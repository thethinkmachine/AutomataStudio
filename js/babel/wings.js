// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY OF BABEL — WINGS
// ══════════════════════════════════════════════════════════════════
// One wing per machine type the library numbers (DEFS, below, says which
// and why), and every wing says the same four things:
//
//   params    what sizes a room has (states, letters, tape symbols, …)
//   shape(p)  what a machine in room p is made of — js/babel/shape.js numbers it
//   toDoc     a body → the workspace document the rest of the app reads
//   fromDoc   a document → its room and body, or a sentence saying why not
//
// A wing holds its type's *formal definition* and nothing else, which is how
// the numbering stays a bijection: the same machine has one body, so it has one
// number. Concretely, a machine is read in a normal form:
//
//   • states are numbered from the start state, then in the document's order;
//   • letters are numbered in natural order and *named* canonically on the way
//     out (a, b, c, …; tape symbols ⊔, 1, 2, …; stack symbols Z, A, B, …), so
//     a machine over {0, 1} and its copy over {a, b} are one volume — the
//     reader's own names are kept for display, never for the number;
//   • a wildcard edge is expanded into the edges it stands for;
//   • a deterministic finite automaton is complete: a partial one is read with
//     a sink added, and the page says so;
//   • a store machine's bottom marker is Z, its other symbols A, B, C, …;
//     a counter's stack is Z under a run of 1s;
//   • what changes a machine's meaning is part of it, never a reader's
//     setting: a TM's tape is one-way (a two-way one is shelved in ITM), and
//     a pushdown automaton's convention (final state over Z, or empty stack)
//     is the first choice of its number.
//
// Anything a wing cannot hold — two moves a deterministic type forbids, a
// machine of a type with no wing — is refused with a reason, never approximated.
//
// The family modules in js/machines/ stay untouched: this file is the one
// place a wing is declared. tests/babel.test.js walks MachineTypes and holds
// every type to a wing or to readDocument's refusal.
//
// DOM-free and App-free, so the worker and the website read it as it is.

import { bits, fin, oneOf, option, seq, subset, table, tuple } from './shape.js';

// The app's default symbols, carried in every volume's document so it reads
// with its own spelling whatever the reader has configured.
export const SYM = Object.freeze({ eps: 'ε', any: 'Σ', blank: '⊔', leftMarker: '⊢', rightMarker: '⊣', stackBottom: 'Z', lambda: 'λ' });

const DIRS = ['L', 'R', 'S'];
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const STACK = 'ABCDEFGHIJKLMNOPQRSTUVWXY'; // Z is the bottom marker

// One code point per symbol, always: push strings and output words are split
// into characters by the simulators, so a two-character name would be two
// symbols. Past the pool, letters continue from the CJK block, which has more
// single characters than any room will ask for.
function pooled(pool, i) {
  return i < pool.length ? pool[i] : String.fromCodePoint(0x4E00 + i - pool.length);
}
export const letterName = i => pooled(LOWER, i);
export const stackName = i => pooled(STACK, i);
export const tapeName = i => (i === 0 ? SYM.blank : i <= 9 ? String(i) : pooled(LOWER, i - 10));
export const stateName = (i, letters = false) => (letters && i < 26 ? UPPER[i] : `q${i}`);

const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

class Refusal extends Error {}
const refuse = msg => { throw new Refusal(msg); };

// Empty strings over an empty alphabet: a shape with exactly one object, [].
const strings = (G, opts) => (G ? seq(fin(G), opts) : tuple());

// ── Building documents ────────────────────────────────────────────

function newDoc(type, n, { letters = false } = {}) {
  const states = [];
  for (let i = 0; i < n; i++) states.push({ id: `s${i}`, name: stateName(i, letters), x: 0, y: 0 });
  return {
    machine: type, states, transitions: [], startId: 's0', accepts: [],
    sigma: [], stackAlpha: [], outputAlpha: [],
    config: { sym: { ...SYM } }
  };
}

function addT(doc, t) {
  t.id = `t${doc.transitions.length + 1}`;
  doc.transitions.push(t);
}

const sid = i => `s${i}`;

const word = (list, name) => (list.length ? list.map(name).join('') : SYM.eps);

/**
 * Positions for a document that has none: columns by breadth-first distance
 * from the start, rows in the order the walk met them, unreachable states in a
 * last column. Deterministic, so a volume always draws the same.
 */
export function layoutDoc(doc) {
  const n = doc.states.length;
  const at = new Map(doc.states.map((s, i) => [s.id, i]));
  const out = Array.from({ length: n }, () => []);
  for (const t of doc.transitions) {
    const a = at.get(t.from), b = at.get(t.to);
    if (a !== undefined && b !== undefined && !out[a].includes(b)) out[a].push(b);
  }
  const depth = new Array(n).fill(-1);
  const order = [];
  const start = at.get(doc.startId) ?? 0;
  depth[start] = 0;
  order.push(start);
  for (let h = 0; h < order.length; h++) {
    for (const b of out[order[h]]) if (depth[b] < 0) { depth[b] = depth[order[h]] + 1; order.push(b); }
  }
  let maxD = Math.max(0, ...depth);
  for (let i = 0; i < n; i++) if (depth[i] < 0) { depth[i] = maxD + 1; order.push(i); }
  maxD = Math.max(0, ...depth);
  const cols = Array.from({ length: maxD + 1 }, () => []);
  for (const i of order) cols[depth[i]].push(i);
  const tall = Math.max(...cols.map(c => c.length));
  // A long chain folds into rows so a 40-state machine is not one line.
  const wrap = Math.max(1, Math.ceil(Math.sqrt(n * 1.6)));
  cols.forEach((c, d) => {
    c.forEach((i, row) => {
      const s = doc.states[i];
      const band = Math.floor(d / wrap), col = d % wrap;
      s.x = 120 + col * 150;
      s.y = 110 + band * (tall * 110 + 80) + (row - (c.length - 1) / 2) * 110 + ((tall - 1) / 2) * 110;
    });
  });
  return doc;
}

