/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Sirius's own panel in stock VS Code (the VS Code edition), driven through its webview as a
// person would, against the stubs (test/harness/edition-stub.sh):
//   walkthrough — first, as after an install, before Sirius was ever opened: "Get started with
//               Sirius" shows its four steps; its "Open Models and Keys" opens the panel on its
//               Models and Keys; "Open Sirius" is then done and "Ask, Edit or Agent" is not.
//   start     — before any setup the panel says how to begin — or, when a local server such as
//               Ollama answers, offers its models and says to ask.
//   setup     — on Models and Keys, an address (the stubs') and a key are saved for Anthropic,
//               Gemini, OpenAI and llama.cpp, and an address for Ollama; each offers the stubs'
//               models; no key ever reaches the webview's page; "Add a model" is then done.
//   guard     — for the whole run the probe stands in for the vendors' own APIs inside the extension
//               host: OpenAI's is answered here, any other is refused and recorded — no request
//               leaves this machine, and none but those this probe means is made.
//   providers — one question each to Gemini, OpenAI, llama.cpp and Ollama is answered by its stub
//               (Anthropic's are the turns below), Gemini's with the key in its own header; after
//               the first, "Ask, Edit or Agent" is done. Tokens: Gemini, llama.cpp and Ollama show
//               the stubs' 12 in and 3 out; OpenAI, here at an address other than its own (as a
//               gateway would be), is not asked for them and shows none, while llama.cpp is asked
//               (the OpenAI stub's log says which request carried stream_options). OpenAI at its own
//               address (answered by the guard) is asked, and shows the guard's 7 in and 2 out. A
//               Gemini answer stopped part-way shows no count: Gemini's chunks carry the prompt's
//               count before the answer's.
//   thinking  — "slow: think about it": the thinking block shows while it streams, its text in
//               pieces; when the answer comes it closes to "Thought for N second(s)"; a click opens
//               it again with the reasoning; the answer is the stub's; its tokens are the stub's —
//               the input from message_start, fresh and cached together (142 in), the output from
//               message_delta (3 out).
//   replay    — the next turn carries the earlier answer's thinking block back, text and signature
//               unchanged, first in that answer (Sirius keeps this history, so nothing drops it);
//               its message_delta carries an input count too, and null cache counts, as a turn
//               with server tools may: 150 in and 5 out (a reader of the delta alone shows 20, one
//               that adds the two 162).
//   modes     — Ask, Edit and Agent each reach the model in the system prompt; Agent by default.
//   effort    — Low goes out as effort low with thinking on, Thinking off as thinking disabled,
//               High as effort high.
//   copy      — a code block's Copy puts its code on the clipboard.
//   errors    — Anthropic's HTTP 529 is shown with its message, and an error event mid-answer
//               keeps the half answer and says what happened; Retry is offered on both.
//   stop      — "think hold" is held mid-thought by the stub; Stop closes the connection at once
//               and the answer is marked Stopped, with no token count (the vendor never gave one).
//   retry     — Retry answers the last question again, in place of the last answer.
//   send key  — with sirius.panel.sendWith set to ctrlEnter, the message box says so, Enter does
//               not send and Ctrl+Enter does; set back, Enter sends again.
//   sessions  — the conversations list holds this one and the providers' one; New starts an empty
//               one; opening the old one brings its turns back; deleting the providers' one takes
//               it, and only it, off the list.
//   tab       — Open in New Tab gives a second panel, a new conversation, with the same models.
//   csp       — no page of the panel logged a content-security violation; one made on purpose is
//               seen, so the check can see one.
//   sanitising — an answer that tries to run code, post a key away, restyle the panel or draw its
//               parts renders as text: no script, frame, form, field, button, stylesheet or image
//               map, no handler, no javascript: address, no class but a code block's language-*,
//               and nothing ran; a task list keeps its checkboxes, disabled; the composer is shown.
//   links     — a person's click (a trusted one, through CDP) on a link goes out through VS Code
//               once: it asks first (the site is not a trusted one), nothing opens before Open, and
//               then the system's opener — the harness's, which only records it — gets it once; a
//               mailto: link opens nothing; the panel stays where it was.
//   reload    — after the window reloads, the side panel shows the last conversation again.
//   at rest   — no file in the profile's folder holds the key, while the conversations are there
//               to be found (the run's keyring is held in memory, so this covers what VS Code
//               writes to disk — settings, state and logs — not the keyring itself).
// Progress in <result>.log; the part before the reload in <result>.before-reload.json.

const fs = require('fs');
const path = require('path');
const { connectWebview, connectWindow } = require(path.join(__dirname, '..', 'cdp-window.js'));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const OUT = process.env.SIRIUS_PROBE_OUT;
const PROFILE = process.env.SIRIUS_PROBE_USER_DIR;
const HOSTED = 'http://127.0.0.1:11992';
const OPENAI = 'http://127.0.0.1:11991/v1';
const STUBLOG = process.env.SIRIUS_PROBE_STUBLOG;
const OPENED = process.env.SIRIUS_PROBE_OPENED;
const KEY = 'good-key';
const EXTENSION = 'siriuside.sirius-ai';
const MODEL = 'anthropic/claude-stub-adaptive';
const OTHERS = { gemini: 'gemini/gemini-stub-flash', openai: 'openai/stub-model', llamacpp: 'llamacpp/stub-model', ollama: 'ollama/stub-coder:1b' };
const REASONING = 'Stub reasoning for round 0: first the files, then the answer.';
const BEFORE = `${OUT}.before-reload.json`;
const CLOSE_WITHIN_MS = 3000;
const STEPS = ['Open Sirius', 'Add a model', 'Ask, Edit or Agent', 'Keep your conversations'];

const log = line => { if (OUT) { fs.appendFileSync(`${OUT}.log`, `${new Date().toISOString().slice(11, 19)} ${line}\n`); } };
const stubRequests = async () => (await fetch(`${HOSTED}/__requests`)).json();
const anthropicSince = async from => (await stubRequests()).slice(from).filter(r => r.method === 'POST' && r.path.startsWith('/v1/messages'));
/** The OpenAI stub's chat requests, as its log printed them. */
const openaiRequests = () => (STUBLOG && fs.existsSync(STUBLOG) ? fs.readFileSync(STUBLOG, 'utf8').split('\n') : [])
	.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } })
	.filter(r => r.method === 'POST' && r.url === '/v1/chat/completions');
