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
// group's description does that). A tool is called once per request;
// once a tool result is in the messages the answer is "pong tool <the last result>". Every
// request is printed as one JSON line with the tool names it offered and whether any message
// carries STUB-INSTRUCTIONS (the stub MCP server's instructions), so a probe can show which
// key, path, tools and instructions arrived.
//
//   node test/harness/openai-stub.mjs <port> <key>

import http from 'node:http';

const [port, key] = process.argv.slice(2);
if (!port || !key) {
	console.error('usage: openai-stub.mjs <port> <key>');
	process.exit(2);
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
	console.log(JSON.stringify({ method: req.method, url: req.url, authorized, ...(tools.length ? { tools, instructions } : {}) }));
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
		const messages = body.messages ?? [];
		const last = [...messages].reverse().find(m => m.role === 'user');
		const task = typeof last?.content === 'string' ? last.content : '';
		const called = new Set(messages.flatMap(m => (m.tool_calls ?? []).map(c => c.function?.name)));
		const wanted = /directly/i.test(task) ? []
			: /filler/i.test(task) ? [/^mcp_.*big.*_filler_1$/, /^activate_.*big/]
				: /echo/i.test(task) ? [/^mcp_.*_echo$/] : [];
		const toolResult = [...messages].reverse().find(m => m.role === 'tool');
		const direct = /directly/i.test(task) && !called.has('mcp_sirius-big_filler_2') ? 'mcp_sirius-big_filler_2' : undefined;
		const next = direct ?? wanted.map(pattern => tools.find(name => pattern.test(name) && !called.has(name))).find(Boolean);
		if (next) {
			const args = next.startsWith('activate_') ? {} : { text: /echo/i.test(task) ? 'marco' : 'polo' };
			const call = { id: `call_stub_${called.size + 1}`, type: 'function', function: { name: next, arguments: JSON.stringify(args) } };
			if (body.stream) {
				res.writeHead(200, { 'content-type': 'text/event-stream' });
				res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, ...call }] } }] })}\n\n`);
				res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
				res.end('data: [DONE]\n\n');
			} else {
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [call] }, finish_reason: 'tool_calls' }] }));
			}
			return;
		}
		const text = toolResult
			? `pong tool ${typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content)}`.trim()
			: `pong ${task}`.trim();
		if (body.stream) {
			res.writeHead(200, { 'content-type': 'text/event-stream' });
			res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: text } }] })}\n\n`);
			res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
			res.end('data: [DONE]\n\n');
		} else {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] }));
		}
		return;
	}
	res.writeHead(404);
	res.end();
}).listen(Number(port), '127.0.0.1', () => console.log(JSON.stringify({ listening: Number(port) })));
