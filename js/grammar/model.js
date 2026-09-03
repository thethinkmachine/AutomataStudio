import { $, App } from '../state.js';
import { DEFAULT_EPS, deriveVars, formatRules, parseGrammarText, tokenizeSymbols } from './parse.js';

// ══════════════════════════════════════════════════════════════════
//  THE GRAMMAR MODEL
// ══════════════════════════════════════════════════════════════════
//  A grammar is `{ vars: Set, start, rules: [rule] }` where a rule is
//  `{ id, lhs, lhsArr, rhs, rhsArr }`. Everything above this module — every
//  analysis, every transform, every tool — takes and returns that object and
//  touches `App` nowhere. This module is the only seam between the two.
//
//  **The persisted shape is unchanged.** `App.grammar` is still
//  `{ vars: ReactiveSet, start, productions: [{lhs, rhs, rhsArr}] }`, which is
//  what `getWorkspaceData`, `exportWorkspaceState`, the share link and the
//  undo stack all carry. A rule is a superset of a production, so reading is
//  a normalization and writing is a projection — no save-format migration,
//  and a file written by an older build opens unchanged.
//
//  `App.grammar.vars` is a ReactiveSet installed by a coercing accessor in
//  state.js, so `writeGrammar` assigns a plain Set and the field keeps
//  notifying. That is the documented contract there; do not reach past it.

/** ε as the reader has it configured. Read live — Settings can change it. */
export const eps = () => App.config?.sym?.eps || DEFAULT_EPS;

export function emptyGrammar() {
  return { vars: new Set(), start: '', rules: [] };
}

export function cloneGrammar(g) {
  return {
    vars: new Set(g.vars),
    start: g.start,
    rules: g.rules.map(r => ({ ...r, lhsArr: [...r.lhsArr], rhsArr: [...r.rhsArr] }))
  };
}

/**
 * Builds a rule from token arrays, which is how every transform makes one:
 * the display strings are derived so the two halves cannot disagree.
 */
export function makeRule(lhsArr, rhsArr, id) {
  const L = Array.isArray(lhsArr) ? lhsArr : [lhsArr];
  const R = Array.isArray(rhsArr) ? rhsArr : [rhsArr];
  return {
    id: id || 'r' + (++ruleN),
    lhs: L.join(' '),
    lhsArr: L,
    rhs: R.length ? R.join(' ') : eps(),
    rhsArr: R
  };
}
let ruleN = 0;

