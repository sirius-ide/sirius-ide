/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The hosted vendors' APIs, stubbed on one port for probes that must not need a real key:
// Anthropic's `GET /v1/models` (paged two models a page whatever `limit` says, with each
// model's `capabilities` and `lifecycle` — one model, a real id, has none, for the shaping by
// generation) and `POST /v1/messages`, the key in `x-api-key` —
// any other answered 401 as Anthropic does; Gemini's `GET /v1beta/models` and
// `:streamGenerateContent` / `:generateContent`, the key in `x-goog-api-key` — any other
// answered with Google's 400 `API_KEY_INVALID` body; and Ollama's `/api/tags`, `/api/show` and
// `/api/chat`, which take no key. A chat answers "pong <the last user text>"; one that offers
// get_weather and asks about the weather calls it with Paris; one that carries a tool result
// answers "pong tool <the result>"; one whose text says "hold" starts its answer and then
// holds the connection until the client closes it, or for 60 s — a probe reads from
// `GET /__requests` whether, and when, the client let go. Every request is recorded there and
// printed as one JSON line: the path, which header carried a key and whether it was the right
// one (never the key), the parsed body, and for a held one when and how it was released.
//
//   node test/harness/hosted-stub.mjs <port> <key>

import http from 'node:http';

const [port, key] = process.argv.slice(2);
if (!port || !key) {
	console.error('usage: hosted-stub.mjs <port> <key>');
	process.exit(2);
}

const HOLD_MS = 60_000;
const PAGE = 2;
const requests = [];

// ── the catalogue ───────────────────────────────────────────────────────────

const support = supported => ({ supported });
const capabilities = ({ adaptive, enabled, disabled, betweenTools, effort }) => ({
	image_input: support(true),
	thinking: { supported: adaptive || enabled, types: { adaptive: support(adaptive), enabled: support(enabled), disabled: support(disabled), between_tools: support(betweenTools) } },
	effort: { supported: effort.length > 0, ...Object.fromEntries(['low', 'medium', 'high', 'xhigh', 'max'].map(level => [level, support(effort.includes(level))])) }
});

