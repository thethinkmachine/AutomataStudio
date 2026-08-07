import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// The flag declaration panel: the fourth declaration surface, and the only one
// whose size is a price rather than a vocabulary.
//
// Adding a symbol to Σ widens what the machine can read. Adding a flag to V
// DOUBLES the machine it denotes, and nothing in the picture shows that — the
// arrows look the same afterwards. So the panel states the cost out loud, and
// reconciles what is declared against what the arrows actually name, which is
// the pair of mistakes guards make easy: a typo that silently disables an arrow
// forever, and a leftover flag that doubles the flattening for nothing.

function guarded(h) {
  const { App } = h.context;
  h.resetApp();
  App.machine = 'HSM';
  App.sigma = new Set(['a', 'b']);
  App.states = [
    { id: 'q0', x: 0, y: 0, name: 'q0' },
    { id: 'q1', x: 100, y: 0, name: 'q1' }
  ];
  App.transitions = [
    { id: 't1', from: 'q0', to: 'q1', symbol: 'a', guard: 'armed' },
    { id: 't2', from: 'q1', to: 'q0', symbol: 'b', assign: '!armed' }
  ];
  App.startId = 'q0';
  App.accepts = new Set(['q1']);
  h.context.ensureRootComponent();
  // The section is hidden for machines without guards, and renderFlags skips
  // the whole-tree walk when it is — so the tests have to open it.
  h.context.$('flags-sec').style.display = '';
  return App;
}

const chips = h => h.context.$('flag-chips').innerHTML;

test('a flag is declared by name and appended, never re-sorted', () => {
  const h = createHarness();
  const App = guarded(h);
  h.context.$('flag-in').value = 'zulu, alpha';
  h.context.addFlag();
  // Declaration order IS the bit order of the valuation key, so alphabetising
  // here would silently renumber every flat state id.
  assert.deepEqual(App.flags, ['zulu', 'alpha']);
  assert.equal(h.context.$('flag-in').value, '', 'and the box clears');
});

test('a name a guard could not parse is refused rather than stored', () => {
  const h = createHarness();
  const App = guarded(h);
  h.context.$('flag-in').value = '9lives, ok, a-b';
  h.context.addFlag();
  // The guard lexer's identifier rule, enforced at the point of declaration —
  // a flag it cannot tokenise would be a guard that never parses.
  assert.deepEqual(App.flags, ['ok']);

  h.context.$('flag-in').value = 'ok';
  h.context.addFlag();
  assert.deepEqual(App.flags, ['ok'], 'and declaring one twice is not two flags');
});

test('a flag an arrow names but nobody declared is offered, not just reported', () => {
  const h = createHarness();
  guarded(h);
  h.context.renderFlags();
  assert.match(chips(h), /chip-undeclared/);
  assert.match(chips(h), /armed/);

  // Clicking it is the fix — the same one the validator asks for.
  h.context.declareFlag('armed');
  assert.deepEqual(h.context.App.flags, ['armed']);
  assert.doesNotMatch(chips(h), /chip-undeclared/);
});

test('a declared flag no arrow uses is marked, because it costs 2x for nothing', () => {
  const h = createHarness();
  guarded(h);
  h.context.declareFlag('armed');
  h.context.declareFlag('spare');
  h.context.renderFlags();
  assert.match(chips(h), /never used/, 'the unused one says so');
  assert.match(h.context.$('flag-cost').textContent, /^2 flags · /,
    'the declaration count still leads, since that is what the panel edits');
});

// The cost line reports the size of the machine that actually gets built, not
// the worst case. x2^n is the bound; the product is reachability-driven, so
// what you get is almost always far smaller — and quoting the bound instead of
// the number trains the reader to ignore a figure that never moves.
test('the cost line reports the real flattened size, not the 2^n bound', () => {
  const h = createHarness();
  const { App } = h.context;
  guarded(h);
  h.context.declareFlag('armed');
  h.context.renderFlags();
  // 'armed' starts false and only t2 assigns it — and t2 leaves q1, which is
  // unreachable while the guard on t1 is false. So one flat state, not 2x2.
  assert.match(h.context.$('flag-cost').textContent, /2 drawn → 1 flat state\b/);
  assert.equal(App.config.maxFlatStates, 4000, 'and the budget is not quoted until it is close');
});

test('exceeding the flattening ceiling is stated in the panel, not just at run time', () => {
  const h = createHarness();
  const { App } = h.context;
  guarded(h);
  // Reachable in both directions, so the product genuinely has somewhere to go.
  App.transitions.push({ id: 't3', from: 'q0', to: 'q1', symbol: 'b', assign: 'armed' });
  App.config.maxFlatStates = 1;
  h.context.declareFlag('armed');
  h.context.renderFlags();
  const cost = h.context.$('flag-cost');
  assert.match(cost.textContent, /truncated/i,
    'a truncated flattening answers for a different machine, so it has to say so');
  assert.match(cost.className, /flag-cost-over/);
  App.config.maxFlatStates = 4000;
});

test('the panel reads flags off every component, not just the one on canvas', () => {
  const h = createHarness();
  const App = guarded(h);
  const root = h.context.activeComponent();
  App.components.push({
    id: 'c99', name: 'Sub', states: [], transitions: [
      { id: 't9', from: 'x', to: 'y', symbol: 'a', guard: 'elsewhere' }
    ], startId: null, accepts: [], exitIds: [], cam: { x: 0, y: 0, z: 1 }
  });
  assert.equal(root.id, App.rootComponentId);
  h.context.renderFlags();
  // A flag is declared once for the whole machine, so a guard buried in a
  // component the user has not navigated to still has to surface here.
  assert.match(chips(h), /elsewhere/);
});

test('deleting a flag disables the arrows naming it rather than rewriting them', () => {
  const h = createHarness();
  const App = guarded(h);
  h.context.declareFlag('armed');
  h.context.delFlag('armed');
  assert.deepEqual(App.flags, []);
  assert.equal(App.transitions[0].guard, 'armed',
    'the arrow keeps its guard — an undeclared flag reads false, so re-adding it undoes this');
  h.context.renderFlags();
  assert.match(chips(h), /chip-undeclared/, 'and the panel offers the way back');
});

test('flags survive undo, save and a workspace round trip', () => {
  const h = createHarness();
  const App = guarded(h);
  h.context.declareFlag('armed');

  const blob = h.context.exportWorkspaceState();
  App.flags = [];
  h.context.importWorkspaceState(blob);
  assert.deepEqual(App.flags, ['armed'], 'workspace tabs carry them');

  h.context.snapshot();
  App.flags = ['armed', 'later'];
  h.context.undo();
  assert.deepEqual(App.flags, ['armed'], 'and so does the undo stack');
});

test('the section is offered exactly where guards are', () => {
  const h = createHarness();
  const { App, $ } = h.context;
  h.resetApp();
  for (const [m, want] of [['DFA', 'none'], ['HSM', ''], ['RSM', ''], ['NPDA', 'none']]) {
    h.context.applyMachineSwitch(m);
    assert.equal($('flags-sec').style.display, want, `${m}`);
  }
  assert.equal(App.machine, 'NPDA');
});
