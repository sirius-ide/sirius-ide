/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Code Actions (Apply, Insert, Diff)
 *  Copyright (c) Arshad Siddiqui. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Handles code actions from AI chat responses:
 * - Apply code to active file
 * - Insert at cursor
 * - Show diff preview
 */
export class SiriusCodeActions {

	/**
	 * Apply a code block to the active editor (replaces selection or entire file)
	 */
	async applyCode(code: string, _language: string): Promise<boolean> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('No active editor to apply code to.');
			return false;
		}

		const selection = editor.selection;
		const range = selection.isEmpty
			? new vscode.Range(0, 0, editor.document.lineCount, 0)
			: selection;

		const success = await editor.edit(editBuilder => {
			editBuilder.replace(range, code);
		});

		if (success) {
			vscode.window.showInformationMessage('✅ Code applied successfully');
		}
		return success;
	}

	/**
	 * Insert code at the current cursor position
	 */
	async insertAtCursor(code: string): Promise<boolean> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('No active editor to insert code into.');
			return false;
		}

		const position = editor.selection.active;
		const success = await editor.edit(editBuilder => {
			editBuilder.insert(position, code);
		});

		if (success) {
			vscode.window.showInformationMessage('✅ Code inserted at cursor');
		}
		return success;
	}

	/**
	 * Show a diff preview before applying changes
	 */
	async showDiffPreview(original: string, suggested: string, fileName: string): Promise<void> {
		const scheme = 'sirius-diff';

		// Register content providers for diff view
		const originalUri = vscode.Uri.parse(`${scheme}:original/${fileName}`);
		const suggestedUri = vscode.Uri.parse(`${scheme}:suggested/${fileName}`);

		const provider = new (class implements vscode.TextDocumentContentProvider {
			provideTextDocumentContent(uri: vscode.Uri): string {
				return uri.path.startsWith('original/') ? original : suggested;
			}
		})();

		const disposable = vscode.workspace.registerTextDocumentContentProvider(scheme, provider);

		await vscode.commands.executeCommand('vscode.diff',
			originalUri,
			suggestedUri,
			`★ Sirius AI Suggestion: ${fileName}`,
			{ preview: true }
		);

		// Clean up after tab is closed
		const listener = vscode.window.onDidChangeVisibleTextEditors(() => {
			const stillOpen = vscode.window.visibleTextEditors.some(
				e => e.document.uri.scheme === scheme
			);
			if (!stillOpen) {
				disposable.dispose();
				listener.dispose();
			}
		});
	}

	/**
	 * Copy code to clipboard
	 */
	async copyToClipboard(code: string): Promise<void> {
		await vscode.env.clipboard.writeText(code);
		vscode.window.showInformationMessage('📋 Code copied to clipboard');
	}

	/**
	 * Create a new file with the given code
	 */
	async createNewFile(code: string, language: string): Promise<void> {
		const doc = await vscode.workspace.openTextDocument({
			content: code,
			language
		});
		await vscode.window.showTextDocument(doc);
	}
}
