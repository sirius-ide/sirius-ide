/*---------------------------------------------------------------------------------------------
 *  Sirius — the panel's messages between the extension and its webview
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// Shared by the extension (panel/*.ts) and the webview (panel/webview/main.ts): plain data,
// no editor API, so both sides compile against it. Everything the webview sends is checked on
// arrival (`toHost`) — the webview renders model output, so it is not trusted.

export type Mode = 'ask' | 'edit' | 'agent';
export type Effort = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type View = 'chat' | 'sessions' | 'setup';
/** The `sirius.panel.sendWith` setting: which key sends a message. */
export type SendWith = 'enter' | 'ctrlEnter';

export const MODES: readonly Mode[] = ['ask', 'edit', 'agent'];
export const EFFORTS: readonly Effort[] = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];
export const VIEWS: readonly View[] = ['chat', 'sessions', 'setup'];

/** A model the panel can talk to: `key` is `<provider>/<model id>`. */
export interface ModelEntry {
	readonly key: string;
	readonly provider: string;
	readonly label: string;
	readonly detail?: string;
	readonly thinking: boolean;
}

/** A provider as the setup page shows it. A key is never sent to the webview, only whether there is one. */
export interface ProviderView {
	readonly id: string;
	readonly label: string;
	readonly kind: 'hosted' | 'local' | 'custom';
	readonly hasKey: boolean;
	/** Whether this provider takes a key at all (a local server may, optionally). */
	readonly takesKey: boolean;
	/** Whether an address can be given: a local or custom server's, or a hosted vendor's gateway. */
	readonly takesUrl: boolean;
	readonly url?: string;
	readonly defaultUrl?: string;
	readonly models: number;
	readonly problem?: string;
}

export interface Usage {
	readonly input: number;
	readonly output: number;
	readonly thinking?: number;
}

export const APPROVALS = ['once', 'session', 'deny'] as const;
export type Approval = typeof APPROVALS[number];

/** A tool call as its card shows it: `at` is where in the answer's text it ran. */
export interface ToolView {
	readonly id: string;
	readonly name: string;
	readonly label: string;
	readonly status: 'running' | 'waiting' | 'done' | 'failed' | 'denied' | 'stopped';
	/** What it was called with, as JSON. */
	readonly input?: string;
	readonly output?: string;
	readonly at: number;
}

export interface TurnView {
	readonly id: string;
	readonly role: 'user' | 'assistant';
	readonly text: string;
	readonly thinking?: { readonly text: string; readonly ms?: number };
	readonly tools?: readonly ToolView[];
	/** Something the user should know about the answer, such as tools that were left out. */
	readonly notice?: string;
	readonly usage?: Usage;
	readonly error?: string;
	readonly stopped?: boolean;
	readonly streaming?: boolean;
	readonly model?: string;
	readonly at: number;
}

export interface SessionSummary {
	readonly id: string;
	readonly title: string;
	readonly updated: number;
	readonly turns: number;
}

export interface PanelState {
	readonly view: View;
	readonly session: { readonly id: string; readonly title: string; readonly turns: readonly TurnView[]; readonly running: boolean };
	readonly sessions: readonly SessionSummary[];
	readonly models: readonly ModelEntry[];
	readonly model?: string;
	readonly mode: Mode;
	readonly effort: Effort;
	readonly providers: readonly ProviderView[];
	readonly refreshing: boolean;
	readonly sendWith: SendWith;
}

/** From the extension to the webview. */
export type ToWebview =
	| { readonly type: 'state'; readonly state: PanelState }
	| { readonly type: 'delta'; readonly turnId: string; readonly kind: 'text' | 'thinking'; readonly text: string }
	| { readonly type: 'turn'; readonly turn: TurnView };

/** From the webview to the extension. */
export type ToHost =
	| { readonly type: 'ready' }
	| { readonly type: 'send'; readonly text: string }
	| { readonly type: 'stop' }
	| { readonly type: 'retry' }
	| { readonly type: 'newSession' }
	| { readonly type: 'openSession'; readonly id: string }
	| { readonly type: 'deleteSession'; readonly id: string }
	| { readonly type: 'setModel'; readonly key: string }
	| { readonly type: 'setMode'; readonly mode: Mode }
	| { readonly type: 'setEffort'; readonly effort: Effort }
	| { readonly type: 'setView'; readonly view: View }
	| { readonly type: 'saveKey'; readonly provider: string; readonly key: string }
	| { readonly type: 'clearKey'; readonly provider: string }
	| { readonly type: 'saveUrl'; readonly provider: string; readonly url: string }
	| { readonly type: 'refreshModels' }
	| { readonly type: 'openLink'; readonly href: string }
	| { readonly type: 'copy'; readonly text: string }
	| { readonly type: 'approve'; readonly turnId: string; readonly callId: string; readonly choice: Approval };

const MAX_TEXT = 200_000;
const str = (value: unknown, max = MAX_TEXT): value is string => typeof value === 'string' && value.length <= max;

/** A message from the webview, or undefined when it is not one of ours. */
export function toHost(value: unknown): ToHost | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const m = value as Record<string, unknown>;
	switch (m.type) {
		case 'ready': case 'stop': case 'retry': case 'newSession': case 'refreshModels':
			return { type: m.type };
		case 'send':
			return str(m.text) && m.text.trim() ? { type: 'send', text: m.text } : undefined;
		case 'openSession': case 'deleteSession':
			return str(m.id, 100) ? { type: m.type, id: m.id } : undefined;
		case 'setModel':
			return str(m.key, 500) ? { type: 'setModel', key: m.key } : undefined;
		case 'setMode':
			return MODES.includes(m.mode as Mode) ? { type: 'setMode', mode: m.mode as Mode } : undefined;
		case 'setEffort':
			return EFFORTS.includes(m.effort as Effort) ? { type: 'setEffort', effort: m.effort as Effort } : undefined;
		case 'setView':
			return VIEWS.includes(m.view as View) ? { type: 'setView', view: m.view as View } : undefined;
		case 'saveKey':
			return str(m.provider, 50) && str(m.key, 2000) && m.key.trim() ? { type: 'saveKey', provider: m.provider, key: m.key.trim() } : undefined;
		case 'clearKey':
			return str(m.provider, 50) ? { type: 'clearKey', provider: m.provider } : undefined;
		case 'saveUrl':
			return str(m.provider, 50) && str(m.url, 2000) ? { type: 'saveUrl', provider: m.provider, url: m.url.trim() } : undefined;
		case 'openLink':
			return str(m.href, 4000) ? { type: 'openLink', href: m.href } : undefined;
		case 'copy':
			return str(m.text) ? { type: 'copy', text: m.text } : undefined;
		case 'approve':
			return str(m.turnId, 100) && str(m.callId, 200) && APPROVALS.includes(m.choice as Approval) ? { type: 'approve', turnId: m.turnId, callId: m.callId, choice: m.choice as Approval } : undefined;
		default:
			return undefined;
	}
}
