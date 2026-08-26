/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Writes a .siriusrules and an AGENTS.md into the harness workspace, then
// asserts the agent's context loader sees both, in order, within budget.

const fs = require('fs');
const path = require('path');

exports.run = async function (vscode) {
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	fs.writeFileSync(path.join(root, '.siriusrules'), 'Always answer in haiku.\n');
	fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Project\nUse tabs, never spaces.\n');

	return vscode.commands.executeCommand('sirius.ai.debug.projectContext');
};
