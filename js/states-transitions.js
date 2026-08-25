import { clearTempLine, hideCanvasContextMenu } from './canvas.js';
import { snapshot } from './history.js';
import { closeModal, registerModal, showOverlay } from './modal.js';
import { pruneNoteAnchorsExcluding } from './notes.js';
import { renderAll } from './render.js';
import { $, App, getMachineConfig, getState, isBoundarySymbol, isReadOnlyHeadMachine, isWeightedFA, statePriority, usesParityPriorities } from './state.js';
import { Change, emit } from './store.js';
import { counterBottomViolation, hasStateOutput, hasTransitionOutput, isAnyPDA, isCounterMachine, isQueueAutomaton, isSingleTapeTM, isTwoStackPDA, parseEps, showStatus } from './utils.js';
import { isMultiTape, machineDeterminism, machineStoreLabels, transitionHasField } from './machines/index.js';
import { applyMachineSwitch } from './view.js';

// ══════════════════════════════════════════════════════════════════
//  STATE MANAGEMENT
// ══════════════════════════════════════════════════════════════════
export function newId() { return 's' + (++App.stateN); }
export function newTId() { return 't' + (++App.transN); }

// Re-exported so the many UI call sites that already import it from here
// keep working; the definition moved to the leaf that owns App.states.
export { getState };
export function getTransition(id) { return App.transitions.find(t => t.id === id); }
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
  const maxX = kind === 'edge' ? 260 : (kind === 'note' || kind === 'divider') ? 240 : 220;
  const maxY = (kind === 'edge' ? 190 : kind === 'note' ? 240 : kind === 'divider' ? 210 : 150) + smRows;
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

