import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, dispatchDocumentEvent } from './harness.js';

// The sidebars' tab strips, arranged the way VS Code arranges its panel tabs:
// a tab can be dragged along its own strip to reorder it, a movable one can be
// dragged onto the other panel, and the tab's context menu does both from the
// keyboard. The order is the reader's, so it persists — as the absence of a
// preference when it is the declared one.

const harness = createHarness();
const { context } = harness;
const el = id => harness.getElement(id);
/** The menu is built on first use, so it is found in the page rather than by id. */
const tabMenu = () => context.document.body.children.find(c => c.id === 'panel-tab-menu');

function desktop() {
  context.matchMedia = () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}
  });
}

function mount() {
  harness.resetApp();
  desktop();
  context.localStorage.removeItem('automata-panel-tab-order');
  context.localStorage.removeItem('automata-statemate-panel');
  context.localStorage.removeItem('automata-panel-tab-sides');
  context.initPanelTabs();
}

/** The tab ids in a strip, in DOM order. */
const stripOrder = side => [...el(`${side}-tabs`).children].map(tab => tab.id);

const rect = (left, top, width, height) => () =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });

/** Both panels on screen, the right one's strip holding its three tabs. */
function layOut() {
  el('lpanel').getBoundingClientRect = rect(0, 40, 256, 700);
  el('rpanel').getBoundingClientRect = rect(1000, 40, 280, 700);
  el('lpanel-tabs').getBoundingClientRect = rect(5, 40, 200, 35);
  el('rpanel-tabs').getBoundingClientRect = rect(1005, 40, 200, 35);
  el('panel-tab-workspace').getBoundingClientRect = rect(5, 40, 90, 35);
  el('panel-tab-inspector').getBoundingClientRect = rect(1005, 40, 80, 35);
  el('panel-tab-run').getBoundingClientRect = rect(1085, 40, 44, 35);
  el('panel-tab-statemate').getBoundingClientRect = rect(1129, 40, 84, 35);
}

function drag(tabId, from, to) {
  el(tabId)._listeners.pointerdown({ button: 0, isPrimary: true, pointerId: 7, clientX: from[0], clientY: from[1] });
  dispatchDocumentEvent('pointermove', { pointerId: 7, clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2 });
  dispatchDocumentEvent('pointermove', { pointerId: 7, clientX: to[0], clientY: to[1] });
  dispatchDocumentEvent('pointerup', { pointerId: 7, clientX: to[0], clientY: to[1] });
}

test('declared order is the default, and moving a tab back leaves no preference', () => {
  mount();
  assert.deepEqual(context.panelTabNames('rpanel'), ['inspector', 'run', 'statemate']);

  assert.equal(context.movePanelTab('inspector', 'rpanel', null), true);
  assert.deepEqual(context.panelTabNames('rpanel'), ['run', 'statemate', 'inspector']);
  assert.deepEqual(stripOrder('rpanel'), ['panel-tab-run', 'panel-tab-statemate', 'panel-tab-inspector'],
    'the strip is redrawn in the new order');
  assert.ok(context.localStorage.getItem('automata-panel-tab-order'), 'and the order is remembered');

  context.movePanelTab('inspector', 'rpanel', 'run');
  assert.equal(context.getPanelTabOrder(), null, 'the declared order is stored as nothing at all');
  assert.equal(context.localStorage.getItem('automata-panel-tab-order'), null);
});

test('any tab can cross to the other panel', () => {
  mount();
  assert.equal(context.movePanelTab('inspector', 'lpanel', null), true);
  assert.equal(context.getTabSide('inspector'), 'lpanel');
  assert.deepEqual(context.panelTabNames('lpanel'), ['workspace', 'inspector']);
  assert.equal(context.getActivePanelTab('lpanel'), 'inspector', 'opened where it arrives');
  assert.equal(context.getActivePanelTab('rpanel'), 'run', 'and the panel it left falls back');
  assert.ok(context.localStorage.getItem('automata-panel-tab-sides'), 'the side is remembered');
  context.movePanelTab('inspector', 'rpanel', 'run');
  assert.equal(context.localStorage.getItem('automata-panel-tab-sides'), null,
    'home is stored as nothing at all');

  assert.equal(context.movePanelTab('statemate', 'lpanel', 'workspace'), true);
  assert.deepEqual(context.panelTabNames('lpanel'), ['statemate', 'workspace'],
    'it lands where it was dropped, not just at the end');
  assert.deepEqual(context.panelTabNames('rpanel'), ['inspector', 'run']);
  assert.deepEqual(stripOrder('lpanel'), ['panel-tab-statemate', 'panel-tab-workspace']);
  assert.equal(context.getActivePanelTab('lpanel'), 'statemate',
    'a tab dragged across is opened where it arrives');
  assert.deepEqual(JSON.parse(context.localStorage.getItem('automata-panel-tab-sides')),
    { statemate: 'lpanel' });
});

