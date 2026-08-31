import { hideCanvasContextMenu } from './canvas.js';
import { commit } from './history.js';
import { runSim } from './simulation.js';
import { $, App } from './state.js';
import { Change, subscribe } from './store.js';
import { repositionCanvasInfo } from './ui.js';

// ══════════════════════════════════════════════════════════════════
//  THE MACHINE CARD
// ══════════════════════════════════════════════════════════════════
//  What the machine on the canvas is, in its author's words, floating over the
//  diagram it describes: a name, a sentence, and the test words worth trying
//  on it as chips that run. It shows itself after a load or a StateMate run
//  and folds back into the small button it springs from.
//
//  ── The text is document content ──
//
//  It lives in `App.meta`, not in a variable here, and that is what makes it
//  survive: exportWorkspaceState carries it between tabs, getWorkspaceData
//  writes it to the .json, the embedded PNG and the share link, and
//  serializeState puts it on the undo stack beside the diagram. It was a
//  module variable once, written only by the example loader and by StateMate,
//  so a machine you drew yourself could never have a card, and a described one
//  lost its description on the first save.
//
//  ── The render is a function of the state ──
//
//  Four variables say everything the card is doing — `open`, `caret`,
//  `pending`, `editIndex` — and `renderExampleCard()` draws exactly what they
//  and `App.meta` describe. Nothing is toggled on a node behind the renderer's
//  back, so there is no second description of the card to drift from the
//  first, and closing it is `open = false` plus a redraw rather than a
//  sequence of class writes that have to happen in the right order.
//
//  `live()` is what makes that safe against the DOM's own noise. Committing a
//  field redraws the row it is in, which detaches the field being typed into —
//  and a detached field that held focus fires `blur` on the way out, landing
//  back in the commit that removed it. So a handler asks whether its own node
//  is still the one the card is showing, and stands down when it is not: a
//  word typed and committed with ⏎ arrives once rather than twice, and a field
//  discarded by Escape or by the card closing has nothing left to say.
//
//  ── One card, and it is the editor ──
//
//  There is no read view and no ✎: the fields are always writable and read as
//  text until you touch them. A field commits when you leave it, so typing
//  costs no undo points and a field opened and left alone is not an edit at
//  all. Escape puts a field back to what the card says.
//
//  A chip *runs* its word on click — the one thing the card does that no panel
//  does — so editing its text is the deliberate gesture beside it (double
//  click, or F2), the verdict is a mark you cycle, and removing it is the ×.

// Default countdown. App.config.cardAutoHideMs is what actually runs; this is
// what a config predating the setting reads as.
export const CARD_AUTO_HIDE_MS = 13000;
// Caps, not validation: the card is ~320px wide and floats over the diagram,
// so the limit is what still reads as a card rather than what fits in memory.
export const CARD_TITLE_MAX = 70;
export const CARD_BLURB_MAX = 400;
export const CARD_WORD_MAX = 60;
export const CARD_WORDS_MAX = 12;

// The verdict a test word carries. The empty string is a word worth trying
// with nothing claimed about the outcome — the honest state for "watch what
// happens here" — so it is a stop on the cycle rather than an absence.
const EXPECT_CYCLE = ['accept', 'reject', ''];
// One shape at three weights, which is what makes the three states read as one
// control. They were a ✓ and an ✕ until the ✕ turned out to be the same glyph
// as the remove button beside it: the colour already carries accept-vs-reject,
// so the mark only has to carry *claimed* vs *not claimed*.
const EXPECT_MARK = { accept: '●', reject: '○', '': '·' };
const EXPECT_TIP = {
  accept: 'Expected to be accepted — click to change',
  reject: 'Expected to be rejected — click to change',
  '': 'No verdict claimed — click to change'
};

// ── What the card is doing ────────────────────────────────────────