/** Rules with duplicates removed, ids renumbered — every transform ends here. */
export function grammarOf(rules, start, extraVars = []) {
  const vars = new Set(extraVars);
  rules.forEach(r => r.lhsArr.forEach(s => vars.add(s)));
  const seen = new Set();
  const out = [];
  rules.forEach(r => {
    const key = `${r.lhsArr.join(' ')} ${r.rhsArr.join(' ')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(makeRule(r.lhsArr, r.rhsArr, 'r' + (out.length + 1)));
  });
  return { vars, start, rules: out };
}

// ── Derived facts ─────────────────────────────────────────────────

/** Σ(G): every symbol a right-hand side uses that no rule defines. */
export function terminalsOf(g) {
  const t = new Set();
  g.rules.forEach(r => r.rhsArr.forEach(s => { if (!g.vars.has(s)) t.add(s); }));
  return t;
}

/**
 * The alphabet a word typed into this view is read against. Σ from the canvas
 * is unioned in, because the two views share a workspace and a reader who set
 * Σ there should not have to retype it — the same reasoning `renderGramSyms`
 * had. `terminalsOf` is the grammar's own answer and is what the tuple prints.
 */
export function grammarTerminals(g = readGrammar()) {
  const t = terminalsOf(g);
  [...App.sigma].forEach(s => t.add(s));
  return t;
}

export function rulesFor(g, lhs) {
  return g.rules.filter(r => r.lhsArr.length === 1 && r.lhsArr[0] === lhs);
}

/** Grouped for display: [[lhs, [rule]]], start symbol first. */
export function byLhs(g) {
  const map = new Map();
  g.rules.forEach(r => {
    if (!map.has(r.lhs)) map.set(r.lhs, []);
    map.get(r.lhs).push(r);
  });
  const keys = [...map.keys()];
  return [...keys.filter(k => k === g.start), ...keys.filter(k => k !== g.start)]
    .map(k => [k, map.get(k)]);
}

/** Every left-hand side is a single variable — the Type 2 shape. */
export function isContextFree(g) {
  return g.rules.every(r => r.lhsArr.length === 1 && g.vars.has(r.lhsArr[0]));
}

/**
 * Changes when the grammar changes and at no other time. Used to key the
 * derived panels, the same job `_regexCacheKey()` does for the Language panel
 * — and, for the same reason, it is deliberately not memoised: it exists to
 * notice edits nobody announced.
 */
export function grammarSignature(g) {
  return `${g.start}|${[...g.vars].sort().join(',')}|`
    + g.rules.map(r => `${r.lhsArr.join(' ')}>${r.rhsArr.join(' ')}`).sort().join(';');
}

export function grammarText(g) {
  return formatRules(g.rules, g.start, eps());
}

// ── The App seam ──────────────────────────────────────────────────

/**
 * `App.grammar` -> the model. A stored production may predate the current
 * tokenizer (or any tokenizer — legacy files carry `{lhs, rhs}` and nothing
 * else), so its right-hand side is re-read against the *declared* variable
 * set rather than against one inferred from the rules. That is what keeps a
 * grammar built directly on `App.grammar` — a `.json`, an undo entry, a test
 * — meaning what it said it meant.
 */
export function readGrammar() {
  const src = App.grammar || {};
  const prods = Array.isArray(src.productions) ? src.productions : [];
  // The vocabulary a stored rule is read against: the declared variables plus
  // every single-symbol left-hand side. A left-hand side *with* whitespace is
  // several symbols and is deliberately not added — adding it would put a
  // variable literally named "A B" into V.
  const declared = new Set([...(src.vars || [])].filter(v => !/\s/.test(v)));
  prods.forEach(p => {
    if (typeof p?.lhs === 'string' && p.lhs && !/\s/.test(p.lhs)) declared.add(p.lhs);
  });

  const rules = [];
  prods.forEach((p, i) => {
    const lhsRaw = typeof p?.lhs === 'string' ? p.lhs : '';
    if (!lhsRaw) return;
    // A left-hand side with whitespace is several symbols — the Type 1 shape —
    // and is not in `declared`, so it goes through the tokenizer. Treating it
    // as one symbol would quietly make a context-sensitive grammar look
    // context-free.
    const lhsArr = declared.has(lhsRaw) ? [lhsRaw] : tokenizeSymbols(lhsRaw, declared);
    const rhsRaw = typeof p?.rhs === 'string' ? p.rhs : eps();
    const rhsArr = Array.isArray(p?.rhsArr)
      ? p.rhsArr.filter(s => s !== eps())
      : (rhsRaw === eps() ? [] : tokenizeSymbols(rhsRaw, declared));
    rules.push(makeRule(lhsArr.length ? lhsArr : [lhsRaw], rhsArr, p.id || 'r' + (i + 1)));
  });

  // `deriveVars` rather than "every left-hand symbol", or a context-sensitive
  // grammar reloads with its terminals in V — and `readGrammar` runs on every
  // render, so that answer, not the parser's, is what the view would show.
  const { vars } = deriveVars(rules.map(r => r.lhsArr), declared);
  const start = src.start || (rules.length ? rules[0].lhsArr[0] : '');
  return { vars, start, rules };
}

/**
 * The model -> `App.grammar`, in the persisted shape. `vars` is assigned a
 * plain Set on purpose: state.js's coercing accessor upgrades it, and going
 * around that would install a field that stops notifying with no error
 * anywhere.
 */
export function writeGrammar(g) {
  App.grammar.vars = new Set(g.vars);
  App.grammar.start = g.start;
  App.grammar.productions = g.rules.map(r => ({
    id: r.id,
    lhs: r.lhs,
    rhs: r.rhsArr.length ? r.rhsArr.join(' ') : eps(),
    rhsArr: [...r.rhsArr]
  }));
}

/** Text -> the model, with the diagnostics the editor prints. */
export function grammarFromText(text) {
  const parsed = parseGrammarText(text, { eps: eps() });
  return {
    grammar: { vars: parsed.vars, start: parsed.start, rules: parsed.rules },
    diagnostics: parsed.diagnostics
  };
}

/**
 * The word the reader typed, as tokens over this grammar's alphabet, or null
 * when it uses a symbol the grammar has never heard of. Answering null rather
 * than splitting into characters is what lets a tool say *which* symbol was
 * unknown instead of silently deciding a different word.
 */
export function tokenizeWord(raw, g) {
  const s = String(raw == null ? '' : raw).trim();
  // `raw` rides along so a tool can tell "nothing was typed" from "ε was
  // typed" — the two mean different things to a parse trace, and tokens alone
  // cannot distinguish them.
  if (!s || s === eps() || s.toLowerCase() === 'eps' || s.toLowerCase() === 'epsilon') {
    return { ok: true, raw: s, tokens: [] };
  }
  const alphabet = grammarTerminals(g);
  const tokens = tokenizeSymbols(s, alphabet);
  const bad = tokens.find(t => !alphabet.has(t));
  // No `tokens` on the failure, deliberately: a caller that forgets to check
  // `ok` should fail loudly rather than quietly answer about the empty word.
  // `needs: { word: true }` is what states the check, and js/grammar-ui.js's
  // `unmet` is where it is made.
  if (bad) return { ok: false, raw: s, error: bad };
  return { ok: true, raw: s, tokens };
}

/** The textarea, when the view is mounted. Kept here so tools never touch it. */
export const grammarSourceEl = () => $('gram-source');
