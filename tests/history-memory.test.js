// What a workspace retains when it is not the one on screen.
//
// The live undo stack is bounded by history.js's own two limits and always
// was. What was not bounded is the *other* tabs: exportWorkspaceState copies
// both stacks into a tab's blob and Workspaces keeps every blob alive, so a
// 200-state machine with 60 edits per tab carried 3,579 KB of stack against a
// 62 KB machine — 98% of the tab — and eight of them retained 105 MB.
//
// Two things are pinned here. The trim keeps the *newest* entries, because
// both stacks are popped from the end and the top of App.history is the edit
// undo reaches first. And it is applied only on the way into the background:
// exportWorkspaceState itself must still round-trip a workspace exactly, or
// StateMate's stash-and-restore would silently drop the reader's undo stack
// every time a candidate was verified.

import './dom-stub.js';
import test from 'node:test';
import assert from 'node:assert';
import { createHarness } from './harness.js';
import {
  HISTORY_STOWED_MAX_BYTES,
  HISTORY_STOWED_MAX_ENTRIES,
  trimStowedHistory
} from '../js/history.js';

const h = createHarness();
const C = h.context;
const App = C.App;

function machine(n) {
  App.machine = 'DFA';
  App.states = [];
  App.transitions = [];
  App.accepts = new Set();
  for (let i = 0; i < n; i++) App.states.push({ id: 's' + i, name: 'q' + i, x: i * 12, y: 0 });
  App.startId = 's0';
  App.accepts.add('s' + (n - 1));
  for (let i = 0; i < n; i++) {
    App.transitions.push({ id: 't' + i, from: 's' + i, to: 's' + ((i + 1) % n), symbol: 'a' });
  }
  C.invalidateStateIndex();
}

// snapshot() records the state an edit starts *from*, so it goes before the
// mutation — the contract every call site in the app follows.
function edits(count) {
  for (let i = 0; i < count; i++) {
    C.snapshot();
    App.states[0].x += 1;
  }
}

test('a stowed workspace keeps the newest entries and drops the rest', () => {
  h.resetApp();
  machine(4);
  edits(HISTORY_STOWED_MAX_ENTRIES + 25);

  const data = C.exportWorkspaceState();
  const full = data.history.slice();
  assert.equal(full.length, HISTORY_STOWED_MAX_ENTRIES + 25, 'the live stack was not capped by depth here');

  trimStowedHistory(data);
  assert.equal(data.history.length, HISTORY_STOWED_MAX_ENTRIES);
  assert.deepEqual(
    data.history,
    full.slice(full.length - HISTORY_STOWED_MAX_ENTRIES),
    'undo reaches the top of the stack first, so the top is what survives'
  );
});

test('a short stack is left exactly as it was', () => {
  h.resetApp();
  machine(3);
  edits(5);

  const data = C.exportWorkspaceState();
  const before = data.history.slice();
  trimStowedHistory(data);
  assert.deepEqual(data.history, before);
});

test('the byte budget bites when forty entries are still too large', () => {
  const big = 'x'.repeat(Math.ceil(HISTORY_STOWED_MAX_BYTES / 4));
  const data = { history: [big, big, big, big, big, big], future: [] };
  trimStowedHistory(data);

  const bytes = data.history.reduce((n, e) => n + e.length, 0);
  assert.ok(data.history.length < 6, 'entries were evicted');
  assert.ok(bytes <= HISTORY_STOWED_MAX_BYTES, `kept ${bytes} bytes`);
  assert.equal(data.history[data.history.length - 1], big, 'the newest entry survives');
});

test('one entry always survives, however large it is', () => {
  const huge = 'x'.repeat(HISTORY_STOWED_MAX_BYTES * 3);
  const data = { history: [huge], future: [] };
  trimStowedHistory(data);
  assert.equal(data.history.length, 1, 'a stack is never emptied by the byte budget');
});

test('the redo stack is trimmed the same way', () => {
  const stack = Array.from({ length: HISTORY_STOWED_MAX_ENTRIES + 10 }, (_, i) => `e${i}`);
  const data = { history: [], future: stack.slice() };
  trimStowedHistory(data);
  assert.equal(data.future.length, HISTORY_STOWED_MAX_ENTRIES);
  assert.equal(data.future[data.future.length - 1], `e${stack.length - 1}`);
});

test('an empty or absent stack is not a special case', () => {
  const data = { history: [], future: [] };
  trimStowedHistory(data);
  assert.deepEqual(data, { history: [], future: [] });
  assert.equal(trimStowedHistory(null), null);
  assert.deepEqual(trimStowedHistory({}), {});
});

test('exportWorkspaceState itself still round-trips the whole stack', () => {
  // This is the reason the trim is not inside it. StateMate stashes a
  // workspace, imports a candidate to verify it and restores in a finally;
  // trimming there would cost the reader undo entries for every verification.
  h.resetApp();
  machine(4);
  edits(HISTORY_STOWED_MAX_ENTRIES + 30);
  const depth = App.history.length;

  const stash = C.exportWorkspaceState();
  assert.equal(stash.history.length, depth, 'nothing was trimmed on the way out');

  machine(2);
  C.snapshot();
  C.importWorkspaceState(stash);
  assert.equal(App.history.length, depth, 'nor on the way back in');
});

test('the stack is copied as an array, not re-parsed entry by entry', () => {
  h.resetApp();
  machine(3);
  edits(4);

  const data = C.exportWorkspaceState();
  assert.notEqual(data.history, App.history, 'the array is a copy, so pushing to one does not grow the other');
  assert.deepEqual(data.history, App.history);

  const before = App.history.length;
  C.snapshot();
  assert.equal(data.history.length, before, 'the stowed blob did not follow the live stack');
});

test('a background tab is trimmed, the active one is not', () => {
  h.resetApp();
  C.setWorkspaces([]);
  C.initTabs();

  machine(4);
  edits(HISTORY_STOWED_MAX_ENTRIES + 20);
  const deep = App.history.length;

  // Leaving this tab is what stows it.
  C.createTab('Workspace 2');

  const ws = C.Workspaces;
  assert.equal(ws.length, 2);
  const stowed = ws[0];
  assert.ok(
    stowed.data.history.length <= HISTORY_STOWED_MAX_ENTRIES,
    `a backgrounded tab keeps at most ${HISTORY_STOWED_MAX_ENTRIES} entries, had ${stowed.data.history.length}`
  );
  assert.ok(deep > HISTORY_STOWED_MAX_ENTRIES, 'the tab really did have a deeper stack to lose');

  // And switching back still finds a usable stack rather than none.
  C.switchTab(stowed.id);
  assert.equal(App.history.length, HISTORY_STOWED_MAX_ENTRIES);
  const x = App.states[0].x;
  C.undo();
  assert.equal(App.states[0].x, x - 1, 'the recent history still undoes, one edit at a time');
});
