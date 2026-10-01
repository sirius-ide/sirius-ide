/** The social images generated at build: one per page, flat, in the brand's colours. */
export interface OgPage { slug: string; kicker: string; title: string; sub?: string }
export const ogPages: OgPage[] = [
	{ slug: 'home', kicker: 'Code editor', title: 'The advanced agentic code editor.', sub: 'Bring your own model. Twelve providers, or local. No telemetry.' },
	{ slug: 'download', kicker: 'Download', title: 'Linux and Windows, attested and checksummed.', sub: 'Tarball, .deb, .rpm, pacman repository, Windows installer.' },
	{ slug: 'docs', kicker: 'Documentation', title: 'Install, bring a model, start working.', sub: 'Providers and keys, local models, agent mode, Tab, rules, the server.' },
	{ slug: 'changelog', kicker: 'Changelog', title: 'What shipped, release by release.', sub: 'Generated from GitHub Releases on every build.' },
	{ slug: 'roadmap', kicker: 'Roadmap', title: 'Shipped, in progress, planned.', sub: 'Rendered from the repository\'s ROADMAP.md.' },
	{ slug: 'privacy', kicker: 'Privacy', title: 'Collects nothing.', sub: 'No telemetry, no account, no relay. Local models leave nothing.' },
	{ slug: 'license', kicker: 'Licence', title: 'Free to install and use on your own devices.', sub: 'Proprietary licence; Code - OSS and third parties keep theirs.' },
	{ slug: 'security', kicker: 'Security', title: 'Report vulnerabilities privately.', sub: 'GitHub private vulnerability reporting; attested releases.' },
];
export function ogSlugFor(pathname: string): string {
	if (pathname === '/' || pathname === '') { return 'home'; }
	const first = pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
	return ogPages.some((p) => p.slug === first) ? first : 'default';
}
