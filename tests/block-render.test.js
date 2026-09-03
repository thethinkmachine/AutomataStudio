import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context, getElement } from './harness.js';

// A block *is* its preview.
//
// The whole idea of the feature is that a block on the canvas is not a labelled
// placeholder but a small drawing of the machine inside it — read by silhouette,
// the way the minimap is read. So the thing worth pinning is that the block and
// the minimap draw from the same geometry, and that drawing it costs what a
// preview should cost rather than what a second canvas would.

const harness = createHarness();
const { App } = context;
const ANY = 'Σ';
const BLANK = '⊔';

function tmCanvas() {
  harness.resetApp();
  App.machine = 'TM';
  App.sigma = new Set(['a', 'b']);
  App.stackAlpha = new Set(['a', 'b', BLANK]);
  App.config.render.animateLayout = false;
}

function def(name, n = 4) {
  const states = [];
  const transitions = [];
  for (let i = 0; i < n; i++) states.push({ id: 'd' + i, x: i * 90, y: (i % 2) * 70, name: 'q' + i });
  for (let i = 0; i + 1 < n; i++) {
    transitions.push({ id: 'e' + i, from: 'd' + i, to: 'd' + (i + 1), symbol: 'a', write: 'a', dir: 'R' });
  }
  transitions.push({ id: 'loop', from: 'd0', to: 'd0', symbol: 'b', write: 'b', dir: 'R' });
  return {
    name, machine: 'TM', sigma: ['a', 'b'], stackAlpha: ['a', 'b', BLANK],
    states, transitions, startId: 'd0', entry: 'd0', accepts: ['d' + (n - 1)], version: 1
  };
}

function placeBlock(name = 'seek', n = 4, at = { x: 300, y: 200 }) {
  const { block } = context.inlineBlock(def(name, n), at);
  context.invalidateViewGraph();
  return block;
}

function blockNode(id) { return App.domCache.states.get(id); }

// ── the drawing ───────────────────────────────────────────────────

test('a block draws one rounded body, a title on it, and a preview', () => {
  tmCanvas();
  const block = placeBlock();
  context.renderAll();

  const g = blockNode(block.id);
  assert.ok(g, 'the block has a node');
  assert.equal(g.__kind, 'block');
  const p = g.__parts;
  assert.ok(p.body && p.title && p.count && p.preview);
  assert.equal(p.title.textContent, 'seek', 'the box carries the name');
  assert.equal(p.count.textContent, '4', 'and the count of what is inside');

  // There is exactly ONE filled shape, and that is the point rather than an
  // implementation detail. A filled title strip laid over a rounded body is a
  // shape problem with no good answer: square, its corners stick out past the
  // body's radius as two pointed ears; rounded to match, the two radii meet in a
  // visible notch. The title needs no band behind it — the box already frames
  // it — so the second shape was removed rather than reshaped.
  assert.equal(p.strip, undefined, 'no second filled shape over the body');
  assert.ok(Number(p.body.getAttribute('rx')) > 0, 'and the one body is rounded');
});

test('the preview draws one mark per thing inside, and the wiring between them', () => {
  tmCanvas();
  const block = placeBlock('seek', 4);
  context.renderAll();
  const p = blockNode(block.id).__parts;

  assert.equal(p.pvNodes.childNodes.length, 4, 'four states, four marks');
  const d = p.pvEdges.getAttribute('d');
  assert.ok(d && d.length > 0, 'and the edges are one path');
  // Three chained edges plus a self-loop. Each subpath begins with its own M,
  // which is what stops the loop being joined to the edge before it by a line
  // across the whole preview.
  assert.equal((d.match(/M /g) || []).length, 4);
});

test('a nested block draws as a rect, so the silhouette says there is more below', () => {
  tmCanvas();
  const outer = context.inlineBlock({
    ...def('ALU', 2),
    states: [
      { id: 'd0', x: 0, y: 0, name: 'in' },
      { id: 'd1', x: 120, y: 0, name: 'add/step', blockId: 'k1' }
    ],
    transitions: [{ id: 'e0', from: 'd0', to: 'd1', symbol: ANY, write: ANY, dir: 'S' }],
    blocks: [{ id: 'k1', name: 'add', parent: null, entry: 'd1', exits: [{ id: 'd1', label: 'done' }], x: 120, y: 0 }],
    accepts: ['d1']
  }, {}).block;
  context.invalidateViewGraph();
  context.renderAll();

  const marks = [...blockNode(outer.id).__parts.pvNodes.childNodes];
  assert.equal(marks.length, 2, 'one state and one nested block');
  const tag = m => String(m.tagName).toLowerCase();
  assert.equal(marks.filter(m => tag(m) === 'rect').length, 1);
  assert.equal(marks.filter(m => tag(m) === 'circle').length, 1);
});

