import test from 'node:test';
import assert from 'node:assert';
import { createHarness } from './harness.js';

const harness = createHarness();
const { context } = harness;

// A state circle is App.config.radius across the middle, so any two centres
// closer than a full diameter are drawn overlapping.
const overlapDistance = () => 2 * context.App.config.radius;

function reset() {
  harness.resetApp();
}

function minSeparation(states) {
  let min = Infinity;
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      min = Math.min(min, Math.hypot(states[i].x - states[j].x, states[i].y - states[j].y));
    }
  }
  return min;
}

function allFinite(states) {
  return states.every(s => Number.isFinite(s.x) && Number.isFinite(s.y));
}

// Divisibility-by-5 over binary input: state r, bit b -> (2r+b) mod 5.
// Strongly connected, which is what used to defeat the layout.
function buildMod5() {
  const { App } = context;
  App.states = [0, 1, 2, 3, 4].map(i => ({ id: 'r' + i, label: 'r' + i, x: 0, y: 0 }));
  App.transitions = [];
  for (let r = 0; r < 5; r++) {
    for (let b = 0; b < 2; b++) {
      App.transitions.push({ id: `t${r}${b}`, from: 'r' + r, to: 'r' + ((2 * r + b) % 5), sym: String(b) });
    }
  }
  App.startId = 'r0';
}

test('layered layout keeps state circles from overlapping', () => {
  reset();
  buildMod5();
  const { App, sugiyamaLayout } = context;
  sugiyamaLayout(App.states, App.transitions, App.startId);
  // Regression: spacing was measured centre-to-centre, so the default
  // nodeSpacing of 35 put rows 56px apart while a state is 60px wide.
  assert.ok(
    minSeparation(App.states) >= overlapDistance(),
    `states overlap: min separation ${minSeparation(App.states)} < ${overlapDistance()}`
  );
});

test('layered layout does not flatten a cyclic automaton into one row', () => {
  reset();
  buildMod5();
  const { App, sugiyamaLayout } = context;
  sugiyamaLayout(App.states, App.transitions, App.startId);
  const rows = new Set(App.states.map(s => s.y));
  // Longest-path ranking gave every state its own rank here, producing a
  // 5-column single-row line with long edges crossing the intervening nodes.
  assert.ok(rows.size > 1, 'expected more than one row, got a single line');
});

test('circular layout sizes the ring from node size, not just count', () => {
  reset();
  buildMod5();
  const { App, circularLayout } = context;
  circularLayout(App.states);
  assert.ok(
    minSeparation(App.states) >= overlapDistance(),
    `ring too tight: min separation ${minSeparation(App.states)}`
  );
});

test('a single state sits at the origin rather than on a ring', () => {
  reset();
  const { App, circularLayout } = context;
  App.states = [{ id: 'q0', label: 'q0', x: 99, y: 99 }];
  App.transitions = [];
  App.startId = 'q0';
  circularLayout(App.states);
  // Compared by magnitude: the trig yields -0 for the y term, which renders
  // identically to 0 but is not deep-equal to it.
  assert.strictEqual(Math.abs(App.states[0].x), 0);
  assert.strictEqual(Math.abs(App.states[0].y), 0);
});

test('hostile nodeSpacing values never overlap or produce NaN coordinates', () => {
  const { App, sugiyamaLayout, circularLayout } = context;
  for (const gap of [0, -50, NaN, undefined]) {
    reset();
    App.config.layout.nodeSpacing = gap;

    buildMod5();
    sugiyamaLayout(App.states, App.transitions, App.startId);
    assert.ok(allFinite(App.states), `sugiyama produced non-finite coords for gap=${gap}`);
    assert.ok(
      minSeparation(App.states) >= overlapDistance(),
      `sugiyama overlapped for gap=${gap}`
    );

    buildMod5();
    circularLayout(App.states);
    assert.ok(allFinite(App.states), `circular produced non-finite coords for gap=${gap}`);
    assert.ok(
      minSeparation(App.states) >= overlapDistance(),
      `circular overlapped for gap=${gap}`
    );
  }
});

test('layout survives a missing start state and disconnected components', () => {
  reset();
  const { App, sugiyamaLayout } = context;
  App.states = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 0 }, { id: 'c', x: 0, y: 0 }];
  App.transitions = [{ id: 't', from: 'a', to: 'b', sym: '0' }];
  App.startId = null; // 'c' is unreachable, and nothing is marked as start
  sugiyamaLayout(App.states, App.transitions, App.startId);
  assert.ok(allFinite(App.states), 'non-finite coordinates without a start state');
  assert.ok(
    minSeparation(App.states) >= overlapDistance(),
    'disconnected components were placed on top of each other'
  );
});

test('larger machines stay separated', () => {
  reset();
  const { App, sugiyamaLayout, circularLayout } = context;
  const n = 24;
  const build = () => {
    App.states = Array.from({ length: n }, (_, i) => ({ id: 'q' + i, label: 'q' + i, x: 0, y: 0 }));
    App.transitions = Array.from({ length: n }, (_, i) => ({
      id: 'e' + i, from: 'q' + i, to: 'q' + ((i + 1) % n), sym: '0'
    }));
    App.startId = 'q0';
  };
  build();
  sugiyamaLayout(App.states, App.transitions, App.startId);
  assert.ok(minSeparation(App.states) >= overlapDistance(), 'sugiyama overlapped at n=24');
  build();
  circularLayout(App.states);
  assert.ok(minSeparation(App.states) >= overlapDistance(), 'circular overlapped at n=24');
});

