/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Proves, live, the fixes for what the 2026-10-01 docs pass found in sirius-ai.
// It reports what it measured rather than failing on the first surprise, so the
// same probe runs against the released bundle (before) and the fixed one (after):
//
//  tools       — `sirius_search_web` (opened Google in the user's browser and
//                handed the model a URL, never results) is no longer offered.
//  keybindings — the extension contributes none; its three shadowed Problems
//                (Ctrl+Shift+M), Reopen Closed Editor (Ctrl+Shift+T) and Open
//                Chat (Agent) (Ctrl+Shift+I).
//  llamacpp    — with `sirius.ai.llamacpp.baseUrl` at its `/v1` default, Tab
//                completion calls llama-server's native `/infill` at the server
//                root (a stub records the requests), not `/v1/infill`.
//  commitModel — `sirius.ai.generateCommitMessage` runs on `sirius.ai.defaultModel`
//                (Ollama's /api/ps shows which model it loaded), not on the first
//                model in provider order.
//  vision      — a PNG attached to a chat request reaches a vision model through
//                the Sirius participant (the reply names its colour), and the
//                model's thinking is rendered (the participant logs its length).
//  createFile  — a file created by the agent is an entry of the editing session:
//                rejecting it removes the file, rather than leaving an empty one.
//  confinement — the read tool refuses paths outside the workspace (`..` walked
//                out before), and still takes absolute paths inside it.
//  askMode     — Ask offers only the read-only tools (it ran a terminal command
//                in 1.118.7, when one participant served all three modes).
//
// Needs a local Ollama with a model reporting tools + thinking + vision under the
// provider's 12 GB load limit (Qwen3.5-9B on the probe machine), and one more
// small model for the commit-message check.

const fs = require('fs');
const path = require('path');
const http = require('http');
const cp = require('child_process');
const zlib = require('zlib');

const OLLAMA = 'http://localhost:11434';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function ollama(pathname, body) {
	const response = await fetch(`${OLLAMA}${pathname}`, body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
	return response.json();
}

/** A solid-colour PNG, encoded by hand so the probe needs no image library. */
function solidPng(size, [r, g, b]) {
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		return c >>> 0;
	});
	const crc = buf => {
		let c = 0xffffffff;
		for (const byte of buf) {
			c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
		}
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type), data]);
		const sum = Buffer.alloc(4);
		sum.writeUInt32BE(crc(body));
		return Buffer.concat([len, body, sum]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // truecolour
	const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).fill(Buffer.from([r, g, b]))]);
	const raw = Buffer.concat(Array.from({ length: size }, () => row));
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0))
	]);
}

/** The "Sirius AI" output channel, as the window persists it under its log folder. */
function siriusLog(context) {
	const exthost = path.dirname(context.logUri.fsPath);
	const lines = [];
	for (const dir of fs.readdirSync(exthost).filter(d => d.startsWith('output_logging_'))) {
		for (const file of fs.readdirSync(path.join(exthost, dir)).filter(f => f.endsWith('Sirius AI.log'))) {
			lines.push(...fs.readFileSync(path.join(exthost, dir, file), 'utf8').split('\n'));
		}
	}
	return lines.filter(Boolean);
}

/** Each check records its own failure, so one surprise does not hide the rest. */
async function section(result, name, fn) {
	try {
		await fn();
	} catch (error) {
		result[name] = { ...(result[name] ?? {}), error: String(error && error.message || error) };
	}
}

async function transcript(vscode) {
	await vscode.env.clipboard.writeText('');
	await vscode.commands.executeCommand('workbench.action.chat.copyAll');
	return vscode.env.clipboard.readText();
}

