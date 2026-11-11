/*---------------------------------------------------------------------------------------------
 *  Sirius — the panel's providers, keys and models
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { IAIProvider, ProviderType, SiriusModel } from '../types';
import { KEYED_PROVIDERS, OPTIONAL_KEY_PROVIDERS, PROVIDER_LABELS } from '../auth/secretStore';
import { DEFAULT_URLS, ModelRouter } from '../providers/modelRouter';
import { PROVIDER_ORDER, LOCAL_PROVIDERS } from '../lm/vendors';
import type { ModelEntry, ProviderView } from './protocol';

/** The vendor's own API, where a gateway or proxy that speaks it may stand in (as in Sirius IDE). */
const BASE_URLS: Partial<Record<ProviderType, string>> = {
	anthropic: 'https://api.anthropic.com',
	gemini: 'https://generativelanguage.googleapis.com',
	openai: 'https://api.openai.com/v1'
};

/** How long one provider may take to answer its check and list its models. */
const DISCOVERY_MS = 8_000;

const KEY = (provider: ProviderType) => `sirius.panel.key.${provider}`;
const URL_KEY = (provider: ProviderType) => `sirius.panel.url.${provider}`;

export interface Reachable {
	readonly provider: IAIProvider;
	readonly model: SiriusModel;
}

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
	return Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} did not answer within ${ms / 1000} s`)), ms))]);
}

/**
 * What the panel can talk to. Keys live in the editor's secret storage (the system keyring)
 * and never reach the webview; a server address lives in the extension's global state.
 * A hosted provider is offered once it has a key that its vendor accepts (one cheap request);
 * a local server is offered when it answers at its usual address or the one given.
 */
export class ModelCatalog {
	private entries = new Map<string, Reachable>();
	private views: ProviderView[] = [];

	constructor(
		private readonly secrets: vscode.SecretStorage,
		private readonly global: vscode.Memento,
		private readonly router: ModelRouter
	) { }

	get providers(): readonly ProviderView[] { return this.views; }

	get models(): ModelEntry[] {
		return [...this.entries.entries()].map(([key, { model }]) => ({
			key,
			provider: model.provider,
			label: model.name || model.id,
			...(model.deprecated ? { detail: 'Deprecated by its vendor' } : model.description ? { detail: model.description } : {}),
			thinking: model.supportsThinking
		}));
	}

	reachable(key: string): Reachable | undefined {
		return this.entries.get(key);
	}

	isProvider(id: string): id is ProviderType {
		return (PROVIDER_ORDER as readonly string[]).includes(id);
	}

	async setKey(provider: ProviderType, key: string): Promise<void> {
		await this.secrets.store(KEY(provider), key);
	}

	async clearKey(provider: ProviderType): Promise<void> {
		await this.secrets.delete(KEY(provider));
	}

	async setUrl(provider: ProviderType, url: string): Promise<void> {
		await this.global.update(URL_KEY(provider), url || undefined);
	}

	/** Asks every provider, in parallel, what it offers now. */
	async refresh(): Promise<void> {
		const results = await Promise.all(PROVIDER_ORDER.map(id => this._discover(id)));
		this.entries = new Map(results.flatMap(r => r.models.map(model => [`${model.provider}/${model.id}`, { provider: r.provider, model }] as const)));
		this.views = results.map(r => r.view);
	}

	private async _discover(id: ProviderType): Promise<{ view: ProviderView; provider: IAIProvider; models: SiriusModel[] }> {
		const kind: ProviderView['kind'] = id === 'custom' ? 'custom' : LOCAL_PROVIDERS.has(id) ? 'local' : 'hosted';
		const apiKey = await this.secrets.get(KEY(id));
		const url = this.global.get<string>(URL_KEY(id)) || undefined;
		const takesKey = KEYED_PROVIDERS.includes(id) || OPTIONAL_KEY_PROVIDERS.includes(id);
		const provider = this.router.createProvider(id, { ...(apiKey ? { apiKey } : {}), ...(url ? { url } : {}) });
		const defaultUrl = DEFAULT_URLS[id] ?? BASE_URLS[id];
		const base = {
			id, label: PROVIDER_LABELS[id], kind, hasKey: !!apiKey, takesKey,
			takesUrl: kind !== 'hosted' || BASE_URLS[id] !== undefined,
			...(url ? { url } : {}),
			...(defaultUrl !== undefined ? { defaultUrl } : {})
		};
		// Nothing to ask: a hosted provider without a key, a custom endpoint without an address.
		if ((kind === 'hosted' && !apiKey) || (kind === 'custom' && !url)) {
			return { view: { ...base, models: 0 }, provider, models: [] };
		}
		try {
			const check = await withTimeout(provider.checkConnection(), DISCOVERY_MS, PROVIDER_LABELS[id]);
			if (!check.ok) {
				// A local server that is simply not running is not a problem to report.
				return { view: { ...base, models: 0, ...(kind === 'local' && !url ? {} : { problem: check.problem }) }, provider, models: [] };
			}
			const models = (await withTimeout(provider.getAvailableModels(), DISCOVERY_MS, PROVIDER_LABELS[id]))
				.filter(model => !model.supportsImageGen);
			return { view: { ...base, models: models.length }, provider, models };
		} catch (error) {
			return { view: { ...base, models: 0, problem: error instanceof Error ? error.message : String(error) }, provider, models: [] };
		}
	}
}
