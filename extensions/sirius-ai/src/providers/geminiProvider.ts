/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Google Gemini Provider (with Imagen)
 *  Copyright (c) emrys. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { SiriusSecretStore } from '../auth/secretStore';
import { IAIProvider, SiriusModel, ChatRequest, ChatChunk, ChatMessage, ProviderType, ImageGenRequest, ImageGenResult, StopReason, ToolCallRequest } from '../types';

/** A single part of a Gemini candidate's content. */
interface GeminiPart {
	text?: string;
	thought?: boolean;
	inlineData?: { data: string; mimeType?: string };
	functionCall?: { name?: string; args?: Record<string, unknown> };
}

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

	constructor(private readonly secrets: SiriusSecretStore) { }

	private getApiKey(): string {
		return this.secrets.get('gemini');
	}

	isConfigured(): boolean {
		return this.getApiKey().length > 0;
	}

	async validateConnection(): Promise<boolean> {
		try {
			const apiKey = this.getApiKey();
			const response = await fetch(
				`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
			);
			return response.ok;
		} catch {
			return false;
		}
	}

	async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
		const apiKey = this.getApiKey();
		if (!apiKey) {
			yield { content: '⚠️ Gemini API key not configured. Run **Sirius: Set API Key** from the command palette.', done: true };
			return;
		}

		const model = request.model || 'gemini-3.5-flash';

		const contents = this._toContents(request.messages);

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

		if (request.tools?.length) {
			payload.tools = [{
				functionDeclarations: request.tools.map(t => ({
					name: t.name,
					description: t.description,
					parameters: t.inputSchema
				}))
			}];
		}

		const body = JSON.stringify(payload);

		try {
			if (request.stream) {
				yield* this._handleStream(model, apiKey, body);
			} else {
				yield* this._handleNonStream(model, apiKey, body);
			}
		} catch (error: any) {
			yield { content: `⚠️ Gemini Error: ${error.message}`, done: true };
		}
	}

	/**
	 * Convert Sirius messages to Gemini `contents`.
	 *
	 * Gemini names the assistant role `model`, carries tool calls as
	 * `functionCall` parts, and takes results back as `functionResponse` parts on
	 * a user turn. It assigns no call ids, so results are matched by name.
	 */
	private _toContents(messages: ChatMessage[]): Array<Record<string, unknown>> {
		const contents: Array<Record<string, unknown>> = [];

		for (const message of messages) {
			if (message.role === 'system') {
				continue;
			}

			if (message.role === 'tool') {
				contents.push({
					role: 'user',
					parts: (message.toolResults ?? []).map(result => ({
						functionResponse: {
							name: result.name,
							response: { result: result.content }
						}
					}))
				});
				continue;
			}

			if (message.role === 'assistant' && message.toolCalls?.length) {
				const parts: Array<Record<string, unknown>> = [];
				if (message.content) {
					parts.push({ text: message.content });
				}
				for (const call of message.toolCalls) {
					parts.push({ functionCall: { name: call.name, args: call.arguments } });
				}
				contents.push({ role: 'model', parts });
				continue;
			}

			contents.push({
				role: message.role === 'assistant' ? 'model' : 'user',
				parts: [{ text: message.content }]
			});
		}

		return contents;
	}

	/**
	 * Gemini assigns no id to a function call, so synthesise one from position.
	 * Results are matched back by name.
	 */
	private _toToolCalls(parts: GeminiPart[], offset = 0): ToolCallRequest[] {
		return parts
			.filter(part => part.functionCall?.name)
			.map((part, i) => ({
				id: `call_${offset + i}`,
				name: part.functionCall?.name ?? '',
				arguments: part.functionCall?.args ?? {}
			}));
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
	private async *_handleStream(model: string, apiKey: string, body: string): AsyncIterable<ChatChunk> {
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body
		});

		if (!response.ok) {
			const error = await response.text();
			yield { content: `⚠️ Gemini API Error (${response.status}): ${error}`, done: true };
			return;
		}

		const reader = response.body?.getReader();
		if (!reader) {
			yield { content: '⚠️ No response stream available', done: true };
			return;
		}

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
				toolCalls.push(...this._toToolCalls(parts, toolCalls.length));

				for (const part of parts) {
					if (part.functionCall) {
						continue; // Collected above.
					}
					if (part.thought) {
						yield { content: '', thinking: part.text || '', isThinkingBlock: true, done: false };
					} else if (part.text) {
						yield { content: part.text, done: false };
					}
				}
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
	private async *_handleNonStream(model: string, apiKey: string, body: string): AsyncIterable<ChatChunk> {
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body
		});

		if (!response.ok) {
			const error = await response.text();
			yield { content: `⚠️ Gemini API Error: ${error}`, done: true };
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
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				contents: [{
					parts: [{ text: request.prompt }]
				}],
				generationConfig: {
					responseModalities: ['TEXT', 'IMAGE'],
					imageSizeHint: request.size || '1024x1024'
				}
			})
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
			const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
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
