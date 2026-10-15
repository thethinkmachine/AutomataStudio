// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY OF BABEL — WINGS
// ══════════════════════════════════════════════════════════════════
// One wing per machine type, and every wing says the same four things:
//
//   params    what sizes a room has (states, letters, stack symbols, …)
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
//   • a store machine's bottom marker is Z, its other symbols A, B, C, ….
//   • what changes a machine's meaning is part of it, never a reader's
//     setting: a TM's tape is one-way (a two-way one is shelved in ITM), and
//     an NDTM's or MTM's tape is the first choice of its number;
//   • a PFA's row δ(q, a) is a probability distribution, or absent.
//
// Anything a wing cannot hold — a weight no fraction reads back as, two moves
// a deterministic type forbids — is refused with a reason, never approximated.
//
// The family modules in js/machines/ stay untouched: this file is the one
// place a wing is declared, and tests/babel.test.js walks MachineTypes and
// fails for a type without one. A type added later gets its wing here.
//
// DOM-free and App-free, so the worker and the website read it as it is.

import { bits, distribution, distributionOf, fin, fraction, fractionOf, nat, oneOf, option, seq, subset, table, tuple } from './shape.js';

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

function gcdOf(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}
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

function detFaWing(type, { priority = false, omega = null } = {}) {
  return {
    type,
    params: [{ id: 'states', min: 1 }, { id: 'letters', min: 1 }],
    kind: omega ? 'omega' : 'fa',
    omega,
    shape: ([n, k]) => tuple(priority ? table(n, nat()) : bits(n), table(n * k, fin(n))),
    toDoc([acc, delta], [n, k]) {
      const doc = newDoc(type, n);
      doc.sigma = Array.from({ length: k }, (_, a) => letterName(a));
      if (priority) doc.states.forEach((s, q) => { s.priority = acc[q]; });
      else doc.accepts = acc.map((b, q) => (b ? sid(q) : null)).filter(Boolean);
      for (let q = 0; q < n; q++) for (let a = 0; a < k; a++) addT(doc, { from: sid(q), to: sid(delta[q * k + a]), symbol: letterName(a) });
      return layoutDoc(doc);
    },
    fromDoc(doc) {
      const S = readStates(doc);
      const { sigma, moves, notes } = faMoves(doc, S, { allowEps: false });
      const acc = priority ? S.order.map(s => (Number.isInteger(s.priority) && s.priority >= 0 ? s.priority : 0)) : [...S.accepting];
      const t = completeTable(S, sigma, moves, { what: type, sink: () => acc.push(priority ? 1 : 0) });
      return { params: [t.n, sigma.length], body: [acc, t.delta], notes: [...notes, ...t.notes], names: namesOf({ sigma }) };
    },
    tile: tileFa(priority)
  };
}

function tileFa(priority) {
  return (path, value, [n, k]) => {
    if (path[0] === 0) {
      if (priority) return { key: `Ω(${stateName(path[1])})`, value: String(value) };
      return { key: 'F', value: value === null ? '' : `{${value.map((b, q) => (b ? stateName(q) : null)).filter(Boolean).join(', ')}}` };
    }
    const i = path[1], q = Math.floor(i / k), a = i % k;
    return { key: `${stateName(q)} · ${letterName(a)}`, value: stateName(value), edge: [q, value] };
  };
}

