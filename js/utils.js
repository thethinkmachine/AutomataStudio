import { closeModal, showOverlay } from './modal.js';
import { clearRunScope } from './run-scope.js';
import { showExampleCard } from './persistence.js';
import { renderAll, updateLPanel, updateRPanel } from './render.js';
import { resetSim } from './simulation.js';
import { $, App, blankWorkspaceData, importWorkspaceState } from './state.js';
import { Change, emit } from './store.js';
import { snapshot } from './history.js';
import { applyCamera } from './canvas.js';
import { applyMachineSwitch } from './view.js';

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


export function resetIds() {
  App.stateN = Math.max(0, ...App.states.map(s => { const m = s.id.match(/(\d+)/g); return m ? Math.max(...m.map(Number)) : 0; }));
  App.transN = Math.max(0, ...App.transitions.map(t => { const m = t.id.match(/(\d+)/g); return m ? Math.max(...m.map(Number)) : 0; }));
  App.noteN = Math.max(0, ...(App.notes || []).map(n => { const m = n.id.match(/(\d+)/g); return m ? Math.max(...m.map(Number)) : 0; }));
  App.dividerN = Math.max(0, ...(App.dividers || []).map(d => { const m = d.id.match(/(\d+)/g); return m ? Math.max(...m.map(Number)) : 0; }));
  App.blockN = Math.max(0, ...(App.blocks || []).map(b => { const m = b.id.match(/(\d+)/g); return m ? Math.max(...m.map(Number)) : 0; }));
}
/**
 * The Clear button: back to an empty workspace, not just an empty canvas.
 *
 * It used to call performClear(), which empties the graph and nothing else —
 * so a cleared workspace kept the previous machine's Σ and Γ, its grammar,
 * its machine card and the camera parked over where the diagram had been.
 * That is a blank *screen*; the tab beside it that says "Workspace 2" is a
 * blank workspace, and the two being different was the whole complaint.
 * Both now start from the same blankWorkspaceData().
 */
export function clearAll(silent) {
  const worthAsking = App.states.length > 0 || App.transitions.length > 0
    || (App.notes || []).length > 0 || (App.dividers || []).length > 0
    || !!App.meta || (App.grammar?.productions || []).length > 0;
  if (!silent && worthAsking) {
    $('confirm-title').textContent = 'Clear Workspace?';
    $('confirm-msg').textContent = 'This resets the workspace to its defaults. '
      + 'Other tabs are left untouched.';
    const btn = $('confirm-action-btn');
    btn.onclick = () => {
      resetWorkspace();
      closeModal('confirm-modal');
    };
    showOverlay('confirm-modal');
    return;
  }
  resetWorkspace();
  if (!silent) showStatus('Workspace cleared');
}

/**
 * Everything back to the state a new tab opens in.
 *
 * The undo point comes first and is the only one: clearing a workspace is
 * one edit, and Ctrl+Z brings the whole thing back — which is what makes a
 * reset this wide safe to offer behind a single button.
 */
export function resetWorkspace() {
  snapshot();
  // The blank workspace carries empty history/future like any other loaded
  // blob, and importWorkspaceState assigns them — which would throw away the
  // undo point taken on the line above, leaving Clear the one edit in the app
  // that cannot be taken back. The stacks are the session's, not the
  // document's, so they are carried across the import.
  const history = App.history;
  const future = App.future;
  importWorkspaceState(blankWorkspaceData());
  App.history = history;
  App.future = future;
  clearTransientPointers();
  if (typeof showExampleCard === 'function') showExampleCard(null);
  resetSim();
  // The machine type is part of what was reset, so the panels, badges and
  // per-machine sections have to be told — emit(GRAPH) redraws the diagram
  // but does not re-shape the editor around a different machine.
  if (typeof applyMachineSwitch === 'function') applyMachineSwitch(App.machine);
  if (typeof applyCamera === 'function') applyCamera();
  emit(Change.ALPHABET, Change.META, Change.GRAMMAR, Change.GRAPH, Change.CANVAS);
}

/**
 * Selections and edit targets that would otherwise outlive what they point
 * at — a stray Ctrl+D or arrow-key nudge just after a clear would act on an
 * id that no longer exists.
 */
function clearTransientPointers() {
  App.edgeHighlight = null;
  App.selectedStates.clear(); App.selectedTransitions.clear();
  App.selectedNotes.clear(); App.selectedDividers.clear();
  App.transFrom = null; App.ctxId = null; App.ctxEdge = null; App.ctxMode = null; App.editId = null;
  // What a run is *about* is one of these: it names a block id, and both paths
  // that reach here replace the machine that block belonged to. resetSim()
  // deliberately keeps the subject across a run — re-picking the block for
  // every word tried is the one thing you do repeatedly — so it has to be
  // dropped where the machine goes rather than where the run does.
  clearRunScope();
}

/**
 * The graph and everything anchored to it, with the machine and its
 * alphabets left standing.
 *
 * This is what switching machine type wants: the diagram cannot survive the
 * switch, but Σ can and should — retyping the alphabet because you moved
 * from a DFA to a PDA over it would be busywork. The Clear button wants
 * resetWorkspace() instead, and conflating the two is what made Clear a
 * half-measure.
 */
export function performClear() {
  App.states = []; App.transitions = []; App.startId = null; App.accepts.clear();
  App.stateN = 0; App.transN = 0; App.history = []; App.future = [];
  App.notes = []; App.noteN = 0;
  App.dividers = []; App.dividerN = 0;
  // The blocks go with the diagram they grouped. Leaving the records behind
  // would leave every one of them pointing at a state that no longer exists —
  // which blockIsIntact() would then drop on the next read, so this is the
  // same answer arrived at eagerly rather than a second policy.
  App.blocks = []; App.blockN = 0; App.scope = [];
  clearTransientPointers();
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
