import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHarness, context } from './harness.js';

// Where a note's dashed leaders end.
//
// A note anchored to a transition used to draw its leader to the midpoint of
// the straight line between the edge's two states. That point is on the edge
// only while the edge is straight; once routeCurve bends it round a state in the
// way — or a reverse edge, or a hand-set curve — the leader stopped in empty
// canvas, pointing at nothing. It now ends on the edge as drawn, at the point
// the label was placed against (labelFootPoint), with a dot to mark it. Where
// the note *sits* is still worked out from the chord, so no saved note moves.

const harness = createHarness();
const { App } = context;

const EPS = 0.5;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= EPS, `${msg}: ${a} vs ${b}`);

// p and q with r standing on the chord between them, so p → q is bent round it.
function fixture({ symbols = ['a'], loop = false } = {}) {
  harness.resetApp();
  App.machine = 'NFA';
  App.sigma = new Set(['a', 'b']);
  App.config.render.animateLayout = false;
  App.states.push({ id: 'p', x: 0, y: 0, name: 'p' });
  App.states.push({ id: 'q', x: 320, y: 0, name: 'q' });
  App.states.push({ id: 'r', x: 160, y: 0, name: 'r' });
  App.startId = 'p';
  const ids = symbols.map((symbol, i) => {
    const t = { id: `t${i}`, from: 'p', to: loop ? 'p' : 'q', symbol };
    App.transitions.push(t);
    return t.id;
  });
  const note = context.createNote(160, 200, [], ids);
  note.text = 'about this edge';
  context.renderAll();
  return { note, key: loop ? 'p|p' : 'p|q' };
}

const noteGroup = note => App.domCache.notes.get(note.id);
const shownLeaders = note => noteGroup(note).__parts.leaders
  .filter(({ line }) => line.getAttribute('display') !== 'none');
const shownGeo = key => App.domCache.transitions.get(key).__shown;
const end = ({ line }) => ({ x: Number(line.getAttribute('x2')), y: Number(line.getAttribute('y2')) });

test('a leader to a bent edge ends on the edge, beside its label', () => {
  const { note, key } = fixture();
  const geo = shownGeo(key);
  assert.notEqual(geo.crvVal, 0, 'the fixture edge is bent round r');

  const leaders = shownLeaders(note);
  assert.equal(leaders.length, 1);
  const pt = end(leaders[0]);
  const foot = context.pathPoint(geo, geo.lt);
  near(pt.x, foot.x, 'x on the drawn curve');
  near(pt.y, foot.y, 'y on the drawn curve');
  assert.ok(Math.hypot(pt.x - 160, pt.y - 0) > 20, 'and not at the chord midpoint, which sits on r');

  const { dot } = leaders[0];
  assert.equal(dot.getAttribute('display'), null, 'the end is marked');
  near(Number(dot.getAttribute('cx')), pt.x, 'dot x');
  near(Number(dot.getAttribute('cy')), pt.y, 'dot y');
});

test('the note itself is still placed from the chord, so a saved note does not move', () => {
  const { note } = fixture();
  const pos = context.resolveNotePos(note);
  near(pos.x, 160 + note.x, 'x');
  near(pos.y, 0 + note.y, 'y');
});

test('a leader starts on the note\'s border, not under its body', () => {
  const { note } = fixture();
  const { rect } = noteGroup(note).__parts;
  const x = Number(rect.getAttribute('x')), y = Number(rect.getAttribute('y'));
  const w = Number(rect.getAttribute('width')), h = Number(rect.getAttribute('height'));
  const { line } = shownLeaders(note)[0];
  const x1 = Number(line.getAttribute('x1')), y1 = Number(line.getAttribute('y1'));
  const onSide = Math.abs(x1 - x) < 1e-6 || Math.abs(x1 - (x + w)) < 1e-6;
  const onTopOrFoot = Math.abs(y1 - y) < 1e-6 || Math.abs(y1 - (y + h)) < 1e-6;
  assert.ok(onSide || onTopOrFoot, `(${x1}, ${y1}) is on the box ${x},${y} ${w}×${h}`);
});

