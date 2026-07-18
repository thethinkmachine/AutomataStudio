const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./harness');

// Simulation canvas highlighting: verifies which states/edges receive the
// act-st / sim-visited-st / sim-active-t / sim-trail-t classes as playback
// steps forward, backward, and resets. Uses a small fake-DOM registry so
// classList changes made through document.querySelector* are observable.

function makeEl() {
  const cls = new Set();
  return {
    cls,
    children: [],
    classList: {
      add: (...n) => n.forEach(x => cls.add(x)),
      remove: (...n) => n.forEach(x => cls.delete(x)),
      contains: n => cls.has(n)
    },
    querySelector: () => null,
    appendChild(c) { this.children.push(c); return c; },
    remove() { },
    setAttribute() { },
    getAttribute: () => null,
    addEventListener() { }
  };
}

function installCanvasDom(h) {
  const ctx = h.context;
  const App = ctx.App;
  const stateEls = new Map();
  const edgeEls = new Map();
  const lblEls = new Map();

  App.states.forEach(s => stateEls.set(s.id, makeEl()));
  const seen = new Set();
  App.transitions.forEach(t => {
    const k = t.from + '|' + t.to;
    if (seen.has(k)) return;
    seen.add(k);
    edgeEls.set(k, makeEl());
    lblEls.set('lbl-' + k, makeEl());
  });
  App.domCache.states = new Map(stateEls);
  App.domCache.transitions = new Map(edgeEls);

  ctx.document.querySelector = sel => {
    const st = sel.match(/^\[data-id="(.+)"\]$/);
    if (st) return stateEls.get(st[1]) || null;
    const ed = sel.match(/^\.edge-g\[data-edge="(.+)"\]$/);
    if (ed) return edgeEls.get(ed[1]) || null;
    return null;
  };
  ctx.document.querySelectorAll = sel => {
    const out = [];
    const classes = [...sel.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
    for (const el of [...stateEls.values(), ...edgeEls.values(), ...lblEls.values()]) {
      if (classes.some(c => el.cls.has(c))) out.push(el);
    }
    return out;
  };
  const realGetById = ctx.document.getElementById.bind(ctx.document);
  ctx.document.getElementById = id => lblEls.get(id) || realGetById(id);

  return { stateEls, edgeEls, lblEls };
}

function highlightedOnly(map) {
  const out = {};
  map.forEach((el, k) => { if (el.cls.size) out[k] = [...el.cls].sort().join(' '); });
  return out;
}

test('DFA playback highlights active edge, accumulates trail, and clears on reset', () => {
  const h = createHarness();
  const ctx = h.context;
  const App = ctx.App;
  h.resetApp();
  App.machine = 'DFA';
  App.sigma = new Set(['a', 'b']);
  App.states = [
    { id: 's0', name: 'q0', x: 0, y: 0 },
    { id: 's1', name: 'q1', x: 100, y: 0 },
    { id: 's2', name: 'q2', x: 200, y: 0 }
  ];
  App.startId = 's0';
  App.accepts = new Set(['s1']);
  App.transitions = [
    { id: 't1', from: 's0', to: 's1', symbol: 'a' },
    { id: 't2', from: 's1', to: 's2', symbol: 'b' },
    { id: 't3', from: 's2', to: 's1', symbol: 'a' }
  ];
  const { stateEls, edgeEls, lblEls } = installCanvasDom(h);

  ctx.simDFA(['a', 'b', 'a']);
  assert.equal(App.simSteps.length, 4);
  assert.ok(stateEls.get('s0').cls.has('act-st'), 'start state active at step 0');
  assert.deepEqual(highlightedOnly(edgeEls), {}, 'no edge highlights at step 0');

  ctx.stepFwd();
  assert.ok(stateEls.get('s1').cls.has('act-st'), 'q1 active after reading a');
  assert.ok(stateEls.get('s0').cls.has('sim-visited-st'), 'q0 joins the trail');
  assert.ok(edgeEls.get('s0|s1').cls.has('sim-active-t'), 's0→s1 edge active');
  assert.ok(lblEls.get('lbl-s0|s1').cls.has('sim-active-lbl'), 's0→s1 label active');

  ctx.stepFwd();
  assert.ok(edgeEls.get('s1|s2').cls.has('sim-active-t'), 's1→s2 becomes active');
  assert.ok(edgeEls.get('s0|s1').cls.has('sim-trail-t'), 's0→s1 demotes to trail');
  assert.ok(!edgeEls.get('s0|s1').cls.has('sim-active-t'));
  assert.ok(stateEls.get('s2').cls.has('act-st'));

  ctx.stepFwd();
  assert.ok(stateEls.get('s1').cls.has('act-st'), 'final accepting state highlighted');
  assert.ok(edgeEls.get('s2|s1').cls.has('sim-active-t'));

  ctx.stepBack();
  assert.ok(edgeEls.get('s1|s2').cls.has('sim-active-t'), 'stepping back restores step-2 highlights');
  assert.ok(!edgeEls.get('s2|s1').cls.has('sim-active-t'));

  ctx.resetSim();
  assert.deepEqual(highlightedOnly(stateEls), {}, 'reset clears all state highlights');
  assert.deepEqual(highlightedOnly(edgeEls), {}, 'reset clears all edge highlights');
});

test('ε-NFA set steps reconstruct symbol-move and ε-closure edges', () => {
  const h = createHarness();
  const ctx = h.context;
  const App = ctx.App;
  h.resetApp();
  App.machine = 'ε-NFA';
  App.sigma = new Set(['a', 'ε']);
  App.states = [
    { id: 'n0', name: 'p0', x: 0, y: 0 },
    { id: 'n1', name: 'p1', x: 100, y: 0 },
    { id: 'n2', name: 'p2', x: 200, y: 0 }
  ];
  App.startId = 'n0';
  App.accepts = new Set(['n2']);
  App.transitions = [
    { id: 'e1', from: 'n0', to: 'n1', symbol: 'ε' },
    { id: 'e2', from: 'n0', to: 'n2', symbol: 'a' },
    { id: 'e3', from: 'n1', to: 'n2', symbol: 'a' }
  ];
  const { stateEls, edgeEls } = installCanvasDom(h);

  ctx.simNFA(['a']);
  assert.ok(stateEls.get('n0').cls.has('act-st'), 'start state active');
  assert.ok(stateEls.get('n1').cls.has('act-st'), 'ε-closure state active');
  assert.ok(edgeEls.get('n0|n1').cls.has('sim-active-t'), 'ε-closure edge active at step 0');

  ctx.stepFwd();
  assert.ok(stateEls.get('n2').cls.has('act-st'));
  assert.ok(edgeEls.get('n0|n2').cls.has('sim-active-t'), 'both parallel symbol moves highlight');
  assert.ok(edgeEls.get('n1|n2').cls.has('sim-active-t'));
  assert.ok(edgeEls.get('n0|n1').cls.has('sim-trail-t'), 'ε edge demotes to trail');
});

test('TM steps record the arriving transition id and highlight its edge', () => {
  const h = createHarness();
  const ctx = h.context;
  const App = ctx.App;
  h.resetApp();
  App.machine = 'TM';
  App.sigma = new Set(['a']);
  App.stackAlpha = new Set(['a', App.config.sym.blank]);
  App.states = [
    { id: 'm0', name: 'q0', x: 0, y: 0 },
    { id: 'm1', name: 'halt', x: 100, y: 0 }
  ];
  App.startId = 'm0';
  App.accepts = new Set(['m1']);
  App.transitions = [
    { id: 'tm1', from: 'm0', to: 'm1', symbol: 'a', write: 'a', dir: 'R' }
  ];
  const { edgeEls } = installCanvasDom(h);

  ctx.simTM(['a']);
  assert.equal(App.simSteps[0].tid, null, 'initial configuration has no arriving transition');
  assert.equal(App.simSteps[1].tid, 'tm1', 'second step records the transition taken');
  ctx.stepFwd();
  assert.ok(edgeEls.get('m0|m1').cls.has('sim-active-t'), 'TM edge highlighted');
});

test('NDTM exploration steps highlight states only — BFS order is not a path', () => {
  const h = createHarness();
  const ctx = h.context;
  const App = ctx.App;
  h.resetApp();
  App.machine = 'NDTM';
  App.sigma = new Set(['a']);
  App.states = [
    { id: 'd0', name: 'q0', x: 0, y: 0 },
    { id: 'd1', name: 'q1', x: 100, y: 0 },
    { id: 'd2', name: 'qa', x: 200, y: 0 }
  ];
  App.startId = 'd0';
  App.accepts = new Set(['d2']);
  App.transitions = [
    { id: 'nd1', from: 'd0', to: 'd1', symbol: 'a', write: 'a', dir: 'R' },
    { id: 'nd2', from: 'd0', to: 'd2', symbol: 'a', write: 'a', dir: 'R' }
  ];
  const { edgeEls } = installCanvasDom(h);

  ctx.simNDTM(['a']);
  while (App.simIdx < App.simSteps.length - 1) ctx.stepFwd();
  const active = [...edgeEls.values()].filter(el => el.cls.has('sim-active-t'));
  assert.equal(active.length, 0, 'no edges marked active for exploration traces');
});
