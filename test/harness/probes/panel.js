/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Sirius's own panel in stock VS Code (the VS Code edition), driven through its webview as a
// person would, against the hosted stub (test/harness/edition-stub.sh):
//   start     — before any setup the panel says how to begin — or, when a local server such as
//               Ollama answers, offers its models and says to ask.
//   setup     — on Models and Keys, Anthropic's address (the stub) and a key are saved; the stub's
//               models are offered; the key never reaches the webview's page.
//   thinking  — "slow: think about it": the thinking block shows while it streams, its text in
//               pieces; when the answer comes it closes to "Thought for N second(s)"; a click opens
//               it again with the reasoning; the answer is the stub's; tokens are shown.
//   replay    — the next turn carries the earlier answer's thinking block back, text and signature
//               unchanged, first in that answer (Sirius keeps this history, so nothing drops it).
//   stop      — "think hold" is held mid-thought by the stub; Stop closes the connection at once
//               and the answer is marked Stopped.
//   retry     — Retry answers the last question again, in place of the last answer.
//   sessions  — the conversations list holds this one; New starts an empty one; opening the old
//               one from the list brings its turns back.
//   tab       — Open in New Tab gives a second panel, a new conversation, with the same models.
//   reload    — after the window reloads, the side panel shows the last conversation again.
// Progress in <result>.log; the part before the reload in <result>.before-reload.json.

const fs = require('fs');
const path = require('path');
const { connectWebview } = require(path.join(__dirname, '..', 'cdp-window.js'));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const OUT = process.env.SIRIUS_PROBE_OUT;
const HOSTED = 'http://127.0.0.1:11992';
const KEY = 'good-key';
const EXTENSION = 'siriuside.sirius-ai';
const MODEL = 'anthropic/claude-stub-adaptive';
const REASONING = 'Stub reasoning for round 0: first the files, then the answer.';
const BEFORE = `${OUT}.before-reload.json`;
const CLOSE_WITHIN_MS = 3000;

