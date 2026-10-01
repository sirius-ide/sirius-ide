// axe-core against every page, both schemes, desktop and phone — WCAG 2.2 AA. Exit code 1 on a violation.
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { serveDist } from './lib/serve.mjs';

const { base, close, pages } = await serveDist();
const browser = await chromium.launch();
let total = 0;
for (const path of pages) {
	for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
		for (const scheme of ['dark', 'light']) {
			const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, colorScheme: scheme, reducedMotion: 'reduce' });
			const page = await ctx.newPage();
			await page.goto(base + path, { waitUntil: 'networkidle' });
			// open every <details> so hidden answers are audited too
			await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
			const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
			if (results.violations.length) {
				total += results.violations.length;
				console.error(`\n${path} ${w}×${h} ${scheme}: ${results.violations.length} violation(s)`);
				for (const v of results.violations) {
					console.error(`  [${v.impact}] ${v.id}: ${v.help} — ${v.nodes.length} node(s)`);
					for (const n of v.nodes.slice(0, 3)) { console.error(`      ${n.target.join(' ')}`); }
				}
			}
			await ctx.close();
		}
	}
	console.log(`  ok ${path}`);
}
await browser.close(); close();
if (total) { console.error(`axe: ${total} violation(s)`); process.exitCode = 1; } else { console.log(`axe: ${pages.length} pages × 4 variants, no violations`); }
