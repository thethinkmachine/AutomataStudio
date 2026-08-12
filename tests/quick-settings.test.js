import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHarness } from './harness.js';

// The quick canvas settings popover.
//
// It is a shortcut into Settings rather than a second store, so the tests that
// matter are about the two staying in agreement: every row names a real control
// in the dialog, writing here lands in App.config, and applying the dialog
// re-reads the popover.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('every quick row mirrors a control that exists in the Settings dialog', () => {
  const h = createHarness();
  const rows = h.context.quickSettingsRows();
  assert.ok(rows.length > 0, 'the popover should have rows');

  for (const row of rows) {
    // A typo here is invisible at runtime: syncMirror would no-op forever and
    // the two surfaces would drift apart with nothing failing.
    assert.ok(html.includes(`id="${row.mirrors}"`),
      `${row.id} mirrors ${row.mirrors}, which is not in index.html`);
  }
});

test('the popover markup and its trigger exist', () => {
  assert.ok(html.includes('id="quick-settings"'));
  assert.ok(html.includes('id="quick-settings-btn"'));
  assert.ok(html.includes('toggleQuickSettings'), 'the button must be wired through the bridge');
});

test('changing a quick setting writes App.config', () => {
  const h = createHarness();
  const { App } = h.context;

  h.context.setQuickSetting('qs-edge-labels', 'none');
  assert.equal(App.config.edgeLabelStyle, 'none');

  h.context.setQuickSetting('qs-edge-labels', 'pills');
  assert.equal(App.config.edgeLabelStyle, 'pills');

  h.context.setQuickSetting('qs-smart-labels', false);
  assert.equal(App.config.render.smartLabels, false);

  h.context.setQuickSetting('qs-animate', false);
  assert.equal(App.config.render.animateLayout, false);
});

test('a junk edge-label value falls back rather than being stored', () => {
  const h = createHarness();
  h.context.setQuickSetting('qs-edge-labels', 'not-a-style');
  assert.equal(h.context.App.config.edgeLabelStyle, 'compact');
});

test('the snap row goes through toggleSnapToGrid, not a bare config write', () => {
  const h = createHarness();
  const { App } = h.context;

  h.context.setQuickSetting('qs-snap', true);
  assert.equal(App.config.snapToGrid, true);
  // toggleSnapToGrid also owns the nav button's active state; a plain config
  // write here would leave the button showing the opposite of the setting.
  assert.equal(h.getElement('snap-toggle-btn').classList.contains('active'), true);

  h.context.setQuickSetting('qs-snap', false);
  assert.equal(App.config.snapToGrid, false);
  assert.equal(h.getElement('snap-toggle-btn').classList.contains('active'), false);
});

test('writing a quick setting pushes the value into the Settings control', () => {
  const h = createHarness();
  // Opening the dialog is what puts the mirrored controls in the DOM.
  h.context.openSettingsModal();

  h.context.setQuickSetting('qs-edge-labels', 'beginner');
  assert.equal(h.getElement('set-edge-label-style').value, 'beginner',
    'a dialog open behind the popover must not keep a stale value and write it back on Apply');

  h.context.setQuickSetting('qs-smart-labels', false);
  assert.equal(h.getElement('set-smart-labels').checked, false);
});

test('the added rows write their own corner of App.config', () => {
  const h = createHarness();
  const { App } = h.context;

  h.context.setQuickSetting('qs-wrap-labels', false);
  assert.equal(App.config.wrapStateLabels, false);

  h.context.setQuickSetting('qs-layout-algo', 'circular');
  assert.equal(App.config.layout.algorithm, 'circular');

  h.context.setQuickSetting('qs-click-highlight', 'incoming');
  assert.equal(App.config.clickHighlightMode, 'incoming');
});

test('turning click-highlight off retires the highlight that is already lit', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.createState(0, 0, 'q0');
  h.context.createState(120, 0, 'q1');
  App.transitions.push({
    id: h.context.newTId(), from: App.states[0].id, to: App.states[1].id, symbol: 'a'
  });

  h.context.setQuickSetting('qs-click-highlight', 'outgoing');
  h.context.highlightEdgesForState(App.states[0].id, 'outgoing');
  assert.ok(App.edgeHighlight, 'a state should now be lit');

  // Off has to clear it: with the mode gone there is no other way to unlight it.
  h.context.setQuickSetting('qs-click-highlight', 'off');
  assert.equal(App.config.clickHighlightMode, 'off');
  assert.equal(App.edgeHighlight, null, 'no state should be left highlighted');
});

