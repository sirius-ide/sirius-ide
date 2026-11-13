/*---------------------------------------------------------------------------------------------
 *  Sirius for VS Code — activation
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PanelHost, TAB_TYPE, VIEW_ID } from '../panel/panelHost';
import { Completions } from './completions';
import { registerCommitMessage } from './commitMessage';

/** Sirius IDE's own Sirius, built in: where it is, this extension stands aside. */
const BUILT_IN = 'sirius.sirius-ai';
/** Every command this extension contributes, for the stand-aside answer. */
const COMMANDS = ['sirius.open', 'sirius.panel.openInTab', 'sirius.panel.newConversation', 'sirius.panel.setup', 'sirius.panel.acceptChange', 'sirius.panel.rejectChange', 'sirius.commitMessage', 'sirius.completions.turnOn', 'sirius.completions.turnOff', 'sirius.completions.menu'];
const STAND_ASIDE = 'Sirius IDE has Sirius built in, so this extension does nothing here — uninstall it.';

/**
 * The VS Code edition, on the stable API only: Sirius's own chat panel, drawn by Sirius in a
 * webview; Tab completion from a code model on the user's machine; commit messages. It starts
 * with the window, so completion is ready before anything is typed; the panel asks no vendor
 * anything until it is opened. Sirius IDE does not load this; its chat is the editor's own
 * (extension.ts) — and installed there, this stands aside.
 */
export function activate(context: vscode.ExtensionContext): void {
	if (vscode.extensions.getExtension(BUILT_IN)) {
		standAside(context);
		return;
	}
	const host = new PanelHost(context);
	const completions = new Completions(host.servers);
	context.subscriptions.push(
		host,
		completions,
		host.onDidChangeServers(() => completions.serversChanged()),
		vscode.window.registerWebviewViewProvider(VIEW_ID, host, { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.window.registerWebviewPanelSerializer(TAB_TYPE, host),
		vscode.commands.registerCommand('sirius.open', () => vscode.commands.executeCommand(`${VIEW_ID}.focus`)),
		vscode.commands.registerCommand('sirius.panel.openInTab', () => host.openInTab()),
		vscode.commands.registerCommand('sirius.panel.newConversation', () => host.newConversation()),
		vscode.commands.registerCommand('sirius.panel.setup', () => host.showSetup()),
		vscode.commands.registerCommand('sirius.panel.acceptChange', (target?: unknown) => host.decideInEditor(target, 'accept')),
		vscode.commands.registerCommand('sirius.panel.rejectChange', (target?: unknown) => host.decideInEditor(target, 'reject'))
	);
	registerCommitMessage(context, host.commitModel);
}

/** Inside Sirius IDE: the panel says why it is empty, and every command says the same. */
function standAside(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VIEW_ID, {
			resolveWebviewView(view) {
				view.webview.options = { enableScripts: false };
				view.webview.html = page();
			}
		}),
		// A tab of Sirius's restored from before says the same, rather than nothing.
		vscode.window.registerWebviewPanelSerializer(TAB_TYPE, {
			async deserializeWebviewPanel(panel) {
				panel.webview.options = { enableScripts: false };
				panel.webview.html = page();
			}
		}),
		// The message is not waited on: a command that waits on a notification ends only when it is closed.
		...COMMANDS.map(command => vscode.commands.registerCommand(command, () => { void vscode.window.showInformationMessage(STAND_ASIDE); }))
	);
}

function page(): string {
	return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'"></head><body><div id="app"><p>${STAND_ASIDE}</p></div></body></html>`;
}

export function deactivate(): void { }
