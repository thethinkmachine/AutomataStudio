// ══════════════════════════════════════════════════════════════════
//  THE LEXER GENERATOR
// ══════════════════════════════════════════════════════════════════
// A rule set → one minimal DFA whose accepting states name a token.
// Import-free apart from the pattern parser, and App-free: what goes in is
// text and what comes out is tables, so every step is testable and the same
// tables drive the in-app tokenizer, the diagram and the generated code.
//
// The construction is the one the Algorithms view teaches, run for real:
//
//   1. each rule's pattern → an NFA (Thompson), its final node tagged with
//      the rule's index;
//   2. one start node with an ε-edge to each rule's NFA;
//   3. the universe of characters is cut into *classes* — maximal sets of
//      characters no pattern tells apart — so the DFA has a column per
//      class rather than per character. `[a-z]` and `[a-zA-Z_]` together
//      make three classes, not fifty-three columns;
//   4. subset construction over classes. A DFA state accepts the token of
//      the *lowest-numbered* rule among the NFA finals it contains: that is
//      the "earlier rule wins" tie-break, decided once at build time;
//   5. minimization, starting from the partition by token — two states that
//      accept different tokens are never merged, however alike they are.
//
// At run time the lexer takes the longest match (maximal munch): it runs the
// DFA as far as it can go and returns to the last accepting state it passed.
//
// The universe is ASCII plus any non-ASCII character a rule names
// literally. `.` and a negated class are resolved against it, so `[^"]`
// matches every character in the universe but `"`; a character outside the
// universe matches no rule and is reported as unexpected input.

import { RegexError, literalCodePoints, parseLexerRegex } from './regex.js';

export const LEXER_LANGS = [
  ['js', 'JavaScript'],
  ['py', 'Python'],
  ['c', 'C']
];

export const DEFAULT_LEXER_RULES = [
  '# One rule per line: NAME, then its pattern.',
  '# When two rules match the same text, the one listed first wins.',
  '# Prefix a rule with "skip" to drop what it matches.',
  'IF       if',
  'ELSE     else',
  'NUMBER   \\d+(\\.\\d+)?',
  'IDENT    [A-Za-z_]\\w*',
  'STRING   "([^"\\\\\\n]|\\\\.)*"',
  'OP       ==|!=|<=|>=|[-+*/=<>]',
  'LPAREN   \\(',
  'RPAREN   \\)',
  'skip WS  \\s+',
  'skip COMMENT  #[^\\n]*'
].join('\n');

export const DEFAULT_LEXER_SAMPLE = 'if (rate >= 2.5) total = total + "fee" # charge it';

const LIMITS = { rules: 200, nfaNodes: 50000, dfaStates: 5000 };

/** The persisted shape: `{ rules, sample, lang }`, or null. */
export function normalizeLexerDoc(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    rules: typeof raw.rules === 'string' ? raw.rules.slice(0, 20000) : DEFAULT_LEXER_RULES,
    sample: typeof raw.sample === 'string' ? raw.sample.slice(0, 20000) : DEFAULT_LEXER_SAMPLE,
    lang: LEXER_LANGS.some(([k]) => k === raw.lang) ? raw.lang : 'js'
  };
}

// ── the spec ──────────────────────────────────────────────────────

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Text → rules. Each line is `[skip] NAME pattern`; the pattern is the rest
 * of the line after the first run of whitespace, trimmed — so a pattern that
 * is a space is written `\s`, `[ ]` or `\x20`. `#` starts a comment only at
 * the beginning of a line, since `#` inside a pattern is an ordinary
 * character.
 */