// ─── Minimap / viewport framing ───────────────────────────────────────────
// An unpinned panel is absolutely positioned over the canvas rather than
// beside it, so canvas-wrap's clientWidth includes the covered strip.

// visibleCanvasBox() returns an object constructed inside the vm realm, so
// its prototype is not the test realm's Object and deepStrictEqual rejects it
// as "not reference-equal" despite identical contents. Compare field-wise.
function assertBox(actual, expected) {
  assert.deepStrictEqual(
    { x: actual.x, y: actual.y, w: actual.w, h: actual.h },
    expected
  );
}

function stubGeometry(harnessCtx, getEl, { lpanel, rpanel }) {
  const wrap = getEl('canvas-wrap');
  wrap.clientWidth = 1280;
  wrap.clientHeight = 800;
  wrap.getBoundingClientRect = () => ({ left: 0, right: 1280, top: 0, bottom: 800, width: 1280, height: 800 });
  // applyCamera (real, from js/canvas.js) writes CSS custom properties that
  // the harness's plain-object style stub doesn't implement.
  wrap.style.setProperty = () => {};
  getEl('cam-g').style.setProperty = () => {};
  const apply = (id, spec) => {
    const p = getEl(id);
    if (spec.unpinned) p.classList.add('unpinned'); else p.classList.remove('unpinned');
    p.getBoundingClientRect = () => spec.rect;
  };
  apply('lpanel', lpanel);
  apply('rpanel', rpanel);
  return wrap;
}

const LEFT_OVER = { unpinned: true, rect: { left: 0, right: 256, top: 0, bottom: 800, width: 256, height: 800 } };
const RIGHT_OVER = { unpinned: true, rect: { left: 980, right: 1280, top: 0, bottom: 800, width: 300, height: 800 } };
const LEFT_PINNED = { unpinned: false, rect: { left: 0, right: 256, top: 0, bottom: 800, width: 256, height: 800 } };
const RIGHT_PINNED = { unpinned: false, rect: { left: 980, right: 1280, top: 0, bottom: 800, width: 300, height: 800 } };

test('visible canvas box excludes panels overlaying the canvas', () => {
  reset();
  stubGeometry(context, harness.getElement, { lpanel: LEFT_OVER, rpanel: RIGHT_OVER });
  assertBox(context.visibleCanvasBox(), { x: 256, y: 0, w: 724, h: 800 });
});

test('pinned panels are not subtracted twice', () => {
  reset();
  // A pinned panel already shrinks canvas-wrap, so subtracting its width
  // again would leave the viewport rect far too narrow.
  stubGeometry(context, harness.getElement, { lpanel: LEFT_PINNED, rpanel: RIGHT_PINNED });
  assertBox(context.visibleCanvasBox(), { x: 0, y: 0, w: 1280, h: 800 });
});

test('a panel collapsed to zero width claims no space', () => {
  reset();
  const collapsed = { unpinned: true, rect: { left: 0, right: 0, top: 0, bottom: 800, width: 0, height: 800 } };
  stubGeometry(context, harness.getElement, { lpanel: collapsed, rpanel: RIGHT_PINNED });
  assertBox(context.visibleCanvasBox(), { x: 0, y: 0, w: 1280, h: 800 });
});

test('a degenerate panel rect never yields a non-positive viewport', () => {
  reset();
  const swallowsCanvas = { unpinned: true, rect: { left: 0, right: 2000, top: 0, bottom: 800, width: 2000, height: 800 } };
  stubGeometry(context, harness.getElement, { lpanel: swallowsCanvas, rpanel: RIGHT_PINNED });
  const box = context.visibleCanvasBox();
  assert.ok(box.w > 0 && box.h > 0, `expected a positive box, got ${JSON.stringify(box)}`);
});

test('fitToScreen centres content in the visible region, not under a panel', () => {
  reset();
  const { App } = context;
  stubGeometry(context, harness.getElement, { lpanel: LEFT_OVER, rpanel: RIGHT_OVER });
  App.states = [{ id: 'q0', label: 'q0', x: 0, y: 0 }];
  App.transitions = [];
  App.startId = 'q0';
  context.fitToScreen(true);
  // The single state sits at world origin, so the camera translation is the
  // centre of the visible strip: 256 + 724/2 = 618, not 1280/2 = 640.
  assert.strictEqual(App.cam.x, 618);
});

test('switching theme repaints the minimap in the new palette', () => {
  reset();
  const { App } = context;
  const canvas = harness.getElement('minimap-canvas');
  canvas.isConnected = true;
  canvas.width = 200;
  canvas.height = 140;
  let fills = [];
  canvas.getContext = () => ({
    clearRect() {}, fillRect() { fills.push(this.fillStyle); }, beginPath() {}, arc() {},
    moveTo() {}, lineTo() {}, stroke() {}, fill() {}, rect() {}, strokeRect() {},
    save() {}, restore() {}, setLineDash() {},
    set fillStyle(v) { this._f = v; }, get fillStyle() { return this._f; },
    strokeStyle: '', lineWidth: 1
  });
  App.states = [{ id: 'q0', x: 0, y: 0 }];
  App.transitions = [];
  App.startId = 'q0';

  // Regression: applyTheme called a non-existent `drawMinimap`, guarded by a
  // typeof check, so the minimap kept the previous theme's export palette.
  for (const theme of ['dark', 'light', 'dark']) {
    fills = [];
    context.applyTheme(theme, false);
    assert.strictEqual(
      fills[0],
      App.config.export.bg,
      `minimap background did not follow the ${theme} theme`
    );
  }
});