/** Newest first, as Anthropic lists them; the retired one is what a listing must leave out. */
const ANTHROPIC_MODELS = [
	{ type: 'model', id: 'claude-stub-adaptive', display_name: 'Claude Stub Adaptive', line: 'opus', lifecycle: 'active', created_at: '2026-10-01T00:00:00Z', deprecated_at: null, retires_at: null, max_input_tokens: 1000000, max_tokens: 128000, capabilities: capabilities({ adaptive: true, enabled: false, disabled: true, betweenTools: true, effort: ['low', 'medium', 'high', 'xhigh', 'max'] }) },
	{ type: 'model', id: 'claude-stub-always', display_name: 'Claude Stub Always', line: 'fable', lifecycle: 'active', created_at: '2026-09-01T00:00:00Z', deprecated_at: null, retires_at: null, max_input_tokens: 1000000, max_tokens: 128000, capabilities: capabilities({ adaptive: true, enabled: false, disabled: false, betweenTools: false, effort: ['low', 'medium', 'high', 'max'] }) },
	{ type: 'model', id: 'claude-3-stub-legacy', display_name: 'Claude Stub Legacy', line: 'haiku', lifecycle: 'deprecated', created_at: '2025-10-01T00:00:00Z', deprecated_at: '2026-09-01T00:00:00Z', retires_at: '2027-01-15T00:00:00Z', max_input_tokens: 200000, max_tokens: 64000, capabilities: capabilities({ adaptive: false, enabled: true, disabled: true, betweenTools: false, effort: [] }) },
	{ type: 'model', id: 'claude-stub-retired', display_name: 'Claude Stub Retired', line: 'sonnet', lifecycle: 'retired', created_at: '2024-10-01T00:00:00Z', deprecated_at: '2025-10-01T00:00:00Z', retires_at: '2026-04-01T00:00:00Z', max_input_tokens: 200000, max_tokens: 8192, capabilities: capabilities({ adaptive: false, enabled: false, disabled: true, betweenTools: false, effort: [] }) },
	{ type: 'model', id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5 (no capabilities)', line: 'sonnet', lifecycle: 'active', created_at: '2024-09-01T00:00:00Z', deprecated_at: null, retires_at: null, max_input_tokens: 1000000, max_tokens: 128000, capabilities: null }
];

const GEMINI_MODELS = {
	models: [
		{ name: 'models/gemini-stub-flash', displayName: 'Gemini Stub Flash', description: 'The stub', inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent', 'countTokens'] },
		{ name: 'models/gemini-stub-embed', displayName: 'Gemini Stub Embedding', inputTokenLimit: 2048, outputTokenLimit: 1, supportedGenerationMethods: ['embedContent'] }
	]
};

const OLLAMA_TAGS = { models: [{ name: 'stub-coder:1b', size: 1_000_000_000, modified_at: '2026-10-01T00:00:00Z', details: { family: 'qwen2', families: ['qwen2'], parameter_size: '1B' } }] };
const OLLAMA_SHOW = { capabilities: ['completion', 'tools'], model_info: { 'qwen2.context_length': 32768 }, details: OLLAMA_TAGS.models[0].details };

const WEATHER_CALL = { name: 'get_weather', args: { location: { city: 'Paris', country: 'France' }, unit: 'celsius' } };
const GOOGLE_BAD_KEY = {
	error: {
		code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT',
		details: [
			{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com', metadata: { service: 'generativelanguage.googleapis.com' } },
			{ '@type': 'type.googleapis.com/google.rpc.LocalizedMessage', locale: 'en-US', message: 'API key not valid. Please pass a valid API key.' }
		]
	}
};

// ── what a chat asks for ────────────────────────────────────────────────────

const blockText = content => typeof content === 'string' ? content : (content ?? []).filter(b => b?.type === 'text' || typeof b?.text === 'string').map(b => b.text).join('');

/** The last user text, the names of the tools offered, and the last tool result — in each vendor's shape. */
function anthropicAsk(body) {
	const messages = body.messages ?? [];
	const last = [...messages].reverse().find(m => m.role === 'user');
	const results = messages.flatMap(m => Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_result') : []);
	const result = results.length ? blockText(results[results.length - 1].content) : undefined;
	return { text: blockText(last?.content), tools: (body.tools ?? []).map(t => t.name), result };
}
function geminiAsk(body) {
	const contents = body.contents ?? [];
	const last = [...contents].reverse().find(c => c.role === 'user' && (c.parts ?? []).some(p => typeof p.text === 'string'));
	const responses = contents.flatMap(c => (c.parts ?? []).filter(p => p.functionResponse));
	const result = responses.length ? JSON.stringify(responses[responses.length - 1].functionResponse.response?.result ?? responses[responses.length - 1].functionResponse.response) : undefined;
	return { text: (last?.parts ?? []).map(p => p.text ?? '').join(''), tools: (body.tools?.[0]?.functionDeclarations ?? []).map(d => d.name), result };
}
function ollamaAsk(body) {
	const messages = body.messages ?? [];
	const last = [...messages].reverse().find(m => m.role === 'user');
	const result = [...messages].reverse().find(m => m.role === 'tool')?.content;
	return { text: typeof last?.content === 'string' ? last.content : '', tools: (body.tools ?? []).map(t => t.function?.name), result };
}

/** What to answer: a tool call, the tool's result echoed, or pong. */
function reply(ask) {
	if (ask.result !== undefined) {
		return { text: `pong tool ${ask.result}`.trim() };
	}
	if (ask.tools.includes('get_weather') && /weather/i.test(ask.text)) {
		return { call: WEATHER_CALL };
	}
	return { text: `pong ${ask.text}`.trim(), hold: /hold/i.test(ask.text) };
}

// ── holding ─────────────────────────────────────────────────────────────────

/** Resolve when the client closes the connection, or after HOLD_MS — whichever first. */
function hold(res, record) {
	record.held = { startedAt: Date.now(), releasedAt: null, by: null };
	return new Promise(resolve => {
		let done = false;
		const release = by => {
			if (done) { return; }
			done = true;
			clearTimeout(timer);
			record.held.releasedAt = Date.now();
			record.held.by = by;
			resolve(by);
		};
		const timer = setTimeout(() => release('timeout'), HOLD_MS);
		res.on('close', () => release('close'));
	});
}

// ── the answers ─────────────────────────────────────────────────────────────

const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };

async function anthropicMessages(body, res, record) {
	const answer = reply(anthropicAsk(body));
	const text = answer.hold ? 'holding' : answer.text;
	if (!body.stream) {
		if (answer.hold) { await hold(res, record); }
		const content = answer.call
			? [{ type: 'tool_use', id: 'toolu_stub_1', name: answer.call.name, input: answer.call.args }]
			: [{ type: 'text', text }];
		json(res, 200, { id: 'msg_stub', type: 'message', role: 'assistant', model: body.model, content, stop_reason: answer.call ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 12, output_tokens: 3 } });
		return;
	}
	res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
	const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	event('message_start', { message: { id: 'msg_stub', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 12, output_tokens: 1 } } });
	if (answer.call) {
		event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_stub_1', name: answer.call.name, input: {} } });
		event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(answer.call.args) } });
	} else {
		event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
		event('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
		if (answer.hold && await hold(res, record) === 'close') {
			return;
		}
	}
	event('content_block_stop', { index: 0 });
	event('message_delta', { delta: { stop_reason: answer.call ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } });
	event('message_stop', {});
	res.end();
}

