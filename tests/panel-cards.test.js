import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, dispatchDocumentEvent } from './harness.js';

// Cards moving between tabs. A card is declared in one tab's stack — that is
// its home, and what its markup is shaped like — and the reader can put it in
// any other. Three routes, one registry: the card menu, dropping the card on a
// tab button, and pulling it across into the stack the other panel shows.

const harness = createHarness();
const { context } = harness;
const el = id => harness.getElement(id);

const rect = (left, top, width, height) => () =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
const nowhere = rect(0, 0, 0, 0);

function desktop() {
  context.matchMedia = query => ({
    // Wide, with a fine hovering pointer: the floating-window query holds.
    matches: !query.includes('max-width: 900px'),
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}
  });
}

/** Every stack in its container, the way index.html has them, with headers. */
function mount() {
  harness.resetApp();
  desktop();
  context.resetPanelFloat();
  context.localStorage.removeItem('automata-panel-tab-sides');
  context.localStorage.removeItem('automata-panel-tab-order');
  context.PANEL_SECTION_SIDES.forEach(group => {
    context.resetSectionOrder(group);
    const cfg = context.PANEL_SECTIONS[group];
    const container = el(cfg.container);
    container.innerHTML = '';
    context.declaredSectionIds(group).forEach(id => {
      const sec = el(id);
      sec.style.display = '';
      sec.classList.remove('panel-float', 'collapsed');
      delete sec.__secGrip;
      const header = context.document.createElement('div');
      header.className = cfg.headerClass;
      sec.appendChild(header);
      sec.__header = header;
      sec.querySelector = sel => (sel === '.' + cfg.headerClass ? header : null);
      container.appendChild(sec);
    });
  });
  // Where a real layout puts things: the Workspace down the left, the right
  // panel's stacks down the right, the tab buttons in the headers above them.
  el('lpanel-content').getBoundingClientRect = rect(0, 76, 256, 700);
  el('rpanel-content').getBoundingClientRect = rect(1000, 76, 280, 700);
  el('rpanel-run-content').getBoundingClientRect = rect(1000, 76, 280, 700);
  el('panel-tab-workspace').getBoundingClientRect = rect(5, 40, 90, 35);
  el('panel-tab-inspector').getBoundingClientRect = rect(1005, 40, 80, 35);
  el('panel-tab-run').getBoundingClientRect = rect(1085, 40, 44, 35);
  el('panel-tab-statemate').getBoundingClientRect = rect(1129, 40, 84, 35);
  context.initPanelTabs();
  context.initPanelFloat();
  context.initPanelSectionReorder();
}

const inStack = (container, id) => el(container).children.includes(el(id));

/** The same element, moved — the thing panel-float.test.js insists on too. */
function pressGrip(id, x, y) {
  el(id).__secGrip._listeners.pointerdown({
    button: 0, pointerId: 4, clientX: x, clientY: y,
    stopPropagation() {}, preventDefault() {}
  });
}

// ── the registry ──────────────────────────────────────────────────

test('a card is in its declared tab until the reader moves it', () => {
  mount();
  assert.equal(context.sectionSide('rp-trace'), 'run');
  assert.equal(context.declaredGroupOf('rp-trace'), 'run');
  assert.equal(context.anySectionMoved(), false);
});

test('moving a card changes where it is, not what it is', () => {
  mount();
  context.moveSectionToGroup('rp-trace', 'lpanel', 1);
  assert.equal(context.sectionSide('rp-trace'), 'lpanel');
  assert.equal(context.declaredGroupOf('rp-trace'), 'run', 'its home is unchanged');
  assert.equal(context.sectionOrder('lpanel')[1], 'rp-trace', 'at the slot it was dropped in');
  assert.ok(!context.sectionOrder('run').includes('rp-trace'), 'and gone from where it was');
  assert.equal(context.sectionConfig('rp-trace').headerClass, 'rp-section-header',
    'its markup is the right panel’s wherever it is');
  assert.equal(context.sectionFill('rp-trace'), '.trace-log');

  context.moveSectionToGroup('rp-trace', 'run');
  assert.equal(context.anySectionMoved(), false, 'home is stored as nothing at all');
  assert.equal(context.localStorage.getItem('automata-section-groups'), null);
});

test('a group’s panel is wherever its tab is', () => {
  mount();
  assert.equal(context.sectionHost('run'), 'rpanel');
  context.movePanelTab('run', 'lpanel', null);
  assert.equal(context.sectionHost('run'), 'lpanel');
});

// ── the menu ──────────────────────────────────────────────────────

test('the card menu moves a card to another tab and shows it there', () => {
  mount();
  el('rp-trace').__header._listeners.contextmenu({
    clientX: 1100, clientY: 300, preventDefault() {}, stopPropagation() {}
  });
  const menu = context.document.body.children.find(c => c.id === 'panel-tab-menu');
  const labels = menu.children.map(r => r.textContent).filter(Boolean);
  assert.ok(labels.includes('Move to Workspace') && labels.includes('Move to Inspector'));
  assert.ok(!labels.includes('Move to Run'), 'not the tab it is already on');

  menu.children.find(r => r.textContent === 'Move to Workspace')._listeners.click({ stopPropagation() {} });
  assert.ok(inStack('lpanel-content', 'rp-trace'), 'the element is in the Workspace stack');
  assert.ok(!inStack('rpanel-run-content', 'rp-trace'));
  assert.equal(context.getActivePanelTab('lpanel'), 'workspace', 'and that tab is showing');
});