test('a leader to a self-loop ends on the loop, not inside the state', () => {
  const { note, key } = fixture({ loop: true });
  const geo = shownGeo(key);
  const pt = end(shownLeaders(note)[0]);
  near(pt.x, geo.mx, 'x at the loop\'s outer point');
  near(pt.y, geo.my, 'y at the loop\'s outer point');
  assert.ok(Math.hypot(pt.x, pt.y) > context.R, 'outside the state circle');
});

test('two rules on one edge draw one leader', () => {
  const { note } = fixture({ symbols: ['a', 'b'] });
  assert.equal(note.anchorTransitions.length, 2);
  assert.equal(shownLeaders(note).length, 1);
});

test('a leader to a state is unchanged, and carries no dot', () => {
  const { note } = fixture();
  note.anchorStates = ['q'];
  context.renderAll();
  const leaders = shownLeaders(note);
  const toState = leaders.find(l => {
    const pt = end(l);
    return pt.x === 320 && pt.y === 0;
  });
  assert.ok(toState, 'a leader ends at q\'s centre');
  assert.equal(toState.dot.getAttribute('display'), 'none');
});

test('an edge with no drawn node falls back to the chord midpoint', () => {
  const { note, key } = fixture();
  // What culling does to an off-screen edge: its node is evicted.
  App.domCache.transitions.delete(key);
  const targets = context.noteLeaderTargets(note);
  assert.deepEqual(targets, [{ x: 160, y: 0, edge: false }]);
});

test('a dragged state moves the leader end with the edge it re-routes', () => {
  const { note, key } = fixture();
  const before = end(shownLeaders(note)[0]);
  context.getState('r').y += 30;
  context.updateFastDOM();
  const geo = shownGeo(key);
  const after = end(shownLeaders(note)[0]);
  const foot = context.pathPoint(geo, geo.lt);
  near(after.x, foot.x, 'x');
  near(after.y, foot.y, 'y');
  assert.notDeepEqual(after, before, 'the end did move');
});

test('a settle frame carries the leader with an edge that is still easing', () => {
  const { note, key } = fixture();
  const t = App.transitions[0];
  const { _setSyncRAF, resetAnim, settleAll } = context;
  // Frames are driven by hand: the stub runs rAF callbacks inline, and a
  // self-arming settle loop would recurse through the whole glide.
  const savedRAF = context.requestAnimationFrame;
  context.requestAnimationFrame = () => 1;
  App.config.render.animateLayout = true;
  _setSyncRAF(false);
  try {
    resetAnim();
    t.curve = 0;
    context.renderAll();
    t.curve = 140;
    context.renderAll();

    const mid = shownGeo(key);
    assert.ok(mid.crvVal !== 140, 'the curve is mid-glide');
    const midEnd = end(shownLeaders(note)[0]);
    const midFoot = context.labelFootPoint(mid);
    near(midEnd.x, midFoot.x, 'mid-glide x on the curve as drawn');
    near(midEnd.y, midFoot.y, 'mid-glide y on the curve as drawn');

    settleAll();
    context.updateFastDOM({ statesMoved: false });
    const settled = shownGeo(key);
    assert.equal(settled.crvVal, 140);
    const settledEnd = end(shownLeaders(note)[0]);
    const foot = context.labelFootPoint(settled);
    near(settledEnd.x, foot.x, 'settled x');
    near(settledEnd.y, foot.y, 'settled y');
  } finally {
    resetAnim();
    _setSyncRAF(true);
    context.requestAnimationFrame = savedRAF;
    App.config.render.animateLayout = false;
  }
});

test('an idle settle frame writes nothing to an edge-anchored note', () => {
  const { note } = fixture();
  const writes = [];
  const grp = noteGroup(note);
  for (const el of [grp.__parts.rect, ...grp.__parts.leaders.flatMap(l => [l.line, l.dot])]) {
    const set = el.setAttribute.bind(el);
    el.setAttribute = (name, value) => { writes.push(name); set(name, value); };
  }
  context.updateFastDOM({ statesMoved: false });
  context.updateFastDOM({ statesMoved: false });
  assert.deepEqual(writes, []);
});

