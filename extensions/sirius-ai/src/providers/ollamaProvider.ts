/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Ollama Local Provider
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IAIProvider, SiriusModel, ChatRequest, ChatChunk, ChatMessage, ProviderType, ToolCallRequest, StopReason } from '../types';

/** A tool call as Ollama reports it. Ollama assigns no id, so we synthesise one. */
interface OllamaToolCall {
	function?: { name?: string; arguments?: Record<string, unknown> };
}

/** The subset of an Ollama chat response that this provider reads. */
interface OllamaChatResponse {
	message?: { content?: string; thinking?: string; tool_calls?: OllamaToolCall[] };
	done?: boolean;
	done_reason?: string;
	prompt_eval_count?: number;
	eval_count?: number;
}

/** The subset of /api/tags that this provider reads. */
interface OllamaTagsResponse {
	models?: Array<{ name: string; size?: number; details?: { parameter_size?: string; family?: string } }>;
}

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
		const messages: Array<Record<string, unknown>> = [];

		if (request.systemPrompt) {
			messages.push({ role: 'system', content: request.systemPrompt });
		}
		messages.push(...this._toWireMessages(request.messages));

		const payload: Record<string, unknown> = {
			model,
			messages,
			stream: request.stream,
			options: {
				temperature: request.temperature,
				num_predict: request.maxTokens
			}
		};

		// Ollama takes the OpenAI function envelope. Models that lack the `tools`
		// capability ignore the field rather than failing.
		if (request.tools?.length) {
			payload.tools = request.tools.map(t => ({
				type: 'function',
				function: {
					name: t.name,
					description: t.description,
					parameters: t.inputSchema
				}
			}));
		}

		const body = JSON.stringify(payload);

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
				const toolCalls: ToolCallRequest[] = [];
				let buffer = '';

				while (true) {
					const { done, value } = await reader.read();
					if (done) { break; }

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						if (!line.trim()) { continue; }

						let parsed: OllamaChatResponse;
						try {
							parsed = JSON.parse(line) as OllamaChatResponse;
						} catch {
							continue; // Skip malformed JSON
						}

						// Tool calls can arrive on any chunk, not only the last.
						const calls = parsed.message?.tool_calls;
						if (calls?.length) {
							toolCalls.push(...this._toToolCalls(calls, toolCalls.length));
						}

						if (parsed.message?.thinking) {
							yield { content: '', thinking: parsed.message.thinking, done: false };
						}

						if (parsed.done) {
							yield {
								content: parsed.message?.content || '',
								done: true,
								stopReason: toolCalls.length > 0 ? 'tool_use' : this._toStopReason(parsed.done_reason),
								toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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
					}
				}
				yield {
					content: '',
					done: true,
					stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
					toolCalls: toolCalls.length > 0 ? toolCalls : undefined
				};
			} else {
				const result = await response.json() as OllamaChatResponse;
				const calls = this._toToolCalls(result.message?.tool_calls, 0);
				yield {
					content: result.message?.content || '',
					done: true,
					stopReason: calls.length > 0 ? 'tool_use' : this._toStopReason(result.done_reason),
					toolCalls: calls.length > 0 ? calls : undefined,
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

	/**
	 * Ollama's messages carry tool results on a dedicated `tool` role and echo
	 * calls back inside the assistant turn.
	 */
	private _toWireMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
		const wire: Array<Record<string, unknown>> = [];

		for (const message of messages) {
			if (message.role === 'tool') {
				for (const result of message.toolResults ?? []) {
					wire.push({ role: 'tool', tool_name: result.name, content: result.content });
				}
				continue;
			}

			if (message.role === 'assistant' && message.toolCalls?.length) {
				wire.push({
					role: 'assistant',
					content: message.content,
					tool_calls: message.toolCalls.map(call => ({
						function: { name: call.name, arguments: call.arguments }
					}))
				});
				continue;
			}

			wire.push({ role: message.role, content: message.content });
		}

		return wire;
	}

	/**
	 * Ollama assigns no id to a tool call, so synthesise a stable one from its
	 * position in the turn. The agent loop only needs ids to be unique per turn.
	 */
	private _toToolCalls(raw: OllamaToolCall[] | undefined, offset: number): ToolCallRequest[] {
		return (raw ?? []).map((call, i) => ({
			id: `call_${offset + i}`,
			name: call.function?.name ?? '',
			arguments: call.function?.arguments ?? {}
		}));
	}

	private _toStopReason(raw: string | undefined): StopReason {
		return raw === 'length' ? 'max_tokens' : 'end_turn';
	}

	async getAvailableModels(): Promise<SiriusModel[]> {
		try {
			const endpoint = this.getEndpoint();
			const response = await fetch(`${endpoint}/api/tags`);
			if (!response.ok) { return []; }

			const data = await response.json() as OllamaTagsResponse;
			const models: SiriusModel[] = (data.models || []).map(m => ({
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
