/*---------------------------------------------------------------------------------------------
 *  Sirius for VS Code — activation
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PanelHost, TAB_TYPE, VIEW_ID } from '../panel/panelHost';

/**
 * The VS Code edition: Sirius's own chat panel, drawn by Sirius in a webview, on the stable
 * API only. Sirius IDE does not load this; its chat is the editor's own (extension.ts).
 */
export function activate(context: vscode.ExtensionContext): void {
	const host = new PanelHost(context);
	context.subscriptions.push(
		host,
		vscode.window.registerWebviewViewProvider(VIEW_ID, host, { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.window.registerWebviewPanelSerializer(TAB_TYPE, host),
		vscode.commands.registerCommand('sirius.open', () => vscode.commands.executeCommand(`${VIEW_ID}.focus`)),
		vscode.commands.registerCommand('sirius.panel.openInTab', () => host.openInTab()),
		vscode.commands.registerCommand('sirius.panel.newConversation', () => host.newConversation()),
		vscode.commands.registerCommand('sirius.panel.setup', () => host.showSetup()),
		vscode.commands.registerCommand('sirius.panel.acceptChange', (target?: unknown) => host.decideInEditor(target, 'accept')),
		vscode.commands.registerCommand('sirius.panel.rejectChange', (target?: unknown) => host.decideInEditor(target, 'reject'))
	);
}

export function deactivate(): void { }
