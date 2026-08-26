/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Tab completion
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { FimBackend, resolveFimBackend } from './fimClient';
import {
	buildNesPrompt, locatePrediction, parseNesResponse,
	NES_CONTEXT_LINES, RecentEditTracker
} from './nextEditPredictor';

const DEBOUNCE_MS = 180;
const PREFIX_CHARS = 2000;
const SUFFIX_CHARS = 600;
const CACHE_SIZE = 64;
const MAX_LINES_DEFAULT = 12;

/** Small LRU keyed by exact context, so a re-trigger at the same spot is free. */
class CompletionCache {
	private readonly entries = new Map<string, string>();

	get(key: string): string | undefined {
		const value = this.entries.get(key);
		if (value !== undefined) {
			this.entries.delete(key);
			this.entries.set(key, value);
		}
		return value;
	}

	set(key: string, value: string): void {
		this.entries.delete(key);
		this.entries.set(key, value);
		if (this.entries.size > CACHE_SIZE) {
			this.entries.delete(this.entries.keys().next().value!);
		}
	}
}

export class TabCompletionProvider implements vscode.InlineCompletionItemProvider {
	private readonly cache = new CompletionCache();
	private readonly recentEdits = new RecentEditTracker();
	private inflight: AbortController | undefined;
	private backend: FimBackend | undefined;
	private backendProbedAt = 0;

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken
	): Promise<vscode.InlineCompletionItem[]> {
		const config = vscode.workspace.getConfiguration('sirius.ai');
		const completionsOn = config.get<boolean>('inlineCompletions', false);
		const nesOn = config.get<boolean>('nextEditSuggestions.enabled', false);
		if (!completionsOn && !nesOn) {
			return [];
		}
		if (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled') {
			return [];
		}

		// Next-edit prediction: a fresh human-scale edit implies the next one.
		if (nesOn) {
			const nextEdit = await this.predictNextEdit(document, position, token);
			if (nextEdit) {
				return [nextEdit];
			}
		}
		if (!completionsOn) {
			return [];
		}

		const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position)).slice(-PREFIX_CHARS);
		const suffix = document.getText(
			new vscode.Range(position, new vscode.Position(document.lineCount, 0))
		).slice(0, SUFFIX_CHARS);

		// Nothing useful to complete at the very start of an empty file.
		if (!prefix.trim()) {
			return [];
		}

		const key = `${document.uri.toString()}#${prefix}#${suffix}`;
		const cached = this.cache.get(key);
		if (cached !== undefined) {
			return cached ? [this.item(cached, position)] : [];
		}

		// Debounce: while the user is mid-burst, the token cancels during this
		// wait and no request is ever made.
		await new Promise(resolve => setTimeout(resolve, DEBOUNCE_MS));
		if (token.isCancellationRequested) {
			return [];
		}

		// Re-resolve the backend at most every 30s, so starting Ollama after
		// the editor is already open gets noticed without a reload.
		if (!this.backend && Date.now() - this.backendProbedAt > 30_000) {
			this.backendProbedAt = Date.now();
			this.backend = await resolveFimBackend();
		}
		if (!this.backend || token.isCancellationRequested) {
			return [];
		}

		// Single flight: a newer keystroke aborts the older request for real,
		// releasing the local GPU or the metered API immediately.
		this.inflight?.abort();
		const controller = new AbortController();
		this.inflight = controller;
		token.onCancellationRequested(() => controller.abort());

		try {
			const raw = await this.backend.complete({
				prefix,
				suffix,
				maxTokens: 256,
				signal: controller.signal
			});
			const completion = this.clean(raw, suffix, config.get<number>('completions.maxLines', MAX_LINES_DEFAULT));
			this.cache.set(key, completion);
			return completion ? [this.item(completion, position)] : [];
		} catch {
			// Aborted or backend hiccup — either way, no suggestion. A failed
			// backend also gets re-probed on the next quiet moment.
			if (!controller.signal.aborted) {
				this.backend = undefined;
			}
			return [];
		} finally {
			if (this.inflight === controller) {
				this.inflight = undefined;
			}
		}
	}

	private async predictNextEdit(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<vscode.InlineCompletionItem | undefined> {
		const recent = this.recentEdits.freshEdit(document.uri);
		if (!recent) {
			return undefined;
		}
		if (!this.backend) {
			this.backend = await resolveFimBackend();
			if (!this.backend) {
				return undefined;
			}
		}

		const startLine = Math.max(0, position.line - NES_CONTEXT_LINES);
		const endLine = Math.min(document.lineCount - 1, position.line + NES_CONTEXT_LINES);
		const windowText = document.getText(new vscode.Range(startLine, 0, endLine, Number.MAX_SAFE_INTEGER));

		this.inflight?.abort();
		const controller = new AbortController();
		this.inflight = controller;
		token.onCancellationRequested(() => controller.abort());

		try {
			const raw = await this.backend.generate(buildNesPrompt(windowText, recent), 200, controller.signal);
			const prediction = parseNesResponse(raw);
			if (!prediction) {
				return undefined;
			}
			const range = locatePrediction(document, prediction, recent.line);
			if (!range || token.isCancellationRequested) {
				return undefined;
			}
			const item = new vscode.InlineCompletionItem(prediction.newText, range);
			(item as vscode.InlineCompletionItem & { isInlineEdit?: boolean; showRange?: vscode.Range }).isInlineEdit = true;
			(item as vscode.InlineCompletionItem & { isInlineEdit?: boolean; showRange?: vscode.Range }).showRange = range;
			return item;
		} catch {
			return undefined;
		} finally {
			if (this.inflight === controller) {
				this.inflight = undefined;
			}
		}
	}

	private item(text: string, position: vscode.Position): vscode.InlineCompletionItem {
		return new vscode.InlineCompletionItem(text, new vscode.Range(position, position));
	}

	/** Trim noise a FIM model can emit and cap the suggestion's size. */
	private clean(raw: string, suffix: string, maxLines: number): string {
		let text = raw.replace(/<\|[a-z_]+\|>/g, '');

		const lines = text.split('\n');
		if (lines.length > maxLines) {
			text = lines.slice(0, maxLines).join('\n');
		}

		// A completion that just retypes what already follows the cursor is
		// worse than none.
		const nextText = suffix.trimStart();
		if (nextText && text.trim() && nextText.startsWith(text.trim())) {
			return '';
		}

		return text.trimEnd() ? text : '';
	}
}
