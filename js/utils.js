// ══════════════════════════════════════════════════════════════════
//  UTILS / HELPERS
// ══════════════════════════════════════════════════════════════════
function getMachineConfig(m) { return MachineTypes[m] || MachineTypes['DFA']; }

function isTwoWayFA(m = App.machine) {
  return m === '2DFA' || m === '2NFA';
}

function isEndmarkerMachine(m = App.machine) {
  return m === '2DFA' || m === '2NFA' || m === 'LBA';
}

function isReadOnlyHeadMachine(m = App.machine) {
  return isTwoWayFA(m);
}

function isBoundaryTapeMachine(m = App.machine) {
  return m === 'LBA';
}

function getBoundaryMarkers() {
  return {
    left: App.config.sym.leftMarker,
    right: App.config.sym.rightMarker
  };
}

function isBoundarySymbol(sym) {
  const { left, right } = getBoundaryMarkers();
  return sym === left || sym === right;
}

function normalizeBoundarySymbolsForMachine(m = App.machine) {
  const { left, right } = getBoundaryMarkers();

  if (App.sigma instanceof Set) {
    App.sigma = new Set([...App.sigma].filter(sym => sym !== left && sym !== right));
  }

  if (!(App.stackAlpha instanceof Set)) return;
  const symbols = [...App.stackAlpha].filter(sym => sym !== left && sym !== right);
  App.stackAlpha = isBoundaryTapeMachine(m)
    ? new Set([left, ...symbols, right])
    : new Set(symbols);
}

function buildMarkedInputTape(tokens = []) {
  const { left, right } = getBoundaryMarkers();
  return [left, ...tokens, right];
}

function isSingleTapeTM(m = App.machine) {
  return m === 'TM' || m === 'NDTM' || m === 'LBA' || m === 'ITM' || isTwoWayFA(m);
}

function isAnyTM(m = App.machine) {
  return m === 'TM' || m === 'NDTM' || m === 'MTM' || m === 'LBA' || m === 'ITM';
}

function isAnyPDA(m = App.machine) {
  return m === 'DPDA' || m === 'NPDA' || m === 'PDA' || m === 'QA' || m === 'Counter' || m === '2PDA';
}

function isClassicPDA(m = App.machine) {
  return m === 'DPDA' || m === 'NPDA' || m === 'PDA';
}

function isCfgConvertiblePDA(m = App.machine) {
  return isClassicPDA(m);
}

function isQueueAutomaton(m = App.machine) {
  return m === 'QA';
}

function isCounterMachine(m = App.machine) {
  return m === 'Counter';
}

function isTwoStackPDA(m = App.machine) {
  return m === '2PDA';
}

function isTwoWayNondeterministicFA(m = App.machine) {
  return m === '2NFA';
}

function isLBA(m = App.machine) {
  return m === 'LBA';
}

function isInfiniteTapeTM(m = App.machine) {
  return m === 'ITM';
}

function hasSingleTapeNondeterminism(transitions = App.transitions) {
  const seen = new Set();
  for (const t of transitions) {
    const key = `${t.from}|${t.symbol}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function pdaReadPatternsOverlap(a, b, eps = App.config.sym.eps, any = App.config.sym.any) {
  if (a === eps || b === eps) return true;
  if (a === any || b === any) return true;
  return a === b;
}

function pdaPopPatternsOverlap(a, b, eps = App.config.sym.eps, any = App.config.sym.any) {
  if (a === eps || b === eps) return true;
  if (a === any || b === any) return true;
  return a === b;
}

function pdaTransitionsOverlap(a, b) {
  return a.from === b.from
    && pdaReadPatternsOverlap(a.symbol, b.symbol)
    && pdaPopPatternsOverlap(a.pop, b.pop);
}

function symbolsOverlap(a, b, any = App.config.sym.any) {
  return a === b || a === any || b === any;
}

function tapeTuplesOverlap(aSyms = [], bSyms = [], any = App.config.sym.any) {
  if (!Array.isArray(aSyms) || !Array.isArray(bSyms) || aSyms.length !== bSyms.length) return false;
  return aSyms.every((sym, i) => symbolsOverlap(sym, bSyms[i], any));
}

function pickMostSpecificTransition(transitions = [], scoreFn = () => 0) {
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

function findPdaNondeterministicPairs(transitions = App.transitions) {
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

function hasPdaNondeterminism(transitions = App.transitions) {
  return findPdaNondeterministicPairs(transitions).length > 0;
}

function getPdaDeterminismConflict(candidate, transitions = App.transitions, ignoreId = null) {
  return transitions.find(t =>
    t.id !== ignoreId
    && pdaTransitionsOverlap(t, candidate)
  ) || null;
}

function resetIds() {
  App.stateN = Math.max(0, ...App.states.map(s => { const m = s.id.match(/(\d+)/g); return m ? Math.max(...m.map(Number)) : 0; }));
  App.transN = Math.max(0, ...App.transitions.map(t => { const m = t.id.match(/(\d+)/g); return m ? Math.max(...m.map(Number)) : 0; }));
  App.noteN = Math.max(0, ...(App.notes || []).map(n => { const m = n.id.match(/(\d+)/g); return m ? Math.max(...m.map(Number)) : 0; }));
}
function clearAll(silent) {
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

function performClear() {
  App.states = []; App.transitions = []; App.startId = null; App.accepts.clear();
  App.stateN = 0; App.transN = 0; App.history = []; App.future = [];
  App.notes = []; App.noteN = 0;
  App.edgeHighlight = null;
  if (typeof showExampleCard === 'function') showExampleCard(null);
  resetSim(); renderAll(); updateLPanel(); updateRPanel();
}

function showStatus(msg) {
  const b = $('status-bar'); b.textContent = msg; b.classList.add('show');
  clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('show'), 2500);
}


function parseEps(str) {
  if (!str) return '';
  const s = str.trim();
  if (s.toLowerCase() === 'eps' || s.toLowerCase() === 'epsilon') return App.config.sym.eps;
  return s;
}

// Escapes a string for safe insertion as HTML text/attribute content — needed
// wherever untrusted data (Σ symbols, stack/output alphabet symbols, all of
// which can arrive via an imported automaton file) is interpolated into innerHTML.
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Safely embeds an arbitrary string as a JS argument inside an inline HTML
// event handler attribute, e.g. `onclick="delSym(${jsAttr(s)})"`. JSON.stringify
// produces a properly quote/backslash-escaped JS string literal; escapeHtml then
// protects the surrounding HTML attribute (browsers HTML-decode the attribute
// value before parsing it as JS, so both layers are required).
function jsAttr(str) {
  return escapeHtml(JSON.stringify(String(str)));
}
