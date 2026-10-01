/**
 * The latest release, for the hero badge and the download page.
 * At build time this is refreshed from the GitHub Releases API (full build); the
 * committed snapshot in release.json is the fallback so a GitHub hiccup never breaks
 * a deploy.
 */
import snapshot from './release.json';

export interface ReleaseAsset {
	name: string;
	size: number;
	downloadUrl: string;
}

export interface Release {
	tag: string;
	version: string;
	name: string;
	publishedAt: string;
	url: string;
	fetchedAt: string;
	assets: ReleaseAsset[];
}

export const release: Release = snapshot;

export function releaseDate(r: Release = release): string {
	return new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(r.publishedAt));
}
