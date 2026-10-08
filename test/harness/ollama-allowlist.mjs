/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// A local Ollama, showing only the models named on the command line. Product screenshots are
// taken against this, so the captures show a model the reader could pull themselves rather
// than whatever happens to be installed on the machine that took them. `shown=installed`
// lists an installed model under its public name (the same weights under a local tag);
// requests naming it are mapped back. Everything else is forwarded, so completions and chat
// are real.
//
//   node test/harness/ollama-allowlist.mjs <port> <upstream> <model>[,<shown>=<installed>…]
//   node test/harness/ollama-allowlist.mjs 11435 http://127.0.0.1:11434 qwen2.5-coder:1.5b,qwen3-coder:30b=qwen3coder-agent:64k

import http from 'node:http';

const [port, upstream, models] = process.argv.slice(2);
if (!port || !upstream || !models) {
	console.error('usage: ollama-allowlist.mjs <port> <upstream> <model>[,<shown>=<installed>…]');
	process.exit(2);
}
/** installed name → name shown */
const shownAs = new Map(models.split(',').map(entry => {
	const [shown, installed = shown] = entry.split('=');
	return [installed, shown];
}));
const installedFor = new Map([...shownAs].map(([installed, shown]) => [shown, installed]));

http.createServer(async (req, res) => {
	const chunks = [];
	for await (const chunk of req) {
		chunks.push(chunk);
	}
	let body = chunks.length ? Buffer.concat(chunks) : undefined;
	if (body) {
		try {
			const json = JSON.parse(body.toString());
			for (const field of ['model', 'name']) {
				if (installedFor.has(json[field])) {
					json[field] = installedFor.get(json[field]);
				}
			}
			body = Buffer.from(JSON.stringify(json));
		} catch {
			// not JSON — forward as is
		}
	}
	try {
		const upstreamResponse = await fetch(new URL(req.url, upstream), {
			method: req.method,
			headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
			body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
		});
		if (req.url.startsWith('/api/tags')) {
			const list = await upstreamResponse.json();
			list.models = (list.models ?? [])
				.filter(m => shownAs.has(m.name))
				.map(m => ({ ...m, name: shownAs.get(m.name), model: shownAs.get(m.name) }));
			res.writeHead(upstreamResponse.status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(list));
			return;
		}
		res.writeHead(upstreamResponse.status, { 'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json' });
		for await (const chunk of upstreamResponse.body ?? []) {
			res.write(chunk);
		}
		res.end();
	} catch (error) {
		res.writeHead(502, { 'content-type': 'text/plain' });
		res.end(String(error));
	}
}).listen(Number(port), '127.0.0.1', () => console.log(`ollama-allowlist on :${port} → ${upstream}, showing ${[...shownAs.values()].join(', ')}`));
