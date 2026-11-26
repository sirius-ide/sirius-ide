/*---------------------------------------------------------------------------------------------
 *  Sirius — what a question carries besides its words: the open file, the selection, files, images
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as nodePath from 'path';
import { createHash, randomBytes } from 'crypto';
import { resolveWorkspacePath } from '../tools/workspacePath';
import type { ImagePart } from '../types';
import { CHANGE_SCHEME, PROPOSAL_SCHEME } from './edits';
import { MAX_PASTED, type EditorView, type PastedImage } from './protocol';

/** Lines around the cursor sent for the open file, each way, and at most this many characters — as Sirius IDE sends. */
const AROUND_LINES = 60;
const MAX_EDITOR_CHARS = 6_000;
/** A file's text rides with the question up to this size; a larger one is named, not shown. */
const MAX_FILE_BYTES = 100 * 1024;
/**
 * An image is sent up to this size: Anthropic's limit of 5 MB may be counted on the base64, which
 * is a third longer. A question carries at most MAX_IMAGES of them, MAX_IMAGES_BYTES together, so
 * a conversation stays well inside every vendor's request limit (Gemini's inline data, 20 MB).
 */
export const MAX_IMAGE_BYTES = 3_750_000;
const MAX_IMAGES = MAX_PASTED;
const MAX_IMAGES_BYTES = 6_000_000;
/** The images every vision model takes, by extension; another type would fail the whole request. */
const IMAGE_TYPES: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
/** A rough characters-per-token figure for code, for sizing what fits rather than counting it. */
const CHARS_PER_TOKEN = 3;
/** What a question carries, at most, whatever the window: it is kept with the conversation and sent again with each turn. */
const MAX_CONTEXT_CHARS = 200_000;
/** Files offered for an @-mention, looked up for each query. */
const SEARCHED = 200;

/**
 * A file's name as the panel shows it and a question carries it: its path inside the workspace, or,
 * for a file outside it, its name alone — the folders above it would tell a vendor about the user's
 * machine, the name of their home among them.
 */
export function shownPath(uri: vscode.Uri): string {
	return vscode.workspace.getWorkspaceFolder(uri) ? vscode.workspace.asRelativePath(uri) : nodePath.basename(uri.path);
}

/** A text editor the panel can speak of: a file's, not one of the panel's own diffs or an output. */
function usable(editor: vscode.TextEditor | undefined): editor is vscode.TextEditor {
	const scheme = editor?.document.uri.scheme;
	return !!scheme && scheme !== PROPOSAL_SCHEME && scheme !== CHANGE_SCHEME && scheme !== 'output' && scheme !== 'vscode-scm';
}

/** The file the user last worked in, and where in it: kept while a tab still shows it, hidden or not. */
interface Place {
	readonly uri: vscode.Uri;
	readonly selection: vscode.Selection;
	/** The document's version when the selection was taken: a later one may have moved the text under it. */
	readonly version: number;
}

/**
 * The text editor the user last worked in. Focus moving to the panel — a side bar, or a tab that
 * takes the file's place in its group — leaves VS Code's active editor empty or unchanged: the
 * panel still speaks of the file before it, with its selection as it was, until no tab shows it.
 */
export class EditorTracker implements vscode.Disposable {
	private place: Place | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private readonly listeners: vscode.Disposable[] = [];

	constructor(private readonly changed: (view: EditorView | undefined) => void) {
		this._take(usable(vscode.window.activeTextEditor) ? vscode.window.activeTextEditor : vscode.window.visibleTextEditors.find(usable));
		this.listeners.push(
			vscode.window.onDidChangeActiveTextEditor(editor => {
				if (usable(editor)) {
					this._take(editor);
					this._changed();
				}
			}),
			vscode.window.onDidChangeTextEditorSelection(event => {
				if (usable(event.textEditor) && (event.textEditor === vscode.window.activeTextEditor || event.textEditor.document.uri.toString() === this.place?.uri.toString())) {
					this._take(event.textEditor);
					this._changed();
				}
			}),
			// A selection remembered in a file that changed while hidden no longer says which text: it is let go.
			vscode.workspace.onDidChangeTextDocument(event => {
				const place = this.place;
				if (place && !place.selection.isEmpty && event.contentChanges.length && event.document.uri.toString() === place.uri.toString()
					&& !vscode.window.visibleTextEditors.some(editor => editor.document === event.document)) {
					const line = Math.min(place.selection.active.line, event.document.lineCount - 1);
					// The version stays the one the selection was taken at: Insert and Apply then know the text moved.
					this.place = { uri: place.uri, selection: new vscode.Selection(line, 0, line, 0), version: place.version };
					this._changed();
				}
			}),
			// A file no tab shows any more is not the open file: one still shown, if any, takes its place.
			vscode.window.tabGroups.onDidChangeTabs(() => {
				if (this.place && !this._shown(this.place.uri)) {
					this._take(usable(vscode.window.activeTextEditor) ? vscode.window.activeTextEditor : vscode.window.visibleTextEditors.find(usable));
					this._changed();
				}
			})
		);
	}

