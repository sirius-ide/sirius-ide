/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — next-edit prediction
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * After an edit, predict the next one nearby — renamed the variable here, so
 * offer the rename two uses below as a Tab-able diff. The prediction rides the
 * same inline-completion provider as ghost text, marked isInlineEdit so the
 * editor renders it as a change rather than an insertion.
 *
 * The model protocol is deliberately rigid (parseable by regex, refusable with
 * NONE) because small local models follow formats far better than they follow
 * prose instructions.
 */

export interface RecentEdit {
	readonly uri: string;
	readonly line: number;
	readonly before: string;
	readonly after: string;
	readonly at: number;
}

export interface NesPrediction {
	readonly oldText: string;
	readonly newText: string;
}

/** An edit older than this no longer predicts anything. */
export const RECENT_EDIT_WINDOW_MS = 8000;

/** Lines of context around the cursor handed to the model. */
export const NES_CONTEXT_LINES = 40;

export function buildNesPrompt(windowText: string, recent: RecentEdit): string {
	return [
		'A developer just made this edit:',
		`- line ${recent.line + 1}: "${recent.before.trim()}" -> "${recent.after.trim()}"`,
		'',
		'Here is the code around their cursor:',
		'---',
		windowText,
		'---',
		'If this edit implies exactly one more small change in the code above',
		'(same rename elsewhere, a matching update, a required fix), reply in',
		'exactly this format:',
		'<<<OLD',
		'the exact existing text to replace (copy it verbatim from the code)',
		'>>>NEW',
		'the replacement text',
		'END',
		'If no further change is implied, reply exactly: NONE'
	].join('\n');
}

export function parseNesResponse(text: string): NesPrediction | undefined {
	const cleaned = text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '').trim();
	if (!cleaned || /^NONE\b/.test(cleaned)) {
		return undefined;
	}
	const match = /<<<OLD\n([\s\S]*?)\n>>>NEW\n([\s\S]*?)\nEND/.exec(cleaned);
	if (!match) {
		return undefined;
	}
	const oldText = match[1];
	const newText = match[2];
	if (!oldText.trim() || oldText === newText) {
		return undefined;
	}
	return { oldText, newText };
}

/** Watches typing and keeps the freshest single-line edit per document. */
export class RecentEditTracker implements vscode.Disposable {
	private readonly edits = new Map<string, RecentEdit>();
	private readonly subscription: vscode.Disposable;

	constructor() {
		this.subscription = vscode.workspace.onDidChangeTextDocument(event => {
			const document = event.document;
			if (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled') {
				return;
			}
			for (const change of event.contentChanges) {
				// Single-line, human-scale edits carry intent; bulk changes
				// (paste, format, refactor) predict nothing useful.
				if (change.range.isSingleLine && change.text.length <= 120 && !change.text.includes('\n')) {
					const line = change.range.start.line;
					this.edits.set(document.uri.toString(), {
						uri: document.uri.toString(),
						line,
						before: '',
						after: document.lineAt(Math.min(line, document.lineCount - 1)).text,
						at: Date.now()
					});
				}
			}
		});
	}

	freshEdit(uri: vscode.Uri): RecentEdit | undefined {
		const edit = this.edits.get(uri.toString());
		return edit && Date.now() - edit.at < RECENT_EDIT_WINDOW_MS ? edit : undefined;
	}

	dispose(): void {
		this.subscription.dispose();
	}
}

/**
 * Locate the prediction's old text in the document, preferring the occurrence
 * nearest the recent edit; a text that no longer exists (or is ambiguous far
 * from the edit) yields nothing.
 */
export function locatePrediction(
	document: vscode.TextDocument,
	prediction: NesPrediction,
	nearLine: number
): vscode.Range | undefined {
	const content = document.getText();
	const needle = prediction.oldText;

	let best: number | undefined;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let index = content.indexOf(needle); index !== -1; index = content.indexOf(needle, index + 1)) {
		const line = document.positionAt(index).line;
		const distance = Math.abs(line - nearLine);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = index;
		}
	}
	if (best === undefined) {
		return undefined;
	}
	const start = document.positionAt(best);
	// The edit that triggered the prediction is not itself the next edit.
	if (start.line === nearLine) {
		return undefined;
	}
	return new vscode.Range(start, document.positionAt(best + needle.length));
}