const js = value => JSON.stringify(value);

/** What the panel shows, read from its page. */
const SNAPSHOT = `({
	title: document.querySelector('.bar .title')?.textContent ?? '',
	empty: document.querySelector('.empty')?.textContent ?? null,
	turns: [...document.querySelectorAll('.turn')].map(t => {
		const thinking = t.querySelector('.thinking');
		return {
			role: t.classList.contains('user') ? 'user' : 'assistant',
			streaming: t.classList.contains('streaming'),
			text: t.querySelector('.markdown, .bubble')?.textContent ?? '',
			thinking: thinking ? { open: thinking.classList.contains('open'), streaming: thinking.classList.contains('streaming'), label: thinking.querySelector('.label')?.textContent ?? '', text: thinking.querySelector('.thinking-body')?.textContent ?? '' } : null,
			meta: t.querySelector('.meta')?.textContent ?? '',
			error: t.querySelector('.error')?.textContent ?? '',
			retry: !!t.querySelector('.meta button[title="Retry"]'),
			code: [...t.querySelectorAll('.code pre')].map(p => p.textContent)
		};
	}),
	models: [...document.querySelectorAll('footer select[title="Model"] option')].map(o => o.value),
	model: document.querySelector('footer select[title="Model"]')?.value ?? null,
	placeholder: document.querySelector('footer textarea')?.placeholder ?? '',
	stop: !document.querySelector('button[title="Stop"]')?.hidden,
	sessions: [...document.querySelectorAll('ul.sessions .session-title')].map(e => e.textContent),
	providers: Object.fromEntries([...document.querySelectorAll('.provider')].map(p => [p.dataset.provider, p.querySelector('.provider-status')?.textContent ?? ''])),
	refreshing: [...document.querySelectorAll('.setup > button')].some(b => b.textContent === 'Checking…')
})`;
const click = selector => `(() => { const b = document.querySelector(${js(selector)}); if (b) { b.click(); } return !!b; })()`;
/** Types `text` into the message box and presses Enter, with the modifier keys in `keys`. */
const press = (text, keys = {}) => `(() => { const t = document.querySelector('footer textarea'); t.value = ${js(text)}; t.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...${js(keys)} })); return true; })()`;
const sendText = text => press(text);
const choose = (selector, value) => `(() => { const s = document.querySelector(${js(selector)}); s.value = ${js(value)}; s.dispatchEvent(new window.Event('change', { bubbles: true })); return s.value; })()`;
const fill = (provider, field, value, button) => `(() => {
	const row = document.querySelector('[data-provider=${js(provider)}]');
	const input = row?.querySelector(${js(field)});
	if (!input) { return false; }
	input.value = ${js(value)};
	[...row.querySelectorAll('button')].find(b => b.textContent === ${js(button)})?.click();
	return true;
})()`;

/** The walkthrough's steps as the Welcome page shows them. */
const WALKTHROUGH = `[...document.querySelectorAll('.getting-started-step')].map(s => ({ title: s.querySelector('.step-title')?.textContent ?? '', done: !!s.querySelector('.codicon.complete') }))`; // the step's badge is checked when it is done
const clickText = (selector, text) => `(() => { const b = [...document.querySelectorAll(${js(selector)})].find(x => x.textContent.trim() === ${js(text)}); if (b) { b.click(); } return !!b; })()`;

/** The vendors' own APIs: the panel's requests to them never leave this machine during a probe. */
const VENDOR_HOSTS = /^(api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.openai\.com|openrouter\.ai|api\.groq\.com|api\.deepseek\.com|api\.mistral\.ai|api\.x\.ai)$/;
const vendorCalls = [];

/**
 * Stands in for the vendors' APIs inside this extension host, which the edition shares: OpenAI's
 * models and a streamed chat (with usage, 7 in and 2 out, only when the request asks for it) are
 * answered here; a request to any other vendor is refused. Every one is recorded.
 */
function guardVendors() {
	const original = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
		if (!VENDOR_HOSTS.test(url.hostname)) {
			return original(input, init);
		}
		let body;
		try { body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined; } catch { /* not JSON */ }
		const call = { host: url.hostname, path: url.pathname, method: init?.method ?? 'GET', streamOptions: body?.stream_options ?? null, answered: false };
		vendorCalls.push(call);
		if (url.hostname === 'api.openai.com' && url.pathname === '/v1/models') {
			call.answered = true;
			return new Response(JSON.stringify({ object: 'list', data: [{ id: 'stub-model', object: 'model' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
		}
		if (url.hostname === 'api.openai.com' && url.pathname === '/v1/chat/completions' && body?.stream) {
			call.answered = true;
			const asked = [...(body.messages ?? [])].reverse().find(m => m.role === 'user')?.content ?? '';
			const chunks = [{ choices: [{ index: 0, delta: { role: 'assistant', content: `pong ${asked}` } }] }, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }];
			if (body.stream_options?.include_usage === true) {
				chunks.push({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 } });
			}
			return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
		}
		throw new TypeError(`refused by the probe: ${url.origin}${url.pathname}`);
	};
}

/** A person's click — a trusted one, as VS Code's own handlers require — on what `selector` finds. */
async function realClick(target, selector) {
	const at = await target.evaluate(`(() => {
		const e = document.querySelector(${js(selector)});
		if (!e) { return null; }
		e.scrollIntoView({ block: 'center' });
		const r = e.getBoundingClientRect();
		const f = window.frameElement ? window.frameElement.getBoundingClientRect() : { left: 0, top: 0 };
		return { x: f.left + r.left + Math.min(r.width / 2, 12), y: f.top + r.top + r.height / 2 };
	})()`);
	if (!at) {
		return false;
	}
	await target.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
	await target.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
	await target.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 });
	return true;
}

