/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// MCP servers' tools in the chat (hole 16). The profile's mcp.json names the stub MCP server
// (test/harness/mcp-stub.mjs); the OpenAI stub is the model and calls an mcp_*_echo tool
// whenever one is offered. Every request goes through the real chat and is read back from the
// "Sirius AI" log: the participant's `[request]` line (the tools it offered), each `[round]`
// (the calls the model made) and any `[refused]`. Checks:
//
//  tools   — after the first send the stub server's echo tool is in vscode.lm.tools (the
//            workbench autostarts the server when a message is sent);
//  agent   — Agent mode offers it, the model's call runs, and the next round has an answer;
//  stubber — an agent the user wrote with tools: ['sirius-stub/*'] gets the server's tools
//            and no terminal (seeded from test/harness/seeds/mcp-tools);
//  ask     — Ask keeps its read-only set: the echo tool is not offered there.
//
// Run through test/harness/mcp-tools.sh, which starts both stubs and seeds the profile.

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
	};
}

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

	const send = async (modeId, query) => {
		await vscode.commands.executeCommand('workbench.action.chat.newChat');
		await vscode.commands.executeCommand('workbench.action.chat.toggleAgentMode', { modeId });
		await sleep(500);
		const before = siriusLog(context).length;
		await vscode.commands.executeCommand('workbench.action.chat.open', {
			query,
			modelSelector: { vendor: model.vendor, id: model.id },
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
			refused: lines.filter(line => line.includes('[refused]')).map(line => line.replace(/^.*\[refused\] /, '')),
			other: lines.filter(line => !/\[request\]|\[round |\[refused\]| enables /.test(line)).slice(0, 20)
		};
	};
	const query = 'Echo the word marco through the stub server.';

	// ── agent ─────────────────────────────────────────────────────────────────
	const agent = await send('agent', query);
	const mcpTools = vscode.lm.tools.filter(t => t.name.startsWith('mcp_')).map(t => ({ name: t.name, tags: t.tags }));
	const echo = mcpTools.find(t => /_echo$/.test(t.name))?.name;
	check(echo, `tools: the stub server's echo tool is not in vscode.lm.tools (${mcpTools.map(t => t.name).join(', ') || 'no mcp_ tool at all'})`);
	check(agent.request, 'agent: no request reached the Sirius participant');
	if (agent.request && echo) {
		check(agent.request.tools.includes(echo), `agent: ${echo} was not offered (offered: ${agent.request.tools.join(', ')})`);
		check(agent.rounds[0]?.calls.includes(echo), `agent: round 0 called ${agent.rounds[0]?.calls.join(',') || 'nothing'}, not ${echo}`);
		check(agent.rounds.length >= 2 && agent.rounds[1].text > 0, `agent: no answer after the tool round (${JSON.stringify(agent.rounds)})`);
		check(agent.refused.length === 0, `agent: refused ${agent.refused.join('; ')}`);
	}

	// ── stubber ───────────────────────────────────────────────────────────────
	let stubberSeen = null;
	if (seeded) {
		stubberSeen = await send(vscode.Uri.file(stubber).toString(), query);
		check(stubberSeen.request?.agent === 'Stubber', `stubber: arrived as ${JSON.stringify(stubberSeen.request)}`);
		if (stubberSeen.request && echo) {
			check(stubberSeen.request.tools.includes(echo), `stubber: ${echo} was not offered (offered: ${stubberSeen.request.tools.join(', ') || 'nothing'}; ${stubberSeen.enables})`);
			check(!stubberSeen.request.tools.includes('run_in_terminal'), 'stubber: run_in_terminal offered though the agent did not ask for it');
			check(stubberSeen.rounds[0]?.calls.includes(echo), `stubber: round 0 called ${stubberSeen.rounds[0]?.calls.join(',') || 'nothing'}, not ${echo}`);
		}
	}

	// ── ask ───────────────────────────────────────────────────────────────────
	const ask = await send(vscode.Uri.joinPath(ext.extensionUri, 'agents', 'ask.agent.md').toString(), query);
	check(ask.request?.agent === 'Ask', `ask: arrived as ${JSON.stringify(ask.request)}`);
	if (ask.request && echo) {
		check(!ask.request.tools.includes(echo), `ask: ${echo} was offered`);
	}

	// The window's own log, for the server's start and anything it complained about.
	const windowLog = path.join(path.dirname(path.dirname(context.logUri.fsPath)), 'renderer.log');
	const rendererNotes = fs.existsSync(windowLog)
		? fs.readFileSync(windowLog, 'utf8').split('\n').filter(line => /mcp|sirius-stub/i.test(line)).slice(0, 30)
		: [`no ${windowLog}`];

	return {
		ok: failures.length === 0,
		failures,
		model: `${model.vendor}/${model.id}`,
		mcpTools,
		agent,
		stubber: stubberSeen ?? 'skipped — run through mcp-tools.sh (SIRIUS_PROBE_SEED=test/harness/seeds/mcp-tools)',
		ask,
		rendererNotes
	};
};
