import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context } from './harness.js';

// The run, drawn onto a canvas that is showing blocks.
//
// The machine is flat and the canvas is a projection of it (js/view-graph.js),
// and the playback highlight is the one consumer that had never been told. It
// built its edge keys from each transition's own endpoints and looked its states
// up by their own ids — both perfectly correct about the *machine*, and both
// naming things the canvas has no node for the moment a block is on it. So from
// the first step a run touched a block, every mark went missing at once: no
// trail, no active edge, no travelling token, no arrival pulse. Nothing threw,
// and the verdict was right throughout — the whole of what was lost was the
// drawing of it, which is exactly the failure a test has to pin, because looking
// at the machine tells you nothing.

const harness = createHarness();
const { App } = context;

function canvas() {
  harness.resetApp();
  // A TM rather than a DFA, because a DFA cannot have blocks — it has no stay
  // move, so an exit edge there would consume a symbol. What is under test is
  // the *drawing*, which is machine-agnostic; the type only has to be one the
  // canvas could really be showing a block on.
  App.machine = 'TM';
  App.sigma = new Set(['a', 'b']);
  App.config.render.animateLayout = false;
}

function def(name) {
  return {
    name, machine: 'TM', sigma: ['a', 'b'],
    states: [
      { id: 'd0', x: 0, y: 0, name: 'i' },
      { id: 'd1', x: 90, y: 0, name: 'j' }
    ],
    transitions: [{ id: 'e0', from: 'd0', to: 'd1', symbol: 'a' }],
    startId: 'd0', entry: 'd0', accepts: ['d1'], version: 1
  };
}

/** Two plain states, a block beside them, and an edge that crosses into it. */
function withBlock() {
  canvas();
  App.states.push({ id: 'x1', x: 0, y: 0, name: 'A' });
  App.states.push({ id: 'x2', x: 200, y: 0, name: 'B' });
  App.transitions.push({ id: 'u1', from: 'x1', to: 'x2', symbol: 'a' });
  App.startId = 'x1';
  const { block } = context.inlineBlock(def('sub'), { x: 460, y: 0 });
  App.transitions.push({ id: 'u2', from: 'x2', to: block.entry, symbol: 'b' });
  context.invalidateViewGraph();
  context.renderAll();
  const inside = context.blockMembers(block.id);
  return { block, inside };
}

/** The run this fixture describes: A -u1-> B -u2-> into the block -> out. */
function stepsFor(block, inside) {
  const inner = App.transitions.find(t => t.from === inside[0].id && t.to === inside[1].id);
  return [
    { state: 'x1', note: '' },
    { state: 'x2', tid: 'u1', note: '' },
    { state: inside[0].id, tid: 'u2', note: '' },
    { state: inside[1].id, tid: inner.id, note: '', final: 'accept' }
  ];
}

function has(id, cls) {
  const n = App.domCache.states.get(id);
  return !!n && n.classList.contains(cls);
}

// ── the edge keys ─────────────────────────────────────────────────

test('a step that crosses into a block names the edge the canvas drew', () => {
  const { block, inside } = withBlock();
  App.simSteps = stepsFor(block, inside);

  // The model's own answer is `x2|s1`, which is a pair the *projection* does
  // not contain: the block's box stands in for everything inside it, so the
  // drawn edge is registered under the box's id.
  const keys = context.getSimStepEdgeKeys(2);
  assert.deepEqual(keys, [`x2|${block.id}`]);
  assert.ok(context.findSimEdgeGroup(keys[0]), 'and that key has a node behind it');
});

test('a step wholly inside a block names no edge at all', () => {
  const { block, inside } = withBlock();
  App.simSteps = stepsFor(block, inside);

  // Not a failure to resolve — there is genuinely nothing drawn for it. The box
  // is what is on screen, and the state half below is what lights it.
  assert.deepEqual(context.getSimStepEdgeKeys(3), []);
});

test('a step outside every block is unchanged', () => {
  const { block, inside } = withBlock();
  App.simSteps = stepsFor(block, inside);
  assert.deepEqual(context.getSimStepEdgeKeys(1), ['x1|x2']);
});

// ── what gets lit ─────────────────────────────────────────────────

test('a run inside a block lights the box standing in for it', () => {
  const { block, inside } = withBlock();
  App.simSteps = stepsFor(block, inside);
  App.simIdx = 3;
  context.updateSimCanvasHighlights(App.simSteps[3]);

  assert.ok(has(block.id, 'act-st'),
    'the block carries the playhead for a state nobody can see');
  assert.ok(has('x1', 'sim-visited-st'), 'and the route in is still a trail');
  assert.ok(has('x2', 'sim-visited-st'));
});

