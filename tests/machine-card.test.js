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

test('an undescribed machine is offered the card, an empty canvas is offered nothing', () => {
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

// ── One card, and it is the editor ────────────────────────────────
//  There is no ✎ and no mode: the fields are always writable, so the tests
//  below are about *when* what is typed becomes App.meta, not about how to
//  get at a form.

test('an undescribed machine opens the same card, empty and ready to be typed into', () => {
  const h = createHarness();
  drawMachine(h);

  h.context.toggleExampleCard();
  const card = h.getElement('example-card');
  assert.ok(card.classList.contains('is-open'));

  const title = findOne(card, 'example-card-title');
  assert.ok(title, 'the card is its own editor — there is no mode to enter first');
  assert.equal(title.value, '');
  assert.equal(title.placeholder, 'Name this machine',
    'an empty card says what goes in it rather than sitting blank');
  assert.ok(findOne(card, 'example-card-add'), 'and there is a way to add the first test word');
});

test('a described card reads, and the text it reads is the field you edit', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);

  const card = h.getElement('example-card');
  assert.equal(h.context.isEditingExampleCard(), false, 'a load lands with the caret nowhere');
  assert.equal(findOne(card, 'example-card-title').value, SAMPLE.title);
  assert.equal(findOne(card, 'example-card-area').value, SAMPLE.blurb);

  const chips = findAll(card, 'example-chip');
  assert.equal(chips.length, 2);
  assert.equal(findOne(chips[0], 'example-chip-run').textContent, 'ε',
    'the empty word is drawn as ε and run as ""');
  assert.ok(chips[1].classList.contains('chip-rej'));
});

test('a field commits when you leave it, and not while you are typing', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);

  const title = findOne(h.getElement('example-card'), 'example-card-title');
  title.onfocus();
  assert.ok(h.context.isEditingExampleCard(), 'a card being typed into never times out');
  title.value = 'Odd number of b’s';
  assert.equal(h.context.App.meta.title, SAMPLE.title,
    'typing has not touched the card — a commit per keystroke is an undo point per keystroke');

  title.onblur();
  assert.equal(h.context.App.meta.title, 'Odd number of b’s');
  assert.equal(h.context.App.meta.blurb, SAMPLE.blurb, 'the untouched fields came through');
  assert.equal(h.context.isEditingExampleCard(), false);
});

test('a local commit does not redraw the card out from under the pointer', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);

  // The node identity is the assertion: rebuilding the card on our own write
  // destroys whatever the gesture that caused the write was standing on — the
  // next chip in the row, or the field being tabbed out of.
  const card = h.getElement('example-card');
  const blurb = findOne(card, 'example-card-area');
  const title = findOne(card, 'example-card-title');
  title.onfocus();
  title.value = 'Renamed';
  title.onblur();

  assert.equal(findOne(h.getElement('example-card'), 'example-card-area'), blurb,
    'the blurb field is the same node it was before the title was committed');
});

test('Escape puts a field back to what the card says', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);

  const title = findOne(h.getElement('example-card'), 'example-card-title');
  title.onfocus();
  title.value = 'half-typed';
  title.onkeydown({ key: 'Escape', stopPropagation() {} });

  assert.equal(title.value, SAMPLE.title, 'the field reverted rather than the card closing');
  assert.equal(h.context.App.meta.title, SAMPLE.title);
});

// ── Test words ────────────────────────────────────────────────────

