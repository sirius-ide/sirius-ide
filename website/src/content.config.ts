import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineCollection, z } from 'astro:content';
import { glob, type Loader } from 'astro/loaders';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

/** The repository root: website/src/content.config.ts → ../../ */
const REPO_ROOT = new URL('../../', import.meta.url);
const GITHUB_BLOB = 'https://github.com/sirius-ide/sirius-ide/blob/sirius/';

/**
 * Relative links inside the repository's documents point at other repository files
 * (ROADMAP.md → PROJECT-STATE.md); on the site they go to GitHub. Absolute links and
 * in-page anchors are left alone.
 */
export function rewriteRepoLinks(html: string): string {
	return html.replace(/href="(?![a-z][a-z0-9+.-]*:|\/|#|mailto:)([^"]+)"/gi, (_m, p: string) => `href="${GITHUB_BLOB}${p}"`);
}

/**
 * Starlight's docs plus INSTALL.md from the repository root as `docs/install`, rendered
 * at build time so /docs/install/ can never drift from the file the editor ships with.
 */
function siriusDocsLoader(): Loader {
	const base = docsLoader();
	return {
		name: 'sirius-docs-loader',
		load: async (context) => {
			await base.load(context);
			const file = fileURLToPath(new URL('INSTALL.md', REPO_ROOT));
			const raw = await readFile(file, 'utf8');
			// The file's own H1 becomes the page title; Starlight renders the title itself.
			const match = raw.match(/^#\s+(.+)\n/);
			const title = match?.[1]?.trim() ?? 'Installing Sirius IDE';
			const body = match ? raw.slice(match[0].length) : raw;
			const id = 'docs/install';
			const data = await context.parseData({
				id,
				data: {
					title,
					description: 'How to install Sirius on Arch, Debian and Ubuntu, Fedora and RHEL, any Linux, Windows, and the remote server — rendered from the repository\'s INSTALL.md.',
					sidebar: { label: 'Install', order: 1 },
				},
			});
			const rendered = await context.renderMarkdown(body);
			rendered.html = rewriteRepoLinks(rendered.html);
			context.store.set({ id, data, body, rendered, digest: context.generateDigest(body) });
		},
	};
}

export const collections = {
	docs: defineCollection({ loader: siriusDocsLoader(), schema: docsSchema() }),
	/** The repository's own documents, read from the repository root at build time. */
	repoDocs: defineCollection({
		loader: glob({ pattern: ['PRIVACY.md', 'ROADMAP.md', 'SECURITY.md'], base: REPO_ROOT }),
		schema: z.object({ title: z.string().optional() }),
	}),
};
