/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Multi-Model Router
 *  Copyright (c) Arshad Siddiqui. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IAIProvider, SiriusModel, ChatRequest, ChatChunk, ChatMessage, ProviderType, ThinkingConfig, ThinkingEffort, ImageGenResult, ToolDefinition, SIRIUS_SYSTEM_PROMPT } from '../types';
import { SiriusSecretStore, KEYED_PROVIDERS, PROVIDER_LABELS } from '../auth/secretStore';
import { GeminiProvider } from './geminiProvider';
import { AnthropicProvider } from './anthropicProvider';
import { OpenAICompatibleProvider, OPENAI_COMPATIBLE_ENDPOINTS } from './openaiCompatible';
import { OllamaProvider } from './ollamaProvider';

/**
 * Provider color map for UI
 */
export const PROVIDER_COLORS: Record<ProviderType, string> = {
	anthropic: '#8b5cf6',   // Purple
	gemini: '#4285f4',      // Blue
	ollama: '#6b7280',      // Gray
	openai: '#10a37f',      // Green
	openrouter: '#6467f2',  // Indigo
	groq: '#f55036',        // Orange
	deepseek: '#4d6bfe',    // Cornflower
	mistral: '#fa520f',     // Vermilion
	xai: '#1d9bf0',         // Sky
	lmstudio: '#8b8b8b',    // Gray
	llamacpp: '#8b8b8b',    // Gray
	custom: '#9ca3af'       // Slate
};

/**
 * Central router that manages all AI providers and routes requests
 * to the appropriate provider based on user configuration.
 */
export class ModelRouter {
	private providers: Map<ProviderType, IAIProvider>;
	private _onModelChanged = new vscode.EventEmitter<SiriusModel>();
	readonly onModelChanged = this._onModelChanged.event;

