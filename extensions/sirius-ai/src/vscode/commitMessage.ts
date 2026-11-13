/*---------------------------------------------------------------------------------------------
 *  Sirius for VS Code — commit messages
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { writeCommitMessage } from '../scm/gitAssist';

/** How long a commit message may take before it is given up. */
const WRITE_MS = 120_000;
const NO_MODEL = 'Sirius has no model yet: add a provider\'s key in Models and Keys, or start a local server such as Ollama.';

/** The panel's side of a commit message: its model, and one question to it. */
export interface CommitModel {
	/**
	 * The model chosen in the panel, looked for first when none is found yet: a way to ask it, which
	 * throws when the model fails; or why there is none (undefined: no model at all).
	 */
	ask(): Promise<((prompt: string, signal: AbortSignal) => Promise<string>) | string | undefined>;
}

/**
 * Write Commit Message, in the Source Control view's title bar for a git repository (the message
 * box's own menu is a proposed API): Sirius IDE's commit message — the staged diff, else the
 * working tree's — written by the model chosen in the panel, into the repository's message box.
 * A failure says so and leaves the box as it was.
 */
export function registerCommitMessage(context: vscode.ExtensionContext, model: CommitModel): void {
	context.subscriptions.push(vscode.commands.registerCommand('sirius.commitMessage', async (...args: unknown[]) => {
		let why: string | undefined;
		await writeCommitMessage(args, async () => {
			const found = await model.ask();
			if (typeof found === 'string') {
				why = found;
				return undefined;
			}
			return found && (async prompt => {
				try {
					return await found(prompt, AbortSignal.timeout(WRITE_MS));
				} catch (error) {
					void vscode.window.showErrorMessage(`Sirius could not write the commit message: ${error instanceof Error ? error.message : String(error)}`);
					return undefined;
				}
			});
		}, () => {
			const setup = 'Open Models and Keys';
			void vscode.window.showWarningMessage(why ?? NO_MODEL, setup)
				.then(choice => choice === setup ? vscode.commands.executeCommand('sirius.panel.setup') : undefined);
		});
	}));
}
