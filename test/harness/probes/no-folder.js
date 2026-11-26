/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Sirius's panel in a window with no folder open (SIRIUS_PROBE_NO_FOLDER=1 test/harness/edition-stub.sh
// <vscode-dir> test/harness/probes/no-folder.js <result.json>). Such a window has no storage of its own:
// the pictures its questions carry go in a folder of the window's own under the extension's global
// storage, which VS Code cannot delete for it, so the window keeps a stamp there fresh while it is
// open and any window's sweep deletes a folder whose stamp is a month old (panel.js checks the sweep).
//   stamp   — a question with a pasted picture, to the hosted stub's Ollama: the picture is kept in
//             the window's folder, the only one there, beside a stamp written now.
//   reload  — the stamp set 40 days back and the side bar closed, the window reloads: as Sirius
//             starts — the panel not shown, so not by its first use — the same folder is stamped
//             again, and the picture is still there.
//   own     — the window's folder made to look gone (stamped 40 days ago, marked two days ago) beside
//             another folder so, the panel is shown: its first sweep deletes the other, never the
//             window's own.
// Progress in <result>.log; the part before the reload in <result>.before-reload.json.

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { connectWebview } = require(path.join(__dirname, '..', 'cdp-window.js'));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const OUT = process.env.SIRIUS_PROBE_OUT;
const PROFILE = process.env.SIRIUS_PROBE_USER_DIR;
const HOSTED = 'http://127.0.0.1:11992';
const EXTENSION = 'siriuside.sirius-ai';
const MODEL = 'ollama/stub-coder:1b';
const BEFORE = `${OUT}.before-reload.json`;
const PICTURES = PROFILE ? path.join(PROFILE, 'User', 'globalStorage', EXTENSION, 'panel-images') : undefined;
const STAMP = 'window-open';
const MARK = 'found-unused';
const DAY_MS = 24 * 60 * 60 * 1000;
/** A 1×1 PNG, pasted; kept under the SHA-256 of its bytes. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const KEPT_AS = `${createHash('sha256').update(Buffer.from(PNG, 'base64')).digest('hex')}.bin`;

const js = value => JSON.stringify(value);
const log = line => { if (OUT) { fs.appendFileSync(`${OUT}.log`, `${new Date().toISOString().slice(11, 19)} ${line}\n`); } };
const SNAPSHOT = `({
	providers: Object.fromEntries([...document.querySelectorAll('.provider')].map(p => [p.dataset.provider, p.querySelector('.provider-status')?.textContent ?? ''])),
	models: [...document.querySelectorAll('footer select[title="Model"] option')].map(o => o.value),
	chips: [...document.querySelectorAll('footer .chips .chip')].map(c => c.querySelector('.chip-label')?.textContent ?? ''),
	turns: [...document.querySelectorAll('.turn')].map(t => ({ role: t.classList.contains('user') ? 'user' : 'assistant', streaming: t.classList.contains('streaming'), text: t.textContent }))
})`;
const click = selector => `(() => { const b = document.querySelector(${js(selector)}); if (b) { b.click(); } return !!b; })()`;
const choose = (selector, value) => `(() => { const s = document.querySelector(${js(selector)}); if (!s) { return null; } s.value = ${js(value)}; s.dispatchEvent(new window.Event('change', { bubbles: true })); return s.value; })()`;
const fill = (provider, field, value, button) => `(() => {
	const row = document.querySelector('[data-provider=${js(provider)}]');
	const input = row?.querySelector(${js(field)});
	if (!input) { return false; }
	input.value = ${js(value)};
	[...row.querySelectorAll('button')].find(b => b.textContent === ${js(button)})?.click();
	return true;
})()`;
const pasteImage = `(() => { const t = document.querySelector('footer textarea'); const bytes = Uint8Array.from(atob(${js(PNG)}), c => c.charCodeAt(0)); const data = new window.DataTransfer(); data.items.add(new window.File([bytes], 'shot.png', { type: 'image/png' })); t.dispatchEvent(new window.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); return true; })()`;
const sendText = text => `(() => { const t = document.querySelector('footer textarea'); t.value = ${js(text)}; t.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true; })()`;

/** The window folders under panel-images, each with its files and its stamp's age in minutes. */
function folders() {
	if (!PICTURES || !fs.existsSync(PICTURES)) {
		return [];
	}
	return fs.readdirSync(PICTURES, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
		const dir = path.join(PICTURES, entry.name);
		const stamp = path.join(dir, STAMP);
		return {
			name: entry.name,
			files: fs.readdirSync(dir).sort(),
			stampAgeMin: fs.existsSync(stamp) ? Math.round((Date.now() - fs.statSync(stamp).mtimeMs) / 60000) : null
		};
	});
}

