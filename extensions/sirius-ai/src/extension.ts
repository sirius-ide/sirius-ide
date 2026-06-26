/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — AI Extension Entry Point
 *  Copyright (c) Arshad Siddiqui. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ModelRouter } from './providers/modelRouter';
import { SiriusChatViewProvider } from './chat/chatPanel';
import { SiriusInlineChatProvider } from './inline/inlineChatProvider';

let modelRouter: ModelRouter;

export function activate(context: vscode.ExtensionContext) {
	console.log('★ Sirius AI is activating...');

	// ─── Core: Model Router ──────────────────────────────────────────────
	modelRouter = new ModelRouter();

	// ─── Chat Panel (Sidebar) ────────────────────────────────────────────
	const chatProvider = new SiriusChatViewProvider(context.extensionUri, modelRouter);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(SiriusChatViewProvider.viewType, chatProvider)
	);

	// ─── Inline Chat (Ctrl+I) ────────────────────────────────────────────
	const inlineChat = new SiriusInlineChatProvider(modelRouter);
	inlineChat.register(context);

	// ─── Commands ────────────────────────────────────────────────────────

	// Open chat
	context.subscriptions.push(
		vscode.commands.registerCommand('sirius.ai.openChat', () => {
			vscode.commands.executeCommand('sirius.ai.chatView.focus');
		})
	);

	// Set API key
	context.subscriptions.push(
		vscode.commands.registerCommand('sirius.ai.setApiKey', () => {
			modelRouter.setApiKey();
		})
	);

	// Select model
	context.subscriptions.push(
		vscode.commands.registerCommand('sirius.ai.selectModel', () => {
			modelRouter.selectModel();
		})
	);

	// Set thinking effort
	context.subscriptions.push(
		vscode.commands.registerCommand('sirius.ai.setThinkingEffort', () => {
			modelRouter.setThinkingEffort();
		})
	);

	// Toggle thinking mode
	context.subscriptions.push(
		vscode.commands.registerCommand('sirius.ai.toggleThinking', async () => {
			const config = vscode.workspace.getConfiguration('sirius.ai.thinking');
			const current = config.get<boolean>('enabled', true);
			await config.update('enabled', !current, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`🧠 Thinking mode ${!current ? 'enabled' : 'disabled'}`);
		})
	);

	// Generate image
	context.subscriptions.push(
		vscode.commands.registerCommand('sirius.ai.generateImage', async () => {
			const prompt = await vscode.window.showInputBox({
				title: '🎨 Generate Image',
				prompt: 'Describe the image you want to generate',
				placeHolder: 'A modern dashboard UI with dark theme...'
			});
			if (prompt) {
				const result = await modelRouter.generateImage(prompt);
				if (result && result.images.length > 0) {
					vscode.window.showInformationMessage(`🎨 Generated ${result.images.length} image(s)`);
				}
			}
		})
	);

	// ─── Context Menu Commands ───────────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('sirius.ai.explainSelection', () => {
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				const code = editor.document.getText(editor.selection);
				const lang = editor.document.languageId;
				chatProvider.sendContextAction('explain', code, lang);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('sirius.ai.fixErrors', () => {
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				const code = editor.document.getText(editor.selection);
				const lang = editor.document.languageId;
				chatProvider.sendContextAction('fix', code, lang);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('sirius.ai.writeTests', () => {
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				const code = editor.document.getText(editor.selection);
				const lang = editor.document.languageId;
				chatProvider.sendContextAction('tests', code, lang);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('sirius.ai.refactor', () => {
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				const code = editor.document.getText(editor.selection);
				const lang = editor.document.languageId;
				chatProvider.sendContextAction('refactor', code, lang);
			}
		})
	);

	// ─── Status Bar ──────────────────────────────────────────────────────

	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
	const model = modelRouter.getDefaultModel();
	const thinking = modelRouter.getThinkingConfig();
	statusBarItem.text = `$(star-full) ${model.name}${thinking.enabled && model.supportsThinking ? ' 🧠' : ''}`;
	statusBarItem.tooltip = 'Sirius AI — Click to change model';
	statusBarItem.command = 'sirius.ai.selectModel';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	modelRouter.onModelChanged((newModel) => {
		const thinkCfg = modelRouter.getThinkingConfig();
		statusBarItem.text = `$(star-full) ${newModel.name}${thinkCfg.enabled && newModel.supportsThinking ? ' 🧠' : ''}`;
	});

	// ─── Welcome ─────────────────────────────────────────────────────────

	const hasShownWelcome = context.globalState.get('sirius.ai.welcomeShown.v2', false);
	if (!hasShownWelcome) {
		vscode.window.showInformationMessage(
			'★ Sirius AI v2 — Multi-model AI with Thinking, Tools, and Image Gen!',
			'Set API Key',
			'Select Model'
		).then(selection => {
			if (selection === 'Set API Key') {
				modelRouter.setApiKey();
			} else if (selection === 'Select Model') {
				modelRouter.selectModel();
			}
		});
		context.globalState.update('sirius.ai.welcomeShown.v2', true);
	}

	console.log('★ Sirius AI v2 activated successfully!');
}

export function deactivate() {
	modelRouter?.dispose();
	console.log('★ Sirius AI deactivated.');
}
