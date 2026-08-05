import { langAcceptedTraces, langCanDecide, langCanTrace, langIsSymbolic, langVerdict } from './language.js';
import { App, Workspaces, activeWorkspaceId, getMachineConfig } from './state.js';
import { transLabel } from './states-transitions.js';
import { showStatus } from './utils.js';

// ══════════════════════════════════════════════════════════════════
//  EXPORT CORE
// ══════════════════════════════════════════════════════════════════
//  Everything the export formats share: one normalised view of the
//  machine, and the file/clipboard plumbing.
//
//  The formats (DOT, TikZ, CSV, Markdown, and the code generators)
//  deliberately do NOT read App directly. Each one would otherwise
//  re-derive the same things — which state is the start, what an edge
//  is called on this machine type, whether Σ needs a separator — and
//  they would drift apart the first time a machine type gained a
//  field. buildMachineIR() does it once; an exporter is then a pure
//  function from that record to a string, which is also what makes
//  them straightforward to test without a DOM.
// ══════════════════════════════════════════════════════════════════

// Ceiling on the Σ* walk behind negative-example sampling. Unlike the
// language panel's step budget this bounds *words examined*, not search
// nodes: the walk is an odometer, so the cost is one simulation per word
// and the budget is what keeps a 12-symbol alphabet from running away.
export const EXPORT_SAMPLE_BUDGET = 20000;

// ── the intermediate representation ───────────────────────────────
// A flat, JSON-safe snapshot. Names are resolved, the start/accept
// flags are folded into the states, and every transition carries both
// its raw fields and the rendered label the canvas would show.
export function buildMachineIR() {
  const cfg = getMachineConfig(App.machine);
  const sym = { ...App.config.sym };
  const byId = new Map(App.states.map(s => [s.id, s]));

  const states = App.states.map((s, i) => ({
    id: s.id,
    name: s.name || s.id,
    index: i,
    x: s.x || 0,
    y: s.y || 0,
    isStart: s.id === App.startId,
    isAccept: App.accepts.has(s.id),
    // Moore is the only model that hangs output off the state itself.
    output: s.output !== undefined ? s.output : null
  }));

  const transitions = App.transitions.map(t => {
    const from = byId.get(t.from);
    const to = byId.get(t.to);
    return {
      id: t.id,
      from: t.from,
      to: t.to,
      fromName: from ? (from.name || from.id) : t.from,
      toName: to ? (to.name || to.id) : t.to,
      symbol: t.symbol,
      label: typeof transLabel === 'function' ? transLabel(t) : String(t.symbol),
      // Machine-specific fields, carried through untouched so a format
      // that understands them (TikZ, the CSV table) can show them and
      // one that doesn't can ignore them.
      pop: t.pop ?? null,
      push: t.push ?? null,
      pop2: t.pop2 ?? null,
      push2: t.push2 ?? null,
      write: t.write ?? null,
      dir: t.dir ?? null,
      output: t.output ?? null,
      tapeSyms: t.tapeSyms ? [...t.tapeSyms] : null,
      tapeWrites: t.tapeWrites ? [...t.tapeWrites] : null,
      tapeDirs: t.tapeDirs ? [...t.tapeDirs] : null,
      isSelfLoop: t.from === t.to
    };
  });

  return {
    machine: App.machine,
    machineLabel: cfg.label || App.machine,
    sym,
    sigma: [...App.sigma],
    stackAlpha: [...App.stackAlpha],
    outputAlpha: [...App.outputAlpha],
    tapeCount: App.tapeCount || 1,
    states,
    transitions,
    startId: App.startId,
    startName: byId.get(App.startId)?.name || null,
    accepts: [...App.accepts],
    acceptNames: [...App.accepts].map(id => byId.get(id)?.name || id),
    hasEpsilon: !!cfg.hasEpsilon,
    hasStack: !!cfg.hasStack,
    hasTape: !!cfg.hasTape,
    isTransducer: !!cfg.isTransducer,
    // Multi-character symbols mean words can't be concatenated without a
    // separator; every format that prints a word has to know this.
    isSymbolic: typeof langIsSymbolic === 'function' ? langIsSymbolic() : true,
    grammar: {
      start: App.grammar.start,
      vars: [...App.grammar.vars],
      productions: App.grammar.productions.map(p => ({ lhs: p.lhs, rhs: p.rhs }))
    }
  };
}

// ── words ─────────────────────────────────────────────────────────
// A word is an array of symbols. Rendering one depends on Σ: single
// character symbols concatenate the way a textbook writes them, word
// length symbols need a separator or "openClose" reads as one token.
export function exportWordText(word, ir) {
  if (!word || !word.length) return (ir && ir.sym ? ir.sym.eps : 'ε');
  const symbolic = ir ? ir.isSymbolic : (typeof langIsSymbolic === 'function' ? langIsSymbolic() : true);
  return symbolic ? word.join('') : word.join(' ');
}

// Lazy shortlex walk of Σ*, bounded by both word length and total words
// yielded. An odometer rather than a materialised frontier: |Σ|^len gets
// large enough at modest lengths that holding a level in memory is the
// thing that would break first.
export function* exportSigmaStar(sigma, maxLen, budget) {
  const n = sigma.length;
  let seen = 0;
  if (!n) { yield []; return; }
  for (let len = 0; len <= maxLen; len++) {
    const idx = new Array(len).fill(0);
    while (true) {
      if (++seen > budget) return;
      yield idx.map(i => sigma[i]);
      let p = len - 1;
      while (p >= 0 && ++idx[p] === n) { idx[p] = 0; p--; }
      if (p < 0) break;
    }
  }
}

