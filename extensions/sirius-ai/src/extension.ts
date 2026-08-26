/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — AI Extension Entry Point
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SiriusSecretStore } from './auth/secretStore';
import { ModelRouter } from './providers/modelRouter';
import { SiriusLanguageModelProvider, SIRIUS_VENDOR } from './lm/languageModelProvider';
import { registerSiriusTools } from './lm/toolRegistration';
import { registerGitAssist } from './scm/gitAssist';
import { registerSiriusAgent } from './chat/siriusAgent';
import { registerEditorImporter } from './importer/editorImporter';
import { registerProjectContextDebug } from './chat/projectContext';
import { SiriusToolExecutor } from './tools/toolExecutor';
import { SiriusInlineChatProvider } from './inline/inlineChatProvider';

let modelRouter: ModelRouter;

export async function activate(context: vscode.ExtensionContext) {
	console.log('★ Sirius AI is activating...');

	// ─── Core: Credentials ───────────────────────────────────────────────
	// Provider keys live in the OS keyring. Creating the store also sweeps any
	// key an earlier version left sitting in settings.json in plaintext.
	const secrets = await SiriusSecretStore.create(context);

	// ─── Core: Model Router ──────────────────────────────────────────────
	modelRouter = new ModelRouter(secrets);

	// ─── Language Models ─────────────────────────────────────────────────
	// Registering as a language-model vendor is what lets the editor's own chat,
	// agent mode, inline chat and MCP tooling drive every provider Sirius can
	// reach, instead of that work living in a bespoke panel.
	const lmProvider = new SiriusLanguageModelProvider(modelRouter);
	context.subscriptions.push(
		vscode.lm.registerLanguageModelChatProvider(SIRIUS_VENDOR, lmProvider)
	);
	context.subscriptions.push(lmProvider);

	// A newly added key unlocks a provider's models, so re-advertise immediately
	// rather than making the user reload the window.
	context.subscriptions.push(secrets.onDidChange(() => lmProvider.refresh()));

	// Warm the editor's model registry immediately. The panel resolves its
	// "Auto" selection against models registered at that instant — on a fresh
	// window a request can beat discovery, and the resolution then fails with
	// "Language model unavailable" before any handler runs.
	void vscode.lm.selectChatModels({ vendor: SIRIUS_VENDOR }).then(undefined, () => { });

	// ─── Agent Tools ─────────────────────────────────────────────────────
	// Removing Copilot took 39 tools with it, and the workbench registers only
	// two of its own, so without these the editor's agent mode can reason but
	// cannot read, edit, search or run anything.
	registerSiriusTools(context, new SiriusToolExecutor());

	// ─── SCM Assistance ──────────────────────────────────────────────────
	// Fills the product.json hooks the workbench already renders buttons for:
	// the commit-message sparkle and the resolve-merge-conflicts action.
	registerGitAssist(context);

	// ─── The Default Chat Agent ──────────────────────────────────────────
	// The panel's ask/edit/agent modes are served by the product's default
	// participant — the role Copilot Chat plays upstream. Without it, the
	// workbench's setup placeholder intercepts every request demanding a
	// GitHub sign-in, and the model picker stays an inert "Auto".
	registerSiriusAgent(context);

	// ─── Import from Another Editor ──────────────────────────────────────
	registerEditorImporter(context);
	registerProjectContextDebug(context);

	// ─── Inline Chat (Ctrl+I) ────────────────────────────────────────────
	const inlineChat = new SiriusInlineChatProvider();
	inlineChat.register(context);

	// ─── Commands ────────────────────────────────────────────────────────

	// Open chat
	context.subscriptions.push(
		vscode.commands.registerCommand('sirius.ai.openChat', () => {
			vscode.commands.executeCommand('workbench.action.chat.open');
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

	// ─── Context Menu Commands ───────────────────────────────────────────
	// These seed the editor's own chat rather than a Sirius-specific panel, so
	// the reply lands somewhere the user can keep working in — with edits,
	// checkpoints and tools attached.

	const selectionPrompts: Record<string, string> = {
		'sirius.ai.explainSelection': 'Explain this code',
		'sirius.ai.fixErrors': 'Find and fix the problems in this code',
		'sirius.ai.writeTests': 'Write tests for this code',
		'sirius.ai.refactor': 'Refactor this code, explaining what you changed and why'
	};

	for (const [command, instruction] of Object.entries(selectionPrompts)) {
		context.subscriptions.push(
			vscode.commands.registerCommand(command, async () => {
				const editor = vscode.window.activeTextEditor;
				if (!editor) {
					return;
				}

				const selection = editor.document.getText(editor.selection);
				const language = editor.document.languageId;
				const query = selection
					? `${instruction}:\n\n\`\`\`${language}\n${selection}\n\`\`\``
					: instruction;

				await vscode.commands.executeCommand('workbench.action.chat.open', { query });
			})
		);
	}

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
