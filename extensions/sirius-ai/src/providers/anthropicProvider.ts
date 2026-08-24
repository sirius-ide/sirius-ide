/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Anthropic Claude Provider
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { SiriusSecretStore } from '../auth/secretStore';
import { IAIProvider, SiriusModel, ChatRequest, ChatChunk, ChatMessage, ProviderType, ThinkingEffort, ToolCallRequest, StopReason } from '../types';

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

/**
 * Per-model API constraints. These changed across Claude generations, and
 * sending a parameter a model no longer accepts is a hard 400, not a warning.
 */
interface ModelConstraints {
	/** Sampling parameters were removed from the 4.6 generation onward. */
	acceptsSampling: boolean;
	/** Thinking is always on, and any explicit `thinking` config is rejected. */
	thinkingAlwaysOn: boolean;
}

export class AnthropicProvider implements IAIProvider {
	readonly id: ProviderType = 'anthropic';
	readonly name = 'Anthropic Claude';
	readonly models: SiriusModel[] = [
		// ─── Flagship ─────────────────────────────────────────────────────
		{
			id: 'claude-opus-5',
			name: 'Claude Opus 5',
			provider: 'anthropic',
			contextWindow: 1000000,
			description: 'Best all-round coding and agentic model — thinking on by default',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false,
			maxOutputTokens: 64000
		},
		// ─── Most capable ─────────────────────────────────────────────────
		{
			id: 'claude-fable-5',
			name: 'Claude Fable 5',
			provider: 'anthropic',
			contextWindow: 1000000,
			description: 'Most capable — hardest reasoning and long-horizon work. Always reasons; costs more',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false,
			maxOutputTokens: 64000
		},
		// ─── Balanced ─────────────────────────────────────────────────────
		{
			id: 'claude-sonnet-5',
			name: 'Claude Sonnet 5',
			provider: 'anthropic',
			contextWindow: 1000000,
			description: 'Strong balance of speed, cost and intelligence — a good daily driver',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false,
			maxOutputTokens: 64000
		},
		// ─── Previous flagship ────────────────────────────────────────────
		{
			id: 'claude-opus-4-8',
			name: 'Claude Opus 4.8',
			provider: 'anthropic',
			contextWindow: 1000000,
			description: 'Previous flagship — still excellent for complex reasoning',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false,
			maxOutputTokens: 64000
		},
		// ─── Fast ─────────────────────────────────────────────────────────
		{
			id: 'claude-haiku-4-5',
			name: 'Claude Haiku 4.5',
			provider: 'anthropic',
			contextWindow: 200000,
			description: 'Fastest and cheapest — quick completions and high-volume work',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: false,
			supportsImageGen: false,
			maxOutputTokens: 8192
		}
	];

	constructor(private readonly secrets: SiriusSecretStore) { }

	private getApiKey(): string {
		return this.secrets.get('anthropic');
	}

	isConfigured(): boolean {
		return this.getApiKey().length > 0;
	}

	async validateConnection(): Promise<boolean> {
		try {
			const apiKey = this.getApiKey();
			const response = await fetch('https://api.anthropic.com/v1/messages', {
				method: 'POST',
				headers: {
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01',
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					model: 'claude-haiku-4-5',
					max_tokens: 10,
					messages: [{ role: 'user', content: 'Hi' }]
				})
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
		const apiKey = this.getApiKey();
		if (!apiKey) {
			yield { content: '⚠️ Anthropic API key not configured. Run **Sirius: Set API Key** from the command palette.', done: true };
			return;
		}

		const model = request.model || 'claude-opus-5';
		const constraints = this._constraintsFor(model);
		const modelInfo = this.models.find(m => m.id === model);

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

		// ─── Thinking and effort ──────────────────────────────────────────
		// `effort` is a field of output_config, not of `thinking`.
		const thinkingOn = constraints.thinkingAlwaysOn
			|| Boolean(request.thinking?.enabled && modelInfo?.supportsThinking);
		let effort: ThinkingEffort = request.thinking?.effort ?? 'high';

		if (constraints.thinkingAlwaysOn) {
			// Any explicit thinking configuration is rejected on these models.
		} else if (thinkingOn) {
			// `display` defaults to omitted, which streams empty thinking blocks
			// and leaves the thinking pane blank. Ask for a summary explicitly.
			body.thinking = { type: 'adaptive', display: 'summarized' };
		} else {
			body.thinking = { type: 'disabled' };
			// Disabling thinking is rejected above `high`.
			if (effort === 'xhigh' || effort === 'max') {
				effort = 'high';
			}
		}

		body.output_config = { effort };

		// Sampling parameters were removed from the 4.6 generation onward and
		// return 400 there. They are also meaningless while the model is reasoning.
		if (constraints.acceptsSampling && !thinkingOn) {
			body.temperature = request.temperature;
		}

		// Streaming
		if (request.stream) {
			body.stream = true;
		}

		try {
			const response = await fetch('https://api.anthropic.com/v1/messages', {
				method: 'POST',
				headers: {
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01',
					'content-type': 'application/json'
				},
				body: JSON.stringify(body)
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
	 * Which parameters a given model still accepts. Prefix matching keeps this
	 * working for models released after this build.
	 */
	private _constraintsFor(modelId: string): ModelConstraints {
		// Fable reasons on every request and rejects an explicit `thinking` block.
		if (modelId.startsWith('claude-fable-') || modelId.startsWith('claude-mythos-')) {
			return { acceptsSampling: false, thinkingAlwaysOn: true };
		}

		// Haiku 4.5 predates the removal of sampling parameters.
		return {
			acceptsSampling: modelId.startsWith('claude-haiku-4-5'),
			thinkingAlwaysOn: false
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
				return '⚠️ Anthropic rejected the API key. Run **Sirius: Set API Key** to enter a new one.';
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
						content: result.content,
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

			wire.push({ role: message.role, content: message.content });
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

	async getAvailableModels(): Promise<SiriusModel[]> {
		return this.models;
	}
}
