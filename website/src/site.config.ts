/**
 * Site-wide constants. build/sirius/set-identity.mjs rewrites the owner and the domain
 * here along with product.json, so this file is the only place they are spelled out.
 */
export const site = {
	name: 'Sirius IDE',
	shortName: 'Sirius',
	tagline: 'The advanced agentic code editor.',
	description:
		'Sirius IDE is the advanced agentic code editor built on Code - OSS. Bring your own model — twelve providers or local models — with no telemetry, no account and no relay.',
	domain: 'siriuside.com',
	url: 'https://siriuside.com',
	githubOwner: 'sirius-ide',
	githubRepo: 'sirius-ide',
	github: 'https://github.com/sirius-ide/sirius-ide',
	issues: 'https://github.com/sirius-ide/sirius-ide/issues',
	releases: 'https://github.com/sirius-ide/sirius-ide/releases',
	securityAdvisories: 'https://github.com/sirius-ide/sirius-ide/security/advisories/new',
	/** The macOS tracking issue — create it on GitHub and put its URL here (PROJECT-STATE §13). */
	macosIssue: 'https://github.com/sirius-ide/sirius-ide/issues',
	downloadHost: 'https://dl.siriuside.com',
	updateHost: 'https://update.siriuside.com',
} as const;