test('the preview shows the immediate contents, not every leaf beneath them', () => {
  tmCanvas();
  // A block whose child block holds twenty states: the box shows the child, not
  // twenty dots. Depth is one on purpose — depth two stops being information.
  const inner = [];
  for (let i = 0; i < 20; i++) inner.push({ id: 'k' + i, x: i * 40, y: 60, name: 'mul/q' + i, blockId: 'kb' });
  const outer = context.inlineBlock({
    name: 'ALU', machine: 'TM', sigma: ['a'], stackAlpha: ['a', BLANK],
    states: [{ id: 'd0', x: 0, y: 0, name: 'in' }, ...inner],
    transitions: [{ id: 'e0', from: 'd0', to: 'k0', symbol: ANY, write: ANY, dir: 'S' }],
    blocks: [{ id: 'kb', name: 'mul', parent: null, entry: 'k0', exits: [{ id: 'k19', label: 'done' }], x: 400, y: 60 }],
    startId: 'd0', entry: 'd0', accepts: ['k19']
  }, {}).block;
  context.invalidateViewGraph();
  context.renderAll();

  const marks = blockNode(outer.id).__parts.pvNodes.childNodes;
  assert.equal(marks.length, 2, 'one state plus one child block, not twenty-one');
});

test('the preview is clipped to the body, below the strip', () => {
  tmCanvas();
  const block = placeBlock();
  context.renderAll();
  const p = blockNode(block.id).__parts;

  const node = context.getNode(block.id);
  const top = node.y - node.box.h / 2;
  assert.equal(Number(p.clipRect.getAttribute('y')), top + context.BLOCK_STRIP_H,
    'the clip starts under the title strip, so a preview can never paint over the name');
  assert.equal(p.preview.getAttribute('clip-path'), `url(#bn-clip-${block.id})`);
});

// ── the preview and the minimap are one drawing ───────────────────

test('the block preview and the minimap fit a graph the same way', () => {
  // Not "they look alike" — the same functions, so they cannot drift into two
  // implementations that merely resemble each other.
  const nodes = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 200, y: 120 },
    { id: 'c', x: -80, y: 60 }
  ];
  const bounds = context.thumbBounds(nodes, 30);
  const fit = context.thumbFit(bounds, { x: 0, y: 0, w: 100, h: 60 });

  // Uniform: a preview that stretched to fill its box would not be the diagram
  // any more, which is the whole thing it is for.
  const dx = fit.px(200) - fit.px(0);
  const dy = fit.py(120) - fit.py(0);
  assert.ok(Math.abs(dx / 200 - dy / 120) < 1e-9, 'one scale on both axes');
  assert.ok(fit.scale > 0);
});

test('parallel transitions collapse to one drawn edge', () => {
  const pairs = context.thumbEdgePairs([
    { from: 'a', to: 'b', symbol: 'x' },
    { from: 'a', to: 'b', symbol: 'y' },
    { from: 'b', to: 'a', symbol: 'z' }
  ]);
  assert.equal(pairs.size, 2, 'one per ordered pair, not one per transition');
});

test('a self-loop is its own subpath', () => {
  // Drawn as from→to it is a zero-length segment that strokes nothing at all,
  // and appended without a break it is joined to the previous edge by a line
  // across the whole thumbnail. Both were real minimap bugs.
  const byId = new Map([['a', { id: 'a', x: 0, y: 0 }], ['b', { id: 'b', x: 100, y: 0 }]]);
  const pairs = context.thumbEdgePairs([
    { from: 'a', to: 'b' },
    { from: 'b', to: 'b' }
  ]);
  const segs = context.thumbEdgeSegments(pairs, byId, { px: x => x, py: y => y, scale: 1 }, 4);
  assert.equal(segs.filter(s => s.kind === 'loop').length, 1);

  const d = context.thumbEdgePath(segs);
  assert.equal((d.match(/M /g) || []).length, 2, 'two subpaths, two moves');
});

// ── cost ──────────────────────────────────────────────────────────