/** Showing, or folded back into its button. The renderer writes the class. */
let open = false;
/** The auto-hide countdown, or null. */
let timer = null;
/** Which field holds the caret, or null — why a card being typed into never times out. */
let caret = null;
/** Up while this module's own commit runs; the Change.META subscriber stands down for it. */
let selfWrite = false;
/** A word typed but not yet committed, so not yet in App.meta: `{expect}` or null. */
let pending = null;
/** Which row is showing a text field, or null. `words().length` is the pending one. */
let editIndex = null;
/** The nodes this render made: `{title, blurb, words, word}`. */
let parts = {};

function words() {
  return Array.isArray(App.meta?.inputs) ? App.meta.inputs : [];
}

/** Is there a description to read, or a machine that could have one? */
function describable() {
  return !!App.meta || App.states.length > 0;
}

function autoHideMs() {
  const ms = App.config?.cardAutoHideMs;
  return Number.isFinite(ms) ? Math.max(0, ms) : CARD_AUTO_HIDE_MS;
}

function stopTimer() {
  if (timer !== null) { clearTimeout(timer); timer = null; }
}

function startTimer() {
  stopTimer();
  const wait = autoHideMs();
  if (!wait) return;
  timer = setTimeout(hideExampleCard, wait);
  // Node's timer keeps the process alive; a browser returns a number and has
  // no unref. Without this every test that draws a card holds the test runner
  // open for the length of the countdown.
  if (typeof timer?.unref === 'function') timer.unref();
}

// ── Writing ───────────────────────────────────────────────────────

/**
 * Trim a card down to what is worth keeping, or to null when that is nothing.
 * Empty fields are dropped rather than stored, so "has a description" stays
 * one truthiness test everywhere else.
 */
export function normalizeCardMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const title = String(meta.title ?? '').trim().slice(0, CARD_TITLE_MAX);
  const blurb = String(meta.blurb ?? '').trim().slice(0, CARD_BLURB_MAX);
  const inputs = (Array.isArray(meta.inputs) ? meta.inputs : [])
    // The empty word is a legitimate test, so a row is dropped for being
    // *absent* rather than for being empty — w: '' is content.
    .filter(row => row && row.w !== undefined && row.w !== null)
    .slice(0, CARD_WORDS_MAX)
    .map(row => {
      const kept = { ...row, w: String(row.w).slice(0, CARD_WORD_MAX) };
      if (kept.expect !== 'accept' && kept.expect !== 'reject') delete kept.expect;
      return kept;
    });
  if (!title && !blurb && !inputs.length) return null;
  const out = {};
  if (title) out.title = title;
  if (blurb) out.blurb = blurb;
  if (inputs.length) out.inputs = inputs;
  return out;
}

/**
 * A mutable copy of what the card says. Rows keep whatever else they arrived
 * with — a StateMate result labels its words with the output it predicted, and
 * rewording the blurb is no reason to throw that away.
 */
function draft() {
  const m = App.meta;
  return {
    title: m?.title || '',
    blurb: m?.blurb || '',
    inputs: (m?.inputs || []).map(row => ({ ...row }))
  };
}

/**
 * Write an edited draft back as one undoable step, and answer whether anything
 * actually changed. A field opened and left alone is not an edit: it spends no
 * undo point and does not dirty the tab.
 */
function write(next) {
  const meta = normalizeCardMeta(next);
  if (JSON.stringify(meta ?? null) === JSON.stringify(App.meta ?? null)) return false;
  selfWrite = true;
  try {
    commit(() => { App.meta = meta; }, Change.META);
  } finally {
    selfWrite = false;
  }
  return true;
}

function writeField(name, value) {
  const d = draft();
  d[name] = value;
  return write(d);
}

function writeWords(edit) {
  const d = draft();
  edit(d.inputs);
  return write(d);
}

/**
 * The card cleared itself — every field emptied — so there is nothing left to
 * read. Fold it away rather than leave an empty shell over the diagram; the
 * button is still there to start again from.
 */
function foldIfEmpty() {
  if (!App.meta) hideExampleCard();
}

// ── Opening and closing ───────────────────────────────────────────

