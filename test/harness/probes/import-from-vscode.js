/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Imports settings/keybindings/snippets from the machine's real VS Code
// profile into the fresh harness profile, and spot-checks one value round-trip.

const fs = require('fs');

exports.run = async function (vscode, context) {
	const report = await vscode.commands.executeCommand('sirius.ai.importFromEditor', {
		source: 'vscode', categories: ['settings', 'keybindings', 'snippets'], interactive: false
	});

	const raw = fs.readFileSync(`${process.env.HOME}/.config/Code/User/settings.json`, 'utf8')
		.replace(/\/\/[^\n]*/g, '').replace(/,\s*([}\]])/g, '$1');
	const source = JSON.parse(raw);
	const firstKey = Object.keys(source)[0];

	const path = require('path');
	const userDir = path.dirname(path.dirname(context.globalStorageUri.fsPath));
	const written = JSON.parse(fs.readFileSync(path.join(userDir, 'settings.json'), 'utf8'));

	return {
		report,
		spotCheck: {
			key: firstKey,
			sourceValue: source[firstKey],
			readBack: written[firstKey] ?? null
		}
	};
};