function nondetFaWing(type, { eps = false, priority = false, omega = null } = {}) {
  return {
    type,
    params: [{ id: 'states', min: 1 }, { id: 'letters', min: 1 }],
    kind: omega ? 'omega' : 'fa',
    omega,
    shape: ([n, k]) => tuple(priority ? table(n, nat()) : bits(n), subset(tuple(fin(n), fin(eps ? k + 1 : k), fin(n)))),
    toDoc([acc, moves], [n, k]) {
      const doc = newDoc(type, n);
      doc.sigma = Array.from({ length: k }, (_, a) => letterName(a));
      if (priority) doc.states.forEach((s, q) => { s.priority = acc[q]; });
      else doc.accepts = acc.map((b, q) => (b ? sid(q) : null)).filter(Boolean);
      for (const [from, a, to] of moves) addT(doc, { from: sid(from), to: sid(to), symbol: a === k ? SYM.eps : letterName(a) });
      return layoutDoc(doc);
    },
    fromDoc(doc) {
      const S = readStates(doc);
      const { sigma, moves, notes } = faMoves(doc, S, { allowEps: eps });
      const k = sigma.length;
      const seen = new Set(), body = [];
      for (const m of moves) {
        const a = m.a < 0 ? k : m.a;
        const key = `${m.from}|${a}|${m.to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        body.push([m.from, a, m.to]);
      }
      const acc = priority ? S.order.map(s => (Number.isInteger(s.priority) && s.priority >= 0 ? s.priority : 0)) : [...S.accepting];
      return { params: [S.n, k], body: [acc, body], notes, names: namesOf({ sigma }) };
    },
    move: ([from, a, to], [n, k]) => `${stateName(from)} —${a === k ? SYM.eps : letterName(a)}→ ${stateName(to)}`
  };
}

// ── Two-way heads ─────────────────────────────────────────────────

function twoWayRead(doc, S) {
  const sym = symOf(doc);
  const ts = transitionsOf(doc);
  const skip = new Set([sym.eps, sym.any, sym.leftMarker, sym.rightMarker]);
  const sigma = alphabetOf(doc.sigma, ts.map(t => t.symbol), skip);
  if (!sigma.length) refuse('It has no letters.');
  const k = sigma.length;
  const readOf = s => (s === sym.leftMarker ? k : s === sym.rightMarker ? k + 1 : indexIn(sigma, String(s), 'the letter'));
  return { sym, ts, sigma, k, readOf };
}

function dirOf(d) {
  const i = DIRS.indexOf(d || 'R');
  if (i < 0) refuse(`It moves “${d}”, which is not L, R or S.`);
  return i;
}

const readName = (a, k) => (a === k ? SYM.leftMarker : a === k + 1 ? SYM.rightMarker : letterName(a));

function twoWayWing(type, { det, output = false }) {
  const params = [{ id: 'states', min: 1 }, { id: 'letters', min: 1 }];
  if (output) params.push({ id: 'output letters', min: 1 });
  const moveShape = (n, l) => (output ? tuple(fin(3), fin(n), seq(fin(l))) : tuple(fin(3), fin(n)));
  return {
    type, params, kind: 'words',
    shape: ([n, k, l]) => tuple(bits(n), det
      ? table(n * (k + 2), option(moveShape(n, l)))
      : subset(tuple(fin(n), fin(k + 2), fin(3), fin(n)))),
    toDoc([acc, delta], [n, k, l]) {
      const doc = newDoc(type, n);
      doc.sigma = Array.from({ length: k }, (_, a) => letterName(a));
      if (output) doc.outputAlpha = Array.from({ length: l }, (_, a) => letterName(a));
      doc.accepts = acc.map((b, q) => (b ? sid(q) : null)).filter(Boolean);
      if (det) {
        delta.forEach((m, i) => {
          if (!m) return;
          const q = Math.floor(i / (k + 2)), a = i % (k + 2);
          const t = { from: sid(q), to: sid(m[1]), symbol: readName(a, k), dir: DIRS[m[0]] };
          if (output) t.output = m[2].map(letterName).join('');
          addT(doc, t);
        });
      } else {
        for (const [from, a, d, to] of delta) addT(doc, { from: sid(from), to: sid(to), symbol: readName(a, k), dir: DIRS[d] });
      }
      return layoutDoc(doc);
    },
    fromDoc(doc) {
      const S = readStates(doc);
      const { sym, ts, sigma, k, readOf } = twoWayRead(doc, S);
      const outAlpha = output ? alphabetOf(doc.outputAlpha, ts.flatMap(t => charsOf(t.output, sym)), new Set([sym.eps])) : [];
      if (output && !outAlpha.length) outAlpha.push('a');
      const n = S.n;
      if (ts.some(t => t.symbol === sym.any)) refuse('It has a wildcard edge; two-way machines are held without them.');
      if (det) {
        const delta = new Array(n * (k + 2)).fill(null);
        for (const t of ts) {
          const q = stateIndex(S, t.from), a = readOf(t.symbol), i = q * (k + 2) + a;
          if (delta[i]) refuse(`It has two moves from one state on “${t.symbol}”; a ${type} has one.`);
          const m = [dirOf(t.dir), stateIndex(S, t.to)];
          if (output) m.push(charsOf(t.output, sym).map(c => indexIn(outAlpha, c, 'the output letter')));
          delta[i] = m;
        }
        const params = output ? [n, k, outAlpha.length] : [n, k];
        return { params, body: [[...S.accepting], delta], notes: [], names: namesOf({ sigma, outputAlpha: outAlpha }) };
      }
      const seen = new Set(), body = [];
      for (const t of ts) {
        const m = [stateIndex(S, t.from), readOf(t.symbol), dirOf(t.dir), stateIndex(S, t.to)];
        const key = m.join('|');
        if (!seen.has(key)) { seen.add(key); body.push(m); }
      }
      return { params: [n, k], body: [[...S.accepting], body], notes: [], names: namesOf({ sigma }) };
    },
    tile: det ? (path, value, [n, k]) => {
      if (path[0] === 0) return tileFa(false)(path, value, [n, k]);
      const i = path[1], q = Math.floor(i / (k + 2)), a = i % (k + 2);
      return { key: `${stateName(q)} · ${readName(a, k)}`, value: value ? `${DIRS[value[0]]} ${stateName(value[1])}` : '—', edge: value ? [q, value[1]] : null };
    } : undefined,
    move: det ? undefined : ([from, a, d, to], [n, k]) => `${stateName(from)} —${readName(a, k)}, ${DIRS[d]}→ ${stateName(to)}`
  };
}

// ── Probabilistic ─────────────────────────────────────────────────

const PFA = {
  type: 'PFA',
  params: [{ id: 'states', min: 1 }, { id: 'letters', min: 1 }],
  kind: 'words',
  // A row δ(q, a) is a probability distribution over the targets, or absent
  // (reading a there loses the run's mass, which the app allows). Weights are
  // never free-standing: a row whose weights do not sum to 1 is not a PFA.
  shape: ([n, k]) => tuple(bits(n), fraction({ zero: true }), table(n * k, option(distribution(n)))),
  toDoc([acc, cut, rows], [n, k]) {
    const doc = newDoc('PFA', n);
    doc.sigma = Array.from({ length: k }, (_, a) => letterName(a));
    doc.accepts = acc.map((b, q) => (b ? sid(q) : null)).filter(Boolean);
    doc.config.pfaCutPoint = cut.p / cut.q;
    rows.forEach((row, i) => {
      if (!row) return;
      const q = Math.floor(i / k), a = i % k;
      row.parts.forEach((x, r) => { if (x) addT(doc, { from: sid(q), to: sid(r), symbol: letterName(a), weight: x / row.d }); });
    });
    return layoutDoc(doc);
  },
  fromDoc(doc) {
    const S = readStates(doc);
    const sym = symOf(doc);
    const ts = transitionsOf(doc);
    if (ts.some(t => t.symbol === sym.any)) refuse('It has a wildcard edge; PFAs are held without them.');
    const sigma = alphabetOf(doc.sigma, ts.map(t => t.symbol), new Set([sym.eps, sym.any]));
    if (!sigma.length) refuse('It has no letters.');
    const n = S.n, k = sigma.length;
    const weights = new Map();
    const nameOf = new Map((doc.states || []).map(st => [st.id, st.name || st.id]));
    for (const t of ts) {
      const q = stateIndex(S, t.from), r = stateIndex(S, t.to), a = indexIn(sigma, String(t.symbol), 'the letter');
      const x = Number(t.weight);
      if (!(x > 0 && x <= 1)) continue; // a weight of 0 is no edge
      const i = q * k + a;
      const row = weights.get(i) || { from: t.from, symbol: t.symbol, w: new Array(n).fill(0) };
      if (row.w[r]) refuse('It has two weighted edges between the same states on one letter.');
      row.w[r] = x;
      weights.set(i, row);
    }
    const rows = new Array(n * k).fill(null);
    for (const [i, row] of weights) {
      const total = row.w.reduce((a, x) => a + x, 0);
      if (Math.abs(total - 1) > 1e-9) refuse(`Its weights from ${nameOf.get(row.from)} on “${row.symbol}” add to ${+total.toFixed(6)}, not 1: a PFA's row is a probability distribution.`);
      rows[i] = distributionOf(row.w) || refuse(`A weight from ${nameOf.get(row.from)} on “${row.symbol}” is not a fraction this wing can hold.`);
    }
    const cutRaw = Number(doc.config?.pfaCutPoint ?? 0.5);
    const cut = fractionOf(Math.min(1, Math.max(0, cutRaw))) || refuse('Its cut point is not a fraction this wing can hold.');
    return { params: [n, k], body: [[...S.accepting], cut, rows], notes: [], names: namesOf({ sigma }) };
  },
  tile: (path, value, [n, k]) => {
    if (path[0] === 0) return tileFa(false)(path, value, [n, k]);
    if (path[0] === 1) return { key: 'cut point', value: `${value.p}/${value.q}` };
    const i = path[1], q = Math.floor(i / k), a = i % k;
    const share = x => { const g = gcdOf(x, value.d); return x === value.d ? '1' : `${x / g}/${value.d / g}`; };
    return { key: `${stateName(q)} · ${letterName(a)}`, value: value ? value.parts.map((x, r) => (x ? `${stateName(r)} ${share(x)}` : null)).filter(Boolean).join(', ') : '—' };
  }
};

// ── Pushdown machines ─────────────────────────────────────────────

/**
 * A store machine's symbols: under the explicit convention (a bottom marker Z
 * under everything, acceptance by final state) Z is symbol 0 and the room's m
 * others follow; under the empty-stack convention there is no Z.
 */
function storeAlphabet(explicit, m) {
  const out = [];
  if (explicit) out.push(SYM.stackBottom);
  for (let i = 0; i < m; i++) out.push(stackName(i));
  return out;
}

function readStore(doc, S, { explicitOnly = false, fixed = null } = {}) {
  const sym = symOf(doc);
  const ts = transitionsOf(doc);
  const explicit = (doc.config?.pdaParadigm ?? 'explicit') !== 'empty';
  if (explicitOnly && !explicit) refuse('It accepts by empty stack; this wing holds the bottom-marker, final-state convention its definition uses.');
  const skip = new Set([sym.eps, sym.any, sym.leftMarker, sym.rightMarker]);
  const sigma = alphabetOf(doc.sigma, ts.map(t => t.symbol), skip);
  if (!sigma.length) refuse('It has no letters.');
  const storeFields = ['pop', 'push', 'pop2', 'push2', 'below', 'above'];
  for (const t of ts) for (const f of [...storeFields, 'symbol']) if (t[f] === sym.any) refuse('It has a wildcard in a move; this wing holds machines without them.');
  const used = [];
  for (const t of ts) {
    for (const f of ['pop', 'pop2']) if (t[f] && t[f] !== sym.eps) used.push(t[f]);
    for (const f of ['push', 'push2']) used.push(...charsOf(t[f], sym));
    for (const f of ['below', 'above']) used.push(...String(t[f] || '').split('|').flatMap(x => charsOf(x, sym)));
  }
  let gamma;
  if (fixed) gamma = fixed;
  else {
    const others = alphabetOf(doc.stackAlpha, used, new Set([sym.eps, sym.stackBottom, sym.any]));
    gamma = explicit ? [sym.stackBottom, ...others] : others;
  }
  const g = s => indexIn(gamma, s, 'the stack symbol');
  return { sym, ts, sigma, k: sigma.length, explicit, gamma, m: explicit ? gamma.length - 1 : gamma.length, g };
}

const pushOf = (str, R) => charsOf(str, R.sym).map(R.g);
const popOf = (s, R) => (s === undefined || s === null || s === '' || s === R.sym.eps ? R.gamma.length : R.g(s));

/** A family of nondeterministic store machines: δ is a set of moves, under either convention. */
function storeWing(type, { fields, twoStacks = false, output = false, embedded = false, counter = false, explicitOnly = false }) {
  const params = [{ id: 'states', min: 1 }, { id: 'letters', min: 1 }];
  if (!counter) params.push({ id: 'stack symbols', min: explicitOnly || counter ? 0 : 0 });
  if (output) params.push({ id: 'output letters', min: 1 });
  const G = (explicit, m) => (counter ? 2 : (explicit ? m + 1 : m));
  // A move: from, read (letters, then ε), pop (Γ, then nothing), [pop2], to, push, [push2], [below, above], [out].
  const moveShape = (n, k, g, l) => tuple([
    fin(n), fin(k + 1), fin(g + 1),
    ...(twoStacks ? [fin(g + 1)] : []),
    fin(n), strings(g),
    ...(twoStacks ? [strings(g)] : []),
    ...(embedded ? [seq(strings(g, { min: 1 })), seq(strings(g, { min: 1 }))] : []),
    ...(output ? [strings(l)] : [])
  ]);
  const explicitShape = (n, k, m, l) => tuple(bits(n), subset(moveShape(n, k, G(true, m), l)));
  const emptyShape = (n, k, m, l) => subset(moveShape(n, k, G(false, m), l));
  const split = p => (counter ? [p[0], p[1], 1, null] : output ? [p[0], p[1], p[2], p[3]] : [p[0], p[1], p[2], null]);
  return {
    type, params, kind: 'words', store: true, explicitOnly: explicitOnly || counter,
    shape: p => {
      const [n, k, m, l] = split(p);
      return explicitOnly || counter ? explicitShape(n, k, m, l) : oneOf(explicitShape(n, k, m, l), emptyShape(n, k, m, l));
    },
    toDoc(body, p) {
      const [n, k, m, l] = split(p);
      const explicit = explicitOnly || counter || body.tag === 0;
      const inner = explicitOnly || counter ? body : body.value;
      const [acc, moves] = explicit ? inner : [new Array(n).fill(0), inner];
      const gamma = counter ? [SYM.stackBottom, '1'] : storeAlphabet(explicit, m);
      const doc = newDoc(type, n);
      doc.sigma = Array.from({ length: k }, (_, a) => letterName(a));
      doc.stackAlpha = [...gamma];
      if (output) doc.outputAlpha = Array.from({ length: l }, (_, a) => letterName(a));
      doc.config.pdaParadigm = explicit ? 'explicit' : 'empty';
      doc.accepts = acc.map((b, q) => (b ? sid(q) : null)).filter(Boolean);
      const gName = i => gamma[i];
      const popName = i => (i === gamma.length ? SYM.eps : gamma[i]);
      for (const mv of moves) {
        let j = 0;
        const from = mv[j++], a = mv[j++], pop = mv[j++];
        const pop2 = twoStacks ? mv[j++] : null;
        const to = mv[j++], push = mv[j++];
        const push2 = twoStacks ? mv[j++] : null;
        const below = embedded ? mv[j++] : null, above = embedded ? mv[j++] : null;
        const out = output ? mv[j++] : null;
        const t = { from: sid(from), to: sid(to), symbol: a === k ? SYM.eps : letterName(a), pop: popName(pop), push: word(push, gName) };
        if (twoStacks) { t.pop2 = popName(pop2); t.push2 = word(push2, gName); }
        if (embedded) {
          t.below = below.length ? below.map(s => s.map(gName).join('')).join('|') : SYM.eps;
          t.above = above.length ? above.map(s => s.map(gName).join('')).join('|') : SYM.eps;
        }
        if (output) t.output = out.map(letterName).join('');
        addT(doc, t);
      }
      return layoutDoc(doc);
    },
    fromDoc(doc) {
      const S = readStates(doc);
      const R = readStore(doc, S, { explicitOnly: explicitOnly || counter, fixed: counter ? [SYM.stackBottom, '1'] : null });
      const outAlpha = output ? alphabetOf(doc.outputAlpha, R.ts.flatMap(t => charsOf(t.output, R.sym)), new Set([R.sym.eps])) : [];
      if (output && !outAlpha.length) outAlpha.push('a');
      const seen = new Set(), moves = [];
      for (const t of R.ts) {
        const a = t.symbol === R.sym.eps || t.symbol === '' || t.symbol === undefined ? R.k : indexIn(R.sigma, String(t.symbol), 'the letter');
        const mv = [stateIndex(S, t.from), a, popOf(t.pop, R)];
        if (twoStacks) mv.push(popOf(t.pop2, R));
        mv.push(stateIndex(S, t.to), pushOf(t.push, R));
        if (twoStacks) mv.push(pushOf(t.push2, R));
        if (embedded) {
          for (const f of ['below', 'above']) {
            const raw = String(t[f] ?? '');
            mv.push(raw === '' || raw === R.sym.eps ? [] : raw.split('|').map(x => pushOf(x, R)).filter(x => x.length));
          }
        }
        if (output) mv.push(charsOf(t.output, R.sym).map(c => indexIn(outAlpha, c, 'the output letter')));
        const key = JSON.stringify(mv);
        if (!seen.has(key)) { seen.add(key); moves.push(mv); }
      }
      const acc = R.explicit ? [...S.accepting] : null;
      const inner = R.explicit ? [acc, moves] : moves;
      const body = explicitOnly || counter ? inner : { tag: R.explicit ? 0 : 1, value: inner };
      const params = counter ? [S.n, R.k] : output ? [S.n, R.k, R.m, outAlpha.length] : [S.n, R.k, R.m];
      const notes = !R.explicit && S.accepting.some(Boolean) ? ['It accepts by empty stack, so its accepting states are not part of it.'] : [];
      return { params, body, notes, names: namesOf({ sigma: R.sigma, stackAlpha: R.gamma, outputAlpha: outAlpha }) };
    },
    move(mv, p) {
      const [n, k, m, l] = split(p);
      return `${stateName(mv[0])} —${mv[1] === k ? SYM.eps : letterName(mv[1])}→ ${stateName(mv[twoStacks ? 4 : 3])}`;
    },
    fields
  };
}

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

/** A state's body → its moves as { a (letter, or -1 for ε), X (symbol, or G for nothing), mv }. */
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

/** The DPDA wing: per state, the moves its determinism rule allows, under either stack convention. */
const DPDA = {
  type: 'DPDA',
  params: [{ id: 'states', min: 1 }, { id: 'letters', min: 1 }, { id: 'stack symbols', min: 0 }],
  kind: 'words', store: true,
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
    const R = readStore(doc, S);
    const n = S.n, k = R.k, G = R.gamma.length;
    const per = Array.from({ length: n }, () => []);
    for (const t of R.ts) {
      const a = t.symbol === R.sym.eps || t.symbol === '' || t.symbol === undefined ? -1 : indexIn(R.sigma, String(t.symbol), 'the letter');
      per[stateIndex(S, t.from)].push({ a, X: popOf(t.pop, R), mv: [stateIndex(S, t.to), pushOf(t.push, R)] });
    }
    const states = per.map(moves => dpdaStateBody(moves, k, G));
    const body = R.explicit ? { tag: 0, value: [[...S.accepting], states] } : { tag: 1, value: states };
    const notes = !R.explicit && S.accepting.some(Boolean) ? ['It accepts by empty stack, so its accepting states are not part of it.'] : [];
    return { params: [n, k, R.m], body, notes, names: namesOf({ sigma: R.sigma, stackAlpha: R.gamma }) };
  },
  tile: (path, value, [n, k, m]) => {
    if (path[0] === 0 && Array.isArray(value)) return tileFa(false)(path, value, [n, k]);
    return null;
  },
  move: (mv, [n, k, m]) => `to ${stateName(mv[0])}`
};

