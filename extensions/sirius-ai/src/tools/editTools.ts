/*---------------------------------------------------------------------------------------------
 *  Sirius — the tools that change files: their schemas and how a change finds its place
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// Shared by Sirius IDE's chat (chat/siriusAgent.ts, where a change goes into the editor's own
// editing session) and the VS Code edition's panel (panel/edits.ts, where the user reviews it in
// a diff): both faces offer a model the same two tools, described the same way. No editor API here.

import type { ToolDefinition } from '../types';

export const EDIT_FILE: ToolDefinition = {
	name: 'edit_file',
	description: 'Replace an exact span of text in an existing file. The search text must match exactly and appear exactly once.',
	inputSchema: {
		type: 'object',
		properties: {
			path: { type: 'string', description: 'Path relative to the workspace root' },
			search: { type: 'string', description: 'Exact text to find' },
			replace: { type: 'string', description: 'Text to put in its place' }
		},
		required: ['path', 'search', 'replace']
	}
};

export const CREATE_FILE: ToolDefinition = {
	name: 'create_file',
	description: 'Create a new file with the given contents. Fails if the file already exists — use edit_file for that.',
	inputSchema: {
		type: 'object',
		properties: {
			path: { type: 'string', description: 'Path relative to the workspace root' },
			content: { type: 'string', description: 'Full contents of the new file' }
		},
		required: ['path', 'content']
	}
};

/** Where `search` sits in `content` — once, exactly — or what the model is told when it does not. */
export function locate(content: string, search: string): { readonly start: number; readonly end: number } | string {
	const first = content.indexOf(search);
	if (first === -1) {
		return 'Search text not found. Read the file again — it may have changed.';
	}
	if (content.indexOf(search, first + 1) !== -1) {
		return 'Search text appears more than once; include more surrounding context to make it unique.';
	}
	return { start: first, end: first + search.length };
}
