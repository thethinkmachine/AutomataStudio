// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY OF BABEL — WHAT A PUSHDOWN AUTOMATON ACCEPTS, DECIDED
// ══════════════════════════════════════════════════════════════════
// The DPDA, NPDA and one-counter wings' maps, and the facts on their pages,
// computed exactly — never guessed from short words:
//
//   empty       does it accept any word?          every pushdown automaton
//   infinite    does it accept infinitely many?   every pushdown automaton
//   universal   does it accept every word?        a DPDA only
//
// The third is the edge the two maps show side by side: universality is
// decidable for a deterministic pushdown automaton (its language's complement
// is one too) and undecidable for a nondeterministic one, so the DPDA map has
// a Σ* colour and the NPDA map cannot.
//
// The method, in three parts, all over the machine's moves as storeMoves() in
// wings.js gives them (a move pops one symbol or nothing, and pushes a word):
//
//   • Pop summaries: P(q, X) is every state the machine can be in after
//     popping an X it found on top in state q — least fixpoint, the standard
//     saturation for pushdown systems. Nothing below X matters until X goes.
//   • Its grammar: the triple construction ([q X p] derives what is read
//     while X is popped from q to p), with the push strings threaded through
//     chain variables so a long push costs a line of variables rather than a
//     power of the state count, and acceptance variables for "reaches an
//     accepting configuration from here". Emptiness is whether the start
//     symbol generates; finiteness is whether a useful variable sits on a
//     cycle that reads a letter.
//   • For a DPDA's universality, the configurations it can reach, with a bit
//     for "accepted since the last letter was read". It fails to accept some
//     word exactly when it can reach one of: a configuration with no ε-move
//     whose bit is clear (the word read so far is rejected), one with no
//     ε-move and no move on some letter (stuck before the end), or one whose
//     ε-run never ends (it never reads on).
//
// Conventions are the app's (js/machines/pushdown.js): a move popping nothing
// applies whatever is on top, even an empty stack; under the explicit
// convention the stack starts as [Z] and a configuration accepts when its
// state does and the input is read; under the empty-stack one it starts empty
// and accepts when the stack is empty and the input is read.
//
// DOM-free and App-free: the worker reads it as it is.

import { storeMoves } from './wings.js';

/** Past this many grammar rules a volume is reported as too large to decide here. */
export const RULE_LIMIT = 400000;

class TooLarge extends Error {}

// ── The pushdown system ───────────────────────────────────────────

/**
 * Moves indexed by state. A head is (state, top), the top being a stack
 * symbol 0…G−1 or G for an empty stack.
 */
function systemOf(M) {
  const from = Array.from({ length: M.n }, () => []);
  for (const m of M.moves) from[m.from].push(m);
  return { ...M, from };
}

const applies = (m, Y, G) => m.pop < 0 || (Y < G && m.pop === Y);

/**
 * P[q·G + X] — the states a run can be in having just popped an X that was on
 * top in state q, as a 0/1 array per head. The rules, to a fixpoint:
 * a move popping X from q to r pushing γ adds every state reached by popping
 * γ from r; a move popping nothing pushes γ above X, and from each state s
 * that pops γ it adds P[s·G + X].
 */
function popSummaries(S) {
  const { n, G, moves } = S;
  const P = Array.from({ length: n * G }, () => new Uint8Array(n));
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of moves) {
      const after = popWord(P, S, m.to, m.push);
      const into = (row, from) => {
        for (let p = 0; p < n; p++) if (from[p] && !row[p]) { row[p] = 1; changed = true; }
      };
      if (m.pop >= 0) into(P[m.from * G + m.pop], after);
      else {
        for (let X = 0; X < G; X++) {
          const row = P[m.from * G + X];
          for (let s = 0; s < n; s++) if (after[s]) into(row, P[s * G + X]);
        }
      }
    }
  }
  return P;
}

/** The states a run can be in after popping `word` (top first), starting in `s`. */
function popWord(P, S, s, word, upTo = word.length) {
  let cur = new Uint8Array(S.n);
  cur[s] = 1;
  for (let i = 0; i < upTo; i++) {
    const next = new Uint8Array(S.n);
    const base = word[i];
    for (let c = 0; c < S.n; c++) {
      if (!cur[c]) continue;
      const row = P[c * S.G + base];
      for (let p = 0; p < S.n; p++) if (row[p]) next[p] = 1;
    }
    cur = next;
  }
  return cur;
}

