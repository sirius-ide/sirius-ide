import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { releases, releaseDate, formatSize } from '../data/release';
import { site } from '../site.config';

export function GET(context: APIContext) {
	return rss({
		title: 'Sirius IDE releases',
		description: 'Every Sirius IDE release: what changed and what shipped.',
		site: context.site ?? site.url,
		items: releases.map((r) => {
			const changes = r.commits.filter((c) => !/^(docs|state|roadmap)(\(|:)/i.test(c.subject) && !/^\d+\.\d+\.\d+$/.test(c.subject));
			const list = changes.length ? `<ul>${changes.map((c) => `<li>${c.subject.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch] ?? ch)}</li>`).join('')}</ul>` : '<p>Documentation changes only.</p>';
			const assets = r.assets.filter((a) => a.name !== 'commit.txt').map((a) => `${a.name} (${formatSize(a.size)})`).join(', ');
			return {
				title: `${site.name} ${r.tag}`,
				pubDate: new Date(r.publishedAt),
				link: `/changelog/#${r.tag}`,
				description: `Released ${releaseDate(r)}. ${changes.length} changes. Assets: ${assets}.`,
				content: `${list}<p>Assets: ${assets}.</p><p><a href="${r.url}">Release on GitHub</a></p>`,
			};
		}),
		customData: '<language>en</language>',
	});
}
