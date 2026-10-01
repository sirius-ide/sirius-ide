// Every internal link and resource in dist/ resolves, including #fragments; external links are
// listed, not fetched (the build environment may be offline). Exit code 1 on a broken link.
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DIST, listPages } from './lib/serve.mjs';

const pages = await listPages();
const fileFor = async (urlPath) => {
	const clean = decodeURIComponent(urlPath);
	const candidates = clean.endsWith('/') ? [join(DIST, clean, 'index.html')] : [join(DIST, clean), join(DIST, clean, 'index.html'), join(DIST, `${clean}.html`)];
	for (const c of candidates) { try { if ((await stat(c)).isFile()) { return c; } } catch { /* next */ } }
	return null;
};
const ids = new Map();
async function idsOf(file) {
	if (!ids.has(file)) {
		const html = await readFile(file, 'utf8');
		ids.set(file, new Set([...html.matchAll(/\sid=["']([^"']+)["']/g)].map((m) => m[1])));
	}
	return ids.get(file);
}
const broken = []; const external = new Set(); let checked = 0;
for (const path of pages) {
	const file = await fileFor(path);
	const html = await readFile(file, 'utf8');
	for (const m of html.matchAll(/\s(?:href|src)=["']([^"']+)["']/g)) {
		const raw = m[1];
		if (/^(mailto:|tel:|data:|javascript:)/.test(raw)) { continue; }
		if (/^https?:\/\//.test(raw)) { if (!raw.startsWith('https://siriuside.com')) { external.add(raw); continue; } }
		let target = raw.replace(/^https:\/\/siriuside\.com/, '');
		if (!target.startsWith('/') && !target.startsWith('#')) { target = new URL(target, `https://x${path}`).pathname + (target.includes('#') ? '#' + target.split('#')[1] : ''); }
		const [p, frag] = target.split('#');
		const targetPath = p || path;
		const f = await fileFor(targetPath);
		checked++;
		if (!f) { broken.push(`${path}: ${raw} → no file for ${targetPath}`); continue; }
		if (frag && f.endsWith('.html') && !(await idsOf(f)).has(frag)) { broken.push(`${path}: ${raw} → no #${frag} in ${targetPath}`); }
	}
}
console.log(`links: ${checked} internal references checked across ${pages.length} pages; ${external.size} external links not fetched`);
if (broken.length) { console.error(`links: ${broken.length} broken`); for (const b of broken) { console.error('  ' + b); } process.exitCode = 1; }
