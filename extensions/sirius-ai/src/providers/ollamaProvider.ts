/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Ollama Local Provider
 *  Copyright (c) Arshad Siddiqui. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IAIProvider, SiriusModel, ChatRequest, ChatChunk, ProviderType } from '../types';

export class OllamaProvider implements IAIProvider {
	readonly id: ProviderType = 'ollama';
	readonly name = 'Ollama (Local)';
	readonly models: SiriusModel[] = []; // Dynamically populated

	private getEndpoint(): string {
		return vscode.workspace.getConfiguration('sirius.ai.ollama').get<string>('endpoint', 'http://localhost:11434');
	}

	isConfigured(): boolean {
		// Ollama doesn't need an API key — just needs to be running
		return true;
	}

	async validateConnection(): Promise<boolean> {
		try {
			const endpoint = this.getEndpoint();
			const response = await fetch(`${endpoint}/api/tags`);
			return response.ok;
		} catch {
			return false;
		}
	}

	async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
		const endpoint = this.getEndpoint();
		const model = request.model || 'deepseek-coder-v3';

		// Check if Ollama is running
		try {
			const healthCheck = await fetch(`${endpoint}/api/tags`);
			if (!healthCheck.ok) {
				yield { content: '⚠️ Ollama is not running. Start it with `ollama serve` in your terminal.', done: true };
				return;
			}
		} catch {
			yield { content: '⚠️ Cannot connect to Ollama at ' + endpoint + '. Make sure Ollama is running (`ollama serve`).', done: true };
			return;
		}

		// Build messages
		const messages: Array<{ role: string; content: string }> = [];

		if (request.systemPrompt) {
			messages.push({ role: 'system', content: request.systemPrompt });
		}

		for (const msg of request.messages) {
			messages.push({ role: msg.role, content: msg.content });
		}

		const body = JSON.stringify({
			model,
			messages,
			stream: request.stream,
			options: {
				temperature: request.temperature,
				num_predict: request.maxTokens
			}
		});

		try {
			const response = await fetch(`${endpoint}/api/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body
			});

			if (!response.ok) {
				const error = await response.text();
				yield { content: `⚠️ Ollama Error (${response.status}): ${error}`, done: true };
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
						if (line.trim()) {
							try {
								const parsed = JSON.parse(line);
								if (parsed.done) {
									yield {
										content: parsed.message?.content || '',
										done: true,
										usage: {
											promptTokens: parsed.prompt_eval_count || 0,
											completionTokens: parsed.eval_count || 0,
											totalTokens: (parsed.prompt_eval_count || 0) + (parsed.eval_count || 0)
										}
									};
									return;
								}
								const text = parsed.message?.content || '';
								if (text) {
									yield { content: text, done: false };
								}
							} catch {
								// Skip malformed JSON
							}
						}
					}
				}
				yield { content: '', done: true };
			} else {
				const result = await response.json() as any;
				const text = result.message?.content || '';
				yield {
					content: text,
					done: true,
					usage: {
						promptTokens: result.prompt_eval_count || 0,
						completionTokens: result.eval_count || 0,
						totalTokens: (result.prompt_eval_count || 0) + (result.eval_count || 0)
					}
				};
			}
		} catch (error: any) {
			yield { content: `⚠️ Ollama Error: ${error.message}`, done: true };
		}
	}

	async getAvailableModels(): Promise<SiriusModel[]> {
		try {
			const endpoint = this.getEndpoint();
			const response = await fetch(`${endpoint}/api/tags`);
			if (!response.ok) { return []; }

			const data = await response.json() as any;
			const models: SiriusModel[] = (data.models || []).map((m: any) => ({
				id: m.name,
				name: m.name,
				provider: 'ollama' as ProviderType,
				contextWindow: 128000,
				description: `Local model — ${m.size ? (m.size / 1e9).toFixed(1) + 'B params' : 'unknown size'}`,
				supportsStreaming: true,
				supportsVision: false,
				supportsThinking: false,
				supportsImageGen: false
			}));

			return models;
		} catch {
			return [];
		}
	}
}
