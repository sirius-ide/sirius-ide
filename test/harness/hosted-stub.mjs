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
// Thinking, on Anthropic's shape: a chat whose text says "think", on a request with thinking on,
// gets its reasoning first — a thinking block whose text arrives in pieces (slowly, 350 ms apart,
// when the text says "slow"; held after the first piece when it says "hold"), then its signature;
// two blocks when it says "two thoughts", empty text when it says "omitted", and a
// redacted_thinking block after them when it says "redacted" — and, offered sirius_list_directory
// and asked about files, calls it. Every signature names the tool set (and system prompt) it was
// made under. The next round must bring the blocks back, first in the last assistant turn,
// unchanged; the request's record says whether it did (`replay`). As Anthropic refuses them:
// with adaptive thinking, a block made under a different tool set is HTTP 400; on a thinking
// budget, a last assistant turn that does not start with its blocks is HTTP 400.
// Gemini 3's signatures, on Gemini's shape, for a chat that says "think" (Gemini 3 signs whether
// or not thoughts are asked for; the thought part comes only with thinkingConfig): the call with an
// id and a thoughtSignature on the first call of the step — "two calls" makes two, the second
// unsigned, as Gemini signs parallel calls; "split" streams them a chunk each; "no ids" leaves the
// ids off, as Gemini 2.5 does — or the text with its signature on a last, empty text part. The next
// round must bring each step's first call back signed — the stub's own signature for that step, or
// Gemini's documented skip value for a call it did not make — or it is refused with Gemini's HTTP
// 400; ids come back on the call and its response. The request's record says what came back
// (`replay`, `textSignature`).
// The agent loop: "prose call" answers with a sirius_list_directory call written as text in a
// fenced block — the call a small model writes instead of using the mechanism — and "call the
// terminal" calls run_in_terminal whether it was offered or not.
//
//   node test/harness/hosted-stub.mjs <port> <key>

