// Dev helper: slice a full-page screenshot into viewport-height bands for review.
// Usage: node scripts/dev/crop.mjs <png> <outDir> [bandHeight=900] [scale=1]
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
const [src, outDir, bandArg = '900', scaleArg = '1'] = process.argv.slice(2);
const band = Number(bandArg); const scale = Number(scaleArg);
await mkdir(outDir, { recursive: true });
const meta = await sharp(src).metadata();
const n = Math.ceil(meta.height / band);
for (let i = 0; i < n; i++) {
	const top = i * band; const height = Math.min(band, meta.height - top);
	let img = sharp(src).extract({ left: 0, top, width: meta.width, height });
	if (scale !== 1) img = img.resize({ width: Math.round(meta.width * scale) });
	const out = join(outDir, `${basename(src, '.png')}-b${String(i).padStart(2, '0')}.png`);
	await img.png({ compressionLevel: 9 }).toFile(out);
}
console.log(`${n} bands of ${meta.width}x${band} from ${meta.width}x${meta.height} -> ${outDir}`);