/** Every file under `dir` whose bytes hold `needle`, by its path under `dir`. */
function filesHolding(dir, needle) {
	const hits = [];
	const walk = folder => {
		for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
			const file = path.join(folder, entry.name);
			if (entry.isDirectory()) {
				walk(file);
			} else if (entry.isFile()) {
				try {
					if (fs.statSync(file).size < 64 * 1024 * 1024 && fs.readFileSync(file).includes(needle)) {
						hits.push(path.relative(dir, file));
					}
				} catch { /* gone, or locked */ }
			}
		}
	};
	walk(dir);
	return hits;
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
	const save = () => { if (OUT) { fs.writeFileSync(`${OUT}.partial.json`, JSON.stringify({ ok: failures.length === 0, failures, ...result }, null, 1)); } };
	guardVendors();

	// ── walkthrough: before Sirius is opened, as after an install ─────────────
	const win = await connectWindow(vscode.env.appRoot);
	const walkthroughStep = title => `(() => { const s = [...document.querySelectorAll('.getting-started-step')].find(x => x.querySelector('.step-title')?.textContent === ${js(title)}); s?.click(); return !!s; })()`;
	const stepButton = text => clickText('.getting-started-step .button-link, .getting-started-step a, .getting-started-step button.monaco-button', text);
	if (!reloaded) {
		log('walkthrough: Get started with Sirius, and its Open Models and Keys before Sirius was ever opened');
		result.walkthrough = { activeBefore: !!vscode.extensions.getExtension(EXTENSION)?.isActive };
		await vscode.commands.executeCommand('workbench.action.openWalkthrough', `${EXTENSION}#start`, false);
		let steps = [];
		for (let i = 0; i < 60 && steps.length < STEPS.length; i++) {
			steps = await win.evaluate(WALKTHROUGH);
			if (steps.length < STEPS.length) { await sleep(250); }
		}
		await win.evaluate(walkthroughStep('Add a model'));
		await sleep(500);
		result.walkthrough.steps = steps.map(s => s.title);
		result.walkthrough.openModels = await win.evaluate(stepButton('Open Models and Keys'));
		check(!result.walkthrough.activeBefore, 'walkthrough: Sirius was running before anything opened it, so the first open is not tested');
		check(js(result.walkthrough.steps) === js(STEPS), `walkthrough: the steps are not ${js(STEPS)} (${js(steps)})`);
		check(result.walkthrough.openModels, 'walkthrough: no "Open Models and Keys" button');
	} else {
		await vscode.commands.executeCommand('sirius.open');
	}
	const panel = await connectWebview(EXTENSION, 'webviewView');
	// Everything the panel's page logs, from its load on: `Log.enable` sends what came before.
	const pageLog = [];
	panel.on('Log.entryAdded', ({ entry }) => pageLog.push({ source: entry.source, level: entry.level, text: entry.text }));
	await panel.send('Log.enable');
	const snap = () => panel.evaluate(SNAPSHOT);
	/** The first snapshot `ok` accepts, asking every 150 ms for up to `ms`. */
	const until = async (ok, ms = 20000) => {
		let s;
		for (const deadline = Date.now() + ms; Date.now() < deadline;) {
			s = await snap();
			if (!s.noContent && ok(s)) { return s; }
			await sleep(150);
		}
		return s;
	};
	const last = s => s.turns[s.turns.length - 1];
	/** Sends `text` and waits for its answer to finish. */
	const ask = async (text, ms = 20000) => {
		const before = (await snap()).turns.length;
		await panel.evaluate(sendText(text));
		return last(await until(s => s.turns.length >= before + 2 && last(s)?.role === 'assistant' && !last(s).streaming && !s.stop, ms));
	};

	// ── reload: the second activation, after the window reloaded ──────────────
	if (reloaded) {
		log('reload: the panel after the window reloaded');
		const after = await until(s => s.turns.length > 0, 20000);
		result.reload = { title: after.title, turns: after.turns.length };
		check(after.turns.length === result.beforeReload?.turns && after.title === result.beforeReload?.title, `reload: the panel did not show the last conversation again (${JSON.stringify(result.reload)} vs ${JSON.stringify(result.beforeReload)})`);
		result.guardAfterReload = vendorCalls;
		check(vendorCalls.length === 0, `guard: after the reload the panel called a vendor's API (${js(vendorCalls)})`);
		panel.close();
		win.close();

		// ── at rest ───────────────────────────────────────────────────────────────
		// The window that reloaded has written its storage away; the keyring is this run's own.
		log('at rest: the profile\'s folder');
		if (PROFILE) {
			const keyFiles = filesHolding(PROFILE, KEY);
			const titleFiles = filesHolding(PROFILE, result.beforeReload?.title ?? 'slow: think about it');
			result.atRest = { keyFiles, titleFiles };
			check(keyFiles.length === 0, `at rest: the key is in the profile's folder (${keyFiles.join(', ')})`);
			check(titleFiles.length > 0, 'at rest: the conversations are not in the profile\'s folder either, so the scan saw nothing');
		} else {
			check(false, 'at rest: no SIRIUS_PROBE_USER_DIR — run through vscode-run.sh');
		}
		return { ok: failures.length === 0, failures, ...result };
	}

	// ── walkthrough, continued: what the panel opened on, and the steps done ───
	const setupFirst = await until(s => s.title === 'Models and Keys', 10000);
	result.walkthrough.panelTitle = setupFirst?.title;
	check(setupFirst?.title === 'Models and Keys', `walkthrough: "Open Models and Keys", with Sirius not yet opened, did not open the panel on Models and Keys (${js(setupFirst?.title)})`);
	let done = [];
	for (let i = 0; i < 40 && !done.includes('Open Sirius'); i++) {
		done = (await win.evaluate(WALKTHROUGH)).filter(s => s.done).map(s => s.title);
		if (!done.includes('Open Sirius')) { await sleep(250); }
	}
	result.walkthrough.doneOnOpen = done;
	check(done.includes('Open Sirius'), `walkthrough: "Open Sirius" is not done once Sirius is open (${js(done)})`);
	check(!done.includes('Ask, Edit or Agent'), `walkthrough: "Ask, Edit or Agent" is done before any question was asked (${js(done)})`);

	// ── start ─────────────────────────────────────────────────────────────────
	log('start');
	await panel.evaluate(click('button[title="Back to the conversation"]'));
	const start = await until(s => s.empty !== null && !/Looking/.test(s.models.join()));
	result.start = { empty: start.empty, models: start.models.length };
	const local = start.models.some(m => /^(ollama|lmstudio|llamacpp)\//.test(m));
	check(local ? /Ask anything/.test(start.empty ?? '') : /Add a provider/.test(start.empty ?? '') && start.models.every(m => !m.includes('/')),
		`start: the panel did not say how to begin for ${local ? 'the local models it found' : 'no models'} (${JSON.stringify(start.empty)})`);

	// ── setup ─────────────────────────────────────────────────────────────────
	log('setup: the stubs\' addresses and a key for Anthropic, Gemini, OpenAI and llama.cpp; Ollama\'s address');
	await panel.evaluate(click('button[title="Models and keys"]'));
	await until(s => 'anthropic' in s.providers);
	for (const [provider, address, key] of [['anthropic', HOSTED, KEY], ['gemini', HOSTED, KEY], ['openai', OPENAI, KEY], ['llamacpp', OPENAI, KEY], ['ollama', HOSTED, undefined]]) {
		await panel.evaluate(fill(provider, 'input[type="text"]', address, 'Save address'));
		await sleep(500);
		await until(s => provider in s.providers);
		if (key) {
			await panel.evaluate(fill(provider, 'input[type="password"]', key, 'Save key'));
			await sleep(500);
		}
	}
	const PROVIDERS = ['anthropic', 'gemini', 'openai', 'llamacpp', 'ollama'];
	const ready = await until(s => PROVIDERS.every(p => /\d+ models?/.test(s.providers[p] ?? '')));
	result.setup = { providers: Object.fromEntries(PROVIDERS.map(p => [p, ready.providers[p]])), keyInPage: await panel.evaluate(`document.documentElement.outerHTML.includes(${js(KEY)})`) };
	for (const provider of PROVIDERS) {
		check(/\d+ models?/.test(ready.providers[provider] ?? ''), `setup: ${provider} did not offer the stub's models (${JSON.stringify(ready.providers[provider])})`);
	}
	check(result.setup.keyInPage === false, 'setup: a key is in the webview\'s page');
	for (let i = 0; i < 40; i++) {
		done = (await win.evaluate(WALKTHROUGH)).filter(s => s.done).map(s => s.title);
		if (done.includes('Add a model')) { break; }
		await sleep(250);
	}
	result.walkthrough.done = done;
	check(done.includes('Add a model'), `walkthrough: "Add a model" is not done once a model is offered (${js(done)})`);
	save();

	// ── providers ─────────────────────────────────────────────────────────────
	log('providers: Gemini, OpenAI, llama.cpp and Ollama answer');
	await panel.evaluate(click('button[title="Back to the conversation"]'));
	await until(s => Object.values(OTHERS).every(m => s.models.includes(m)));
	result.providers = {};
	for (const [provider, model] of Object.entries(OTHERS)) {
		const from = (await stubRequests()).length;
		await panel.evaluate(choose('footer select[title="Model"]', model));
		await sleep(300);
		const answer = await ask(`a question for ${provider}`);
		const seen = (await stubRequests()).slice(from).filter(r => r.method === 'POST');
		const openai = openaiRequests().filter(r => r.ask === `a question for ${provider}`);
		result.providers[provider] = { text: answer?.text, meta: answer?.meta, stub: seen.map(r => ({ path: r.path.split('?')[0], keyHeader: r.keyHeader, authorized: r.authorized })), openai };
		check(answer && answer.text.includes(`pong a question for ${provider}`), `providers: ${provider} did not answer through the panel (${js(answer)})`);
		if (provider === 'openai') {
			check(!/\d+ in/.test(answer?.meta ?? ''), `providers: OpenAI at another address than its own shows a token count it was not asked for (${js(answer?.meta)})`);
			check(openai.length === 1 && openai[0].streamUsage === false, `providers: OpenAI at another address than its own was sent stream_options (${js(openai)})`);
		} else {
			check(/^12 in · 3 out\b/.test(answer?.meta ?? ''), `providers: ${provider}'s answer does not show the stub's 12 in and 3 out (${js(answer?.meta)})`);
		}
		if (provider === 'llamacpp') {
			check(openai.length === 1 && openai[0].streamUsage === true, `providers: llama.cpp was not sent stream_options (${js(openai)})`);
		}
		if (provider === 'gemini') {
			let asked = [];
			for (let i = 0; i < 40 && !asked.includes('Ask, Edit or Agent'); i++) {
				asked = (await win.evaluate(WALKTHROUGH)).filter(s => s.done).map(s => s.title);
				if (!asked.includes('Ask, Edit or Agent')) { await sleep(250); }
			}
			result.walkthrough.doneAfterAsking = asked;
			check(asked.includes('Ask, Edit or Agent'), `walkthrough: "Ask, Edit or Agent" is not done once a question was asked (${js(asked)})`);
		}
	}
	check(result.providers.gemini?.stub.some(r => /:streamGenerateContent$/.test(r.path) && r.keyHeader === 'x-goog-api-key' && r.authorized), `providers: Gemini's request did not carry its key in x-goog-api-key (${js(result.providers.gemini?.stub)})`);
	check(result.providers.ollama?.stub.some(r => r.path === '/api/chat'), `providers: Ollama's request did not reach /api/chat (${js(result.providers.ollama?.stub)})`);

	log('providers: a Gemini answer stopped part-way');
	await panel.evaluate(choose('footer select[title="Model"]', OTHERS.gemini));
	await sleep(300);
	let from = (await stubRequests()).length;
	await panel.evaluate(sendText('a gemini hold'));
	let geminiHeld;
	for (let i = 0; i < 100 && !geminiHeld; i++) {
		geminiHeld = (await stubRequests()).slice(from).find(r => r.method === 'POST' && r.held);
		if (!geminiHeld) { await sleep(100); }
	}
	await sleep(300);
	await panel.evaluate(click('button[title="Stop"]'));
	const geminiStopped = last(await until(s => !s.stop && !last(s)?.streaming, 5000));
	result.providers.geminiStopped = { held: !!geminiHeld, meta: geminiStopped?.meta };
	check(!!geminiHeld && /Stopped/.test(geminiStopped?.meta ?? ''), `providers: the Gemini answer was not held and then stopped (${js(result.providers.geminiStopped)})`);
	check(!/\d+ in/.test(geminiStopped?.meta ?? ''), `providers: a Gemini answer stopped part-way shows a token count — the prompt's, not the answer's (${js(geminiStopped?.meta)})`);

	log('providers: OpenAI at its own address');
	const others = (await snap()).title;
	await panel.evaluate(click('button[title="Models and keys"]'));
	await until(s => 'openai' in s.providers);
	await panel.evaluate(fill('openai', 'input[type="text"]', '', 'Save address'));
	// The page shows the last discovery until the new one ends: wait for OpenAI's own API to be asked, then for the end.
	for (let i = 0; i < 100 && !vendorCalls.some(call => call.path === '/v1/models'); i++) { await sleep(150); }
	await sleep(300);
	await until(s => !s.refreshing && /\d+ models?/.test(s.providers.openai ?? ''));
	await panel.evaluate(click('button[title="Back to the conversation"]'));
	await until(s => s.title === others && s.models.includes(OTHERS.openai));
	await panel.evaluate(choose('footer select[title="Model"]', OTHERS.openai));
	await sleep(300);
	const ownCalls = vendorCalls.length;
	const own = await ask('a question for openai at its own address');
	const ownChat = vendorCalls.slice(ownCalls).find(c => c.path === '/v1/chat/completions');
	result.providers.openaiOwn = { meta: own?.meta, text: own?.text, chat: ownChat };
	check(own?.text?.includes('pong a question for openai at its own address'), `providers: OpenAI at its own address did not answer (${js(own)})`);
	check(ownChat?.streamOptions?.include_usage === true, `providers: OpenAI at its own address was not asked for its usage (${js(ownChat)})`);
	check(/^7 in · 2 out\b/.test(own?.meta ?? ''), `providers: OpenAI at its own address does not show its 7 in and 2 out (${js(own?.meta)})`);
	save();

	// ── thinking ──────────────────────────────────────────────────────────────
	log('thinking: slow thinking, then the answer');
	await panel.evaluate(click('button[title="New conversation"]'));
	const chat = await until(s => s.turns.length === 0 && s.models.includes(MODEL));
	check(chat.models.includes(MODEL), `thinking: ${MODEL} is not offered (${chat.models.join(', ')})`);
	await panel.evaluate(choose('footer select[title="Model"]', MODEL));
	from = (await stubRequests()).length;
	await panel.evaluate(sendText('slow: think about it'));
	const samples = [];
	let finished;
	for (const deadline = Date.now() + 30000; Date.now() < deadline;) {
		const s = await snap();
		const turn = last(s);
		if (turn?.role === 'assistant' && turn.thinking?.streaming) {
			samples.push({ length: turn.thinking.text.length, open: turn.thinking.open, label: turn.thinking.label });
		}
		if (turn?.role === 'assistant' && !turn.streaming && turn.text) { finished = s; break; }
		await sleep(100);
	}
	const answer = finished ? last(finished) : undefined;
	const firstAnswer = (await anthropicSince(from))[0];
	await panel.evaluate(click('.turn:last-child .thinking-head'));
	const reopened = last(await until(s => last(s)?.thinking?.open === true, 3000));
	result.thinking = { samples: samples.length, lengths: [...new Set(samples.map(s => s.length))], answer, reopened: reopened?.thinking };
	check(samples.length > 0 && samples.every(s => s.open && s.label === 'Thinking…'), `thinking: the block was not seen open and streaming (${JSON.stringify(samples.slice(0, 3))})`);
	check(samples.some(s => s.length > 0 && s.length < REASONING.length), 'thinking: the reasoning was never seen part-way');
	check(answer && answer.thinking && !answer.thinking.open && /^Thought for \d+ seconds?$/.test(answer.thinking.label), `thinking: the block did not close to "Thought for N seconds" (${JSON.stringify(answer?.thinking)})`);
	check(answer && /pong slow: think about it/.test(answer.text), `thinking: the answer was ${JSON.stringify(answer?.text)}`);
	check(answer && /^142 in · 3 out\b/.test(answer.meta), `thinking: the tokens are not 142 in and 3 out (${JSON.stringify(answer?.meta)})`);
	check(reopened?.thinking?.text === REASONING, `thinking: the reopened block does not hold the reasoning (${JSON.stringify(reopened?.thinking)})`);
	save();

	// ── replay ────────────────────────────────────────────────────────────────
	log('replay: the next turn carries the thinking back');
	from = (await stubRequests()).length;
	const again = await ask('think again, recount');
	const second = (await anthropicSince(from))[0];
	const earlier = (second?.body?.messages ?? []).filter(m => m.role === 'assistant')[0];
	const block = Array.isArray(earlier?.content) ? earlier.content[0] : undefined;
	result.replay = { firstStatus: firstAnswer?.status, sentBack: block ? { type: block.type, thinking: block.thinking, signature: block.signature } : earlier?.content ?? null, meta: again?.meta };
	check(block?.type === 'thinking' && block.thinking === REASONING && /^stub-signature-0-[0-9a-f]{12}$/.test(block.signature ?? ''), `replay: the earlier answer's thinking did not go back unchanged (${JSON.stringify(result.replay.sentBack)})`);
	check(/^150 in · 5 out\b/.test(again?.meta ?? ''), `replay: the tokens are not 150 in and 5 out — message_delta's numbers over message_start's (${JSON.stringify(again?.meta)})`);
	save();

	// ── modes ─────────────────────────────────────────────────────────────────
	log('modes: Ask, Edit and Agent reach the model');
	result.modes = { first: /Agent mode/.test(js(firstAnswer?.body?.system)) };
	check(result.modes.first, `modes: the first question did not go out in Agent mode, the default (${js(firstAnswer?.body?.system)})`);
	for (const [mode, label] of [['ask', 'Ask'], ['edit', 'Edit'], ['agent', 'Agent']]) {
		await panel.evaluate(choose('footer select[title="Mode"]', mode));
		await sleep(300);
		from = (await stubRequests()).length;
		await ask(`which mode is ${mode}`);
		const system = js((await anthropicSince(from))[0]?.body?.system);
		result.modes[mode] = system.includes(`${label} mode`);
		check(result.modes[mode], `modes: ${label} did not reach the model's system prompt (${system})`);
	}
	save();

	// ── effort ────────────────────────────────────────────────────────────────
	log('effort: Low, Thinking off, High');
	result.effort = {};
	for (const effort of ['low', 'off', 'high']) {
		await panel.evaluate(choose('footer select[title="Thinking"]', effort));
		await sleep(300);
		from = (await stubRequests()).length;
		await ask(`effort ${effort}`);
		const body = (await anthropicSince(from))[0]?.body;
		result.effort[effort] = { thinking: body?.thinking, effort: body?.output_config?.effort };
	}
	check(result.effort.low.thinking?.type === 'adaptive' && result.effort.low.effort === 'low', `effort: Low did not go out as effort low with thinking on (${js(result.effort.low)})`);
	check(result.effort.off.thinking?.type === 'disabled', `effort: Thinking off did not go out as thinking disabled (${js(result.effort.off)})`);
	check(result.effort.high.thinking?.type === 'adaptive' && result.effort.high.effort === 'high', `effort: High did not go out as effort high with thinking on (${js(result.effort.high)})`);
	save();

	// ── copy ──────────────────────────────────────────────────────────────────
	log('copy: a code block\'s Copy');
	const shown = await ask('show me');
	await vscode.env.clipboard.writeText('');
	await panel.evaluate(click('.turn:last-child .code button[title="Copy"]'));
	let copied = '';
	for (let i = 0; i < 20 && !copied; i++) {
		copied = await vscode.env.clipboard.readText();
		if (!copied) { await sleep(150); }
	}
	result.copy = { code: shown?.code, copied };
	check(shown?.code?.length > 0 && copied === shown.code[0], `copy: Copy did not put the code block's code on the clipboard (${js(result.copy)})`);
	save();

	// ── errors ────────────────────────────────────────────────────────────────
	log('errors: an HTTP 529, then an error event mid-answer');
	const overloaded = await ask('overloaded');
	const midway = await ask('overloaded midway');
	result.errors = { overloaded: { text: overloaded?.text, meta: overloaded?.meta, retry: overloaded?.retry }, midway: { text: midway?.text, meta: midway?.meta, retry: midway?.retry } };
	check(/529/.test(overloaded?.text ?? '') && /Overloaded/.test(overloaded?.text ?? '') && overloaded?.retry, `errors: the HTTP 529 was not shown with its message and Retry (${js(result.errors.overloaded)})`);
	check(/^Half an answer/.test(midway?.text ?? '') && /stopped mid-answer \(overloaded_error\): Overloaded/.test(midway?.text ?? '') && midway?.retry, `errors: the error mid-answer was not shown after the half answer, with Retry (${js(result.errors.midway)})`);
	check(!/\d+ in/.test(midway?.meta ?? ''), `errors: the answer cut off mid-way shows a token count the vendor never gave (${js(midway?.meta)})`);
	save();

	// ── stop ──────────────────────────────────────────────────────────────────
	log('stop: Stop mid-thought');
	from = (await stubRequests()).length;
	await panel.evaluate(sendText('think hold'));
	let held;
	for (let i = 0; i < 100 && !held; i++) {
		held = (await stubRequests()).slice(from).find(r => r.method === 'POST' && r.held);
		if (!held) { await sleep(100); }
	}
	await sleep(500);
	const during = last(await snap());
	const stoppedAt = Date.now();
	await panel.evaluate(click('button[title="Stop"]'));
	let release;
	for (let i = 0; i < 80 && !release; i++) {
		const record = (await stubRequests()).find(r => r.n === held?.n);
		if (record?.held?.releasedAt) { release = { by: record.held.by, closeMs: record.held.releasedAt - stoppedAt }; } else { await sleep(100); }
	}
	const stopped = last(await until(s => !s.stop && !last(s)?.streaming, 5000));
	result.stop = { held: !!held, during: during?.thinking, release, stopped: { meta: stopped?.meta, streaming: stopped?.streaming } };
	check(!!held, 'stop: the request never reached the stub\'s hold');
	check(during?.thinking?.streaming && during.thinking.text.length > 0, `stop: no thinking was streaming before Stop (${JSON.stringify(during)})`);
	check(release?.by === 'close' && release.closeMs >= 0 && release.closeMs <= CLOSE_WITHIN_MS, `stop: the connection did not close within ${CLOSE_WITHIN_MS} ms of Stop (${JSON.stringify(release)})`);
	check(/Stopped/.test(stopped?.meta ?? '') && !stopped?.streaming, `stop: the answer was not marked Stopped (${JSON.stringify(stopped)})`);
	check(!/\d+ in/.test(stopped?.meta ?? ''), `stop: the stopped answer shows a token count the vendor never gave (${JSON.stringify(stopped?.meta)})`);
	save();

	// ── retry ─────────────────────────────────────────────────────────────────
	log('retry');
	await panel.evaluate(sendText('a plain question'));
	const asked = await until(s => last(s)?.role === 'assistant' && !last(s).streaming && last(s).text.includes('pong a plain question'));
	from = (await stubRequests()).length;
	await panel.evaluate(click('.turn:last-child .meta button[title="Retry"]'));
	await sleep(300);
	const retried = await until(s => last(s)?.role === 'assistant' && !last(s).streaming && last(s).text.includes('pong a plain question'));
	const retryRequests = await anthropicSince(from);
	result.retry = { before: asked.turns.length, after: retried.turns.length, requests: retryRequests.length };
	check(retryRequests.length === 1 && retried.turns.length === asked.turns.length, `retry: not one new request in place of the last answer (${JSON.stringify(result.retry)})`);
	save();

	// ── send key ──────────────────────────────────────────────────────────────
	log('send key: Ctrl+Enter');
	await vscode.workspace.getConfiguration().update('sirius.panel.sendWith', 'ctrlEnter', vscode.ConfigurationTarget.Global);
	const ctrl = await until(s => /\b(Ctrl|Cmd)\+Enter to send/.test(s.placeholder), 5000);
	const before = ctrl.turns.length;
	await panel.evaluate(press('sent with ctrl enter'));
	await sleep(1500);
	const afterEnter = (await snap()).turns.length;
	await panel.evaluate(press('sent with ctrl enter', { ctrlKey: true }));
	const afterCtrl = last(await until(s => last(s)?.role === 'assistant' && !last(s).streaming && last(s).text.includes('pong sent with ctrl enter')));
	await vscode.workspace.getConfiguration().update('sirius.panel.sendWith', undefined, vscode.ConfigurationTarget.Global);
	const plain = await until(s => /^Ask Sirius… \(Enter to send/.test(s.placeholder), 5000);
	const back = await ask('sent with enter again');
	result.sendKey = { placeholder: ctrl.placeholder, enterSent: afterEnter !== before, ctrlAnswer: afterCtrl?.text, placeholderAfter: plain.placeholder, enterAgain: back?.text };
	check(/\b(Ctrl|Cmd)\+Enter to send/.test(ctrl.placeholder), `send key: the message box does not say Ctrl+Enter sends (${js(ctrl.placeholder)})`);
	check(afterEnter === before, 'send key: Enter sent the message while Ctrl+Enter is the send key');
	check(afterCtrl?.text?.includes('pong sent with ctrl enter'), `send key: Ctrl+Enter did not send (${js(afterCtrl)})`);
	check(back?.text?.includes('pong sent with enter again'), `send key: set back, Enter did not send (${js(back)})`);
	save();

	// ── sessions ──────────────────────────────────────────────────────────────
	log('sessions');
	const current = await snap();
	const title = current.title;
	const turns = current.turns.length;
	await panel.evaluate(click('button[title="Conversations"]'));
	const listed = await until(s => s.sessions.length > 1, 5000);
	await panel.evaluate(click('button[title="New conversation"]'));
	const fresh = await until(s => s.empty !== null && s.turns.length === 0, 5000);
	await panel.evaluate(click('button[title="Conversations"]'));
	await until(s => s.sessions.length > 0, 5000);
	await panel.evaluate(`(() => { const b = [...document.querySelectorAll('button.session')].find(x => x.querySelector('.session-title')?.textContent === ${js(title)}); b?.click(); return !!b; })()`);
	const reopenedSession = await until(s => s.turns.length === turns, 5000);
	await panel.evaluate(click('button[title="Conversations"]'));
	await until(s => s.sessions.includes(others), 5000);
	await panel.evaluate(click(`button[title=${js(`Delete "${others}"`)}]`));
	const afterDelete = await until(s => !s.sessions.includes(others), 5000);
	await panel.evaluate(click('button[title="Back to the conversation"]'));
	const backInChat = await until(s => s.title === title && s.turns.length === turns, 5000);
	result.sessions = { listed: listed.sessions, freshTurns: fresh.turns.length, reopened: { title: reopenedSession.title, turns: reopenedSession.turns.length }, afterDelete: afterDelete.sessions, back: { title: backInChat.title, turns: backInChat.turns.length } };
	check(listed.sessions.includes(title) && listed.sessions.includes(others), `sessions: the list does not hold "${title}" and "${others}" (${JSON.stringify(listed.sessions)})`);
	check(fresh.turns.length === 0, 'sessions: New did not start an empty conversation');
	check(reopenedSession.title === title && reopenedSession.turns.length === turns, `sessions: opening "${title}" did not bring its ${turns} turns back (${JSON.stringify(result.sessions.reopened)})`);
	check(!afterDelete.sessions.includes(others) && afterDelete.sessions.includes(title), `sessions: deleting "${others}" did not take it, and only it, off the list (${JSON.stringify(afterDelete.sessions)})`);
	check(backInChat.title === title && backInChat.turns.length === turns, `sessions: back in the conversation, "${title}" is not shown (${JSON.stringify(result.sessions.back)})`);
	save();

	// ── tab ───────────────────────────────────────────────────────────────────
	log('tab');
	await vscode.commands.executeCommand('sirius.panel.openInTab');
	const tab = await connectWebview(EXTENSION, 'webviewPanel');
	const tabLog = [];
	tab.on('Log.entryAdded', ({ entry }) => tabLog.push({ source: entry.source, level: entry.level, text: entry.text }));
	await tab.send('Log.enable');
	let tabState;
	for (let i = 0; i < 100; i++) {
		tabState = await tab.evaluate(SNAPSHOT);
		if (!tabState.noContent && tabState.models.includes(MODEL)) { break; }
		await sleep(150);
	}
	result.tab = { empty: tabState?.empty, turns: tabState?.turns?.length, models: tabState?.models?.length };
	check(tabState && tabState.turns.length === 0 && tabState.models.includes(MODEL), `tab: not a new conversation with the models (${JSON.stringify(result.tab)})`);
	tab.close();

	// ── csp ───────────────────────────────────────────────────────────────────
	log('csp: the pages\' logs');
	const violations = [...pageLog, ...tabLog].filter(e => /Content Security Policy/i.test(e.text));
	await panel.evaluate(`(() => { const i = document.createElement('img'); i.src = 'https://example.invalid/csp-check.png'; document.body.append(i); setTimeout(() => i.remove(), 2000); return true; })()`);
	let provoked;
	for (let i = 0; i < 30 && !provoked; i++) {
		provoked = pageLog.find(e => /Content Security Policy/i.test(e.text) && e.text.includes('csp-check.png'));
		if (!provoked) { await sleep(100); }
	}
	result.csp = { entries: pageLog.length + tabLog.length, violations, provoked: provoked?.text?.slice(0, 160) ?? null };
	check(violations.length === 0, `csp: the panel's pages logged content-security violations (${js(violations.slice(0, 3))})`);
	check(!!provoked, 'csp: a violation made on purpose was not seen, so the check cannot see one');
	save();

	// ── sanitising ────────────────────────────────────────────────────────────
	log('sanitising: an answer that tries to run code');
	const titleBefore = await panel.evaluate('document.title');
	const hostile = await ask('try to inject');
	await sleep(1000);
	result.sanitising = await panel.evaluate(`(() => {
		const md = [...document.querySelectorAll('.turn')].pop()?.querySelector('.markdown');
		if (!md) { return null; }
		// The panel's own bar on a code block (its Copy button) is not the answer's.
		const all = [...md.querySelectorAll('*')].filter(e => !e.closest('.code-bar'));
		const text = md.textContent.replace(/\\s+/g, ' ').trim();
		return {
			tags: [...new Set(all.map(e => e.tagName.toLowerCase()))].sort(),
			handlers: all.flatMap(e => [...e.attributes].filter(a => /^on/i.test(a.name)).map(a => e.tagName.toLowerCase() + '.' + a.name)),
			scriptUrls: all.flatMap(e => ['href', 'src', 'action', 'formaction', 'srcdoc'].map(n => e.getAttribute(n)).filter(v => v && /javascript:|<script/i.test(v))),
			fields: [...md.querySelectorAll('input')].map(i => ({ type: i.type, disabled: i.disabled })),
			classes: [...new Set(all.flatMap(e => [...e.classList]).filter(c => c !== 'code'))].sort(),
			start: text.slice(0, 40),
			end: text.slice(-40)
		};
	})()`) ?? {};
	result.sanitising.title = { before: titleBefore, after: await panel.evaluate('document.title') };
	result.sanitising.composer = await panel.evaluate(`(() => { const box = document.querySelector('footer textarea'); return !!box && !box.closest('[hidden]') && box.getBoundingClientRect().height > 0 && getComputedStyle(document.querySelector('footer')).display !== 'none'; })()`);
	const unwanted = (result.sanitising.tags ?? []).filter(t => ['script', 'iframe', 'object', 'embed', 'form', 'button', 'textarea', 'select', 'option', 'style', 'map', 'area'].includes(t));
	check(/^Before\./.test(result.sanitising.start ?? '') && /After\.$/.test(result.sanitising.end ?? ''), `sanitising: the answer did not render as text around what was removed (${js([result.sanitising.start, result.sanitising.end])})`);
	check(unwanted.length === 0, `sanitising: the answer put ${unwanted.join(', ')} on the page`);
	check((result.sanitising.handlers ?? []).length === 0, `sanitising: event handlers reached the page (${js(result.sanitising.handlers)})`);
	check((result.sanitising.scriptUrls ?? []).length === 0, `sanitising: a javascript: address or inline script reached the page (${js(result.sanitising.scriptUrls)})`);
	check(js(result.sanitising.fields) === js([{ type: 'checkbox', disabled: true }, { type: 'checkbox', disabled: true }]), `sanitising: the only fields left are not the task list's two disabled checkboxes (${js(result.sanitising.fields)})`);
	check(js(result.sanitising.classes) === js(['language-ts']), `sanitising: the answer's classes are not just its code block's language-ts — it could draw the panel's own parts (${js(result.sanitising.classes)})`);
	check(result.sanitising.title.after === titleBefore, `sanitising: code from the answer ran (the page's title became ${js(result.sanitising.title.after)})`);
	check(hostile?.retry && result.sanitising.composer, 'sanitising: the panel\'s own controls are gone after the answer');
	save();

	// ── links ─────────────────────────────────────────────────────────────────
	log('links: a person clicks a link in an answer');
	const openedLines = () => (OPENED && fs.existsSync(OPENED) ? fs.readFileSync(OPENED, 'utf8') : '').split('\n').filter(Boolean);
	const dialogs = () => win.evaluate(`[...document.querySelectorAll('.monaco-dialog-box')].map(d => d.textContent).join(' | ')`);
	const turnsBefore = (await ask('a link please')) && (await snap()).turns.length;
	const linesBefore = openedLines().length;
	const clicked = await realClick(panel, '.turn:last-child .markdown a[href="https://example.com/docs"]');
	let prompt = '';
	for (let i = 0; i < 40 && !prompt.includes('example.com'); i++) {
		prompt = await dialogs();
		if (!prompt.includes('example.com')) { await sleep(250); }
	}
	await sleep(1000);
	const beforeOpen = openedLines().slice(linesBefore);
	const openClicked = await win.evaluate(clickText('.monaco-dialog-box .monaco-button', 'Open'));
	let afterOpen = [];
	for (let i = 0; i < 40 && !afterOpen.some(line => line.includes('https://example.com/docs')); i++) {
		afterOpen = openedLines().slice(linesBefore);
		if (!afterOpen.some(line => line.includes('https://example.com/docs'))) { await sleep(250); }
	}
	await sleep(1000);
	afterOpen = openedLines().slice(linesBefore);
	const mailtoClicked = await realClick(panel, '.turn:last-child .markdown a[href^="mailto:"]');
	await sleep(2000);
	const afterMailto = openedLines().slice(linesBefore);
	const mailtoDialog = await dialogs();
	const afterLink = await snap();
	result.links = { clicked, prompt: prompt.slice(0, 200), beforeOpen, openClicked, afterOpen, mailtoClicked, afterMailto, mailtoDialog: mailtoDialog.slice(0, 120), turns: { before: turnsBefore, after: afterLink.turns.length } };
	check(clicked && mailtoClicked, `links: the links were not there to click (${js(result.links)})`);
	check(prompt.includes('example.com/docs'), `links: VS Code did not ask before opening the link — it did not go through VS Code (${js(prompt.slice(0, 200))})`);
	check(beforeOpen.length === 0, `links: something opened before the person said Open (${js(beforeOpen)})`);
	check(openClicked && afterOpen.length === 1 && afterOpen[0].includes('https://example.com/docs'), `links: after Open, the link did not go to the system's opener exactly once (${js(afterOpen)})`);
	check(afterMailto.length === afterOpen.length && !/mailto|someone@example\.com/.test(mailtoDialog), `links: a mailto: link in an answer opened something (${js(afterMailto)})`);
	check(afterLink.turns.length === turnsBefore, `links: the panel did not stay where it was (${js(result.links.turns)})`);
	save();

	// ── guard ─────────────────────────────────────────────────────────────────
	result.guard = vendorCalls;
	const unanswered = vendorCalls.filter(call => !call.answered);
	check(unanswered.length === 0, `guard: the panel called a vendor's API the probe did not mean it to (${js(unanswered)})`);
	check(vendorCalls.length > 0 && vendorCalls.every(call => call.host === 'api.openai.com'), `guard: the vendor calls are not just OpenAI's, at its own address, as this probe asked (${js(vendorCalls)})`);
	save();

	// ── reload ────────────────────────────────────────────────────────────────
	log('reload: the window reloads');
	const final = await snap();
	result.beforeReload = { title: final.title, turns: final.turns.length };
	fs.writeFileSync(BEFORE, JSON.stringify({ ...result, failures }, null, 1));
	panel.close();
	win.close();
	// Not awaited: the command's promise is cancelled as the window goes.
	vscode.commands.executeCommand('workbench.action.reloadWindow').then(undefined, () => { /* the window is reloading */ });
	return new Promise(() => { /* this extension host ends with the reload; the next one finishes */ });
};
