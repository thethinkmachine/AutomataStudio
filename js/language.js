import { wrap } from './canvas.js';
import { openExportCodeModal } from './export-ui.js';
import { _regexCacheKey, updateDefBoxOverflowShadow } from './render.js';
import { runSim } from './simulation.js';
import { decideWord, inFamily, machineFormal } from './machines/index.js';
import { langStepBudget } from './machines/runtime.js';
import { $, App, getMachineConfig, isOmegaAutomaton, omegaAcceptanceOf, statePriority } from './state.js';
import { getState } from './states-transitions.js';
import { toggleRPSection } from './ui.js';
import { isAnyPDA, isAnyTM } from './utils.js';

// ══════════════════════════════════════════════════════════════════
//  LANGUAGE PANEL
// ══════════════════════════════════════════════════════════════════
//  The section answers "what is L(M)?" in one of two registers,
//  chosen by the shape of Σ rather than by machine type:
//
//    symbolic   — every symbol is one character. L is shown as a
//                 fingerprint: Σ* in shortlex order, one cell per
//                 word, accepted cells lit. Σ* has no end, so the
//                 grid scrolls: a sentinel pulls the next rows out
//                 of a paused enumeration, the way the trace list
//                 below does, and a cell is decided only once it is
//                 about to be looked at.
//    vocabulary — some symbol is a word. Σ* is exponential in |Σ|,
//                 so at (say) 17 event names a fingerprint never
//                 reaches a length that holds an accepted word — not
//                 at any amount of scrolling. L is shown as accepted
//                 traces instead: shortlex over L(M) itself, found by
//                 walking the machine.
//
//  Both sit under the same one-line formal definition whose
//  components are clickable and cross-highlight the canvas.
// ══════════════════════════════════════════════════════════════════

export const LANG_FP_ROW_CELLS = 20;     // cells drawn on one gutter row; the
                                         // column count in css/views.css is the
                                         // same number and has to stay so
export const LANG_FP_ROWS = 8;           // rows drawn before the reader must scroll
export const LANG_FP_PAGE = 6;           // rows pulled per scroll-triggered batch
export const LANG_FP_CELL_CAP = 8192;    // hard backstop: one full simulation per cell
export const LANG_FP_DEPTH_CAP = 512;    // hard backstop on word length. Binds only
                                         // for a one-symbol Σ, where a block never
                                         // grows and the cell cap alone would let
                                         // the reader scroll to length 8192
export const LANG_TRACE_ROWS = 6;        // rows shown before the user has to scroll
export const LANG_TRACE_PAGE = 20;       // rows fetched per scroll-triggered batch
export const LANG_TRACE_DEPTH_CAP = 300; // hard backstop on word length; the step
                                   // budget below is what actually binds
export const LANG_TRACE_STEP_BUDGET = 400000; // search-tree nodes per generator,
                                        // keeps a pathological graph from
                                        // freezing the tab while scrolling

// ── mode ──────────────────────────────────────────────────────────
// The one heuristic the whole section turns on.
export function langIsSymbolic() {
  for (const s of App.sigma) if ([...s].length !== 1) return false;
  return true;
}

// Turing machines are included: testTMVerdict answers three-valued, so a
// word the machine has not decided is drawn as "no verdict" rather than
// silently counted as a reject. A transducer only has an accept/reject
// notion when the user has opted into one.
// A Büchi automaton's language is a set of infinite words, so no enumeration of
// Σ* says anything about it — the panel reports "no verdict" rather than
// pretending the finite words it can list are members or non-members.
export function langCanDecide() {
  const m = App.machine;
  if (isOmegaAutomaton(m)) return false;
  if (getMachineConfig(m).isTransducer && !App.config.transducerAccepts) return false;
  return true;
}

// Walking the transition graph only yields meaningful words when edges
// consume input left to right. Two-way heads and tapes revisit cells,
// so a path through the graph is not a word.
export function langCanTrace() {
  const m = App.machine;
  return inFamily(m, 'finite') || isAnyPDA(m);
}

// ── the vocabulary: abbreviations, actor groups, usage ─────────────
// camelCase / PascalCase → initials. "citizenFilesComplaint" → "cFC".
export function langAbbrev(sym) {
  const parts = sym.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_\-.]+/).filter(Boolean);
  if (!parts.length) return sym.slice(0, 3);
  return parts.map((p, i) => i === 0 ? [...p][0] : [...p][0].toUpperCase()).join('');
}

// Actor = the leading lowercase run before the first capital. A
// PascalCase name has none, which is itself worth surfacing.
export function langActor(sym) {
  const m = sym.match(/^[a-z][a-z0-9]*/);
  return m ? m[0] : '';
}

export let _langVocab = { key: '', val: null };
export function _langVocabKey() {
  return [...App.sigma].join('') + '||' +
    App.transitions.map(t => t.symbol).sort().join('');
}

export function langVocab() {
  const key = _langVocabKey();
  if (_langVocab.key === key && _langVocab.val) return _langVocab.val;

  const sigma = [...App.sigma];
  const any = App.config.sym.any;
  const uses = {};
  sigma.forEach(s => { uses[s] = 0; });
  let wildcards = 0;
  for (const t of App.transitions) {
    if (t.symbol === any) wildcards++;
    else if (Object.prototype.hasOwnProperty.call(uses, t.symbol)) uses[t.symbol]++;
  }

  // Digit suffixes only where initials actually collide.
  const taken = Object.create(null), abbr = {};
  for (const s of sigma) {
    let a = langAbbrev(s); const base = a; let n = 2;
    while (taken[a]) a = base + (n++);
    taken[a] = true; abbr[s] = a;
  }

  const groups = {};
  for (const s of sigma) { const g = langActor(s); (groups[g] = groups[g] || []).push(s); }
  // Two categorical hues, never more: the two largest actor groups.
  // Everything else stays neutral, which makes the odd-one-out names
  // flag themselves without anyone writing a rule.
  const ranked = Object.keys(groups)
    .filter(g => g && groups[g].length > 1)
    .sort((a, b) => groups[b].length - groups[a].length || a.localeCompare(b));
  const slot = {};
  sigma.forEach(s => { slot[s] = 0; });
  ranked.slice(0, 2).forEach((g, i) => groups[g].forEach(s => { slot[s] = i + 1; }));

  const dead = wildcards ? [] : sigma.filter(s => !uses[s]);
  const val = { sigma, uses, abbr, groups, ranked, slot, dead, wildcards };
  _langVocab = { key, val };
  return val;
}

// ── deciding a word ───────────────────────────────────────────────
// The same verdict the batch tester and StateMate's verification get,
// from the same place: a word shown here is accepted by exactly the
// machine the reader runs. `null` back from decideWord means this
// machine does not read finite words at all — an ω-automaton — and no
// enumeration of Σ* says anything about its language.
export function langVerdict(tokens) {
  try {
    return decideWord(App.machine, tokens)?.verdict ?? 'unk';
  } catch (e) {
    return 'unk';
  }
}

