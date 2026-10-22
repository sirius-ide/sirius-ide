/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Anthropic Claude Provider
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { IAIProvider, KeySource, SiriusModel, ChatRequest, ChatChunk, ChatMessage, ImagePart, ProviderType, ThinkingEffort, ToolCallRequest, StopReason } from '../types';
import { ConnectionCheck, checkEndpoint } from './connection';

/** A content block in a response: text, thinking, or a tool call. */
interface AnthropicContentBlock {
	type?: string;
	text?: string;
	thinking?: string;
	id?: string;
	name?: string;
	input?: Record<string, unknown>;
}

/** The subset of Anthropic's Messages response that this provider reads. */
interface AnthropicMessageResponse {
	content?: AnthropicContentBlock[];
	stop_reason?: string;
	usage?: AnthropicUsage;
}

/** The subset of the SSE event stream that this provider reads. */
interface AnthropicStreamEvent {
	type?: string;
	index?: number;
	content_block?: AnthropicContentBlock;
	delta?: {
		type?: string;
		text?: string;
		thinking?: string;
		partial_json?: string;
		stop_reason?: string;
	};
	usage?: AnthropicUsage;
}

/** One Anthropic wire message. Content is a string or an array of blocks. */
interface AnthropicWireMessage {
	role: 'user' | 'assistant';
	content: string | unknown[];
}

/**
 * `input_tokens` counts only the tokens after the last cache breakpoint, so the
 * true input is that plus both cache figures.
 */
interface AnthropicUsage {
	input_tokens?: number;
	output_tokens?: number;
	cache_creation_input_tokens?: number;
	cache_read_input_tokens?: number;
}

/** The vendor's API, unless a gateway or proxy that speaks it is configured. */
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

/** From the least to the most; a level a model lacks steps down to the nearest it has. */
const EFFORT_LEVELS: readonly ThinkingEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** `budget_tokens` for a model that takes thinking as a budget rather than an effort. */
const THINKING_BUDGET: Record<ThinkingEffort, number> = { low: 1024, medium: 4096, high: 16384, xhigh: 32768, max: 65536 };

/**
 * The generations before 4.6: thinking is a token budget (`enabled`), there is no
 * `output_config.effort`, and sampling parameters are still accepted. Later generations
 * reason adaptively, take `effort`, and reject `temperature`.
 */
const LEGACY_GENERATION = /^claude-(3-|opus-4-([015]|2025)|sonnet-4-([05]|2025)|haiku-4-5)/;

interface CapabilitySupport {
	supported?: boolean;
}

/** The subset of a model's `capabilities` from `GET /v1/models` that shapes a request. */
interface AnthropicCapabilities {
	image_input?: CapabilitySupport;
	thinking?: CapabilitySupport & { types?: Partial<Record<'adaptive' | 'enabled' | 'disabled' | 'between_tools', CapabilitySupport>> };
	effort?: CapabilitySupport & Partial<Record<ThinkingEffort, CapabilitySupport | null>>;
}

/** One model as `GET /v1/models` describes it. */
interface AnthropicModelInfo {
	id?: string;
	display_name?: string;
	lifecycle?: string;
	max_input_tokens?: number | null;
	max_tokens?: number | null;
	retires_at?: string | null;
	capabilities?: AnthropicCapabilities | null;
}

/** One page of the listing; `has_more` and `last_id` page it. */
interface AnthropicModelList {
	data?: AnthropicModelInfo[];
	has_more?: boolean;
	last_id?: string | null;
}

/**
 * What a model accepts: read from its capabilities when discovery described it, otherwise
 * from what its generation is known to take. Sending a parameter a model does not accept
 * is a hard 400, not a warning.
 */
