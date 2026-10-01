// ══════════════════════════════════════════════════════════════════
//  FINITE AUTOMATA AS VALUES
// ══════════════════════════════════════════════════════════════════
// The constructions the command line composes — determinize, minimize,
// complement, products, the regular operations, regex in and out — over the
// grader's target shape rather than over App, so they can be chained in a
// pipe or an expression without a canvas in between.
//
// The app already owns the two hard parts and this file borrows them rather
// than repeating them: the subset construction is the grader's `subsetSide`
// (so a DFA resolves a symbol over the Σ wildcard exactly as the simulator
// does, and an NFA closes under ε exactly as testNFA does), and the minimal
// DFA is the library's `minimalDfaOf`, canonical numbering and all. What is
// here is the plumbing around them: tables back into machines, the product,
// and the Thompson-style operations that only need fresh names.

import { aMachine } from './grammar.mjs';
import { App } from '../js/state.js';
import { subsetSide, withMachine } from '../js/exercise/grade.js';
import { minimalDfaOf } from '../js/library/analyze.js';
import { thompsonBuild } from '../js/algorithms-fa.js';
import { deriveRegex } from '../js/render.js';
import { CliError } from './errors.mjs';

export const FA_TYPES = new Set(['DFA', 'NFA', 'ε-NFA']);

export const symOf = target => ({ ...App.config.sym, ...(target.config?.sym || {}) });

/** Σ without ε or the wildcard, sorted — the letters a word is made of. */
export function lettersOf(target) {
  const sym = symOf(target);
  return [...new Set(target.sigma || [])].filter(s => s !== sym.eps && s !== sym.any).sort();
}

export function requireFA(target, what) {
  if (!FA_TYPES.has(target.machine)) {
    throw new CliError(`${what} works on finite automata (DFA, NFA, ε-NFA); this is ${aMachine(target.machine)}.`);
  }
}

function blankTarget(machine, sigma, config = {}) {
  return {
    kind: 'machine', machine, states: [], transitions: [], startId: null, accepts: [],
    sigma: [...sigma], stackAlpha: [], outputAlpha: [], tapeCount: 1, blocks: [], config: { ...config }
  };
}

/**
 * A DFA table `{ sigma, n, start, acc, delta, dead }` → a DFA target. The dead
 * sink is left out unless `complete`, which is how a reader draws a DFA.
 */
export function dfaTableToTarget(dfa, { complete = false, names = null, config = {} } = {}) {
  const t = blankTarget('DFA', dfa.sigma, config);
  const keep = q => complete || q !== dfa.dead;
  for (let q = 0; q < dfa.n; q++) if (keep(q)) t.states.push({ id: `q${q}`, name: names ? names[q] : `q${q}` });
  t.startId = `q${dfa.start}`;
  if (!keep(dfa.start)) {
    // The whole language is empty and the sink is the start: keep it, or the
    // machine would have no start at all.
    t.states.push({ id: `q${dfa.start}`, name: names ? names[dfa.start] : `q${dfa.start}` });
  }
  const acc = new Set(dfa.acc);
  t.accepts = t.states.filter(s => acc.has(Number(s.id.slice(1)))).map(s => s.id);
  const present = new Set(t.states.map(s => s.id));
  const k = dfa.sigma.length;
  let n = 0;
  for (let q = 0; q < dfa.n; q++) {
    if (!present.has(`q${q}`)) continue;
    for (let a = 0; a < k; a++) {
      const to = dfa.delta[q * k + a];
      if (!present.has(`q${to}`)) continue;
      t.transitions.push({ id: `t${++n}`, from: `q${q}`, to: `q${to}`, symbol: dfa.sigma[a] });
    }
  }
  return t;
}

/**
 * The reachable subset construction, complete over Σ, in breadth-first order.
 * Each DFA state remembers the set it stands for, which is what `determinize`
 * names it by.
 */