test('an empty select value falls back rather than being stored', () => {
  const h = createHarness();
  h.context.setQuickSetting('qs-layout-algo', '');
  assert.equal(h.context.App.config.layout.algorithm, 'sugiyama');

  h.context.setQuickSetting('qs-click-highlight', '');
  assert.equal(h.context.App.config.clickHighlightMode, 'off');
});

test('getQuickSetting reads back what the config holds', () => {
  const h = createHarness();
  h.context.App.config.edgeLabelStyle = 'pills';
  assert.equal(h.context.getQuickSetting('qs-edge-labels'), 'pills');

  // Absent render flags read as on, matching every other consumer of them.
  delete h.context.App.config.render.smartLabels;
  assert.equal(h.context.getQuickSetting('qs-smart-labels'), true);
});

test('an unknown row id is a no-op rather than a throw', () => {
  const h = createHarness();
  assert.equal(h.context.setQuickSetting('qs-nonexistent', true), false);
  assert.equal(h.context.getQuickSetting('qs-nonexistent'), undefined);
});

test('open and close track the trigger button state', () => {
  const h = createHarness();
  assert.equal(h.context.isQuickSettingsOpen(), false);

  h.context.openQuickSettings();
  assert.equal(h.context.isQuickSettingsOpen(), true);
  assert.equal(h.getElement('quick-settings-btn').getAttribute('aria-expanded'), 'true');

  h.context.closeQuickSettings();
  assert.equal(h.context.isQuickSettingsOpen(), false);
  assert.equal(h.getElement('quick-settings-btn').getAttribute('aria-expanded'), 'false');
});

test('a quick change announces the repaint exactly once', () => {
  const h = createHarness();
  let announced = 0;
  const off = h.context.subscribe(h.context.Change.CANVAS, () => { announced++; });
  try {
    h.context.setQuickSetting('qs-edge-labels', 'none');
    assert.equal(announced, 1, 'one canvas announcement per change');
  } finally {
    off();
  }
});

// The store contract from CLAUDE.md: announce, do not repaint. Change.CANVAS
// already carries renderAll, so a direct call beside the emit draws every frame
// twice — invisible on screen, and only ever visible as wasted work. Counting
// emissions cannot see it (one emit either way), so this reads the source.
test('the write path does not call a renderer directly', () => {
  const src = readFileSync(new URL('../js/quick-settings.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function applyQuick'));
  const fn = body.slice(0, body.indexOf('\n}'));

  for (const renderer of ['renderAll', 'renderTransitions', 'updateFastDOM', 'updateLPanel', 'updateRPanel']) {
    assert.ok(!new RegExp(`\\b${renderer}\\s*\\(`).test(fn),
      `applyQuick calls ${renderer}() directly; emit(Change.CANVAS) already repaints`);
  }
  // commit() is snapshot + emit: the change is announced *and* undoable.
  assert.ok(/commit\(Change\.CANVAS\)/.test(fn),
    'applyQuick must commit the change — announcing it and recording an undo point');
});

// Config is replaced wholesale by more than the Settings dialog: each workspace
// tab carries its own, and a loaded file brings one with it. The popover
// re-reads on open, which covers anything reached by a click — but a dropped
// .json replaces the config without one, and a tab switch rehydrates it. Both
// have to refresh explicitly or an open popover shows the outgoing settings.
test('every path that replaces App.config refreshes the popover', () => {
  const uiSrc = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  const persistSrc = readFileSync(new URL('../js/persistence.js', import.meta.url), 'utf8');

  const fn = (src, name) => {
    const at = src.indexOf(`export function ${name}(`);
    assert.notEqual(at, -1, `${name} not found`);
    return src.slice(at, src.indexOf('\n}', at));
  };

  for (const name of ['switchTab', 'createTab', 'confirmSettings']) {
    assert.match(fn(uiSrc, name), /refreshQuickSettings\(\)/,
      `${name} replaces or rewrites App.config without refreshing the popover`);
  }
  assert.match(fn(persistSrc, 'loadData'), /refreshQuickSettings\(\)/,
    'loadData replaces App.config without refreshing the popover');
});
