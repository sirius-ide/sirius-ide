/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — where an MCP server's or another extension's tool comes from, in the editor's chat
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { ExternalSource } from './externalTools';

// A tool's `source` is proposed API, which Sirius IDE's built-in extension may use and the VS
// Code edition may not: the edition reads sources its own way (panel/tools.ts).

/** The source of a tool, when it is an MCP server or another extension. */
export function sourceOf(tool: vscode.LanguageModelToolInformation): Omit<ExternalSource, 'tools'> | undefined {
	const source = tool.source;
	if (source instanceof vscode.LanguageModelToolMCPSource) {
		return { key: `mcp:${source.label}`, kind: 'mcp', label: source.label, instructions: source.instructions };
	}
	if (source instanceof vscode.LanguageModelToolExtensionSource) {
		return { key: `extension:${source.id}`, kind: 'extension', label: source.label };
	}
	return undefined;
}

/** The external tools among `tools`, grouped by source, in a stable order. */
export function externalSources(tools: Iterable<vscode.LanguageModelToolInformation>): ExternalSource[] {
	const byKey = new Map<string, { meta: Omit<ExternalSource, 'tools'>; tools: vscode.LanguageModelToolInformation[] }>();
	for (const tool of tools) {
		const meta = sourceOf(tool);
		if (!meta) {
			continue;
		}
		const entry = byKey.get(meta.key) ?? { meta, tools: [] };
		entry.tools.push(tool);
		byKey.set(meta.key, entry);
	}
	return [...byKey.values()]
		.map(({ meta, tools }) => ({ ...meta, tools: tools.slice().sort((a, b) => a.name.localeCompare(b.name)) }))
		.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}
