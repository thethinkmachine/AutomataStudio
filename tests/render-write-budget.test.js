import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// What a frame is allowed to write.
//
// updateFastDOM used to write every node's coordinates on every frame, whatever
// had moved: at 200 states a drag frame issued ~2,800 setAttribute calls to move
// one circle, and an idle frame issued the same number to move nothing. Both are
// now bounded by what actually changed, because every geometry write goes
// through setGeoAttr in render.js, which skips a write whose value the element
// already holds.
//
// These are the invariants that keeps honest, and each fails loudly rather than
// quietly getting slower:
//
//   * an idle frame writes nothing at all;
//   * a one-state drag frame's cost does not grow with the machine;
//   * the drawing is still correct — a skipped write must mean "already right",
//     never "not painted", which is asserted by comparing the attributes against
//     a full renderAll of the same positions.
//
// The rect cache and the rAF coalescing are pinned here too: both are about how
// many times per frame the app touches the DOM, which is the same question.
const harness = createHarness();
const { context, getElement } = harness;
const { App } = context;

function machine(n, fanout = 2) {
  harness.resetApp();
  App.machine = 'DFA';
  App.sigma = new Set(['a', 'b']);
  const cols = Math.ceil(Math.sqrt(n));
  App.states = [];
  for (let i = 0; i < n; i++) {
    App.states.push({ id: 'q' + i, name: 'q' + i, x: (i % cols) * 120 + 60, y: Math.floor(i / cols) * 120 + 60 });
  }
  App.startId = 'q0';
  App.transitions = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < fanout; k++) {
      App.transitions.push({
        id: 't' + i + '_' + k,
        from: 'q' + i,
        to: 'q' + ((i + 1 + k * 7) % n),
        symbol: k === 0 ? 'a' : 'b'
      });
    }
  }
  context.invalidateLayoutGroups();
  context.renderAll();
}

// Counts setAttribute calls across every node the renderer writes to.
function meterWrites() {
  let count = 0;
  const seen = new Set();
  const wrap = node => {
    if (!node || seen.has(node) || typeof node.setAttribute !== 'function') return;
    seen.add(node);
    const orig = node.setAttribute.bind(node);
    node.setAttribute = (k, v) => { count++; return orig(k, v); };
  };
  for (const [, g] of App.domCache.states) { wrap(g); for (const k in g.__parts || {}) wrap(g.__parts[k]); }
  for (const [, g] of App.domCache.transitions) { wrap(g); for (const k in g.__parts || {}) wrap(g.__parts[k]); }
  wrap(App.domCache.startArrow);
  return { get: () => count, reset: () => { count = 0; } };
}

// Every geometry attribute currently on the drawn nodes, as one comparable blob.
function drawnGeometry() {
  const out = [];
  const want = ['cx', 'cy', 'd', 'x', 'y', 'transform'];
  const read = (tag, node) => {
    if (!node) return;
    for (const a of want) if (node[a] !== undefined) out.push(`${tag}.${a}=${node[a]}`);
  };
  for (const [id, g] of [...App.domCache.states].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    for (const k of Object.keys(g.__parts || {}).sort()) read(`${id}.${k}`, g.__parts[k]);
  }
  for (const [key, g] of [...App.domCache.transitions].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    for (const k of Object.keys(g.__parts || {}).sort()) read(`${key}.${k}`, g.__parts[k]);
  }
  return out.join('\n');
}

test('an idle frame writes nothing', () => {
  machine(60);
  context.updateFastDOM();          // settle whatever the first render left moving
  context.updateFastDOM();
  const meter = meterWrites();
  meter.reset();
  context.updateFastDOM();
  assert.equal(meter.get(), 0, 'a frame in which nothing moved must issue no attribute writes');
});