// ── Turing machines ───────────────────────────────────────────────

function readTape(doc, S, { markers = false } = {}) {
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
  const readIdx = s => {
    if (markers && s === sym.leftMarker) return K;
    if (markers && s === sym.rightMarker) return K + 1;
    return indexIn(gamma, String(s), 'the tape symbol');
  };
  const notes = [];
  const declared = new Set(doc.sigma || []);
  if (others.some(s => !declared.has(s))) notes.push('Every non-blank tape symbol is read as an input letter here.');
  return { sym, ts, gamma, K, readIdx, notes };
}

function tmWing(type, { markers = false, kind = 'tm', twoWay = null } = {}) {
  return {
    type,
    params: [{ id: 'states', min: 1 }, { id: 'tape symbols', min: 2 }],
    kind,
    shape: ([n, K]) => {
      const R = markers ? K + 2 : K;
      return tuple(bits(n), table(n * R, option(tuple(fin(R), fin(3), fin(n)))));
    },
    toDoc([acc, delta], [n, K]) {
      const R = markers ? K + 2 : K;
      const doc = newDoc(type, n, { letters: true });
      const gamma = Array.from({ length: K }, (_, i) => tapeName(i));
      const nameOf = i => (i < K ? gamma[i] : i === K ? SYM.leftMarker : SYM.rightMarker);
      doc.sigma = gamma.slice(1);
      doc.stackAlpha = markers ? [SYM.leftMarker, ...gamma, SYM.rightMarker] : [...gamma];
      doc.tapeCount = 1;
      if (twoWay !== null) doc.config.twoWayTape = twoWay;
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
      const T = readTape(doc, S, { markers });
      const n = S.n, K = T.K, R = markers ? K + 2 : K;
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
      const R = markers ? K + 2 : K, i = path[1], q = Math.floor(i / R), c = i % R;
      const nm = x => (x < K ? tapeName(x) : x === K ? SYM.leftMarker : SYM.rightMarker);
      return { key: `${stateName(q, true)}${nm(c)}`, value: value ? `${nm(value[0])}${DIRS[value[1]]}${stateName(value[2], true)}` : '—', edge: value ? [q, value[2]] : null };
    }
  };
}

