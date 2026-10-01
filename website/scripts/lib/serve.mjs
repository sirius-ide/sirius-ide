// A static server for dist/, shared by the test scripts: directory indexes, a 404 page,
// and the same content types the CDN will send. Returns { base, close, pages }.
import { createServer } from 'node:http';
import { readFile, stat, readdir } from 'node:fs/promises';
import { extname, join, normalize, resolve, relative } from 'node:path';

const MIME = {
	'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
	'.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
	'.ico': 'image/x-icon', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
	'.pf_meta': 'application/octet-stream', '.pf_index': 'application/octet-stream', '.pf_fragment': 'application/octet-stream', '.pagefind': 'application/octet-stream',
};

export const DIST = resolve(import.meta.dirname, '..', '..', 'dist');

export async function listPages(dist = DIST) {
	const pages = [];
	async function walk(dir) {
		for (const e of await readdir(dir, { withFileTypes: true })) {
			const p = join(dir, e.name);
			if (e.isDirectory()) { await walk(p); } else if (e.name.endsWith('.html')) {
				const rel = relative(dist, p).replace(/\\/g, '/');
				pages.push(rel === 'index.html' ? '/' : rel.endsWith('/index.html') ? `/${rel.slice(0, -'index.html'.length)}` : `/${rel}`);
			}
		}
	}
	await walk(dist);
	return pages.sort();
}

export async function serveDist(dist = DIST) {
	async function fileFor(urlPath) {
		const clean = normalize(decodeURIComponent(urlPath.split('?')[0].split('#')[0])).replace(/^(\.\.[/\\])+/, '');
		const candidates = clean.endsWith('/') ? [join(dist, clean, 'index.html')] : [join(dist, clean), join(dist, clean, 'index.html'), join(dist, `${clean}.html`)];
		for (const c of candidates) { try { if ((await stat(c)).isFile()) { return { file: c, status: 200 }; } } catch { /* next */ } }
		return { file: join(dist, '404.html'), status: 404 };
	}
	const server = createServer(async (req, res) => {
		const { file, status } = await fileFor(req.url ?? '/');
		try { const body = await readFile(file); res.writeHead(status, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }); res.end(body); }
		catch { res.writeHead(404); res.end('not found'); }
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close(), pages: await listPages(dist) };
}
