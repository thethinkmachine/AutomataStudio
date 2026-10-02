// ══════════════════════════════════════════════════════════════════
//  HANOI OMEGA-AUTOMATA (HOA v1)
// ══════════════════════════════════════════════════════════════════
// The exchange format of the ω-automata tools — Spot, Owl, Rabinizer, ltl3ba,
// GOAL's newer releases. Reading and writing it is what lets a machine drawn
// here be checked with `autfilt`, and a machine an LTL translator produced be
// opened here. Spec: https://adl.github.io/hoaf/
//
// The one real translation is the alphabet. HOA's letters are *valuations* of
// atomic propositions, and edges are labelled with Boolean formulas over them;
// the app's letters are symbols. So:
//
//   writing   one proposition per symbol of Σ, and an edge on `a` is labelled
//             "a and no other". A valuation with two propositions true, or
//             none, has no edge — which is exactly "that is not a letter".
//   reading   the valuations an edge's label admits become symbols. When every
//             valuation any edge uses has exactly one proposition true (a file
//             this wrote, or anything shaped like it), the symbol is that
//             proposition's name; otherwise it is the set of true propositions
//             joined by '&', and '∅' for none.
//
// Acceptance: state-based Büchi, co-Büchi and min-even parity map to the app's
// types directly. Transition-based marks — what Spot writes by default — are
// moved onto states by splitting each state by the marks of the edge that
// entered it, which preserves the language exactly (a mark seen infinitely
// often on edges is a split state visited infinitely often). Generalized
// Büchi is degeneralised with the usual counter. Rabin, Streett and arbitrary
// Emerson-Lei conditions are refused by name rather than approximated.

import { aMachine } from '../grammar.mjs';
import { CliError } from '../errors.mjs';

// ── Reading ───────────────────────────────────────────────────────

function tokenizeHOA(text) {
  const toks = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && text[i + 1] === '*') {
      let depth = 1; i += 2;
      while (i < n && depth) {
        if (text[i] === '/' && text[i + 1] === '*') { depth++; i += 2; }
        else if (text[i] === '*' && text[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
      continue;
    }
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < n && text[j] !== '"') { if (text[j] === '\\') j++; s += text[j]; j++; }
      toks.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (text.startsWith('--BODY--', i)) { toks.push({ t: 'body' }); i += 8; continue; }
    if (text.startsWith('--END--', i)) { toks.push({ t: 'end' }); i += 7; continue; }
    if (text.startsWith('--ABORT--', i)) throw new CliError('The HOA stream was aborted by its producer (--ABORT--).');
    if (/[0-9]/.test(c)) {
      let j = i; while (j < n && /[0-9]/.test(text[j])) j++;
      toks.push({ t: 'int', v: Number(text.slice(i, j)) }); i = j; continue;
    }
    if (/[A-Za-z_@]/.test(c)) {
      let j = i + 1; while (j < n && /[A-Za-z0-9_\-]/.test(text[j])) j++;
      let word = text.slice(i, j);
      if (text[j] === ':' && c !== '@') { toks.push({ t: 'hdr', v: word }); i = j + 1; continue; }
      toks.push({ t: c === '@' ? 'alias' : 'id', v: word }); i = j; continue;
    }
    toks.push({ t: 'sym', v: c }); i++;
  }
  return toks;
}

