/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — OpenAI GPT Provider
 *  Copyright (c) Arshad Siddiqui. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { SiriusSecretStore } from '../auth/secretStore';
import { IAIProvider, SiriusModel, ChatRequest, ChatChunk, ProviderType } from '../types';

/** The subset of OpenAI's chat-completions response that this provider reads. */
interface OpenAIChatCompletionResponse {
	choices?: Array<{ message?: { content?: string } }>;
	usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export class OpenAIProvider implements IAIProvider {
	readonly id: ProviderType = 'openai';
	readonly name = 'OpenAI GPT';
	readonly models: SiriusModel[] = [
		{
			id: 'gpt-4.1',
			name: 'GPT-4.1',
			provider: 'openai',
			contextWindow: 1047576,
			description: 'Most capable GPT model — excellent at coding and reasoning',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: false,
			supportsImageGen: false
		},
		{
			id: 'gpt-4.1-mini',
			name: 'GPT-4.1 Mini',
			provider: 'openai',
			contextWindow: 1047576,
			description: 'Fast and affordable — great for everyday coding',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: false,
			supportsImageGen: false
		},
		{
			id: 'gpt-4.1-nano',
			name: 'GPT-4.1 Nano',
			provider: 'openai',
			contextWindow: 1047576,
			description: 'Fastest GPT — minimal latency for quick tasks',
			supportsStreaming: true,
			supportsVision: false,
			supportsThinking: false,
			supportsImageGen: false
		},
		{
			id: 'o4-mini',
			name: 'o4-mini',
			provider: 'openai',
			contextWindow: 200000,
			description: 'Reasoning model — thinks step by step for complex problems',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false
		},
		{
			id: 'o3',
			name: 'o3',
			provider: 'openai',
			contextWindow: 200000,
			description: 'Most powerful reasoning model — for the hardest problems',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false
		}
	];

	constructor(private readonly secrets: SiriusSecretStore) { }

	private getApiKey(): string {
		return this.secrets.get('openai');
	}

	isConfigured(): boolean {
		return this.getApiKey().length > 0;
	}

	async validateConnection(): Promise<boolean> {
		try {
			const apiKey = this.getApiKey();
			const response = await fetch('https://api.openai.com/v1/models', {
				headers: { 'Authorization': `Bearer ${apiKey}` }
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
		const apiKey = this.getApiKey();
		if (!apiKey) {
			yield { content: '⚠️ OpenAI API key not configured. Go to Settings → Sirius AI → OpenAI API Key', done: true };
			return;
		}

		const model = request.model || 'gpt-4.1-mini';

		// Build OpenAI messages format
		const messages: Array<{ role: string; content: string }> = [];

		if (request.systemPrompt) {
			messages.push({ role: 'system', content: request.systemPrompt });
		}

		for (const msg of request.messages) {
			if (msg.role !== 'system') {
				messages.push({ role: msg.role, content: msg.content });
			}
		}

		const body: Record<string, any> = {
			model,
			messages,
			max_completion_tokens: request.maxTokens,
			temperature: request.temperature,
			stream: request.stream
		};

		try {
			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(body)
			});

			if (!response.ok) {
				const error = await response.text();
				yield { content: `⚠️ OpenAI API Error (${response.status}): ${error}`, done: true };
				return;
			}

			if (request.stream) {
				const reader = response.body?.getReader();
				if (!reader) {
					yield { content: '⚠️ No response stream available', done: true };
					return;
				}

				const decoder = new TextDecoder();
				let buffer = '';

				while (true) {
					const { done, value } = await reader.read();
					if (done) { break; }

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						if (line.startsWith('data: ')) {
							const data = line.slice(6).trim();
							if (data === '[DONE]') {
								yield { content: '', done: true };
								return;
							}
							try {
								const parsed = JSON.parse(data);
								const text = parsed.choices?.[0]?.delta?.content || '';
								if (text) {
									yield { content: text, done: false };
								}

								if (parsed.choices?.[0]?.finish_reason === 'stop') {
									yield {
										content: '',
										done: true,
										usage: parsed.usage ? {
											promptTokens: parsed.usage.prompt_tokens || 0,
											completionTokens: parsed.usage.completion_tokens || 0,
											totalTokens: parsed.usage.total_tokens || 0
										} : undefined
									};
									return;
								}
							} catch {
								// Skip malformed JSON
							}
						}
					}
				}
				yield { content: '', done: true };
			} else {
				const result = await response.json() as OpenAIChatCompletionResponse;
				const text = result.choices?.[0]?.message?.content || '';
				yield {
					content: text,
					done: true,
					usage: {
						promptTokens: result.usage?.prompt_tokens || 0,
						completionTokens: result.usage?.completion_tokens || 0,
						totalTokens: result.usage?.total_tokens || 0
					}
				};
			}
		} catch (error: any) {
			yield { content: `⚠️ OpenAI Error: ${error.message}`, done: true };
		}
	}

	async getAvailableModels(): Promise<SiriusModel[]> {
		return this.models;
	}
}