/** Collapse the card back to its button, dropping anything half-typed. */
export function hideExampleCard() {
  stopTimer();
  // Whatever had the focus is about to be hidden, so hand it back to the
  // button the card folds into rather than letting it fall to the body.
  const returnFocus = holdsFocus();
  open = false;
  caret = null;
  // Redrawn from App.meta rather than left half-typed behind the fade, to be
  // found still sitting there on the next open.
  renderExampleCard();
  if (returnFocus) $('canvas-info-btn')?.focus?.();
}

/** Is the focus inside the card? */
function holdsFocus() {
  const card = $('example-card');
  const active = typeof document === 'undefined' ? null : document.activeElement;
  return !!card && !!active && (active === card || card.contains?.(active) === true);
}

/**
 * Open the card. With nothing written about the machine yet this opens the
 * same card with its fields empty and the caret in the title — the button is
 * only offered when there is either something to read or something to say.
 *
 * `autoHide` is also what says who opened it. The app opening a card on a load
 * or a StateMate run must not take the focus out from under whatever the
 * reader was doing; a reader opening it *asked* for it, and opening it takes
 * the button they pressed away, so leaving focus there would put it on a
 * hidden node — and the card's Escape, which is on the card, would never fire.
 *
 * @param {boolean} [opts.autoHide] the app opened it: fold away again after
 *   the countdown, and leave the focus where it was
 */
export function openExampleCard({ autoHide = false } = {}) {
  const card = $('example-card');
  if (!describable() || !card) return;
  stopTimer();
  open = true;
  renderExampleCard();
  if (autoHide) { startTimer(); return; }
  // An undescribed machine opens on the one field that has to be filled in
  // first; a described one opens as something to read, so the focus goes to
  // the card rather than into a field — a caret in a sentence you came to read
  // is an invitation to edit it by accident.
  if (App.meta) card.focus?.();
  else focusField('title');
}

export function toggleExampleCard() {
  if (open) hideExampleCard();
  else openExampleCard();
}

/**
 * Open the card with the caret already in it — the canvas context menu's way
 * in, and the answer to "how do I describe a machine I drew myself?". A 24px
 * circle in a corner is a way *back* to something already read, not somewhere
 * anyone looks to start writing. Right-clicking the canvas is.
 */
export function ctxCanvasDescribe() {
  hideCanvasContextMenu();
  openExampleCard();
  focusField('title');
}

/**
 * Describe the machine now on the canvas; null says nothing about it and takes
 * the card away. This is the loaders' entry point — a bundled example, a
 * dropped file, a StateMate result — so it writes App.meta without an undo
 * point of its own, each of those paths having recorded one for the load.
 */
export function showExampleCard(meta) {
  if (!$('example-card')) return;
  stopTimer();
  caret = null;
  pending = null;
  editIndex = null;
  App.meta = normalizeCardMeta(meta);
  if (App.meta) openExampleCard({ autoHide: true });
  else hideExampleCard();
}

export function exampleCardMeta() {
  return App.meta;
}

/** Is the caret in one of the card's fields? For the tests, and for the timer. */
export function isEditingExampleCard() {
  return caret !== null;
}

/** Test seam — a timer, a half-typed field and a stale node must not cross tests. */
export function _resetExampleCardForTests() {
  stopTimer();
  open = false;
  caret = null;
  selfWrite = false;
  pending = null;
  editIndex = null;
  parts = {};
  const card = $('example-card');
  if (card) {
    card.classList.remove('is-open');
    card.innerHTML = '';
  }
}

// ── Building nodes ────────────────────────────────────────────────

