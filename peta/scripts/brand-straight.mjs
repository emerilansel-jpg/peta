// Generate all Straight Ltd brand assets from a single source logo.
//
// Drop your source logo at: public/straight/source.png (or .svg)
// Then run: npm run brand:straight
//
// Outputs:
//   public/straight/favicon-16.png      (16x16)
//   public/straight/favicon-32.png      (32x32)
//   public/straight/apple-touch-icon.png (180x180)
//   public/straight/icon-192.png        (192x192)
//   public/straight/icon-512.png        (512x512)
//   public/straight/og.png              (1200x630)
//
// Source requirements:
//   - Square aspect ratio works best (anything rectangular will be padded)
//   - At least 1024x1024 for sharp downsampling
//   - PNG with transparency OR SVG (vector preferred)

import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const srcDir = resolve('public/straight');
const candidates = [
  resolve(srcDir, 'source.svg'),
  resolve(srcDir, 'source.png'),
  resolve(srcDir, 'logo.svg'),
  resolve(srcDir, 'logo.png'),
];

const source = candidates.find((p) => existsSync(p));
if (!source) {
  console.error('No source logo found. Drop one at:');
  candidates.forEach((c) => console.error('  - ' + c));
  process.exit(1);
}

if (!existsSync(srcDir)) mkdirSync(srcDir, { recursive: true });

const isSvg = source.endsWith('.svg');
const input = isSvg
  ? { input: readFileSync(source), density: 384 }
  : { input: source };

const ICON_BG = { r: 249, g: 115, b: 22, alpha: 1 }; // brand orange #F97316

const sizes = [
  { name: 'favicon-16.png', size: 16, pad: false },
  { name: 'favicon-32.png', size: 32, pad: false },
  { name: 'apple-touch-icon.png', size: 180, pad: true },
  { name: 'icon-192.png', size: 192, pad: true },
  { name: 'icon-512.png', size: 512, pad: true },
];

console.log('Source: ' + source);

for (const { name, size, pad } of sizes) {
  const out = resolve(srcDir, name);
  let pipeline = sharp(input.input, isSvg ? { density: input.density } : undefined)
    .resize(size, size, {
      fit: 'contain',
      background: pad ? ICON_BG : { r: 0, g: 0, b: 0, alpha: 0 },
    });
  if (pad) {
    pipeline = pipeline.flatten({ background: ICON_BG });
  }
  const info = await pipeline.png({ quality: 95 }).toFile(out);
  console.log(`  ${name}: ${info.width}x${info.height} (${(info.size / 1024).toFixed(1)} KB)`);
}

// OG image (1200x630) with logo centered + background
const ogOut = resolve(srcDir, 'og.png');
const ogInfo = await sharp({
  create: {
    width: 1200,
    height: 630,
    channels: 4,
    background: { r: 15, g: 23, b: 42, alpha: 1 }, // slate-900 background
  },
})
  .composite([
    {
      input: await sharp(input.input, isSvg ? { density: input.density } : undefined)
        .resize(400, 400, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer(),
      gravity: 'center',
    },
  ])
  .png({ quality: 95 })
  .toFile(ogOut);
console.log(`  og.png: ${ogInfo.width}x${ogInfo.height} (${(ogInfo.size / 1024).toFixed(1)} KB)`);

console.log('\nDone. Assets written to public/straight/');