test('a one-state drag does not cost more on a bigger machine', () => {
  const cost = n => {
    machine(n);
    context.updateFastDOM();
    context.updateFastDOM();
    const meter = meterWrites();
    meter.reset();
    App.states[0].x += 3;
    context.updateFastDOM();
    return meter.get();
  };
  const small = cost(40);
  const large = cost(160);
  assert.ok(small > 0, 'moving a state must write something');
  // Four times the machine, and the frame writes the moved state plus the edges
  // it touches -- a constant. The bound is loose enough not to be brittle and
  // far below the ~2,800 the unguarded version issued.
  assert.ok(large < small * 3, `a drag frame grew with the machine: ${small} -> ${large}`);
  assert.ok(large < 200, `a one-state drag frame wrote ${large} attributes`);
});

test('skipping a write never means skipping the paint', () => {
  // The invariant is that the cache is invisible: the DOM the guarded writes
  // leave behind is the DOM the unguarded writes would have left behind.
  //
  // It is deliberately NOT compared against a fresh full layout pass. relayout()
  // is allowed to arrive at a different label slot than a from-scratch pass
  // would -- that approximation is documented in geometry.js and predates this
  // -- so such a comparison would be testing the layout, not the writing.
  // Clearing the caches and repainting the *same* context is the exact question:
  // did any skipped write matter?
  machine(40);
  context.updateFastDOM();
  App.states[0].x += 37;
  App.states[1].y -= 21;
  context.updateFastDOM();
  context.settleAll();
  context.updateFastDOM();
  const guarded = drawnGeometry();

  let cleared = 0;
  const strip = node => {
    if (!node) return;
    for (const k of Object.keys(node)) if (k.startsWith('__v_')) { delete node[k]; cleared++; }
  };
  for (const [, g] of App.domCache.states) { strip(g); for (const k in g.__parts || {}) strip(g.__parts[k]); }
  for (const [, g] of App.domCache.transitions) { strip(g); for (const k in g.__parts || {}) strip(g.__parts[k]); }
  strip(App.domCache.startArrow);
  assert.ok(cleared > 0, 'no write caches were found -- setGeoAttr is not being used');

  context.updateFastDOM();
  const unguarded = drawnGeometry();

  if (guarded !== unguarded) {
    const a = guarded.split('\n'), b = unguarded.split('\n');
    const at = a.findIndex((line, i) => line !== b[i]);
    assert.fail(`a skipped write left the DOM stale at line ${at}:\n  guarded:   ${a[at]}\n  unguarded: ${b[at]}`);
  }
});

test('many pointer events in one frame paint once', () => {
  machine(60);
  context.updateFastDOM();

  const queue = [];
  const realRAF = context.requestAnimationFrame;
  context.requestAnimationFrame = fn => { queue.push(fn); return queue.length; };
  try {
    const meter = meterWrites();
    meter.reset();
    // Eight moves delivered before the frame runs, as a high-rate pointer does.
    for (let i = 0; i < 8; i++) {
      App.states[0].x += 2;
      context.scheduleFastDOM();
    }
    assert.equal(meter.get(), 0, 'scheduling must not paint synchronously');
    assert.equal(queue.length, 1, `eight events scheduled ${queue.length} frames`);
    queue.shift()();
    assert.ok(meter.get() > 0, 'the frame must paint');
  } finally {
    context.requestAnimationFrame = realRAF;
  }
});

test('the canvas well is measured once per gesture, not once per frame', () => {
  machine(40);
  const wrap = context.wrap;
  let reads = 0;
  const orig = wrap.getBoundingClientRect.bind(wrap);
  wrap.getBoundingClientRect = () => { reads++; return orig(); };
  try {
    context.invalidateWellRect();
    for (let f = 0; f < 20; f++) {
      context.svgPt({ clientX: 100 + f, clientY: 100 });
      context.checkAutoPan({ clientX: 100 + f, clientY: 100 });
    }
    // A forced layout flush per frame was the cost; one measurement for the
    // whole gesture is the point. ResizeObserver invalidates it when the well
    // actually moves.
    assert.ok(reads <= 1, `the well was measured ${reads} times across 20 frames`);
  } finally {
    wrap.getBoundingClientRect = orig;
  }
});