// Boolean label expressions over AP indices: t, f, n, @alias, !, &, |, ( ).
function parseLabel(toks, pos, aliases) {
  let i = pos;
  const peek = () => toks[i];
  function or() {
    let l = and();
    while (peek()?.t === 'sym' && peek().v === '|') { i++; const r = and(); const a = l; l = v => a(v) || r(v); }
    return l;
  }
  function and() {
    let l = not();
    while (peek()?.t === 'sym' && peek().v === '&') { i++; const r = not(); const a = l; l = v => a(v) && r(v); }
    return l;
  }
  function not() {
    if (peek()?.t === 'sym' && peek().v === '!') { i++; const e = not(); return v => !e(v); }
    return atom();
  }
  function atom() {
    const tk = toks[i++];
    if (!tk) throw new CliError('HOA: a label ended early.');
    if (tk.t === 'int') { const k = tk.v; return v => !!(v & (1 << k)); }
    if (tk.t === 'id' && tk.v === 't') return () => true;
    if (tk.t === 'id' && tk.v === 'f') return () => false;
    if (tk.t === 'alias') {
      const e = aliases.get(tk.v);
      if (!e) throw new CliError(`HOA: the alias ${tk.v} is used before it is defined.`);
      return e;
    }
    if (tk.t === 'sym' && tk.v === '(') {
      const e = or();
      const close = toks[i++];
      if (!close || close.v !== ')') throw new CliError('HOA: a label has an unclosed parenthesis.');
      return e;
    }
    throw new CliError(`HOA: unexpected ${tk.v ?? tk.t} in a label.`);
  }
  const fn = or();
  return { fn, next: i };
}

// Acceptance formula → a small tree: {op:'inf'|'fin', set, neg} | {op:'and'|'or', l, r} | {op:'t'|'f'}
function parseAcceptance(toks, pos) {
  let i = pos;
  const peek = () => toks[i];
  function or() {
    let l = and();
    while (peek()?.t === 'sym' && peek().v === '|') { i++; l = { op: 'or', l, r: and() }; }
    return l;
  }
  function and() {
    let l = atom();
    while (peek()?.t === 'sym' && peek().v === '&') { i++; l = { op: 'and', l, r: atom() }; }
    return l;
  }
  function atom() {
    const tk = toks[i++];
    if (tk?.t === 'id' && (tk.v === 't' || tk.v === 'f')) return { op: tk.v };
    if (tk?.t === 'id' && (tk.v === 'Inf' || tk.v === 'Fin')) {
      if (toks[i++]?.v !== '(') throw new CliError('HOA: Inf/Fin needs an argument in parentheses.');
      let neg = false;
      if (peek()?.t === 'sym' && peek().v === '!') { neg = true; i++; }
      const set = toks[i++];
      if (set?.t !== 'int') throw new CliError('HOA: Inf/Fin takes an acceptance set number.');
      if (toks[i++]?.v !== ')') throw new CliError('HOA: unclosed Inf/Fin.');
      return { op: tk.v === 'Inf' ? 'inf' : 'fin', set: set.v, neg };
    }
    if (tk?.t === 'sym' && tk.v === '(') {
      const e = or();
      if (toks[i++]?.v !== ')') throw new CliError('HOA: unclosed parenthesis in Acceptance.');
      return e;
    }
    throw new CliError('HOA: could not read the Acceptance condition.');
  }
  return { tree: or(), next: i };
}

function flattenOp(tree, op) {
  if (tree.op === op) return [...flattenOp(tree.l, op), ...flattenOp(tree.r, op)];
  return [tree];
}

/**
 * The acceptance condition, recognised as one of the shapes the app has:
 *   { kind: 'buchi', sets: [s] }           Inf(s)
 *   { kind: 'genbuchi', sets: [s1..sk] }   Inf(s1) & … & Inf(sk)
 *   { kind: 'cobuchi', sets: [s] }         Fin(s)
 *   { kind: 'parity', sets: n }            parity min even over sets 0..n-1
 *   { kind: 'all' } / { kind: 'none' }     t / f
 */
