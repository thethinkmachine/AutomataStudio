// Editing a transition where it is drawn: double-click a row of an edge's
// label and that row becomes a strip of fields, one per thing the transition
// carries, laid over the label in the same order and colours the pills use.
// Enter saves, Escape puts it back, ↑ and ↓ step to the edge's other rows.
//
// **What the fields are.** Read off the machine's declared `transitionFields`,
// never a list of names, so a machine added to js/machines/ is editable here
// the day it is defined. `from` and `to` are not offered: the label belongs to
// an edge, and moving a transition to another edge is a different gesture —
// the dialog, one click away on the strip, still does it. A multi-tape
// machine's transition carries three arrays rather than three fields, so the
// strip has a read, a write and a move per tape, grouped as the label groups
// them (T1, T2, …) and wrapping onto more lines past a few tapes. A field per
// tape is named `tapeSyms.0`, `tapeWrites.0`, `tapeDirs.0`: the array and the
// tape.
//
// **What decides whether it is allowed.** saveTransition() in
// states-transitions.js, the same function the dialog's Save goes through, so
// a rule cannot be enforced in one and missing from the other. The checks made
// here are only the ones the dialog makes by *construction* — its Read and
// Output menus cannot hold a symbol the machine does not have, and a text
// field can.
//
// **Size.** The strip is one small HTML element over the canvas, positioned
// from the layout pass's label point and the camera, so it costs the same on a
// thousand-state machine as on a three-state one, and it reads at the same
// size at any zoom. Where the label is not drawn at all — zoomed out past the
// level of detail, or turned off by the large-machine profile — a double-click
// on the edge itself opens it at the point the label would occupy, so the
// gesture survives exactly where reading the label does not. Saving is one
// commit, which repaints through the same path as any other edit.
//
// Nothing here is reached from an `on*` attribute, so it adds nothing to
// bridge.js.

import { $, App, getMachineConfig, isReadOnlyHeadMachine } from './state.js';
import { isMultiTape, transitionFieldsOf } from './machines/index.js';
import { parseEps } from './machines/predicates.js';
import { formatWeight, getTransition, openTransModal, saveTransition, transitionSymbolChoices } from './states-transitions.js';
import { edgeLabelAnchor } from './render.js';
import { viewEdgeGroup } from './view-graph.js';
import { hideSymSuggest, handleSymSuggestActive, handleSymSuggestKeyup, refreshSymSuggest, trySymSuggestKeydown } from './suggest.js';
import { isCounterMachine, isQueueAutomaton, showStatus } from './utils.js';
import { Change, subscribe } from './store.js';

// ── the fields ────────────────────────────────────────────────────

/** The pill role each field is drawn with, so the strip wears the label's colours. */
const ROLE = {
  on: 'input', write: 'write', move: 'move', out: 'output', weight: 'weight',
  pop: 'memory-read', push: 'memory-write', pop2: 'memory-read', push2: 'memory-write',
  below: 'memory-write', above: 'memory-write',
  tapeSyms: 'input', tapeWrites: 'write', tapeDirs: 'move'
};

/** A field id split into the field and, for a per-tape field, the tape. */
function fieldParts(id) {
  const dot = id.indexOf('.');
  return dot === -1 ? { base: id, tape: -1 } : { base: id.slice(0, dot), tape: Number(id.slice(dot + 1)) };
}

/**
 * The field a pill stands for — which input a double-click on that pill
 * focuses. `part` is the pill's place in its row, which on a multi-tape label
 * is the tape.
 */
function fieldForRole(role, fields, part = 0) {
  switch (role) {
    case 'tape': return `tapeSyms.${part}`;
    case 'input': return 'on';
    case 'write': return 'write';
    case 'move': return 'move';
    case 'output': return 'out';
    case 'weight': return 'weight';
    // A two-stack label draws stack 1 as the read pill and stack 2 as the write
    // pill; everything else draws pop and push.
    case 'memory-read': return 'pop';
    case 'memory-write': return fields.includes('pop2') ? 'pop2' : 'push';
    default: return null;
  }
}

/** The word in front of a field — the label's own vocabulary, so the strip reads like the row it replaced. */
function captionFor(field) {
  const [pop, push] = isQueueAutomaton(App.machine) ? ['deq', 'enq']
    : isCounterMachine(App.machine) ? ['test', 'set'] : ['pop', 'push'];
  return {
    on: '', write: 'write', move: 'move', out: 'out', weight: 'p',
    pop, push, pop2: `${pop}₂`, push2: `${push}₂`, below: 'below', above: 'above',
    tapeSyms: '', tapeWrites: 'write', tapeDirs: 'move'
  }[fieldParts(field).base] ?? field;
}

