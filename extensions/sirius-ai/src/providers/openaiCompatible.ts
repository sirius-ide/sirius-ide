/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — OpenAI-Compatible Provider
 *  Copyright (c) emrys. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	IAIProvider, SiriusModel, ChatRequest, ChatChunk, ChatMessage,
	ProviderType, StopReason, ToolCallRequest
} from '../types';
import { SiriusSecretStore } from '../auth/secretStore';

/**
 * Describes one service that speaks the OpenAI chat-completions shape.
 *
 * Hosted gateways, local runtimes and OpenAI itself all differ only in base URL,
 * whether they need a key, and a couple of headers — so they are data, not code.
 * Adding a provider is a table entry.
 */
export interface OpenAICompatibleConfig {
	id: ProviderType;
	name: string;
	/** Overridable per install via `sirius.ai.<id>.baseUrl`. */
	defaultBaseUrl: string;
	/** Local runtimes accept any key, or none. */
	requiresKey: boolean;
	/** Where to get a key, shown when one is missing. */
	keyUrl?: string;
	/** Sent on every request; OpenRouter uses these for attribution. */
	extraHeaders?: Record<string, string>;
	/** Shown before discovery runs, and if discovery fails. */
	fallbackModelIds?: string[];
	/** Context window reported for discovered models, which carry no metadata. */
	assumedContextWindow?: number;
}

/** Every OpenAI-shaped service Sirius ships with. */
export const OPENAI_COMPATIBLE_ENDPOINTS: OpenAICompatibleConfig[] = [
	{
		id: 'openai',
		name: 'OpenAI',
		defaultBaseUrl: 'https://api.openai.com/v1',
		requiresKey: true,
		keyUrl: 'https://platform.openai.com/api-keys',
		assumedContextWindow: 128000
	},
	{
		id: 'openrouter',
		name: 'OpenRouter',
		defaultBaseUrl: 'https://openrouter.ai/api/v1',
		requiresKey: true,
		keyUrl: 'https://openrouter.ai/keys',
		// OpenRouter attributes traffic by these headers.
		extraHeaders: {
			'HTTP-Referer': 'https://github.com/sirius-ide/sirius-ide',
			'X-Title': 'Sirius IDE'
		},
		assumedContextWindow: 128000
	},
	{
		id: 'groq',
		name: 'Groq',
		defaultBaseUrl: 'https://api.groq.com/openai/v1',
		requiresKey: true,
		keyUrl: 'https://console.groq.com/keys',
		assumedContextWindow: 128000
	},
	{
		id: 'deepseek',
		name: 'DeepSeek',
		defaultBaseUrl: 'https://api.deepseek.com/v1',
		requiresKey: true,
		keyUrl: 'https://platform.deepseek.com/api_keys',
		assumedContextWindow: 128000
	},
	{
		id: 'mistral',
		name: 'Mistral',
		defaultBaseUrl: 'https://api.mistral.ai/v1',
		requiresKey: true,
		keyUrl: 'https://console.mistral.ai/api-keys',
		assumedContextWindow: 128000
	},
	{
		id: 'xai',
		name: 'xAI Grok',
		defaultBaseUrl: 'https://api.x.ai/v1',
		requiresKey: true,
		keyUrl: 'https://console.x.ai',
		assumedContextWindow: 128000
	},
	{
		id: 'lmstudio',
		name: 'LM Studio (Local)',
		defaultBaseUrl: 'http://localhost:1234/v1',
		requiresKey: false,
		assumedContextWindow: 32768
	},
	{
		id: 'llamacpp',
		name: 'llama.cpp / vLLM (Local)',
		defaultBaseUrl: 'http://localhost:8080/v1',
		requiresKey: false,
		assumedContextWindow: 32768
	},
	{
		id: 'custom',
		name: 'Custom OpenAI-Compatible',
		defaultBaseUrl: '',
		requiresKey: false,
		assumedContextWindow: 128000
	}
];

