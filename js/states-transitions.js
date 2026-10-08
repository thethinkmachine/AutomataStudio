import { clearTempLine, hideCanvasContextMenu } from './canvas.js';
import { invalidateTransitionIndex } from './machines/runtime.js';
import { snapshot } from './history.js';
import { closeModal, registerModal, showOverlay } from './modal.js';
import { pruneNoteAnchorsExcluding } from './notes.js';
import { acceptsAreShown, renderAll } from './render.js';
import { drawEditPreview, previewSpan } from './edit-preview.js';
import { $, App, getMachineConfig, getState, isBoundarySymbol, isReadOnlyHeadMachine, isWeightedFA, statePriority, usesParityPriorities, wrapStateLabelsOn } from './state.js';
import { Change, emit } from './store.js';
import { counterBottomViolation, escapeHtml, hasStateOutput, hasTransitionOutput, isAnyPDA, isCounterMachine, isEmbeddedMachine, isQueueAutomaton, isSingleTapeTM, isTwoStackPDA, parseEps, showStatus } from './utils.js';
import { isMultiTape, machineDeterminism, machineStoreLabels, transitionHasField } from './machines/index.js';
import { applyMachineSwitch } from './view.js';
import { viewEdgeKeyFor, viewStates } from './view-graph.js';
import { getBlock } from './blocks.js';
import { enhanceCustomSelect } from './dropdown.js';

// ══════════════════════════════════════════════════════════════════
//  STATE MANAGEMENT
// ══════════════════════════════════════════════════════════════════
export function newId() { return 's' + (++App.stateN); }
export function newTId() { return 't' + (++App.transN); }

// Re-exported so the many UI call sites that already import it from here
// keep working; the definition moved to the leaf that owns App.states.
export { getState };
// Indexed for the same reason getState is (see js/state.js): resolving a
// selection of two thousand ids by linear scan is four million comparisons, and
// syncSelectionClasses does exactly that after a select-all. Validated rather
// than invalidated — App.transitions is pushed to, filtered and reassigned from
// a dozen places, and none of them announces it.
let _tIdx = null, _tArr = null, _tLen = -1, _tFirst = null, _tLast = null;

function transitionIndex() {
  const arr = App.transitions || [];
  const n = arr.length;
  if (_tArr === arr && _tLen === n && _tFirst === arr[0] && _tLast === arr[n - 1]) return _tIdx;
  const map = new Map();
  for (let i = 0; i < n; i++) map.set(arr[i].id, arr[i]);
  _tIdx = map; _tArr = arr; _tLen = n; _tFirst = arr[0]; _tLast = arr[n - 1];
  return map;
}

export function getTransition(id) { return transitionIndex().get(id); }
export function getEdgeTransitions(from, to) { return App.transitions.filter(t => t.from === from && t.to === to); }

// At most one right-click popover is ever open: the two menus (#ctx for
// state/edge/note, #canvas-ctx for empty background) live in separate DOM
// nodes, so opening one must explicitly close the other — they don't share
// an element the way re-showing #ctx for a different target does.
export function showContextMenu(kind, x, y) {
  const m = $('ctx');
  if (!m) return;
  if (typeof hideCanvasContextMenu === 'function') hideCanvasContextMenu();
  m.dataset.mode = kind;
  m.style.display = 'block';
  // These are the menu's own dimensions, used to keep it inside the viewport.
  // They have to grow with the rows: every mode except `divider` now carries
  // the two StateMate items and a rule, and a stale height here means a menu
  // opened near the bottom of the screen quietly loses its last entries.
  const smRows = kind === 'divider' ? 0 : 66;
  const maxX = kind === 'edge' ? 260 : (kind === 'note' || kind === 'divider') ? 240 : kind === 'block' ? 250 : 220;
  const maxY = (kind === 'edge' ? 190 : kind === 'note' ? 240 : kind === 'divider' ? 210
    : kind === 'block' ? 200 : 150) + smRows;
  m.style.left = Math.max(8, Math.min(x, innerWidth - maxX)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - maxY)) + 'px';
}

export function hideContextMenu() {
  const m = $('ctx');
  if (m) m.style.display = 'none';
  App.ctxId = null;
  App.ctxEdge = null;
  App.ctxMode = null;
  App.ctxNoteId = null;
  App.ctxDividerId = null;
}

export function ensureSelectValue(sel, value) {
  if (!sel || value === undefined || value === null) return;
  const strValue = String(value);
  if (strValue === '') return;
  if (!sel.innerHTML.includes(`value="${strValue}"`)) {
    sel.innerHTML += `<option value="${strValue}">${strValue}</option>`;
  }
  sel.value = strValue;
}

export function setTransitionModalMode(mode) {
  const title = $('trans-modal-title');
  const confirmBtn = $('trans-confirm-btn');
  const isEdit = mode === 'edit';
  if (title) title.textContent = isEdit ? 'Edit Transition' : 'Add Transition';
  if (confirmBtn) confirmBtn.textContent = isEdit ? 'Save' : 'Add';
  // The picker over an edge's rules chooses the rule being edited, or — when
  // adding — the rule whose fields the new one starts from.
  const say = isEdit ? 'Editing' : 'Copy from';
  const lbl = $('m-trans-lbl');
  if (lbl) lbl.textContent = say;
  $('m-trans')?.closest?.('.custom-select')?.querySelector('.custom-select-trigger')?.setAttribute('aria-label', say);
}

export function buildTransitionPicker(transitions, selectedId) {
  const row = $('m-trans-row');
  const sel = $('m-trans');
  if (!row || !sel) return null;
  if (transitions.length <= 1) {
    row.style.display = 'none';
    sel.innerHTML = '';
    sel.onchange = null;
    return null;
  }
  row.style.display = '';
  sel.innerHTML = transitions.map((t, i) => `<option value="${t.id}">${i + 1}. ${transLabel(t)}</option>`).join('');
  sel.value = selectedId || transitions[0].id;
  return sel;
}

/**
 * The symbols a transition of this machine may read: the dialog's Read menu,
 * and what the label editor on the canvas accepts typed into the same slot.
 */
export function transitionSymbolChoices() {
  const cfg = getMachineConfig(App.machine);
  const { eps, any, blank } = App.config.sym;
  const markers = cfg.hasEndMarkers ? [App.config.sym.leftMarker, App.config.sym.rightMarker] : [];
  // A tape machine reads Γ, not Σ. The menu offered Σ ∪ {⊔} only, so every
  // work symbol the machine writes — the X of a crossing-off pass, and on a
  // multi-tape machine essentially the whole content of tapes 2..k — was a
  // symbol you could write and then had no way to select as a read. Σ stays
  // in the list because the input is written on the tape and reading it back
  // is the commonest rule there is.
  const tapeSyms = cfg.hasTape ? [...App.stackAlpha, blank] : [];
  return [...new Set([...(cfg.hasEpsilon ? [eps] : []), any, ...App.sigma, ...tapeSyms, ...markers])];
}

/**
 * What a reserved symbol means, for the menu that offers it. `Σ` alone in a
 * Read menu reads as "the alphabet", which is not something a head can read;
 * it is the wildcard. The value stays the bare symbol — only the words differ.
 */
function symbolMeaning(s) {
  const { eps, any, blank, leftMarker, rightMarker } = App.config.sym;
  if (s === eps) return 'nothing (ε-move)';
  if (s === any) return 'any symbol';
  if (s === blank) return 'blank cell';
  if (s === leftMarker) return 'left end';
  if (s === rightMarker) return 'right end';
  return '';
}

// `bare` drops the words: the multi-tape table's columns are too narrow to
// carry them, and says what the reserved symbols mean once, under the table.
function symbolOptions(syms, bare = false) {
  return syms.map(s => {
    const say = bare ? '' : symbolMeaning(s);
    return `<option value="${escapeHtml(s)}">${escapeHtml(s)}${say ? `  —  ${say}` : ''}</option>`;
  }).join('');
}

const DIR_GLYPH = { L: '←', R: '→', S: '•' };

/**
 * The strip of arrows standing in for a hidden direction select. `compact`
 * is arrows only, named by aria-label and tooltip — a table row per tape has
 * room for three glyphs, not three words.
 */
function dirSegmentHTML(selectId, compact = false) {
  // Laid out the way the arrows point — left, stay, right — whatever order
  // App.directions lists them in. A direction with no glyph goes last.
  const at = d => ({ L: 0, S: 1, R: 2 })[d.value] ?? 3;
  return [...App.directions].sort((a, b) => at(a) - at(b)).map(d => {
    const glyph = `<span class="seg-glyph" aria-hidden="true">${escapeHtml(DIR_GLYPH[d.value] ?? d.value)}</span>`;
    const name = escapeHtml(d.label);
    return `<button type="button" class="seg-btn dir-seg-btn" role="radio" aria-checked="false" tabindex="-1"
      data-for="${selectId}" data-dir="${escapeHtml(d.value)}"${compact ? ` aria-label="${name}" data-tip="${name}"` : ''}>${glyph}${compact ? '' : name}</button>`;
  }).join('');
}