test('the preview is rebuilt when the interior changes, and not otherwise', () => {
  tmCanvas();
  const block = placeBlock();
  context.renderAll();
  const g = blockNode(block.id);
  const first = g.__parts.pvNodes.childNodes[0];
  const key = g.__previewKey;

  // An idle repaint must not rebuild it: renderAll runs on every graph emit,
  // and rebuilding a hundred elements per block per emit is the cost the key
  // exists to avoid.
  context.renderAll();
  assert.equal(g.__previewKey, key);
  assert.equal(g.__parts.pvNodes.childNodes[0], first, 'the same elements');

  // Moving a state inside it does rebuild — nothing announces that, so the key
  // is derived rather than invalidated.
  context.blockMembers(block.id)[0].x += 60;
  context.renderAll();
  assert.notEqual(g.__previewKey, key);
});

test('dragging a block moves the box without rebuilding the preview', () => {
  tmCanvas();
  const block = placeBlock();
  context.renderAll();
  const g = blockNode(block.id);
  const key = g.__previewKey;
  const first = g.__parts.pvNodes.childNodes[0];

  const record = App.blocks.find(b => b.id === block.id);
  const x0 = record.x;
  for (let f = 0; f < 20; f++) {
    record.x = x0 + f * 12;
    context.updateFastDOM();
  }

  assert.equal(g.__previewKey, key, 'the interior did not change, so nothing was rebuilt');
  assert.equal(g.__parts.pvNodes.childNodes[0], first);
  const box = context.getNode(block.id).box;
  assert.equal(Number(g.__parts.body.getAttribute('x')), record.x - box.w / 2,
    'and the box really did move');
});

test('a block is one node in the registry, however much is inside it', () => {
  tmCanvas();
  placeBlock('a', 30);
  placeBlock('b', 30, { x: 900, y: 200 });
  context.renderAll();
  assert.equal(App.domCache.states.size, 2, 'sixty states, two nodes');
});

// ── identity across a drill-in ────────────────────────────────────

test('a node whose kind changes is replaced rather than re-synced', () => {
  tmCanvas();
  const block = placeBlock();
  context.renderAll();
  const box = blockNode(block.id);
  assert.equal(box.__kind, 'block');

  // Ungrouping turns the box back into its states: the id disappears from the
  // projection entirely, so the node is evicted rather than left with a block's
  // parts and a state's job.
  context.ungroupBlock(block.id);
  context.renderAll();
  assert.equal(blockNode(block.id), undefined);
  assert.equal(App.domCache.states.size, 4, 'the four states are drawn now');
});

test('a block evicted from the window takes its clipPath with it', () => {
  tmCanvas();
  const block = placeBlock();
  context.renderAll();
  const clip = blockNode(block.id).__parts.clip;
  assert.ok(clip.parentNode, 'the clipPath is in the document');

  context.removeBlock(block.id);
  context.invalidateBlockIndex();
  context.invalidateViewGraph();
  context.renderAll();
  assert.equal(clip.parentNode, null,
    'or a session of drilling in and out leaves one clipPath per visit behind');
});

// ══════════════════════════════════════════════════════════════════
//  THE THINGS THAT WERE BROKEN
// ══════════════════════════════════════════════════════════════════
// Each of these was visible on screen and invisible to the suite, which is why
// they are pinned by the property that failed rather than by a screenshot.

test('dragging a block does not clip its own interior away', () => {
  tmCanvas();
  const block = placeBlock('seek', 4, { x: 300, y: 200 });
  context.renderAll();
  const p = blockNode(block.id).__parts;

  // The clip rect is resolved in the preview's own user space, and the preview
  // carries a transform — so the translate below already moves the clip with it.
  // Writing the new position onto the rect as well moved it twice, and two
  // boxes' worth of offset puts the clip clean off the block: the interior
  // vanished the instant the block was dragged.
  const before = ['x', 'y'].map(a => p.clipRect.getAttribute(a));
  block.x += 260;
  block.y += 140;
  context.updateFastDOM();

  assert.deepEqual(['x', 'y'].map(a => p.clipRect.getAttribute(a)), before,
    'the clip rect is not moved a second time under the transform');
  const t = p.preview.getAttribute('transform');
  assert.match(t, /translate\(260 140\)/, 'the preview moves by exactly the delta');
});

