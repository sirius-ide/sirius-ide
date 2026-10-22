/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The hosted providers live: a real request each to Anthropic and Google Gemini through a built
// app. The keys come from outside the repository — `live-providers.sh` reads them from a file
// and hands them to the probe in the environment — and nothing here writes a key to the result
// or the log. The probe wraps the extension host's `fetch`, so it sees every request the
// providers send the way the vendor does: the URL, which header carried the key, the body's
// shape, the status answered. Checks, per provider:
//
//  group     — the key added in Manage Models becomes a group: the connection check (a GET of
//              the vendor's model list with the key in its header) answered 200, and the
//              group's models are offered under the vendor;
//  reply     — a chat request answers the word asked for; the vendor answered 200 to a request
//              carrying the key in the documented header and nowhere in the URL. The models
//              tried are the two cheapest offered (the light tiers only — never an Opus, Fable
//              or Pro model unless named), a transient answer (429, 5xx, an empty 200) is retried
//              once, and a model that fails is a finding;
//  toolCall  — offered one tool whose schema carries `$defs`, `$ref` and `additionalProperties`
//              (an MCP server's usual shape), the model calls it with the city asked for under
//              the `$ref`'d object — a LanguageModelToolCallPart through the bridge. On the wire
//              the schema arrived whole: Gemini as `parametersJsonSchema` (never `parameters`)
//              under `x-goog-api-key`; Anthropic as `input_schema` under `x-api-key` with
//              `anthropic-version`;
//  toolRound — handed the tool's result in the editor's shape (the call and its result as parts
//              of the history), the model answers in prose with what the result said — the
//              second round of an agent turn. The result records whether the provider sent
//              Gemini's function call back with its `id` and `thoughtSignature`, which Gemini 3
//              documents as required; the check is the vendor's answer, not the docs.
//
// A provider whose key is not in the environment is reported as skipped and fails the run.
// SIRIUS_PROBE_ANTHROPIC_MODELS / SIRIUS_PROBE_GEMINI_MODELS (comma-separated ids) name the
// models to try instead, in that order and no others. The result so far is written to
// <result>.partial.json after every step, progress to <result>.log, so a run the harness gives
// up on still leaves what was sent and what the vendor answered.
//
//   test/harness/live-providers.sh <app-dir>      # reads ~/.secrets/ai-keys.env and runs this

const fs = require('fs');
const path = require('path');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const OUT = process.env.SIRIUS_PROBE_OUT;
const REQUEST_TIMEOUT_MS = 90_000;
const ATTEMPTS = 2;

const PROVIDERS = [
	{
		id: 'anthropic', vendor: 'sirius-anthropic', name: 'Anthropic',
		key: process.env.SIRIUS_PROBE_ANTHROPIC_KEY || '',
		host: 'api.anthropic.com', header: 'x-api-key',
		named: process.env.SIRIUS_PROBE_ANTHROPIC_MODELS,
		prefer: ['claude-haiku-5-5', 'claude-haiku-4-5', 'claude-sonnet-5-5', 'claude-sonnet-5']
	},
	{
		id: 'gemini', vendor: 'sirius-gemini', name: 'Google Gemini',
		key: process.env.SIRIUS_PROBE_GEMINI_KEY || '',
		host: 'generativelanguage.googleapis.com', header: 'x-goog-api-key',
		named: process.env.SIRIUS_PROBE_GEMINI_MODELS,
		prefer: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash']
	}
];
const keyed = PROVIDERS.filter(p => p.key);
/** Every key value replaced, wherever a vendor or the editor might echo one. */
const redact = text => keyed.reduce((s, p) => s.split(p.key).join(`<${p.id}-key>`), String(text ?? ''));
const log = line => fs.appendFileSync(`${OUT}.log`, `${new Date().toISOString().slice(11, 19)} ${redact(line)}\n`);

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
				properties: {
					city: { type: 'string', description: 'City name' },
					country: { type: 'string', description: 'Country name' }
				},
				required: ['city'],
				additionalProperties: false
			}
		}
	}
};
const ASK_REPLY = 'Reply with the single word: pong';
const ASK_TOOL = 'What is the weather in Paris, France right now? Use the get_weather tool; do not answer without calling it.';
const TOOL_RESULT = '{"city":"Paris","condition":"sunny","temperature_c":21}';