interface ModelRules {
	/** The model can think at all. */
	thinking: boolean;
	/** `thinking: { type: 'adaptive' }` — the model decides how much. */
	adaptive: boolean;
	/** `thinking: { type: 'enabled', budget_tokens }` — the pre-4.6 form. */
	enabled: boolean;
	/** `thinking: { type: 'disabled' }` is accepted; false on a model that always reasons. */
	disabled: boolean;
	/** `thinking: { type: 'between_tools' }` — up-front thinking off, where `disabled` is refused. */
	betweenTools: boolean;
	/** The effort levels accepted, or none: then `output_config.effort` is not sent. */
	effort: ReadonlySet<ThinkingEffort> | undefined;
	/** `temperature` is accepted — the pre-4.6 generations only. */
	sampling: boolean;
}

/** The thinking, effort and sampling fields of one request. */
interface RequestShape {
	thinking?: Record<string, unknown>;
	effort?: ThinkingEffort;
	temperature: boolean;
}

export class AnthropicProvider implements IAIProvider {
	readonly id: ProviderType = 'anthropic';
	readonly name = 'Anthropic Claude';
	/**
	 * What is offered before discovery has answered, and when it cannot (no key, a gateway
	 * without `/v1/models` — its 404 passes the connection check): the current lineup, then
	 * the previous generation. Discovery replaces it with what the key can actually use.
	 */
	readonly models: SiriusModel[] = [
		// ─── Current ──────────────────────────────────────────────────────
		{
			id: 'claude-opus-5-5',
			name: 'Claude Opus 5.5',
			provider: 'anthropic',
			contextWindow: 1000000,
			description: 'Best all-round coding and agentic model — thinking always on',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false,
			maxOutputTokens: 128000
		},
		{
			id: 'claude-fable-5-1',
			name: 'Claude Fable 5.1',
			provider: 'anthropic',
			contextWindow: 1000000,
			description: 'Most capable — the hardest reasoning and long-horizon work. Always reasons; costs more',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false,
			maxOutputTokens: 128000
		},
		{
			id: 'claude-sonnet-5-5',
			name: 'Claude Sonnet 5.5',
			provider: 'anthropic',
			contextWindow: 1000000,
			description: 'Speed and intelligence balanced — a good daily driver',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false,
			maxOutputTokens: 128000
		},
		{
			id: 'claude-haiku-5-5',
			name: 'Claude Haiku 5.5',
			provider: 'anthropic',
			contextWindow: 1000000,
			description: 'Fastest and cheapest — quick completions and high-volume work',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false,
			maxOutputTokens: 128000
		},
		// ─── Previous generation ──────────────────────────────────────────
		{
			id: 'claude-opus-5',
			name: 'Claude Opus 5',
			provider: 'anthropic',
			contextWindow: 1000000,
			description: 'The previous Opus — still excellent for complex reasoning',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false,
			maxOutputTokens: 128000
		},
		{
			id: 'claude-fable-5',
			name: 'Claude Fable 5',
			provider: 'anthropic',
			contextWindow: 1000000,
			description: 'The previous Fable — always reasons; costs more',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false,
			maxOutputTokens: 128000
		},
		{
			id: 'claude-sonnet-5',
			name: 'Claude Sonnet 5',
			provider: 'anthropic',
			contextWindow: 1000000,
			description: 'The previous Sonnet',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false,
			maxOutputTokens: 128000
		},
		{
			id: 'claude-opus-4-8',
			name: 'Claude Opus 4.8',
			provider: 'anthropic',
			contextWindow: 1000000,
			description: 'The last Opus of the 4.x line',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false,
			maxOutputTokens: 128000
		},
		{
			id: 'claude-haiku-4-5',
			name: 'Claude Haiku 4.5',
			provider: 'anthropic',
			contextWindow: 200000,
			description: 'The previous fast model — takes no effort setting',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: false,
			supportsImageGen: false,
			maxOutputTokens: 64000
		}
	];

	/** What discovery learnt about each model this key can use, by id — requests are shaped from it. */
	private readonly _capabilities = new Map<string, AnthropicCapabilities>();

	/** @param baseUrl a gateway or proxy that speaks Anthropic's API; else the vendor's. */
	constructor(private readonly secrets: KeySource, private readonly baseUrl?: string) { }

	private getApiKey(): string {
		return this.secrets.get('anthropic');
	}