	dispose(): void {
		clearTimeout(this.timer);
		for (const listener of this.listeners) {
			listener.dispose();
		}
	}

	private _take(editor: vscode.TextEditor | undefined): void {
		this.place = editor ? { uri: editor.document.uri, selection: editor.selection, version: editor.document.version } : undefined;
	}

	/** Whether a tab shows the file: as text, as a side of a diff, or as a cell of a notebook. (The merge editor's tab is proposed API.) */
	private _shown(uri: vscode.Uri): boolean {
		const key = uri.toString();
		const notebook = vscode.workspace.notebookDocuments.find(document => document.getCells().some(cell => cell.document.uri.toString() === key))?.uri.toString();
		return vscode.window.tabGroups.all.some(group => group.tabs.some(tab => {
			const input = tab.input;
			return (input instanceof vscode.TabInputText && input.uri.toString() === key)
				|| (input instanceof vscode.TabInputTextDiff && (input.original.toString() === key || input.modified.toString() === key))
				|| (!!notebook && input instanceof vscode.TabInputNotebook && input.uri.toString() === notebook);
		}));
	}

	/** Selections change as fast as a person drags: the panel hears of them a moment later. */
	private _changed(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.changed(this.view), 120);
	}

	/** The open file's document and where the user was in it, if a tab still shows it. */
	/**
	 * The open file's document and where the user is in it: a visible editor's live selection, or
	 * the one remembered — `moved` when the file changed since, so the position may no longer be
	 * where the user left it.
	 */
	get current(): { readonly document: vscode.TextDocument; readonly selection: vscode.Selection; readonly editor?: vscode.TextEditor; readonly moved: boolean } | undefined {
		const place = this.place;
		const document = place && this._shown(place.uri) ? vscode.workspace.textDocuments.find(d => d.uri.toString() === place.uri.toString() && !d.isClosed) : undefined;
		if (!document) {
			return undefined;
		}
		const editor = vscode.window.visibleTextEditors.find(visible => visible.document === document);
		return editor ? { document, selection: editor.selection, editor, moved: false } : { document, selection: place!.selection, moved: document.version !== place!.version };
	}

	get view(): EditorView | undefined {
		const current = this.current;
		if (!current) {
			return undefined;
		}
		const selection = current.selection;
		return {
			path: shownPath(current.document.uri),
			...(selection.isEmpty ? {} : { selection: { start: selection.start.line + 1, end: selection.end.line + 1 } })
		};
	}
}

/** A name as it goes into the context: quoted, so a file name cannot carry lines of its own. */
const quoted = (name: string): string => JSON.stringify(name);

/** The image type a file's first bytes say it is, or undefined: a picture labelled wrongly fails a vendor's whole request. */
function sniff(bytes: Uint8Array): string | undefined {
	const at = (i: number, ...values: number[]) => values.every((value, j) => bytes[i + j] === value);
	return at(0, 0x89, 0x50, 0x4e, 0x47) ? 'image/png'
		: at(0, 0xff, 0xd8, 0xff) ? 'image/jpeg'
			: at(0, 0x47, 0x49, 0x46, 0x38) ? 'image/gif'
				: at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50) ? 'image/webp'
					: undefined;
}

/** A file's text — the open document's, unsaved changes included — or undefined when it is too large, a folder or binary. */
async function fileText(uri: vscode.Uri): Promise<string | undefined> {
	const open = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString() && !document.isClosed);
	if (open) {
		const text = open.getText();
		return text.length > MAX_FILE_BYTES ? undefined : text;
	}
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		if (stat.size > MAX_FILE_BYTES || stat.type & vscode.FileType.Directory) {
			return undefined;
		}
		const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
		return text.includes('\u0000') ? undefined : text;
	} catch {
		return undefined;
	}
}

