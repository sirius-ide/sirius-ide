/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Anthropic Claude Provider
 *  Copyright (c) Arshad Siddiqui. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { SiriusSecretStore } from '../auth/secretStore';
import { IAIProvider, SiriusModel, ChatRequest, ChatChunk, ProviderType } from '../types';

/** The subset of Anthropic's Messages response that this provider reads. */
interface AnthropicMessageResponse {
	content?: Array<{ type?: string; text?: string; thinking?: string }>;
	usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicProvider implements IAIProvider {
	readonly id: ProviderType = 'anthropic';
	readonly name = 'Anthropic Claude';
	readonly models: SiriusModel[] = [
		// ─── Flagship ─────────────────────────────────────────────────────
		{
			id: 'claude-opus-4-8',
			name: 'Claude Opus 4.8',
			provider: 'anthropic',
			contextWindow: 1000000,
			description: 'Latest flagship — best at complex reasoning, agentic coding, and long-horizon tasks',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false,
			maxOutputTokens: 32768
		},
		// ─── Previous Flagship ────────────────────────────────────────────
		{
			id: 'claude-opus-4-6',
			name: 'Claude Opus 4.6',
			provider: 'anthropic',
			contextWindow: 200000,
			description: 'Powerful reasoning — great for complex coding and analysis',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false,
			maxOutputTokens: 16384
		},
		// ─── Balanced ─────────────────────────────────────────────────────
		{
			id: 'claude-sonnet-4-6',
			name: 'Claude Sonnet 4.6',
			provider: 'anthropic',
			contextWindow: 200000,
			description: 'Best balance of speed and intelligence — excellent daily driver',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false,
			maxOutputTokens: 16384
		},
		// ─── Fast ─────────────────────────────────────────────────────────
		{
			id: 'claude-haiku-4-5-20251001',
			name: 'Claude Haiku 4.5',
			provider: 'anthropic',
			contextWindow: 200000,
			description: 'Fastest Claude — ideal for quick completions, simple tasks, and high-volume use',
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
					model: 'claude-haiku-4-5-20251001',
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

		const model = request.model || 'claude-sonnet-4-6';

		// Convert messages to Anthropic format
		const messages = request.messages
			.filter(m => m.role !== 'system')
			.map(m => ({
				role: m.role as 'user' | 'assistant',
				content: m.content
			}));

		const body: Record<string, any> = {
			model,
			max_tokens: request.maxTokens,
			messages
		};

		// System prompt
		if (request.systemPrompt) {
			body.system = request.systemPrompt;
		}

		// ─── Adaptive Thinking ────────────────────────────────────────────
		if (request.thinking?.enabled) {
			body.thinking = {
				type: 'adaptive',
				effort: request.thinking.effort || 'high'
			};
			// Thinking requires temperature = 1 (Anthropic constraint)
			body.temperature = 1;
		} else {
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
				const error = await response.text();
				yield { content: `⚠️ Anthropic API Error (${response.status}): ${error}`, done: true };
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
							usage: {
								promptTokens: parsed.usage?.input_tokens || 0,
								completionTokens: parsed.usage?.output_tokens || 0,
								totalTokens: (parsed.usage?.input_tokens || 0) + (parsed.usage?.output_tokens || 0)
							}
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
			usage: {
				promptTokens: result.usage?.input_tokens || 0,
				completionTokens: result.usage?.output_tokens || 0,
				totalTokens: (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0)
			}
		};
	}

	async getAvailableModels(): Promise<SiriusModel[]> {
		return this.models;
	}
}