	private _baseUrl(): string {
		return (this.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
	}

	private _headers(): Record<string, string> {
		return { 'x-api-key': this.getApiKey(), 'anthropic-version': '2023-06-01' };
	}

	isConfigured(): boolean {
		return this.getApiKey().length > 0;
	}

	checkConnection(): Promise<ConnectionCheck> {
		// Listing models costs nothing; the check used to spend a real completion.
		return checkEndpoint(`${this._baseUrl()}/v1/models?limit=1`, this._headers(), 'Anthropic', {
			notFoundIsFine: this._baseUrl() !== DEFAULT_BASE_URL,
			noRedirect: true
		});
	}

	async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
		const apiKey = this.getApiKey();
		if (!apiKey) {
			yield { content: '⚠️ No Anthropic API key. Add Anthropic in **Manage Models** (or **Sirius: Set API Key**).', done: true };
			return;
		}

		const model = request.model || 'claude-opus-5-5';
		const shape = this._shape(model, request);

		const body: Record<string, unknown> = {
			model,
			max_tokens: request.maxTokens,
			messages: this._toWireMessages(request.messages)
		};

		// Tool definitions are stable across turns, so they sit before the system
		// prompt's cache breakpoint and are cached along with it.
		if (request.tools?.length) {
			body.tools = request.tools.map(t => ({
				name: t.name,
				description: t.description,
				input_schema: t.inputSchema
			}));
		}

		// The system prompt is byte-identical on every turn, so mark it as a cache
		// breakpoint. Cached reads bill at a tenth of the input rate and do not
		// count toward the input-tokens-per-minute limit at all, which matters a
		// lot for an editor that re-sends the same preamble constantly.
		if (request.systemPrompt) {
			body.system = [{
				type: 'text',
				text: request.systemPrompt,
				cache_control: { type: 'ephemeral' }
			}];
		}

		// ─── Thinking, effort and sampling ────────────────────────────────
		// Shaped from what the model accepts (discovery's `capabilities`, or its
		// generation): a model that always reasons gets no `thinking` field, a pre-4.6
		// model a token budget and no `output_config`, and `temperature` only goes
		// where it is still taken.
		if (shape.thinking) {
			body.thinking = shape.thinking;
		}
		if (shape.effort) {
			body.output_config = { effort: shape.effort };
		}
		if (shape.temperature) {
			// Anthropic takes 0–1 where the setting allows up to 2.
			body.temperature = Math.min(Math.max(request.temperature, 0), 1);
		}

		// Streaming
		if (request.stream) {
			body.stream = true;
		}

		try {
			// No redirect: the key sits in a custom header, which `fetch` would carry to
			// another host, unlike an Authorization header.
			const response = await fetch(`${this._baseUrl()}/v1/messages`, {
				method: 'POST',
				headers: { ...this._headers(), 'content-type': 'application/json' },
				body: JSON.stringify(body),
				signal: request.signal,
				redirect: 'error'
			});

			if (!response.ok) {
				yield { content: await this._describeError(response), done: true };
				return;
			}

			if (request.stream) {
				yield* this._handleStream(response);
			} else {
				yield* this._handleNonStream(response);
			}
		} catch (error: any) {
			if (request.signal?.aborted) {
				return; // the user stopped it, and the editor is no longer reading
			}
			yield { content: `⚠️ Anthropic Error: ${error.message}`, done: true };
		}
	}

	/**
	 * Total input is the post-breakpoint tokens plus everything written to or
	 * read from the cache; reporting `input_tokens` alone hides cached context.
	 */
	private _summariseUsage(usage: AnthropicUsage | undefined): ChatChunk['usage'] {
		const fresh = usage?.input_tokens ?? 0;
		const written = usage?.cache_creation_input_tokens ?? 0;
		const read = usage?.cache_read_input_tokens ?? 0;
		const promptTokens = fresh + written + read;
		const completionTokens = usage?.output_tokens ?? 0;

		return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
	}