test('the clip stays over the box across the full render a drag ends in', () => {
  tmCanvas();
  const block = placeBlock('seek', 4, { x: 300, y: 200 });
  context.renderAll();
  const p = blockNode(block.id).__parts;

  // The clip and the drawn interior have to share one frame, and the transform
  // is what defines it. The drag path was right on its own; the *render on
  // drop* was not — it rewrote the rect to the box's new position while leaving
  // the drag's translate in place, so the clip was offset by the whole delta a
  // second time. Under a box's width that trimmed the preview, and past it the
  // interior vanished outright — a preview that disappeared on some blocks and
  // not others, depending on how far each had been dragged.
  const effective = () => {
    const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(p.preview.getAttribute('transform') || '');
    const dx = m ? parseFloat(m[1]) : 0, dy = m ? parseFloat(m[2]) : 0;
    return [parseFloat(p.clipRect.getAttribute('x')) + dx, parseFloat(p.clipRect.getAttribute('y')) + dy];
  };
  const overBody = where => {
    const [cx, cy] = where;
    assert.ok(Math.abs(cx - (parseFloat(p.body.getAttribute('x')) + 1)) < 0.01
      && cy > parseFloat(p.body.getAttribute('y')),
      `clip at ${cx},${cy} is not over the body at ${p.body.getAttribute('x')},${p.body.getAttribute('y')}`);
  };

  overBody(effective());
  block.x += 400;
  context.updateFastDOM();
  overBody(effective());
  // The render on drop: it changes no member and no size, so the preview is
  // deliberately not rebuilt — which is exactly why the clip must not move.
  context.renderAll();
  overBody(effective());
});

test('a block is dragged, nudged and pushed like a state', () => {
  tmCanvas();
  const block = placeBlock('seek', 4, { x: 300, y: 200 });
  const node = context.getNode(block.id);

  // The projection's node used to hold *copies* of the record's coordinates, so
  // every mover in the app wrote to the projection and the next refresh put the
  // old value straight back: a block could not be dragged, could not be nudged,
  // and absorbed no push from the states it sat on.
  node.x = 620;
  node.y = 410;
  assert.equal(block.x, 620, 'writing the node writes the record');
  assert.equal(block.y, 410);
  assert.equal(context.getNode(block.id).x, 620, 'and the next frame keeps it');

  context.App.selectedStates.clear();
  context.App.selectedStates.add(block.id);
  context.nudgeSelected(10, -5);
  assert.equal(block.x, 630, 'an arrow key moves it');
  assert.equal(block.y, 405);
});

test('auto-layout arranges blocks, not just the states hidden inside them', () => {
  tmCanvas();
  const block = placeBlock('seek', 4, { x: 300, y: 200 });
  context.App.states.push({ id: 'z1', x: 40, y: 40, name: 'outside' });
  context.App.states = [...context.App.states];
  context.invalidateViewGraph();
  const was = { x: block.x, y: block.y };

  context.autoLayout();

  assert.notDeepEqual({ x: block.x, y: block.y }, was,
    'Arrange used to run over App.states, where a block does not appear at all');
});

test('the transition editor offers no block box as an endpoint', () => {
  tmCanvas();
  placeBlock('seek', 4, { x: 300, y: 200 });
  context.App.states.push({ id: 'z1', x: 40, y: 40, name: 'outside' });
  context.App.states = [...context.App.states];
  context.invalidateViewGraph();

  context.populateTransitionModal(null);
  const html = getElement('m-from').innerHTML;
  // Picking a box wrote `to: "b1"` onto a real transition — an endpoint naming
  // no state the machine has. It was saved to the file and counted in the
  // Transitions list, and drawn nowhere, because the projection cannot resolve it.
  assert.ok(!/value="b\d/.test(html), 'no block ids in the endpoint menu');
  assert.match(html, /outside/, 'the real states are still there');
});

test('the start arrow follows a block being dragged, without a full render', () => {
  tmCanvas();
  const block = placeBlock('seek', 4, { x: 300, y: 200 });
  // Control starts inside the block, so the arrow points at the box.
  context.App.startId = context.App.states.find(st => st.blockId === block.id).id;
  context.invalidateViewGraph();
  context.renderAll();

  const arrow = context.App.domCache.startArrow;
  assert.ok(arrow, 'the arrow is drawn');
  const before = arrow.getAttribute('d');

  block.x += 240;
  context.updateFastDOM();

  // The drag path used to resolve App.startId against the *drawn* states, where
  // a state inside a collapsed block does not appear — so the lookup missed, the
  // arrow stayed put for the whole drag, and it only snapped into place on the
  // next full render, which a click on the background happens to cause.
  const after = arrow.getAttribute('d');
  assert.notEqual(after, before, 'the arrow moved with the box');
  context.renderAll();
  assert.equal(arrow.getAttribute('d'), after,
    'and the drag path put it exactly where a full render does');
});
