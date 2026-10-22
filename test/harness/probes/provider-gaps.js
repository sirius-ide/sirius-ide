/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The provider gaps that need no key to be real, against stubs (hosted-stub.mjs for the
// Anthropic, Gemini and Ollama shapes; openai-stub.mjs). Checks:
//
//  anthropic — a group with the stub's Base URL: the connection check `GET /v1/models?limit=1`
//              and the listing `GET /v1/models?limit=1000`, its second page asked for with
//              `after_id`, all under `x-api-key` with `anthropic-version`; the three live stub
//              models offered under their display names with the listing's context window —
//              the retired one not;
//  shape     — one request to each stub model with thinking on and off: the adaptive model gets
//              `thinking: adaptive` + `output_config.effort`, and `disabled` with the effort
//              capped at high when off; the always-on model `adaptive` too, no `thinking` field
//              when off, and the effort stepped down to a level it has; the legacy model (an id
//              of the pre-4.6 generations) `enabled` with a budget under
//              `max_tokens` and no `output_config`, and nothing but `temperature` when off; a
//              model the listing gave no capabilities (a real id, `claude-sonnet-5-5`) is shaped
//              by its generation: `adaptive`, and `between_tools` when off; every reply "pong
//              ping";
//  gemini    — a wrong key: the stub answers Google's 400 `API_KEY_INVALID`, nothing is offered,
//              and the extension's log says "Gemini rejected the API key (HTTP 400)."; the right
//              key: the chat model offered (not the embedding one), a reply through
//              `:streamGenerateContent?alt=sse` under `x-goog-api-key`, a tool call through a
//              `$ref`'d schema sent whole as `parametersJsonSchema`, and its result handed back;
//  ollama, openai — a stub server each, added with its URL, one reply;
//  cancel    — "hold" to a model of each of the four through the chat, and the chat's Stop once
//              the stub has begun its answer: the stub sees the connection close within 3 s of
//              the Stop. Before, the bridge checked the token only between chunks and no provider
//              aborted its fetch, so the request stayed open until the stub gave up after 60 s.
//
// Progress in <result>.log, the steps so far in <result>.partial.json.
//
//   test/harness/provider-gaps.sh <app-dir>

const fs = require('fs');
const path = require('path');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const OUT = process.env.SIRIUS_PROBE_OUT;
const STUBLOG = process.env.SIRIUS_PROBE_STUBLOG;
const HOSTED = 'http://127.0.0.1:11992';
const OPENAI = 'http://127.0.0.1:11991/v1';
const KEY = 'good-key';
const CLOSE_WITHIN_MS = 3000;

const log = line => { if (OUT) { fs.appendFileSync(`${OUT}.log`, `${new Date().toISOString().slice(11, 19)} ${line}\n`); } };

/** An MCP server's usual schema shape: a `$ref` into `$defs`, `additionalProperties: false`. */
const TOOL = {
	name: 'get_weather',
	description: 'Get the current weather for a city.',
	inputSchema: {
		type: 'object',
		properties: {
			location: { $ref: '#/$defs/Location' },
			unit: { type: 'string', enum: ['celsius', 'fahrenheit'], description: 'Temperature unit' }
		},
		required: ['location'],
		additionalProperties: false,
		$defs: {
			Location: {
				type: 'object',
				properties: { city: { type: 'string', description: 'City name' }, country: { type: 'string', description: 'Country name' } },
				required: ['city'],
				additionalProperties: false
			}
		}
	}
};
const ASK_TOOL = 'What is the weather in Paris, France right now? Use the get_weather tool; do not answer without calling it.';
const TOOL_RESULT = '{"city":"Paris","condition":"sunny","temperature_c":21}';

/** JSON with every object's keys sorted, so two values compare by content. */
function canonical(value) {
	if (Array.isArray(value)) {
		return `[${value.map(canonical).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

const stubRequests = async () => (await fetch(`${HOSTED}/__requests`)).json();
const since = (requests, n) => requests.filter(r => r.n > n);
const describe = r => r ? { path: r.path, keyHeader: r.keyHeader, authorized: r.authorized, anthropicVersion: r.anthropicVersion, status: r.status } : null;

/** Lines matching `pattern` in any .log file under `root`, waiting up to `waitMs` for one. */
async function findInLogs(root, pattern, waitMs) {
	const deadline = Date.now() + waitMs;
	do {
		const hits = [];
		const walk = dir => {
			let entries = [];
			try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
			for (const entry of entries) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(full);
				} else if (entry.isFile() && entry.name.endsWith('.log')) {
					let text = '';
					try { if (fs.statSync(full).size < 5_000_000) { text = fs.readFileSync(full, 'utf8'); } } catch { continue; }
					for (const line of text.split('\n')) {
						if (pattern.test(line)) { hits.push(`${path.relative(root, full)}: ${line.trim().slice(0, 200)}`); }
					}
				}
			}
		};
		walk(root);
		if (hits.length) { return hits.slice(0, 4); }
		await sleep(1000);
	} while (Date.now() < deadline);
	return [];
}

exports.run = async function (vscode, context) {
	const failures = [];
	const check = (ok, what) => { if (!ok) { failures.push(what); } };
	const result = {};
	const save = () => { if (OUT) { fs.writeFileSync(`${OUT}.partial.json`, JSON.stringify({ ok: failures.length === 0, failures, ...result }, null, 1)); } };

	await vscode.extensions.getExtension('sirius.sirius-ai').activate();
	// <logs>/<session>/window1/exthost/<this extension> — the session's whole tree is searched.
	const logsRoot = path.dirname(path.dirname(path.dirname(context.logUri.fsPath)));
	const User = text => vscode.LanguageModelChatMessage.User(text);

	const addGroup = async configuration => {
		try {
			await vscode.commands.executeCommand('lm.addLanguageModelsProviderGroup', configuration);
			return null;
		} catch (error) {
			return String(error);
		}
	};
	/** The vendor's models once `ready` says so, asking every 2 s for up to 30 s. */
	const waitFor = async (vendor, ready) => {
		let models = [];
		for (let i = 0; i < 15 && !ready(models); i++) {
			await sleep(2000);
			models = await vscode.lm.selectChatModels({ vendor });
		}
		return models;
	};
	const mark = async () => (await stubRequests()).length;

	/** Send through the bridge and gather what streams back, for up to 30 s. */
	async function send(model, messages, options) {
		const cancel = new vscode.CancellationTokenSource();
		const startedAt = Date.now();
		const out = { text: '', parts: 0, toolCalls: [], ms: 0, ended: false };
		const collect = (async () => {
			try {
				const response = await model.sendRequest(messages, options, cancel.token);
				for await (const part of response.stream) {
					out.parts++;
					if (part instanceof vscode.LanguageModelTextPart) {
						out.text += part.value;
					} else if (part instanceof vscode.LanguageModelToolCallPart) {
						out.toolCalls.push({ callId: part.callId, name: part.name, input: part.input });
					}
				}
			} catch (error) {
				out.error = String(error && error.message || error);
			}
			out.ended = true;
		})();
		await Promise.race([collect, sleep(30000)]);
		if (!out.ended) {
			out.error = out.error ?? 'no end within 30 s';
			cancel.cancel();
		}
		out.ms = Date.now() - startedAt;
		return out;
	}

	// ── anthropic ──────────────────────────────────────────────────────────────
	let n = await mark();
	log('anthropic: adding the group');
	result.anthropic = { addError: await addGroup({ vendor: 'sirius-anthropic', name: 'Anthropic stub', apiKey: KEY, url: HOSTED }) };
	const anthropicModels = await waitFor('sirius-anthropic', models => models.length >= 4);
	await sleep(1000);
	const listings = since(await stubRequests(), n).filter(r => r.vendor === 'anthropic' && r.method === 'GET');
	result.anthropic.models = anthropicModels.map(m => ({ id: m.id, name: m.name, maxInputTokens: m.maxInputTokens }));
	result.anthropic.listings = listings.map(r => `${r.path} key=${r.keyHeader}${r.authorized ? ' ok' : ' bad'} version=${r.anthropicVersion} → ${r.status}`);
	save();
	const ids = anthropicModels.map(m => m.id).sort();
	const byId = Object.fromEntries(anthropicModels.map(m => [m.id, m]));
	log(`anthropic: ${ids.join(', ')}`);
	check(JSON.stringify(ids) === JSON.stringify(['claude-3-stub-legacy', 'claude-sonnet-5-5', 'claude-stub-adaptive', 'claude-stub-always']), `anthropic: the models offered were ${ids.join(', ')}, not the four live stub models`);
	check(byId['claude-stub-adaptive']?.name === 'Claude Stub Adaptive', `anthropic: the name was ${JSON.stringify(byId['claude-stub-adaptive']?.name)}, not the listing's display name`);
	check(byId['claude-stub-adaptive']?.maxInputTokens === 1000000 && byId['claude-3-stub-legacy']?.maxInputTokens === 200000, `anthropic: context windows ${JSON.stringify(result.anthropic.models)}, not the listing's`);
	check(listings.some(r => r.path === '/v1/models?limit=1'), `anthropic: no connection check GET /v1/models?limit=1 (${result.anthropic.listings.join(' | ')})`);
	check(listings.some(r => r.path === '/v1/models?limit=1000'), 'anthropic: no listing GET /v1/models?limit=1000');
	check(listings.some(r => r.path === '/v1/models?limit=1000&after_id=claude-stub-always'), 'anthropic: the second page was not asked for with after_id');
	check(listings.length > 0 && listings.every(r => r.keyHeader === 'x-api-key' && r.authorized && r.anthropicVersion === '2023-06-01'), 'anthropic: a listing went without the key in x-api-key, or without anthropic-version');

	// ── shape ──────────────────────────────────────────────────────────────────
	const thinkingConfig = vscode.workspace.getConfiguration('sirius.ai.thinking');
	const underMax = body => ({ type: 'enabled', budget_tokens: Math.min(16384, Math.floor((body.max_tokens ?? 0) / 2)) });
	const CASES = [
		{ model: 'claude-stub-adaptive', enabled: true, effort: 'high', expect: { thinking: { type: 'adaptive', display: 'summarized' }, effort: 'high', temperature: false } },
		{ model: 'claude-stub-adaptive', enabled: false, effort: 'xhigh', expect: { thinking: { type: 'disabled' }, effort: 'high', temperature: false } },
		{ model: 'claude-stub-always', enabled: true, effort: 'xhigh', expect: { thinking: { type: 'adaptive', display: 'summarized' }, effort: 'high', temperature: false } },
		{ model: 'claude-stub-always', enabled: false, effort: 'high', expect: { thinking: undefined, effort: 'high', temperature: false } },
		{ model: 'claude-3-stub-legacy', enabled: true, effort: 'high', expect: { thinking: underMax, effort: undefined, temperature: false } },
		{ model: 'claude-3-stub-legacy', enabled: false, effort: 'high', expect: { thinking: undefined, effort: undefined, temperature: true } },
		{ model: 'claude-sonnet-5-5', enabled: true, effort: 'high', expect: { thinking: { type: 'adaptive', display: 'summarized' }, effort: 'high', temperature: false } },
		{ model: 'claude-sonnet-5-5', enabled: false, effort: 'xhigh', expect: { thinking: { type: 'between_tools' }, effort: 'high', temperature: false } }
	];
	result.shape = [];
	for (const c of CASES) {
		const label = `shape ${c.model} thinking ${c.enabled ? 'on' : 'off'} effort ${c.effort}`;
		if (!byId[c.model]) {
			check(false, `${label}: the model is not offered`);
			continue;
		}
		await thinkingConfig.update('enabled', c.enabled, vscode.ConfigurationTarget.Global);
		await thinkingConfig.update('effort', c.effort, vscode.ConfigurationTarget.Global);
		n = await mark();
		log(label);
		const reply = await send(byId[c.model], [User('ping')], {});
		const post = since(await stubRequests(), n).find(r => r.vendor === 'anthropic' && r.method === 'POST');
		const body = post?.body ?? {};
		const seen = { thinking: body.thinking, effort: body.output_config?.effort, temperature: body.temperature !== undefined, max_tokens: body.max_tokens, stream: body.stream, model: body.model };
		const expected = { ...c.expect, thinking: typeof c.expect.thinking === 'function' ? c.expect.thinking(body) : c.expect.thinking };
		result.shape.push({ model: c.model, enabled: c.enabled, effort: c.effort, seen, expected, reply: reply.text.slice(0, 60), request: describe(post) });
		save();
		check(post, `${label}: no request reached the stub`);
		check(canonical(seen.thinking) === canonical(expected.thinking) && seen.effort === expected.effort && seen.temperature === expected.temperature,
			`${label}: sent ${JSON.stringify(seen)}, expected ${JSON.stringify(expected)}`);
		check(/^pong ping/.test(reply.text), `${label}: the reply was ${JSON.stringify(reply.text.slice(0, 80))}`);
		check(post?.keyHeader === 'x-api-key' && post.authorized && post.anthropicVersion === '2023-06-01', `${label}: the request carried the key in ${post?.keyHeader}, anthropic-version ${post?.anthropicVersion}`);
	}
	await thinkingConfig.update('enabled', undefined, vscode.ConfigurationTarget.Global);
	await thinkingConfig.update('effort', undefined, vscode.ConfigurationTarget.Global);

	// ── gemini: a wrong key ────────────────────────────────────────────────────
	n = await mark();
	log('gemini: adding a wrong key');
	result.geminiRejected = { addError: await addGroup({ vendor: 'sirius-gemini', name: 'Gemini wrong key', apiKey: 'bad-key', url: HOSTED }) };
	let refused = [];
	for (let i = 0; i < 10 && refused.length === 0; i++) {
		await sleep(2000);
		refused = since(await stubRequests(), n).filter(r => r.vendor === 'gemini' && r.method === 'GET');
	}
	const logged = await findInLogs(logsRoot, /Gemini rejected the API key \(HTTP 400\)\./, 10000);
	const rejectedModels = await vscode.lm.selectChatModels({ vendor: 'sirius-gemini' });
	Object.assign(result.geminiRejected, { listings: refused.map(describe), models: rejectedModels.map(m => m.id), logged });
	save();
	log(`gemini: wrong key → ${JSON.stringify(result.geminiRejected.listings)} logged ${logged.length}`);
	check(refused.some(r => r.path === '/v1beta/models' && r.keyHeader === 'x-goog-api-key' && r.authorized === false && r.status === 400), `gemini rejected: the stub saw ${JSON.stringify(result.geminiRejected.listings)}, not the listing refused 400 to the key in x-goog-api-key`);
	check(rejectedModels.length === 0, `gemini rejected: a wrong key offers ${rejectedModels.map(m => m.id).join(', ')}`);
	check(logged.length > 0, 'gemini rejected: no line "Gemini rejected the API key (HTTP 400)." in any log under the profile');

	// ── gemini: the right key ──────────────────────────────────────────────────
	n = await mark();
	log('gemini: adding the group');
	result.gemini = { addError: await addGroup({ vendor: 'sirius-gemini', name: 'Gemini stub', apiKey: KEY, url: HOSTED }) };
	const geminiModels = await waitFor('sirius-gemini', models => models.length >= 1);
	const flash = geminiModels.find(m => m.id === 'gemini-stub-flash');
	result.gemini.models = geminiModels.map(m => m.id);
	check(flash && geminiModels.length === 1, `gemini: offered ${result.gemini.models.join(', ')}, not gemini-stub-flash alone`);
	let call;
	if (flash) {
		n = await mark();
		const reply = await send(flash, [User('ping')], {});
		const post = since(await stubRequests(), n).find(r => r.vendor === 'gemini' && r.method === 'POST');
		result.gemini.reply = { text: reply.text.slice(0, 60), request: describe(post) };
		save();
		check(/^pong ping/.test(reply.text), `gemini: the reply was ${JSON.stringify(reply.text.slice(0, 80))}`);
		check(post?.path === '/v1beta/models/gemini-stub-flash:streamGenerateContent?alt=sse' && post.keyHeader === 'x-goog-api-key' && post.authorized, `gemini: the request was ${JSON.stringify(describe(post))}`);

		n = await mark();
		const ask = User(ASK_TOOL);
		const called = await send(flash, [ask], { tools: [TOOL] });
		const post2 = since(await stubRequests(), n).find(r => r.vendor === 'gemini' && r.method === 'POST');
		const declaration = post2?.body?.tools?.[0]?.functionDeclarations?.[0];
		call = called.toolCalls.find(c => c.name === TOOL.name);
		result.gemini.toolCall = { calls: called.toolCalls, text: called.text.slice(0, 60), declarationFields: declaration ? Object.keys(declaration) : null, request: describe(post2) };
		save();
		check(call && /paris/i.test(String(call.input?.location?.city)), `gemini toolCall: ${JSON.stringify(called.toolCalls)}, not a call with the city under the $ref'd location`);
		check(declaration && declaration.parametersJsonSchema && !('parameters' in declaration), `gemini toolCall: the declaration's fields were ${JSON.stringify(result.gemini.toolCall.declarationFields)}, not parametersJsonSchema without parameters`);
		check(declaration && canonical(declaration.parametersJsonSchema) === canonical(TOOL.inputSchema), 'gemini toolCall: the schema on the wire was not the tool\'s whole');
	}
	if (call) {
		const history = [
			User(ASK_TOOL),
			vscode.LanguageModelChatMessage.Assistant([new vscode.LanguageModelToolCallPart(call.callId, call.name, call.input)]),
			vscode.LanguageModelChatMessage.User([new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart(TOOL_RESULT)])])
		];
		n = await mark();
		const answered = await send(flash, history, { tools: [TOOL] });
		const post3 = since(await stubRequests(), n).find(r => r.vendor === 'gemini' && r.method === 'POST');
		const parts = (post3?.body?.contents ?? []).flatMap(t => (t.parts ?? []).map(p => ({ role: t.role, part: p })));
		const functionResponse = parts.find(p => p.part.functionResponse);
		result.gemini.toolRound = { text: answered.text.slice(0, 120), turns: (post3?.body?.contents ?? []).map(t => `${t.role}: ${(t.parts ?? []).map(p => Object.keys(p).join('/')).join('+')}`), functionResponse: functionResponse ? { role: functionResponse.role, name: functionResponse.part.functionResponse.name } : null };
		save();
		check(/sunny|21/.test(answered.text), `gemini toolRound: the answer was ${JSON.stringify(answered.text.slice(0, 120))}, not the result's weather`);
		check(functionResponse?.role === 'user' && functionResponse.part.functionResponse.name === TOOL.name, `gemini toolRound: the result went back as ${JSON.stringify(result.gemini.toolRound.turns)}`);
	}

	// ── ollama and openai ──────────────────────────────────────────────────────
	n = await mark();
	log('ollama: adding the stub server');
	result.ollama = { addError: await addGroup({ vendor: 'sirius-ollama', name: 'Ollama stub', url: HOSTED }) };
	const coder = (await waitFor('sirius-ollama', models => models.some(m => m.id === 'stub-coder:1b'))).find(m => m.id === 'stub-coder:1b');
	check(coder, 'ollama: stub-coder:1b is not offered under sirius-ollama');
	if (coder) {
		n = await mark();
		const reply = await send(coder, [User('ping')], {});
		const post = since(await stubRequests(), n).find(r => r.vendor === 'ollama' && r.method === 'POST' && r.path === '/api/chat');
		result.ollama.reply = { text: reply.text.slice(0, 60), request: describe(post) };
		check(/^pong ping/.test(reply.text) && post, `ollama: the reply was ${JSON.stringify(reply.text.slice(0, 80))} (${JSON.stringify(describe(post))})`);
	}
	log('openai: adding the stub server');
	result.openai = { addError: await addGroup({ vendor: 'sirius-openai', name: 'OpenAI stub', apiKey: KEY, url: OPENAI }) };
	const stubModel = (await waitFor('sirius-openai', models => models.some(m => m.id === 'stub-model'))).find(m => m.id === 'stub-model');
	check(stubModel, 'openai: stub-model is not offered under sirius-openai');
	if (stubModel) {
		const reply = await send(stubModel, [User('ping')], {});
		result.openai.reply = reply.text.slice(0, 60);
		check(/^pong ping/.test(reply.text), `openai: the reply was ${JSON.stringify(reply.text.slice(0, 80))}`);
	}
	save();

	// ── cancel ─────────────────────────────────────────────────────────────────
	// Through the chat and its Stop: an extension's own token on `sendRequest` is detached once
	// the request has started (the editor's start call returns before the stream ends), so the
	// chat's cancellation is the path a stop travels — and the one a user presses.
	result.cancel = {};
	const held = [
		{ id: 'anthropic', model: byId['claude-stub-adaptive'], vendor: 'anthropic' },
		{ id: 'gemini', model: flash, vendor: 'gemini' },
		{ id: 'ollama', model: coder, vendor: 'ollama' },
		{ id: 'openai', model: stubModel, vendor: null }
	];
	const stubLogLines = from => (STUBLOG && fs.existsSync(STUBLOG) ? fs.readFileSync(STUBLOG, 'utf8').slice(from) : '').split('\n').filter(Boolean)
		.map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
	for (const h of held) {
		if (!h.model) {
			check(false, `cancel ${h.id}: no model to send to`);
			continue;
		}
		n = await mark();
		const stubLogMark = STUBLOG && fs.existsSync(STUBLOG) ? fs.readFileSync(STUBLOG, 'utf8').length : 0;
		log(`cancel: holding ${h.id} through the chat`);
		await vscode.commands.executeCommand('workbench.action.chat.newChat');
		await sleep(300);
		const sentAt = Date.now();
		void vscode.commands.executeCommand('workbench.action.chat.open', { query: 'please hold', modelSelector: { vendor: h.model.vendor, id: h.model.id } });
		// The stub says when the hold began — the first chunk is on its way to the chat by then.
		let holdStartedAt = null;
		const heldRecord = async () => h.vendor
			? since(await stubRequests(), n).find(r => r.vendor === h.vendor && r.method === 'POST' && r.held)
			: (stubLogLines(stubLogMark).some(entry => entry.holding) ? { held: { startedAt: Date.now() } } : undefined);
		for (let i = 0; i < 100 && !holdStartedAt; i++) {
			holdStartedAt = (await heldRecord())?.held?.startedAt ?? null;
			if (!holdStartedAt) { await sleep(100); }
		}
		await sleep(500);
		const cancelledAt = Date.now();
		await vscode.commands.executeCommand('workbench.action.chat.cancel');
		let release = null;
		const deadline = Date.now() + 8000;
		while (!release && Date.now() < deadline) {
			if (h.vendor) {
				const record = await heldRecord();
				if (record?.held?.releasedAt) {
					release = { by: record.held.by, closeMs: record.held.releasedAt - cancelledAt, heldMs: record.held.releasedAt - record.held.startedAt };
				}
			} else {
				const done = stubLogLines(stubLogMark).find(entry => entry.released);
				if (done) {
					release = { by: done.released, closeMs: Date.now() - cancelledAt, heldMs: done.heldMs };
				}
			}
			if (!release) { await sleep(100); }
		}
		result.cancel[h.id] = { model: `${h.model.vendor}/${h.model.id}`, holdStartedAfterMs: holdStartedAt ? holdStartedAt - sentAt : null, cancelledAfterMs: cancelledAt - sentAt, release };
		save();
		log(`cancel: ${h.id} → ${JSON.stringify(release)}`);
		check(holdStartedAt, `cancel ${h.id}: the chat's request never reached the stub`);
		check(release?.by === 'close', `cancel ${h.id}: the stub did not see the connection close within 8 s of the chat's Stop (${JSON.stringify(release)})`);
		check(release?.by === 'close' && release.closeMs >= 0 && release.closeMs <= CLOSE_WITHIN_MS, `cancel ${h.id}: the close came ${release?.closeMs} ms after the Stop`);
	}
	await vscode.commands.executeCommand('workbench.action.chat.newChat');

	result.vendors = (vscode.extensions.getExtension('sirius.sirius-ai').packageJSON.contributes.languageModelChatProviders ?? []).map(p => p.vendor);
	check(result.vendors.length === 12, `vendors: ${result.vendors.length} declared`);
	return { ok: failures.length === 0, failures, ...result };
};
