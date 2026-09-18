import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context } from './harness.js';

// The label stage exists twice — compiled in wasm/label-penalty.ts and in JS in
// geometry.js — because the kernel cannot always be compiled: Chrome refuses
// synchronous compilation past 4KB on the main thread, a CSP can forbid it
// outright, and an engine may have no WebAssembly at all. js/label-wasm.js
// answers `null` in every one of those cases and the pass falls back.
//
// So the fallback is not a degraded mode; it is the same diagram computed the
// other way, and that is what this file pins. Everything else in the suite runs
// the kernel, because on any machine that can compile it that is what is in
// force — which is exactly why the other branch needs a test of its own.

const { App } = context;

function build(nStates, nTrans, machine = 'DFA') {
  createHarness();
  App.machine = machine;
  App.sigma = new Set(['a', 'b']);
  App.states = []; App.transitions = []; App.accepts = new Set();
  for (let i = 0; i < nStates; i++) {
    App.states.push({
      id: 's' + i, name: 'q' + i,
      // Deliberately irregular: a lattice puts every label in an identical
      // neighbourhood, where a disagreement has nowhere to show itself.
      x: 120 + ((i * 137) % 900) + (i % 7) * 11,
      y: 120 + ((i * 89) % 600) + (i % 5) * 13
    });
  }
  App.startId = 's0';
  App.accepts.add('s' + (nStates - 1));
  App.stateN = nStates;
  for (let i = 0; i < nTrans; i++) {
    App.transitions.push({
      id: 't' + i,
      from: 's' + (i % nStates),
      to: 's' + ((i * 7 + 3) % nStates),
      symbol: i % 2 ? 'a' : 'b'
    });
  }
  App.transN = nTrans;
}

// Everything the label stage decides, in a comparable form.
function labelLayout() {
  context.invalidateLayoutGroups();
  const ctx = context.buildLayoutContext({ collide: true });
  const out = [];
  for (const g of ctx.groups) {
    const geo = ctx.geo.get(g.key);
    out.push(geo ? `${g.key} ${geo.lx} ${geo.ly}` : `${g.key} -`);
  }
  return out;
}

test('the kernel compiles here, so the suite is exercising it', () => {
  build(10, 14);
  assert.equal(context.labelKernel(), 'wasm',
    'wasm did not compile in this environment — every other assertion here is vacuous');
});

test('wasm and JS place every label identically', () => {
  for (const [n, t] of [[12, 18], [40, 80], [120, 260]]) {
    build(n, t);

    assert.equal(context.setLabelKernel('auto'), 'wasm');
    const withWasm = labelLayout();

    assert.equal(context.setLabelKernel('js'), 'js');
    const withJs = labelLayout();

    context.setLabelKernel('auto');

    assert.ok(withWasm.length > 0, 'the fixture produced no labels to compare');
    // Exact, not approximate: a label position is a sum of f64 penalties, and
    // two implementations that only nearly agree would drift a diagram apart
    // over a drag rather than at the first frame.
    assert.deepEqual(withJs, withWasm,
      `${n} states / ${t} transitions: the two kernels laid labels out differently`);
  }
});

test('the two kernels agree on the incremental path as well', () => {
  // relayout reuses the previous pass's boxes and re-places only the dirty
  // ones, so it reaches addLabelBox and labelPenalty by a different route than
  // a full pass does — and in wasm mode it is also where resetGrids has to land
  // after the dirty scan has read the previous pass's JS label grid.
  //
  // What is compared is the two kernels against each other, drag for drag, and
  // deliberately *not* the incremental result against a full pass: a label that
  // did not move is not re-examined against one that did, which is the one
  // approximation relayout is documented to make. Routes are exact and are
  // pinned by tests/incremental-layout.test.js; labels are not, and asserting
  // otherwise here would be testing the wrong thing in both kernels at once.
  const drag = (mode) => {
    build(60, 120);
    context.setLabelKernel(mode);
    context.invalidateLayoutGroups();
    let ctx = context.buildLayoutContext({ collide: true });
    const moved = App.states[17];
    const seen = [];
    for (let f = 0; f < 8; f++) {
      moved.x += 6; moved.y -= 4;
      ctx = context.buildLayoutContext({ collide: true, since: ctx });
      for (const g of ctx.groups) {
        const geo = ctx.geo.get(g.key);
        seen.push(geo ? `${f} ${g.key} ${geo.lx} ${geo.ly}` : `${f} ${g.key} -`);
      }
    }
    return seen;
  };

  const withWasm = drag('auto');
  const withJs = drag('js');
  context.setLabelKernel('auto');

  assert.ok(withWasm.length > 0, 'the drag produced no labels to compare');
  assert.deepEqual(withJs, withWasm,
    'the kernels diverged part-way through a drag, which a single frame would not show');
});

test('a forced-JS test does not leak the fallback into the next one', () => {
  build(10, 14);
  context.setLabelKernel('js');
  assert.equal(context.labelKernel(), 'js');
  createHarness();                       // what every test starts with
  assert.equal(context.labelKernel(), 'wasm');
});