/** An image file, read so the model sees the picture rather than its path. */
async function fileImage(uri: vscode.Uri): Promise<ImagePart | undefined> {
	if (!IMAGE_TYPES[uri.path.split('.').pop()?.toLowerCase() ?? '']) {
		return undefined;
	}
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		if (stat.size > MAX_IMAGE_BYTES) {
			return undefined;
		}
		const bytes = await vscode.workspace.fs.readFile(uri);
		const mimeType = sniff(bytes);
		return mimeType ? { base64: Buffer.from(bytes).toString('base64'), mimeType } : undefined;
	} catch {
		return undefined;
	}
}

/** What a question carries before its words, the images with it, and the names shown on its bubble. */
export interface Carried {
	readonly context: string;
	readonly images: ImagePart[];
	readonly labels: string[];
}

/**
 * The context a question goes out with: the open file or the selection first, then each file — every
 * one between tags named with a nonce of this question's, so no file can close its block early and
 * go on as if it were the user, and every name quoted — then what did not fit, by name. Everything
 * inlined shares half the model's window, at most MAX_CONTEXT_CHARS. `mentions` are workspace paths
 * the webview names and are checked here; `picked` are files the user chose in VS Code's own picker.
 */
export async function carry(options: {
	readonly editor: { readonly document: vscode.TextDocument; readonly selection: vscode.Selection } | undefined;
	readonly file: boolean;
	readonly selection: boolean;
	readonly mentions: readonly string[];
	readonly picked: readonly { readonly uri: vscode.Uri; readonly label: string }[];
	readonly pasted: readonly PastedImage[];
	readonly contextWindow: number;
}): Promise<Carried> {
	let budget = Math.min(MAX_CONTEXT_CHARS, Math.max(16_000, Math.floor(options.contextWindow * CHARS_PER_TOKEN * 0.5)));
	const fits = (text: string): boolean => {
		if (text.length > budget) {
			return false;
		}
		budget -= text.length;
		return true;
	};
	const fence = `attachment-${randomBytes(6).toString('hex')}`;
	const block = (attributes: string, text: string) => `<${fence} ${attributes}>\n${text}\n</${fence}>`;
	const parts: string[] = [];
	const notShown: string[] = [];
	const images: ImagePart[] = [];
	const labels: string[] = [];
	let imageBytes = 0;
	const addImage = (image: ImagePart, label: string): boolean => {
		const bytes = Math.floor(image.base64.length * 3 / 4);
		if (images.length >= MAX_IMAGES || imageBytes + bytes > MAX_IMAGES_BYTES) {
			notShown.push(`${quoted(label)} (more pictures than one message takes)`);
			return false;
		}
		images.push(image);
		imageBytes += bytes;
		return true;
	};

	const open = options.editor;
	if (open && !open.document.isClosed && (options.file || (options.selection && !open.selection.isEmpty))) {
		const { document, selection } = open;
		const path = shownPath(document.uri);
		let snippet: string;
		let where: string;
		let label = path;
		if (options.selection && !selection.isEmpty) {
			snippet = document.getText(selection);
			where = `the user selected lines ${selection.start.line + 1}-${selection.end.line + 1}`;
			label = `${path}:${selection.start.line + 1}-${selection.end.line + 1}`;
		} else {
			const line = selection.active.line;
			const start = Math.max(0, line - AROUND_LINES);
			const end = Math.min(document.lineCount - 1, line + AROUND_LINES);
			snippet = document.getText(new vscode.Range(start, 0, end, Number.MAX_SAFE_INTEGER));
			where = `around line ${line + 1}, lines ${start + 1}-${end + 1}`;
		}
		if (snippet.length > MAX_EDITOR_CHARS) {
			snippet = `${snippet.slice(0, MAX_EDITOR_CHARS)}\n[truncated]`;
		}
		const text = `The user has ${quoted(path)} open (${document.languageId}; ${where}):\n${block(`path=${quoted(path)}`, snippet)}`;
		if (fits(text)) {
			parts.push(text);
			labels.push(label);
		}
	}

	const files: { uri: vscode.Uri; label: string }[] = [];
	for (const mention of options.mentions) {
		try {
			const uri = await resolveWorkspacePath(mention);
			files.push({ uri, label: vscode.workspace.asRelativePath(uri) });
		} catch {
			notShown.push(`${quoted(mention)} (outside the workspace)`);
		}
	}
	files.push(...options.picked);
	const seen = new Set<string>();
	for (const { uri, label } of files) {
		if (seen.has(uri.toString())) {
			continue;
		}
		seen.add(uri.toString());
		labels.push(label);
		const image = await fileImage(uri);
		if (image) {
			addImage(image, label);
			continue;
		}
		const text = await fileText(uri);
		const inlined = text === undefined ? undefined : block(`path=${quoted(label)}`, text);
		if (inlined && fits(inlined)) {
			parts.push(inlined);
		} else {
			notShown.push(quoted(label));
		}
	}

	for (const image of options.pasted) {
		const declared = sniff(Buffer.from(image.base64.slice(0, 24), 'base64'));
		let shown = false;
		if (declared !== image.mimeType) {
			notShown.push('a pasted picture (not a PNG, JPEG, GIF or WebP)');
		} else if (Math.floor(image.base64.length * 3 / 4) > MAX_IMAGE_BYTES) {
			notShown.push('a pasted picture (larger than 3.75 MB)');
		} else {
			shown = addImage({ base64: image.base64, mimeType: image.mimeType }, 'a pasted picture');
		}
		// Named on the bubble like a file is; one the model was only told of says so.
		labels.push(shown ? 'image' : 'image (not sent)');
	}
	if (notShown.length) {
		parts.push(`(Attached, not shown: ${notShown.join(', ')})`);
	}
	return { context: parts.join('\n\n'), images, labels };
}

