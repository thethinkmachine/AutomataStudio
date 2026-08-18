import test from 'node:test';
import assert from 'node:assert';
import { createHarness } from './harness.js';

// ══════════════════════════════════════════════════════════════════
//  THE MACHINE CARD
// ══════════════════════════════════════════════════════════════════
//  The info card behind the (i) button used to be readable only, and its text
//  lived in a module variable in js/persistence.js. Two things followed, and
//  this file is mostly about them not coming back:
//
//    * a machine you drew yourself could never have a card at all, because
//      the only writers were the example loader and StateMate; and
//    * a machine that *did* have one lost it on the first save, because
//      getWorkspaceData never wrote `meta` out.
//
//  Both are properties of where the text lives. It is App.meta now, which is
//  what makes it survive a save, a tab switch and a Ctrl+Z.

const { context, getElement } = createHarness();

function deepText(node) {
  if (!node || typeof node !== 'object') return '';
  const own = typeof node.textContent === 'string' ? node.textContent : '';
  const kids = (node.children || []).map(deepText).join(' ');
  return `${own} ${kids}`.trim();
}

// Matches whole class tokens, not substrings: `example-card-rows` contains
// `example-card-row`, and a container counted as one of its own children is
// the kind of thing that makes a row-count assertion pass for the wrong reason.
function findAll(node, cls) {
  const out = [];
  (function walk(n) {
    (n.children || []).forEach(child => {
      if (String(child.className || '').split(/\s+/).includes(cls)) out.push(child);
      walk(child);
    });
  })(node);
  return out;
}

function findOne(node, cls) {
  return findAll(node, cls)[0] || null;
}

// A minimal two-state DFA, so that "there is a machine on the canvas" is true.
function drawMachine(h) {
  h.context.App.states = [
    { id: 's1', name: 'q0', x: 100, y: 100 },
    { id: 's2', name: 'q1', x: 220, y: 100 }
  ];
  h.context.App.startId = 's1';
  h.context.App.accepts = new Set(['s2']);
  h.context.App.stateN = 2;
}

const SAMPLE = {
  title: 'Even number of a’s',
  blurb: 'Two states, flipped by every a and ignoring every b.',
  inputs: [{ w: '', expect: 'accept' }, { w: 'a', expect: 'reject' }]
};

// ── Where the text lives ──────────────────────────────────────────

test('the card is App state, not the card renderer’s private variable', () => {
  const h = createHarness();
  assert.equal(h.context.App.meta, null, 'a blank canvas has nothing to say about itself');

  h.context.showExampleCard(SAMPLE);
  assert.equal(h.context.App.meta.title, 'Even number of a’s');
  assert.deepEqual(h.context.exampleCardMeta(), h.context.App.meta,
    'the accessor reads App rather than a second copy that could drift from it');

  h.context.showExampleCard(null);
  assert.equal(h.context.App.meta, null);
});

test('normalizing drops what is not worth storing, and keeps the empty word', () => {
  const n = context.normalizeCardMeta;

  assert.equal(n(null), null);
  assert.equal(n({ title: '   ', blurb: '', inputs: [] }), null,
    'a card of blanks is no card — "has a description" stays one truthiness test');

  const kept = n({ title: '  Trimmed  ', inputs: [{ w: '' }, { w: 'ab', expect: 'accept' }] });
  assert.equal(kept.title, 'Trimmed');
  assert.equal(kept.blurb, undefined, 'an empty field is dropped rather than stored as ""');
  assert.equal(kept.inputs.length, 2, 'the empty word is a test like any other');
  assert.equal(kept.inputs[0].w, '');

  const noVerdict = n({ title: 'x', inputs: [{ w: 'a', expect: 'maybe' }] });
  assert.equal(noVerdict.inputs[0].expect, undefined,
    'an unrecognized verdict becomes no verdict, not a chip coloured by a typo');

  const capped = n({ title: 'x', inputs: Array.from({ length: 40 }, (_, i) => ({ w: `w${i}` })) });
  assert.equal(capped.inputs.length, context.CARD_WORDS_MAX,
    'the cap is what still reads as a card, and it is enforced on the way in');
});

