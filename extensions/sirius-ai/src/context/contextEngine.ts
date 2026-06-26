/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Workspace Context Engine
 *  Copyright (c) Arshad Siddiqui. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ContextBlock, ContextType } from '../types';

/**
 * Gathers workspace context to inject into AI chat messages.
 * Supports @file, @selection, @workspace, @terminal, @errors, @git tags.
 */
export class WorkspaceContextEngine {

	/**
	 * Parse context tags from a message and return enriched context
	 */
	async resolveContextTags(text: string): Promise<{ cleanText: string; context: ContextBlock[] }> {
		const context: ContextBlock[] = [];
		let cleanText = text;

		// @selection — currently selected code
		if (text.includes('@selection')) {
			const block = await this.getSelectionContext();
			if (block) { context.push(block); }
			cleanText = cleanText.replace(/@selection/g, '');
		}

		// @file — current file content
		if (text.includes('@file')) {
			const block = await this.getFileContext();
			if (block) { context.push(block); }
			cleanText = cleanText.replace(/@file/g, '');
		}

		// @workspace — workspace file tree
		if (text.includes('@workspace')) {
			const block = await this.getWorkspaceTree();
			if (block) { context.push(block); }
			cleanText = cleanText.replace(/@workspace/g, '');
		}

		// @terminal — recent terminal output
		if (text.includes('@terminal')) {
			const block = await this.getTerminalContext();
			if (block) { context.push(block); }
			cleanText = cleanText.replace(/@terminal/g, '');
		}

		// @errors — current diagnostics
		if (text.includes('@errors')) {
			const block = await this.getDiagnosticsContext();
			if (block) { context.push(block); }
			cleanText = cleanText.replace(/@errors/g, '');
		}

		// @git — git status and diff
		if (text.includes('@git')) {
			const block = await this.getGitContext();
			if (block) { context.push(block); }
			cleanText = cleanText.replace(/@git/g, '');
		}

		return { cleanText: cleanText.trim(), context };
	}

	/**
	 * Build a context string from resolved blocks
	 */
	formatContextBlocks(blocks: ContextBlock[]): string {
		if (blocks.length === 0) { return ''; }

		return '\n\n' + blocks.map(b =>
			`--- ${b.label} ---\n${b.content}`
		).join('\n\n');
	}

	// ─── Individual Context Providers ────────────────────────────────────────

	private async getSelectionContext(): Promise<ContextBlock | null> {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.selection.isEmpty) { return null; }

		const selection = editor.document.getText(editor.selection);
		const lang = editor.document.languageId;
		const fileName = editor.document.fileName.split('/').pop() || 'unknown';
		const startLine = editor.selection.start.line + 1;
		const endLine = editor.selection.end.line + 1;

