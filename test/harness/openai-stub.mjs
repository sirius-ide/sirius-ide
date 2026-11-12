/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// An OpenAI-compatible server that knows one key, for probes that must not need a real one:
// GET /v1/models lists `stub-model` to that key and answers 401 to any other; POST
// /v1/chat/completions answers "pong <the last user message>", streamed or not — unless the
// message is a task it knows: one that says "echo" calls an offered mcp_*_echo tool with
// "marco"; one that says "filler" calls the big server's mcp_*big*_filler_1 with "polo", or,
// when only its group tool activate_*big* is offered, that first; one that says "directly"
// calls mcp_sirius-big_filler_2 by name whether or not it was offered (a model reading the
// group's description does that). A tool is called once per question; once the current question
// (what came after the last user message) has a tool result, the answer is "pong tool <that
// result>". Every
// request is printed as one JSON line with the tool names it offered and whether any message
// carries STUB-INSTRUCTIONS (the stub MCP server's instructions), so a probe can show which
// key, path, tools and instructions arrived. A message that says "hold" is answered with a
// first chunk and then held — the connection stays open until the client closes it, or for
// 60 s — a line `{"holding":…}` says the hold began and `{"held":…,"released":"close"|"timeout",
// "heldMs":…}` how it ended, so a probe can show that a stopped request ended at the server.
// Usage, as OpenAI gives it: an unstreamed answer carries it; a streamed one ends with a chunk of
// no choices and the usage (12 in, 3 out) only when the request asked with
// `stream_options.include_usage` — the request's line says whether it did (`streamUsage`), and
// which question it carried (`ask`, the last user message's first 80 characters). As OpenAI does, a
// request whose tool call has no result after it is refused with a 400; "null args" calls
// sirius_list_directory, when offered, with the arguments `null`, and "odd ids" calls it under an
// id as Kimi K2 names its calls, `functions.sirius_list_directory:0`. Each request's line carries
// the first six characters of the key it was sent (`bearer`), so a probe can see whose key came.
//
//   node test/harness/openai-stub.mjs <port> <key>

import http from 'node:http';

const [port, key] = process.argv.slice(2);
if (!port || !key) {
	console.error('usage: openai-stub.mjs <port> <key>');
	process.exit(2);
}

const HOLD_MS = 60_000;

/** Resolve when the client closes the connection, or after HOLD_MS — whichever first. */
function hold(res, task) {
	const started = Date.now();
	console.log(JSON.stringify({ holding: task }));
	return new Promise(resolve => {
		let done = false;
		const release = by => {
			if (done) { return; }
			done = true;
			clearTimeout(timer);
			console.log(JSON.stringify({ held: task, released: by, heldMs: Date.now() - started }));
			resolve(by);
		};
		const timer = setTimeout(() => release('timeout'), HOLD_MS);
		res.on('close', () => release('close'));
	});
}

http.createServer(async (req, res) => {
	const chunks = [];
	for await (const chunk of req) {
		chunks.push(chunk);
	}
	const authorized = req.headers.authorization === `Bearer ${key}`;
	const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
	const tools = (body.tools ?? []).map(t => t.function?.name).filter(Boolean);
	const instructions = (body.messages ?? []).some(m => typeof m.content === 'string' && m.content.includes('STUB-INSTRUCTIONS'));
	const asked = [...(body.messages ?? [])].reverse().find(m => m.role === 'user');
	console.log(JSON.stringify({ method: req.method, url: req.url, authorized, bearer: (req.headers.authorization ?? '').replace(/^Bearer /, '').slice(0, 6), ...(tools.length ? { tools, instructions } : {}), ...(body.stream ? { streamUsage: body.stream_options?.include_usage === true } : {}), ...(typeof asked?.content === 'string' ? { ask: asked.content.slice(0, 80) } : {}) }));
	if (!authorized) {
		res.writeHead(401, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
		return;
	}
	if (req.method === 'GET' && req.url === '/v1/models') {
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ object: 'list', data: [{ id: 'stub-model', object: 'model' }] }));
		return;
	}
	if (req.method === 'POST' && req.url === '/v1/chat/completions') {
		const usage = { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 };
		const end = () => {
			if (body.stream_options?.include_usage === true) {
				res.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
			}
			res.end('data: [DONE]\n\n');
		};
		const messages = body.messages ?? [];
		const unanswered = new Set();
		for (const m of messages) {
			if (m.role === 'tool') {
				unanswered.delete(m.tool_call_id);
			} else if (unanswered.size) {
				break;
			} else if (m.role === 'assistant') {
				for (const c of m.tool_calls ?? []) {
					unanswered.add(c.id);
				}
			}
		}
		if (unanswered.size) {
			console.log(JSON.stringify({ refused: [...unanswered] }));
			res.writeHead(400, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ error: { message: `An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. The following tool_call_ids did not have response messages: ${[...unanswered].join(', ')}`, type: 'invalid_request_error', param: 'messages', code: null } }));
			return;
		}
		// The current question: the last user message, and what came after it.
		const at = messages.map(m => m.role).lastIndexOf('user');
		const last = messages[at];
		const current = messages.slice(at + 1);
		const task = typeof last?.content === 'string' ? last.content : '';
		const called = new Set(current.flatMap(m => (m.tool_calls ?? []).map(c => c.function?.name)));
		const wanted = /directly/i.test(task) ? []
			: /filler/i.test(task) ? [/^mcp_.*big.*_filler_1$/, /^activate_.*big/]
				: /echo/i.test(task) ? [/^mcp_.*_echo$/] : [];
		const toolResult = [...current].reverse().find(m => m.role === 'tool');
		const direct = /directly/i.test(task) && !called.has('mcp_sirius-big_filler_2') ? 'mcp_sirius-big_filler_2' : undefined;
		const nullArgs = /\b(null args|odd ids)\b/i.test(task) && !toolResult && tools.includes('sirius_list_directory') ? 'sirius_list_directory' : undefined;
		const next = nullArgs ?? direct ?? wanted.map(pattern => tools.find(name => pattern.test(name) && !called.has(name))).find(Boolean);
		if (next) {
			const args = next.startsWith('activate_') ? {} : { text: /echo/i.test(task) ? 'marco' : 'polo' };
			const call = { id: /\bodd ids\b/i.test(task) ? `functions.${next}:0` : `call_stub_${called.size + 1}`, type: 'function', function: { name: next, arguments: /\bnull args\b/i.test(task) ? 'null' : JSON.stringify(args) } };
			if (body.stream) {
				res.writeHead(200, { 'content-type': 'text/event-stream' });
				res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, ...call }] } }] })}\n\n`);
				res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
				end();
			} else {
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [call] }, finish_reason: 'tool_calls' }], usage }));
			}
			return;
		}
		const holding = /hold/i.test(task) && !toolResult;
		const text = toolResult
			? `pong tool ${typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content)}`.trim()
			: holding ? 'holding' : `pong ${task}`.trim();
		if (body.stream) {
			res.writeHead(200, { 'content-type': 'text/event-stream' });
			res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: text } }] })}\n\n`);
			if (holding && await hold(res, task) === 'close') {
				return;
			}
			res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
			end();
		} else {
			if (holding) {
				await hold(res, task);
			}
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage }));
		}
		return;
	}
	res.writeHead(404);
	res.end();
}).listen(Number(port), '127.0.0.1', () => console.log(JSON.stringify({ listening: Number(port) })));
