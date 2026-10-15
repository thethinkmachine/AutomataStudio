// ══════════════════════════════════════════════════════════════════
//  REGEX → ε-NFA (THOMPSON'S CONSTRUCTION)
// ══════════════════════════════════════════════════════════════════
// The textbook notation's parser and the construction over its tree, with no
// page attached: the Algorithms view draws it, and `automata` (cli/fa.mjs)
// builds from it under plain node.
//
// There used to be two constructions, one silent and one that narrated each
// fragment for the step-by-step card, and they had drifted — the narrated one
// expanded {n,m} on its own schedule and invented an ε for a node it did not
// know. Now there is one, and narration is an optional list it appends to.
//
// Not the lexer generator's parser (js/lexer/regex.js), which reads a
// different, programmer's dialect.

import { App } from '../core/state.js';
import { html } from '../text/html.js';

/** The printable ASCII range, which `.` and a negated class range over. */
export function getAllChars() {
  const chars = [];
  for (let i = 32; i <= 126; i++) chars.push(String.fromCharCode(i));
  return chars;
}

export function parseRE(re) {
  let pos = 0;
  const peek = () => re[pos];
  const digits = () => { let s = ''; while (pos < re.length && /\d/.test(re[pos])) s += re[pos++]; return s; };

  function parseUnion() {
    let r = parseConcat();
    while (peek() === '|') { pos++; r = { t: 'union', l: r, r: parseConcat() }; }
    return r;
  }
  function parseConcat() {
    let r = parseQuant();
    while (pos < re.length && peek() !== '|' && peek() !== ')') r = { t: 'cat', l: r, r: parseQuant() };
    return r;
  }
  function parseQuant() {
    let r = parseAtom();
    for (;;) {
      const q = peek();
      if (q === '*' || q === '+' || q === '?') {
        pos++;
        r = { t: q === '*' ? 'star' : q === '+' ? 'plus' : 'opt', c: r };
      } else if (q === '{') {
        pos++;
        const lo = digits();
        if (!lo) throw new Error('Expected digit in {n,m}');
        const min = parseInt(lo, 10);
        let max = min;
        if (peek() === ',') { pos++; const hi = digits(); max = hi ? parseInt(hi, 10) : Infinity; }
        if (peek() !== '}') throw new Error("Expected '}'");
        pos++;
        r = { t: 'bound', c: r, min, max };
      } else {
        return r;
      }
    }
  }
  function parseAtom() {
    if (pos >= re.length) throw new Error('Unexpected end');
    const ch = re[pos];
    if (ch === ')') throw new Error("Unexpected ')'");
    // These used to be read as letters: a||b had a letter |, *a a letter *.
    if (ch === '|') throw new Error(`An alternative is empty: write ${App.config.sym.eps} for the empty word`);
    if ('*+?{'.includes(ch)) throw new Error(`Nothing for '${ch}' to repeat`);
    if (ch === '(') {
      pos++;
      const r = parseUnion();
      if (peek() !== ')') throw new Error("Expected ')'");
      pos++;
      return r;
    }
    if (ch === App.config.sym.eps) { pos++; return { t: 'eps' }; }
    if (ch === '∅') { pos++; return { t: 'empty' }; }
    if (ch === '.') { pos++; return { t: 'any' }; }
    if (ch === '[') return parseClass();
    pos++;
    return { t: 'lit', ch };
  }
  function parseClass() {
    pos++;
    const neg = peek() === '^';
    if (neg) pos++;
    const chars = new Set();
    while (pos < re.length && peek() !== ']') {
      const c = re[pos++];
      if (peek() === '-' && re[pos + 1] !== ']') {
        pos++;
        const end = re[pos++];
        for (let i = c.charCodeAt(0); i <= end.charCodeAt(0); i++) chars.add(String.fromCharCode(i));
      } else {
        chars.add(c);
      }
    }
    if (pos >= re.length) throw new Error("Expected ']'");
    pos++;
    return { t: 'class', chars: [...chars], neg };
  }

  const parsed = parseUnion();
  if (pos !== re.length) throw new Error(`Unexpected token '${re[pos]}'`);
  return parsed;
}

// The sugar, rewritten into the five forms the construction has a fragment
// for. Expanding at the tree, rather than per fragment, is what keeps the
// narrated and the silent build numbering their states the same.
function desugar(ast) {
  switch (ast.t) {
    case 'plus': return { t: 'cat', l: ast.c, r: { t: 'star', c: ast.c } };
    case 'opt': return { t: 'union', l: ast.c, r: { t: 'eps' } };
    case 'class': return unionOf(ast.neg ? getAllChars().filter(c => !ast.chars.includes(c)) : ast.chars, 'Empty character class');
    case 'any': return unionOf(getAllChars(), "'.' requires a non-empty alphabet Σ");
    case 'bound': return expandBound(ast);
    default: return null;
  }
}

function unionOf(chars, emptyError) {
  if (!chars.length) throw new Error(emptyError);
  return chars.map(ch => ({ t: 'lit', ch })).reduce((l, r) => ({ t: 'union', l, r }));
}

