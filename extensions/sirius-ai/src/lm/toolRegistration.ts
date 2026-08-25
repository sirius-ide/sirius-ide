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
					{ id: '', name: definition.name, arguments: options.input }
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
				// Every remaining Sirius tool is read-only; mutating work goes
				// through the workbench's own tools, which carry the review and
				// approval flows.
				return { invocationMessage: describeInvocation(definition.name, options.input) };
			}
		};

		context.subscriptions.push(vscode.lm.registerTool(qualifiedToolName(definition.name), tool));
	}
}

/** A short, human-readable line describing what a call is about to do. */
function describeInvocation(name: string, input: Record<string, unknown>): string {
	const path = typeof input.path === 'string' ? input.path : '';
	const query = typeof input.query === 'string' ? input.query : '';

	switch (name) {
		case 'read_file': return `Read ${path}`;
		case 'list_directory': return `List ${path || 'the workspace root'}`;
		case 'search_files': return `Search for "${query}"`;
		case 'search_web': return `Search the web for "${query}"`;
		case 'get_diagnostics': return 'Check errors and warnings';
		default: return name;
	}
}
