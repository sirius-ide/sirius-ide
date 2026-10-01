import type { APIRoute, GetStaticPaths } from 'astro';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { ogPages, type OgPage } from '../../og/pages';
import { site } from '../../site.config';

export const getStaticPaths: GetStaticPaths = () => ogPages.map((p) => ({ params: { slug: p.slug }, props: { ...p } }));

// Resolved from the project root, not import.meta.url: the compiled module lives under dist/ at build time.
const font = (file: string) => readFile(resolve(process.cwd(), 'src', 'og', file));
const star = '32.00,4.00 38.94,22.45 58.63,23.35 43.22,35.65 48.46,54.65 32.00,43.80 15.54,54.65 20.78,35.65 5.37,23.35 25.06,22.45';

// Satori takes React-shaped element trees; no JSX needed. Every <div> is a flex box unless told
// otherwise, because satori rejects a div with element children that has no explicit display.
const h = (type: string, props: Record<string, unknown>, ...children: unknown[]) => {
	const style = { ...(type === 'div' ? { display: 'flex' } : {}), ...((props.style as Record<string, unknown> | undefined) ?? {}) };
	return { type, props: { ...props, style, children: children.length === 1 ? children[0] : children } };
};

function mark(size: number) {
	return h('svg', { width: size, height: size, viewBox: '0 0 64 64' },
		h('defs', {}, h('clipPath', { id: 'l' }, h('rect', { x: 0, y: 0, width: 32, height: 64 })), h('clipPath', { id: 'r' }, h('rect', { x: 32, y: 0, width: 32, height: 64 }))),
		h('polygon', { points: star, fill: '#e6edf3', 'clip-path': 'url(#l)' }),
		h('polygon', { points: star, fill: '#0094f3', 'clip-path': 'url(#r)' }),
		h('polyline', { points: '49,5 31.5,30 36.5,30 15,59', fill: 'none', stroke: '#02060e', 'stroke-width': 3.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
		h('polyline', { points: '49,5 31.5,30 36.5,30 15,59', fill: 'none', stroke: '#ffffff', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
	);
}

export const GET: APIRoute = async ({ props }) => {
	const page = props as OgPage;
	const [bold, regular, mono] = await Promise.all([font('Geist-Bold.ttf'), font('Geist-Regular.ttf'), font('GeistMono-Regular.ttf')]);
	const tree = h('div', { style: { width: 1200, height: 630, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 72px', background: '#06080d', color: '#e6edf3', fontFamily: 'Geist', border: '2px solid rgba(139, 92, 246, 0.45)' } },
		h('div', { style: { display: 'flex', alignItems: 'center', gap: 20 } },
			mark(56),
			h('div', { style: { display: 'flex', flexDirection: 'column' } },
				h('div', { style: { fontSize: 30, fontWeight: 700, letterSpacing: -0.5 } }, 'Sirius IDE'),
				h('div', { style: { fontSize: 20, fontFamily: 'Geist Mono', color: '#a78bfa', letterSpacing: 2, textTransform: 'uppercase' } }, page.kicker),
			),
		),
		h('div', { style: { display: 'flex', flexDirection: 'column', gap: 22 } },
			h('div', { style: { fontSize: page.title.length > 40 ? 58 : 68, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2.2, maxWidth: 1000 } }, page.title),
			page.sub ? h('div', { style: { fontSize: 28, color: '#8b949e', lineHeight: 1.35, maxWidth: 960 } }, page.sub) : null,
		),
		h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'Geist Mono', fontSize: 22, color: '#6e7781' } },
			h('div', {}, site.domain),
			h('div', { style: { display: 'flex', alignItems: 'center', gap: 14 } }, h('div', { style: { width: 12, height: 12, borderRadius: 6, background: '#67e8f9' } }), h('div', {}, 'Free to download and use')),
		),
	);
	const svg = await satori(tree as never, {
		width: 1200, height: 630,
		fonts: [
			{ name: 'Geist', data: bold, weight: 700, style: 'normal' },
			{ name: 'Geist', data: regular, weight: 400, style: 'normal' },
			{ name: 'Geist Mono', data: mono, weight: 400, style: 'normal' },
		],
	});
	const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
	return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