const log = line => { if (OUT) { fs.appendFileSync(`${OUT}.log`, `${new Date().toISOString().slice(11, 19)} ${line}\n`); } };
const stubRequests = async () => (await fetch(`${HOSTED}/__requests`)).json();
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
			retry: !!t.querySelector('.meta button[title="Retry"]')
		};
	}),
	models: [...document.querySelectorAll('footer select[title="Model"] option')].map(o => o.value),
	model: document.querySelector('footer select[title="Model"]')?.value ?? null,
	stop: !document.querySelector('button[title="Stop"]')?.hidden,
	sessions: [...document.querySelectorAll('ul.sessions .session-title')].map(e => e.textContent),
	providers: Object.fromEntries([...document.querySelectorAll('.provider')].map(p => [p.dataset.provider, p.querySelector('.provider-status')?.textContent ?? '']))
})`;
const click = selector => `(() => { const b = document.querySelector(${js(selector)}); if (b) { b.click(); } return !!b; })()`;
const sendText = text => `(() => { const t = document.querySelector('footer textarea'); t.value = ${js(text)}; t.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`;
const choose = (selector, value) => `(() => { const s = document.querySelector(${js(selector)}); s.value = ${js(value)}; s.dispatchEvent(new window.Event('change', { bubbles: true })); return s.value; })()`;
const fill = (provider, field, value, button) => `(() => {
	const row = document.querySelector('[data-provider=${js(provider)}]');
	const input = row?.querySelector(${js(field)});
	if (!input) { return false; }
	input.value = ${js(value)};
	[...row.querySelectorAll('button')].find(b => b.textContent === ${js(button)})?.click();
	return true;
})()`;

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

	await vscode.commands.executeCommand('sirius.open');
	const panel = await connectWebview(EXTENSION, 'webviewView');
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

	// ── reload: the second activation, after the window reloaded ──────────────
	if (reloaded) {
		log('reload: the panel after the window reloaded');
		const after = await until(s => s.turns.length > 0, 20000);
		result.reload = { title: after.title, turns: after.turns.length };
		check(after.turns.length === result.beforeReload?.turns && after.title === result.beforeReload?.title, `reload: the panel did not show the last conversation again (${JSON.stringify(result.reload)} vs ${JSON.stringify(result.beforeReload)})`);
		panel.close();
		return { ok: failures.length === 0, failures, ...result };
	}

	// ── start ─────────────────────────────────────────────────────────────────
	log('start');
	const start = await until(s => s.empty !== null && !/Looking/.test(s.models.join()));
	result.start = { empty: start.empty, models: start.models.length };
	const local = start.models.some(m => /^(ollama|lmstudio|llamacpp)\//.test(m));
	check(local ? /Ask anything/.test(start.empty ?? '') : /Add a provider/.test(start.empty ?? '') && start.models.every(m => !m.includes('/')),
		`start: the panel did not say how to begin for ${local ? 'the local models it found' : 'no models'} (${JSON.stringify(start.empty)})`);

	// ── setup ─────────────────────────────────────────────────────────────────
	log('setup: the stub\'s address and a key for Anthropic');
	await panel.evaluate(click('button[title="Models and keys"]'));
	await until(s => 'anthropic' in s.providers);
	await panel.evaluate(fill('anthropic', 'input[type="text"]', HOSTED, 'Save address'));
	await sleep(500);
	await until(s => 'anthropic' in s.providers);
	await panel.evaluate(fill('anthropic', 'input[type="password"]', KEY, 'Save key'));
	const ready = await until(s => /\d+ models?/.test(s.providers.anthropic ?? ''));
	result.setup = { anthropic: ready.providers.anthropic, keyInPage: await panel.evaluate(`document.documentElement.outerHTML.includes(${js(KEY)})`) };
	check(/\d+ models?/.test(ready.providers.anthropic ?? ''), `setup: Anthropic did not offer the stub's models (${JSON.stringify(ready.providers)})`);
	check(result.setup.keyInPage === false, 'setup: the key is in the webview\'s page');
	save();

	// ── thinking ──────────────────────────────────────────────────────────────
	log('thinking: slow thinking, then the answer');
	await panel.evaluate(click('button[title="Back to the conversation"]'));
	const chat = await until(s => s.models.includes(MODEL));
	check(chat.models.includes(MODEL), `thinking: ${MODEL} is not offered (${chat.models.join(', ')})`);
	await panel.evaluate(choose('footer select[title="Model"]', MODEL));
	await panel.evaluate(sendText('slow: think about it'));
	const samples = [];
	let done;
	for (const deadline = Date.now() + 30000; Date.now() < deadline;) {
		const s = await snap();
		const turn = last(s);
		if (turn?.role === 'assistant' && turn.thinking?.streaming) {
			samples.push({ length: turn.thinking.text.length, open: turn.thinking.open, label: turn.thinking.label });
		}
		if (turn?.role === 'assistant' && !turn.streaming && turn.text) { done = s; break; }
		await sleep(100);
	}
	const answer = done ? last(done) : undefined;
	await panel.evaluate(click('.turn:last-child .thinking-head'));
	const reopened = last(await until(s => last(s)?.thinking?.open === true, 3000));
	result.thinking = { samples: samples.length, lengths: [...new Set(samples.map(s => s.length))], answer, reopened: reopened?.thinking };
	check(samples.length > 0 && samples.every(s => s.open && s.label === 'Thinking…'), `thinking: the block was not seen open and streaming (${JSON.stringify(samples.slice(0, 3))})`);
	check(samples.some(s => s.length > 0 && s.length < REASONING.length), 'thinking: the reasoning was never seen part-way');
	check(answer && answer.thinking && !answer.thinking.open && /^Thought for \d+ seconds?$/.test(answer.thinking.label), `thinking: the block did not close to "Thought for N seconds" (${JSON.stringify(answer?.thinking)})`);
	check(answer && /pong slow: think about it/.test(answer.text), `thinking: the answer was ${JSON.stringify(answer?.text)}`);
	check(answer && /\d+ in · \d+ out/.test(answer.meta), `thinking: no token count (${JSON.stringify(answer?.meta)})`);
	check(reopened?.thinking?.text === REASONING, `thinking: the reopened block does not hold the reasoning (${JSON.stringify(reopened?.thinking)})`);
	save();

	// ── replay ────────────────────────────────────────────────────────────────
	log('replay: the next turn carries the thinking back');
	let from = (await stubRequests()).length;
	const firstAnswer = (await stubRequests()).filter(r => r.method === 'POST' && r.path.startsWith('/v1/messages')).pop();
	await panel.evaluate(sendText('think again'));
	await until(s => last(s)?.role === 'assistant' && !last(s).streaming && last(s).text.includes('pong think again'));
	const second = (await stubRequests()).slice(from).find(r => r.method === 'POST' && r.path.startsWith('/v1/messages'));
	const earlier = (second?.body?.messages ?? []).filter(m => m.role === 'assistant')[0];
	const block = Array.isArray(earlier?.content) ? earlier.content[0] : undefined;
	result.replay = { firstStatus: firstAnswer?.status, sentBack: block ? { type: block.type, thinking: block.thinking, signature: block.signature } : earlier?.content ?? null };
	check(block?.type === 'thinking' && block.thinking === REASONING && /^stub-signature-0-[0-9a-f]{12}$/.test(block.signature ?? ''), `replay: the earlier answer's thinking did not go back unchanged (${JSON.stringify(result.replay.sentBack)})`);
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
	save();

	// ── retry ─────────────────────────────────────────────────────────────────
	log('retry');
	await panel.evaluate(sendText('a plain question'));
	const asked = await until(s => last(s)?.role === 'assistant' && !last(s).streaming && last(s).text.includes('pong a plain question'));
	from = (await stubRequests()).length;
	await panel.evaluate(click('.turn:last-child .meta button[title="Retry"]'));
	await sleep(300);
	const retried = await until(s => last(s)?.role === 'assistant' && !last(s).streaming && last(s).text.includes('pong a plain question'));
	const retryRequests = (await stubRequests()).slice(from).filter(r => r.method === 'POST' && r.path.startsWith('/v1/messages'));
	result.retry = { before: asked.turns.length, after: retried.turns.length, requests: retryRequests.length };
	check(retryRequests.length === 1 && retried.turns.length === asked.turns.length, `retry: not one new request in place of the last answer (${JSON.stringify(result.retry)})`);
	save();

	// ── sessions ──────────────────────────────────────────────────────────────
	log('sessions');
	const title = retried.title;
	const turns = retried.turns.length;
	await panel.evaluate(click('button[title="Conversations"]'));
	const listed = await until(s => s.sessions.length > 0, 5000);
	await panel.evaluate(click('button[title="New conversation"]'));
	const fresh = await until(s => s.empty !== null && s.turns.length === 0, 5000);
	await panel.evaluate(click('button[title="Conversations"]'));
	await until(s => s.sessions.length > 0, 5000);
	await panel.evaluate(`(() => { const b = [...document.querySelectorAll('button.session')].find(x => x.querySelector('.session-title')?.textContent === ${js(title)}); b?.click(); return !!b; })()`);
	const reopenedSession = await until(s => s.turns.length === turns, 5000);
	result.sessions = { listed: listed.sessions, freshTurns: fresh.turns.length, reopened: { title: reopenedSession.title, turns: reopenedSession.turns.length } };
	check(listed.sessions.includes(title), `sessions: the list does not hold "${title}" (${JSON.stringify(listed.sessions)})`);
	check(fresh.turns.length === 0, 'sessions: New did not start an empty conversation');
	check(reopenedSession.title === title && reopenedSession.turns.length === turns, `sessions: opening "${title}" did not bring its ${turns} turns back (${JSON.stringify(result.sessions.reopened)})`);
	save();

	// ── tab ───────────────────────────────────────────────────────────────────
	log('tab');
	await vscode.commands.executeCommand('sirius.panel.openInTab');
	const tab = await connectWebview(EXTENSION, 'webviewPanel');
	let tabState;
	for (let i = 0; i < 100; i++) {
		tabState = await tab.evaluate(SNAPSHOT);
		if (!tabState.noContent && tabState.models.includes(MODEL)) { break; }
		await sleep(150);
	}
	result.tab = { empty: tabState?.empty, turns: tabState?.turns?.length, models: tabState?.models?.length };
	check(tabState && tabState.turns.length === 0 && tabState.models.includes(MODEL), `tab: not a new conversation with the models (${JSON.stringify(result.tab)})`);
	tab.close();

	// ── reload ────────────────────────────────────────────────────────────────
	log('reload: the window reloads');
	result.beforeReload = { title, turns };
	fs.writeFileSync(BEFORE, JSON.stringify({ ...result, failures }, null, 1));
	panel.close();
	// Not awaited: the command's promise is cancelled as the window goes.
	vscode.commands.executeCommand('workbench.action.reloadWindow').then(undefined, () => { /* the window is reloading */ });
	return new Promise(() => { /* this extension host ends with the reload; the next one finishes */ });
};