// ── Surviving a save ──────────────────────────────────────────────

test('a description survives the round trip that used to lose it', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);

  // getWorkspaceData is what saveJSON writes, what the PNG embeds and what the
  // share link encodes. Dropping `meta` here is the bug that made a card a
  // property of the file you loaded rather than of the machine you have.
  const saved = h.context.getWorkspaceData();
  assert.equal(saved.meta.title, SAMPLE.title);
  assert.equal(saved.meta.inputs.length, 2);

  const reopened = createHarness();
  reopened.context.loadData(saved);
  reopened.context.showExampleCard(saved.meta);
  assert.equal(reopened.context.App.meta.title, SAMPLE.title,
    'saving and loading again gives the machine its description back');
});

test('a description rides between tabs', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);

  const blob = h.context.exportWorkspaceState();
  assert.equal(blob.meta.title, SAMPLE.title);
  assert.notEqual(blob.meta, h.context.App.meta, 'the tab holds its own copy, not a live alias');

  h.context.App.meta = null;
  h.context.importWorkspaceState(blob);
  assert.equal(h.context.App.meta.title, SAMPLE.title);

  h.context.importWorkspaceState({ ...blob, meta: undefined });
  assert.equal(h.context.App.meta, null,
    'a tab with no description does not inherit the last tab’s');
});

test('the API key does not follow the card into storage', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.saveStateMateSettings({ enabled: true, provider: 'anthropic', apiKey: 'sk-secret' });
  h.context.showExampleCard(SAMPLE);

  // App.meta is new state on App, and App is what the four serializers walk.
  // This is the same guard statemate.test.js keeps, re-asserted at the point
  // a new field was added to the thing being serialized.
  const written = JSON.stringify(h.context.getWorkspaceData())
    + JSON.stringify(h.context.exportWorkspaceState());
  assert.ok(!written.includes('sk-secret'));
});

// ── The way in ────────────────────────────────────────────────────

test('an undescribed machine is offered the editor, an empty canvas is offered nothing', () => {
  const h = createHarness();
  const btn = h.getElement('canvas-info-btn');

  h.context.syncCanvasInfoButton();
  assert.equal(btn.hidden, true,
    'with no machine and nothing said about one, a button that opens an empty card is worse than no button');

  drawMachine(h);
  h.context.emit(h.context.Change.GRAPH);
  assert.equal(btn.hidden, false, 'drawing a machine is what makes a description possible');
  assert.equal(btn.dataset.tip, 'Describe this machine',
    'and the button says which of its two jobs it is about to do');

  h.context.showExampleCard(SAMPLE);
  h.context.hideExampleCard();
  assert.equal(btn.dataset.tip, 'About this machine');
});

test('opening the card of an undescribed machine opens the editor', () => {
  const h = createHarness();
  drawMachine(h);

  h.context.toggleExampleCard();
  const card = h.getElement('example-card');
  assert.ok(card.classList.contains('is-open'));
  assert.ok(card.classList.contains('is-editing'),
    'there is nothing to read yet, so the card opens as the thing that fixes that');
  assert.ok(h.context.isEditingExampleCard());
  assert.match(deepText(card), /Describe this machine/);
  assert.ok(findOne(card, 'example-card-save'), 'and there is a way to commit it');
});

test('a described card reads, and carries the way back into the editor', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);

  const card = h.getElement('example-card');
  assert.equal(h.context.isEditingExampleCard(), false, 'a load lands in the reading state');
  assert.match(deepText(card), /Even number of a’s/);
  assert.match(deepText(card), /Two states, flipped by every a/);

  const chips = findAll(card, 'example-chip');
  assert.equal(chips.length, 2);
  assert.equal(chips[0].textContent, 'ε', 'the empty word is drawn as ε and run as ""');
  assert.ok(String(chips[1].className).includes('chip-rej'));

  const pencil = findOne(card, 'example-card-btn');
  assert.ok(pencil, 'the edit affordance the card never used to have');
  pencil.onclick();
  assert.ok(h.context.isEditingExampleCard());
});

