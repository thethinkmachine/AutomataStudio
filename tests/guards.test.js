import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Guards over a FINITE flag domain.
//
// The qualifier is the feature. A guard over an integer is an infinite-state
// system and this app would be lying about the language class; over booleans it
// is state x valuation, still finite, still regular — and flattening builds that
// product, which is what "the guard is compiled away into the state space"
// means concretely.
//
// So the load-bearing test is "the flag doubles the state": if the picture with
// a guard denoted the same automaton as the picture without one, the guard would
// not be doing anything.

function door(h) {
  const { App } = h.context;
  h.resetApp();
  App.machine = 'HSM';
  App.sigma = new Set(['key', 'open']);
  App.flags = ['hasKey'];
  App.states = [
    { id: 'r', x: 0, y: 0, name: 'room' },
    { id: 'o', x: 200, y: 0, name: 'outside' }
  ];
  App.transitions = [
    { id: 't1', from: 'r', to: 'r', symbol: 'key', assign: 'hasKey' },
    { id: 't2', from: 'r', to: 'o', symbol: 'open', guard: 'hasKey' }
  ];
  App.startId = 'r';
  App.accepts = new Set(['o']);
  h.context.ensureRootComponent();
  return App;
}

const flat = h => h.context.flattenComponent({
  states: h.context.App.states, transitions: h.context.App.transitions,
  startId: h.context.App.startId, accepts: h.context.App.accepts
});
const run = (h, w) => h.context.simRSM(w).accepted;

// ── the expression language ──

test('the guard grammar parses and evaluates without eval', () => {
  const h = createHarness();
  const { parseGuard, evalGuard } = h.context;
  assert.equal(evalGuard(parseGuard('a && !b'), { a: 1, b: 0 }), true);
  assert.equal(evalGuard(parseGuard('a || b && c'), { a: 0, b: 1, c: 0 }), false, '&& binds tighter');
  assert.equal(evalGuard(parseGuard('(a || b) && c'), { a: 0, b: 1, c: 1 }), true);
  assert.equal(evalGuard(parseGuard(''), {}), true, 'no guard is not a false guard');
  assert.equal(evalGuard(parseGuard('ghost'), {}), false,
    'an undeclared flag disables its arrow rather than breaking the run');
});

test('assignments accept both the longhand and the shorthand', () => {
  const h = createHarness();
  assert.deepEqual(h.context.parseAssign('armed = true, alert=false'),
    [{ flag: 'armed', value: true }, { flag: 'alert', value: false }]);
  assert.deepEqual(h.context.parseAssign('armed, !alert'),
    [{ flag: 'armed', value: true }, { flag: 'alert', value: false }]);
});

test('a syntax error is reported rather than silently disabling the arrow', () => {
  const h = createHarness();
  assert.ok(h.context.checkGuardSyntax('a &&', ''));
  assert.ok(h.context.checkGuardSyntax('', 'armed = maybe'));
  assert.equal(h.context.checkGuardSyntax('a && !b', 'a, !b'), null);
});

// ── the product ──

test('a guard decides which words are accepted', () => {
  const h = createHarness();
  door(h);
  assert.equal(run(h, ['open']), false, 'no key, no exit');
  assert.equal(run(h, ['key', 'open']), true);
  assert.equal(run(h, ['key', 'key', 'open']), true, 'setting a flag twice is setting it once');
});

test('the flag doubles the state — the guard is compiled into the state space', () => {
  const h = createHarness();
  door(h);
  const f = flat(h);
  assert.equal(f.states.filter(s => s.origin === 'r').length, 2,
    'room-without-key and room-with-key are different states of the automaton');
  assert.ok(f.states.every(s => ['r', 'o'].includes(s.origin)),
    'and both point back at the one node the user drew');
});

test('guards apply on a flat machine, with no regions anywhere', () => {
  const h = createHarness();
  const App = door(h);
  assert.ok(App.states.every(s => !s.parent && !s.super));
  assert.ok(flat(h).states.length > App.states.length,
    'the fast "the picture denotes itself" path must not swallow a guarded machine');
});

test('history and guards are ONE product, not two passes', () => {
  const h = createHarness();
  const { App } = h.context;
  h.resetApp();
  App.machine = 'HSM';
  App.sigma = new Set(['spot', 'close', 'hurt', 'arm']);
  App.flags = ['armed'];
  App.states = [
    { id: 'p', x: 0, y: 0, name: 'patrol' },
    { id: 'R', x: 3, y: 0, name: 'Combat', super: true, initial: 'a' },
    { id: 'a', x: 2, y: 0, name: 'approach', parent: 'R' },
    { id: 'b', x: 4, y: 0, name: 'strike', parent: 'R' }
  ];
  App.transitions = [
    { id: 't0', from: 'p', to: 'p', symbol: 'arm', assign: 'armed' },
    { id: 't1', from: 'p', to: 'R', symbol: 'spot', entryMode: 'history', guard: 'armed' },
    { id: 't2', from: 'a', to: 'b', symbol: 'close' },
    { id: 't3', from: 'R', to: 'p', symbol: 'hurt' }
  ];
  App.startId = 'p';
  App.accepts = new Set(['b']);
  h.context.ensureRootComponent();

  assert.equal(run(h, ['spot', 'close']), false, 'unarmed, so the region is unreachable');
  assert.equal(run(h, ['arm', 'spot', 'close', 'hurt', 'spot']), true,
    'armed, enters, and history resumes strike');
  const ids = flat(h).states.map(s => s.id);
  assert.ok(ids.includes('p@-#0') && ids.includes('p@-#1'),
    'the id carries both coordinates — memory and valuation, in one state space');
});

// ── validation ──

test('validation names an undeclared flag and an unused one', () => {
  const h = createHarness();
  const { validateGuards } = h.context;
  assert.ok(validateGuards([{ id: 'x', symbol: 'a', guard: 'ghost' }], [])
    .some(i => i.level === 'error' && /never declared/.test(i.message)));
  assert.ok(validateGuards([], ['spare'])
    .some(i => i.level === 'warn' && /never used/.test(i.message)));
});

test('the label reads event [guard] / action', () => {
  const h = createHarness();
  const App = door(h);
  assert.equal(h.context.transLabel(App.transitions[1]), 'open [hasKey]');
  assert.equal(h.context.transLabel(App.transitions[0]), 'key / ⟨hasKey⟩');
  App.transitions[1].action = 'push';
  assert.equal(h.context.transLabel(App.transitions[1]), 'open [hasKey] / push');
});
