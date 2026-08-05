import { closeModal, registerModal, showOverlay } from './modal.js';
import { showExampleCard } from './persistence.js';
import { renderAll, updateLPanel, updateRPanel } from './render.js';
import { resetSim } from './simulation.js';
import { $, App, getBoundaryMarkers, isTwoWayFA } from './state.js';

// ══════════════════════════════════════════════════════════════════
//  UTILS / HELPERS
// ══════════════════════════════════════════════════════════════════
// The machine-shape predicates (getMachineConfig, isTwoWayFA,
// normalizeBoundarySymbolsForMachine, ...) that used to head this file now live
// in js/state.js. They only ever read App and MachineTypes, and keeping them
// here made state.js import utils.js — a cycle that decided module evaluation
// order for the whole app.
export function buildMarkedInputTape(tokens = []) {
  const { left, right } = getBoundaryMarkers();
  return [left, ...tokens, right];
}

export function isSingleTapeTM(m = App.machine) {
  return m === 'TM' || m === 'NDTM' || m === 'LBA' || m === 'ITM' || isTwoWayFA(m);
}

export function isAnyTM(m = App.machine) {
  return m === 'TM' || m === 'NDTM' || m === 'MTM' || m === 'LBA' || m === 'ITM';
}

export function isAnyPDA(m = App.machine) {
  return m === 'DPDA' || m === 'NPDA' || m === 'PDA' || m === 'QA' || m === 'Counter' || m === '2PDA';
}

export function isClassicPDA(m = App.machine) {
  return m === 'DPDA' || m === 'NPDA' || m === 'PDA';
}

export function isCfgConvertiblePDA(m = App.machine) {
  return isClassicPDA(m);
}

export function isQueueAutomaton(m = App.machine) {
  return m === 'QA';
}

export function isCounterMachine(m = App.machine) {
  return m === 'Counter';
}

export function isTwoStackPDA(m = App.machine) {
  return m === '2PDA';
}

export function isTwoWayNondeterministicFA(m = App.machine) {
  return m === '2NFA';
}

export function isLBA(m = App.machine) {
  return m === 'LBA';
}

export function isInfiniteTapeTM(m = App.machine) {
  return m === 'ITM';
}

export function hasSingleTapeNondeterminism(transitions = App.transitions) {
  const seen = new Set();
  for (const t of transitions) {
    const key = `${t.from}|${t.symbol}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export function pdaReadPatternsOverlap(a, b, eps = App.config.sym.eps, any = App.config.sym.any) {
  if (a === eps || b === eps) return true;
  if (a === any || b === any) return true;
  return a === b;
}

export function pdaPopPatternsOverlap(a, b, eps = App.config.sym.eps, any = App.config.sym.any) {
  if (a === eps || b === eps) return true;
  if (a === any || b === any) return true;
  return a === b;
}

export function pdaTransitionsOverlap(a, b) {
  return a.from === b.from
    && pdaReadPatternsOverlap(a.symbol, b.symbol)
    && pdaPopPatternsOverlap(a.pop, b.pop);
}

export function symbolsOverlap(a, b, any = App.config.sym.any) {
  return a === b || a === any || b === any;
}

export function tapeTuplesOverlap(aSyms = [], bSyms = [], any = App.config.sym.any) {
  if (!Array.isArray(aSyms) || !Array.isArray(bSyms) || aSyms.length !== bSyms.length) return false;
  return aSyms.every((sym, i) => symbolsOverlap(sym, bSyms[i], any));
}

export function pickMostSpecificTransition(transitions = [], scoreFn = () => 0) {
  let best = null;
  let bestScore = -Infinity;
  for (const transition of transitions) {
    const score = scoreFn(transition);
    if (score > bestScore) {
      best = transition;
      bestScore = score;
      continue;
    }
    if (score === bestScore && best && String(transition.id || '').localeCompare(String(best.id || ''), undefined, { numeric: true }) < 0) {
      best = transition;
    }
  }
  return best;
}

export function findPdaNondeterministicPairs(transitions = App.transitions) {
  const pairs = [];
  for (let i = 0; i < transitions.length; i++) {
    for (let j = i + 1; j < transitions.length; j++) {
      if (pdaTransitionsOverlap(transitions[i], transitions[j])) {
        pairs.push([transitions[i], transitions[j]]);
      }
    }
  }
  return pairs;
}

export function hasPdaNondeterminism(transitions = App.transitions) {
  return findPdaNondeterministicPairs(transitions).length > 0;
}

export function getPdaDeterminismConflict(candidate, transitions = App.transitions, ignoreId = null) {
  return transitions.find(t =>
    t.id !== ignoreId
    && pdaTransitionsOverlap(t, candidate)
  ) || null;
}

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
  App.dividers = []; App.dividerN = 0; App.selectedDividerId = null;
  App.edgeHighlight = null;
  // Selections/edit targets can otherwise outlive the states and
  // transitions they point at — a stray Ctrl+D or arrow-key nudge right
  // after Clear would then act on an id that no longer exists.
  App.selectedStates.clear(); App.selectedTransitions.clear();
  App.transFrom = null; App.ctxId = null; App.ctxEdge = null; App.ctxMode = null; App.editId = null;
  if (typeof showExampleCard === 'function') showExampleCard(null);
  resetSim(); renderAll(); updateLPanel(); updateRPanel();
}

export function showStatus(msg) {
  const b = $('status-bar'); b.textContent = msg; b.classList.add('show');
  clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('show'), 2500);
}


export function parseEps(str) {
  if (!str) return '';
  const s = str.trim();
  if (s.toLowerCase() === 'eps' || s.toLowerCase() === 'epsilon') return App.config.sym.eps;
  return s;
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
