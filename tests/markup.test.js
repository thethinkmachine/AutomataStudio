import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

// A tooltip is aria-hidden (js/tooltip.js), so `data-tip` names a control for
// the eye and for nobody else. An icon button that carries only that has no
// accessible name at all: the canvas zoom bar and the player's five transport
// buttons were each announced as "button".
test('every icon-only button with a tooltip also has an accessible name', () => {
  const unnamed = [];
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const [, attrs, inner] = m;
    if (!/\bdata-tip="/.test(attrs)) continue;
    if (/\baria-label(ledby)?="/.test(attrs)) continue;
    if (inner.replace(/<[^>]*>/g, '').trim()) continue;
    unnamed.push((attrs.match(/data-tip="([^"]*)"/) || [])[1]);
  }
  assert.deepEqual(unnamed, [], `icon buttons announced as just "button": ${unnamed.join(', ')}`);
});