// ── fingerprint (symbolic mode) ───────────────────────────────────
// Shortlex over Σ*: shorter words first, ties broken on the alphabet's
// own order, with the *last* symbol varying fastest inside a length.
//
// Words are addressed, not accumulated. The i-th word of length L is i
// written in base |Σ|, so the enumeration can start drawing at any
// offset without building — or holding — everything before it. That is
// what lets the grid be scrolled rather than budgeted: a length block
// is |Σ|^L words, which at seventeen event names is a hundred thousand
// arrays by length four, and the reader who scrolls that far looks at
// twenty of them at a time.
export function langSigmaOrdered() {
  return [...App.sigma].filter(s => s !== App.config.sym.eps).sort();
}

export function langWordAt(sigma, len, idx) {
  const n = sigma.length;
  if (!n) return [];
  const w = new Array(len);
  for (let k = len - 1; k >= 0; k--) { w[k] = sigma[idx % n]; idx = Math.floor(idx / n); }
  return w;
}

// The fingerprint as a stream of gutter rows, ready to draw and paused
// between them. Two shapes, and the size of Σ picks which:
//
//   |Σ| ≥ 2 — one row per length block, wrapped every LANG_FP_ROW_CELLS
//             cells. The block is the unit being compared, so it gets
//             the gutter number and a line of its own.
//   |Σ| ≤ 1 — one row per LANG_FP_ROW_CELLS *lengths*. A unary block
//             holds exactly one word, so a row per block is a column of
//             single cells — 128 rows tall, one cell wide, with the
//             length gutter counting to 127. That is not a fingerprint
//             of anything: what a unary language has to show is its
//             period, and a period is only visible along a ribbon.
//
// A row is addressed, not just drawn: `len` plus `off` locates its first
// word in the enumeration, and `span` says the row walks lengths rather
// than a block. That is enough to rebuild any cell's word from where the
// cell sits, which is what lets the grid carry no per-cell data at all.
//
// `state.capped` says the stream stopped at a backstop rather than at
// the end of Σ*, which is the difference between "that is all of it"
// and "there is more, we stopped counting".
export function* langFingerprintRows(state = {}, opts = {}) {
  const sigma = langSigmaOrdered();
  const n = sigma.length;
  const cellCap = opts.cellCap ?? LANG_FP_CELL_CAP;
  const depthCap = opts.depthCap ?? LANG_FP_DEPTH_CAP;
  const rowCells = opts.rowCells ?? LANG_FP_ROW_CELLS;
  state.capped = false;

  // With no symbols at all, Σ* is {ε} — one cell, and genuinely all of it.
  if (!n) { yield { len: 0, off: 0, words: [[]], span: false }; return; }

  let cells = 0;

  if (n === 1) {
    for (let len = 0; len <= depthCap && cells < cellCap;) {
      const start = len, words = [];
      while (words.length < rowCells && len <= depthCap && cells < cellCap) {
        words.push(langWordAt(sigma, len, 0)); len++; cells++;
      }
      yield { len: start, off: 0, words, span: true };
    }
    state.capped = true;   // Σ* over one symbol never runs out
    return;
  }

  for (let len = 0, size = 1; len <= depthCap; len++, size *= n) {
    for (let i = 0; i < size; i += rowCells) {
      if (cells >= cellCap) { state.capped = true; return; }
      const take = Math.min(rowCells, size - i, cellCap - cells);
      const words = new Array(take);
      for (let k = 0; k < take; k++) words[k] = langWordAt(sigma, len, i + k);
      cells += take;
      yield { len, off: i, words, span: false };
    }
  }
  state.capped = true;
}

// How many cells a fingerprint would need to reach a given length.
export function langCellsToReach(n, L) {
  if (n <= 1) return L + 1;
  return Math.round((Math.pow(n, L + 1) - 1) / (n - 1));
}

// ── accepted traces (vocabulary mode) ─────────────────────────────
// Candidates come from walking the graph — linear in the machine, not
// exponential in |Σ| — and every candidate is then verified with the
// real simulator, so a stack-sensitive machine never reports a word it
// would actually reject.
//
// Selection is strict shortlex over L(M): shortest first, ties broken
// on the alphabet's own order. That is what makes the list a signature
// — the k shortest words of a language depend on the language alone,
// so two machines accepting the same strings produce the same rows
// however differently they happen to be drawn.

// Shared scaffolding for both the trace search and the infinite-language
// check: index transitions once, and compute the shortest number of
// *real* symbols from every state to some accept (ε edges cost nothing).
// A state absent from `dist` cannot reach an accept at all — that is
// exactly the states pruning removes, and removing them is a language
// property, so it cannot skew the ordering.
export function _langGraph() {
  const eps = App.config.sym.eps;
  const any = App.config.sym.any;
  const sigma = [...App.sigma].filter(s => s !== eps).sort();

  const out = new Map(), rev = new Map();
  for (const t of App.transitions) {
    if (!out.has(t.from)) out.set(t.from, []);
    out.get(t.from).push(t);
    if (!rev.has(t.to)) rev.set(t.to, []);
    rev.get(t.to).push(t);
  }

  // 0-1 BFS on the reversed graph: ε-edges cost 0, real symbols cost 1.
  const dist = new Map();
  const deque = [];
  for (const a of App.accepts) { dist.set(a, 0); deque.push(a); }
  const done = new Set();
  while (deque.length) {
    const x = deque.shift();
    if (done.has(x)) continue;
    done.add(x);
    const dx = dist.get(x);
    for (const t of (rev.get(x) || [])) {
      const p = t.from, w = t.symbol === eps ? 0 : 1, nd = dx + w;
      if (!dist.has(p) || nd < dist.get(p)) {
        dist.set(p, nd);
        if (w === 0) deque.unshift(p); else deque.push(p);
      }
    }
  }
  const live = new Set(dist.keys());

  const closure = (id) => {
    const seen = new Set([id]), st = [id];
    while (st.length) {
      const x = st.pop();
      for (const t of (out.get(x) || [])) {
        if (t.symbol === eps && !seen.has(t.to)) { seen.add(t.to); st.push(t.to); }
      }
    }
    return seen;
  };

  return { eps, any, sigma, out, rev, live, dist, closure };
}

// L(M) is infinite iff some state that is both reachable from the start
// and live (able to reach an accept) sits on a cycle built from ≥1 real
// symbol. That is exact for every machine langCanTrace() covers, stack
// included: revisiting a graph state after consuming input is a cycle by
// definition, and a path touching no state twice is bounded by |Q| — no
// stack discipline can stretch it further.
export function langIsInfinite() {
  if (!App.startId || !App.accepts.size) return false;
  const g = _langGraph();
  const startSubset = new Set([...g.closure(App.startId)].filter(id => g.live.has(id)));
  if (!startSubset.size) return false;

  const edgesOf = (id) => {
    const dest = new Set();
    for (const t of (g.out.get(id) || [])) {
      if (t.symbol === g.eps) continue;
      for (const to of g.closure(t.to)) if (g.live.has(to)) dest.add(to);
    }
    return dest;
  };

  const reach = new Set(startSubset);
  const stack = [...startSubset];
  while (stack.length) {
    const x = stack.pop();
    for (const to of edgesOf(x)) if (!reach.has(to)) { reach.add(to); stack.push(to); }
  }

  // 3-colour DFS for a back-edge, restricted to `reach`.
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...reach].map(id => [id, WHITE]));
  for (const start of reach) {
    if (color.get(start) !== WHITE) continue;
    const frames = [[start, edgesOf(start).values()]];
    color.set(start, GRAY);
    while (frames.length) {
      const top = frames[frames.length - 1];
      const nx = top[1].next();
      if (nx.done) { color.set(top[0], BLACK); frames.pop(); continue; }
      const c = color.get(nx.value);
      if (c === GRAY) return true;
      if (c === WHITE) { color.set(nx.value, GRAY); frames.push([nx.value, edgesOf(nx.value).values()]); }
    }
  }
  return false;
}

