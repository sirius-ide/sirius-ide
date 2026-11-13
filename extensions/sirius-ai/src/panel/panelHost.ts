/*---------------------------------------------------------------------------------------------
 *  Sirius — the panel: Sirius's own chat in VS Code
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { type AgentToolCall, runAgent } from '../agent/core';
import type { ImagePart, ProviderType, ThinkingBlock, ThinkingConfig } from '../types';
import { ModelRouter } from '../providers/modelRouter';
import { ModelCatalog } from './models';
import { panelFace } from './panelFace';
import { EDITS, EFFORTS, MODES, type Approval, type Decision, type Edits, type Effort, type Mode, type PanelState, type SendWith, type ToHost, type ToWebview, type TurnView, type View, toHost } from './protocol';
import { SessionStore, type StoredSession, type StoredTurn, newId, titleOf, turnView } from './sessions';
import { answered, buildHistory } from './history';
import { PanelTools, UNSEEN } from './tools';
import { ARM_MS, CHANGE_SCHEME, Diffs, PROPOSAL_SCHEME, apply, blockFor, proposeCode } from './edits';
import { Kept } from './kept';
import { EditorTracker, ImageStore, carry, findFiles } from './context';
import { resolveWorkspacePath } from '../tools/workspacePath';
import type { LocalServers } from '../vscode/completions';
import type { CommitModel } from '../vscode/commitMessage';
import * as nodePath from 'path';

export const VIEW_ID = 'sirius.panel';
export const TAB_TYPE = 'sirius.chat';

const MODEL = 'sirius.panel.model';
const MODE = 'sirius.panel.mode';
const EFFORT = 'sirius.panel.effort';
const EDITS_KEY = 'sirius.panel.edits';
/** How many of a conversation's latest questions with pictures send them again: older ones are named, not sent. */
const RESENT_PICTURES = 2;
/** Where a window with no folder keeps its pictures, in the extension's shared storage. */
const IMAGES_FOLDER = 'sirius.panel.imagesFolder';
const LAST_SESSION = 'sirius.panel.lastSession';
const SEND_WITH = 'sirius.panel.sendWith';
/** Set while some model can be asked; the walkthrough's "Add a model" step completes on it. */
const MODEL_AVAILABLE = 'sirius.panel.modelAvailable';
/** Set once a question was sent; the walkthrough's "Ask, Edit or Agent" step completes on it. */
const ASKED = 'sirius.panel.asked';
/** How old the list of models may be when the panel is shown again before it is looked for anew: a server started since is found. */
const STALE_MODELS_MS = 60_000;
/** A commit message's model is told no more than its job; the prompt says the rest. */
const COMMIT_PROMPT = 'You write git commit messages.';

const PROMPT =
	'You are Sirius, an AI engineer working inside the user\'s VS Code. Answer directly and concisely in markdown, ' +
	'with code in fenced blocks that name their language. When you are unsure, say so. ' +
	'Use tools only when the task needs them; call them through the tool-calling mechanism, never as JSON in your text.';
const MODE_RULES: Record<Mode, string> = {
	ask: 'You are in Ask mode: explain and answer. You can read and search the workspace with your tools, but not change it — when a change is needed, describe it; the user can switch to Edit or Agent mode.',
	edit: 'You are in Edit mode: read the workspace with your tools and change files with sirius_edit_file and sirius_create_file. You cannot run commands here.',
	agent: 'You are in Agent mode: work through the task step by step with your tools; change files with sirius_edit_file and sirius_create_file. Tools from MCP servers and other extensions run only once the user allows them; if the user declines one, carry on without it.'
};
/** How changes to files are taken, said in both modes that make them. */
const EDIT_RULE = 'The user reviews each change to a file before it is applied, unless they chose to accept changes as they come; each tool result says whether the change was applied. When a change is rejected, do not make it again.';

/** One webview showing the panel: the side panel, or a tab. */
interface Client {
	readonly webview: vscode.Webview;
	sessionId: string;
	view: View;
}

interface Running {
	readonly controller: AbortController;
	readonly turn: StoredTurn;
	readonly session: StoredSession;
}

