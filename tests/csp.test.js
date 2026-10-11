import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MEASUREMENT_ID } from '../js/analytics.js';

// index.html's Content-Security-Policy. Its point is the one thing it leaves
// out: 'unsafe-inline' in script-src, so an on*="..." attribute or a <script>
// that reaches the page through rendered content does not run. That was not
// possible while the UI was wired through inline handlers (CLAUDE.md, "Wiring
// controls"). The one inline script the page needs — the theme bootstrap,
// which has to run before first paint — is allowed by hash.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

function policy() {
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  assert.ok(meta, 'index.html must carry a CSP meta tag');
  return Object.fromEntries(meta[1].split(';').map(d => d.trim()).filter(Boolean).map(d => {
    const [name, ...sources] = d.split(/\s+/);
    return [name, sources];
  }));
}

const inlineScripts = () => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const sha256 = text => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

test('script-src allows no inline code and no eval', () => {
  const src = policy()['script-src'];
  assert.ok(src, 'the policy restricts scripts');
  assert.ok(!src.includes("'unsafe-inline'"), "'unsafe-inline' would let any on* attribute run");
  assert.ok(!src.includes("'unsafe-eval'"));
  assert.ok(!src.includes("'unsafe-hashes'"));
  assert.deepEqual(policy()['object-src'], ["'none'"]);
  assert.deepEqual(policy()['base-uri'], ["'self'"]);
});

test('the policy lists exactly the hashes of the inline scripts the page has', () => {
  // Edit an inline script and this fails until its new hash replaces the old
  // one: the browser would otherwise refuse it without a word.
  const listed = policy()['script-src'].filter(s => s.startsWith("'sha256-")).sort();
  const actual = inlineScripts().map(sha256).sort();
  assert.ok(actual.length, 'the theme bootstrap is inline');
  assert.deepEqual(listed, actual);
});

test('the inline scripts hash the same on every checkout', () => {
  // A CRLF checkout changes the bytes the hash is taken over; .gitattributes
  // pins index.html to LF so the Windows build hashes what this file does.
  for (const script of inlineScripts()) assert.ok(!script.includes('\r'));
  assert.match(readFileSync(join(ROOT, '.gitattributes'), 'utf8'), /^index\.html\s+text\s+eol=lf$/m);
});

// How a CSP host source matches a URL: a source ending in / admits that
// folder and below; one with no path admits the whole host.
function admits(source, url) {
  if (!source.startsWith('https://')) return false;
  const u = new URL(url), s = new URL(source);
  if (u.origin !== s.origin) return false;
  if (s.pathname === '/') return true;
  return s.pathname.endsWith('/') ? u.pathname.startsWith(s.pathname) : u.pathname === s.pathname;
}

test('the policy comes before any script, and every script it loads is admitted', () => {
  // A meta CSP governs only what is parsed after it.
  assert.ok(html.indexOf('http-equiv="Content-Security-Policy"') < html.indexOf('<script'));
  const allowed = policy()['script-src'];
  const loaded = [...html.matchAll(/<script\b[^>]*\bsrc="(https?:[^"]+)"/g)].map(m => m[1]);
  loaded.push(`https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`); // js/analytics.js
  for (const url of loaded) {
    assert.ok(allowed.some(src => admits(src, url)), `${url} is loaded but not admitted`);
  }
});

test('the CDN is admitted by folder, never as a host', () => {
  // jsDelivr serves any package anyone has published to npm, so a host source
  // would admit a script element pointing at one. Only KaTeX's folder is.
  const cdn = policy()['script-src'].filter(src => src.startsWith('https://cdn.jsdelivr.net'));
  assert.deepEqual(cdn, ['https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/']);
});

test('every file from the CDN carries an integrity hash', () => {
  // Within the folder, a file that does not hash to what was published is refused.
  const tags = [...html.matchAll(/<(?:script|link)\b[^>]*https:\/\/cdn\.jsdelivr\.net[^>]*>/g)].map(m => m[0]);
  assert.equal(tags.length, 3, 'katex.min.css, katex.min.js and auto-render.min.js');
  for (const tag of tags) {
    assert.match(tag, /\bintegrity="sha384-[A-Za-z0-9+/=]+"/, tag);
    assert.match(tag, /\bcrossorigin="anonymous"/, `${tag} — integrity on a cross-origin file needs CORS`);
  }
});

test('the label kernel is allowed to compile', () => {
  // js/label-wasm.js compiles its bytes with new WebAssembly.Module, which a
  // script-src without 'wasm-unsafe-eval' refuses.
  assert.match(readFileSync(join(ROOT, 'js', 'label-wasm.js'), 'utf8'), /new WebAssembly\.Module/);
  assert.ok(policy()['script-src'].includes("'wasm-unsafe-eval'"));
});
