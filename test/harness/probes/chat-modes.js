/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Ask and Edit in the chat (hole 14): Sirius's two agents (extensions/sirius-ai/agents/*.agent.md)
// and an agent the user wrote each get exactly the tools their file allows, and their
// instructions; the built-in Agent keeps its tier's set. Every request goes through the real
// chat — switched by the agent's id with toggleAgentMode, sent with chat.open — and is read back
// from the participant's `[request]` line in the "Sirius AI" log. A model that asks for a tool
// its agent lacks is refused (docs-pass-fixes.js proves that path).
//
// Needs any local Ollama model; qwen2.5-coder:1.5b keeps it quick.

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
		instructions: Number(/ instructions=(\d+)/.exec(line)?.[1] ?? 0),
		tools: (/tools=\d+ \(([^)]*)\)/.exec(line)?.[1] ?? '').split(',').filter(Boolean).sort(),
	};
}

const READ = ['sirius_get_diagnostics', 'sirius_list_directory', 'sirius_read_file', 'sirius_search_files'];
const EDIT = ['create_file', 'edit_file'];

exports.run = async function (vscode, context) {
	const failures = [];
	const check = (ok, what) => { if (!ok) { failures.push(what); } };

	const ext = vscode.extensions.getExtension('sirius.sirius-ai');
	await ext.activate();
	const ws = vscode.workspace.workspaceFolders[0].uri.fsPath;

	// An agent the user wrote, in the project's default agents folder. The workbench finds a
	// project's agents at startup, so run.sh is given test/harness/seeds/chat-modes, which holds
	// it (SIRIUS_PROBE_SEED); without the seed this check reports itself as skipped.
	const reviewer = path.join(ws, '.github', 'agents', 'reviewer.agent.md');
	const seeded = fs.existsSync(reviewer);

	// What the workbench's prompt validator says about each agent file (unknown tool names, etc.).
	const diagnostics = {};
	for (const file of ['ask.agent.md', 'edit.agent.md']) {
		const uri = vscode.Uri.joinPath(ext.extensionUri, 'agents', file);
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: false });
		await sleep(2500);
		diagnostics[file] = vscode.languages.getDiagnostics(uri).map(d => `${d.range.start.line + 1}: ${d.message}`);
	}
	await vscode.commands.executeCommand('workbench.action.closeAllEditors');

	// What the workbench registered from extensions' `chatAgents` (and other prompt files).
	const contributed = (await vscode.commands.executeCommand('_listExtensionPromptFiles') ?? [])
		.map(file => ({ type: file.type, extensionId: file.extensionId, path: vscode.Uri.from(file.uri).path }));

	const models = (await vscode.lm.selectChatModels()).filter(m => m.vendor.startsWith('sirius-'));
	const model = models.find(m => m.vendor === 'sirius-ollama' && m.id === 'qwen2.5-coder:1.5b') ?? models[0];
	if (!model) {
		return { ok: false, failures: ['no Sirius model to send through'] };
	}

	const agents = {
		Ask: vscode.Uri.joinPath(ext.extensionUri, 'agents', 'ask.agent.md').toString(),
		Edit: vscode.Uri.joinPath(ext.extensionUri, 'agents', 'edit.agent.md').toString(),
		...(seeded ? { Reviewer: vscode.Uri.file(reviewer).toString() } : {}),
		Agent: 'agent', // the built-in mode
	};
	const seen = {};
	for (const [name, modeId] of Object.entries(agents)) {
		await vscode.commands.executeCommand('workbench.action.chat.newChat');
		await vscode.commands.executeCommand('workbench.action.chat.toggleAgentMode', { modeId });
		await sleep(500);
		const before = siriusLog(context).length;
		await vscode.commands.executeCommand('workbench.action.chat.open', {
			query: 'Say hello in one word.',
			modelSelector: { vendor: model.vendor, id: model.id },
			blockOnResponse: true
		});
		await sleep(1500);
		const lines = siriusLog(context).slice(before);
		seen[name] = parseRequest(lines.find(line => line.includes('[request] mode=')));
		if (seen[name]) {
			seen[name].enables = lines.find(line => line.includes(' enables '))?.replace(/^.*\] /, '') ?? null;
		}
		check(seen[name], `${name}: no request reached the Sirius participant`);
	}

	const same = (a, b) => JSON.stringify(a) === JSON.stringify([...b].sort());
	if (seen.Ask) {
		check(seen.Ask.agent === 'Ask' && seen.Ask.instructions > 0, `Ask: arrived as ${JSON.stringify(seen.Ask)}`);
		check(same(seen.Ask.tools, READ), `Ask: offered ${seen.Ask.tools.join(', ')}`);
	}
	if (seen.Edit) {
		check(seen.Edit.agent === 'Edit' && seen.Edit.instructions > 0, `Edit: arrived as ${JSON.stringify(seen.Edit)}`);
		check(same(seen.Edit.tools, [...READ, ...EDIT]), `Edit: offered ${seen.Edit.tools.join(', ')}`);
	}
	if (seen.Reviewer) {
		check(seen.Reviewer.agent === 'Reviewer' && seen.Reviewer.instructions > 0, `Reviewer: arrived as ${JSON.stringify(seen.Reviewer)}`);
		check(same(seen.Reviewer.tools, ['sirius_read_file']), `Reviewer: offered ${seen.Reviewer.tools.join(', ')}`);
	}
	if (seen.Agent) {
		check(seen.Agent.agent === null, `Agent: arrived as a custom agent ${seen.Agent.agent}`);
		const has = name => seen.Agent.tools.includes(name);
		check([...READ, ...EDIT, 'run_in_terminal'].every(has), `Agent: offered only ${seen.Agent.tools.join(', ')}`);
	}

	// The window's own log, for why an agent file was not turned into a mode.
	const windowLog = path.join(path.dirname(path.dirname(context.logUri.fsPath)), 'renderer.log');
	const rendererNotes = fs.existsSync(windowLog)
		? fs.readFileSync(windowLog, 'utf8').split('\n').filter(line => /agent|prompt|mode/i.test(line) && /warn|error|fail/i.test(line)).slice(0, 20)
		: [`no ${windowLog}`];
	return { ok: failures.length === 0, failures, model: `${model.vendor}/${model.id}`, userAgent: seeded ? 'checked' : 'skipped — run with SIRIUS_PROBE_SEED=test/harness/seeds/chat-modes', diagnostics, contributed, agentIds: agents, seen, rendererNotes };
};
