// Dev probe: print axe colour-contrast details (computed fg/bg, ratio, message key) for a page.
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { serveDist } from '../lib/serve.mjs';
const [path = '/', scheme = 'dark', width = '1440'] = process.argv.slice(2);
const { base, close } = await serveDist();
const browser = await chromium.launch();
try {
	const context = await browser.newContext({ viewport: { width: Number(width), height: 900 }, colorScheme: scheme });
	const page = await context.newPage();
	await page.goto(base + path, { waitUntil: 'networkidle' });
	await page.waitForTimeout(6500);
	const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
	for (const v of res.violations) {
		console.log(`${v.id} (${v.impact}) ${v.nodes.length} nodes`);
		for (const n of v.nodes.slice(0, 8)) {
			const d = n.any[0]?.data ?? {};
			console.log(`  ${n.target[0]} :: fg ${d.fgColor} bg ${d.bgColor} ratio ${d.contrastRatio} expected ${d.expectedContrastRatio} key ${d.messageKey ?? ''} size ${d.fontSize ?? ''}`);
		}
	}
	if (!res.violations.length) { console.log('no violations'); }
} finally { await browser.close(); await close(); }
