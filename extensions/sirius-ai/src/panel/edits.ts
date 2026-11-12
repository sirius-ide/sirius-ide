/*---------------------------------------------------------------------------------------------
 *  Sirius — the panel's changes to files: proposed, shown in VS Code's diff editor, applied
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as nodePath from 'path';
import { CREATE_FILE, EDIT_FILE, locate } from '../tools/editTools';
import { isInWorkspace, realPath, resolveWorkspacePath } from '../tools/workspacePath';
import type { ToolDefinition } from '../types';

/** A change waiting on the user: the diff editor's title bar offers Accept and Reject on it. */
export const PROPOSAL_SCHEME = 'sirius-proposal';
/** A change already decided, shown again from its card: only to look at. */
export const CHANGE_SCHEME = 'sirius-change';

/** The tools that change files, as the panel offers them in Edit and Agent: Sirius IDE's two, under Sirius's prefix. */
export const EDIT_TOOLS: readonly ToolDefinition[] = [EDIT_FILE, CREATE_FILE].map(definition => ({ ...definition, name: `sirius_${definition.name}` }));
export const EDIT_NAMES: ReadonlySet<string> = new Set(EDIT_TOOLS.map(tool => tool.name));

/** What the diffs may hold before the oldest decided ones are let go, in characters. */
const MAX_KEPT_CHARS = 16 * 1024 * 1024;
/** How long a change's Accept and Reject in the diff editor take no click once it is shown: a click meant for the change before. */
export const ARM_MS = 500;

/** A change a model asked for, as it would leave the file. */
export interface Proposal {
	readonly uri: vscode.Uri;
	/** The file, as the workspace names it. */
	readonly path: string;
	readonly kind: 'edit' | 'create';
	/** The file's text when the change was proposed, unsaved edits included; empty for a new file. */
	readonly original: string;
	readonly proposed: string;
	/** What an edit replaces, and with what — applied again to the file as it is when accepted. */
	readonly search: string;
	readonly replace: string;
	readonly added: number;
	readonly removed: number;
	/** A file that can run code when written: asked about even under Auto-accept edits. */
	readonly guarded: boolean;
}

/** A text's lines; a last line break ends the last line rather than starting another. */
function lines(text: string): string[] {
	const split = text === '' ? [] : text.split(/\r?\n/);
	if (split[split.length - 1] === '') {
		split.pop();
	}
	return split;
}

/** Lines `after` adds and removes against `before`: what differs between their common start and end. */
export function lineCounts(before: string, after: string): { readonly added: number; readonly removed: number } {
	const a = lines(before);
	const b = lines(after);
	let head = 0;
	while (head < a.length && head < b.length && a[head] === b[head]) {
		head++;
	}
	let tail = 0;
	while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
		tail++;
	}
	return { added: b.length - head - tail, removed: a.length - head - tail };
}

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * Files that can run code or change how the workspace is built when they are written: never taken
 * by Auto-accept edits or Accept all. The list is VS Code's own chat's (`chat.tools.edits.autoApprove`),
 * with any `.env.*` and Husky's hooks too. `path` is the file's path in its workspace folder.
 */
function guarded(path: string): boolean {
	const parts = path.toLowerCase().split('/');
	const name = parts[parts.length - 1];
	return (parts[parts.length - 2] === '.vscode' && name.endsWith('.json')) || parts.includes('.husky')
		|| ['package.json', 'server.xml', 'build.rs', 'web.config', '.gitattributes', '.env'].includes(name) || name.startsWith('.env.')
		|| /\.(code-workspace|csproj|fsproj|vbproj|vcxproj|proj|targets|props)$/.test(name)
		|| name.endsWith('.lock') || /-lock\.(yaml|json)$/.test(name);
}

/** `.git` or a path inside it: git's own files, whose settings and hooks run commands. */
function insideGit(path: string): boolean {
	return path.toLowerCase().split('/').includes('.git');
}

/**
 * Where a file really is in its workspace folder, links followed, as `a/b/c`: a link named `g` to
 * `.git` is `.git` here. For a file not on this machine's disk, its path as written.
 */
async function realInFolder(uri: vscode.Uri): Promise<string> {
	const written = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
	const folder = vscode.workspace.getWorkspaceFolder(uri);
	if (uri.scheme !== 'file' || folder?.uri.scheme !== 'file') {
		return written;
	}
	return nodePath.relative(await realPath(folder.uri.fsPath), await realPath(uri.fsPath)).split(nodePath.sep).join('/');
}

