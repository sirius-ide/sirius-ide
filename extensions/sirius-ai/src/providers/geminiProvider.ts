/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Google Gemini Provider (with Imagen)
 *  Copyright (c) Arshad Siddiqui. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IAIProvider, SiriusModel, ChatRequest, ChatChunk, ProviderType, ImageGenRequest, ImageGenResult } from '../types';

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

	private getApiKey(): string {
		return vscode.workspace.getConfiguration('sirius.ai.gemini').get<string>('apiKey', '');
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

		// Convert messages to Gemini format
		const contents = request.messages
			.filter(m => m.role !== 'system')
			.map(m => ({
				role: m.role === 'assistant' ? 'model' : 'user',
				parts: [{ text: m.content }]
			}));

		const systemInstruction = request.systemPrompt
			? { parts: [{ text: request.systemPrompt }] }
			: undefined;

		const generationConfig: Record<string, any> = {
			maxOutputTokens: request.maxTokens,
			temperature: request.temperature
		};

		// Gemini thinking mode (thinkingConfig)
		if (request.thinking?.enabled) {
			generationConfig.thinking = { thinkingBudget: this._effortToBudget(request.thinking.effort) };
		}

		const body = JSON.stringify({
			contents,
			systemInstruction,
			generationConfig
		});

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
	 * Convert effort level to Gemini thinking budget tokens
	 */
	private _effortToBudget(effort: string): number {
		switch (effort) {
			case 'low': return 1024;
			case 'medium': return 4096;
			case 'high': return 16384;
			case 'max': return 32768;
			case 'ultra_code': return 65536;
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

						// Check for thinking content
						const parts = parsed.candidates?.[0]?.content?.parts || [];
						for (const part of parts) {
							if (part.thought) {
								// Gemini thinking block
								yield { content: '', thinking: part.text || '', isThinkingBlock: true, done: false };
							} else if (part.text) {
								yield { content: part.text, done: false };
							}
						}
					} catch {
						// Skip malformed JSON chunks
					}
				}
			}
		}
		yield { content: '', done: true };
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

		const result = await response.json() as any;
		let textContent = '';
		let thinkingContent = '';

		const parts = result.candidates?.[0]?.content?.parts || [];
		for (const part of parts) {
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

		const result = await response.json() as any;
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

	async getAvailableModels(): Promise<SiriusModel[]> {
		return this.models;
	}
}