function expandBound({ c, min, max }) {
  if (min === 0 && max === 1) return { t: 'opt', c };
  if (min === 0 && max === Infinity) return { t: 'star', c };
  if (min === 1 && max === Infinity) return { t: 'plus', c };
  const parts = [];
  for (let i = 0; i < min; i++) parts.push(c);
  // {n,} is n copies and then a star. It used to be the n copies alone, so
  // a{2,} matched aa and nothing longer.
  if (max === Infinity) parts.push({ t: 'star', c });
  else for (let i = min; i < max; i++) parts.push({ t: 'opt', c });
  return parts.length ? parts.reduce((l, r) => ({ t: 'cat', l, r })) : { t: 'eps' };
}

const KIND_LABELS = {
  lit: 'LITERAL', eps: 'EPSILON', empty: 'EMPTY (∅)', union: 'UNION (|)', cat: 'CONCAT', star: 'KLEENE *',
  plus: 'ONE-OR-MORE +', opt: 'OPTIONAL ?', class: 'CHAR CLASS', bound: 'BOUND {n,m}', any: 'ANY (.)'
};

/** What the step-by-step card calls a node of the tree. */
export function thAstLabel(kind) {
  return KIND_LABELS[kind] || String(kind).toUpperCase();
}

/**
 * Build the ε-NFA for a parsed expression. With `steps`, each fragment made
 * is appended to it as `{ kind, nfa, note }`, `note` being markup.
 */
export function buildThompson(ast, steps = null) {
  let n = 0;
  const fresh = () => 'n' + (++n);
  const eps = App.config.sym.eps;
  const say = (kind, nfa, note) => { if (steps) steps.push({ kind, nfa, note: String(note) }); return nfa; };
  const counts = nfa => `${nfa.states.length} states, ${nfa.trans.length} transitions`;

  function build(node) {
    switch (node.t) {
      case 'lit': {
        const s = fresh(), e = fresh();
        return say('lit', { states: [s, e], trans: [{ from: s, sym: node.ch, to: e }], start: s, accept: e },
          html`Create literal fragment for '${node.ch}': ${s} —'${node.ch}'→ ${e}<span class="step-sub">2 states, 1 transition · start: ${s}, accept: ${e}<br>Matches exactly one occurrence of symbol '${node.ch}'</span>`);
      }
      case 'eps': {
        const s = fresh(), e = fresh();
        return say('eps', { states: [s, e], trans: [{ from: s, sym: eps, to: e }], start: s, accept: e },
          html`Create epsilon fragment: ${s} —ε→ ${e}<span class="step-sub">2 states, 1 ε-transition · start: ${s}, accept: ${e}<br>Matches the empty string — no input consumed</span>`);
      }
      case 'empty': {
        const s = fresh(), e = fresh();
        return say('empty', { states: [s, e], trans: [], start: s, accept: e },
          html`Create empty fragment: ${s} and ${e}, unconnected<span class="step-sub">2 states, no transitions · start: ${s}, accept: ${e}<br>Matches nothing: the accept state cannot be reached</span>`);
      }
      case 'cat': {
        const L = build(node.l), R = build(node.r);
        const nfa = { states: [...L.states, ...R.states], trans: [...L.trans, { from: L.accept, sym: eps, to: R.start }, ...R.trans], start: L.start, accept: R.accept };
        return say('cat', nfa,
          html`Concatenation: chain two sub-fragments in sequence<span class="step-sub">Left fragment accept (${L.accept}) bridged via ε to right fragment start (${R.start})<br>Combined start: <em>${L.start}</em> · Combined accept: <em>${R.accept}</em><br>Result: ${counts(nfa)} — matches left then right</span>`);
      }
      case 'union': {
        const L = build(node.l), R = build(node.r), s = fresh(), e = fresh();
        const nfa = {
          states: [s, ...L.states, ...R.states, e],
          trans: [{ from: s, sym: eps, to: L.start }, { from: s, sym: eps, to: R.start }, ...L.trans, ...R.trans, { from: L.accept, sym: eps, to: e }, { from: R.accept, sym: eps, to: e }],
          start: s, accept: e
        };
        return say('union', nfa,
          html`Union (|): merge two sub-fragments<span class="step-sub">New start <em>${s}</em> forks via ε to left branch (${L.start}) and right branch (${R.start})<br>Both accept states (${L.accept}, ${R.accept}) converge via ε to new accept <em>${e}</em><br>Result: ${counts(nfa)} — matches either alternative</span>`);
      }
      case 'star': {
        const M = build(node.c), s = fresh(), e = fresh();
        const nfa = {
          states: [s, ...M.states, e],
          trans: [{ from: s, sym: eps, to: M.start }, { from: s, sym: eps, to: e }, { from: M.accept, sym: eps, to: M.start }, { from: M.accept, sym: eps, to: e }, ...M.trans],
          start: s, accept: e
        };
        return say('star', nfa,
          html`Kleene star (*): wrap sub-fragment with loop and bypass<span class="step-sub">New start <em>${s}</em> has two ε-paths: bypass to <em>${e}</em> (zero repetitions) or enter fragment at ${M.start}<br>Fragment accept ${M.accept} has ε-loop back to ${M.start} (repetition) and ε-exit to <em>${e}</em><br>Result: ${counts(nfa)} — matches zero or more repetitions</span>`);
      }
      default: {
        const plain = desugar(node);
        if (!plain) throw new Error('Unknown AST node: ' + node.t);
        return build(plain);
      }
    }
  }
  return build(ast);
}