function elem(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(cls, glyph, tip, onClick) {
  const b = elem('button', cls, glyph);
  b.type = 'button';
  if (tip) b.dataset.tip = tip;
  b.setAttribute('aria-label', tip || glyph);
  b.onclick = onClick;
  return b;
}

/**
 * Is this still the node the card is showing under that name? A field that has
 * been redrawn is a field whose handlers have been replaced, and everything it
 * would have had to say has either just happened or has just been undone.
 */
function live(name, node) {
  return parts[name] === node;
}

/** Put the caret in a named field, if this render is showing one. */
function focusField(name) {
  const node = parts[name];
  if (node && node.focus) node.focus();
}

/**
 * Grow a textarea to its content, so a blurb is never a two-line window onto a
 * four-line sentence. It measures, so it can only run once the node is in the
 * document — a detached textarea reports a scrollHeight of 0, and a blurb set
 * to `height: 0` is a card with its description missing.
 */
function autoGrow(area) {
  if (!area?.style || typeof area.scrollHeight !== 'number') return;
  area.style.height = 'auto';
  area.style.height = `${Math.min(220, area.scrollHeight)}px`;
}

/**
 * Wire a field that reads as text: focus bookkeeping, commit on the way out,
 * and Escape to put it back. `read` is what App.meta says the field holds, so
 * Escape and the no-op check share one source of truth.
 */
function wireField(node, name, { read, write: writeBack, onEnter }) {
  node.dataset.field = name;
  node.onfocus = () => {
    if (!live(name, node)) return;
    caret = name;
    stopTimer();
  };
  node.onblur = () => {
    if (!live(name, node)) return;
    if (caret === name) caret = null;
    writeBack(node.value);
  };
  node.onkeydown = e => {
    if (!live(name, node)) return;
    if (e.key === 'Escape') {
      // Handled here rather than by the card's own listener, so a field
      // reverts where the card itself would close.
      e.stopPropagation();
      node.value = read();
      if (node.blur) node.blur();
      return;
    }
    if (e.key === 'Enter' && onEnter) {
      e.preventDefault();
      onEnter(node);
    }
  };
}

/**
 * Wire the two nodes that are in the markup rather than built here: the button
 * and the card's own shell. Idempotent, and called from syncCanvasInfoButton
 * rather than from the renderer — **the card may never have been drawn**. It is
 * drawn on a load, an undo or a tab switch, and none of those happen on a fresh
 * page, so a button wired by the renderer was a Describe button that did
 * nothing at all for the first machine anybody drew.
 *
 * Done here rather than through an on* attribute, so the card adds no names to
 * bridge.js — the same way reference.js and statemate-ui.js do it.
 */
function wireChrome() {
  const btn = $('canvas-info-btn');
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', toggleExampleCard);
  }
  const card = $('example-card');
  if (!card || card.dataset.wired) return;
  card.dataset.wired = '1';
  // The one certain sign someone is still reading is that they are pointing at
  // it, so the countdown stops there.
  card.addEventListener('pointerenter', stopTimer);
  // Escape from the card itself — not from a field, which reverts and stops
  // the event — puts the card away. The card is not a modal, so modal.js never
  // sees this key and the dialog chain is not involved.
  card.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    hideExampleCard();
  });
}

// ── The head and the blurb ────────────────────────────────────────

function buildHead(meta) {
  const head = elem('div', 'example-card-head');

  const title = elem('input', 'example-card-input example-card-title');
  title.type = 'text';
  title.value = meta.title || '';
  title.maxLength = CARD_TITLE_MAX;
  title.placeholder = 'Name this machine';
  title.setAttribute('aria-label', 'Machine name');
  wireField(title, 'title', {
    read: () => App.meta?.title || '',
    write: value => { if (writeField('title', value)) foldIfEmpty(); },
    // ⏎ in a one-line field means "done", the way it does in the tab rename
    // and the state rename. The blurb is the exception: a description is
    // allowed more than one line.
    onEnter: node => node.blur?.()
  });
  parts.title = title;
  head.append(title);

  head.append(iconButton('example-card-close', '×', 'Dismiss', hideExampleCard));
  return head;
}

function buildBlurb(meta) {
  const blurb = elem('textarea', 'example-card-input example-card-area');
  blurb.value = meta.blurb || '';
  blurb.maxLength = CARD_BLURB_MAX;
  // One row is the floor, not the size: autoGrow() sets the height from the
  // content on every render and every keystroke. At two, an empty card carried
  // a blank line under its placeholder for no reason.
  blurb.rows = 1;
  blurb.placeholder = 'What does it accept, and how?';
  blurb.setAttribute('aria-label', 'What this machine does');
  wireField(blurb, 'blurb', {
    read: () => App.meta?.blurb || '',
    write: value => { if (writeField('blurb', value)) foldIfEmpty(); }
  });
  blurb.oninput = () => autoGrow(blurb);
  parts.blurb = blurb;
  return blurb;
}