/**
 * Every head the machine can reach: (state, top) as a 0/1 array indexed
 * q·(G+1) + Y. A pushed word's symbols become tops in turn, each once the one
 * above it has been popped (P says in which states), and the head under a
 * word pushed by a move that popped nothing comes back once the word is gone.
 * `bottom(q)` names the state a head on an empty stack is recorded under —
 * the universality check sets its bit there.
 */
function reachableHeads(S, P, start, bottom = q => q) {
  const { G } = S;
  const W = G + 1;
  const seen = new Uint8Array(S.n * W);
  const work = [];
  const add = (q, Y) => {
    if (Y === G) q = bottom(q);
    const i = q * W + Y;
    if (!seen[i]) { seen[i] = 1; work.push(i); }
  };
  const addAll = (set, Y) => { for (let q = 0; q < S.n; q++) if (set[q]) add(q, Y); };
  if (start.stack.length) {
    add(start.q, start.stack[0]);
    addAll(P[start.q * G + start.stack[0]], G);
  } else add(start.q, G);
  while (work.length) {
    const i = work.pop();
    const q = Math.floor(i / W), Y = i % W;
    for (const m of S.from[q]) {
      if (!applies(m, Y, G)) continue;
      const w = m.push;
      if (!w.length) { if (m.pop < 0) add(m.to, Y); continue; }
      add(m.to, w[0]);
      for (let j = 1; j < w.length; j++) addAll(popWord(P, S, m.to, w, j), w[j]);
      if (m.pop < 0) addAll(popWord(P, S, m.to, w), Y);
    }
  }
  return seen;
}

// ── The grammar ───────────────────────────────────────────────────

/**
 * The machine's language as a grammar whose every rule has at most one letter
 * and two variables, built from the start symbol out (only what it can reach
 * is built). Variables, by the key they are interned under:
 *
 *   T q X p      read while popping X, from q to p
 *   C m i s p    a move m that popped X has pushed γ; popping γ[i…] from s ends in p
 *   D m X i s p  the same for a move that popped nothing, then X is popped to p
 *   A q Y        reach acceptance from head (q, Y) without popping Y
 *   CA m i s     reach acceptance inside γ[i…] from s, γ pushed in place of the top
 *   DA m Y i s   the same for γ pushed above Y, which may be reached again
 *   S            the start
 *
 * A rule is { lhs, letter (or −1), vars }.
 */
