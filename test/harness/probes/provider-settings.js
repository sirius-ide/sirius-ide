/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Provider settings (hole 10): every Sirius provider is a vendor in the editor's Language
// Models, its key in a provider group the editor keeps in the system keyring. Starts from what
// an earlier version left — an OpenAI key in settings.json, pointed at a stub — and checks:
//
//  migrated — the key is now a provider group "OpenAI" in chatLanguageModels.json, which holds
//             a secret reference rather than the key, and settings.json no longer holds it;
//  models   — that group's model is offered under the vendor sirius-openai;
//  request  — a request to it reaches the stub with the key and the endpoint (reply "pong …");
//  rejected — a provider added with a wrong key offers nothing, and the window log says why;
//  local    — with nothing configured, a running Ollama's models are still offered.
//
//   node test/harness/openai-stub.mjs 11991 good-key &
//   SIRIUS_PROBE_SETTINGS=test/harness/seeds/provider-settings/settings.json \
//     test/harness/run.sh <app> test/harness/probes/provider-settings.js <out.json>

const fs = require('fs');
const path = require('path');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const STUB = 'http://127.0.0.1:11991/v1';

exports.run = async function (vscode, context) {
	const failures = [];
	const check = (ok, what) => { if (!ok) { failures.push(what); } };
	const result = {};

	await vscode.extensions.getExtension('sirius.sirius-ai').activate();
	const userDir = path.dirname(path.dirname(context.globalStorageUri.fsPath));
	const groupsFile = path.join(userDir, 'chatLanguageModels.json');
	const readGroups = () => fs.existsSync(groupsFile) ? JSON.parse(fs.readFileSync(groupsFile, 'utf8')) : [];
	const siriusModels = async () => (await vscode.lm.selectChatModels()).filter(m => m.vendor.startsWith('sirius-'));

	// ── migrated ──────────────────────────────────────────────────────────────
	let groups = [];
	for (let i = 0; i < 20 && !groups.some(g => g.vendor === 'sirius-openai'); i++) {
		await sleep(1000);
		groups = readGroups();
	}
	const openai = groups.find(g => g.vendor === 'sirius-openai');
	const raw = fs.existsSync(groupsFile) ? fs.readFileSync(groupsFile, 'utf8') : '';
	const settings = fs.readFileSync(path.join(userDir, 'settings.json'), 'utf8');
	result.migrated = { group: openai ?? null, keyInFile: raw.includes('good-key'), keyInSettings: settings.includes('good-key') };
	check(openai?.name === 'OpenAI' && openai.url === STUB, `migrated: no OpenAI group with the stub's URL (${JSON.stringify(groups)})`);
	check(typeof openai?.apiKey === 'string' && openai.apiKey.startsWith('${input:'), `migrated: the group's apiKey is ${JSON.stringify(openai?.apiKey)}, not a secret reference`);
	check(!result.migrated.keyInFile, 'migrated: the key itself is in chatLanguageModels.json');
	check(!result.migrated.keyInSettings, 'migrated: the key is still in settings.json');

	// ── models ────────────────────────────────────────────────────────────────
	let stubModel;
	for (let i = 0; i < 10 && !stubModel; i++) {
		stubModel = (await vscode.lm.selectChatModels({ vendor: 'sirius-openai' })).find(m => m.id === 'stub-model');
		if (!stubModel) { await sleep(1000); }
	}
	result.models = (await siriusModels()).map(m => `${m.vendor}/${m.id}`);
	check(stubModel, `models: stub-model is not offered under sirius-openai (${result.models.join(', ')})`);

	// ── request ───────────────────────────────────────────────────────────────
	if (stubModel) {
		try {
			const response = await stubModel.sendRequest([vscode.LanguageModelChatMessage.User('ping')], {}, new vscode.CancellationTokenSource().token);
			let text = '';
			for await (const part of response.text) {
				text += part;
			}
			result.request = text;
			check(/^pong ping/.test(text), `request: the stub's reply was ${JSON.stringify(text)}`);
		} catch (error) {
			result.request = `error: ${error}`;
			check(false, `request: ${error}`);
		}
	}

	// ── rejected ──────────────────────────────────────────────────────────────
	try {
		await vscode.commands.executeCommand('lm.addLanguageModelsProviderGroup', { vendor: 'sirius-custom', name: 'Wrong key', url: STUB, apiKey: 'bad-key' });
	} catch (error) {
		result.addError = String(error);
	}
	await sleep(4000);
	const customModels = await vscode.lm.selectChatModels({ vendor: 'sirius-custom' });
	const windowLog = path.join(path.dirname(path.dirname(context.logUri.fsPath)), 'renderer.log');
	const logLines = fs.existsSync(windowLog) ? fs.readFileSync(windowLog, 'utf8').split('\n') : [];
	result.rejected = {
		models: customModels.map(m => m.id),
		groupAdded: readGroups().some(g => g.vendor === 'sirius-custom' && g.name === 'Wrong key'),
		logged: logLines.filter(line => /rejected the API key|did not answer/.test(line)).map(line => line.slice(0, 300)).slice(0, 4)
	};
	check(result.rejected.groupAdded, 'rejected: the provider was not added');
	check(customModels.length === 0, `rejected: a provider with a wrong key offers ${customModels.map(m => m.id).join(', ')}`);

	// ── local ─────────────────────────────────────────────────────────────────
	let ollamaUp = false;
	try {
		ollamaUp = (await fetch('http://localhost:11434/api/tags')).ok;
	} catch { /* not running */ }
	const ollamaModels = await vscode.lm.selectChatModels({ vendor: 'sirius-ollama' });
	result.local = { ollamaRunning: ollamaUp, models: ollamaModels.length };
	if (ollamaUp) {
		check(ollamaModels.length > 0, 'local: Ollama is running, but sirius-ollama offers nothing with nothing configured');
	}

	result.vendors = (vscode.extensions.getExtension('sirius.sirius-ai').packageJSON.contributes.languageModelChatProviders ?? []).map(p => p.vendor);
	check(result.vendors.length === 12, `vendors: ${result.vendors.length} declared`);

	return { ok: failures.length === 0, failures, ...result };
};
