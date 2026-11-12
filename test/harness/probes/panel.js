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
//   tools     — Agent with thinking: a question about the files has the model call
//               sirius_list_directory; its card shows it done; the tool round carries the thinking
//               back unchanged (the stub's `replay`), and the answer is the tool's result. Agent is
//               offered another extension's tool (probe-tools-ext's harness_ping), and neither a
//               built-in extension's nor an MCP server's that VS Code has not started (the panel
//               starts none). The next turn sends that whole round back — every block one the stub
//               sent, unchanged (its `history`) — and Ask after it is offered Sirius's four alone.
//   approvals — harness_ping waits on its card, showing what it will run with, and runs on Allow
//               once. The stub MCP server (the profile's mcp.json), once started as a user would, in
//               VS Code's MCP commands: echo waits, runs on Allow once, waits again and is declined
//               on Deny; write_note, allowed for the conversation, is then asked about by VS Code
//               itself (Yes runs it); called again it is not asked about by the panel, and VS Code's
//               Cancel declines it; Stop while a card waits stops it, and the next question is
//               answered on that history.
//   ids       — Ollama names its calls call_0 every round: a two-round answer shows two cards of
//               its own; a question to Anthropic after it is answered (the stub refuses repeated
//               tool_use ids, as Anthropic does). An OpenAI-compatible model calling a tool with
//               `null` arguments, and under a Kimi-style id (`functions.<name>:0`), gets results and
//               the next questions are answered, by it and then by Anthropic (the stubs refuse a
//               call left without a result, input that is not an object and an id outside
//               Anthropic's pattern, as the vendors do).
//   pictures  — a tool's picture reaches Anthropic as an image and Ollama's text-only model as a
//               note that an image could not be shown.
//   deleting  — a conversation deleted while a card waits stays deleted.
//   edits     — the composer's Edits choice shows in Edit, not in Ask. Switched quickly through four
//               modes, a question goes out in the last, Edit, offered Sirius's four read tools and the
//               two that change files. A round of two changes waits on two cards with what each
//               changes, their buttons idle for half a second, and Accept all and Reject all; the
//               first opens in the diff editor, the file beside the change, with Accept Change and
//               Reject Change in its title bar. A real click on that Accept Change applies it and the
//               next change takes its place; a second click at once (a double-click) does not take
//               that one; Reject on its card leaves README.md as it was; the model is told which was
//               applied. Two changes to one file accepted in the other order both reach it; a change
//               rejected before another does not ride with it — each is applied to the file as it is
//               then. Accept all applies a new file and an edit. Undo in the file takes an accepted
//               change back, and in a new file deletes it. A file in .git, a new file that exists, a
//               path outside the workspace and text not in the file fail on their cards, never asked,
//               each saying why. A change building on a new file in its round is proposed with it, and
//               the same change asked twice is not. Under Auto-accept edits a change applies as it
//               comes and Show diff shows it, with no Accept in the title bar; a change to
//               .vscode/settings.json still waits, saying why; a file with unsaved changes gets the
//               change but is not saved. Switched quickly back to Ask before edits, the next change
//               waits; Stop while it waits leaves the file, closes the diff, and the next question is
//               answered on that history. In Agent, a round of a change, another extension's tool and
//               a change proposes the second change only after the tool ran. Every check reads the
//               files on disk.
//   context   — greet.js open with lines selected: the composer shows the file and the lines as chips,
//               and the question carries the selection before its words, its bubble saying so; with
//               the selection chip off it carries the lines around the cursor; with both off, its
//               words alone; a closed editor's file is no longer offered. "@READ" offers README.md
//               first; Enter takes it, and the question carries it between nonce-named tags. A file
//               outside the workspace chosen in VS Code's file picker (its simple dialog) goes with
//               the question. A pasted image reaches Anthropic as an image and Ollama's text-only
//               model as a note. The next question's history carries all of them as they went.
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
//   tab       — Open in New Tab gives a second panel, a new conversation, with the same models; opened
//               over greet.js in its group, hiding it, the panel still offers and sends greet.js.
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
//   reload    — first, in the tab, a round of two changes: one accepted, the other left waiting. Then
//               the window reloads while a card waits on the user (a two-round answer): after it,
//               the side panel shows the last conversation again, that answer with its first round
//               done and the waiting call stopped, and a next question is answered on that history;
//               the MCP server's tools are known before anything starts it (VS Code keeps them). The
//               tab comes back with the accepted change done and the other stopped, no diff of a
//               waiting change left open, and its next question goes out on a history that says so.
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
const GROQ_KEY = 'groqke-for-the-probe';
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
const openaiLines = () => (STUBLOG && fs.existsSync(STUBLOG) ? fs.readFileSync(STUBLOG, 'utf8').split('\n') : [])
	.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
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
			attached: [...t.querySelectorAll('.attached .chip')].map(c => c.textContent),
			streaming: t.classList.contains('streaming'),
			text: t.classList.contains('user') ? t.querySelector('.bubble')?.textContent ?? '' : [...t.querySelectorAll(':scope > .markdown')].map(m => m.textContent).join(''),
			tools: [...t.querySelectorAll(':scope > .tool')].map(c => ({ id: c.dataset.call, label: c.querySelector('.tool-label')?.textContent ?? '', status: ['running', 'waiting', 'done', 'failed', 'denied', 'stopped'].find(k => c.classList.contains(k)) ?? '', statusText: c.querySelector('.tool-status')?.textContent ?? '', asks: [...c.querySelectorAll('.tool-ask button')].map(b => b.textContent), armed: [...c.querySelectorAll('.tool-ask button.allow')].some(b => !b.disabled), waitedMs: Number(c.dataset.waitedMs ?? -1), input: c.querySelector('.tool-input')?.textContent ?? '', edit: c.classList.contains('edit'), counts: c.querySelector('.edit-counts')?.textContent ?? '', batch: c.dataset.batch ?? '' })),
			batches: [...t.querySelectorAll(':scope > .edit-batch')].map(b => ({ batch: b.dataset.batch, text: b.querySelector('span')?.textContent ?? '', buttons: [...b.querySelectorAll('button')].map(x => x.textContent), armed: [...b.querySelectorAll('button')].some(x => !x.disabled) })),
			thinking: thinking ? { open: thinking.classList.contains('open'), streaming: thinking.classList.contains('streaming'), label: thinking.querySelector('.label')?.textContent ?? '', text: thinking.querySelector('.thinking-body')?.textContent ?? '' } : null,
			meta: t.querySelector('.meta')?.textContent ?? '',
			error: t.querySelector('.error')?.textContent ?? '',
			retry: !!t.querySelector('.meta button[title="Retry"]'),
			code: [...t.querySelectorAll('.code pre')].map(p => p.textContent)
		};
	}),
	models: [...document.querySelectorAll('footer select[title="Model"] option')].map(o => o.value),
	model: document.querySelector('footer select[title="Model"]')?.value ?? null,
	edits: document.querySelector('footer select[title="Edits"]')?.hidden ? null : document.querySelector('footer select[title="Edits"]')?.value ?? null,
	chips: [...document.querySelectorAll('footer .chips .chip')].map(c => ({ text: c.querySelector('.chip-label')?.textContent ?? '', on: !c.classList.contains('off') })),
	suggest: document.querySelector('footer .suggest')?.hidden ? [] : [...document.querySelectorAll('footer .suggest .suggestion')].map(x => x.textContent),
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
/** Types `text` into the message box, the cursor at its end, as a person would (an input event). */
const typeText = text => `(() => { const t = document.querySelector('footer textarea'); t.focus(); t.value = ${js(text)}; t.setSelectionRange(t.value.length, t.value.length); t.dispatchEvent(new window.Event('input', { bubbles: true })); return true; })()`;
/** A key pressed in the message box, its text left as it is. */
const key = (name, keys = {}) => `(() => { document.querySelector('footer textarea').dispatchEvent(new window.KeyboardEvent('keydown', { key: ${js(name)}, bubbles: true, cancelable: true, ...${js(keys)} })); return true; })()`;
/** A 1×1 PNG, pasted. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const pasteImage = `(() => { const t = document.querySelector('footer textarea'); const bytes = Uint8Array.from(atob(${js(PNG)}), c => c.charCodeAt(0)); const data = new window.DataTransfer(); data.items.add(new window.File([bytes], 'shot.png', { type: 'image/png' })); t.dispatchEvent(new window.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); return true; })()`;
/** The text of a request's last user message, in any vendor's shape. */
const lastUserText = request => {
	const message = [...(request?.body?.messages ?? [])].reverse().find(m => m.role === 'user');
	return typeof message?.content === 'string' ? message.content : (message?.content ?? []).map(b => b.text ?? '').join('');
};
const choose = (selector, value) => `(() => { const s = document.querySelector(${js(selector)}); if (!s) { return null; } s.value = ${js(value)}; s.dispatchEvent(new window.Event('change', { bubbles: true })); return s.value; })()`;
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
		if (url.hostname === 'api.groq.com' && url.pathname === '/openai/v1/models') {
			call.answered = true;
			return new Response(JSON.stringify({ object: 'list', data: [{ id: 'stub-groq', object: 'model' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
		}
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

/** The panel's lines in its output channel ("Sirius"), as VS Code wrote them to the profile's logs. */
function panelLog() {
	const lines = [];
	const walk = folder => {
		for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
			const file = path.join(folder, entry.name);
			if (entry.isDirectory()) {
				walk(file);
			} else if (/Sirius\.log$/.test(entry.name)) {
				lines.push(...fs.readFileSync(file, 'utf8').split('\n').filter(line => line.includes('[panel]')));
			}
		}
	};
	try { walk(path.join(PROFILE ?? '', 'logs')); } catch { /* no logs yet */ }
	return lines;
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
		const kept = last(after);
		result.reload.kept = { cards: kept?.tools?.map(card => ({ label: card.label, status: card.status })), meta: kept?.meta };
		check(js(kept?.tools?.map(card => card.status)) === js(['done', 'stopped']) && /Stopped/.test(kept?.meta ?? ''), `reload: the answer that waited on a card was not kept with its first round done and the call stopped (${js(result.reload.kept)})`);
		// The harness's keyring is held in memory and is gone after a reload (a user's is not): the
		// key is saved again, and the question waits for Anthropic's models, or another would answer.
		await panel.evaluate(click('button[title="Models and keys"]'));
		await until(s => 'anthropic' in s.providers);
		await panel.evaluate(fill('anthropic', 'input[type="password"]', KEY, 'Save key'));
		await until(s => /\d+ models?/.test(s.providers.anthropic ?? ''), 20000);
		await panel.evaluate(click('button[title="Back to the conversation"]'));
		await until(s => s.model === MODEL, 20000);
		const reloadedFrom = (await stubRequests()).length;
		const next = await ask('a question after the reload');
		const nextRequest = (await stubRequests()).slice(reloadedFrom).filter(r => r.method === 'POST' && r.path.startsWith('/v1/messages'))[0];
		const stoppedResult = (nextRequest?.body?.messages ?? []).flatMap(m => Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_result') : []).map(b => JSON.stringify(b.content)).pop() ?? '';
		result.reload.next = { status: nextRequest?.status, text: next?.text?.slice(0, 80), stoppedResult: stoppedResult.slice(0, 80) };
		check(nextRequest?.status === 200 && /pong a question after the reload/.test(next?.text ?? '') && /Stopped by the user/.test(stoppedResult), `reload: the next question was not answered on the kept history (${js(result.reload.next)})`);
		result.mcpAfterReload = vscode.lm.tools.filter(tool => tool.tags.includes('mcp')).map(tool => tool.name);
		check(result.mcpAfterReload.includes('mcp_sirius-stub_echo'), `reload: the MCP server's tools are not known after the reload without starting it (${js(result.mcpAfterReload)})`);
		log('reload: the tab, its change applied before the reload kept as applied');
		const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
		const fileNow = name => { try { return fs.readFileSync(path.join(ws, name), 'utf8'); } catch { return null; } };
		const tabBack = await connectWebview(EXTENSION, 'webviewPanel', 20000).catch(error => ({ failed: String(error) }));
		if (tabBack.failed) {
			check(false, `reload: the tab did not come back (${tabBack.failed})`);
		} else {
			const tabUntil = async (ok, ms = 20000) => {
				let s;
				for (const deadline = Date.now() + ms; Date.now() < deadline;) {
					s = await tabBack.evaluate(SNAPSHOT);
					if (!s.noContent && ok(s)) { return s; }
					await sleep(150);
				}
				return s;
			};
			const keptTab = await tabUntil(s => s.turns.length > 0 && !last(s).streaming, 20000);
			const tabFrom = (await stubRequests()).length;
			await tabBack.evaluate(sendText('a question in the tab after the reload'));
			const tabNext = last(await tabUntil(s => s.turns.length >= keptTab.turns.length + 2 && !last(s).streaming && !s.stop, 20000));
			const tabRequest = (await anthropicSince(tabFrom))[0];
			const keptResults = (tabRequest?.body?.messages ?? []).flatMap(m => Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_result') : []).slice(-2)
				.map(b => typeof b.content === 'string' ? b.content : (b.content ?? []).map(x => x.text ?? '').join(''));
			result.reload.tab = {
				cards: (last(keptTab)?.tools ?? []).map(c => [c.label, c.status]),
				next: { status: tabRequest?.status, text: tabNext?.text?.slice(0, 60), results: keptResults.map(t => t.slice(0, 40)) },
				files: { readme: fileNow('README.md') === result.tabReload?.readme, greet: fileNow('greet.js')?.includes('Hi there') ?? false },
				proposalTabs: vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input?.modified?.scheme === 'sirius-proposal').map(t => t.label)
			};
			check(js(result.reload.tab.cards) === js([['Edit README.md', 'stopped'], ['Edit greet.js', 'done']]) && result.reload.tab.proposalTabs.length === 0, `reload: the tab did not keep the change applied before the reload as applied and the other as stopped, with no diff of the stopped one left open (${js(result.reload.tab)})`);
			check(tabRequest?.status === 200 && /pong a question in the tab after the reload/.test(tabNext?.text ?? '') && /^Stopped by the user/.test(keptResults[0] ?? '') && keptResults[1] === 'Edited greet.js.', `reload: the tab's next question did not go out on a history that has the applied change as applied (${js(result.reload.tab.next)})`);
			check(result.reload.tab.files.readme && result.reload.tab.files.greet, `reload: the files are not the applied change alone (${js(result.reload.tab.files)})`);
			tabBack.close();
		}
		result.guardAfterReload = vendorCalls;
		check(vendorCalls.length === 0, `guard: after the reload the panel called a vendor's API (${js(vendorCalls)})`);
		panel.close();
		win.close();

		// ── at rest ───────────────────────────────────────────────────────────────
		// The window that reloaded has written its storage away; the keyring is this run's own.
		log('at rest: the profile\'s folder');
		if (PROFILE) {
			const keyFiles = filesHolding(PROFILE, KEY);
			// The conversation is kept as JSON: a title with quotes in it is on disk with them escaped.
			const titleFiles = filesHolding(PROFILE, JSON.stringify(result.beforeReload?.title ?? 'slow: think about it').slice(1, -1));
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
	for (const [provider, address, key] of [['anthropic', HOSTED, KEY], ['gemini', HOSTED, KEY], ['openai', OPENAI, KEY], ['llamacpp', OPENAI, KEY], ['ollama', HOSTED, undefined], ['groq', undefined, GROQ_KEY]]) {
		if (address) {
			await panel.evaluate(fill(provider, 'input[type="text"]', address, 'Save address'));
			await sleep(500);
		}
		await until(s => provider in s.providers);
		if (key) {
			await panel.evaluate(fill(provider, 'input[type="password"]', key, 'Save key'));
			await sleep(500);
		}
	}
	const PROVIDERS = ['anthropic', 'gemini', 'openai', 'llamacpp', 'ollama', 'groq'];
	const ready = await until(s => PROVIDERS.every(p => /\d+ models?/.test(s.providers[p] ?? '')));
	result.setup = { providers: Object.fromEntries(PROVIDERS.map(p => [p, ready.providers[p]])), keyInPage: await panel.evaluate(`document.documentElement.outerHTML.includes(${js(KEY)})`) };
	for (const provider of PROVIDERS) {
		check(/\d+ models?/.test(ready.providers[provider] ?? ''), `setup: ${provider} did not offer the stub's models (${JSON.stringify(ready.providers[provider])})`);
	}
	check(result.setup.keyInPage === false, 'setup: a key is in the webview\'s page');
	const groqAt = { workspace: openaiLines().filter(line => line.bearer === GROQ_KEY.slice(0, 6)).map(line => line.url), own: vendorCalls.filter(call => call.host === 'api.groq.com').map(call => call.path) };
	result.addresses = groqAt;
	check(groqAt.workspace.length === 0, `addresses: Groq's key went to the address the workspace's settings named (${js(groqAt)})`);
	check(groqAt.own.includes('/openai/v1/models'), `addresses: Groq was not asked at its own address (${js(groqAt)})`);
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

	// ── tools ─────────────────────────────────────────────────────────────────
	log('tools: Agent with thinking calls a tool');
	const lastTool = s => last(s)?.tools?.[last(s).tools.length - 1];
	from = (await stubRequests()).length;
	const listing = await ask('think about the files here');
	const listRequests = await anthropicSince(from);
	const listResult = listRequests[1]?.body?.messages?.flatMap(m => Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_result') : []).pop();
	result.tools = { card: listing?.tools, text: listing?.text?.slice(0, 120), offered: (listRequests[0]?.body?.tools ?? []).map(t => t.name), requests: listRequests.map(r => ({ status: r.status, replay: r.replay ? { ok: r.replay.ok, round: r.replay.round } : undefined, history: r.history })), result: JSON.stringify(listResult?.content ?? null).slice(0, 160) };
	check(listing?.tools?.length === 1 && listing.tools[0].status === 'done' && /^List /.test(listing.tools[0].label), `tools: no done card for the directory listing (${js(listing?.tools)})`);
	check(listRequests.length === 2 && listRequests[1].replay?.ok === true, `tools: the tool round did not carry the thinking back unchanged (${js(result.tools.requests)})`);
	check(/greet\.js/.test(result.tools.result) && /README\.md/.test(result.tools.result), `tools: the listing the model got does not name the workspace's files (${result.tools.result})`);
	check(/pong tool/.test(listing?.text ?? ''), `tools: the answer is not the tool's result (${js(listing?.text)})`);
	check(result.tools.offered.includes('harness_ping'), `tools: Agent was not offered another extension's tool (${js(result.tools.offered)})`);
	check(!result.tools.offered.some(name => /^mcp_/.test(name) || name === 'renderMermaidDiagram'), `tools: Agent was offered a built-in extension's tool, or an MCP server's VS Code had not started (${js(result.tools.offered)})`);

	log('tools: the next turn sends the tool round back whole');
	from = (await stubRequests()).length;
	const followed = await ask('think about it once more');
	const follow = (await anthropicSince(from))[0];
	const shapes = (follow?.body?.messages ?? []).map(m => `${m.role}:${Array.isArray(m.content) ? m.content.map(b => b.type).join('+') : 'text'}`);
	result.tools.next = { status: follow?.status, history: follow?.history, shapes: shapes.slice(-6) };
	check(follow?.status === 200 && followed?.text?.includes('pong think about it once more'), `tools: the next turn was refused or not answered (${js(result.tools.next)})`);
	const questions = (follow?.body?.messages ?? []).map((m, i) => m.role === 'user' && (typeof m.content === 'string' || m.content.some(b => b.type === 'text')) ? i : -1).filter(i => i >= 0);
	const previousExchange = (follow?.body?.messages ?? []).slice(questions[questions.length - 2] + 1, questions[questions.length - 1]);
	const earlierBlocks = previousExchange.flatMap(m => m.role === 'assistant' && Array.isArray(m.content) ? m.content.filter(b => b.type === 'thinking') : []).length;
	result.tools.next.earlierBlocks = earlierBlocks;
	check(earlierBlocks === 2 && follow.history.genuine === follow.history.blocks, `tools: the next turn's history does not carry both rounds' blocks back as the stub sent them (${js({ earlierBlocks, history: follow?.history })})`);
	check(shapes.some((shape, i) => /^assistant:thinking\+tool_use$/.test(shape) && /^user:tool_result$/.test(shapes[i + 1] ?? '')), `tools: the next turn's history lost the earlier tool round (${js(shapes)})`);

	log('tools: Ask after the Agent turn');
	await panel.evaluate(choose('footer select[title="Mode"]', 'ask'));
	await sleep(300);
	from = (await stubRequests()).length;
	const inAsk = await ask('think in ask mode');
	const askRequest = (await anthropicSince(from))[0];
	result.tools.ask = { status: askRequest?.status, history: askRequest?.history, tools: (askRequest?.body?.tools ?? []).map(t => t.name) };
	check(askRequest?.status === 200 && inAsk?.text?.includes('pong think in ask mode'), `tools: Ask after the Agent turn was refused or not answered (${js(result.tools.ask)})`);
	check(js(result.tools.ask.tools.sort()) === js(['sirius_get_diagnostics', 'sirius_list_directory', 'sirius_read_file', 'sirius_search_files']), `tools: Ask was offered other tools than Sirius's four (${js(result.tools.ask.tools)})`);
	await panel.evaluate(choose('footer select[title="Mode"]', 'agent'));
	await sleep(300);
	save();

	// ── approvals ─────────────────────────────────────────────────────────────
	log('approvals: an MCP server\'s tools ask first');
	/** Sends `text`, waits for its tool's card to ask, and answers it with `choice`'s button. */
	const askAndAnswer = async (text, button) => {
		const before = (await snap()).turns.length;
		await panel.evaluate(sendText(text));
		const waiting = await until(s => s.turns.length >= before + 2 && lastTool(s)?.status === 'waiting', 30000);
		const card = lastTool(waiting);
		// A new card's buttons take no click for half a second; then they do.
		await until(s => lastTool(s)?.armed === true, 5000);
		const clicked = await panel.evaluate(clickText('.turn:last-child .tool.waiting .tool-ask button', button));
		return { card, clicked };
	};
	const vscodeDialog = async (answer) => {
		let text = '';
		for (let i = 0; i < 40 && !text.includes('write_note'); i++) {
			text = await win.evaluate(`[...document.querySelectorAll('.monaco-dialog-box')].map(d => d.textContent).join(' | ')`);
			if (!text.includes('write_note')) { await sleep(250); }
		}
		const pressed = text ? await win.evaluate(clickText('.monaco-dialog-box .monaco-button', answer)) : false;
		return { text: text.slice(0, 120), pressed };
	};
	const answered = async () => last(await until(s => last(s)?.role === 'assistant' && !last(s).streaming && !s.stop, 30000));

	const ping = await askAndAnswer('please use harness_ping', 'Allow once');
	const pingDone = await answered();
	result.approvals = { ping: { card: ping.card, done: pingDone?.tools, text: pingDone?.text } };
	check(ping.card?.status === 'waiting' && /"text": "marco"/.test(ping.card?.input ?? ''), `approvals: harness_ping's card did not wait showing what it would run with (${js(ping.card)})`);
	check(ping.card && (ping.card.armed === false || ping.card.waitedMs >= 500), `approvals: a new card's buttons took a click at once (${js(ping.card)})`);
	check(ping.clicked && pingDone?.tools?.[0]?.status === 'done' && /pong tool ping:marco/.test(pingDone?.text ?? ''), `approvals: allowed once, harness_ping did not run (${js(result.approvals.ping)})`);
	save();

	log('approvals: the MCP server, started as a user would');
	await vscode.commands.executeCommand('workbench.mcp.startServer', '*', { waitForLiveTools: true });
	for (let i = 0; i < 40 && !vscode.lm.tools.some(tool => tool.name === 'mcp_sirius-stub_echo'); i++) { await sleep(250); }
	from = (await stubRequests()).length;
	const once = await askAndAnswer('please use mcp_sirius-stub_echo', 'Allow once');
	const onceDone = await answered();
	result.approvals.offered = ((await anthropicSince(from))[0]?.body?.tools ?? []).map(t => t.name);
	result.approvals.once = { card: once.card, clicked: once.clicked, done: onceDone?.tools, text: onceDone?.text };
	save();
	const deny = await askAndAnswer('please use mcp_sirius-stub_echo again', 'Deny');
	const denyDone = await answered();
	result.approvals.deny = { card: deny.card, done: denyDone?.tools };
	save();
	const session = await askAndAnswer('please use mcp_sirius-stub_write_note', 'Allow for this conversation');
	const sessionDialog = await vscodeDialog('Yes');
	const sessionDone = await answered();
	const beforeAgain = (await snap()).turns.length;
	await panel.evaluate(sendText('please use mcp_sirius-stub_write_note again'));
	const againRunning = await until(s => s.turns.length >= beforeAgain + 2 && lastTool(s) !== undefined, 30000);
	const againDialog = await vscodeDialog('Cancel');
	const againDone = await answered();
	result.approvals = {
		ping: result.approvals.ping,
		offered: result.approvals.offered,
		once: { asks: once.card?.asks, clicked: once.clicked, card: onceDone?.tools, text: onceDone?.text },
		deny: { card: denyDone?.tools, text: denyDone?.text?.slice(0, 120) },
		session: { dialog: sessionDialog, card: sessionDone?.tools, text: sessionDone?.text },
		again: { first: lastTool(againRunning), dialog: againDialog, card: againDone?.tools, text: againDone?.text?.slice(0, 120) }
	};
	check(js(once.card?.asks) === js(['Allow once', 'Allow for this conversation', 'Deny']) && once.clicked, `approvals: the echo card did not ask with Allow once, Allow for this conversation and Deny (${js(result.approvals.once)})`);
	check(onceDone?.tools?.[0]?.status === 'done' && /pong tool echo:marco/.test(onceDone?.text ?? ''), `approvals: allowed once, echo did not run (${js(result.approvals.once)})`);
	check(deny.card?.status === 'waiting' && denyDone?.tools?.[0]?.status === 'denied' && /declined/.test(denyDone?.text ?? ''), `approvals: echo did not ask again, or Deny did not decline it (${js(result.approvals.deny)})`);
	check(session.clicked && /write_note/.test(sessionDialog.text) && sessionDialog.pressed && sessionDone?.tools?.[0]?.status === 'done' && /pong tool write_note:marco/.test(sessionDone?.text ?? ''), `approvals: allowed for the conversation and confirmed in VS Code's own dialog, write_note did not run (${js(result.approvals.session)})`);
	check(result.approvals.again.first?.status !== 'waiting' && /write_note/.test(againDialog.text) && againDone?.tools?.[0]?.status === 'denied' && /declined/.test(againDone?.text ?? ''), `approvals: called again, write_note was asked about by the panel, or VS Code's Cancel did not decline it (${js(result.approvals.again)})`);

	log('approvals: Stop while a card waits');
	const stopWait = await askAndAnswer('please use mcp_sirius-stub_echo once more', 'nothing');
	await panel.evaluate(click('button[title="Stop"]'));
	const stoppedWait = last(await until(s => !s.stop && !last(s)?.streaming, 10000));
	from = (await stubRequests()).length;
	const afterStop = await ask('a plain question after the stop');
	const afterStopRequest = (await anthropicSince(from))[0];
	result.approvals.stop = { waiting: stopWait.card?.status, card: stoppedWait?.tools, meta: stoppedWait?.meta, next: { status: afterStopRequest?.status, text: afterStop?.text } };
	check(stopWait.card?.status === 'waiting' && stoppedWait?.tools?.[0]?.status === 'stopped' && /Stopped/.test(stoppedWait?.meta ?? ''), `approvals: Stop did not stop the waiting call (${js(result.approvals.stop)})`);
	check(afterStopRequest?.status === 200 && /pong a plain question after the stop/.test(afterStop?.text ?? ''), `approvals: the question after the stop was not answered (${js(result.approvals.stop.next)})`);
	save();

	// ── ids ───────────────────────────────────────────────────────────────────
	log('ids: Ollama\'s call_0 in every round, then Anthropic');
	await panel.evaluate(choose('footer select[title="Model"]', OTHERS.ollama));
	await sleep(300);
	const twoRounds = await ask('use sirius_list_directory then sirius_get_diagnostics');
	await panel.evaluate(choose('footer select[title="Model"]', MODEL));
	await sleep(300);
	from = (await stubRequests()).length;
	const afterOllama = await ask('a question after the ollama rounds');
	const afterOllamaRequest = (await anthropicSince(from))[0];
	const useIds = (afterOllamaRequest?.body?.messages ?? []).flatMap(m => Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_use').map(b => b.id) : []);
	result.ids = { cards: twoRounds?.tools, next: { status: afterOllamaRequest?.status, text: afterOllama?.text, useIds } };
	check(twoRounds?.tools?.length === 2 && twoRounds.tools[0].id !== twoRounds.tools[1].id && twoRounds.tools.every(card => card.status === 'done'), `ids: Ollama's two rounds did not show two cards of their own, both done (${js(twoRounds?.tools)})`);
	check(afterOllamaRequest?.status === 200 && /pong a question after the ollama rounds/.test(afterOllama?.text ?? '') && new Set(useIds).size === useIds.length, `ids: after Ollama's rounds, Anthropic was sent repeated ids or refused (${js(result.ids.next)})`);

	log('ids: null arguments from an OpenAI-compatible model');
	await panel.evaluate(choose('footer select[title="Model"]', OTHERS.llamacpp));
	await sleep(300);
	const nullArgs = await ask('null args please');
	const afterNull = await ask('a plain question for llamacpp');
	const oddIds = await ask('odd ids please');
	result.ids.nullArgs = { card: nullArgs?.tools, text: nullArgs?.text?.slice(0, 80), next: afterNull?.text?.slice(0, 120), oddIds: oddIds?.tools, refusals: openaiLines().filter(line => line.refused).length };
	check(nullArgs?.tools?.[0]?.status === 'done' && /pong tool/.test(nullArgs?.text ?? ''), `ids: a call with null arguments did not run (${js(result.ids.nullArgs)})`);
	check(/pong a plain question for llamacpp/.test(afterNull?.text ?? '') && result.ids.nullArgs.refusals === 0, `ids: after a call with null arguments the next question was refused (${js(result.ids.nullArgs)})`);
	check(oddIds?.tools?.[0]?.status === 'done' && /pong tool/.test(oddIds?.text ?? ''), `ids: a call under a Kimi-style id did not run (${js(oddIds?.tools)})`);
	await panel.evaluate(choose('footer select[title="Model"]', MODEL));
	await sleep(300);
	from = (await stubRequests()).length;
	const toClaude = await ask('a question for claude after those');
	const toClaudeRequest = (await anthropicSince(from))[0];
	const sentIds = (toClaudeRequest?.body?.messages ?? []).flatMap(m => Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_use') : []);
	result.ids.toClaude = { status: toClaudeRequest?.status, text: toClaude?.text?.slice(0, 100), ids: sentIds.map(b => b.id).slice(-3), inputs: sentIds.map(b => b.input).slice(-3) };
	check(toClaudeRequest?.status === 200 && /pong a question for claude after those/.test(toClaude?.text ?? ''), `ids: after the null arguments and the Kimi-style id, Anthropic refused the conversation (${js(result.ids.toClaude)})`);

	// ── pictures ──────────────────────────────────────────────────────────────
	log('pictures: a tool\'s picture, to a model that can see and to one that cannot');
	from = (await stubRequests()).length;
	await askAndAnswer('please use harness_picture', 'Allow once');
	const seenByClaude = await answered();
	const claudeRound = (await anthropicSince(from))[1];
	const claudeResult = (claudeRound?.body?.messages ?? []).flatMap(m => Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_result') : []).pop();
	await panel.evaluate(choose('footer select[title="Model"]', OTHERS.ollama));
	await sleep(300);
	from = (await stubRequests()).length;
	await askAndAnswer('please use harness_picture', 'Allow once');
	const seenByOllama = await answered();
	const ollamaRound = (await stubRequests()).slice(from).filter(r => r.path === '/api/chat')[1];
	const ollamaTool = (ollamaRound?.body?.messages ?? []).filter(m => m.role === 'tool').pop();
	result.pictures = {
		claude: { text: seenByClaude?.text?.slice(0, 60), parts: Array.isArray(claudeResult?.content) ? claudeResult.content.map(b => b.type) : typeof claudeResult?.content },
		ollama: { text: seenByOllama?.text?.slice(0, 80), images: ollamaRound?.body?.messages?.flatMap(m => m.images ?? []).length ?? -1, tool: String(ollamaTool?.content ?? '').slice(0, 120) }
	};
	check(Array.isArray(claudeResult?.content) && claudeResult.content.some(b => b.type === 'image'), `pictures: the picture did not reach Anthropic as an image (${js(result.pictures.claude)})`);
	check(ollamaRound && result.pictures.ollama.images === 0 && /cannot view images/.test(result.pictures.ollama.tool), `pictures: the text-only model was sent the picture, or no note (${js(result.pictures.ollama)})`);
	await panel.evaluate(choose('footer select[title="Model"]', MODEL));
	await sleep(300);
	save();

	// ── deleting ──────────────────────────────────────────────────────────────
	log('deleting: a conversation deleted while a card waits');
	await panel.evaluate(click('button[title="New conversation"]'));
	await until(s => s.turns.length === 0, 5000);
	await panel.evaluate(sendText('please use harness_ping to wait'));
	const waitingToDelete = await until(s => lastTool(s)?.status === 'waiting', 30000);
	const doomed = waitingToDelete.title;
	await panel.evaluate(click('button[title="Conversations"]'));
	await until(s => s.sessions.includes(doomed), 5000);
	await panel.evaluate(click(`button[title=${js(`Delete "${doomed}"`)}]`));
	await sleep(2500);
	await panel.evaluate(click('button[title="Conversations"]'));
	const afterDeleting = await until(s => s.sessions.length > 0, 5000);
	result.deleting = { doomed, waited: lastTool(waitingToDelete)?.status, sessions: afterDeleting.sessions };
	check(lastTool(waitingToDelete)?.status === 'waiting' && !afterDeleting.sessions.includes(doomed), `deleting: a conversation deleted while a card waited came back (${js(result.deleting)})`);
	await panel.evaluate(click('button[title="Back to the conversation"]'));
	save();

	// ── edits ─────────────────────────────────────────────────────────────────
	log('edits: Edit mode proposes two changes; one accepted in the diff editor\'s title bar, one rejected on its card');
	const WS = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
	const onDisk = name => { try { return fs.readFileSync(path.join(WS, name), 'utf8'); } catch { return null; } };
	/** Every diff editor's tab: what it compares, and whether it is the one shown. */
	const diffTabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => ({ tab, group })))
		.filter(({ tab }) => tab.input?.original && tab.input?.modified)
		.map(({ tab, group }) => ({ label: tab.label, original: tab.input.original.toString(), modified: tab.input.modified.toString(), shown: tab.isActive && group.isActive }));
	const proposalTabs = () => diffTabs().filter(t => t.modified.startsWith('sirius-proposal:'));
	const textOf = async uri => (await vscode.workspace.openTextDocument(vscode.Uri.parse(uri))).getText();
	const diffOf = async tab => tab ? { label: tab.label, scheme: tab.modified.split(':')[0], original: await textOf(tab.original), modified: await textOf(tab.modified) } : null;
	const within = async (read, ok, ms = 10000) => {
		let value;
		for (const deadline = Date.now() + ms; Date.now() < deadline;) {
			value = await read();
			if (ok(value)) { return value; }
			await sleep(150);
		}
		return value;
	};
	/** The results the model got for the last round, in the order it called. */
	const resultsOf = request => {
		const lastMessage = (request?.body?.messages ?? []).slice(-1)[0];
		return (Array.isArray(lastMessage?.content) ? lastMessage.content : []).filter(b => b.type === 'tool_result')
			.map(b => ({ text: typeof b.content === 'string' ? b.content : (b.content ?? []).map(x => x.text ?? '').join(''), error: b.is_error === true }));
	};
	const proposeText = changes => `propose ${js(changes)}`;
	const cardsOf = s => last(s)?.tools ?? [];
	const waitingCards = s => cardsOf(s).filter(c => c.status === 'waiting');
	const onCard = (id, button) => panel.evaluate(clickText(`.turn:last-child .tool[data-call=${js(id)}] .tool-ask button`, button));
	/** Sends the changes and waits until `n` of them wait on their cards, their buttons ready. */
	const proposeAndWait = async (changes, n) => {
		const before = (await snap()).turns.length;
		await panel.evaluate(sendText(proposeText(changes)));
		const first = await until(s => s.turns.length >= before + 2 && waitingCards(s).length === n, 30000);
		const ready = await until(s => waitingCards(s).length === n && waitingCards(s).every(c => c.armed), 5000);
		return { first, ready };
	};
	const HELLO = 'Hello, ${name}!';
	const HI = 'Hi, ${name}!';
	const greet0 = onDisk('greet.js');
	const readme0 = onDisk('README.md');
	result.edits = {};

	await panel.evaluate(choose('footer select[title="Mode"]', 'ask'));
	const inAskMode = await until(s => s.edits === null, 5000);
	// Switched quickly, as a person might: the question goes out in the last mode chosen (VS Code
	// echoes each write to global state back, and an echo of an earlier choice used to win).
	for (const mode of ['edit', 'agent', 'ask', 'edit']) {
		await panel.evaluate(choose('footer select[title="Mode"]', mode));
	}
	const inEditMode = await until(s => s.edits !== null, 5000);
	result.edits.composer = { ask: inAskMode.edits, edit: inEditMode.edits };
	check(inAskMode.edits === null && inEditMode.edits === 'ask', `edits: the composer's Edits choice is not hidden in Ask and "Ask before edits" in Edit (${js(result.edits.composer)})`);

	from = (await stubRequests()).length;
	const e1 = await proposeAndWait([{ edit: 'greet.js', search: HELLO, replace: HI }, { edit: 'README.md', search: 'A small workspace', replace: 'A tiny workspace' }], 2);
	const e1Offered = ((await anthropicSince(from))[0]?.body?.tools ?? []).map(t => t.name).sort();
	const e1Shown = (await within(async () => diffTabs(), tabs => tabs.some(t => t.shown && t.modified.startsWith('sirius-proposal:')))).find(t => t.shown);
	const e1ShownAt = Date.now();
	const e1Diff = await diffOf(e1Shown);
	// The title bar's actions, as the window draws them for the diff shown.
	const titleActions = await within(() => win.evaluate(`[...document.querySelectorAll('.editor-actions .action-label')].map(a => a.getAttribute('aria-label') ?? '')`), labels => labels.some(l => /^Accept Change/.test(l)), 5000);
	// A diff's Accept takes no click for half a second after it appears, as a card's does: a person looks first.
	await sleep(Math.max(0, 700 - (Date.now() - e1ShownAt)));
	const titleClicked = await realClick(win, '.editor-actions .action-label[aria-label^="Accept Change"]');
	const greetAfterTitle = await within(async () => onDisk('greet.js'), text => text?.includes(HI) ?? false);
	const e1Next = (await within(async () => diffTabs(), tabs => tabs.some(t => t.shown && /README\.md/.test(t.modified)) && !tabs.some(t => /greet\.js/.test(t.modified) && t.modified.startsWith('sirius-proposal:')))).find(t => t.shown);
	// The second click of a double-click lands on the change that took the first one's place: not taken.
	const doubleClicked = await realClick(win, '.editor-actions .action-label[aria-label^="Accept Change"]');
	await sleep(800);
	const afterDouble = { clicked: doubleClicked, readme: onDisk('README.md') === readme0, card: cardsOf(await snap()).find(c => c.label === 'Edit README.md')?.status };
	const readmeCard = cardsOf(e1.first).find(c => c.label === 'Edit README.md');
	const e1Rejected = await onCard(readmeCard?.id, 'Reject');
	const e1Done = await answered();
	const e1Requests = await anthropicSince(from);
	result.edits.reviewed = {
		offered: e1Offered,
		cards: cardsOf(e1.first).map(c => ({ label: c.label, status: c.status, counts: c.counts, asks: c.asks, armed: c.armed, waitedMs: c.waitedMs })),
		batch: last(e1.ready)?.batches,
		diff: e1Diff && { label: e1Diff.label, scheme: e1Diff.scheme, original: e1Diff.original === greet0, modified: e1Diff.modified === greet0.replace(HELLO, HI) },
		titleActions, titleClicked, greet: greetAfterTitle?.includes(HI), next: e1Next?.modified,
		rejected: e1Rejected, done: e1Done?.tools?.map(c => ({ status: c.status, statusText: c.statusText })), results: resultsOf(e1Requests[1]),
		readmeKept: onDisk('README.md') === readme0, proposalTabs: proposalTabs().length, afterDouble
	};
	const e1System = js((await anthropicSince(from))[0]?.body?.system);
	result.edits.reviewed.mode = /Edit mode/.test(e1System);
	result.edits.reviewed.log = panelLog().slice(-12).map(line => line.replace(/^.*\[panel\] /, ''));
	check(result.edits.reviewed.mode && js(e1Offered) === js(['sirius_create_file', 'sirius_edit_file', 'sirius_get_diagnostics', 'sirius_list_directory', 'sirius_read_file', 'sirius_search_files']), `edits: the question did not go out in Edit mode, the mode last chosen, offered Sirius's four read tools and the two that change files (${js({ mode: result.edits.reviewed.mode, offered: e1Offered })})`);
	check(js(cardsOf(e1.first).map(c => [c.label, c.status, c.counts])) === js([['Edit greet.js', 'waiting', '+1−1'], ['Edit README.md', 'waiting', '+1−1']]), `edits: the round's two changes did not both wait on their cards, with what they change (${js(result.edits.reviewed.cards)})`);
	check(cardsOf(e1.first).length === 2 && cardsOf(e1.first).every(c => c.armed === false || c.waitedMs >= 500), `edits: a new change's Accept took a click at once, or there was none (${js(result.edits.reviewed.cards)})`);
	check(js(last(e1.ready)?.batches?.map(b => [b.text, b.buttons])) === js([['2 changes waiting', ['Accept all', 'Reject all']]]), `edits: the round's two changes had no Accept all and Reject all (${js(result.edits.reviewed.batch)})`);
	check(e1Diff?.scheme === 'sirius-proposal' && /greet\.js/.test(e1Diff.label) && result.edits.reviewed.diff.original && result.edits.reviewed.diff.modified, `edits: the first change did not open in the diff editor with the file and the change (${js(result.edits.reviewed.diff)})`);
	check(titleActions?.some(l => /^Accept Change/.test(l)) && titleActions.some(l => /^Reject Change/.test(l)), `edits: the diff editor's title bar has no Accept Change and Reject Change (${js(titleActions)})`);
	check(titleClicked && result.edits.reviewed.greet, `edits: Accept Change in the diff editor's title bar did not apply the change to the file (${js({ titleClicked, greet: greetAfterTitle })})`);
	check(/README\.md/.test(e1Next?.modified ?? '') && e1Next?.modified.startsWith('sirius-proposal:'), `edits: once the first change was decided, the next did not take its place in the diff editor (${js(diffTabs())})`);
	check(afterDouble.clicked && afterDouble.readme && afterDouble.card === 'waiting', `edits: a double-click on Accept Change also accepted the change that took the first one's place (${js(afterDouble)})`);
	check(e1Rejected && js(result.edits.reviewed.done) === js([{ status: 'done', statusText: 'Accepted' }, { status: 'denied', statusText: 'Rejected' }]), `edits: the cards do not say Accepted and Rejected (${js(result.edits.reviewed.done)})`);
	const [appliedResult, rejectedResult] = result.edits.reviewed.results;
	check(result.edits.reviewed.results.length === 2 && appliedResult.text === 'Edited greet.js.' && !appliedResult.error && /^The user rejected this change to README\.md/.test(rejectedResult.text) && rejectedResult.error, `edits: the model was not told the first change was applied and the second rejected (${js(result.edits.reviewed.results)})`);
	check(result.edits.reviewed.readmeKept && onDisk('greet.js') === greet0.replace(HELLO, HI), `edits: the files on disk are not the accepted change alone (${js({ greet: onDisk('greet.js'), readme: onDisk('README.md') })})`);
	check(e1Diff?.scheme === 'sirius-proposal' && result.edits.reviewed.proposalTabs === 0, `edits: a decided change's diff stayed open, or none was shown (${js(proposalTabs())})`);
	save();

	log('edits: two changes to one file, accepted in the other order, then one rejected and one accepted — each applied to the file as it is then');
	const DEFAULT = 'export function greet(name = \'world\')';
	const greetA = onDisk('greet.js');
	const e2 = await proposeAndWait([{ edit: 'greet.js', search: HI, replace: 'Hey, ${name}!' }, { edit: 'greet.js', search: 'export function greet(name)', replace: DEFAULT }], 2);
	const [e2a, e2b] = cardsOf(e2.ready);
	await onCard(e2b?.id, 'Show diff');
	const e2Shown = await diffOf((await within(async () => diffTabs(), tabs => tabs.some(t => t.shown && t.modified.includes(encodeURIComponent(e2b?.id ?? '-'))))).find(t => t.shown));
	await onCard(e2b?.id, 'Accept');
	await within(async () => onDisk('greet.js'), text => text?.includes(DEFAULT) ?? false);
	await onCard(e2a?.id, 'Accept');
	const e2Done = await answered();
	const bothApplied = greetA.replace(HI, 'Hey, ${name}!').replace('export function greet(name)', DEFAULT);
	// The second change is shown on the file as the first would leave it: the first is context on both sides.
	result.edits.order = { shown: e2Shown && { scheme: e2Shown.scheme, original: e2Shown.original === greetA.replace(HI, 'Hey, ${name}!'), modified: e2Shown.modified === bothApplied }, cards: e2Done?.tools?.map(c => c.status), both: onDisk('greet.js') === bothApplied };
	check(e2Shown?.scheme === 'sirius-proposal' && result.edits.order.shown.original && result.edits.order.shown.modified, `edits: Show diff on a waiting change did not show that change, on the file as the round's earlier change leaves it (${js(result.edits.order.shown)})`);
	check(js(result.edits.order.cards) === js(['done', 'done']) && result.edits.order.both, `edits: two changes to one file, accepted in the other order, did not both reach the file (${js({ ...result.edits.order, greet: onDisk('greet.js') })})`);

	const greetB = onDisk('greet.js');
	const e3 = await proposeAndWait([{ edit: 'greet.js', search: DEFAULT, replace: 'export function greet(name = \'you\')' }, { edit: 'greet.js', search: 'Hey, ${name}!', replace: 'Hello again, ${name}!' }], 2);
	const [e3a, e3b] = cardsOf(e3.ready);
	await onCard(e3a?.id, 'Reject');
	await until(s => cardsOf(s).find(c => c.id === e3a?.id)?.status === 'denied', 5000);
	await onCard(e3b?.id, 'Accept');
	const e3Done = await answered();
	result.edits.rejectedFirst = { cards: e3Done?.tools?.map(c => c.status), greet: onDisk('greet.js') };
	check(js(result.edits.rejectedFirst.cards) === js(['denied', 'done']) && onDisk('greet.js') === greetB.replace('Hey, ${name}!', 'Hello again, ${name}!'), `edits: a change rejected before another to the same file reached the file, or the other did not (${js(result.edits.rejectedFirst)})`);
	save();

	log('edits: Accept all, with a new file — and package.json, which Accept all leaves to its own card');
	const NOTES = '# Notes\n\nWritten through the panel.\n';
	from = (await stubRequests()).length;
	const e4 = await proposeAndWait([{ create: 'notes.md', content: NOTES }, { edit: 'README.md', search: 'A small workspace', replace: 'A tiny workspace' }, { create: 'package.json', content: '{}\n' }], 3);
	const e4Bar = await until(s => last(s)?.batches?.[0]?.armed === true, 5000);
	const allClicked = await panel.evaluate(clickText('.turn:last-child .edit-batch button', 'Accept all'));
	const e4Left = await until(s => cardsOf(s).filter(c => c.status === 'done').length === 2, 10000);
	const packageCard = cardsOf(e4Left).find(c => c.label === 'Create package.json');
	await onCard(packageCard?.id, 'Reject');
	const e4Done = await answered();
	const e4Results = resultsOf((await anthropicSince(from))[1]);
	result.edits.all = { cards: cardsOf(e4.first).map(c => [c.label, c.counts]), bar: last(e4Bar)?.batches, clicked: allClicked, left: cardsOf(e4Left).map(c => c.status), done: e4Done?.tools?.map(c => c.status), results: e4Results.map(r => r.text.slice(0, 40)), notes: onDisk('notes.md'), readme: onDisk('README.md'), packageJson: onDisk('package.json') };
	check(js(result.edits.all.cards) === js([['Create notes.md', '+3−0'], ['Edit README.md', '+1−1'], ['Create package.json', '+1−0']]), `edits: the new files' and the edit's cards are not as proposed (${js(result.edits.all.cards)})`);
	check(/^3 changes waiting — Accept all leaves one file for its own card$/.test(last(e4Bar)?.batches?.[0]?.text ?? ''), `edits: the bar did not say Accept all leaves package.json to its own card (${js(result.edits.all.bar)})`);
	check(allClicked && js(result.edits.all.left) === js(['done', 'done', 'waiting']) && js(result.edits.all.done) === js(['done', 'done', 'denied']) && result.edits.all.packageJson === null && js(e4Results.slice(0, 2).map(r => r.text)) === js(['Created notes.md.', 'Edited README.md.']), `edits: Accept all did not apply the two changes and leave package.json waiting (${js(result.edits.all)})`);
	check(result.edits.all.notes === NOTES && result.edits.all.readme === readme0.replace('A small workspace', 'A tiny workspace'), `edits: after Accept all the files on disk are not as proposed (${js({ notes: result.edits.all.notes, readme: result.edits.all.readme })})`);

	log('edits: Undo in the file takes an accepted change back');
	const readmeUri = vscode.Uri.file(path.join(WS, 'README.md'));
	const changedBeforeUndo = onDisk('README.md') !== readme0;
	const readmeDoc = await vscode.workspace.openTextDocument(readmeUri);
	await vscode.window.showTextDocument(readmeDoc, { preview: false });
	await vscode.commands.executeCommand('undo');
	const undone = await within(async () => readmeDoc.getText(), text => text === readme0, 5000);
	await readmeDoc.save();
	await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	result.edits.undo = { changed: changedBeforeUndo, undone: undone === readme0, disk: onDisk('README.md') === readme0 };
	check(changedBeforeUndo && result.edits.undo.undone && result.edits.undo.disk, `edits: Undo in the file did not take the accepted change back (${js({ changed: changedBeforeUndo, text: readmeDoc.getText(), disk: onDisk('README.md') })})`);
	const notesDoc = onDisk('notes.md') === null ? undefined : await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(WS, 'notes.md')));
	await vscode.window.showTextDocument(notesDoc ?? readmeDoc, { preview: false });
	// Not awaited: were VS Code to ask first, its dialog is answered here, not left to hang the run.
	const undoing = Promise.resolve(vscode.commands.executeCommand('undo')).catch(() => undefined);
	const notesGone = await within(async () => onDisk('notes.md'), text => text === null, 5000);
	const undoDialog = await win.evaluate(`[...document.querySelectorAll('.monaco-dialog-box')].map(d => d.textContent).join(' | ')`);
	if (undoDialog) {
		await win.evaluate(clickText('.monaco-dialog-box .monaco-button', 'Cancel'));
	}
	await Promise.race([undoing, sleep(2000)]);
	await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	result.edits.undo.created = { gone: notesGone === null, dialog: undoDialog.slice(0, 160) };
	check(notesDoc && notesGone === null && !undoDialog, `edits: Undo in a new file did not take its creation back (${js(result.edits.undo.created)})`);
	save();

	log('edits: changes that cannot be made fail on their cards, unasked');
	// A .git folder, and a link to it under another name, as a repository could commit.
	fs.mkdirSync(path.join(WS, '.git'), { recursive: true });
	fs.writeFileSync(path.join(WS, '.git', 'config'), '[core]\n');
	fs.symlinkSync('.git', path.join(WS, 'gitlink'));
	from = (await stubRequests()).length;
	const e5 = await ask(proposeText([{ create: '.git/hooks/pre-commit', content: 'echo ran\n' }, { edit: 'gitlink/config', search: '[core]', replace: '[core]\n\tfsmonitor = echo ran' }, { create: 'greet.js', content: 'x' }, { edit: '../outside.txt', search: 'a', replace: 'b' }, { edit: 'README.md', search: 'not in the file', replace: 'x' }]), 30000);
	const e5Results = resultsOf((await anthropicSince(from))[1]);
	result.edits.refused = { cards: e5?.tools?.map(c => [c.label, c.status, c.asks.length]), results: e5Results.map(r => r.text.slice(0, 70)), git: onDisk('.git/config') === '[core]\n' && onDisk('.git/hooks/pre-commit') === null, greet: onDisk('greet.js') === greetB.replace('Hey, ${name}!', 'Hello again, ${name}!'), readme: onDisk('README.md') === readme0 };
	check(e5?.tools?.length === 5 && e5.tools.every(c => c.status === 'failed' && c.asks.length === 0) && result.edits.refused.git && result.edits.refused.greet && result.edits.refused.readme, `edits: a change that cannot be made was asked about, or touched a file (${js(result.edits.refused)})`);
	check(/inside \.git/.test(e5Results[0]?.text ?? '') && /inside \.git/.test(e5Results[1]?.text ?? '') && /already exists/.test(e5Results[2]?.text ?? '') && /outside the workspace/.test(e5Results[3]?.text ?? '') && /not found/.test(e5Results[4]?.text ?? ''), `edits: the model was not told why each change could not be made — .git, also through a link to it (${js(result.edits.refused.results)})`);

	log('edits: a change that builds on another in its round, and one asked for twice');
	from = (await stubRequests()).length;
	const e5b = await proposeAndWait([{ create: 'notes2.md', content: 'one\n' }, { edit: 'notes2.md', search: 'one', replace: 'one\ntwo' }, { edit: 'notes2.md', search: 'one', replace: 'one\ntwo' }], 2);
	await until(s => last(s)?.batches?.[0]?.armed === true, 5000);
	await panel.evaluate(clickText('.turn:last-child .edit-batch button', 'Accept all'));
	const e5bDone = await answered();
	const e5bResults = resultsOf((await anthropicSince(from))[1]);
	result.edits.building = { proposed: cardsOf(e5b.ready).map(c => [c.label, c.status]), done: e5bDone?.tools?.map(c => c.status), results: e5bResults.map(r => r.text.slice(0, 70)), notes2: onDisk('notes2.md') };
	check(js(result.edits.building.proposed) === js([['Create notes2.md', 'waiting'], ['Edit notes2.md', 'waiting'], ['Edit notes2.md', 'failed']]) && /repeats/.test(e5bResults[2]?.text ?? ''), `edits: a change building on another in its round was not proposed, or one asked for twice was (${js(result.edits.building)})`);
	check(js(result.edits.building.done) === js(['done', 'done', 'failed']) && result.edits.building.notes2 === 'one\ntwo\n', `edits: Accept all did not make the new file and the change built on it, once (${js(result.edits.building)})`);

	log('edits: Auto-accept edits applies as it comes, its diff a click away');
	await panel.evaluate(choose('footer select[title="Edits"]', 'auto'));
	await until(s => s.edits === 'auto', 5000);
	const greetC = onDisk('greet.js');
	const e6 = await ask(proposeText([{ edit: 'greet.js', search: 'Hello again, ${name}!', replace: HELLO }]), 30000);
	const e6Card = e6?.tools?.[0];
	await onCard(e6Card?.id, 'Show diff');
	const e6Diff = await diffOf((await within(async () => diffTabs(), tabs => tabs.some(t => t.shown && t.modified.startsWith('sirius-change:')))).find(t => t.shown));
	await sleep(500);
	const e6Actions = await win.evaluate(`[...document.querySelectorAll('.editor-actions .action-label')].map(a => a.getAttribute('aria-label') ?? '')`);
	await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input?.modified?.scheme === 'sirius-change'));
	log('edits: under Auto-accept edits, a file that can run code still asks; one with unsaved changes is not saved');
	const settings0 = onDisk('.vscode/settings.json');
	fs.symlinkSync('.vscode', path.join(WS, 'vslink'));
	const guardedWait = await proposeAndWait([{ edit: '.vscode/settings.json', search: 'sirius.ai.groq.baseUrl', replace: 'sirius.ai.groq.baseUrlChanged' }, { edit: 'vslink/settings.json', search: 'sirius.ai.groq.baseUrl', replace: 'sirius.ai.groq.baseUrlLinked' }], 1);
	const guardedCard = waitingCards(guardedWait.ready)[0];
	const guardedNote = await panel.evaluate(`document.querySelector('.turn:last-child .tool.waiting .edit-why')?.textContent ?? ''`);
	await onCard(guardedCard?.id, 'Reject');
	const linkedWait = await until(s => waitingCards(s).length === 1 && waitingCards(s)[0].id !== guardedCard?.id && waitingCards(s)[0].armed, 15000);
	const linkedCard = waitingCards(linkedWait)[0];
	await onCard(linkedCard?.id, 'Reject');
	const guardedDone = await answered();
	result.edits.guarded = { cards: [guardedCard?.label, linkedCard?.label], note: guardedNote.slice(0, 80), done: guardedDone?.tools?.map(c => c.status), settings: onDisk('.vscode/settings.json') === settings0 };
	check(guardedCard?.label === 'Edit .vscode/settings.json' && linkedCard?.label === 'Edit vslink/settings.json' && /accepted only here/.test(guardedNote) && js(result.edits.guarded.done) === js(['denied', 'denied']) && result.edits.guarded.settings, `edits: under Auto-accept edits a change to .vscode/settings.json, or to it through a link, did not wait for the user (${js(result.edits.guarded)})`);
	const readmeE = onDisk('README.md');
	const dirtyDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(WS, 'README.md')));
	const dirtyEditor = await vscode.window.showTextDocument(dirtyDoc, { preview: false });
	await dirtyEditor.edit(b => b.insert(new vscode.Position(dirtyDoc.lineCount - 1, 0), 'A line the user is still writing\n'));
	const dirtyAnswer = await ask(proposeText([{ edit: 'README.md', search: 'A small workspace', replace: 'A dirty workspace' }]), 30000);
	result.edits.unsaved = { card: dirtyAnswer?.tools?.[0]?.status, disk: onDisk('README.md') === readmeE, buffer: dirtyDoc.getText().includes('A dirty workspace') && dirtyDoc.getText().includes('A line the user is still writing'), dirty: dirtyDoc.isDirty, told: /not saved/.test(dirtyAnswer?.text ?? '') };
	await vscode.window.showTextDocument(dirtyDoc);
	await vscode.commands.executeCommand('workbench.action.files.revert');
	await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	check(result.edits.unsaved.card === 'done' && result.edits.unsaved.disk && result.edits.unsaved.buffer && result.edits.unsaved.dirty && result.edits.unsaved.told, `edits: a change to a file with unsaved changes was saved with them, or not made (${js(result.edits.unsaved)})`);
	// Switched back quickly: the next change must wait for the user, whatever VS Code echoes back.
	for (const edits of ['ask', 'auto', 'ask']) {
		await panel.evaluate(choose('footer select[title="Edits"]', edits));
	}
	await until(s => s.edits === 'ask', 5000);
	result.edits.auto = { card: e6Card && { status: e6Card.status, statusText: e6Card.statusText, asks: e6Card.asks }, greet: onDisk('greet.js') === greetC.replace('Hello again, ${name}!', HELLO), diff: e6Diff && { scheme: e6Diff.scheme, original: e6Diff.original === greetC, modified: e6Diff.modified === onDisk('greet.js') }, titleActions: e6Actions };
	check(e6Card?.status === 'done' && e6Card.statusText === 'Applied' && js(e6Card.asks) === js(['Show diff']) && result.edits.auto.greet, `edits: under Auto-accept edits the change did not apply as it came (${js(result.edits.auto)})`);
	check(e6Diff?.scheme === 'sirius-change' && result.edits.auto.diff.original && result.edits.auto.diff.modified && !e6Actions.some(l => /^Accept Change/.test(l)), `edits: Show diff on an applied change did not show it, only to look at (${js(result.edits.auto)})`);
	save();

	log('edits: Stop while a change waits');
	const readmeD = onDisk('README.md');
	await proposeAndWait([{ edit: 'README.md', search: 'A small workspace', replace: 'A stopped workspace' }], 1);
	await within(async () => proposalTabs(), tabs => tabs.length === 1, 5000);
	await panel.evaluate(click('button[title="Stop"]'));
	const e7 = last(await until(s => !s.stop && !last(s)?.streaming, 10000));
	const e7Tabs = await within(async () => proposalTabs(), tabs => tabs.length === 0, 5000);
	from = (await stubRequests()).length;
	const e7Next = await ask('a plain question after the stopped change');
	const e7Request = (await anthropicSince(from))[0];
	const e7Kept = (e7Request?.body?.messages ?? []).flatMap(m => Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_result') : []).map(b => typeof b.content === 'string' ? b.content : js(b.content)).pop() ?? '';
	result.edits.stop = { card: e7?.tools?.[0]?.status, readme: onDisk('README.md') === readmeD, tabs: e7Tabs.length, next: { status: e7Request?.status, text: e7Next?.text?.slice(0, 60), kept: e7Kept.slice(0, 60) } };
	check(result.edits.stop.card === 'stopped' && result.edits.stop.readme && result.edits.stop.tabs === 0, `edits: Stop did not stop the waiting change, leave the file and close its diff (${js(result.edits.stop)})`);
	check(e7Request?.status === 200 && /pong a plain question after the stopped change/.test(e7Next?.text ?? '') && /Stopped by the user/.test(e7Kept), `edits: the question after the stopped change was not answered on that history (${js(result.edits.stop.next)})`);
	await panel.evaluate(choose('footer select[title="Mode"]', 'agent'));
	await sleep(300);

	log('edits: a round that mixes changes with another tool: a change after the tool waits for it');
	await panel.evaluate(sendText(proposeText([{ edit: 'README.md', search: 'A small workspace', replace: 'A mixed workspace' }, { call: 'harness_ping' }, { edit: 'greet.js', search: HELLO, replace: HI }])));
	await until(s => waitingCards(s).length >= 1 && waitingCards(s).every(c => c.armed), 30000);
	await sleep(500);
	const mixedFirst = await snap();
	await onCard(waitingCards(mixedFirst)[0]?.id, 'Accept');
	const mixedPing = await until(s => cardsOf(s).some(c => c.label === 'harness ping' && c.status === 'waiting' && c.armed), 15000);
	const pingAllowed = await panel.evaluate(clickText('.turn:last-child .tool.waiting .tool-ask button', 'Allow once'));
	const mixedLast = await until(s => cardsOf(s).some(c => c.label === 'Edit greet.js' && c.status === 'waiting' && c.armed), 15000);
	await onCard(cardsOf(mixedLast).find(c => c.label === 'Edit greet.js')?.id, 'Accept');
	const mixedDone = await answered();
	result.edits.mixed = { first: cardsOf(mixedFirst).map(c => [c.label, c.status]), ping: cardsOf(mixedPing).map(c => [c.label, c.status]), allowed: pingAllowed, done: mixedDone?.tools?.map(c => [c.label, c.status]), readme: /A mixed workspace/.test(onDisk('README.md') ?? ''), greet: onDisk('greet.js')?.includes(HI) };
	check(js(result.edits.mixed.first) === js([['Edit README.md', 'waiting']]) && js(result.edits.mixed.ping) === js([['Edit README.md', 'done'], ['harness ping', 'waiting']]), `edits: a change after another tool in its round was proposed before that tool ran (${js(result.edits.mixed)})`);
	check(js(result.edits.mixed.done) === js([['Edit README.md', 'done'], ['harness ping', 'done'], ['Edit greet.js', 'done']]) && result.edits.mixed.readme && result.edits.mixed.greet, `edits: the mixed round did not run in its order and reach both files (${js(result.edits.mixed)})`);
	save();

	// ── context ───────────────────────────────────────────────────────────────
	log('context: the open file and the selection go with a question, until switched off');
	const chipNamed = (s, text) => s.chips?.find(c => c.text === text);
	/** The names on the last question's bubble. */
	const bubble = async () => (await snap()).turns.filter(t => t.role === 'user').pop()?.attached;
	const greetDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(WS, 'greet.js')));
	const greetEditor = await vscode.window.showTextDocument(greetDoc, { preview: false });
	const fnLine = greetDoc.getText().split('\n').findIndex(line => line.startsWith('export function greet'));
	greetEditor.selection = new vscode.Selection(fnLine, 0, fnLine + 2, 1);
	const selectionChip = `lines ${fnLine + 1}-${fnLine + 3}`;
	const withChips = await until(s => !!chipNamed(s, 'greet.js') && !!chipNamed(s, selectionChip), 5000);
	from = (await stubRequests()).length;
	await ask('context one: what is selected?');
	const c1 = { attached: await bubble() };
	const c1Text = lastUserText((await anthropicSince(from))[0]);
	await panel.evaluate(clickText('footer .chips .chip-label', selectionChip));
	await until(s => chipNamed(s, selectionChip)?.on === false, 3000);
	from = (await stubRequests()).length;
	await ask('context two: and around the cursor?');
	const c2Text = lastUserText((await anthropicSince(from))[0]);
	await panel.evaluate(clickText('footer .chips .chip-label', 'greet.js'));
	await until(s => chipNamed(s, 'greet.js')?.on === false, 3000);
	from = (await stubRequests()).length;
	await ask('context three: nothing else');
	const c3Text = lastUserText((await anthropicSince(from))[0]);
	const selected = greetDoc.getText(new vscode.Range(fnLine, 0, fnLine + 2, 1));
	result.context = {
		chips: withChips.chips, bubble: c1?.attached,
		withSelection: { opened: c1Text.includes('The user has "greet.js" open'), selection: c1Text.includes(`the user selected lines ${fnLine + 1}-${fnLine + 3}`) && c1Text.includes(selected), words: c1Text.endsWith('context one: what is selected?') },
		aroundCursor: { opened: c2Text.includes('The user has "greet.js" open'), around: /around line \d+/.test(c2Text), selection: c2Text.includes('the user selected') },
		switchedOff: { opened: c3Text.includes('greet.js'), text: c3Text.slice(0, 60) }
	};
	check(result.context.withSelection.opened && result.context.withSelection.selection && result.context.withSelection.words && js(c1?.attached) === js([`greet.js:${fnLine + 1}-${fnLine + 3}`]), `context: a question did not carry the selection of the open file before its words, or its bubble did not say so (${js({ ...result.context.withSelection, bubble: c1?.attached })})`);
	check(result.context.aroundCursor.opened && result.context.aroundCursor.around && !result.context.aroundCursor.selection, `context: with the selection switched off, the question did not carry the lines around the cursor alone (${js(result.context.aroundCursor)})`);
	check(result.context.withSelection.opened && !result.context.switchedOff.opened && c3Text === 'context three: nothing else', `context: with both switched off, the question still carried the open file, or none ever did (${js(result.context.switchedOff)})`);
	await panel.evaluate(clickText('footer .chips .chip-label', 'greet.js'));
	await panel.evaluate(clickText('footer .chips .chip-label', selectionChip));
	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	const closed = await until(s => !chipNamed(s, 'greet.js'), 5000);
	result.context.closed = closed.chips;
	check(!!chipNamed(withChips, 'greet.js') && !chipNamed(closed, 'greet.js'), `context: a closed editor's file was still offered, or it never was (${js(closed.chips)})`);
	save();

	log('context: an @-mention');
	await panel.evaluate(typeText('context four: read @READ'));
	const suggested = await until(s => s.suggest.includes('README.md'), 5000);
	await panel.evaluate(key('Enter'));
	const mentioned = await until(s => !!chipNamed(s, '@README.md'), 3000);
	const typed = await panel.evaluate(`document.querySelector('footer textarea').value`);
	from = (await stubRequests()).length;
	const beforeMention = mentioned.turns.length;
	await panel.evaluate(key('Enter'));
	await until(s => s.turns.length >= beforeMention + 2 && !last(s).streaming && !s.stop, 20000);
	const c4 = { attached: await bubble() };
	const c4Text = lastUserText((await anthropicSince(from))[0]);
	const readmeNow = onDisk('README.md');
	result.context.mention = { suggested: suggested.suggest.slice(0, 3), typed, chips: mentioned.chips, bubble: c4?.attached, fenced: /<attachment-[0-9a-f]{12} path="README\.md">/.test(c4Text) && c4Text.includes(readmeNow.trim()) };
	check(suggested.suggest[0] === 'README.md' && typed === 'context four: read @README.md ' && result.context.mention.fenced && js(c4?.attached) === js(['README.md']), `context: an @-mention did not offer README.md, or did not carry it, fenced, with the question (${js(result.context.mention)})`);
	check(mentioned.chips.length === 1, `context: the @-mention left other chips on the composer (${js(mentioned.chips)})`);
	save();

	log('context: a file outside the workspace, chosen in VS Code\'s file picker');
	const outside = path.join(PROFILE ?? WS, 'outside-note.txt');
	fs.writeFileSync(outside, 'A note kept outside the workspace, attached by the user.\n');
	await vscode.workspace.getConfiguration().update('files.simpleDialog.enable', true, vscode.ConfigurationTarget.Global);
	await panel.evaluate(click('button[title="Attach files"]'));
	let dialogInput = false;
	for (let i = 0; i < 40 && !dialogInput; i++) {
		dialogInput = await win.evaluate(`(() => { const i = document.querySelector('.quick-input-widget:not([style*="display: none"]) input.input'); if (!i) { return false; } i.focus(); i.select(); return true; })()`);
		if (!dialogInput) { await sleep(250); }
	}
	if (dialogInput) {
		await win.send('Input.insertText', { text: outside });
		await sleep(300);
		await win.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
		await win.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
	}
	// A file outside the workspace goes by its name alone: its folder would tell a vendor the user's home.
	const attachedChip = await until(s => !!chipNamed(s, 'outside-note.txt'), 8000);
	from = (await stubRequests()).length;
	await ask('context five: what does the note say?');
	const c5 = { attached: await bubble() };
	const c5Text = lastUserText((await anthropicSince(from))[0]);
	await vscode.workspace.getConfiguration().update('files.simpleDialog.enable', undefined, vscode.ConfigurationTarget.Global);
	result.context.picked = { dialog: dialogInput, chips: attachedChip.chips, bubble: c5?.attached, carried: c5Text.includes('A note kept outside the workspace'), folderSent: c5Text.includes(path.dirname(outside)) };
	check(dialogInput && !!chipNamed(attachedChip, 'outside-note.txt') && result.context.picked.carried && !result.context.picked.folderSent && js(c5?.attached) === js(['outside-note.txt']), `context: a file chosen in VS Code's file picker, outside the workspace, did not go with the question by its name alone (${js(result.context.picked)})`);
	save();

	log('context: a pasted image, to a model that can see and to one that cannot');
	await panel.evaluate(pasteImage);
	await until(s => s.chips.some(c => /^image 1 /.test(c.text)), 5000);
	from = (await stubRequests()).length;
	await ask('context six: what is in the picture?');
	const c6 = { attached: await bubble() };
	const c6Request = (await anthropicSince(from))[0];
	const c6User = [...(c6Request?.body?.messages ?? [])].reverse().find(m => m.role === 'user');
	const c6Images = (Array.isArray(c6User?.content) ? c6User.content : []).filter(b => b.type === 'image');
	await panel.evaluate(choose('footer select[title="Model"]', OTHERS.ollama));
	await sleep(300);
	await panel.evaluate(pasteImage);
	await until(s => s.chips.some(c => /^image 1 /.test(c.text)), 5000);
	from = (await stubRequests()).length;
	await ask('context seven: and this one?');
	const c7Request = (await stubRequests()).slice(from).filter(r => r.path === '/api/chat')[0];
	const c7User = [...(c7Request?.body?.messages ?? [])].reverse().find(m => m.role === 'user');
	await panel.evaluate(choose('footer select[title="Model"]', MODEL));
	await sleep(300);
	result.context.pictures = { bubble: c6?.attached, claude: c6Images.map(b => b.source?.media_type), ollama: { images: (c7Request?.body?.messages ?? []).flatMap(m => m.images ?? []).length, note: /cannot view images/.test(c7User?.content ?? '') } };
	check(js(c6?.attached) === js(['image']) && js(result.context.pictures.claude) === js(['image/png']), `context: a pasted image did not reach Anthropic as an image with the question (${js(result.context.pictures)})`);
	check(c7Request && result.context.pictures.ollama.images === 0 && result.context.pictures.ollama.note, `context: the text-only model was sent the pasted image, or no note (${js(result.context.pictures.ollama)})`);

	log('context: the next question carries the earlier ones as they went');
	from = (await stubRequests()).length;
	await ask('context eight: one more');
	const c8Messages = (await anthropicSince(from))[0]?.body?.messages ?? [];
	const c8Users = c8Messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : m.content.map(b => b.type === 'text' ? b.text : `[${b.type}]`).join(''));
	result.context.history = { readme: c8Users.some(t => /<attachment-[0-9a-f]{12} path="README\.md">/.test(t) && t.includes('context four')), note: c8Users.some(t => t.includes('A note kept outside the workspace')), image: c8Messages.some(m => m.role === 'user' && Array.isArray(m.content) && m.content.some(b => b.type === 'image')) };
	check(result.context.history.readme && result.context.history.note && result.context.history.image, `context: the next question's history did not carry what the earlier questions carried (${js(result.context.history)})`);
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
	// The tab opens in the file's group, in its place: greet.js is hidden, and still the open file.
	const greetForTab = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(WS, 'greet.js')));
	await vscode.window.showTextDocument(greetForTab, { preview: false });
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
	from = (await stubRequests()).length;
	await tab.evaluate(sendText('a question from the tab'));
	for (let i = 0; i < 100; i++) {
		const s = await tab.evaluate(SNAPSHOT);
		if (!s.noContent && s.turns.length >= 2 && !last(s).streaming && !s.stop) { break; }
		await sleep(150);
	}
	const fromTab = lastUserText((await anthropicSince(from))[0]);
	result.tab.context = { chips: tabState?.chips, carried: fromTab.includes('The user has "greet.js" open'), greetShown: vscode.window.visibleTextEditors.some(e => e.document.uri.fsPath.endsWith('greet.js')) };
	check(tabState?.chips?.some(c => c.text === 'greet.js') && result.tab.context.carried && !result.tab.context.greetShown, `tab: opened over greet.js in its group, the panel did not keep greet.js as the open file (${js(result.tab.context)})`);
	await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input?.uri?.fsPath?.endsWith('greet.js')));
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
	check(vendorCalls.length > 0 && vendorCalls.every(call => call.host === 'api.openai.com' || (call.host === 'api.groq.com' && call.path === '/openai/v1/models')), `guard: the vendor calls are not just OpenAI's and Groq's, at their own addresses, as this probe asked (${js(vendorCalls)})`);
	save();

	// ── reload ────────────────────────────────────────────────────────────────
	log('reload: in the tab, one change applied while the other waits');
	const tabAgain = await connectWebview(EXTENSION, 'webviewPanel');
	const tabUntil = async (ok, ms = 20000) => {
		let s;
		for (const deadline = Date.now() + ms; Date.now() < deadline;) {
			s = await tabAgain.evaluate(SNAPSHOT);
			if (!s.noContent && ok(s)) { return s; }
			await sleep(150);
		}
		return s;
	};
	result.tabReload = { readme: onDisk('README.md'), greet: onDisk('greet.js') };
	await tabAgain.evaluate(sendText(proposeText([{ edit: 'README.md', search: 'A mixed workspace', replace: 'A waiting workspace' }, { edit: 'greet.js', search: HI, replace: 'Hi there, ${name}!' }])));
	const tabWaiting = await tabUntil(s => waitingCards(s).length === 2 && waitingCards(s).every(c => c.armed), 30000);
	const tabGreet = waitingCards(tabWaiting).find(c => c.label === 'Edit greet.js');
	await tabAgain.evaluate(clickText(`.turn:last-child .tool[data-call=${js(tabGreet?.id ?? '-')}] .tool-ask button`, 'Accept'));
	await within(async () => onDisk('greet.js'), text => text?.includes('Hi there') ?? false);
	const tabApplied = await tabUntil(s => cardsOf(s).some(c => c.label === 'Edit greet.js' && c.status === 'done'), 5000);
	result.tabReload.atReload = cardsOf(tabApplied).map(c => [c.label, c.status]);
	check(js(result.tabReload.atReload) === js([['Edit README.md', 'waiting'], ['Edit greet.js', 'done']]), `reload: in the tab, the change accepted while the other waited was not applied (${js(result.tabReload)})`);
	tabAgain.close();

	log('reload: the window reloads while a card waits');
	const reloadFrom = (await snap()).turns.length;
	await panel.evaluate(sendText('use sirius_list_directory then harness_ping'));
	const waitingAtReload = await until(s => s.turns.length >= reloadFrom + 2 && lastTool(s)?.status === 'waiting', 30000);
	result.atReload = { cards: last(waitingAtReload)?.tools?.map(card => ({ label: card.label, status: card.status })) };
	check(last(waitingAtReload)?.tools?.length === 2 && lastTool(waitingAtReload)?.status === 'waiting', `reload: the answer was not waiting on its second round's card (${js(result.atReload)})`);
	const final = await snap();
	result.beforeReload = { title: final.title, turns: final.turns.length };
	fs.writeFileSync(BEFORE, JSON.stringify({ ...result, failures }, null, 1));
	panel.close();
	win.close();
	// Not awaited: the command's promise is cancelled as the window goes.
	vscode.commands.executeCommand('workbench.action.reloadWindow').then(undefined, () => { /* the window is reloading */ });
	return new Promise(() => { /* this extension host ends with the reload; the next one finishes */ });
};