async function geminiGenerate(body, res, record, streamed) {
	const answer = reply(geminiAsk(body));
	const text = answer.hold ? 'holding' : answer.text;
	const parts = answer.call ? [{ functionCall: answer.call }] : [{ text }];
	const usage = { promptTokenCount: 12, candidatesTokenCount: 3, totalTokenCount: 15 };
	if (!streamed) {
		if (answer.hold) { await hold(res, record); }
		json(res, 200, { candidates: [{ content: { parts, role: 'model' }, finishReason: 'STOP', index: 0 }], usageMetadata: usage, modelVersion: 'stub' });
		return;
	}
	res.writeHead(200, { 'content-type': 'text/event-stream' });
	const chunk = (chunkParts, final) => res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: chunkParts, role: 'model' }, index: 0, ...(final ? { finishReason: 'STOP' } : {}) }], ...(final ? { usageMetadata: usage } : {}), modelVersion: 'stub' })}\r\n\r\n`);
	if (answer.hold) {
		chunk(parts, false);
		if (await hold(res, record) === 'close') {
			return;
		}
		chunk([{ text: '' }], true);
	} else {
		chunk(parts, true);
	}
	res.end();
}

async function ollamaChat(body, res, record) {
	const answer = reply(ollamaAsk(body));
	const text = answer.hold ? 'holding' : answer.text;
	const message = answer.call
		? { role: 'assistant', content: '', tool_calls: [{ function: { name: answer.call.name, arguments: answer.call.args } }] }
		: { role: 'assistant', content: text };
	const done = { model: body.model, created_at: new Date().toISOString(), message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 12, eval_count: 3 };
	if (body.stream === false) {
		if (answer.hold) { await hold(res, record); }
		json(res, 200, { ...done, message });
		return;
	}
	res.writeHead(200, { 'content-type': 'application/x-ndjson' });
	res.write(`${JSON.stringify({ model: body.model, created_at: new Date().toISOString(), message, done: false })}\n`);
	if (answer.hold && await hold(res, record) === 'close') {
		return;
	}
	res.end(`${JSON.stringify(done)}\n`);
}

// ── the server ──────────────────────────────────────────────────────────────

http.createServer(async (req, res) => {
	const chunks = [];
	for await (const chunk of req) {
		chunks.push(chunk);
	}
	const url = new URL(req.url, 'http://127.0.0.1');
	if (req.method === 'GET' && url.pathname === '/__requests') {
		json(res, 200, requests);
		return;
	}
	let body = null;
	try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null; } catch { body = Buffer.concat(chunks).toString().slice(0, 200); }
	const vendor = url.pathname.startsWith('/v1/') ? 'anthropic' : url.pathname.startsWith('/v1beta/') ? 'gemini' : url.pathname.startsWith('/api/') ? 'ollama' : null;
	const keyHeader = vendor === 'anthropic' ? 'x-api-key' : vendor === 'gemini' ? 'x-goog-api-key' : null;
	const record = {
		n: requests.length + 1, vendor, method: req.method, path: url.pathname + url.search,
		keyHeader: keyHeader && req.headers[keyHeader] !== undefined ? keyHeader : null,
		authorized: keyHeader ? req.headers[keyHeader] === key : null,
		anthropicVersion: req.headers['anthropic-version'] ?? null,
		body, startedAt: Date.now(), status: null
	};
	requests.push(record);
	let printed = false;
	const print = () => { if (!printed) { printed = true; record.status = res.statusCode; record.answeredAt = Date.now(); console.log(JSON.stringify(record)); } };
	res.on('finish', print);
	res.on('close', () => { if (record.held) { setImmediate(print); } });

	try {
		if (vendor === 'anthropic') {
			if (!record.authorized) {
				json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
			} else if (req.method === 'GET' && url.pathname === '/v1/models') {
				const after = url.searchParams.get('after_id');
				const start = after ? ANTHROPIC_MODELS.findIndex(m => m.id === after) + 1 : 0;
				const data = ANTHROPIC_MODELS.slice(start, start + PAGE);
				json(res, 200, { data, first_id: data[0]?.id ?? null, last_id: data[data.length - 1]?.id ?? null, has_more: start + PAGE < ANTHROPIC_MODELS.length });
			} else if (req.method === 'POST' && url.pathname === '/v1/messages') {
				await anthropicMessages(body ?? {}, res, record);
			} else {
				json(res, 404, { type: 'error', error: { type: 'not_found_error', message: `Not found: ${url.pathname}` } });
			}
		} else if (vendor === 'gemini') {
			if (!record.authorized) {
				json(res, 400, GOOGLE_BAD_KEY);
			} else if (req.method === 'GET' && url.pathname === '/v1beta/models') {
				json(res, 200, GEMINI_MODELS);
			} else if (req.method === 'POST' && /^\/v1beta\/models\/[^/:]+:(stream)?[gG]enerateContent$/.test(url.pathname)) {
				await geminiGenerate(body ?? {}, res, record, url.pathname.endsWith(':streamGenerateContent'));
			} else {
				json(res, 404, { error: { code: 404, message: `Not found: ${url.pathname}`, status: 'NOT_FOUND' } });
			}
		} else if (vendor === 'ollama') {
			if (req.method === 'GET' && url.pathname === '/api/tags') {
				json(res, 200, OLLAMA_TAGS);
			} else if (req.method === 'POST' && url.pathname === '/api/show') {
				json(res, 200, OLLAMA_SHOW);
			} else if (req.method === 'POST' && url.pathname === '/api/chat') {
				await ollamaChat(body ?? {}, res, record);
			} else {
				json(res, 404, { error: `not found: ${url.pathname}` });
			}
		} else {
			res.writeHead(404);
			res.end();
		}
	} catch (error) {
		record.error = String(error && error.message || error);
		if (!res.headersSent) {
			json(res, 500, { error: record.error });
		} else {
			res.end();
		}
	}
}).listen(Number(port), '127.0.0.1', () => console.log(JSON.stringify({ listening: Number(port) })));