const NDTM = {
  type: 'NDTM',
  params: [{ id: 'states', min: 1 }, { id: 'tape symbols', min: 2 }],
  kind: 'words',
  shape: ([n, K]) => tuple(bits(n), subset(tuple(fin(n), fin(K), fin(K), fin(3), fin(n)))),
  toDoc([acc, moves], [n, K]) {
    const doc = newDoc('NDTM', n, { letters: true });
    const gamma = Array.from({ length: K }, (_, i) => tapeName(i));
    doc.sigma = gamma.slice(1);
    doc.stackAlpha = [...gamma];
    doc.tapeCount = 1;
    doc.accepts = acc.map((b, q) => (b ? sid(q) : null)).filter(Boolean);
    for (const [from, c, w, d, to] of moves) addT(doc, { from: sid(from), to: sid(to), symbol: gamma[c], write: gamma[w], dir: DIRS[d] });
    return layoutDoc(doc);
  },
  fromDoc(doc) {
    const S = readStates(doc);
    const T = readTape(doc, S);
    if (T.ts.some(t => t.symbol === T.sym.any || t.write === T.sym.any)) refuse('It has a wildcard edge; this wing holds machines without them.');
    const seen = new Set(), moves = [];
    for (const t of T.ts) {
      const c = T.readIdx(t.symbol);
      const mv = [stateIndex(S, t.from), c, t.write === undefined ? c : T.readIdx(t.write), dirOf(t.dir), stateIndex(S, t.to)];
      const key = mv.join('|');
      if (!seen.has(key)) { seen.add(key); moves.push(mv); }
    }
    return { params: [S.n, T.K], body: [[...S.accepting], moves], notes: T.notes, names: namesOf({ stackAlpha: T.gamma }) };
  },
  move: ([from, c, w, d, to]) => `${stateName(from, true)} —${tapeName(c)}/${tapeName(w)},${DIRS[d]}→ ${stateName(to, true)}`
};

