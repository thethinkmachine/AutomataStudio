import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// AND-regions: orthogonality, and the exponential.
//
// An OR-region is "in exactly one of these"; an AND-region is "in ALL of these
// at once". Flattening multiplies them out, and that multiplication is the real
// theorem about statecharts — the picture grows linearly while the automaton it
// denotes grows like a power.
//
// The semantics implemented is SYNCHRONOUS: on a symbol, every region takes a
// transition or none does. The consequence is the reason to pick it —
// L(AND-region) is the INTERSECTION of its regions' languages, so an AND-region
// is literally the product construction that proves regular languages are closed
// under intersection. The test named for that is the one to read first.

// Body { idle ⇄ run }  ∥  Arms { holstered ⇄ drawn }, plus a way to die.
function character(h) {
  const { App } = h.context;
  h.resetApp();
  App.machine = 'HSM';
  App.sigma = new Set(['move', 'stop', 'draw', 'holster', 'die']);
  App.states = [
    { id: 'P', x: 0, y: 0, name: 'Alive', super: true, parallel: true },
    { id: 'M', x: 0, y: 0, name: 'Body', super: true, parent: 'P', initial: 'idle' },
    { id: 'idle', x: 0, y: 0, name: 'idle', parent: 'M' },
    { id: 'run', x: 0, y: 0, name: 'run', parent: 'M' },
    { id: 'W', x: 0, y: 0, name: 'Arms', super: true, parent: 'P', initial: 'hol' },
    { id: 'hol', x: 0, y: 0, name: 'holstered', parent: 'W' },
    { id: 'drw', x: 0, y: 0, name: 'drawn', parent: 'W' },
    { id: 'dead', x: 0, y: 0, name: 'dead' }
  ];
  App.transitions = [
    { id: 'a1', from: 'idle', to: 'run', symbol: 'move' },
    { id: 'a2', from: 'run', to: 'idle', symbol: 'stop' },
    // "Ignore this event" is a self-loop on each LEAF. A self-loop drawn on the
    // REGION exits and re-enters it, which snaps Body back to its default entry
    // — correct statechart semantics, and a trap worth having written down.
    { id: 'a3', from: 'idle', to: 'idle', symbol: 'draw' },
    { id: 'a4', from: 'idle', to: 'idle', symbol: 'holster' },
    { id: 'a5', from: 'run', to: 'run', symbol: 'draw' },
    { id: 'a6', from: 'run', to: 'run', symbol: 'holster' },
    { id: 'b1', from: 'hol', to: 'drw', symbol: 'draw' },
    { id: 'b2', from: 'drw', to: 'hol', symbol: 'holster' },
    { id: 'b3', from: 'hol', to: 'hol', symbol: 'move' },
    { id: 'b4', from: 'hol', to: 'hol', symbol: 'stop' },
    { id: 'b5', from: 'drw', to: 'drw', symbol: 'move' },
    { id: 'b6', from: 'drw', to: 'drw', symbol: 'stop' },
    { id: 'g1', from: 'P', to: 'dead', symbol: 'die' }
  ];
  App.startId = 'P';
  App.accepts = new Set(['run', 'drw']);
  h.context.ensureRootComponent();
  return App;
}

const flat = h => h.context.flattenComponent({
  states: h.context.App.states, transitions: h.context.App.transitions,
  startId: h.context.App.startId, accepts: h.context.App.accepts
});
const run = (h, w) => h.context.simRSM(w).accepted;

test('entering an AND-region enters every one of its regions at once', () => {
  const h = createHarness();
  character(h);
  const f = flat(h);
  assert.deepEqual(f.states[0].origins, ['hol', 'idle'],
    'the start configuration is both defaults, simultaneously');
});

