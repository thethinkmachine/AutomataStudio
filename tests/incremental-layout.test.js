import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context } from './harness.js';

// A drag frame used to re-route every edge and re-place every label in the
// diagram, sixty times a second. That is why the worst machine in the app was
// the one just *under* the collision budget: at 200 states a drag frame cost
// ~22 ms against a 16.7 ms budget, while at 210 states the stages are skipped
// wholesale and the same frame cost ~1 ms.
//
// buildLayoutContext({ since }) rebuilds only what a change could have altered.
// The invariant that makes that safe is the first test here: **the routes it
// arrives at are the routes a full pass would have computed.** Label placement
// is deliberately allowed to differ — see relayout() — because a label
// re-optimising during a drag it is not part of reads as jitter, and every
// structural edit takes a full pass anyway.

const { App } = context;

function build(nStates, nTrans, spread = 12) {
  createHarness();
  App.machine = 'TM';
  App.sigma = new Set(['a', 'b']);
  App.states = []; App.transitions = []; App.accepts = new Set();
  for (let i = 0; i < nStates; i++) {
    App.states.push({
      id: 's' + i, name: 'q' + i,
      x: 100 + (i % spread) * 90, y: 100 + Math.floor(i / spread) * 90
    });
  }
  App.startId = 's0';
  App.accepts.add('s' + (nStates - 1));
  App.stateN = nStates;
  for (let i = 0; i < nTrans; i++) {
    App.transitions.push({
      id: 't' + i, from: 's' + (i % nStates), to: 's' + ((i * 7 + 3) % nStates),
      symbol: i % 2 ? 'a' : 'b', read: i % 2 ? 'a' : 'b',
      write: i % 2 ? 'b' : 'a', dir: i % 2 ? 'R' : 'L'
    });
  }
  App.transN = nTrans;
  // Eased drawing interpolates toward the target over several frames, so a
  // mid-drag comparison would be measuring the easing rather than the layout.
  App.config.render.animateLayout = false;
}

/** Every edge's drawn path and label position, as the DOM currently holds it. */
function drawn() {
  const out = new Map();
  for (const [key, grp] of App.domCache.transitions) {
    const p = grp.__parts;
    if (!p) continue;
    out.set(key, {
      d: p.pathEl.getAttribute('d'),
      lx: Number(p.textEl.getAttribute('x')),
      ly: Number(p.textEl.getAttribute('y'))
    });
  }
  return out;
}

/** Drag one state along a path, one updateFastDOM per frame. */
function dragOne(frames = 24) {
  const s = App.states[Math.floor(App.states.length / 2)];
  const x0 = s.x, y0 = s.y;
  context.updateFastDOM();
  for (let f = 0; f < frames; f++) {
    s.x = x0 + Math.sin(f / 4) * 140;
    s.y = y0 + Math.cos(f / 4) * 110;
    context.updateFastDOM();
  }
  return s;
}

test('an incrementally dragged diagram is routed the way a full pass routes it', () => {
  build(120, 240);
  context.renderAll();
  dragOne();

  const incremental = drawn();
  // renderAll takes a full pass — it hands no `since` — at the same positions.
  context.renderAll();
  const full = drawn();

  let compared = 0, pathDiff = 0;
  for (const [key, a] of full) {
    const b = incremental.get(key);
    if (!b) continue;
    compared++;
    if (a.d !== b.d) pathDiff++;
  }
  assert.ok(compared > 50, `expected a real diagram to compare, got ${compared} edges`);
  assert.equal(pathDiff, 0,
    `${pathDiff} of ${compared} edges were routed differently by the incremental pass — ` +
    'the dirty set is missing edges the moved state blocks or unblocks');
});

test('moving a state re-routes the edges it steps into, not just its own', () => {
  build(40, 60, 8);
  context.renderAll();
  context.updateFastDOM();
  const before = drawn();

  // A state with no transitions of its own, walked into the middle of the
  // diagram: every edge that changes shape does so purely as a blocker effect.
  const loner = { id: 'lone', name: 'lone', x: -400, y: -400 };
  App.states.push(loner);
  context.renderAll();
  context.updateFastDOM();

  loner.x = App.states[20].x + 45;
  loner.y = App.states[20].y + 45;
  context.updateFastDOM();
  const after = drawn();

  let moved = 0;
  for (const [key, a] of before) {
    const b = after.get(key);
    if (b && a.d !== b.d) moved++;
  }
  assert.ok(moved > 0, 'a state dropped into the middle of the diagram bent nothing');

  // And the incremental answer is still the full pass's answer.
  const inc = drawn();
  context.renderAll();
  const full = drawn();
  let diff = 0;
  for (const [key, a] of full) if (inc.has(key) && inc.get(key).d !== a.d) diff++;
  assert.equal(diff, 0, `${diff} edges disagree after a pure blocker move`);
});

test('a hand-set curve is picked up without any state moving', () => {
  build(30, 40, 6);
  context.renderAll();
  context.updateFastDOM();
  const before = drawn();

  const t = App.transitions.find(x => x.from !== x.to);
  t.curve = 140;
  context.updateFastDOM();
  const after = drawn();

  const key = `${t.from}|${t.to}`;
  assert.notEqual(after.get(key)?.d, before.get(key)?.d,
    'dragging an edge handle changes no state position, so the pass has to notice the curve itself');
});

test('a structural edit is not served from the previous frame', () => {
  build(30, 40, 6);
  context.renderAll();
  context.updateFastDOM();

  App.states.push({ id: 'sNew', name: 'qNew', x: 300, y: 300 });
  App.transitions.push({ id: 'tNew', from: 's0', to: 'sNew', symbol: 'a', read: 'a', write: 'a', dir: 'R' });
  App.stateN++; App.transN++;
  context.renderAll();

  assert.ok(drawn().has('s0|sNew'), 'a new edge has to reach the diagram');
});

test('nothing moving costs nothing', () => {
  build(120, 240);
  context.renderAll();
  context.updateFastDOM();
  const a = drawn();
  context.updateFastDOM();
  context.updateFastDOM();
  const b = drawn();
  for (const [key, v] of a) {
    assert.equal(b.get(key)?.d, v.d, `idle frames moved edge ${key}`);
  }
});
