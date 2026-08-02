const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHarness } = require('./harness');

// js/canvas.js is deliberately not in the harness's SCRIPT_ORDER: it binds
// pointer/wheel listeners and installs a real applyCamera that needs DOM APIs
// the stub elements don't implement, which would break the other suites. The
// layout functions themselves are pure, so this loads the module into a
// harness of its own.
const harness = createHarness();
const { context } = harness;
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, '..', 'js/canvas.js'), 'utf8'),
  context,
  { filename: 'js/canvas.js' }
);

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
