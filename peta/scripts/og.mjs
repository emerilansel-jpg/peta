// Re-render public/og.png from public/og.svg.
// Run: npm run og   (after editing public/og.svg)
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const svgPath = resolve('public/og.svg');
const pngPath = resolve('public/og.png');

const svg = readFileSync(svgPath);
const info = await sharp(svg, { density: 200 })
  .resize(1200, 630)
  .png({ quality: 90 })
  .toFile(pngPath);

console.log(`og.png: ${info.size} bytes (${info.width}x${info.height})`);