/** Mirror a direction select's value onto its strip: checked state and roving tabindex. */
function syncDirSegment(selectId) {
  const sel = $(selectId);
  const seg = sel?.parentElement?.querySelector?.('.dir-seg');
  if (!sel || !seg) return;
  for (const btn of seg.querySelectorAll('.dir-seg-btn')) {
    const on = btn.dataset.dir === sel.value;
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
    btn.tabIndex = on ? 0 : -1;
    btn.classList.toggle('active', on);
  }
}

function setDirFromSegment(btn, focus = false) {
  const sel = $(btn.dataset.for);
  if (!sel) return;
  sel.value = btn.dataset.dir;
  syncDirSegment(btn.dataset.for);
  if (focus) btn.focus();
  updateTransPreview();
}

// One set of listeners on the dialog, for every strip it will ever hold —
// the multi-tape block is rebuilt per open, and its buttons with it.
function bindTransModal() {
  const modal = $('trans-modal');
  if (!modal || modal.__transBound) return;
  modal.__transBound = true;
  modal.addEventListener('input', updateTransPreview);
  modal.addEventListener('change', updateTransPreview);
  modal.addEventListener('click', e => {
    const btn = e.target?.closest?.('.dir-seg-btn');
    if (btn) setDirFromSegment(btn);
  });
  modal.addEventListener('keydown', e => {
    const btn = e.target?.closest?.('.dir-seg-btn');
    if (!btn) return;
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const all = [...btn.parentElement.querySelectorAll('.dir-seg-btn')];
    const next = all[(all.indexOf(btn) + step + all.length) % all.length];
    setDirFromSegment(next, true);
  });
}

/** A dialog's node for state `id`, carrying the marks the canvas would draw on it. */
function previewNodeFor(id, x, y) {
  const s = getState(id);
  const n = { id, name: s?.name ?? '?', x, y, start: App.startId === id, accept: acceptsAreShown() && App.accepts.has(id) };
  if (hasStateOutput(App.machine)) n.output = s?.output ?? '';
  if (usesParityPriorities(App.machine) && s) n.priority = statePriority(s);
  return n;
}

/**
 * Draw the edge the dialog is editing as the canvas will draw it: every rule
 * already on it, with this one in its place (or added at the end), and the
 * reverse edge when there is one, since it is what bends this one.
 */
export function updateTransPreview() {
  const svg = $('m-preview');
  if (!svg) return;
  let v;
  try { v = getTransitionFormValues(); } catch { return; }
  if (!v.from || !v.to) { svg.innerHTML = ''; return; }
  const editId = App.transEditId;
  const original = editId ? getTransition(editId) : null;
  // The rule as it will be saved: the form's fields over the stored ones, so a
  // hand-set bend or loop angle rides along while the pair is unchanged.
  const samePair = original && original.from === v.from && original.to === v.to;
  const draft = { ...(samePair ? original : {}), ...v, id: editId || '__draft' };
  const ts = [];
  let placed = false;
  for (const t of App.transitions) {
    if (t.from !== v.from || t.to !== v.to) continue;
    if (t.id === editId) { placed = true; ts.push(draft); } else ts.push(t);
  }
  if (!placed) ts.push(draft);
  const edges = [{ from: v.from, to: v.to, ts, focus: draft.id }];
  if (v.from !== v.to) {
    const back = App.transitions.filter(t => t.from === v.to && t.to === v.from && t.id !== editId);
    if (back.length) edges.push({ from: v.to, to: v.from, ts: back, context: true });
  }
  const span = v.from === v.to ? 0 : previewSpan(edges);
  const nodes = v.from === v.to
    ? [previewNodeFor(v.from, 0, 0)]
    : [previewNodeFor(v.from, 0, 0), previewNodeFor(v.to, span, 0)];
  drawEditPreview(svg, { nodes, edges });
  const fromName = getState(v.from)?.name ?? '?';
  const toName = getState(v.to)?.name ?? '?';
  svg.setAttribute('aria-label', `Preview: ${fromName} to ${toName} on ${transLabel(draft)}`);
}

export function populateTransitionModal(t) {
  const { eps, blank } = App.config.sym;
  const syms = transitionSymbolChoices();

  const fromSel = $('m-from');
  const toSel = $('m-to');
  // The states on screen, not every state in the machine. Inside a building
  // block the two are very different lists — a CPU is three thousand states —
  // and a From/To menu offering all of them is one you cannot find anything in.
  // Ports are derived rather than owned, so there is nothing there to wire to.
  // ensureSelectValue below still restores a value from outside the list, which
  // is what keeps editing an edge that crosses a boundary from losing its end.
  // Real states only. `viewStates()` also holds the block boxes and the scope's
  // ports, and neither is something a transition can end on: picking a box put
  // `to: "b1"` on a transition, where `b1` names no state the machine has — it
  // was saved to the file, counted in the Transitions δ list, and drawn nowhere,
  // because the projection has no endpoint to resolve. A state is the node kind
  // with no `kind` at all, which is the same test updateLPanel uses.
  const pickable = viewStates().filter(s => s.kind === undefined);
  const options = pickable.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  if (fromSel) {
    fromSel.innerHTML = options;
    if (t?.from) ensureSelectValue(fromSel, t.from);
  }
  if (toSel) {
    toSel.innerHTML = options;
    if (t?.to) ensureSelectValue(toSel, t.to);
  }

  const symSel = $('m-sym');
  if (symSel) {
    if (App.machine !== 'MTM') {
      symSel.innerHTML = symbolOptions(syms);
      if (t?.symbol !== undefined) ensureSelectValue(symSel, t.symbol);
    } else {
      symSel.innerHTML = '';
    }
  }

  // Which rows this dialog shows is exactly which fields the machine's
  // transitions carry, and the machine says which those are — the same
  // list the wizard asks its questions from and the StateMate dialect
  // validates against. Six predicates used to answer it here, and each
  // one was a place a new machine could be editable in the dialog but
  // undescribable to the model, or the other way round.
  const has = field => transitionHasField(App.machine, field);
  // A multi-tape machine reads one symbol per tape, so the single Read
  // row is replaced by the per-tape block rather than sitting above it.
  $('m-sym-row').style.display = has('tapeSyms') ? 'none' : '';
  $('m-pda-extra').style.display = has('pop') ? '' : 'none';
  $('m-tm-extra').style.display = has('move') ? '' : 'none';
  $('m-mealy-extra').style.display = has('out') ? '' : 'none';
  $('m-mtm-extra').style.display = has('tapeSyms') ? '' : 'none';
  const twoStackExtra = $('m-2pda-extra');
  if (twoStackExtra) twoStackExtra.style.display = has('pop2') ? '' : 'none';
  const epdaExtra = $('m-epda-extra');
  if (epdaExtra) epdaExtra.style.display = has('below') ? '' : 'none';
  const pfaExtra = $('m-pfa-extra');
  if (pfaExtra) pfaExtra.style.display = has('weight') ? '' : 'none';
  if (has('weight')) {
    const wIn = $('m-weight');
    if (wIn) wIn.value = t?.weight !== undefined ? String(t.weight) : '1';
  }
  // What this machine calls its store. A queue's ends are not a stack's,
  // and calling them push and pop would be technically true and useless.
  // (The wizard says the same thing at greater length in wizard-copy.js;
  // three-word labels for a form and a sentence with a hint are different
  // registers, not a duplicated fact.)
  // A two-way automaton's head reads and moves but never writes, so its one
  // row sits under "Head" — "Tape" over a lone Move promised a write row.
  const tapeTitle = $('m-tape-title');
  if (tapeTitle) tapeTitle.textContent = isReadOnlyHeadMachine(App.machine) ? 'Head' : 'Tape';
  // Output takes a heading of its own only when a section sits above it;
  // without one it read as the last row of the stack or the head (PDT, 2DFT).
  const outTitle = $('m-output-title');
  if (outTitle) outTitle.hidden = !(has('out') && (has('pop') || has('move')));
  const [storeTitle, popLabel, pushLabel] = machineStoreLabels(App.machine);
  if ($('m-memory-title')) $('m-memory-title').textContent = storeTitle;
  if ($('m-pop-label')) $('m-pop-label').textContent = popLabel;
  if ($('m-push-label')) $('m-push-label').textContent = pushLabel;

  if (has('out')) {
    const { lambda } = App.config.sym;
    const outs = [...new Set([...App.outputAlpha, lambda, ...(t?.output ? [t.output] : [])])];
    const outSel = $('m-output');
    if (outSel) {
      outSel.innerHTML = outs.map(o => `<option value="${o}">${o}</option>`).join('');
      ensureSelectValue(outSel, (t && t.output !== undefined && t.output !== '') ? t.output : lambda);
    }
  }

  if (has('move')) {
    const dirSel = $('m-dir');
    if (dirSel) {
      dirSel.innerHTML = App.directions.map(d => `<option value="${d.value}">${d.label} (${d.value})</option>`).join('');
      ensureSelectValue(dirSel, t?.dir || App.directions[0].value);
      const seg = dirSel.parentElement?.querySelector?.('.dir-seg');
      if (seg) seg.innerHTML = dirSegmentHTML('m-dir');
      syncDirSegment('m-dir');
    }
    const writeInput = $('m-write');
    const writeRow = writeInput && typeof writeInput.closest === 'function' ? writeInput.closest('.modal-row') : null;
    if (writeRow) writeRow.style.display = isReadOnlyHeadMachine(App.machine) ? 'none' : '';
  }

  if (has('tapeSyms')) {
    const k = App.tapeCount;
    const dirOpts = App.directions.map(d => `<option value="${escapeHtml(d.value)}">${escapeHtml(d.label)}</option>`).join('');
    const symOpts = symbolOptions(syms, true);
    const mtmExtra = $('m-mtm-extra');
    if (mtmExtra) {
      // One row per tape, read → write → move across it: the same order as
      // the label on the canvas. Three stacked rows per tape made a four-tape
      // rule twelve rows tall, with the edge's preview a scroll away.
      const rows = Array.from({ length: k }, (_, i) => `
        <span class="mtm-tape" aria-hidden="true">${i + 1}</span>
        <select class="sel" id="m-mtm-read-${i}" aria-label="Tape ${i + 1} read">${symOpts}</select>
        <input class="inp" id="m-mtm-write-${i}" placeholder="same" aria-label="Tape ${i + 1} write"
          autocomplete="off" onkeydown="trySymSuggestKeydown(event)" oninput="handleSymSuggestActive(this)"
          onfocus="handleSymSuggestActive(this)" onclick="refreshSymSuggest(this)"
          onkeyup="handleSymSuggestKeyup(this)" onblur="hideSymSuggest()">
        <div class="mtm-move"><select class="sel" id="m-mtm-dir-${i}" data-native-select hidden>${dirOpts}</select>
          <div class="seg seg-compact dir-seg" role="radiogroup" aria-label="Tape ${i + 1} move">${dirSegmentHTML(`m-mtm-dir-${i}`, true)}</div></div>
      `).join('');
      const legend = syms.map(s => [s, symbolMeaning(s)]).filter(([, say]) => say)
        .map(([s, say]) => `<span><b>${escapeHtml(s)}</b> ${escapeHtml(say)}</span>`).join('');
      mtmExtra.innerHTML = `
        <div class="edit-grid mtm-grid">
          <span class="edit-grid-head">Tape</span><span class="edit-grid-head">Read</span><span class="edit-grid-head">Write</span><span class="edit-grid-head">Move</span>
          ${rows}
        </div>
        ${legend ? `<div class="edit-legend">${legend}</div>` : ''}`;
    }
    for (let i = 0; i < k; i++) {
      ensureSelectValue($(`m-mtm-read-${i}`), t?.tapeSyms?.[i] ?? t?.symbol ?? blank);
      const writeEl = $(`m-mtm-write-${i}`);
      if (writeEl) writeEl.value = t?.tapeWrites?.[i] ?? t?.write ?? t?.symbol ?? blank;
      ensureSelectValue($(`m-mtm-dir-${i}`), t?.tapeDirs?.[i] ?? t?.dir ?? App.directions[0].value);
      syncDirSegment(`m-mtm-dir-${i}`);
    }
  } else {
    const pdaPop = $('m-pop');
    const pdaPush = $('m-push');
    if (pdaPop) pdaPop.value = t?.pop ?? eps;
    if (pdaPush) pdaPush.value = t?.push ?? eps;
    if (has('pop2')) {
      const pdaPop2 = $('m-pop2');
      const pdaPush2 = $('m-push2');
      if (pdaPop2) pdaPop2.value = t?.pop2 ?? eps;
      if (pdaPush2) pdaPush2.value = t?.push2 ?? eps;
    }
    if (has('below')) {
      const below = $('m-below');
      const above = $('m-above');
      if (below) below.value = t?.below ?? eps;
      if (above) above.value = t?.above ?? eps;
    }
    const tmWrite = $('m-write');
    if (tmWrite) tmWrite.value = isReadOnlyHeadMachine(App.machine) ? (t?.symbol ?? '') : (t?.write ?? t?.symbol ?? '');
  }

  const picker = $('m-trans');
  if (picker && t) picker.value = t.id;
  updateTransPreview();
}

