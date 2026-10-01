// Lighthouse CI: Lighthouse's default mobile emulation and simulated throttling, three runs per page, and the
// budgets from BRIEF.md §1 as hard assertions (resource-summary sizes, scores, LCP, CLS). `npm run lighthouse` runs it against dist/.
const pages = ['/', '/download/', '/docs/', '/docs/install/', '/changelog/', '/roadmap/', '/privacy/', '/license/', '/security/'];
// Every page, the docs included, holds the brief's budget as written.
const common = {
	'largest-contentful-paint': ['error', { maxNumericValue: 1500 }],
	'categories:performance': ['error', { minScore: 0.95 }],
	'categories:accessibility': ['error', { minScore: 1 }],
	'categories:best-practices': ['error', { minScore: 1 }],
	'categories:seo': ['error', { minScore: 1 }],
	'cumulative-layout-shift': ['error', { maxNumericValue: 0 }],
	// Lighthouse 12 removed the budget-file audit; the brief's budgets are asserted on resource-summary instead.
	'resource-summary:script:size': ['error', { maxNumericValue: 61440 }],
	'resource-summary:font:size': ['error', { maxNumericValue: 40960 }],
	'resource-summary:document:size': ['error', { maxNumericValue: 81920 }],
	'resource-summary:total:size': ['error', { maxNumericValue: 409600 }],
	'resource-summary:third-party:count': ['error', { maxNumericValue: 0 }],
};
module.exports = {
	ci: {
		collect: {
			staticDistDir: './dist',
			url: pages.map((p) => `http://localhost${p}`),
			numberOfRuns: 3,
			settings: {
				chromeFlags: '--no-sandbox --headless=new --disable-gpu',
			},
		},
		assert: { assertions: common },
		upload: { target: 'filesystem', outputDir: './test-results/lighthouse' },
	},
};