function classifyAcceptance(tree, count, accName) {
  if (tree.op === 't') return { kind: 'all' };
  if (tree.op === 'f') return { kind: 'none' };
  if (tree.op === 'inf' && !tree.neg) return { kind: 'buchi', sets: [tree.set] };
  if (tree.op === 'fin' && !tree.neg) return { kind: 'cobuchi', sets: [tree.set] };
  const conj = flattenOp(tree, 'and');
  if (conj.length > 1 && conj.every(c => c.op === 'inf' && !c.neg)) return { kind: 'genbuchi', sets: conj.map(c => c.set) };
  const parity = parityOf(tree, count, accName);
  if (parity) return parity;
  throw new CliError(`HOA: the acceptance condition${accName ? ` (${accName})` : ''} is not Büchi, generalized Büchi, co-Büchi or parity, so no machine in the app can hold it.`);
}

// The Acceptance line is what a parity condition is, not acc-name: the name is
// optional, and two colours of min odd are exactly Rabin 1 (Fin(0) & Inf(1)),
// two of max odd exactly Streett 1 (Fin(0) | Inf(1)) — which is what Spot names
// them. So the formula is compared with each flavour on every set of colours
// that could be seen infinitely often, the named flavour first. An unseen
// colour is past the end, k under min and −1 under max, as priorityOf maps it.
const PARITY_FLAVOURS = [['min', 'even'], ['min', 'odd'], ['max', 'even'], ['max', 'odd']];
const MAX_PARITY_SETS = 16;

function parityOf(tree, count, accName) {
  if (count < 1 || count > MAX_PARITY_SETS) return null;
  const named = accName && /^parity\s+(min|max)\s+(even|odd)\b/.exec(accName);
  const flavours = named ? [[named[1], named[2]], ...PARITY_FLAVOURS] : PARITY_FLAVOURS;
  const holds = (t, inf) => {
    switch (t.op) {
      case 't': return true;
      case 'f': return false;
      case 'inf': return t.neg || t.set >= count ? null : inf.has(t.set);
      case 'fin': return t.neg || t.set >= count ? null : !inf.has(t.set);
      default: {
        const l = holds(t.l, inf), r = holds(t.r, inf);
        if (l === null || r === null) return null;
        return t.op === 'and' ? l && r : l || r;
      }
    }
  };
  for (const [dir, par] of flavours) {
    let same = true;
    for (let bits = 0; same && bits < 1 << count; bits++) {
      const seen = [];
      for (let s = 0; s < count; s++) if (bits & (1 << s)) seen.push(s);
      const got = holds(tree, new Set(seen));
      if (got === null) return null;
      const m = seen.length ? (dir === 'min' ? seen[0] : seen[seen.length - 1]) : (dir === 'min' ? count : -1);
      same = got === ((Math.abs(m) % 2 === 0) === (par === 'even'));
    }
    if (same) return { kind: 'parity', dir, par, sets: count };
  }
  return null;
}

/**
 * HOA text → the loadData fields of the matching ω-automaton, or throws.
 * Only the first automaton of a stream is read.
 */