const MTM = {
  type: 'MTM',
  params: [{ id: 'states', min: 1 }, { id: 'tape symbols', min: 2 }, { id: 'tapes', min: 1 }],
  kind: 'words',
  shape: ([n, K, t]) => tuple(bits(n), table(n * K ** t, option(tuple(table(t, fin(K)), table(t, fin(3)), fin(n))))),
  toDoc([acc, delta], [n, K, tapes]) {
    const doc = newDoc('MTM', n, { letters: true });
    const gamma = Array.from({ length: K }, (_, i) => tapeName(i));
    doc.sigma = gamma.slice(1);
    doc.stackAlpha = [...gamma];
    doc.tapeCount = tapes;
    doc.accepts = acc.map((b, q) => (b ? sid(q) : null)).filter(Boolean);
    const per = K ** tapes;
    delta.forEach((m, i) => {
      if (!m) return;
      const q = Math.floor(i / per);
      let x = i % per;
      const reads = [];
      for (let j = 0; j < tapes; j++) { reads.push(gamma[x % K]); x = Math.floor(x / K); }
      addT(doc, {
        from: sid(q), to: sid(m[2]), symbol: reads[0],
        tapeSyms: reads, tapeWrites: m[0].map(w => gamma[w]), tapeDirs: m[1].map(d => DIRS[d])
      });
    });
    return layoutDoc(doc);
  },
  fromDoc(doc) {
    const S = readStates(doc);
    const T = readTape(doc, S);
    const tapes = Math.max(1, Number(doc.tapeCount) || 1);
    const n = S.n, K = T.K, per = K ** tapes;
    if (n * per > 1 << 20) refuse('Its table is too large to number on this device.');
    const delta = new Array(n * per).fill(null);
    const notes = [...T.notes];
    // The most specific move wins, as the simulator has it: moves with fewer
    // wildcards are placed first, and a wildcard move fills only the reads no
    // more specific move has claimed.
    const moves = T.ts.map(t => {
      const reads = Array.isArray(t.tapeSyms) ? t.tapeSyms : [t.symbol];
      if (reads.length !== tapes) refuse('A move reads a different number of tapes than the machine has.');
      return { t, reads, wild: reads.filter(r => r === T.sym.any).length };
    }).sort((x, y) => x.wild - y.wild);
    let expanded = false;
    for (const { t, reads, wild } of moves) {
      const options = reads.map(r => (r === T.sym.any ? Array.from({ length: K }, (_, c) => c) : [T.readIdx(r)]));
      const combos = options.reduce((acc, opts) => acc.flatMap(c => opts.map(o => [...c, o])), [[]]);
      for (const combo of combos) {
        const idx = combo.reduce((acc, c, j) => acc + c * K ** j, 0);
        const i = stateIndex(S, t.from) * per + idx;
        if (delta[i]) {
          if (wild) continue;
          refuse('It has two moves from one configuration; an MTM has one.');
        }
        const writes = (t.tapeWrites || reads).map((w, j) => (w === T.sym.any || w === undefined ? combo[j] : T.readIdx(w)));
        const dirs = (t.tapeDirs || reads.map(() => 'S')).map(dirOf);
        delta[i] = [writes, dirs, stateIndex(S, t.to)];
      }
      if (wild) expanded = true;
    }
    if (expanded) notes.push('Wildcard reads were expanded into the symbols they stand for.');
    return { params: [n, K, tapes], body: [[...S.accepting], delta], notes, names: namesOf({ stackAlpha: T.gamma }) };
  }
};