// ── Editing ───────────────────────────────────────────────────────

test('the editor is seeded from the card and writes it back on Save', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);
  h.context.editExampleCard();

  const card = h.getElement('example-card');
  const inputs = findAll(card, 'example-card-input');
  assert.equal(inputs[0].value, SAMPLE.title, 'the name field starts at what the card says');
  assert.equal(findOne(card, 'example-card-area').value, SAMPLE.blurb);

  inputs[0].value = 'Odd number of b’s';
  inputs[0].oninput();
  assert.equal(h.context.App.meta.title, SAMPLE.title,
    'typing has not touched the card yet — the draft is held aside so Cancel is free');

  h.context.saveCardEdit();
  assert.equal(h.context.App.meta.title, 'Odd number of b’s');
  assert.equal(h.context.App.meta.blurb, SAMPLE.blurb, 'the untouched fields came through');
  assert.equal(h.context.isEditingExampleCard(), false);
  assert.match(deepText(h.getElement('example-card')), /Odd number of b’s/);
});

test('Cancel really cancels, down to the test words', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);
  h.context.editExampleCard();

  const card = h.getElement('example-card');
  findAll(card, 'example-card-input')[0].value = 'wrong';
  findAll(card, 'example-card-input')[0].oninput();
  // The rows are copied, not aliased — mutating one must not reach App.meta.
  findOne(card, 'example-card-drop').onclick();

  h.context.cancelCardEdit();
  assert.equal(h.context.App.meta.title, SAMPLE.title);
  assert.equal(h.context.App.meta.inputs.length, 2, 'the deleted row was only ever deleted in the draft');
});

test('test words can be added, cycled through their verdicts and removed', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.editExampleCard();
  const card = () => h.getElement('example-card');

  findOne(card(), 'example-card-add').onclick();
  let rows = findAll(card(), 'example-card-row');
  assert.equal(rows.length, 1);

  const word = findOne(rows[0], 'example-card-word');
  word.value = 'abba';
  word.oninput();

  // Three states, cycled in place: accept → reject → no verdict. A word worth
  // trying with nothing claimed about the outcome is a legitimate thing to
  // write down, so it is a stop on the cycle rather than an absence.
  const verdict = () => findOne(findAll(card(), 'example-card-row')[0], 'example-card-expect');
  assert.equal(verdict().textContent, 'accept');
  verdict().onclick();
  assert.equal(verdict().textContent, 'reject');
  verdict().onclick();
  assert.equal(verdict().textContent, 'no verdict');

  findOne(card(), 'example-card-add').onclick();
  assert.equal(findAll(card(), 'example-card-row').length, 2);
  findOne(findAll(card(), 'example-card-row')[1], 'example-card-drop').onclick();
  assert.equal(findAll(card(), 'example-card-row').length, 1);

  const title = findAll(card(), 'example-card-input')[0];
  title.value = 'Palindromes';
  title.oninput();
  h.context.saveCardEdit();

  assert.deepEqual(h.context.App.meta.inputs, [{ w: 'abba' }],
    'no verdict is stored as no verdict, not as an empty string');
});

test('emptying the fields is how a description is taken back', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);
  h.context.editExampleCard();

  const card = h.getElement('example-card');
  const title = findAll(card, 'example-card-input')[0];
  title.value = '';
  title.oninput();
  const blurb = findOne(card, 'example-card-area');
  blurb.value = '';
  blurb.oninput();
  findAll(card, 'example-card-drop').forEach(b => b.onclick());
  // Rows are removed by index against a re-rendered list, so drop the rest one
  // at a time rather than trusting a single pass over a stale node list.
  while (findAll(h.getElement('example-card'), 'example-card-drop').length) {
    findAll(h.getElement('example-card'), 'example-card-drop')[0].onclick();
  }

  h.context.saveCardEdit();
  assert.equal(h.context.App.meta, null);
  assert.equal(h.getElement('example-card').classList.contains('is-open'), false,
    'and the card folds away rather than sitting there empty');
});

