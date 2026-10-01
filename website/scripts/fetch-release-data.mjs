// Release data for /download/ and /changelog/, read from the GitHub Releases API at build
// time: every release with its assets (name, size, download URL and the sha256 from the
// .sha256 sidecar) and the commit subjects between it and the previous release. Written to
// src/data/releases.json, which is committed: when GitHub cannot be reached the snapshot
// stands and the build goes on — a GitHub hiccup must never break a deploy (BRIEF.md §6).
// Set GITHUB_TOKEN to lift the anonymous rate limit (CI does).
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Behind an egress proxy (HTTPS_PROXY set), Node's fetch ignores the proxy unless told to;
// re-run under NODE_USE_ENV_PROXY so the request goes the same way curl's would.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
	const child = spawnSync(process.execPath, ['--no-warnings', ...process.argv.slice(1)], {
		stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
	});
	process.exit(child.status ?? 1);
}

const OWNER = 'sirius-ide';
const REPO = 'sirius-ide';
const OUT = resolve(import.meta.dirname, '..', 'src', 'data', 'releases.json');
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const headers = { accept: 'application/vnd.github+json', 'user-agent': 'siriuside.com build' };
if (process.env.GITHUB_TOKEN) { headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`; }

async function json(url) {
	let res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
	if ((res.status === 401 || res.status === 403) && headers.authorization) {
		// A token that the API refuses (wrong audience, expired) must not cost the build: go anonymous.
		delete headers.authorization;
		res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
	}
	if (!res.ok) { throw new Error(`${res.status} ${url}`); }
	return res.json();
}
async function text(url) {
	const res = await fetch(url, { headers: { 'user-agent': headers['user-agent'] }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
	if (!res.ok) { throw new Error(`${res.status} ${url}`); }
	return res.text();
}

let previous = null;
try { previous = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }

try {
	const raw = await json(`${API}/releases?per_page=100`);
	const releases = raw
		.filter((r) => !r.draft)
		.sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
		.map((r) => ({
			tag: r.tag_name,
			version: r.tag_name.replace(/^v/, ''),
			name: r.name || r.tag_name,
			prerelease: Boolean(r.prerelease),
			publishedAt: r.published_at,
			url: r.html_url,
			body: r.body ?? '',
			assets: r.assets
				.filter((a) => !a.name.endsWith('.sha256'))
				.map((a) => ({ name: a.name, size: a.size, downloadUrl: a.browser_download_url, sha256: null })),
			sidecars: r.assets.filter((a) => a.name.endsWith('.sha256')).map((a) => ({ for: a.name.replace(/\.sha256$/, ''), url: a.browser_download_url })),
			commits: [],
		}));

	// sha256 from the sidecars — only for the newest two releases; older ones keep what the snapshot had
	const prevByTag = new Map((previous?.releases ?? []).map((r) => [r.tag, r]));
	for (const [i, rel] of releases.entries()) {
		const prev = prevByTag.get(rel.tag);
		if (i >= 2 && prev) {
			for (const a of rel.assets) { a.sha256 = prev.assets.find((p) => p.name === a.name)?.sha256 ?? null; }
			rel.commits = prev.commits ?? [];
			continue;
		}
		await Promise.all(rel.sidecars.map(async (s) => {
			const asset = rel.assets.find((a) => a.name === s.for);
			if (!asset) { return; }
			try { asset.sha256 = (await text(s.url)).trim().split(/\s+/)[0] || null; } catch { asset.sha256 = prev?.assets.find((p) => p.name === asset.name)?.sha256 ?? null; }
		}));
	}
	// commit subjects between consecutive releases (the body GitHub generates is only a compare link)
	for (const [i, rel] of releases.entries()) {
		const older = releases[i + 1];
		if (!older || (i >= 2 && prevByTag.get(rel.tag))) { continue; }
		try {
			const cmp = await json(`${API}/compare/${older.tag}...${rel.tag}`);
			rel.commits = (cmp.commits ?? []).map((c) => ({ sha: c.sha.slice(0, 7), subject: c.commit.message.split('\n')[0] })).reverse();
		} catch (e) {
			rel.commits = prevByTag.get(rel.tag)?.commits ?? [];
		}
	}
	for (const rel of releases) { delete rel.sidecars; }
	const out = { fetchedAt: new Date().toISOString(), owner: OWNER, repo: REPO, releases };
	await writeFile(OUT, JSON.stringify(out, null, '\t') + '\n');
	console.log(`release data: ${releases.length} releases, latest ${releases[0]?.tag}, written to src/data/releases.json`);
} catch (e) {
	if (previous) {
		console.warn(`release data: GitHub unreachable (${e.message}); building with the snapshot from ${previous.fetchedAt}`);
	} else {
		console.error(`release data: GitHub unreachable (${e.message}) and no snapshot exists`);
		process.exitCode = 1;
	}
}
