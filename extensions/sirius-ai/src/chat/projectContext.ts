/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — project rules and ambient context
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Phase 2, first brick: the agent reads the project's standing instructions
 * and knows what the user is looking at, on every request.
 *
 * Rules come from `.siriusrules` (ours) and `AGENTS.md` (the ecosystem
 * convention many tools already share) — both honoured so a repo configured
 * for any agentic editor steers Sirius too.
 */

const RULE_FILES = ['.siriusrules', '.sirius/rules.md', 'AGENTS.md'];

/** Standing instructions must not crowd out the task itself. */
const MAX_RULES_CHARS = 8000;

/** Lines of the active file surrounding the cursor offered as ambient context. */
const ACTIVE_CONTEXT_LINES = 60;
const MAX_ACTIVE_CONTEXT_CHARS = 6000;

export interface ProjectRules {
	readonly text: string;
	readonly sources: string[];
}

export function loadProjectRules(): ProjectRules {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) {
		return { text: '', sources: [] };
	}

	const sources: string[] = [];
	const parts: string[] = [];
	let budget = MAX_RULES_CHARS;

	for (const candidate of RULE_FILES) {
		const file = path.join(root, candidate);
		try {
			if (!fs.existsSync(file)) {
				continue;
			}
			const content = fs.readFileSync(file, 'utf8').trim();
			if (!content) {
				continue;
			}
			const clipped = content.length > budget ? content.slice(0, budget) + '\n[rules truncated]' : content;
			parts.push(`# From ${candidate}\n${clipped}`);
			sources.push(candidate);
			budget -= clipped.length;
			if (budget <= 0) {
				break;
			}
		} catch {
			// Unreadable rules never block a request.
		}
	}

	return { text: parts.join('\n\n'), sources };
}

/**
 * What the user is looking at right now — file, language, and either their
 * selection or the code around the cursor. Editors that are not text (the
 * chat panel itself, settings UI) contribute nothing.
 */
export function activeEditorContext(): string {
	const editor = vscode.window.activeTextEditor;
	if (!editor || editor.document.uri.scheme !== 'file') {
		return '';
	}

	const document = editor.document;
	const relative = vscode.workspace.asRelativePath(document.uri);

	let snippet: string;
	let where: string;
	if (!editor.selection.isEmpty) {
		snippet = document.getText(editor.selection);
		where = `selection, lines ${editor.selection.start.line + 1}-${editor.selection.end.line + 1}`;
	} else {
		const line = editor.selection.active.line;
		const start = Math.max(0, line - ACTIVE_CONTEXT_LINES);
		const end = Math.min(document.lineCount - 1, line + ACTIVE_CONTEXT_LINES);
		snippet = document.getText(new vscode.Range(start, 0, end, Number.MAX_SAFE_INTEGER));
		where = `around line ${line + 1}`;
	}

	if (snippet.length > MAX_ACTIVE_CONTEXT_CHARS) {
		snippet = snippet.slice(0, MAX_ACTIVE_CONTEXT_CHARS) + '\n[truncated]';
	}

	return [
		`The user currently has ${relative} open (${document.languageId}; ${where}):`,
		'```' + document.languageId,
		snippet,
		'```'
	].join('\n');
}

/** Support surface: lets people (and the test harness) see what the agent sees. */
export function registerProjectContextDebug(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.commands.registerCommand('sirius.ai.debug.projectContext', () => {
		const rules = loadProjectRules();
		const active = activeEditorContext();
		return {
			ruleSources: rules.sources,
			rulesChars: rules.text.length,
			activeContextChars: active.length
		};
	}));
}
