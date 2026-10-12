import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context } from './harness.js';

// What a drag frame does to the notes.
//
// updateFastDOM runs updateNotesDOM on every frame a state moves, for every
// visible note. It was `forEach(updateOneNoteDOM)`, which handed the array
// index in as the options object — so `refillText` kept its default of true,
// and every tspan of every note was torn down and rebuilt on every frame of
// every drag, including notes nowhere near the state being dragged. Nothing
// looked wrong; it was only slow. On an eight-state machine with one note it
// was ~70 node insertions per frame, and each one invalidated a `:has()` rule
// up to <body> — enough to miss frames on a 144Hz panel.

const harness = createHarness();
const { App } = context;

function fixture() {
  harness.resetApp();
  App.machine = 'DFA';
  App.sigma = new Set(['a']);
  App.config.render.animateLayout = false;
  App.states.push({ id: 'p', x: 0, y: 0, name: 'p' });
  App.states.push({ id: 'q', x: 300, y: 0, name: 'q' });
  App.transitions.push({ id: 't', from: 'p', to: 'q', symbol: 'a' });
  App.startId = 'p';

  const pinned = context.createNote(0, -120);
  pinned.text = 'pinned to p\nsecond line\n**bold** words';
  pinned.anchorStates = ['p'];
  pinned.x = 0; pinned.y = -120;
  const loose = context.createNote(600, 300);
  loose.text = 'free-floating, far from anything';
  context.renderAll();
  return { pinned, loose };
}

const noteGroup = note => App.domCache.notes.get(note.id);
const tspans = note => [...noteGroup(note).__parts.textEl.childNodes];

test('a state drag moves a pinned note without rebuilding its text', () => {
  const { pinned } = fixture();
  const before = tspans(pinned);
  assert.ok(before.length > 1, 'the fixture note has several runs');
  const rectBefore = noteGroup(pinned).__parts.rect.getAttribute('x');

  context.getState('p').x += 40;
  context.updateFastDOM();

  const after = tspans(pinned);
  assert.equal(after.length, before.length);
  after.forEach((ts, i) => assert.equal(ts, before[i], `tspan ${i} is the same node`));
  assert.notEqual(noteGroup(pinned).__parts.rect.getAttribute('x'), rectBefore,
    'but the note did follow its state');
});

test('a note the drag cannot have moved is not written to at all', () => {
  const { loose } = fixture();
  const grp = noteGroup(loose);
  const writes = [];
  for (const el of [grp.__parts.rect, grp.__parts.textEl, grp.__parts.handle]) {
    const set = el.setAttribute.bind(el);
    el.setAttribute = (name, value) => { writes.push(name); set(name, value); };
  }

  context.getState('p').x += 40;
  context.updateFastDOM();
  context.getState('p').x += 40;
  context.updateFastDOM();

  assert.deepEqual(writes, []);
});

test('a resize still re-wraps the text', () => {
  const { pinned } = fixture();
  const before = tspans(pinned);
  pinned.w = 400; pinned.h = 200;
  context.updateOneNoteDOM(pinned);
  assert.notEqual(tspans(pinned)[0], before[0], 'the text was rebuilt for the new width');
});

// ── What a note costs when nothing about it changed: nothing ─────────────
//
// Notes used to be visited by every drag frame and rebuilt by every renderAll,
// each visit laying out the note's Markdown again. A drag frame now visits
// only the notes filed under a node it moved or an edge whose drawing changed,
// a render diffs the groups it already has, and a layout is cached until the
// text or the box changes. The reads are counted, not timed: a note that is
// not touched must not even be looked at.

function countReads(note) {
  const reads = { n: 0 };
  for (const key of ['x', 'y', 'text']) {
    let value = note[key];
    Object.defineProperty(note, key, {
      get() { reads.n++; return value; },
      set(v) { value = v; },
      enumerable: true, configurable: true
    });
  }
  return reads;
}

test('a drag frame does not look at a note it cannot have moved', () => {
  const { pinned, loose } = fixture();
  const pinnedReads = countReads(pinned), looseReads = countReads(loose);

  context.getState('q').x += 40;
  context.updateFastDOM();
  assert.equal(pinnedReads.n, 0, 'a note on p is not visited when q moves');
  assert.equal(looseReads.n, 0, 'a note on nothing is never visited');

  context.getState('p').x += 40;
  context.updateFastDOM();
  assert.ok(pinnedReads.n > 0, 'but it is when p moves');
  assert.equal(looseReads.n, 0);
});

test('a settle frame with nothing easing looks at no note', () => {
  const { pinned, loose } = fixture();
  const reads = [countReads(pinned), countReads(loose)];
  context.updateFastDOM({ statesMoved: false });
  assert.deepEqual(reads.map(r => r.n), [0, 0]);
});

test('a render keeps each note\'s elements, and its text, when the note did not change', () => {
  const { pinned } = fixture();
  const grp = noteGroup(pinned);
  const before = tspans(pinned);
  context.renderAll();
  assert.equal(noteGroup(pinned), grp, 'the same group');
  tspans(pinned).forEach((ts, i) => assert.equal(ts, before[i], `tspan ${i} is the same node`));
});

test('a render rebuilds a note\'s text when the text changed', () => {
  const { pinned } = fixture();
  const before = tspans(pinned);
  pinned.text = 'something else entirely';
  context.renderAll();
  assert.notEqual(tspans(pinned)[0], before[0]);
  assert.equal(tspans(pinned).map(ts => ts.textContent).join(''), 'something else entirely');
});

test('a deleted note takes its group and its leaders with it', () => {
  const { pinned } = fixture();
  const grp = noteGroup(pinned);
  const { line } = grp.__parts.leaders[0];
  assert.ok(line.parentNode, 'the fixture note has a drawn leader');
  App.notes = App.notes.filter(n => n !== pinned);
  context.renderAll();
  assert.equal(App.domCache.notes.has(pinned.id), false);
  assert.equal(grp.parentNode, null);
  assert.equal(line.parentNode, null);
});

test('a note\'s layout is computed once, and kept across an undo that hands back the same text', () => {
  const { pinned } = fixture();
  const layout = context.noteBoxLayout(pinned);
  assert.equal(context.noteBoxLayout(pinned), layout, 'the same object on a second read');
  const restored = JSON.parse(JSON.stringify(pinned));
  assert.equal(context.noteBoxLayout(restored), layout, 'a copy with the same id and text shares it');
  restored.text += '!';
  assert.notEqual(context.noteBoxLayout(restored), layout, 'a different text does not');
});

test('the notes\' boxes the minimap reads are kept until a note moves', () => {
  const { pinned } = fixture();
  const boxes = context.noteWorldBoxes();
  context.getState('q').x += 40;
  context.updateFastDOM();
  assert.equal(context.noteWorldBoxes(), boxes, 'a drag that moved no note keeps the list');

  const before = boxes.find(b => b.x < 200).x;
  context.getState('p').x += 40;
  context.updateFastDOM();
  const after = context.noteWorldBoxes();
  assert.notEqual(after, boxes, 'a drag that moved one rebuilds it');
  assert.equal(after.length, 2);
  assert.ok(after.some(b => b.x === before + 40), `the pinned note's box followed p (${pinned.id})`);
});