// ── Transducers ───────────────────────────────────────────────────

function readOutput(doc, values) {
  const sym = symOf(doc);
  const out = alphabetOf(doc.outputAlpha, values, new Set([sym.eps, '', undefined]));
  return out.length ? out : ['a'];
}

const MOORE = {
  type: 'Moore',
  params: [{ id: 'states', min: 1 }, { id: 'letters', min: 1 }, { id: 'output letters', min: 1 }],
  kind: 'words',
  shape: ([n, k, l]) => tuple(bits(n), table(n, fin(l)), table(n * k, fin(n))),
  toDoc([acc, outs, delta], [n, k, l]) {
    const doc = newDoc('Moore', n);
    doc.sigma = Array.from({ length: k }, (_, a) => letterName(a));
    doc.outputAlpha = Array.from({ length: l }, (_, a) => letterName(a));
    doc.accepts = acc.map((b, q) => (b ? sid(q) : null)).filter(Boolean);
    doc.states.forEach((s, q) => { s.output = letterName(outs[q]); });
    for (let q = 0; q < n; q++) for (let a = 0; a < k; a++) addT(doc, { from: sid(q), to: sid(delta[q * k + a]), symbol: letterName(a) });
    return layoutDoc(doc);
  },
  fromDoc(doc) {
    const S = readStates(doc);
    const { sigma, moves, notes } = faMoves(doc, S, { allowEps: false });
    const outAlpha = readOutput(doc, S.order.map(s => s.output));
    const outs = S.order.map(s => (s.output ? indexIn(outAlpha, String(s.output), 'the output letter') : 0));
    const acc = [...S.accepting];
    const t = completeTable(S, sigma, moves, { what: 'Moore machine', sink: () => { acc.push(0); outs.push(0); } });
    return { params: [t.n, sigma.length, outAlpha.length], body: [acc, outs, t.delta], notes: [...notes, ...t.notes], names: namesOf({ sigma, outputAlpha: outAlpha }) };
  },
  tile: (path, value, [n, k, l]) => {
    if (path[0] === 0) return tileFa(false)(path, value, [n, k]);
    if (path[0] === 1) return { key: `λ(${stateName(path[1])})`, value: letterName(value) };
    const i = path[1];
    return { key: `${stateName(Math.floor(i / k))} · ${letterName(i % k)}`, value: stateName(value), edge: [Math.floor(i / k), value] };
  }
};