test('a panel with every tab dragged off it is hidden, and comes back', () => {
  mount();
  context.movePanelTab('workspace', 'rpanel', null);
  assert.equal(context.isPanelEmpty('lpanel'), true);
  assert.equal(el('lpanel').classList.contains('is-empty'), true,
    'nothing to show, so nothing drawn — the way VS Code hides an empty sidebar');
  assert.equal(context.getActivePanelTab('lpanel'), null);

  context.movePanelTab('run', 'lpanel', null);
  assert.equal(el('lpanel').classList.contains('is-empty'), false);
  assert.equal(context.getActivePanelTab('lpanel'), 'run');
});

test('a tab can be dragged to the edge of a panel that has none', () => {
  mount();
  layOut();
  el('canvas-wrap').getBoundingClientRect = rect(256, 40, 744, 700);
  context.movePanelTab('workspace', 'rpanel', null);
  // Its panel is not drawn, so the drop target is a band at that canvas edge.
  drag('panel-tab-workspace', [1030, 55], [280, 400]);
  assert.equal(context.getTabSide('workspace'), 'lpanel');
  assert.equal(el('lpanel').classList.contains('is-empty'), false);
});

test('StateMate left alone on a panel is opened there, quietly', () => {
  mount();
  context.movePanelTab('statemate', 'lpanel', null);
  context.showPanelTab('workspace');
  const panel = el('lpanel');
  panel.classList.add('unpinned');
  context.movePanelTab('workspace', 'rpanel', null);
  assert.equal(context.getActivePanelTab('lpanel'), 'statemate', 'the only tab there');
  assert.equal(panel.classList.contains('unpinned'), true,
    'and nobody asked for it, so the reader’s unpinned panel stays unpinned');
});

test('the StateMate-only side key of earlier versions is migrated', () => {
  harness.resetApp();
  desktop();
  context.localStorage.removeItem('automata-panel-tab-sides');
  context.localStorage.removeItem('automata-panel-tab-order');
  context.localStorage.setItem('automata-statemate-panel', 'lpanel');
  context.initPanelTabs();
  assert.equal(context.getTabSide('statemate'), 'lpanel');
  context.localStorage.removeItem('automata-statemate-panel');
});

test('a saved order is reconciled against the registry, not trusted', () => {
  mount();
  context.setPanelTabOrder(['statemate', 'nonsense', 'inspector']);
  assert.deepEqual(context.panelTabNames('rpanel'), ['statemate', 'inspector', 'run'],
    'a tab the saved order predates lands at its declared place, not in front of everything');
  assert.deepEqual(context.panelTabNames('lpanel'), ['workspace'],
    'a tab the saved order does not mention is still shown');
});

test('the order survives a reload', () => {
  mount();
  context.movePanelTab('inspector', 'rpanel', null);
  context.resetPanelTabs();
  context.initPanelTabs();
  assert.deepEqual(context.panelTabNames('rpanel'), ['run', 'statemate', 'inspector']);
});

test('dragging a tab along its strip reorders it, and the drag is not a click', () => {
  mount();
  layOut();
  assert.equal(context.getActivePanelTab('rpanel'), 'inspector');
  drag('panel-tab-inspector', [1030, 55], [1200, 55]);
  assert.deepEqual(context.panelTabNames('rpanel'), ['run', 'statemate', 'inspector']);

  // The pointerup of a drag still produces a click on the tab it started on.
  el('panel-tab-statemate')._listeners.click();
  assert.equal(context.getActivePanelTab('rpanel'), 'inspector',
    'the click the drop produces does not select anything');
});

test('a press that does not travel is an ordinary click', () => {
  mount();
  layOut();
  el('panel-tab-inspector')._listeners.pointerdown({ button: 0, isPrimary: true, pointerId: 3, clientX: 1030, clientY: 55 });
  dispatchDocumentEvent('pointermove', { pointerId: 3, clientX: 1032, clientY: 56 });
  dispatchDocumentEvent('pointerup', { pointerId: 3, clientX: 1032, clientY: 56 });
  assert.deepEqual(context.panelTabNames('rpanel'), ['inspector', 'run', 'statemate'], 'nothing moved');
  assert.equal(el('panel-tab-inspector').classList.contains('is-dragging'), false);
});

test('dragging StateMate over the other panel moves it there', () => {
  mount();
  layOut();
  drag('panel-tab-statemate', [1160, 55], [120, 400]);
  assert.equal(context.getTabSide('statemate'), 'lpanel');
  assert.deepEqual(context.panelTabNames('lpanel'), ['workspace', 'statemate'],
    'dropped on the panel body rather than its strip, it goes last');
});

test('Escape cancels a drag in flight', () => {
  mount();
  layOut();
  el('panel-tab-inspector')._listeners.pointerdown({ button: 0, isPrimary: true, pointerId: 9, clientX: 1030, clientY: 55 });
  dispatchDocumentEvent('pointermove', { pointerId: 9, clientX: 1180, clientY: 55 });
  const esc = dispatchDocumentEvent('keydown', { key: 'Escape' });
  assert.equal(esc.propagationStopped, true, 'the drag claims the key while it is in flight');
  dispatchDocumentEvent('pointerup', { pointerId: 9, clientX: 1180, clientY: 55 });
  assert.deepEqual(context.panelTabNames('rpanel'), ['inspector', 'run', 'statemate']);
  assert.equal(dispatchDocumentEvent('keydown', { key: 'Escape' }).propagationStopped, false,
    'and gives it back once it is over');
});

