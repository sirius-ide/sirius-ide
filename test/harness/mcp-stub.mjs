/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The smallest MCP server that matters: stdio, newline-delimited JSON-RPC, two tools.
// `echo` is read-only (no approval needed) and answers "echo:<text>"; `write_note` is not
// (the editor asks before running it) and answers "write_note:<text>". The server's
// instructions carry a marker, so a probe can see whether they reached the model.
//
//   { "servers": { "sirius-stub": { "type": "stdio", "command": "node",
//                                   "args": ["test/harness/mcp-stub.mjs"] } } }
//
// `--tools N` makes it a server of N filler tools instead (filler_1 … filler_N, each answering
// "filler:<n>:<text>"), for a server bigger than a model's budget.

import readline from 'node:readline';

const fillers = Number(process.argv[process.argv.indexOf('--tools') + 1] || 0);

const TOOLS = process.argv.includes('--tools') ? Array.from({ length: fillers }, (_, i) => ({
	name: `filler_${i + 1}`,
	description: `Filler tool ${i + 1}. Returns "filler:${i + 1}:<text>".`,
	inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
	annotations: { readOnlyHint: true }
})) : [
	{
		name: 'echo',
		description: 'Returns the text it is given, as "echo:<text>".',
		inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'The text to echo.' } }, required: ['text'] },
		annotations: { readOnlyHint: true }
	},
	{
		name: 'write_note',
		description: 'Keeps a note. Returns what it kept, as "write_note:<text>".',
		inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'The note.' } }, required: ['text'] }
	}
];

const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

readline.createInterface({ input: process.stdin }).on('line', line => {
	let message;
	try {
		message = JSON.parse(line);
	} catch {
		return;
	}
	const { id, method, params } = message;
	process.stderr.write(`mcp-stub: ${method}\n`);
	switch (method) {
		case 'initialize':
			reply(id, {
				protocolVersion: params?.protocolVersion ?? '2025-06-18',
				capabilities: { tools: {} },
				serverInfo: { name: 'sirius-stub', version: '0.0.1' },
				instructions: 'STUB-INSTRUCTIONS: when asked to echo something, call echo with it.'
			});
			return;
		case 'ping':
			reply(id, {});
			return;
		case 'tools/list':
			reply(id, { tools: TOOLS });
			return;
		case 'tools/call': {
			const tool = TOOLS.find(t => t.name === params?.name);
			if (!tool) {
				fail(id, -32602, `unknown tool ${params?.name}`);
				return;
			}
			const filler = /^filler_(\d+)$/.exec(tool.name);
			reply(id, { content: [{ type: 'text', text: `${filler ? `filler:${filler[1]}` : tool.name}:${params?.arguments?.text ?? ''}` }] });
			return;
		}
		default:
			if (id !== undefined) {
				fail(id, -32601, `unknown method ${method}`);
			}
	}
});