const MEALY = {
  type: 'Mealy',
  params: [{ id: 'states', min: 1 }, { id: 'letters', min: 1 }, { id: 'output letters', min: 1 }],
  kind: 'words',
  shape: ([n, k, l]) => tuple(bits(n), table(n * k, tuple(fin(n), fin(l)))),
  toDoc([acc, delta], [n, k, l]) {
    const doc = newDoc('Mealy', n);
    doc.sigma = Array.from({ length: k }, (_, a) => letterName(a));
    doc.outputAlpha = Array.from({ length: l }, (_, a) => letterName(a));
    doc.accepts = acc.map((b, q) => (b ? sid(q) : null)).filter(Boolean);
    for (let q = 0; q < n; q++) for (let a = 0; a < k; a++) {
      const [to, o] = delta[q * k + a];
      addT(doc, { from: sid(q), to: sid(to), symbol: letterName(a), output: letterName(o) });
    }
    return layoutDoc(doc);
  },
  fromDoc(doc) {
    const S = readStates(doc);
    const ts = transitionsOf(doc);
    const outAlpha = readOutput(doc, ts.map(t => t.output));
    const { sigma, moves, notes } = faMoves(doc, S, { allowEps: false });
    const outOf = new Map();
    for (const t of ts) if (t.symbol !== symOf(doc).any) outOf.set(`${t.from}|${t.symbol}`, t.output);
    const k = sigma.length;
    const t = completeTable(S, sigma, moves, { what: 'Mealy machine' });
    const delta = t.delta.map((to, i) => {
      const q = Math.floor(i / k), a = i % k;
      const st = S.order[q];
      const raw = st ? outOf.get(`${st.id}|${sigma[a]}`) : undefined;
      return [to, raw ? indexIn(outAlpha, String(raw), 'the output letter') : 0];
    });
    return { params: [t.n, k, outAlpha.length], body: [[...S.accepting, ...new Array(t.n - S.n).fill(0)], delta], notes: [...notes, ...t.notes], names: namesOf({ sigma, outputAlpha: outAlpha }) };
  },
  tile: (path, value, [n, k, l]) => {
    if (path[0] === 0) return tileFa(false)(path, value, [n, k]);
    const i = path[1];
    return { key: `${stateName(Math.floor(i / k))} · ${letterName(i % k)}`, value: `${stateName(value[0])} / ${letterName(value[1])}`, edge: [Math.floor(i / k), value[0]] };
  }
};

const FST = {
  type: 'FST',
  params: [{ id: 'states', min: 1 }, { id: 'letters', min: 1 }, { id: 'output letters', min: 1 }],
  kind: 'words',
  shape: ([n, k, l]) => tuple(bits(n), subset(tuple(fin(n), fin(k + 1), fin(n), strings(l)))),
  toDoc([acc, moves], [n, k, l]) {
    const doc = newDoc('FST', n);
    doc.sigma = Array.from({ length: k }, (_, a) => letterName(a));
    doc.outputAlpha = Array.from({ length: l }, (_, a) => letterName(a));
    doc.accepts = acc.map((b, q) => (b ? sid(q) : null)).filter(Boolean);
    for (const [from, a, to, out] of moves) addT(doc, { from: sid(from), to: sid(to), symbol: a === k ? SYM.eps : letterName(a), output: out.map(letterName).join('') });
    return layoutDoc(doc);
  },
  fromDoc(doc) {
    const S = readStates(doc);
    const sym = symOf(doc);
    const ts = transitionsOf(doc);
    if (ts.some(t => t.symbol === sym.any)) refuse('It has a wildcard edge; this wing holds machines without them.');
    const sigma = alphabetOf(doc.sigma, ts.map(t => t.symbol), new Set([sym.eps, sym.any]));
    if (!sigma.length) refuse('It has no letters.');
    const outAlpha = readOutput(doc, ts.flatMap(t => charsOf(t.output, sym)));
    const k = sigma.length;
    const seen = new Set(), moves = [];
    for (const t of ts) {
      const a = t.symbol === sym.eps || t.symbol === '' || t.symbol === undefined ? k : indexIn(sigma, String(t.symbol), 'the letter');
      const mv = [stateIndex(S, t.from), a, stateIndex(S, t.to), charsOf(t.output, sym).map(c => indexIn(outAlpha, c, 'the output letter'))];
      const key = JSON.stringify(mv);
      if (!seen.has(key)) { seen.add(key); moves.push(mv); }
    }
    return { params: [S.n, k, outAlpha.length], body: [[...S.accepting], moves], notes: [], names: namesOf({ sigma, outputAlpha: outAlpha }) };
  },
  move: ([from, a, to, out], [n, k]) => `${stateName(from)} —${a === k ? SYM.eps : letterName(a)} / ${word(out, letterName)}→ ${stateName(to)}`
};

