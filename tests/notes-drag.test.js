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