export function readHOA(text, sym) {
  const toks = tokenizeHOA(text);
  let i = 0;
  const header = { aps: [], starts: [], aliases: new Map(), states: null, accName: null, acc: null, accCount: 0, name: null, props: [] };
  if (toks[i]?.t !== 'hdr' || toks[i].v !== 'HOA') throw new CliError('HOA: the text does not start with "HOA: v1".');
  // Header items until --BODY--.
  while (i < toks.length && toks[i].t !== 'body') {
    const h = toks[i++];
    if (h.t !== 'hdr') continue;
    const args = [];
    const start = i;
    while (i < toks.length && toks[i].t !== 'hdr' && toks[i].t !== 'body') i++;
    for (let j = start; j < i; j++) args.push(toks[j]);
    switch (h.v) {
      case 'States': header.states = args[0]?.v; break;
      case 'Start': {
        // A conjunction of states is alternation, which no machine here has.
        if (args.some(a => a.t === 'sym' && a.v === '&')) throw new CliError('HOA: an alternating start (conjunction of states) is not supported.');
        header.starts.push(...args.filter(a => a.t === 'int').map(a => a.v));
        break;
      }
      case 'AP': header.aps = args.slice(1).filter(a => a.t === 'str').map(a => a.v); break;
      case 'Alias': {
        const name = args[0]?.v;
        const { fn } = parseLabel(args, 1, header.aliases);
        header.aliases.set(name, fn);
        break;
      }
      case 'Acceptance': {
        header.accCount = args[0]?.v ?? 0;
        header.acc = parseAcceptance(args, 1).tree;
        break;
      }
      case 'acc-name': header.accName = args.map(a => a.v).join(' '); break;
      case 'name': header.name = args[0]?.v ?? null; break;
      case 'properties': header.props.push(...args.map(a => a.v)); break;
      default: break;
    }
  }
  if (toks[i]?.t !== 'body') throw new CliError('HOA: no --BODY-- section.');
  i++;
  if (header.aps.length > 12) throw new CliError(`HOA: ${header.aps.length} atomic propositions is 2^${header.aps.length} letters; this reads at most 12.`);
  const acc = classifyAcceptance(header.acc || { op: 't' }, header.accCount, header.accName);

  // Body: State: n ["name"] [{sets}] then edges.
  const states = new Map(); // n -> { name, marks:Set, edges: [{label, to, marks}] }
  let cur = null;
  let implicitIndex = 0;
  const nVals = 1 << header.aps.length;
  const readSets = () => {
    const out = [];
    if (toks[i]?.t === 'sym' && toks[i].v === '{') {
      i++;
      while (toks[i] && !(toks[i].t === 'sym' && toks[i].v === '}')) { if (toks[i].t === 'int') out.push(toks[i].v); i++; }
      i++;
    }
    return out;
  };
  while (i < toks.length && toks[i].t !== 'end') {
    const tk = toks[i];
    if (tk.t === 'hdr' && tk.v === 'State') {
      i++;
      let stateLabel = null;
      if (toks[i]?.t === 'sym' && toks[i].v === '[') {
        const r = parseLabel(toks, i + 1, header.aliases);
        stateLabel = r.fn; i = r.next + 1;
      }
      const num = toks[i++]?.v;
      let name = null;
      if (toks[i]?.t === 'str') name = toks[i++].v;
      const marks = readSets();
      cur = { num, name, marks, edges: [], stateLabel };
      states.set(num, cur);
      implicitIndex = 0;
      continue;
    }
    if (!cur) throw new CliError('HOA: an edge appears before any State:.');
    let label = null;
    if (tk.t === 'sym' && tk.v === '[') {
      const r = parseLabel(toks, i + 1, header.aliases);
      label = r.fn; i = r.next;
      if (toks[i]?.v !== ']') throw new CliError('HOA: an edge label is missing its closing bracket.');
      i++;
    }
    if (toks[i]?.t !== 'int') throw new CliError(`HOA: expected a destination state, found ${toks[i]?.v ?? 'the end'}.`);
    const dests = [toks[i++].v];
    if (toks[i]?.t === 'sym' && toks[i].v === '&') throw new CliError('HOA: alternating edges (conjunctions of states) are not supported.');
    const marks = readSets();
    if (!label) {
      if (cur.stateLabel) label = cur.stateLabel;
      else { const k = implicitIndex++; label = v => v === k; }
    }
    for (const to of dests) cur.edges.push({ label, to, marks });
  }

  const n = header.states ?? (Math.max(-1, ...states.keys(), ...header.starts) + 1);
  for (let q = 0; q < n; q++) if (!states.has(q)) states.set(q, { num: q, name: null, marks: [], edges: [] });
  if (!header.starts.length) throw new CliError('HOA: no Start: state.');

  // The letters: every valuation some edge admits.
  const used = new Set();
  for (const st of states.values()) for (const e of st.edges) for (let v = 0; v < nVals; v++) if (e.label(v)) used.add(v);
  const oneHot = [...used].every(v => v && !(v & (v - 1)));
  // A proposition name becomes a symbol as it is, except for what the app's
  // words cannot contain: a space or a comma separates symbols.
  const clean = s => String(s).replace(/[\s,]/g, '_') || '_';
  const letter = v => {
    if (oneHot) return clean(header.aps[Math.log2(v)]);
    const on = header.aps.filter((_, k) => v & (1 << k)).map(clean);
    return on.length ? on.join('&') : '∅';
  };
  const letters = [...used].sort((a, b) => a - b);

  // Acceptance → per-state data, splitting states by entering marks when the
  // marks are on transitions.
  const transitionBased = [...states.values()].some(st => st.edges.some(e => e.marks.length));
  let machine, out;
  if (acc.kind === 'genbuchi') out = degeneralize(states, header, acc.sets, letters, letter, transitionBased);
  else out = split(states, header, acc, letters, letter, transitionBased);
  machine = out.machine;
  const deterministic = isDeterministic(out.transitions, out.startIds);
  if (out.startIds.length > 1) mergeStarts(out);
  const type = { buchi: 'BA', cobuchi: 'coBA', parity: 'PA' }[machine];
  const warnings = [];
  if (acc.kind === 'genbuchi') warnings.push(`Generalized Büchi with ${acc.sets.length} sets was degeneralised into a Büchi automaton.`);
  if (transitionBased) warnings.push('Transition-based acceptance was moved onto states by splitting each state by the marks of the edges entering it.');
  return {
    machine: (deterministic && out.startIds.length === 1 ? 'D' : 'N') + type,
    sigma: letters.map(letter),
    stackAlpha: [],
    outputAlpha: [],
    tapeCount: 1,
    states: out.states,
    transitions: out.transitions,
    startId: out.startId,
    accepts: out.accepts,
    config: {},
    warnings,
    meta: header.name ? { title: header.name, blurb: `Read from HOA${header.accName ? ` (${header.accName})` : ''}.` } : null
  };
}

