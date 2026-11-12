/*---------------------------------------------------------------------------------------------
 *  Sirius — the panel's choices, as this window made them
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

/** When the stored value is checked after a write, in ms after it: VS Code's later echo comes through its main process, a few hundred ms on. */
const CHECKS = [500, 1500, 3000];

/**
 * Values kept in an extension's global state, read back as this window wrote them.
 *
 * VS Code sends every write to global state back to the extension host, and the extension's memento
 * takes what comes back whole (extHostMemento.ts, `onDidChangeStorage`) — twice:
 * - at once, from the window: two writes a millisecond or two apart, the first's echo lands on the
 *   second before the second is sent, and the key keeps the first for good (test/harness/memento.sh
 *   measures it: nearly every time in VS Code 1.145.3 and 1.146.0);
 * - a few hundred ms later, from VS Code's main process, which batches what windows store and sends
 *   it back to every window, the writer's too: an older value, over a newer one.
 * So a value this window wrote is read from its own copy for as long as the window is open, and the
 * stored value is checked at CHECKS and written again whenever it is not this window's, so the next
 * window starts from it. A value this window never wrote is read from the memento.
 */
export class Kept implements Pick<vscode.Memento, 'get' | 'update'> {
	/** This window's writes, by key; compared by identity, so a value written twice is two writes. */
	private readonly written = new Map<string, { readonly value: unknown }>();

	constructor(private readonly memento: vscode.Memento) { }

	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: string, defaultValue?: T): T | undefined {
		const value = this.written.has(key) ? this.written.get(key)!.value as T | undefined : this.memento.get<T>(key);
		return value === undefined ? defaultValue : value;
	}

	/** For plain values — strings, numbers, booleans, undefined — which is all the panel keeps here. */
	async update(key: string, value: string | number | boolean | undefined): Promise<void> {
		const mine = { value };
		this.written.set(key, mine);
		try {
			await this.memento.update(key, value);
		} catch {
			// This window reads its own copy; the checks below try the write again.
		}
		void this._settle(key, mine);
	}

	/** Makes sure the stored value is this window's, until VS Code has sent everything back. */
	private async _settle(key: string, mine: { readonly value: unknown }): Promise<void> {
		let waited = 0;
		for (const at of CHECKS) {
			await new Promise(resolve => setTimeout(resolve, at - waited));
			waited = at;
			if (this.written.get(key) !== mine) {
				return; // a later write is this key's now
			}
			if (this.memento.get(key) !== mine.value) {
				try {
					await this.memento.update(key, mine.value);
				} catch {
					// tried again at the next check
				}
			}
		}
	}
}
