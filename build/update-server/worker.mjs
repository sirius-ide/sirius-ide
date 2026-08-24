/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Update Server
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * Implements the update protocol the editor's update service speaks:
 *
 *   GET /api/update/{platform}/{quality}/{commit}
 *     204            — already current
 *     200 + IUpdate  — an update is available
 *
 * Releases are read from GitHub, so publishing a release is all it takes to
 * ship an update. Each release must carry a `commit.txt` asset holding the
 * git SHA the build came from; that is what the editor compares against, since
 * `productVersion` alone cannot distinguish two builds of the same version.
 *
 * Deploy as a Cloudflare Worker:
 *   npx wrangler deploy build/update-server/worker.mjs --name sirius-update
 * then point `updateUrl` in product.json at the worker's hostname.
 */

const REPO = 'sirius-ide/sirius-ide';
const CACHE_SECONDS = 300;

/**
 * Every response carries an explicit TTL. A bare 204 has no cache-control, and
 * a CDN in front of this worker would then apply its default TTL — pinning
 * "already current" at the edge long after a release ships.
 */
function noUpdate() {
	return new Response(null, {
		status: 204,
		headers: { 'cache-control': `public, max-age=${CACHE_SECONDS}` }
	});
}

/** Asset naming per platform, as produced by the release workflow. */
const ASSET_SUFFIX = {
	'linux-x64': 'linux-x64.tar.gz',
	'linux-arm64': 'linux-arm64.tar.gz',
	'win32-x64': 'win32-x64-setup.exe',
	'win32-arm64': 'win32-arm64-setup.exe',
	'darwin': 'darwin-universal.zip',
	'darwin-x64': 'darwin-x64.zip',
	'darwin-arm64': 'darwin-arm64.zip'
};

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const match = url.pathname.match(/^\/api\/update\/([^/]+)\/([^/]+)\/([^/]+)$/);

		if (!match) {
			return new Response('Sirius IDE update server', {
				status: 200,
				headers: { 'cache-control': `public, max-age=${CACHE_SECONDS}` }
			});
		}

		const [, platform, quality, currentCommit] = match;
		const suffix = ASSET_SUFFIX[platform];
		if (!suffix) {
			return noUpdate();
		}

		let release;
		try {
			release = await latestRelease(quality);
		} catch {
			// Never fail an update check loudly; the editor treats it as "no update".
			return noUpdate();
		}
		if (!release) {
			return noUpdate();
		}

		const commit = await releaseCommit(release);
		if (!commit || commit === currentCommit) {
			return noUpdate();
		}

		const asset = release.assets.find(a => a.name.endsWith(suffix));
		if (!asset) {
			return noUpdate();
		}

		// When DL_BASE is set (wrangler [vars]), downloads ride the R2/CDN path
		// the release workflow mirrors to; GitHub remains the fallback and the
		// canonical archive either way.
		const downloadUrl = env?.DL_BASE
			? `${env.DL_BASE}/releases/${release.tag_name}/${asset.name}`
			: asset.browser_download_url;

		const body = {
			// `version` is the build commit, not the product version.
			version: commit,
			productVersion: release.tag_name.replace(/^v/, ''),
			timestamp: Date.parse(release.published_at) || Date.now(),
			url: downloadUrl,
			sha256hash: await assetHash(release, asset.name)
		};

		return new Response(JSON.stringify(body), {
			status: 200,
			headers: {
				'content-type': 'application/json',
				'cache-control': `public, max-age=${CACHE_SECONDS}`
			}
		});
	}
};

async function gh(path) {
	const response = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
		headers: { 'accept': 'application/vnd.github+json', 'user-agent': 'sirius-update-server' }
	});
	if (!response.ok) {
		throw new Error(`GitHub ${response.status}`);
	}
	return response.json();
}

/**
 * `stable` takes the newest non-prerelease; any other quality (e.g. `insider`)
 * takes the newest prerelease, so both channels can ship from one repository.
 */
async function latestRelease(quality) {
	const releases = await gh('/releases?per_page=20');
	const wantPrerelease = quality !== 'stable';
	return releases.find(r => !r.draft && Boolean(r.prerelease) === wantPrerelease) ?? null;
}

async function releaseCommit(release) {
	const asset = release.assets.find(a => a.name === 'commit.txt');
	if (!asset) {
		return null;
	}
	const response = await fetch(asset.browser_download_url, {
		headers: { 'user-agent': 'sirius-update-server' }
	});
	return response.ok ? (await response.text()).trim() : null;
}

/** Hashes are published as `<asset>.sha256`; absent is not fatal. */
async function assetHash(release, assetName) {
	const asset = release.assets.find(a => a.name === `${assetName}.sha256`);
	if (!asset) {
		return undefined;
	}
	const response = await fetch(asset.browser_download_url, {
		headers: { 'user-agent': 'sirius-update-server' }
	});
	if (!response.ok) {
		return undefined;
	}
	return (await response.text()).trim().split(/\s+/)[0];
}
