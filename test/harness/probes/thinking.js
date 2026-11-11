/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Thinking in the chat, on screen and on the wire, against the hosted stub (test/harness/chat-stub.sh).
// Sent through the real chat in Agent mode to an Anthropic group pointed at the stub:
//   live      — "slow: think, then list the files" on the adaptive model: the thinking block shows
//               while it streams, with the text arriving in pieces; the model calls list_directory;
//               when the answer comes the block is closed; a click on its header opens it again,
//               and it holds the reasoning of both rounds.
//   replay    — that request's second round carries the first round's thinking back, first in the
//               assistant turn, text and signature unchanged (the stub checks it: `replay`).
//   budget    — the same on the old-generation model, which thinks on a budget: there a missing
//               block is refused with HTTP 400, as Anthropic refuses it, so the answer arriving
//               is the proof.
//   shapes    — through the language-model API, as the agent sends a tool round: two blocks and a
//               redacted one, and an empty-text block (display omitted), each come back whole and
//               in order.
//   binding    — the tool set changes between rounds, as when the agent opens a group of an MCP
//               server's tools: with adaptive thinking the earlier block is left behind (the stub,
//               as Anthropic, refuses a block bound to another tool set); on a thinking budget,
//               which binds nothing and needs it, the block is kept.
//   stop      — "think hold" holds the reply after the first piece of thinking; the chat's Stop
//               closes the connection at the stub, and the block stops streaming.
// The window's DOM is read over CDP: run.sh passes SIRIUS_PROBE_ARGS=--remote-debugging-port=<n>
// and the probe reads SIRIUS_PROBE_CDP_PORT. Progress in <result>.log.

const fs = require('fs');
const path = require('path');
const { connectWindow } = require(path.join(__dirname, '..', 'cdp-window.js'));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const OUT = process.env.SIRIUS_PROBE_OUT;
const HOSTED = 'http://127.0.0.1:11992';
const KEY = 'good-key';
const CLOSE_WITHIN_MS = 3000;
const REASONING = round => `Stub reasoning for round ${round}: first the files, then the answer.`;

const log = line => { if (OUT) { fs.appendFileSync(`${OUT}.log`, `${new Date().toISOString().slice(11, 19)} ${line}\n`); } };
const stubRequests = async () => (await fetch(`${HOSTED}/__requests`)).json();

/** Every thinking block in the chat: closed or open, streaming or not, its title and text. */
const BLOCKS = `[...document.querySelectorAll('.chat-used-context.chat-thinking-box')].map(box => ({
	collapsed: box.classList.contains('chat-used-context-collapsed'),
	streaming: !!box.querySelector('.chat-thinking-streaming'),
	title: (box.querySelector('.chat-used-context-label')?.textContent ?? '').trim(),
	text: (box.querySelector('.chat-thinking-collapsible')?.textContent ?? '')
}))`;
/** Clicks each closed block's header, as a user opens it. */
const OPEN_ALL = `(() => { let n = 0; for (const box of document.querySelectorAll('.chat-used-context.chat-thinking-box.chat-used-context-collapsed')) {
	const header = box.querySelector('.chat-used-context-label .monaco-button') ?? box.querySelector('.chat-used-context-label');
	header?.click(); n++; } return n; })()`;
const CHAT_TEXT = `document.querySelector('.interactive-session')?.textContent ?? ''`;

