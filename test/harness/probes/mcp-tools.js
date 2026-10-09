/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// MCP servers' tools in the chat (hole 16). The profile's mcp.json names three stub MCP servers
// (test/harness/mcp-stub.mjs): sirius-stub with echo and write_note, sirius-mid with 20 filler
// tools, sirius-big with 70. The OpenAI stub is the model: asked to echo it calls an mcp_*_echo
// tool; asked for the filler it calls the big server's filler_1, opening the server's group
// first when that is all it is offered. Every request goes through the real chat and is read
// back from the "Sirius AI" log — the participant's `[request]` line (the tools it offered and
// which servers are open), each `[round]` (the calls the model made), `[opened]`, `[refused]`.
// Checks:
//
//  tools        — after the first send all three servers' tools are in vscode.lm.tools;
//  agent        — Agent (extended tier, budget 64) opens sirius-stub and sirius-mid, offers
//                 sirius-big as the group activate_sirius_big, and the echo call runs and is
//                 answered; the stub server's instructions reached the model;
//  big          — asked for the filler, the model opens the group, the next round calls
//                 mcp_sirius-big_filler_1, the round after answers;
//  again        — a follow-up in the same conversation starts with sirius-big open: its tools
//                 are offered directly, no group, and filler_1 is called in round 0;
//  stubber      — an agent the user wrote with tools: ['sirius-stub/*'] gets exactly the two
//                 stub tools, no terminal, no groups (seeded from test/harness/seeds/mcp-tools);
//  ask          — Ask keeps its read-only set: no server tool, no group;
//  core         — with qwen2.5-coder:1.5b (core tier, budget 8) sirius-stub is open and both
//                 bigger servers are groups; skipped without that Ollama model;
//  view         — what sirius-ai itself sees in vscode.lm.tools (sirius.ai.debug.extensionState),
//                 for the internal tools the state doc describes — reported, not asserted.
//
// Run through test/harness/mcp-tools.sh, which starts the stubs and seeds the profile.

const fs = require('fs');
const path = require('path');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The "Sirius AI" output channel, as the window persists it under its log folder. */
function siriusLog(context) {
	const exthost = path.dirname(context.logUri.fsPath);
	const lines = [];
	for (const dir of fs.readdirSync(exthost).filter(d => d.startsWith('output_logging_'))) {
		for (const file of fs.readdirSync(path.join(exthost, dir)).filter(f => f.endsWith('Sirius AI.log'))) {
			lines.push(...fs.readFileSync(path.join(exthost, dir, file), 'utf8').split('\n'));
		}
	}
	return lines.filter(Boolean);
}

function parseRequest(line) {
	if (!line) {
		return undefined;
	}
	return {
		mode: /mode=(\S+)/.exec(line)?.[1],
		agent: / agent=(\S+)/.exec(line)?.[1] ?? null,
		tier: /tier=(\S+)/.exec(line)?.[1],
		tools: (/tools=\d+ \(([^)]*)\)/.exec(line)?.[1] ?? '').split(',').filter(Boolean).sort(),
		external: / external (open=\[[^\]]*\] closed=\[[^\]]*\] dropped=\[[^\]]*\])/.exec(line)?.[1] ?? null,
	};
}

const ECHO = 'mcp_sirius-stub_echo';
const NOTE = 'mcp_sirius-stub_write_note';
const MID_1 = 'mcp_sirius-mid_filler_1';
const BIG_1 = 'mcp_sirius-big_filler_1';
const BIG_GROUP = 'activate_sirius_big';
const MID_GROUP = 'activate_sirius_mid';

