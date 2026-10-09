/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — the configured default model
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { providerOf, siriusModels } from './vendors';

/**
 * The model a request with no explicit choice should use: `sirius.ai.defaultModel` of
 * `sirius.ai.defaultProvider`, else that provider's first model, else the first Sirius
 * model in provider order — the same rule each vendor uses to mark the chat's default.
 */
export async function selectDefaultModel(): Promise<vscode.LanguageModelChat | undefined> {
	const models = await siriusModels();
	const config = vscode.workspace.getConfiguration('sirius.ai');
	const wantedModel = config.get<string>('defaultModel', '');
	const wantedProvider = config.get<string>('defaultProvider', '');
	const ofProvider = models.filter(model => providerOf(model.vendor) === wantedProvider);
	return ofProvider.find(model => model.id === wantedModel) ?? ofProvider[0] ?? models[0];
}