/**
 * Büchi / co-Büchi / parity / t / f, state- or transition-based → states with
 * F or priorities. A transition mark is carried by splitting the target state
 * into one copy per distinct mark set arriving at it.
 */
function split(states, header, acc, letters, letter, transitionBased) {
  const machineOf = { buchi: 'buchi', cobuchi: 'cobuchi', parity: 'parity', all: 'buchi', none: 'buchi' };
  const machine = machineOf[acc.kind];
  // Which mark set a state copy carries: state marks, or the entering edge's.
  const key = (q, marks) => `${q}|${[...marks].sort((a, b) => a - b).join(',')}`;
  const copies = new Map();
  const outStates = [], outTrans = [], accepts = [];
  // Any parity flavour → the app's min-even, by a map that keeps the order of
  // importance and sends accepting colours to even ones. An unmarked visit is
  // a colour past the end: k under min (least important), −1 under max.
  //   min even   m          min odd    m + 1
  //   max even   k − m or k + 1 − m, whichever makes m even ↔ result even
  //   max odd    likewise with m odd ↔ result even
  const priorityOf = marks => {
    if (acc.kind !== 'parity') return null;
    const k = acc.sets;
    if (acc.dir === 'min') {
      const m = marks.length ? Math.min(...marks) : k;
      return acc.par === 'even' ? m : m + 1;
    }
    const m = marks.length ? Math.max(...marks) : -1;
    const wantEven = acc.par === 'even' ? k % 2 === 0 : k % 2 === 1;
    return wantEven ? k - m : k + 1 - m;
  };
  const isAccepting = marks => {
    if (acc.kind === 'all') return true;
    if (acc.kind === 'none') return false;
    return marks.includes(acc.sets[0]);
  };
  const ensure = (q, marks) => {
    const k = key(q, marks);
    if (copies.has(k)) return copies.get(k);
    const st = states.get(q);
    const id = `q${copies.size}`;
    const base = st.name ?? String(q);
    const name = transitionBased && marks.length ? `${base}·${[...marks].sort().join('')}` : base;
    const s = { id, name };
    const pr = priorityOf(marks);
    if (pr !== null) s.priority = pr;
    outStates.push(s);
    if (acc.kind !== 'parity' && isAccepting(marks)) accepts.push(id);
    copies.set(k, { id, q, marks });
    work.push(copies.get(k));
    return copies.get(k);
  };
  const work = [];
  const startIds = header.starts.map(q => ensure(q, transitionBased ? [] : states.get(q).marks).id);
  for (let h = 0; h < work.length; h++) {
    const { id, q } = work[h];
    for (const e of states.get(q).edges) {
      // A state's own marks count as marks on each of its outgoing edges.
      const marks = transitionBased ? [...new Set([...e.marks, ...states.get(q).marks])] : states.get(e.to).marks;
      const to = ensure(e.to, marks).id;
      for (const v of letters) if (e.label(v)) outTrans.push({ id: `t${outTrans.length + 1}`, from: id, to, symbol: letter(v) });
    }
  }
  return { machine, states: outStates, transitions: dedupe(outTrans), accepts, startIds, startId: startIds[0] };
}