export class PanelHost implements vscode.WebviewViewProvider, vscode.WebviewPanelSerializer, vscode.Disposable {
	private readonly clients = new Set<Client>();
	private readonly running = new Map<string, Running>();
	private readonly sessions: SessionStore;
	private readonly catalog: ModelCatalog;
	/** The mode, model, effort and edits chosen: global state, as this window wrote it (kept.ts). */
	private readonly choices: Kept;
	private readonly output = vscode.window.createOutputChannel('Sirius');
	private refreshing: Promise<void> | undefined;
	/** A look asked for while one was under way: that one may have read the keyring before a key just saved. */
	private refreshAgain = false;
	private refreshedAt = 0;
	/** Whether a webview of the panel was ever shown in this window: its first sweeps the pictures. */
	private used = false;
	private readonly serversChanged = new vscode.EventEmitter<void>();
	/** Ollama's or llama.cpp's address or key changed, here or in another window: Tab completion looks again. */
	readonly onDidChangeServers = this.serversChanged.event;
	/** Where Tab completion finds the local servers: as Models and Keys has them. */
	readonly servers: LocalServers = {
		ollama: () => this.catalog.address('ollama'),
		llamacpp: () => this.catalog.address('llamacpp'),
		llamacppSaved: () => this.catalog.saved('llamacpp'),
		llamaKey: async () => await this.catalog.key('llamacpp') ?? ''
	};
	/**
	 * A commit message's model: the one chosen here — never another in its place, as the diff is the
	 * user's code — or, when none was ever chosen, the one a question would go to. Looked for first
	 * when none has been yet. A model gone quiet says so, by name.
	 */
	readonly commitModel: CommitModel = {
		ask: async () => {
			const chosen = this.choices.get<string>(MODEL);
			if (!this.refreshedAt || !(chosen ? this.catalog.reachable(chosen) : this._model)) {
				await this.refreshModels(false);
			}
			const key = chosen ?? this._model;
			const reachable = key ? this.catalog.reachable(key) : undefined;
			if (!reachable) {
				return chosen ? `The model chosen in Sirius (${chosen}) does not answer now: open Models and Keys, or choose another in the panel.` : undefined;
			}
			this.output.appendLine(`[panel] a commit message from ${key}`);
			return async (prompt, signal) => {
				let text = '';
				let failure: string | undefined;
				const messages = [{ role: 'user' as const, content: prompt, timestamp: Date.now() }];
				for await (const chunk of new ModelRouter().chatWithModel(reachable.provider, reachable.model, messages, undefined, signal, { systemPrompt: COMMIT_PROMPT, thinking: { enabled: false, effort: 'high' } })) {
					// The providers report a failure as a last chunk of text behind a warning sign — after
					// part of an answer, when a stream breaks — not always marked as an error.
					if (chunk.stopReason === 'error' || (chunk.done && /^\s*⚠️/.test(chunk.content ?? ''))) {
						failure = (chunk.content ?? '').replace(/^\s*⚠️\s*/, '').replace(/\*\*/g, '').trim() || 'the model failed';
					} else {
						text += chunk.content ?? '';
					}
				}
				// A stopped request just ends: what came before it is not a commit message either.
				if (signal.aborted) {
					throw new Error((signal.reason as { name?: unknown } | undefined)?.name === 'TimeoutError' ? 'the model did not answer in time' : 'stopped');
				}
				if (failure) {
					throw new Error(failure);
				}
				if (!text.trim()) {
					throw new Error('the model gave no message');
				}
				return text;
			};
		}
	};
	private viewClient: Client | undefined;
	/**
	 * What a command asked of the side panel before it existed: VS Code resolves a view only
	 * after focusing it, so Models and Keys or a new conversation waits here for it.
	 */
	private pending: { view?: View; fresh?: boolean } = {};
	private asked = false;
	/** Calls waiting for the user's yes or no, by `<session>:<card>`. */
	private readonly approvals = new Map<string, (choice: Approval | 'stop') => void>();
	/** Tools the user allowed for a conversation, by conversation; kept until the window closes. */
	private readonly allowed = new Map<string, Set<string>>();
	/** Conversations deleted while they answered: the answer, ending, must not save them again. */
	private readonly deleted = new Set<string>();
	/** Proposed changes waiting for the user's Accept or Reject, by card. */
	private readonly decisions = new Map<string, { readonly session: string; decide(choice: Decision | 'stop'): void }>();
	/** The text editor the user last worked in, for the composer's chips and what a question carries. */
	private readonly editor: EditorTracker;
	/** Files the user chose in VS Code's file picker, by the ids given to the webview that asked; spent when sent. */
	private readonly picked = new Map<string, { readonly client: Client; readonly uri: vscode.Uri; readonly label: string }>();
	/** The pictures questions carried, as files of their own. */
	private picturesStore: ImageStore | undefined;
	/** Conversations whose question is being put together: a second one waits for it. */
	private readonly preparing = new Set<string>();
	/** Code blocks applied and waiting in the diff editor: closing the diff leaves the change. */
	private readonly applying = new Set<string>();
	/** Pictures stored for a question not yet in a saved conversation: a sweep keeps them. */
	private readonly unsaved = new Set<string>();
	private sweeping: Promise<void> = Promise.resolve();
	/** The changes the diff editor can show; those still waiting are kept whatever their size. */
	private readonly diffs = new Diffs(id => this.decisions.has(id));

