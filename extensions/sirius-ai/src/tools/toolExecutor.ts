/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — AI Tools System (Search, File Ops, Terminal, Tasks)
 *  Copyright (c) Arshad Siddiqui. All rights reserved.
 *  Licensed under the MIT License.
 *
 *  Provides tool capabilities to the AI agent, similar to Google Antigravity's
 *  built-in tools for web search, file operations, terminal execution, and
 *  task management.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ToolDefinition, ToolCallRequest } from '../types';

// ─── Tool Definitions ────────────────────────────────────────────────────────

export interface ToolResult {
	success: boolean;
	output: string;
	/** Optional data for rich rendering (images, links, etc.) */
	data?: unknown;
}

/**
 * Every tool the agent can call, described as JSON Schema.
 *
 * Each provider wraps these in its own envelope — Anthropic wants
 * `input_schema`, the OpenAI-shaped APIs want `function.parameters` — but the
 * schema itself is identical, so it is written once here.
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
	{
		name: 'read_file',
		description: 'Read the contents of a file in the workspace. Prefer a line range for large files.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Path relative to the workspace root' },
				startLine: { type: 'number', description: 'First line to read, 1-indexed' },
				endLine: { type: 'number', description: 'Last line to read, 1-indexed' }
			},
			required: ['path']
		}
	},
	{
		name: 'write_file',
		description: 'Create a file, or replace an existing file entirely. Use edit_file for targeted changes.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Path relative to the workspace root' },
				content: { type: 'string', description: 'Full contents to write' }
			},
			required: ['path', 'content']
		}
	},
	{
		name: 'edit_file',
		description: 'Replace an exact span of text in a file. The search text must match exactly and appear once.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Path relative to the workspace root' },
				search: { type: 'string', description: 'Exact text to find' },
				replace: { type: 'string', description: 'Text to put in its place' }
			},
			required: ['path', 'search', 'replace']
		}
	},
	{
		name: 'search_files',
		description: 'Search workspace files for a literal string, like grep.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Text to search for' },
				include: { type: 'string', description: 'Glob of files to include, e.g. "**/*.ts"' },
				maxResults: { type: 'number', description: 'Maximum matches to return, default 20' }
			},
			required: ['query']
		}
	},
	{
		name: 'list_directory',
		description: 'List the files and directories at a path in the workspace.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Path relative to the workspace root; empty for the root itself' }
			},
			required: []
		}
	},
	{
		name: 'run_terminal',
		description: 'Run a shell command in the integrated terminal. The user is asked to confirm first.',
		inputSchema: {
			type: 'object',
			properties: {
				command: { type: 'string', description: 'Command to run' },
				cwd: { type: 'string', description: 'Working directory relative to the workspace root' }
			},
			required: ['command']
		}
	},
	{
		name: 'search_web',
		description: 'Open a web search in the default browser.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'What to search for' }
			},
			required: ['query']
		}
	},
	{
		name: 'get_diagnostics',
		description: 'Get current errors and warnings reported in the workspace.',
		inputSchema: {
			type: 'object',
			properties: {
				file: { type: 'string', description: 'Limit results to paths containing this string' }
			},
			required: []
		}
	}
];

// ─── Tool Executor ───────────────────────────────────────────────────────────

/**
 * Executes tool calls from the AI and returns results.
 * This is the core engine that gives Sirius Antigravity-like capabilities.
 */
export class SiriusToolExecutor {

	/** Set once the user opts into unattended file writes for this session. */
	private _alwaysAllowWrites = false;

	/**
	 * Ask before a tool touches the user's files.
	 *
	 * These tools replace content with no diff, no preview and no undo, and the
	 * agent loop now genuinely drives them. Until edits are routed through the
	 * editor's chat-editing session — which brings its own review and rollback —
	 * this prompt is the only thing between a misread instruction and lost work.
	 */
	private async _confirmWrite(summary: string): Promise<boolean> {
		if (this._alwaysAllowWrites) {
			return true;
		}

		const allowOnce = 'Allow';
		const allowSession = 'Allow for This Session';
		const choice = await vscode.window.showWarningMessage(
			`★ Sirius AI wants to ${summary}`,
			allowOnce,
			allowSession
		);

		if (choice === allowSession) {
			this._alwaysAllowWrites = true;
			return true;
		}
		return choice === allowOnce;
	}

