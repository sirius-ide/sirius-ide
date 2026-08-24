/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Inline Chat Provider (Ctrl+I)
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *
 *  Hooks into VS Code's built-in inline chat system to provide
 *  AI-powered inline editing with accept/reject diffs.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ModelRouter } from '../providers/modelRouter';

/**
 * Registers Sirius as a Chat Participant for inline chat (Ctrl+I).
 * This uses VS Code's Chat API to provide inline editing capabilities.
 */
export class SiriusInlineChatProvider {

	constructor(
		private readonly modelRouter: ModelRouter
	) { }

	/**
	 * Register all inline chat features
	 */
	register(context: vscode.ExtensionContext): void {
		// The editor's own chat drives Sirius models through the language-model
		// provider, so a separate participant would just be a second front door.
		this._registerInlineCompletions(context);
	}

	/**
	 * Register inline completion provider for code suggestions
	 */
	private _registerInlineCompletions(context: vscode.ExtensionContext): void {
		const provider = vscode.languages.registerInlineCompletionItemProvider(
			{ pattern: '**' },
			{
				provideInlineCompletionItems: async (
					document: vscode.TextDocument,
					position: vscode.Position,
					_context: vscode.InlineCompletionContext,
					token: vscode.CancellationToken
				): Promise<vscode.InlineCompletionItem[]> => {

					// Only trigger on explicit invocation or after typing
					const config = vscode.workspace.getConfiguration('sirius.ai');
					if (!config.get<boolean>('inlineCompletions', false)) {
						return [];
					}

					// Get surrounding context
					const startLine = Math.max(0, position.line - 20);
					const prefix = document.getText(new vscode.Range(startLine, 0, position.line, position.character));
					const suffix = document.getText(new vscode.Range(position.line, position.character, Math.min(document.lineCount - 1, position.line + 10), 0));

					const prompt = `Complete the following ${document.languageId} code. Only output the completion, nothing else.\n\nBefore cursor:\n\`\`\`\n${prefix}\n\`\`\`\n\nAfter cursor:\n\`\`\`\n${suffix}\n\`\`\`\n\nCompletion:`;

					try {
						let completion = '';
						for await (const chunk of this.modelRouter.chat([{ role: 'user', content: prompt, timestamp: Date.now() }])) {
							if (token.isCancellationRequested) { return []; }
							if (chunk.content) {
								completion += chunk.content;
							}
						}

						// Clean up the completion
						completion = completion
							.replace(/^```[\w]*\n?/, '')
							.replace(/\n?```$/, '')
							.trim();

						if (completion) {
							return [new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))];
						}
					} catch {
						// Silently fail for inline completions
					}

					return [];
				}
			}
		);

		context.subscriptions.push(provider);
	}
}