export function subsetTable(target, sigma = lettersOf(target), cap = 1 << 16) {
  const sym = symOf(target);
  const side = subsetSide(target, sym);
  const index = new Map();
  const configs = [];
  const add = cfg => {
    const key = cfg.join('\u0001');
    let i = index.get(key);
    if (i === undefined) { i = configs.length; index.set(key, i); configs.push(cfg); }
    return i;
  };
  add(side.start);
  const delta = [];
  for (let i = 0; i < configs.length; i++) {
    if (configs.length > cap) throw new CliError(`The subset construction passed ${cap} states and was stopped.`);
    for (let a = 0; a < sigma.length; a++) delta[i * sigma.length + a] = add(side.step(configs[i], sigma[a]));
  }
  const acc = [];
  configs.forEach((c, i) => { if (side.accepting(c)) acc.push(i); });
  const dead = configs.findIndex(c => !c.length);
  return { sigma, n: configs.length, start: 0, acc, delta, dead, configs };
}

export function determinize(target, { complete = false } = {}) {
  requireFA(target, 'determinize');
  const table = subsetTable(target);
  const nameOf = new Map(target.states.map(s => [s.id, String(s.name ?? s.id)]));
  const names = table.configs.map(c => (c.length ? `{${c.map(id => nameOf.get(id)).join(',')}}` : '∅'));
  return dfaTableToTarget(table, { complete, names, config: target.config });
}

export function minimize(target, { complete = false } = {}) {
  requireFA(target, 'minimize');
  const dfa = minimalDfaOf(target);
  if (!dfa) throw new CliError('The subset construction outgrew its limit, so the minimal DFA was not built.');
  return dfaTableToTarget(dfa, { complete, config: target.config });
}

export function complement(target, sigma = lettersOf(target)) {
  requireFA(target, 'complement');
  const t = subsetTable(target, sigma);
  const acc = new Set(t.acc);
  const flipped = { ...t, acc: [...Array(t.n).keys()].filter(q => !acc.has(q)), dead: -1 };
  return dfaTableToTarget(flipped, { complete: true, config: target.config });
}

/**
 * The product of two finite automata over the union of their alphabets.
 * `mode` is and | or | xor | diff (a and not b).
 */
export function product(a, b, mode = 'and') {
  requireFA(a, mode); requireFA(b, mode);
  const sigma = [...new Set([...lettersOf(a), ...lettersOf(b)])].sort();
  const A = subsetTable(a, sigma), B = subsetTable(b, sigma);
  const k = sigma.length;
  const accA = new Set(A.acc), accB = new Set(B.acc);
  const index = new Map(), pairs = [];
  const add = (x, y) => {
    const key = x * B.n + y;
    let i = index.get(key);
    if (i === undefined) { i = pairs.length; index.set(key, i); pairs.push([x, y]); }
    return i;
  };
  add(A.start, B.start);
  const delta = [];
  for (let i = 0; i < pairs.length; i++) {
    const [x, y] = pairs[i];
    for (let s = 0; s < k; s++) delta[i * k + s] = add(A.delta[x * k + s], B.delta[y * k + s]);
  }
  const keep = ([x, y]) => {
    const p = accA.has(x), q = accB.has(y);
    return mode === 'and' ? p && q : mode === 'or' ? p || q : mode === 'xor' ? p !== q : p && !q;
  };
  const acc = pairs.map((p, i) => (keep(p) ? i : -1)).filter(i => i >= 0);
  const table = { sigma, n: pairs.length, start: 0, acc, delta, dead: -1 };
  return dfaTableToTarget(table, { complete: true, config: a.config });
}

// ── The regular operations, as ε-NFAs ─────────────────────────────

function copyInto(out, target, prefix) {
  const ids = new Map();
  for (const s of target.states) {
    const id = `${prefix}${s.id}`;
    ids.set(s.id, id);
    out.states.push({ id, name: `${prefix}${s.name ?? s.id}` });
  }
  for (const t of target.transitions) {
    out.transitions.push({ id: `t${out.transitions.length + 1}`, from: ids.get(t.from), to: ids.get(t.to), symbol: t.symbol });
  }
  return ids;
}