import http from 'node:http';
import { createHash } from 'node:crypto';

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
const LIST_CALL = { name: 'sirius_list_directory', args: { path: '.' } };
const TERMINAL_CALL = { name: 'run_in_terminal', args: { command: 'echo stub', explanation: 'stub', isBackground: false } };
const PROSE_CALL = '```json\n' + JSON.stringify({ name: LIST_CALL.name, arguments: LIST_CALL.args }) + '\n```';
const SLOW_MS = 350;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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
	if (ask.tools.includes(LIST_CALL.name) && /\bthink\b/i.test(ask.text) && /\bfiles?\b/i.test(ask.text)) {
		return { call: LIST_CALL };
	}
	if (ask.tools.includes(LIST_CALL.name) && /\bprose call\b/i.test(ask.text)) {
		return { text: PROSE_CALL };
	}
	if (/\bcall the terminal\b/i.test(ask.text)) {
		return { call: TERMINAL_CALL };
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

// ── thinking ────────────────────────────────────────────────────────────────

/** The last user text in an Anthropic request — a tool round's last user turn holds only results. */
const promptOf = body => blockText([...(body.messages ?? [])].reverse().find(m => m.role === 'user' && blockText(m.content))?.content);
/** Whether this request gets reasoning: asked to think, with thinking on. */
const thinks = body => /\bthink\b/i.test(promptOf(body)) && ['adaptive', 'enabled'].includes(body.thinking?.type);
/** Which tool round a request is: how many tool results it carries. */
const roundOf = body => (body.messages ?? []).flatMap(m => Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_result') : []).length;
const reasoningOf = round => `Stub reasoning for round ${round}: first the files, then the answer.`;
/** What a block is bound to besides the messages: the system prompt and the set of tool names. */
const bindingOf = body => createHash('sha256').update(JSON.stringify({ system: body.system ?? null, tools: (body.tools ?? []).map(t => t.name).sort() })).digest('hex').slice(0, 12);
const signatureOf = (round, binding, part = '') => `stub-signature-${round}${part}-${binding}`;
/** The binding a block was made under, read back from its signature or data. */
const boundTo = block => /-([0-9a-f]{12})$/.exec(block?.signature ?? block?.data ?? '')?.[1];
const isReasoning = block => block?.type === 'thinking' || block?.type === 'redacted_thinking';

/** The reasoning this stub produces for a round, under a binding. */
function reasoningBlocks(body, round, binding) {
	const prompt = promptOf(body);
	const text = /\bomitted\b/i.test(prompt) ? '' : reasoningOf(round);
	const blocks = /\btwo thoughts\b/i.test(prompt)
		? [{ type: 'thinking', thinking: text.slice(0, 20), signature: signatureOf(round, binding, 'a') }, { type: 'thinking', thinking: text.slice(20), signature: signatureOf(round, binding, 'b') }]
		: [{ type: 'thinking', thinking: text, signature: signatureOf(round, binding) }];
	if (/\bredacted\b/i.test(prompt)) {
		blocks.push({ type: 'redacted_thinking', data: `stub-redacted-${round}-${binding}` });
	}
	return blocks;
}

/**
 * What came back: `kept` — the last assistant turn starts with exactly the previous round's
 * reasoning, unchanged; `stale` — reasoning anywhere made under another binding than this
 * request's; `ok` — what Anthropic would accept and the model would keep its reasoning.
 */
function replayOf(body) {
	const binding = bindingOf(body);
	const assistants = (body.messages ?? []).filter(m => m.role === 'assistant');
	const blocksOf = m => Array.isArray(m?.content) ? m.content : [];
	const last = assistants[assistants.length - 1];
	const leading = [];
	for (const block of blocksOf(last)) {
		if (!isReasoning(block)) { break; }
		leading.push(block);
	}
	const round = roundOf(body) - 1;
	const expected = leading.length ? reasoningBlocks(body, round, boundTo(leading[0])) : [];
	const kept = leading.length > 0 && JSON.stringify(leading) === JSON.stringify(expected);
	const stale = assistants.flatMap(blocksOf).filter(b => isReasoning(b) && boundTo(b) !== binding).length;
	const budget = body.thinking?.type === 'enabled';
	return { round, binding, kept, stale, ok: kept && (budget || stale === 0), leading: leading.map(b => b.type), found: blocksOf(last)[0]?.type ?? null };
}

// ── the answers ─────────────────────────────────────────────────────────────

const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };

async function anthropicMessages(body, res, record) {
	const ask = anthropicAsk(body);
	const answer = reply(ask);
	const text = answer.hold ? 'holding' : answer.text;
	const thinking = thinks(body);
	const round = roundOf(body);
	if (thinking && round > 0) {
		record.replay = replayOf(body);
		if (body.thinking.type === 'enabled' && !record.replay.kept) {
			json(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'messages: Expected `thinking` or `redacted_thinking`, but found `tool_use`. When `thinking` is enabled, a final `assistant` message must start with a thinking block.' } });
			return;
		}
		if (body.thinking.type === 'adaptive' && record.replay.stale > 0) {
			json(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'messages: Invalid `signature` in `thinking` block. The block is bound to a different conversation.' } });
			return;
		}
	}
	const reasoning = thinking ? reasoningBlocks(body, round, bindingOf(body)) : [];
	if (!body.stream) {
		if (answer.hold) { await hold(res, record); }
		const content = [
			...reasoning,
			...(answer.call
				? [{ type: 'tool_use', id: 'toolu_stub_1', name: answer.call.name, input: answer.call.args }]
				: [{ type: 'text', text }])
		];
		json(res, 200, { id: 'msg_stub', type: 'message', role: 'assistant', model: body.model, content, stop_reason: answer.call ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 12, output_tokens: 3 } });
		return;
	}
	res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
	const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	event('message_start', { message: { id: 'msg_stub', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 12, output_tokens: 1 } } });
	let index = 0;
	let held = false;
	const slow = /\bslow\b/i.test(promptOf(body));
	for (const block of reasoning) {
		if (block.type === 'redacted_thinking') {
			event('content_block_start', { index, content_block: { type: 'redacted_thinking', data: block.data } });
		} else {
			event('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } });
			const pieces = block.thinking ? block.thinking.match(/.{1,12}/gs) : [''];
			for (const [i, piece] of pieces.entries()) {
				event('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: piece } });
				if (i === 0 && answer.hold && !held) {
					held = true;
					if (await hold(res, record) === 'close') {
						return;
					}
				}
				if (slow) { await sleep(SLOW_MS); }
			}
			event('content_block_delta', { index, delta: { type: 'signature_delta', signature: block.signature } });
		}
		event('content_block_stop', { index });
		index++;
	}
	if (answer.call) {
		event('content_block_start', { index, content_block: { type: 'tool_use', id: 'toolu_stub_1', name: answer.call.name, input: {} } });
		event('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(answer.call.args) } });
	} else {
		event('content_block_start', { index, content_block: { type: 'text', text: '' } });
		event('content_block_delta', { index, delta: { type: 'text_delta', text } });
		if (answer.hold && !held && await hold(res, record) === 'close') {
			return;
		}
	}
	event('content_block_stop', { index });
	event('message_delta', { delta: { stop_reason: answer.call ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } });
	event('message_stop', {});
	res.end();
}

// ── Gemini 3's signatures ───────────────────────────────────────────────────

const SKIP_SIGNATURE = 'skip_thought_signature_validator';
const geminiThinks = (body, ask) => /\bthink\b/i.test(ask.text);
/** Which tool round a Gemini request is: how many function responses it carries. */
const geminiRoundOf = body => (body.contents ?? []).flatMap(c => (c.parts ?? []).filter(p => p.functionResponse)).length;
const geminiSignature = (round, what = 'call') => `gemini-sig-${round}-${what}`;
const geminiCallId = (round, i) => `gemini-call-${round}-${i}`;

/** What came back in the current turn: each step's first call, signed how; the ids on calls and responses. */
function geminiReplayOf(body) {
	const contents = body.contents ?? [];
	let start = 0;
	contents.forEach((c, i) => { if (c.role === 'user' && (c.parts ?? []).some(p => typeof p.text === 'string')) { start = i; } });
	const turn = contents.slice(start);
	// Step k of the current turn is the stub's round k: its first call carries that round's signature.
	const steps = turn.filter(c => c.role === 'model').map((step, k) => {
		const calls = (step.parts ?? []).filter(p => p.functionCall);
		const first = calls[0];
		const signature = !first ? 'none'
			: !first.thoughtSignature ? 'missing'
				: first.thoughtSignature === SKIP_SIGNATURE ? 'dummy'
					: first.thoughtSignature === geminiSignature(k) ? 'real' : 'wrong';
		return { name: first?.functionCall?.name ?? null, signature, callIds: calls.map(c => c.functionCall.id ?? null), signatures: calls.map(c => c.thoughtSignature ?? null) };
	});
	const responseIds = turn.flatMap(c => (c.parts ?? []).filter(p => p.functionResponse).map(p => p.functionResponse.id ?? null));
	const issuedIds = steps.flatMap(s => s.callIds).filter(id => /^gemini-call-/.test(id ?? ''));
	return { steps, responseIds, idsBack: issuedIds.every(id => responseIds.includes(id)) };
}

async function geminiGenerate(body, res, record, streamed) {
	const ask = geminiAsk(body);
	const answer = reply(ask);
	const text = answer.hold ? 'holding' : answer.text;
	const thinking = geminiThinks(body, ask);
	const round = geminiRoundOf(body);
	if (thinking) {
		const lastModel = [...(body.contents ?? [])].reverse().find(c => c.role === 'model');
		record.textSignature = (lastModel?.parts ?? []).find(p => typeof p.text === 'string')?.thoughtSignature ?? null;
	}
	if (thinking && round > 0) {
		record.replay = geminiReplayOf(body);
		const missing = record.replay.steps.findIndex(step => step.signature === 'missing');
		if (missing !== -1) {
			json(res, 400, { error: { code: 400, message: `Function call is missing a thought_signature in functionCall parts. This is required for tools to work correctly, and missing thought_signature may lead to degraded model performance. Additional data, function call \`default_api:${record.replay.steps[missing].name}\` , position ${missing + 2}. Please refer to https://ai.google.dev/gemini-api/docs/thought-signatures for more details.`, status: 'INVALID_ARGUMENT' } });
			return;
		}
		if (record.replay.steps.some(step => step.signature === 'wrong')) {
			json(res, 400, { error: { code: 400, message: 'Thought signature is not valid.', status: 'INVALID_ARGUMENT' } });
			return;
		}
	}
	const calls = !answer.call ? [] : /\btwo calls|\bsplit\b/i.test(ask.text) ? [answer.call, answer.call] : [answer.call];
	const ids = thinking && !/\bno ids\b/i.test(ask.text);
	const thought = thinking && body.generationConfig?.thinkingConfig ? [{ thought: true, text: reasoningOf(round) }] : [];
	const callParts = calls.map((call, i) => ({ functionCall: { ...(ids ? { id: geminiCallId(round, i) } : {}), name: call.name, args: call.args }, ...(thinking && i === 0 ? { thoughtSignature: geminiSignature(round) } : {}) }));
	const parts = [
		...thought,
		...(answer.call ? callParts : [{ text, ...(thinking && !streamed ? { thoughtSignature: geminiSignature(round, 'text') } : {}) }])
	];
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
	} else if (answer.call && callParts.length > 1 && /\bsplit\b/i.test(ask.text)) {
		// As Gemini may stream a parallel step: a call a chunk.
		chunk([...thought, callParts[0]], false);
		chunk(callParts.slice(1), true);
	} else if (thinking && !answer.call) {
		// As Gemini streams it: the answer, then its signature on a last part with no text.
		chunk(parts, false);
		chunk([{ text: '', thoughtSignature: geminiSignature(round, 'text') }], true);
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