	/**
	 * Execute a tool call and return the result
	 */
	async execute(tool: ToolCallRequest): Promise<ToolResult> {
		switch (tool.name) {
			case 'read_file':
				return this._readFile(tool.arguments);
			case 'write_file':
				return this._writeFile(tool.arguments);
			case 'edit_file':
				return this._editFile(tool.arguments);
			case 'search_files':
				return this._searchFiles(tool.arguments);
			case 'list_directory':
				return this._listDirectory(tool.arguments);
			case 'run_terminal':
				return this._runTerminal(tool.arguments);
			case 'search_web':
				return this._searchWeb(tool.arguments);
			case 'get_diagnostics':
				return this._getDiagnostics(tool.arguments);
			default:
				return { success: false, output: `Unknown tool: ${tool.name}` };
		}
	}

	// ─── Tool Implementations ────────────────────────────────────────────────

	private async _readFile(args: Record<string, any>): Promise<ToolResult> {
		try {
			const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
			if (!rootUri) { return { success: false, output: 'No workspace open' }; }

			const fileUri = vscode.Uri.joinPath(rootUri, args.path);
			const data = await vscode.workspace.fs.readFile(fileUri);
			let content = new TextDecoder().decode(data);

			// Apply line range if specified
			if (args.startLine || args.endLine) {
				const lines = content.split('\n');
				const start = Math.max(0, (args.startLine || 1) - 1);
				const end = Math.min(lines.length, args.endLine || lines.length);
				content = lines.slice(start, end).map((line, i) =>
					`${start + i + 1}: ${line}`
				).join('\n');
			}

			return { success: true, output: content };
		} catch (e: any) {
			return { success: false, output: `Failed to read file: ${e.message}` };
		}
	}

	private async _writeFile(args: Record<string, any>): Promise<ToolResult> {
		try {
			const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
			if (!rootUri) { return { success: false, output: 'No workspace open' }; }

			if (!await this._confirmWrite(`write ${args.path}`)) {
				return { success: false, output: 'The user declined the write.' };
			}

			const fileUri = vscode.Uri.joinPath(rootUri, args.path);
			const data = new TextEncoder().encode(args.content);
			await vscode.workspace.fs.writeFile(fileUri, data);

			// Open the file in editor
			const doc = await vscode.workspace.openTextDocument(fileUri);
			await vscode.window.showTextDocument(doc, { preview: true });

			return { success: true, output: `✅ File written: ${args.path}` };
		} catch (e: any) {
			return { success: false, output: `Failed to write file: ${e.message}` };
		}
	}