// Lazily yields every accepted word in exact shortlex order — no length
// materialises a frontier, and no row count is baked in, so the caller
// can pull one word or a thousand from the same paused generator.
//
// It is a branch-and-bound DFS, iterative-deepening over target length:
// at each subset of live states, `dist` tells the search instantly
// whether reaching an accept within the symbols left is even possible,
// so the walk stays proportional to accepted words actually found rather
// than to |Σ|^depth. Symbols are tried in alphabet order at every branch,
// which is what makes a fixed-length pass emit in lex order; length
// dominates shortlex, so increasing the target length after each
// exhausted pass keeps the overall sequence correct.
//
// `opts` narrows the sequence without reordering it, for callers that want
// a spread of the language rather than its shortlex prefix (the export
// dialog; the sidebar list passes nothing and gets the full sequence):
//
//   minLen   skip words shorter than this — the deepening simply starts
//            there, so skipped lengths cost nothing rather than being
//            generated and filtered
//   maxLen   stop deepening after this (still capped by DEPTH_CAP)
//   perPath  at most this many words per loop-free path skeleton; 0 = all
//
// The skeleton is what makes `perPath` mean "fewer loop repeats" rather
// than "fewer words": it is the run with its cycles collapsed out, so two
// words share one exactly when they differ only in how many times they go
// round. See _langPathSkeleton below.
export function* _langTraceWords(g, state, opts = {}) {
  const startSubset = new Set([...g.closure(App.startId)].filter(id => g.live.has(id)));
  if (!startSubset.size) return;

  const maxDepth = Math.min(
    opts.maxLen === undefined || opts.maxLen === null ? LANG_TRACE_DEPTH_CAP : opts.maxLen,
    LANG_TRACE_DEPTH_CAP
  );
  const minDepth = Math.max(0, opts.minLen || 0);
  const perPath = Math.max(0, opts.perPath || 0);

  // Tracked only when the cap is on: maintaining it costs an allocation per
  // branch, and the uncapped search is the hot one.
  const path = [];
  const pathSeen = new Map();
  const admit = () => {
    if (!perPath) return true;
    const key = _langPathSkeleton(path);
    const n = pathSeen.get(key) || 0;
    if (n >= perPath) return false;
    pathSeen.set(key, n + 1);
    return true;
  };

  const subsetMinDist = (subset) => {
    let m = Infinity;
    for (const s of subset) { const d = g.dist.get(s); if (d < m) m = d; }
    return m;
  };
  const hasAccept = (subset) => { for (const s of subset) if (App.accepts.has(s)) return true; return false; };
  // a wildcard edge stands for every symbol in Σ
  const step = (subset, sym) => {
    const dest = new Set();
    for (const s of subset) {
      for (const t of (g.out.get(s) || [])) {
        if (t.symbol !== sym && t.symbol !== g.any) continue;
        for (const to of g.closure(t.to)) if (g.live.has(to)) dest.add(to);
      }
    }
    return dest;
  };

  function* dfs(subset, word, budget) {
    if (state.truncated) return;
    if (++state.steps > LANG_TRACE_STEP_BUDGET) { state.truncated = true; return; }
    if (subsetMinDist(subset) > budget) return;
    if (budget === 0) {
      // admit() last: it has the side effect of consuming the path's quota,
      // so a word the simulator goes on to reject must not spend one.
      if (hasAccept(subset) && langVerdict(word) === 'acc' && admit()) yield word;
      return;
    }
    for (const sym of g.sigma) {
      const next = step(subset, sym);
      if (next.size) {
        if (perPath) path.push({ k: _langSubsetKey(next), s: sym });
        yield* dfs(next, word.concat([sym]), budget - 1);
        if (perPath) path.pop();
      }
      if (state.truncated) return;
    }
  }

  if (perPath) path.push({ k: _langSubsetKey(startSubset), s: null });
  for (let depth = minDepth; depth <= maxDepth; depth++) {
    yield* dfs(startSubset, [], depth);
    if (state.truncated) return;
  }
}

// A configuration here is a subset of states, so that is what a step of the
// run lands on.
export function _langSubsetKey(subset) {
  return [...subset].sort().join(',');
}

// The run with its loops collapsed out: walk the steps, and whenever one
// repeats a step the run has already taken, drop everything back to that
// first occurrence. What survives touches no step twice, so "a", "aa" and
// "aaa" all share one skeleton on a self-loop.
//
// A step is identified by the symbol *and* the subset it lands on, not the
// subset alone. Keying on the subset alone reads a one-state machine as
// having exactly one loop-free run — every word over (0|1)* would collapse
// onto ε — which is the wrong answer to the case the cap exists for. The
// cost of the finer key is that a cycle leaving and re-entering a state by
// different edges is kept rather than collapsed: it is a route the other
// words do not cover, so it survives as its own skeleton.
export function _langPathSkeleton(path) {
  const out = [];
  const at = new Map();
  for (const e of path) {
    const k = e.s === null ? e.k : e.s + '>' + e.k;
    const prev = at.get(k);
    if (prev === undefined) { at.set(k, out.length); out.push(k); continue; }
    for (let i = prev + 1; i < out.length; i++) at.delete(out[i]);
    out.length = prev + 1;
  }
  return out.join('|');
}

export function langAcceptedTraces(K, opts) {
  K = K || LANG_TRACE_ROWS;
  if (!App.startId) return { traces: [], reason: 'no start state' };
  if (!App.accepts.size) return { traces: [], reason: 'no accepting state' };

  const g = _langGraph();
  const state = { steps: 0, truncated: false };
  const traces = [];
  for (const w of _langTraceWords(g, state, opts)) {
    traces.push(w);
    if (traces.length >= K) break;
  }

  return { traces, truncated: state.truncated, reason: traces.length ? null : 'no accepted word found within the search budget' };
}

// ── transition coverage ───────────────────────────────────────────
// The trace search answers "what words are in L?". This answers "what words
// exercise the machine?" — one accepted word per transition, so every loop
// is taken once and no edge goes unvisited for want of a reason to enter it.
//
// The two questions want different searches, which is why this is not a
// filter over the trace list. Selecting words by language properties can
// never guarantee edge coverage: on a machine where two edges carry the same
// symbol into the same state, no shortlex prefix distinguishes them, and a
// cycle can be unreachable by any word short enough to be in the list.
//
// Each word is built rather than found: a shortest route to the edge, the
// edge, then a shortest route on to an accept. Both halves are 0-1 BFS with
// ε free — the same pass `_langGraph` runs to compute `dist`, once forwards
// from the start and once backwards from F.
//
// Two honest limits, both reported rather than hidden:
//
//   • The graph over-approximates a PDA, so a route through it need not be
//     a word the stack allows. Every word is verified with the real
//     simulator, and a transition whose word does not verify is listed as
//     uncovered rather than exported as a lie.
//   • "This word exercises this edge" is exact for a DFA with no wildcards.
//     Under nondeterminism the word is accepted but the simulator may reach
//     the accept by a different run, and a wildcard edge is probed with one
//     concrete symbol that a more specific edge may claim first. The word is
//     still accepted and still the shortest route through that edge; it is
//     the exclusivity that weakens.