function epsEdge(out, from, to) {
  out.transitions.push({ id: `t${out.transitions.length + 1}`, from, to, symbol: symOf(out).eps });
}

function faPair(a, b, what) {
  requireFA(a, what); requireFA(b, what);
  const sigma = [...new Set([...lettersOf(a), ...lettersOf(b)])];
  return blankTarget('ε-NFA', sigma, a.config);
}

export function union(a, b) {
  const out = faPair(a, b, 'union');
  const ia = copyInto(out, a, 'a.'), ib = copyInto(out, b, 'b.');
  out.states.unshift({ id: 's', name: 's' });
  out.startId = 's';
  epsEdge(out, 's', ia.get(a.startId));
  epsEdge(out, 's', ib.get(b.startId));
  out.accepts = [...a.accepts.map(id => ia.get(id)), ...b.accepts.map(id => ib.get(id))];
  return out;
}

export function concat(a, b) {
  const out = faPair(a, b, 'concat');
  const ia = copyInto(out, a, 'a.'), ib = copyInto(out, b, 'b.');
  out.startId = ia.get(a.startId);
  for (const f of a.accepts) epsEdge(out, ia.get(f), ib.get(b.startId));
  out.accepts = b.accepts.map(id => ib.get(id));
  return out;
}

export function star(a) {
  requireFA(a, 'star');
  const out = blankTarget('ε-NFA', lettersOf(a), a.config);
  const ia = copyInto(out, a, '');
  out.states.unshift({ id: 's', name: 's' });
  out.startId = 's';
  epsEdge(out, 's', ia.get(a.startId));
  for (const f of a.accepts) epsEdge(out, ia.get(f), 's');
  out.accepts = ['s'];
  return out;
}

export function reverse(a) {
  requireFA(a, 'reverse');
  const sym = symOf(a);
  const letters = lettersOf(a);
  const out = blankTarget('ε-NFA', letters, a.config);
  const ids = new Map(a.states.map(s => [s.id, `r.${s.id}`]));
  for (const s of a.states) out.states.push({ id: ids.get(s.id), name: String(s.name ?? s.id) });
  out.states.unshift({ id: 's', name: 's' });
  out.startId = 's';
  for (const f of a.accepts) epsEdge(out, 's', ids.get(f));
  for (const t of a.transitions) {
    const syms = t.symbol === sym.any ? letters : [t.symbol];
    for (const x of syms) out.transitions.push({ id: `t${out.transitions.length + 1}`, from: ids.get(t.to), to: ids.get(t.from), symbol: x });
  }
  out.accepts = [ids.get(a.startId)];
  return out;
}

/** ε-elimination: an NFA with no ε-moves and the same language. */
export function epsilonFree(target) {
  requireFA(target, 'eps-elim');
  const sym = symOf(target);
  const letters = lettersOf(target);
  const out = new Map(target.states.map(s => [s.id, []]));
  for (const t of target.transitions) out.get(t.from)?.push(t);
  const close = id => {
    const seen = new Set([id]), stack = [id];
    while (stack.length) {
      for (const t of out.get(stack.pop()) || []) {
        if (t.symbol === sym.eps && !seen.has(t.to)) { seen.add(t.to); stack.push(t.to); }
      }
    }
    return seen;
  };
  const acc = new Set(target.accepts);
  const res = blankTarget('NFA', letters, target.config);
  res.states = target.states.map(s => ({ ...s }));
  res.startId = target.startId;
  const seen = new Set();
  for (const s of target.states) {
    const c = close(s.id);
    if ([...c].some(q => acc.has(q))) res.accepts.push(s.id);
    for (const q of c) {
      for (const t of out.get(q) || []) {
        if (t.symbol === sym.eps) continue;
        const syms = t.symbol === sym.any ? letters : [t.symbol];
        for (const x of syms) {
          const key = `${s.id}|${x}|${t.to}`;
          if (seen.has(key)) continue;
          seen.add(key);
          res.transitions.push({ id: `t${res.transitions.length + 1}`, from: s.id, to: t.to, symbol: x });
        }
      }
    }
  }
  return res;
}

