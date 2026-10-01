/**
 * Release data for the hero badge, /download/ and /changelog/. scripts/fetch-release-data.mjs
 * refreshes releases.json from the GitHub Releases API before every build (npm run prebuild);
 * the committed file is the fallback, so a GitHub hiccup never breaks a deploy.
 */
import snapshot from './releases.json';

export interface ReleaseAsset {
	name: string;
	size: number;
	downloadUrl: string;
	sha256: string | null;
}

export interface ReleaseCommit {
	sha: string;
	subject: string;
}

export interface Release {
	tag: string;
	version: string;
	name: string;
	prerelease: boolean;
	publishedAt: string;
	url: string;
	body: string;
	assets: ReleaseAsset[];
	commits: ReleaseCommit[];
}

export const releases: Release[] = snapshot.releases;
export const fetchedAt: string = snapshot.fetchedAt;
export const release: Release = releases.find((r) => !r.prerelease) ?? releases[0];

export function releaseDate(r: Release = release): string {
	return new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(r.publishedAt));
}

export function formatSize(bytes: number): string {
	if (bytes >= 1024 * 1024) { return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`; }
	if (bytes >= 1024) { return `${Math.round(bytes / 1024)} KB`; }
	return `${bytes} B`;
}

/** The download the CDN serves for a release asset; GitHub keeps the archival copy. */
export function cdnUrl(r: Release, asset: ReleaseAsset, downloadHost: string): string {
	return `${downloadHost}/releases/${r.tag}/${asset.name}`;
}