		return {
			type: 'selection',
			label: `Selected Code (${fileName}:${startLine}-${endLine})`,
			content: `\`\`\`${lang}\n${selection}\n\`\`\``
		};
	}

	private async getFileContext(): Promise<ContextBlock | null> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) { return null; }

		const content = editor.document.getText();
		const lang = editor.document.languageId;
		const fileName = editor.document.fileName.split('/').pop() || 'unknown';
		const lineCount = editor.document.lineCount;

		// Truncate very large files
		const maxLines = 500;
		const truncated = content.split('\n').slice(0, maxLines).join('\n');
		const wasTruncated = lineCount > maxLines;

		return {
			type: 'file',
			label: `Current File: ${fileName} (${lineCount} lines)`,
			content: `\`\`\`${lang}\n${truncated}\n\`\`\`${wasTruncated ? `\n(truncated — showing first ${maxLines} of ${lineCount} lines)` : ''}`
		};
	}

	async getWorkspaceTree(): Promise<ContextBlock | null> {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) { return null; }

		const rootUri = folders[0].uri;
		const tree = await this._buildTree(rootUri, '', 0, 3); // max depth 3

		return {
			type: 'workspace',
			label: `Workspace Structure: ${folders[0].name}`,
			content: tree
		};
	}

	private async _buildTree(uri: vscode.Uri, prefix: string, depth: number, maxDepth: number): Promise<string> {
		if (depth >= maxDepth) { return prefix + '...\n'; }

		try {
			const entries = await vscode.workspace.fs.readDirectory(uri);
			let result = '';

			// Sort: directories first, then files
			const sorted = entries.sort((a, b) => {
				if (a[1] === b[1]) { return a[0].localeCompare(b[0]); }
				return a[1] === vscode.FileType.Directory ? -1 : 1;
			});

			// Skip common non-essential dirs
			const skipDirs = new Set(['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', '.vscode', '.sirius', 'out', 'coverage', '.cache']);

			let count = 0;
			for (const [name, type] of sorted) {
				if (count > 50) {
					result += prefix + `... and ${sorted.length - count} more\n`;
					break;
				}

				if (type === vscode.FileType.Directory) {
					if (skipDirs.has(name)) { continue; }
					result += prefix + `📁 ${name}/\n`;
					const childUri = vscode.Uri.joinPath(uri, name);
					result += await this._buildTree(childUri, prefix + '  ', depth + 1, maxDepth);
				} else {
					result += prefix + `📄 ${name}\n`;
				}
				count++;
			}

			return result;
		} catch {
			return prefix + '(unable to read)\n';
		}
	}

	private async getTerminalContext(): Promise<ContextBlock | null> {
		// VS Code API doesn't expose terminal buffer directly
		// We provide instructions for the user to use the terminal
		const terminals = vscode.window.terminals;
		if (terminals.length === 0) {
			return {
				type: 'terminal',
				label: 'Terminal',
				content: '(No active terminals)'
			};
		}

		return {
			type: 'terminal',
			label: `Active Terminals (${terminals.length})`,
			content: terminals.map((t, i) =>
				`Terminal ${i + 1}: "${t.name}"`
			).join('\n') + '\n\n(Note: Terminal output buffer is not directly accessible via VS Code API. For recent output, copy and paste from the terminal.)'
		};
	}

	private async getDiagnosticsContext(): Promise<ContextBlock | null> {
		const allDiagnostics = vscode.languages.getDiagnostics();
		const issues: string[] = [];

		for (const [uri, diagnostics] of allDiagnostics) {
			const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
			const warnings = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Warning);

			if (errors.length > 0 || warnings.length > 0) {
				const fileName = uri.path.split('/').pop() || uri.path;
				for (const d of [...errors, ...warnings]) {
					const severity = d.severity === vscode.DiagnosticSeverity.Error ? '❌' : '⚠️';
					issues.push(`${severity} ${fileName}:${d.range.start.line + 1} — ${d.message}`);
				}
			}
		}

		if (issues.length === 0) {
			return {
				type: 'errors',
				label: 'Diagnostics',
				content: '✅ No errors or warnings found in workspace.'
			};
		}

		return {
			type: 'errors',
			label: `Diagnostics (${issues.length} issues)`,
			content: issues.slice(0, 30).join('\n') + (issues.length > 30 ? `\n... and ${issues.length - 30} more` : '')
		};
	}

	private async getGitContext(): Promise<ContextBlock | null> {
		try {
			const gitExt = vscode.extensions.getExtension('vscode.git')?.exports;
			const api = gitExt?.getAPI?.(1);
			if (!api || api.repositories.length === 0) {
				return { type: 'git', label: 'Git', content: '(No git repository found)' };
			}

			const repo = api.repositories[0];
			const head = repo.state?.HEAD;
			const changes = repo.state?.workingTreeChanges || [];
			const staged = repo.state?.indexChanges || [];

			let content = `Branch: ${head?.name || 'unknown'}\n`;
			content += `Commit: ${head?.commit?.substring(0, 8) || 'none'}\n\n`;

			if (staged.length > 0) {
				content += `Staged (${staged.length}):\n`;
				for (const c of staged.slice(0, 15)) {
					content += `  + ${c.uri.path.split('/').pop()}\n`;
				}
			}

			if (changes.length > 0) {
				content += `Changed (${changes.length}):\n`;
				for (const c of changes.slice(0, 15)) {
					content += `  M ${c.uri.path.split('/').pop()}\n`;
				}
			}

			if (changes.length === 0 && staged.length === 0) {
				content += 'Working tree clean.';
			}

			return { type: 'git', label: 'Git Status', content };
		} catch {
			return { type: 'git', label: 'Git', content: '(Unable to access git status)' };
		}
	}
}
