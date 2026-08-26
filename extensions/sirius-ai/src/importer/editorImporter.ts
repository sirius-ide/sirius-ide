/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — import from another editor
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
/**
 * Settings and keybindings files are JSONC. This strips comments and trailing
 * commas — string-aware — which is all those files need.
 */
function parseJsonc(text: string): unknown {
	let out = '';
	let inString = false;
	let inLine = false;
	let inBlock = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		const next = text[i + 1];
		if (inLine) {
			if (ch === '\n') { inLine = false; out += ch; }
			continue;
		}
		if (inBlock) {
			if (ch === '*' && next === '/') { inBlock = false; i++; }
			continue;
		}
		if (inString) {
			out += ch;
			if (ch === '\\') { out += next ?? ''; i++; }
			else if (ch === '"') { inString = false; }
			continue;
		}
		if (ch === '"') { inString = true; out += ch; continue; }
		if (ch === '/' && next === '/') { inLine = true; i++; continue; }
		if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
		out += ch;
	}
	out = out.replace(/,\s*([}\]])/g, '$1');
	try {
		return JSON.parse(out);
	} catch {
		return undefined;
	}
}

/**
 * The single biggest barrier to switching editors is losing your setup. This
 * imports settings, keybindings, snippets and extensions from VS Code, Cursor,
 * Windsurf or VSCodium in one command.
 */

interface EditorSource {
	readonly id: string;
	readonly label: string;
	/** The per-OS name of the config directory holding User/. */
	readonly configDirName: string;
	/** The home-relative extensions directory (same dotfolder on every OS). */
	readonly extensionsDir: string;
}

const SOURCES: EditorSource[] = [
	{ id: 'vscode', label: 'Visual Studio Code', configDirName: 'Code', extensionsDir: '.vscode/extensions' },
	{ id: 'cursor', label: 'Cursor', configDirName: 'Cursor', extensionsDir: '.cursor/extensions' },
	{ id: 'windsurf', label: 'Windsurf', configDirName: 'Windsurf', extensionsDir: '.windsurf/extensions' },
	{ id: 'vscodium', label: 'VSCodium', configDirName: 'VSCodium', extensionsDir: '.vscode-oss/extensions' }
];

/** Settings that must not follow the user across editors. */
const SKIPPED_SETTING_PREFIXES = ['cursor.', 'windsurf.', 'codeium.', 'github.copilot', 'sirius.'];

/** Extensions that are pointless or broken outside their home editor. */
const SKIPPED_EXTENSIONS = new Set(['github.copilot', 'github.copilot-chat']);

const CATEGORIES = ['settings', 'keybindings', 'snippets', 'extensions'] as const;
type Category = typeof CATEGORIES[number];

export interface ImportOptions {
	readonly source?: string;
	readonly categories?: readonly Category[];
	readonly interactive?: boolean;
}

export interface ImportReport {
	settingsImported: number;
	keybindings: 'imported' | 'kept-existing' | 'none';
	snippetsCopied: number;
	extensionsInstalled: string[];
	extensionsUnavailable: string[];
}

function userConfigRoot(configDirName: string): string {
	switch (os.platform()) {
		case 'win32': return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), configDirName);
		case 'darwin': return path.join(os.homedir(), 'Library', 'Application Support', configDirName);
		default: return path.join(os.homedir(), '.config', configDirName);
	}
}

function detectSources(): Array<EditorSource & { userDir: string; extDir: string }> {
	return SOURCES.flatMap(source => {
		const userDir = path.join(userConfigRoot(source.configDirName), 'User');
		const extDir = path.join(os.homedir(), source.extensionsDir);
		return fs.existsSync(path.join(userDir, 'settings.json')) || fs.existsSync(extDir)
			? [{ ...source, userDir, extDir }]
			: [];
	});
}

/** Sirius's own User directory, derived from the extension's storage path. */
function siriusUserDir(context: vscode.ExtensionContext): string {
	return path.dirname(path.dirname(context.globalStorageUri.fsPath));
}

export function registerEditorImporter(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.commands.registerCommand(
		'sirius.ai.importFromEditor',
		(options?: ImportOptions) => runImport(context, options ?? {})
	));
}