/**
 * Workspace files whose path holds what was typed after `@`, the nearest first: a name that starts
 * with it, then a name that holds it, then a path that does. VS Code looks them up for each query,
 * leaving out what `files.exclude` hides; dependencies and git's own files are left out too.
 */
export async function findFiles(query: string, limit = 12): Promise<string[]> {
	// Each character matched in either case, and none of the glob's own characters taken as one.
	// (`!` is literal outside brackets; inside them it would negate.)
	const glob = [...query].map(ch => /[a-z]/i.test(ch) ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : /[\\[\]{}*?,]/.test(ch) ? `[${ch}]` : ch).join('');
	const uris = await vscode.workspace.findFiles(`**/*${glob}*`, undefined, SEARCHED).then(found => found, () => []);
	const needle = query.toLowerCase();
	const rank = (path: string): number => {
		const lower = path.toLowerCase();
		const name = lower.slice(lower.lastIndexOf('/') + 1);
		return name.startsWith(needle) ? 0 : name.includes(needle) ? 1 : 2;
	};
	return uris
		.map(uri => vscode.workspace.asRelativePath(uri))
		.filter(path => !/(^|\/)(node_modules|\.git)\//.test(path))
		.map(path => ({ path, rank: rank(path) }))
		.sort((a, b) => a.rank - b.rank || a.path.length - b.path.length || a.path.localeCompare(b.path))
		.slice(0, limit)
		.map(entry => entry.path);
}

/** An image a question carried, kept as a file of its own: the conversation keeps only this. */
export interface StoredImage {
	readonly ref: string;
	readonly mimeType: string;
}

/**
 * The pictures questions carried, as files under the extension's storage, named by their content:
 * the conversations, kept in VS Code's workspace state — written whole at every save — hold only
 * their names.
 */
export class ImageStore {
	constructor(private readonly folder: vscode.Uri) { }

	private _file(ref: string): vscode.Uri {
		return vscode.Uri.joinPath(this.folder, `${ref}.bin`);
	}

	/** The name a picture is kept under: known before it is written, so it can be reserved from a sweep first. */
	static refOf(image: ImagePart): StoredImage {
		return { ref: createHash('sha256').update(Buffer.from(image.base64, 'base64')).digest('hex'), mimeType: image.mimeType };
	}

	async put(image: ImagePart): Promise<StoredImage> {
		const stored = ImageStore.refOf(image);
		await vscode.workspace.fs.createDirectory(this.folder);
		await vscode.workspace.fs.writeFile(this._file(stored.ref), Buffer.from(image.base64, 'base64'));
		return stored;
	}

	async get(image: StoredImage): Promise<ImagePart | undefined> {
		if (!/^[0-9a-f]{64}$/.test(image.ref)) {
			return undefined;
		}
		try {
			return { base64: Buffer.from(await vscode.workspace.fs.readFile(this._file(image.ref))).toString('base64'), mimeType: image.mimeType };
		} catch {
			return undefined;
		}
	}

	/** Deletes every picture `kept` does not keep — asked again at each one, as a question may store one meanwhile. */
	async sweep(kept: (ref: string) => boolean): Promise<void> {
		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(this.folder);
		} catch {
			return;
		}
		for (const [name] of entries) {
			const ref = nodePath.basename(name, '.bin');
			if (name.endsWith('.bin') && !kept(ref)) {
				await vscode.workspace.fs.delete(this._file(ref)).then(undefined, () => undefined);
			}
		}
	}
}

