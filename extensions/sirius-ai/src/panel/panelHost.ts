/*---------------------------------------------------------------------------------------------
 *  Sirius — the panel: Sirius's own chat in VS Code
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { type AgentToolCall, runAgent } from '../agent/core';
import type { ProviderType, ThinkingBlock, ThinkingConfig } from '../types';
import { ModelRouter } from '../providers/modelRouter';
import { ModelCatalog } from './models';
import { panelFace } from './panelFace';
import { EFFORTS, MODES, type Approval, type Effort, type Mode, type PanelState, type SendWith, type ToWebview, type View, toHost } from './protocol';
import { SessionStore, type StoredSession, type StoredTurn, newId, titleOf, turnView } from './sessions';
import { answered, buildHistory } from './history';
import { PanelTools } from './tools';

export const VIEW_ID = 'sirius.panel';
export const TAB_TYPE = 'sirius.chat';

const MODEL = 'sirius.panel.model';
const MODE = 'sirius.panel.mode';
const EFFORT = 'sirius.panel.effort';
const LAST_SESSION = 'sirius.panel.lastSession';
const SEND_WITH = 'sirius.panel.sendWith';
/** Set while some model can be asked; the walkthrough's "Add a model" step completes on it. */
const MODEL_AVAILABLE = 'sirius.panel.modelAvailable';
/** Set once a question was sent; the walkthrough's "Ask, Edit or Agent" step completes on it. */
const ASKED = 'sirius.panel.asked';

const PROMPT =
	'You are Sirius, an AI engineer working inside the user\'s VS Code. Answer directly and concisely in markdown, ' +
	'with code in fenced blocks that name their language. When you are unsure, say so. ' +
	'Use tools only when the task needs them; call them through the tool-calling mechanism, never as JSON in your text.';
const MODE_RULES: Record<Mode, string> = {
	ask: 'You are in Ask mode: explain and answer. You can read and search the workspace with your tools, but not change it — when a change is needed, describe it; the user can switch to Edit or Agent mode.',
	edit: 'You are in Edit mode: read the workspace with your tools and propose changes to the user\'s code as complete, ready-to-apply code blocks.',
	agent: 'You are in Agent mode: work through the task step by step with your tools. Tools from MCP servers and other extensions run only once the user allows them; if the user declines one, carry on without it.'
};

/** One webview showing the panel: the side panel, or a tab. */
interface Client {
	readonly webview: vscode.Webview;
	sessionId: string;
	view: View;
}

interface Running {
	readonly controller: AbortController;
	readonly turn: StoredTurn;
}

export class PanelHost implements vscode.WebviewViewProvider, vscode.WebviewPanelSerializer, vscode.Disposable {
	private readonly clients = new Set<Client>();
	private readonly running = new Map<string, Running>();
	private readonly sessions: SessionStore;
	private readonly catalog: ModelCatalog;
	private readonly output = vscode.window.createOutputChannel('Sirius');
	private refreshing: Promise<void> | undefined;
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