// A label can straddle its own edge: a wide pill on a steep edge is offset by
// half its height, not its width, so the point the leader used to end at was
// under the pill and its dot was drawn on the text.
function pillFixture(style = 'pills') {
  harness.resetApp();
  App.machine = 'NFA';
  App.sigma = new Set(['citizenResubmitsEvidence']);
  App.config.render.animateLayout = false;
  App.config.edgeLabelStyle = style;
  App.states.push({ id: 'p', x: 0, y: 300, name: 'p' });
  App.states.push({ id: 'q', x: 40, y: 0, name: 'q' });
  App.startId = 'p';
  App.transitions.push({ id: 't0', from: 'p', to: 'q', symbol: 'citizenResubmitsEvidence' });
  const note = context.createNote(300, 260, [], ['t0']);
  note.text = 'why resubmit';
  context.renderAll();
  return { note, geo: shownGeo('p|q') };
}

const labelBox = geo => ({
  x: geo.lx - geo.labelSize.w / 2, y: geo.ly - geo.labelSize.h / 2,
  w: geo.labelSize.w, h: geo.labelSize.h
});
const inBox = (p, b, m = 0) => p.x > b.x - m && p.x < b.x + b.w + m && p.y > b.y - m && p.y < b.y + b.h + m;
const distToCurve = (geo, p) => {
  let best = Infinity;
  for (let i = 0; i <= 2000; i++) {
    const c = context.pathPoint(geo, i / 2000);
    best = Math.min(best, Math.hypot(c.x - p.x, c.y - p.y));
  }
  return best;
};

function withLabelStyle(fn) {
  const saved = App.config.edgeLabelStyle;
  try { fn(); } finally { App.config.edgeLabelStyle = saved; }
}

test('a leader to a label that straddles its edge ends on the edge, clear of the label', () => {
  withLabelStyle(() => {
    const { note, geo } = pillFixture();
    const box = labelBox(geo);
    assert.ok(inBox(context.labelFootPoint(geo), box), 'the fixture pill covers the point beside it');

    const { line, dot } = shownLeaders(note)[0];
    const pt = end({ line });
    assert.ok(!inBox(pt, box, 3.5), `(${pt.x}, ${pt.y}) is clear of the pill`);
    assert.ok(distToCurve(geo, pt) < 0.5, 'and on the drawn edge');
    near(Number(dot.getAttribute('cx')), pt.x, 'dot x');

    const x1 = Number(line.getAttribute('x1')), y1 = Number(line.getAttribute('y1'));
    for (let i = 0; i <= 100; i++) {
      const s = { x: x1 + (pt.x - x1) * i / 100, y: y1 + (pt.y - y1) * i / 100 };
      assert.ok(!inBox(s, box), 'the leader does not cut across the pill');
    }
  });
});

test('with labels off, the leader ends beside where the label would be', () => {
  withLabelStyle(() => {
    const { note, geo } = pillFixture('none');
    const pt = end(shownLeaders(note)[0]);
    const foot = context.labelFootPoint(geo);
    near(pt.x, foot.x, 'x');
    near(pt.y, foot.y, 'y');
  });
});

test('leaders are drawn in a layer of their own, under the labels and the states', () => {
  const { note } = fixture();
  const layer = context.$('note-leaders-g');
  for (const { line, dot } of noteGroup(note).__parts.leaders) {
    assert.equal(line.parentNode, layer);
    assert.equal(dot.parentNode, layer);
  }
  context.renderAll();
  assert.equal(layer.childNodes.length, 2, 'a re-render replaces the leaders rather than adding to them');

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const at = id => html.indexOf(`id="${id}"`);
  assert.ok(at('trans-g') < at('note-leaders-g'), 'over the edges');
  assert.ok(at('note-leaders-g') < at('trans-lbl-g'), 'under the edge labels');
  assert.ok(at('trans-lbl-g') < at('states-g'), 'and so under the states');
});
