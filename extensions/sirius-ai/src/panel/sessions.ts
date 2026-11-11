/*---------------------------------------------------------------------------------------------
 *  Sirius — the panel's conversations, kept per workspace
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { ThinkingBlock } from '../types';
import type { Mode, SessionSummary, TurnView, Usage } from './protocol';

/**
 * A turn as kept. An answer keeps the reasoning blocks the model produced, whole, so the next
 * turn can send them back unchanged — Sirius owns this history, so nothing between it and the
 * vendor drops them.
 */
export interface StoredTurn {
	id: string;
	role: 'user' | 'assistant';
	text: string;
	thinking?: { text: string; ms?: number };
	reasoning?: ThinkingBlock[];
	usage?: Usage;
	error?: string;
	stopped?: boolean;
	model?: string;
	at: number;
}

export interface StoredSession {
	id: string;
	title: string;
	created: number;
	updated: number;
	mode: Mode;
	turns: StoredTurn[];
}

const INDEX = 'sirius.panel.sessions';
const BODY = (id: string) => `sirius.panel.session.${id}`;
/** The oldest conversations beyond this are dropped. */
const MAX_SESSIONS = 200;
const TITLE_CHARS = 60;

export function newId(): string {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The first words of the first message, as the conversation's title. */
export function titleOf(text: string): string {
	const line = text.trim().replace(/\s+/g, ' ');
	return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1)}…` : line || 'New conversation';
}

export function turnView(turn: StoredTurn, streaming = false): TurnView {
	return {
		id: turn.id, role: turn.role, text: turn.text, at: turn.at,
		...(turn.thinking ? { thinking: turn.thinking } : {}),
		...(turn.usage ? { usage: turn.usage } : {}),
		...(turn.error ? { error: turn.error } : {}),
		...(turn.stopped ? { stopped: true } : {}),
		...(turn.model ? { model: turn.model } : {}),
		...(streaming ? { streaming: true } : {})
	};
}

/** Conversations in the workspace's storage: an index, and one entry per conversation. */
export class SessionStore {
	constructor(private readonly memento: vscode.Memento) { }

	list(): SessionSummary[] {
		return [...this.memento.get<SessionSummary[]>(INDEX, [])].sort((a, b) => b.updated - a.updated);
	}

	get(id: string): StoredSession | undefined {
		return this.memento.get<StoredSession>(BODY(id));
	}

	async save(session: StoredSession): Promise<void> {
		session.updated = Date.now();
		const summary: SessionSummary = { id: session.id, title: session.title, updated: session.updated, turns: session.turns.length };
		const others = this.list().filter(s => s.id !== session.id);
		const index = [summary, ...others];
		const dropped = index.slice(MAX_SESSIONS);
		await this.memento.update(BODY(session.id), session);
		for (const old of dropped) {
			await this.memento.update(BODY(old.id), undefined);
		}
		await this.memento.update(INDEX, index.slice(0, MAX_SESSIONS));
	}

	async delete(id: string): Promise<void> {
		await this.memento.update(BODY(id), undefined);
		await this.memento.update(INDEX, this.list().filter(s => s.id !== id));
	}
}
