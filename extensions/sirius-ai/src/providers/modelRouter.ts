/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Multi-Model Router
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IAIProvider, KeySource, SiriusModel, ChatRequest, ChatChunk, ChatMessage, ProviderType, ThinkingConfig, ThinkingEffort, ToolDefinition, SIRIUS_SYSTEM_PROMPT } from '../types';
import { KEYED_PROVIDERS, PROVIDER_LABELS } from '../auth/secretStore';
import { ProviderConnection, knownModel, providerOf, siriusModels, vendorOf } from '../lm/vendors';
import { selectDefaultModel } from '../lm/defaultModel';

/** The editor's Language Models editor; Sirius links to it wherever providers are set up. */
export const MANAGE_MODELS_COMMAND = 'workbench.action.chat.manage';

/** Providers whose endpoint is asked for when one is added; the value is the usual one. */
const DEFAULT_URLS: Partial<Record<ProviderType, string>> = {
	ollama: 'http://localhost:11434',
	lmstudio: 'http://localhost:1234/v1',
	llamacpp: 'http://localhost:8080/v1',
	custom: ''
};
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

/** A key for exactly one provider — what one configured provider group carries. */
class ConnectionKeys implements KeySource {
	constructor(private readonly provider: ProviderType, private readonly key = '') { }
	get(provider: ProviderType): string {
		return provider === this.provider ? this.key : '';
	}
	has(provider: ProviderType): boolean {
		return this.get(provider).length > 0;
	}
}

/**
 * Builds provider instances and sends requests through them, and runs the two Sirius
 * commands for choosing a model and adding a key. Which providers are set up is no longer
 * kept here: each is a vendor in the editor's Language Models, and its key and endpoint
 * arrive with the request (lm/languageModelProvider.ts).
 */
export class ModelRouter {
	private _onModelChanged = new vscode.EventEmitter<vscode.LanguageModelChat>();
	readonly onModelChanged = this._onModelChanged.event;

