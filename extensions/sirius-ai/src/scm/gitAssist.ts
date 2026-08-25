/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — SCM assistance: commit messages and merge conflicts
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/** The slice of the vscode.git extension API these commands need. */
interface GitRepository {
	readonly rootUri: vscode.Uri;
	readonly inputBox: { value: string };
	readonly state: { mergeChanges: ReadonlyArray<{ uri: vscode.Uri }> };
	diff(cached: boolean): Promise<string>;
}

interface GitApi {
	readonly repositories: GitRepository[];
}

/** Keep prompts bounded: a huge diff drowns the model and slows the button. */
const MAX_DIFF_CHARS = 12_000;

function gitApi(): GitApi | undefined {
	const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
	return extension?.exports?.getAPI(1);
}

/**
 * The workbench forwards the SCM action's own arguments, whose exact shape is
 * an internal detail. Matching by root URI when one is recognisable and
 * falling back to the first repository covers both.
 */
function pickRepository(git: GitApi, args: unknown[]): GitRepository | undefined {
	for (const arg of args) {
		const root = (arg as { rootUri?: vscode.Uri })?.rootUri;
		if (root) {
			const match = git.repositories.find(r => r.rootUri.toString() === root.toString());
			if (match) {
				return match;
			}
		}
	}

	return git.repositories[0];
}

async function generateCommitMessage(...args: unknown[]): Promise<void> {
	const git = gitApi();
	const repository = git && pickRepository(git, args);
	if (!repository) {
		vscode.window.showWarningMessage('Sirius: no git repository found.');
		return;
	}

	let diff = await repository.diff(true);
	if (!diff.trim()) {
		diff = await repository.diff(false);
	}
	if (!diff.trim()) {
		vscode.window.showInformationMessage('Sirius: nothing staged or changed to describe.');
		return;
	}

	const [model] = await vscode.lm.selectChatModels({ vendor: 'sirius' });
	if (!model) {
		vscode.window.showWarningMessage('Sirius: no model available — add a provider key with "Sirius: Set API Key", or start Ollama.');
		return;
	}

	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.SourceControl, title: 'Generating commit message…' },
		async () => {
			const truncated = diff.length > MAX_DIFF_CHARS
				? diff.slice(0, MAX_DIFF_CHARS) + '\n[diff truncated]'
				: diff;

			const response = await model.sendRequest([
				vscode.LanguageModelChatMessage.User(
					'Write a commit message for this diff. First line: an imperative summary under 72 characters. ' +
					'If the change genuinely needs explanation, add a blank line and a short body. ' +
					'Reply with the commit message only — no quotes, no code fences.\n\n' + truncated
				)
			], {}, new vscode.CancellationTokenSource().token);

			let message = '';
			for await (const part of response.text) {
				message += part;
			}
			repository.inputBox.value = message.trim();
		}
	);
}

/**
 * Conflicts are an editing task, so they belong to the agent — which applies
 * changes through the workbench's reviewed edit flow rather than blind writes.
 */
async function resolveMergeConflicts(...args: unknown[]): Promise<void> {
	const git = gitApi();
	const repository = git && pickRepository(git, args);
	const conflicted = repository?.state.mergeChanges ?? [];
	if (conflicted.length === 0) {
		vscode.window.showInformationMessage('Sirius: no merge conflicts to resolve.');
		return;
	}

	const files = conflicted.map(change => vscode.workspace.asRelativePath(change.uri)).join(', ');
	await vscode.commands.executeCommand('workbench.action.chat.open', {
		query: `Resolve the merge conflicts in: ${files}. Read each file, understand both sides of every conflict, and apply a resolution that keeps the intent of both changes. Explain each resolution briefly as you go.`
	});
}

export function registerGitAssist(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('sirius.ai.generateCommitMessage', generateCommitMessage),
		vscode.commands.registerCommand('sirius.ai.resolveMergeConflicts', resolveMergeConflicts)
	);
}