function grammarOf(S, P) {
  const { n, G, acc, explicit } = S;
  const ids = new Map();
  const rules = [];
  const byLhs = [];
  const work = [];
  const V = key => {
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
      byLhs.push([]);
      work.push([id, key]);
    }
    return id;
  };
  const rule = (lhs, letter, vars) => {
    if (rules.length >= RULE_LIMIT) throw new TooLarge();
    const r = { lhs, letter, vars };
    rules.push(r);
    byLhs[lhs].push(r);
  };
  const inP = (s, X, p) => P[s * G + X][p] === 1;
  const moveNo = new Map(S.moves.map((m, i) => [m, i]));

  const expand = (id, key) => {
    const [kind, ...a] = key.split(',');
    const x = a.map(Number);
    if (kind === 'S') {
      if (explicit) {
        rule(id, -1, [V(`A,${S.q0},0`)]);
        for (let p = 0; p < n; p++) if (inP(S.q0, 0, p)) rule(id, -1, [V(`T,${S.q0},0,${p}`), V(`A,${p},${G}`)]);
      } else rule(id, -1, [V(`A,${S.q0},${G}`)]);
    } else if (kind === 'T') {
      const [q, X, p] = x;
      for (const m of S.from[q]) {
        const mi = moveNo.get(m);
        if (m.pop === X) rule(id, m.a, [V(`C,${mi},0,${m.to},${p}`)]);
        else if (m.pop < 0) rule(id, m.a, [V(`D,${mi},${X},0,${m.to},${p}`)]);
      }
    } else if (kind === 'C' || kind === 'D') {
      const [mi, ...rest] = x;
      const X = kind === 'D' ? rest[0] : -1;
      const [i, s, p] = kind === 'D' ? rest.slice(1) : rest;
      const w = S.moves[mi].push;
      if (i === w.length) {
        if (kind === 'C') { if (s === p) rule(id, -1, []); }
        else if (inP(s, X, p)) rule(id, -1, [V(`T,${s},${X},${p}`)]);
        return;
      }
      const head = kind === 'D' ? `D,${mi},${X},${i + 1}` : `C,${mi},${i + 1}`;
      for (let t = 0; t < n; t++) if (inP(s, w[i], t)) rule(id, -1, [V(`T,${s},${w[i]},${t}`), V(`${head},${t},${p}`)]);
    } else if (kind === 'A') {
      const [q, Y] = x;
      if (explicit ? acc[q] : Y === G) rule(id, -1, []);
      for (const m of S.from[q]) {
        if (!applies(m, Y, G)) continue;
        const mi = moveNo.get(m);
        rule(id, m.a, [V(m.pop < 0 ? `DA,${mi},${Y},0,${m.to}` : `CA,${mi},0,${m.to}`)]);
      }
    } else {
      // CA m i s, DA m Y i s
      const [mi, ...rest] = x;
      const Y = kind === 'DA' ? rest[0] : -1;
      const [i, s] = kind === 'DA' ? rest.slice(1) : rest;
      const w = S.moves[mi].push;
      if (i === w.length) {
        if (kind === 'DA') rule(id, -1, [V(`A,${s},${Y}`)]);
        return;
      }
      rule(id, -1, [V(`A,${s},${w[i]}`)]);
      const head = kind === 'DA' ? `DA,${mi},${Y},${i + 1}` : `CA,${mi},${i + 1}`;
      for (let t = 0; t < n; t++) if (inP(s, w[i], t)) rule(id, -1, [V(`T,${s},${w[i]},${t}`), V(`${head},${t}`)]);
    }
  };

  const start = V('S');
  while (work.length) {
    const [id, key] = work.pop();
    expand(id, key);
  }
  return { start, count: ids.size, rules, byLhs };
}

/** Which variables derive some word: rules count their unproven variables down. */
function generatingOf(g) {
  const gen = new Uint8Array(g.count);
  const left = g.rules.map(r => r.vars.length);
  const uses = Array.from({ length: g.count }, () => []);
  g.rules.forEach((r, i) => { for (const v of r.vars) uses[v].push(i); });
  const work = [];
  g.rules.forEach((r, i) => { if (!left[i] && !gen[r.lhs]) { gen[r.lhs] = 1; work.push(r.lhs); } });
  while (work.length) {
    const v = work.pop();
    for (const i of uses[v]) {
      if (--left[i] === 0 && !gen[g.rules[i].lhs]) { gen[g.rules[i].lhs] = 1; work.push(g.rules[i].lhs); }
    }
  }
  return gen;
}

/**
 * Whether the start symbol derives infinitely many words: some useful
 * variable lies on a cycle with a letter beside it — A ⇒⁺ uAv with uv ≠ ε.
 * Only rules whose every variable generates take part; an edge A → B through
 * A → α B β pumps when α β holds a letter or a variable that derives a
 * non-empty word, and the language is infinite exactly when some strongly
 * connected component of useful variables contains a pumping edge.
 */
function infiniteOf(g, gen) {
  const live = g.rules.filter(r => gen[r.lhs] && r.vars.every(v => gen[v]));
  // Useful: reached from the start through live rules.
  const useful = new Uint8Array(g.count);
  const stack = [g.start];
  useful[g.start] = 1;
  const liveBy = Array.from({ length: g.count }, () => []);
  for (const r of live) liveBy[r.lhs].push(r);
  while (stack.length) {
    const v = stack.pop();
    for (const r of liveBy[v]) for (const u of r.vars) if (!useful[u]) { useful[u] = 1; stack.push(u); }
  }
  // Which variables derive a non-empty word.
  const grows = new Uint8Array(g.count);
  for (let changed = true; changed;) {
    changed = false;
    for (const r of live) {
      if (grows[r.lhs]) continue;
      if (r.letter >= 0 || r.vars.some(v => grows[v])) { grows[r.lhs] = 1; changed = true; }
    }
  }
  const edges = Array.from({ length: g.count }, () => []);
  for (const r of live) {
    if (!useful[r.lhs]) continue;
    r.vars.forEach((v, j) => {
      const pump = r.letter >= 0 || r.vars.some((u, k) => k !== j && grows[u]);
      edges[r.lhs].push([v, pump]);
    });
  }
  const comp = sccOf(g.count, edges, useful);
  for (let v = 0; v < g.count; v++) {
    if (!useful[v]) continue;
    for (const [u, pump] of edges[v]) if (pump && comp[u] === comp[v]) return true;
  }
  return false;
}