// Reading the dialog back. Which fields to read is the same question as
// which rows were shown, so it is asked the same way.
export function getTransitionFormValues() {
  const cfg = getMachineConfig(App.machine);
  const { eps } = App.config.sym;
  const has = field => transitionHasField(App.machine, field);
  const values = {
    from: $('m-from')?.value,
    to: $('m-to')?.value,
    symbol: has('tapeSyms') ? null : $('m-sym')?.value
  };
  if (has('pop')) {
    values.pop = parseEps($('m-pop')?.value) || eps;
    values.push = parseEps($('m-push')?.value) || eps;
    if (has('pop2')) {
      values.pop2 = parseEps($('m-pop2')?.value) || eps;
      values.push2 = parseEps($('m-push2')?.value) || eps;
    }
    if (has('below')) {
      values.below = parseEps($('m-below')?.value) || eps;
      values.above = parseEps($('m-above')?.value) || eps;
    }
  }
  if (has('move')) {
    values.dir = $('m-dir')?.value || App.directions[0].value;
    values.write = isReadOnlyHeadMachine(App.machine)
      ? values.symbol
      : (parseEps($('m-write')?.value) || values.symbol);
  }
  if (has('out')) {
    const out = $('m-output')?.value?.trim() || App.config.sym.lambda;
    values.output = out === App.config.sym.lambda ? '' : out;
  }
  if (has('weight')) {
    const raw = $('m-weight')?.value?.trim();
    values.weight = raw === '' || raw === undefined ? 1 : Number(raw);
  }
  if (has('tapeSyms')) {
    const k = App.tapeCount;
    const blank = App.config.sym.blank;
    values.tapeSyms = Array.from({ length: k }, (_, i) => $(`m-mtm-read-${i}`)?.value || blank);
    values.tapeWrites = Array.from({ length: k }, (_, i) => parseEps($(`m-mtm-write-${i}`)?.value) || blank);
    values.tapeDirs = Array.from({ length: k }, (_, i) => $(`m-mtm-dir-${i}`)?.value || App.directions[0].value);
    values.symbol = values.tapeSyms[0];
  }
  return values;
}

export function createState(x, y, name) {
  snapshot();
  const id = newId();
  const s = { id, x, y, name: name || `${App.config.statePrefix}${App.stateN - 1}` };
  App.states.push(s);
  if (!App.startId) App.startId = id;
  emit(Change.GRAPH);
  return s;
}
export function deleteState(id) {
  snapshot();
  // Resolve any notes anchored to this state (or edges through it) while it's
  // still live — renderAll()'s prune pass runs after the array mutation below
  // and can no longer recover the note's pre-deletion position.
  const orphanedTransIds = App.transitions.filter(t => t.from === id || t.to === id).map(t => t.id);
  if (typeof pruneNoteAnchorsExcluding === 'function') pruneNoteAnchorsExcluding([id], orphanedTransIds);
  App.states = App.states.filter(s => s.id !== id);
  App.transitions = App.transitions.filter(t => t.from !== id && t.to !== id);
  App.accepts.delete(id);
  if (App.startId === id) App.startId = App.states[0]?.id || null;
  emit(Change.GRAPH);
}
// ══════════════════════════════════════════════════════════════════
//  TRANSITIONS
// ══════════════════════════════════════════════════════════════════
export function openTransModal(from, to, opts = {}) {
  const mode = opts.mode === 'edit' ? 'edit' : 'add';
  const groupTransitions = opts.transitions || getEdgeTransitions(from, to);
  const selectedId = mode === 'edit'
    ? (opts.transId || groupTransitions[0]?.id || null)
    : (opts.seedId || groupTransitions[0]?.id || null);
  const selectedTrans = selectedId ? getTransition(selectedId) : null;

  App._pendFrom = from;
  App._pendTo = to;
  App.transModalMode = mode;
  App.transModalIds = groupTransitions.map(t => t.id);
  App.transEditId = mode === 'edit' ? selectedId : null;

  setTransitionModalMode(mode);
  buildTransitionPicker(groupTransitions, selectedId);
  const picker = $('m-trans');
  if (picker) {
    picker.onchange = () => {
      const next = getTransition(picker.value);
      if (!next) return;
      if (App.transModalMode === 'edit') App.transEditId = next.id;
      populateTransitionModal(next);
    };
  }

  populateTransitionModal(selectedTrans);
  // Always pre-select From/To to match the states the user clicked,
  // even when there's no existing transition to seed from (t was null).
  const fromSel = $('m-from');
  const toSel = $('m-to');
  if (fromSel && from) ensureSelectValue(fromSel, from);
  if (toSel && to) ensureSelectValue(toSel, to);
  // A symbol the caller already knows — an empty cell of the δ table is a
  // (state, symbol) pair asking for a rule, and the reader should not have to
  // pick the column's symbol again from a list.
  const symSel = $('m-sym');
  if (symSel && opts.symbol !== undefined) ensureSelectValue(symSel, opts.symbol);
  bindTransModal();
  updateTransPreview();
  showOverlay('trans-modal');
}
export function confirmTrans() {
  const result = saveTransition(getTransitionFormValues(), App.transEditId);
  if (!result.ok && !result.gone) { showStatus(result.error); return; }
  closeModal('trans-modal');
  App.transFrom = null; clearTempLine();
}