export function parseLexerSpec(text) {
  const rules = [];
  const diagnostics = [];
  String(text || '').split('\n').forEach((raw, i) => {
    const line = i + 1;
    const s = raw.trim();
    if (!s || s.startsWith('#')) return;
    let rest = s, skip = false;
    const skipM = /^skip\s+/.exec(rest);
    if (skipM) { skip = true; rest = rest.slice(skipM[0].length); }
    const m = /^(\S+)\s+(.*)$/.exec(rest);
    if (!m) {
      diagnostics.push({ line, level: 'error', message: NAME_RE.test(rest) ? `${rest} has no pattern.` : 'Expected a token name and a pattern.' });
      return;
    }
    const [, name, pattern] = m;
    if (!NAME_RE.test(name)) {
      diagnostics.push({ line, level: 'error', message: `"${name}" is not a token name — use letters, digits and _, starting with a letter.` });
      return;
    }
    rules.push({ name, pattern: pattern.trim(), skip, line });
  });
  if (rules.length > LIMITS.rules) diagnostics.push({ line: rules[LIMITS.rules].line, level: 'error', message: `At most ${LIMITS.rules} rules.` });
  return { rules: rules.slice(0, LIMITS.rules), diagnostics };
}

// ── NFA ───────────────────────────────────────────────────────────

class NFA {
  constructor() { this.eps = []; this.edges = []; this.final = []; }
  node() {
    if (this.eps.length >= LIMITS.nfaNodes) throw new RegexError('the patterns are too large to compile', 0);
    this.eps.push([]); this.edges.push([]); this.final.push(-1);
    return this.eps.length - 1;
  }
}

// Thompson's construction; `resolve` turns a set node into a code point
// array against the universe. Returns [start, end].
function thompson(nfa, ast, resolve) {
  switch (ast.t) {
    case 'eps': { const s = nfa.node(), e = nfa.node(); nfa.eps[s].push(e); return [s, e]; }
    case 'set': { const s = nfa.node(), e = nfa.node(); nfa.edges[s].push({ cps: resolve(ast), to: e }); return [s, e]; }
    case 'cat': {
      const frags = ast.parts.map(p => thompson(nfa, p, resolve));
      for (let i = 0; i + 1 < frags.length; i++) nfa.eps[frags[i][1]].push(frags[i + 1][0]);
      return [frags[0][0], frags[frags.length - 1][1]];
    }
    case 'alt': {
      const s = nfa.node(), e = nfa.node();
      ast.parts.forEach(p => { const [ps, pe] = thompson(nfa, p, resolve); nfa.eps[s].push(ps); nfa.eps[pe].push(e); });
      return [s, e];
    }
    case 'rep': {
      const s = nfa.node(), e = nfa.node();
      let cur = s;
      for (let i = 0; i < ast.min; i++) {
        const [ps, pe] = thompson(nfa, ast.c, resolve);
        nfa.eps[cur].push(ps); cur = pe;
      }
      if (ast.max === Infinity) {
        const [ps, pe] = thompson(nfa, ast.c, resolve);
        nfa.eps[cur].push(ps, e); nfa.eps[pe].push(ps, e);
      } else {
        for (let i = ast.min; i < ast.max; i++) {
          const [ps, pe] = thompson(nfa, ast.c, resolve);
          nfa.eps[cur].push(ps, e); cur = pe;
        }
        nfa.eps[cur].push(e);
      }
      return [s, e];
    }
    default: throw new Error('unknown node ' + ast.t);
  }
}

function closure(nfa, seeds) {
  const seen = new Set(seeds), stk = [...seeds];
  while (stk.length) {
    const n = stk.pop();
    for (const m of nfa.eps[n]) if (!seen.has(m)) { seen.add(m); stk.push(m); }
  }
  return [...seen].sort((a, b) => a - b);
}

// ── classes ───────────────────────────────────────────────────────

// Characters no pattern distinguishes share a class. A character's signature
// is the list of distinct edge sets containing it; equal signatures, one
// class. Characters in no set belong to no class — nothing can read them.
function partition(universe, edgeSets) {
  const sig = new Map(universe.map(c => [c, '']));
  edgeSets.forEach((set, j) => set.forEach(c => { if (sig.has(c)) sig.set(c, sig.get(c) + ',' + j); }));
  const bySig = new Map();
  universe.forEach(c => {
    const s = sig.get(c);
    if (!s) return;
    if (!bySig.has(s)) bySig.set(s, []);
    bySig.get(s).push(c);
  });
  const classes = [...bySig.values()].sort((a, b) => a[0] - b[0]);
  const classOf = new Map();
  classes.forEach((cps, i) => cps.forEach(c => classOf.set(c, i)));
  return { classes, classOf };
}

