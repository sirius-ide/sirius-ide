// Every built page renders at 1440×900 and 390×844, in dark and light, without console errors,
// page errors or failed requests, and carries the basics: one <title>, one <h1>, a <main>,
// a canonical link, a description. Exit code 1 on any problem.
import { chromium } from '@playwright/test';
import { serveDist } from './lib/serve.mjs';

const { base, close, pages } = await serveDist();
const browser = await chromium.launch();
const problems = [];
const variants = [
	{ tag: '1440x900', viewport: { width: 1440, height: 900 } },
	{ tag: '390x844', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];
for (const path of pages) {
	for (const v of variants) {
		for (const scheme of ['dark', 'light']) {
			const ctx = await browser.newContext({ ...v, colorScheme: scheme });
			const page = await ctx.newPage();
			const tag = `${path} ${v.tag} ${scheme}`;
			page.on('console', (m) => { if (m.type() === 'error') { problems.push(`${tag}: console error: ${m.text()}`); } });
			page.on('pageerror', (e) => problems.push(`${tag}: page error: ${e.message}`));
			page.on('requestfailed', (r) => problems.push(`${tag}: request failed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
			page.on('response', (r) => { if (r.status() >= 400 && !path.endsWith('404.html')) { problems.push(`${tag}: ${r.status()} ${r.url()}`); } });
			const res = await page.goto(base + path, { waitUntil: 'networkidle' });
			if (!res || (res.status() >= 400 && !path.endsWith('404.html'))) { problems.push(`${tag}: status ${res?.status()}`); }
			const checks = await page.evaluate(() => ({
				title: document.title, h1: document.querySelectorAll('h1').length, main: document.querySelectorAll('main').length,
				canonical: document.querySelector('link[rel=canonical]')?.getAttribute('href') ?? '', description: document.querySelector('meta[name=description]')?.getAttribute('content') ?? '',
				lang: document.documentElement.lang, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
			}));
			if (!checks.title) { problems.push(`${tag}: no <title>`); }
			if (checks.h1 !== 1) { problems.push(`${tag}: ${checks.h1} <h1> elements`); }
			if (checks.main !== 1) { problems.push(`${tag}: ${checks.main} <main> elements`); }
			if (!checks.canonical) { problems.push(`${tag}: no canonical link`); }
			if (!checks.description) { problems.push(`${tag}: no meta description`); }
			if (checks.lang !== 'en') { problems.push(`${tag}: lang is "${checks.lang}"`); }
			if (checks.overflow) { problems.push(`${tag}: horizontal overflow (page wider than the viewport)`); }
			await ctx.close();
		}
	}
	console.log(`  ok ${path}`);
}
await browser.close(); close();
if (problems.length) { console.error(`\nsmoke: ${problems.length} problem(s)`); for (const p of problems) { console.error('  ' + p); } process.exitCode = 1; }
else { console.log(`smoke: ${pages.length} pages × 4 variants clean`); }