// ── Reading documents ─────────────────────────────────────────────

function symOf(doc) {
  return { ...SYM, ...(doc?.config?.sym || {}) };
}

/** The states, start first, then in document order. */
function readStates(doc) {
  if (!doc || !Array.isArray(doc.states) || !doc.states.length) refuse('It has no states.');
  const start = doc.states.find(s => s.id === doc.startId);
  if (!start) refuse('It has no start state.');
  const order = [start, ...doc.states.filter(s => s !== start)];
  const idx = new Map(order.map((s, i) => [s.id, i]));
  const accepts = new Set(doc.accepts || []);
  return { order, idx, n: order.length, accepting: order.map(s => (accepts.has(s.id) ? 1 : 0)) };
}

function stateIndex(S, id) {
  const i = S.idx.get(id);
  if (i === undefined) refuse('A transition leaves from or goes to a state that is not there.');
  return i;
}

/** A sorted alphabet from a declared list and the symbols actually used, without the specials. */
function alphabetOf(declared, used, skip) {
  const set = new Set();
  for (const s of declared || []) if (s !== undefined && s !== null && s !== '' && !skip.has(s)) set.add(String(s));
  for (const s of used) if (s !== undefined && s !== null && s !== '' && !skip.has(s)) set.add(String(s));
  return [...set].sort(natural);
}

function transitionsOf(doc) {
  return (doc.transitions || []).filter(t => !t.port);
}

/** Split a push string, an output word or a stack list into symbols. */
function charsOf(str, sym) {
  if (str === undefined || str === null || str === '' || str === sym.eps) return [];
  return [...String(str)];
}

function indexIn(list, s, what) {
  const i = list.indexOf(s);
  if (i < 0) refuse(`It uses ${what} “${s}”, which is not in its alphabet.`);
  return i;
}

/** The reader's own names, kept for display only. */
function namesOf(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => Array.isArray(v)));
}

// ── The finite automata ───────────────────────────────────────────

/**
 * Letters for a finite automaton, and its moves with wildcards expanded: a
 * wildcard edge stands for every letter its state has no specific edge on —
 * the most specific transition wins, as the simulator has it.
 */
function faMoves(doc, S, { allowEps }) {
  const sym = symOf(doc);
  const ts = transitionsOf(doc);
  const skip = new Set([sym.eps, sym.any, sym.leftMarker, sym.rightMarker]);
  const sigma = alphabetOf(doc.sigma, ts.map(t => t.symbol), skip);
  const moves = [];
  const specific = new Set();
  for (const t of ts) {
    const from = stateIndex(S, t.from), to = stateIndex(S, t.to);
    if (t.symbol === sym.any) continue;
    if (t.symbol === sym.eps || t.symbol === '' || t.symbol === undefined) {
      if (!allowEps) refuse('It has an ε-move, which this type does not allow.');
      moves.push({ from, to, a: -1 });
      continue;
    }
    const a = indexIn(sigma, String(t.symbol), 'the letter');
    specific.add(`${from}|${a}`);
    moves.push({ from, to, a });
  }
  const notes = [];
  for (const t of ts) {
    if (t.symbol !== sym.any) continue;
    const from = stateIndex(S, t.from), to = stateIndex(S, t.to);
    sigma.forEach((_, a) => { if (!specific.has(`${from}|${a}`)) moves.push({ from, to, a }); });
    if (!notes.length) notes.push('Wildcard edges were expanded into the letters they stand for.');
  }
  if (!sigma.length) refuse('It has no letters.');
  return { sigma, moves, notes };
}

/** δ as a complete table, adding a sink when it is partial. */
function completeTable(S, sigma, moves, { what = 'DFA', sink = () => {} } = {}) {
  const k = sigma.length;
  let n = S.n;
  const delta = new Array(n * k).fill(null);
  for (const m of moves) {
    const i = m.from * k + m.a;
    if (delta[i] !== null && delta[i] !== m.to) refuse(`It has two moves from one state on “${sigma[m.a]}”; a ${what} has one.`);
    delta[i] = m.to;
  }
  const notes = [];
  if (delta.includes(null)) {
    const q = n;
    n += 1;
    for (let i = 0; i < delta.length; i++) if (delta[i] === null) delta[i] = q;
    for (let a = 0; a < k; a++) delta.push(q);
    sink(q);
    notes.push(`It was partial, so it is read with a sink state added (${what}s here are complete).`);
  }
  return { n, delta, notes };
}

function detFaWing(type, { omega = null } = {}) {
  return {
    type,
    params: [{ id: 'states', min: 1 }, { id: 'letters', min: 1 }],
    kind: omega ? 'omega' : 'fa',
    omega,
    shape: ([n, k]) => tuple(bits(n), table(n * k, fin(n))),
    toDoc([acc, delta], [n, k]) {
      const doc = newDoc(type, n);
      doc.sigma = Array.from({ length: k }, (_, a) => letterName(a));
      doc.accepts = acc.map((b, q) => (b ? sid(q) : null)).filter(Boolean);
      for (let q = 0; q < n; q++) for (let a = 0; a < k; a++) addT(doc, { from: sid(q), to: sid(delta[q * k + a]), symbol: letterName(a) });
      return layoutDoc(doc);
    },
    fromDoc(doc) {
      const S = readStates(doc);
      const { sigma, moves, notes } = faMoves(doc, S, { allowEps: false });
      const acc = [...S.accepting];
      const t = completeTable(S, sigma, moves, { what: type, sink: () => acc.push(0) });
      return { params: [t.n, sigma.length], body: [acc, t.delta], notes: [...notes, ...t.notes], names: namesOf({ sigma }) };
    },
    tile: (path, value, [n, k]) => {
      if (path[0] === 0) return { key: 'F', value: value === null ? '' : `{${value.map((b, q) => (b ? stateName(q) : null)).filter(Boolean).join(', ')}}` };
      const i = path[1], q = Math.floor(i / k), a = i % k;
      return { key: `${stateName(q)} · ${letterName(a)}`, value: stateName(value), edge: [q, value] };
    }
  };
}

