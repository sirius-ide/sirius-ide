/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Tab completion against a real llama-server, started with `--api-key`, end to end in a built
// app. A recording proxy sits in front of the server so the probe sees every request as the
// server does — method, path, whether a key came with it, the status it answered — and the
// editor talks to the proxy's `/v1` as `sirius.ai.llamacpp.baseUrl`. Checks, in order:
//
//  noKey     — with nothing configured, Tab completion sends `POST /infill` at the server root
//              without a key, the server refuses it (401) and nothing is suggested;
//  chat      — the server added in Manage Models (URL and key) lists its model under
//              sirius-llamacpp, and a chat request answers through /v1/chat/completions with
//              the key;
//  completed — the configured key now reaches /infill, the server answers, and the suggestion
//              is shown and accepted into the editor: the file carries the model's text;
//  v1        — no request went to /v1/infill (where it went before 1.118.8).
//
// Progress goes to <result>.log, for a run that does not finish.
//
//   test/harness/tab-completion.sh <app-dir>      # starts the server and runs this

const fs = require('fs');
const path = require('path');
const http = require('http');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const LLAMA = process.env.SIRIUS_PROBE_LLAMA ?? 'http://127.0.0.1:18080';
const KEY = process.env.SIRIUS_PROBE_LLAMA_KEY ?? 'sirius-fim-key';
const log = line => fs.appendFileSync(`${process.env.SIRIUS_PROBE_OUT}.log`, `${new Date().toISOString().slice(11, 19)} ${line}\n`);
/** What the provider strips before showing a completion (tabCompletionProvider.clean). */
const cleaned = raw => raw.replace(/<\|[a-z_]+\|>/g, '').split('\n').slice(0, 12).join('\n');

/** Forwards every request to the server unchanged and records what passed. */
function recordingProxy(hits) {
	const upstream = new URL(LLAMA);
	return http.createServer((req, res) => {
		let body = '';
		req.on('data', chunk => { body += chunk; });
		req.on('end', () => {
			const headers = { ...req.headers, host: upstream.host };
			const out = http.request({ hostname: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers }, up => {
				let reply = '';
				up.on('data', chunk => { reply += chunk; });
				up.on('end', () => {
					const key = req.headers.authorization === `Bearer ${KEY}` ? 'sent' : req.headers.authorization ? 'other' : 'none';
					hits.push({ method: req.method, url: req.url, key, status: up.statusCode, body: body.slice(0, 300), reply });
					log(`server: ${req.method} ${req.url} key=${key} → ${up.statusCode}`);
					const { 'transfer-encoding': _te, 'content-length': _cl, ...rest } = up.headers;
					res.writeHead(up.statusCode, rest);
					res.end(reply);
				});
			});
			out.on('error', error => { res.writeHead(502); res.end(String(error)); });
			out.end(body);
		});
	});
}

