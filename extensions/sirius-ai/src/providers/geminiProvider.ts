/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Google Gemini Provider (with Imagen)
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { IAIProvider, KeySource, SiriusModel, ChatRequest, ChatChunk, ChatMessage, ImagePart, ProviderType, ImageGenRequest, ImageGenResult, StopReason, ToolCallRequest } from '../types';
import { ConnectionCheck, checkEndpoint, closeOnAbort, isRejectedKey } from './connection';

/** The vendor's API, unless a gateway or proxy that speaks it is configured. */
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

/**
 * The key travels in the `x-goog-api-key` header, not the `?key=` query
 * parameter: a URL ends up in proxy logs, error messages and crash reports,
 * where a header does not.
 */
function geminiHeaders(apiKey: string): Record<string, string> {
	return { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
}

/** A single part of a Gemini candidate's content. */
interface GeminiPart {
	text?: string;
	thought?: boolean;
	inlineData?: { data: string; mimeType?: string };
	functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
	/** Gemini's signature over its reasoning, on the part it belongs to: a function call, or text. */
	thoughtSignature?: string;
}

/**
 * Gemini's documented value for a function call it did not sign — one rescued from a model's
 * prose, or made by another model — which Google's own SDK sends the same way. Gemini 3 checks
 * the first function call of each step and refuses one with no signature at all; the calls after
 * it in a parallel step come unsigned from Gemini itself and go back the same way.
 */
const SKIP_SIGNATURE = 'skip_thought_signature_validator';

/**
 * A call id Gemini gave, as Sirius carries it: marked, so that only Gemini's own ids go back to
 * Gemini as ids. A call without one gets `sirius-call-<n>`, never sent.
 */
const GEMINI_ID = 'gid_';
const geminiIdOf = (id: string): string | undefined => id.startsWith(GEMINI_ID) ? id.slice(GEMINI_ID.length) : undefined;

/** The subset of the models endpoint that discovery reads. */
interface GeminiModelList {
	models?: Array<{
		name?: string;
		displayName?: string;
		description?: string;
		inputTokenLimit?: number;
		outputTokenLimit?: number;
		supportedGenerationMethods?: string[];
	}>;
}

/** The subset of Gemini's generateContent response that this provider reads. */
interface GeminiGenerateResponse {
	candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
	usageMetadata?: {
		promptTokenCount?: number;
		candidatesTokenCount?: number;
		totalTokenCount?: number;
		thoughtsTokenCount?: number;
	};
}

export class GeminiProvider implements IAIProvider {
	readonly id: ProviderType = 'gemini';
	readonly name = 'Google Gemini';
	readonly models: SiriusModel[] = [
		// ─── Flagship ─────────────────────────────────────────────────────
		{
			id: 'gemini-3.5-flash',
			name: 'Gemini 3.5 Flash',
			provider: 'gemini',
			contextWindow: 1048576,
			description: 'Latest flagship — best for agentic workflows, coding, and reasoning',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false,
			maxOutputTokens: 65536
		},
		// ─── Reasoning ────────────────────────────────────────────────────
		{
			id: 'gemini-3.1-pro',
			name: 'Gemini 3.1 Pro',
			provider: 'gemini',
			contextWindow: 1048576,
			description: 'Deep reasoning model — great for complex analysis and planning',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: true,
			supportsImageGen: false,
			maxOutputTokens: 65536
		},
		// ─── Fast & Cheap ─────────────────────────────────────────────────
		{
			id: 'gemini-3.1-flash-lite',
			name: 'Gemini 3.1 Flash Lite',
			provider: 'gemini',
			contextWindow: 1048576,
			description: 'Cost-efficient — fastest responses for simple tasks',
			supportsStreaming: true,
			supportsVision: true,
			supportsThinking: false,
			supportsImageGen: false,
			maxOutputTokens: 8192
		},
		// ─── Image Generation ─────────────────────────────────────────────
		{
			id: 'gemini-3.1-flash-image',
			name: 'Gemini 3.1 Flash Image',
			provider: 'gemini',
			contextWindow: 32768,
			description: 'Image generation (Imagen) — create and edit images from text prompts',
			supportsStreaming: false,
			supportsVision: true,
			supportsThinking: false,
			supportsImageGen: true,
			maxOutputTokens: 8192
		},
		// ─── Pro Image ────────────────────────────────────────────────────
		{
			id: 'gemini-3-pro-image',
			name: 'Gemini 3 Pro Image',
			provider: 'gemini',
			contextWindow: 32768,
			description: 'High-quality image generation — better detail and consistency',
			supportsStreaming: false,
			supportsVision: true,
			supportsThinking: false,
			supportsImageGen: true,
			maxOutputTokens: 8192
		}
	];

	/** @param baseUrl a gateway or proxy that speaks the Gemini API; else the vendor's. */
	constructor(private readonly secrets: KeySource, private readonly baseUrl?: string) { }

	private getApiKey(): string {
		return this.secrets.get('gemini');
	}

	private _baseUrl(): string {
		return (this.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
	}

	isConfigured(): boolean {
		return this.getApiKey().length > 0;
	}

	checkConnection(): Promise<ConnectionCheck> {
		return checkEndpoint(`${this._baseUrl()}/v1beta/models`, { 'x-goog-api-key': this.getApiKey() }, 'Gemini', {
			notFoundIsFine: this._baseUrl() !== DEFAULT_BASE_URL,
			noRedirect: true
		});
	}

	async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
		const apiKey = this.getApiKey();
		if (!apiKey) {
			yield { content: '⚠️ No Gemini API key. Add Google Gemini in **Manage Models** (or **Sirius: Set API Key**).', done: true };
			return;
		}

		const model = request.model || 'gemini-3.5-flash';

		const contents = this._toContents(request.messages, model);

		const systemInstruction = request.systemPrompt
			? { parts: [{ text: request.systemPrompt }] }
			: undefined;

		const generationConfig: Record<string, any> = {
			maxOutputTokens: request.maxTokens,
			temperature: request.temperature
		};

		// Gemini's field is `thinkingConfig`, and thought parts are only returned
		// when `includeThoughts` is set — without it the parser below never sees a
		// thought and the thinking pane stays empty.
		if (request.thinking?.enabled) {
			generationConfig.thinkingConfig = {
				thinkingBudget: this._effortToBudget(request.thinking.effort),
				includeThoughts: true
			};
		}

		const payload: Record<string, unknown> = {
			contents,
			systemInstruction,
			generationConfig
		};

		// `parameters` is Gemini's OpenAPI subset, which refuses `$ref`, `$defs` and
		// `additionalProperties` — all common in an MCP server's schema.
		// `parametersJsonSchema` takes JSON Schema as it is. A tool with no
		// arguments (a group tool, say) declares none: an empty object schema has
		// been refused.
		if (request.tools?.length) {
			payload.tools = [{
				functionDeclarations: request.tools.map(t => ({
					name: t.name,
					description: t.description,
					...(Object.keys(t.inputSchema.properties).length ? { parametersJsonSchema: t.inputSchema } : {})
				}))
			}];
		}

		const body = JSON.stringify(payload);

		try {
			if (request.stream) {
				yield* this._handleStream(model, apiKey, body, request.signal);
			} else {
				yield* this._handleNonStream(model, apiKey, body, request.signal);
			}
		} catch (error: any) {
			if (request.signal?.aborted) {
				return; // the user stopped it, and the editor is no longer reading
			}
			yield { content: `⚠️ Gemini Error: ${error.message}`, done: true };
		}
	}

	/**
	 * Convert Sirius messages to Gemini `contents`.
	 *
	 * Gemini names the assistant role `model`, carries tool calls as
	 * `functionCall` parts, and takes results back as `functionResponse` parts on
	 * a user turn, matched by name — and by the call's id where Gemini gave one.
	 * The reasoning signatures it gave go back on the parts they belong to: a call's
	 * on that call, the answer's on its text (thoughtSignature).
	 */
	private _toContents(messages: ChatMessage[], model: string): Array<Record<string, unknown>> {
		const contents: Array<Record<string, unknown>> = [];

		for (const message of messages) {
			if (message.role === 'system') {
				continue;
			}

			if (message.role === 'tool') {
				// A tool's images ride as sibling `inlineData` parts on the same
				// user turn as its `functionResponse` — Gemini's documented shape
				// for a multimodal function result.
				contents.push({
					role: 'user',
					parts: (message.toolResults ?? []).flatMap(result => [
						{
							functionResponse: {
								...(geminiIdOf(result.id) ? { id: geminiIdOf(result.id) } : {}),
								name: result.name,
								response: { result: result.content }
							}
						},
						...geminiImageParts(result.images)
					])
				});
				continue;
			}

			// Only signatures this model made: a signature goes back to the model that produced
			// it, never to another Gemini after a switch.
			const own = message.role === 'assistant' ? (message.thinkingBlocks ?? []).filter(block => block.vendor === 'gemini' && block.binding === model && block.signature) : [];
			const textSignature = own.filter(block => !block.call).pop()?.signature;
			const text = (value: string) => ({ text: value, ...(textSignature ? { thoughtSignature: textSignature } : {}) });

			if (message.role === 'assistant' && message.toolCalls?.length) {
				const signed = new Map(own.filter(block => block.call).map(block => [block.call, block.signature]));
				const parts: Array<Record<string, unknown>> = [];
				if (message.content) {
					parts.push(text(message.content));
				}
				message.toolCalls.forEach((call, i) => {
					const signature = signed.get(call.id) ?? (i === 0 ? SKIP_SIGNATURE : undefined);
					parts.push({
						functionCall: { ...(geminiIdOf(call.id) ? { id: geminiIdOf(call.id) } : {}), name: call.name, args: call.arguments },
						...(signature ? { thoughtSignature: signature } : {})
					});
				});
				contents.push({ role: 'model', parts });
				continue;
			}

			// Gemini rejects an empty `text` part, so it is only emitted when there
			// is text; an image-only turn is just its inlineData parts.
			contents.push({
				role: message.role === 'assistant' ? 'model' : 'user',
				parts: [
					...(message.content ? [message.role === 'assistant' ? text(message.content) : { text: message.content }] : []),
					...geminiImageParts(message.images)
				]
			});
		}

		return contents;
	}

	/**
	 * A call keeps the id Gemini gave it, marked (Gemini 3 gives one, and wants it back on the
	 * call and its result); one without gets an id of Sirius's own, by position, which is never
	 * sent as an id. Results are matched back by name either way.
	 */
	private _toToolCalls(parts: GeminiPart[], offset = 0): ToolCallRequest[] {
		return parts
			.filter(part => part.functionCall?.name)
			.map((part, i) => ({
				id: part.functionCall?.id ? `${GEMINI_ID}${part.functionCall.id}` : `sirius-call-${offset + i}`,
				name: part.functionCall?.name ?? '',
				arguments: part.functionCall?.args ?? {}
			}));
	}

	/**
	 * The parts' text and thought as they stream (`streamed`), and every signature as a
	 * thinking block: a call's tied to that call, any other — often on the last part, whose
	 * text may be empty — to the answer's text. `calls` are the parts' calls, in order.
	 */
	private *_signatures(parts: GeminiPart[], calls: ToolCallRequest[], streamed: boolean, model: string): Iterable<ChatChunk> {
		let next = 0;
		for (const part of parts) {
			if (part.functionCall) {
				const call = part.functionCall.name ? calls[next++] : undefined;
				if (call && part.thoughtSignature) {
					yield { content: '', done: false, thinkingBlock: { text: '', signature: part.thoughtSignature, call: call.id, vendor: 'gemini', binding: model } };
				}
				continue;
			}
			if (streamed && part.thought) {
				yield { content: '', thinking: part.text || '', isThinkingBlock: true, done: false };
			} else if (streamed && part.text) {
				yield { content: part.text, done: false };
			}
			if (part.thoughtSignature) {
				yield { content: '', done: false, thinkingBlock: { text: '', signature: part.thoughtSignature, vendor: 'gemini', binding: model } };
			}
		}
	}

	private _toStopReason(raw: string | undefined): StopReason {
		switch (raw) {
			case 'MAX_TOKENS': return 'max_tokens';
			case 'SAFETY':
			case 'PROHIBITED_CONTENT':
				return 'refusal';
			default: return 'end_turn';
		}
	}

	/**
	 * Convert effort level to Gemini thinking budget tokens
	 */
	private _effortToBudget(effort: string): number {
		switch (effort) {
			case 'low': return 1024;
			case 'medium': return 4096;
			case 'high': return 16384;
			case 'xhigh': return 32768;
			case 'max': return 65536;
			default: return 16384;
		}
	}

	/**
	 * Handle SSE streaming response
	 */
	private async *_handleStream(model: string, apiKey: string, body: string, signal: AbortSignal | undefined): AsyncIterable<ChatChunk> {
		const url = `${this._baseUrl()}/v1beta/models/${model}:streamGenerateContent?alt=sse`;
		// No redirect: the key sits in a custom header, which `fetch` would carry to another host.
		const response = await fetch(url, {
			method: 'POST',
			headers: geminiHeaders(apiKey),
			body,
			signal,
			redirect: 'error'
		});

		if (!response.ok) {
			yield { content: await this._describeError(response), done: true };
			return;
		}

		const reader = response.body?.getReader();
		if (!reader) {
			yield { content: '⚠️ No response stream available', done: true };
			return;
		}
		closeOnAbort(reader, signal);

		const decoder = new TextDecoder();
		const toolCalls: ToolCallRequest[] = [];
		let buffer = '';
		let stopReason: StopReason = 'end_turn';

		while (true) {
			const { done, value } = await reader.read();
			if (done) { break; }

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				if (!line.startsWith('data: ')) { continue; }
				const data = line.slice(6).trim();
				if (data === '[DONE]') {
					yield {
						content: '', done: true,
						stopReason: toolCalls.length > 0 ? 'tool_use' : stopReason,
						toolCalls: toolCalls.length > 0 ? toolCalls : undefined
					};
					return;
				}

				let parsed: GeminiGenerateResponse & { candidates?: Array<{ finishReason?: string }> };
				try {
					parsed = JSON.parse(data) as typeof parsed;
				} catch {
					continue; // Skip malformed JSON chunks
				}

				const candidate = parsed.candidates?.[0];
				if (candidate?.finishReason) {
					stopReason = this._toStopReason(candidate.finishReason);
				}

				const parts = parsed.candidates?.[0]?.content?.parts || [];
				const calls = this._toToolCalls(parts, toolCalls.length);
				toolCalls.push(...calls);
				yield* this._signatures(parts, calls, true, model);
			}
		}

		yield {
			content: '', done: true,
			stopReason: toolCalls.length > 0 ? 'tool_use' : stopReason,
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined
		};
	}

	/**
	 * Handle non-streaming response
	 */
	private async *_handleNonStream(model: string, apiKey: string, body: string, signal: AbortSignal | undefined): AsyncIterable<ChatChunk> {
		const url = `${this._baseUrl()}/v1beta/models/${model}:generateContent`;
		const response = await fetch(url, {
			method: 'POST',
			headers: geminiHeaders(apiKey),
			body,
			signal,
			redirect: 'error'
		});

		if (!response.ok) {
			yield { content: await this._describeError(response), done: true };
			return;
		}

		const result = await response.json() as GeminiGenerateResponse & { candidates?: Array<{ finishReason?: string }> };
		let textContent = '';
		let thinkingContent = '';

		const parts = result.candidates?.[0]?.content?.parts || [];
		const toolCalls = this._toToolCalls(parts);

		for (const part of parts) {
			if (part.functionCall) {
				continue; // Collected above.
			}
			if (part.thought) {
				thinkingContent += part.text || '';
			} else if (part.text) {
				textContent += part.text || '';
			}
		}

		if (thinkingContent) {
			yield { content: '', thinking: thinkingContent, isThinkingBlock: true, done: false };
		}
		yield* this._signatures(parts, toolCalls, false, model);

		yield {
			content: textContent,
			done: true,
			stopReason: toolCalls.length > 0 ? 'tool_use' : this._toStopReason(result.candidates?.[0]?.finishReason),
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			usage: {
				promptTokens: result.usageMetadata?.promptTokenCount || 0,
				completionTokens: result.usageMetadata?.candidatesTokenCount || 0,
				totalTokens: result.usageMetadata?.totalTokenCount || 0,
				thinkingTokens: result.usageMetadata?.thoughtsTokenCount || 0
			}
		};
	}

	/**
	 * Turn a refusal into something a user can act on. A wrong key is answered 400 here,
	 * not 401 — `connection.ts` reads the body for it.
	 */
	private async _describeError(response: Response): Promise<string> {
		const raw = await response.text();
		let message = raw;
		try {
			message = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? raw;
		} catch {
			// Not JSON — show the raw body.
		}
		if (isRejectedKey(response.status, raw)) {
			// Google's own text matters here: a 403 may be the API not enabled for the project.
			return `⚠️ Gemini rejected the API key. Change it in **Manage Models** — Configure on the provider's row. (${message})`;
		}
		switch (response.status) {
			case 404:
				return `⚠️ Gemini does not recognise that model. Pick another with **Sirius: Select AI Model**. (${message})`;
			case 429: {
				const retryAfter = response.headers.get('retry-after');
				return `⚠️ Rate limited by Gemini${retryAfter ? ` — try again in ${retryAfter}s` : ''}. ${message}`;
			}
			default:
				return `⚠️ Gemini API Error (${response.status}): ${message}`;
		}
	}

	// ─── Image Generation via Imagen ─────────────────────────────────────────

	/**
	 * Generate images using Gemini's native image generation
	 */
	async generateImage(request: ImageGenRequest): Promise<ImageGenResult> {
		const apiKey = this.getApiKey();
		if (!apiKey) {
			throw new Error('Gemini API key not configured');
		}

		const model = 'gemini-3.1-flash-image';
		const url = `${this._baseUrl()}/v1beta/models/${model}:generateContent`;

		const response = await fetch(url, {
			method: 'POST',
			headers: geminiHeaders(apiKey),
			body: JSON.stringify({
				contents: [{
					parts: [{ text: request.prompt }]
				}],
				generationConfig: {
					responseModalities: ['TEXT', 'IMAGE'],
					imageSizeHint: request.size || '1024x1024'
				}
			}),
			redirect: 'error'
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Imagen API Error (${response.status}): ${error}`);
		}

		const result = await response.json() as GeminiGenerateResponse;
		const images: Array<{ base64: string; mimeType: string }> = [];
		let revisedPrompt: string | undefined;

		const parts = result.candidates?.[0]?.content?.parts || [];
		for (const part of parts) {
			if (part.inlineData) {
				images.push({
					base64: part.inlineData.data,
					mimeType: part.inlineData.mimeType || 'image/png'
				});
			} else if (part.text) {
				revisedPrompt = part.text;
			}
		}

		return { images, revisedPrompt };
	}

	/**
	 * Ask Google which models this key can actually use.
	 *
	 * The static list above is a guess that goes stale; discovery keeps the picker
	 * honest. Only models advertising `generateContent` are usable for chat.
	 */
	async getAvailableModels(): Promise<SiriusModel[]> {
		const apiKey = this.getApiKey();
		if (!apiKey) {
			return this.models;
		}

		try {
			const response = await fetch(`${this._baseUrl()}/v1beta/models`, { headers: { 'x-goog-api-key': apiKey }, redirect: 'error' });
			if (!response.ok) {
				return this.models;
			}

			const data = await response.json() as GeminiModelList;
			const discovered = (data.models ?? [])
				.filter(m => m.name && m.supportedGenerationMethods?.includes('generateContent'))
				.map(m => {
					const id = (m.name ?? '').replace(/^models\//, '');
					return {
						id,
						name: m.displayName || id,
						provider: 'gemini' as ProviderType,
						contextWindow: m.inputTokenLimit ?? 1000000,
						description: m.description || 'Google Gemini model',
						supportsStreaming: true,
						supportsVision: true,
						supportsThinking: true,
						supportsImageGen: id.includes('image'),
						maxOutputTokens: m.outputTokenLimit
					} satisfies SiriusModel;
				});

			return discovered.length > 0 ? discovered : this.models;
		} catch {
			return this.models;
		}
	}
}

/** Images as Gemini `inlineData` parts; empty when there are none. */
function geminiImageParts(images: ImagePart[] | undefined): Array<Record<string, unknown>> {
	return (images ?? []).map(image => ({ inlineData: { mimeType: image.mimeType, data: image.base64 } }));
}