	/**
	 * A provider instance for one connection: a configured provider group (its key, its
	 * endpoint), or — with none — a local server at its usual endpoint.
	 */
	createProvider(id: ProviderType, connection?: ProviderConnection): IAIProvider {
		const keys = new ConnectionKeys(id, connection?.apiKey);
		switch (id) {
			case 'anthropic': return new AnthropicProvider(keys);
			case 'gemini': return new GeminiProvider(keys);
			case 'ollama': return new OllamaProvider(connection?.url);
			default: {
				const endpoint = OPENAI_COMPATIBLE_ENDPOINTS.find(candidate => candidate.id === id);
				if (!endpoint) {
					throw new Error(`Unknown provider: ${id}`);
				}
				return new OpenAICompatibleProvider(endpoint, keys, connection?.url);
			}
		}
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

	/**
	 * Sirius: Select AI Model — the default for commit messages, for a chat that names no
	 * model, and for the status bar. Every model the editor has from Sirius, by provider.
	 */
	async selectModel(): Promise<vscode.LanguageModelChat | undefined> {
		const models = await siriusModels();
		if (models.length === 0) {
			const manage = 'Manage Models';
			if (await vscode.window.showInformationMessage('No model yet: add a provider and its key, or start Ollama.', manage) === manage) {
				await vscode.commands.executeCommand(MANAGE_MODELS_COMMAND);
			}
			return undefined;
		}
		const current = await selectDefaultModel();
		type ModelPick = vscode.QuickPickItem & { model?: vscode.LanguageModelChat };
		const items: ModelPick[] = [];
		let group: ProviderType | undefined;
		for (const model of models) {
			const provider = providerOf(model.vendor)!;
			if (provider !== group) {
				items.push({ label: PROVIDER_LABELS[provider], kind: vscode.QuickPickItemKind.Separator });
				group = provider;
			}
			const known = knownModel(model);
			const badges = `${known?.supportsThinking ? '🧠' : ''}${known?.supportsVision ? '👁️' : ''}`;
			const isCurrent = current?.vendor === model.vendor && current.id === model.id;
			items.push({ label: `${isCurrent ? '$(star-full) ' : ''}${model.name} ${badges}`.trim(), description: model.id, detail: known?.description, model });
		}
		const selected = await vscode.window.showQuickPick(items, { title: 'Select AI Model', placeHolder: 'The default for commit messages and the status bar' });
		if (!selected?.model) {
			return undefined;
		}
		const config = vscode.workspace.getConfiguration('sirius.ai');
		await config.update('defaultProvider', providerOf(selected.model.vendor), vscode.ConfigurationTarget.Global);
		await config.update('defaultModel', selected.model.id, vscode.ConfigurationTarget.Global);
		this._onModelChanged.fire(selected.model);
		return selected.model;
	}

	// ─── API Key Setup ───────────────────────────────────────────────────────

	/**
	 * Sirius: Set API Key — adds a provider to the editor's Language Models, its key going
	 * to the system keyring there. Changing or removing one is the Language Models
	 * editor's Configure and Delete, so a provider already added opens it.
	 */
	async setApiKey(): Promise<void> {
		type ProviderPick = vscode.QuickPickItem & { provider?: ProviderType };
		const items: ProviderPick[] = [
			...KEYED_PROVIDERS.map(provider => ({ label: PROVIDER_LABELS[provider], description: 'API key', provider })),
			...(['lmstudio', 'llamacpp', 'custom'] as const).map(provider => ({ label: PROVIDER_LABELS[provider], description: 'endpoint, and a key if your server needs one', provider })),
			{ label: PROVIDER_LABELS.ollama, description: 'another Ollama host — the local one is found automatically', provider: 'ollama' as ProviderType },
			{ label: '', kind: vscode.QuickPickItemKind.Separator },
			{ label: '$(gear) Manage Models…', description: 'change or remove a provider, hide models' }
		];
		const selected = await vscode.window.showQuickPick(items, { title: 'Set API Key', placeHolder: 'Add a provider' });
		if (!selected) {
			return;
		}
		if (!selected.provider) {
			await vscode.commands.executeCommand(MANAGE_MODELS_COMMAND);
			return;
		}
		const provider = selected.provider;
		const label = PROVIDER_LABELS[provider];
		const configuration: Record<string, string> = {};

		const defaultUrl = DEFAULT_URLS[provider];
		if (defaultUrl !== undefined) {
			const url = await vscode.window.showInputBox({ title: `${label} — endpoint`, value: defaultUrl, prompt: 'The server\'s base URL', ignoreFocusOut: true });
			if (!url?.trim()) {
				return;
			}
			configuration.url = url.trim();
		}
		if (provider !== 'ollama') {
			const required = KEYED_PROVIDERS.includes(provider);
			const apiKey = await vscode.window.showInputBox({
				title: `${label} API Key`,
				password: true,
				prompt: required ? 'Stored in the system keyring — never written to settings.json' : 'Optional — leave empty if your server needs none. Stored in the system keyring.',
				ignoreFocusOut: true
			});
			if (apiKey === undefined || (required && !apiKey.trim())) {
				return;
			}
			if (apiKey.trim()) {
				configuration.apiKey = apiKey.trim();
			}
		}

		try {
			await vscode.commands.executeCommand('lm.addLanguageModelsProviderGroup', { vendor: vendorOf(provider), name: label, ...configuration });
			vscode.window.showInformationMessage(`${label} added — its models are in the chat's model picker.`);
		} catch (error) {
			const manage = 'Manage Models';
			const already = /already exists/i.test(String(error));
			const message = already
				? `${label} is already set up. Change its key or endpoint, or remove it, in Manage Models.`
				: `Could not add ${label}: ${error instanceof Error ? error.message : String(error)}`;
			if (await vscode.window.showWarningMessage(message, manage) === manage) {
				await vscode.commands.executeCommand(MANAGE_MODELS_COMMAND);
			}
		}
	}

	// ─── Chat Routing ────────────────────────────────────────────────────────

	/** Send through one provider instance, to a model discovery described. */
	async *chatWithModel(
		provider: IAIProvider,
		model: SiriusModel,
		messages: ChatMessage[],
		tools?: ToolDefinition[]
	): AsyncIterable<ChatChunk> {
		yield* this._send(provider, model, messages, tools);
	}

	private async *_send(
		provider: IAIProvider,
		model: SiriusModel,
		messages: ChatMessage[],
		tools?: ToolDefinition[]
	): AsyncIterable<ChatChunk> {
		const config = vscode.workspace.getConfiguration('sirius.ai');
		const modelId = model.id;

		// Thinking is only requested where the model actually supports it — what
		// discovery learnt, which the static lists never knew for a local model.
		const thinkingConfig = this.getThinkingConfig();
		const thinking: ThinkingConfig | undefined =
			model.supportsThinking && thinkingConfig.enabled ? thinkingConfig : undefined;

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

	dispose(): void {
		this._onModelChanged.dispose();
	}
}
