/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — fill-in-the-middle transport
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface FimRequest {
	readonly prefix: string;
	readonly suffix: string;
	readonly maxTokens: number;
	readonly signal: AbortSignal;
}

export interface FimBackend {
	readonly id: string;
	complete(request: FimRequest): Promise<string>;
}

/**
 * Chat framing ruins completion quality — models narrate, fence, and
 * apologise. Real Tab completion needs the runtimes' native fill-in-the-middle
 * protocols, which is why this client exists apart from the chat router.
 */

/** Ollama's /api/generate takes prefix + suffix natively for FIM-trained models. */
class OllamaFim implements FimBackend {
	constructor(readonly id: string, private readonly endpoint: string, private readonly model: string) { }

	async complete(request: FimRequest): Promise<string> {
		const response = await fetch(`${this.endpoint}/api/generate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			signal: request.signal,
			body: JSON.stringify({
				model: this.model,
				prompt: request.prefix,
				suffix: request.suffix,
				stream: false,
				options: {
					num_predict: request.maxTokens,
					temperature: 0.2,
					stop: ['\n\n\n']
				}
			})
		});
		if (!response.ok) {
			throw new Error(`Ollama ${response.status}`);
		}
		const body = await response.json() as { response?: string };
		return body.response ?? '';
	}
}

/** llama.cpp's dedicated /infill endpoint. */
class LlamaCppFim implements FimBackend {
	constructor(readonly id: string, private readonly baseUrl: string) { }

	async complete(request: FimRequest): Promise<string> {
		const response = await fetch(`${this.baseUrl}/infill`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			signal: request.signal,
			body: JSON.stringify({
				input_prefix: request.prefix,
				input_suffix: request.suffix,
				n_predict: request.maxTokens,
				temperature: 0.2,
				stop: ['\n\n\n']
			})
		});
		if (!response.ok) {
			throw new Error(`llama.cpp ${response.status}`);
		}
		const body = await response.json() as { content?: string };
		return body.content ?? '';
	}
}

/** Models an Ollama install might carry that are FIM-trained. */
const FIM_CAPABLE = /coder|code|starcoder|codegemma|codestral|codellama/i;

/**
 * Resolve the best available FIM backend. Explicit configuration wins;
 * otherwise a running local Ollama with a code model is picked up
 * automatically, so Tab completion lights up for local-first users with zero
 * setup.
 */
export async function resolveFimBackend(): Promise<FimBackend | undefined> {
	const config = vscode.workspace.getConfiguration('sirius.ai');
	const configured = config.get<string>('completions.model', 'auto');

	const ollamaEndpoint = vscode.workspace.getConfiguration('sirius.ai.ollama')
		.get<string>('endpoint', 'http://localhost:11434');
	const llamaBase = vscode.workspace.getConfiguration('sirius.ai.llamacpp')
		.get<string>('baseUrl', '');

	if (configured !== 'auto' && configured.startsWith('ollama/')) {
		return new OllamaFim(configured, ollamaEndpoint, configured.slice('ollama/'.length));
	}
	if (configured === 'llamacpp' && llamaBase) {
		return new LlamaCppFim(configured, llamaBase);
	}

	// Auto: a running Ollama with any FIM-capable model.
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 1500);
		const response = await fetch(`${ollamaEndpoint}/api/tags`, { signal: controller.signal });
		clearTimeout(timer);
		if (response.ok) {
			const body = await response.json() as { models?: Array<{ name: string }> };
			const model = body.models?.find(m => FIM_CAPABLE.test(m.name));
			if (model) {
				return new OllamaFim(`ollama/${model.name}`, ollamaEndpoint, model.name);
			}
		}
	} catch {
		// Ollama not running — fall through.
	}

	if (llamaBase) {
		return new LlamaCppFim('llamacpp', llamaBase);
	}

	return undefined;
}
