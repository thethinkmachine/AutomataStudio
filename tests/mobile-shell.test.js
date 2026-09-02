import test from 'node:test';
import assert from 'node:assert';
import { createHarness, dispatchDocumentEvent } from './harness.js';

const harness = createHarness();
const { context, getElement } = harness;

// Everything below 900px. The stub has no media queries, so `matchMedia` is
// installed per test the way tests/canvas-overlays.test.js does it — the
// module asks it directly (isMobileShell) and through ui.js
// (isMobilePanelLayout, isCompactToolbarMode), and all three read the same
// answer.
function onMobile(fn) {
  const real = context.matchMedia;
  context.matchMedia = () => ({ matches: true });
  try { return fn(); } finally { context.matchMedia = real; }
}

/** The bar's cells, as the markup wires them. */
function seedBar() {
  harness.resetApp();
  const cells = ['pointer', 'state', 'trans'].map(tool => {
    const el = getElement(`mobile-tool-${tool}`);
    el.setAttribute('data-mobile-tool', tool);
    return el;
  });
  // querySelectorAll is what syncMobileTools walks.
  const doc = context.document;
  const realQSA = doc.querySelectorAll;
  doc.querySelectorAll = sel => (sel === '[data-mobile-tool]' ? cells : realQSA.call(doc, sel));
  return { cells, restore: () => { doc.querySelectorAll = realQSA; } };
}

// ── the tool cells ────────────────────────────────────────────────
//
// The bar is not a second implementation of the toolbox: it calls `toggleTool`
// and is painted by `setTool`, so the two surfaces cannot come to disagree
// about which mode the canvas is in.

test('setTool marks the bar cell for the tool that is on', () => {
  const { cells, restore } = seedBar();
  try {
    context.setTool('state');
    assert.deepStrictEqual(cells.map(c => c.classList.contains('is-on')), [false, true, false]);
    assert.deepStrictEqual(cells.map(c => c.getAttribute('aria-pressed')), ['false', 'true', 'false'],
      'and says so to a screen reader, which cannot see the fill');
    context.setTool('pointer');
    assert.deepStrictEqual(cells.map(c => c.classList.contains('is-on')), [true, false, false]);
  } finally { restore(); }
});

// Divider and Region live behind More and have no cell of their own, so with
// one of them on every cell is unmarked. That is the honest report — the mode
// the canvas is in is not one of the three on the bar — and it is strictly
// better than lighting the nearest cell, which would claim a mode that is off.
test('a tool with no cell leaves every cell unmarked', () => {
  const { cells, restore } = seedBar();
  try {
    context.setTool('divider');
    assert.ok(cells.every(c => !c.classList.contains('is-on')));
    assert.strictEqual(context.App.tool, 'divider', 'the tool itself still changed');
  } finally { restore(); }
});

// ── the panel cell ────────────────────────────────────────────────

test('the panel cell names the tab it will open, not a container', () => {
  harness.resetApp();
  context.localStorage.setItem('automata-mobile-tab', 'workspace');
  assert.strictEqual(context.preferredMobileTab(), 'workspace');
  context.localStorage.setItem('automata-mobile-tab', 'statemate');
  assert.strictEqual(context.preferredMobileTab(), 'statemate');
});

test('an unknown remembered tab falls back rather than coercing silently', () => {
  harness.resetApp();
  context.localStorage.setItem('automata-mobile-tab', 'nonesuch');
  assert.strictEqual(context.preferredMobileTab(), 'inspector');
  context.localStorage.removeItem('automata-mobile-tab');
  assert.strictEqual(context.preferredMobileTab(), 'inspector');
});

// While a sheet is up the cell is that sheet's own toggle, so it has to name
// what is on screen — otherwise one button means two different things
// depending on state the reader cannot see.
test('an open sheet outranks the remembered preference', () => {
  harness.resetApp();
  context.localStorage.setItem('automata-mobile-tab', 'statemate');
  getElement('lpanel').dataset.mobileCollapsed = '1';
  getElement('rpanel').dataset.mobileCollapsed = '1';
  assert.strictEqual(context.mobileBarTabName(), 'statemate');

  context.setActivePanelTab('lpanel', 'workspace');
  getElement('lpanel').dataset.mobileCollapsed = '0';
  assert.strictEqual(context.mobileBarTabName(), 'workspace',
    'the cell names the sheet that is showing');
});

// ── where the preference lives ────────────────────────────────────
//
// Never App.config, which is deep-copied into every workspace tab and written
// to IndexedDB — a phone-shaped preference stored there would travel to the
// next reader of a .json file and quietly re-answer a question they had
// answered for themselves. This is the same assertion StateMate's settings key
// carries, for the same reason.

test('the mobile tab preference reaches none of the serializers', () => {
  harness.resetApp();
  context.localStorage.setItem('automata-mobile-tab', 'statemate');
  const blobs = [
    JSON.stringify(context.exportWorkspaceState()),
    JSON.stringify(context.getWorkspaceData()),
    JSON.stringify(context.getEditorSettingsData())
  ];
  for (const blob of blobs) {
    assert.ok(!blob.includes('automata-mobile-tab'), 'the key itself must not travel');
    assert.ok(!blob.includes('mobileTab'), 'and neither must a field standing in for it');
  }
});