// The symbol a route spends to cross `t`: null for ε (free), a concrete
// symbol otherwise, and `undefined` when the edge cannot be spent at all —
// a wildcard stands for every symbol in Σ, so with Σ empty it stands for
// none. Both BFS passes skip those edges rather than putting a hole in a
// word: a route with an unspendable symbol in it is not a route, and one
// that reached the exporter would be a word the file could not spell.
function _langStepSymbol(g, t, concrete) {
  if (t.symbol === g.eps) return null;
  return concrete(t.symbol);
}

// Shortest word from `startId` to every state it can reach.
function _langShortestFrom(g, startId, concrete) {
  const best = new Map([[startId, []]]);
  const dist = new Map([[startId, 0]]);
  const deque = [startId];
  const done = new Set();
  while (deque.length) {
    const x = deque.shift();
    if (done.has(x)) continue;
    done.add(x);
    const dx = dist.get(x);
    for (const t of (g.out.get(x) || [])) {
      const sym = _langStepSymbol(g, t, concrete);
      if (sym === undefined) continue;
      const free = sym === null;
      const nd = dx + (free ? 0 : 1);
      if (dist.has(t.to) && nd >= dist.get(t.to)) continue;
      dist.set(t.to, nd);
      best.set(t.to, free ? best.get(x) : best.get(x).concat([sym]));
      if (free) deque.unshift(t.to); else deque.push(t.to);
    }
  }
  return best;
}

// Shortest word from every state on to an accept, and which accept it is.
function _langShortestToAccept(g, concrete) {
  const best = new Map();
  const dist = new Map();
  const deque = [];
  for (const a of App.accepts) { dist.set(a, 0); best.set(a, { word: [], accept: a }); deque.push(a); }
  const done = new Set();
  while (deque.length) {
    const x = deque.shift();
    if (done.has(x)) continue;
    done.add(x);
    const dx = dist.get(x);
    for (const t of (g.rev.get(x) || [])) {
      const sym = _langStepSymbol(g, t, concrete);
      if (sym === undefined) continue;
      const free = sym === null;
      const nd = dx + (free ? 0 : 1);
      if (dist.has(t.from) && nd >= dist.get(t.from)) continue;
      dist.set(t.from, nd);
      const bx = best.get(x);
      best.set(t.from, { word: free ? bx.word : [sym].concat(bx.word), accept: bx.accept });
      if (free) deque.unshift(t.from); else deque.push(t.from);
    }
  }
  return best;
}

// The shared half of "route a word through this transition": one graph index
// and both BFS passes. langRouteDepth() wants only the lengths and skips the
// simulator; langCoverageTraces() wants the words and verifies each one.
function _langRoutePlan() {
  const g = _langGraph();
  // A wildcard edge stands for all of Σ; probe it with one concrete symbol.
  const concrete = (sym) => (sym === g.any ? g.sigma[0] : sym);
  return {
    g,
    concrete,
    prefix: _langShortestFrom(g, App.startId, concrete),
    suffix: _langShortestToAccept(g, concrete)
  };
}

// The route through `t`: shortest way in, the edge, shortest way on to an
// accept — or the reason there isn't one. One place decides what a route is,
// so the depth estimate and the coverage export cannot disagree about it.
function _langRouteThrough(plan, t) {
  const pre = plan.prefix.get(t.from);
  if (!pre) return { reason: () => 'source state is unreachable' };
  const post = plan.suffix.get(t.to);
  if (!post) return { reason: goal => `target state cannot reach ${goal}` };

  const sym = _langStepSymbol(plan.g, t, plan.concrete);
  if (sym === undefined) return { reason: () => 'wildcard edge with an empty alphabet' };

  return { word: pre.concat(sym === null ? [] : [sym], post.word), accept: post.accept };
}

// The length of the longest word transition coverage needs — the worst
// "shortest route in, one edge, shortest route out" over every transition.
//
// It is what a max-length default should be derived from rather than
// guessed: below it some edge of the machine cannot appear in any exported
// word at all, and above it the extra length buys only longer words through
// edges already covered. Two BFS, so it is cheap enough to compute whenever
// the dialog opens. 0 means there is nothing to route (no start, no accept,
// or no transitions), and the caller should fall back to a constant.
export function langRouteDepth() {
  if (!App.startId || !App.accepts.size || !App.transitions.length) return 0;
  const plan = _langRoutePlan();
  let longest = 0;
  for (const t of App.transitions) {
    const route = _langRouteThrough(plan, t);
    if (route.word && route.word.length > longest) longest = route.word.length;
  }
  return longest;
}

export function langCoverageTraces(opts = {}) {
  // What the suffix routes towards, for the messages only. The export can
  // rename it when the caller has swapped the accept set for one chosen state.
  const goal = opts.goalLabel || 'an accept';
  const out = { rows: [], uncovered: [], reason: null };
  if (!App.startId) { out.reason = 'no start state'; return out; }
  if (!App.accepts.size) { out.reason = 'no accepting state'; return out; }
  if (!App.transitions.length) { out.reason = 'no transitions'; return out; }

  const plan = _langRoutePlan();
  const nameOf = (id) => getState(id)?.name || id;

  for (const t of App.transitions) {
    const edge = { id: t.id, from: nameOf(t.from), to: nameOf(t.to), symbol: t.symbol };
    const route = _langRouteThrough(plan, t);
    if (route.reason) { out.uncovered.push({ ...edge, reason: route.reason(goal) }); continue; }
    if (langVerdict(route.word) !== 'acc') {
      out.uncovered.push({ ...edge, reason: 'no accepted word runs through this transition' });
      continue;
    }
    out.rows.push({ ...edge, word: route.word, accept: nameOf(route.accept) });
  }

  return out;
}

// ── the formal definition, as one line ────────────────────────────
// Which components a machine's tuple has, and what δ's signature reads,
// are facts about that machine — so both come from its definition rather
// than from a chain of thirty string comparisons whose *order* was
// load-bearing. (It was: a PDT had to be tested before the pushdown
// family or the output alphabet silently vanished from the tuple, and a
// 2DFT before the two-way heads for the same reason.)
export function langTupleSyms() {
  return machineFormal(App.machine)?.tuple?.() || ['Q', 'Σ', 'δ', 'q₀', 'F'];
}

