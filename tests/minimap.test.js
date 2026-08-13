import test from 'node:test';
import assert from 'node:assert';
import { stubCanvas } from './dom-stub.js';
import { createHarness } from './harness.js';

const harness = createHarness();
const { context, getElement } = harness;
const { App } = context;

// The minimap needs a measurable canvas-wrap, because the viewport rectangle it
// draws comes from visibleCanvasBox().
function setup({ cssW = 160, cssH = 100 } = {}) {
  harness.resetApp();
  const wrap = getElement('canvas-wrap');
  wrap.clientWidth = 1280;
  wrap.clientHeight = 800;
  wrap.getBoundingClientRect = () => ({ left: 0, right: 1280, top: 0, bottom: 800, width: 1280, height: 800 });
  for (const id of ['lpanel', 'rpanel']) {
    const p = getElement(id);
    p.classList.remove('unpinned');
    p.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 800, width: 0, height: 800 });
  }
  App.cam = { x: 640, y: 400, z: 1 };
  return stubCanvas(getElement('minimap-canvas'), cssW, cssH);
}

function twoStates() {
  App.states = [{ id: 'q0', name: 'q0', x: 0, y: 0 }, { id: 'q1', name: 'q1', x: 200, y: 0 }];
  App.startId = 'q0';
}

// Arc calls are [x, y, r, start, end, props]. With no self-loops and no
// simulation running, drawStates is the only thing that draws circles.
function stateDiscs(ctx) {
  return ctx.calls('arc').map(([x, y, r, , , props]) => ({ x, y, r, props }));
}

// ─── backing store ────────────────────────────────────────────────────────

// The canvas used to be a fixed 160×100 backing store behind a 160×100 CSS box,
// so every hairline in it was upsampled on any HiDPI display.
test('the backing store is sized to the CSS box times the pixel ratio', () => {
  const ctx = setup();
  const canvas = getElement('minimap-canvas');
  twoStates();
  globalThis.devicePixelRatio = 2;
  try {
    context.renderMinimap();
    assert.strictEqual(canvas.width, 320);
    assert.strictEqual(canvas.height, 200);
    // ...and the context is pre-scaled to match, so the painter keeps working
    // in CSS pixels and a 1px stroke stays 1px.
    assert.deepStrictEqual(ctx.calls('setTransform')[0].slice(0, 6), [2, 0, 0, 2, 0, 0]);
  } finally {
    globalThis.devicePixelRatio = 1;
  }
});

test('an unmeasurable canvas keeps its backing store rather than blanking', () => {
  const ctx = setup();
  const canvas = getElement('minimap-canvas');
  twoStates();
  // A hidden container, or a DOM that does no layout.
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
  context.renderMinimap();
  assert.strictEqual(canvas.width, 160, 'backing store was resized to nothing');
  assert.ok(ctx.calls('fillRect').length > 0, 'nothing was painted');
});

// ─── what gets drawn ──────────────────────────────────────────────────────

// Regression: a self-loop was drawn as moveTo(from) → lineTo(to), which for
// from === to is a zero-length segment and strokes no pixels at all. Loop-heavy
// machines — most DFAs — showed as a scatter of unconnected dots.
test('a self-loop draws an arc beside its state, not a zero-length line', () => {
  const ctx = setup();
  App.states = [{ id: 'q0', name: 'q0', x: 0, y: 0 }];
  App.startId = 'q0';
  App.transitions = [{ id: 't0', from: 'q0', to: 'q0', symbol: 'a' }];
  context.renderMinimap();

  const arcs = stateDiscs(ctx);
  assert.ok(arcs.length >= 2, 'expected a loop arc as well as the state disc');
  // The default loop direction is up, so the loop sits above the state centre.
  const disc = arcs[arcs.length - 1];
  assert.ok(
    arcs.some(a => a.y < disc.y - 1),
    `no arc was drawn above the state (arcs at y=${arcs.map(a => a.y).join(', ')})`
  );
});

// The canvas draws parallel transitions as one path with a stacked label;
// stroking five identical curves here only darkens the line.
test('parallel transitions between a pair share one drawn edge', () => {
  const ctx = setup();
  twoStates();
  App.transitions = [
    { id: 't0', from: 'q0', to: 'q1', symbol: 'a' },
    { id: 't1', from: 'q0', to: 'q1', symbol: 'b' },
    { id: 't2', from: 'q0', to: 'q1', symbol: 'c' }
  ];
  context.renderMinimap();
  // moveTo comes from each edge plus the two viewport round-rects (scrim and
  // outline). Three parallel transitions must contribute one, not three.
  assert.strictEqual(ctx.calls('moveTo').length, 1 + 2);
});