/** Generalized Büchi → Büchi: states (q, i) waiting for set i; accepting at i = 0 on a wrap. */
function degeneralize(states, header, sets, letters, letter, transitionBased) {
  const k = sets.length;
  const outStates = [], outTrans = [], accepts = [];
  const ids = new Map();
  const work = [];
  const ensure = (q, i, acc) => {
    const key = `${q}|${i}|${acc ? 1 : 0}`;
    if (ids.has(key)) return ids.get(key);
    const id = `q${ids.size}`;
    ids.set(key, id);
    outStates.push({ id, name: `${states.get(q).name ?? q}·${i}${acc ? '✓' : ''}` });
    if (acc) accepts.push(id);
    work.push({ id, q, i });
    return id;
  };
  // Advance the counter past every set the marks satisfy, in order.
  const advance = (i, marks) => {
    let j = i, wrapped = false;
    while (marks.includes(sets[j])) { j++; if (j === k) { j = 0; wrapped = true; break; } }
    return { j, wrapped };
  };
  const startIds = header.starts.map(q => ensure(q, 0, false));
  for (let h = 0; h < work.length; h++) {
    const { id, q, i } = work[h];
    for (const e of states.get(q).edges) {
      const marks = transitionBased ? [...new Set([...e.marks, ...states.get(q).marks])] : states.get(q).marks;
      const { j, wrapped } = advance(i, marks);
      const to = ensure(e.to, j, wrapped);
      for (const v of letters) if (e.label(v)) outTrans.push({ id: `t${outTrans.length + 1}`, from: id, to, symbol: letter(v) });
    }
  }
  return { machine: 'buchi', states: outStates, transitions: dedupe(outTrans), accepts, startIds, startId: startIds[0] };
}