/**
 * Checks a transition against the machine and, if it passes, saves it as one
 * undoable edit — a new one, or `editId` rewritten in place.
 *
 * The dialog and the label editor on the canvas both come through here, so a
 * rule one of them enforces cannot be missing from the other. Nothing here
 * reads the DOM: `values` has the shape getTransitionFormValues() returns,
 * wherever it was read from.
 *
 * Returns `{ ok: true, id }`, or `{ ok: false, error }` with a sentence for the
 * reader. `gone` marks the one failure that is not the reader's: the
 * transition being edited was deleted while its editor was open.
 */
export function saveTransition(values, editId = null) {
  const cfg = getMachineConfig(App.machine);
  const { eps } = App.config.sym;
  const from = values.from, to = values.to, sym = values.symbol;
  const fail = error => ({ ok: false, error });
  // First, so a deleted transition is not reported as clashing with itself.
  if (editId && !getTransition(editId)) return { ok: false, gone: true, error: 'That transition no longer exists.' };

  if (!cfg.hasEpsilon && sym === eps) {
    return fail(`${App.machine} cannot have epsilon-transitions.`);
  }
  if (cfg.hasEndMarkers && isBoundarySymbol(sym)) {
    const { leftMarker, rightMarker } = App.config.sym;
    if (sym === leftMarker && values.dir === 'L') {
      return fail(`${App.machine} cannot move left of the left boundary marker.`);
    }
    if (sym === rightMarker && values.dir === 'R') {
      return fail(`${App.machine} cannot move right of the right boundary marker.`);
    }
    if (App.machine === 'LBA' && values.write !== sym) {
      return fail('LBA boundary markers are fixed and must be preserved on write.');
    }
  }
  // Determinism, enforced by the machine's own rule. What counts as a
  // clash differs — equality for a DFA, symbol overlap for a tape head or
  // a D-type ω-automaton, a whole store configuration for a DPDA, a read
  // tuple for an MTM — and so does what the reader should be told to do
  // about it, so both live with the machine. A machine that returns no
  // rule is one where a second edge is a branch, not a mistake.
  const rule = machineDeterminism(App.machine);
  if (rule) {
    const conflict = rule.conflict({ ...values, from, symbol: sym }, editId);
    if (conflict) { return fail(rule.say({ ...values, from, symbol: sym }, conflict)); }
  }
  if (isWeightedFA(App.machine)) {
    const w = values.weight;
    if (!Number.isFinite(w) || w < 0 || w > 1) {
      return fail('PFA transition probability must be a number between 0 and 1.');
    }
  }
  if (isAnyPDA(App.machine)) {
    const isExplicit = App.config.pdaParadigm === 'explicit';
    if (!values.pop || values.pop.trim() === '') values.pop = eps;
    if (isExplicit && values.pop === eps) {
      // Allow epsilon pops for 7-tuple PDAs although formal definition requires exactly one symbol
    }
    if (values.pop.length > 1 && values.pop !== App.config.sym.any) {
      return fail(`${App.machine} pop must be exactly one symbol.`);
    }
    const stackAllowed = new Set([...App.stackAlpha, App.config.sym.stackBottom, App.config.sym.any]);
    if (values.pop !== eps && !stackAllowed.has(values.pop)) {
      return fail(`Symbol '${values.pop}' is not in your Stack Alphabet (Γ). Add it in the left panel first.`);
    }
    if (values.push && values.push !== eps && values.push !== App.config.sym.any) {
      const invalidChars = values.push.split('').filter(c => !stackAllowed.has(c));
      if (invalidChars.length > 0) {
        return fail(`Push string contains symbols not in Stack Alphabet (Γ): ${invalidChars.join(', ')}. Add them first.`);
      }
    }

    if (isTwoStackPDA(App.machine)) {
      if (!values.pop2 || values.pop2.trim() === '') values.pop2 = eps;
      if (values.pop2.length > 1 && values.pop2 !== App.config.sym.any) {
        return fail(`${App.machine} pop₂ must be exactly one symbol.`);
      }
      if (values.pop2 !== eps && !stackAllowed.has(values.pop2)) {
        return fail(`Symbol '${values.pop2}' is not in your Stack Alphabet (Γ). Add it in the left panel first.`);
      }
      if (values.push2 && values.push2 !== eps && values.push2 !== App.config.sym.any) {
        const invalidChars2 = values.push2.split('').filter(c => !stackAllowed.has(c));
        if (invalidChars2.length > 0) {
          return fail(`Push₂ string contains symbols not in Stack Alphabet (Γ): ${invalidChars2.join(', ')}. Add them first.`);
        }
      }
    }

    if (isCounterMachine(App.machine)) {
      const bottom = App.config.sym.stackBottom;
      const counterSym = [...App.stackAlpha].find(symEl => symEl !== bottom) || '1';
      const counterAllowed = new Set([eps, bottom, counterSym, App.config.sym.any]);
      if (!counterAllowed.has(values.pop)) {
        return fail(`Counter Automaton pop must use only '${counterSym}', '${bottom}', '${App.config.sym.any}', or ε.`);
      }
      if (values.push && values.push !== eps && values.push !== App.config.sym.any) {
        const invalidCounterPush = values.push.split('').filter(c => c !== counterSym && c !== bottom);
        if (invalidCounterPush.length > 0) {
          return fail(`Counter Automaton push may only use '${counterSym}' (and optional '${bottom}'). Invalid: ${invalidCounterPush.join(', ')}.`);
        }
      }
      const bottomIssue = counterBottomViolation(values.pop, values.push);
      if (bottomIssue) {
        return fail(`Counter Automaton push ${bottomIssue} — '${bottom}' marks zero, so it stays at the bottom.`);
      }
    }
  }
  snapshot();
  let savedId = editId;
  if (editId) {
    const t = getTransition(editId);
    t.from = from;
    t.to = to;
    t.symbol = sym;
    // `from` changed in place, which the δ index cannot see for itself.
    invalidateTransitionIndex();
    // Which fields a saved transition carries is the same question as which
    // rows the dialog showed, so it is asked the same way. It used to be asked
    // with the family predicates instead, which is the one thing that could not
    // survive a second family with a store: an EPDA is not `isAnyPDA`, so its
    // pop and push were deleted on every save — the dialog offered them, took
    // them, and dropped them.
    const keeps = field => transitionHasField(App.machine, field);
    if (keeps('pop')) {
      t.pop = values.pop;
      t.push = values.push;
    } else {
      delete t.pop;
      delete t.push;
    }
    if (keeps('pop2')) {
      t.pop2 = values.pop2;
      t.push2 = values.push2;
    } else {
      delete t.pop2;
      delete t.push2;
    }
    if (keeps('below')) {
      t.below = values.below;
      t.above = values.above;
    } else {
      delete t.below;
      delete t.above;
    }
    if (isSingleTapeTM(App.machine)) {
      // A two-way automaton's head moves but never writes, so `write` is
      // asked of the machine rather than implied by the head: saving a 2DFA
      // rule unchanged used to add a `write` it does not have to the file.
      if (keeps('write')) t.write = values.write;
      else delete t.write;
      t.dir = values.dir;
    } else {
      delete t.write;
      delete t.dir;
    }
    if (hasTransitionOutput(App.machine)) {
      t.output = values.output;
    } else {
      delete t.output;
    }
    if (isWeightedFA(App.machine)) {
      t.weight = values.weight;
    } else {
      delete t.weight;
    }
    if (isMultiTape(App.machine)) {
      t.tapeSyms = values.tapeSyms;
      t.tapeWrites = values.tapeWrites;
      t.tapeDirs = values.tapeDirs;
      t.symbol = values.symbol;
    } else {
      delete t.tapeSyms;
      delete t.tapeWrites;
      delete t.tapeDirs;
    }
  } else {
    const t = { id: newTId(), from, to, symbol: sym };
    const takes = field => transitionHasField(App.machine, field);
    if (takes('pop')) { t.pop = values.pop; t.push = values.push; }
    if (takes('pop2')) { t.pop2 = values.pop2; t.push2 = values.push2; }
    if (takes('below')) { t.below = values.below; t.above = values.above; }
    if (isSingleTapeTM(App.machine)) {
      if (takes('write')) t.write = values.write;
      t.dir = values.dir;
    }
    if (hasTransitionOutput(App.machine)) { t.output = values.output; }
    if (isWeightedFA(App.machine)) { t.weight = values.weight; }
    if (isMultiTape(App.machine)) {
      t.tapeSyms = values.tapeSyms;
      t.tapeWrites = values.tapeWrites;
      t.tapeDirs = values.tapeDirs;
      t.symbol = values.symbol;
    }
    App.transitions.push(t);
    savedId = t.id;
  }
  emit(Change.GRAPH);
  return { ok: true, id: savedId };
}
// The Transitions δ list's pencil, and its double-click. It resolves the edge
// the transition sits on and opens the editor with that transition selected —
// the same route ctxEditTrans takes from the canvas context menu, so the list
// and the diagram open the same dialog on the same row. openTransModal fills
// the picker from getEdgeTransitions(), so a parallel edge is still reachable
// from the dialog once it is open.
export function editTransFromList(id) {
  const t = getTransition(id);
  if (!t) return;
  openTransModal(t.from, t.to, { mode: 'edit', transId: id });
}

