// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';

// The Latin range Google Fonts ships as its `latin` subset — the two woff2 files in
// src/fonts are exactly that subset, so this is what the browser may use them for.
/** @type {[string, ...string[]]} */
const LATIN = [
	'U+0000-00FF', 'U+0131', 'U+0152-0153', 'U+02BB-02BC', 'U+02C6', 'U+02DA', 'U+02DC',
	'U+0304', 'U+0308', 'U+0329', 'U+2000-206F', 'U+20AC', 'U+2122', 'U+2191', 'U+2193',
	'U+2212', 'U+2215', 'U+FEFF', 'U+FFFD',
];

export default defineConfig({
	site: 'https://siriuside.com',
	trailingSlash: 'always',
	build: { format: 'directory' },
	fonts: [
		{
			provider: fontProviders.local(),
			name: 'Geist',
			cssVariable: '--font-sans',
			fallbacks: ['Arial', 'Liberation Sans', 'Helvetica Neue', 'sans-serif'],
			optimizedFallbacks: true,
			options: {
				variants: [
					{ src: ['./src/fonts/Geist-latin.woff2'], weight: '100 900', style: 'normal', display: 'swap', unicodeRange: LATIN },
				],
			},
		},
		{
			provider: fontProviders.local(),
			name: 'Geist Mono',
			cssVariable: '--font-mono',
			fallbacks: ['Liberation Mono', 'Courier New', 'monospace'],
			optimizedFallbacks: true,
			options: {
				variants: [
					{ src: ['./src/fonts/GeistMono-latin.woff2'], weight: '100 900', style: 'normal', display: 'swap', unicodeRange: LATIN },
				],
			},
		},
	],
	integrations: [
		starlight({
			title: 'Sirius IDE',
			description: 'Documentation for Sirius IDE — the agentic, AI-native code editor.',
			disable404Route: true,
			favicon: '/favicon.ico',
			customCss: ['./src/styles/starlight.css'],
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/sirius-ide/sirius-ide' }],
			sidebar: [{ label: 'Start here', items: [{ slug: 'docs' }] }],
		}),
		sitemap(),
	],
});
