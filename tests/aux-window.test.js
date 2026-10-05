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

// ── The last view, reopened from the header ──

function lastView(h, id = 'hdr-last-view') {
  return h.getElement(id);
}

test('the header button names the view the window showed last, Library before any', () => {
  const h = createHarness();
  // The remembered view is module state an earlier test may have set, so the
  // Library default is pinned on the source rather than observed here.
  assert.match(readFileSync(join(ROOT, 'js/view.js'), 'utf8'),
    /AUX_VIEWS\.includes\(v\) \? v : AUX_VIEWS\[0\]/);
  h.context.setView('build');
  const btn = lastView(h);
  h.context.setView('grammar');
  h.context.setView('build');
  assert.equal(btn.dataset.view, 'grammar');
  assert.match(btn.innerHTML, /Grammar/);
  assert.equal(btn.getAttribute('aria-label'), 'Open Grammar');
  assert.equal(btn.getAttribute('data-tip-kbd'), h.context.auxViewKey('grammar'));
  assert.equal(h.context.localStorage.getItem('automata-aux-last'), 'grammar');
});

test('pressing it opens that view, and on a phone a second press puts it away', () => {
  const h = createHarness();
  h.context.setView('reference');
  h.context.setView('build');
  lastView(h)._listeners.click();
  assert.equal(h.context.App.view, 'reference');
  assert.equal(lastView(h).classList.contains('is-open'), true);
  lastView(h, 'mobile-last-view')._listeners.click();
  assert.equal(h.context.App.view, 'build');
  assert.equal(lastView(h, 'mobile-last-view').classList.contains('is-open'), false);
});

test('the desktop and phone buttons always name the same view', () => {
  const h = createHarness();
  for (const v of h.context.AUX_VIEWS) {
    h.context.setView(v);
    h.context.setView('build');
    assert.equal(lastView(h).dataset.view, v);
    assert.equal(lastView(h, 'mobile-last-view').dataset.view, v);
  }
});

test('the button and the tab chevron sit inside the strip frame, outside the scroller', () => {
  const strip = html.slice(html.indexOf('<div class="tab-strip"'), html.indexOf('<!-- The workspace strip, for a screen'));
  const scroller = strip.indexOf('<div id="tab-bar"');
  assert.ok(scroller > 0, 'the scroller is inside the frame');
  const scrollerEnd = strip.indexOf('</div>', scroller);
  for (const id of ['tab-overflow-btn', 'hdr-last-view']) {
    const at = strip.indexOf(`id="${id}"`);
    assert.ok(at > scrollerEnd, `${id} is in the frame, after the scroller`);
  }
  // The frame holds the border, so nothing in it scrolls away with the tabs.
  const layout = readFileSync(join(ROOT, 'css/layout.css'), 'utf8');
  const rule = name => (layout.match(new RegExp(`\\n${name.replace('.', '\\.')} \\{[^}]*\\}`)) || [''])[0];
  assert.match(rule('.tab-strip'), /border: 1px solid/);
  assert.doesNotMatch(rule('.tab-bar'), /border:/);
});

test('on a phone the button shares the workspace pill', () => {
  const pill = html.slice(html.indexOf('<div class="mobile-ws-pill"'));
  const end = pill.indexOf('id="mobile-last-view"');
  assert.ok(pill.indexOf('id="mobile-ws-btn"') > 0 && pill.indexOf('id="mobile-ws-btn"') < end);
});

// ── The window is modal ──

test('canvas shortcuts do not reach the canvas under the window', () => {
  const h = createHarness();
  const { App } = h.context;
  App.states.push({ id: 'q0', name: 'q0', x: 0, y: 0 }, { id: 'q1', name: 'q1', x: 100, y: 0 });
  App.selectedStates.add('q0');
  h.context.setView('library');
  // Delete used to remove the selected state from behind the Library.
  h.dispatchDocumentEvent('keydown', { key: 'Delete' });
  assert.equal(App.states.length, 2);
  const tool = App.tool;
  h.dispatchDocumentEvent('keydown', { key: 's' });
  assert.equal(App.tool, tool);
  // The window's own keys still work: a digit moves along the strip.
  h.dispatchDocumentEvent('keydown', { key: h.context.auxViewKey('reference') });
  assert.equal(App.view, 'reference');
  // And on the canvas, the same key does what it always did.
  h.context.setView('build');
  App.selectedStates.add('q0');
  h.dispatchDocumentEvent('keydown', { key: 'Delete' });
  assert.equal(App.states.length, 1);
});

test('Escape from a field inside the window closes it, unless the field took it', () => {
  const h = createHarness();
  const field = (extra = {}) => ({
    tagName: 'INPUT', type: 'text', value: '',
    closest: sel => (sel === '#aux-overlay' ? h.getElement('aux-overlay') : null),
    ...extra
  });
  h.context.setView('algo');
  // A completion list that consumed the key has said so.
  h.dispatchDocumentEvent('keydown', { key: 'Escape', target: field(), defaultPrevented: true });
  assert.equal(h.context.App.view, 'algo');
  // A search box with text in it: Escape empties it first.
  h.dispatchDocumentEvent('keydown', { key: 'Escape', target: field({ type: 'search', value: 'nfa' }) });
  assert.equal(h.context.App.view, 'algo');
  h.dispatchDocumentEvent('keydown', { key: 'Escape', target: field() });
  assert.equal(h.context.App.view, 'build');
});

test('a message sent from inside the window is shown in the window', () => {
  const h = createHarness();
  h.context.setView('grammar');
  h.context.showStatus('Grammar copied');
  assert.equal(h.getElement('aux-status').textContent, 'Grammar copied');
  assert.equal(h.getElement('aux-status').classList.contains('show'), true);
  h.context.setView('build');
  h.context.showStatus('Machine: DFA');
  assert.equal(h.getElement('status-bar').textContent, 'Machine: DFA');
});

test('popovers the window opens are drawn above it, and the phone header menus too', () => {
  const views = css.replace(/\r\n/g, '\n');
  const layout = readFileSync(join(ROOT, 'css/layout.css'), 'utf8').replace(/\r\n/g, '\n');
  const z = (src, selector) => {
    const at = src.indexOf(`\n${selector} {`);
    assert.ok(at >= 0, selector);
    return Number(src.slice(at, src.indexOf('}', at)).match(/z-index: (\d+)/)[1]);
  };
  assert.ok(z(views, '.sym-suggest') > z(views, '.aux-overlay'), 'the symbol popover completes fields inside the window');
  // On a phone the window sits under the header's stacking context, which
  // caps every menu the header drops at the header's own z-index.
  const header = z(layout, 'header');
  const phone = views.slice(views.indexOf('@media (max-width: 900px) {\n  /* Full-screen below the header'));
  const phoneZ = Number(phone.slice(0, phone.indexOf('\n  }')).match(/z-index: (\d+)/)[1]);
  assert.ok(phoneZ < header, `phone window z ${phoneZ} must be under the header's ${header}`);
});