	/**
	 * The thinking, effort and sampling fields for one request. `effort` is a field of
	 * `output_config`, not of `thinking`; turning thinking off is rejected above `high`;
	 * a thinking budget must stay under `max_tokens`.
	 */
	private _shape(model: string, request: ChatRequest): RequestShape {
		const capabilities = this._capabilities.get(model);
		const rules = capabilities
			? rulesFromCapabilities(model, capabilities)
			: rulesFromId(model, this.models.find(m => m.id === model));
		let effort: ThinkingEffort = request.thinking?.effort ?? 'high';
		let thinking: Record<string, unknown> | undefined;

		if (request.thinking?.enabled && rules.thinking) {
			if (rules.adaptive) {
				// `display` defaults to omitted, which streams empty thinking blocks
				// and leaves the thinking pane blank. Ask for a summary explicitly.
				thinking = { type: 'adaptive', display: 'summarized' };
			} else if (rules.enabled) {
				// The budget counts against `max_tokens`: at most half of it, so the
				// answer keeps the other half.
				const budget = Math.min(THINKING_BUDGET[effort], Math.floor(request.maxTokens / 2));
				if (budget >= 1024) {
					thinking = { type: 'enabled', budget_tokens: budget };
				}
			}
		} else if (rules.adaptive) {
			// An adaptive model reasons unless told not to; a budget model does not reason
			// unless given a budget, so nothing is sent to it.
			if (rules.disabled) {
				thinking = { type: 'disabled' };
				effort = atMost(effort, 'high');
			} else if (rules.betweenTools) {
				thinking = { type: 'between_tools' };
				effort = atMost(effort, 'high');
			}
			// Otherwise the model reasons on every request: nothing to send.
		}

		const reasoning = thinking?.type === 'adaptive' || thinking?.type === 'enabled';
		return {
			thinking,
			effort: pickEffort(effort, rules.effort),
			// Sampling is meaningless while the model reasons, and rejected where it was removed.
			temperature: rules.sampling && !reasoning
		};
	}

	/**
	 * Turn a failed response into something a user can act on. A spend-cap 429
	 * looks like a rate limit but carries no retry-after and will not clear until
	 * the next billing month, so the two are worth telling apart.
	 */
	private async _describeError(response: Response): Promise<string> {
		const raw = await response.text();
		let message = raw;
		let errorCode: string | undefined;

		try {
			const parsed = JSON.parse(raw) as {
				error?: { message?: string; details?: { error_code?: string } };
			};
			message = parsed.error?.message ?? raw;
			errorCode = parsed.error?.details?.error_code;
		} catch {
			// Not JSON — fall back to the raw body.
		}

		switch (response.status) {
			case 401:
			case 403:
				return '⚠️ Anthropic rejected the API key. Change it in **Manage Models** — Configure on the provider\'s row.';
			case 404:
				return `⚠️ Anthropic does not recognise that model. Pick another with **Sirius: Select AI Model**. (${message})`;
			case 429: {
				if (errorCode === 'enforced_spend_limit_reached') {
					return `⚠️ Your Anthropic organisation has reached its monthly spend cap, so requests are paused until it resets. ${message}`;
				}
				const retryAfter = response.headers.get('retry-after');
				return `⚠️ Rate limited by Anthropic${retryAfter ? ` — try again in ${retryAfter}s` : ''}. ${message}`;
			}
			case 400:
				return `⚠️ Anthropic rejected the request: ${message}`;
			default:
				return `⚠️ Anthropic API error (${response.status}): ${message}`;
		}
	}

