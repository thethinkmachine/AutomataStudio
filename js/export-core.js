import { LANG_TRACE_DEPTH_CAP, langAcceptedTraces, langCanDecide, langCanTrace, langCoverageTraces, langIsInfinite, langIsSymbolic, langRouteDepth, langVerdict } from './language.js';
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

// Fallback when the machine gives nothing to derive a length from.
export const EXPORT_FALLBACK_LENGTH = 10;

// What stopped a column from listing more. `null` means nothing did: the
// column is every word the request describes, which for a test suite is the
// difference between "complete" and "quietly missing cases".
//
// One flag could not carry this. `truncated` was true when the row count
// filled, when the length bound stopped the search, when the Σ* walk ran out
// of budget and when the graph search did — four different things to change,
// reported identically. These are per column because the two columns are
// bounded by different machinery and routinely stop for different reasons.
export const ExportLimits = {
  ROWS: 'rows',                   // the requested word count filled
  LENGTH: 'length',               // no word of this length or less is left
  WORD_BUDGET: 'word-budget',     // EXPORT_SAMPLE_BUDGET, the Σ* walk
  SEARCH_BUDGET: 'search-budget'  // LANG_TRACE_STEP_BUDGET, the graph walk
};

// Longest word the machine can still produce beyond `maxLen`, conservatively.
// An infinite language always has one. A finite one cannot have a word as
// long as |Q|, since a run that long repeats a state and so pumps.
function mayExceedLength(maxLen) {
  try {
    if (langIsInfinite()) return true;
  } catch (e) { return true; }
  return maxLen < App.states.length;
}

