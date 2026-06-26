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

// ─── Tool Definitions ────────────────────────────────────────────────────────

export interface ToolCall {
	name: string;
	arguments: Record<string, any>;
}

export interface ToolResult {
	success: boolean;
	output: string;
	/** Optional data for rich rendering (images, links, etc.) */
	data?: any;
}

/**
 * All available tools the AI can use
 */
export const TOOL_DEFINITIONS = [
	{
		name: 'read_file',
		description: 'Read the contents of a file in the workspace',
		parameters: {
			path: { type: 'string', description: 'Relative path to the file' },
			startLine: { type: 'number', description: 'Optional start line (1-indexed)', optional: true },
			endLine: { type: 'number', description: 'Optional end line (1-indexed)', optional: true }
		}
	},
	{
		name: 'write_file',
		description: 'Write or create a file in the workspace',
		parameters: {
			path: { type: 'string', description: 'Relative path to the file' },
			content: { type: 'string', description: 'Content to write to the file' }
		}
	},
	{
		name: 'edit_file',
		description: 'Replace specific content in a file',
		parameters: {
			path: { type: 'string', description: 'Relative path to the file' },
			search: { type: 'string', description: 'Exact text to find' },
			replace: { type: 'string', description: 'Replacement text' }
		}
	},
	{
		name: 'search_files',
		description: 'Search for text across workspace files (like grep)',
		parameters: {
			query: { type: 'string', description: 'Search query (text or regex)' },
			include: { type: 'string', description: 'Glob pattern to include (e.g. "**/*.ts")', optional: true },
			maxResults: { type: 'number', description: 'Max results (default 20)', optional: true }
		}
	},
	{
		name: 'list_directory',
		description: 'List files and directories at a given path',
		parameters: {
			path: { type: 'string', description: 'Relative path to directory (empty for root)' }
		}
	},
	{
		name: 'run_terminal',
		description: 'Execute a shell command in the integrated terminal',
		parameters: {
			command: { type: 'string', description: 'Shell command to execute' },
			cwd: { type: 'string', description: 'Working directory (relative)', optional: true }
		}
	},
	{
		name: 'search_web',
		description: 'Search the web for information (opens browser or returns search URL)',
		parameters: {
			query: { type: 'string', description: 'Search query' }
		}
	},
	{
		name: 'get_diagnostics',
		description: 'Get current errors and warnings from the workspace',
		parameters: {
			file: { type: 'string', description: 'Optional specific file path', optional: true }
		}
	}
] as const;

// ─── Tool Executor ───────────────────────────────────────────────────────────

/**
 * Executes tool calls from the AI and returns results.
 * This is the core engine that gives Sirius Antigravity-like capabilities.
 */
export class SiriusToolExecutor {

	/**
	 * Execute a tool call and return the result
	 */
	async execute(tool: ToolCall): Promise<ToolResult> {
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

	/**
	 * Get the tools description for injection into system prompt
	 */
	getToolsSystemPrompt(): string {
		return `\n\nYou have access to the following tools. To use a tool, respond with a JSON block wrapped in \`\`\`tool tags:

\`\`\`tool
{"name": "tool_name", "arguments": {"param": "value"}}
\`\`\`

Available tools:
${TOOL_DEFINITIONS.map(t => `- **${t.name}**: ${t.description}`).join('\n')}

Use tools when the user asks you to search files, read code, make changes, run commands, or look up information. Always explain what you're doing before using a tool.`;
	}

	/**
	 * Parse tool calls from AI response text
	 */
	parseToolCalls(text: string): ToolCall[] {
		const toolCalls: ToolCall[] = [];
		const regex = /```tool\s*\n([\s\S]*?)```/g;
		let match;

		while ((match = regex.exec(text)) !== null) {
			try {
				const parsed = JSON.parse(match[1].trim());
				if (parsed.name && parsed.arguments) {
					toolCalls.push(parsed);
				}
			} catch {
				// Skip malformed tool calls
			}
		}

		return toolCalls;
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