	/**
	 * Convert Sirius messages to Anthropic's wire format.
	 *
	 * Anthropic carries tool calls and their results as content blocks, and
	 * results come back on a `user` turn rather than a dedicated tool role.
	 */
	private _toWireMessages(messages: ChatMessage[]): AnthropicWireMessage[] {
		const wire: AnthropicWireMessage[] = [];

		for (const message of messages) {
			if (message.role === 'system') {
				continue;
			}

			if (message.role === 'tool') {
				wire.push({
					role: 'user',
					content: (message.toolResults ?? []).map(result => ({
						type: 'tool_result',
						tool_use_id: result.id,
						content: anthropicBlocks(result.content, result.images),
						...(result.isError ? { is_error: true } : {})
					}))
				});
				continue;
			}

			if (message.role === 'assistant' && message.toolCalls?.length) {
				const blocks: unknown[] = [];
				if (message.content) {
					blocks.push({ type: 'text', text: message.content });
				}
				for (const call of message.toolCalls) {
					blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
				}
				wire.push({ role: 'assistant', content: blocks });
				continue;
			}

			wire.push({ role: message.role, content: anthropicBlocks(message.content, message.images) });
		}

		return wire;
	}

	/**
	 * Rebuild tool calls from the accumulated per-block JSON fragments.
	 *
	 * A call whose arguments failed to parse is still returned, with empty
	 * arguments, so the agent loop reports the failure back to the model rather
	 * than dropping the call and leaving the model waiting for a result.
	 */
	private _collectToolCalls(pending: Map<number, { id: string; name: string; json: string }>): ToolCallRequest[] | undefined {
		if (pending.size === 0) {
			return undefined;
		}

		return Array.from(pending.values()).map(({ id, name, json }) => {
			let args: Record<string, unknown> = {};
			try {
				args = json.trim() ? JSON.parse(json) as Record<string, unknown> : {};
			} catch {
				// Leave the arguments empty; the tool reports what it was missing.
			}
			return { id, name, arguments: args };
		});
	}

	private _toStopReason(raw: string | undefined): StopReason {
		switch (raw) {
			case 'tool_use': return 'tool_use';
			case 'max_tokens': return 'max_tokens';
			case 'refusal': return 'refusal';
			default: return 'end_turn';
		}
	}

	/**
	 * Handle SSE streaming, accumulating text, thinking and tool calls.
	 *
	 * Tool arguments arrive as a stream of JSON fragments (`input_json_delta`)
	 * keyed by content-block index, so they must be reassembled per block before
	 * they can be parsed.
	 */
	private async *_handleStream(response: Response): AsyncIterable<ChatChunk> {
		const reader = response.body?.getReader();
		if (!reader) {
			yield { content: '⚠️ No response stream available', done: true, stopReason: 'error' };
			return;
		}

		const decoder = new TextDecoder();
		const pendingTools = new Map<number, { id: string; name: string; json: string }>();
		let buffer = '';
		let isInThinkingBlock = false;
		let stopReason: StopReason = 'end_turn';
		let usage: ChatChunk['usage'];

		while (true) {
			const { done, value } = await reader.read();
			if (done) { break; }

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				if (!line.startsWith('data: ')) { continue; }
				const data = line.slice(6).trim();
				if (!data || data === '[DONE]') { continue; }

				let event: AnthropicStreamEvent;
				try {
					event = JSON.parse(data) as AnthropicStreamEvent;
				} catch {
					continue; // Skip malformed JSON
				}

				if (event.type === 'content_block_start') {
					const block = event.content_block;
					if (block?.type === 'thinking') {
						isInThinkingBlock = true;
						yield { content: '', thinking: '', isThinkingBlock: true, done: false };
					} else if (block?.type === 'tool_use' && block.id && block.name) {
						pendingTools.set(event.index ?? 0, { id: block.id, name: block.name, json: '' });
					} else {
						isInThinkingBlock = false;
					}
					continue;
				}

				if (event.type === 'content_block_delta') {
					const delta = event.delta;
					if (delta?.type === 'thinking_delta') {
						yield { content: '', thinking: delta.thinking || '', done: false };
					} else if (delta?.type === 'text_delta') {
						yield { content: delta.text || '', done: false };
					} else if (delta?.type === 'input_json_delta') {
						const pending = pendingTools.get(event.index ?? 0);
						if (pending) {
							pending.json += delta.partial_json || '';
						}
					}
					continue;
				}

				if (event.type === 'content_block_stop') {
					if (isInThinkingBlock) {
						isInThinkingBlock = false;
						yield { content: '', thinking: '', isThinkingBlock: false, done: false };
					}
					continue;
				}

				if (event.type === 'message_delta') {
					stopReason = this._toStopReason(event.delta?.stop_reason);
					usage = this._summariseUsage(event.usage);
					continue;
				}

				if (event.type === 'message_stop') {
					yield { content: '', done: true, stopReason, usage, toolCalls: this._collectToolCalls(pendingTools) };
					return;
				}
			}
		}