exports.run = async function (vscode, context) {
	const failures = [];
	const check = (ok, what) => { if (!ok) { failures.push(what); } };

	const ext = vscode.extensions.getExtension('sirius.sirius-ai');
	await ext.activate();
	const ws = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const stubber = path.join(ws, '.github', 'agents', 'stubber.agent.md');
	const seeded = fs.existsSync(stubber);

	// The stub model arrives through the migrated key (seeds/provider-settings/settings.json).
	let model;
	for (let i = 0; i < 20 && !model; i++) {
		model = (await vscode.lm.selectChatModels({ vendor: 'sirius-openai' })).find(m => m.id === 'stub-model');
		if (!model) { await sleep(1000); }
	}
	if (!model) {
		return { ok: false, failures: ['no stub-model under sirius-openai — run through mcp-tools.sh'] };
	}

	const send = async (modeId, query, { fresh = true, through = model } = {}) => {
		if (fresh) {
			await vscode.commands.executeCommand('workbench.action.chat.newChat');
			await vscode.commands.executeCommand('workbench.action.chat.toggleAgentMode', { modeId });
			await sleep(500);
		}
		const before = siriusLog(context).length;
		await vscode.commands.executeCommand('workbench.action.chat.open', {
			query,
			modelSelector: { vendor: through.vendor, id: through.id },
			blockOnResponse: true
		});
		await sleep(2000);
		const lines = siriusLog(context).slice(before);
		return {
			request: parseRequest(lines.find(line => line.includes('[request] mode='))),
			enables: lines.find(line => line.includes(' enables '))?.replace(/^.*\] /, '') ?? null,
			rounds: lines.filter(line => /\[round \d+\]/.test(line)).map(line => ({
				text: Number(/text=(\d+)/.exec(line)?.[1] ?? 0),
				calls: (/calls=(\S+)/.exec(line)?.[1] ?? 'none').split(',').filter(c => c !== 'none')
			})),
			opened: lines.filter(line => line.includes('[opened]')).map(line => line.replace(/^.*\[opened\] /, '')),
			refused: lines.filter(line => line.includes('[refused]')).map(line => line.replace(/^.*\[refused\] /, '')),
			other: lines.filter(line => !/\[request\]|\[round |\[refused\]|\[opened\]| enables /.test(line)).slice(0, 20)
		};
	};
	const echoQuery = 'Echo the word marco through the stub server.';
	const fillerQuery = 'Use the big server\'s filler tool with polo.';

	// ── tools + agent ─────────────────────────────────────────────────────────
	const agent = await send('agent', echoQuery);
	const mcpTools = vscode.lm.tools.filter(t => t.name.startsWith('mcp_')).map(t => t.name).sort();
	const count = prefix => mcpTools.filter(name => name.startsWith(prefix)).length;
	check(mcpTools.includes(ECHO) && mcpTools.includes(NOTE), `tools: sirius-stub's tools are not in vscode.lm.tools (${mcpTools.filter(n => n.includes('stub')).join(', ') || 'none'})`);
	check(count('mcp_sirius-mid_') === 20 && count('mcp_sirius-big_') === 70, `tools: expected 20 mid and 70 big filler tools, found ${count('mcp_sirius-mid_')} and ${count('mcp_sirius-big_')}`);
	check(agent.request, 'agent: no request reached the Sirius participant');
	if (agent.request) {
		const offered = agent.request.tools;
		check(agent.request.tier === 'extended', `agent: tier ${agent.request.tier}`);
		check(offered.includes(ECHO) && offered.includes(NOTE), `agent: the stub tools were not offered (${offered.filter(n => n.startsWith('mcp_') || n.startsWith('activate_')).join(', ') || 'no server tool at all'})`);
		check(offered.includes(MID_1) && offered.filter(n => n.startsWith('mcp_sirius-mid_')).length === 20, 'agent: sirius-mid (20 tools) should be open on the extended tier');
		check(offered.includes(BIG_GROUP) && !offered.includes(BIG_1), `agent: sirius-big should be the group ${BIG_GROUP} (offered ${offered.filter(n => n.includes('big')).length} big names)`);
		check(agent.rounds[0]?.calls.includes(ECHO), `agent: round 0 called ${agent.rounds[0]?.calls.join(',') || 'nothing'}, not ${ECHO}`);
		check(agent.rounds.length >= 2 && agent.rounds[1].text > 0, `agent: no answer after the tool round (${JSON.stringify(agent.rounds)})`);
		check(agent.refused.length === 0, `agent: refused ${agent.refused.join('; ')}`);
	}

	// ── big + again ───────────────────────────────────────────────────────────
	const big = await send('agent', fillerQuery);
	check(big.rounds[0]?.calls.includes(BIG_GROUP), `big: round 0 called ${big.rounds[0]?.calls.join(',') || 'nothing'}, not ${BIG_GROUP}`);
	check(big.rounds[1]?.calls.includes(BIG_1), `big: round 1 called ${big.rounds[1]?.calls.join(',') || 'nothing'}, not ${BIG_1}`);
	check(big.rounds.length >= 3 && big.rounds[2].text > 0, `big: no answer after the two tool rounds (${JSON.stringify(big.rounds)})`);
	check(big.opened.some(line => line.startsWith('sirius-big')), `big: no [opened] line (${big.opened.join('; ') || 'none'})`);
	const again = await send('agent', 'Use the filler tool again.', { fresh: false });
	check(again.request?.tools.includes(BIG_1) && !again.request.tools.includes(BIG_GROUP), `again: sirius-big should be open from the start (${again.request?.external})`);
	check(again.rounds[0]?.calls.includes(BIG_1), `again: round 0 called ${again.rounds[0]?.calls.join(',') || 'nothing'}, not ${BIG_1}`);

	// ── stubber ───────────────────────────────────────────────────────────────
	let stubberSeen = null;
	if (seeded) {
		stubberSeen = await send(vscode.Uri.file(stubber).toString(), echoQuery);
		check(stubberSeen.request?.agent === 'Stubber', `stubber: arrived as ${JSON.stringify(stubberSeen.request)}`);
		if (stubberSeen.request) {
			check(JSON.stringify(stubberSeen.request.tools) === JSON.stringify([ECHO, NOTE]), `stubber: offered ${stubberSeen.request.tools.join(', ') || 'nothing'} (${stubberSeen.enables})`);
			check(stubberSeen.rounds[0]?.calls.includes(ECHO), `stubber: round 0 called ${stubberSeen.rounds[0]?.calls.join(',') || 'nothing'}, not ${ECHO}`);
		}
	}

	// ── ask ───────────────────────────────────────────────────────────────────
	const ask = await send(vscode.Uri.joinPath(ext.extensionUri, 'agents', 'ask.agent.md').toString(), echoQuery);
	check(ask.request?.agent === 'Ask', `ask: arrived as ${JSON.stringify(ask.request)}`);
	if (ask.request) {
		check(!ask.request.tools.some(n => n.startsWith('mcp_') || n.startsWith('activate_')), `ask: offered ${ask.request.tools.join(', ')}`);
	}

	// ── core ──────────────────────────────────────────────────────────────────
	const small = (await vscode.lm.selectChatModels({ vendor: 'sirius-ollama' })).find(m => m.id === 'qwen2.5-coder:1.5b');
	let core = 'skipped — no qwen2.5-coder:1.5b in Ollama';
	if (small) {
		core = await send('agent', echoQuery, { through: small });
		check(core.request?.tier === 'core', `core: tier ${core.request?.tier}`);
		if (core.request) {
			const offered = core.request.tools;
			check(offered.includes(ECHO) && offered.includes(NOTE), `core: the stub tools were not offered (${offered.join(', ')})`);
			check(offered.includes(MID_GROUP) && offered.includes(BIG_GROUP) && !offered.includes(MID_1) && !offered.includes(BIG_1), `core: both bigger servers should be groups (${core.request.external})`);
		}
	}

	// ── instructions, from the OpenAI stub's own log ──────────────────────────
	let instructions = 'skipped — no SIRIUS_PROBE_STUBLOG';
	const stubLog = process.env.SIRIUS_PROBE_STUBLOG;
	if (stubLog && fs.existsSync(stubLog)) {
		const requests = fs.readFileSync(stubLog, 'utf8').split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } })
			.filter(entry => entry && entry.tools);
		const withEcho = requests.find(entry => entry.tools.includes(ECHO));
		instructions = { requests: requests.length, echoRequestHadInstructions: withEcho?.instructions ?? null };
		check(withEcho?.instructions === true, 'instructions: the stub server\'s instructions did not reach the model with its tools');
	}

	// ── view: what sirius-ai itself sees ──────────────────────────────────────
	let view = null;
	try {
		const before = siriusLog(context).length;
		await vscode.commands.executeCommand('sirius.ai.debug.extensionState');
		await sleep(1500);
		const text = siriusLog(context).slice(before).join('\n');
		const native = /"nativeTools": \[([\s\S]*?)\]/.exec(text)?.[1] ?? '';
		const names = native.split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
		view = {
			total: names.length,
			internal: names.filter(n => /^vscode_|rtifact/.test(n)).sort(),
			probeExtensionSees: vscode.lm.tools.length
		};
	} catch (error) {
		view = { error: String(error && error.message || error) };
	}

	const windowLog = path.join(path.dirname(path.dirname(context.logUri.fsPath)), 'renderer.log');
	const rendererNotes = fs.existsSync(windowLog)
		? fs.readFileSync(windowLog, 'utf8').split('\n').filter(line => /mcp|sirius-(stub|mid|big)/i.test(line) && /warn|error|fail/i.test(line)).slice(0, 20)
		: [`no ${windowLog}`];

	return {
		ok: failures.length === 0,
		failures,
		model: `${model.vendor}/${model.id}`,
		mcpToolCount: mcpTools.length,
		agent,
		big,
		again,
		stubber: stubberSeen ?? 'skipped — run through mcp-tools.sh (SIRIUS_PROBE_SEED=test/harness/seeds/mcp-tools)',
		ask,
		core,
		instructions,
		view,
		rendererNotes
	};
};