// A class drawn as a Σ symbol: no whitespace and no comma, because Σ is typed
// as a whitespace- or comma-separated list and a symbol containing either
// could never be entered again. So those are escaped, and a class covering
// most of the universe is drawn as the complement of what it lacks.
function charLabel(c) {
  if (c === 32) return '␣';
  if (c === 9) return '\\t';
  if (c === 10) return '\\n';
  if (c === 13) return '\\r';
  if (c === 44) return '\\x2c';
  if (c === 92) return '\\\\';
  if (c === 45) return '\\-';
  if (c < 32 || c === 127) return '\\x' + c.toString(16).padStart(2, '0');
  const ch = String.fromCodePoint(c);
  return /\s/.test(ch) ? '\\u{' + c.toString(16) + '}' : ch;
}

function describeSet(cps) {
  const sorted = [...cps].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j - i >= 2) parts.push(charLabel(sorted[i]) + '-' + charLabel(sorted[j]));
    else for (let k = i; k <= j; k++) parts.push(charLabel(sorted[k]));
    i = j + 1;
  }
  return parts.join('');
}

export function classLabels(classes, universe) {
  const used = new Set();
  return classes.map(cps => {
    const inClass = new Set(cps);
    const rest = universe.filter(c => !inClass.has(c));
    const direct = describeSet(cps);
    const inverse = rest.length ? '¬' + describeSet(rest) : 'any';
    let label = inverse.length < direct.length ? inverse : direct;
    if (label.length > 28) label = label.slice(0, 26) + '…';
    let unique = label, n = 2;
    while (used.has(unique)) unique = `${label}#${n++}`;
    used.add(unique);
    return unique;
  });
}

// ── build ─────────────────────────────────────────────────────────

/**
 * Rules text → a lexer.
 *
 * `{ ok, rules, diagnostics, classes, classOf, labels, start, trans, accept,
 *    nStates, nClasses, universe }` where `trans[s * nClasses + k]` is the
 * next state or -1, and `accept[s]` is a rule index or -1.
 * `ok: false` carries only `rules` and `diagnostics`.
 */