export function langTupleInfo(sym) {
  const m = App.machine;
  const names = (ids) => App.states.filter(s => ids.has(s.id)).map(s => s.name);
  const set = (arr) => arr.length ? '{' + arr.join(', ') + '}' : '∅';
  switch (sym) {
    case 'Q': return { n: App.states.length, say: 'states', val: set(App.states.map(s => s.name)) };
    case 'Σ': return { n: App.sigma.size, say: 'input alphabet', val: set([...App.sigma]) };
    case 'Γ': case 'Γ₁': case 'Γ₂':
      return {
        n: App.stackAlpha.size, val: set([...App.stackAlpha]),
        say: machineFormal(m)?.storeSay || 'stack alphabet'
      };
    case 'Δ': return { n: App.outputAlpha.size, say: 'output alphabet', val: set([...App.outputAlpha]) };
    case 'F': return {
      n: App.accepts.size,
      say: isOmegaAutomaton(m)
        ? (omegaAcceptanceOf() === 'cobuchi'
          ? 'co-Büchi states (must be visited only finitely often)'
          : 'Büchi accepting states (visited infinitely often)')
        : 'accepting states',
      val: set(names(App.accepts))
    };
    case 'Ω': {
      const used = [...new Set(App.states.map(statePriority))].sort((a, b) => a - b);
      return {
        n: used.length,
        say: 'priority function (accept when the least recurring priority is even)',
        val: used.length ? '{' + used.join(', ') + '}' : '∅'
      };
    }
    case 'q₀': return { n: null, say: 'start state', val: getState(App.startId)?.name || '—' };
    case 'Z₀': return { n: null, say: 'initial stack symbol', val: App.config.sym.stackBottom };
    case 'δ': return { n: App.transitions.length, say: 'transition function', val: langDeltaSignature() };
    // λ is the output function everywhere except a PFA, where the same
    // letter names the cut-point the accepting mass is compared against.
    // Moore emits per state and everyone else per transition, so the
    // cardinality shown follows the machine rather than the tuple slot.
    case 'λ': {
      const formal = machineFormal(m);
      if (formal?.cutPoint) {
        return { n: null, say: 'cut-point (accept when P(w) > λ)', val: String(App.config.pfaCutPoint) };
      }
      return {
        n: formal?.outputPerState ? App.states.length : App.transitions.length,
        say: 'output function',
        val: formal?.outputSay || 'Q × (Σ ∪ {ε}) × Q → Δ*'
      };
    }
  }
  return { n: null, say: '', val: '—' };
}

export function langDeltaSignature() {
  return machineFormal(App.machine)?.delta?.() || '';
}

// ── canvas cross-highlight ────────────────────────────────────────
// Reuses the same classes the state/transition lists use for their
// hover highlight, so pointing at δ here looks like pointing at a
// transition row over there.
export function langClearHighlight() {
  document.querySelectorAll('.sn.list-hover-st').forEach(el => el.classList.remove('list-hover-st'));
  document.querySelectorAll('.edge-g.list-hover-t').forEach(el => el.classList.remove('list-hover-t'));
}

export function langHighlight(sym) {
  langClearHighlight();
  const litStates = (ids) => ids.forEach(id => {
    const el = App.domCache.states.get(id) || document.querySelector(`.sn[data-id="${id}"]`);
    if (el) el.classList.add('list-hover-st');
  });
  const litEdges = (pred) => {
    const keys = new Set();
    App.transitions.forEach(t => { if (pred(t)) keys.add(t.from + '|' + t.to); });
    keys.forEach(k => {
      const el = App.domCache.transitions.get(k) || document.querySelector(`.edge-g[data-edge="${k}"]`);
      if (el) el.classList.add('list-hover-t');
    });
  };
  if (sym === 'Q') litStates(App.states.map(s => s.id));
  else if (sym === 'F') litStates([...App.accepts]);
  else if (sym === 'q₀') { if (App.startId) litStates([App.startId]); }
  else if (sym === 'δ' || sym === 'λ') litEdges(() => true);
  else if (sym === 'Σ') litEdges(t => App.sigma.has(t.symbol) || t.symbol === App.config.sym.any);
}

// Highlight every transition carrying one particular input symbol.
export function langHighlightSymbol(sym, on) {
  const keys = new Set();
  App.transitions.forEach(t => { if (t.symbol === sym) keys.add(t.from + '|' + t.to); });
  keys.forEach(k => {
    const el = App.domCache.transitions.get(k) || document.querySelector(`.edge-g[data-edge="${k}"]`);
    if (el) el.classList.toggle('list-hover-t', on);
  });
}

// ── rendering ─────────────────────────────────────────────────────
export function _le(tag, cls, txt) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
}

// Hue is never the only channel: each code's first letter is the actor
// initial, so the grouping survives CVD, greyscale and forced-colors.
export function langSymChip(sym, opts = {}) {
  const v = langVocab();
  const cls = 'lang-sym' + (v.slot[sym] ? ' g' + v.slot[sym] : '') +
    (!opts.plain && !v.uses[sym] && !v.wildcards ? ' dead' : '');
  const c = _le('span', cls, langIsSymbolic() ? sym : v.abbr[sym]);
  const n = v.uses[sym];
  c.dataset.tip = sym + (v.wildcards ? '' : n ? ` · ${n} transition${n > 1 ? 's' : ''}` : ' · declared in Σ but on no transition');
  if (!opts.static) {
    c.addEventListener('mouseenter', () => langHighlightSymbol(sym, true));
    c.addEventListener('mouseleave', () => langHighlightSymbol(sym, false));
  }
  return c;
}

export function langLoadTrace(word) {
  const input = $('sim-in');
  if (!input) return;
  input.value = word.length
    ? (langIsSymbolic() ? word.join('') : word.join(','))
    : App.config.sym.eps;
  const sec = $('rp-simulate');
  if (sec && sec.classList.contains('collapsed') && typeof toggleRPSection === 'function') {
    toggleRPSection('rp-simulate');
  }
  if (typeof runSim === 'function') runSim();
}

// Both the fingerprint and the trace search run the real simulator many
// times over, and updateRPanel() fires on every edit — so the result is
// memoised on the same structural key the regex cache uses. Dragging a
// state around must not re-decide 127 words.
export let _langExtCache = { key: '', node: null };
export function _langExtKey() {
  const base = typeof _regexCacheKey === 'function'
    ? _regexCacheKey()
    : App.transitions.map(t => t.from + t.symbol + t.to).join(',');
  return App.machine + '|' + [...App.sigma].join('') + '|' +
    [...App.stackAlpha].join('') + '|' + App.config.transducerAccepts + '|' +
    App.config.langStepBudget + '|' + App.tapeCount + '|' + base;
}

export function renderLangExtension() {
  const host = $('lang-extension');
  if (!host) return;
  host.innerHTML = '';
  if (!App.states.length) { _langExtCache.node?._cleanup?.(); _langExtCache = { key: '', node: null }; return; }

  const key = _langExtKey();
  if (_langExtCache.key === key && _langExtCache.node) {
    host.appendChild(_langExtCache.node);
    return;
  }
  // A stale trace box may still hold a live IntersectionObserver watching
  // its scroll sentinel — disconnect it before the subtree becomes
  // unreachable, rather than leaning on GC to notice.
  _langExtCache.node?._cleanup?.();

  const box = _le('div');
  if (!langCanDecide()) {
    box.appendChild(_le('div', 'lang-note',
      'Enable "transducers accept" in Settings to list accepted inputs.'));
  } else if (langIsSymbolic()) {
    renderLangFingerprint(box);
    renderLangExportBar(box);
  } else {
    renderLangTraces(box);
    renderLangExportBar(box);
  }
  _langExtCache = { key, node: box };
  host.appendChild(box);
}