// ── the sheet ─────────────────────────────────────────────────────

test('the sheet opens at half and the detent is written to both panels', () => {
  harness.resetApp();
  context.setMobileSheetDetent('full');
  assert.strictEqual(context.mobileSheetDetent(), 'full');
  assert.strictEqual(getElement('lpanel').dataset.detent, 'full');
  assert.strictEqual(getElement('rpanel').dataset.detent, 'full',
    'both sheets carry it, because switching tabs switches sheets');

  context.setMobileSheetDetent('half');
  assert.strictEqual(getElement('rpanel').dataset.detent, 'half');
});

test('an unknown detent falls back to half rather than to nothing', () => {
  harness.resetApp();
  context.setMobileSheetDetent('enormous');
  assert.strictEqual(context.mobileSheetDetent(), 'half');
});

// The chrome is injected rather than written into both panels' markup — the
// same reasoning as installModalChrome() — so it has to be idempotent, and the
// flag has to be set last: a throw halfway through must leave a sheet
// un-chromed rather than half-chromed.
test('the sheet head is injected once per panel', () => {
  harness.resetApp();
  onMobile(() => {
    context.initMobileShell();
    context.initMobileShell();
  });
  for (const id of ['lpanel', 'rpanel']) {
    const heads = getElement(id).children.filter(c => c.className?.includes?.('mobile-sheet-head'));
    assert.strictEqual(heads.length, 1, `${id} has exactly one head`);
  }
});

// One bar cell can only stand for three surfaces if the other two are visible
// the moment the sheet opens. The strip lists *every* tab, not the hosting
// panel's own — the three live on two panels, so switching is a change of
// sheet, which toggleMobilePanelTab already knows how to do.
test('the sheet head lists every tab, not just its own panel\'s', () => {
  harness.resetApp();
  onMobile(() => context.initMobileShell());
  const head = getElement('rpanel').children.find(c => c.className?.includes?.('mobile-sheet-head'));
  assert.ok(head, 'the head was injected');
  for (const name of context.PANEL_TAB_NAMES) {
    assert.ok(head.innerHTML.includes(`data-sheet-tab="${name}"`), `${name} is on the strip`);
  }
});

// ── the More popover ──────────────────────────────────────────────

test('the More popover opens, and Escape closes it', () => {
  harness.resetApp();
  onMobile(() => {
    context.initMobileShell();
    assert.strictEqual(context.isMobileMoreOpen(), false);
    context.toggleMobileMore();
    assert.strictEqual(context.isMobileMoreOpen(), true);
    assert.strictEqual(getElement('mobile-more-btn').getAttribute('aria-expanded'), 'true');
    // Driven through the real document listener rather than by calling
    // hideMobileMore: the popover is one of several things in the app that
    // claims Escape, and whether this one gets it is a question about
    // registration, not about the function it ends up calling.
    dispatchDocumentEvent('keydown', { key: 'Escape' });
    assert.strictEqual(context.isMobileMoreOpen(), false);
    assert.strictEqual(getElement('mobile-more-btn').getAttribute('aria-expanded'), 'false');
  });
});

// A tap anywhere else dismisses it, the way every other .ctx menu in the app
// behaves — and bubble-phase, so the bar's own cells still get their click.
test('a tap elsewhere dismisses the More popover', () => {
  harness.resetApp();
  onMobile(() => {
    context.initMobileShell();
    context.toggleMobileMore();
    assert.strictEqual(context.isMobileMoreOpen(), true);
    dispatchDocumentEvent('click', {});
    assert.strictEqual(context.isMobileMoreOpen(), false);
  });
});

// ── the workspace button ──────────────────────────────────────────

test('the header button names the active workspace and its unsaved mark', () => {
  harness.resetApp();
  context.initTabs();
  context.syncMobileWorkspaceButton();
  const name = getElement('mobile-ws-name').textContent;
  assert.ok(name && name.length, 'a name is printed');
  assert.strictEqual(getElement('mobile-ws-dirty').hidden, true, 'a clean workspace has no mark');

  const ws = context.Workspaces[0];
  ws.dirty = true;
  context.syncMobileWorkspaceButton();
  assert.strictEqual(getElement('mobile-ws-dirty').hidden, false);
});

// The strip is hidden below 900px, so this button is the only list of
// workspaces there — and `updateTabOverflowShadows` used to gate it on the
// strip being a scroller, which mobile.css makes it not. It retired itself on
// exactly the screen that needed it.
test('the jump-to-workspace button is offered on mobile with one workspace', () => {
  harness.resetApp();
  const tb = getElement('tab-bar');
  tb.scrollWidth = 100;
  tb.clientWidth = 100;   // no overflow at all
  const btn = getElement('tab-overflow-btn');

  context.updateTabOverflowShadows(tb);
  assert.strictEqual(btn.classList.contains('show'), false, 'a desktop with room hides it');

  onMobile(() => context.updateTabOverflowShadows(tb));
  assert.strictEqual(btn.classList.contains('show'), true,
    'below 900px it is the only way to reach another workspace');
});
