import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { formatKbd } from '../js/kbd.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// A shortcut label is a platform-neutral spec, written as text in one place.
// The app spoke three dialects of it — `Ctrl+Z`, `⌘Z` on Linux, `Ctrl/Cmd+B` —
// while every key handler read `ctrlKey || metaKey` the same way everywhere.

test('a spec reads as the platform writes it', () => {
  assert.equal(formatKbd('Mod+Shift+T', false), 'Ctrl+Shift+T');
  assert.equal(formatKbd('Mod+Shift+T', true), '⌘⇧T');
  // `Ctrl` is `Mod`, because that is what the handlers make of it.
  assert.equal(formatKbd('Ctrl+Z', true), '⌘Z');
  assert.equal(formatKbd('Ctrl+Z', false), 'Ctrl+Z');
});

test('the zoom keys and a gesture survive the separator', () => {
  for (const apple of [false, true]) {
    assert.equal(formatKbd('+', apple), '+');
    assert.equal(formatKbd('-', apple), '-');
    assert.equal(formatKbd('Space+Drag', apple), 'Space+Drag');
  }
});

test('no label in the markup hard-codes a platform', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  // Visible text only: a data-kbd element's own text is the non-Apple
  // fallback, written over at boot.
  assert.doesNotMatch(html, /⌘|Ctrl\/Cmd/, 'a ⌘ or a Ctrl/Cmd hedge written into the page');
});