/** Which symbol-suggest list a field gets (js/suggest.js), if any. */
function suggestKindFor(field) {
  const { base } = fieldParts(field);
  if (base === 'write' || base === 'tapeSyms' || base === 'tapeWrites') return 'write';
  if (field === 'pop' || field === 'pop2') return 'pop';
  if (field === 'push' || field === 'push2') return 'push';
  // A tape machine reads the blank, which nobody can type; the write list is
  // Σ and ⊔, which is what a read needs too.
  if (field === 'on' && getMachineConfig(App.machine).hasTape) return 'write';
  return null;
}

/**
 * The fields the strip offers for a machine, in the order its schema lists
 * them — or null where the dialog is the right editor.
 */
export function labelEditorFields(m = App.machine) {
  if (isMultiTape(m)) {
    const out = [];
    for (let i = 0; i < App.tapeCount; i++) out.push(`tapeSyms.${i}`, `tapeWrites.${i}`, `tapeDirs.${i}`);
    return out;
  }
  const fields = (transitionFieldsOf(m) || []).filter(f => f !== 'from' && f !== 'to');
  return fields.length ? fields : null;
}

/** What a field shows for a transition, in the form the label draws it. */
function shownValue(t, field) {
  const { eps, lambda, blank } = App.config.sym;
  const { base, tape } = fieldParts(field);
  // The dialog's fallbacks, kept exactly: a transition saved before it had
  // per-tape arrays, or before the tape count went up, still shows something
  // for every tape.
  if (base === 'tapeSyms') return String(t.tapeSyms?.[tape] ?? t.symbol ?? blank);
  if (base === 'tapeWrites') return String(t.tapeWrites?.[tape] ?? t.write ?? t.symbol ?? blank);
  if (base === 'tapeDirs') return t.tapeDirs?.[tape] ?? t.dir ?? App.directions[0].value;
  switch (field) {
    case 'on': return String(t.symbol ?? '');
    case 'write': return String(t.write ?? t.symbol ?? '');
    case 'move': return t.dir || App.directions[0].value;
    case 'out': return t.output !== undefined && t.output !== '' ? String(t.output) : lambda;
    case 'weight': return formatWeight(t.weight ?? 1);
    default: return String(t[field] ?? eps);
  }
}

// ── the editor ────────────────────────────────────────────────────

let ed = null;

/** The open editor, for the tests: which edge, which row, what each field holds. */
export function edgeLabelEditorState() {
  if (!ed) return null;
  const fields = {};
  for (const [f, el] of ed.inputs) fields[f] = el.value;
  return { key: ed.key, tid: ed.t.id, row: ed.row, rows: ed.ids.length, fields, error: ed.error };
}

/** What the open editor would save, for the tests: `{ values }` or `{ error }`. */
export function edgeLabelEditorValues() {
  return ed ? readValues() : null;
}

/** The field a pill focuses, for the tests. */
export function labelEditorFieldForPill(role, part = 0, m = App.machine) {
  return fieldForRole(role, labelEditorFields(m) || [], part);
}

/** One of the open editor's inputs, for the tests. */
export function edgeLabelEditorInput(field) {
  return ed ? ed.inputs.get(field) || null : null;
}

/**
 * Opens the editor on one row of an edge's label. `row` is the transition's
 * position in the label; `role` is the pill that was hit, whose field takes
 * the focus. Returns whether an inline editor opened — false where the dialog
 * was opened instead, or there was nothing to edit.
 */