	constructor(private readonly context: vscode.ExtensionContext) {
		this.sessions = new SessionStore(context.workspaceState);
		this.choices = new Kept(context.globalState);
		this.editor = new EditorTracker(editor => {
			for (const client of this.clients) {
				this._post(client, { type: 'editor', ...(editor ? { editor } : {}) });
			}
		});
		this.catalog = new ModelCatalog(context.secrets, context.globalState, new ModelRouter());
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration(event => {
				if (event.affectsConfiguration(SEND_WITH)) {
					this._broadcast();
				}
			}),
			vscode.workspace.registerTextDocumentContentProvider(PROPOSAL_SCHEME, this.diffs),
			// A code block's proposal whose diff the user closed is left, as a rejection would.
			vscode.window.tabGroups.onDidChangeTabs(event => {
				for (const tab of event.closed) {
					const id = tab.input instanceof vscode.TabInputTextDiff ? this.diffs.idOf(tab.input.modified) : undefined;
					if (id && this.applying.has(id) && !this.diffs.shown(id)) {
						vscode.window.setStatusBarMessage('Sirius: the code was not applied — its diff was closed.', 5000);
						this.decisions.get(id)?.decide('reject');
					}
				}
			}),
			vscode.workspace.registerTextDocumentContentProvider(CHANGE_SCHEME, this.diffs)
		);
		context.subscriptions.push(context.secrets.onDidChange(event => {
			if (event.key === ModelCatalog.keyName('llamacpp')) {
				this.serversChanged.fire();
			}
		}));
		// The first look for models waits for the panel, or a commit message, to need them: Sirius
		// starts with the window for Tab completion, and asks no vendor anything until then.
	}

	/**
	 * The pictures questions carried, made when the panel is first used (Sirius starts with every
	 * window). A window with no folder has no storage of its own: its pictures get a folder of their
	 * own in the shared one, or one such window's sweep would delete another's.
	 */
	private get images(): ImageStore {
		if (!this.picturesStore) {
			let windowFolder = this.context.workspaceState.get<string>(IMAGES_FOLDER);
			if (!this.context.storageUri && !windowFolder) {
				windowFolder = newId();
				void this.context.workspaceState.update(IMAGES_FOLDER, windowFolder);
			}
			this.picturesStore = new ImageStore(this.context.storageUri ? vscode.Uri.joinPath(this.context.storageUri, 'panel-images') : vscode.Uri.joinPath(this.context.globalStorageUri, 'panel-images', windowFolder!));
		}
		return this.picturesStore;
	}

	dispose(): void {
		this.serversChanged.dispose();
		for (const { controller } of this.running.values()) {
			controller.abort();
		}
		this.editor.dispose();
		this.output.dispose();
	}

	// ─── Webviews ────────────────────────────────────────────────────────────

	resolveWebviewView(view: vscode.WebviewView): void {
		const { view: wanted, fresh } = this.pending;
		this.pending = {};
		const client = this._attach(view.webview, fresh ? undefined : this.context.workspaceState.get<string>(LAST_SESSION), wanted);
		this.viewClient = client;
		view.onDidDispose(() => {
			this._detach(client);
			// The view moved to another place: the new one may already have resolved.
			if (this.viewClient === client) {
				this.viewClient = undefined;
			}
		});
		view.onDidChangeVisibility(() => view.visible && this._refreshIfStale());
	}

	async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
		const sessionId = (state as { sessionId?: unknown } | undefined)?.sessionId;
		this._adopt(panel, typeof sessionId === 'string' ? sessionId : undefined);
	}

	/** A new tab with a new conversation. */
	openInTab(): void {
		const panel = vscode.window.createWebviewPanel(TAB_TYPE, 'Sirius', vscode.ViewColumn.Active, this._options(true));
		this._adopt(panel, undefined);
	}

	async newConversation(): Promise<void> {
		const client = this.viewClient;
		if (client) {
			this._open(client, undefined);
			// Asked for from the Command Palette, with the side bar closed: shown, not changed out of sight.
			await this._focusView();
		} else {
			this.pending = { ...this.pending, fresh: true };
			await this._focusView();
		}
	}

	async showSetup(): Promise<void> {
		if (!this.viewClient) {
			this.pending = { ...this.pending, view: 'setup' };
		}
		await this._focusView();
		if (this.viewClient) {
			this.viewClient.view = 'setup';
			this._post(this.viewClient, { type: 'state', state: this._state(this.viewClient) });
		}
	}

	/** Shows the side panel; what was asked of it is dropped if it cannot be shown. */
	private async _focusView(): Promise<void> {
		try {
			await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
		} catch (error) {
			this.pending = {};
			throw error;
		}
	}

	private _adopt(panel: vscode.WebviewPanel, sessionId: string | undefined): void {
		panel.webview.options = this._options(false);
		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sirius.svg');
		const client = this._attach(panel.webview, sessionId);
		panel.onDidDispose(() => this._detach(client));
		panel.onDidChangeViewState(event => event.webviewPanel.visible && this._refreshIfStale());
	}

	/** A webview is gone: so are the files picked in it and not sent. */
	private _detach(client: Client): void {
		this.clients.delete(client);
		for (const [id, entry] of this.picked) {
			if (entry.client === client) {
				this.picked.delete(id);
			}
		}
	}

	private _options(retain: boolean): vscode.WebviewPanelOptions & vscode.WebviewOptions {
		return {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist'), vscode.Uri.joinPath(this.context.extensionUri, 'media')],
			...(retain ? { retainContextWhenHidden: true } : {})
		};
	}

	private _attach(webview: vscode.Webview, sessionId: string | undefined, view: View = 'chat'): Client {
		webview.options = this._options(false);
		const client: Client = { webview, sessionId: sessionId && this.sessions.get(sessionId) ? sessionId : newId(), view };
		this.clients.add(client);
		if (!this.used) {
			// The panel's first use in this window: the models (unless a commit message looked already),
			// and a sweep of pictures no conversation names.
			this.used = true;
			if (!this.refreshedAt && !this.refreshing) {
				void this.refreshModels();
			}
			void this._sweepImages();
		}
		webview.onDidReceiveMessage(raw => this._receive(client, raw));
		webview.html = this._html(webview);
		return client;
	}

	private _html(webview: vscode.Webview): string {
		const nonce = randomBytes(16).toString('base64');
		const asset = (...path: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...path));
		// `default-src` does not cover where a form may post or what a <base> may point at.
		const csp = [
			`default-src 'none'`,
			`script-src 'nonce-${nonce}'`,
			`style-src ${webview.cspSource}`,
			`font-src ${webview.cspSource}`,
			`img-src ${webview.cspSource} data:`,
			`form-action 'none'`,
			`base-uri 'none'`
		].join('; ');
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('media', 'codicons', 'codicon.css')}">
<link rel="stylesheet" href="${asset('media', 'panel.css')}">
<title>Sirius</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${asset('dist', 'panel.js')}"></script>
</body>
</html>`;
	}

	// ─── Messages ────────────────────────────────────────────────────────────

	private _post(client: Client, message: ToWebview): void {
		void client.webview.postMessage(message);
	}

	/** Every webview showing `sessionId`. */
	private _showing(sessionId: string): Client[] {
		return [...this.clients].filter(c => c.sessionId === sessionId);
	}

	private _broadcast(sessionId?: string): void {
		for (const client of this.clients) {
			if (!sessionId || client.sessionId === sessionId || client.view === 'sessions') {
				this._post(client, { type: 'state', state: this._state(client) });
			}
		}
	}

	private async _receive(client: Client, raw: unknown): Promise<void> {
		const message = toHost(raw);
		if (!message) {
			return;
		}
		// What the panel was asked, for a bug report: the choices and each question's arrival, never their text.
		if (message.type === 'setMode' || message.type === 'setEffort' || message.type === 'setEdits' || message.type === 'setModel' || message.type === 'send') {
			const choice = message.type === 'setMode' ? message.mode : message.type === 'setEffort' ? message.effort : message.type === 'setEdits' ? message.edits : message.type === 'setModel' ? message.key : '';
			this.output.appendLine(`[panel] ${message.type} ${choice} (${client === this.viewClient ? 'side panel' : 'tab'})`.trimEnd());
		}
		switch (message.type) {
			case 'ready':
				break;
			case 'send':
				await this._send(client, message);
				return;
			case 'insertCode':
				await this._insertCode(message.code);
				return;
			case 'applyCode':
				await this._applyCode(client, message.code);
				return;
			case 'searchFiles':
				this._post(client, { type: 'files', requestId: message.requestId, files: await findFiles(message.query) });
				return;
			case 'attach': {
				const chosen = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: 'Attach', defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri });
				const files = (chosen ?? []).map(uri => {
					const id = newId();
					// A file outside the workspace goes by its name alone: its folder would tell a vendor the user's home.
					const label = vscode.workspace.getWorkspaceFolder(uri) ? vscode.workspace.asRelativePath(uri) : nodePath.basename(uri.path);
					this.picked.set(id, { client, uri, label });
					return { id, label };
				});
				if (files.length) {
					this._post(client, { type: 'attached', files });
				}
				return;
			}
			case 'stop':
				this.running.get(client.sessionId)?.controller.abort();
				return;
			case 'approve':
				this.approvals.get(`${client.sessionId}:${message.callId}`)?.(message.choice);
				return;
			case 'decide': {
				const waiting = this.decisions.get(message.callId);
				if (waiting?.session === client.sessionId) {
					waiting.decide(message.choice);
				}
				return;
			}
			case 'decideAll':
				// In the cards' order, so the changes apply in the order the model asked for them. A file that
				// can run code is accepted only on its own card.
				for (const tool of this.running.get(client.sessionId)?.turn.tools ?? []) {
					if (tool.edit?.batch === message.batch && !(message.choice === 'accept' && tool.edit.guarded)) {
						this.decisions.get(tool.id)?.decide(message.choice);
					}
				}
				return;
			case 'showDiff':
				if (this._cards(client.sessionId).some(tool => tool.id === message.callId) && !await this.diffs.show(message.callId, this.decisions.has(message.callId))) {
					// Let go to make room: the card stops offering it.
					this._broadcast(client.sessionId);
				}
				return;
			case 'setEdits':
				await this.choices.update(EDITS_KEY, message.edits);
				this._broadcast();
				return;
			case 'retry':
				await this._retry(client);
				return;
			case 'newSession':
				this._open(client, undefined);
				return;
			case 'openSession':
				this._open(client, message.id);
				return;
			case 'deleteSession':
				this.deleted.add(message.id);
				this.running.get(message.id)?.controller.abort();
				await this.sessions.delete(message.id);
				void this._sweepImages();
				for (const other of this._showing(message.id)) {
					other.sessionId = newId();
				}
				this._broadcast();
				return;
			case 'setModel':
				if (this.catalog.reachable(message.key)) {
					await this.choices.update(MODEL, message.key);
				}
				this._broadcast();
				return;
			case 'setMode':
				await this.choices.update(MODE, message.mode);
				this._broadcast();
				return;
			case 'setEffort':
				await this.choices.update(EFFORT, message.effort);
				this._broadcast();
				return;
			case 'setView':
				client.view = message.view;
				break;
			case 'saveKey':
			case 'clearKey':
			case 'saveUrl':
				if (this.catalog.isProvider(message.provider)) {
					const provider: ProviderType = message.provider;
					if (message.type === 'saveKey') {
						await this.catalog.setKey(provider, message.key);
					} else if (message.type === 'clearKey') {
						await this.catalog.clearKey(provider);
					} else {
						await this.catalog.setUrl(provider, message.url);
					}
					if (provider === 'ollama' || provider === 'llamacpp') {
						this.serversChanged.fire();
					}
					await this.refreshModels();
				}
				return;
			case 'refreshModels':
				await this.refreshModels();
				return;
			case 'openLink':
				if (/^https?:\/\//i.test(message.href)) {
					await vscode.env.openExternal(vscode.Uri.parse(message.href));
				} else {
					await this._openFileLink(message.href);
				}
				return;
			case 'copy':
				await vscode.env.clipboard.writeText(message.text);
				return;
		}
		this._post(client, { type: 'state', state: this._state(client) });
	}

	/**
	 * Accept or Reject from the diff editor's title bar: on the change it shows — unless that change
	 * took the place of a decided one a moment ago, when the click was meant for the one before.
	 */
	decideInEditor(target: unknown, choice: Decision): void {
		const id = target instanceof vscode.Uri ? this.diffs.idOf(target) : this.diffs.activeId();
		if (id && !this.diffs.shownWithin(id, ARM_MS)) {
			this.decisions.get(id)?.decide(choice);
		}
	}

	/** The pictures of the last RESENT_PICTURES questions that carried any, read for the model: earlier ones are not sent again. */
	private async _recentImages(turns: readonly StoredTurn[]): Promise<Map<string, ImagePart[]>> {
		const recent = new Map<string, ImagePart[]>();
		for (const turn of [...turns].reverse()) {
			if (recent.size >= RESENT_PICTURES) {
				break;
			}
			if (turn.role === 'user' && turn.images?.length) {
				recent.set(turn.id, (await Promise.all(turn.images.map(image => this.images.get(image)))).filter((image): image is ImagePart => !!image));
			}
		}
		return recent;
	}

	/** Deletes the pictures no kept conversation names; one sweep at a time. */
	private _sweepImages(): Promise<void> {
		this.sweeping = this.sweeping.then(() => this._sweep(), () => this._sweep());
		return this.sweeping;
	}

	private async _sweep(): Promise<void> {
		// Asked afresh for each picture: a question may be stored, or answered and saved, while the sweep goes.
		const named = (ref: string): boolean => this.unsaved.has(ref)
			|| [...this.running.values()].some(running => running.session.turns.some(turn => turn.images?.some(image => image.ref === ref)))
			|| this.sessions.list().some(summary => this.sessions.get(summary.id)?.turns.some(turn => turn.images?.some(image => image.ref === ref)));
		await this.images.sweep(named);
	}

	/** A code block's Insert: in place of the selection, or at the cursor, of the file last worked in — an edit Undo takes back. */
	private async _insertCode(code: string): Promise<void> {
		const current = this.editor.current;
		if (!current) {
			void vscode.window.showInformationMessage('Open a file and put the cursor where the code goes, then Insert again.');
			return;
		}
		if (current.moved) {
			void vscode.window.showInformationMessage('The file changed since you left it: put the cursor where the code goes again, then Insert.');
			return;
		}
		// Unseen characters would go into the file unreviewed: Apply's diff shows them.
		const unseen = code.match(UNSEEN)?.length ?? 0;
		if (unseen) {
			void vscode.window.showWarningMessage(`The code holds ${unseen} invisible or direction-changing character${unseen === 1 ? '' : 's'}. Use Apply to review it in the diff editor first.`);
			return;
		}
		const { document, selection } = current;
		const text = blockFor(document, selection, code);
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, selection, text);
		if (!await vscode.workspace.applyEdit(edit)) {
			void vscode.window.showWarningMessage(`The code could not be inserted into ${vscode.workspace.asRelativePath(document.uri)}.`);
			return;
		}
		// Shown where it is, the cursor after what went in: in its visible editor — a diff's side
		// included — or its tab's group.
		const end = document.positionAt(document.offsetAt(selection.start) + text.length);
		if (current.editor) {
			current.editor.selection = new vscode.Selection(end, end);
			current.editor.revealRange(new vscode.Range(end, end));
			return;
		}
		const column = vscode.window.tabGroups.all.find(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === document.uri.toString()))?.viewColumn;
		await vscode.window.showTextDocument(document, { selection: new vscode.Range(end, end), preview: false, ...(column ? { viewColumn: column } : {}) });
	}

	/**
	 * A code block's Apply: proposed for the file last worked in — in place of the selection, or of
	 * the whole file — and reviewed as a change is, in the diff editor: Accept Change applies it to
	 * the file as it is then and saves it; Reject Change, or closing the diff, leaves it.
	 */
	private async _applyCode(client: Client, code: string): Promise<void> {
		const current = this.editor.current;
		if (!current) {
			void vscode.window.showInformationMessage('Open the file the code is for and select what it replaces — or put the cursor where it goes — then Apply again.');
			return;
		}
		if (current.moved) {
			void vscode.window.showInformationMessage('The file changed since you left it: select what the code replaces again, then Apply.');
			return;
		}
		const made = await proposeCode(current.document, current.selection, code);
		if (typeof made === 'string') {
			void vscode.window.showInformationMessage(made);
			return;
		}
		const id = newId();
		this.diffs.keep(id, made);
		this.applying.add(id);
		this.decisions.set(id, {
			session: client.sessionId,
			decide: choice => {
				if (!this.decisions.delete(id)) {
					return;
				}
				this.applying.delete(id);
				void this.diffs.close(id);
				if (choice === 'accept') {
					void apply(made).then(outcome => {
						if (outcome.ok) {
							vscode.window.setStatusBarMessage(`Sirius: ${outcome.text}`, 5000);
						} else {
							void vscode.window.showWarningMessage(`The code was not applied to ${made.path}: the file changed after it was proposed, or could not be written. Apply it again.`);
						}
					}, error => void vscode.window.showWarningMessage(`The code could not be applied: ${error instanceof Error ? error.message : String(error)}`));
				}
			}
		});
		// Not a preview: opening another file must not close it, and with it the proposal.
		await this.diffs.show(id, true, false);
	}

	/** Every card of a conversation, its answer in progress included. */
	private _cards(sessionId: string) {
		return [...(this.running.get(sessionId)?.turn.tools ?? []), ...(this.sessions.get(sessionId)?.turns ?? []).flatMap(turn => turn.tools ?? [])];
	}

	/**
	 * Asks every provider what it offers now, showing "Checking…" meanwhile. Asked again while a look
	 * is under way, another follows it — the first may have read the keyring before a key just saved —
	 * unless `again` is false: a question with no model waits for the look under way, not for two.
	 */
	async refreshModels(again = true): Promise<void> {
		if (this.refreshing) {
			this.refreshAgain ||= again;
			await this.refreshing;
			return;
		}
		this.refreshing = this._lookForModels();
		this._broadcast();
		await this.refreshing;
		void vscode.commands.executeCommand('setContext', MODEL_AVAILABLE, this.catalog.models.length > 0);
		this._broadcast();
	}

	private async _lookForModels(): Promise<void> {
		try {
			do {
				this.refreshAgain = false;
				try {
					await this.catalog.refresh();
				} catch (error) {
					this.output.appendLine(`[panel] looking for models failed: ${error instanceof Error ? error.message : String(error)}`);
				}
				this.refreshedAt = Date.now();
			} while (this.refreshAgain);
		} finally {
			this.refreshing = undefined;
		}
	}

	/**
	 * Shown again with no model found, the panel looks again: a server started since is found. With
	 * models it does not — a look that missed the chosen one would put the next question on another.
	 */
	private _refreshIfStale(): void {
		if (!this.refreshing && !this.catalog.models.length && Date.now() - this.refreshedAt > STALE_MODELS_MS) {
			void this.refreshModels();
		}
	}

	/**
	 * A link in an answer that names a file of the workspace — `src/app.ts`, `src/app.ts#L12`,
	 * `src/app.ts#L12-L20`, or its absolute path — opens it there; a folder is shown in the Explorer;
	 * anything else gets a word in the status bar. (The page keeps no other scheme's link but http(s)
	 * and mailto:, which never reach here as files.)
	 */
	private async _openFileLink(href: string): Promise<void> {
		if (href.startsWith('#') || href.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
			return;
		}
		const [, target = '', from, to] = /^([^#?]*)(?:\?[^#]*)?(?:#L(\d+)(?:-L?(\d+))?)?/.exec(href) ?? [];
		let uri: vscode.Uri;
		let type: vscode.FileType;
		try {
			uri = await resolveWorkspacePath(decodeURIComponent(target));
			type = (await vscode.workspace.fs.stat(uri)).type;
		} catch {
			type = vscode.FileType.Unknown;
			uri = vscode.Uri.file('/');
		}
		if (type & vscode.FileType.Directory) {
			await vscode.commands.executeCommand('revealInExplorer', uri);
			return;
		}
		if (!(type & vscode.FileType.File)) {
			vscode.window.setStatusBarMessage(`Sirius: ${decodeURIComponentSafe(target)} is not a file in this workspace.`, 5000);
			return;
		}
		const line = from ? Math.max(0, Number(from) - 1) : undefined;
		// A range runs to the end of its last line; the editor fits a column past the end to the line.
		const selection = line === undefined ? undefined : to ? new vscode.Range(line, 0, Math.max(line, Number(to) - 1), Number.MAX_SAFE_INTEGER) : new vscode.Range(line, 0, line, 0);
		await vscode.commands.executeCommand('vscode.open', uri, selection ? { preview: true, selection } : { preview: true });
	}

	private _open(client: Client, sessionId: string | undefined): void {
		client.sessionId = sessionId && this.sessions.get(sessionId) ? sessionId : newId();
		client.view = 'chat';
		if (client === this.viewClient) {
			void this.context.workspaceState.update(LAST_SESSION, client.sessionId);
		}
		this._post(client, { type: 'state', state: this._state(client) });
	}

	// ─── State ───────────────────────────────────────────────────────────────

	private get _mode(): Mode {
		const mode = this.choices.get<Mode>(MODE);
		return mode && MODES.includes(mode) ? mode : 'agent';
	}

	private get _edits(): Edits {
		const edits = this.choices.get<Edits>(EDITS_KEY);
		return edits && EDITS.includes(edits) ? edits : 'ask';
	}

	/** A turn as the webview shows it: a change's card says whether its diff can still be shown. */
	private _view(turn: StoredTurn, streaming = false): TurnView {
		const view = turnView(turn, streaming);
		return view.tools?.some(tool => tool.edit)
			? { ...view, tools: view.tools.map(tool => tool.edit ? { ...tool, edit: { ...tool.edit, diff: this.diffs.has(tool.id) } } : tool) }
			: view;
	}

	private get _effort(): Effort {
		const effort = this.choices.get<Effort>(EFFORT);
		return effort && EFFORTS.includes(effort) ? effort : 'high';
	}

	/** The chosen model while it is reachable, otherwise the first one that is. */
	private get _model(): string | undefined {
		const chosen = this.choices.get<string>(MODEL);
		return chosen && this.catalog.reachable(chosen) ? chosen : this.catalog.models[0]?.key;
	}

	private _state(client: Client): PanelState {
		const session = this.sessions.get(client.sessionId);
		const running = this.running.get(client.sessionId);
		return {
			view: client.view,
			session: {
				id: client.sessionId,
				title: session?.title ?? 'New conversation',
				// The store keeps a copy taken at the last save; the answer in progress is the live turn.
				turns: (session?.turns ?? []).map(turn => running && turn.id === running.turn.id ? this._view(running.turn, true) : this._view(turn)),
				running: !!running
			},
			sessions: this.sessions.list(),
			models: this.catalog.models,
			...(this._model ? { model: this._model } : {}),
			mode: this._mode,
			effort: this._effort,
			providers: this.catalog.providers,
			refreshing: !!this.refreshing,
			sendWith: vscode.workspace.getConfiguration().get<SendWith>(SEND_WITH) === 'ctrlEnter' ? 'ctrlEnter' : 'enter',
			edits: this._edits,
			...(this.editor.view ? { editor: this.editor.view } : {})
		};
	}

	// ─── Requests ────────────────────────────────────────────────────────────

	private async _send(client: Client, message: Extract<ToHost, { type: 'send' }>): Promise<void> {
		const sessionId = client.sessionId;
		if (this.running.has(sessionId) || this.preparing.has(sessionId)) {
			// Sent again before the first was under way: the webview gets its message back to send later.
			this._post(client, { type: 'unsent', id: message.id, reason: 'busy' });
			return;
		}
		// What the question carries is read now, as the user sees it: the editor, the files, the images.
		// A picked file's id is this webview's, and spent.
		const taken = message.attachments.map(id => {
			const entry = this.picked.get(id);
			this.picked.delete(id);
			return entry?.client === client ? [id, entry] as const : undefined;
		}).filter((pair): pair is NonNullable<typeof pair> => !!pair);
		const picked = taken.map(([, entry]) => entry);
		this.preparing.add(sessionId);
		const reserved: string[] = [];
		/** Whether the question was stored, and whether `_put` let the conversation go (it may be another's to hold since). */
		const progress = { stored: false, released: false };
		try {
			await this._put(client, sessionId, message, picked, reserved, progress);
		} catch (error) {
			this.output.appendLine(`[panel] a question failed: ${error instanceof Error ? error.message : String(error)}`);
			void vscode.window.showErrorMessage(`Sirius could not send that: ${error instanceof Error ? error.message : String(error)}`);
			if (!progress.stored) {
				// Given back with the message, its picked files are the webview's again.
				for (const [id, entry] of taken) {
					this.picked.set(id, entry);
				}
				this._post(client, { type: 'unsent', id: message.id, reason: 'failed' });
			}
		} finally {
			if (!progress.released) {
				this.preparing.delete(sessionId);
			}
			// The question's pictures are in its conversation now, saved — or it went nowhere.
			for (const ref of reserved) {
				this.unsaved.delete(ref);
			}
		}
	}

	/** Puts the question together, stores it and answers it; `reserved` collects the picture names kept from a sweep meanwhile. */
	private async _put(client: Client, sessionId: string, message: Extract<ToHost, { type: 'send' }>, picked: readonly { readonly uri: vscode.Uri; readonly label: string }[], reserved: string[], progress: { stored: boolean; released: boolean }): Promise<void> {
		const text = message.text;
		if (!this._model) {
			// None found yet: a server started since the last look, or a key saved in another window, is found now.
			await this.refreshModels(false);
		}
		const key = this._model;
		const carried = await carry({
			editor: this.editor.current,
			file: message.file,
			selection: message.selection,
			mentions: message.mentions,
			picked,
			pasted: message.images,
			contextWindow: (key ? this.catalog.reachable(key)?.model.contextWindow : undefined) ?? 128_000
		});
		// Reserved before they are written: a sweep running now must not take them.
		for (const image of carried.images) {
			const ref = ImageStore.refOf(image).ref;
			reserved.push(ref);
			this.unsaved.add(ref);
		}
		const stored = await Promise.all(carried.images.map(image => this.images.put(image)));
		this.preparing.delete(sessionId);
		progress.released = true;
		if (this.running.has(sessionId) || this.deleted.has(sessionId)) {
			return;
		}
		const session: StoredSession = this.sessions.get(sessionId)
			?? { id: sessionId, title: titleOf(text), created: Date.now(), updated: Date.now(), mode: this._mode, turns: [] };
		progress.stored = true;
		session.turns.push({
			id: newId(), role: 'user', text, at: Date.now(),
			...(carried.context ? { context: carried.context } : {}),
			...(stored.length ? { images: stored } : {}),
			...(carried.labels.length ? { attached: carried.labels } : {})
		});
		if (!this.asked) {
			this.asked = true;
			void vscode.commands.executeCommand('setContext', ASKED, true);
		}
		if (client === this.viewClient) {
			void this.context.workspaceState.update(LAST_SESSION, session.id);
		}
		await this._answer(session);
	}

	/** Answers the last question again, in place of the last answer. */
	private async _retry(client: Client): Promise<void> {
		const session = this.sessions.get(client.sessionId);
		const ready = () => !!session && !this.running.has(session.id) && !this.preparing.has(session.id) && !this.deleted.has(session.id) && session.turns.length >= 2 && session.turns[session.turns.length - 1].role === 'assistant';
		if (!session || !ready()) {
			return;
		}
		if (!this._model) {
			this.preparing.add(session.id);
			try {
				await this.refreshModels(false);
			} finally {
				this.preparing.delete(session.id);
			}
			if (!ready()) {
				return;
			}
		}
		session.turns.pop();
		await this._answer(session);
	}

	private async _answer(session: StoredSession): Promise<void> {
		const key = this._model;
		const reachable = key ? this.catalog.reachable(key) : undefined;
		const turn: StoredTurn = { id: newId(), role: 'assistant', text: '', at: Date.now(), ...(key ? { model: key } : {}) };
		session.turns.push(turn);
		if (!reachable) {
			turn.error = 'No model is available yet. Open Models and Keys (the gear) to add a provider\'s key, or start a local server such as Ollama.';
			await this.sessions.save(session);
			this._broadcast(session.id);
			return;
		}

		const controller = new AbortController();
		this.running.set(session.id, { controller, turn, session });
		await this.sessions.save(session);
		this._broadcast(session.id);

		const mode = this._mode;
		const effort = this._effort;
		this.output.appendLine(`[panel] answer in ${mode} mode, ${key}, effort ${effort}, edits ${this._edits}`);
		const thinking: ThinkingConfig = { enabled: effort !== 'off', effort: effort === 'off' ? 'high' : effort };
		const reasoning: ThinkingBlock[] = [];
		const roundReasoning = new Set<ThinkingBlock>();
		const usage = { input: 0, output: 0, thinking: 0 };
		let thinkingFrom: number | undefined;
		let textFrom: number | undefined;
		const delta = (kind: 'text' | 'thinking', text: string) => {
			for (const client of this._showing(session.id)) {
				this._post(client, { type: 'delta', turnId: turn.id, kind, text });
			}
		};
		const show = () => this._broadcast(session.id);

		const opened = new Set(session.opened ?? []);
		const allowed = this.allowed.get(session.id) ?? new Set<string>();
		this.allowed.set(session.id, allowed);
		/** Saves the answer as it would end if stopped now: the rounds so far, the round in hand answered, cards stopped. */
		const checkpoint = () => {
			if (this.deleted.has(session.id)) {
				return;
			}
			const done = messages.slice(before);
			const inHand = tools.stoppedRound();
			const last = done[done.length - 1];
			const rounds = inHand && last?.role === 'assistant' && last.toolCalls?.length ? [...done, inHand] : answered(done);
			const stopped: StoredTurn = {
				...turn,
				stopped: true,
				...(rounds.length ? { rounds } : {}),
				...(turn.tools ? { tools: turn.tools.map(tool => tool.status === 'waiting' || tool.status === 'running' ? { ...tool, status: 'stopped' } : tool) } : {}),
				...(usage.input || usage.output ? { usage: { input: usage.input, output: usage.output, ...(usage.thinking ? { thinking: usage.thinking } : {}) } } : {})
			};
			void this.sessions.save({ ...session, turns: session.turns.map(t => t === turn ? stopped : t) });
		};
		// A card's id is the panel's own: some vendors start their call ids again every round.
		const cards = new Map<AgentToolCall, string>();
		const card = (call: AgentToolCall) => cards.get(call) ?? '';
		const update = (id: string, change: Partial<NonNullable<StoredTurn['tools']>[number]>) => {
			turn.tools = (turn.tools ?? []).map(tool => tool.id === id ? { ...tool, ...change } : tool);
			show();
		};
		const tools = new PanelTools(mode, reachable.model, this.context.extension.id, allowed, opened, {
			start: (call, label, ask, input) => {
				const id = newId();
				cards.set(call, id);
				turn.tools = [...(turn.tools ?? []), { id, name: call.name, label, status: ask ? 'waiting' : 'running', at: turn.text.length, ...(input && input !== '{}' ? { input } : {}) }];
				show();
			},
			approve: call => new Promise(resolve => {
				if (controller.signal.aborted) {
					resolve('stop');
					return;
				}
				const key = `${session.id}:${card(call)}`;
				const done = (choice: Approval | 'stop') => {
					this.approvals.delete(key);
					controller.signal.removeEventListener('abort', stop);
					if (choice === 'once' || choice === 'session') {
						update(card(call), { status: 'running' });
					}
					resolve(choice);
				};
				const stop = () => done('stop');
				controller.signal.addEventListener('abort', stop);
				this.approvals.set(key, done);
				// A card may wait for hours, and VS Code drops what an extension saves as it shuts
				// down: the answer is kept now as it would end if stopped, the rounds that ran included.
				checkpoint();
			}),
			finish: (call, status, output) => {
				update(card(call), { status, ...(output ? { output } : {}) });
				// A change to a file is saved as it went at once: the window may close before the answer ends,
				// and the history must not say a change that reached the file never ran.
				if (turn.tools?.some(tool => tool.id === card(call) && tool.edit)) {
					checkpoint();
				}
			},
			propose: (call, label, edit, proposal) => {
				const id = newId();
				cards.set(call, id);
				this.diffs.keep(id, proposal);
				turn.tools = [...(turn.tools ?? []), { id, name: call.name, label, status: edit.auto ? 'running' : 'waiting', at: turn.text.length, edit }];
				show();
			},
			decide: call => new Promise(resolve => {
				if (controller.signal.aborted) {
					resolve('stop');
					return;
				}
				const id = card(call);
				const batch = turn.tools?.find(tool => tool.id === id)?.edit?.batch;
				const done = (choice: Decision | 'stop') => {
					if (!this.decisions.delete(id)) {
						return;
					}
					controller.signal.removeEventListener('abort', stop);
					if (choice === 'accept') {
						update(id, { status: 'running' });
					}
					resolve(choice);
					// The decided change's diff closes; if it was the one shown, the round's next waiting change takes its place.
					void this.diffs.close(id).then(shown => {
						const next = shown && choice !== 'stop' ? turn.tools?.find(tool => tool.edit?.batch === batch && this.decisions.has(tool.id)) : undefined;
						if (next) {
							void this.diffs.show(next.id, true);
						}
					});
				};
				const stop = () => done('stop');
				controller.signal.addEventListener('abort', stop);
				this.decisions.set(id, { session: session.id, decide: done });
				checkpoint();
			}),
			// The first change still waiting is shown: one decided, or stopped, while the round was proposed is not.
			review: call => {
				const batch = turn.tools?.find(tool => tool.id === card(call))?.edit?.batch;
				const next = this.decisions.has(card(call)) ? card(call) : turn.tools?.find(tool => tool.edit?.batch === batch && this.decisions.has(tool.id))?.id;
				if (next) {
					void this.diffs.show(next, true);
				}
			}
		}, () => this._edits === 'auto');
		if (tools.droppedSources.length) {
			turn.notice = `Not offered to ${reachable.model.name || reachable.model.id}: ${tools.droppedSources.map(source => `${source.label} (${source.tools.length} tools)`).join(', ')} — more tool sources than this model's tools hold.`;
			show();
		}

		const face = panelFace({
			router: new ModelRouter(),
			provider: reachable.provider,
			model: reachable.model,
			systemPrompt: `${PROMPT}\n\n${MODE_RULES[mode]}${mode === 'ask' ? '' : ` ${EDIT_RULE}`}`,
			thinking,
			signal: controller.signal,
			tools,
			onReasoning: block => reasoning.push(block),
			onUsage: u => { usage.input += u.input; usage.output += u.output; usage.thinking += u.thinking ?? 0; },
			onRound: () => {
				// The round's reasoning rides in its assistant turn; what comes after is the last round's.
				for (const block of reasoning) {
					roundReasoning.add(block);
				}
				turn.finalFrom = turn.text.length;
			}
		});
		const sink = {
			markdown: (text: string) => {
				textFrom ??= Date.now();
				if (turn.thinking && turn.thinking.ms === undefined && thinkingFrom !== undefined) {
					turn.thinking.ms = textFrom - thinkingFrom;
				}
				turn.text += text;
				delta('text', text);
			},
			thinking: (text: string) => {
				thinkingFrom ??= Date.now();
				turn.thinking = { text: (turn.thinking?.text ?? '') + text, ...(turn.thinking?.ms !== undefined ? { ms: turn.thinking.ms } : {}) };
				delta('thinking', text);
			}
		};
		const token = { get isCancellationRequested() { return controller.signal.aborted; } };
		const messages = buildHistory(session.turns, turn, reachable.model.provider, reachable.model.contextWindow, await this._recentImages(session.turns));
		const before = messages.length;

		try {
			await runAgent(messages, face, sink, token, line => this.output.appendLine(line));
		} catch (error) {
			if (!controller.signal.aborted) {
				turn.error = error instanceof Error ? error.message : String(error);
			}
		} finally {
			if (turn.thinking && turn.thinking.ms === undefined && thinkingFrom !== undefined) {
				turn.thinking.ms = (textFrom ?? Date.now()) - thinkingFrom;
			}
			if (controller.signal.aborted) {
				turn.stopped = true;
			}
			const rounds = answered(messages.slice(before));
			if (rounds.length) {
				turn.rounds = rounds;
			}
			const last = reasoning.filter(block => !roundReasoning.has(block));
			if (last.length) {
				turn.reasoning = last;
			}
			if (usage.input || usage.output) {
				turn.usage = { input: usage.input, output: usage.output, ...(usage.thinking ? { thinking: usage.thinking } : {}) };
			}
			if (opened.size) {
				session.opened = [...opened];
			}
			this.running.delete(session.id);
			if (!this.deleted.has(session.id)) {
				await this.sessions.save(session);
			}
			for (const client of this._showing(session.id)) {
				this._post(client, { type: 'turn', turn: this._view(turn) });
			}
			this._broadcast(session.id);
		}
	}

}

function decodeURIComponentSafe(text: string): string {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
}