// ── One undoable step, one dirty tab ──────────────────────────────

test('saving a description is one Ctrl+Z, and Ctrl+Z brings the old one back', () => {
  const h = createHarness();
  h.context.initTabs();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);

  const depth = h.context.App.history.length;
  h.context.editExampleCard();
  const title = findAll(h.getElement('example-card'), 'example-card-input')[0];
  title.value = 'Renamed';
  title.oninput();
  h.context.saveCardEdit();

  assert.equal(h.context.App.history.length, depth + 1, 'one edit, one undo point');
  h.context.undo();
  assert.equal(h.context.App.meta.title, SAMPLE.title, 'the wording came back with it');
  assert.match(deepText(h.getElement('example-card')), /Even number of a’s/,
    'and the card redrew, because restoreSnapshot announces the change');

  h.context.redo();
  assert.equal(h.context.App.meta.title, 'Renamed');
});

test('a form opened and closed unchanged is not an edit', () => {
  const h = createHarness();
  h.context.initTabs();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);
  h.context.markActiveWorkspaceSaved();

  const depth = h.context.App.history.length;
  h.context.editExampleCard();
  h.context.saveCardEdit();

  assert.equal(h.context.App.history.length, depth, 'no undo point for a no-op');
  assert.equal(h.context.Workspaces.find(w => w.id === h.context.activeWorkspaceId).dirty, false,
    'and no unsaved-changes prompt for having looked at the form');
});

test('rewording the card dirties the tab, because the card is saved with it', () => {
  const h = createHarness();
  h.context.initTabs();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);
  h.context.markActiveWorkspaceSaved();

  h.context.editExampleCard();
  const title = findAll(h.getElement('example-card'), 'example-card-input')[0];
  title.value = 'Reworded';
  title.oninput();
  h.context.saveCardEdit();

  assert.equal(h.context.Workspaces.find(w => w.id === h.context.activeWorkspaceId).dirty, true,
    'Change.META marks dirty for the same reason the camera does — it is persisted');
});

// ── Not being clobbered ───────────────────────────────────────────

test('editing the diagram does not redraw the card out from under a result strip', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);

  const card = h.getElement('example-card');
  // Stand in for decorateResultCard, which appends to the card in place.
  const strip = h.context.document.createElement('div');
  strip.className = 'sm-result-strip';
  card.appendChild(strip);

  h.context.App.states.push({ id: 's3', name: 'q2', x: 340, y: 100 });
  h.context.emit(h.context.Change.GRAPH);

  assert.ok(findOne(h.getElement('example-card'), 'sm-result-strip'),
    'Change.GRAPH only re-answers whether the button is offered; the card is Change.META');
});

test('a machine loaded over another takes its description with it', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);

  h.context.showExampleCard(null);
  assert.equal(h.context.App.meta, null);
  assert.equal(h.getElement('example-card').classList.contains('is-open'), false);
  assert.equal(deepText(h.getElement('example-card')), '',
    'the previous machine’s card is not left behind the fade to be found on the next open');
});

test('an abandoned draft does not survive the card closing', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.editExampleCard();
  const title = findAll(h.getElement('example-card'), 'example-card-input')[0];
  title.value = 'half-typed';
  title.oninput();

  h.context.hideExampleCard();
  assert.equal(h.context.isEditingExampleCard(), false);
  assert.equal(h.context.App.meta, null);

  h.context.toggleExampleCard();
  const restarted = findAll(h.getElement('example-card'), 'example-card-input')[0];
  assert.equal(restarted.value, '', 'the editor reopens blank rather than mid-sentence');
});
