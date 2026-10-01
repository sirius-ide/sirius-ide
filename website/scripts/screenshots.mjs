// Design-review screenshots: every page at 1440×900 and 390×844, dark and light, from
// the built site in dist/. Run `npm run build` first. Output goes to design/ (or the
// directory given as the first argument). Uses the Chromium that @playwright/test pins.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import sharp from 'sharp';

const DIST = resolve(import.meta.dirname, '..', 'dist');
const OUT = resolve(process.argv[2] ?? resolve(import.meta.dirname, '..', 'design'));
const MIME = {
	'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
	'.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
	'.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain',
};

async function fileFor(urlPath) {
	const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
	const candidates = clean.endsWith('/')
		? [join(DIST, clean, 'index.html')]
		: [join(DIST, clean), join(DIST, clean, 'index.html'), join(DIST, `${clean}.html`)];
	for (const c of candidates) {
		try {
			if ((await stat(c)).isFile()) { return c; }
		} catch { /* next */ }
	}
	return join(DIST, '404.html');
}

const server = createServer(async (req, res) => {
	const file = await fileFor(req.url ?? '/');
	try {
		const body = await readFile(file);
		res.writeHead(file.endsWith('404.html') ? 404 : 200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
		res.end(body);
	} catch {
		res.writeHead(404); res.end('not found');
	}
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const pages = (process.env.PAGES ?? '/').split(',');
const variants = [
	{ tag: '1440x900', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
	{ tag: '390x844', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];
const schemes = ['dark', 'light'];
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 9500);
// REDUCED_MOTION=1 renders with prefers-reduced-motion: reduce — every sequence must land on its end state.
const REDUCED = process.env.REDUCED_MOTION === '1';
const SUFFIX = REDUCED ? '-reduced' : '';

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const problems = [];
for (const path of pages) {
	const slug = path === '/' ? 'home' : path.replace(/^\/|\/$/g, '').replace(/\//g, '-');
	for (const v of variants) {
		for (const scheme of schemes) {
			const context = await browser.newContext({
				viewport: v.viewport, deviceScaleFactor: v.deviceScaleFactor, isMobile: v.isMobile, hasTouch: v.hasTouch,
				colorScheme: scheme, reducedMotion: REDUCED ? 'reduce' : 'no-preference',
			});
			const page = await context.newPage();
			page.on('console', (m) => { if (m.type() === 'error') { problems.push(`${path} ${v.tag} ${scheme}: console ${m.text()}`); } });
			page.on('pageerror', (e) => problems.push(`${path} ${v.tag} ${scheme}: pageerror ${e.message}`));
			page.on('requestfailed', (r) => problems.push(`${path} ${v.tag} ${scheme}: request failed ${r.url()}`));
			await page.goto(base + path, { waitUntil: 'networkidle' });
			// Size the viewport to the whole page now and take plain captures later: Playwright's
			// fullPage mode re-emulates the device at capture time, and in Chromium that restarts
			// the CSS animations of anything inside the containers the phone layout hides (a plain
			// resize does not — checked), so a fullPage capture would miss their end state.
			const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
			await page.setViewportSize({ width: v.viewport.width, height: fullHeight });
			if (!REDUCED && process.env.MID_MS && v.tag === '1440x900' && scheme === 'dark' && (await page.locator('.win').count())) {
				// The product window mid-sequence: the diff with its Keep / Undo controls on screen.
				await page.waitForTimeout(Number(process.env.MID_MS));
				await page.locator('.win').screenshot({ path: join(OUT, `${slug}-${v.tag}-${scheme}-mid.png`) });
				await page.waitForTimeout(Math.max(0, SETTLE_MS - Number(process.env.MID_MS)));
			} else {
				await page.waitForTimeout(REDUCED ? 800 : SETTLE_MS);
			}
			const out = join(OUT, `${slug}-${v.tag}-${scheme}${SUFFIX}.png`);
			const png = await page.screenshot({ fullPage: false });
			// Palette PNGs: a third of the size for a review render that is committed to the repository.
			await sharp(png).png({ palette: true, quality: 90, compressionLevel: 9, effort: 7 }).toFile(out);
			await context.close();
			console.log(`  ${slug}-${v.tag}-${scheme}${SUFFIX}.png`);
		}
	}
}
await browser.close();
server.close();
if (problems.length) {
	console.error('\nProblems while rendering:');
	for (const p of problems) { console.error('  ' + p); }
	process.exitCode = 1;
}
