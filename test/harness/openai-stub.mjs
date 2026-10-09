/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// An OpenAI-compatible server that knows one key, for probes that must not need a real one:
// GET /v1/models lists `stub-model` to that key and answers 401 to any other; POST
// /v1/chat/completions answers "pong <the last user message>", streamed or not — unless the
// request offers an MCP echo tool (a name like mcp_<server>_echo) and holds no tool result
// yet: then it calls that tool with "marco", and the round after answers "pong tool <the
// result>". Every request is printed as one JSON line, with the tool names it offered, so a
// probe can show which key, path and tools arrived.
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
	console.log(JSON.stringify({ method: req.method, url: req.url, authorized, ...(tools.length ? { tools } : {}) }));
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
		const echo = tools.find(name => /^mcp_.*_echo$/.test(name));
		const toolResult = [...(body.messages ?? [])].reverse().find(m => m.role === 'tool');
		if (echo && !toolResult) {
			const call = { id: 'call_stub_1', type: 'function', function: { name: echo, arguments: JSON.stringify({ text: 'marco' }) } };
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
		const last = [...(body.messages ?? [])].reverse().find(m => m.role === 'user');
		const text = toolResult
			? `pong tool ${typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content)}`.trim()
			: `pong ${typeof last?.content === 'string' ? last.content : ''}`.trim();
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
