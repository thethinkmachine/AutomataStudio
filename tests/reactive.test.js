import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';
import { App } from '../js/state.js';
import { Change, changed, emit } from '../js/store.js';
import { REACTIVITY_LIVE, ReactiveSet, createMemo, reactiveRoot } from '../js/reactive.js';
import { updateFormalDef, _defBoxPainted } from '../js/render.js';
import { renderLanguagePanel } from '../js/language.js';
// Namespace import: machine-card's exports are not in the harness context, and an
// ESM namespace read is live, so this tracks the module's own `let`.
import * as card from '../js/machine-card.js';

// Reactivity.
//
// The app is not a Solid application and is not becoming one. The canvas hot
// path — buildLayoutContext, updateFastDOM, resolveNodeOverlaps, cullViewport —
// reads plain properties off plain objects and must keep doing so; wrapping App
// in a store proxy was measured at ~260x per property read, which on a
// 1000-state machine is most of a frame budget spent before any geometry runs.
//
// What is reactive is the derived panel content and the Sets it depends on.
// These tests pin the three things that would otherwise fail silently.

const harness = createHarness();
const { context } = harness;

function fa({ sigma = ['a', 'b'], states = ['q0', 'q1'], start = 'q0', accepts = ['q1'], edges = [] } = {}) {
  App.machine = 'DFA';
  App.sigma = new Set(sigma);
  App.states = states.map((n, i) => ({ id: 's' + i, name: n, x: 0, y: 0 }));
  const id = n => App.states.find(s => s.name === n).id;
  App.transitions = edges.map(([f, sym, t], i) => ({ id: 'e' + i, from: id(f), to: id(t), symbol: sym }));
  App.startId = id(start);
  App.accepts = new Set(accepts.map(id));
  App.stateN = states.length;
  App.transN = edges.length;
  return id;
}

// ── The build ─────────────────────────────────────────────────────
// Node's "node" export condition resolves solid-js to dist/server.js, where
// createEffect is an empty function. Nothing throws; effects simply never run.
// A suite that inherited that would pass every test below while asserting
// nothing at all, so the condition is asserted rather than assumed.

test('the reactive build of Solid is the one that loaded', () => {
  assert.equal(REACTIVITY_LIVE, true,
    'solid-js resolved to the SSR stub — run node with --conditions=browser');
});

test('effects and memos actually run', () => {
  let runs = 0;
  const [read, bump] = reactiveRoot(() => {
    const s = new ReactiveSet();
    const m = createMemo(() => { runs++; return s.size; });
    return [m, () => s.add('x')];
  });
  assert.equal(read(), 0);
  bump();
  assert.equal(read(), 1, 'a memo must see a ReactiveSet mutation');
  assert.ok(runs >= 2, 'the memo must have recomputed');
});

// ── The Set fields ────────────────────────────────────────────────
// App.accepts.add(id) is mutated in place 76 times across the app and the field
// is reassigned wholesale 33 times from twelve other modules. Reactivity is
// installed on the field by state.js so that neither path can drop it.

test('an in-place Set mutation notifies', () => {
  harness.resetApp();
  fa();
  let seen = null;
  const size = reactiveRoot(() => createMemo(() => App.accepts.size));
  seen = size();
  App.accepts.add('s0');
  assert.equal(size(), seen + 1, 'App.accepts.add must notify a memo');
});

test('a plain Set assigned from another module is coerced, not accepted', () => {
  harness.resetApp();
  // Exactly what js/statemate.js, js/persistence.js, js/history.js and nine
  // others do. If this were stored as handed over, the field would stop
  // notifying and no error would be raised anywhere.
  App.sigma = new Set(['x', 'y']);
  assert.ok(App.sigma instanceof ReactiveSet, 'a plain Set must be upgraded');
  assert.deepEqual([...App.sigma].sort(), ['x', 'y']);

  const size = reactiveRoot(() => createMemo(() => App.sigma.size));
  const before = size();
  App.sigma.add('z');
  assert.equal(size(), before + 1, 'the coerced set must still notify');
});

test('every reactive field survives a wholesale reassignment', () => {
  harness.resetApp();
  for (const key of ['sigma', 'outputAlpha', 'stackAlpha', 'accepts',
    'selectedStates', 'selectedTransitions', 'selectedNotes', 'selectedDividers']) {
    App[key] = new Set(['a']);
    assert.ok(App[key] instanceof ReactiveSet, `${key} must stay reactive`);
  }
  assert.ok(App.grammar.vars instanceof ReactiveSet, 'grammar.vars must stay reactive');
});

test('assignment builds a new set, so save-and-restore keeps its contents', () => {
  harness.resetApp();
  fa();
  // The exportWithOverrides pattern in js/export-core.js: stash the real accept
  // set, install a temporary one, put the original back in a finally. Refilling
  // the backing set in place would empty the object it just saved.
  App.accepts = new Set(['s1']);
  const saved = App.accepts;
  App.accepts = new Set(['s0']);
  assert.deepEqual([...saved], ['s1'], 'the saved reference must not have been emptied');
  App.accepts = saved;
  assert.deepEqual([...App.accepts], ['s1'], 'restoring must give back the original marks');
});