export function populateTransitionModal(t) {
  const cfg = getMachineConfig(App.machine);
  const { eps, any, blank } = App.config.sym;
  const markers = cfg.hasEndMarkers ? [App.config.sym.leftMarker, App.config.sym.rightMarker] : [];
  const syms = [...new Set([...(cfg.hasEpsilon ? [eps] : []), any, ...App.sigma, ...markers, ...(cfg.hasTape ? [blank] : [])])];

  const fromSel = $('m-from');
  const toSel = $('m-to');
  if (fromSel) {
    fromSel.innerHTML = App.states.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    if (t?.from) ensureSelectValue(fromSel, t.from);
  }
  if (toSel) {
    toSel.innerHTML = App.states.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    if (t?.to) ensureSelectValue(toSel, t.to);
  }

  const symSel = $('m-sym');
  if (symSel) {
    if (App.machine !== 'MTM') {
      symSel.innerHTML = syms.map(s => `<option value="${s}">${s}</option>`).join('');
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
    }
    const writeInput = $('m-write');
    const writeRow = writeInput && typeof writeInput.closest === 'function' ? writeInput.closest('.modal-row') : null;
    if (writeRow) writeRow.style.display = isReadOnlyHeadMachine(App.machine) ? 'none' : '';
  }

  if (has('tapeSyms')) {
    const k = App.tapeCount;
    const dirOpts = App.directions.map(d => `<option value="${d.value}">${d.label} (${d.value})</option>`).join('');
    const symOpts = syms.map(s => `<option value="${s}">${s}</option>`).join('');
    const mtmExtra = $('m-mtm-extra');
    if (mtmExtra) {
      mtmExtra.innerHTML = Array.from({ length: k }, (_, i) => `
        <div class="modal-section-lbl">Tape ${i + 1}</div>
        <div class="modal-row"><span class="modal-lbl">Read</span><select class="sel" id="m-mtm-read-${i}">${symOpts}</select></div>
        <div class="modal-row"><span class="modal-lbl">Write</span><input class="inp" id="m-mtm-write-${i}" placeholder="symbol"
          autocomplete="off" onkeydown="trySymSuggestKeydown(event)" oninput="handleSymSuggestActive(this)"
          onfocus="handleSymSuggestActive(this)" onclick="refreshSymSuggest(this)"
          onkeyup="handleSymSuggestKeyup(this)" onblur="hideSymSuggest()"></div>
        <div class="modal-row"><span class="modal-lbl">Move</span><select class="sel" id="m-mtm-dir-${i}">${dirOpts}</select></div>
      `).join('');
    }
    for (let i = 0; i < k; i++) {
      ensureSelectValue($(`m-mtm-read-${i}`), t?.tapeSyms?.[i] ?? t?.symbol ?? blank);
      const writeEl = $(`m-mtm-write-${i}`);
      if (writeEl) writeEl.value = t?.tapeWrites?.[i] ?? t?.write ?? t?.symbol ?? blank;
      ensureSelectValue($(`m-mtm-dir-${i}`), t?.tapeDirs?.[i] ?? t?.dir ?? App.directions[0].value);
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
    const tmWrite = $('m-write');
    if (tmWrite) tmWrite.value = isReadOnlyHeadMachine(App.machine) ? (t?.symbol ?? '') : (t?.write ?? t?.symbol ?? '');
  }

  const picker = $('m-trans');
  if (picker && t) picker.value = t.id;
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
  showOverlay('trans-modal');
}
export function confirmTrans() {
  const cfg = getMachineConfig(App.machine);
  const { eps } = App.config.sym;
  const values = getTransitionFormValues();
  const from = values.from, to = values.to, sym = values.symbol;
  const editId = App.transEditId;

  if (!cfg.hasEpsilon && sym === eps) {
    showStatus(`${App.machine} cannot have epsilon-transitions.`); return;
  }
  if (cfg.hasEndMarkers && isBoundarySymbol(sym)) {
    const { leftMarker, rightMarker } = App.config.sym;
    if (sym === leftMarker && values.dir === 'L') {
      showStatus(`${App.machine} cannot move left of the left boundary marker.`); return;
    }
    if (sym === rightMarker && values.dir === 'R') {
      showStatus(`${App.machine} cannot move right of the right boundary marker.`); return;
    }
    if (App.machine === 'LBA' && values.write !== sym) {
      showStatus('LBA boundary markers are fixed and must be preserved on write.'); return;
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
    if (conflict) { showStatus(rule.say({ ...values, from, symbol: sym }, conflict)); return; }
  }
  if (isWeightedFA(App.machine)) {
    const w = values.weight;
    if (!Number.isFinite(w) || w < 0 || w > 1) {
      showStatus('PFA transition probability must be a number between 0 and 1.'); return;
    }
  }
  if (isAnyPDA(App.machine)) {
    const isExplicit = App.config.pdaParadigm === 'explicit';
    if (!values.pop || values.pop.trim() === '') values.pop = eps;
    if (isExplicit && values.pop === eps) {
      // Allow epsilon pops for 7-tuple PDAs although formal definition requires exactly one symbol
    }
    if (values.pop.length > 1 && values.pop !== App.config.sym.any) {
      showStatus(`${App.machine} pop must be exactly one symbol.`); return;
    }
    const stackAllowed = new Set([...App.stackAlpha, App.config.sym.stackBottom, App.config.sym.any]);
    if (values.pop !== eps && !stackAllowed.has(values.pop)) {
      showStatus(`Symbol '${values.pop}' is not in your Stack Alphabet (Γ). Add it in the left panel first.`); return;
    }
    if (values.push && values.push !== eps && values.push !== App.config.sym.any) {
      const invalidChars = values.push.split('').filter(c => !stackAllowed.has(c));
      if (invalidChars.length > 0) {
        showStatus(`Push string contains symbols not in Stack Alphabet (Γ): ${invalidChars.join(', ')}. Add them first.`); return;
      }
    }

    if (isTwoStackPDA(App.machine)) {
      if (!values.pop2 || values.pop2.trim() === '') values.pop2 = eps;
      if (values.pop2.length > 1 && values.pop2 !== App.config.sym.any) {
        showStatus(`${App.machine} pop₂ must be exactly one symbol.`); return;
      }
      if (values.pop2 !== eps && !stackAllowed.has(values.pop2)) {
        showStatus(`Symbol '${values.pop2}' is not in your Stack Alphabet (Γ). Add it in the left panel first.`); return;
      }
      if (values.push2 && values.push2 !== eps && values.push2 !== App.config.sym.any) {
        const invalidChars2 = values.push2.split('').filter(c => !stackAllowed.has(c));
        if (invalidChars2.length > 0) {
          showStatus(`Push₂ string contains symbols not in Stack Alphabet (Γ): ${invalidChars2.join(', ')}. Add them first.`); return;
        }
      }
    }

    if (isCounterMachine(App.machine)) {
      const bottom = App.config.sym.stackBottom;
      const counterSym = [...App.stackAlpha].find(symEl => symEl !== bottom) || '1';
      const counterAllowed = new Set([eps, bottom, counterSym, App.config.sym.any]);
      if (!counterAllowed.has(values.pop)) {
        showStatus(`Counter Automaton pop must use only '${counterSym}', '${bottom}', '${App.config.sym.any}', or ε.`); return;
      }
      if (values.push && values.push !== eps && values.push !== App.config.sym.any) {
        const invalidCounterPush = values.push.split('').filter(c => c !== counterSym && c !== bottom);
        if (invalidCounterPush.length > 0) {
          showStatus(`Counter Automaton push may only use '${counterSym}' (and optional '${bottom}'). Invalid: ${invalidCounterPush.join(', ')}.`); return;
        }
      }
      const bottomIssue = counterBottomViolation(values.pop, values.push);
      if (bottomIssue) {
        showStatus(`Counter Automaton push ${bottomIssue} — '${bottom}' marks zero, so it stays at the bottom.`); return;
      }
    }
  }
  snapshot();
  if (editId) {
    const t = getTransition(editId);
    if (!t) { closeModal('trans-modal'); return; }
    t.from = from;
    t.to = to;
    t.symbol = sym;
    if (isAnyPDA(App.machine)) {
      t.pop = values.pop;
      t.push = values.push;
      if (isTwoStackPDA(App.machine)) {
        t.pop2 = values.pop2;
        t.push2 = values.push2;
      } else {
        delete t.pop2;
        delete t.push2;
      }
    } else {
      delete t.pop;
      delete t.push;
      delete t.pop2;
      delete t.push2;
    }
    if (isSingleTapeTM(App.machine)) {
      t.write = values.write;
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
    if (isAnyPDA(App.machine)) {
      t.pop = values.pop;
      t.push = values.push;
      if (isTwoStackPDA(App.machine)) {
        t.pop2 = values.pop2;
        t.push2 = values.push2;
      }
    }
    if (isSingleTapeTM(App.machine)) { t.write = values.write; t.dir = values.dir; }
    if (hasTransitionOutput(App.machine)) { t.output = values.output; }
    if (isWeightedFA(App.machine)) { t.weight = values.weight; }
    if (isMultiTape(App.machine)) {
      t.tapeSyms = values.tapeSyms;
      t.tapeWrites = values.tapeWrites;
      t.tapeDirs = values.tapeDirs;
      t.symbol = values.symbol;
    }
    App.transitions.push(t);
  }
  closeModal('trans-modal');
  App.transFrom = null; clearTempLine();
  emit(Change.GRAPH);
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

export function transLabel(t) {
  if (isWeightedFA(App.machine)) return `${t.symbol} : ${formatWeight(t.weight ?? 1)}`;
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

// ══════════════════════════════════════════════════════════════════
//  STATE MODAL / CTX
// ══════════════════════════════════════════════════════════════════
export function openStateModal(id) {
  App.editId = id;
  const s = getState(id); if (!s) return;
  $('s-name').value = s.name;
  const hint = $('s-name-hint');
  if (hint) {
    hint.innerHTML = App.config.wrapStateLabels
      ? 'Use <code>_</code>, space or <code>-</code> to break long names onto multiple lines inside the node.'
      : 'Long names will overflow the node — enable "Wrap Long State Labels" in Settings → Rendering to break them at <code>_</code>, space or <code>-</code>.';
  }
  $('s-start').checked = isConceptualStart(id);
  const cfg = getMachineConfig(App.machine);
  if (cfg.isTransducer && !App.config.transducerAccepts) {
    $('s-acc').parentElement.style.display = 'none';
  } else {
    $('s-acc').parentElement.style.display = '';
  }
  $('s-acc').checked = App.accepts.has(id);
  // Under parity, α is the number rather than the ring — F carries no meaning,
  // so offering the Accept toggle would invite a mode that does nothing.
  const parityExtra = $('s-parity-extra');
  const parity = usesParityPriorities(App.machine);
  if (parityExtra) parityExtra.style.display = parity ? '' : 'none';
  if (parity) {
    $('s-acc').parentElement.style.display = 'none';
    $('s-priority').value = String(statePriority(s));
  }
  const mooreExtra = $('s-moore-extra');
  mooreExtra.style.display = hasStateOutput(App.machine) ? '' : 'none';
  if (hasStateOutput(App.machine)) {
    const { lambda } = App.config.sym;
    const outs = [...new Set([...App.outputAlpha, lambda])];
    $('s-output').innerHTML = outs.map(o => `<option value="${o}">${o}</option>`).join('');
    $('s-output').value = (s.output === undefined || s.output === '') ? lambda : s.output;
  }
  const mealyExtra = $('s-mealy-extra');
  if (mealyExtra) mealyExtra.style.display = App.machine === 'Mealy' ? '' : 'none';
  if (App.machine === 'Mealy') {
    const { lambda } = App.config.sym;
    const outs = [...new Set([...App.outputAlpha, lambda])];
    const outgoing = App.transitions.filter(t => t.from === id);
    const list = $('s-mealy-transitions-list');
    if (outgoing.length === 0) {
      list.innerHTML = '<div class="modal-hint">No outgoing transitions</div>';
    } else {
      list.innerHTML = outgoing.map(t => {
        const toState = getState(t.to)?.name || '?';
        const outVal = (t.output === undefined || t.output === '') ? lambda : t.output;
        const options = outs.map(o => `<option value="${o}" ${outVal === o ? 'selected' : ''}>${o}</option>`).join('');
        return `<div class="mealy-output-row">
          <span class="mealy-output-lbl">→ ${toState} ('${t.symbol}')</span>
          <select class="sel" id="mealy-out-${t.id}">${options}</select>
        </div>`;
      }).join('');
    }
  }
  showOverlay('state-modal');
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