// The panel shows a window onto L(M); this is how that leaves the app.
// Sampling can be slower than a render (every candidate is verified with
// the real simulator), so it happens on click rather than eagerly here.
export function renderLangExportBar(host) {
  if (typeof openExportCodeModal !== 'function') return;
  const bar = _le('div', 'exp-bar');
  const btn = _le('button', 'exp-bar-btn', 'Export words');
  btn.type = 'button';
  btn.dataset.tip = 'Accepted and rejected words as CSV, JSON or batch-test input';
  btn.addEventListener('click', () => openExportCodeModal('samples'));
  bar.appendChild(btn);
  host.appendChild(bar);
}

// ── symbolic: the fingerprint ─────────────────────────────────────
const LANG_SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

// A long unary word is drawn as aⁿ. At length 300 the string itself is
// not something anyone reads, and the exponent is the only part of it
// that varies from the cell before.
export function langFpLabel(w) {
  if (!w.length) return App.config.sym.eps;
  if (w.length > 8 && w.every(s => s === w[0])) {
    return w[0] + String(w.length).replace(/\d/g, d => LANG_SUPS[+d]);
  }
  return w.join('');
}

// Backed by a live generator, the same way the trace list is: the grid
// starts at LANG_FP_ROWS rows and a sentinel at the bottom pulls the
// next page straight out of the paused enumeration, so the reader
// scrolls into Σ* instead of being handed 128 cells and a full stop.
// Nothing past the drawn rows has been decided — a cell costs one real
// simulation, so cells are paid for as they are looked at, which is
// also why the counts and the legend are running totals over what is
// on screen rather than over a budget fixed in advance.
export function renderLangFingerprint(host) {
  const streamState = { capped: false };
  const rows = langFingerprintRows(streamState);
  // Fixed for the life of this node: _langExtKey folds Σ in, so a change
  // to the alphabet rebuilds the grid rather than reusing it.
  const sigma = langSigmaOrdered();

  const head = _le('div', 'lang-head');
  head.appendChild(_le('span', 'lang-cap', 'fingerprint'));
  const count = _le('span', 'lang-cap');
  head.appendChild(count);
  host.appendChild(head);

  const scroll = _le('div', 'lang-fp');
  const grid = _le('div', 'lang-fp-grid');
  const sentinel = _le('div', 'lang-fp-sentinel');
  scroll.appendChild(grid);
  scroll.appendChild(sentinel);

  // The readout is two nodes for the life of the grid, written over on
  // hover, rather than two built per cell the pointer crosses.
  const read = _le('div', 'lang-fp-read');
  const readWord = _le('span', 'w');
  const readVerdict = _le('span');
  read.appendChild(readWord);
  read.appendChild(readVerdict);

  const legend = _le('div', 'lang-legend');
  const foot = _le('div', 'lang-foot');

  let nAcc = 0, nRej = 0, nUnk = 0, shown = 0, deepest = 0;
  let exhausted = false, selected = null;
  const say = v => v === 'acc' ? 'accepted' : v === 'unk' ? 'no verdict' : 'rejected';

  // ── a cell is where it sits ──────────────────────────────────────
  // Nothing per-cell is stored or closed over: the row records the one
  // (len, off) pair its twenty cells share, and a cell's word is
  // rebuilt from that plus its index at the moment it is wanted. It is
  // the rule render.js follows for states and edges, and here it is
  // what makes a long scroll affordable — a listener per cell per
  // event would be 24,576 of them at the cell cap, each closing over a
  // word array that then cannot be collected.
  //
  // The verdicts ride along as one character per cell in a single
  // string on the row — describing a cell must not re-decide its word,
  // which for a Turing machine is a second full run per hover.
  const cellAt = (el) => {
    const cells = el && el.parentNode;
    const at = cells && cells._fpAt;
    if (!at) return null;
    const i = Array.prototype.indexOf.call(cells.children, el);
    if (i < 0) return null;
    return {
      w: at.span ? langWordAt(sigma, at.len + i, 0) : langWordAt(sigma, at.len, at.off + i),
      v: at.v[i] === 'a' ? 'acc' : at.v[i] === 'u' ? 'unk' : 'rej'
    };
  };

  const reveal = (el) => {
    const cell = cellAt(el);
    if (!cell) return;
    readWord.textContent = langFpLabel(cell.w);
    readVerdict.className = 'v-' + cell.v;
    readVerdict.textContent = say(cell.v);
  };

  grid.addEventListener('pointerover', e => reveal(e.target));
  grid.addEventListener('focusin', e => reveal(e.target));
  grid.addEventListener('click', e => {
    const cell = cellAt(e.target);
    if (!cell) return;
    if (selected) selected.classList.remove('lang-fp-selected');
    selected = e.target;
    e.target.classList.add('lang-fp-selected');
    langLoadTrace(cell.w);
  });

  const addRow = (r) => {
    const row = _le('div', 'lang-fp-row');
    const last = r.len + (r.span ? r.words.length - 1 : 0);
    // The gutter carries one number even when the row spans lengths;
    // the range is a tooltip, because a gutter wide enough for "20–39"
    // is a gutter that eats a cell's worth of the grid beside it.
    // A continuation row's gutter is blank on purpose: the number
    // appearing is what says a new length has started, which is the
    // only thing separating one wrapped block from four small ones.
    const gutter = _le('div', 'lang-fp-len', r.off ? '' : String(r.len));
    gutter.dataset.tip = r.off
      ? `length ${r.len}, continued`
      : r.span && last > r.len
        ? `lengths ${r.len}–${last}`
        : `${r.words.length} word${r.words.length > 1 ? 's' : ''} of length ${r.len}`;
    row.appendChild(gutter);

    const cells = _le('div', 'lang-fp-cells');
    const verdicts = new Array(r.words.length);
    for (let i = 0; i < r.words.length; i++) {
      const w = r.words[i];
      const v = langVerdict(w);
      verdicts[i] = v === 'acc' ? 'a' : v === 'unk' ? 'u' : 'r';
      if (v === 'acc') nAcc++; else if (v === 'unk') nUnk++; else nRej++;
      shown++;
      if (w.length > deepest) deepest = w.length;
      const c = _le('button', 'lang-fp-c' + (v === 'acc' ? ' acc' : v === 'unk' ? ' unk' : ''));
      // The accessible name is the one thing a cell carries, because it
      // has to be there before an assistive technology asks rather than
      // when a pointer arrives. There is deliberately no `data-tip` to
      // go with it: the readout under the grid says the same sentence
      // immediately and in a fixed place, and a tooltip chasing the
      // pointer across eleven-pixel cells is the same text again, later
      // and harder to read.
      c.setAttribute('aria-label', `${langFpLabel(w)} — ${say(v)}`);
      cells.appendChild(c);
    }
    cells._fpAt = { len: r.len, off: r.off, span: r.span, v: verdicts.join('') };
    row.appendChild(cells);
    grid.appendChild(row);
  };

  // Built once and written over, so a pull updates three strings rather
  // than tearing the legend down and rebuilding it.
  const kv = (cls) => {
    const el = _le('span');
    el.appendChild(_le('i', cls));
    const t = _le('span');
    el.appendChild(t);
    return { el, t };
  };
  const kAcc = kv('k-acc'), kRej = kv('k-rej'), kUnk = kv('k-unk');
  legend.appendChild(kAcc.el);
  legend.appendChild(kRej.el);
  let unkShown = false;

  const update = () => {
    count.textContent = `${nAcc} of ${shown}`;
    kAcc.t.textContent = `accept ${nAcc}`;
    kRej.t.textContent = `reject ${nRej}`;
    if (nUnk) {
      kUnk.t.textContent = `no verdict ${nUnk}`;
      if (!unkShown) { legend.appendChild(kUnk.el); unkShown = true; }
    }

    const parts = [`to length ${deepest}`];
    if (!exhausted) parts.push('scroll for more');
    else if (streamState.capped) parts.push(`stopped at ${shown} words — Σ* goes on`);
    else parts.push('that is all of Σ*');
    // The hatched cells are the honest part: raising the budget resolves
    // the slow ones, and whatever is left never halts at any budget.
    if (nUnk) {
      parts.push(`${nUnk} still running after ${langStepBudget()} steps — not rejections. ` +
        'Raise the budget in Settings › Turing Machine; whatever stays hatched never halts');
    }
    foot.textContent = parts.join(' · ');
  };

  let io = null;
  const pull = (n) => {
    if (exhausted) return;
    for (let i = 0; i < n; i++) {
      const nx = rows.next();
      if (nx.done) { exhausted = true; break; }
      addRow(nx.value);
    }
    update();
    if (exhausted && io) { io.disconnect(); io = null; }
  };

  // A stale grid may still hold a live observer watching its sentinel;
  // renderLangExtension calls this before the subtree goes unreachable.
  host._cleanup = () => { if (io) { io.disconnect(); io = null; } };

  pull(LANG_FP_ROWS);
  if (!shown) return;

  host.appendChild(scroll);
  host.appendChild(read);
  host.appendChild(legend);
  host.appendChild(foot);

  if (!exhausted && typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) pull(LANG_FP_PAGE);
    }, { root: scroll, threshold: 0 });
    io.observe(sentinel);
  }
}