test('a ReactiveSet is a real Set, so the shape tests still hold', () => {
  harness.resetApp();
  assert.ok(App.sigma instanceof Set);
  assert.equal(typeof App.sigma.has, 'function');
  assert.deepEqual([...new ReactiveSet(['a'])], ['a']);
});

// ── The formal definition ─────────────────────────────────────────
// updateFormalDef ends in an innerHTML write and a full KaTeX re-typeset, and
// it ran on every emit(Change.GRAPH). Most graph edits do not change what the
// box shows: δ is displayed as a signature rather than as a listing, so adding
// or deleting a transition leaves Q, Σ, q0 and F alone.

test('an unchanged structure does not repaint the formal definition', () => {
  harness.resetApp();
  fa({ edges: [['q0', 'a', 'q1']] });
  emit(Change.GRAPH);
  const painted = context._defBoxPainted;
  assert.ok(painted, 'the first paint must land');

  // A transition edit: the machine changed, the displayed tuple did not.
  App.transitions.push({ id: 'e9', from: 's0', to: 's0', symbol: 'b' });
  App.transN = 2;
  emit(Change.GRAPH);
  assert.equal(context._defBoxPainted, painted,
    'a transition edit must not re-typeset the tuple');
});

test('a change to Q, F or Σ does repaint it', () => {
  harness.resetApp();
  fa({ edges: [['q0', 'a', 'q1']] });
  emit(Change.GRAPH);
  const painted = context._defBoxPainted;

  App.states.push({ id: 's9', name: 'q9', x: 0, y: 0 });
  emit(Change.GRAPH);
  assert.notEqual(context._defBoxPainted, painted, 'a new state must repaint Q');

  const afterQ = context._defBoxPainted;
  App.accepts.add('s9');
  emit(Change.GRAPH);
  assert.notEqual(context._defBoxPainted, afterQ, 'a new accept mark must repaint F');

  const afterF = context._defBoxPainted;
  App.sigma.add('c');
  emit(Change.ALPHABET, Change.GRAPH);
  assert.notEqual(context._defBoxPainted, afterF, 'a new input symbol must repaint Σ');
});

// ── The store ─────────────────────────────────────────────────────

test('changed() advances for the kind that was emitted, and only that kind', () => {
  harness.resetApp();
  const read = reactiveRoot(() => createMemo(() => [changed(Change.GRAPH), changed(Change.SAVE)]));
  const [g0, s0] = read();
  emit(Change.GRAPH);
  const [g1, s1] = read();
  assert.notEqual(g1, g0, 'GRAPH must advance');
  assert.equal(s1, s0, 'SAVE must not');
});

test('the regex cache key stays a structural probe, not a subscriber', () => {
  harness.resetApp();
  fa({ edges: [['q0', 'a', 'q1']] });
  const before = context._regexCacheKey();
  // Deliberately no emit. The key exists to catch edits nobody announced, so
  // memoising it on the change kinds would blind it to exactly those.
  App.accepts = new Set(['s0']);
  assert.notEqual(context._regexCacheKey(), before,
    'the key must notice an unannounced change to F');
});

// ── The Language panel ────────────────────────────────────────────
// Its pieces are keyed-cached inside; the guard is about the DOM writes, class
// toggles and tuple render that ran on every emit regardless.
//
// These drive updateRegex explicitly before reading the key. Under the DOM stub
// updateRPanel can abort partway (there is no #def-box to write into), so
// going through emit alone would leave the regex — which is part of the key —
// at whatever the previous test left behind.
function settleLangPanel() {
  context.updateRegex();
  renderLanguagePanel();
  return context._langPanelPainted;
}

test('an unchanged structure does not redraw the Language panel', () => {
  harness.resetApp();
  fa({ edges: [['q0', 'a', 'q1']] });
  emit(Change.GRAPH);
  const painted = settleLangPanel();
  assert.ok(painted, 'the first draw must record a key');

  emit(Change.GRAPH);
  assert.equal(settleLangPanel(), painted, 'nothing changed, nothing redrawn');
});

test('retargeting a transition redraws it, though every count is unchanged', () => {
  harness.resetApp();
  fa({ states: ['q0', 'q1', 'q2'], accepts: ['q2'], edges: [['q0', 'a', 'q1']] });
  emit(Change.GRAPH);
  const before = settleLangPanel();

  // Same number of states, transitions, accepts and symbols — only the target
  // moved. A key built from counts would miss this and freeze the panel; a key
  // built from the class label would miss it on every TM and PDA, where that
  // label is a constant.
  App.transitions[0].to = 's2';
  emit(Change.GRAPH);
  assert.notEqual(settleLangPanel(), before,
    'a retargeted edge changes the language and must redraw');
});

test('a machine switch redraws it', () => {
  harness.resetApp();
  fa({ edges: [['q0', 'a', 'q1']] });
  emit(Change.GRAPH);
  const before = settleLangPanel();
  App.machine = 'NFA';
  emit(Change.GRAPH);
  assert.notEqual(settleLangPanel(), before, 'the machine is part of the key');
});

