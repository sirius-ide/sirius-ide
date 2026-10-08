/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — paths a tool may touch
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';

/**
 * The workspace is the boundary the user chose when they opened the folder, and
 * every tool a model drives — read, list, search, edit, create — stays inside
 * it. A model reads what its prompt steers it to, and a prompt can come from a
 * file it just read; without a boundary `../../.ssh/id_ed25519` or
 * `../.bashrc` was one tool call away.
 *
 * The check is made on the normalised path (so `/ws/../x` is `/x`, not "under
 * /ws"), case-insensitively where the filesystem is, and — for local files — on
 * the real path, so a symlink checked into a repository cannot point out of it.
 */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

function normalisedPath(uri: vscode.Uri): string {
	const normal = path.posix.normalize(uri.path).replace(/\/+$/, '') || '/';
	return CASE_INSENSITIVE ? normal.toLowerCase() : normal;
}

function lexicallyInside(root: vscode.Uri, candidate: vscode.Uri): boolean {
	if (root.scheme !== candidate.scheme || root.authority !== candidate.authority) {
		return false;
	}
	const base = normalisedPath(root);
	const target = normalisedPath(candidate);
	return target === base || target.startsWith(base === '/' ? '/' : `${base}/`);
}

/** The real path of a file, or of its nearest existing ancestor joined with the rest (for a file not yet created). */
async function realPath(fsPath: string): Promise<string> {
	let existing = fsPath;
	const rest: string[] = [];
	for (; ;) {
		try {
			return path.join(await fs.realpath(existing), ...rest.reverse());
		} catch {
			const parent = path.dirname(existing);
			if (parent === existing) {
				return fsPath;
			}
			rest.push(path.basename(existing));
			existing = parent;
		}
	}
}

async function reallyInside(folders: readonly vscode.WorkspaceFolder[], candidate: vscode.Uri): Promise<boolean> {
	if (candidate.scheme !== 'file') {
		// Other filesystems (remote, virtual) offer no realpath here; the lexical
		// check above is what they get.
		return true;
	}
	const target = await realPath(candidate.fsPath);
	for (const folder of folders) {
		if (folder.uri.scheme === 'file' && lexicallyInside(vscode.Uri.file(await realPath(folder.uri.fsPath)), vscode.Uri.file(target))) {
			return true;
		}
	}
	return false;
}

/** Is this URI — say, a search result — inside the workspace, symlinks resolved? */
export async function isInWorkspace(uri: vscode.Uri): Promise<boolean> {
	const folders = vscode.workspace.workspaceFolders ?? [];
	return folders.some(folder => lexicallyInside(folder.uri, uri)) && await reallyInside(folders, uri);
}

/**
 * Resolve a path a model handed to a tool, and refuse anything outside the open
 * workspace folders.
 *
 * Relative paths resolve against the first folder — or, in a multi-root
 * workspace, against the folder whose name is their first segment, which is how
 * `asRelativePath` (and so the search and problems tools) writes them. An
 * absolute path is accepted when it lies inside a workspace folder, since models
 * often echo the full path the editor showed them.
 */
export async function resolveWorkspacePath(input: string): Promise<vscode.Uri> {
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length === 0) {
		throw new Error('No workspace folder is open.');
	}
	const raw = String(input ?? '').trim();
	const absolute = raw.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(raw);
	let candidate: vscode.Uri;
	if (absolute) {
		const root = folders[0].uri;
		candidate = root.scheme === 'file' ? vscode.Uri.file(raw) : root.with({ path: raw });
	} else {
		const [first, ...rest] = raw.split(/[\\/]/);
		const named = folders.length > 1 ? folders.find(folder => folder.name === first) : undefined;
		candidate = named ? vscode.Uri.joinPath(named.uri, ...rest) : vscode.Uri.joinPath(folders[0].uri, raw);
	}
	candidate = candidate.with({ path: path.posix.normalize(candidate.path) });
	if (!folders.some(folder => lexicallyInside(folder.uri, candidate)) || !await reallyInside(folders, candidate)) {
		throw new Error(`${raw} is outside the workspace. Only files inside the open folder can be read or changed.`);
	}
	return candidate;
}
