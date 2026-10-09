/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — AI Extension Entry Point
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PROVIDER_LABELS, SiriusSecretStore } from './auth/secretStore';
import { migrateKeysToLanguageModels } from './auth/migrateToLanguageModels';
import { MANAGE_MODELS_COMMAND, ModelRouter } from './providers/modelRouter';
import { SiriusLanguageModelProvider } from './lm/languageModelProvider';
import { LOCAL_PROVIDERS, PROVIDER_ORDER, knownModel, lastConnection, providerOf, siriusModels } from './lm/vendors';
import { selectDefaultModel } from './lm/defaultModel';
import { registerSiriusTools } from './lm/toolRegistration';
import { registerGitAssist } from './scm/gitAssist';
import { debug, registerSiriusAgent } from './chat/siriusAgent';
import { registerEditorImporter } from './importer/editorImporter';
import { registerProjectContextDebug } from './chat/projectContext';
import { SiriusToolExecutor } from './tools/toolExecutor';
import { SiriusInlineChatProvider } from './inline/inlineChatProvider';
import { resolveFimBackend } from './inline/fimClient';

/** `contributes.walkthroughs` in package.json, addressed as `<publisher>.<name>#<id>`. */
const WALKTHROUGH_ID = 'sirius.sirius-ai#gettingStarted';

let modelRouter: ModelRouter;

