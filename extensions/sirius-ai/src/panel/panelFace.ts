/*---------------------------------------------------------------------------------------------
 *  Sirius — the panel's face of the agent
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import type { AgentFace, AgentPart, AgentToolCall } from '../agent/core';
import type { ChatChunk, ChatMessage, IAIProvider, SiriusModel, ThinkingBlock, ThinkingConfig } from '../types';
import type { ModelRouter } from '../providers/modelRouter';
import type { Usage } from './protocol';

/**
 * The agent core's loop (agent/core.ts) over Sirius's own providers, with Sirius's own message
 * history: no editor language-model layer in between, so the reasoning a model produced goes
 * back exactly as the vendor sent it. Tools join in a later phase; until then nothing is offered
 * and the loop ends after one round.
 */
export interface PanelFaceOptions {
	readonly router: ModelRouter;
	readonly provider: IAIProvider;
	readonly model: SiriusModel;
	readonly systemPrompt: string;
	readonly thinking: ThinkingConfig;
	/** Fires on Stop: every round's request is aborted with it. */
	readonly signal: AbortSignal;
	/** Every finished block of reasoning, as it arrives — kept with the answer for the next turn. */
	onReasoning(block: ThinkingBlock): void;
	onUsage(usage: Usage): void;
}

export function panelFace(options: PanelFaceOptions): AgentFace<ChatMessage> {
	return {
		round: () => ({ toolNames: new Set<string>() }),
		send: async messages => ({
			parts: parts(options.router.chatWithModel(options.provider, options.model, [...messages], undefined, options.signal, {
				systemPrompt: options.systemPrompt,
				thinking: options.thinking
			}), options)
		}),
		assistant: (reasoning, text, calls) => ({
			role: 'assistant',
			content: text ?? '',
			timestamp: Date.now(),
			...(reasoning.length ? { thinkingBlocks: [...reasoning] } : {}),
			...(calls.length ? { toolCalls: calls.map(call => ({ id: call.callId, name: call.name, arguments: call.input as Record<string, unknown> })) } : {})
		}),
		run: async (calls: readonly AgentToolCall[]) => ({
			role: 'tool',
			content: '',
			timestamp: Date.now(),
			toolResults: calls.map(call => ({ id: call.callId, name: call.name, content: 'Tools are not available in this panel yet.', isError: true }))
		})
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