// ── Test words ────────────────────────────────────────────────────

/** Run a word on the canvas — the one thing the card does that no panel does. */
function runWord(word) {
  const box = $('sim-in');
  if (box) box.value = word;
  runSim();
}

function epsilon() {
  return App.config?.sym?.eps || 'ε';
}

function verdictOf(row) {
  return row?.expect === 'accept' || row?.expect === 'reject' ? row.expect : '';
}

/** The verdict class is written from one place, so cycling can take it off again. */
function paintVerdict(chip, expect) {
  chip.dataset.expect = expect;
  chip.classList.remove('chip-acc', 'chip-rej');
  if (expect === 'accept') chip.classList.add('chip-acc');
  if (expect === 'reject') chip.classList.add('chip-rej');
}

/**
 * One test word. A committed row is a pill that runs; the row being typed is
 * the same pill with a field where its word goes, so a word is edited in the
 * row it belongs to rather than in a form somewhere else.
 */
function buildChip(row, i, { draft: isDraft = false } = {}) {
  const expect = verdictOf(row);
  const chip = elem('span', 'example-chip');
  if (isDraft) chip.classList.add('is-pending');
  chip.dataset.i = String(i);
  paintVerdict(chip, expect);

  const mark = iconButton('example-chip-expect', EXPECT_MARK[expect], EXPECT_TIP[expect],
    () => cycleVerdict(chip, i));
  chip.append(mark);
  chip.__parts = { mark };

  if (editIndex === i) chip.append(buildWordField(row, i, isDraft));
  else chip.append(buildRunButton(row, i));

  chip.append(iconButton('example-chip-drop', '×', 'Remove this word', () => dropWord(i)));
  return chip;
}

function buildRunButton(row, i) {
  const word = row.w === undefined || row.w === null ? '' : String(row.w);
  const run = elem('button', 'example-chip-run');
  run.type = 'button';
  // Drawn as "" the empty word is a blank pill that reads as a rendering
  // fault. Show the symbol; run the real (empty) string.
  run.textContent = word === '' ? epsilon() : word;
  const expect = verdictOf(row);
  const hint = [row.label, expect || (row.out !== undefined ? `→ ${row.out}` : '')]
    .filter(Boolean).join(' — ');
  run.dataset.tip = hint ? `${hint} · double-click to edit` : 'Run this word · double-click to edit';
  run.setAttribute('aria-label', `Run ${word === '' ? 'the empty word' : word}`);
  run.onclick = () => runWord(word);
  run.ondblclick = e => { e.preventDefault(); beginWordEdit(i); };
  // The same gesture without a pointer: F2 is what renames things everywhere
  // else a list of short names is edited in place.
  run.onkeydown = e => { if (e.key === 'F2') { e.preventDefault(); beginWordEdit(i); } };
  return run;
}