test('Shift+F10 on the grip opens the same menu from the keyboard', () => {
  mount();
  let prevented = false;
  el('lp-states').__secGrip._listeners.keydown({
    key: 'F10', shiftKey: true, preventDefault() { prevented = true; }, stopPropagation() {}
  });
  assert.equal(prevented, true);
  const menu = context.document.body.children.find(c => c.id === 'panel-tab-menu');
  assert.equal(menu.style.display, 'block');
});

test('a floating card is docked before it changes tabs', () => {
  mount();
  context.floatSection('rp-simulate', { x: 40, y: 40, w: 320, h: 240 });
  assert.equal(context.isSectionFloating('rp-simulate'), true);
  assert.equal(context.moveCardTo('rp-simulate', 'rpanel'), true);
  assert.equal(context.isSectionFloating('rp-simulate'), false,
    'a window belongs to the group holding its record, which is about to change');
  assert.ok(inStack('rpanel-content', 'rp-simulate'));
});

test('reset puts every card back on its own tab', () => {
  mount();
  context.moveCardTo('rp-trace', 'lpanel');
  context.moveCardTo('lp-states', 'rpanel');
  context.resetCardLayout();
  assert.equal(context.anySectionMoved(), false);
  assert.ok(inStack('rpanel-run-content', 'rp-trace'));
  assert.ok(inStack('lpanel-content', 'lp-states'));
});

// ── dragging ──────────────────────────────────────────────────────

test('dropping a card on a tab button moves it to that tab', () => {
  mount();
  pressGrip('lp-states', 16, 200);
  dispatchDocumentEvent('pointermove', { pointerId: 4, clientX: 20, clientY: 120 });
  dispatchDocumentEvent('pointermove', { pointerId: 4, clientX: 1100, clientY: 55 });
  assert.equal(el('panel-tab-run').classList.contains('is-card-drop-target'), true,
    'the tab under the pointer says it will take the card');
  dispatchDocumentEvent('pointerup', { pointerId: 4, clientX: 1100, clientY: 55 });
  assert.equal(context.sectionSide('lp-states'), 'run');
  assert.ok(inStack('rpanel-run-content', 'lp-states'));
  assert.equal(el('panel-tab-run').classList.contains('is-card-drop-target'), false);
  assert.equal(context.getActivePanelTab('rpanel'), 'run', 'revealed where it went');
});

test('pulling a card into the other panel docks it in that panel’s stack', () => {
  mount();
  pressGrip('lp-states', 16, 200);
  // Out past the tear-off threshold: a window, following the pointer ...
  dispatchDocumentEvent('pointermove', { pointerId: 4, clientX: 500, clientY: 300 });
  assert.equal(context.isSectionFloating('lp-states'), true);
  // ... and over the Inspector's stack, where it docks.
  dispatchDocumentEvent('pointermove', { pointerId: 4, clientX: 1100, clientY: 300 });
  assert.ok(inStack('rpanel-content', 'lp-states'), 'docked into the stack under the pointer');
  dispatchDocumentEvent('pointerup', { pointerId: 4, clientX: 1100, clientY: 300 });
  assert.equal(context.sectionSide('lp-states'), 'rpanel');
  assert.equal(context.isSectionFloating('lp-states'), false);
});

test('Escape puts a card back even after it was docked in another stack', () => {
  mount();
  const before = [...context.sectionOrder('lpanel')];
  pressGrip('lp-states', 16, 200);
  dispatchDocumentEvent('pointermove', { pointerId: 4, clientX: 500, clientY: 300 });
  dispatchDocumentEvent('pointermove', { pointerId: 4, clientX: 1100, clientY: 300 });
  assert.ok(inStack('rpanel-content', 'lp-states'));
  dispatchDocumentEvent('keydown', { key: 'Escape' });
  assert.ok(inStack('lpanel-content', 'lp-states'), 'back in its own stack');
  assert.equal(context.sectionSide('lp-states'), 'lpanel', 'and the registry never heard of it');
  assert.deepEqual(context.sectionOrder('lpanel'), before);
});

test('dropping a card on its own tab leaves it where it was', () => {
  mount();
  const before = [...context.sectionOrder('lpanel')];
  pressGrip('lp-transitions', 16, 400);
  dispatchDocumentEvent('pointermove', { pointerId: 4, clientX: 20, clientY: 90 });
  dispatchDocumentEvent('pointermove', { pointerId: 4, clientX: 40, clientY: 55 });
  dispatchDocumentEvent('pointerup', { pointerId: 4, clientX: 40, clientY: 55 });
  assert.deepEqual(context.sectionOrder('lpanel'), before);
  assert.equal(context.anySectionMoved(), false);
});

// ── what a stack does with a guest ────────────────────────────────

test('a guest keeps its own dock-fill rule', () => {
  mount();
  // States Q is a transparent list: it takes spare height in any stack.
  context.moveCardTo('lp-states', 'rpanel');
  el('lp-states').querySelector = sel => (sel === '.slist' ? el('states-list') : null);
  assert.equal(context.syncDockFill('rpanel'), 'lp-states');
  // Trace is a drawn box: it never does, even in the Workspace.
  context.moveCardTo('rp-trace', 'lpanel');
  assert.notEqual(context.syncDockFill('lpanel'), 'rp-trace');
});

test('a tab emptied by moving its cards away says so', () => {
  mount();
  context.declaredSectionIds('run').forEach(id => context.moveCardTo(id, 'rpanel'));
  const note = el('run-float-empty');
  assert.equal(note.style.display, '');
  assert.match(note.__text?.textContent || '', /No cards on this tab/);
  assert.equal(note.__btn?.hidden, true, 'nothing is floating, so there is nothing to return');
});