test('several states inside one block are one mark, not four', () => {
  const { block, inside } = withBlock();
  // A subset-style step standing on both interior states at once. They are one
  // box on screen, so a set of *machine* ids would resolve to the same node
  // twice — and the "already active?" test would be asking about ids the canvas
  // does not have.
  App.simSteps = [{ states: [inside[0].id, inside[1].id], note: '' }];
  App.simIdx = 0;
  context.updateSimCanvasHighlights(App.simSteps[0]);

  assert.ok(has(block.id, 'act-st'));
  assert.ok(!has(block.id, 'sim-visited-st'),
    'the active box is not also marked as merely visited');
});

test('the marks come off again', () => {
  const { block, inside } = withBlock();
  App.simSteps = stepsFor(block, inside);
  App.simIdx = 3;
  context.updateSimCanvasHighlights(App.simSteps[3]);
  context.clearSimCanvasHighlights();
  assert.ok(!has(block.id, 'act-st'));
  assert.ok(!has('x1', 'sim-visited-st'));
});

// ── the arrival pulse ─────────────────────────────────────────────

test('the arrival ring traces the shape of the node it arrives at', () => {
  const { block, inside } = withBlock();

  context.pulseSimState(inside[1].id, 'acc');
  const boxRing = [...App.domCache.states.get(block.id).childNodes]
    .filter(n => n.classList && n.classList.contains('sim-pulse'));
  assert.equal(boxRing.length, 1, 'a state inside a block pulses its box');
  // A ring of radius R centred on a box two hundred pixels wide is a circle
  // floating inside it, which reads as a second unexplained mark rather than as
  // "control arrived here".
  assert.equal(boxRing[0].tagName.toLowerCase(), 'rect');
  assert.ok(boxRing[0].classList.contains('is-box'), 'and takes the gentler ramp');

  context.pulseSimState('x1');
  const stRing = [...App.domCache.states.get('x1').childNodes]
    .filter(n => n.classList && n.classList.contains('sim-pulse'));
  assert.equal(stRing.length, 1);
  assert.equal(stRing[0].tagName.toLowerCase(), 'circle', 'a plain state still pulses as a circle');
  assert.ok(!stRing[0].classList.contains('is-box'));
});

// ── the map ───────────────────────────────────────────────────────

test('the minimap marks the run in drawn ids too', () => {
  const { block, inside } = withBlock();
  // drawStates compares against the projection's nodes, so an answer in the
  // machine's own ids never matched, and the marker vanished for the whole of
  // the time the run was inside a block — on the one surface whose reason to
  // exist is finding a playhead that is off screen.
  assert.equal(context.visibleNodeIdFor(inside[1].id), block.id);
  assert.equal(context.visibleNodeIdFor('x1'), 'x1');
});

// ── the trail across a scope change ───────────────────────────────

test('drilling in rebuilds the trail rather than carrying stale keys', () => {
  const { block, inside } = withBlock();
  App.simSteps = stepsFor(block, inside);
  App.simIdx = 3;
  context.updateSimCanvasHighlights(App.simSteps[3]);
  const top = App._simTrail;
  assert.ok(top.keys.has('x1|x2'));

  context.enterBlockScope(block.id);
  context.renderAll();
  context.updateSimCanvasHighlights(App.simSteps[3]);

  // Which node shows a given state is exactly what the scope change decides, so
  // a trail carried across it would be a set of keys for a diagram that is no
  // longer on screen.
  assert.notEqual(App._simTrail, top, 'the cache was rebuilt');
  assert.ok(!App._simTrail.keys.has('x1|x2'), 'and holds nothing from the level above');
  assert.ok(has(inside[1].id, 'act-st'),
    'the playhead is on the real state now that the real state is drawn');
});

// ── one level in: the preview draws the run too ───────────────────
//
// A box on the canvas is a small drawing of the machine inside it, so marks that
// stop at the box say "something in here" and nothing more. These reach the dot
// that is actually running — and cost a class each, because the preview was
// drawn once and a run moves nothing it is keyed on.

function pvEl(blockId, stateId) {
  const g = App.domCache.states.get(blockId);
  return g && g.__pvIndex ? g.__pvIndex.get(stateId) : null;
}

test('the dot that is really running lights inside the preview', () => {
  const { block, inside } = withBlock();
  App.simSteps = stepsFor(block, inside);
  App.simIdx = 3;
  context.updateSimCanvasHighlights(App.simSteps[3]);

  assert.ok(pvEl(block.id, inside[1].id).classList.contains('is-active'),
    'the interior state has its own mark, not just the box');
  assert.ok(pvEl(block.id, inside[0].id).classList.contains('is-visited'),
    'and the one it came from is on the trail');
});

test('the interior transition is drawn on its own path', () => {
  const { block, inside } = withBlock();
  App.simSteps = stepsFor(block, inside);
  App.simIdx = 3;
  context.updateSimCanvasHighlights(App.simSteps[3]);

  const active = App.domCache.states.get(block.id).__parts.pvActive;
  const d = active.getAttribute('d');
  assert.ok(d && d.startsWith('M'), 'the edge inside the box is drawn');
  // The same subpath the quiet layer under it carries, so the bright edge lies
  // exactly on the one it replaces rather than beside it.
  assert.ok(App.domCache.states.get(block.id).__parts.pvEdges.getAttribute('d').includes(d),
    'and it is the very segment the base path already had');
});

