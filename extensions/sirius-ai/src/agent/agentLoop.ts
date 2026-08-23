/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Agent Loop
 *  Copyright (c) Arshad Siddiqui. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ChatMessage, ChatChunk, StopReason, ToolCallRequest, ToolCallResult, ToolDefinition } from '../types';
import { ModelRouter } from '../providers/modelRouter';
import { SiriusToolExecutor } from '../tools/toolExecutor';

/** Everything the loop emits as it runs, for a UI to render incrementally. */
export type AgentEvent =
	| { type: 'text'; text: string }
	| { type: 'thinking'; text: string }
	| { type: 'toolStart'; call: ToolCallRequest }
	| { type: 'toolResult'; call: ToolCallRequest; result: ToolCallResult }
	| { type: 'usage'; usage: NonNullable<ChatChunk['usage']> }
	| { type: 'done'; reason: AgentStopReason };

/** Why the loop finished. `max_iterations` is the loop's own guard, not the model's. */
export type AgentStopReason = StopReason | 'max_iterations' | 'cancelled';

export interface AgentRunOptions {
	modelId?: string;
	/** Tools the model may call. Omit to run a plain chat turn with no tools. */
	tools?: ToolDefinition[];
	/** Safety valve against a model that keeps calling tools forever. */
	maxIterations?: number;
	token?: vscode.CancellationToken;
}

const DEFAULT_MAX_ITERATIONS = 8;

/**
 * Drives the request → tool call → result → request cycle until the model stops
 * asking for tools.
 *
 * The previous implementation parsed tool calls out of the response text after
 * the stream had finished and never sent the results anywhere, so tools fired
 * once as a side effect and the model never saw what they returned. Closing the
 * loop is what makes tool use actually work.
 */
export class SiriusAgentLoop {

	constructor(
		private readonly router: ModelRouter,
		private readonly executor: SiriusToolExecutor
	) { }

	async *run(history: ChatMessage[], options: AgentRunOptions = {}): AsyncIterable<AgentEvent> {
		const messages = [...history];
		const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

		for (let iteration = 0; iteration < maxIterations; iteration++) {
			if (options.token?.isCancellationRequested) {
				yield { type: 'done', reason: 'cancelled' };
				return;
			}

			let text = '';
			let toolCalls: ToolCallRequest[] | undefined;
			let stopReason: StopReason = 'end_turn';

			for await (const chunk of this.router.chat(messages, options.modelId, options.tools)) {
				if (options.token?.isCancellationRequested) {
					yield { type: 'done', reason: 'cancelled' };
					return;
				}

				if (chunk.thinking) {
					yield { type: 'thinking', text: chunk.thinking };
				}
				if (chunk.content) {
					text += chunk.content;
					yield { type: 'text', text: chunk.content };
				}
				if (chunk.usage) {
					yield { type: 'usage', usage: chunk.usage };
				}
				if (chunk.done) {
					toolCalls = chunk.toolCalls;
					stopReason = chunk.stopReason ?? 'end_turn';
				}
			}

			if (!toolCalls?.length) {
				yield { type: 'done', reason: stopReason };
				return;
			}

			// Record the assistant's own turn, tool calls included. Without this the
			// next request would carry results answering a request the model cannot
			// see, which every provider rejects.
			messages.push({
				role: 'assistant',
				content: text,
				timestamp: Date.now(),
				toolCalls
			});

			const results: ToolCallResult[] = [];
			for (const call of toolCalls) {
				if (options.token?.isCancellationRequested) {
					yield { type: 'done', reason: 'cancelled' };
					return;
				}

				yield { type: 'toolStart', call };
				const result = await this._runTool(call);
				results.push(result);
				yield { type: 'toolResult', call, result };
			}

			// Every result goes back in a single turn. Splitting them across turns
			// teaches the model to stop making parallel calls.
			messages.push({
				role: 'tool',
				content: '',
				timestamp: Date.now(),
				toolResults: results
			});
		}

		yield { type: 'done', reason: 'max_iterations' };
	}

	/**
	 * A tool that throws still has to answer. Dropping the result leaves the model
	 * waiting on a call it can see it made.
	 */
	private async _runTool(call: ToolCallRequest): Promise<ToolCallResult> {
		try {
			const outcome = await this.executor.execute(call);
			return {
				id: call.id,
				name: call.name,
				content: outcome.output,
				isError: !outcome.success
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				id: call.id,
				name: call.name,
				content: `Tool threw: ${message}`,
				isError: true
			};
		}
	}
}