exports.run = async function (vscode, context) {
	const ws = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const global = vscode.ConfigurationTarget.Global;
	const result = {};
	const extension = vscode.extensions.getExtension('sirius.sirius-ai');
	result.extension = { version: extension?.packageJSON?.version, description: extension?.packageJSON?.description };

	// ── tools ────────────────────────────────────────────────────────────────
	const toolNames = vscode.lm.tools.map(t => t.name);
	result.tools = {
		siriusTools: toolNames.filter(n => n.startsWith('sirius_')).sort(),
		searchWebOffered: toolNames.includes('sirius_search_web'),
		total: toolNames.length
	};

	// ── keybindings ──────────────────────────────────────────────────────────
	result.keybindings = (extension?.packageJSON?.contributes?.keybindings ?? []).map(k => `${k.key} → ${k.command}`);

	// ── confinement: the read tool stays inside the workspace ────────────────
	await section(result, 'confinement', async () => {
		fs.writeFileSync(path.join(ws, 'inside.txt'), 'inside the workspace');
		const read = async p => {
			const r = await vscode.lm.invokeTool('sirius_read_file', { input: { path: p }, toolInvocationToken: undefined });
			return r.content.map(c => c.value ?? '').join('').slice(0, 160);
		};
		result.confinement = {
			relative: await read('inside.txt'),
			absoluteInside: await read(path.join(ws, 'inside.txt')),
			traversal: await read('../../../../../../etc/hostname'),
			absoluteOutside: await read('/etc/hostname')
		};
	});

	// ── llamacpp: Tab completion against a stub llama-server ─────────────────
	await section(result, 'llamacpp', async () => {
		const hits = [];
		const server = http.createServer((req, res) => {
			let body = '';
			req.on('data', d => { body += d; });
			req.on('end', () => {
				hits.push({ method: req.method, url: req.url });
				if (req.method === 'POST' && req.url === '/infill') {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ content: 'return 42;' }));
				} else {
					res.writeHead(404);
					res.end();
				}
			});
		});
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		const port = server.address().port;
		await vscode.workspace.getConfiguration('sirius.ai.llamacpp').update('baseUrl', `http://127.0.0.1:${port}/v1`, global);
		await vscode.workspace.getConfiguration('sirius.ai').update('completions.model', 'llamacpp', global);
		await vscode.workspace.getConfiguration('sirius.ai').update('enable', { '*': true }, global);
		await vscode.workspace.getConfiguration('editor').update('inlineSuggest.enabled', true, global);

		const file = path.join(ws, 'tab.js');
		fs.writeFileSync(file, 'function answer() {\n\t\n}\n');
		const editor = await vscode.window.showTextDocument(vscode.Uri.file(file));
		editor.selection = new vscode.Selection(1, 1, 1, 1);
		for (let attempt = 0; attempt < 4 && !hits.some(h => h.url.endsWith('/infill')); attempt++) {
			await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
			await sleep(2500);
		}
		server.close();
		result.llamacpp = {
			baseUrl: `http://127.0.0.1:${port}/v1`,
			requests: hits.map(h => `${h.method} ${h.url}`),
			infillAtRoot: hits.some(h => h.method === 'POST' && h.url === '/infill'),
			infillUnderV1: hits.some(h => h.url === '/v1/infill')
		};
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	// ── commitModel: the commit message runs on sirius.ai.defaultModel ───────
	const models = await vscode.lm.selectChatModels({ vendor: 'sirius' });
	await section(result, 'commitModel', async () => {
		const tiers = await vscode.commands.executeCommand('sirius.ai.debug.toolTier');
		const small = tiers.filter(t => t.id.startsWith('ollama/') && t.sizeBytes && t.sizeBytes < 8e9).sort((a, b) => a.sizeBytes - b.sizeBytes);
		const target = small.find(t => t.id !== models[0]?.id);
		if (!target) {
			result.commitModel = { skipped: 'no small Ollama model other than the first', models: models.map(m => m.id) };
		} else {
			const wanted = target.id.slice('ollama/'.length);
			await vscode.workspace.getConfiguration('sirius.ai').update('defaultModel', wanted, global);
			for (const loaded of (await ollama('/api/ps')).models ?? []) {
				await ollama('/api/generate', { model: loaded.name, keep_alive: 0 });
			}

			const git = (...args) => cp.execFileSync('git', args, { cwd: ws, encoding: 'utf8' });
			git('init', '-q');
			git('config', 'user.email', 'probe@example.invalid');
			git('config', 'user.name', 'probe');
			fs.writeFileSync(path.join(ws, 'greet.js'), 'export function greet(name) {\n\treturn `Hello, ${name}!`;\n}\n');
			git('add', 'greet.js');
			const gitApi = (await vscode.extensions.getExtension('vscode.git').activate()).getAPI(1);
			for (let i = 0; i < 20 && gitApi.repositories.length === 0; i++) {
				await sleep(500);
			}
			result.commitModel = { firstInProviderOrder: models[0]?.id, defaultModel: wanted };
			await vscode.commands.executeCommand('sirius.ai.generateCommitMessage');
			const loaded = ((await ollama('/api/ps')).models ?? []).map(m => m.name);
			result.commitModel = {
				firstInProviderOrder: models[0]?.id,
				defaultModel: wanted,
				loadedAfter: loaded,
				usedDefault: loaded.includes(wanted),
				message: gitApi.repositories[0]?.inputBox.value ?? null
			};
		}
	});

	// ── vision + thinking through the Sirius participant ─────────────────────
	const tiers = await vscode.commands.executeCommand('sirius.ai.debug.toolTier');
	const preferred = 'ollama/hf.co/HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive:Q4_K_M';
	const agentModel = models.find(m => m.id === preferred)?.id;
	result.agentModel = agentModel ?? null;
	if (!agentModel) {
		result.vision = result.createFile = { skipped: `${preferred} is not available`, models: models.map(m => m.id), tiers };
		return result;
	}
	await section(result, 'vision', async () => {
		fs.writeFileSync(path.join(ws, 'swatch.png'), solidPng(64, [220, 20, 20]));
		const before = siriusLog(context).length;
		await vscode.commands.executeCommand('workbench.action.chat.newChat');
		// `chat.open` does not await `addFile`, and an image attaches
		// asynchronously (it is decoded and resized first), so attaching and
		// submitting in one call races the image. Attach, let it land, then send —
		// the order a user's paste-then-Enter has anyway.
		await vscode.commands.executeCommand('workbench.action.chat.open', {
			query: '',
			isPartialQuery: true,
			attachFiles: [vscode.Uri.file(path.join(ws, 'swatch.png'))],
			mode: 'ask',
			modelSelector: { vendor: 'sirius', id: agentModel }
		});
		await sleep(3000);
		await vscode.commands.executeCommand('workbench.action.chat.open', {
			query: 'What single colour fills the attached image? Answer with one word.',
			mode: 'ask',
			modelSelector: { vendor: 'sirius', id: agentModel },
			blockOnResponse: true
		});
		const text = await transcript(vscode);
		const log = siriusLog(context).slice(before);
		const thinking = log.map(l => /thinking=(\d+)/.exec(l)).filter(Boolean).map(m => Number(m[1]));
		const request = log.find(l => l.includes('[request] mode=') || (l.includes('[request] model=')));
		result.askMode = {
			request: request ?? null,
			toolCalls: log.map(l => /calls=([^ ]+)/.exec(l)?.[1]).filter(c => c && c !== 'none')
		};
		result.vision = {
			transcriptTail: text.slice(-400),
			saysRed: /\bred\b/i.test(text.split('swatch.png').pop() ?? text),
			log: log.filter(l => l.includes('[request]') || l.includes('[round')),
			references: log.filter(l => l.includes('references=')),
			imagesForwarded: log.some(l => /\[request\] images=1\b/.test(l)),
			thinkingChars: thinking.reduce((a, b) => a + b, 0)
		};
	});

	// ── createFile: the creation belongs to the editing session ──────────────
	await section(result, 'createFile', async () => {
		const target = path.join(ws, 'notes', 'hello.txt');
		await vscode.commands.executeCommand('workbench.action.chat.newChat');
		await vscode.commands.executeCommand('workbench.action.chat.open', {
			query: 'Create a new file at notes/hello.txt whose entire content is: hello from sirius. Use the create_file tool once, then stop.',
			mode: 'agent',
			modelSelector: { vendor: 'sirius', id: agentModel },
			blockOnResponse: true
		});
		await sleep(1500);
		const afterCreate = {
			exists: fs.existsSync(target),
			onDisk: fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null,
			inEditor: vscode.workspace.textDocuments.find(d => d.uri.fsPath === target)?.getText() ?? null
		};
		await vscode.commands.executeCommand('chatEditing.discardFile', vscode.Uri.file(target));
		await sleep(1500);
		result.createFile = {
			afterCreate,
			existsAfterReject: fs.existsSync(target),
			contentAfterReject: fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null,
			log: siriusLog(context).filter(l => l.includes('create_file') || l.includes('[round')).slice(-6)
		};
	});

	return result;
};
