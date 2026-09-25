// Bundles the game into a single self-contained HTML page.
//   dist/solharbor.html          full standalone document (open locally)
//   dist/solharbor-artifact.html content-only page for the Artifact publisher (no doctype/html/head/body)
import * as esbuild from 'esbuild';
import fs from 'fs';
import { execFileSync } from 'child_process';

// the character meshes are generated (tools/bake-humans.mjs); bake them on a fresh clone
if (!fs.existsSync('src/generated/humans.bin.js')) execFileSync(process.execPath, ['tools/bake-humans.mjs'], { stdio: 'inherit' });

const res = await esbuild.build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false,
  legalComments: 'eof', logLevel: 'warning', define: { 'process.env.NODE_ENV': '"production"' },
});
let js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const FONTS = 'https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&family=Big+Shoulders+Display:wght@500;700;800&display=swap';
const head = `<title>Sol Harbor</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>
:root{color-scheme:dark;--ink:#07060d;--sun:#ff7a3d;--gold:#ffd36b;--tide:#3dd6c6;--coral:#ff5e62;--sand:#ffd9b8}
html,body{height:100%;margin:0;background:var(--ink);color:var(--sand);overflow:hidden;overscroll-behavior:none}
#app{position:fixed;inset:0;background:var(--ink)}
canvas:focus{outline:none}
</style>`;
const bodyHTML = `<div id="app"></div>\n<script>${js}</script>`;
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/solharbor-artifact.html', `${head}\n${bodyHTML}\n`);
fs.writeFileSync('dist/solharbor.html', `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="theme-color" content="#07060d">\n${head}\n</head><body>\n${bodyHTML}\n</body></html>\n`);
const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log('bundle', kb(js.length), '-> dist/solharbor.html', kb(fs.statSync('dist/solharbor.html').size));