/**
 * Positive and negative examples of L(M), both in shortlex order.
 *
 * Accepted words come from langAcceptedTraces() where that applies — it
 * walks the transition graph, so it stays proportional to words actually
 * found rather than to |Σ|^depth. Two-way heads and tapes revisit input
 * cells, so a graph path isn't a word for them (langCanTrace draws that
 * line); those machines fall back to the same Σ* walk the rejects use.
 *
 * Rejected words have no such shortcut in either case: "not in L" isn't a
 * path property, so the only sound way to find them is to enumerate Σ*
 * and ask the simulator. Words the machine hasn't decided inside its step
 * budget are reported separately — counting a non-halting run as a reject
 * is exactly the false negative the language panel exists to avoid.
 */
export function exportSampleWords(opts = {}) {
  const wantAcc = opts.accepted === undefined ? 25 : Math.max(0, opts.accepted);
  const wantRej = opts.rejected === undefined ? 25 : Math.max(0, opts.rejected);
  const maxLen = opts.maxLength === undefined ? 10 : Math.max(0, opts.maxLength);
  const budget = opts.budget || EXPORT_SAMPLE_BUDGET;

  const out = { accepted: [], rejected: [], undecided: 0, truncated: false, decidable: true };

  if (typeof langCanDecide === 'function' && !langCanDecide()) {
    // A transducer with no accept notion has no L(M) to sample.
    out.decidable = false;
    return out;
  }
  if (!App.startId) { out.decidable = false; return out; }

  const canTrace = typeof langCanTrace === 'function' && langCanTrace();
  if (canTrace && wantAcc > 0 && typeof langAcceptedTraces === 'function') {
    const res = langAcceptedTraces(wantAcc);
    out.accepted = (res.traces || []).map(w => [...w]);
    if (res.truncated) out.truncated = true;
  }

  const needAcc = wantAcc - out.accepted.length;
  if (wantRej > 0 || needAcc > 0) {
    const sigma = [...App.sigma].filter(s => s !== App.config.sym.eps).sort();
    let addedAcc = 0;
    for (const word of exportSigmaStar(sigma, maxLen, budget)) {
      if (out.rejected.length >= wantRej && addedAcc >= needAcc) break;
      const verdict = typeof langVerdict === 'function' ? langVerdict(word) : 'unk';
      if (verdict === 'unk') { out.undecided++; continue; }
      if (verdict === 'acc') {
        // Only top up when the graph walk was unavailable or came up short;
        // otherwise langAcceptedTraces already holds the true shortlex prefix.
        if (addedAcc < needAcc && !canTrace) { out.accepted.push(word); addedAcc++; }
      } else if (out.rejected.length < wantRej) {
        out.rejected.push(word);
      }
    }
    if (out.rejected.length < wantRej) out.truncated = true;
  }

  return out;
}

// ── file + clipboard plumbing ─────────────────────────────────────
// Mirrors saveJSON()'s approach. Kept here so a new format never has to
// re-derive object-URL lifetime handling.
export function exportDownload(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoke on the next turn: Chrome and Safari need the URL to survive the
  // synchronous click, and leaking it pins the whole blob for the session.
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
}

export function exportCopyText(text, okMsg) {
  const done = () => showStatus(okMsg || 'Copied to clipboard');
  const failed = () => { try { window.prompt('Copy:', text); } catch (e) { showStatus('Could not copy'); } };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(failed);
  } else {
    failed();
  }
}

// ── naming ────────────────────────────────────────────────────────
// Exports inherit the tab's name so a folder of them stays legible;
// falling back to the machine type beats a folder of "automaton (3)".
export function exportBaseName() {
  let name = '';
  try {
    const ws = typeof Workspaces !== 'undefined' && Workspaces.find(w => w.id === activeWorkspaceId);
    if (ws && ws.name) name = ws.name;
  } catch (e) { /* Workspaces may not exist yet during early init */ }
  if (!name) name = App.machine || 'automaton';
  return exportSlug(name) || 'automaton';
}

export function exportSlug(str) {
  return String(str)
    .trim()
    .replace(/[^\w\s.-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();
}

export function exportFilename(ext) {
  return `${exportBaseName()}.${ext}`;
}

// Turns a state name into an identifier that is legal in generated source.
// Collisions are the caller's problem — exportUniqueIdents() below resolves
// them, because "q0" and "q 0" must not silently become the same constant.
export function exportIdent(str, fallback) {
  let s = String(str == null ? '' : str)
    .normalize('NFKD')
    .replace(/[^\w]/g, '_')
    .replace(/^(\d)/, '_$1');
  if (!s || /^_+$/.test(s)) s = fallback || 'S';
  return s;
}

// Stable, collision-free identifiers for a list of states, keyed by id.
export function exportUniqueIdents(states, transform) {
  const used = new Set();
  const map = new Map();
  states.forEach((s, i) => {
    let base = exportIdent(s.name, 'q' + i);
    if (transform) base = transform(base);
    let name = base;
    let n = 2;
    while (used.has(name)) name = `${base}_${n++}`;
    used.add(name);
    map.set(s.id, name);
  });
  return map;
}

// ── shared guards ─────────────────────────────────────────────────
export function exportHasMachine() {
  return App.states.length > 0;
}

export function exportRequireMachine() {
  if (exportHasMachine()) return true;
  showStatus('Nothing to export — the canvas is empty');
  return false;
}