/** JSON with every object's keys sorted, so two schemas compare by content. */
function canonical(value) {
	if (Array.isArray(value)) {
		return `[${value.map(canonical).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

// ── the wire ────────────────────────────────────────────────────────────────

function headerEntries(headers) {
	if (!headers) { return []; }
	if (typeof headers.forEach === 'function' && !Array.isArray(headers)) {
		const entries = [];
		headers.forEach((value, name) => entries.push([name, value]));
		return entries;
	}
	return Array.isArray(headers) ? headers : Object.entries(headers);
}

/**
 * Replace the providers' `fetch` with one that records each request to a hosted vendor — the
 * host, method, path, which key travelled in which header (never the key itself), the parsed
 * body, the status and, for a refusal, the vendor's error text. The response passes through
 * untouched; only a refusal's body is read, from a clone. Returns the restore function.
 */
function recordFetch(hits, providers) {
	const original = globalThis.fetch;
	const secrets = providers.filter(p => p.key);
	const hide = text => secrets.reduce((s, p) => s.split(p.key).join(`<${p.id}-key>`), String(text ?? ''));
	globalThis.fetch = async function (input, init) {
		const isRequest = typeof input === 'object' && input !== null && !(input instanceof URL);
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		let parsed;
		try { parsed = new URL(url); } catch { return original.call(this, input, init); }
		const provider = providers.find(p => p.host === parsed.host);
		if (!provider) {
			return original.call(this, input, init);
		}
		const hit = { provider: provider.id, method: (init?.method ?? (isRequest ? input.method : undefined) ?? 'GET').toUpperCase(), path: hide(parsed.pathname + parsed.search), key: 'none', keyHeader: null, keyInUrl: false, status: null, ms: 0 };
		for (const [name, value] of headerEntries(init?.headers ?? (isRequest ? input.headers : undefined))) {
			const owner = secrets.find(p => p.key === value);
			if (owner) {
				hit.key = owner.id;
				hit.keyHeader = name.toLowerCase();
			} else if (name.toLowerCase() === provider.header) {
				hit.key = 'other';
				hit.keyHeader = name.toLowerCase();
			} else if (name.toLowerCase() === 'anthropic-version') {
				hit.anthropicVersion = value;
			}
		}
		hit.keyInUrl = secrets.some(p => url.includes(p.key)) || parsed.searchParams.has('key');
		if (typeof init?.body === 'string') {
			try { hit.body = JSON.parse(init.body); } catch { hit.body = hide(init.body).slice(0, 300); }
		}
		const started = Date.now();
		try {
			const response = await original.call(this, input, init);
			hit.status = response.status;
			hit.ms = Date.now() - started;
			if (!response.ok) {
				try { hit.error = hide(await response.clone().text()).slice(0, 800); } catch { /* no body */ }
			}
			return response;
		} catch (error) {
			hit.ms = Date.now() - started;
			hit.error = hide(error && error.message || error);
			throw error;
		} finally {
			hits.push(hit);
			if (OUT) {
				log(`${provider.id}: ${hit.method} ${hit.path} key=${hit.key}${hit.keyHeader ? ` in ${hit.keyHeader}` : ''} → ${hit.status ?? 'no answer'} (${hit.ms} ms)${hit.error ? ` ${hit.error.slice(0, 120)}` : ''}`);
			}
		}
	};
	return () => { globalThis.fetch = original; };
}

/** The parts of a request worth keeping in the result. */
function describe(hit) {
	if (!hit) { return null; }
	const out = { method: hit.method, path: hit.path, key: hit.key, keyHeader: hit.keyHeader, keyInUrl: hit.keyInUrl, status: hit.status, ms: hit.ms };
	if (hit.anthropicVersion) { out.anthropicVersion = hit.anthropicVersion; }
	if (hit.error) { out.error = hit.error; }
	const body = hit.body;
	if (body && typeof body === 'object') {
		if (hit.provider === 'anthropic') {
			out.body = {
				model: body.model, max_tokens: body.max_tokens, stream: body.stream, thinking: body.thinking, output_config: body.output_config,
				temperature: body.temperature,
				turns: Array.isArray(body.messages) ? body.messages.map(m => `${m.role}: ${typeof m.content === 'string' ? 'text' : (m.content ?? []).map(b => b.type).join('+')}`) : undefined,
				system: Array.isArray(body.system) ? body.system.map(b => ({ type: b.type, chars: (b.text ?? '').length, cache_control: b.cache_control })) : body.system,
				tools: Array.isArray(body.tools) ? body.tools.map(t => ({ name: t.name, fields: Object.keys(t), input_schema: t.input_schema })) : undefined
			};
		} else {
			const declarations = body.tools?.[0]?.functionDeclarations;
			out.body = {
				turns: Array.isArray(body.contents) ? body.contents.map(c => `${c.role}: ${(c.parts ?? []).map(p => Object.keys(p).filter(k => k !== 'thoughtSignature').join('/')).join('+')}`) : undefined,
				systemInstruction: body.systemInstruction ? { parts: (body.systemInstruction.parts ?? []).length } : undefined,
				generationConfig: body.generationConfig,
				tools: Array.isArray(declarations) ? declarations.map(d => ({ name: d.name, fields: Object.keys(d), parametersJsonSchema: d.parametersJsonSchema, parameters: d.parameters })) : undefined
			};
		}
	} else if (body !== undefined) {
		out.body = body;
	}
	return out;
}

/** One line per distinct request shape, with how often it was sent. */
function tally(hits) {
	const counts = new Map();
	for (const h of hits) {
		const line = `${h.method} ${h.path} key=${h.key}${h.keyHeader ? ` in ${h.keyHeader}` : ''} → ${h.status ?? 'no answer'}`;
		counts.set(line, (counts.get(line) ?? 0) + 1);
	}
	return [...counts].map(([line, n]) => n > 1 ? `${line} ×${n}` : line);
}

// ── the models ──────────────────────────────────────────────────────────────

const word = names => new RegExp(`(^|-)(${names})(-|$)`, 'i');
/** 0 the light tier, 1 the middle, 3 the flagships; 2 anything unplaced. */
const tier = id => word('lite|haiku').test(id) ? 0 : word('flash|sonnet').test(id) ? 1 : word('fable|mythos|opus|pro').test(id) ? 3 : 2;
const NOT_CHAT = /image|tts|audio|embed|live|imagen|veo|banana/i;

/**
 * The models to try, in order. Named ids: exactly those that are offered, in that order.
 * Otherwise the preferred ids that are offered, then the rest of the light and middle tiers
 * from the cheapest-looking up — never a flagship, never a model that is not for chat — and
 * at most ATTEMPTS of them.
 */
function candidates(models, prefer, named) {
	const byId = new Map(models.map(m => [m.id, m]));
	if (named) {
		return named.split(',').map(id => byId.get(id.trim())).filter(Boolean);
	}
	const first = prefer.map(id => byId.get(id)).filter(Boolean);
	const rest = models
		.filter(m => !first.includes(m) && !NOT_CHAT.test(m.id) && tier(m.id) <= 1)
		.sort((a, b) => tier(a.id) - tier(b.id) || a.id.localeCompare(b.id));
	return [...first, ...rest].slice(0, ATTEMPTS);
}

// ── the editor ──────────────────────────────────────────────────────────────

/**
 * Send through the bridge and gather what streams back. The editor lets go of an extension's
 * own token once the request has started (only the chat's Stop reaches the provider, through
 * the participant), so a stalled stream is left behind after the timeout rather than waited for.
 */
async function send(vscode, model, messages, options) {
	const cancel = new vscode.CancellationTokenSource();
	const out = { text: '', textParts: 0, toolCalls: [], ms: 0 };
	const started = Date.now();
	const collect = (async () => {
		try {
			const response = await model.sendRequest(messages, options, cancel.token);
			for await (const part of response.stream) {
				if (part instanceof vscode.LanguageModelTextPart) {
					out.text += part.value;
					out.textParts++;
				} else if (part instanceof vscode.LanguageModelToolCallPart) {
					out.toolCalls.push({ callId: part.callId, name: part.name, input: part.input });
				}
			}
		} catch (error) {
			out.error = redact(error && error.message || error);
		}
		return 'done';
	})();
	let timer;
	const expiry = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), REQUEST_TIMEOUT_MS); });
	const outcome = await Promise.race([collect, expiry]);
	clearTimeout(timer);
	if (outcome === 'timeout') {
		cancel.cancel();
		out.error = `no answer within ${REQUEST_TIMEOUT_MS / 1000} s — the request may still be running at the vendor`;
	}
	out.ms = Date.now() - started;
	out.text = redact(out.text);
	return out;
}

const transient = (hit, reply) => !hit || hit.status === 429 || hit.status >= 500 || (hit.status === 200 && !reply.text.trim() && reply.toolCalls.length === 0);

async function exercise(vscode, context, provider, hits, save) {
	const failures = [];
	const check = (ok, what) => { if (!ok) { failures.push(`${provider.id}: ${what}`); } };
	const out = { vendor: provider.vendor };
	save(out, failures);
	if (!provider.key) {
		out.skipped = 'no key in the environment';
		check(false, 'skipped — no key in the environment');
		return { out, failures };
	}
	const posts = () => hits.filter(h => h.provider === provider.id && h.method === 'POST');
	/** The key where the docs put it and nowhere else, on every request that carried it. */
	const keyedRight = (hit, step) => {
		check(hit?.key === provider.id && hit.keyHeader === provider.header, `${step}: the request carried key=${hit?.key} in ${hit?.keyHeader}, not ${provider.header}`);
		check(hit && !hit.keyInUrl, `${step}: the key travelled in the URL`);
		if (provider.id === 'anthropic') {
			check(hit?.anthropicVersion === '2023-06-01', `${step}: anthropic-version was ${JSON.stringify(hit?.anthropicVersion)}`);
		}
	};

	// ── group ─────────────────────────────────────────────────────────────────
	log(`${provider.id}: adding the group`);
	const before = hits.length;
	try {
		await vscode.commands.executeCommand('lm.addLanguageModelsProviderGroup', { vendor: provider.vendor, name: provider.name, apiKey: provider.key });
	} catch (error) {
		out.addError = redact(error);
	}
	// Each ask resolves the group again — another listing at the vendor — so the asking stops
	// as soon as models are offered or the vendor has refused the key.
	let models = [];
	const listings = () => hits.slice(before).filter(h => h.provider === provider.id && h.method === 'GET');
	for (let i = 0; i < 15 && models.length === 0; i++) {
		await sleep(2000);
		models = await vscode.lm.selectChatModels({ vendor: provider.vendor });
		if (models.length === 0 && listings().some(h => h.status !== null && h.status !== 200)) {
			break;
		}
	}
	await sleep(2000);
	const listed = listings();
	const windowLog = path.join(path.dirname(path.dirname(context.logUri.fsPath)), 'renderer.log');
	const logged = fs.existsSync(windowLog) ? fs.readFileSync(windowLog, 'utf8').split('\n').filter(line => /rejected the API key|did not answer|answered HTTP/.test(line)).map(line => redact(line).slice(0, 300)).slice(-4) : [];
	out.group = { models: models.map(m => m.id), listings: tally(listed), firstListing: describe(listed[0]), logged };
	save(out, failures);
	log(`${provider.id}: ${models.length} models (${models.map(m => m.id).join(', ')})`);
	check(listed.length > 0, 'group: no request reached the vendor');
	check(listed.some(h => h.key === provider.id && h.keyHeader === provider.header && h.status === 200), `group: the model listing saw ${JSON.stringify(out.group.listings)}, not the key in ${provider.header} answered 200`);
	check(!listed.some(h => h.keyInUrl), 'group: the key travelled in the URL');
	check(models.length > 0, `group: no model offered under ${provider.vendor}${logged.length ? ` (${logged.join(' | ')})` : ''}`);
	if (models.length === 0) {
		return { out, failures };
	}

	// ── reply ─────────────────────────────────────────────────────────────────
	const tried = candidates(models, provider.prefer, provider.named);
	out.reply = { candidates: tried.map(m => m.id), attempts: [] };
	check(tried.length > 0, `reply: none of the models offered is one to try (${provider.named ? `named: ${provider.named}` : 'the light tiers'}); offered: ${models.map(m => m.id).join(', ')}`);
	let model;
	for (const candidate of tried) {
		for (let attempt = 0; attempt < 2 && !model; attempt++) {
			const mark = posts().length;
			log(`${provider.id}: reply via ${candidate.id}${attempt ? ' (retry)' : ''}`);
			const reply = await send(vscode, candidate, [vscode.LanguageModelChatMessage.User(ASK_REPLY)], {});
			const hit = posts().slice(mark)[0];
			out.reply.attempts.push({ model: candidate.id, text: reply.text.slice(0, 300), textParts: reply.textParts, ms: reply.ms, request: describe(hit), ...(reply.error ? { error: reply.error } : {}) });
			save(out, failures);
			log(`${provider.id}: ${candidate.id} → ${hit?.status ?? 'no request'} ${JSON.stringify(reply.text.slice(0, 80))}`);
			if (/pong/i.test(reply.text) && hit?.status === 200) {
				model = candidate;
				keyedRight(hit, 'reply');
				break;
			}
			if (attempt === 0 && transient(hit, reply)) {
				log(`${provider.id}: transient (${hit?.status ?? 'no request'}), retrying in 5 s`);
				await sleep(5000);
				continue;
			}
			check(false, `reply: ${candidate.id} answered ${hit?.status ?? 'nothing'} ${JSON.stringify((hit?.error ?? reply.error ?? reply.text).slice(0, 200))}`);
			break;
		}
	}
	out.reply.model = model?.id ?? null;
	save(out, failures);
	if (!model) {
		return { out, failures };
	}

	// ── toolCall ──────────────────────────────────────────────────────────────
	const mark = posts().length;
	log(`${provider.id}: tool call via ${model.id}`);
	const ask = vscode.LanguageModelChatMessage.User(ASK_TOOL);
	const called = await send(vscode, model, [ask], { tools: [TOOL] });
	const hit = posts().slice(mark)[0];
	out.toolCall = { model: model.id, calls: called.toolCalls, text: called.text.slice(0, 300), ms: called.ms, request: describe(hit), ...(called.error ? { error: called.error } : {}) };
	save(out, failures);
	log(`${provider.id}: tool call → ${hit?.status ?? 'no request'} ${JSON.stringify(called.toolCalls)}`);
	check(hit?.status === 200, `toolCall: the vendor answered ${hit?.status ?? 'nothing'} ${JSON.stringify((hit?.error ?? called.error ?? '').slice(0, 300))}`);
	keyedRight(hit, 'toolCall');
	const call = called.toolCalls.find(c => c.name === TOOL.name);
	check(call, `toolCall: no call to ${TOOL.name} came back (text ${JSON.stringify(called.text.slice(0, 120))})`);
	check(call && /paris/i.test(String(call.input?.location?.city)), `toolCall: the arguments were ${JSON.stringify(call?.input)}, not the city under the $ref'd location`);
	const wire = hit?.body?.tools?.[0];
	const expected = canonical(TOOL.inputSchema);
	if (provider.id === 'gemini') {
		const declaration = wire?.functionDeclarations?.[0];
		check(declaration && declaration.parametersJsonSchema && !('parameters' in declaration), `toolCall: the declaration's fields were ${JSON.stringify(declaration ? Object.keys(declaration) : null)}, not parametersJsonSchema without parameters`);
		check(canonical(declaration?.parametersJsonSchema) === expected, `toolCall: the schema on the wire was ${JSON.stringify(declaration?.parametersJsonSchema)}, not the tool's whole`);
	} else {
		check(canonical(wire?.input_schema) === expected, `toolCall: input_schema on the wire was ${JSON.stringify(wire?.input_schema)}, not the tool's whole`);
	}
	if (!call) {
		return { out, failures };
	}

	// ── toolRound ─────────────────────────────────────────────────────────────
	const history = [
		ask,
		vscode.LanguageModelChatMessage.Assistant([new vscode.LanguageModelToolCallPart(call.callId, call.name, call.input)]),
		vscode.LanguageModelChatMessage.User([new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart(TOOL_RESULT)])])
	];
	const mark2 = posts().length;
	log(`${provider.id}: tool result back via ${model.id}`);
	const answered = await send(vscode, model, history, { tools: [TOOL] });
	const hit2 = posts().slice(mark2)[0];
	out.toolRound = { model: model.id, text: answered.text.slice(0, 300), textParts: answered.textParts, toolCalls: answered.toolCalls, ms: answered.ms, request: describe(hit2), ...(answered.error ? { error: answered.error } : {}) };
	if (provider.id === 'gemini') {
		const turns = hit2?.body?.contents ?? [];
		const callPart = turns.find(t => t.role === 'model')?.parts?.find(p => p.functionCall);
		const resultPart = turns.find(t => t.role === 'user' && (t.parts ?? []).some(p => p.functionResponse))?.parts?.find(p => p.functionResponse);
		out.toolRound.wire = {
			generation: (model.id.match(/gemini-(\d+(?:\.\d+)?)/) ?? [])[1] ?? null,
			functionCall: callPart ? { fields: Object.keys(callPart), name: callPart.functionCall.name, id: callPart.functionCall.id ?? null, thoughtSignature: callPart.thoughtSignature ? `${String(callPart.thoughtSignature).length} chars` : null } : null,
			functionResponse: resultPart ? { fields: Object.keys(resultPart.functionResponse), name: resultPart.functionResponse.name, id: resultPart.functionResponse.id ?? null } : null
		};
	} else {
		const messages = hit2?.body?.messages ?? [];
		out.toolRound.wire = {
			toolUse: messages.find(m => m.role === 'assistant' && Array.isArray(m.content))?.content.find(b => b.type === 'tool_use') ?? null,
			toolResult: messages.find(m => m.role === 'user' && Array.isArray(m.content))?.content.find(b => b.type === 'tool_result') ?? null
		};
	}
	save(out, failures);
	log(`${provider.id}: tool round → ${hit2?.status ?? 'no request'} ${JSON.stringify(answered.text.slice(0, 80))}`);
	check(hit2?.status === 200, `toolRound: the vendor answered ${hit2?.status ?? 'nothing'} ${JSON.stringify((hit2?.error ?? answered.error ?? '').slice(0, 400))}`);
	keyedRight(hit2, 'toolRound');
	check(/sunny|21/i.test(answered.text), `toolRound: the answer was ${JSON.stringify(answered.text.slice(0, 200))}, not the result's weather`);
	return { out, failures };
}

/** For a check of the recorder and the model choice outside the editor. */
exports.internal = { recordFetch, describe, candidates, tally, canonical };

exports.run = async function (vscode, context) {
	await vscode.extensions.getExtension('sirius.sirius-ai').activate();
	const hits = [];
	const restore = recordFetch(hits, PROVIDERS);
	const result = { app: vscode.version, providers: {}, failures: [] };
	const save = (provider, out, failures) => {
		result.providers[provider] = out;
		result.failures = Object.values(partials).flat().concat(failures);
		result.requests = tally(hits.map(h => ({ ...h, path: `${h.provider}: ${h.path}` })));
		fs.writeFileSync(`${OUT}.partial.json`, JSON.stringify(result, null, 1));
	};
	const partials = {};
	let failures = [];
	try {
		for (const provider of PROVIDERS) {
			const run = await exercise(vscode, context, provider, hits, (out, f) => save(provider.id, out, f));
			save(provider.id, run.out, run.failures);
			partials[provider.id] = run.failures;
			failures = failures.concat(run.failures);
		}
	} finally {
		restore();
	}
	result.requests = tally(hits.map(h => ({ ...h, path: `${h.provider}: ${h.path}` })));
	result.failures = failures;
	return { ok: failures.length === 0, ...result };
};
