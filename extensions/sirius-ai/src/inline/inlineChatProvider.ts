/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Inline Chat Provider (Ctrl+I)
 *  Copyright (c) Arshad Siddiqui. All rights reserved.
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
		// Register the Sirius chat participant
		this._registerChatParticipant(context);

		// Register inline completion provider for quick suggestions
		this._registerInlineCompletions(context);
	}

	/**
	 * Register Sirius as a VS Code Chat Participant
	 */
	private _registerChatParticipant(context: vscode.ExtensionContext): void {
		try {
			// Check if the chat API is available (VS Code 1.90+)
			if (!vscode.chat?.createChatParticipant) {
				console.log('★ Sirius: Chat Participant API not available in this VS Code version');
				return;
			}

			const participant = vscode.chat.createChatParticipant('sirius.ai', this._handleChatRequest.bind(this));

			participant.iconPath = new vscode.ThemeIcon('star-full');

			context.subscriptions.push(participant);
			console.log('★ Sirius: Chat Participant registered');
		} catch (error) {
			console.log('★ Sirius: Could not register Chat Participant:', error);
		}
	}

	/**
	 * Handle chat requests from VS Code's built-in chat panel or inline chat
	 */
	private async _handleChatRequest(
		request: vscode.ChatRequest,
		_context: vscode.ChatContext,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<vscode.ChatResult> {

		const userMessage = request.prompt;

		// Get current editor context
		const editor = vscode.window.activeTextEditor;
		let contextPrefix = '';

		if (editor) {
			const selection = editor.document.getText(editor.selection);
			const fileName = editor.document.fileName.split('/').pop();
			const lang = editor.document.languageId;

			if (selection) {
				contextPrefix = `\n\nThe user has selected this code in ${fileName}:\n\`\`\`${lang}\n${selection}\n\`\`\`\n\n`;
			} else {
				// Send surrounding context (±50 lines around cursor)
				const cursorLine = editor.selection.active.line;
				const startLine = Math.max(0, cursorLine - 50);
				const endLine = Math.min(editor.document.lineCount - 1, cursorLine + 50);
				const range = new vscode.Range(startLine, 0, endLine, editor.document.lineAt(endLine).text.length);
				const surroundingCode = editor.document.getText(range);

				contextPrefix = `\n\nThe user's cursor is at line ${cursorLine + 1} in ${fileName}:\n\`\`\`${lang}\n${surroundingCode}\n\`\`\`\n\n`;
			}
		}

		const fullPrompt = contextPrefix + userMessage;
		const messages = [{ role: 'user' as const, content: fullPrompt, timestamp: Date.now() }];

		try {
			for await (const chunk of this.modelRouter.chat(messages)) {
				if (token.isCancellationRequested) { break; }

				if (chunk.thinking) {
					// Show thinking as a progress indicator
					stream.progress(`🧠 Thinking: ${chunk.thinking.substring(0, 100)}...`);
				}

				if (chunk.content) {
					stream.markdown(chunk.content);
				}
			}
		} catch (error: any) {
			stream.markdown(`\n\n⚠️ Error: ${error.message}`);
		}

		return {};
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
