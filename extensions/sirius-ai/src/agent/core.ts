/*---------------------------------------------------------------------------------------------
 *  Sirius — the agent loop
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import type { ThinkingBlock } from '../types';

/**
 * The agent's loop, with no user interface in it: ask the model, show what it writes and
 * thinks, run the tools it calls, hand back the results, and go round again until it
 * answers without a call.
 *
 * Each face of the agent supplies the model, the tools and where the output goes — the
 * editor's own chat in Sirius IDE (chat/siriusAgent.ts). Nothing here touches an editor
 * API, so the same loop can serve another face without change.
 *
 * The reasoning a model produced in a round goes back with the round's assistant turn,
 * whole and in order: Anthropic requires the thinking that led to a tool call to come back
 * with the call's result, and without it the model resumes without its own line of thought.
 */

/** A tool call the model made, or one rescued from its prose. */
export interface AgentToolCall {
	readonly callId: string;
	readonly name: string;
	readonly input: object;
}

/** What a model's reply is made of, as the loop sees it. */
export type AgentPart =
	| { readonly kind: 'text'; readonly text: string }
	/** Reasoning to show as it streams. */
	| { readonly kind: 'thinking'; readonly text: string; readonly id?: string; readonly metadata?: { readonly [key: string]: unknown } }
	/** A finished block of reasoning, whole, to send back. */
	| { readonly kind: 'thinkingBlock'; readonly block: ThinkingBlock }
	| { readonly kind: 'toolCall'; readonly call: AgentToolCall }
	/** Anything else the model sent; nothing is done with it, but Stop is still checked. */
	| { readonly kind: 'other' };

export interface AgentReply {
	readonly parts: AsyncIterable<AgentPart>;
	/** Called when the round is over, after its tools have run — or when it fails. */
	dispose?(): void;
}

export interface Cancellation {
	readonly isCancellationRequested: boolean;
}

/** One face of the agent: its model, its tools, and its own message shape `M`. */
export interface AgentFace<M> {
	/** Fixes this round's offer of tools; the names are what a rescued call may use. */
	round(): { readonly toolNames: ReadonlySet<string> };
	/** Sends the conversation with this round's tools. */
	send(messages: readonly M[], token: Cancellation): Promise<AgentReply>;
	/** The assistant's turn as the model gave it: its reasoning, then any text, then its calls. */
	assistant(reasoning: readonly ThinkingBlock[], text: string | undefined, calls: readonly AgentToolCall[]): M;
	/** Runs the calls and returns the message that carries their results. */
	run(calls: readonly AgentToolCall[], token: Cancellation): Promise<M>;
}

/** Where the loop's output goes. */
export interface AgentSink {
	markdown(text: string): void;
	thinking(text: string, id: string, metadata: { readonly [key: string]: unknown } | undefined): void;
}

export const MAX_TOOL_ROUNDS = 25;

/**
 * Runs rounds until the model answers without a tool call, the request is cancelled, or
 * MAX_TOOL_ROUNDS is reached. `messages` is extended in place with each round's assistant
 * turn and its results.
 */
export async function runAgent<M>(messages: M[], face: AgentFace<M>, sink: AgentSink, token: Cancellation, log: (line: string) => void): Promise<void> {
	for (let round = 0; round < MAX_TOOL_ROUNDS && !token.isCancellationRequested; round++) {
		const { toolNames } = face.round();
		const reply = await face.send(messages, token);
		try {
			const emitted = new TextGate(sink, toolNames, log);
			const calls: AgentToolCall[] = [];
			const reasoning: ThinkingBlock[] = [];
			let thinking = 0;

			for await (const part of reply.parts) {
				if (token.isCancellationRequested) {
					return;
				}
				switch (part.kind) {
					case 'text':
						emitted.push(part.text);
						break;
					case 'toolCall':
						calls.push(part.call);
						break;
					case 'thinking':
						// The editor renders it as a collapsible section; without it the
						// reasoning was paid for and never shown.
						if (part.text) {
							thinking += part.text.length;
							sink.thinking(part.text, part.id ?? `thinking-${round}`, part.metadata);
						}
						break;
					case 'thinkingBlock':
						reasoning.push(part.block);
						break;
					case 'other':
						break;
				}
			}
			// A small model sometimes writes its tool call as prose instead of using the
			// mechanism; the gate holds such text back so it can run as a real call
			// instead of leaking JSON into the conversation.
			const rescued = emitted.finish(round);
			calls.push(...rescued);

			log(`[round ${round}] text=${emitted.total} thinking=${thinking} calls=${calls.map(c => c.name).join(',') || 'none'}${reasoning.length ? ` reasoning=${reasoning.length}` : ''}`);

			if (calls.length === 0) {
				return;
			}

			messages.push(face.assistant(reasoning, emitted.total > 0 && rescued.length === 0 ? emitted.text : undefined, calls));
			messages.push(await face.run(calls, token));
		} finally {
			reply.dispose?.();
		}
	}

	if (!token.isCancellationRequested) {
		sink.markdown('\n\nStopping here — this task took more tool rounds than expected. Say "continue" to keep going.');
	}
}

