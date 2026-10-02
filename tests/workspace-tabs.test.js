import test from 'node:test';
import assert from 'node:assert';
import { createHarness, dispatchDocumentEvent, getElement } from './harness.js';

const harness = createHarness();
const { context } = harness;

function setup(names, { activeIndex = 0, dirty = [] } = {}) {
  harness.resetApp();
  const ws = names.map((name, i) => ({
    id: `ws_t${i}`,
    name,
    dirty: dirty.includes(i),
    data: context.blankWorkspaceData(),
  }));
  context.setWorkspaces(ws);
  context.setActiveWorkspaceId(ws[activeIndex].id);
  context.renderTabs();
  return getElement('tab-bar');
}

function tabsIn(tb) {
  const out = [];
  for (let n = tb.firstChild; n; n = n.nextSibling) {
    if (!n.classList.contains('is-leaving')) out.push(n);
  }
  return out;
}

const ids = tb => tabsIn(tb).map(el => el.dataset.tabId);
const key = (code, mods = {}) => ({ code, key: '', preventDefault() {}, ...mods });

// The strip used to be rebuilt from a string on every renderTabs — ~18 call
// sites — which restarted hover fades, dropped focus and threw away a rename
// half typed. A redraw now keeps every element a workspace already had.
test('a redraw keeps each tab element rather than rebuilding the strip', () => {
  const tb = setup(['A', 'B', 'C']);
  const before = tabsIn(tb);
  assert.deepStrictEqual(ids(tb), ['ws_t0', 'ws_t1', 'ws_t2']);

  context.Workspaces[1].dirty = true;
  context.renderTabs();
  const after = tabsIn(tb);
  assert.strictEqual(after.length, 3);
  after.forEach((el, i) => assert.strictEqual(el, before[i], `tab ${i} is the same node`));
  assert.ok(after[1].classList.contains('is-dirty'));
});

test('a reorder moves the existing elements into the new order', () => {
  const tb = setup(['A', 'B', 'C']);
  const [a, b, c] = tabsIn(tb);
  const W = context.Workspaces;
  W.splice(0, W.length, W[2], W[0], W[1]);
  context.renderTabs();
  assert.deepStrictEqual(tabsIn(tb), [c, a, b]);
});

test('a closed workspace stops being a tab at once, though it may still be folding away', () => {
  const tb = setup(['A', 'B', 'C']);
  const [, b] = tabsIn(tb);
  context.Workspaces.splice(1, 1);
  context.renderTabs();
  assert.deepStrictEqual(ids(tb), ['ws_t0', 'ws_t2']);
  assert.strictEqual(b.dataset.tabId, undefined, 'no lookup can find it');
  assert.strictEqual(b.getAttribute?.('aria-hidden') ?? b['aria-hidden'], 'true');
});