/**
 * A transducer either has an acceptance condition (its accepting states decide
 * which runs count) or it does not (every run that consumes its input counts)
 * — the app's transducerAccepts. It changes what the machine does, so it is
 * part of the machine: the first choice of every transducer's number, with
 * acceptance on first.
 */
function withAcceptanceSwitch(def) {
  return {
    ...def,
    shape: p => { const s = def.shape(p); return oneOf(s, s); },
    toDoc(body, p) {
      const doc = def.toDoc(body.value, p);
      doc.config.transducerAccepts = body.tag === 0;
      return doc;
    },
    fromDoc(doc) {
      const r = def.fromDoc(doc);
      const on = doc.config?.transducerAccepts ?? false;
      return { ...r, body: { tag: on ? 0 : 1, value: r.body } };
    },
    conventions: ['an acceptance condition: its accepting states decide which runs count', 'no acceptance condition: every run that reads its input counts'],
    tile: def.tile,
    move: def.move
  };
}

/**
 * An NDTM's or MTM's tape is one-way or two-way — the app's twoWayTape — and
 * that changes what the machine does, so it is part of the machine: the first
 * choice of its number, one-way first. (A TM has a wing for each: TM and ITM.)
 */
function withTapeSwitch(def) {
  return {
    ...def,
    shape: p => { const s = def.shape(p); return oneOf(s, s); },
    toDoc(body, p) {
      const doc = def.toDoc(body.value, p);
      doc.config.twoWayTape = body.tag === 1;
      return doc;
    },
    fromDoc(doc) {
      const r = def.fromDoc(doc);
      return { ...r, body: { tag: doc.config?.twoWayTape ? 1 : 0, value: r.body } };
    },
    conventions: ['a one-way tape: it ends at the left of the input', 'a two-way tape: it runs on in both directions'],
    tile: def.tile,
    move: def.move
  };
}

// ── The table ─────────────────────────────────────────────────────

const OMEGA = {
  DBA: 'buchi', DcoBA: 'cobuchi', DPA: 'parity',
  NBA: 'buchi', NcoBA: 'cobuchi', NPA: 'parity'
};

const DEFS = [
  detFaWing('DFA'),
  nondetFaWing('NFA'),
  nondetFaWing('ε-NFA', { eps: true }),
  twoWayWing('2DFA', { det: true }),
  twoWayWing('2NFA', { det: false }),
  PFA,
  detFaWing('DBA', { omega: OMEGA.DBA }),
  detFaWing('DcoBA', { omega: OMEGA.DcoBA }),
  detFaWing('DPA', { priority: true, omega: OMEGA.DPA }),
  nondetFaWing('NBA', { omega: OMEGA.NBA }),
  nondetFaWing('NcoBA', { omega: OMEGA.NcoBA }),
  nondetFaWing('NPA', { priority: true, omega: OMEGA.NPA }),
  DPDA,
  storeWing('NPDA', {}),
  storeWing('QA', {}),
  storeWing('Counter', { counter: true }),
  storeWing('2PDA', { twoStacks: true }),
  storeWing('EPDA', { embedded: true, explicitOnly: true }),
  tmWing('TM', { twoWay: false }),
  withTapeSwitch(NDTM),
  withTapeSwitch(MTM),
  tmWing('LBA', { markers: true, kind: 'words' }),
  tmWing('ITM', { twoWay: true }),
  withAcceptanceSwitch(MOORE),
  withAcceptanceSwitch(MEALY),
  withAcceptanceSwitch(FST),
  withAcceptanceSwitch(storeWing('PDT', { output: true })),
  withAcceptanceSwitch(twoWayWing('2DFT', { det: true, output: true }))
];

/** The wing's key in an address: the type's name in lower case, ε as e. */
// A key is the first part of an address, where `-` separates the room's
// parameters, so a key has no hyphen: ε-NFA is `enfa`. It was `e-nfa`, which
// no address could parse, so every ε-NFA room and volume was unreachable.
export const wingKeyOf = type => type.toLowerCase().replace('ε', 'e').replace(/-/g, '');

export const WINGS = DEFS.map(d => Object.freeze({ ...d, key: wingKeyOf(d.type) }));
const BY_KEY = new Map(WINGS.map(w => [w.key, w]));
const BY_TYPE = new Map(WINGS.map(w => [w.type, w]));

/**
 * Machine types with no wing of their own, because another wing already holds
 * their machines. PDA is DPDA's alias in the app. A weak automaton is a Büchi
 * automaton whose every cycle sits wholly inside or outside F, and it decides
 * exactly as Büchi does — the app only warns when the structure is not weak —
 * so a weak wing would be the Büchi wing again under another name. The Büchi
 * volume's page says whether it is weak.
 */
export const WINGLESS_ALIASES = Object.freeze({ PDA: 'DPDA', DWA: 'DBA', NWA: 'NBA' });
const ALIAS_KEYS = new Map(Object.entries(WINGLESS_ALIASES).map(([a, t]) => [wingKeyOf(a), wingKeyOf(t)]));

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
  if (!wing) return { error: `AutomataStudio Babel has no wing for “${doc?.machine}”.` };
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