// ─── Wire shapes ─────────────────────────────────────────────────────────────

/** A tool call as the OpenAI shape reports it. Arguments are a JSON *string*. */
interface WireToolCall {
	index?: number;
	id?: string;
	function?: { name?: string; arguments?: string };
}

interface WireDelta {
	content?: string;
	/** DeepSeek and some gateways stream reasoning separately. */
	reasoning_content?: string;
	reasoning?: string;
	tool_calls?: WireToolCall[];
}

interface WireChoice {
	delta?: WireDelta;
	message?: WireDelta;
	finish_reason?: string;
}

interface WireResponse {
	choices?: WireChoice[];
	usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
	error?: { message?: string };
}

interface WireModelList {
	data?: Array<{ id: string }>;
}

/**
 * One adapter for every service that speaks OpenAI chat-completions.
 *
 * Replaces the OpenAI-only provider. The shape is near-universal — OpenRouter,
 * Groq, DeepSeek, Mistral, xAI, LM Studio, llama.cpp and vLLM all serve it — so
 * supporting them is configuration rather than another hand-written client.
 */
export class OpenAICompatibleProvider implements IAIProvider {

	/** Filled by discovery; falls back to the configured ids. */
	private _models: SiriusModel[] = [];

	constructor(
		private readonly config: OpenAICompatibleConfig,
		private readonly secrets: SiriusSecretStore
	) {
		this._models = (config.fallbackModelIds ?? []).map(id => this._describe(id));
	}

	get id(): ProviderType { return this.config.id; }
	get name(): string { return this.config.name; }
	get models(): SiriusModel[] { return this._models; }

	// ─── Configuration ───────────────────────────────────────────────────────

	private _baseUrl(): string {
		const configured = vscode.workspace
			.getConfiguration(`sirius.ai.${this.config.id}`)
			.get<string>('baseUrl', '')
			.trim();
		return (configured || this.config.defaultBaseUrl).replace(/\/+$/, '');
	}

