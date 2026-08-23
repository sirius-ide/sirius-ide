/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Multi-Model Router
 *  Copyright (c) Arshad Siddiqui. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IAIProvider, SiriusModel, ChatRequest, ChatChunk, ProviderType, ThinkingConfig, ThinkingEffort, ImageGenResult, SIRIUS_SYSTEM_PROMPT } from '../types';
import { GeminiProvider } from './geminiProvider';
import { AnthropicProvider } from './anthropicProvider';
import { OpenAIProvider } from './openaiProvider';
import { OllamaProvider } from './ollamaProvider';

/**
 * Provider color map for UI
 */
export const PROVIDER_COLORS: Record<ProviderType, string> = {
	anthropic: '#8b5cf6',  // Purple
	gemini: '#4285f4',     // Blue
	openai: '#10a37f',     // Green
	ollama: '#6b7280'      // Gray
};

/**
 * Central router that manages all AI providers and routes requests
 * to the appropriate provider based on user configuration.
 */
export class ModelRouter {
	private providers: Map<ProviderType, IAIProvider>;
	private _onModelChanged = new vscode.EventEmitter<SiriusModel>();
	readonly onModelChanged = this._onModelChanged.event;

	constructor() {
		this.providers = new Map();
		this.providers.set('gemini', new GeminiProvider());
		this.providers.set('anthropic', new AnthropicProvider());
		this.providers.set('openai', new OpenAIProvider());
		this.providers.set('ollama', new OllamaProvider());
	}

	// ─── Provider Access ─────────────────────────────────────────────────────

	getAllProviders(): IAIProvider[] {
		return Array.from(this.providers.values());
	}

	getProvider(id: ProviderType): IAIProvider | undefined {
		return this.providers.get(id);
	}

	getDefaultProvider(): IAIProvider {
		const config = vscode.workspace.getConfiguration('sirius.ai');
		const providerId = config.get<ProviderType>('defaultProvider', 'gemini');
		return this.providers.get(providerId) || this.providers.get('gemini')!;
	}

	// ─── Model Access ────────────────────────────────────────────────────────

	getDefaultModel(): SiriusModel {
		const config = vscode.workspace.getConfiguration('sirius.ai');
		const modelId = config.get<string>('defaultModel', 'gemini-3.5-flash');
		return this.findModel(modelId) || this.getDefaultProvider().models[0];
	}

	findModel(modelId: string): SiriusModel | undefined {
		for (const provider of this.providers.values()) {
			const model = provider.models.find(m => m.id === modelId);
			if (model) { return model; }
		}
		return undefined;
	}

	getProviderForModel(modelId: string): IAIProvider | undefined {
		for (const provider of this.providers.values()) {
			if (provider.models.some(m => m.id === modelId)) {
				return provider;
			}
		}
		return undefined;
	}

	getAllModels(): SiriusModel[] {
		const allModels: SiriusModel[] = [];
		for (const provider of this.providers.values()) {
			allModels.push(...provider.models);
		}
		return allModels;
	}

	getModelsGroupedByProvider(): Map<string, SiriusModel[]> {
		const grouped = new Map<string, SiriusModel[]>();
		for (const provider of this.providers.values()) {
			grouped.set(provider.name, provider.models);
		}
		return grouped;
	}

	getConfiguredProviders(): IAIProvider[] {
		return this.getAllProviders().filter(p => p.isConfigured());
	}

	// ─── Thinking Config ─────────────────────────────────────────────────────

	getThinkingConfig(): ThinkingConfig {
		const config = vscode.workspace.getConfiguration('sirius.ai.thinking');
		return {
			enabled: config.get<boolean>('enabled', true),
			effort: config.get<ThinkingEffort>('effort', 'high')
		};
	}

	async setThinkingEffort(): Promise<void> {
		const efforts: Array<{ label: string; effort: ThinkingEffort; description: string }> = [
			{ label: '⚡ Low', effort: 'low', description: 'Fastest — simple tasks, quick answers' },
			{ label: '🔷 Medium', effort: 'medium', description: 'Balanced — everyday coding tasks' },
			{ label: '🔶 High', effort: 'high', description: 'Thorough — complex reasoning (default)' },
			{ label: '🔴 Max', effort: 'max', description: 'Deep analysis — hard problems' },
			{ label: '💎 Ultra Code', effort: 'ultra_code', description: 'Maximum depth — advanced engineering' }
		];

		const selected = await vscode.window.showQuickPick(
			efforts.map(e => ({ label: e.label, description: e.effort, detail: e.description, effort: e.effort })),
			{ title: '🧠 Set Thinking Effort', placeHolder: 'How deeply should the AI reason?' }
		);

		if (selected) {
			await vscode.workspace.getConfiguration('sirius.ai.thinking')
				.update('effort', selected.effort, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`🧠 Thinking effort set to ${selected.label}`);
		}
	}

	// ─── Model Selection UI ──────────────────────────────────────────────────

