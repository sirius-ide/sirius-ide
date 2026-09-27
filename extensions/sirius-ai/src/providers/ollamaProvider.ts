/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Ollama Local Provider
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IAIProvider, SiriusModel, ChatRequest, ChatChunk, ChatMessage, ImagePart, ProviderType, ToolCallRequest, StopReason } from '../types';

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
	models?: Array<{ name: string; size?: number; details?: OllamaModelDetails }>;
}

interface OllamaModelDetails {
	parameter_size?: string;
	family?: string;
	/** Every architecture in the model; a vision model lists its projector here too. */
	families?: string[];
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

	/** On-disk size per model name, from the last listing. */
	private readonly _modelSizes = new Map<string, number>();

	/**
	 * Loading a model far larger than this machine's memory has frozen and
	 * crashed the whole system before, not just the request. Refuse clearly
	 * instead; sirius.ai.ollama.largeModelBytes raises or (0) disables the gate.
	 */
	private _guardModelSize(model: string): void {
		const limit = vscode.workspace.getConfiguration('sirius.ai.ollama')
			.get<number>('largeModelBytes', 12_000_000_000);
		const size = this._modelSizes.get(model);
		if (limit > 0 && size !== undefined && size > limit) {
			throw new Error(
				`Model "${model}" is ${(size / 1e9).toFixed(1)} GB — larger than the configured safety limit ` +
				`(${(limit / 1e9).toFixed(0)} GB). Loading it can freeze this machine. ` +
				'Prefer a smaller quantisation (Q4 of the same model), or raise "sirius.ai.ollama.largeModelBytes" knowingly.'
			);
		}
	}

	async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
		const endpoint = this.getEndpoint();
		const model = request.model || 'deepseek-coder-v3';
		this._guardModelSize(model);

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
				// Ollama's `images` field is documented for user turns, so a
				// tool's images follow on one user message after every tool
				// result of the round — the same contiguity rule as OpenAI, and
				// the shape llava-class models are known to attend to.
				const images: string[] = [];
				const sources: string[] = [];
				for (const result of message.toolResults ?? []) {
					wire.push({ role: 'tool', tool_name: result.name, content: result.content });
					if (result.images?.length) {
						images.push(...result.images.map(image => image.base64));
						sources.push(result.name);
					}
				}
				if (images.length) {
					wire.push({ role: 'user', content: `[image output of ${sources.join(', ')}]`, images });
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

			// Ollama takes raw base64 in `images`, no data: prefix and no mime —
			// it sniffs the bytes itself.
			wire.push({
				role: message.role,
				content: message.content,
				...(message.images?.length ? { images: ollamaImages(message.images) } : {})
			});
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

	/**
	 * What one installed model can actually do, from `/api/show`.
	 *
	 * `/api/tags` only says what is installed. `/api/show` carries the
	 * architecture's real context length under `model_info.<arch>.context_length`
	 * and, on current servers, an explicit `capabilities` list — `vision`,
	 * `tools`, `thinking`. Both matter downstream: the context length is what
	 * the agent's tool tiers key on, and a hardcoded 128k put a 1.5B model in
	 * the extended tier alongside frontier models. Reads metadata only — it does
	 * not load the model — so it is quick, and any failure (old server, slow
	 * disk) degrades to `null` and the caller's fallbacks.
	 */
	private async _show(endpoint: string, name: string): Promise<{ contextLength?: number; capabilities?: string[] } | null> {
		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 4000);
			const response = await fetch(`${endpoint}/api/show`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name }),
				signal: controller.signal
			});
			clearTimeout(timer);
			if (!response.ok) {
				return null;
			}
			const data = await response.json() as { capabilities?: string[]; model_info?: Record<string, unknown> };
			const entry = Object.entries(data.model_info ?? {}).find(([key]) => key.endsWith('.context_length'));
			const contextLength = typeof entry?.[1] === 'number' ? entry[1] : undefined;
			return { contextLength, capabilities: data.capabilities };
		} catch {
			return null;
		}
	}

	async getAvailableModels(): Promise<SiriusModel[]> {
		try {
			const endpoint = this.getEndpoint();
			const response = await fetch(`${endpoint}/api/tags`);
			if (!response.ok) { return []; }

			const data = await response.json() as OllamaTagsResponse;
			const installed = data.models || [];
			for (const m of installed) {
				if (m.size !== undefined) {
					this._modelSizes.set(m.name, m.size);
				}
			}

			// One /api/show per model, concurrently. Ten models is ten quick
			// metadata reads, not ten model loads.
			const shown = await Promise.all(installed.map(m => this._show(endpoint, m.name)));

			const models: SiriusModel[] = installed.map((m, i) => {
				const info = shown[i];
				const capabilities = info?.capabilities;
				return {
					id: m.name,
					name: m.name,
					provider: 'ollama' as ProviderType,
					// The architecture's real window when the server tells us; the
					// old assumption only when it cannot.
					contextWindow: info?.contextLength ?? 128000,
					sizeBytes: m.size,
					description: `Local model — ${m.size ? (m.size / 1e9).toFixed(1) + ' GB' : 'size unknown'}`,
					supportsStreaming: true,
					// `capabilities` is authoritative where present — including an
					// authoritative *no*. The name/family heuristic is only for
					// servers old enough not to report it.
					supportsVision: capabilities ? capabilities.includes('vision') : looksVisionCapable(m.name, m.details),
					supportsThinking: capabilities?.includes('thinking') ?? false,
					supportsImageGen: false
				};
			});

			return models;
		} catch {
			return [];
		}
	}
}

/** Ollama wants bare base64 strings — no `data:` prefix, no mime; it sniffs the bytes. */
function ollamaImages(images: ImagePart[]): string[] {
	return images.map(image => image.base64);
}

/**
 * Whether a local model can see.
 *
 * `/api/tags` carries no capability flag, so this reads the two signals it does
 * carry. `families` is authoritative when present: a multimodal model lists its
 * vision projector alongside the language architecture (`clip` for the
 * llava/moondream/minicpm-v lineage, `mllama` for llama3.2-vision, and the
 * fused architectures qwen and gemma use). The name check is the fallback for
 * older Ollama builds that omit `families`, and covers the models people
 * actually pull. Getting this wrong in the `false` direction is the costly
 * error — the vision guard then strips every image before llava sees it — so
 * the heuristic leans towards `true` on any vision signal.
 *
 * `/api/show` returns an explicit `capabilities: ["vision", …]` on current
 * Ollama and would be exact, at one request per model; worth adopting once
 * discovery is cached rather than run on every refresh.
 */
function looksVisionCapable(name: string, details: OllamaModelDetails | undefined): boolean {
	const families = (details?.families ?? []).map(f => f.toLowerCase());
	if (families.some(f => f === 'clip' || f === 'mllama' || f.includes('vl') || f.includes('vision'))) {
		return true;
	}
	if (families.some(f => f.startsWith('gemma3') || f.startsWith('qwen2') && families.length > 1)) {
		return true;
	}
	const lower = name.toLowerCase();
	// gemma3 and gemma3n are both multimodal, so no lookahead separating them.
	return /llava|bakllava|moondream|minicpm-v|llama3\.2-vision|llama4|qwen2(\.5)?-?vl|gemma3|pixtral|granite3\.2-vision|mistral-small3\.[1-9]/.test(lower);
}