/** Tarjan's strongly connected components over the marked vertices, iteratively. */
function sccOf(N, edges, mark) {
  const index = new Int32Array(N).fill(-1), low = new Int32Array(N), comp = new Int32Array(N).fill(-1);
  const on = new Uint8Array(N), stack = [];
  let next = 0, c = 0;
  for (let root = 0; root < N; root++) {
    if (!mark[root] || index[root] >= 0) continue;
    const call = [[root, 0]];
    index[root] = low[root] = next++;
    stack.push(root); on[root] = 1;
    while (call.length) {
      const top = call[call.length - 1];
      const [v, i] = top;
      if (i < edges[v].length) {
        top[1]++;
        const u = edges[v][i][0];
        if (!mark[u]) continue;
        if (index[u] < 0) {
          index[u] = low[u] = next++;
          stack.push(u); on[u] = 1;
          call.push([u, 0]);
        } else if (on[u]) low[v] = Math.min(low[v], index[u]);
        continue;
      }
      call.pop();
      if (call.length) { const p = call[call.length - 1][0]; low[p] = Math.min(low[p], low[v]); }
      if (low[v] === index[v]) {
        let u;
        do { u = stack.pop(); on[u] = 0; comp[u] = c; } while (u !== v);
        c++;
      }
    }
  }
  return comp;
}

/**
 * The shortest word the start symbol derives (Knuth's generalisation of
 * Dijkstra to grammars): a variable's length is settled in order of length,
 * each by the rule that settled it, so spelling the word back follows rules
 * whose variables were settled first and cannot loop. Null when there is none;
 * the length alone when the word would be longer than `spellUpTo`.
 */
function shortestOf(g, spellUpTo) {
  const INF = Infinity;
  const len = new Float64Array(g.count).fill(INF);
  const done = new Uint8Array(g.count);
  const via = new Array(g.count).fill(null);
  const left = g.rules.map(r => r.vars.length);
  const sum = g.rules.map(r => (r.letter >= 0 ? 1 : 0));
  const uses = Array.from({ length: g.count }, () => []);
  g.rules.forEach((r, i) => { for (const v of r.vars) uses[v].push(i); });
  const heap = [];
  const push = (d, v, i) => {
    heap.push([d, v, i]);
    for (let j = heap.length - 1; j > 0;) {
      const p = (j - 1) >> 1;
      if (heap[p][0] <= heap[j][0]) break;
      [heap[p], heap[j]] = [heap[j], heap[p]];
      j = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let j = 0; ;) {
        const l = 2 * j + 1, r = l + 1;
        let m = j;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === j) break;
        [heap[m], heap[j]] = [heap[j], heap[m]];
        j = m;
      }
    }
    return top;
  };
  g.rules.forEach((r, i) => { if (!left[i]) push(sum[i], r.lhs, i); });
  while (heap.length) {
    const [d, v, i] = pop();
    if (done[v]) continue;
    done[v] = 1; len[v] = d; via[v] = i;
    if (v === g.start) break;
    for (const ri of uses[v]) {
      sum[ri] += d;
      if (--left[ri] === 0 && !done[g.rules[ri].lhs]) push(sum[ri], g.rules[ri].lhs, ri);
    }
  }
  if (!done[g.start]) return null;
  const length = len[g.start];
  if (length > spellUpTo) return { length, word: null };
  const word = [];
  const spell = v => {
    const r = g.rules[via[v]];
    if (r.letter >= 0) word.push(r.letter);
    for (const u of r.vars) spell(u);
  };
  spell(g.start);
  return { length, word };
}

// ── A DPDA's universality ─────────────────────────────────────────

const STOP = -1, LOOP = -2;

/**
 * What the ε-run from head (q, Y) does before Y is popped: pops it, arriving
 * in state p (≥ 0); stops, with no ε-move to take (STOP); or runs for ever
 * (LOOP). Deterministic, so each head has one answer; a head met again while
 * its own answer is being worked out is a configuration that repeats with at
 * least as much stack — a loop, whatever lies below.
 */
