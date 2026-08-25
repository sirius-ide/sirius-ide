/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Inline Chat Provider (Ctrl+I)
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *
 *  Hooks into VS Code's built-in inline chat system to provide
 *  AI-powered inline editing with accept/reject diffs.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { TabCompletionProvider } from './tabCompletionProvider';

/**
 * Registers Sirius as a Chat Participant for inline chat (Ctrl+I).
 * This uses VS Code's Chat API to provide inline editing capabilities.
 */
export class SiriusInlineChatProvider {

	/**
	 * Register all inline chat features
	 */
	register(context: vscode.ExtensionContext): void {
		// The editor's own chat drives Sirius models through the language-model
		// provider, so a separate participant would just be a second front door.
		this._registerInlineCompletions(context);
	}

	/**
	 * Tab completion: debounced, cached, cancellable fill-in-the-middle.
	 */
	private _registerInlineCompletions(context: vscode.ExtensionContext): void {
		context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider(
			{ pattern: '**' },
			new TabCompletionProvider()
		));
	}
}