export function openEdgeLabelEditor(key, { row = 0, role = null, part = 0, field = null } = {}) {
  const ts = viewEdgeGroup(key);
  if (!ts || !ts.length) return false;
  const at = Math.max(0, Math.min(ts.length - 1, row | 0));
  const t = ts[at];
  const fields = labelEditorFields();
  if (!fields) {
    closeEdgeLabelEditor();
    openTransModal(t.from, t.to, { mode: 'edit', transId: t.id, transitions: ts });
    return false;
  }
  closeEdgeLabelEditor();
  const host = $('canvas-wrap');
  if (!host) return false;

  const el = document.createElement('div');
  el.className = 'ele';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Edit transition');
  const strip = document.createElement('div');
  strip.className = 'ele-strip';
  el.appendChild(strip);
  // Per-tape fields stack as a column, a tape to a line — the dialog's
  // table, laid over the label — with the ⋯ beside the whole column.
  let tapeBox = null;
  if (fields.some(f => fieldParts(f).tape !== -1)) {
    tapeBox = document.createElement('div');
    tapeBox.className = 'ele-tapes';
    strip.appendChild(tapeBox);
  }

  const inputs = new Map();
  const tapes = new Map();
  for (const f of fields) {
    const { base, tape } = fieldParts(f);
    // A tape's three fields sit together under its number, the way the
    // label's pill for that tape does.
    let into = strip;
    if (tape !== -1) {
      into = tapes.get(tape);
      if (!into) {
        into = document.createElement('span');
        into.className = 'ele-tape';
        const n = document.createElement('span');
        n.className = 'ele-tape-n';
        n.textContent = `T${tape + 1}`;
        into.appendChild(n);
        tapeBox.appendChild(into);
        tapes.set(tape, into);
      }
    }
    // A <label> for a text field, so a press on the caption focuses it — but
    // not for the move, whose buttons are labelable: a press on the word
    // "move" would click the first of them and change the move.
    const isMove = base === 'move' || base === 'tapeDirs';
    const part = document.createElement(isMove ? 'span' : 'label');
    part.className = `ele-part ele-${ROLE[base] || 'input'}`;
    const cap = captionFor(f);
    if (cap) {
      const span = document.createElement('span');
      span.className = 'ele-cap';
      span.textContent = cap;
      part.appendChild(span);
    }
    const input = isMove ? moveChoice(shownValue(t, f)) : textInput(t, f);
    input.setAttribute('data-field', f);
    const say = cap || 'read';
    input.setAttribute('aria-label', tape === -1 ? say : `tape ${tape + 1} ${say}`);
    part.appendChild(input);
    into.appendChild(part);
    inputs.set(f, input);
  }

  // Everything the strip does not carry — From and To — is in the dialog, so
  // the dialog is one press away.
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'ele-more';
  more.setAttribute('aria-label', 'Open in the transition dialog');
  more.setAttribute('data-tip', 'Open in the transition dialog');
  more.textContent = '⋯';
  more.addEventListener('click', openInDialog);
  strip.appendChild(more);

  const count = document.createElement('span');
  count.className = 'ele-count';
  count.hidden = ts.length < 2;
  count.textContent = `${at + 1}/${ts.length}`;
  count.setAttribute('data-tip', '↑ ↓ for the edge\'s other transitions');
  strip.appendChild(count);

  const msg = document.createElement('div');
  msg.className = 'ele-msg';
  msg.setAttribute('role', 'alert');
  msg.hidden = true;
  el.appendChild(msg);

  el.addEventListener('keydown', onKey);
  host.appendChild(el);

  ed = { key, t, row: at, ids: ts.map(x => x.id), fieldsKey: fields.join(','), el, msg, more, inputs, error: null, pos: null };
  place();
  if (typeof document.addEventListener === 'function') document.addEventListener('pointerdown', onOutside, true);

  const want = field || fieldForRole(role, fields, part) || fields[0];
  const first = inputs.get(want) || inputs.get(fields[0]);
  if (first && typeof first.focus === 'function') {
    first.focus();
    if (typeof first.select === 'function') first.select();
  }
  return true;
}

function textInput(t, field) {
  const input = document.createElement('input');
  input.className = 'ele-in';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  if (field === 'weight') input.setAttribute('inputmode', 'decimal');
  input.value = shownValue(t, field);
  const kind = suggestKindFor(field);
  if (kind) input.setAttribute('data-suggest', kind);
  fitWidth(input);
  input.addEventListener('input', () => {
    fitWidth(input);
    clearError();
    if (kind) handleSymSuggestActive(input);
  });
  if (kind) {
    input.addEventListener('focus', () => handleSymSuggestActive(input));
    input.addEventListener('click', () => refreshSymSuggest(input));
    input.addEventListener('keyup', () => handleSymSuggestKeyup(input));
    input.addEventListener('blur', () => hideSymSuggest());
  }
  return input;
}

