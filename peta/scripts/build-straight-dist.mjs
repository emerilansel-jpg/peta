// scripts/build-straight-dist.mjs
// Creates a dist-straight folder where index.html is straight.html,
// ensuring Cloudflare Pages project 'straight' serves Straight branding statically to all crawlers & visitors.

import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const straightDistDir = path.resolve('dist-straight');

if (!fs.existsSync(distDir)) {
  console.error('Error: dist directory does not exist. Run vite build first.');
  process.exit(1);
}

// Clean and recreate dist-straight
fs.rmSync(straightDistDir, { recursive: true, force: true });
fs.cpSync(distDir, straightDistDir, { recursive: true });

// Overwrite index.html with straight.html
const straightHtmlPath = path.join(distDir, 'straight.html');
const straightIndexPath = path.join(straightDistDir, 'index.html');

if (!fs.existsSync(straightHtmlPath)) {
  console.error('Error: dist/straight.html not found!');
  process.exit(1);
}

fs.copyFileSync(straightHtmlPath, straightIndexPath);
console.log('✓ Successfully created dist-straight with straight.html as index.html');