	private _headers(): Record<string, string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			...(this.config.extraHeaders ?? {})
		};

		const key = this.secrets.get(this.config.id);
		if (key) {
			headers['Authorization'] = `Bearer ${key}`;
		}
		return headers;
	}

	isConfigured(): boolean {
		if (!this._baseUrl()) {
			return false;
		}
		return !this.config.requiresKey || this.secrets.has(this.config.id);
	}

	async validateConnection(): Promise<boolean> {
		try {
			const response = await fetch(`${this._baseUrl()}/models`, { headers: this._headers() });
			return response.ok;
		} catch {
			return false;
		}
	}

	// ─── Chat ────────────────────────────────────────────────────────────────

	async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
		const baseUrl = this._baseUrl();
		if (!baseUrl) {
			yield { content: `⚠️ No endpoint set for ${this.config.name}. Set \`sirius.ai.${this.config.id}.baseUrl\`.`, done: true, stopReason: 'error' };
			return;
		}
		if (this.config.requiresKey && !this.secrets.has(this.config.id)) {
			const where = this.config.keyUrl ? ` Get one at ${this.config.keyUrl}.` : '';
			yield { content: `⚠️ No ${this.config.name} API key set. Run **Sirius: Set API Key**.${where}`, done: true, stopReason: 'error' };
			return;
		}

		const body: Record<string, unknown> = {
			model: request.model,
			messages: this._toWireMessages(request),
			stream: request.stream,
			max_tokens: request.maxTokens,
			temperature: request.temperature
		};

		if (request.tools?.length) {
			body.tools = request.tools.map(t => ({
				type: 'function',
				function: { name: t.name, description: t.description, parameters: t.inputSchema }
			}));
		}

		try {
			const response = await fetch(`${baseUrl}/chat/completions`, {
				method: 'POST',
				headers: this._headers(),
				body: JSON.stringify(body)
			});

			if (!response.ok) {
				yield { content: await this._describeError(response), done: true, stopReason: 'error' };
				return;
			}

			if (request.stream) {
				yield* this._handleStream(response);
			} else {
				yield* this._handleNonStream(response);
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			yield { content: `⚠️ ${this.config.name} error: ${message}`, done: true, stopReason: 'error' };
		}
	}

	/**
	 * The OpenAI shape puts tool results on a dedicated `tool` role keyed by
	 * `tool_call_id`, and echoes calls back on the assistant turn with arguments
	 * re-encoded as a JSON string.
	 */
	private _toWireMessages(request: ChatRequest): Array<Record<string, unknown>> {
		const wire: Array<Record<string, unknown>> = [];

		if (request.systemPrompt) {
			wire.push({ role: 'system', content: request.systemPrompt });
		}

		for (const message of request.messages as ChatMessage[]) {
			if (message.role === 'system') {
				continue;
			}

			if (message.role === 'tool') {
				for (const result of message.toolResults ?? []) {
					wire.push({ role: 'tool', tool_call_id: result.id, content: result.content });
				}
				continue;
			}

			if (message.role === 'assistant' && message.toolCalls?.length) {
				wire.push({
					role: 'assistant',
					content: message.content || null,
					tool_calls: message.toolCalls.map(call => ({
						id: call.id,
						type: 'function',
						function: { name: call.name, arguments: JSON.stringify(call.arguments) }
					}))
				});
				continue;
			}

			wire.push({ role: message.role, content: message.content });
		}

		return wire;
	}

	private async *_handleStream(response: Response): AsyncIterable<ChatChunk> {
		const reader = response.body?.getReader();
		if (!reader) {
			yield { content: '⚠️ No response stream available', done: true, stopReason: 'error' };
			return;
		}

		const decoder = new TextDecoder();
		const pending = new Map<number, { id: string; name: string; args: string }>();
		let buffer = '';
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
				if (!data) { continue; }
				if (data === '[DONE]') {
					yield { content: '', done: true, stopReason, usage, toolCalls: this._collect(pending) };
					return;
				}

				let parsed: WireResponse;
				try {
					parsed = JSON.parse(data) as WireResponse;
				} catch {
					continue;
				}

				if (parsed.usage) {
					usage = {
						promptTokens: parsed.usage.prompt_tokens ?? 0,
						completionTokens: parsed.usage.completion_tokens ?? 0,
						totalTokens: parsed.usage.total_tokens ?? 0
					};
				}

				const choice = parsed.choices?.[0];
				if (!choice) { continue; }

				if (choice.finish_reason) {
					stopReason = this._toStopReason(choice.finish_reason);
				}

				const delta = choice.delta;
				const reasoning = delta?.reasoning_content ?? delta?.reasoning;
				if (reasoning) {
					yield { content: '', thinking: reasoning, done: false };
				}
				if (delta?.content) {
					yield { content: delta.content, done: false };
				}

				// Tool calls stream as fragments keyed by index: the id and name
				// arrive once, the arguments accumulate across many deltas.
				for (const call of delta?.tool_calls ?? []) {
					const index = call.index ?? 0;
					const current = pending.get(index) ?? { id: '', name: '', args: '' };
					if (call.id) { current.id = call.id; }
					if (call.function?.name) { current.name += call.function.name; }
					if (call.function?.arguments) { current.args += call.function.arguments; }
					pending.set(index, current);
				}
			}
		}

		yield { content: '', done: true, stopReason, usage, toolCalls: this._collect(pending) };
	}

	private async *_handleNonStream(response: Response): AsyncIterable<ChatChunk> {
		const result = await response.json() as WireResponse;
		const choice = result.choices?.[0];
		const message = choice?.message;

		const reasoning = message?.reasoning_content ?? message?.reasoning;
		if (reasoning) {
			yield { content: '', thinking: reasoning, isThinkingBlock: true, done: false };
		}

		const toolCalls = (message?.tool_calls ?? []).map((call, i) => ({
			id: call.id || `call_${i}`,
			name: call.function?.name ?? '',
			arguments: this._parseArgs(call.function?.arguments)
		}));

		yield {
			content: message?.content ?? '',
			done: true,
			stopReason: toolCalls.length > 0 ? 'tool_use' : this._toStopReason(choice?.finish_reason),
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			usage: {
				promptTokens: result.usage?.prompt_tokens ?? 0,
				completionTokens: result.usage?.completion_tokens ?? 0,
				totalTokens: result.usage?.total_tokens ?? 0
			}
		};
	}

	private _collect(pending: Map<number, { id: string; name: string; args: string }>): ToolCallRequest[] | undefined {
		if (pending.size === 0) {
			return undefined;
		}

		return Array.from(pending.entries())
			.sort(([a], [b]) => a - b)
			.map(([index, call]) => ({
				id: call.id || `call_${index}`,
				name: call.name,
				arguments: this._parseArgs(call.args)
			}));
	}

	/**
	 * Arguments arrive as a JSON string here, unlike Ollama's native API which
	 * sends an object. A call whose arguments failed to parse still comes through
	 * so the agent loop can answer it rather than leave the model waiting.
	 */
	private _parseArgs(raw: string | undefined): Record<string, unknown> {
		if (!raw?.trim()) {
			return {};
		}
		try {
			return JSON.parse(raw) as Record<string, unknown>;
		} catch {
			return {};
		}
	}

	private _toStopReason(raw: string | undefined): StopReason {
		switch (raw) {
			case 'tool_calls':
			case 'function_call':
				return 'tool_use';
			case 'length':
				return 'max_tokens';
			case 'content_filter':
				return 'refusal';
			default:
				return 'end_turn';
		}
	}

	private async _describeError(response: Response): Promise<string> {
		const raw = await response.text();
		let message = raw;
		try {
			message = (JSON.parse(raw) as WireResponse).error?.message ?? raw;
		} catch {
			// Not JSON — show the raw body.
		}

		switch (response.status) {
			case 401:
			case 403:
				return `⚠️ ${this.config.name} rejected the API key. Run **Sirius: Set API Key** to enter a new one.`;
			case 404:
				return `⚠️ ${this.config.name} does not recognise that model or endpoint. (${message})`;
			case 429: {
				const retryAfter = response.headers.get('retry-after');
				return `⚠️ Rate limited by ${this.config.name}${retryAfter ? ` — try again in ${retryAfter}s` : ''}. ${message}`;
			}
			default:
				return `⚠️ ${this.config.name} error (${response.status}): ${message}`;
		}
	}

	// ─── Discovery ───────────────────────────────────────────────────────────

	private _describe(id: string): SiriusModel {
		return {
			id,
			name: id,
			provider: this.config.id,
			contextWindow: this.config.assumedContextWindow ?? 128000,
			description: `${this.config.name} model`,
			supportsStreaming: true,
			supportsVision: false,
			supportsThinking: false,
			supportsImageGen: false
		};
	}

	/**
	 * Ask the endpoint what it serves. `/v1/models` is part of the shape, so this
	 * works for hosted gateways and local runtimes alike and keeps the picker
	 * honest instead of listing models that may not exist.
	 */
	async getAvailableModels(): Promise<SiriusModel[]> {
		if (!this._baseUrl()) {
			return this._models;
		}

		try {
			const response = await fetch(`${this._baseUrl()}/models`, { headers: this._headers() });
			if (!response.ok) {
				return this._models;
			}

			const data = await response.json() as WireModelList;
			const discovered = (data.data ?? [])
				.map(m => m.id)
				.filter(Boolean)
				.sort()
				.map(id => this._describe(id));

			if (discovered.length > 0) {
				this._models = discovered;
			}
			return this._models;
		} catch {
			return this._models;
		}
	}
}