// The dot and the button share one slot. A tab with neither draws no slot, so
// it carries no invisible space on its right.
test('the end slot is drawn only when there is a dot or a close button in it', () => {
  let tb = setup(['Only']);
  assert.strictEqual(tabsIn(tb)[0].classList.contains('has-end'), false, 'one clean tab: nothing to show');

  tb = setup(['Only'], { dirty: [0] });
  assert.ok(tabsIn(tb)[0].classList.contains('has-end'), 'a dirty tab shows its dot');
  assert.match(tabsIn(tb)[0].innerHTML, /tab-dirty/);
  assert.doesNotMatch(tabsIn(tb)[0].innerHTML, /tab-close/, 'the last workspace cannot be closed');

  tb = setup(['A', 'B']);
  tabsIn(tb).forEach(el => {
    assert.ok(el.classList.contains('has-end'));
    assert.match(el.innerHTML, /tab-end"><button class="tab-close"/);
  });
});

test('a tab names its machine in a label of its own', () => {
  const tb = setup(['A']);
  assert.match(tabsIn(tb)[0].innerHTML, new RegExp(`<span class="tab-type"[^>]*>${context.App.machine}</span>`));
});

test('dropping commits the order the drag left the strip in', () => {
  const tb = setup(['A', 'B', 'C']);
  const [a, , c] = tabsIn(tb);
  const ev = { currentTarget: a, preventDefault() {}, stopPropagation() {}, dataTransfer: null };
  context.handleTabDragStart('ws_t0', ev);
  tb.insertBefore(a, null);   // what the dragover does, live
  context.handleTabDrop('ws_t2', { ...ev, currentTarget: c });
  assert.deepStrictEqual(context.Workspaces.map(w => w.id), ['ws_t1', 'ws_t2', 'ws_t0']);
  assert.deepStrictEqual(ids(tb), ['ws_t1', 'ws_t2', 'ws_t0']);
  assert.strictEqual(context.draggingTabId, null);
});

test('a drag that ends without a drop is put back', () => {
  const tb = setup(['A', 'B', 'C']);
  const [a] = tabsIn(tb);
  context.handleTabDragStart('ws_t0', { currentTarget: a, preventDefault() {}, dataTransfer: null });
  tb.insertBefore(a, null);
  context.handleTabDragEnd({});
  assert.deepStrictEqual(context.Workspaces.map(w => w.id), ['ws_t0', 'ws_t1', 'ws_t2']);
  assert.deepStrictEqual(ids(tb), ['ws_t0', 'ws_t1', 'ws_t2']);
});

test('Home and End on a tab go to the first and the last workspace', () => {
  setup(['A', 'B', 'C', 'D'], { activeIndex: 1 });
  const ev = k => ({ key: k, preventDefault() {}, stopPropagation() {} });
  context.handleTabKeydown('ws_t1', ev('End'));
  assert.strictEqual(context.activeWorkspaceId, 'ws_t3');
  context.handleTabKeydown('ws_t3', ev('Home'));
  assert.strictEqual(context.activeWorkspaceId, 'ws_t0');
});

// A browser keeps Ctrl+Tab, Ctrl+T, Ctrl+W and Ctrl+1…9 for its own tabs, so
// each act also has an Alt spelling the website does receive.
test('the workspace shortcuts switch, jump, open and close from anywhere', () => {
  setup(['A', 'B', 'C', 'D']);
  const { handleWorkspaceShortcut: go } = context;

  assert.ok(go(key('BracketRight', { altKey: true })));
  assert.strictEqual(context.activeWorkspaceId, 'ws_t1');
  assert.ok(go(key('', { key: 'Tab', ctrlKey: true, shiftKey: true })));
  assert.strictEqual(context.activeWorkspaceId, 'ws_t0');
  assert.ok(go(key('BracketLeft', { altKey: true })), 'previous wraps to the end');
  assert.strictEqual(context.activeWorkspaceId, 'ws_t3');

  assert.ok(go(key('Digit2', { ctrlKey: true })));
  assert.strictEqual(context.activeWorkspaceId, 'ws_t1');
  assert.ok(go(key('Digit9', { altKey: true })), '9 is the last however many there are');
  assert.strictEqual(context.activeWorkspaceId, 'ws_t3');

  assert.ok(go(key('KeyT', { altKey: true })));
  assert.strictEqual(context.Workspaces.length, 5);
  assert.strictEqual(context.activeWorkspaceId, context.Workspaces[4].id);

  assert.ok(go(key('KeyW', { metaKey: true })));
  assert.strictEqual(context.Workspaces.length, 4, 'a clean workspace closes without asking');

  assert.strictEqual(go(key('KeyT', { ctrlKey: true, altKey: true })), false, 'Ctrl+Alt is not either spelling');
  assert.strictEqual(go(key('KeyQ', { altKey: true })), false);
});

test('the shortcuts reach the page through the document listener', () => {
  setup(['A', 'B']);
  const ev = dispatchDocumentEvent('keydown', { key: ']', code: 'BracketRight', altKey: true, target: { tagName: 'DIV', closest: () => null } });
  assert.strictEqual(context.activeWorkspaceId, 'ws_t1');
  assert.ok(ev.defaultPrevented);
});

// Activating a tab announces META, GRAMMAR, EXERCISE and LEXER so the panels
// redraw from it, and markDirty listens to all four — so every tab clicked on,
// and every new blank one, came up with the unsaved dot.
test('switching to a tab or opening a new one does not mark it unsaved', () => {
  setup(['A', 'B'], { dirty: [] });
  context.switchTab('ws_t1');
  assert.deepStrictEqual(context.Workspaces.map(w => w.dirty), [false, false]);
  context.createTab();
  assert.deepStrictEqual(context.Workspaces.map(w => !!w.dirty), [false, false, false]);
});

test('a tab that was unsaved when left is still unsaved when returned to', () => {
  setup(['A', 'B'], { dirty: [1] });
  context.switchTab('ws_t1');
  context.switchTab('ws_t0');
  assert.deepStrictEqual(context.Workspaces.map(w => w.dirty), [false, true]);
});

test('an edit after switching still marks the tab unsaved', () => {
  setup(['A', 'B']);
  context.switchTab('ws_t1');
  context.markDirty();
  assert.strictEqual(context.Workspaces[1].dirty, true);
});
