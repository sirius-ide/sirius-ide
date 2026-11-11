/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The agent loop (agent/core.ts) through the real chat, against the hosted stub
// (test/harness/chat-stub.sh), on an Anthropic group pointed at the stub:
//   rescue — in Agent mode, "prose call" is answered with a sirius_list_directory call written as
//            text in a fenced block, as a small model writes it: the loop runs it as a real call
//            (its id `rescued-0-0`), the next round carries the listing back, the answer arrives,
//            and the call's JSON never shows in the chat.
//   refuse — in Ask mode, "call the terminal" is answered with a run_in_terminal call, which Ask
//            does not offer: the loop runs nothing and tells the model so, and the answer arrives.
// The chat's text is read over CDP. Progress in <result>.log.

const fs = require('fs');
const path = require('path');
const { connectWindow } = require(path.join(__dirname, '..', 'cdp-window.js'));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const OUT = process.env.SIRIUS_PROBE_OUT;
const HOSTED = 'http://127.0.0.1:11992';
const KEY = 'good-key';

const log = line => { if (OUT) { fs.appendFileSync(`${OUT}.log`, `${new Date().toISOString().slice(11, 19)} ${line}\n`); } };
const stubRequests = async () => (await fetch(`${HOSTED}/__requests`)).json();
const CHAT_TEXT = `document.querySelector('.interactive-session')?.textContent ?? ''`;
/** The text of the tool results a recorded Anthropic request carries. */
const toolResults = record => (record.body?.messages ?? []).flatMap(m => Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_result') : [])
	.map(b => ({ id: b.tool_use_id, text: typeof b.content === 'string' ? b.content : (b.content ?? []).map(c => c.text ?? '').join('') }));

exports.run = async function (vscode) {
	const failures = [];
	const check = (ok, what) => { if (!ok) { failures.push(what); } };
	const result = {};

	await vscode.extensions.getExtension('sirius.sirius-ai').activate();
	const window = await connectWindow(vscode.env.appRoot);
	try {
		await vscode.commands.executeCommand('lm.addLanguageModelsProviderGroup', { vendor: 'sirius-anthropic', name: 'Anthropic stub', apiKey: KEY, url: HOSTED });
	} catch (error) {
		check(false, `adding the group: ${error}`);
	}
	let model;
	for (let i = 0; i < 15 && !model; i++) {
		model = (await vscode.lm.selectChatModels({ vendor: 'sirius-anthropic' })).find(m => m.id === 'claude-stub-adaptive');
		if (!model) { await sleep(2000); }
	}
	if (!model) {
		window.close();
		return { ok: false, failures: [...failures, 'the stub\'s adaptive model was not offered'] };
	}

	/** Sends `query` in a new chat in `modeId` and waits for "pong tool" in the chat, up to 30 s. */
	const exchange = async (modeId, query) => {
		const from = (await stubRequests()).length;
		await vscode.commands.executeCommand('workbench.action.chat.newChat');
		await vscode.commands.executeCommand('workbench.action.chat.toggleAgentMode', { modeId });
		await sleep(300);
		void vscode.commands.executeCommand('workbench.action.chat.open', { query, modelSelector: { vendor: model.vendor, id: model.id } });
		let text = '';
		for (let i = 0; i < 150 && !text.includes('pong tool'); i++) {
			await sleep(200);
			text = await window.evaluate(CHAT_TEXT);
		}
		await sleep(500);
		text = await window.evaluate(CHAT_TEXT);
		const requests = (await stubRequests()).slice(from).filter(r => r.method === 'POST' && r.path.startsWith('/v1/messages') && r.body?.model === model.id);
		return { text, requests };
	};

	// ── rescue ─────────────────────────────────────────────────────────────────
	log('rescue: a call written as prose');
	{
		const { text, requests } = await exchange('agent', 'prose call: list the files');
		const results = requests.flatMap(toolResults);
		const rescued = results.find(r => r.id === 'rescued-0-0');
		result.rescue = { rounds: requests.length, results, answer: text.includes('pong tool'), leaked: text.includes('"arguments"') };
		check(requests.length >= 2, `rescue: ${requests.length} round(s) reached the stub, not 2`);
		check(rescued && rescued.text.length > 0 && !/not available|failed/i.test(rescued.text), `rescue: the prose call did not run as a real call (${JSON.stringify(results)})`);
		check(result.rescue.answer, 'rescue: no answer in the chat');
		check(!result.rescue.leaked, 'rescue: the call\'s JSON showed in the chat');
	}

	// ── refuse ─────────────────────────────────────────────────────────────────
	log('refuse: a tool Ask does not offer');
	{
		const { text, requests } = await exchange('ask', 'call the terminal');
		const results = requests.flatMap(toolResults);
		result.refuse = { rounds: requests.length, offered: (requests[0]?.body?.tools ?? []).map(t => t.name), results, answer: text.includes('pong tool') };
		check(!result.refuse.offered.includes('run_in_terminal'), `refuse: Ask offered run_in_terminal (${result.refuse.offered.join(', ')})`);
		check(results.some(r => r.text === 'run_in_terminal is not available in ask mode.'), `refuse: the model was not told the tool is unavailable (${JSON.stringify(results)})`);
		check(result.refuse.answer, 'refuse: no answer in the chat');
	}

	await vscode.commands.executeCommand('workbench.action.chat.newChat');
	window.close();
	return { ok: failures.length === 0, failures, ...result };
};
