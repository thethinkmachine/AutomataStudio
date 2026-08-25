import { closeModal, registerModal, showOverlay } from './modal.js';
import { showExampleCard } from './persistence.js';
import { renderAll, updateLPanel, updateRPanel } from './render.js';
import { resetSim } from './simulation.js';
import { $, App } from './state.js';
import { Change, emit } from './store.js';

// ══════════════════════════════════════════════════════════════════
//  UTILS / HELPERS
// ══════════════════════════════════════════════════════════════════
// The machine-shape predicates (getMachineConfig, isTwoWayFA,
// normalizeBoundarySymbolsForMachine, ...) that used to head this file now live
// in js/state.js. They only ever read App and MachineTypes, and keeping them
// here made state.js import utils.js — a cycle that decided module evaluation
// order for the whole app.
// The machine predicates that used to fill the next two hundred lines now live
// in js/machines/predicates.js. They read only App and the registry, and
// keeping them here forced js/machines/** to import this file — which imports
// modal.js, render.js and persistence.js, and so cannot be evaluated without a
// document. That is what kept the simulators off a worker thread. Re-exported
// rather than moved-and-rewritten, so every existing call site is unchanged.
export {
  buildMarkedInputTape, counterBottomViolation, findOmegaDeterminismConflict,
  findPdaNondeterministicPairs, getPdaDeterminismConflict, hasPdaNondeterminism,
  hasSingleTapeNondeterminism, hasSingleValuedDelta, isAnyPDA, isAnyTM,
  isCfgConvertiblePDA, isClassicPDA, isCounterMachine, isInfiniteTapeTM, isLBA,
  isPushdownTransducer, isQueueAutomaton, isSingleTapeTM, isTwoStackPDA,
  isTwoWayNondeterministicFA, isTwoWayTransducer, parseEps,
  pdaPopPatternsOverlap, pdaReadPatternsOverlap, pdaTransitionsOverlap,
  pickMostSpecificTransition, symbolsOverlap, tapeTuplesOverlap
} from './machines/predicates.js';

export { hasStateOutput, hasTransitionOutput } from './machines/index.js';


// Callers rebind #confirm-action-btn per prompt, so Enter has to dispatch to
// whatever handler is currently attached rather than a fixed function.
registerModal('confirm-modal', {
  submit: () => {
    const btn = $('confirm-action-btn');
    if (btn && btn.onclick) btn.onclick();
  }
});

export function resetIds() {
  App.stateN = Math.max(0, ...App.states.map(s => { const m = s.id.match(/(\d+)/g); return m ? Math.max(...m.map(Number)) : 0; }));
  App.transN = Math.max(0, ...App.transitions.map(t => { const m = t.id.match(/(\d+)/g); return m ? Math.max(...m.map(Number)) : 0; }));
  App.noteN = Math.max(0, ...(App.notes || []).map(n => { const m = n.id.match(/(\d+)/g); return m ? Math.max(...m.map(Number)) : 0; }));
  App.dividerN = Math.max(0, ...(App.dividers || []).map(d => { const m = d.id.match(/(\d+)/g); return m ? Math.max(...m.map(Number)) : 0; }));
}
export function clearAll(silent) {
  if (!silent && App.states.length > 0) {
    $('confirm-title').textContent = 'Clear Canvas?';
    $('confirm-msg').textContent = 'This will permanently delete all states and transitions from the workspace.';
    const btn = $('confirm-action-btn');
    btn.onclick = () => {
      performClear();
      closeModal('confirm-modal');
    };
    showOverlay('confirm-modal');
    return;
  }
  performClear();
  if (!silent) showStatus('Canvas cleared');
}

export function performClear() {
  App.states = []; App.transitions = []; App.startId = null; App.accepts.clear();
  App.stateN = 0; App.transN = 0; App.history = []; App.future = [];
  App.notes = []; App.noteN = 0;
  App.dividers = []; App.dividerN = 0;
  App.edgeHighlight = null;
  // Selections/edit targets can otherwise outlive the states and
  // transitions they point at — a stray Ctrl+D or arrow-key nudge right
  // after Clear would then act on an id that no longer exists.
  App.selectedStates.clear(); App.selectedTransitions.clear();
  App.selectedNotes.clear(); App.selectedDividers.clear();
  App.transFrom = null; App.ctxId = null; App.ctxEdge = null; App.ctxMode = null; App.editId = null;
  if (typeof showExampleCard === 'function') showExampleCard(null);
  resetSim(); emit(Change.GRAPH);
}

export function showStatus(msg) {
  const b = $('status-bar'); b.textContent = msg; b.classList.add('show');
  clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('show'), 2500);
}



// Escapes a string for safe insertion as HTML text/attribute content — needed
// wherever untrusted data (Σ symbols, stack/output alphabet symbols, all of
// which can arrive via an imported automaton file) is interpolated into innerHTML.
export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Safely embeds an arbitrary string as a JS argument inside an inline HTML
// event handler attribute, e.g. `onclick="delSym(${jsAttr(s)})"`. JSON.stringify
// produces a properly quote/backslash-escaped JS string literal; escapeHtml then
// protects the surrounding HTML attribute (browsers HTML-decode the attribute
// value before parsing it as JS, so both layers are required).
export function jsAttr(str) {
  return escapeHtml(JSON.stringify(String(str)));
}
