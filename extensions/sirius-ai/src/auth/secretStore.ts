/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Provider Credential Store
 *  Copyright (c) Arshad Siddiqui. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProviderType } from '../types';

/**
 * Providers that authenticate with an API key. Ollama talks to a local server
 * and needs an endpoint rather than a credential, so it is deliberately absent.
 */
export const KEYED_PROVIDERS: readonly ProviderType[] = [
	'anthropic', 'gemini', 'openai', 'openrouter', 'groq', 'deepseek', 'mistral', 'xai'
];

/** Human-readable names, used in prompts and confirmations. */
export const PROVIDER_LABELS: Record<ProviderType, string> = {
	anthropic: 'Anthropic Claude',
	gemini: 'Google Gemini',
	ollama: 'Ollama (local)',
	openai: 'OpenAI',
	openrouter: 'OpenRouter',
	groq: 'Groq',
	deepseek: 'DeepSeek',
	mistral: 'Mistral',
	xai: 'xAI Grok',
	lmstudio: 'LM Studio (local)',
	llamacpp: 'llama.cpp / vLLM (local)',
	custom: 'Custom OpenAI-compatible'
};

/** Where a provider's key lives in SecretStorage. */
function secretKey(provider: ProviderType): string {
	return `sirius.ai.apiKey.${provider}`;
}

/** The old plaintext settings key, kept only so existing keys can be migrated out of it. */
function legacySettingsSection(provider: ProviderType): string {
	return `sirius.ai.${provider}`;
}

/**
 * Stores provider API keys in the OS keyring via VS Code's SecretStorage.
 *
 * Keys were previously written to settings.json in plaintext, where they were
 * readable by any process running as the user, captured by dotfile backups and
 * carried off the machine by Settings Sync. {@link migrateLegacyKeys} moves any
 * such key into the keyring and clears the setting.
 *
 * Reads are served from an in-memory cache so that `isConfigured()` can stay
 * synchronous — SecretStorage itself is async, and the model picker needs to
 * render provider state without awaiting.
 */
export class SiriusSecretStore {

	private readonly cache = new Map<ProviderType, string>();
	private readonly _onDidChange = new vscode.EventEmitter<ProviderType>();

	/** Fires when a provider's key is added, replaced or removed. */
	readonly onDidChange = this._onDidChange.event;

	private constructor(private readonly secrets: vscode.SecretStorage) { }

	/**
	 * Builds the store, migrates any plaintext keys, and primes the cache.
	 */
	static async create(context: vscode.ExtensionContext): Promise<SiriusSecretStore> {
		const store = new SiriusSecretStore(context.secrets);

		await store.migrateLegacyKeys();
		await store.reloadAll();

		// Another window, or Settings Sync, may change a secret underneath us.
		context.subscriptions.push(context.secrets.onDidChange(async e => {
			const provider = KEYED_PROVIDERS.find(p => secretKey(p) === e.key);
			if (provider) {
				await store.reload(provider);
				store._onDidChange.fire(provider);
			}
		}));

		context.subscriptions.push(store._onDidChange);
		return store;
	}

	// ─── Reads ───────────────────────────────────────────────────────────────

	/** The stored key for a provider, or an empty string. Served from cache. */
	get(provider: ProviderType): string {
		return this.cache.get(provider) ?? '';
	}

	has(provider: ProviderType): boolean {
		return this.get(provider).length > 0;
	}

	// ─── Writes ──────────────────────────────────────────────────────────────

	async set(provider: ProviderType, apiKey: string): Promise<void> {
		const trimmed = apiKey.trim();
		if (!trimmed) {
			await this.delete(provider);
			return;
		}

		await this.secrets.store(secretKey(provider), trimmed);
		this.cache.set(provider, trimmed);
		this._onDidChange.fire(provider);
	}

	async delete(provider: ProviderType): Promise<void> {
		await this.secrets.delete(secretKey(provider));
		this.cache.delete(provider);
		this._onDidChange.fire(provider);
	}

	// ─── Internals ───────────────────────────────────────────────────────────

	private async reloadAll(): Promise<void> {
		await Promise.all(KEYED_PROVIDERS.map(p => this.reload(p)));
	}

	private async reload(provider: ProviderType): Promise<void> {
		const value = await this.secrets.get(secretKey(provider));
		if (value) {
			this.cache.set(provider, value);
		} else {
			this.cache.delete(provider);
		}
	}

	/**
	 * Moves any key still sitting in settings.json into SecretStorage and blanks
	 * the setting. Runs on every activation, so a key restored from an old
	 * settings backup is swept up the next time Sirius starts.
	 */
	private async migrateLegacyKeys(): Promise<void> {
		const migrated: ProviderType[] = [];

		for (const provider of KEYED_PROVIDERS) {
			const config = vscode.workspace.getConfiguration(legacySettingsSection(provider));
			const inspected = config.inspect<string>('apiKey');
			const plaintext = (inspected?.globalValue ?? inspected?.workspaceValue ?? '').trim();

			if (!plaintext) {
				continue;
			}

			// Never clobber a key already in the keyring with a stale settings value.
			const existing = await this.secrets.get(secretKey(provider));
			if (!existing) {
				await this.secrets.store(secretKey(provider), plaintext);
			}

			// Clear every scope the value could have been written to.
			for (const target of [vscode.ConfigurationTarget.Global, vscode.ConfigurationTarget.Workspace]) {
				try {
					await config.update('apiKey', undefined, target);
				} catch {
					// A scope that was never written to throws; nothing to clear there.
				}
			}

			migrated.push(provider);
		}

		if (migrated.length > 0) {
			const names = migrated.map(p => PROVIDER_LABELS[p]).join(', ');
			vscode.window.showInformationMessage(
				`Sirius moved your ${names} API key${migrated.length > 1 ? 's' : ''} out of settings.json and into the system keyring.`
			);
		}
	}
}