test('the language of an AND-region is the INTERSECTION of its regions', () => {
  const h = createHarness();
  character(h);
  // Accepting needs `run` AND `drawn` — neither alone will do.
  assert.equal(run(h, ['move', 'draw']), true);
  assert.equal(run(h, ['draw', 'move']), true, 'order does not matter, both hold');
  assert.equal(run(h, ['move']), false, 'running, but still holstered');
  assert.equal(run(h, ['draw']), false, 'drawn, but still idle');
  assert.equal(run(h, ['move', 'draw', 'stop']), false, 'stopped again');
});

test('the flattening is the product — that is the succinctness claim', () => {
  const h = createHarness();
  const App = character(h);
  assert.equal(flat(h).states.length, 5, '2 x 2 configurations, plus dead');

  // A third orthogonal region multiplies again rather than adding.
  App.sigma.add('duck');
  App.states.push(
    { id: 'S', x: 0, y: 0, name: 'Stance', super: true, parent: 'P', initial: 'up' },
    { id: 'up', x: 0, y: 0, name: 'up', parent: 'S' },
    { id: 'crouch', x: 0, y: 0, name: 'crouch', parent: 'S' }
  );
  for (const sym of ['move', 'stop', 'draw', 'holster']) {
    App.transitions.push({ id: 'cu' + sym, from: 'up', to: 'up', symbol: sym });
    App.transitions.push({ id: 'cc' + sym, from: 'crouch', to: 'crouch', symbol: sym });
  }
  App.transitions.push({ id: 'd1', from: 'up', to: 'crouch', symbol: 'duck' });
  App.transitions.push({ id: 'd2', from: 'crouch', to: 'up', symbol: 'duck' });
  for (const leaf of ['idle', 'run', 'hol', 'drw']) {
    App.transitions.push({ id: 'dk' + leaf, from: leaf, to: leaf, symbol: 'duck' });
  }
  assert.equal(flat(h).states.length, 2 * 2 * 2 + 1,
    'three regions of two states denote eight configurations, not six');
});

test('a symbol one region cannot take stops the whole machine', () => {
  const h = createHarness();
  const App = character(h);
  // Accept once the body has stopped again with the weapon still drawn, so the
  // verdict turns entirely on whether `stop` was allowed to happen.
  App.accepts = new Set(['idle', 'drw']);
  assert.equal(run(h, ['move', 'draw', 'stop']), true, 'both regions can stop');

  // Now Arms has no `stop` while drawn. Body still does — and under the
  // synchronous reading that is not enough: nobody moves, the word is never
  // consumed, and the run rejects. Interleaved semantics would accept here, so
  // this assertion is what pins the choice down.
  App.transitions = App.transitions.filter(t => t.id !== 'b6');
  assert.equal(run(h, ['move', 'draw', 'stop']), false);
});

test('an arrow on the AND-region itself tears down every region at once', () => {
  const h = createHarness();
  character(h);
  const f = flat(h);
  assert.equal(run(h, ['move', 'draw', 'die']), false, 'dead is not accepting');
  const deadCfgs = f.states.filter(s => s.origins.length === 1 && s.origins[0] === 'dead');
  assert.equal(deadCfgs.length, 1,
    'one dead configuration — not one per surviving Body/Arms pair');
});

test('the product is bounded by the same budget the other constructions use', () => {
  const h = createHarness();
  const App = character(h);
  App.config.maxFlatStates = 3;
  const f = flat(h);
  assert.ok(f.truncated);
  assert.ok(f.states.length <= 3);
});

test('a configuration reports every leaf it is in, for highlighting', () => {
  const h = createHarness();
  character(h);
  const f = flat(h);
  const both = f.states.find(s => s.origins.length === 2);
  assert.ok(both, 'a configuration of two simultaneous leaves exists');
  assert.ok(both.name.includes('∥'), 'and reads as one');
  assert.ok(both.origins.every(o => ['idle', 'run', 'hol', 'drw'].includes(o)),
    'both point back at nodes the user drew');
});