export function buildLexer(text) {
  const spec = parseLexerSpec(text);
  const diagnostics = [...spec.diagnostics];
  const rules = spec.rules;
  const fail = () => ({ ok: false, rules, diagnostics });

  const asts = rules.map(r => {
    try { return parseLexerRegex(r.pattern); }
    catch (e) {
      if (!(e instanceof RegexError)) throw e;
      diagnostics.push({ line: r.line, level: 'error', message: `${r.name}: ${e.message}${e.index != null ? ` (column ${e.index + 1} of the pattern)` : ''}.` });
      return null;
    }
  });
  if (!rules.length && !diagnostics.length) diagnostics.push({ line: 1, level: 'error', message: 'No rules yet.' });
  if (diagnostics.some(d => d.level === 'error')) return fail();

  const universeSet = new Set();
  for (let c = 0; c < 128; c++) universeSet.add(c);
  asts.forEach(a => literalCodePoints(a).forEach(c => universeSet.add(c)));
  const universe = [...universeSet].sort((a, b) => a - b);
  const resolve = node => node.neg ? universe.filter(c => !node.cps.includes(c)) : node.cps;

  const nfa = new NFA();
  const start = nfa.node();
  const ruleStarts = [];
  try {
    asts.forEach((ast, i) => {
      const [s, e] = thompson(nfa, ast, resolve);
      nfa.eps[start].push(s);
      nfa.final[e] = i;
      ruleStarts.push(s);
    });
  } catch (e) {
    if (!(e instanceof RegexError)) throw e;
    diagnostics.push({ line: 1, level: 'error', message: e.message + '.' });
    return fail();
  }

  // A rule that matches the empty string would let the lexer produce a
  // zero-length token forever. Refused, not warned: there is no lexer to run.
  asts.forEach((_, i) => {
    if (closure(nfa, [ruleStarts[i]]).some(n => nfa.final[n] === i)) {
      diagnostics.push({ line: rules[i].line, level: 'error', message: `${rules[i].name} matches the empty string, so the lexer could match it forever without moving. Use + instead of *, or make part of it required.` });
    }
  });
  if (diagnostics.some(d => d.level === 'error')) return fail();

  const setKey = new Map();
  const edgeSets = [];
  nfa.edges.forEach(list => list.forEach(e => {
    const k = e.cps.join(',');
    if (!setKey.has(k)) { setKey.set(k, edgeSets.length); edgeSets.push(e.cps); }
    e.set = setKey.get(k);
  }));
  const { classes, classOf } = partition(universe, edgeSets);
  const nClasses = classes.length;
  // Which classes each distinct edge set covers.
  const setClasses = edgeSets.map(set => [...new Set(set.map(c => classOf.get(c)).filter(k => k !== undefined))]);

  // Subset construction.
  const winner = nodes => {
    let best = -1;
    for (const n of nodes) { const r = nfa.final[n]; if (r >= 0 && (best < 0 || r < best)) best = r; }
    return best;
  };
  const dStates = [closure(nfa, [start])];
  const index = new Map([[dStates[0].join(','), 0]]);
  const dTrans = [];
  const contains = []; // rules whose final each DFA state contains, for shadowing
  for (let s = 0; s < dStates.length; s++) {
    if (dStates.length > LIMITS.dfaStates) {
      diagnostics.push({ line: 1, level: 'error', message: `The lexer needs more than ${LIMITS.dfaStates} states; simplify the patterns.` });
      return fail();
    }
    const row = new Array(nClasses).fill(-1);
    const moves = Array.from({ length: nClasses }, () => new Set());
    for (const n of dStates[s]) for (const e of nfa.edges[n]) for (const k of setClasses[e.set]) moves[k].add(e.to);
    for (let k = 0; k < nClasses; k++) {
      if (!moves[k].size) continue;
      const next = closure(nfa, [...moves[k]]);
      const key = next.join(',');
      if (!index.has(key)) { index.set(key, dStates.length); dStates.push(next); }
      row[k] = index.get(key);
    }
    dTrans.push(row);
    contains.push(dStates[s].map(n => nfa.final[n]).filter(r => r >= 0));
  }
  const dAccept = dStates.map(winner);

  // A rule that never wins in any state is dead: every word it matches is
  // claimed by an earlier rule. Worth saying — it is the commonest lexer bug
  // there is (IDENT listed above the keywords).
  const wins = new Set(dAccept.filter(r => r >= 0));
  rules.forEach((r, i) => {
    if (wins.has(i)) return;
    const blockers = new Set();
    contains.forEach((rs, s) => { if (rs.includes(i) && dAccept[s] >= 0) blockers.add(rules[dAccept[s]].name); });
    const by = [...blockers].filter(n => n !== r.name);
    diagnostics.push({
      line: r.line, level: 'warning',
      message: `${r.name} can never be produced: everything it matches is claimed first by ${by.length ? by.join(', ') : 'an earlier rule with the same name'}. Move it above ${by.length > 1 ? 'them' : 'that rule'}.`
    });
  });

  // Minimization (Moore): refine the partition by token until stable.
  let block = dAccept.slice();
  let count = -1;
  while (true) {
    const sigs = new Map();
    const next = dTrans.map((row, s) => {
      const key = block[s] + '|' + row.map(t => (t < 0 ? -1 : block[t])).join(',');
      if (!sigs.has(key)) sigs.set(key, sigs.size);
      return sigs.get(key);
    });
    block = next;
    if (sigs.size === count) break;
    count = sigs.size;
  }
  // Renumber in BFS order from the start, so the tables are stable.
  const order = new Map([[block[0], 0]]);
  const rep = [0];
  for (let i = 0; i < rep.length; i++) {
    for (const t of dTrans[rep[i]]) {
      if (t >= 0 && !order.has(block[t])) { order.set(block[t], order.size); rep.push(t); }
    }
  }
  const nStates = rep.length;
  const trans = new Int32Array(nStates * nClasses).fill(-1);
  const accept = new Int32Array(nStates);
  rep.forEach((s, i) => {
    accept[i] = dAccept[s];
    dTrans[s].forEach((t, k) => { trans[i * nClasses + k] = t < 0 ? -1 : order.get(block[t]); });
  });

  return {
    ok: true, rules, diagnostics,
    universe, classes, classOf, labels: classLabels(classes, universe),
    start: 0, nStates, nClasses, trans, accept
  };
}