function nondetFaWing(type, { omega = null } = {}) {
  return {
    type,
    params: [{ id: 'states', min: 1 }, { id: 'letters', min: 1 }],
    kind: omega ? 'omega' : 'fa',
    omega,
    shape: ([n, k]) => tuple(bits(n), subset(tuple(fin(n), fin(k), fin(n)))),
    toDoc([acc, moves], [n, k]) {
      const doc = newDoc(type, n);
      doc.sigma = Array.from({ length: k }, (_, a) => letterName(a));
      doc.accepts = acc.map((b, q) => (b ? sid(q) : null)).filter(Boolean);
      for (const [from, a, to] of moves) addT(doc, { from: sid(from), to: sid(to), symbol: letterName(a) });
      return layoutDoc(doc);
    },
    fromDoc(doc) {
      const S = readStates(doc);
      const { sigma, moves, notes } = faMoves(doc, S, { allowEps: false });
      const k = sigma.length;
      const seen = new Set(), body = [];
      for (const m of moves) {
        const a = m.a;
        const key = `${m.from}|${a}|${m.to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        body.push([m.from, a, m.to]);
      }
      return { params: [S.n, k], body: [[...S.accepting], body], notes, names: namesOf({ sigma }) };
    },
    move: ([from, a, to]) => `${stateName(from)} —${letterName(a)}→ ${stateName(to)}`
  };
}

function dirOf(d) {
  const i = DIRS.indexOf(d || 'R');
  if (i < 0) refuse(`It moves “${d}”, which is not L, R or S.`);
  return i;
}

// ── One-counter automata ──────────────────────────────────────────

/**
 * A counter is a stack over {Z, 1}: Z marks zero, each 1 above it is one.
 * The wing holds the bottom-marker, final-state convention its definition uses.
 */
const COUNTER_GAMMA = Object.freeze([SYM.stackBottom, '1']);

function readCounter(doc) {
  const sym = symOf(doc);
  const ts = transitionsOf(doc);
  if ((doc.config?.pdaParadigm ?? 'explicit') === 'empty') refuse('It accepts by empty stack; this wing holds the bottom-marker, final-state convention its definition uses.');
  const skip = new Set([sym.eps, sym.any, sym.leftMarker, sym.rightMarker]);
  const sigma = alphabetOf(doc.sigma, ts.map(t => t.symbol), skip);
  if (!sigma.length) refuse('It has no letters.');
  for (const t of ts) for (const f of ['pop', 'push', 'symbol']) if (t[f] === sym.any) refuse('It has a wildcard in a move; this wing holds machines without them.');
  const gamma = COUNTER_GAMMA;
  const g = s => indexIn(gamma, s, 'the stack symbol');
  return { sym, ts, sigma, k: sigma.length, gamma, g };
}

const pushOf = (str, R) => charsOf(str, R.sym).map(R.g);
const popOf = (s, R) => (s === undefined || s === null || s === '' || s === R.sym.eps ? R.gamma.length : R.g(s));

/**
 * The one-counter automaton: a nondeterministic store machine whose stack is
 * a counter. A move reads a letter or ε, pops Z, 1 or nothing, and pushes a
 * word over {Z, 1}. (Its number is the one the store-machine family gave it,
 * so a Counter address names the same machine it always did.)
 */
const COUNTER = (() => {
  const G = COUNTER_GAMMA.length;
  const moveShape = (n, k) => tuple([fin(n), fin(k + 1), fin(G + 1), fin(n), strings(G)]);
  return {
    type: 'Counter',
    params: [{ id: 'states', min: 1 }, { id: 'letters', min: 1 }],
    kind: 'cf', store: true, explicitOnly: true,
    shape: ([n, k]) => tuple(bits(n), subset(moveShape(n, k))),
    toDoc([acc, moves], [n, k]) {
      const doc = newDoc('Counter', n);
      doc.sigma = Array.from({ length: k }, (_, a) => letterName(a));
      doc.stackAlpha = [...COUNTER_GAMMA];
      doc.config.pdaParadigm = 'explicit';
      doc.accepts = acc.map((b, q) => (b ? sid(q) : null)).filter(Boolean);
      const popName = i => (i === G ? SYM.eps : COUNTER_GAMMA[i]);
      for (const [from, a, pop, to, push] of moves) {
        addT(doc, { from: sid(from), to: sid(to), symbol: a === k ? SYM.eps : letterName(a), pop: popName(pop), push: word(push, x => COUNTER_GAMMA[x]) });
      }
      return layoutDoc(doc);
    },
    fromDoc(doc) {
      const S = readStates(doc);
      const R = readCounter(doc);
      const pushOf = str => charsOf(str, R.sym).map(R.g);
      const popOf = s => (s === undefined || s === null || s === '' || s === R.sym.eps ? G : R.g(s));
      const seen = new Set(), moves = [];
      for (const t of R.ts) {
        const a = t.symbol === R.sym.eps || t.symbol === '' || t.symbol === undefined ? R.k : indexIn(R.sigma, String(t.symbol), 'the letter');
        const mv = [stateIndex(S, t.from), a, popOf(t.pop), stateIndex(S, t.to), pushOf(t.push)];
        const key = JSON.stringify(mv);
        if (!seen.has(key)) { seen.add(key); moves.push(mv); }
      }
      return { params: [S.n, R.k], body: [[...S.accepting], moves], notes: [], names: namesOf({ sigma: R.sigma, stackAlpha: R.gamma }) };
    },
    move: (mv, [n, k]) => `${stateName(mv[0])} —${mv[1] === k ? SYM.eps : letterName(mv[1])}→ ${stateName(mv[3])}`
  };
})();

// ── Pushdown automata ─────────────────────────────────────────────
//
// Both wings hold either convention, as the app does: a bottom marker Z under
// everything with acceptance by final state, or an empty start stack with
// acceptance by empty stack (the bracket matcher's). The convention is the
// first choice of the number — explicit first — so it is part of the machine,
// never the reader's setting. These are the numberings the two wings had
// before 2026-10-15, restored unchanged: an old DPDA or NPDA address names the
// machine it always did.

/**
 * A store machine's symbols: under the explicit convention Z is symbol 0 and
 * the room's m others follow; under the empty-stack convention there is no Z.
 */
function storeAlphabet(explicit, m) {
  const out = [];
  if (explicit) out.push(SYM.stackBottom);
  for (let i = 0; i < m; i++) out.push(stackName(i));
  return out;
}

function readStore(doc) {
  const sym = symOf(doc);
  const ts = transitionsOf(doc);
  const explicit = (doc.config?.pdaParadigm ?? 'explicit') !== 'empty';
  const skip = new Set([sym.eps, sym.any, sym.leftMarker, sym.rightMarker]);
  const sigma = alphabetOf(doc.sigma, ts.map(t => t.symbol), skip);
  if (!sigma.length) refuse('It has no letters.');
  for (const t of ts) for (const f of ['pop', 'push', 'symbol']) if (t[f] === sym.any) refuse('It has a wildcard in a move; this wing holds machines without them.');
  const used = [];
  for (const t of ts) {
    if (t.pop && t.pop !== sym.eps) used.push(t.pop);
    used.push(...charsOf(t.push, sym));
  }
  const others = alphabetOf(doc.stackAlpha, used, new Set([sym.eps, sym.stackBottom, sym.any]));
  const gamma = explicit ? [sym.stackBottom, ...others] : others;
  const g = s => indexIn(gamma, s, 'the stack symbol');
  return { sym, ts, sigma, k: sigma.length, explicit, gamma, m: others.length, g };
}

const readOf = (t, R) => (t.symbol === R.sym.eps || t.symbol === '' || t.symbol === undefined ? -1 : indexIn(R.sigma, String(t.symbol), 'the letter'));
const emptyStackNote = S => (S.accepting.some(Boolean) ? ['It accepts by empty stack, so its accepting states are not part of it.'] : []);

/** The nondeterministic pushdown automaton: δ is a set of moves, under either convention. */
const NPDA = (() => {
  // A move: from, read (letters, then ε), pop (Γ, then nothing), to, push.
  const moveShape = (n, k, G) => tuple([fin(n), fin(k + 1), fin(G + 1), fin(n), strings(G)]);
  return {
    type: 'NPDA',
    params: [{ id: 'states', min: 1 }, { id: 'letters', min: 1 }, { id: 'stack symbols', min: 0 }],
    kind: 'cf', store: true,
    shape: ([n, k, m]) => oneOf(tuple(bits(n), subset(moveShape(n, k, m + 1))), subset(moveShape(n, k, m))),
    toDoc(body, [n, k, m]) {
      const explicit = body.tag === 0;
      const [acc, moves] = explicit ? body.value : [new Array(n).fill(0), body.value];
      const gamma = storeAlphabet(explicit, m);
      const doc = newDoc('NPDA', n);
      doc.sigma = Array.from({ length: k }, (_, a) => letterName(a));
      doc.stackAlpha = [...gamma];
      doc.config.pdaParadigm = explicit ? 'explicit' : 'empty';
      doc.accepts = acc.map((b, q) => (b ? sid(q) : null)).filter(Boolean);
      const popName = i => (i === gamma.length ? SYM.eps : gamma[i]);
      for (const [from, a, pop, to, push] of moves) {
        addT(doc, { from: sid(from), to: sid(to), symbol: a === k ? SYM.eps : letterName(a), pop: popName(pop), push: word(push, x => gamma[x]) });
      }
      return layoutDoc(doc);
    },
    fromDoc(doc) {
      const S = readStates(doc);
      const R = readStore(doc);
      const G = R.gamma.length;
      const seen = new Set(), moves = [];
      for (const t of R.ts) {
        const a = readOf(t, R);
        const pop = t.pop === undefined || t.pop === null || t.pop === '' || t.pop === R.sym.eps ? G : R.g(t.pop);
        const mv = [stateIndex(S, t.from), a < 0 ? R.k : a, pop, stateIndex(S, t.to), charsOf(t.push, R.sym).map(R.g)];
        const key = JSON.stringify(mv);
        if (!seen.has(key)) { seen.add(key); moves.push(mv); }
      }
      const body = R.explicit ? { tag: 0, value: [[...S.accepting], moves] } : { tag: 1, value: moves };
      return { params: [S.n, R.k, R.m], body, notes: R.explicit ? [] : emptyStackNote(S), names: namesOf({ sigma: R.sigma, stackAlpha: R.gamma }) };
    },
    move: (mv, [n, k]) => `${stateName(mv[0])} —${mv[1] === k ? SYM.eps : letterName(mv[1])}→ ${stateName(mv[3])}`
  };
})();

/**
 * One state's moves in a DPDA, exactly as the app's determinism rule allows
 * them. A move reads a letter or ε and pops a symbol or nothing, and two moves
 * from a state clash when their reads overlap (ε overlaps everything) and their
 * pops overlap (popping nothing overlaps everything). Every clash-free set of
 * moves is one of three kinds, and each has one body:
 *
 *   0  one move that reads ε and pops nothing — it is the state's only move;
 *   1  no move reads ε: each letter has either one move that pops nothing, or
 *      a row of optional moves, one per stack symbol;
 *   2  some move reads ε and pops a symbol (so none pops nothing): j is the
 *      first such symbol; the symbols before it have a column of optional
 *      letter moves, j has its ε-move, and each symbol after has either an
 *      ε-move or a column.
 */
function dpdaStateShape(n, k, G) {
  const move = tuple(fin(n), strings(G));
  const cell = option(move);
  const rows = table(k, oneOf(move, table(G, cell)));
  const kinds = [move, rows];
  if (G > 0) {
    kinds.push(oneOf(Array.from({ length: G }, (_, j) =>
      tuple(table(j, table(k, cell)), move, table(G - 1 - j, oneOf(move, table(k, cell)))))));
  }
  return oneOf(kinds);
}

/** A state's body → its moves as { a (letter, or -1 for ε), X (symbol, or G for nothing), mv: [to, push] }. */
function dpdaStateMoves(s, k, G) {
  const out = [];
  if (s.tag === 0) out.push({ a: -1, X: G, mv: s.value });
  else if (s.tag === 1) {
    s.value.forEach((row, a) => {
      if (row.tag === 0) out.push({ a, X: G, mv: row.value });
      else row.value.forEach((mv, X) => { if (mv) out.push({ a, X, mv }); });
    });
  } else {
    const j = s.value.tag, [before, eps, after] = s.value.value;
    const column = (col, X) => col.forEach((mv, a) => { if (mv) out.push({ a, X, mv }); });
    before.forEach((col, X) => column(col, X));
    out.push({ a: -1, X: j, mv: eps });
    after.forEach((c, i) => {
      const X = j + 1 + i;
      if (c.tag === 0) out.push({ a: -1, X, mv: c.value });
      else column(c.value, X);
    });
  }
  return out;
}

/** A state's moves → its body, refusing a set the determinism rule forbids. */
function dpdaStateBody(moves, k, G) {
  for (let i = 0; i < moves.length; i++) for (let j = i + 1; j < moves.length; j++) {
    const x = moves[i], y = moves[j];
    const reads = x.a < 0 || y.a < 0 || x.a === y.a;
    const pops = x.X === G || y.X === G || x.X === y.X;
    if (reads && pops) refuse('It can make two moves from one configuration; a DPDA has at most one.');
  }
  const epsEps = moves.find(m => m.a < 0 && m.X === G);
  if (epsEps) return { tag: 0, value: epsEps.mv };
  const epsCols = moves.filter(m => m.a < 0);
  const at = (a, X) => moves.find(m => m.a === a && m.X === X)?.mv || null;
  if (!epsCols.length) {
    return {
      tag: 1,
      value: Array.from({ length: k }, (_, a) => {
        const popless = at(a, G);
        return popless ? { tag: 0, value: popless } : { tag: 1, value: Array.from({ length: G }, (_, X) => at(a, X)) };
      })
    };
  }
  const j = Math.min(...epsCols.map(m => m.X));
  const col = X => Array.from({ length: k }, (_, a) => at(a, X));
  const before = Array.from({ length: j }, (_, X) => col(X));
  const after = Array.from({ length: G - 1 - j }, (_, i) => {
    const X = j + 1 + i, e = at(-1, X);
    return e ? { tag: 0, value: e } : { tag: 1, value: col(X) };
  });
  return { tag: 2, value: { tag: j, value: [before, at(-1, j), after] } };
}

/** The DPDA wing: per state, the moves its determinism rule allows, under either convention. */
const DPDA = {
  type: 'DPDA',
  params: [{ id: 'states', min: 1 }, { id: 'letters', min: 1 }, { id: 'stack symbols', min: 0 }],
  kind: 'dcf', store: true,
  shape: ([n, k, m]) => oneOf(
    tuple(bits(n), table(n, dpdaStateShape(n, k, m + 1))),
    table(n, dpdaStateShape(n, k, m))
  ),
  toDoc(body, [n, k, m]) {
    const explicit = body.tag === 0;
    const [acc, states] = explicit ? body.value : [new Array(n).fill(0), body.value];
    const gamma = storeAlphabet(explicit, m);
    const G = gamma.length;
    const doc = newDoc('DPDA', n);
    doc.sigma = Array.from({ length: k }, (_, a) => letterName(a));
    doc.stackAlpha = [...gamma];
    doc.config.pdaParadigm = explicit ? 'explicit' : 'empty';
    doc.accepts = acc.map((b, q) => (b ? sid(q) : null)).filter(Boolean);
    states.forEach((s, q) => {
      for (const { a, X, mv } of dpdaStateMoves(s, k, G)) {
        addT(doc, {
          from: sid(q), to: sid(mv[0]), symbol: a < 0 ? SYM.eps : letterName(a),
          pop: X === G ? SYM.eps : gamma[X], push: word(mv[1], x => gamma[x])
        });
      }
    });
    return layoutDoc(doc);
  },
  fromDoc(doc) {
    const S = readStates(doc);
    const R = readStore(doc);
    const n = S.n, k = R.k, G = R.gamma.length;
    const per = Array.from({ length: n }, () => []);
    for (const t of R.ts) {
      const X = t.pop === undefined || t.pop === null || t.pop === '' || t.pop === R.sym.eps ? G : R.g(t.pop);
      per[stateIndex(S, t.from)].push({ a: readOf(t, R), X, mv: [stateIndex(S, t.to), charsOf(t.push, R.sym).map(R.g)] });
    }
    const states = per.map(moves => dpdaStateBody(moves, k, G));
    const body = R.explicit ? { tag: 0, value: [[...S.accepting], states] } : { tag: 1, value: states };
    return { params: [n, k, R.m], body, notes: R.explicit ? [] : emptyStackNote(S), names: namesOf({ sigma: R.sigma, stackAlpha: R.gamma }) };
  },
  move: mv => `to ${stateName(mv[0])}`
};

/**
 * A store machine's volume as plain moves, for the analyses in
 * context-free.js: { n, k, G, explicit, acc, moves }, a move being
 * { from, a (letter, or -1 for ε), pop (symbol, or -1 for nothing), to, push }
 * with push[0] the symbol that ends on top. Under the explicit convention the
 * stack starts as [Z] — symbol 0 — and acceptance is by final state; otherwise
 * it starts empty and acceptance is by empty stack.
 */
export function storeMoves(wing, params, body) {
  const [n, k] = params;
  const out = [];
  let explicit = true, acc, G;
  if (wing.type === 'DPDA') {
    explicit = body.tag === 0;
    G = explicit ? params[2] + 1 : params[2];
    const states = explicit ? body.value[1] : body.value;
    acc = explicit ? body.value[0] : null;
    states.forEach((s, q) => {
      for (const { a, X, mv } of dpdaStateMoves(s, k, G)) out.push({ from: q, a, pop: X === G ? -1 : X, to: mv[0], push: mv[1] });
    });
  } else {
    let moves;
    if (wing.type === 'Counter') { G = COUNTER_GAMMA.length; [acc, moves] = body; }
    else {
      explicit = body.tag === 0;
      G = explicit ? params[2] + 1 : params[2];
      [acc, moves] = explicit ? body.value : [null, body.value];
    }
    for (const [from, a, pop, to, push] of moves) out.push({ from, a: a === k ? -1 : a, pop: pop === G ? -1 : pop, to, push });
  }
  return { n, k, G, explicit, acc: acc ? Uint8Array.from(acc) : null, moves: out };
}

// ── Turing machines ───────────────────────────────────────────────

function readTape(doc, S) {
  const sym = symOf(doc);
  const ts = transitionsOf(doc);
  const skip = new Set([sym.eps, sym.any, sym.blank, sym.leftMarker, sym.rightMarker]);
  const used = [];
  for (const t of ts) {
    used.push(t.symbol, t.write);
    for (const f of ['tapeSyms', 'tapeWrites']) if (Array.isArray(t[f])) used.push(...t[f]);
  }
  const others = alphabetOf([...(doc.stackAlpha || []), ...(doc.sigma || [])], used, skip);
  const gamma = [sym.blank, ...others];
  const K = gamma.length;
  const readIdx = s => indexIn(gamma, String(s), 'the tape symbol');
  const notes = [];
  const declared = new Set(doc.sigma || []);
  if (others.some(s => !declared.has(s))) notes.push('Every non-blank tape symbol is read as an input letter here.');
  return { sym, ts, gamma, K, readIdx, notes };
}

function tmWing(type, { twoWay }) {
  return {
    type,
    params: [{ id: 'states', min: 1 }, { id: 'tape symbols', min: 2 }],
    kind: 'tm',
    shape: ([n, K]) => tuple(bits(n), table(n * K, option(tuple(fin(K), fin(3), fin(n))))),
    toDoc([acc, delta], [n, K]) {
      const R = K;
      const doc = newDoc(type, n, { letters: true });
      const gamma = Array.from({ length: K }, (_, i) => tapeName(i));
      const nameOf = i => gamma[i];
      doc.sigma = gamma.slice(1);
      doc.stackAlpha = [...gamma];
      doc.tapeCount = 1;
      doc.config.twoWayTape = twoWay;
      doc.accepts = acc.map((b, q) => (b ? sid(q) : null)).filter(Boolean);
      delta.forEach((m, i) => {
        if (!m) return;
        const q = Math.floor(i / R), c = i % R;
        addT(doc, { from: sid(q), to: sid(m[2]), symbol: nameOf(c), write: nameOf(m[0]), dir: DIRS[m[1]] });
      });
      return layoutDoc(doc);
    },
    fromDoc(doc) {
      const S = readStates(doc);
      const T = readTape(doc, S);
      const n = S.n, K = T.K, R = K;
      const delta = new Array(n * R).fill(null);
      const notes = [...T.notes];
      const specific = new Set();
      for (const t of T.ts) {
        if (t.symbol === T.sym.any) continue;
        const q = stateIndex(S, t.from), c = T.readIdx(t.symbol), i = q * R + c;
        if (delta[i]) refuse(`It has two moves from one state on “${t.symbol}”; a ${type} has one.`);
        const w = t.write === T.sym.any || t.write === undefined ? c : T.readIdx(t.write);
        delta[i] = [w, dirOf(t.dir), stateIndex(S, t.to)];
        specific.add(i);
      }
      for (const t of T.ts) {
        if (t.symbol !== T.sym.any) continue;
        const q = stateIndex(S, t.from);
        for (let c = 0; c < R; c++) {
          const i = q * R + c;
          if (specific.has(i)) continue;
          const w = t.write === T.sym.any || t.write === undefined ? c : T.readIdx(t.write);
          delta[i] = [w, dirOf(t.dir), stateIndex(S, t.to)];
        }
        if (!notes.includes('Wildcard edges were expanded into the symbols they stand for.')) notes.push('Wildcard edges were expanded into the symbols they stand for.');
      }
      return { params: [n, K], body: [[...S.accepting], delta], notes, names: namesOf({ stackAlpha: T.gamma }) };
    },
    tile: (path, value, [n, K]) => {
      if (path[0] === 0) return { key: 'F', value: `{${value.map((b, q) => (b ? stateName(q, true) : null)).filter(Boolean).join(', ')}}` };
      const R = K, i = path[1], q = Math.floor(i / R), c = i % R;
      const nm = tapeName;
      return { key: `${stateName(q, true)}${nm(c)}`, value: value ? `${nm(value[0])}${DIRS[value[1]]}${stateName(value[2], true)}` : '—', edge: value ? [q, value[2]] : null };
    }
  };
}

// ── The table ─────────────────────────────────────────────────────

/**
 * The wings: the machines whose numbering answers a question a theory of
 * computation course asks, and whose map is decided rather than guessed —
 * DFA and NFA (counting languages, state complexity), the Büchi pair (the one
 * place determinism costs ω-regular power), the pushdown pair and the
 * one-counter automaton (context-free languages, and the edge of what can be
 * decided about them), and the Turing machine on a one-way and a two-way tape
 * (the busy beaver programme). The other machine types were cut on
 * 2026-10-15: equivalent to one of these (ε-NFA, two-way automata, the queue,
 * two-stack, nondeterministic and multi-tape machines), the same tables read
 * with a dual condition (co-Büchi), endless only by an encoding artefact
 * (parity priorities), or coloured by short-word guesses where the theory has
 * more to say (linear-bounded, probabilistic, transducers).
 *
 * DPDA and NPDA were cut with the last group and came back on 2026-10-16,
 * once their maps were exact (context-free.js): emptiness and finiteness are
 * decidable for every pushdown automaton, and universality for a deterministic
 * one — so the DPDA map has a Σ* colour the NPDA map cannot have.
 */
const DEFS = [
  detFaWing('DFA'),
  nondetFaWing('NFA'),
  detFaWing('DBA', { omega: 'buchi' }),
  nondetFaWing('NBA', { omega: 'buchi' }),
  DPDA,
  NPDA,
  COUNTER,
  tmWing('TM', { twoWay: false }),
  tmWing('ITM', { twoWay: true })
];

/**
 * The wing's key in an address: the type's name in lower case. A key is the
 * first part of an address, where `-` separates the room's parameters, so a
 * key has no hyphen.
 */
export const wingKeyOf = type => type.toLowerCase().replace('ε', 'e').replace(/-/g, '');

export const WINGS = DEFS.map(d => Object.freeze({ ...d, key: wingKeyOf(d.type) }));
const BY_KEY = new Map(WINGS.map(w => [w.key, w]));
const BY_TYPE = new Map(WINGS.map(w => [w.type, w]));

/**
 * Machine types with no wing of their own, because another wing already holds
 * their machines. PDA is the app's hidden alias of DPDA. A weak automaton is a Büchi
 * automaton whose every cycle sits wholly inside or outside F, and it decides
 * exactly as Büchi does — the app only warns when the structure is not weak —
 * so a weak wing would be the Büchi wing again under another name. The Büchi
 * volume's page says whether it is weak.
 */
export const WINGLESS_ALIASES = Object.freeze({ PDA: 'DPDA', DWA: 'DBA', NWA: 'NBA' });
const ALIAS_KEYS = new Map(Object.entries(WINGLESS_ALIASES).map(([a, t]) => [wingKeyOf(a), wingKeyOf(t)]));

/** Why a machine of a type with no wing has no volume: the sentence every refusal uses. */
export function unnumbered(type) {
  const kinds = WINGS.map(w => w.type).join(', ').replace(/, ([^,]*)$/, ' and $1');
  return `AutomataStudio Babel numbers ${kinds} machines; a ${type || 'machine of this type'} has no volume here.`;
}

/**
 * The machine type an address's key names when no wing holds it — a type the
 * library numbered before 2026-10-15 (qa, pfa, e-nfa, …) — or null. An old
 * link to one is refused in a sentence rather than read as something else.
 */
export function unnumberedTypeOfKey(key) {
  const k = String(key || '').toLowerCase();
  if (wingByKey(k)) return null;
  return FORMER_TYPES.find(t => wingKeyOf(t) === k || t.toLowerCase().replace('ε', 'e') === k) || null;
}
const FORMER_TYPES = ['ε-NFA', '2DFA', '2NFA', 'PFA', 'DcoBA', 'DPA', 'NcoBA', 'NPA', 'QA', '2PDA', 'EPDA', 'NDTM', 'MTM', 'LBA', 'Moore', 'Mealy', 'FST', 'PDT', '2DFT'];

export function wingByKey(key) {
  const k = String(key || '').toLowerCase();
  return BY_KEY.get(k) || BY_KEY.get(ALIAS_KEYS.get(k)) || null;
}
export function wingOf(type) { return BY_TYPE.get(type) || BY_TYPE.get(WINGLESS_ALIASES[type]) || null; }

/** True when every room of the wing is finite. */
export function wingIsFinite(wing) {
  return wing.shape(wing.params.map(p => Math.max(p.min, 1))).finite;
}

// ── Rooms ─────────────────────────────────────────────────────────

const shapeCache = new Map();

/** The shape of room `params` in `wing`, built once. */
export function roomShape(wing, params) {
  const id = roomId(wing, params);
  let s = shapeCache.get(id);
  if (!s) {
    s = wing.shape(params);
    if (shapeCache.size > 400) shapeCache.clear();
    shapeCache.set(id, s);
  }
  return s;
}

export function roomId(wing, params) {
  return `${wing.key}-${params.join('-')}`;
}

/** Check a room's parameters against the wing's minimums; the sentence when they fail. */
export function roomProblem(wing, params) {
  if (!Array.isArray(params) || params.length !== wing.params.length) return `A ${wing.type} room has ${wing.params.length} sizes: ${wing.params.map(p => p.id).join(', ')}.`;
  for (let i = 0; i < params.length; i++) {
    const p = params[i], spec = wing.params[i];
    if (!Number.isInteger(p) || p < spec.min) return `The number of ${spec.id} must be at least ${spec.min}.`;
  }
  return null;
}

/** A body → its document, through the wing — the one way a volume becomes a machine. */
export function documentOf(wing, params, body) {
  return wing.toDoc(body, params);
}

/** A document → { wing, params, body, notes, names } or { error }. */
export function readDocument(doc) {
  let wing = wingOf(doc?.machine);
  if (!wing) return { error: unnumbered(doc?.machine) };
  const moved = [];
  if (wing.type === 'TM' && doc.config?.twoWayTape) {
    wing = BY_TYPE.get('ITM');
    moved.push('Its tape is two-way, so it is shelved with the two-way Turing machines, in ITM.');
  } else if (doc.machine === 'DWA' || doc.machine === 'NWA') {
    moved.push(`A weak automaton decides as a Büchi automaton does, so it is shelved in ${wing.type}.`);
  }
  // Blocks are grouping: every state of a machine built from them is already
  // in doc.states, so the flat machine is what is read — the same rule as
  // machineIdOf's flat canonical code.
  try {
    const r = wing.fromDoc(doc);
    const problem = roomProblem(wing, r.params);
    if (problem) return { error: problem };
    return { wing, ...r, notes: [...moved, ...(r.notes || [])] };
  } catch (e) {
    if (e instanceof Refusal) return { error: e.message };
    throw e;
  }
}

/**
 * A volume's document with the reader's own letters put back: `names` is what
 * `readDocument` kept ({ sigma, stackAlpha, outputAlpha }), index for index
 * with the canonical a, b, …; Z, A, …; ⊔, 1, …. The number is the same machine
 * either way — this is for display, the canvas and My Library, so a machine
 * looked up over {x, y, z} comes back over {x, y, z}.
 *
 * The app's own symbols (ε, the blank, the bottom marker, the end markers)
 * keep their canonical spelling, since the document's config names them. A
 * store or output alphabet whose words are split into characters (push
 * strings, output words) is renamed only when every name is one code point;
 * otherwise the whole document stays canonical rather than half-renamed.
 */
export function withReaderNames(doc, names) {
  if (!doc || !names) return doc;
  const special = new Set(Object.values(SYM));
  const mapOf = (canon, mine) => {
    if (!Array.isArray(mine)) return null;
    const list = (canon || []).filter(s => s !== SYM.leftMarker && s !== SYM.rightMarker);
    if (list.length !== mine.length) return null;
    const m = new Map();
    list.forEach((s, i) => { if (!special.has(s) && !special.has(String(mine[i]))) m.set(s, String(mine[i])); });
    return m.size ? m : null;
  };
  const tapeLike = !names.sigma && Array.isArray(names.stackAlpha);
  const store = mapOf(doc.stackAlpha, names.stackAlpha);
  const input = tapeLike ? store : mapOf(doc.sigma, names.sigma);
  const output = mapOf(doc.outputAlpha, names.outputAlpha);
  if (!input && !store && !output) return doc;
  const oneCp = m => !m || [...m.values()].every(v => [...v].length === 1);
  const usesWords = doc.transitions.some(t => t.push !== undefined || t.push2 !== undefined || t.below !== undefined);
  // Moore and Mealy emit one letter a move; the other transducers emit words.
  const outputWords = doc.machine !== 'Moore' && doc.machine !== 'Mealy';
  if ((usesWords && !oneCp(store)) || (outputWords && !oneCp(output))) return doc;

  const one = m => s => (m && typeof s === 'string' && m.has(s) ? m.get(s) : s);
  const words = m => w => (m && typeof w === 'string' && w !== SYM.eps ? [...w].map(one(m)).join('') : w);
  const inName = one(input), stName = one(store), outName = one(output);
  const stWord = words(store), outWord = outputWords ? words(output) : outName;
  const symName = tapeLike ? stName : inName;
  const out = {
    ...doc,
    sigma: (doc.sigma || []).map(symName),
    stackAlpha: (doc.stackAlpha || []).map(stName),
    outputAlpha: (doc.outputAlpha || []).map(outName),
    states: doc.states.map(s => (s.output !== undefined ? { ...s, output: outWord(s.output) } : s)),
    transitions: doc.transitions.map(t => {
      const r = { ...t };
      if (t.symbol !== undefined) r.symbol = symName(t.symbol);
      if (t.write !== undefined) r.write = stName(t.write);
      if (t.pop !== undefined) r.pop = stName(t.pop);
      if (t.pop2 !== undefined) r.pop2 = stName(t.pop2);
      if (t.push !== undefined) r.push = stWord(t.push);
      if (t.push2 !== undefined) r.push2 = stWord(t.push2);
      if (t.below !== undefined) r.below = t.below === SYM.eps ? t.below : t.below.split('|').map(stWord).join('|');
      if (t.above !== undefined) r.above = t.above === SYM.eps ? t.above : t.above.split('|').map(stWord).join('|');
      if (t.output !== undefined) r.output = outWord(t.output);
      if (Array.isArray(t.tapeSyms)) r.tapeSyms = t.tapeSyms.map(stName);
      if (Array.isArray(t.tapeWrites)) r.tapeWrites = t.tapeWrites.map(stName);
      return r;
    })
  };
  return out;
}

export { Refusal };
