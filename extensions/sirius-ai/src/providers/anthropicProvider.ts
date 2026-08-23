/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Anthropic Claude Provider
 *  Copyright (c) Arshad Siddiqui. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { SiriusSecretStore } from '../auth/secretStore';
import { IAIProvider, SiriusModel, ChatRequest, ChatChunk, ProviderType, ThinkingEffort } from '../types';

/** The subset of Anthropic's Messages response that this provider reads. */
interface AnthropicMessageResponse {
	content?: Array<{ type?: string; text?: string; thinking?: string }>;
	usage?: AnthropicUsage;
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

		// Convert messages to Anthropic format
		const messages = request.messages
			.filter(m => m.role !== 'system')
			.map(m => ({
				role: m.role as 'user' | 'assistant',
				content: m.content
			}));

		const body: Record<string, unknown> = {
			model,
			max_tokens: request.maxTokens,
			messages
		};

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
	 * Handle SSE streaming response with thinking block support
	 */
	private async *_handleStream(response: Response): AsyncIterable<ChatChunk> {
		const reader = response.body?.getReader();
		if (!reader) {
			yield { content: '⚠️ No response stream available', done: true };
			return;
		}

		const decoder = new TextDecoder();
		let buffer = '';
		let isInThinkingBlock = false;

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

				try {
					const parsed = JSON.parse(data);

					// ─── Thinking Block Start ─────────────────────────────
					if (parsed.type === 'content_block_start') {
						if (parsed.content_block?.type === 'thinking') {
							isInThinkingBlock = true;
							yield { content: '', thinking: '', isThinkingBlock: true, done: false };
						} else {
							isInThinkingBlock = false;
						}
						continue;
					}

					// ─── Content Deltas ───────────────────────────────────
					if (parsed.type === 'content_block_delta') {
						if (parsed.delta?.type === 'thinking_delta') {
							// Thinking content
							yield { content: '', thinking: parsed.delta.thinking || '', done: false };
						} else if (parsed.delta?.type === 'text_delta') {
							// Regular text content
							yield { content: parsed.delta.text || '', done: false };
						}
						continue;
					}

					// ─── Block Stop ───────────────────────────────────────
					if (parsed.type === 'content_block_stop') {
						if (isInThinkingBlock) {
							isInThinkingBlock = false;
							yield { content: '', thinking: '', isThinkingBlock: false, done: false };
						}
						continue;
					}

					// ─── Message Stop / Delta ─────────────────────────────
					if (parsed.type === 'message_stop') {
						yield { content: '', done: true };
						return;
					}

					if (parsed.type === 'message_delta') {
						yield {
							content: '',
							done: true,
							usage: this._summariseUsage(parsed.usage)
						};
					}
				} catch {
					// Skip malformed JSON
				}
			}
		}
		yield { content: '', done: true };
	}

	/**
	 * Handle non-streaming response
	 */
	private async *_handleNonStream(response: Response): AsyncIterable<ChatChunk> {
		const result = await response.json() as AnthropicMessageResponse;
		let textContent = '';
		let thinkingContent = '';

		// Parse content blocks (may include both thinking and text)
		for (const block of (result.content || [])) {
			if (block.type === 'thinking') {
				thinkingContent += block.thinking || '';
			} else if (block.type === 'text') {
				textContent += block.text || '';
			}
		}

		if (thinkingContent) {
			yield { content: '', thinking: thinkingContent, isThinkingBlock: true, done: false };
		}

		yield {
			content: textContent,
			done: true,
			usage: this._summariseUsage(result.usage)
		};
	}

	async getAvailableModels(): Promise<SiriusModel[]> {
		return this.models;
	}
}
