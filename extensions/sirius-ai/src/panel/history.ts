/*---------------------------------------------------------------------------------------------
 *  Sirius — the panel's conversation, as it goes back to a model
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import type { ChatMessage, ProviderType } from '../types';
import type { StoredTurn } from './sessions';

/** A rough characters-per-token figure, for sizing what fits rather than counting it. */
const CHARS_PER_TOKEN = 4;
/** The share of a model's window the earlier turns may fill; the rest is the question, its tools and the answer. */
const HISTORY_SHARE = 0.6;
/** What an image costs a model, roughly, in characters' worth: vendors bill a picture by its size, not its bytes. */
const IMAGE_CHARS = 1_600 * CHARS_PER_TOKEN;

/**
 * The conversation before `current`, as it went to the model: each answer's tool rounds whole,
 * then its last round's text with that round's reasoning, to go back unchanged — a model that
 * binds its reasoning to the conversation refuses an edited history. Two things are adjusted for
 * the model it goes to now, neither of which touches a vendor's own reasoning:
 * - call ids another vendor would refuse are renamed, with their results (see `fitIds`);
 * - when the turns outgrow `HISTORY_SHARE` of the model's window, the oldest are left out whole,
 *   from the front, which is the one place a history can lose turns without the later reasoning
 *   being refused.
 */
export function buildHistory(turns: readonly StoredTurn[], current: StoredTurn, provider: ProviderType, contextWindow: number): ChatMessage[] {
	const exchanges: ChatMessage[][] = [];
	for (const turn of turns) {
		if (turn === current) {
			break;
		}
		if (turn.role === 'user') {
			exchanges.push([{ role: 'user', content: turn.text, timestamp: turn.at }]);
			continue;
		}
		const exchange = exchanges[exchanges.length - 1] ?? [];
		if (!exchanges.length) {
			exchanges.push(exchange);
		}
		const rounds = answered(turn.rounds ?? []);
		exchange.push(...rounds);
		const text = turn.text.slice(rounds.length ? turn.finalFrom ?? turn.text.length : 0);
		if (text.trim()) {
			exchange.push({ role: 'assistant', content: text, timestamp: turn.at, ...(turn.reasoning?.length ? { thinkingBlocks: turn.reasoning } : {}) });
		} else if (rounds.length) {
			// The answer ended after a tool round: the results are the last word and the model's turn
			// comes next — said plainly, so every vendor reads the turns in order.
			exchange.push({ role: 'assistant', content: turn.stopped ? '(The user stopped this answer.)' : '(The answer ended here.)', timestamp: turn.at });
		}
	}

	const budget = Math.max(16_000, contextWindow * CHARS_PER_TOKEN * HISTORY_SHARE);
	let size = exchanges.reduce((sum, exchange) => sum + sizeOf(exchange), 0);
	while (exchanges.length > 1 && size > budget) {
		size -= sizeOf(exchanges.shift()!);
	}
	return fitIds(exchanges.flat(), provider);
}

/**
 * Tool rounds as kept, less a last assistant turn whose calls never got their results (its tools
 * could not run): sent on, every vendor would refuse the conversation from then on.
 */
export function answered(rounds: readonly ChatMessage[]): ChatMessage[] {
	const kept = [...rounds];
	const last = kept[kept.length - 1];
	if (last?.role === 'assistant' && last.toolCalls?.length) {
		kept.pop();
	}
	return kept;
}

/** Roughly what messages cost a model, in characters: text as it is, each image at IMAGE_CHARS. */
function sizeOf(messages: readonly ChatMessage[]): number {
	let images = 0;
	const text = JSON.stringify(messages, (key, value) => {
		if (key === 'images' && Array.isArray(value)) {
			images += value.length;
			return undefined;
		}
		return value;
	});
	return text.length + images * IMAGE_CHARS;
}

/**
 * Call ids as the model it goes to takes them. A vendor makes its own ids, and some restart them
 * every round (Ollama's `call_0`, ids Sirius gives a call that came without one) or use characters
 * another refuses (`functions.read:0`), which the vendor that made them takes but another refuses
 * after a switch of model: every vendor, a repeated id; Anthropic, any character but letters,
 * digits, `_` and `-`; Mistral, any id that is not nine letters and digits. A call keeps its id
 * where it can; one that cannot gets a new id, and its result and any reasoning bound to it follow.
 */
function fitIds(messages: ChatMessage[], provider: ProviderType): ChatMessage[] {
	const seen = new Set<string>();
	const shaped = provider === 'mistral' ? /^[A-Za-z0-9]{9}$/ : provider === 'anthropic' ? /^[A-Za-z0-9_-]{1,64}$/ : /./;
	const fits = (id: string): boolean => !seen.has(id) && shaped.test(id);
	const fresh = (id: string, n: number): string => {
		for (let salt = 0; ; salt++) {
			const hash = createHash('sha256').update(`${id}:${n}:${salt}`).digest('base64').replace(/[^A-Za-z0-9]/g, '');
			const candidate = provider === 'mistral' ? hash.slice(0, 9) : `call_${hash.slice(0, 16)}`;
			if (!seen.has(candidate)) {
				return candidate;
			}
		}
	};
	// A round's renamed ids, in order, by the id they replace: two calls of one round can share an
	// id, and their results follow them one by one.
	let renamed = new Map<string, string[]>();
	return messages.map((message, n) => {
		if (message.role === 'assistant' && message.toolCalls?.length) {
			renamed = new Map();
			const toolCalls = message.toolCalls.map((call, i) => {
				const id = fits(call.id) ? call.id : fresh(call.id, n * 1000 + i);
				seen.add(id);
				renamed.set(call.id, [...(renamed.get(call.id) ?? []), id]);
				return id === call.id ? call : { ...call, id };
			});
			if (toolCalls.every((call, i) => call === message.toolCalls![i])) {
				return message;
			}
			const first = (id: string) => renamed.get(id)?.[0] ?? id;
			const thinkingBlocks = message.thinkingBlocks?.map(block => block.call && first(block.call) !== block.call ? { ...block, call: first(block.call) } : block);
			return { ...message, toolCalls, ...(thinkingBlocks ? { thinkingBlocks } : {}) };
		}
		if (message.role === 'tool' && renamed.size && message.toolResults?.length) {
			const queues = new Map([...renamed].map(([id, ids]) => [id, [...ids]]));
			return {
				...message, toolResults: message.toolResults.map(result => {
					const id = queues.get(result.id)?.shift();
					return id && id !== result.id ? { ...result, id } : result;
				})
			};
		}
		return message;
	});
}
