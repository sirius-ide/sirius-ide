/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — paths a tool may touch
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

function isInside(root: vscode.Uri, candidate: vscode.Uri): boolean {
	if (root.scheme !== candidate.scheme || root.authority !== candidate.authority) {
		return false;
	}
	const base = root.path.replace(/\/+$/, '');
	return candidate.path === base || candidate.path.startsWith(`${base}/`);
}

/**
 * Resolve a path a model handed to a tool, and refuse anything outside the open
 * workspace folders.
 *
 * `Uri.joinPath` resolves `..`, so `../../etc/passwd` or `../.ssh/id_ed25519`
 * walked straight out of the workspace — for the read and list tools and for
 * `edit_file` / `create_file` alike. A model reads what the prompt steers it to,
 * and a prompt can come from a file it just read; the workspace is the boundary
 * the user chose when they opened the folder.
 *
 * Relative paths resolve against the first folder. An absolute path is accepted
 * when it lies inside any workspace folder, since models often echo the full
 * path the editor showed them.
 */
export function resolveWorkspacePath(input: string): vscode.Uri {
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length === 0) {
		throw new Error('No workspace folder is open.');
	}
	const raw = String(input ?? '').trim();
	const root = folders[0].uri;
	const absolute = raw.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(raw);
	const candidate = !absolute
		? vscode.Uri.joinPath(root, raw)
		: root.scheme === 'file' ? vscode.Uri.file(raw) : root.with({ path: raw });
	if (!folders.some(folder => isInside(folder.uri, candidate))) {
		throw new Error(`${raw} is outside the workspace. Only files inside the open folder can be read or changed.`);
	}
	return candidate;
}