// ── Regular expressions ───────────────────────────────────────────

/**
 * A regular expression → an ε-NFA by Thompson's construction, the app's own
 * parser (|, concatenation, * + ?, {n,m}, [classes], ε). `.` and negated
 * classes range over printable ASCII unless `sigma` names the alphabet.
 */
export function fromRegex(re, { sigma = null } = {}) {
  const sym0 = App.config.sym;
  // The notation the app writes (the Language panel, to-regex) reads back:
  // · is concatenation, the spaces around | are layout, the wildcard is "any
  // letter", and ∅ is the empty language. A symbol is one character here, so
  // none of these can be a letter.
  let src = String(re).replace(/·/g, '').replace(/\s+/g, '').split(sym0.any).join('.');
  if (src === '∅') {
    const empty = blankTarget('ε-NFA', sigma || [], {});
    empty.states = [{ id: 's0', name: 's0' }];
    empty.startId = 's0';
    return empty;
  }
  if (sigma && sigma.length) {
    // '.' outside a class is "any letter of Σ".
    let out = '', inClass = false;
    for (const c of src) {
      if (c === '[') inClass = true;
      if (c === ']') inClass = false;
      out += c === '.' && !inClass ? `(${sigma.join('|')})` : c;
    }
    src = out;
  }
  let nfa;
  try { nfa = thompsonBuild(src); }
  catch (e) { throw new CliError(`The regular expression could not be read: ${e.message}.`); }
  const sym = App.config.sym;
  const letters = new Set(sigma || []);
  for (const t of nfa.trans) if (t.sym !== sym.eps) letters.add(t.sym);
  const out = blankTarget('ε-NFA', [...letters].sort(), {});
  const ids = new Map(nfa.states.map((s, i) => [s, `s${i}`]));
  out.states = nfa.states.map((s, i) => ({ id: `s${i}`, name: `s${i}` }));
  out.startId = ids.get(nfa.start);
  out.accepts = [ids.get(nfa.accept)];
  out.transitions = nfa.trans.map((t, i) => ({ id: `t${i + 1}`, from: ids.get(t.from), to: ids.get(t.to), symbol: t.sym }));
  return out;
}

/** A finite automaton → a regular expression, by the Language panel's state elimination. */
export function toRegex(target) {
  requireFA(target, 'regex');
  return withMachine(target, () => deriveRegex());
}

// ── Words ─────────────────────────────────────────────────────────

/**
 * How many words of each length 0..maxLen the automaton accepts, exactly, by
 * dynamic programming over the subset DFA. BigInt, because |Σ|^n outruns a
 * double by length 60 on a binary alphabet.
 */
export function countByLength(target, maxLen) {
  const t = subsetTable(target);
  const k = t.sigma.length;
  const acc = new Set(t.acc);
  let ways = new Array(t.n).fill(0n);
  ways[t.start] = 1n;
  const out = [];
  for (let len = 0; len <= maxLen; len++) {
    let total = 0n;
    for (let q = 0; q < t.n; q++) if (acc.has(q)) total += ways[q];
    out.push(total);
    const next = new Array(t.n).fill(0n);
    for (let q = 0; q < t.n; q++) {
      if (!ways[q]) continue;
      for (let a = 0; a < k; a++) next[t.delta[q * k + a]] += ways[q];
    }
    ways = next;
  }
  return out;
}

/**
 * `count` accepted words of length exactly `len`, each drawn uniformly at
 * random from all accepted words of that length. The backward counts say how
 * many accepted completions each state has with r letters left, and each
 * letter is taken with probability proportional to its completions — which is
 * what makes the draw uniform over words rather than over paths.
 */
