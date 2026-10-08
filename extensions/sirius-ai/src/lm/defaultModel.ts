/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — the configured default model
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * The model a request with no explicit choice should use: `sirius.ai.defaultModel`,
 * else the first model of `sirius.ai.defaultProvider`, else the first Sirius
 * model — the order the language-model bridge uses to mark the chat panel's
 * default. `selectChatModels` alone returns models in provider order, so taking
 * its first entry ignored the user's setting.
 */
export async function selectDefaultModel(): Promise<vscode.LanguageModelChat | undefined> {
	const models = await vscode.lm.selectChatModels({ vendor: 'sirius' });
	const config = vscode.workspace.getConfiguration('sirius.ai');
	const wantedModel = config.get<string>('defaultModel', '');
	const wantedProvider = config.get<string>('defaultProvider', '');
	// The exact provider/model first: OpenRouter, for one, serves the same model
	// names under its own prefix (`openrouter/anthropic/claude-…`).
	return (wantedModel && wantedProvider ? models.find(m => m.id === `${wantedProvider}/${wantedModel}`) : undefined)
		?? (wantedModel ? models.find(m => m.id.endsWith(`/${wantedModel}`)) : undefined)
		?? (wantedProvider ? models.find(m => m.id.startsWith(`${wantedProvider}/`)) : undefined)
		?? models[0];
}