		yield { content: '', done: true, stopReason, usage, toolCalls: this._collectToolCalls(pendingTools) };
	}

	/**
	 * Handle non-streaming response
	 */
	private async *_handleNonStream(response: Response): AsyncIterable<ChatChunk> {
		const result = await response.json() as AnthropicMessageResponse;
		let textContent = '';
		let thinkingContent = '';
		const toolCalls: ToolCallRequest[] = [];

		for (const block of (result.content || [])) {
			if (block.type === 'thinking') {
				thinkingContent += block.thinking || '';
			} else if (block.type === 'text') {
				textContent += block.text || '';
			} else if (block.type === 'tool_use' && block.id && block.name) {
				toolCalls.push({ id: block.id, name: block.name, arguments: block.input ?? {} });
			}
		}

		if (thinkingContent) {
			yield { content: '', thinking: thinkingContent, isThinkingBlock: true, done: false };
		}

		yield {
			content: textContent,
			done: true,
			stopReason: this._toStopReason(result.stop_reason),
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			usage: this._summariseUsage(result.usage)
		};
	}

	/**
	 * Ask Anthropic which models this key can use, and what each accepts.
	 *
	 * The static list above goes stale a generation at a time. `GET /v1/models` carries
	 * every model's context window, output cap, lifecycle and `capabilities`, and requests
	 * are shaped from the latter. Retired models are left out; deprecated ones are offered
	 * and marked. The static list's order comes first, then the rest as the vendor lists
	 * them — newest first.
	 */
	async getAvailableModels(): Promise<SiriusModel[]> {
		if (!this.getApiKey()) {
			return this.models;
		}
		try {
			const listed: AnthropicModelInfo[] = [];
			let after: string | undefined;
			for (let page = 0; page < 10; page++) {
				const url = new URL(`${this._baseUrl()}/v1/models`);
				url.searchParams.set('limit', '1000');
				if (after) {
					url.searchParams.set('after_id', after);
				}
				const response = await fetch(url.toString(), { headers: this._headers(), redirect: 'error' });
				if (!response.ok) {
					break; // a first page refused is the static list; a later one keeps what was read
				}
				const data = await response.json() as AnthropicModelList;
				listed.push(...(data.data ?? []));
				if (!data.has_more || !data.last_id) {
					break;
				}
				after = data.last_id;
			}
			const discovered = this._fromListing(listed);
			return discovered.length > 0 ? discovered : this.models;
		} catch {
			return this.models;
		}
	}

	private _fromListing(listed: AnthropicModelInfo[]): SiriusModel[] {
		const rank = (id: string) => {
			const index = this.models.findIndex(m => m.id === id);
			return index < 0 ? this.models.length : index;
		};
		const seen = new Set<string>();
		return listed
			.filter((info): info is AnthropicModelInfo & { id: string } => Boolean(info.id) && info.lifecycle !== 'retired')
			.filter(info => !seen.has(info.id) && seen.add(info.id))
			.map((info, index) => ({ info, index }))
			.sort((a, b) => rank(a.info.id) - rank(b.info.id) || a.index - b.index)
			.map(({ info }) => {
				const known = this.models.find(m => m.id === info.id);
				const capabilities = info.capabilities ?? undefined;
				if (capabilities) {
					this._capabilities.set(info.id, capabilities);
				} else {
					this._capabilities.delete(info.id);
				}
				const deprecated = info.lifecycle === 'deprecated';
				return {
					id: info.id,
					name: info.display_name || known?.name || info.id,
					provider: 'anthropic' as ProviderType,
					contextWindow: info.max_input_tokens ?? known?.contextWindow ?? 200000,
					description: deprecated
						? `Deprecated by Anthropic${typeof info.retires_at === 'string' ? ` — retires ${info.retires_at.slice(0, 10)}` : ''}`
						: known?.description ?? 'Claude model',
					supportsStreaming: true,
					supportsVision: capabilities?.image_input?.supported ?? known?.supportsVision ?? true,
					supportsThinking: capabilities?.thinking?.supported ?? known?.supportsThinking ?? true,
					supportsImageGen: false,
					maxOutputTokens: info.max_tokens ?? known?.maxOutputTokens,
					deprecated
				} satisfies SiriusModel;
			});
	}
}

