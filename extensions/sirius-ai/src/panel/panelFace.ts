/*---------------------------------------------------------------------------------------------
 *  Sirius — the panel's face of the agent
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { createHash, randomBytes } from 'crypto';
import type { AgentFace, AgentPart, AgentToolCall } from '../agent/core';
import type { ChatChunk, ChatMessage, IAIProvider, SiriusModel, ThinkingBlock, ThinkingConfig, ToolDefinition } from '../types';
import type { ModelRouter } from '../providers/modelRouter';
import { withVisionGuard } from '../providers/visionGuard';
import type { Usage } from './protocol';
import { type PanelTools, asObject } from './tools';

/**
 * The agent core's loop (agent/core.ts) over Sirius's own providers, with Sirius's own message
 * history: no editor language-model layer in between, so the reasoning a model produced goes
 * back exactly as the vendor sent it. Each round offers the mode's tools (panel/tools.ts).
 */
export interface PanelFaceOptions {
	readonly router: ModelRouter;
	readonly provider: IAIProvider;
	readonly model: SiriusModel;
	readonly systemPrompt: string;
	readonly thinking: ThinkingConfig;
	/** Fires on Stop: every round's request is aborted with it, and every tool stops. */
	readonly signal: AbortSignal;
	readonly tools: PanelTools;
	/** Every finished block of reasoning, as it arrives — kept with the answer for the next turn. */
	onReasoning(block: ThinkingBlock): void;
	onUsage(usage: Usage): void;
	/** A round with tool calls is over: its assistant turn is made, its tools run next. */
	onRound(): void;
}

export function panelFace(options: PanelFaceOptions): AgentFace<ChatMessage> {
	let offered: readonly ToolDefinition[] = [];
	// A call the core rescued from a model's prose is named for its round (`rescued-0-0`), the same
	// in every answer; here it gets an id of its own when it is first sent — nine letters and
	// digits, which every vendor takes (Mistral takes no other form).
	const answer = randomBytes(8).toString('hex');
	const named = (call: AgentToolCall): AgentToolCall => call.callId.startsWith('rescued-')
		? { ...call, callId: createHash('sha256').update(`${answer}:${call.callId}`).digest('hex').slice(0, 9) }
		: call;
	return {
		round: () => {
			const round = options.tools.round();
			offered = round.definitions;
			return { toolNames: round.names };
		},
		// A model that cannot see gets a note in place of each image, as Sirius IDE's models do;
		// the images stay in the history for one that can.
		send: async messages => ({
			parts: parts(options.router.chatWithModel(options.provider, options.model, withVisionGuard([...messages], options.model.supportsVision), [...offered], options.signal, {
				systemPrompt: options.systemPrompt,
				thinking: options.thinking
			}), options)
		}),
		assistant: (reasoning, text, calls) => {
			options.onRound();
			return {
				role: 'assistant',
				// Text that is only spaces would go to Anthropic as an empty text block, which it refuses.
				content: text?.trim() ? text : '',
				timestamp: Date.now(),
				...(reasoning.length ? { thinkingBlocks: [...reasoning] } : {}),
				// Kept as every vendor takes them back: arguments an object, whatever this model sent.
				...(calls.length ? { toolCalls: calls.map(named).map(call => ({ id: call.callId, name: call.name, arguments: asObject(call.input) })) } : {})
			};
		},
		run: (calls: readonly AgentToolCall[]) => options.tools.run(calls.map(named), options.signal)
	};
}

/** A provider's chunks, as the agent core reads them. */
async function* parts(chunks: AsyncIterable<ChatChunk>, options: PanelFaceOptions): AsyncIterable<AgentPart> {
	for await (const chunk of chunks) {
		if (chunk.thinking) {
			yield { kind: 'thinking', text: chunk.thinking };
		}
		if (chunk.thinkingBlock) {
			options.onReasoning(chunk.thinkingBlock);
			yield { kind: 'thinkingBlock', block: chunk.thinkingBlock };
		}
		if (chunk.content) {
			yield { kind: 'text', text: chunk.content };
		}
		for (const call of chunk.toolCalls ?? []) {
			yield { kind: 'toolCall', call: { callId: call.id, name: call.name, input: call.arguments } };
		}
		if (chunk.usage) {
			options.onUsage({ input: chunk.usage.promptTokens, output: chunk.usage.completionTokens, ...(chunk.usage.thinkingTokens ? { thinking: chunk.usage.thinkingTokens } : {}) });
		}
	}
}