// ── vocabulary: accepted traces ───────────────────────────────────
// The list is backed by a live generator (_langTraceWords), not a fixed
// array: scrolling near the bottom pulls the next page straight out of
// the paused search, so "6 shortest" becomes "as many as you scroll to"
// without ever materialising L(M) as a whole — which for a machine with
// a cycle on an accepting path is not a finite thing to materialise.
export function renderLangTraces(host) {
  const v = langVocab();

  const head = _le('div', 'lang-head');
  head.appendChild(_le('span', 'lang-cap', 'accepted traces'));
  const count = _le('span', 'lang-cap');
  head.appendChild(count);
  host.appendChild(head);

  if (!langCanTrace()) {
    host.appendChild(_le('div', 'lang-note',
      isAnyTM(App.machine)
        ? `A ${App.machine} rewrites its tape, so a path through the graph is not an input word. ` +
          'Use Simulate or Batch test to probe specific traces.'
        : `A ${App.machine} head revisits input, so a path through the graph is not a word. ` +
          'Use Batch test to probe specific traces.'));
    return;
  }
  if (!App.startId) { host.appendChild(_le('div', 'lang-note', 'no start state')); return; }
  if (!App.accepts.size) { host.appendChild(_le('div', 'lang-note', 'no accepting state')); return; }

  const g = _langGraph();
  const searchState = { steps: 0, truncated: false };
  const gen = _langTraceWords(g, searchState);
  const infinite = langIsInfinite();

  const list = _le('div', 'lang-tr');
  const sentinel = _le('div', 'lang-tr-sentinel');
  list.appendChild(sentinel);
  const covered = new Set();
  const foot = _le('div', 'lang-foot');
  let shown = 0, exhausted = false;

  const addRow = (w) => {
    w.forEach(s => covered.add(s));
    const row = _le('div', 'lang-tr-row');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.dataset.tip = (w.length ? w.join(' → ') : 'ε') + '  ·  click to run in Simulate';
    const syms = _le('div', 'lang-tr-syms');
    if (!w.length) syms.appendChild(_le('span', 'lang-tr-eps', App.config.sym.eps));
    else w.forEach(s => syms.appendChild(langSymChip(s)));
    row.appendChild(syms);
    row.appendChild(_le('div', 'lang-tr-len', String(w.length)));
    const go = () => langLoadTrace(w);
    row.addEventListener('click', go);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    list.insertBefore(row, sentinel);
    shown++;
  };

  const updateFoot = () => {
    count.textContent = exhausted ? `${shown} total` : `${shown} shown`;

    const parts = [`${covered.size}/${App.sigma.size} symbols exercised`];
    if (infinite) parts.push('L(M) is infinite — scroll for more');
    else if (exhausted) parts.push('that is all of L(M)');
    if (searchState.truncated) parts.push('search truncated');
    foot.textContent = parts.join(' · ');
  };

  const pullMore = (n) => {
    if (exhausted) return;
    for (let i = 0; i < n; i++) {
      const nx = gen.next();
      if (nx.done) { exhausted = true; break; }
      addRow(nx.value);
    }
    updateFoot();
    if (exhausted && io) { io.disconnect(); io = null; }
  };

  let io = null;
  host._cleanup = () => { if (io) { io.disconnect(); io = null; } };
  pullMore(LANG_TRACE_ROWS);

  if (!shown) {
    host.appendChild(_le('div', 'lang-note',
      searchState.truncated ? 'no accepted word found within the search budget' : 'L(M) = ∅'));
    return;
  }

  host.appendChild(list);

  if (!exhausted && typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) pullMore(LANG_TRACE_PAGE);
    }, { root: list, threshold: 0 });
    io.observe(sentinel);
  }

  const top = v.ranked.slice(0, 2);
  if (top.length) {
    const legend = _le('div', 'lang-legend');
    const kv = (cls, txt) => { const s = _le('span'); s.appendChild(_le('i', cls)); s.appendChild(document.createTextNode(txt)); return s; };
    top.forEach((g2, i) => legend.appendChild(kv('k-g' + (i + 1), `${g2} · ${v.groups[g2].length}`)));
    const rest = App.sigma.size - top.reduce((n, g2) => n + v.groups[g2].length, 0);
    if (rest > 0) legend.appendChild(kv('k-g0', `other · ${rest}`));
    host.appendChild(legend);
  }

  host.appendChild(foot);
}