	private async _editFile(args: Record<string, any>): Promise<ToolResult> {
		try {
			const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
			if (!rootUri) { return { success: false, output: 'No workspace open' }; }

			const fileUri = vscode.Uri.joinPath(rootUri, args.path);
			const data = await vscode.workspace.fs.readFile(fileUri);
			let content = new TextDecoder().decode(data);

			if (!content.includes(args.search)) {
				return { success: false, output: `Search text not found in ${args.path}` };
			}

			if (!await this._confirmWrite(`edit ${args.path}`)) {
				return { success: false, output: 'The user declined the edit.' };
			}

			content = content.replace(args.search, args.replace);
			await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(content));

			// Open and show the file
			const doc = await vscode.workspace.openTextDocument(fileUri);
			await vscode.window.showTextDocument(doc, { preview: true });

			return { success: true, output: `✅ File edited: ${args.path}` };
		} catch (e: any) {
			return { success: false, output: `Failed to edit file: ${e.message}` };
		}
	}

	private async _searchFiles(args: Record<string, any>): Promise<ToolResult> {
		try {
			const include = args.include || '**/*';
			const maxResults = args.maxResults || 20;

			const results: string[] = [];
			const files = await vscode.workspace.findFiles(include, '**/node_modules/**', 100);

			for (const file of files) {
				if (results.length >= maxResults) { break; }

				try {
					const data = await vscode.workspace.fs.readFile(file);
					const content = new TextDecoder().decode(data);
					const lines = content.split('\n');

					for (let i = 0; i < lines.length; i++) {
						if (results.length >= maxResults) { break; }
						if (lines[i].includes(args.query)) {
							const relativePath = vscode.workspace.asRelativePath(file);
							results.push(`${relativePath}:${i + 1}: ${lines[i].trim()}`);
						}
					}
				} catch {
					// Skip unreadable files
				}
			}

			if (results.length === 0) {
				return { success: true, output: `No results found for "${args.query}"` };
			}

			return { success: true, output: `Found ${results.length} results:\n\n${results.join('\n')}` };
		} catch (e: any) {
			return { success: false, output: `Search failed: ${e.message}` };
		}
	}

	private async _listDirectory(args: Record<string, any>): Promise<ToolResult> {
		try {
			const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
			if (!rootUri) { return { success: false, output: 'No workspace open' }; }

			const dirUri = args.path
				? vscode.Uri.joinPath(rootUri, args.path)
				: rootUri;

			const entries = await vscode.workspace.fs.readDirectory(dirUri);
			const skipDirs = new Set(['node_modules', '.git', '__pycache__', '.next', 'dist']);

			const listing = entries
				.filter(([name]) => !skipDirs.has(name))
				.sort((a, b) => {
					if (a[1] === b[1]) { return a[0].localeCompare(b[0]); }
					return a[1] === vscode.FileType.Directory ? -1 : 1;
				})
				.map(([name, type]) =>
					type === vscode.FileType.Directory ? `📁 ${name}/` : `📄 ${name}`
				)
				.join('\n');

			return { success: true, output: listing || '(empty directory)' };
		} catch (e: any) {
			return { success: false, output: `Failed to list directory: ${e.message}` };
		}
	}

	private async _runTerminal(args: Record<string, any>): Promise<ToolResult> {
		// Show confirmation before running commands
		const confirm = await vscode.window.showWarningMessage(
			`★ Sirius AI wants to run: \`${args.command}\``,
			'Run', 'Cancel'
		);

		if (confirm !== 'Run') {
			return { success: false, output: 'Command execution cancelled by user.' };
		}

		const terminal = vscode.window.createTerminal({
			name: `★ Sirius: ${args.command.substring(0, 30)}`,
			cwd: args.cwd ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, args.cwd) : undefined
		});

		terminal.show();
		terminal.sendText(args.command);

		return { success: true, output: `✅ Command sent to terminal: \`${args.command}\`\n(Check the terminal for output)` };
	}

	private async _searchWeb(args: Record<string, any>): Promise<ToolResult> {
		const query = encodeURIComponent(args.query);
		const url = `https://www.google.com/search?q=${query}`;

		await vscode.env.openExternal(vscode.Uri.parse(url));

		return {
			success: true,
			output: `🔍 Opened web search for: "${args.query}"\n\nURL: ${url}`
		};
	}

	private async _getDiagnostics(args: Record<string, any>): Promise<ToolResult> {
		const allDiagnostics = vscode.languages.getDiagnostics();
		const issues: string[] = [];

		for (const [uri, diagnostics] of allDiagnostics) {
			const relativePath = vscode.workspace.asRelativePath(uri);

			if (args.file && !relativePath.includes(args.file)) { continue; }

			for (const d of diagnostics) {
				if (d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning) {
					const severity = d.severity === vscode.DiagnosticSeverity.Error ? '❌' : '⚠️';
					issues.push(`${severity} ${relativePath}:${d.range.start.line + 1} — ${d.message}`);
				}
			}
		}

		if (issues.length === 0) {
			return { success: true, output: '✅ No errors or warnings found.' };
		}

		return { success: true, output: `Found ${issues.length} issues:\n\n${issues.join('\n')}` };
	}
}
