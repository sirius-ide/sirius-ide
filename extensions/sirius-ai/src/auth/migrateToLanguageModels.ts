/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Keys into the editor's Language Models
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProviderType } from '../types';
import { KEYED_PROVIDERS, OPTIONAL_KEY_PROVIDERS, PROVIDER_LABELS, SiriusSecretStore } from './secretStore';
import { vendorOf } from '../lm/vendors';

/** Endpoints that were settings and become part of the configured provider. */
const URL_SETTINGS: Partial<Record<ProviderType, { readonly key: string; readonly usual: string }>> = {
	openai: { key: 'sirius.ai.openai.baseUrl', usual: 'https://api.openai.com/v1' },
	custom: { key: 'sirius.ai.custom.baseUrl', usual: '' }
};

/**
 * Keys Sirius kept under its own keyring entries (`sirius.ai.apiKey.<provider>`) become
 * provider groups in the editor's Language Models — one per provider, named after it — and
 * Sirius's copy is deleted. Both halves are the same secret store (the workbench's, backed by
 * the OS keyring), so a key never touches disk in the clear on the way. A custom endpoint
 * set in settings comes along, and OpenAI's if it is not the usual one.
 *
 * The editor's migrate command asks the provider for its models first; a key that is
 * rejected or a server that does not answer then fails it, and the key is added anyway —
 * the Language Models editor shows that provider's problem — rather than stranded.
 *
 * Returns the providers moved, for one notice.
 */
export async function migrateKeysToLanguageModels(secrets: SiriusSecretStore, log: (line: string) => void): Promise<string[]> {
	const moved: string[] = [];
	for (const provider of [...KEYED_PROVIDERS, ...OPTIONAL_KEY_PROVIDERS]) {
		const apiKey = secrets.get(provider);
		const setting = URL_SETTINGS[provider];
		const configuredUrl = setting ? vscode.workspace.getConfiguration().get<string>(setting.key, '').trim() : '';
		const url = configuredUrl && configuredUrl !== setting?.usual ? configuredUrl : undefined;
		if (!apiKey && !(provider === 'custom' && url)) {
			continue;
		}
		const group = { vendor: vendorOf(provider), name: PROVIDER_LABELS[provider], ...(apiKey ? { apiKey } : {}), ...(url ? { url } : {}) };
		let alreadyThere = false;
		try {
			await vscode.commands.executeCommand('lm.migrateLanguageModelsProviderGroup', group);
		} catch (error) {
			if (/already exists/i.test(String(error))) {
				alreadyThere = true; // moved on an earlier start; only Sirius's copy is left to clear
			} else {
				log(`[migrate] ${provider}: ${error instanceof Error ? error.message : String(error)} — adding it anyway`);
				try {
					await vscode.commands.executeCommand('lm.addLanguageModelsProviderGroup', group);
				} catch (again) {
					log(`[migrate] ${provider}: not moved (${again instanceof Error ? again.message : String(again)}); kept for the next start`);
					continue;
				}
			}
		}
		if (apiKey) {
			await secrets.delete(provider);
		}
		if (!alreadyThere) {
			moved.push(PROVIDER_LABELS[provider]);
		}
	}
	return moved;
}