exports.run = async function (vscode) {
	const failures = [];
	const check = (ok, what) => { if (!ok) { failures.push(what); } };
	const result = {};
	const global = vscode.ConfigurationTarget.Global;
	const ws = vscode.workspace.workspaceFolders[0].uri.fsPath;

	await vscode.extensions.getExtension('sirius.sirius-ai').activate();

	const hits = [];
	const proxy = recordingProxy(hits);
	await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
	const base = `http://127.0.0.1:${proxy.address().port}/v1`;
	result.server = { real: LLAMA, viaProxy: base };

	await vscode.workspace.getConfiguration('sirius.ai.llamacpp').update('baseUrl', base, global);
	await vscode.workspace.getConfiguration('sirius.ai').update('completions.model', 'llamacpp', global);
	await vscode.workspace.getConfiguration('sirius.ai').update('enable', { '*': true }, global);
	await vscode.workspace.getConfiguration('editor').update('inlineSuggest.enabled', true, global);

	const head = 'function add(a, b) {\n\t';
	const tail = '\n}\n';
	const infills = () => hits.filter(h => h.method === 'POST' && h.url === '/infill');

	/**
	 * Open a fresh file (the editor keeps an explicit trigger's result for a position and
	 * document version it has seen), trigger at the empty line inside the function, wait for
	 * the server to answer an /infill, accept, and read what the file holds now.
	 */
	const complete = async name => {
		const seen = infills().length;
		const file = path.join(ws, `${name}.js`);
		fs.writeFileSync(file, head + tail);
		const editor = await vscode.window.showTextDocument(vscode.Uri.file(file));
		const spot = new vscode.Position(1, 1);
		editor.selection = new vscode.Selection(spot, spot);
		for (let attempt = 0; attempt < 3 && infills().length === seen; attempt++) {
			log(`${name}: trigger ${attempt}`);
			await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
			for (let i = 0; i < 15 && infills().length === seen; i++) {
				await sleep(1000);
			}
		}
		await sleep(2000); // the ghost text renders after the reply
		await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
		await sleep(500);
		const text = editor.document.getText();
		await editor.document.save();
		const inserted = text.startsWith(head) && text.endsWith(tail) ? text.slice(head.length, -tail.length) : null;
		log(`${name}: file ${JSON.stringify(text)}`);
		// The first new request answered the trigger; accepting moves the cursor, and the
		// editor may ask again from there.
		const fresh = infills().slice(seen);
		return { hit: fresh[0] ?? null, requests: fresh.length, text, inserted };
	};

	// ── noKey ─────────────────────────────────────────────────────────────────
	const firstTrigger = Date.now();
	const before = await complete('tab-nokey');
	result.noKey = { request: before.hit && { url: before.hit.url, key: before.hit.key, status: before.hit.status }, inserted: before.inserted };
	check(before.hit, 'noKey: no /infill request reached the server');
	check(before.hit?.key === 'none' && before.hit?.status === 401, `noKey: the server saw ${JSON.stringify(result.noKey.request)}, not a keyless request refused with 401`);
	check(before.inserted === '', `noKey: the editor took ${JSON.stringify(before.inserted)} with no key`);

	// ── chat ──────────────────────────────────────────────────────────────────
	log('chat: adding the group');
	await vscode.commands.executeCommand('lm.addLanguageModelsProviderGroup', { vendor: 'sirius-llamacpp', name: 'llama-server', url: base, apiKey: KEY });
	let model;
	for (let i = 0; i < 30 && !model; i++) {
		await sleep(1000);
		model = (await vscode.lm.selectChatModels({ vendor: 'sirius-llamacpp' }))[0];
	}
	result.chat = { model: model ? `${model.vendor}/${model.id}` : null };
	log(`chat: model ${result.chat.model}`);
	check(model, 'chat: the configured llama-server offers no model');
	if (model) {
		const cancel = new vscode.CancellationTokenSource();
		const timer = setTimeout(() => cancel.cancel(), 90_000);
		try {
			const response = await model.sendRequest([vscode.LanguageModelChatMessage.User('Reply with the single word: pong')], {}, cancel.token);
			let text = '';
			for await (const part of response.text) {
				text += part;
			}
			const hit = hits.filter(h => h.url.endsWith('/chat/completions')).at(-1);
			result.chat.reply = text;
			result.chat.request = hit && { url: hit.url, key: hit.key, status: hit.status };
			check(/pong/i.test(text), `chat: the model answered ${JSON.stringify(text)}`);
			check(hit?.key === 'sent' && hit.status === 200, `chat: the server saw ${JSON.stringify(result.chat.request)}`);
		} catch (error) {
			result.chat.error = String(error);
			check(false, `chat: ${error}`);
		} finally {
			clearTimeout(timer);
		}
		log(`chat: reply ${JSON.stringify(result.chat.reply ?? result.chat.error)}`);
	}
	result.chat.modelsRequest = hits.filter(h => h.url.endsWith('/models')).map(h => `${h.key}→${h.status}`);

	// ── completed ─────────────────────────────────────────────────────────────
	// A failed backend is probed again 30 s after the last probe; the key is read per request.
	await sleep(Math.max(0, 31_000 - (Date.now() - firstTrigger)));
	const after = await complete('tab-keyed');
	result.completed = { request: after.hit && { url: after.hit.url, key: after.hit.key, status: after.hit.status }, requests: after.requests, inserted: after.inserted, file: after.text };
	let content = null;
	try { content = JSON.parse(after.hit?.reply ?? 'null')?.content ?? null; } catch { /* not JSON */ }
	result.completed.serverContent = content;
	check(after.hit?.key === 'sent' && after.hit?.status === 200, `completed: the server saw ${JSON.stringify(result.completed.request)}, not a keyed request answered 200`);
	check(typeof after.inserted === 'string' && after.inserted.trim().length > 0, `completed: nothing was accepted into the editor (file: ${JSON.stringify(after.text)})`);
	check(typeof content === 'string' && after.inserted !== null && cleaned(content).startsWith(after.inserted), `completed: the editor holds ${JSON.stringify(after.inserted)}, the server answered ${JSON.stringify(content)}`);

	// ── v1 ────────────────────────────────────────────────────────────────────
	result.requests = hits.map(h => `${h.method} ${h.url} key=${h.key} → ${h.status}`);
	check(!hits.some(h => h.url === '/v1/infill'), 'v1: a request went to /v1/infill');

	proxy.close();
	return { ok: failures.length === 0, failures, ...result };
};