exports.run = async function (vscode) {
	const failures = [];
	const check = (ok, what) => { if (!ok) { failures.push(what); } };
	const reloaded = fs.existsSync(BEFORE);
	const result = reloaded ? JSON.parse(fs.readFileSync(BEFORE, 'utf8')) : {};
	if (reloaded) {
		failures.push(...(result.failures ?? []));
		delete result.failures;
	}
	for (let i = 0; i < 50 && !vscode.extensions.getExtension(EXTENSION)?.isActive; i++) { await sleep(200); }
	result[reloaded ? 'afterReload' : 'window'] = { folders: (vscode.workspace.workspaceFolders ?? []).length, active: !!vscode.extensions.getExtension(EXTENSION)?.isActive };
	check(!vscode.workspace.workspaceFolders?.length, 'window: a folder is open — run with SIRIUS_PROBE_NO_FOLDER=1');
	check(!!PICTURES, 'window: no SIRIUS_PROBE_USER_DIR — run through vscode-run.sh');

	if (reloaded) {
		// ── reload: stamped again as Sirius starts, before the panel is used ──────
		log('reload: the folder stamped again at startup');
		let now = folders();
		for (let i = 0; i < 50 && !(now.length === 1 && now[0].stampAgeMin !== null && now[0].stampAgeMin < 5); i++) {
			await sleep(200);
			now = folders();
		}
		// The panel was closed before the reload: had it been shown, its first use would stamp the folder too.
		const shown = await connectWebview(EXTENSION, 'webviewView', 1500).then(view => { view.close(); return true; }, () => false);
		result.reload = { folders: now, panelShown: shown };
		check(!shown, 'reload: the panel was shown after the reload, so the stamp may be its first use\'s, not startup\'s');
		check(now.length === 1 && now[0].name === result.stamp?.folders?.[0]?.name && now[0].stampAgeMin !== null && now[0].stampAgeMin < 5 && now[0].files.includes(KEPT_AS), `reload: the window's folder was not stamped again as Sirius started, its picture kept (${js(result.reload)} after ${js(result.stamp)})`);

		// ── own: a sweep never takes the window's own folder ─────────────────────
		log('own: the window\'s folder made to look gone beside another; the panel shown');
		const age = (file, days) => { fs.writeFileSync(file, 'aged'); const at = (Date.now() - days * DAY_MS) / 1000; fs.utimesSync(file, at, at); };
		const own = now[0]?.name;
		const other = path.join(PICTURES, 'probeother001');
		fs.mkdirSync(other, { recursive: true });
		fs.writeFileSync(path.join(other, KEPT_AS), 'a picture');
		age(path.join(other, STAMP), 40);
		age(path.join(other, MARK), 2);
		if (own) {
			age(path.join(PICTURES, own, STAMP), 40);
			age(path.join(PICTURES, own, MARK), 2);
		}
		await vscode.commands.executeCommand('sirius.open');
		let after = folders();
		for (let i = 0; i < 50 && after.some(folder => folder.name === 'probeother001'); i++) {
			await sleep(200);
			after = folders();
		}
		// The sweep may still be on its way through the folders: a moment longer.
		await sleep(1500);
		after = folders();
		result.own = { folders: after };
		check(!after.some(folder => folder.name === 'probeother001'), `own: the panel's first sweep did not delete another window's folder gone 40 days and marked two days ago, so it did not run (${js(after)})`);
		check(!!own && after.some(folder => folder.name === own && folder.files.includes(KEPT_AS)), `own: the panel's first sweep deleted the window's own folder (${js(after)})`);
		return { ok: failures.length === 0, failures, ...result };
	}

	// ── stamp: a question with a picture keeps it in the window's own folder ──
	log('stamp: a picture pasted and sent to the Ollama stub');
	result.before = { folders: folders() };
	await vscode.commands.executeCommand('sirius.panel.setup');
	const panel = await connectWebview(EXTENSION, 'webviewView');
	const snap = () => panel.evaluate(SNAPSHOT);
	const until = async (ok, ms = 20000) => {
		let s;
		for (const deadline = Date.now() + ms; Date.now() < deadline;) {
			s = await snap();
			if (s && !s.noContent && ok(s)) { return s; }
			await sleep(150);
		}
		return s;
	};
	await until(s => 'ollama' in s.providers);
	await panel.evaluate(fill('ollama', 'input[type="text"]', HOSTED, 'Save address'));
	const found = await until(s => /\d+ models?/.test(s.providers.ollama ?? ''));
	await panel.evaluate(click('button[title="Back to the conversation"]'));
	await until(s => s.models.includes(MODEL));
	await panel.evaluate(choose('footer select[title="Model"]', MODEL));
	await sleep(300);
	await panel.evaluate(pasteImage);
	const pasted = await until(s => s.chips.some(c => /^image 1 /.test(c)), 5000);
	await panel.evaluate(sendText('a picture to keep'));
	const answered = await until(s => s.turns.length >= 2 && s.turns[s.turns.length - 1].role === 'assistant' && !s.turns[s.turns.length - 1].streaming && /pong/.test(s.turns[s.turns.length - 1].text), 30000);
	let kept = folders();
	for (let i = 0; i < 25 && !(kept.length === 1 && kept[0].files.includes(KEPT_AS) && kept[0].stampAgeMin !== null); i++) {
		await sleep(200);
		kept = folders();
	}
	result.stamp = { ollama: found?.providers?.ollama, pasted: pasted?.chips, answer: answered?.turns?.at(-1)?.text?.slice(0, 60), folders: kept };
	check(js(result.before.folders) === js([]), `stamp: picture folders were there before the panel was used (${js(result.before)})`);
	check(/pong/.test(result.stamp.answer ?? ''), `stamp: the question with a picture was not answered (${js(result.stamp)})`);
	check(kept.length === 1 && js(kept[0].files) === js([KEPT_AS, STAMP].sort()) && kept[0].stampAgeMin !== null && kept[0].stampAgeMin < 5, `stamp: the picture was not kept in the window's own folder beside a stamp written now (${js(kept)})`);

	// ── reload: the stamp made old, then the window reloads ─────────────────────
	log('reload: the stamp set 40 days back; the window reloads');
	if (kept.length === 1 && kept[0].stampAgeMin !== null) {
		const stamp = path.join(PICTURES, kept[0].name, STAMP);
		const at = (Date.now() - 40 * DAY_MS) / 1000;
		fs.utimesSync(stamp, at, at);
		result.stamp.agedTo = Math.round((Date.now() - fs.statSync(stamp).mtimeMs) / DAY_MS);
	}
	panel.close();
	await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
	await sleep(500);
	fs.writeFileSync(BEFORE, JSON.stringify({ ...result, failures }, null, 1));
	// Not awaited: the command's promise is cancelled as the window goes.
	vscode.commands.executeCommand('workbench.action.reloadWindow').then(undefined, () => { /* the window is reloading */ });
	return new Promise(() => { /* this extension host ends with the reload; the next one finishes */ });
};
