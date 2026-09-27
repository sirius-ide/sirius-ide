/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Proves the product.json wiring that a fresh audit found dangling:
//  - `chatExtensionOutputExtensionStateCommand` (sirius.ai.debug.extensionState)
//    must be a registered command, and must run without throwing;
//  - `completionsEnablementSetting` (sirius.ai.enable) must be a declared
//    setting whose default is the per-language object the workbench reads;
//  - image-generation models must not appear among the chat models.
// Also spot-checks that the older boolean still exists (deprecated, not removed).

exports.run = async function (vscode) {
	const commands = new Set(await vscode.commands.getCommands(true));
	const config = vscode.workspace.getConfiguration('sirius.ai');

	let stateRan = null;
	let stateError = null;
	try {
		await vscode.commands.executeCommand('sirius.ai.debug.extensionState');
		stateRan = true;
	} catch (error) {
		stateRan = false;
		stateError = String(error && error.message || error);
	}

	const enable = config.inspect('sirius.ai.enable'.replace('sirius.ai.', ''));
	const legacy = config.inspect('inlineCompletions');

	let chatModelIds = [];
	let selectError = null;
	try {
		chatModelIds = (await vscode.lm.selectChatModels({ vendor: 'sirius' })).map(m => m.id);
	} catch (error) {
		selectError = String(error && error.message || error);
	}

	return {
		commands: {
			extensionState: commands.has('sirius.ai.debug.extensionState'),
			toolTier: commands.has('sirius.ai.debug.toolTier'),
			projectContext: commands.has('sirius.ai.debug.projectContext')
		},
		extensionStateRan: stateRan,
		stateError,
		settings: {
			enableDeclared: enable !== undefined && enable.defaultValue !== undefined,
			enableDefault: enable && enable.defaultValue,
			legacyDeclared: legacy !== undefined && legacy.defaultValue !== undefined
		},
		imageModelsInChatList: chatModelIds.filter(id => /image|imagen/i.test(id)),
		chatModelCount: chatModelIds.length,
		selectError
	};
};
