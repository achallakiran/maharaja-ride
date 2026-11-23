// Bundles src/main.ts + three.js + CSS into ONE offline HTML file (no CDN).
// `npm run build` -> dist/index.html. `npm run release` also copies it to the repo root for GitHub Pages.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';

const release = process.argv.includes('--release');
const [html, css, bundle] = await Promise.all([
  readFile('src/template.html', 'utf8'),
  readFile('src/style.css', 'utf8'),
  build({ entryPoints: ['src/main.ts'], bundle: true, minify: true, write: false, format: 'iife', target: ['es2022', 'safari16'], legalComments: 'none' }),
]);
const js = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const output = html.replace('/* STYLE */', () => css).replace('/* BUNDLE */', () => js);
await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', output);
await writeFile('dist/.nojekyll', '');
if (release) {
  await copyFile('dist/index.html', 'index.html');
  await writeFile('.nojekyll', '');
}
console.log(`built ${(output.length / 1024).toFixed(0)} KB${release ? ' (copied to repo root)' : ''}`);
