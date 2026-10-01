// Lighthouse CI: Lighthouse's default mobile emulation and simulated throttling, three runs per page, and the
// budgets from BRIEF.md §1 as hard assertions. `npm run lighthouse` runs it against dist/.
const pages = ['/', '/download/', '/docs/', '/docs/install/', '/changelog/', '/roadmap/', '/privacy/', '/license/', '/security/'];
module.exports = {
	ci: {
		collect: {
			staticDistDir: './dist',
			url: pages.map((p) => `http://localhost${p}`),
			numberOfRuns: 3,
			settings: {
				chromeFlags: '--no-sandbox --headless=new --disable-gpu',
				budgetPath: './budgets.json',
			},
		},
		assert: {
			assertions: {
				'categories:performance': ['error', { minScore: 0.95 }],
				'categories:accessibility': ['error', { minScore: 1 }],
				'categories:best-practices': ['error', { minScore: 1 }],
				'categories:seo': ['error', { minScore: 1 }],
				'largest-contentful-paint': ['error', { maxNumericValue: 1500 }],
				'cumulative-layout-shift': ['error', { maxNumericValue: 0 }],
				'performance-budget': 'error',
			},
		},
		upload: { target: 'filesystem', outputDir: './test-results/lighthouse' },
	},
};
