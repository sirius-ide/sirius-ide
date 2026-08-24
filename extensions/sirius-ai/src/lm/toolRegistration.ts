/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Agent Tools for the Editor's Chat
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { TOOL_DEFINITIONS, SiriusToolExecutor } from '../tools/toolExecutor';

/**
 * Tool names are global across every extension, so Sirius's are prefixed. This
 * must match the `name` in the `languageModelTools` contribution.
 */
export function qualifiedToolName(name: string): string {
	return `sirius_${name}`;
}

/** Tools that change the user's files, and so need confirming before they run. */
const DESTRUCTIVE_TOOLS = new Set(['write_file', 'edit_file', 'run_terminal']);

/**
 * Register Sirius's tools with the editor so agent mode can actually do work.
 *
 * Removing the upstream Copilot extension took 39 tools with it, and the
 * workbench itself only registers two (rename and usages). Without these, the
 * editor's agent mode can reason but cannot read a file, edit one, search, or
 * run a command — so these are not a duplicate of upstream's, they are the only
 * ones Sirius has.
 *
 * Confirmation is handled here through `prepareInvocation`, which renders in the
 * chat itself, rather than by the executor's own modal — hence the
 * `skipConfirmation` flag on invoke.
 */
export function registerSiriusTools(
	context: vscode.ExtensionContext,
	executor: SiriusToolExecutor
): void {
	for (const definition of TOOL_DEFINITIONS) {
		const tool: vscode.LanguageModelTool<Record<string, unknown>> = {
			async invoke(options, _token) {
				const result = await executor.execute(
					{ id: '', name: definition.name, arguments: options.input },
					{ skipConfirmation: true }
				);

				// A failed tool still returns a result. The model needs to read what
				// went wrong, not be left waiting on a call it can see it made.
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(
						result.success ? result.output : `Tool failed: ${result.output}`
					)
				]);
			},

			prepareInvocation(options, _token) {
				const summary = describeInvocation(definition.name, options.input);
				if (!DESTRUCTIVE_TOOLS.has(definition.name)) {
					return { invocationMessage: summary };
				}

				return {
					invocationMessage: summary,
					confirmationMessages: {
						title: `Allow Sirius to ${summary.toLowerCase()}?`,
						message: 'This changes files or runs commands in your workspace.'
					}
				};
			}
		};

		context.subscriptions.push(vscode.lm.registerTool(qualifiedToolName(definition.name), tool));
	}
}

/** A short, human-readable line describing what a call is about to do. */
function describeInvocation(name: string, input: Record<string, unknown>): string {
	const path = typeof input.path === 'string' ? input.path : '';
	const query = typeof input.query === 'string' ? input.query : '';
	const command = typeof input.command === 'string' ? input.command : '';

	switch (name) {
		case 'read_file': return `Read ${path}`;
		case 'write_file': return `Write ${path}`;
		case 'edit_file': return `Edit ${path}`;
		case 'list_directory': return `List ${path || 'the workspace root'}`;
		case 'search_files': return `Search for "${query}"`;
		case 'search_web': return `Search the web for "${query}"`;
		case 'run_terminal': return `Run \`${command}\``;
		case 'get_diagnostics': return 'Check errors and warnings';
		default: return name;
	}
}