export function sampleAccepted(target, len, count, rnd = Math.random) {
  const t = subsetTable(target);
  const k = t.sigma.length;
  const acc = new Set(t.acc);
  // left[r][q] = accepted completions of length r from q.
  const left = [];
  left[0] = Array.from({ length: t.n }, (_, q) => (acc.has(q) ? 1n : 0n));
  for (let r = 1; r <= len; r++) {
    left[r] = new Array(t.n).fill(0n);
    for (let q = 0; q < t.n; q++) {
      let s = 0n;
      for (let a = 0; a < k; a++) s += left[r - 1][t.delta[q * k + a]];
      left[r][q] = s;
    }
  }
  const total = left[len][t.start];
  if (!total) return { total: 0n, words: [] };
  const words = [];
  for (let i = 0; i < count; i++) {
    const w = [];
    let q = t.start;
    for (let r = len; r > 0; r--) {
      let pick = randomBig(left[r][q], rnd);
      for (let a = 0; a < k; a++) {
        const to = t.delta[q * k + a];
        const c = left[r - 1][to];
        if (pick < c) { w.push(t.sigma[a]); q = to; break; }
        pick -= c;
      }
    }
    words.push(w);
  }
  return { total, words };
}

// A uniform BigInt in [0, n), by rejection. Built from 32-bit chunks because a
// seeded generator has 32 bits of precision: scaled to 52 bits, its low 20
// are always zero — and the mask below keeps the low bits.
function randomBig(n, rnd) {
  if (n <= 0n) return 0n;
  const bits = n.toString(2).length;
  for (;;) {
    let x = 0n;
    for (let b = 0; b < bits; b += 32) x = (x << 32n) | BigInt(Math.floor(rnd() * 2 ** 32));
    x &= (1n << BigInt(bits)) - 1n;
    if (x < n) return x;
  }
}

/** Accepted words in shortlex order up to `maxLen`, at most `limit` of them. */
export function listAccepted(target, maxLen, limit) {
  const t = subsetTable(target);
  const k = t.sigma.length;
  const acc = new Set(t.acc);
  // Only extend prefixes that can still reach acceptance within the bound.
  const live = new Set();
  for (let q = 0; q < t.n; q++) if (acc.has(q)) live.add(q);
  let changed = true;
  while (changed) {
    changed = false;
    for (let q = 0; q < t.n; q++) {
      if (live.has(q)) continue;
      for (let a = 0; a < k; a++) if (live.has(t.delta[q * k + a])) { live.add(q); changed = true; break; }
    }
  }
  const out = [];
  let level = live.has(t.start) ? [[[], t.start]] : [];
  for (let len = 0; len <= maxLen && level.length; len++) {
    for (const [w, q] of level) {
      if (acc.has(q)) { out.push(w); if (out.length >= limit) return out; }
    }
    if (len === maxLen) break;
    const next = [];
    for (const [w, q] of level) {
      for (let a = 0; a < k; a++) {
        const to = t.delta[q * k + a];
        if (live.has(to)) next.push([[...w, t.sigma[a]], to]);
      }
    }
    level = next;
  }
  return out;
}

/** A random DFA: n states over Σ, each move uniform, each state accepting with probability p. */
export function randomDfa(n, sigma, { p = 0.4, rnd = Math.random, complete = true } = {}) {
  const t = blankTarget('DFA', sigma);
  for (let q = 0; q < n; q++) t.states.push({ id: `q${q}`, name: `q${q}` });
  t.startId = 'q0';
  let id = 0;
  for (let q = 0; q < n; q++) {
    if (rnd() < p) t.accepts.push(`q${q}`);
    for (const a of sigma) {
      if (!complete && rnd() < 0.15) continue;
      t.transitions.push({ id: `t${++id}`, from: `q${q}`, to: `q${Math.floor(rnd() * n)}`, symbol: a });
    }
  }
  return t;
}

/** A seeded PRNG (mulberry32), so a generated set of exercises can be made again. */
export function seeded(seed) {
  let a = (Number(seed) >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