// The move is a choice of two or three, so it is buttons rather than a menu —
// one press, and every option visible on the strip. It is deliberately not a
// <select>: js/dropdown.js replaces every select the page grows with a popup
// attached to <body>, outside the strip, so choosing from it was a press
// outside — which saved the strip as it stood and closed it before the choice
// arrived. The group answers `.value` like the text fields, so reading the
// strip back does not care which kind of field it is.
function moveChoice(initial) {
  const group = document.createElement('span');
  group.className = 'ele-seg';
  group.setAttribute('role', 'radiogroup');
  group.tabIndex = 0;
  const values = App.directions.map(d => d.value);
  let value = initial;
  const buttons = App.directions.map(d => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ele-opt';
    b.tabIndex = -1;
    b.textContent = d.value;
    b.setAttribute('role', 'radio');
    b.setAttribute('data-tip', d.label);
    b.addEventListener('click', () => choose(d.value));
    group.appendChild(b);
    return [d.value, b];
  });
  const paint = () => {
    for (const [v, b] of buttons) {
      b.classList.toggle('is-on', v === value);
      b.setAttribute('aria-checked', String(v === value));
    }
  };
  function choose(v) {
    value = v;
    paint();
    clearError();
  }
  Object.defineProperty(group, 'value', { get: () => value, set: v => { value = String(v); paint(); }, configurable: true });
  // ←/→ step through the moves and a letter picks one, so the keyboard never
  // has to leave the strip. ↑/↓ are left to the rows, as in the text fields.
  group.addEventListener('keydown', e => {
    const at = values.indexOf(value);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      choose(values[(at + (e.key === 'ArrowLeft' ? -1 : 1) + values.length) % values.length]);
      return;
    }
    const hit = e.key && e.key.length === 1 ? values.find(v => v.toLowerCase() === e.key.toLowerCase()) : null;
    if (hit) { e.preventDefault(); e.stopPropagation(); choose(hit); }
  });
  paint();
  return group;
}

// Monospace, so a character is a `ch`: the field is as wide as what is in it,
// the way the pill it replaced was.
function fitWidth(input) {
  if (input.style) input.style.width = `${Math.max(2, String(input.value).length + 1)}ch`;
}

/** Closes the editor. Unsaved changes are dropped; saving is commitEdgeLabelEditor(). */
export function closeEdgeLabelEditor() {
  if (!ed) return;
  const { el } = ed;
  ed = null;
  hideSymSuggest();
  if (typeof document.removeEventListener === 'function') document.removeEventListener('pointerdown', onOutside, true);
  if (el.parentNode) el.parentNode.removeChild(el);
}

/** Drops module state between tests. */
export function resetEdgeLabelEditor() {
  closeEdgeLabelEditor();
}

// ── reading it back ───────────────────────────────────────────────

/**
 * The strip's fields, as the values saveTransition() takes, or an error for a
 * field a text box could hold and the dialog's menus could not.
 */
function readValues() {
  const { t, inputs } = ed;
  const { eps, lambda } = App.config.sym;
  const v = {
    from: t.from, to: t.to, symbol: t.symbol,
    pop: t.pop, push: t.push, pop2: t.pop2, push2: t.push2, below: t.below, above: t.above,
    write: t.write, dir: t.dir, output: t.output, weight: t.weight
  };
  // Fresh arrays, never the transition's own: a refused save must leave it
  // exactly as it was.
  const arrays = {};
  for (const [field, input] of inputs) {
    const raw = String(input.value ?? '');
    const { base, tape } = fieldParts(field);
    if (tape !== -1) {
      // The dialog's reading of each per-tape field, kept exactly.
      if (!arrays[base]) arrays[base] = [];
      arrays[base][tape] = base === 'tapeDirs' ? (raw || App.directions[0].value)
        : base === 'tapeWrites' ? (parseEps(raw) || App.config.sym.blank)
        : parseEps(raw);
      continue;
    }
    switch (field) {
      case 'on': v.symbol = parseEps(raw); break;
      case 'write': v.write = parseEps(raw); break;
      case 'move': v.dir = raw || App.directions[0].value; break;
      case 'out': { const o = raw.trim(); v.output = o === '' || o === lambda ? '' : o; break; }
      case 'weight': v.weight = raw.trim() === '' ? 1 : Number(raw.trim()); break;
      default: v[field] = parseEps(raw) || eps;
    }
  }
  const choices = transitionSymbolChoices();
  const alpha = getMachineConfig(App.machine).hasTape ? 'Γ' : 'Σ';
  // A value the transition already had is kept even when it is not in the
  // alphabet — a symbol since removed from Σ, say. The dialog keeps it the same
  // way (ensureSelectValue), and refusing it would lock every other field of
  // the transition behind a fix the reader did not ask to make.
  const allowed = (sym, had) => choices.includes(sym) || sym === had;
  if (arrays.tapeSyms) {
    const blankAt = arrays.tapeSyms.findIndex(sym => !sym);
    if (blankAt !== -1) return { error: `Tape ${blankAt + 1} has to read something — type its symbol.` };
    const bad = arrays.tapeSyms.find((sym, i) => !allowed(sym, shownValue(t, `tapeSyms.${i}`)));
    if (bad !== undefined) return { error: `'${bad}' is not in ${alpha}. Add it in the left panel first.` };
    Object.assign(v, arrays);
    v.symbol = arrays.tapeSyms[0];
    return { values: v };
  }
  if (!v.symbol) return { error: 'A transition has to read something — type its symbol.' };
  // The dialog's defaulting, kept exactly: a blank write puts back what was
  // read, and a read-only head writes nothing at all.
  if (inputs.has('move')) v.write = isReadOnlyHeadMachine(App.machine) ? v.symbol : (v.write || v.symbol);
  if (!allowed(v.symbol, t.symbol)) {
    return { error: `'${v.symbol}' is not in ${alpha}. Add it in the left panel first.` };
  }
  if (inputs.has('out') && v.output !== '' && v.output !== (t.output ?? '') && !App.outputAlpha.has(v.output)) {
    return { error: `'${v.output}' is not in the output alphabet. Add it in the left panel first.` };
  }
  return { values: v };
}