function epsilonRuns(S) {
  const { G } = S;
  const W = G + 1;
  const memo = new Int32Array(S.n * W).fill(-3);
  const busy = new Uint8Array(S.n * W);
  const eps = (q, Y) => S.from[q].find(m => m.a < 0 && applies(m, Y, G)) || null;
  const run = (q, Y) => {
    const i = q * W + Y;
    if (memo[i] !== -3) return memo[i];
    if (busy[i]) return LOOP;
    busy[i] = 1;
    let out;
    const m = eps(q, Y);
    if (!m) out = STOP;
    else {
      let s = m.to;
      out = null;
      for (const Z of m.push) {
        const o = run(s, Z);
        if (o < 0) { out = o; break; }
        s = o;
      }
      if (out === null) out = m.pop >= 0 ? s : run(s, Y);
    }
    busy[i] = 0;
    memo[i] = out;
    return out;
  };
  return { run, eps };
}

/**
 * Whether a DPDA accepts every word. The machine is run with a bit beside its
 * state — set when it accepts, cleared when it reads a letter — and it fails
 * exactly when it can reach a head that is stuck with the bit clear, stuck
 * with a letter it has no move on, or at the start of an ε-run that never
 * ends. (A letter move never applies where an ε-move does: the determinism
 * rule makes ε clash with every read.)
 */
function universalDpda(M, S) {
  const { n, G, k, acc, explicit } = S;
  const moves = [];
  for (const m of M.moves) {
    for (let f = 0; f < 2; f++) {
      const bit = (m.a < 0 ? f : 0) | (explicit && acc[m.to] ? 1 : 0);
      moves.push({ from: m.from * 2 + f, a: m.a, pop: m.pop, to: m.to * 2 + bit, push: m.push });
    }
  }
  const F = systemOf({ n: n * 2, G, k, moves });
  const P = popSummaries(F);
  const f0 = explicit ? (acc[S.q0] ? 1 : 0) : 1;
  // An empty stack accepts under the empty-stack convention: the bit is set there.
  const bottom = explicit ? (q => q) : (q => q | 1);
  const heads = reachableHeads(F, P, { q: S.q0 * 2 + f0, stack: explicit ? [0] : [] }, bottom);
  const { run, eps } = epsilonRuns(S);
  const W = G + 1;
  for (let i = 0; i < heads.length; i++) {
    if (!heads[i]) continue;
    const qf = Math.floor(i / W), Y = i % W, q = qf >> 1, bit = qf & 1;
    if (eps(q, Y)) { if (run(q, Y) === LOOP) return false; continue; }
    if (!bit) return false;
    for (let a = 0; a < k; a++) if (!S.from[q].some(m => m.a === a && applies(m, Y, G))) return false;
  }
  return true;
}

// ── What the census and the page ask ──────────────────────────────

/**
 * A store machine's volume, decided: { empty, finite, universal, grammar }
 * — universal is null where it cannot be decided (anything but a DPDA) —
 * or { tooLarge: true } past RULE_LIMIT.
 */
export function pushdownFacts(wing, params, body) {
  const M = storeMoves(wing, params, body);
  const S = systemOf({ ...M, q0: 0 });
  try {
    const P = popSummaries(S);
    const g = grammarOf(S, P);
    const gen = generatingOf(g);
    const empty = !gen[g.start];
    const finite = empty || !infiniteOf(g, gen);
    let universal = null;
    if (wing.type === 'DPDA') universal = !finite && universalDpda(M, S);
    return { empty, finite, universal, grammar: g };
  } catch (e) {
    if (e instanceof TooLarge) return { tooLarge: true };
    throw e;
  }
}

/** The map's colour for a pushdown volume: e, f, i — and u for a DPDA that accepts every word — or x. */
export function pushdownClass(wing, params, body) {
  const r = pushdownFacts(wing, params, body);
  if (r.tooLarge) return 'x';
  if (r.empty) return 'e';
  if (r.finite) return 'f';
  return r.universal ? 'u' : 'i';
}

/** The shortest word a pushdown volume accepts, as letter indices: { length, word } or null. */
export function shortestAccepted(wing, params, body, { spellUpTo = 24 } = {}) {
  const r = pushdownFacts(wing, params, body);
  if (r.tooLarge || r.empty) return null;
  return shortestOf(r.grammar, spellUpTo);
}