exports.run = async function (vscode) {
	const failures = [];
	const check = (ok, what) => { if (!ok) { failures.push(what); } };
	const result = {};
	const save = () => { if (OUT) { fs.writeFileSync(`${OUT}.partial.json`, JSON.stringify({ ok: failures.length === 0, failures, ...result }, null, 1)); } };

	await vscode.extensions.getExtension('sirius.sirius-ai').activate();
	const window = await connectWindow(vscode.env.appRoot);
	log('connected to the window');

	// ── the stub's group ───────────────────────────────────────────────────────
	try {
		await vscode.commands.executeCommand('lm.addLanguageModelsProviderGroup', { vendor: 'sirius-anthropic', name: 'Anthropic stub', apiKey: KEY, url: HOSTED });
	} catch (error) {
		check(false, `adding the group: ${error}`);
	}
	let models = [];
	for (let i = 0; i < 15; i++) {
		models = await vscode.lm.selectChatModels({ vendor: 'sirius-anthropic' });
		if (models.some(m => m.id === 'claude-stub-adaptive') && models.some(m => m.id === 'claude-3-stub-legacy')) {
			break;
		}
		await sleep(2000);
	}
	const adaptive = models.find(m => m.id === 'claude-stub-adaptive');
	const legacy = models.find(m => m.id === 'claude-3-stub-legacy');
	check(adaptive && legacy, `the stub's models were not offered (${models.map(m => m.id).join(', ') || 'none'})`);
	if (!adaptive || !legacy) {
		window.close();
		return { ok: false, failures };
	}

	/** Opens a new chat in Agent mode and sends `query` to `model`, without waiting for the answer. */
	const ask = async (model, query) => {
		await vscode.commands.executeCommand('workbench.action.chat.newChat');
		await vscode.commands.executeCommand('workbench.action.chat.toggleAgentMode', { modeId: 'agent' });
		await sleep(300);
		void vscode.commands.executeCommand('workbench.action.chat.open', { query, modelSelector: { vendor: model.vendor, id: model.id } });
	};
	/** The stub's records of this query's tool-loop requests, by round. */
	const rounds = async (from, model) => (await stubRequests()).slice(from)
		.filter(r => r.method === 'POST' && r.path.startsWith('/v1/messages') && r.body?.model === model.id && (r.body?.tools ?? []).some(t => t.name === 'sirius_list_directory'));

	// ── live: the block while it streams, then closed, then opened ─────────────
	{
		const from = (await stubRequests()).length;
		log('live: slow thinking through the chat');
		await ask(adaptive, 'slow: think, then list the files');
		const samples = [];
		let answered = false;
		for (let i = 0; i < 200 && !answered; i++) {
			const blocks = await window.evaluate(BLOCKS);
			const streaming = (blocks ?? []).filter(b => b.streaming);
			if (streaming.length) {
				samples.push({ at: i, length: streaming[0].text.length, collapsed: streaming[0].collapsed });
			}
			answered = (await window.evaluate(CHAT_TEXT)).includes('pong tool');
			if (!answered) { await sleep(100); }
		}
		await sleep(1500); // the block settles once the answer has started
		const settled = await window.evaluate(BLOCKS);
		const opened = await window.evaluate(OPEN_ALL);
		await sleep(500);
		const expanded = await window.evaluate(BLOCKS);
		const recorded = await rounds(from, adaptive);
		const second = recorded.find(r => r.replay);
		result.live = {
			answered,
			streamingSamples: samples.length,
			partialSeen: samples.some(s => s.length > 0 && s.length < REASONING(0).length),
			lengths: [...new Set(samples.map(s => s.length))],
			settled,
			opened,
			expanded,
			requests: recorded.map(r => ({ n: r.n, status: r.status, thinking: r.body?.thinking, replay: r.replay ? { ok: r.replay.ok, round: r.replay.round, found: r.replay.found?.type } : undefined }))
		};
		save();
		check(answered, 'live: no answer in the chat');
		check(samples.length > 0, 'live: the thinking block was never seen streaming');
		check(result.live.partialSeen, `live: the thinking text was never seen part-way (lengths ${result.live.lengths.join(',')})`);
		check((settled ?? []).length > 0 && settled.every(b => !b.streaming), `live: a block still streams after the answer (${JSON.stringify(settled)})`);
		check((settled ?? []).length > 0 && settled.every(b => b.collapsed), `live: the block did not close when the answer came (${JSON.stringify(settled)})`);
		const all = (expanded ?? []).map(b => b.text).join('\n');
		check((expanded ?? []).length > 0 && expanded.every(b => !b.collapsed), `live: a click on the header did not open the block (${JSON.stringify(expanded)})`);
		check(all.includes(REASONING(0)), 'live: the opened block does not hold the first round\'s reasoning');
		check(all.includes(REASONING(1)), 'live: the opened block does not hold the second round\'s reasoning');
		// ── replay ──
		check(!!second, 'replay: the second round never reached the stub');
		check(second?.replay?.ok === true, `replay: the second round did not carry the first round's thinking back unchanged (found ${JSON.stringify(second?.replay?.found)})`);
	}

	// ── budget: the old generation refuses a tool loop without its thinking ───
	{
		const from = (await stubRequests()).length;
		log('budget: the legacy model through the chat');
		await ask(legacy, 'think, then list the files');
		let answered = false;
		for (let i = 0; i < 150 && !answered; i++) {
			answered = (await window.evaluate(CHAT_TEXT)).includes('pong tool');
			if (!answered) { await sleep(200); }
		}
		const recorded = await rounds(from, legacy);
		const second = recorded.find(r => r.replay);
		result.budget = { answered, requests: recorded.map(r => ({ n: r.n, status: r.status, thinking: r.body?.thinking, replay: r.replay ? { ok: r.replay.ok, found: r.replay.found?.type } : undefined })) };
		save();
		check(second?.body?.thinking?.type === 'enabled', `budget: the legacy model was not asked to think on a budget (${JSON.stringify(second?.body?.thinking)})`);
		check(second?.status === 200 && second?.replay?.ok === true, `budget: the second round was refused or lost its thinking (${JSON.stringify(result.budget.requests)})`);
		check(answered, 'budget: no answer in the chat');
	}

	// ── shapes and binding: a tool round through the API, as the agent sends it ─
	{
		const LIST = { name: 'sirius_list_directory', description: 'List a directory.', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } };
		const EXTRA = { name: 'stub_extra', description: 'A tool that joins later, as a group\'s tools do.', inputSchema: { type: 'object', properties: {} } };
		/** One reply: the parts that carry blocks whole, the tool calls, the text, any error. */
		const reply = async (model, messages, tools) => {
			const out = { blocks: [], calls: [], text: '', error: undefined };
			try {
				const response = await model.sendRequest(messages, { tools }, new vscode.CancellationTokenSource().token);
				for await (const part of response.stream) {
					if (part instanceof vscode.LanguageModelThinkingPart && part.metadata?.siriusThinkingBlock) {
						out.blocks.push(part);
					} else if (part instanceof vscode.LanguageModelToolCallPart) {
						out.calls.push(part);
					} else if (part instanceof vscode.LanguageModelTextPart) {
						out.text += part.value;
					}
				}
			} catch (error) {
				out.error = String(error?.message ?? error);
			}
			return out;
		};
		/** A tool round: ask, then send the blocks and calls back with results under `second` tools. */
		const round = async (model, prompt, second) => {
			const from = (await stubRequests()).length;
			const user = vscode.LanguageModelChatMessage.User(prompt);
			const first = await reply(model, [user], [LIST]);
			const assistant = new vscode.LanguageModelChatMessage2(vscode.LanguageModelChatMessageRole.Assistant, [...first.blocks, ...first.calls]);
			const results = vscode.LanguageModelChatMessage.User(first.calls.map(call => new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart('a.txt')])));
			const answer = await reply(model, [user, assistant, results], second);
			const last = (await stubRequests()).slice(from).filter(r => r.method === 'POST' && r.path.startsWith('/v1/messages')).pop();
			return { blocks: first.blocks.length, calls: first.calls.length, status: last?.status, replay: last?.replay, answer: answer.text, error: answer.error };
		};
		log('shapes and binding: tool rounds through the API');
		result.shapes = {
			plain: await round(adaptive, 'think about the files', [LIST]),
			twoAndRedacted: await round(adaptive, 'think about the files: two thoughts, redacted', [LIST]),
			omitted: await round(adaptive, 'think about the files: omitted', [LIST])
		};
		result.binding = {
			adaptive: await round(adaptive, 'think about the files', [LIST, EXTRA]),
			budget: await round(legacy, 'think about the files', [LIST, EXTRA])
		};
		save();
		const blocksWanted = { plain: 1, twoAndRedacted: 3, omitted: 1 };
		for (const [name, r] of Object.entries(result.shapes)) {
			check(r.blocks === blocksWanted[name], `shapes ${name}: ${r.blocks} block(s) reported, not ${blocksWanted[name]}`);
			check(r.status === 200 && r.replay?.kept === true && r.replay?.stale === 0, `shapes ${name}: the blocks did not come back whole and in order (${JSON.stringify(r)})`);
			check(r.answer.includes('pong tool'), `shapes ${name}: no answer (${r.error ?? r.answer})`);
		}
		const a = result.binding.adaptive;
		check(a.status === 200 && a.replay?.stale === 0 && (a.replay?.leading ?? []).length === 0, `binding adaptive: a block made under the earlier tool set went back (${JSON.stringify(a)})`);
		check(a.answer.includes('pong tool'), `binding adaptive: no answer (${a.error ?? a.answer})`);
		const b = result.binding.budget;
		check(b.status === 200 && b.replay?.kept === true, `binding budget: the block was not kept for a model on a thinking budget (${JSON.stringify(b)})`);
		check(b.answer.includes('pong tool'), `binding budget: no answer (${b.error ?? b.answer})`);
	}

	// ── stop: Stop mid-thought closes the connection, and the block stops ─────
	{
		const from = (await stubRequests()).length;
		log('stop: holding mid-thought');
		await ask(adaptive, 'think hold');
		let held;
		for (let i = 0; i < 100 && !held; i++) {
			held = (await stubRequests()).slice(from).find(r => r.method === 'POST' && r.held && r.body?.model === adaptive.id);
			if (!held) { await sleep(100); }
		}
		await sleep(700);
		const during = await window.evaluate(BLOCKS);
		const cancelledAt = Date.now();
		await vscode.commands.executeCommand('workbench.action.chat.cancel');
		let release;
		for (let i = 0; i < 80 && !release; i++) {
			const record = (await stubRequests()).find(r => r.n === held?.n);
			if (record?.held?.releasedAt) {
				release = { by: record.held.by, closeMs: record.held.releasedAt - cancelledAt };
			} else {
				await sleep(100);
			}
		}
		await sleep(1000);
		const after = await window.evaluate(BLOCKS);
		result.stop = { held: !!held, during, release, after };
		save();
		check(!!held, 'stop: the request never reached the stub\'s hold');
		check((during ?? []).some(b => b.streaming && b.text.length > 0 && b.text.length < REASONING(0).length), `stop: no block was streaming part of the reasoning before Stop (${JSON.stringify(during)})`);
		check(release?.by === 'close' && release.closeMs >= 0 && release.closeMs <= CLOSE_WITHIN_MS, `stop: the stub did not see the connection close within ${CLOSE_WITHIN_MS} ms of Stop (${JSON.stringify(release)})`);
		check((after ?? []).every(b => !b.streaming), `stop: a block still streams after Stop (${JSON.stringify(after)})`);
	}

	await vscode.commands.executeCommand('workbench.action.chat.newChat');
	window.close();
	return { ok: failures.length === 0, failures, ...result };
};