async function runImport(context: vscode.ExtensionContext, options: ImportOptions): Promise<ImportReport | undefined> {
	const detected = detectSources();
	if (detected.length === 0) {
		vscode.window.showInformationMessage('Sirius: no other editor installations found to import from.');
		return undefined;
	}

	let source = detected.find(candidate => candidate.id === options.source);
	const interactive = options.interactive !== false && !options.source;

	if (!source) {
		if (!interactive) {
			throw new Error(`Import source not found: ${options.source}`);
		}
		const pick = await vscode.window.showQuickPick(
			detected.map(candidate => ({ label: candidate.label, description: candidate.userDir, candidate })),
			{ title: 'Import settings from which editor?' }
		);
		if (!pick) {
			return undefined;
		}
		source = pick.candidate;
	}

	let categories: readonly Category[] = options.categories ?? CATEGORIES;
	if (interactive && !options.categories) {
		const picks = await vscode.window.showQuickPick(
			CATEGORIES.map(category => ({ label: category, picked: true })),
			{ title: `Import from ${source.label}`, canPickMany: true }
		);
		if (!picks) {
			return undefined;
		}
		categories = picks.map(pick => pick.label as Category);
	}

	const report: ImportReport = {
		settingsImported: 0,
		keybindings: 'none',
		snippetsCopied: 0,
		extensionsInstalled: [],
		extensionsUnavailable: []
	};

	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `Importing from ${source.label}…` },
		async progress => {
			if (categories.includes('settings')) {
				progress.report({ message: 'settings' });
				report.settingsImported = await importSettings(source!.userDir, siriusUserDir(context));
			}
			if (categories.includes('keybindings')) {
				progress.report({ message: 'keybindings' });
				report.keybindings = importKeybindings(source!.userDir, siriusUserDir(context));
			}
			if (categories.includes('snippets')) {
				progress.report({ message: 'snippets' });
				report.snippetsCopied = importSnippets(source!.userDir, siriusUserDir(context));
			}
			if (categories.includes('extensions')) {
				await importExtensions(source!.extDir, report, progress);
			}
		}
	);

	const summary = [
		`Imported from ${source.label}:`,
		`${report.settingsImported} settings`,
		`keybindings ${report.keybindings}`,
		`${report.snippetsCopied} snippets`,
		`${report.extensionsInstalled.length} extensions installed` +
		(report.extensionsUnavailable.length ? ` (${report.extensionsUnavailable.length} not on Open VSX)` : '')
	].join(' · ');

	if (report.extensionsUnavailable.length > 0) {
		const channel = vscode.window.createOutputChannel('Sirius Import');
		channel.appendLine(summary);
		channel.appendLine('');
		channel.appendLine('Not available on Open VSX (Sirius\'s open extension gallery):');
		for (const id of report.extensionsUnavailable) {
			channel.appendLine(`  ${id}`);
		}
		channel.show(true);
	}
	vscode.window.showInformationMessage(`Sirius: ${summary}`);
	return report;
}

/**
 * Settings merge at the file level, not through the configuration API:
 * config.update() silently drops unregistered keys, and imported extension
 * settings are always unregistered at import time — their extensions install
 * a step later. Keys the user has already set in Sirius win over imports.
 */
async function importSettings(sourceUserDir: string, targetUserDir: string): Promise<number> {
	const file = path.join(sourceUserDir, 'settings.json');
	if (!fs.existsSync(file)) {
		return 0;
	}
	const source = parseJsonc(fs.readFileSync(file, 'utf8')) as Record<string, unknown> | undefined;
	if (!source || typeof source !== 'object') {
		return 0;
	}

	const targetFile = path.join(targetUserDir, 'settings.json');
	let existing: Record<string, unknown> = {};
	if (fs.existsSync(targetFile)) {
		const parsed = parseJsonc(fs.readFileSync(targetFile, 'utf8')) as Record<string, unknown> | undefined;
		if (parsed && typeof parsed === 'object') {
			existing = parsed;
		}
	}

	let imported = 0;
	const merged: Record<string, unknown> = { ...existing };
	for (const [key, value] of Object.entries(source)) {
		if (SKIPPED_SETTING_PREFIXES.some(prefix => key.startsWith(prefix)) || Object.hasOwn(existing, key)) {
			continue;
		}
		merged[key] = value;
		imported++;
	}

	if (imported > 0) {
		fs.mkdirSync(targetUserDir, { recursive: true });
		fs.writeFileSync(targetFile, JSON.stringify(merged, null, '\t') + '\n');
	}
	return imported;
}

function importKeybindings(sourceUserDir: string, targetUserDir: string): ImportReport['keybindings'] {
	const sourceFile = path.join(sourceUserDir, 'keybindings.json');
	if (!fs.existsSync(sourceFile)) {
		return 'none';
	}
	const targetFile = path.join(targetUserDir, 'keybindings.json');
	if (fs.existsSync(targetFile)) {
		const existing = parseJsonc(fs.readFileSync(targetFile, 'utf8')) as unknown[] | undefined;
		if (Array.isArray(existing) && existing.length > 0) {
			// The user has already customised Sirius; silently clobbering that
			// would be worse than skipping.
			return 'kept-existing';
		}
	}
	fs.mkdirSync(targetUserDir, { recursive: true });
	fs.copyFileSync(sourceFile, targetFile);
	return 'imported';
}

function importSnippets(sourceUserDir: string, targetUserDir: string): number {
	const sourceDir = path.join(sourceUserDir, 'snippets');
	if (!fs.existsSync(sourceDir)) {
		return 0;
	}
	const targetDir = path.join(targetUserDir, 'snippets');
	fs.mkdirSync(targetDir, { recursive: true });

	let copied = 0;
	for (const name of fs.readdirSync(sourceDir)) {
		const target = path.join(targetDir, name);
		if (!fs.existsSync(target)) {
			fs.copyFileSync(path.join(sourceDir, name), target);
			copied++;
		}
	}
	return copied;
}

async function importExtensions(
	extDir: string,
	report: ImportReport,
	progress: vscode.Progress<{ message?: string }>
): Promise<void> {
	if (!fs.existsSync(extDir)) {
		return;
	}

	const ids = new Set<string>();
	for (const entry of fs.readdirSync(extDir)) {
		const match = /^(?<id>.+?)-\d+\.\d+\.\d+/.exec(entry);
		const id = match?.groups?.id?.toLowerCase();
		if (id && !SKIPPED_EXTENSIONS.has(id)) {
			ids.add(id);
		}
	}

	const installed = new Set(vscode.extensions.all.map(extension => extension.id.toLowerCase()));
	for (const id of ids) {
		if (installed.has(id)) {
			continue;
		}
		progress.report({ message: `extension ${id}` });
		try {
			await vscode.commands.executeCommand('workbench.extensions.installExtension', id);
			report.extensionsInstalled.push(id);
		} catch {
			// Most commonly: published to Microsoft's marketplace but not to
			// Open VSX. Reported, not hidden.
			report.extensionsUnavailable.push(id);
		}
	}
}