/** The file in a no-folder window's picture folder whose time says the window was open then. */
const STAMP = 'window-open';
/** The file a sweep leaves in a folder whose stamp it found ORPHANED_MS old: a later sweep deletes the folder. */
const MARK = 'found-unused';
/** A no-folder window's picture folder whose stamp is older than this has no window any more. */
const ORPHANED_MS = 30 * 24 * 60 * 60 * 1000;
/** How long a folder stays marked before a sweep deletes it — time for a window still open to stamp it. */
const MARKED_MS = 24 * 60 * 60 * 1000;
/** A folder's name as `newId` makes them: only such a folder is ever deleted here. */
const FOLDER_NAME = /^[0-9a-z]{8,24}$/;

/**
 * The pictures of windows with no folder open. Such a window has no storage of its own, so each
 * keeps its pictures in a folder of its own under the extension's global storage, named in the
 * window's state — which VS Code deletes once the window is gone, leaving a folder no window will
 * name again. While a window is open it keeps the stamp in its folder fresh. A sweep that finds a
 * stamp ORPHANED_MS old marks the folder, and a sweep MARKED_MS or more later deletes it if the
 * stamp is still that old — so a window restored after a month away, or woken from a long sleep,
 * has a day to stamp its folder before it can go. A folder found without a stamp gets one.
 */
export class NoFolderPictures {
	constructor(private readonly root: vscode.Uri) { }

	folder(id: string): vscode.Uri {
		return vscode.Uri.joinPath(this.root, id);
	}

	/** Marks a window's folder as in use now, making it if need be. */
	async touch(id: string): Promise<void> {
		await vscode.workspace.fs.createDirectory(this.folder(id));
		await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(this.folder(id), STAMP), Buffer.from(new Date().toISOString()));
	}

	/** Marks, or deletes, the folders whose stamp is ORPHANED_MS old — never `own`, the asking window's. */
	async sweep(own: string | undefined): Promise<void> {
		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(this.root);
		} catch {
			return;
		}
		const quietly = () => undefined;
		for (const [name, type] of entries) {
			if (name === own || !(type & vscode.FileType.Directory) || !FOLDER_NAME.test(name)) {
				continue;
			}
			const stamp = vscode.Uri.joinPath(this.folder(name), STAMP);
			const mark = vscode.Uri.joinPath(this.folder(name), MARK);
			const stamped = await this._time(stamp);
			// No stamp, or one from the future (a clock set back): the month starts now.
			if (stamped === undefined || stamped > Date.now() + MARKED_MS) {
				await this.touch(name).then(undefined, quietly);
				continue;
			}
			let marked = await this._time(mark);
			if (marked !== undefined && marked > Date.now()) {
				marked = undefined;
			}
			if (Date.now() - stamped <= ORPHANED_MS) {
				// Stamped again since a sweep marked it: its window is open.
				if (marked !== undefined) {
					await vscode.workspace.fs.delete(mark).then(undefined, quietly);
				}
			} else if (marked === undefined || marked < stamped) {
				// Not marked since its last stamp (or marked from the future): marked now.
				await vscode.workspace.fs.writeFile(mark, Buffer.from(new Date().toISOString())).then(undefined, quietly);
			} else if (Date.now() - marked >= MARKED_MS && await this._time(stamp) === stamped) {
				await vscode.workspace.fs.delete(this.folder(name), { recursive: true, useTrash: false }).then(undefined, quietly);
			}
		}
	}

	/** A file's last change, or undefined when it is not there. */
	private async _time(file: vscode.Uri): Promise<number | undefined> {
		try {
			return (await vscode.workspace.fs.stat(file)).mtime;
		} catch {
			return undefined;
		}
	}
}