/** Whether any field differs from the transition it was opened on. */
function isDirty() {
  for (const [field, input] of ed.inputs) {
    if (String(input.value) !== shownValue(ed.t, field)) return true;
  }
  return false;
}

/**
 * Saves the strip as one undoable edit and closes it. An unchanged strip
 * closes without an undo point. On a refusal the strip stays open with the
 * reason under it, and nothing has changed. Returns whether it closed.
 */
export function commitEdgeLabelEditor() {
  if (!ed) return true;
  if (!isDirty()) { closeEdgeLabelEditor(); return true; }
  const read = readValues();
  if (read.error) { showError(read.error); return false; }
  const result = saveTransition(read.values, ed.t.id);
  if (!result.ok) {
    if (result.gone) { closeEdgeLabelEditor(); return true; }
    showError(result.error);
    return false;
  }
  closeEdgeLabelEditor();
  return true;
}

function showError(text) {
  ed.error = text;
  ed.msg.textContent = text;
  ed.msg.hidden = false;
  ed.el.classList.add('is-bad');
}

function clearError() {
  if (!ed || !ed.error) return;
  ed.error = null;
  ed.msg.hidden = true;
  ed.msg.textContent = '';
  ed.el.classList.remove('is-bad');
}

// ── keys and the pointer ──────────────────────────────────────────

/**
 * The strip's keys stay in the strip — the canvas shortcuts listen on the
 * document and would otherwise switch the tool on a letter or delete the
 * selected edge on Backspace.
 */
function onKey(e) {
  if (!ed) return;
  // The symbol list owns Tab, ←/→ and its own Escape while it is open.
  if (trySymSuggestKeydown(e)) { e.stopPropagation(); return; }
  e.stopPropagation();
  const target = e.target;
  // The field a key came from: the input itself, or the move group around a
  // button that was pressed.
  const fieldEl = target && typeof target.closest === 'function' ? (target.closest('[data-field]') || target) : target;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeEdgeLabelEditor();
    return;
  }
  // Enter on the ⋯ button is that button's.
  if (e.key === 'Enter' && target !== ed.more) {
    e.preventDefault();
    commitEdgeLabelEditor();
    return;
  }
  if (e.key === 'Tab') {
    // Round the strip, rather than out of it into whatever the page puts next.
    const order = [...ed.inputs.values()];
    const at = order.indexOf(fieldEl);
    if (at === -1) return;
    e.preventDefault();
    const next = order[(at + (e.shiftKey ? -1 : 1) + order.length) % order.length];
    if (next && typeof next.focus === 'function') { next.focus(); if (typeof next.select === 'function') next.select(); }
    return;
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const step = e.key === 'ArrowUp' ? -1 : 1;
    const row = ed.row + step;
    if (row < 0 || row >= ed.ids.length) return;
    e.preventDefault();
    const { key } = ed;
    const field = fieldEl && fieldEl.getAttribute ? fieldEl.getAttribute('data-field') : null;
    if (commitEdgeLabelEditor()) openEdgeLabelEditor(key, { row, field });
  }
}