test('the preview marks come off with everything else', () => {
  const { block, inside } = withBlock();
  App.simSteps = stepsFor(block, inside);
  App.simIdx = 3;
  context.updateSimCanvasHighlights(App.simSteps[3]);
  context.clearSimCanvasHighlights();

  assert.ok(!pvEl(block.id, inside[1].id).classList.contains('is-active'));
  assert.equal(App.domCache.states.get(block.id).__parts.pvActive.getAttribute('d'), '',
    'the active path is blanked, not left lit on a box the run has left');
});

test('a step at the top level writes nothing into any preview', () => {
  const { block, inside } = withBlock();
  App.simSteps = stepsFor(block, inside);
  App.simIdx = 1;
  context.updateSimCanvasHighlights(App.simSteps[1]);

  // The cheapness of this is the point: a box the run is nowhere near is not
  // touched at all, so previews cost nothing on the machines that have many.
  assert.equal(App.domCache.states.get(block.id).__parts.pvActive.getAttribute('d'), '');
  assert.ok(!pvEl(block.id, inside[0].id).classList.contains('is-active'));
});

test('marking the run rebuilds no preview', () => {
  const { block, inside } = withBlock();
  App.simSteps = stepsFor(block, inside);
  const g = App.domCache.states.get(block.id);
  const before = { key: g.__previewKey, index: g.__pvIndex, dot: pvEl(block.id, inside[1].id) };

  for (let i = 0; i < App.simSteps.length; i++) {
    App.simIdx = i;
    context.updateSimCanvasHighlights(App.simSteps[i]);
  }

  // A run moves no state and changes no transition, so nothing the preview key
  // is built from has moved — and rebuilding a hundred child elements per box
  // per step is exactly the cost this feature must not have.
  assert.equal(g.__previewKey, before.key);
  assert.equal(g.__pvIndex, before.index, 'the index is the same object');
  assert.equal(pvEl(block.id, inside[1].id), before.dot, 'and the dot is the same element');
});

// ── the other three surfaces that light something ─────────────────
//
// Not playback, but the same failure exactly: a key or an id taken from the
// model, a lookup that comes back empty, and a surface that lights nothing with
// nothing to say it tried. They are collected here because the shape is one
// thing, and because each is invisible on any machine without a block on it.

function edgeEl(key) { return App.domCache.transitions.get(key); }

test('a selected edge that crosses into a block is drawn selected', () => {
  const { block } = withBlock();
  App.selectedTransitions = new Set(['u2']);
  context.syncSelectionClasses();

  // The worst version of the bug: `u2` is in App.selectedTransitions and Delete
  // will take it, while nothing on screen says so — a selection you cannot see
  // is one you cannot check.
  assert.ok(edgeEl(`x2|${block.id}`).classList.contains('sel-t'));
});

test('a note anchored across a boundary lights the edge and the box', () => {
  const { block, inside } = withBlock();
  App.notes = [{
    id: 'n1', x: 0, y: 0, text: 'why',
    anchorStates: [inside[0].id], anchorTransitions: ['u2']
  }];
  context.renderAll();
  context.highlightNoteAnchors('n1', true);

  assert.ok(edgeEl(`x2|${block.id}`).classList.contains('note-link-t'),
    'the crossing edge is what the anchor is on');
  assert.ok(App.domCache.states.get(block.id).classList.contains('note-link-st'),
    'and a state inside the block points at the block, not at nothing');
});

test('hovering Q lights every state, including the ones inside blocks', () => {
  const { block } = withBlock();
  context.langHighlight('Q');

  // The panel beside it reports the machine's own |Q| — every state at every
  // depth — so a highlight that lit only the top level would say the opposite
  // of the number it sits under.
  assert.ok(App.domCache.states.get('x1').classList.contains('list-hover-st'));
  assert.ok(App.domCache.states.get(block.id).classList.contains('list-hover-st'),
    'the box stands for the states it contains');
});

test('hovering a symbol lights a crossing edge once, not zero times', () => {
  const { block } = withBlock();
  context.langHighlightSymbol('b', true);
  assert.ok(edgeEl(`x2|${block.id}`).classList.contains('list-hover-t'));

  context.langHighlightSymbol('b', false);
  assert.ok(!edgeEl(`x2|${block.id}`).classList.contains('list-hover-t'));
});

test('an edge wholly inside a block lights nothing anywhere', () => {
  const { block, inside } = withBlock();
  const inner = App.transitions.find(t => t.from === inside[0].id && t.to === inside[1].id);
  App.selectedTransitions = new Set([inner.id]);
  context.syncSelectionClasses();

  // It is genuinely not on screen. The honest answer is no mark, not a mark on
  // the box — which already carries the states' own.
  assert.ok(!App.domCache.states.get(block.id).classList.contains('sel-t'));
  assert.equal(context.viewEdgeKeyFor(inner.id), null);
});
