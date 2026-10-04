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

// The header lockup is the way to About, and its hover byline is a miniature
// of that dialog's header. Two copies of one credit drift apart unless
// something holds them together: the name is typed in both places.
test('the header logo opens About and credits the same author', () => {
  const header = html.match(/<header>[\s\S]*?<\/header>/)[0];
  const logo = header.match(/<button\b([^>]*class="logo-wrapper"[^>]*)>([\s\S]*?)<\/button>/);
  assert.ok(logo, 'the header lockup is a button');
  const [, attrs, inner] = logo;
  assert.match(attrs, /onclick="openAboutModal\(\)"/, 'clicking the logo opens About');
  assert.match(attrs, /aria-label="[^"]+"/, 'the button names itself, since its visible text is aria-hidden');

  const byline = inner.match(/<span class="logo-author logo-byline">by ([^<]+)<\/span>/);
  assert.ok(byline, 'the lockup carries a byline');
  const about = html.match(/<div class="logo-author">([^<]+)<\/div>/);
  assert.ok(about, 'the About dialog credits its author');
  assert.equal(byline[1], about[1], 'the hover byline names the author About does');
  assert.ok(attrs.includes(about[1]), 'and so does the label a screen reader hears');
});
