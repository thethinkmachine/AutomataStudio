import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHarness } from './harness.js';

// The window Algorithms, Grammar, Reference and Library share.
//
// Its bar is a tab strip across the four, so moving between them no longer
// means closing the window and reopening it from the header's More menu. What
// that has to get right: exactly one tab is selected and it is the open view,
// the strip is one Tab stop, the arrow keys walk it, maximize is remembered,
// and the machine chip appears only where the view reads the canvas.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'css/views.css'), 'utf8');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

function tabs(h) {
  return Array.from(h.getElement('aux-tabs').children).filter(t => t.dataset && t.dataset.auxView);
}

function selected(h) {
  return tabs(h).filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.dataset.auxView);
}

test('the bar is one tab per view, in AUX_VIEWS order, with the selected tab the open view', () => {
  const h = createHarness();
  h.context.setView('reference');
  assert.deepEqual(tabs(h).map(t => t.dataset.auxView), h.context.AUX_VIEWS);
  assert.deepEqual(selected(h), ['reference']);
  h.context.setView('grammar');
  assert.deepEqual(selected(h), ['grammar']);
  // Roving tabindex: the strip is one Tab stop, on the selected tab.
  assert.deepEqual(tabs(h).map(t => t.tabIndex), h.context.AUX_VIEWS.map(v => (v === 'grammar' ? 0 : -1)));
  h.context.setView('build');
});

test('the strip is built once, however many times the window opens', () => {
  const h = createHarness();
  h.context.setView('algo');
  h.context.setView('build');
  h.context.setView('library');
  assert.equal(tabs(h).length, h.context.AUX_VIEWS.length);
  h.context.setView('build');
});

test('clicking a tab switches the view inside the window', () => {
  const h = createHarness();
  h.context.setView('algo');
  const lib = tabs(h).find(t => t.dataset.auxView === 'library');
  lib._listeners.click();
  assert.equal(h.context.App.view, 'library');
  assert.equal(h.getElement('aux-overlay').classList.contains('open'), true);
  h.context.setView('build');
});

test('the arrow keys walk the strip and wrap at both ends', () => {
  const h = createHarness();
  const views = h.context.AUX_VIEWS;
  h.context.setView(views[views.length - 1]);
  const press = key => h.getElement('aux-tabs')._listeners.keydown({ key, preventDefault() {} });
  press('ArrowRight');
  assert.equal(h.context.App.view, views[0]);
  press('ArrowLeft');
  assert.equal(h.context.App.view, views[views.length - 1]);
  press('Home');
  assert.equal(h.context.App.view, views[0]);
  press('End');
  assert.equal(h.context.App.view, views[views.length - 1]);
  h.context.setView('build');
});

test('maximize is a toggle with one name, and it is remembered', () => {
  const h = createHarness();
  h.context.setView('reference');
  h.context.setAuxMaximized(true);
  const btn = h.getElement('aux-max-btn');
  assert.equal(h.getElement('aux-overlay').classList.contains('is-max'), true);
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.equal(h.context.localStorage.getItem('automata-aux-max'), '1');
  h.context.setAuxMaximized(false);
  assert.equal(h.getElement('aux-overlay').classList.contains('is-max'), false);
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  assert.equal(h.context.localStorage.getItem('automata-aux-max'), '0');
  assert.match(html, /id="aux-max-btn"[^>]*aria-label="Maximize"/);
  h.context.setView('build');
});

test('maximize does not apply on the phone layout, where the window is already full-screen', () => {
  const rule = css.indexOf('.aux-overlay.is-max {');
  assert.ok(rule > 0);
  const before = css.slice(0, rule);
  assert.ok(before.lastIndexOf('@media (min-width: 901px)') > before.lastIndexOf('}\n\n.'),
    'the .is-max size must sit inside the desktop media query');
});

test('the machine chip is shown for Algorithms only, and follows the canvas', () => {
  const h = createHarness();
  const ctx = h.getElement('aux-ctx');
  const text = () => Array.from(ctx.children).map(c => c.textContent).join(' ');
  h.context.setView('grammar');
  assert.equal(ctx.hidden, true);
  h.context.setView('algo');
  assert.equal(ctx.hidden, false);
  assert.match(text(), /^DFA empty canvas$/);
  h.context.App.states.push({ id: 'q0', name: 'q0', x: 0, y: 0 }, { id: 'q1', name: 'q1', x: 100, y: 0 });
  h.context.App.transitions.push({ id: 't0', from: 'q0', to: 'q1', on: 'a' });
  h.context.emit(h.context.Change.GRAPH);
  assert.match(text(), /2 states · 1 transition$/);
  h.context.setView('build');
  assert.equal(ctx.hidden, true);
});

test('the four rails share one width, set by the window rather than inline', () => {
  for (const id of ['algo-nav', 'gram-nav', 'ref-nav', 'lib-nav']) {
    const tag = html.match(new RegExp(`<div[^>]*id="${id}"[^>]*>`));
    assert.ok(tag, id);
    assert.doesNotMatch(tag[0], /style="[^"]*width/, `${id} sets its own width inline`);
  }
  assert.match(css, /\.aux-overlay \.algo-nav,\s*\.aux-overlay \.gram-nav,\s*\.aux-overlay \.ref-nav \{\s*width: var\(--aux-rail-w\);/);
});

test('Library comes first, and the More menu, the strip and the digits agree on the order', () => {
  const h = createHarness();
  assert.equal(h.context.AUX_VIEWS[0], 'library');
  const menu = [...html.matchAll(/onclick="setView\('(\w+)'\)">[\s\S]*?<span class="ctx-kbd-hint">(\d)<\/span>/g)]
    .map(m => [m[1], m[2]]);
  assert.deepEqual(menu, h.context.AUX_VIEWS.map(v => [v, h.context.auxViewKey(v)]));
  h.context.setView('library');
  assert.deepEqual(tabs(h).map(t => t.getAttribute('data-tip-kbd')), ['2', '3', '4', '5']);
  h.context.setView('build');
});
