#!/usr/bin/env node
// Production build: bundles, minifies, and lightly obfuscates the app for deployment.
//
// The app is a classic (non-module) multi-<script> page: every top-level function/const
// in js/*.js lives in one shared global scope, and ~230 inline onclick/onchange/... HTML
// attributes call ~114 of those globals by name. That means top-level identifiers must
// NEVER be renamed — only local (function-scope) identifiers, string literals, and
// whitespace/dead-code are fair game. Terser's `mangle.toplevel` defaults to false and
// javascript-obfuscator's `renameGlobals` defaults to false, so both tools already honor
// this constraint; we still set the options explicitly below so the intent is documented.

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify as minifyJS } from 'terser';
import JavaScriptObfuscator from 'javascript-obfuscator';
import CleanCSS from 'clean-css';
import { minify as minifyHTML } from 'html-minifier-terser';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const hash8 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8);

function extractLocalTags(html, tagRegex, srcAttr) {
  const matches = [...html.matchAll(tagRegex)];
  const local = matches
    .map((m) => m[0])
    .filter((tag) => !/https?:\/\//.test(tag));
  const files = local.map((tag) => tag.match(new RegExp(`${srcAttr}="([^"]+)"`))[1]);
  return { block: local, files };
}

async function main() {
  console.log('Building production bundle...');
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, 'assets'), { recursive: true });

  let html = read('index.html');

  // ---- CSS: concatenate local stylesheets in document order, then minify ----
  const cssTagRe = /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g;
  const { block: cssBlock, files: cssFiles } = extractLocalTags(html, cssTagRe, 'href');
  const cssSource = cssFiles.map((f) => read(f)).join('\n');
  const cssResult = new CleanCSS({ level: 2 }).minify(cssSource);
  if (cssResult.errors.length) throw new Error('CSS minify failed: ' + cssResult.errors.join('\n'));
  const cssHash = hash8(cssResult.styles);
  const cssOut = `assets/app.${cssHash}.css`;
  writeFileSync(join(DIST, cssOut), cssResult.styles);
  console.log(`CSS: ${(cssSource.length / 1024).toFixed(1)}kB -> ${(cssResult.styles.length / 1024).toFixed(1)}kB`);

  // ---- JS: concatenate local scripts in document order, minify, then obfuscate ----
  const jsTagRe = /<script[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g;
  const { block: jsBlock, files: jsFiles } = extractLocalTags(html, jsTagRe, 'src');
  const jsSource = jsFiles.map((f) => `// ---- ${f} ----\n${read(f)}`).join('\n;\n');

  const terserResult = await minifyJS(jsSource, {
    compress: { passes: 2 },
    mangle: { toplevel: false }, // never rename globals referenced by onclick="..." etc.
    format: { comments: false },
  });
  if (!terserResult.code) throw new Error('Terser produced no output');

  const obfuscated = JavaScriptObfuscator.obfuscate(terserResult.code, {
    compact: true,
    renameGlobals: false, // safety net on top of mangle.toplevel:false above
    identifierNamesGenerator: 'hexadecimal',
    stringArray: true,
    stringArrayThreshold: 0.75,
    stringArrayEncoding: ['base64'],
    splitStrings: false,
    numbersToExpressions: false,
    simplify: true,
    controlFlowFlattening: false, // would hurt perf on the canvas render loop
    deadCodeInjection: false,
    selfDefending: false, // brittle around further processing/CDN rewrites; skip for reliability
    debugProtection: false,
  }).getObfuscatedCode();

  const jsHash = hash8(obfuscated);
  const jsOut = `assets/app.${jsHash}.js`;
  writeFileSync(join(DIST, jsOut), obfuscated);
  console.log(`JS:  ${(jsSource.length / 1024).toFixed(1)}kB -> ${(terserResult.code.length / 1024).toFixed(1)}kB (minified) -> ${(obfuscated.length / 1024).toFixed(1)}kB (obfuscated)`);

  // ---- HTML: swap the per-file tag blocks for single bundled tags, then minify ----
  // Paths are relative (no leading slash) so the build works when served from a
  // subpath, e.g. a GitHub Pages project site at /<repo>/ rather than domain root.
  html = html.replace(cssBlock.join('\n  '), `<link rel="stylesheet" href="${cssOut}">`);
  for (const tag of cssBlock) html = html.replace(tag, '');
  html = html.replace(/^\s*\n/gm, ''); // tidy up blank lines left behind
  html = html.replace(jsBlock[0], `<script src="${jsOut}"></script>`);
  for (let i = 1; i < jsBlock.length; i++) html = html.replace(jsBlock[i], '');

  const minifiedHTML = await minifyHTML(html, {
    collapseWhitespace: true,
    conservativeCollapse: false,
    removeComments: true,
    minifyCSS: true,
    minifyJS: true,
    removeAttributeQuotes: false,
    keepClosingSlash: true,
  });
  writeFileSync(join(DIST, 'index.html'), minifiedHTML);
  console.log(`HTML: ${(html.length / 1024).toFixed(1)}kB -> ${(minifiedHTML.length / 1024).toFixed(1)}kB`);

  // ---- static assets fetched at runtime (js/examples/*.json) ----
  mkdirSync(join(DIST, 'js', 'examples'), { recursive: true });
  for (const f of readdirSync(join(ROOT, 'js', 'examples'))) {
    cpSync(join(ROOT, 'js', 'examples', f), join(DIST, 'js', 'examples', f));
  }

  console.log(`\nDone. Output in ${DIST}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