// ── running it ────────────────────────────────────────────────────

/**
 * Maximal munch over `input`. Returns `{ tokens, error }`: tokens carry
 * `{ type, text, line, col, skip }` (skipped ones included, flagged, so the
 * view can draw them dimmed), and `error` is `{ line, col, index, char }`
 * at the first character no rule can start with — the lexer stops there.
 */
export function runLexer(lx, input) {
  const cps = Array.from(String(input));
  const tokens = [];
  let pos = 0, line = 1, col = 1;
  while (pos < cps.length) {
    let s = lx.start, lastRule = -1, lastEnd = pos;
    for (let i = pos; i < cps.length; i++) {
      const k = lx.classOf.get(cps[i].codePointAt(0));
      if (k === undefined) break;
      s = lx.trans[s * lx.nClasses + k];
      if (s < 0) break;
      if (lx.accept[s] >= 0) { lastRule = lx.accept[s]; lastEnd = i + 1; }
    }
    if (lastRule < 0) return { tokens, error: { line, col, index: pos, char: cps[pos] } };
    const text = cps.slice(pos, lastEnd).join('');
    const rule = lx.rules[lastRule];
    tokens.push({ type: rule.name, text, line, col, skip: rule.skip });
    for (const ch of cps.slice(pos, lastEnd)) {
      if (ch === '\n') { line++; col = 1; } else col++;
    }
    pos = lastEnd;
  }
  return { tokens, error: null };
}

// ── as a machine on the canvas ────────────────────────────────────

/**
 * The lexer's DFA as a workspace machine: Σ is the class labels, accepting
 * states are named after the token they produce. What it accepts is the set
 * of single tokens — which is exactly what a lexer's DFA recognizes; the
 * longest-match loop around it is the driver's job, not the automaton's.
 */
export function lexerToMachine(lx) {
  const depth = new Array(lx.nStates).fill(-1);
  depth[lx.start] = 0;
  const queue = [lx.start];
  for (let h = 0; h < queue.length; h++) {
    const s = queue[h];
    for (let k = 0; k < lx.nClasses; k++) {
      const t = lx.trans[s * lx.nClasses + k];
      if (t >= 0 && depth[t] < 0) { depth[t] = depth[s] + 1; queue.push(t); }
    }
  }
  const rowsAt = new Map();
  const used = new Map();
  let plain = 0;
  const states = queue.map(s => {
    const d = depth[s];
    const row = rowsAt.get(d) || 0;
    rowsAt.set(d, row + 1);
    let name;
    if (s === lx.start) name = 'start';
    else if (lx.accept[s] >= 0) {
      const base = lx.rules[lx.accept[s]].name;
      const n = (used.get(base) || 0) + 1;
      used.set(base, n);
      name = n === 1 ? base : `${base}${n}`;
    } else name = `q${++plain}`;
    return { id: 's' + (s + 1), name, x: 120 + d * 190, y: 120 + row * 110 };
  });
  const transitions = [];
  queue.forEach(s => {
    for (let k = 0; k < lx.nClasses; k++) {
      const t = lx.trans[s * lx.nClasses + k];
      if (t >= 0) transitions.push({ id: 't' + (transitions.length + 1), from: 's' + (s + 1), to: 's' + (t + 1), symbol: lx.labels[k] });
    }
  });
  return {
    machine: 'DFA',
    states,
    transitions,
    startId: 's' + (lx.start + 1),
    accepts: queue.filter(s => lx.accept[s] >= 0).map(s => 's' + (s + 1)),
    sigma: [...lx.labels]
  };
}