export async function activate(context: vscode.ExtensionContext) {
	console.log('★ Sirius AI is activating...');

	// ─── Core: Credentials ───────────────────────────────────────────────
	// Keys earlier versions kept — in settings.json, then under Sirius's own
	// keyring entries — are swept into the editor's Language Models below.
	const secrets = await SiriusSecretStore.create(context);

	// ─── Core: Model Router ──────────────────────────────────────────────
	modelRouter = new ModelRouter();

	// ─── Language Models ─────────────────────────────────────────────────
	// One language-model vendor per provider. That is what lets the editor's own
	// chat, agent mode, inline chat and MCP tooling drive every provider Sirius
	// can reach — and what the editor's Language Models editor is built around:
	// each provider is added there with its key (kept in the system keyring),
	// can be added again for another endpoint, shows a red row when it fails,
	// and its models can be hidden.
	const lmProviders = PROVIDER_ORDER.map(provider => new SiriusLanguageModelProvider(modelRouter, provider));
	for (const lmProvider of lmProviders) {
		context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(lmProvider.vendor, lmProvider), lmProvider);
	}

	void migrateKeysToLanguageModels(secrets, debug).then(moved => {
		if (moved.length > 0) {
			const manage = 'Manage Models';
			vscode.window.showInformationMessage(
				`Your ${moved.join(', ')} ${moved.length === 1 ? 'key is' : 'keys are'} now in the editor's Language Models — still in the system keyring. Change or remove ${moved.length === 1 ? 'it' : 'them'} there.`,
				manage
			).then(choice => choice === manage ? vscode.commands.executeCommand(MANAGE_MODELS_COMMAND) : undefined);
		}
	}, error => debug(`[migrate] ${error}`));

	// A local server's usual endpoint, and the default model, are settings:
	// re-advertise when they change instead of waiting for a reload.
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
		for (const lmProvider of lmProviders) {
			const local = LOCAL_PROVIDERS.has(lmProvider.providerId) && event.affectsConfiguration(`sirius.ai.${lmProvider.providerId}`);
			if (local || event.affectsConfiguration('sirius.ai.defaultProvider') || event.affectsConfiguration('sirius.ai.defaultModel')) {
				lmProvider.refresh();
			}
		}
	}));

	// Warm the editor's model registry, so the first request does not race discovery.
	void siriusModels().then(undefined, () => { });

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
	// Tab completion talks to llama.cpp outside the chat path; its optional key is
	// the configured llama.cpp's.
	const llamaKey = () => lastConnection('llamacpp')?.apiKey ?? secrets.get('llamacpp');
	const inlineChat = new SiriusInlineChatProvider(llamaKey);
	inlineChat.register(context);

	// ─── Commands ────────────────────────────────────────────────────────

	// Open chat
	context.subscriptions.push(
		vscode.commands.registerCommand('sirius.ai.openChat', () => {
			vscode.commands.executeCommand('workbench.action.chat.open');
		})
	);

	// Manage Models — the editor's Language Models editor, where providers are added
	context.subscriptions.push(
		vscode.commands.registerCommand('sirius.ai.manageModels', () => vscode.commands.executeCommand(MANAGE_MODELS_COMMAND))
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

	// Turn on Tab completion. `sirius.ai.enable` is a per-language object, which
	// the Settings editor can only hand over as raw JSON — so the walkthrough's
	// button lands here, and the user learns at once whether a backend exists.
	context.subscriptions.push(
		vscode.commands.registerCommand('sirius.ai.enableTabCompletion', async () => {
			const config = vscode.workspace.getConfiguration('sirius.ai');
			const current = config.inspect<Record<string, boolean>>('enable')?.globalValue ?? {};
			await config.update('enable', { ...current, '*': true }, vscode.ConfigurationTarget.Global);

			const backend = await resolveFimBackend(llamaKey);
			if (backend) {
				vscode.window.showInformationMessage(`Tab completion is on, using ${backend.id}.`);
				return;
			}
			const learnMore = 'Learn More';
			const choice = await vscode.window.showWarningMessage(
				'Tab completion is on, but no local code model is running yet. Start Ollama with a coder model, or llama-server, and Sirius picks it up.',
				learnMore
			);
			if (choice === learnMore) {
				vscode.env.openExternal(vscode.Uri.parse('https://siriuside.com/docs/tab-and-next-edit/'));
			}
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

	// The model a request with no explicit choice uses — the same rule as commit
	// messages (lm/defaultModel.ts), so it never names a model nothing will use. It
	// named Claude Opus 5, unconfigured, whenever the default was a local model.
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
	statusBarItem.command = 'sirius.ai.selectModel';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);
	const updateStatus = async () => {
		const model = await selectDefaultModel();
		if (!model) {
			statusBarItem.text = '$(star-full) No model';
			statusBarItem.tooltip = 'Sirius AI — no model yet. Add a provider in Manage Models, or start Ollama.';
			return;
		}
		const thinking = modelRouter.getThinkingConfig();
		const provider = providerOf(model.vendor);
		statusBarItem.text = `$(star-full) ${model.name}${thinking.enabled && knownModel(model)?.supportsThinking ? ' 🧠' : ''}`;
		statusBarItem.tooltip = `Sirius AI — ${model.name}${provider ? `, ${PROVIDER_LABELS[provider]}` : ''}. Click to change.`;
	};
	void updateStatus();
	context.subscriptions.push(
		vscode.lm.onDidChangeChatModels(() => void updateStatus()),
		modelRouter.onModelChanged(() => void updateStatus()),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('sirius.ai.defaultProvider') || event.affectsConfiguration('sirius.ai.defaultModel') || event.affectsConfiguration('sirius.ai.thinking')) {
				void updateStatus();
			}
		})
	);

	// ─── Welcome ─────────────────────────────────────────────────────────
	// A built-in extension's walkthrough never opens by itself — upstream only
	// auto-opens walkthroughs of extensions installed at runtime — so open it
	// once, for new and existing users alike. In front when the window has no
	// editors (a first start); behind the restored editors otherwise.

	if (!context.globalState.get('sirius.ai.walkthroughShown', false)) {
		await context.globalState.update('sirius.ai.walkthroughShown', true);
		const inactive = vscode.window.visibleTextEditors.length > 0;
		vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH_ID, { inactive }).then(undefined, () => {
			vscode.window.showInformationMessage(
				'★ Sirius AI — add a provider key, or start Ollama and Sirius finds your models.',
				'Set API Key'
			).then(selection => {
				if (selection === 'Set API Key') {
					modelRouter.setApiKey();
				}
			});
		});
	}

	console.log('★ Sirius AI v2 activated successfully!');
}

export function deactivate() {
	modelRouter?.dispose();
	console.log('★ Sirius AI deactivated.');
}
