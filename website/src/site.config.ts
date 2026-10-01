/**
 * Site-wide constants. build/sirius/set-identity.mjs rewrites the owner and the domain
 * here along with product.json, so this file is the only place they are spelled out.
 */
export const site = {
	name: 'Sirius IDE',
	shortName: 'Sirius',
	tagline: 'The agentic, AI-native code editor.',
	description:
		'Sirius IDE is an agentic, AI-native code editor built on Code - OSS. Bring your own model — twelve providers or local models — with no telemetry, no account and no relay.',
	company: 'Clicksora, L.L.C.',
	domain: 'siriuside.com',
	url: 'https://siriuside.com',
	githubOwner: 'sirius-ide',
	githubRepo: 'sirius-ide',
	github: 'https://github.com/sirius-ide/sirius-ide',
	issues: 'https://github.com/sirius-ide/sirius-ide/issues',
	releases: 'https://github.com/sirius-ide/sirius-ide/releases',
	securityAdvisories: 'https://github.com/sirius-ide/sirius-ide/security/advisories/new',
	downloadHost: 'https://dl.siriuside.com',
	updateHost: 'https://update.siriuside.com',
} as const;
