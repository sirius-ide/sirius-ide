// Dev probe: list the elements that stick out of a 390px viewport on a page. Usage: node scripts/probe-overflow.mjs /path/
import { chromium } from '@playwright/test';
import { serveDist } from '../lib/serve.mjs';
const path = process.argv[2] || '/';
const { base, close } = await serveDist();
const browser = await chromium.launch();
try {
	for (const scheme of ['dark', 'light']) {
		const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
		await page.goto(base + path, { waitUntil: 'networkidle' });
		await page.waitForTimeout(6500);
		const wide = await page.evaluate(() => {
			const vw = document.documentElement.clientWidth; const out = [];
			for (const el of document.querySelectorAll('body *')) {
				const r = el.getBoundingClientRect(); if (r.width === 0) continue;
				if (r.right > vw + 1 || r.left < -1) {
					const cls = typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '';
					out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls} left=${Math.round(r.left)} right=${Math.round(r.right)} w=${Math.round(r.width)} :: ${(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)}`);
				}
			}
			return { vw, sw: document.documentElement.scrollWidth, bodySw: document.body.scrollWidth, out: out.slice(0, 25) };
		});
		console.log(scheme, JSON.stringify(wide, null, 1));
		await page.close();
	}
} finally { await browser.close(); await close(); }