	constructor(private readonly secrets: SiriusSecretStore) {
		this.providers = new Map();
		this.providers.set('anthropic', new AnthropicProvider(secrets));
		this.providers.set('gemini', new GeminiProvider(secrets));
		this.providers.set('ollama', new OllamaProvider());

		// Everything OpenAI-shaped comes from one adapter and one table.
		for (const endpoint of OPENAI_COMPATIBLE_ENDPOINTS) {
			this.providers.set(endpoint.id, new OpenAICompatibleProvider(endpoint, secrets));
		}
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
		const modelId = config.get<string>('defaultModel', 'claude-opus-5');

		return this.findModel(modelId)
			?? this.getDefaultProvider().models[0]
			// Providers that discover their models start empty, so fall back to
			// anything statically known rather than returning undefined.
			?? this.getAllModels()[0];
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
			{ label: '🔷 Extra High', effort: 'xhigh', description: 'Best for coding and agentic work' },
			{ label: '💎 Max', effort: 'max', description: 'Maximum depth — when correctness beats cost' }
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

		// Ask every configured provider what it actually serves. Local runtimes and
		// gateways both change underneath us, so a static list goes stale fast.
		const configured = this.getConfiguredProviders();
		const discovered = await Promise.all(
			configured.map(async provider => {
				try {
					return { provider, models: await provider.getAvailableModels() };
				} catch {
					return { provider, models: [] as SiriusModel[] };
				}
			})
		);

		for (const { provider, models } of discovered) {
			const fresh = models.filter(m => !provider.models.some(known => known.id === m.id));
			if (fresh.length === 0) { continue; }

			items.push({ label: `${provider.name} — detected`, kind: vscode.QuickPickItemKind.Separator });
			for (const model of fresh) {
				items.push({
					label: model.name,
					description: model.id,
					detail: model.description,
					model
				});
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
		type ProviderPick = vscode.QuickPickItem & { provider: ProviderType };

		const items: ProviderPick[] = KEYED_PROVIDERS.map(provider => ({
			label: PROVIDER_LABELS[provider],
			description: this.secrets.has(provider) ? '$(key) key stored' : 'no key set',
			provider
		}));
		items.push({
			label: PROVIDER_LABELS.ollama,
			description: 'no key needed — runs locally',
			provider: 'ollama'
		});

		const selected = await vscode.window.showQuickPick(items, {
			title: '🔑 Set API Key',
			placeHolder: 'Choose a provider to configure...'
		});
		if (!selected) { return; }

		if (selected.provider === 'ollama') {
			const config = vscode.workspace.getConfiguration('sirius.ai.ollama');
			const endpoint = await vscode.window.showInputBox({
				title: 'Ollama Endpoint',
				value: config.get<string>('endpoint', 'http://localhost:11434'),
				prompt: 'Enter your Ollama server endpoint',
				ignoreFocusOut: true
			});
			if (endpoint) {
				await config.update('endpoint', endpoint, vscode.ConfigurationTarget.Global);
				vscode.window.showInformationMessage('✅ Ollama endpoint configured.');
			}
			return;
		}

		const provider = selected.provider;
		const label = PROVIDER_LABELS[provider];

		if (this.secrets.has(provider)) {
			const action = await vscode.window.showQuickPick(
				[
					{ label: 'Replace key', detail: `Enter a new ${label} key` },
					{ label: 'Remove key', detail: `Delete the ${label} key from the system keyring` }
				],
				{ title: `${label} — a key is already stored`, placeHolder: 'What would you like to do?' }
			);

			if (!action) { return; }
			if (action.label === 'Remove key') {
				await this.secrets.delete(provider);
				vscode.window.showInformationMessage(`Removed the ${label} key from the system keyring.`);
				return;
			}
		}

		const apiKey = await vscode.window.showInputBox({
			title: `${label} API Key`,
			password: true,
			prompt: 'Stored in the system keyring — never written to settings.json',
			ignoreFocusOut: true
		});
		if (!apiKey?.trim()) { return; }

		await this.secrets.set(provider, apiKey);
		vscode.window.showInformationMessage(`✅ ${label} key saved to the system keyring.`);
	}

	// ─── Chat Routing ────────────────────────────────────────────────────────

	async *chat(
		messages: ChatMessage[],
		modelId?: string,
		tools?: ToolDefinition[]
	): AsyncIterable<ChatChunk> {
		const config = vscode.workspace.getConfiguration('sirius.ai');
		const targetModelId = modelId || config.get<string>('defaultModel', 'claude-opus-5');

		// A model discovered at runtime has no statically known provider, so fall
		// back to Ollama, which is the only provider that serves unlisted ids.
		const provider = this.getProviderForModel(targetModelId) ?? this.providers.get('ollama')!;

		yield* this._send(provider, targetModelId, messages, tools);
	}

	/**
	 * Send to an explicitly chosen provider.
	 *
	 * The language-model bridge namespaces ids as `provider/model` to keep them
	 * unique across twelve providers, so it resolves the provider itself rather
	 * than searching for a model id that may be served by several of them.
	 */
	async *chatWithProvider(
		providerId: ProviderType,
		modelId: string,
		messages: ChatMessage[],
		tools?: ToolDefinition[]
	): AsyncIterable<ChatChunk> {
		const provider = this.providers.get(providerId);
		if (!provider) {
			yield { content: `⚠️ Unknown provider: ${providerId}`, done: true, stopReason: 'error' };
			return;
		}

		yield* this._send(provider, modelId, messages, tools);
	}

	private async *_send(
		provider: IAIProvider,
		modelId: string,
		messages: ChatMessage[],
		tools?: ToolDefinition[]
	): AsyncIterable<ChatChunk> {
		const config = vscode.workspace.getConfiguration('sirius.ai');

		// Thinking is only requested where the model actually supports it.
		const model = provider.models.find(m => m.id === modelId) ?? this.findModel(modelId);
		const thinkingConfig = this.getThinkingConfig();
		const thinking: ThinkingConfig | undefined =
			model?.supportsThinking && thinkingConfig.enabled ? thinkingConfig : undefined;

		const request: ChatRequest = {
			messages,
			model: modelId,
			maxTokens: config.get<number>('maxTokens', 16384),
			temperature: config.get<number>('temperature', 0.7),
			stream: config.get<boolean>('streamResponses', true),
			systemPrompt: SIRIUS_SYSTEM_PROMPT,
			thinking,
			tools
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