/**
 * A press anywhere else saves, the way leaving a cell does in a spreadsheet.
 * A change the machine refuses is dropped with the reason in the status bar —
 * the press has already gone somewhere else, and holding the strip open
 * against it would leave a field the reader has stopped looking at.
 */
function onOutside(e) {
  if (!ed) return;
  const t = e.target;
  if (t && typeof ed.el.contains === 'function' && ed.el.contains(t)) return;
  // The suggest popover is a sibling of the page, not of the strip.
  const pop = $('sym-suggest');
  if (t && pop && typeof pop.contains === 'function' && pop.contains(t)) return;
  if (!isDirty()) { closeEdgeLabelEditor(); return; }
  const read = readValues();
  const result = read.error ? { ok: false, error: read.error } : saveTransition(read.values, ed.t.id);
  if (!result.ok && !result.gone) showStatus(`${result.error} The change was not saved.`);
  closeEdgeLabelEditor();
}

function openInDialog() {
  if (!ed) return;
  const { t, ids } = ed;
  // Typed changes go with it when the machine accepts them; the dialog then
  // opens on the saved transition.
  if (isDirty() && !commitEdgeLabelEditor()) return;
  closeEdgeLabelEditor();
  const ts = ids.map(id => getTransition(id)).filter(Boolean);
  openTransModal(t.from, t.to, { mode: 'edit', transId: t.id, transitions: ts.length ? ts : undefined });
}

// ── where it sits ─────────────────────────────────────────────────

// Over the label's row, in canvas pixels. The point comes from the layout pass
// and the camera rather than from measuring the drawn label, so it is the same
// arithmetic whether or not the label is drawn.
function place() {
  if (!ed) return;
  const a = edgeLabelAnchor(ed.key);
  const style = ed.el.style;
  if (!a) {
    // Scrolled off the window the edges are laid out for. The strip waits
    // where it is, out of sight, rather than closing on a pan.
    if (ed.pos !== 'hidden') { style.visibility = 'hidden'; ed.pos = 'hidden'; }
    return;
  }
  const n = ed.ids.length;
  const y = a.drawn ? a.y + (ed.row - (n - 1) / 2) * a.pitch : a.y;
  const z = App.cam.z || 1;
  const x = App.cam.x + a.x * z;
  const top = App.cam.y + y * z;
  // The label's 11px at the current zoom, but never smaller than reads: zoomed
  // out it is a smear, and the strip is where it has to be legible again.
  const font = Math.min(22, Math.max(12, 11 * z));
  const pos = `${x}|${top}|${font}`;
  if (pos === ed.pos) return;
  ed.pos = pos;
  style.visibility = '';
  style.fontSize = `${font}px`;
  // Kept inside the canvas sideways. Below a zoom of 1 the strip is wider than
  // the row it covers, and a label near the edge would push half of it out of
  // the well, which clips. Measured after the font is set, since that is what
  // its width follows — one read, and only when the camera or the edge moved.
  const host = ed.el.parentNode;
  const w = ed.el.offsetWidth || 0;
  const room = host && host.clientWidth ? host.clientWidth : 0;
  const left = w && room > w + 16 ? Math.max(w / 2 + 8, Math.min(room - w / 2 - 8, x)) : x;
  style.left = `${left}px`;
  style.top = `${top}px`;
}

/**
 * Keep up with the camera. Called from applyCamera's frame, which every pan
 * and zoom ends in — a wheel, a fit, the minimap — none of which announce a
 * change. Costs a map lookup when the strip is open and nothing when it is not.
 */
export function followLabelEditor() {
  if (ed) place();
}

// An undo, a delete or a tab switch can take the transition away while the
// strip is open, and a strip editing a transition that is not on screen any
// more would save into whatever now has its id. Identity, not the id: a
// restored snapshot builds new objects under the same ids.
subscribe(Change.GRAPH, () => {
  if (!ed) return;
  // The fields can change under it too: a tape added or removed.
  const fields = labelEditorFields();
  if (getTransition(ed.t.id) !== ed.t || !fields || fields.join(',') !== ed.fieldsKey) { closeEdgeLabelEditor(); return; }
  place();
});