	constructor(private readonly context: vscode.ExtensionContext) {
		this.sessions = new SessionStore(context.workspaceState);
		this.catalog = new ModelCatalog(context.secrets, context.globalState, new ModelRouter());
		context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(SEND_WITH)) {
				this._broadcast();
			}
		}));
		void this.refreshModels();
	}

	dispose(): void {
		for (const { controller } of this.running.values()) {
			controller.abort();
		}
		this.output.dispose();
	}

	// ─── Webviews ────────────────────────────────────────────────────────────

	resolveWebviewView(view: vscode.WebviewView): void {
		const { view: wanted, fresh } = this.pending;
		this.pending = {};
		const client = this._attach(view.webview, fresh ? undefined : this.context.workspaceState.get<string>(LAST_SESSION), wanted);
		this.viewClient = client;
		view.onDidDispose(() => { this.clients.delete(client); this.viewClient = undefined; });
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
		panel.onDidDispose(() => this.clients.delete(client));
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
		switch (message.type) {
			case 'ready':
				break;
			case 'send':
				await this._send(client, message.text);
				return;
			case 'stop':
				this.running.get(client.sessionId)?.controller.abort();
				return;
			case 'approve':
				this.approvals.get(`${client.sessionId}:${message.callId}`)?.(message.choice);
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
				for (const other of this._showing(message.id)) {
					other.sessionId = newId();
				}
				this._broadcast();
				return;
			case 'setModel':
				if (this.catalog.reachable(message.key)) {
					await this.context.globalState.update(MODEL, message.key);
				}
				this._broadcast();
				return;
			case 'setMode':
				await this.context.globalState.update(MODE, message.mode);
				this._broadcast();
				return;
			case 'setEffort':
				await this.context.globalState.update(EFFORT, message.effort);
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
					await this.refreshModels();
				}
				return;
			case 'refreshModels':
				await this.refreshModels();
				return;
			case 'openLink':
				if (/^https?:\/\//i.test(message.href)) {
					await vscode.env.openExternal(vscode.Uri.parse(message.href));
				}
				return;
			case 'copy':
				await vscode.env.clipboard.writeText(message.text);
				return;
		}
		this._post(client, { type: 'state', state: this._state(client) });
	}

	async refreshModels(): Promise<void> {
		if (!this.refreshing) {
			this.refreshing = (async () => {
				this._broadcast();
				try {
					await this.catalog.refresh();
				} finally {
					this.refreshing = undefined;
				}
			})();
		}
		await this.refreshing;
		void vscode.commands.executeCommand('setContext', MODEL_AVAILABLE, this.catalog.models.length > 0);
		this._broadcast();
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
		const mode = this.context.globalState.get<Mode>(MODE);
		return mode && MODES.includes(mode) ? mode : 'agent';
	}

	private get _effort(): Effort {
		const effort = this.context.globalState.get<Effort>(EFFORT);
		return effort && EFFORTS.includes(effort) ? effort : 'high';
	}

	/** The chosen model while it is reachable, otherwise the first one that is. */
	private get _model(): string | undefined {
		const chosen = this.context.globalState.get<string>(MODEL);
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
				turns: (session?.turns ?? []).map(turn => running && turn.id === running.turn.id ? turnView(running.turn, true) : turnView(turn)),
				running: !!running
			},
			sessions: this.sessions.list(),
			models: this.catalog.models,
			...(this._model ? { model: this._model } : {}),
			mode: this._mode,
			effort: this._effort,
			providers: this.catalog.providers,
			refreshing: !!this.refreshing,
			sendWith: vscode.workspace.getConfiguration().get<SendWith>(SEND_WITH) === 'ctrlEnter' ? 'ctrlEnter' : 'enter'
		};
	}

	// ─── Requests ────────────────────────────────────────────────────────────

	private async _send(client: Client, text: string): Promise<void> {
		if (this.running.has(client.sessionId)) {
			return;
		}
		const session: StoredSession = this.sessions.get(client.sessionId)
			?? { id: client.sessionId, title: titleOf(text), created: Date.now(), updated: Date.now(), mode: this._mode, turns: [] };
		session.turns.push({ id: newId(), role: 'user', text, at: Date.now() });
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
		if (!session || this.running.has(session.id) || session.turns.length < 2 || session.turns[session.turns.length - 1].role !== 'assistant') {
			return;
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
		this.running.set(session.id, { controller, turn });
		await this.sessions.save(session);
		this._broadcast(session.id);

		const mode = this._mode;
		const effort = this._effort;
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
			finish: (call, status, output) => update(card(call), { status, ...(output ? { output } : {}) })
		});
		if (tools.droppedSources.length) {
			turn.notice = `Not offered to ${reachable.model.name || reachable.model.id}: ${tools.droppedSources.map(source => `${source.label} (${source.tools.length} tools)`).join(', ')} — more tool sources than this model's tools hold.`;
		}

		const face = panelFace({
			router: new ModelRouter(),
			provider: reachable.provider,
			model: reachable.model,
			systemPrompt: `${PROMPT}\n\n${MODE_RULES[mode]}`,
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
		const messages = buildHistory(session.turns, turn, reachable.model.provider, reachable.model.contextWindow);
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
				this._post(client, { type: 'turn', turn: turnView(turn) });
			}
			this._broadcast(session.id);
		}
	}

}