test('a reverse pair splays so the two directions stay distinguishable', () => {
  const ctx = setup();
  twoStates();
  App.transitions = [
    { id: 't0', from: 'q0', to: 'q1', symbol: 'a' },
    { id: 't1', from: 'q1', to: 'q0', symbol: 'b' }
  ];
  context.renderMinimap();
  assert.strictEqual(ctx.calls('quadraticCurveTo').length - 8, 2,
    'both directions should be curved (8 quadratics belong to the two viewport round-rects)');
});

test('the simulation cursor is painted in the accent colour', () => {
  const ctx = setup();
  twoStates();
  App.simSteps = [{ state: 'q1' }];
  App.simIdx = 0;
  context.renderMinimap();

  const discs = stateDiscs(ctx);
  const accent = App.config.export.actStroke;
  assert.ok(discs.some(d => d.props.fillStyle === accent),
    'the state under the simulation cursor should be filled with the accent');
  // A halo goes down first, so the cursor is findable on a dense diagram.
  assert.strictEqual(discs.length, 3, 'expected two state discs plus one halo');
});

test('an accepting state gets a second ring in the accept colour', () => {
  const ctx = setup();
  twoStates();
  App.accepts = new Set(['q1']);
  context.renderMinimap();
  const discs = stateDiscs(ctx);
  assert.strictEqual(discs.length, 3, 'expected two state discs plus one accept ring');
  assert.ok(discs.some(d => d.props.strokeStyle === App.config.export.accStroke));
});

// ─── framing ──────────────────────────────────────────────────────────────

// The old map folded the viewport into its bounding box and re-derived the
// scale every paint, so the whole diagram rescaled and slid on every frame of a
// pan — while you were dragging the map itself. The frame now holds still
// unless the camera actually asks for more room than it has.
test('a small pan moves the viewport rectangle without rescaling the diagram', () => {
  const ctx = setup();
  twoStates();
  context.renderMinimap();
  const before = stateDiscs(ctx);

  ctx.reset();
  App.cam.x -= 1;
  context.renderMinimap();
  const after = stateDiscs(ctx);

  assert.deepStrictEqual(
    after.map(d => [d.x, d.y, d.r]),
    before.map(d => [d.x, d.y, d.r]),
    'the diagram shifted under a pan it had room for'
  );
});

test('panning past the framed region does re-frame', () => {
  const ctx = setup();
  twoStates();
  context.renderMinimap();
  const before = stateDiscs(ctx);

  ctx.reset();
  App.cam.x -= 900;
  context.renderMinimap();
  const after = stateDiscs(ctx);

  assert.notDeepStrictEqual(after.map(d => [d.x, d.y]), before.map(d => [d.x, d.y]));
  // Framing more world in the same pixels means everything got smaller.
  assert.ok(after[0].r < before[0].r, 'the map should have zoomed out to keep up');
});

test('the frame matches the canvas aspect, so the scale is uniform on both axes', () => {
  const ctx = setup({ cssW: 160, cssH: 100 });
  // Tall content against a wide canvas is the case that used to leave separate
  // x and y offsets to keep in step.
  App.states = [{ id: 'q0', name: 'q0', x: 0, y: 0 }, { id: 'q1', name: 'q1', x: 0, y: 4000 }];
  App.startId = 'q0';
  context.renderMinimap();
  const mm = getElement('minimap-canvas')._mm;
  const discs = stateDiscs(ctx);
  // One scale for both axes: the two states are 4000 apart in y and 0 in x, so
  // their drawn separation is exactly 4000 × scale.
  assert.ok(Math.abs(Math.abs(discs[1].y - discs[0].y) - 4000 * mm.scale) < 1e-6);
  assert.ok(Math.abs(discs[1].x - discs[0].x) < 1e-6);
});

// ─── hit testing ──────────────────────────────────────────────────────────

test('the projection published for pointer input inverts the one drawn with', () => {
  const ctx = setup();
  twoStates();
  context.renderMinimap();
  const mm = getElement('minimap-canvas')._mm;
  const discs = stateDiscs(ctx);

  // Forward: q0 sits at world (0, 0).
  assert.ok(Math.abs((0 - mm.ox) * mm.scale - discs[0].x) < 1e-6);
  // Inverse: the pixel q1 was drawn at maps back to world x = 200.
  assert.ok(Math.abs(discs[1].x / mm.scale + mm.ox - 200) < 1e-6);
});

test('an empty canvas publishes no projection to hit-test against', () => {
  setup();
  App.states = [];
  context.renderMinimap();
  assert.strictEqual(getElement('minimap-canvas')._mm, null);
});