// ── the tuple line ────────────────────────────────────────────────
export function renderLangTuple() {
  const strip = $('lang-tuple');
  const open = $('lang-tuple-open');
  if (!strip || !open) return;
  strip.innerHTML = '';
  open.innerHTML = '';
  open.style.display = 'none';

  const syms = langTupleSyms();
  strip.appendChild(_le('span', 'lang-punc', 'M = ('));
  let active = null;

  syms.forEach((s, i) => {
    const info = langTupleInfo(s);
    const b = _le('button', 'lang-chip');
    b.type = 'button';
    b.setAttribute('aria-expanded', 'false');
    b.appendChild(document.createTextNode(s));
    if (info.n != null) b.appendChild(_le('sup', null, String(info.n)));
    b.dataset.tip = `${s} — ${info.say}`;
    b.addEventListener('click', () => {
      if (active === b) {
        b.setAttribute('aria-expanded', 'false');
        open.style.display = 'none'; active = null; langClearHighlight();
        return;
      }
      strip.querySelectorAll('.lang-chip').forEach(x => x.setAttribute('aria-expanded', 'false'));
      b.setAttribute('aria-expanded', 'true'); active = b;
      renderLangChipBody(open, s, info);
      open.style.display = '';
      langHighlight(s);
    });
    b.addEventListener('mouseenter', () => { if (!active) langHighlight(s); });
    b.addEventListener('mouseleave', () => { if (!active) langClearHighlight(); });
    strip.appendChild(b);
    if (i < syms.length - 1) strip.appendChild(_le('span', 'lang-punc', ','));
  });
  strip.appendChild(_le('span', 'lang-punc', ')'));
}

export function renderLangChipBody(open, sym, info) {
  open.innerHTML = '';
  const head = _le('div', 'lang-open-head');
  head.appendChild(_le('span', 'k', sym));
  head.appendChild(document.createTextNode(' — ' + info.say));
  open.appendChild(head);

  // Σ over a word alphabet is a vocabulary, not a set you can print.
  if (sym === 'Σ' && !langIsSymbolic()) { renderLangVocabList(open); return; }

  if (sym === 'Σ') {
    const row = _le('div', 'lang-open-chips');
    [...App.sigma].forEach(s => row.appendChild(langSymChip(s, { plain: true })));
    open.appendChild(row);
    return;
  }
  open.appendChild(_le('div', 'lang-open-val', info.val));
}

// Σ as a vocabulary: ranked by how many transitions actually use each
// symbol. At |Σ| = 2 this is overkill; at 17 the zero-usage row is the
// most useful thing on the panel.
export function renderLangVocabList(open) {
  const v = langVocab();
  const search = _le('input', 'lang-voc-search');
  search.type = 'search';
  search.placeholder = `filter ${v.sigma.length} symbols…`;
  open.appendChild(search);

  const list = _le('div', 'lang-voc-list');
  const max = Math.max(1, ...v.sigma.map(s => v.uses[s]));
  const ordered = v.sigma.slice().sort((a, b) => v.uses[b] - v.uses[a] || a.localeCompare(b));
  for (const s of ordered) {
    const row = _le('div', 'lang-voc-row' + (!v.uses[s] && !v.wildcards ? ' dead' : ''));
    row.dataset.name = s.toLowerCase();
    const nm = _le('div', 'lang-voc-name');
    nm.appendChild(langSymChip(s));
    const t = _le('span', 't', s); t.dataset.tip = s;
    nm.appendChild(t);
    row.appendChild(nm);
    // Meter is magnitude, so one hue on its own soft track; identity
    // lives in the chip beside it, never in the bar's colour.
    const meter = _le('div', 'lang-voc-meter');
    const fill = _le('i');
    fill.style.width = (v.uses[s] / max * 100) + '%';
    meter.appendChild(fill);
    row.appendChild(meter);
    row.appendChild(_le('div', 'lang-voc-n', String(v.uses[s])));
    row.addEventListener('mouseenter', () => langHighlightSymbol(s, true));
    row.addEventListener('mouseleave', () => langHighlightSymbol(s, false));
    list.appendChild(row);
  }
  open.appendChild(list);

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    list.querySelectorAll('.lang-voc-row').forEach(r => {
      r.style.display = !q || r.dataset.name.includes(q) ? '' : 'none';
    });
  });

  if (v.dead.length) {
    const flag = _le('div', 'lang-flag');
    flag.textContent = `${v.dead.length} symbol${v.dead.length > 1 ? 's' : ''} declared in Σ but on no transition: ` + v.dead.join(', ');
    open.appendChild(flag);
  }
  if (v.ranked.length) {
    open.appendChild(_le('div', 'lang-voc-groups',
      'prefixes  ' + v.ranked.map(g => `${g}·${v.groups[g].length}`).join('  ')));
  }
}

// The tuple line is the default view of the definition; the full KaTeX
// block stays one click away so nothing that used to be here is lost.
export function toggleFormalDef() {
  const wrap = $('def-box-wrap'), btn = $('def-toggle-btn');
  if (!wrap) return;
  const show = wrap.style.display === 'none';
  wrap.style.display = show ? '' : 'none';
  if (btn) {
    btn.setAttribute('aria-expanded', String(show));
    btn.classList.toggle('open', show);
    btn.dataset.tip = show ? 'Hide the full formal definition' : 'Show the full formal definition';
  }
  if (show && typeof updateDefBoxOverflowShadow === 'function') updateDefBoxOverflowShadow();
}

// Flags the claim row while the expression runs past its right edge, which
// drives the fade. Re-run on resize as well as on re-render: the panel is
// user-resizable, so the same text overflows or not depending on width.
export function updateLangClaimOverflow() {
  const box = $('regex-box');
  if (!box || !box.parentElement) return;
  const maxScroll = Math.max(0, box.scrollWidth - box.clientWidth);
  // Clear the fade once scrolled to the end — there is nothing further right
  // to hint at.
  box.parentElement.classList.toggle('has-more', maxScroll > 2 && box.scrollLeft < maxScroll - 2);
}

// Mirrors initDefBoxOverflowObserver for the claim row: the panel is
// user-resizable, so overflow has to be re-measured on width changes and not
// only when the text is rebuilt.
export function initLangClaimOverflowObserver() {
  const box = $('regex-box');
  if (!box || box._overflowObsInit) return;
  box._overflowObsInit = true;
  box.addEventListener('scroll', updateLangClaimOverflow);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(updateLangClaimOverflow).observe(box);
  }
}

// ── entry point ───────────────────────────────────────────────────
export function renderLanguagePanel() {
  const wrap = $('rp-language');
  if (wrap) {
    wrap.classList.toggle('lang-vocabulary', !langIsSymbolic());
    wrap.classList.toggle('lang-asserted', App._regexIsDerived === false);
  }
  const claim = $('regex-box');
  if (claim) claim.classList.toggle('asserted', App._regexIsDerived === false);
  // The derived/asserted distinction is carried by the mono-gold vs
  // serif-italic type. The copy button also reports unusually long regexes.
  const copyBtn = $('regex-copy-btn');
  if (copyBtn) {
    const n = (App._regexBoxPlain || '').length;
    copyBtn.dataset.tip = App._regexIsDerived === false || n <= 240
      ? 'Copy regular expression'
      : `Copy regular expression (${n.toLocaleString()} chars)`;
  }
  updateLangClaimOverflow();
  renderLangExtension();
  renderLangTuple();
}
