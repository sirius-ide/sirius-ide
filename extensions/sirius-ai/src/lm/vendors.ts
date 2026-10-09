/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Language model vendors
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProviderType, SiriusModel } from '../types';

/**
 * Sirius registers each provider as its own language-model vendor — `sirius-anthropic`,
 * `sirius-ollama`, … — matching `languageModelChatProviders` in package.json. That is what
 * the editor's Language Models editor is built around: per vendor, an Add Models entry, a
 * configuration form whose API key the editor keeps in the system keyring, any number of
 * configured instances (provider groups), Delete, Show/Hide and a red row when one fails.
 */
export const VENDOR_PREFIX = 'sirius-';

/** The order providers are listed in, wherever Sirius lists them. */
export const PROVIDER_ORDER: readonly ProviderType[] = [
	'anthropic', 'gemini', 'openai', 'openrouter', 'groq',
	'deepseek', 'mistral', 'xai', 'ollama', 'lmstudio', 'llamacpp', 'custom'
];

/** Found on their usual port with nothing configured; a configured one adds another host. */
export const LOCAL_PROVIDERS: ReadonlySet<ProviderType> = new Set(['ollama', 'lmstudio', 'llamacpp']);

export function vendorOf(provider: ProviderType): string {
	return `${VENDOR_PREFIX}${provider}`;
}

export function providerOf(vendor: string): ProviderType | undefined {
	if (!vendor.startsWith(VENDOR_PREFIX)) {
		return undefined;
	}
	const provider = vendor.slice(VENDOR_PREFIX.length) as ProviderType;
	return PROVIDER_ORDER.includes(provider) ? provider : undefined;
}

/** Every model Sirius offers, across its vendors, in provider order. */
export async function siriusModels(): Promise<vscode.LanguageModelChat[]> {
	const all = await vscode.lm.selectChatModels();
	const rank = (model: vscode.LanguageModelChat) => PROVIDER_ORDER.indexOf(providerOf(model.vendor) ?? 'custom');
	return all
		.filter(model => providerOf(model.vendor) !== undefined)
		.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * What discovery learnt about each model — size on disk, vision, thinking — keyed by vendor
 * and id. The agent picks a tool tier from it: a context window alone cannot tell a 1.5B
 * model from a 32B one.
 */
const knownModels = new Map<string, SiriusModel>();

export function rememberModel(vendor: string, model: SiriusModel): void {
	knownModels.set(`${vendor}/${model.id}`, model);
}

export function knownModel(model: Pick<vscode.LanguageModelChat, 'vendor' | 'id'>): SiriusModel | undefined {
	return knownModels.get(`${model.vendor}/${model.id}`);
}

/**
 * The last configured connection seen for a provider. Tab completion talks to llama.cpp
 * outside the chat path and needs the same optional key a configured llama.cpp carries.
 */
const lastConnections = new Map<ProviderType, ProviderConnection>();

export interface ProviderConnection {
	readonly apiKey?: string;
	readonly url?: string;
}

export function rememberConnection(provider: ProviderType, connection: ProviderConnection): void {
	lastConnections.set(provider, connection);
}

export function lastConnection(provider: ProviderType): ProviderConnection | undefined {
	return lastConnections.get(provider);
}
