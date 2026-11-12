/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Tools another extension offers, as a probe of Sirius's panel needs them: harness_ping answers
// "ping:<text>"; harness_picture answers with a 1×1 PNG and a line of text. Neither asks for a
// confirmation, so only the panel's own question stands before them.
// Loaded beside the edition by edition-stub.sh (SIRIUS_PROBE_EXTRA_EXT).

const vscode = require('vscode');

/** A 1×1 transparent PNG. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

exports.activate = function (context) {
	context.subscriptions.push(vscode.lm.registerTool('harness_ping', {
		invoke: async options => new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`ping:${options.input?.text ?? ''}`)])
	}));
	context.subscriptions.push(vscode.lm.registerTool('harness_picture', {
		invoke: async () => new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart('picture:attached'),
			vscode.LanguageModelDataPart.image(Buffer.from(PNG, 'base64'), 'image/png')
		])
	}));
};