test('a region with fewer than two children is not orthogonal', () => {
  const h = createHarness();
  const { App } = h.context;
  h.resetApp();
  App.machine = 'HSM';
  App.states = [
    { id: 'P', x: 0, y: 0, name: 'P', super: true, parallel: true },
    { id: 'M', x: 0, y: 0, name: 'M', super: true, parent: 'P', initial: 'x' },
    { id: 'x', x: 0, y: 0, name: 'x', parent: 'M' }
  ];
  assert.equal(h.context.parallelRegionsOf(App.states).size, 0,
    'one region is not a product, so it stays on the cheap path');
});

// ══════════════════════════════════════════════════════════════════
//  ORTHOGONAL LANE RENDERING
// ══════════════════════════════════════════════════════════════════
// The dashed rules are the only thing on the canvas that distinguishes "these
// run at once" from "these are nested". They are derived from the child rects
// every pass, so the assertions below are about them tracking the layout rather
// than about exact pixels.

// Regions side by side: Body on the left, Arms on the right.
function laidOut(h) {
  const App = character(h);
  const at = (id, x, y) => { const s = App.states.find(n => n.id === id); s.x = x; s.y = y; };
  at('idle', 100, 100); at('run', 220, 100);
  at('hol', 560, 100); at('drw', 680, 100);
  at('dead', 900, 400);
  return App;
}

const laneOf = h => h.context.App.domCache.supers.get('P').__parts.lanes;
// "M x1 y1 L x2 y2" -> the four numbers.
const seg = d => d.match(/-?[\d.]+/g).map(Number);

test('an orthogonal region draws a dashed rule between its regions', () => {
  const h = createHarness();
  laidOut(h);
  h.context.renderAll();
  const node = h.context.App.domCache.supers.get('P');
  assert.ok(node.classList.contains('par-st'), 'and marks itself orthogonal');
  const lanes = node.__parts.lanes;
  assert.notEqual(lanes.style.display, 'none');
  // Vertical rule, since the two regions are spread along x.
  const [x1, y1, x2, y2] = seg(lanes.getAttribute('d'));
  assert.equal(x1, x2, 'a vertical rule between the two columns');
  assert.notEqual(y1, y2);
  // And it lands in the gap, not through either region.
  const body = h.context.App.superRects.get('M');
  const arms = h.context.App.superRects.get('W');
  assert.ok(x1 > body.x + body.w && x1 < arms.x, 'between the two, not across one');
});

test('the rule re-flows when the regions are dragged into a stack', () => {
  const h = createHarness();
  const App = laidOut(h);
  h.context.renderAll();
  const before = laneOf(h).getAttribute('d');

  // Arms moves below Body rather than beside it.
  for (const id of ['hol', 'drw']) {
    const s = App.states.find(n => n.id === id);
    s.x -= 460; s.y += 300;
  }
  h.context.refreshSuperRects();
  h.context.updateFastDOM();
  const after = laneOf(h).getAttribute('d');

  assert.notEqual(after, before);
  const [x1, y1, x2, y2] = seg(after);
  assert.equal(y1, y2, 'now a horizontal rule');
  assert.notEqual(x1, x2);
});

test('an orthogonal region draws no default-entry arrow', () => {
  const h = createHarness();
  const App = laidOut(h);
  h.context.renderAll();
  // Every region IS entered, so pointing an arrow at one child would draw a
  // claim the simulator does not make.
  assert.equal(h.context.App.domCache.supers.get('P').__parts.initDot.style.display, 'none');
  // The ordinary region inside it still shows one.
  assert.notEqual(h.context.App.domCache.supers.get('M').__parts.initDot.style.display, 'none');

  App.states.find(s => s.id === 'P').parallel = false;
  h.context.renderAll();
  const node = h.context.App.domCache.supers.get('P');
  assert.equal(node.classList.contains('par-st'), false);
  assert.equal(node.__parts.lanes.style.display, 'none', 'and the rules go with it');
});