/** What a model accepts, from the `capabilities` the listing gave it. */
function rulesFromCapabilities(id: string, capabilities: AnthropicCapabilities): ModelRules {
	const types = capabilities.thinking?.types ?? {};
	const effort = capabilities.effort;
	return {
		thinking: capabilities.thinking?.supported === true,
		adaptive: types.adaptive?.supported === true,
		enabled: types.enabled?.supported === true,
		disabled: types.disabled?.supported === true,
		betweenTools: types.between_tools?.supported === true,
		effort: effort?.supported ? new Set(EFFORT_LEVELS.filter(level => effort[level]?.supported)) : undefined,
		// The listing says nothing about sampling; the generation does.
		sampling: LEGACY_GENERATION.test(id)
	};
}

/** For a model discovery has not described: what its generation is known to take. */
function rulesFromId(id: string, known: SiriusModel | undefined): ModelRules {
	if (LEGACY_GENERATION.test(id)) {
		return { thinking: known?.supportsThinking ?? false, adaptive: false, enabled: true, disabled: true, betweenTools: false, effort: undefined, sampling: true };
	}
	// Fable, Mythos and Opus 5.5 reason on every request; Sonnet 5.5 turns thinking off
	// only through `between_tools`; the rest of the adaptive generations take `disabled`.
	// `xhigh` arrived with 4.7: the 4.6 pair has the other four levels.
	const alwaysOn = /^claude-(fable-|mythos-|opus-5-5)/.test(id);
	const betweenTools = /^claude-sonnet-5-5/.test(id);
	const effort = /^claude-(opus|sonnet)-4-6/.test(id) ? ['low', 'medium', 'high', 'max'] as const : EFFORT_LEVELS;
	return {
		thinking: known?.supportsThinking ?? true,
		adaptive: true,
		enabled: false,
		disabled: !alwaysOn && !betweenTools,
		betweenTools,
		effort: new Set<ThinkingEffort>(effort),
		sampling: false
	};
}

/** The level asked for if the model has it, else the nearest below; nothing when it takes none. */
function pickEffort(wanted: ThinkingEffort, accepted: ReadonlySet<ThinkingEffort> | undefined): ThinkingEffort | undefined {
	if (!accepted) {
		return undefined;
	}
	for (let i = EFFORT_LEVELS.indexOf(wanted); i >= 0; i--) {
		if (accepted.has(EFFORT_LEVELS[i])) {
			return EFFORT_LEVELS[i];
		}
	}
	return undefined;
}

function atMost(effort: ThinkingEffort, cap: ThinkingEffort): ThinkingEffort {
	return EFFORT_LEVELS.indexOf(effort) > EFFORT_LEVELS.indexOf(cap) ? cap : effort;
}

/**
 * Anthropic content is a string or a block array. It stays a string when there
 * are no images — that is the shape every existing request already sends — and
 * becomes blocks only when an image has to ride along. An empty text block is
 * rejected by the API, so text is only emitted when present.
 */
function anthropicBlocks(text: string, images: ImagePart[] | undefined): string | unknown[] {
	if (!images?.length) {
		return text;
	}
	const blocks: unknown[] = [];
	if (text) {
		blocks.push({ type: 'text', text });
	}
	for (const image of images) {
		blocks.push({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.base64 } });
	}
	return blocks;
}