function buildWordField(row, i, isDraft) {
  const field = elem('input', 'example-card-input example-card-word');
  field.type = 'text';
  field.value = isDraft ? '' : String(row.w ?? '');
  field.maxLength = CARD_WORD_MAX;
  // A field left blank *is* the empty word, and the chip will read ε too — so
  // the placeholder shows what it is about to become rather than "type here".
  field.placeholder = epsilon();
  field.setAttribute('aria-label', 'Test word');
  field.dataset.field = `word-${i}`;
  field.oninput = () => sizeWordField(field);
  field.onfocus = () => { if (live('word', field)) { caret = `word-${i}`; stopTimer(); } };
  field.onblur = () => { if (live('word', field)) commitWord(field.value); };
  field.onkeydown = e => {
    if (!live('word', field)) return;
    if (e.key === 'Escape') {
      // Escape is the way to take a word back: a new one leaves nothing
      // behind, an edited one goes back to what it said.
      e.stopPropagation();
      cancelWordEdit();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // ⏎ commits, and on the last row offers another — which is how a list of
    // words gets typed.
    const wasLast = i >= words().length - 1;
    commitWord(field.value);
    if (wasLast) addCardWord();
  };
  parts.word = field;
  sizeWordField(field);
  return field;
}

// The field is as wide as what is in it, so a chip being edited stays a chip
// rather than becoming a text box the width of the card.
function sizeWordField(field) {
  if (!field?.style) return;
  const len = Math.max(1, String(field.value || field.placeholder || '').length);
  field.style.width = `${Math.min(22, len + 1)}ch`;
}

/**
 * Show a text field in one row. A draft word exists only while it is being
 * typed, so moving the caret to another row ends it rather than leaving a
 * chip behind with nothing in it.
 */
function beginWordEdit(i) {
  if (pending && i !== words().length) pending = null;
  editIndex = i;
  renderWords();
  focusField('word');
  if (parts.word?.select) parts.word.select();
}

/** Put the row back the way it was, adding nothing. */
function cancelWordEdit() {
  editIndex = null;
  pending = null;
  caret = null;
  renderWords();
}

/**
 * Write the row being typed, exactly once.
 *
 * Once is the whole of it. Committing redraws the row, which detaches the
 * field being typed into — and a detached field that held focus fires blur on
 * its way out, landing back here. `live()` is what stops that: the redraw
 * below replaces the field, and its handlers stand down on the way past.
 *
 * The empty word is a word. A new chip used to be dropped unless it had been
 * typed into, which made ε the one input the card could not be given with a
 * pointer at all — so the + always adds, and Escape and the × are how one is
 * taken back.
 */
function commitWord(value) {
  const i = editIndex;
  if (i === null) return;
  const isDraft = !!pending;
  const expect = isDraft ? verdictOf(pending) : '';
  editIndex = null;
  pending = null;
  caret = null;

  writeWords(rows => {
    if (isDraft) {
      if (rows.length < CARD_WORDS_MAX) rows.push(expect ? { w: value, expect } : { w: value });
    } else if (rows[i]) {
      rows[i].w = value;
    }
  });
  renderWords();
  foldIfEmpty();
}

/** Add a word: a chip that is not in App.meta until it has been typed into. */
export function addCardWord() {
  if (!parts.words || words().length >= CARD_WORDS_MAX) return;
  pending = { expect: 'accept' };
  beginWordEdit(words().length);
}

function dropWord(i) {
  if (pending && i === words().length) { cancelWordEdit(); return; }
  pending = null;
  editIndex = null;
  writeWords(rows => rows.splice(i, 1));
  renderWords();
  foldIfEmpty();
}

/**
 * accept → reject → nothing claimed, in place. The row being typed has nothing
 * to write to yet, so its verdict rides on the draft until the word beside it
 * is committed.
 */
function cycleVerdict(chip, i) {
  const now = chip.dataset.expect || '';
  const next = EXPECT_CYCLE[(EXPECT_CYCLE.indexOf(now) + 1) % EXPECT_CYCLE.length];
  paintVerdict(chip, next);
  const mark = chip.__parts?.mark;
  if (mark) {
    mark.textContent = EXPECT_MARK[next];
    mark.dataset.tip = EXPECT_TIP[next];
    mark.setAttribute('aria-label', EXPECT_TIP[next]);
  }
  if (pending && i === words().length) { pending.expect = next; return; }
  writeWords(rows => {
    if (!rows[i]) return;
    if (next) rows[i].expect = next;
    else delete rows[i].expect;
  });
}

// ── Rendering ─────────────────────────────────────────────────────

/**
 * Draw the word row only. Rows are addressed by index, so a commit that
 * changes their number has to renumber the chips — but the fields above are
 * left alone, which is what lets a word be edited without the caret jumping
 * out of the blurb.
 */
function renderWords() {
  const row = parts.words;
  if (!row) return;
  row.innerHTML = '';
  parts.word = null;

  words().forEach((word, i) => row.append(buildChip(word, i)));
  if (pending) row.append(buildChip(pending, words().length, { draft: true }));
  else if (words().length < CARD_WORDS_MAX) {
    row.append(iconButton('example-card-add', '+', 'Add a test word', addCardWord));
  }
  // The corner is chosen for the card's footprint, and a row that gained or
  // lost a line is a card that may no longer clear the toolbar it sits beside.
  repositionCanvasInfo();
}

/**
 * Draw the whole card from App.meta. Subscribed to Change.META, so everything
 * that writes it and announces it lands here — an undo, a tab switch, a loaded
 * file, a StateMate result — everything except this module's own commits,
 * which have already put the DOM where they want it.
 */
export function renderExampleCard() {
  const card = $('example-card');
  if (!card) return;
  card.innerHTML = '';
  parts = {};
  card.classList.toggle('is-open', open);

  // Closed and undescribed is the one case with nothing to draw. Open, the
  // card is its own editor, so an empty one is a card of placeholders rather
  // than no card at all.
  if (!App.meta && !open) {
    pending = null;
    editIndex = null;
    syncCanvasInfoButton();
    repositionCanvasInfo();
    return;
  }

  const meta = App.meta || {};
  card.append(buildHead(meta), buildBlurb(meta));
  parts.words = elem('div', 'example-card-words');
  card.append(parts.words);
  // Once, and only now that the textarea is in the document to be measured.
  autoGrow(parts.blurb);
  syncCanvasInfoButton();
  // Last, because renderWords() re-anchors the card and the footprint it is
  // anchored by is only final once the words are in it.
  renderWords();
}

/**
 * Show or hide the button the card folds into. It is offered whenever there is
 * a description to read *or* a machine that could have one — the second half is
 * what makes the card reachable for a machine you drew yourself. With neither,
 * it stays away: a button that opens an empty card is worse than no button.
 */
export function syncCanvasInfoButton() {
  wireChrome();
  const btn = $('canvas-info-btn');
  if (!btn) return;
  const wasHidden = btn.hidden;
  const described = !!App.meta;
  btn.hidden = open || !describable();
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  btn.dataset.tip = described ? 'About this machine' : 'Describe this machine';
  // A bare (i) is a way back to something already read. With nothing written
  // yet there is nothing to go back *to*, and the same circle reads as
  // decoration — so it says what it does instead.
  btn.classList.toggle('is-invite', !described);
  const label = btn.querySelector?.('.canvas-info-label');
  if (label) label.textContent = described ? '' : 'Describe';
  if (wasHidden !== btn.hidden) repositionCanvasInfo();
}

// The button appears with the first state and goes away with the last, so it
// tracks the graph. Deliberately *not* a full card re-render: a StateMate
// result decorates the card in place, and redrawing on every edit to the
// diagram would wipe that strip off between the run and the reading of it.
subscribe(Change.GRAPH, syncCanvasInfoButton);
// Guarded on the card's own contents, not on the emit.
//
// renderExampleCard ends in repositionCanvasInfo(), which calls
// getBoundingClientRect on #canvas-wrap and so forces a synchronous layout
// flush against the whole diagram — 8.4ms on a 200-state machine, and it is
// paid even on the early-return path where App.meta is null and the card is
// closed, i.e. when there is nothing to draw at all.
//
// That would be fine if META meant "the card changed", but it does not: every
// path that rehydrates App announces it, so restoreSnapshot (each undo and
// redo), both tab-activation paths and StateMate's restoreCheckpoint all pay
// the reflow to redraw a card that usually did not move.
//
// Only the subscriber is guarded. Every direct caller is a live interaction
// with the card — opening it, committing a field, adding a test word — where
// module state the signature cannot see has changed and a redraw is the point.
export let _metaPainted = null;
function metaSignature() {
  const m = App.meta;
  if (!m) return '';
  // Small by construction: a title, a blurb and a handful of test words.
  return JSON.stringify(m);
}
subscribe(Change.META, () => {
  if (selfWrite) return;
  const sig = metaSignature();
  if (sig === _metaPainted) return;
  _metaPainted = sig;
  renderExampleCard();
});
export function _resetMetaPainted() { _metaPainted = null; }