// Machine-derived default for the max-length spinner: long enough that every
// transition can appear in some exported word. See langRouteDepth().
export function exportDefaultMaxLength() {
  try {
    const depth = typeof langRouteDepth === 'function' ? langRouteDepth() : 0;
    if (!depth) return EXPORT_FALLBACK_LENGTH;
    return Math.min(Math.max(depth, 1), LANG_TRACE_DEPTH_CAP);
  } catch (e) {
    return EXPORT_FALLBACK_LENGTH;
  }
}

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
      weight: t.weight ?? null,
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
    isWeighted: !!cfg.isWeighted,
    isOmega: !!cfg.isOmega,
    hasEndMarkers: !!cfg.hasEndMarkers,
    cutPoint: App.config.pfaCutPoint,
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
//
// `minLen` starts the odometer partway up rather than filtering its output,
// so a caller asking for long words does not spend its budget generating
// short ones and throwing them away.
export function* exportSigmaStar(sigma, maxLen, budget, minLen = 0) {
  const n = sigma.length;
  let seen = 0;
  if (!n) { if (minLen <= 0) yield []; return; }
  for (let len = Math.max(0, minLen); len <= maxLen; len++) {
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
 *
 * Three options narrow what counts as a sample. `minLength`/`maxLength`
 * bound both columns; the loop switch acts on the accepted one only.
 *
 * Turning loops off keeps a word only when its run reaches a step no kept
 * word's run has already taken, which drops every word that is another word
 * with a loop gone round again. Without it a single self-loop fills every
 * row with a, aa, aaa — shortlex has no opinion about how interesting a word
 * is, and the k shortest words of a pumped language are all the same word
 * pumped. The surviving rows are still in shortlex order, but they are a
 * subsequence chosen by the machine's shape, so two machines accepting the
 * same language no longer necessarily export the same rows: loops on, the
 * default, keeps that property for anyone relying on it.
 *
 * The dialog spells this as a boolean (`expandLoops`) because that is the
 * decision a user makes; the search underneath takes a count of words per
 * route (`perPath`, 0 = unlimited), which callers may set directly.
 *
 * Neither has meaning for the Σ* path — a rejected word need not have a run
 * at all — so both are ignored when the graph walk is unavailable.
 */
export function exportSampleWords(opts = {}) {
  const wantAcc = opts.accepted === undefined ? 25 : Math.max(0, opts.accepted);
  const wantRej = opts.rejected === undefined ? 25 : Math.max(0, opts.rejected);
  const maxLen = opts.maxLength === undefined ? 10 : Math.max(0, opts.maxLength);
  // Clamped rather than left to produce an empty band: the two spinners are
  // set one at a time, so a min briefly above the max is a half-finished
  // edit, not a request for nothing.
  const minLen = Math.min(Math.max(0, opts.minLength || 0), maxLen);
  const perPath = opts.expandLoops === false
    ? 1
    : Math.max(0, opts.perPath || 0);
  const budget = opts.budget || EXPORT_SAMPLE_BUDGET;

  const out = {
    accepted: [], rejected: [], undecided: 0, truncated: false, decidable: true,
    origin: null, target: null, limits: { accepted: null, rejected: null }
  };

  if (typeof langCanDecide === 'function' && !langCanDecide()) {
    // A transducer with no accept notion has no L(M) to sample.
    out.decidable = false;
    return out;
  }
  if (!App.startId) { out.decidable = false; return out; }

  Object.assign(out, routeLabels(opts));
  return withRoute(opts.origin, opts.target, () => exportSampleWordsFrom(out, {
    wantAcc, wantRej, maxLen, minLen, perPath, budget
  }));
}

// The body of exportSampleWords, split out so the origin swap wraps the whole
// computation rather than being reinstalled around each of its two halves.
function exportSampleWordsFrom(out, { wantAcc, wantRej, maxLen, minLen, perPath, budget }) {
  const canTrace = typeof langCanTrace === 'function' && langCanTrace();
  if (canTrace && wantAcc > 0 && typeof langAcceptedTraces === 'function') {
    const res = langAcceptedTraces(wantAcc, { minLen, maxLen, perPath });
    out.accepted = (res.traces || []).map(w => [...w]);
    if (res.truncated) out.truncated = true;

    // Reported in the order that decides what to change. A filled row count
    // reads as ROWS even when the language happened to end on that exact
    // word: the search stops on the Kth word without asking whether a K+1th
    // exists, and "there may be more" is the safe way to be wrong here.
    if (res.truncated) out.limits.accepted = ExportLimits.SEARCH_BUDGET;
    else if (out.accepted.length >= wantAcc) out.limits.accepted = ExportLimits.ROWS;
    else if (mayExceedLength(maxLen)) out.limits.accepted = ExportLimits.LENGTH;
  }

  // Only top up the accepted column when the graph walk was unavailable;
  // where it ran, what it returned is the answer. Coming up short there is
  // a fact about L(M) and the filters, not a gap for Σ* to paper over —
  // and with `perPath` set, coming up short is the normal case, so treating
  // it as a gap would spend the whole budget re-finding capped words.
  const needAcc = canTrace ? 0 : wantAcc - out.accepted.length;
  if (wantRej > 0 || needAcc > 0) {
    const sigma = [...App.sigma].filter(s => s !== App.config.sym.eps).sort();
    let addedAcc = 0;
    let seen = 0;
    for (const word of exportSigmaStar(sigma, maxLen, budget, minLen)) {
      if (out.rejected.length >= wantRej && addedAcc >= needAcc) break;
      seen++;
      const verdict = typeof langVerdict === 'function' ? langVerdict(word) : 'unk';
      if (verdict === 'unk') { out.undecided++; continue; }
      if (verdict === 'acc') {
        if (addedAcc < needAcc) { out.accepted.push(word); addedAcc++; }
      } else if (out.rejected.length < wantRej) {
        out.rejected.push(word);
      }
    }
    if (out.rejected.length < wantRej) out.truncated = true;

    if (wantRej > 0) {
      if (out.rejected.length >= wantRej) out.limits.rejected = ExportLimits.ROWS;
      else if (seen >= budget) out.limits.rejected = ExportLimits.WORD_BUDGET;
      else out.limits.rejected = ExportLimits.LENGTH;
    }
    // The Σ* walk also fed the accepted column where the graph walk could not.
    if (needAcc > 0) {
      if (addedAcc >= needAcc) out.limits.accepted = ExportLimits.ROWS;
      else if (seen >= budget) out.limits.accepted = ExportLimits.WORD_BUDGET;
      else if (mayExceedLength(maxLen)) out.limits.accepted = ExportLimits.LENGTH;
    }
  }

  return out;
}

// ── choosing where a route starts and ends ────────────────────────
// Both language exports route from the start state to the accept set. Asking
// for "words from x to y" is asking about L of the same machine started in x
// with {y} for its accept set — so every part of the computation has to agree
// about both ends, including the simulators that verify each candidate word.
// Those read App.startId and App.accepts directly, and threading a route
// through every one of them would touch a dozen call sites to serve an export.
//
// So the route is installed for the duration of the computation instead. It
// is sound because the swap spans the whole read: nothing here mutates,
// delivery is synchronous, and the restore is in a finally. It is emphatically
// not a pattern to copy into anything that emits, snapshots, or awaits.
//
// Swapping the accept set is only equivalent to "ends at y" because every
// machine langCanTrace() covers accepts by final state — isPdaAcceptingConfig
// is `App.accepts.has(state) && input consumed`, with no accept-by-empty-stack
// mode anywhere. A machine type that accepted some other way would need more
// than this.
export function exportResolveOrigin(id) {
  if (!id) return App.startId;
  return App.states.some(s => s.id === id) ? id : App.startId;
}

// null means "leave the machine's own accept set alone".
export function exportResolveTarget(id) {
  if (!id) return null;
  return App.states.some(s => s.id === id) ? id : null;
}

function withRoute(originId, targetId, fn) {
  const origin = exportResolveOrigin(originId);
  const target = exportResolveTarget(targetId);
  const moveStart = origin && origin !== App.startId;
  if (!moveStart && target === null) return fn();

  const savedStart = App.startId;
  const savedAccepts = App.accepts;
  if (moveStart) App.startId = origin;
  if (target !== null) App.accepts = new Set([target]);
  try {
    return fn();
  } finally {
    App.startId = savedStart;
    App.accepts = savedAccepts;
  }
}

// Longest word needed to reach every transition *on the chosen route*. The
// max-length default is computed once when the dialog opens, so re-aiming the
// route afterwards can leave it too short; this is what the dialog compares
// against to say so.
export function exportRouteDepth(opts = {}) {
  return withRoute(opts.origin, opts.target, () => {
    try {
      return typeof langRouteDepth === 'function' ? langRouteDepth() : 0;
    } catch (e) {
      return 0;
    }
  });
}

// Whether the graph walk — and so everything built on it, the loop switch
// included — applies to this machine at all.
export function exportCanTrace() {
  try {
    return typeof langCanTrace === 'function' ? langCanTrace() : false;
  } catch (e) {
    return false;
  }
}

// The names the export reports for each end of the route.
function routeLabels(opts) {
  const nameOf = id => App.states.find(s => s.id === id)?.name || null;
  const target = exportResolveTarget(opts.target);
  return { origin: nameOf(exportResolveOrigin(opts.origin)), target: target ? nameOf(target) : null };
}

/**
 * One accepted word per transition, for the coverage export.
 *
 * Thin over langCoverageTraces(): the gating is the point. A machine with
 * no accept notion has nothing to route towards, and a machine outside
 * langCanTrace() revisits input cells, so a path through its graph is not
 * a word at all — for those two the mode is meaningless rather than empty,
 * and the dialog says so instead of writing a file with no rows.
 */
export function exportCoverageWords(opts = {}) {
  const out = { rows: [], uncovered: [], decidable: true, traceable: true, reason: null, origin: null, target: null };
  if (typeof langCanDecide === 'function' && !langCanDecide()) { out.decidable = false; return out; }
  if (typeof langCanTrace === 'function' && !langCanTrace()) { out.traceable = false; return out; }
  if (!App.startId) { out.reason = 'no start state'; return out; }

  Object.assign(out, routeLabels(opts));

  return withRoute(opts.origin, opts.target, () => {
    // With an end state chosen, "cannot reach an accept" would name something
    // the user did not ask about.
    const cov = langCoverageTraces({ goalLabel: out.target ? `the end state ${out.target}` : 'an accept' });
    out.rows = cov.rows;
    out.uncovered = cov.uncovered;
    out.reason = cov.reason;
    return out;
  });
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