/** What the guards look at: the path as written and where it really leads, either one counting. */
async function paths(uri: vscode.Uri): Promise<readonly string[]> {
	return [vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/'), await realInFolder(uri)];
}

/**
 * A round's changes as they are proposed: each is checked against the file as the batch's earlier
 * changes would leave it, so a change that builds on another can be proposed with it — the change
 * itself is still applied to the file as it is when accepted. `seen` is the whole tool round's.
 */
export class Round {
	/** Each file's text once the batch's earlier changes are made, by URI. */
	readonly texts = new Map<string, string>();

	/** The changes proposed in this tool round so far, to refuse one asked for twice. */
	constructor(readonly seen: Set<string>) { }
}

/**
 * The change a call asks for, checked against the file as it is now and the round's earlier
 * changes — or what the model is told when it cannot be made.
 */
export async function propose(name: string, input: Record<string, unknown>, round: Round): Promise<Proposal | string> {
	const raw = typeof input.path === 'string' ? input.path.trim() : '';
	if (!raw) {
		return `${name} needs the file's path.`;
	}
	let uri: vscode.Uri;
	try {
		uri = await resolveWorkspacePath(raw);
	} catch (error) {
		return message(error);
	}
	const path = vscode.workspace.asRelativePath(uri);
	const where = await paths(uri);
	if (where.some(insideGit)) {
		return `${raw} is inside .git. Sirius does not change git's own files: their settings and hooks run commands.`;
	}
	const isGuarded = where.some(guarded);
	const key = uri.toString();
	if (name === 'sirius_create_file') {
		if (round.texts.has(key)) {
			return `${raw} is already changed or created in this round. Use sirius_edit_file to change it.`;
		}
		try {
			await vscode.workspace.fs.stat(uri);
			return `${raw} already exists. Read it, then use sirius_edit_file to change it — or choose another path.`;
		} catch {
			// Not there: the expected case.
		}
		const content = String(input.content ?? '');
		round.texts.set(key, content);
		return { uri, path, kind: 'create', original: '', proposed: content, search: '', replace: content, guarded: isGuarded, ...lineCounts('', content) };
	}
	let original = round.texts.get(key);
	let crlf = original?.includes('\r\n') ?? false;
	if (original === undefined) {
		try {
			const document = await vscode.workspace.openTextDocument(uri);
			original = document.getText();
			crlf = document.eol === vscode.EndOfLine.CRLF;
		} catch (error) {
			return `${raw} could not be opened: ${message(error)}`;
		}
	}
	// A model writes its lines with \n whatever the file uses; the file's own line breaks are kept.
	const fit = (text: string) => crlf ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n');
	const search = fit(String(input.search ?? ''));
	const replace = fit(String(input.replace ?? ''));
	const found = locate(original, search);
	if (typeof found === 'string') {
		return found;
	}
	if (search === replace) {
		return 'The search and replace texts are the same: nothing would change.';
	}
	const repeat = `${key}\u0000${search}\u0000${replace}`;
	if (round.seen.has(repeat)) {
		return 'This change repeats one made earlier in this round; it was not proposed again.';
	}
	round.seen.add(repeat);
	const proposed = original.slice(0, found.start) + replace + original.slice(found.end);
	round.texts.set(key, proposed);
	return { uri, path, kind: 'edit', original, proposed, search, replace, guarded: isGuarded, ...lineCounts(original, proposed) };
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Applies an accepted change to the file as it is now — not the text proposed earlier, so a change
 * rejected or applied before it cannot be undone or doubled by it — as a workspace edit, so VS
 * Code's Undo takes it back, and saves it, so the model's next read sees it: unless the file had
 * unsaved changes of the user's, which are not saved for them. Changes apply one at a time, in the
 * order they were accepted. Returns what the model is told.
 */
export function apply(proposal: Proposal): Promise<{ readonly ok: boolean; readonly text: string }> {
	const applied = queue.then(() => applyNow(proposal));
	queue = applied.catch(() => undefined);
	return applied;
}

async function applyNow(p: Proposal): Promise<{ readonly ok: boolean; readonly text: string }> {
	// Checked again: what the round ran since the proposal may have moved a folder or made a link.
	if (!await isInWorkspace(p.uri)) {
		return { ok: false, text: `${p.path} is no longer inside the workspace, so the change was not applied.` };
	}
	if ((await paths(p.uri)).some(insideGit)) {
		return { ok: false, text: `${p.path} now leads into .git, so the change was not applied.` };
	}
	if (p.kind === 'create') {
		try {
			await vscode.workspace.fs.stat(p.uri);
			return { ok: false, text: `${p.path} was created by something else after this change was proposed, so nothing was written. Read it, then use sirius_edit_file.` };
		} catch {
			// Still not there.
		}
		const edit = new vscode.WorkspaceEdit();
		edit.createFile(p.uri, { overwrite: false, contents: new TextEncoder().encode(p.proposed) });
		return await vscode.workspace.applyEdit(edit)
			? { ok: true, text: `Created ${p.path}.` }
			: { ok: false, text: `${p.path} could not be created.` };
	}
	let document: vscode.TextDocument;
	try {
		document = await vscode.workspace.openTextDocument(p.uri);
	} catch (error) {
		return { ok: false, text: `${p.path} could not be opened, so the change was not applied: ${message(error)}` };
	}
	const found = locate(document.getText(), p.search);
	if (typeof found === 'string') {
		return { ok: false, text: `${p.path} changed after this change was proposed, so it was not applied. ${found}` };
	}
	const unsaved = document.isDirty;
	const edit = new vscode.WorkspaceEdit();
	edit.replace(p.uri, new vscode.Range(document.positionAt(found.start), document.positionAt(found.end)), p.replace);
	if (!await vscode.workspace.applyEdit(edit)) {
		return { ok: false, text: `${p.path} could not be changed.` };
	}
	if (unsaved) {
		return { ok: true, text: `Edited ${p.path} in the editor. The user had unsaved changes in it, so it was not saved: until they save it, the file on disk does not have this change.` };
	}
	return await document.save()
		? { ok: true, text: `Edited ${p.path}.` }
		: { ok: true, text: `Edited ${p.path}, but it could not be saved: the change is in the editor, unsaved.` };
}

/**
 * The changes the panel can show in VS Code's diff editor, by card: the file as it was when the
 * change was proposed beside the change, as two documents of Sirius's own. Kept until the window
 * closes, the oldest let go past MAX_KEPT_CHARS.
 */
export class Diffs implements vscode.TextDocumentContentProvider {
	private readonly kept = new Map<string, Proposal>();
	private readonly shownAt = new Map<string, number>();
	private size = 0;

	/** `waiting` says whether a change still waits on the user: those are never let go. */
	constructor(private readonly waiting: (id: string) => boolean) { }

	keep(id: string, proposal: Proposal): void {
		this.kept.set(id, proposal);
		this.size += proposal.original.length + proposal.proposed.length;
		for (const [old, kept] of this.kept) {
			if (this.size <= MAX_KEPT_CHARS) {
				break;
			}
			if (old !== id && !this.waiting(old)) {
				this.kept.delete(old);
				this.shownAt.delete(old);
				this.size -= kept.original.length + kept.proposed.length;
			}
		}
	}

	/** Whether the change was shown as a proposal less than `ms` ago. */
	shownWithin(id: string, ms: number): boolean {
		return Date.now() - (this.shownAt.get(id) ?? 0) < ms;
	}

	has(id: string): boolean {
		return this.kept.has(id);
	}

	provideTextDocumentContent(uri: vscode.Uri): string {
		const query = new URLSearchParams(uri.query);
		const proposal = this.kept.get(query.get('id') ?? '');
		return !proposal ? '' : query.get('side') === 'original' ? proposal.original : proposal.proposed;
	}

	/** The change's id, from either side of its diff. */
	idOf(uri: vscode.Uri): string | undefined {
		return uri.scheme === PROPOSAL_SCHEME || uri.scheme === CHANGE_SCHEME ? new URLSearchParams(uri.query).get('id') ?? undefined : undefined;
	}

	/**
	 * Opens the change in the diff editor, keeping the focus where it is: as a proposal, with Accept
	 * and Reject in its title bar, while it waits; otherwise only to look at. Beside the panel when
	 * the panel is a tab.
	 */
	async show(id: string, waiting: boolean): Promise<boolean> {
		const proposal = this.kept.get(id);
		if (!proposal) {
			return false;
		}
		const scheme = waiting ? PROPOSAL_SCHEME : CHANGE_SCHEME;
		const side = (which: string) => vscode.Uri.from({ scheme, path: `/${proposal.path}`, query: `id=${encodeURIComponent(id)}&side=${which}` });
		const active = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		const beside = active instanceof vscode.TabInputWebview && active.viewType.endsWith('sirius.chat');
		const title = waiting
			? `${proposal.path} (${proposal.kind === 'create' ? 'new file, ' : ''}proposed change)`
			: `${proposal.path} (Sirius's change)`;
		if (waiting) {
			this.shownAt.set(id, Date.now());
		}
		await vscode.commands.executeCommand('vscode.diff', side('original'), side('proposed'), title,
			{ preview: true, preserveFocus: true, viewColumn: beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active });
		// Counted again from when it is on screen: a slow open must not leave its buttons ready at once.
		if (waiting) {
			this.shownAt.set(id, Date.now());
		}
		return true;
	}

	/** Closes every diff of this change; whether one was open. */
	async close(id: string): Promise<boolean> {
		const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs)
			.filter(tab => tab.input instanceof vscode.TabInputTextDiff && this.idOf(tab.input.modified) === id);
		if (tabs.length) {
			await vscode.window.tabGroups.close(tabs, true);
		}
		return tabs.length > 0;
	}

	/** The change shown in the active diff editor, if it is one of the panel's. */
	activeId(): string | undefined {
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		return input instanceof vscode.TabInputTextDiff ? this.idOf(input.modified) : undefined;
	}
}