/**
 * Buffers a round's text so a small model's tool call written as prose — bare
 * or wrapped in a markdown fence — can be converted into a real invocation
 * instead of leaking JSON into the conversation. Long prose streams normally
 * once it is clearly not a tool call.
 */
export class TextGate {
	text = '';
	total = 0;
	private streamedFrom = 0;
	private decidedProse = false;

	constructor(
		private readonly sink: Pick<AgentSink, 'markdown'>,
		private readonly toolNames: ReadonlySet<string>,
		private readonly log: (line: string) => void
	) { }

	push(value: string): void {
		this.text += value;
		this.total += value.length;

		// Past this size it is an answer, not a call — stream it live.
		if (!this.decidedProse && this.total > 4096 && !this.extractCall()) {
			this.decidedProse = true;
		}
		if (this.decidedProse) {
			this.sink.markdown(this.text.slice(this.streamedFrom));
			this.streamedFrom = this.text.length;
		}
	}

	finish(round: number): AgentToolCall[] {
		// A small model may write several calls in one breath; convert every
		// one, and only the leftover prose reaches the conversation.
		const calls: AgentToolCall[] = [];
		let remaining = this.text;
		for (let i = 0; i < 6; i++) {
			const found = this.extractCallIn(remaining);
			if (!found) {
				break;
			}
			this.log(`[rescue] textual tool call converted: ${found.name}`);
			calls.push({ callId: `rescued-${round}-${i}`, name: found.name, input: found.args });
			remaining = remaining.slice(0, found.start) + remaining.slice(found.end);
		}
		if (calls.length > 0) {
			const prose = remaining.replace(/```[a-zA-Z]*\s*```/g, '').trim();
			if (prose) {
				this.sink.markdown(prose + '\n\n');
			}
			return calls;
		}
		if (this.streamedFrom < this.text.length) {
			this.sink.markdown(this.text.slice(this.streamedFrom));
			this.streamedFrom = this.text.length;
		}
		return calls;
	}

	private extractCall(): { name: string; args: object; start: number; end: number } | undefined {
		return this.extractCallIn(this.text);
	}

	/** A fenced or bare {"name": ..., "arguments": ...} for a known tool. */
	private extractCallIn(text: string): { name: string; args: object; start: number; end: number } | undefined {
		const fenced = /```[a-zA-Z]*\s*\n?([\s\S]*?)```/.exec(text);
		const candidates: Array<{ body: string; start: number; end: number }> = [];
		if (fenced) {
			candidates.push({ body: fenced[1], start: fenced.index, end: fenced.index + fenced[0].length });
		}
		const brace = text.indexOf('{');
		if (brace !== -1) {
			const close = text.lastIndexOf('}');
			if (close > brace) {
				candidates.push({ body: text.slice(brace, close + 1), start: brace, end: close + 1 });
			}
		}
		for (const candidate of candidates) {
			try {
				const parsed = JSON.parse(candidate.body.trim()) as { name?: string; arguments?: unknown };
				if (parsed && typeof parsed.name === 'string' && this.toolNames.has(parsed.name)) {
					return {
						name: parsed.name,
						args: (parsed.arguments as object | undefined) ?? {},
						start: candidate.start,
						end: candidate.end
					};
				}
			} catch {
				// keep looking
			}
		}
		return undefined;
	}
}

/**
 * Where a thinking block rides in a language-model part's metadata, between the
 * language-model bridge (lm/languageModelProvider.ts) and the editor's face of the agent.
 */
export const THINKING_BLOCK_KEY = 'siriusThinkingBlock';

/** The thinking block carried in a part's metadata, if it is one. */
export function thinkingBlockOf(metadata: unknown): ThinkingBlock | undefined {
	const block = (metadata as { readonly [THINKING_BLOCK_KEY]?: unknown } | undefined)?.[THINKING_BLOCK_KEY];
	if (typeof block !== 'object' || block === null || typeof (block as ThinkingBlock).text !== 'string') {
		return undefined;
	}
	const { text, signature, redacted, binding } = block as ThinkingBlock;
	return {
		text,
		...(typeof signature === 'string' ? { signature } : {}),
		...(typeof redacted === 'string' ? { redacted } : {}),
		...(typeof binding === 'string' ? { binding } : {})
	};
}