export function deleteTrans(id) {
  snapshot();
  if (typeof pruneNoteAnchorsExcluding === 'function') pruneNoteAnchorsExcluding([], [id]);
  App.transitions = App.transitions.filter(t => t.id !== id);
  emit(Change.GRAPH);
}
export function deleteTransitions(ids) {
  const removeIds = new Set(ids);
  if (!removeIds.size) return;
  snapshot();
  if (typeof pruneNoteAnchorsExcluding === 'function') pruneNoteAnchorsExcluding([], ids);
  App.transitions = App.transitions.filter(t => !removeIds.has(t.id));
  emit(Change.GRAPH);
}
// The emitted symbol is a suffix rather than a separate branch: a PDT edge is a
// PDA edge that also prints, and a 2DFT edge is a 2DFA edge that also prints, so
// each keeps its family's label and appends "/ out".
export function outputSuffix(t) {
  if (!hasTransitionOutput(App.machine)) return '';
  const o = t.output !== undefined && t.output !== '' ? t.output : App.config.sym.lambda;
  return ` / ${o}`;
}

export function formatWeight(w) {
  const n = Number(w);
  if (!Number.isFinite(n)) return '1';
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

function outputValue(t) {
  return t.output !== undefined && t.output !== '' ? t.output : App.config.sym.lambda;
}

function moveText(dir) {
  return dir === 'R' ? 'move R' : dir === 'L' ? 'move L' : dir === 'S' ? 'stay' : `move ${dir}`;
}

function moveDescription(dir) {
  return dir === 'R' ? 'Move right' : dir === 'L' ? 'Move left' : dir === 'S' ? 'Stay here' : `Move ${dir}`;
}

function actionValue(action, value, beginner) {
  if (!beginner) return `${action} ${value}`;
  if (value === App.config.sym.eps || value === App.config.sym.lambda || value === '') {
    return action === 'pop' ? 'Remove nothing' : action === 'push' ? 'Add nothing' : `${action} nothing`;
  }
  return `${action} ${value}`;
}

// Semantic label data is independent of SVG. The canvas can render these as
// pills while compact labels, panels and exports keep using transLabel().
export function transLabelParts(t, beginner = false) {
  const input = { role: 'input', text: beginner ? `Read ${t.symbol}` : String(t.symbol) };
  if (isWeightedFA(App.machine)) {
    const weight = formatWeight(t.weight ?? 1);
    const probability = Number(weight);
    return [input, { role: 'weight', text: beginner && Number.isFinite(probability) ? `Probability ${formatWeight(probability * 100)}%` : `p ${weight}` }];
  }
  if (isAnyPDA(App.machine)) {
    if (isTwoStackPDA(App.machine)) {
      if (beginner) {
        return [
          input,
          { role: 'memory-read', text: `Stack 1: replace ${t.pop} with ${t.push}` },
          { role: 'memory-write', text: `Stack 2: replace ${t.pop2 ?? App.config.sym.eps} with ${t.push2 ?? App.config.sym.eps}` }
        ];
      }
      return [
        input,
        { role: 'memory-read', text: `S1 ${t.pop}→${t.push}` },
        { role: 'memory-write', text: `S2 ${t.pop2 ?? App.config.sym.eps}→${t.push2 ?? App.config.sym.eps}` }
      ];
    }
    const parts = isQueueAutomaton(App.machine)
      ? [input,
        { role: 'memory-read', text: beginner ? `Remove ${t.pop} from front` : `deq ${t.pop}` },
        { role: 'memory-write', text: beginner ? `Add ${t.push} to rear` : `enq ${t.push}` }]
      : isCounterMachine(App.machine)
        ? [input,
          { role: 'memory-read', text: beginner ? `Check counter: ${t.pop}` : `test ${t.pop}` },
          { role: 'memory-write', text: beginner ? `Change counter to ${t.push}` : `set ${t.push}` }]
        : [input,
          { role: 'memory-read', text: beginner ? `${actionValue('pop', t.pop, true)} from stack` : `pop ${t.pop}` },
          { role: 'memory-write', text: beginner ? `${actionValue('push', t.push, true)} to stack` : `push ${t.push}` }];
    if (hasTransitionOutput(App.machine)) parts.push({ role: 'output', text: beginner ? `Output ${outputValue(t)}` : `out ${outputValue(t)}` });
    return parts;
  }
  if (isReadOnlyHeadMachine(App.machine)) {
    const parts = [input, { role: 'move', text: beginner ? moveDescription(t.dir) : moveText(t.dir) }];
    if (hasTransitionOutput(App.machine)) parts.push({ role: 'output', text: beginner ? `Output ${outputValue(t)}` : `out ${outputValue(t)}` });
    return parts;
  }
  if (isSingleTapeTM(App.machine)) {
    return [input, { role: 'write', text: `${beginner ? 'Write' : 'write'} ${t.write}` }, { role: 'move', text: beginner ? moveDescription(t.dir) : moveText(t.dir) }];
  }
  if (isMultiTape(App.machine)) {
    const syms = t.tapeSyms || [t.symbol];
    const writes = t.tapeWrites || [t.write || t.symbol];
    const defDir = App.directions[0].value;
    const dirs = t.tapeDirs || [t.dir || defDir];
    return syms.map((s, i) => ({
      role: 'tape',
      text: beginner
        ? `Tape ${i + 1}: read ${s}, write ${writes[i] ?? s}, ${moveDescription(dirs[i] ?? defDir).toLowerCase()}`
        : `T${i + 1} ${s}→${writes[i] ?? s} ${dirs[i] ?? defDir}`
    }));
  }
  if (hasTransitionOutput(App.machine)) {
    return [input, { role: 'output', text: beginner ? `Output ${outputValue(t)}` : `out ${outputValue(t)}` }];
  }
  return [input];
}

// The EPDA is tested before the pushdown family. It is not `isAnyPDA` — it is
// its own family — but it carries `pop`/`push`, so a reader who moved it
// under that branch would get a plain pushdown label and lose the part that
// says what the move does to the stacks around the top one.
function embeddedLabel(t) {
  const eps = App.config.sym.eps;
  const extra = [];
  if (t.below && t.below !== eps) extra.push(`▼${t.below}`);
  if (t.above && t.above !== eps) extra.push(`▲${t.above}`);
  return `${t.symbol}, ${t.pop || eps} → ${t.push || eps}${extra.length ? ' · ' + extra.join(' ') : ''}`;
}

export function transLabel(t) {
  if (isWeightedFA(App.machine)) return `${t.symbol} : ${formatWeight(t.weight ?? 1)}`;
  if (isEmbeddedMachine(App.machine)) return embeddedLabel(t);
  if (isAnyPDA(App.machine)) {
    if (isTwoStackPDA(App.machine)) {
      return `${t.symbol}, (${t.pop}, ${t.pop2 ?? App.config.sym.eps}) → (${t.push}, ${t.push2 ?? App.config.sym.eps})${outputSuffix(t)}`;
    }
    if (isQueueAutomaton(App.machine)) return `${t.symbol}, deq ${t.pop} → enq ${t.push}`;
    if (isCounterMachine(App.machine)) return `${t.symbol}, test ${t.pop} → set ${t.push}`;
    return `${t.symbol}, ${t.pop} → ${t.push}${outputSuffix(t)}`;
  }
  if (isReadOnlyHeadMachine(App.machine)) return `${t.symbol}, ${t.dir}${outputSuffix(t)}`;
  if (isSingleTapeTM(App.machine)) return `${t.symbol} → ${t.write}, ${t.dir}`;
  if (hasTransitionOutput(App.machine)) return `${t.symbol} / ${t.output !== undefined && t.output !== '' ? t.output : App.config.sym.lambda}`;
  if (isMultiTape(App.machine)) {
    const syms = t.tapeSyms || [t.symbol];
    const writes = t.tapeWrites || [t.write || t.symbol];
    const defDir = App.directions[0].value;
    const dirs = t.tapeDirs || [t.dir || defDir];
    return syms.map((s, i) => `${s} → ${writes[i] ?? s}, ${dirs[i] ?? defDir}`).join(' | ');
  }
  return t.symbol;
}

export function transLabelDescriptive(t) {
  const dirMap = { 'R': 'Right', 'L': 'Left', 'S': 'Stay' };
  if (isEmbeddedMachine(App.machine)) {
    const eps = App.config.sym.eps;
    const parts = [`Read '${t.symbol}'`, `Pop '${t.pop || eps}'`, `Push '${t.push || eps}'`];
    if (t.below && t.below !== eps) parts.push(`Insert '${t.below}' below`);
    if (t.above && t.above !== eps) parts.push(`Insert '${t.above}' above`);
    return parts.join(', ');
  }
  const printPart = hasTransitionOutput(App.machine)
    ? `, Print '${t.output !== undefined && t.output !== '' ? t.output : App.config.sym.lambda}'`
    : '';
  if (isWeightedFA(App.machine)) {
    return `Read '${t.symbol}' with probability ${formatWeight(t.weight ?? 1)}`;
  }
  if (isAnyPDA(App.machine)) {
    if (isTwoStackPDA(App.machine)) {
      return `Read '${t.symbol}', Pop₁ '${t.pop}', Push₁ '${t.push}', Pop₂ '${t.pop2 ?? App.config.sym.eps}', Push₂ '${t.push2 ?? App.config.sym.eps}'${printPart}`;
    }
    if (isQueueAutomaton(App.machine)) {
      return `Read '${t.symbol}', Dequeue '${t.pop}', Enqueue '${t.push}'`;
    }
    if (isCounterMachine(App.machine)) {
      return `Read '${t.symbol}', Test '${t.pop}', Update counter to '${t.push}'`;
    }
    return `Read '${t.symbol}', Pop '${t.pop}', Push '${t.push}'${printPart}`;
  }
  if (isReadOnlyHeadMachine(App.machine)) {
    return `Read '${t.symbol}', Move ${dirMap[t.dir] || t.dir}${printPart}`;
  }
  if (isSingleTapeTM(App.machine)) {
    return `Read '${t.symbol}', Write '${t.write}', Move ${dirMap[t.dir] || t.dir}`;
  }
  if (hasTransitionOutput(App.machine)) {
    const o = t.output !== undefined && t.output !== '' ? t.output : App.config.sym.lambda;
    return `Read '${t.symbol}', Print '${o}'`;
  }
  if (isMultiTape(App.machine)) {
    const syms = t.tapeSyms || [t.symbol];
    const writes = t.tapeWrites || [t.write || t.symbol];
    const defDir = App.directions[0].value;
    const dirs = t.tapeDirs || [t.dir || defDir];
    return syms.map((s, i) => `Tape ${i + 1}: Read '${s}', Write '${writes[i] ?? s}', Move ${dirMap[dirs[i] ?? defDir] || (dirs[i] ?? defDir)}`).join(' | ');
  }
  return `Read '${t.symbol}'`;
}

// A ceiling on the *assembled* tooltip, and the only one.
//
// It used to be two caps — a transition count and a tape count — and they were
// wrong twice over. They multiplied, so five transitions on a twelve-tape
// machine was still seventy-one rows; and worse, what they trimmed was simply
// gone. A tooltip that says "+5 more" and offers no way to reach them is a
// worse answer than a long tooltip, because the reader can see that something
// is being withheld and has nothing to do about it. On a large machine, where
// the edge labels are not drawn at all, those five may be the whole reason the
// edge was hovered.
//
// So the content is whole and the *box* is what is bounded: js/tooltip.js gives
// it a max-height and makes it scrollable and hoverable when it overflows. This
// number only exists so that a pathological edge cannot build an unbounded grid
// on hover — it is far past anything a reader will meet, and when it does trim
// it says so.
const TIP_MAX_ROWS = 120;

/**
 * The same description as transLabelDescriptive, laid out in columns.
 *
 * Rows are separated by \n and cells within a row by \t; js/tooltip.js turns
 * that into a grid, and a row with one cell spans the whole width. It is a
 * string rather than a structure because it travels through `data-tip`, which
 * is an attribute — so every existing tooltip keeps working and this is a
 * richer thing to put in one, not a second tooltip system.
 *
 * Prose stays the accessible name. A screen reader should hear "Read a, write
 * b, move right", not a table read left to right, and the two forms are
 * deliberately generated side by side so neither can quietly stop matching.
 *
 * The branch order mirrors transLabelDescriptive's exactly, and has to: the
 * family predicates overlap (isAnyPDA includes PDT, isMultiTape is reached only
 * after the single-tape test), so a reordered copy is a copy that disagrees.
 *
 * Values are unquoted here. In prose the quotes are what separate a symbol from
 * the sentence around it; in a table the column already does that, and on a
 * five-tape machine fifteen pairs of quotes are the difference between a table
 * you scan and one you read.
 */
export function transTipRows(t) {
  const dirMap = { 'R': 'Right', 'L': 'Left', 'S': 'Stay' };
  const dirName = d => dirMap[d] || d;
  const rows = [];
  const add = (k, v) => rows.push(`${k}\t${v}`);
  const printRow = () => {
    if (!hasTransitionOutput(App.machine)) return;
    add('Print', t.output !== undefined && t.output !== '' ? t.output : App.config.sym.lambda);
  };

  if (isWeightedFA(App.machine)) {
    add('Read', t.symbol);
    add('Probability', formatWeight(t.weight ?? 1));
    return rows.join('\n');
  }
  if (isEmbeddedMachine(App.machine)) {
    const eps = App.config.sym.eps;
    add('Read', t.symbol);
    add('Top stack', `pop ${t.pop || eps}\tpush ${t.push || eps}`);
    add('Below', t.below || eps);
    add('Above', t.above || eps);
    return rows.join('\n');
  }
  if (isAnyPDA(App.machine)) {
    add('Read', t.symbol);
    if (isTwoStackPDA(App.machine)) {
      const eps = App.config.sym.eps;
      add('Stack 1', `pop ${t.pop}\tpush ${t.push}`);
      add('Stack 2', `pop ${t.pop2 ?? eps}\tpush ${t.push2 ?? eps}`);
    } else if (isQueueAutomaton(App.machine)) {
      add('Dequeue', t.pop);
      add('Enqueue', t.push);
    } else if (isCounterMachine(App.machine)) {
      add('Test', t.pop);
      add('Counter', t.push);
    } else {
      add('Pop', t.pop);
      add('Push', t.push);
    }
    printRow();
    return rows.join('\n');
  }
  if (isReadOnlyHeadMachine(App.machine)) {
    add('Read', t.symbol);
    add('Move', dirName(t.dir));
    printRow();
    return rows.join('\n');
  }
  if (isSingleTapeTM(App.machine)) {
    add('Read', t.symbol);
    add('Write', t.write);
    add('Move', dirName(t.dir));
    return rows.join('\n');
  }
  if (hasTransitionOutput(App.machine)) {
    add('Read', t.symbol);
    printRow();
    return rows.join('\n');
  }
  if (isMultiTape(App.machine)) {
    // The one machine that earns a real table: five tapes as a sentence is the
    // wall of text this exists to replace.
    const syms = t.tapeSyms || [t.symbol];
    const writes = t.tapeWrites || [t.write || t.symbol];
    const defDir = App.directions[0].value;
    const dirs = t.tapeDirs || [t.dir || defDir];
    rows.push('Tape\tRead\tWrite\tMove');

    syms.forEach((sym, i) => {
      rows.push(`${i + 1}\t${sym}\t${writes[i] ?? sym}\t${dirName(dirs[i] ?? defDir)}`);
    });
    return rows.join('\n');
  }
  add('Read', t.symbol);
  return rows.join('\n');
}

/**
 * The tooltip for a whole edge: which edge it is, then what each of its
 * transitions does.
 *
 * The header is not decoration. With the large-machine profile on, the edge
 * labels are not drawn at all, so hovering is how a transition is read — and an
 * unlabelled arrow among a thousand others needs to say which two states it
 * joins before it says anything else.
 */
export function edgeTipFor(ts) {
  if (!ts || !ts.length) return '';
  // The heading names the *drawn* endpoints, not the transition's own. An edge
  // that crosses into a block is drawn between a state and a box, and a box is
  // not something getState can answer for — so `s5|b1` came out with no heading
  // at all, which is the one thing an unlabelled arrow among a thousand others
  // needs to say first. viewEdgeKeyFor is how the model's endpoints are
  // resolved to the pair actually on screen; a transition in no drawn group
  // (an edge wholly inside a collapsed block) falls back to its own ends.
  const [dFrom, dTo] = (viewEdgeKeyFor(ts[0].id) || `${ts[0].from}|${ts[0].to}`).split('|');
  const from = endName(dFrom), to = endName(dTo);
  const head = from && to
    ? (dFrom === dTo ? `${from} ↺` : `${from} → ${to}`)
    : null;
  // '---' is a rule spanning the grid. Between transitions it is what says
  // "this is a second rule on the same arrow" rather than more of the first.
  const rows = head ? [head, '---'] : [];
  // What the box hides. Several transitions collapse onto one arrow when an
  // endpoint is a block, and from outside they are indistinguishable — an edge
  // into the block's declared entry and one that bypasses it into the middle of
  // the sub-machine draw as the same arrow. The group already holds both, so
  // saying which is which costs a row rather than a channel.
  const crossing = boundaryNote(ts, dFrom, dTo);
  if (crossing) rows.push(crossing, '---');
  let drawn = 0;
  for (const t of ts) {
    const block = transTipRows(t);
    if (!block) continue;
    const lines = block.split('\n');
    // The first block goes in whatever it costs — a tooltip showing no
    // transition at all would be worse than a tall one. After that the
    // ceiling applies, rule included.
    if (drawn && rows.length + 1 + lines.length > TIP_MAX_ROWS) break;
    if (drawn) rows.push('---');
    rows.push(...lines);
    drawn++;
  }
  if (ts.length > drawn) rows.push(`+${ts.length - drawn} more on this edge`);
  return rows.join('\n');
}

/** A drawn endpoint's name: a state's, or the box standing in for one. */
function endName(id) {
  const s = getState(id);
  if (s) return s.name;
  const b = getBlock(id);
  return b ? b.name : null;
}

/**
 * How the transitions on one arrow meet a block's boundary.
 *
 * Only when an endpoint is a box, because that is the only case where the
 * drawn arrow is fewer things than the machine has. `entry` and `exits` are
 * what the block *declares*; anything else crossing the same boundary is a
 * wire into or out of the middle of a sub-machine, which is exactly what stops
 * a block being reusable — a copy of it placed elsewhere would have that wire
 * dangling off a state its definition never mentioned.
 */
function boundaryNote(ts, drawnFrom, drawnTo) {
  const rows = [];
  const say = (id, pick, what) => {
    const b = getBlock(id);
    if (!b) return;
    const declared = new Set(what === 'in' ? [b.entry] : (b.exits || []).map(e => e.id));
    const stray = ts.filter(t => !declared.has(pick(t)));
    const n = ts.length;
    const noun = `${n} transition${n === 1 ? '' : 's'}`;
    if (!stray.length) {
      rows.push(what === 'in'
        ? `${noun}, all through ${b.name}'s entry`
        : `${noun}, all from ${b.name}'s declared exits`);
      return;
    }
    const names = [...new Set(stray.map(t => getState(pick(t))?.name).filter(Boolean))];
    rows.push(what === 'in'
      ? `${noun}, ${stray.length} not through ${b.name}'s entry: ${names.join(', ')}`
      : `${noun}, ${stray.length} not from a declared exit of ${b.name}: ${names.join(', ')}`);
  };
  say(drawnTo, t => t.to, 'in');
  say(drawnFrom, t => t.from, 'out');
  return rows.join('\n');
}

// ══════════════════════════════════════════════════════════════════
//  STATE MODAL / CTX
// ══════════════════════════════════════════════════════════════════
export function openStateModal(id) {
  App.editId = id;
  const s = getState(id); if (!s) return;
  $('s-name').value = s.name;
  const hint = $('s-name-hint');
  if (hint) {
    hint.innerHTML = wrapStateLabelsOn()
      ? 'Use <code>_</code>, space or <code>-</code> to break long names onto multiple lines inside the node.'
      : 'Long names will overflow the node — enable "Wrap Long State Labels" in Settings → Diagram to break them at <code>_</code>, space or <code>-</code>.';
  }
  $('s-start').checked = isConceptualStart(id);
  // The option, not the checkbox's parent: that used to be the switch's own
  // <label>, so hiding it left the word "Accept" standing beside nothing.
  // Under parity, α is the number rather than the ring — F carries no meaning,
  // so offering Accepting would invite a mode that does nothing.
  const cfg = getMachineConfig(App.machine);
  const parity = usesParityPriorities(App.machine);
  const accOpt = $('s-acc-opt');
  if (accOpt) accOpt.style.display = parity || (cfg.isTransducer && !App.config.transducerAccepts) ? 'none' : '';
  $('s-acc').checked = App.accepts.has(id);
  const parityExtra = $('s-parity-extra');
  if (parityExtra) parityExtra.style.display = parity ? '' : 'none';
  if (parity) $('s-priority').value = String(statePriority(s));
  const mooreExtra = $('s-moore-extra');
  mooreExtra.style.display = hasStateOutput(App.machine) ? '' : 'none';
  if (hasStateOutput(App.machine)) {
    const { lambda } = App.config.sym;
    // The state's own output is offered even if Δ no longer holds it, or the
    // select had no matching option and an untouched Save emptied it.
    const outs = [...new Set([...App.outputAlpha, lambda, ...(s.output ? [s.output] : [])])];
    $('s-output').innerHTML = outs.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
    ensureSelectValue($('s-output'), (s.output === undefined || s.output === '') ? lambda : s.output);
  }
  const mealyExtra = $('s-mealy-extra');
  if (mealyExtra) mealyExtra.style.display = App.machine === 'Mealy' ? '' : 'none';
  if (App.machine === 'Mealy') {
    const { lambda } = App.config.sym;
    // An output the alphabet no longer holds is still offered, as the
    // transition dialog offers it: missing from the menu, the select fell back
    // to its first option and an untouched Save rewrote the rule.
    const outgoing = App.transitions.filter(t => t.from === id);
    const outs = [...new Set([...App.outputAlpha, lambda, ...outgoing.map(t => t.output).filter(o => o)])];
    const list = $('s-mealy-transitions-list');
    if (outgoing.length === 0) {
      list.innerHTML = '<div class="modal-hint">No outgoing transitions</div>';
    } else {
      // A row per outgoing edge, read → destination → output, the way the
      // transition dialog's multi-tape table lays out a row per tape.
      const rows = outgoing.map(t => {
        const toState = getState(t.to)?.name || '?';
        const outVal = (t.output === undefined || t.output === '') ? lambda : t.output;
        const options = outs.map(o => `<option value="${escapeHtml(o)}" ${outVal === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');
        return `<span class="edit-grid-sym">${escapeHtml(t.symbol)}</span>
          <span class="edit-grid-to" title="${escapeHtml(toState)}">→ ${escapeHtml(toState)}</span>
          <select class="sel" id="mealy-out-${t.id}" aria-label="Output reading ${escapeHtml(t.symbol)} to ${escapeHtml(toState)}">${options}</select>`;
      }).join('');
      list.innerHTML = `<div class="edit-grid mealy-grid">
        <span class="edit-grid-head">Read</span><span class="edit-grid-head">To</span><span class="edit-grid-head">Output</span>
        ${rows}</div>`;
      // Set, not only marked `selected`: the value is what confirmState reads.
      for (const t of outgoing) {
        ensureSelectValue($(`mealy-out-${t.id}`), (t.output === undefined || t.output === '') ? lambda : t.output);
      }
    }
  }
  bindStateModal();
  updateStatePreview();
  showOverlay('state-modal');
}

function bindStateModal() {
  const modal = $('state-modal');
  if (!modal || modal.__stateBound) return;
  modal.__stateBound = true;
  modal.addEventListener('input', updateStatePreview);
  modal.addEventListener('change', updateStatePreview);
}

/**
 * Draw the state as the canvas will, from the fields: its name (wrapped as the
 * canvas wraps it), the start arrow, the accepting ring, a Moore output or a
 * parity badge, and its self-loops — the edges drawn on the node itself, whose
 * outputs a Mealy state's table edits.
 */
export function updateStatePreview() {
  const svg = $('s-preview');
  const s = getState(App.editId);
  if (!svg || !s) return;
  const name = $('s-name')?.value.trim() || s.name;
  const parity = usesParityPriorities(App.machine);
  const start = !!$('s-start')?.checked;
  const accept = $('s-acc-opt')?.style.display !== 'none' && !!$('s-acc')?.checked;
  const node = { id: s.id, name, x: 0, y: 0, start, accept };
  if (parity) {
    const p = parseInt($('s-priority')?.value, 10);
    node.priority = Number.isInteger(p) && p >= 0 ? p : 0;
  } else if (hasStateOutput(App.machine)) {
    const out = $('s-output')?.value ?? '';
    node.output = out === App.config.sym.lambda ? '' : out;
  }
  const loops = App.transitions.filter(t => t.from === s.id && t.to === s.id).map(t => {
    const el = $(`mealy-out-${t.id}`);
    if (!el) return t;
    const out = el.value.trim();
    return { ...t, output: out === App.config.sym.lambda ? '' : out };
  });
  drawEditPreview(svg, { nodes: [node], edges: loops.length ? [{ from: s.id, to: s.id, ts: loops }] : [] });
  const marks = [start && 'start', accept && 'accepting',
    node.priority !== undefined && `priority ${node.priority}`,
    node.output !== undefined && `output ${node.output || App.config.sym.lambda}`].filter(Boolean);
  svg.setAttribute('aria-label', `Preview: ${name}${marks.length ? ', ' + marks.join(', ') : ''}`);
}
export function confirmState() {
  const s = getState(App.editId); if (!s) return closeModal('state-modal');
  snapshot();
  s.name = $('s-name').value.trim() || s.name;
  
  const wasStart = isConceptualStart(s.id);
  const nowStart = $('s-start').checked;
  if (!wasStart && nowStart) {
    applyStartState(s.id);
  } else if (wasStart && !nowStart) {
    removeStartState(s.id);
  }
  
  if (usesParityPriorities(App.machine)) {
    const p = parseInt($('s-priority').value, 10);
    s.priority = Number.isInteger(p) && p >= 0 ? p : 0;
  } else if ($('s-acc').checked) {
    App.accepts.add(s.id);
  } else {
    App.accepts.delete(s.id);
  }
  if (hasStateOutput(App.machine)) {
    const out = $('s-output').value.trim();
    s.output = out === App.config.sym.lambda ? '' : out;
  }
  if (App.machine === 'Mealy') {
    const outgoing = App.transitions.filter(t => t.from === s.id);
    outgoing.forEach(t => {
      const el = $(`mealy-out-${t.id}`);
      if (el) {
        const out = el.value.trim();
        t.output = out === App.config.sym.lambda ? '' : out;
      }
    });
  }
  closeModal('state-modal'); emit(Change.GRAPH);
}

export function isConceptualStart(id) {
  if (App.startId === id) return true;
  const startState = getState(App.startId);
  if (startState && startState.isDummyStart) {
    return App.transitions.some(t => t.from === startState.id && t.to === id && t.symbol === App.config.sym.eps);
  }
  return false;
}

export function applyStartState(targetId) {
  if (App.startId === targetId) return;
  if (!App.startId) {
    App.startId = targetId;
    return;
  }
  if (App.machine === 'NFA' || App.machine === 'ε-NFA') {
    let dummy = App.states.find(s => s.isDummyStart && App.startId === s.id);
    const eps = App.config.sym.eps;
    if (dummy) {
      if (!App.transitions.find(t => t.from === dummy.id && t.to === targetId && t.symbol === eps)) {
        App.transitions.push({ id: newTId(), from: dummy.id, to: targetId, symbol: eps });
      }
    } else {
      const oldStart = getState(App.startId);
      const nx = oldStart ? oldStart.x - 80 : 100;
      const ny = oldStart ? oldStart.y : 100;
      const dummyId = newId();
      const newDummy = { id: dummyId, x: nx, y: ny, name: 'q_start', isDummyStart: true };
      App.states.push(newDummy);
      App.startId = dummyId;
      if (oldStart) {
        App.transitions.push({ id: newTId(), from: dummyId, to: oldStart.id, symbol: eps });
      }
      App.transitions.push({ id: newTId(), from: dummyId, to: targetId, symbol: eps });
      // A second start state is wired up with ε-moves, so the machine is no
      // longer a plain NFA. applyMachineSwitch is the non-prompting switch —
      // it syncs the model picker label, the badge, the alphabet panels and
      // the machine-specific sections together. The hand-rolled version this
      // replaces updated three elements by hand, two of which
      // (#mobile-machine-select, .mtab) no longer exist, and never touched the
      // picker — so the header kept reading "NFA" for an ε-NFA.
      if (App.machine === 'NFA') applyMachineSwitch('ε-NFA');
    }
  } else {
    App.startId = targetId; 
  }
}

export function removeStartState(targetId) {
  if (App.startId === targetId) {
    App.startId = null;
  } else {
    const startState = getState(App.startId);
    if (startState && startState.isDummyStart) {
      App.transitions = App.transitions.filter(t => !(t.from === startState.id && t.to === targetId && t.symbol === App.config.sym.eps));
      const remainingLinks = App.transitions.filter(t => t.from === startState.id && t.symbol === App.config.sym.eps);
      if (remainingLinks.length === 0) {
        App.states = App.states.filter(s => s.id !== startState.id);
        App.startId = null;
      }
    }
  }
}

export function ctxStart() { 
  if (!App.ctxId) return;
  const id = App.ctxId;
  hideContextMenu();
  snapshot();
  if (isConceptualStart(id)) {
    removeStartState(id);
  } else {
    applyStartState(id);
  }
  emit(Change.GRAPH); 
}

export function ctxToggleAcc() { 
  if (!App.ctxId) return;
  const id = App.ctxId;
  hideContextMenu();
  const cfg = getMachineConfig(App.machine);
  if (cfg.isTransducer && !App.config.transducerAccepts) return;
  snapshot();
  App.accepts.has(id) ? App.accepts.delete(id) : App.accepts.add(id); 
  emit(Change.GRAPH); 
}
export function ctxRename() { 
  if (!App.ctxId) return;
  const id = App.ctxId;
  hideContextMenu();
  openStateModal(id); 
}
export function ctxDel() { 
  if (!App.ctxId) return;
  const id = App.ctxId;
  hideContextMenu();
  deleteState(id); 
}

export function ctxEditTrans() {
  const edge = App.ctxEdge;
  if (!edge) return;
  const transitions = edge.transitionIds.map(getTransition).filter(Boolean);
  const primary = transitions.find(t => t.id === edge.primaryId) || transitions[0];
  hideContextMenu();
  if (!primary) return;
  openTransModal(edge.from, edge.to, { mode: 'edit', transId: primary.id, transitions });
}

export function ctxDuplicateTrans() {
  const edge = App.ctxEdge;
  if (!edge) return;
  const transitions = edge.transitionIds.map(getTransition).filter(Boolean);
  const primary = transitions.find(t => t.id === edge.primaryId) || transitions[0];
  hideContextMenu();
  if (!primary) return;
  openTransModal(edge.from, edge.to, { mode: 'add', seedId: primary.id, transitions });
}

export function ctxReverseTrans() {
  const edge = App.ctxEdge;
  if (!edge) return;
  hideContextMenu();
  const ids = new Set(edge.transitionIds);
  if (!ids.size) return;
  if (App.machine === 'DFA') {
    let conflictMsg = null;
    App.transitions.find(t => {
      if (ids.has(t.id)) return false;
      return edge.transitionIds.some(id => {
        const tr = getTransition(id);
        if (!tr) return false;
        if (t.from === tr.to && t.symbol === tr.symbol) {
          const fromName = getState(tr.to)?.name || '?';
          const toName = getState(t.to)?.name || '?';
          conflictMsg = `Cannot reverse: δ(${fromName}, '${tr.symbol}') → ${toName} already exists. Remove it first.`;
          return true;
        }
        return false;
      });
    });
    if (conflictMsg) {
      showStatus(conflictMsg);
      return;
    }
  }
  snapshot();
  App.transitions.forEach(t => {
    if (!ids.has(t.id)) return;
    const oldFrom = t.from;
    const oldTo = t.to;
    t.from = t.to;
    t.to = oldFrom;
    if (typeof t.curve === 'number' && oldFrom !== oldTo) t.curve = -t.curve;
  });
  invalidateTransitionIndex();   // every `from` above changed in place
  emit(Change.GRAPH);
}

// Drops the hand-set bend or loop direction, handing the edge back to the
// automatic routing. Without this the only way out of a curve dragged to a bad
// place is undo, which is no help once anything else has been edited since.
export function ctxResetEdgeShape() {
  const edge = App.ctxEdge;
  if (!edge) return;
  hideContextMenu();
  const ids = new Set(edge.transitionIds);
  const overridden = App.transitions.filter(t => ids.has(t.id)
    && (t.curve !== undefined || t.loopAngle !== undefined));
  if (!overridden.length) { showStatus('This edge is already placed automatically'); return; }
  snapshot();
  overridden.forEach(t => { delete t.curve; delete t.loopAngle; });
  emit(Change.GRAPH);
  showStatus('Edge shape reset');
}

export function ctxDeleteTrans() {
  const edge = App.ctxEdge;
  if (!edge) return;
  hideContextMenu();
  deleteTransitions(edge.transitionIds);
}

// showOverlay/closeModal now live in modal.js; each modal registers its own
// teardown there instead of being special-cased inside a shared close.
registerModal('trans-modal', {
  submit: () => confirmTrans(),
  // The edge's ends are already chosen — by the drag that opened the dialog,
  // or by the rule being edited — so the caret starts on what it reads.
  initialFocus: () => {
    const row = $('m-sym-row');
    const sym = row && row.style.display !== 'none' ? $('m-sym') : $('m-mtm-read-0');
    // The multi-tape table was written a moment ago, and the observer that
    // dresses its selects has not run yet — so dress this one now.
    if (sym?.parentNode) enhanceCustomSelect(sym);
    return sym?.closest?.('.custom-select')?.querySelector('.custom-select-trigger') || null;
  },
  onClose: () => {
    App.transEditId = null;
    App.transModalMode = 'add';
    App.transModalIds = [];
    const pickerRow = $('m-trans-row');
    const picker = $('m-trans');
    if (pickerRow) pickerRow.style.display = 'none';
    if (picker) {
      picker.innerHTML = '';
      picker.onchange = null;
    }
    setTransitionModalMode('add');
  }
});

registerModal('state-modal', { submit: () => confirmState() });