// ── Eager memos ───────────────────────────────────────────────────

test('a derived value that throws does not abort the delivery', () => {
  harness.resetApp();
  // Solid memos are eager: deliver() writing the version signal recomputes them
  // on the spot, before any subscriber runs. Unguarded, one bad memo would take
  // the whole repaint — canvas included — down with it.
  let ran = false;
  let first = true;
  reactiveRoot(() => createMemo(() => {
    changed(Change.GRAPH);
    // createMemo runs its body on creation, so the failure has to be armed for
    // the recompute — which is the one deliver() triggers.
    if (first) { first = false; return 0; }
    throw new Error('boom');
  }));
  const off = harness.context.subscribe(Change.GRAPH, () => { ran = true; });
  try {
    assert.doesNotThrow(() => emit(Change.GRAPH));
    assert.equal(ran, true, 'subscribers must still run');
  } finally { off(); }
});

test('a memo reading a value an earlier subscriber writes must not be memoised on it', () => {
  harness.resetApp();
  fa({ edges: [['q0', 'a', 'q1']] });
  // updateRPanel runs updateRegex before renderLanguagePanel, but the eager memo
  // recomputes before either. So the Language panel's key memoises the structure
  // only and reads the regex live — pinned here because getting it wrong gives a
  // key that is stale by exactly one edit, which looks like a caching bug
  // anywhere else.
  emit(Change.GRAPH);
  const a = settleLangPanel();
  const b = settleLangPanel();
  assert.equal(a, b, 'the key must be stable across repeated settles');
  assert.ok(!/undefined/.test(a), `the key must not carry unset values: ${a}`);
});

// ── The left panel's two lists ────────────────────────────────────
// updateLPanel rebuilt both on every emit(Change.GRAPH) — 6.95ms on a
// 200-state machine — including edits that changed neither list.

test('an unchanged machine does not rebuild the States and Transitions lists', () => {
  harness.resetApp();
  fa({ edges: [['q0', 'a', 'q1']] });
  emit(Change.GRAPH);
  const painted = context._lpanelPainted;
  assert.ok(painted, 'the first draw must record a key');
  emit(Change.GRAPH);
  assert.equal(context._lpanelPainted, painted, 'nothing changed, nothing rebuilt');
});

test('a rename rebuilds them, though no id or count moved', () => {
  harness.resetApp();
  fa({ edges: [['q0', 'a', 'q1']] });
  emit(Change.GRAPH);
  const before = context._lpanelPainted;
  App.states[0].name = 'start';
  emit(Change.GRAPH);
  assert.notEqual(context._lpanelPainted, before, 'the row text changed and must redraw');
});

test('a relabelled edge rebuilds them, whatever fields its machine carries', () => {
  harness.resetApp();
  fa({ edges: [['q0', 'a', 'q1']] });
  emit(Change.GRAPH);
  const before = context._lpanelPainted;
  // The key enumerates a transition's own keys rather than a hand-written list,
  // so a field belonging to some other machine still counts.
  App.transitions[0].write = 'X';
  emit(Change.GRAPH);
  assert.notEqual(context._lpanelPainted, before, 'a new field must be part of the key');
});

test('geometry is not part of the key', () => {
  harness.resetApp();
  fa({ edges: [['q0', 'a', 'q1']] });
  emit(Change.GRAPH);
  const before = context._lpanelPainted;
  App.transitions[0].curve = 42;
  App.transitions[0].loopAngle = 1.5;
  App.states[0].x = 999;
  emit(Change.GRAPH);
  assert.equal(context._lpanelPainted, before, 'a list shows no coordinates');
});

// ── The machine card's forced reflow ──────────────────────────────
// renderExampleCard ends in repositionCanvasInfo(), a getBoundingClientRect on
// the canvas — 8.4ms of forced layout, paid even when the card is closed and
// App.meta is null. Every undo announces META, so every undo used to pay it.

test('a META announcement that did not change the card is dropped', () => {
  harness.resetApp();
  App.meta = { title: 'Divisible by 5', blurb: 'counts mod 5', inputs: [{ w: '101' }] };
  emit(Change.META);
  const painted = card._metaPainted;
  assert.ok(painted, 'the first announcement must draw');

  // What restoreSnapshot does on every undo: rehydrate and announce, with the
  // card's contents identical.
  emit(Change.META);
  assert.equal(card._metaPainted, painted, 'an unchanged card must not redraw');
});

test('an actual change to the card still draws', () => {
  harness.resetApp();
  App.meta = { title: 'A', blurb: 'b', inputs: [] };
  emit(Change.META);
  const before = card._metaPainted;
  App.meta = { title: 'A', blurb: 'b reworded', inputs: [] };
  emit(Change.META);
  assert.notEqual(card._metaPainted, before, 'a reworded blurb must redraw');
});

test('clearing the card is a change, not a no-op', () => {
  harness.resetApp();
  App.meta = { title: 'A', blurb: 'b', inputs: [] };
  emit(Change.META);
  const before = card._metaPainted;
  App.meta = null;
  emit(Change.META);
  assert.notEqual(card._metaPainted, before, 'losing a description must redraw');
});