function dedupe(ts) {
  const seen = new Set();
  const out = [];
  for (const t of ts) {
    const key = `${t.from}|${t.to}|${t.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...t, id: `t${out.length + 1}` });
  }
  return out;
}

function isDeterministic(transitions, startIds) {
  if (startIds.length > 1) return false;
  const seen = new Set();
  for (const t of transitions) {
    const key = `${t.from}|${t.symbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/**
 * Several initial states → one: a fresh state with every initial state's
 * outgoing edges. It is visited once, so it changes no ω-run's inf(r).
 */
function mergeStarts(out) {
  const id = 'q_init';
  const s = { id, name: 'init' };
  if (out.states.some(x => x.priority !== undefined)) s.priority = Math.max(...out.states.map(x => x.priority ?? 0));
  out.states.unshift(s);
  const starts = new Set(out.startIds);
  const extra = out.transitions.filter(t => starts.has(t.from)).map(t => ({ ...t, from: id }));
  out.transitions = dedupe([...out.transitions, ...extra]);
  out.startId = id;
  out.startIds = [id];
}

// ── Writing ───────────────────────────────────────────────────────

const OMEGA = new Set(['DBA', 'DcoBA', 'DPA', 'DWA', 'NBA', 'NcoBA', 'NPA', 'NWA']);

/** An ω-automaton target → HOA text. */
export function hoaText(target, { name = null, warn = () => {} } = {}) {
  if (!OMEGA.has(target.machine)) {
    throw new CliError(`HOA describes ω-automata; ${aMachine(target.machine)} is not one. Use --to automaton, jff or dot instead.`);
  }
  const sym = target.config?.sym || {};
  const any = sym.any ?? 'Σ';
  const sigma = [...new Set(target.sigma)].filter(s => s !== sym.eps);
  const index = new Map(target.states.map((s, k) => [s.id, k]));
  const apIndex = new Map(sigma.map((s, k) => [s, k]));
  const spaced = sigma.filter(a => /[\s,]/.test(a));
  if (spaced.length) warn(`${spaced.map(a => JSON.stringify(a)).join(', ')} contain a space or comma, which the app's words cannot: reading this file back names them with _ instead.`);
  const cond = target.machine.replace(/^[DN]/, '');
  const accepts = new Set(target.accepts || []);
  const lines = ['HOA: v1', `tool: "AutomataStudio"`];
  if (name) lines.push(`name: "${String(name).replace(/"/g, '\\"')}"`);
  lines.push(`States: ${target.states.length}`);
  if (target.startId) lines.push(`Start: ${index.get(target.startId)}`);
  lines.push(`AP: ${sigma.length}${sigma.map(s => ` "${s.replace(/"/g, '\\"')}"`).join('')}`);
  let priorities = null;
  if (cond === 'BA' || cond === 'WA') {
    lines.push('acc-name: Buchi', 'Acceptance: 1 Inf(0)');
  } else if (cond === 'coBA') {
    lines.push('acc-name: co-Buchi', 'Acceptance: 1 Fin(0)');
  } else {
    priorities = target.states.map(s => Math.max(0, Math.floor(Number(s.priority) || 0)));
    const k = Math.max(1, ...priorities.map(p => p + 1));
    lines.push(`acc-name: parity min even ${k}`, `Acceptance: ${k} ${parityFormula(0, k)}`);
  }
  const props = ['explicit-labels', 'state-acc', 'trans-labels'];
  if (target.machine.startsWith('D')) props.push('deterministic');
  lines.push(`properties: ${props.join(' ')}`);
  lines.push('--BODY--');
  const letterLabel = s => sigma.map((x, k) => (x === s ? String(k) : `!${k}`)).join('&') || 't';
  target.states.forEach((s, k) => {
    let marks = '';
    if (priorities) marks = ` {${priorities[k]}}`;
    else if (accepts.has(s.id)) marks = ' {0}';
    lines.push(`State: ${k} "${String(s.name ?? s.id).replace(/"/g, '\\"')}"${marks}`);
    for (const t of target.transitions.filter(t => t.from === s.id)) {
      const syms = t.symbol === any ? sigma : [t.symbol];
      for (const a of syms) {
        if (!apIndex.has(a)) continue;
        lines.push(`[${letterLabel(a)}] ${index.get(t.to)}`);
      }
    }
  });
  lines.push('--END--');
  return lines.join('\n') + '\n';
}

// min even over sets 0..k-1: Inf(0) | (Fin(1) & (Inf(2) | (Fin(3) & …)))
function parityFormula(i, k) {
  if (i >= k) return i % 2 === 0 ? 'f' : 't';
  const atom = i % 2 === 0 ? `Inf(${i})` : `Fin(${i})`;
  if (i === k - 1) return atom;
  const rest = parityFormula(i + 1, k);
  return i % 2 === 0 ? `${atom} | (${rest})` : `${atom} & (${rest})`;
}
