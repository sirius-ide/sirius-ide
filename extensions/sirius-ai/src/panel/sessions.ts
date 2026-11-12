/*---------------------------------------------------------------------------------------------
 *  Sirius — the panel's conversations, kept per workspace
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { ChatMessage, ThinkingBlock } from '../types';
import type { Mode, SessionSummary, ToolView, TurnView, Usage } from './protocol';

/**
 * A turn as kept. An answer keeps the reasoning blocks the model produced, whole, so the next
 * turn can send them back unchanged — Sirius owns this history, so nothing between it and the
 * vendor drops them.
 */
export interface StoredTurn {
	id: string;
	role: 'user' | 'assistant';
	/** What the answer showed, every round's text in order. */
	text: string;
	thinking?: { text: string; ms?: number };
	/**
	 * The answer's tool rounds as they went to and came from the model — each assistant turn with
	 * its reasoning, text and calls, then the results — sent back whole on the next turn: a model
	 * that binds its reasoning to the conversation refuses it on an edited history.
	 */
	rounds?: ChatMessage[];
	/** The last round's text, from where it starts in `text` (the earlier rounds' is in `rounds`). */
	finalFrom?: number;
	/** The last round's reasoning; the earlier rounds' rides in `rounds`. */
	reasoning?: ThinkingBlock[];
	tools?: ToolView[];
	notice?: string;
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
	/** The tool sources the model opened in this conversation (chat/externalTools.ts); they stay open. */
	opened?: string[];
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
		...(turn.tools?.length ? { tools: turn.tools } : {}),
		...(turn.notice ? { notice: turn.notice } : {}),
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