test('a word is added, typed, cycled and removed without leaving the card', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.toggleExampleCard();
  const card = () => h.getElement('example-card');

  findOne(card(), 'example-card-add').onclick();
  const chip = findOne(card(), 'example-chip');
  assert.ok(chip.classList.contains('is-pending'),
    'a new chip is DOM until it has been typed into — the + is not itself an edit');
  assert.equal(h.context.App.meta, null);

  const word = findOne(chip, 'example-card-word');
  word.value = 'abba';
  word.onblur();
  assert.deepEqual(h.context.App.meta.inputs, [{ w: 'abba', expect: 'accept' }]);

  // Three states, cycled in place: accept → reject → no verdict. A word worth
  // trying with nothing claimed about the outcome is a legitimate thing to
  // write down, so it is a stop on the cycle rather than an absence.
  // One shape at three weights. A ✕ here was the same glyph as the remove
  // button beside it, so a rejecting chip appeared to carry two close buttons
  // and the verdict looked destructive; the colour carries accept-vs-reject,
  // and the mark only has to carry claimed-vs-not.
  const mark = () => findOne(findOne(card(), 'example-chip'), 'example-chip-expect');
  assert.equal(mark().textContent, '●');
  mark().onclick();
  assert.equal(mark().textContent, '○');
  assert.equal(h.context.App.meta.inputs[0].expect, 'reject');
  mark().onclick();
  assert.equal(mark().textContent, '·');
  assert.deepEqual(h.context.App.meta.inputs, [{ w: 'abba' }],
    'no verdict is stored as no verdict, not as an empty string');

  findOne(findOne(card(), 'example-chip'), 'example-chip-drop').onclick();
  assert.equal(h.context.App.meta, null, 'the last thing the card said is gone with it');
});

test('the empty word can be added, because a field whose placeholder is ε must accept ε', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.showExampleCard({ title: 'Named', inputs: [{ w: 'a', expect: 'accept' }] });

  findOne(h.getElement('example-card'), 'example-card-add').onclick();
  const pending = findAll(h.getElement('example-card'), 'example-chip')
    .find(c => c.classList.contains('is-pending'));
  // Left empty on purpose. The + used to drop an untouched chip, which made
  // the empty word the one input the card could not be given with a pointer.
  findOne(pending, 'example-card-word').onblur();

  assert.deepEqual(h.context.App.meta.inputs, [
    { w: 'a', expect: 'accept' }, { w: '', expect: 'accept' }
  ]);
  assert.equal(findOne(findAll(h.getElement('example-card'), 'example-chip')[1], 'example-chip-run')
    .textContent, 'ε', 'and it is drawn as ε rather than as a blank pill');
});

test('a word is committed once, however it was committed', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.toggleExampleCard();
  const card = () => h.getElement('example-card');

  findOne(card(), 'example-card-add').onclick();
  const pending = findOne(card(), 'example-chip');
  const word = findOne(pending, 'example-card-word');
  word.value = 'abba';

  // ⏎ commits and redraws the row, which destroys this field — and a
  // destroyed field that held focus fires blur on its way out, landing back in
  // the commit. Every word added with the keyboard used to arrive twice.
  word.onkeydown({ key: 'Enter', preventDefault() {} });
  if (word.onblur) word.onblur();

  assert.deepEqual(h.context.App.meta.inputs.map(s => s.w), ['abba'],
    'one word typed is one word on the card');
});

test('Escape takes a new word back without adding it', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.showExampleCard({ title: 'Named', inputs: [{ w: 'a' }] });

  findOne(h.getElement('example-card'), 'example-card-add').onclick();
  const pending = findAll(h.getElement('example-card'), 'example-chip')
    .find(c => c.classList.contains('is-pending'));
  const word = findOne(pending, 'example-card-word');
  word.value = 'never';
  word.onkeydown({ key: 'Escape', stopPropagation() {} });
  if (word.onblur) word.onblur();

  assert.deepEqual(h.context.App.meta.inputs.map(s => s.w), ['a'],
    'the gesture that discards a word is Escape, not a guess about intent');
});

test('clicking a word runs it, because that is what a card can do that a panel cannot', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);

  const chips = findAll(h.getElement('example-card'), 'example-chip');
  findOne(chips[1], 'example-chip-run').onclick();
  assert.equal(h.getElement('sim-in').value, 'a',
    'the run part still runs — editing the text is the deliberate gesture beside it');
});

