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
/** How a model's changes to files are taken: each reviewed first, or applied as they come. */
export type Edits = 'ask' | 'auto';

export const MODES: readonly Mode[] = ['ask', 'edit', 'agent'];
export const EFFORTS: readonly Effort[] = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];
export const VIEWS: readonly View[] = ['chat', 'sessions', 'setup'];
export const EDITS: readonly Edits[] = ['ask', 'auto'];

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

/** The text editor the user last worked in, as the composer's chips show it. */
export interface EditorView {
	/** The file, as the workspace names it. */
	readonly path: string;
	/** The selected lines, 1-based, when something is selected. */
	readonly selection?: { readonly start: number; readonly end: number };
}

/** An image pasted into the message box. */
export interface PastedImage {
	readonly mimeType: string;
	/** Its bytes, base64, with no `data:` prefix. */
	readonly base64: string;
}

/** The images every vision model takes. */
export const IMAGE_MIME_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
/** A pasted image's base64 at most: 3.75 MB of picture (the extension caps what a message carries further). */
export const MAX_PASTED_BASE64 = 5_000_000;
/** At most this many pasted images, mentioned files and picked files in one message. */
export const MAX_PASTED = 8;
export const MAX_FILES = 20;

export const APPROVALS = ['once', 'session', 'deny'] as const;
export type Approval = typeof APPROVALS[number];
export const DECISIONS = ['accept', 'reject'] as const;
export type Decision = typeof DECISIONS[number];

/** A change to a file a model proposed, as its card shows it. */
export interface EditView {
	/** The file, as the workspace names it. */
	readonly path: string;
	readonly kind: 'edit' | 'create';
	/** Lines the change adds and removes. */
	readonly added: number;
	readonly removed: number;
	/** The round's changes, which Accept all and Reject all decide together. */
	readonly batch: string;
	/** Applied as it came, under Auto-accept edits. */
	readonly auto?: boolean;
	/** A file that can run code when written: asked about even under Auto-accept edits. */
	readonly guarded?: boolean;
	/** Whether its diff can still be shown: the panel keeps them until the window closes. Not stored. */
	readonly diff?: boolean;
}

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
	/** Set on a proposed change to a file: the card is its review. */
	readonly edit?: EditView;
}

export interface TurnView {
	readonly id: string;
	readonly role: 'user' | 'assistant';
	readonly text: string;
	/** What a question carried, by name: the open file or selection, files, images. */
	readonly attached?: readonly string[];
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
	readonly edits: Edits;
	readonly editor?: EditorView;
}

/** From the extension to the webview. */
export type ToWebview =
	| { readonly type: 'state'; readonly state: PanelState }
	| { readonly type: 'delta'; readonly turnId: string; readonly kind: 'text' | 'thinking'; readonly text: string }
	| { readonly type: 'turn'; readonly turn: TurnView }
	/** The text editor the user last worked in changed, or its selection did. */
	| { readonly type: 'editor'; readonly editor?: EditorView }
	/** Workspace files for an @-mention, answering `searchFiles`. */
	| { readonly type: 'files'; readonly requestId: number; readonly files: readonly string[] }
	/** Files the user chose in VS Code's file picker, by ids of the host's: a path from the webview is never trusted. */
	| { readonly type: 'attached'; readonly files: readonly { readonly id: string; readonly label: string }[] };

/** From the webview to the extension. */
export type ToHost =
	| { readonly type: 'ready' }
	| {
		readonly type: 'send'; readonly text: string;
		/** Whether the open file and the selection go with it (the composer's chips). */
		readonly file: boolean; readonly selection: boolean;
		/** Workspace files @-mentioned; picked files by the ids `attached` gave; pasted images. */
		readonly mentions: readonly string[]; readonly attachments: readonly string[]; readonly images: readonly PastedImage[];
	}
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
	| { readonly type: 'approve'; readonly turnId: string; readonly callId: string; readonly choice: Approval }
	| { readonly type: 'setEdits'; readonly edits: Edits }
	/** Accept or Reject on one proposed change's card. */
	| { readonly type: 'decide'; readonly callId: string; readonly choice: Decision }
	/** Accept all or Reject all on a round's changes. */
	| { readonly type: 'decideAll'; readonly batch: string; readonly choice: Decision }
	| { readonly type: 'showDiff'; readonly callId: string }
	| { readonly type: 'searchFiles'; readonly requestId: number; readonly query: string }
	| { readonly type: 'attach' };

const MAX_TEXT = 200_000;
const str = (value: unknown, max = MAX_TEXT): value is string => typeof value === 'string' && value.length <= max;
/** A list of at most `max` items each `ok` accepts (none when absent), or undefined when it is not one. */
const list = (value: unknown, max: number, ok: (item: unknown) => boolean): unknown[] | undefined =>
	value === undefined ? [] : Array.isArray(value) && value.length <= max && value.every(ok) ? value : undefined;

/** A message from the webview, or undefined when it is not one of ours. */
export function toHost(value: unknown): ToHost | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const m = value as Record<string, unknown>;
	switch (m.type) {
		case 'ready': case 'stop': case 'retry': case 'newSession': case 'refreshModels': case 'attach':
			return { type: m.type };
		case 'send': {
			if (!str(m.text) || !m.text.trim()) {
				return undefined;
			}
			const mentions = list(m.mentions, MAX_FILES, item => str(item, 1_000));
			const attachments = list(m.attachments, MAX_FILES, item => str(item, 100));
			const images = list(m.images, MAX_PASTED, item => {
				const image = item as Record<string, unknown> | null;
				return typeof image === 'object' && image !== null && IMAGE_MIME_TYPES.includes(image.mimeType as string)
					&& str(image.base64, MAX_PASTED_BASE64) && /^[A-Za-z0-9+/]+={0,2}$/.test(image.base64);
			});
			return mentions && attachments && images ? {
				type: 'send', text: m.text, file: m.file !== false, selection: m.selection !== false,
				mentions: mentions as string[], attachments: attachments as string[],
				images: (images as PastedImage[]).map(image => ({ mimeType: image.mimeType, base64: image.base64 }))
			} : undefined;
		}
		case 'searchFiles':
			return typeof m.requestId === 'number' && Number.isSafeInteger(m.requestId) && str(m.query, 500) ? { type: 'searchFiles', requestId: m.requestId, query: m.query } : undefined;
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
		case 'setEdits':
			return EDITS.includes(m.edits as Edits) ? { type: 'setEdits', edits: m.edits as Edits } : undefined;
		case 'decide':
			return str(m.callId, 200) && DECISIONS.includes(m.choice as Decision) ? { type: 'decide', callId: m.callId, choice: m.choice as Decision } : undefined;
		case 'decideAll':
			return str(m.batch, 200) && DECISIONS.includes(m.choice as Decision) ? { type: 'decideAll', batch: m.batch, choice: m.choice as Decision } : undefined;
		case 'showDiff':
			return str(m.callId, 200) ? { type: 'showDiff', callId: m.callId } : undefined;
		default:
			return undefined;
	}
}