test('the tab menu is the keyboard route to the same moves', () => {
  mount();
  layOut();
  let prevented = false;
  el('panel-tab-inspector')._listeners.keydown({ key: 'F10', shiftKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  const menu = tabMenu();
  assert.equal(menu.style.display, 'block');
  const rows = menu.children.filter(r => r.className.includes('ctx-i'));
  const row = label => rows.find(r => r.textContent === label);
  assert.ok(row('Move Left').className.includes('disabled'), 'the first tab cannot move left');
  assert.ok(row('Move to Left Panel'), 'and every tab is offered the other panel');

  row('Move Right')._listeners.click({ stopPropagation() {} });
  assert.deepEqual(context.panelTabNames('rpanel'), ['run', 'inspector', 'statemate']);
  assert.equal(menu.style.display, 'none');
});

test('the menu offers StateMate the other panel, and a reset once anything moved', () => {
  mount();
  layOut();
  el('panel-tab-statemate')._listeners.contextmenu({
    clientX: 1100, clientY: 60, preventDefault() {}, stopPropagation() {}
  });
  const menu = tabMenu();
  const labels = () => menu.children.map(r => r.textContent).filter(Boolean);
  assert.ok(labels().includes('Move to Left Panel'));
  assert.ok(!labels().includes('Reset Tab Layout'), 'nothing to reset yet');

  menu.children.find(r => r.textContent === 'Move to Left Panel')._listeners.click({ stopPropagation() {} });
  assert.equal(context.getTabSide('statemate'), 'lpanel');

  el('panel-tab-statemate')._listeners.contextmenu({
    clientX: 100, clientY: 60, preventDefault() {}, stopPropagation() {}
  });
  menu.children.find(r => r.textContent === 'Reset Tab Layout')._listeners.click({ stopPropagation() {} });
  assert.equal(context.getTabSide('statemate'), 'rpanel');
  assert.equal(context.getPanelTabOrder(), null);
  assert.deepEqual(stripOrder('rpanel'), ['panel-tab-inspector', 'panel-tab-run', 'panel-tab-statemate']);
});

// ── the Run tab ───────────────────────────────────────────────────
//  The player and what it draws moved out of the Inspector. Anything that
//  jumps into a run from outside the tab has to bring the tab up with it, or
//  the word runs and the transport, tape and trace stay out of sight.

test('the Run tab hosts the player and what it draws; the Inspector keeps the rest', () => {
  mount();
  assert.deepEqual(context.declaredSectionIds('run'),
    ['rp-simulate', 'rp-trace', 'rp-branches', 'rp-spacetime']);
  assert.deepEqual(context.declaredSectionIds('rpanel'),
    ['rp-exercise', 'rp-language', 'rp-complexity', 'rp-batch']);
  assert.equal(context.sectionHost('run'), 'rpanel', 'both are stacks in the right panel');
  assert.equal(context.PANEL_TABS.run.panel, context.PANEL_SECTIONS.run.container,
    'and the tab controls exactly the container the group draws into');
});

test('running a word from the Inspector reveals the player', () => {
  mount();
  assert.equal(context.getActivePanelTab('rpanel'), 'inspector');
  context.setRPSectionCollapsed('rp-simulate', true, false);
  context.revealPlayer();
  assert.equal(context.getActivePanelTab('rpanel'), 'run');
  assert.equal(el('rp-simulate').classList.contains('collapsed'), false,
    'expanded as well, or the tab comes up with the transport folded away');
  assert.equal(el('rpanel-run-content').hidden, false);
  assert.equal(el('rpanel-content').hidden, true);
});

test('a floating section is revealed where it already is', () => {
  mount();
  context.setFloatState('rp-simulate', { x: 40, y: 60, w: 320, h: 240 });
  try {
    context.revealPlayer();
    assert.equal(context.getActivePanelTab('rpanel'), 'inspector',
      'a window over the canvas is in view whichever tab is selected');
  } finally {
    context.setFloatState('rp-simulate', null);
  }
});

test('a strip whose labels do not fit drops the unselected ones to icons', () => {
  mount();
  const strip = el('rpanel-tabs');
  strip.clientWidth = 300;
  strip.scrollWidth = 270;          // the strip's content with nothing shrunk
  context.fitPanelTabs('rpanel');
  assert.equal(strip.classList.contains('is-compact'), false, '270px of labels fit in 300');
  context.movePanelTab('workspace', 'rpanel', null);
  strip.scrollWidth = 360;
  context.fitPanelTabs('rpanel');
  assert.equal(strip.classList.contains('is-measuring'), false, 'the measuring state is not left behind');
  assert.equal(strip.classList.contains('is-compact'), true, '360px of labels do not');
});