test('emptying the fields is how a description is taken back', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);
  const card = () => h.getElement('example-card');

  const title = findOne(card(), 'example-card-title');
  title.value = '';
  title.onblur();
  const blurb = findOne(card(), 'example-card-area');
  blurb.value = '';
  blurb.onblur();
  while (findAll(card(), 'example-chip-drop').length) {
    findAll(card(), 'example-chip-drop')[0].onclick();
  }

  assert.equal(h.context.App.meta, null);
  assert.equal(card().classList.contains('is-open'), false,
    'and the card folds away rather than sitting there empty');
});

// ── One undoable step, one dirty tab ──────────────────────────────

test('rewording the card is one Ctrl+Z, and Ctrl+Z brings the old wording back', () => {
  const h = createHarness();
  h.context.initTabs();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);

  const depth = h.context.App.history.length;
  const title = findOne(h.getElement('example-card'), 'example-card-title');
  title.onfocus();
  title.value = 'Renamed';
  title.onblur();

  assert.equal(h.context.App.history.length, depth + 1, 'one edit, one undo point');
  h.context.undo();
  assert.equal(h.context.App.meta.title, SAMPLE.title, 'the wording came back with it');
  assert.equal(findOne(h.getElement('example-card'), 'example-card-title').value, SAMPLE.title,
    'and the card redrew, because an undo is not one of this module’s own writes');

  h.context.redo();
  assert.equal(h.context.App.meta.title, 'Renamed');
});

test('a field looked at and left alone is not an edit', () => {
  const h = createHarness();
  h.context.initTabs();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);
  h.context.markActiveWorkspaceSaved();

  const depth = h.context.App.history.length;
  const title = findOne(h.getElement('example-card'), 'example-card-title');
  title.onfocus();
  title.onblur();

  assert.equal(h.context.App.history.length, depth, 'no undo point for a no-op');
  assert.equal(h.context.Workspaces.find(w => w.id === h.context.activeWorkspaceId).dirty, false,
    'and no unsaved-changes prompt for having put the caret in a field');
});

test('rewording the card dirties the tab, because the card is saved with it', () => {
  const h = createHarness();
  h.context.initTabs();
  drawMachine(h);
  h.context.showExampleCard(SAMPLE);
  h.context.markActiveWorkspaceSaved();

  const title = findOne(h.getElement('example-card'), 'example-card-title');
  title.value = 'Reworded';
  title.onblur();

  assert.equal(h.context.Workspaces.find(w => w.id === h.context.activeWorkspaceId).dirty, true,
    'Change.META marks dirty for the same reason the camera does — it is persisted');
});

// ── The countdown ─────────────────────────────────────────────────

test('how long the card waits is a setting, and 0 means it never folds away', () => {
  const h = createHarness();
  drawMachine(h);

  h.context.App.config.cardAutoHideMs = 0;
  h.context.showExampleCard(SAMPLE);
  assert.equal(h.getElement('example-card').classList.contains('is-open'), true);
  assert.equal(h.context.getEditorSettingsData().cardAutoHideMs, 0,
    'and it rides in the settings file with every other preference');

  // The API key guard, at the point a new key was added to what is written.
  h.context.App.config.cardAutoHideMs = h.context.CARD_AUTO_HIDE_MS;
  assert.equal(h.context.getEditorSettingsData().cardAutoHideMs, 13000);
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

test('nothing half-typed survives the card closing', () => {
  const h = createHarness();
  drawMachine(h);
  h.context.toggleExampleCard();
  const title = findOne(h.getElement('example-card'), 'example-card-title');
  title.onfocus();
  title.value = 'half-typed';

  h.context.hideExampleCard();
  assert.equal(h.context.isEditingExampleCard(), false);
  assert.equal(h.context.App.meta, null, 'a field never left is a field never committed');

  h.context.toggleExampleCard();
  assert.equal(findOne(h.getElement('example-card'), 'example-card-title').value, '',
    'and the card reopens blank rather than mid-sentence');
});
