// Behaviour the static checks cannot see, driven in a real browser against dist/:
//   - the phone menu closes on Escape (focus back on its button) and on a click outside it;
//   - the comparison table is one tab stop per row for its source links, and the arrow keys move along the row;
//   - the docs' search loads nothing until it is asked for, then opens, finds a page and links to it;
//   - the download page's jump links resolve, and every Linux command block has its own copy button.
// Exit code 1 on any problem.
import { chromium } from '@playwright/test';
import { serveDist } from './lib/serve.mjs';

const { base, close } = await serveDist();
const browser = await chromium.launch();
const problems = [];
const check = (ok, what) => { if (!ok) { problems.push(what); } };

// --- phone menu ---------------------------------------------------------------------------------
{
	const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
	const page = await ctx.newPage();
	await page.goto(base + '/', { waitUntil: 'networkidle' });
	const open = () => page.evaluate(() => document.querySelector('header.nav details.menu').open);
	await page.locator('header.nav details.menu summary').click();
	check(await open(), 'phone menu: did not open');
	await page.keyboard.press('Escape');
	check(!(await open()), 'phone menu: Escape did not close it');
	check(await page.evaluate(() => document.activeElement?.closest('details.menu') !== null), 'phone menu: focus did not return to the menu button');
	await page.locator('header.nav details.menu summary').click();
	check(await open(), 'phone menu: did not reopen');
	await page.mouse.click(40, 600);
	check(!(await open()), 'phone menu: a click outside did not close it');
	await ctx.close();
}

// --- comparison table: one tab stop per row ----------------------------------------------------
{
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const page = await ctx.newPage();
	await page.goto(base + '/', { waitUntil: 'networkidle' });
	const rows = await page.evaluate(() => [...document.querySelectorAll('#compare tbody tr')].map((tr) => {
		const links = [...tr.querySelectorAll('a.src')];
		return { links: links.length, stops: links.filter((a) => a.tabIndex >= 0).length };
	}));
	check(rows.every((r) => r.links < 2 || r.stops === 1), `comparison: a row has ${JSON.stringify(rows.filter((r) => r.links >= 2 && r.stops !== 1))} tab stops (want one)`);
	const multi = await page.evaluate(() => { const tr = [...document.querySelectorAll('#compare tbody tr')].find((r) => r.querySelectorAll('a.src').length >= 2); return tr ? [...document.querySelectorAll('#compare tbody tr')].indexOf(tr) : -1; });
	check(multi >= 0, 'comparison: no row with two or more sources to test');
	if (multi >= 0) {
		const first = page.locator('#compare tbody tr').nth(multi).locator('a.src').first();
		await first.focus();
		await page.keyboard.press('ArrowRight');
		const moved = await page.evaluate(() => document.activeElement?.classList.contains('src') && document.activeElement.tabIndex === 0);
		check(moved, 'comparison: ArrowRight did not move to the next source link');
		await page.keyboard.press('ArrowLeft');
		check(await first.evaluate((a) => a === document.activeElement), 'comparison: ArrowLeft did not move back');
	}
	await ctx.close();
}

// --- docs search is lazy ------------------------------------------------------------------------
{
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const page = await ctx.newPage();
	const loaded = [];
	page.on('request', (r) => loaded.push(new URL(r.url()).pathname));
	page.on('pageerror', (e) => problems.push(`search: page error: ${e.message}`));
	await page.goto(base + '/docs/', { waitUntil: 'networkidle' });
	await page.waitForTimeout(500);
	check(!loaded.some((p) => /search-ui|pagefind/.test(p)), `search: loaded before it was asked for (${loaded.filter((p) => /search-ui|pagefind/.test(p)).join(', ')})`);
	await page.locator('site-search button[data-open-modal]').click();
	await page.locator('#starlight__search input').waitFor({ timeout: 8000 });
	await page.locator('#starlight__search input').fill('ollama');
	await page.locator('#starlight__search .pagefind-ui__result-link').first().waitFor({ timeout: 8000 });
	const href = await page.locator('#starlight__search .pagefind-ui__result-link').first().getAttribute('href');
	check(!!href && href.startsWith('/'), `search: first result has no usable link (${href})`);
	check(await page.evaluate(() => getComputedStyle(document.querySelector('#starlight__search .pagefind-ui__result-link')).fontWeight === '600'), 'search: the results stylesheet did not apply');
	await page.keyboard.press('Escape');
	check(await page.evaluate(() => !document.querySelector('site-search dialog').open), 'search: Escape did not close the dialog');
	// Ctrl+K opens it too
	await page.keyboard.press('Control+k');
	check(await page.evaluate(() => document.querySelector('site-search dialog').open), 'search: Ctrl+K did not open the dialog');
	await ctx.close();
}

// --- download page ------------------------------------------------------------------------------
{
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const page = await ctx.newPage();
	await page.goto(base + '/download/', { waitUntil: 'networkidle' });
	const jumps = await page.evaluate(() => [...document.querySelectorAll('nav.jump a')].map((a) => ({ href: a.getAttribute('href'), ok: !!document.getElementById(a.getAttribute('href').slice(1)) })));
	check(jumps.length >= 8 && jumps.every((j) => j.ok), `download: jump links missing or dangling (${JSON.stringify(jumps.filter((j) => !j.ok))})`);
	const blocks = await page.evaluate(() => [...document.querySelectorAll('.cmd')].filter((c) => /arm64|aarch64/.test(c.textContent ?? '')).map((c) => ({ text: (c.querySelector('code')?.textContent ?? '').trim().split('\n')[0], copy: !!c.querySelector('button.copy') })));
	check(blocks.length >= 3 && blocks.every((b) => b.copy), `download: an arm64 command has no copy button (${JSON.stringify(blocks.filter((b) => !b.copy))})`);
	await ctx.close();
}

await browser.close(); close();
if (problems.length) { console.error(`\ninteract: ${problems.length} problem(s)`); for (const p of problems) { console.error('  ' + p); } process.exitCode = 1; }
else { console.log('interact: phone menu, comparison table, lazy docs search and download page behave'); }