	async selectModel(): Promise<SiriusModel | undefined> {
		const items: (vscode.QuickPickItem & { model?: SiriusModel })[] = [];

		for (const provider of this.providers.values()) {
			// Provider header
			items.push({
				label: provider.name,
				kind: vscode.QuickPickItemKind.Separator
			});

			const isConfigured = provider.isConfigured();

			for (const model of provider.models) {
				const currentModel = this.getDefaultModel();
				const isActive = currentModel.id === model.id;
				const badges: string[] = [];
				if (model.supportsThinking) { badges.push('🧠'); }
				if (model.supportsImageGen) { badges.push('🎨'); }
				if (model.supportsVision) { badges.push('👁️'); }

				items.push({
					label: `${isActive ? '$(star-full) ' : ''}${model.name} ${badges.join('')}`,
					description: isConfigured ? model.id : '(API key not set)',
					detail: model.description,
					model
				});
			}
		}

		// Add Ollama dynamic models
		const ollama = this.providers.get('ollama')!;
		const ollamaModels = await ollama.getAvailableModels();
		if (ollamaModels.length > 0) {
			for (const model of ollamaModels) {
				if (!ollama.models.some(m => m.id === model.id)) {
					items.push({
						label: `  ${model.name}`,
						description: `(detected) ${model.id}`,
						detail: model.description,
						model
					});
				}
			}
		}

		const selected = await vscode.window.showQuickPick(items, {
			title: '✨ Select AI Model',
			placeHolder: 'Choose a model from any provider... (🧠=Thinking 🎨=ImageGen 👁️=Vision)',
			matchOnDescription: true,
			matchOnDetail: true
		});

		if (selected?.model) {
			const config = vscode.workspace.getConfiguration('sirius.ai');
			await config.update('defaultProvider', selected.model.provider, vscode.ConfigurationTarget.Global);
			await config.update('defaultModel', selected.model.id, vscode.ConfigurationTarget.Global);
			this._onModelChanged.fire(selected.model);

			vscode.window.showInformationMessage(`✨ Sirius AI now using ${selected.model.name}`);
			return selected.model;
		}
		return undefined;
	}

	// ─── API Key Setup ───────────────────────────────────────────────────────

	async setApiKey(): Promise<void> {
		const providers = ['Google Gemini', 'Anthropic Claude', 'OpenAI GPT', 'Ollama (no key needed)'];

		const selected = await vscode.window.showQuickPick(providers, {
			title: '🔑 Set API Key',
			placeHolder: 'Choose a provider to configure...'
		});

		if (!selected) { return; }

		if (selected.includes('Ollama')) {
			const endpoint = await vscode.window.showInputBox({
				title: 'Ollama Endpoint',
				value: 'http://localhost:11434',
				prompt: 'Enter your Ollama server endpoint'
			});
			if (endpoint) {
				await vscode.workspace.getConfiguration('sirius.ai.ollama')
					.update('endpoint', endpoint, vscode.ConfigurationTarget.Global);
				vscode.window.showInformationMessage('✅ Ollama endpoint configured!');
			}
			return;
		}

		const providerMap: Record<string, string> = {
			'Google Gemini': 'sirius.ai.gemini',
			'Anthropic Claude': 'sirius.ai.anthropic',
			'OpenAI GPT': 'sirius.ai.openai'
		};

		const configKey = providerMap[selected];
		if (!configKey) { return; }

		const apiKey = await vscode.window.showInputBox({
			title: `${selected} API Key`,
			password: true,
			prompt: `Enter your ${selected} API key`,
			placeHolder: 'sk-...'
		});

		if (apiKey) {
			await vscode.workspace.getConfiguration(configKey)
				.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`✅ ${selected} API key saved!`);
		}
	}

	// ─── Chat Routing ────────────────────────────────────────────────────────

	async *chat(
		messages: Array<{ role: 'user' | 'assistant'; content: string }>,
		modelId?: string
	): AsyncIterable<ChatChunk> {
		const config = vscode.workspace.getConfiguration('sirius.ai');
		const targetModelId = modelId || config.get<string>('defaultModel', 'gemini-3.5-flash');
		const maxTokens = config.get<number>('maxTokens', 16384);
		const temperature = config.get<number>('temperature', 0.7);
		const stream = config.get<boolean>('streamResponses', true);

		// Find the provider for this model
		let provider = this.getProviderForModel(targetModelId);
		if (!provider) {
			// Fallback: might be a dynamic Ollama model
			provider = this.providers.get('ollama')!;
		}

		// Build thinking config — only if the model supports it
		const model = this.findModel(targetModelId);
		const thinkingConfig = this.getThinkingConfig();
		const thinking: ThinkingConfig | undefined =
			model?.supportsThinking && thinkingConfig.enabled
				? thinkingConfig
				: undefined;

		const chatMessages = messages.map(m => ({
			...m,
			timestamp: Date.now()
		}));

		const request: ChatRequest = {
			messages: chatMessages,
			model: targetModelId,
			maxTokens,
			temperature,
			stream,
			systemPrompt: SIRIUS_SYSTEM_PROMPT,
			thinking
		};

		yield* provider.chat(request);
	}

	// ─── Image Generation ────────────────────────────────────────────────────

	async generateImage(prompt: string): Promise<ImageGenResult | null> {
		const gemini = this.providers.get('gemini') as GeminiProvider;
		if (!gemini?.isConfigured()) {
			vscode.window.showWarningMessage('⚠️ Gemini API key required for image generation. Run Sirius: Set API Key.');
			return null;
		}

		try {
			return await gemini.generateImage({ prompt });
		} catch (error: any) {
			vscode.window.showErrorMessage(`Image generation failed: ${error.message}`);
			return null;
		}
	}

	dispose(): void {
		this._onModelChanged.dispose();
	}
}
