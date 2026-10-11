import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// index.html's Content-Security-Policy. Its point is the one thing it leaves
// out: 'unsafe-inline' in script-src, so an on*="..." attribute or a <script>
// that reaches the page through rendered content does not run. That was not
// possible while the UI was wired through inline handlers (CLAUDE.md, "Wiring
// controls"). The two inline scripts the page does need are allowed by hash.

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
  assert.ok(actual.length, 'the theme bootstrap and the tag setup are inline');
  assert.deepEqual(listed, actual);
});

test('the inline scripts hash the same on every checkout', () => {
  // A CRLF checkout changes the bytes the hash is taken over; .gitattributes
  // pins index.html to LF so the Windows build hashes what this file does.
  for (const script of inlineScripts()) assert.ok(!script.includes('\r'));
  assert.match(readFileSync(join(ROOT, '.gitattributes'), 'utf8'), /^index\.html\s+text\s+eol=lf$/m);
});

test('the policy comes before any script, and every script host is allowed', () => {
  // A meta CSP governs only what is parsed after it.
  assert.ok(html.indexOf('http-equiv="Content-Security-Policy"') < html.indexOf('<script'));
  const allowed = policy()['script-src'];
  for (const [, url] of html.matchAll(/<script\b[^>]*\bsrc="(https?:[^"]+)"/g)) {
    const origin = new URL(url).origin;
    assert.ok(allowed.includes(origin), `${origin} is loaded but not allowed`);
  }
});

test('the label kernel is allowed to compile', () => {
  // js/label-wasm.js compiles its bytes with new WebAssembly.Module, which a
  // script-src without 'wasm-unsafe-eval' refuses.
  assert.match(readFileSync(join(ROOT, 'js', 'label-wasm.js'), 'utf8'), /new WebAssembly\.Module/);
  assert.ok(policy()['script-src'].includes("'wasm-unsafe-eval'"));
});