// A symbol the parser cannot take as one character — a word, or a character
// outside the BMP, which it would split into two halves — stands in its text
// as a private-use character, one each.
const CODE_FIRST = 0xE000, CODE_LAST = 0xF8FF;

// Concatenation as written: the panel's ·, and the ⋅ and ∙ that LaTeX's \cdot
// and a word processor make of it.
const DOT = /[·⋅∙]/;

// What may follow a closing bracket as its quantifier, in the panel's notation.
const AFTER_CLOSE = /^(?:\*|\+|\?|\{\d+(?:,\d*)?\})/;

/**
 * The notation the app writes (the Language panel, `automata to-regex`) as the
 * parser reads it: · is concatenation, spaces are layout (the panel sets | and
 * its factors apart with them), the wildcard Σ is "any letter", and ∅ is the
 * empty language. `sigma`, when given, is what "any letter" ranges over;
 * without it `.` keeps its printable-ASCII range.
 *
 * The panel writes every concatenation with a ·, because a symbol can be a
 * whole word (citizenFilesComplaint·officerClaims). So a text with a · in it —
 * or read against a Σ with a word in it — is read the way the panel writes
 * it, `mode: 'words'`:
 *
 *   • ( ) | and the separators (spaces, ·) split it into runs, and a run is
 *     one symbol: 1·+·1 is three symbols, c++ is one;
 *   • a run is ε, Σ or ∅ only when that is all it is, so ε2 is a symbol;
 *   • a trailing * is a star, since the panel writes a single letter's star as
 *     a* — the only quantifier it ever puts after a symbol;
 *   • * + ? and {n,m} directly after a ) (spaces allowed, a · not) quantify
 *     the bracket: (a·b)+, (coin·push){2}. Anywhere else they are symbols.
 *
 * Otherwise it is the textbook notation, `mode: 'letters'`: one character to a
 * letter, so abb is three. Either way a symbol the parser cannot hold as one
 * character stands in `src` as a private-use one, and `symbolOf` turns a
 * symbol of the built NFA back into what was written.
 *
 * What the panel cannot write unambiguously, this cannot read: a symbol with a
 * space, a ·, a bracket or a | in it, one ending in *, and — with no · at all
 * — an expression whose symbols are words (coin | push reads as letters).
 * → { src, empty, mode, symbolOf }
 */
export function readWrittenRegex(text, { sigma = null } = {}) {
  const { eps, any } = App.config.sym;
  const raw = String(text);
  const codes = new Map(), named = new Map();
  const code = w => {
    if (!codes.has(w)) {
      const at = CODE_FIRST + codes.size;
      if (at > CODE_LAST) throw new Error(`More than ${CODE_LAST - CODE_FIRST + 1} different symbols`);
      const ch = String.fromCharCode(at);
      codes.set(w, ch);
      named.set(ch, w);
    }
    return codes.get(w);
  };
  const symbolOf = s => named.get(s) ?? s;
  const one = s => (s.length === 1 ? s : code(s));
  const anyLetter = sigma && sigma.length ? `(${sigma.map(one).join('|')})` : '.';

  if (!DOT.test(raw) && !(sigma || []).some(s => [...s].length > 1)) {
    let src = '', inClass = false;
    for (const c of raw.replace(/\s+/g, '')) {
      if (c === '[') inClass = true;
      if (c === ']') inClass = false;
      src += c === any || (c === '.' && !inClass) ? (inClass ? '.' : anyLetter) : one(c);
    }
    return { src, empty: src === '∅', mode: 'letters', symbolOf };
  }

  let src = '', run = '', afterClose = false;
  const flush = () => {
    if (!run) return;
    if (afterClose) {
      for (let m; (m = AFTER_CLOSE.exec(run));) { src += m[0]; run = run.slice(m[0].length); }
    }
    let stars = '';
    while (run.length > 1 && run.endsWith('*')) { stars += '*'; run = run.slice(0, -1); }
    if (run) src += run === eps || run === '∅' ? run : run === any ? anyLetter : code(run);
    src += stars;
    run = '';
    afterClose = false;
  };
  for (const c of raw) {
    if (c === '(' || c === ')' || c === '|') {
      flush();
      src += c;
      afterClose = c === ')';
    } else if (DOT.test(c)) {
      flush();
      afterClose = false;
    } else if (/\s/.test(c)) {
      flush();
    } else {
      run += c;
    }
  }
  flush();
  return { src, empty: src === '∅', mode: 'words', symbolOf };
}

export function thompsonBuild(re) {
  return buildThompson(parseRE(re));
}

/** The construction narrated: `{ nfa, steps }`. */
export function thompsonSteps(re) {
  const steps = [];
  const nfa = buildThompson(parseRE(re), steps);
  return { nfa, steps };
}
