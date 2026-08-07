// Guards over a FINITE domain, and the reason that qualifier is the whole story.
//
// "Fire this arrow only if the alarm is raised" is the thing every real state
// machine grows next, and it is also the fastest way to leave the regular
// languages without noticing. A guard over an integer — `health < 20` — is an
// infinite-state system; two of them is a two-counter machine, which is
// Turing-complete. That is not an extension of a statechart, it is a different
// model wearing the same picture.
//
// So the variables here are BOOLEAN FLAGS, a fixed finite set declared up front.
// The machine is then state x valuation: still finite, still regular, and
// exponentially more succinct than writing the valuations out as states. That
// product is exactly what flattening builds, and the 2^n it costs is the
// succinctness claim stated as a number.
//
// When someone genuinely needs to count, the honest answer is that they have
// left the class — and this app already has Counter and NPDA waiting for them.
//
// No eval(). The grammar is four lines and a recursive-descent parser is shorter
// than the argument for why eval on user input would be fine.

const TOKEN = /\s*(\|\||&&|[!()]|[A-Za-z_][A-Za-z0-9_]*|=|,)/y;

function lex(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(src);
    if (!m) {
      if (!src.slice(i).trim()) break;
      throw new Error(`unexpected "${src.slice(i).trim()[0]}"`);
    }
    out.push(m[1]);
    i = TOKEN.lastIndex;
  }
  return out;
}

/**
 * expr := or ;  or := and ('||' and)* ;  and := not ('&&' not)*
 * not  := '!' not | atom ;  atom := '(' expr ')' | ident | true | false
 *
 * @returns {object} AST — {k:'lit'|'ref'|'not'|'and'|'or', ...}
 */
export function parseGuard(src) {
  const s = (src || '').trim();
  if (!s) return null;
  const toks = lex(s);
  let p = 0;
  const peek = () => toks[p];
  const eat = t => { if (toks[p] !== t) throw new Error(`expected "${t}"`); p++; };

  const atom = () => {
    const t = peek();
    if (t === undefined) throw new Error('unexpected end of guard');
    if (t === '(') { p++; const e = or(); eat(')'); return e; }
    if (t === '!') { p++; return { k: 'not', a: atom() }; }
    if (t === 'true' || t === 'false') { p++; return { k: 'lit', v: t === 'true' }; }
    if (/^[A-Za-z_]/.test(t)) { p++; return { k: 'ref', name: t }; }
    throw new Error(`unexpected "${t}"`);
  };
  const and = () => {
    let e = atom();
    while (peek() === '&&') { p++; e = { k: 'and', a: e, b: atom() }; }
    return e;
  };
  const or = () => {
    let e = and();
    while (peek() === '||') { p++; e = { k: 'or', a: e, b: and() }; }
    return e;
  };

  const ast = or();
  if (p !== toks.length) throw new Error(`unexpected "${toks[p]}"`);
  return ast;
}

export function evalGuard(ast, vals) {
  if (!ast) return true;
  switch (ast.k) {
    case 'lit': return ast.v;
    // An undeclared flag reads false rather than throwing: a guard naming a flag
    // that was just deleted should disable its arrow, not break the whole run.
    case 'ref': return !!vals[ast.name];
    case 'not': return !evalGuard(ast.a, vals);
    case 'and': return evalGuard(ast.a, vals) && evalGuard(ast.b, vals);
    case 'or': return evalGuard(ast.a, vals) || evalGuard(ast.b, vals);
    default: return true;
  }
}

export function guardRefs(ast, out = new Set()) {
  if (!ast) return out;
  if (ast.k === 'ref') out.add(ast.name);
  if (ast.a) guardRefs(ast.a, out);
  if (ast.b) guardRefs(ast.b, out);
  return out;
}

/**
 * `armed = true, alert = false` — with `armed` and `!armed` as the obvious
 * shorthands, because that is how everyone writes it the second time.
 *
 * @returns {Array<{flag: string, value: boolean}>}
 */
export function parseAssign(src) {
  const s = (src || '').trim();
  if (!s) return [];
  return s.split(',').map(part => part.trim()).filter(Boolean).map(part => {
    const eq = part.indexOf('=');
    if (eq < 0) {
      const neg = part.startsWith('!');
      const name = (neg ? part.slice(1) : part).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`bad assignment "${part}"`);
      return { flag: name, value: !neg };
    }
    const name = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`bad assignment "${part}"`);
    if (val !== 'true' && val !== 'false') throw new Error(`"${name}" must be set to true or false`);
    return { flag: name, value: val === 'true' };
  });
}

// A one-line report for the transition dialog and the validator, so a typo says
// so at the point it is made rather than silently disabling an arrow forever.
export function checkGuardSyntax(guard, assign) {
  try { parseGuard(guard); } catch (e) { return `Guard: ${e.message}`; }
  try { parseAssign(assign); } catch (e) { return `Assign: ${e.message}`; }
  return null;
}

export function hasGuardsAnywhere(transitions = []) {
  return transitions.some(t => t && (t.guard || t.assign));
}

/**
 * Every flag any arrow mentions, so the declared set can be reconciled with the
 * used set — a guard naming a flag nobody declared is a typo, and a flag nobody
 * uses is 2x the flat state count for nothing.
 */
export function flagsUsed(transitions = []) {
  const out = new Set();
  for (const t of transitions) {
    try { guardRefs(parseGuard(t.guard), out); } catch (e) { /* reported elsewhere */ }
    try { for (const a of parseAssign(t.assign)) out.add(a.flag); } catch (e) { /* ditto */ }
  }
  return out;
}

export function validateGuards(transitions = [], declared = []) {
  const issues = [];
  const known = new Set(declared);
  for (const t of transitions) {
    const err = checkGuardSyntax(t.guard, t.assign);
    if (err) issues.push({ level: 'error', transition: t.id, message: `${err} on '${t.symbol}'` });
  }
  for (const f of flagsUsed(transitions)) {
    if (!known.has(f)) {
      issues.push({ level: 'error', message: `Flag '${f}' is used but never declared, so it reads false everywhere` });
    }
  }
  for (const f of declared) {
    if (!flagsUsed(transitions).has(f)) {
      issues.push({ level: 'warn', message: `Flag '${f}' is declared but never used — it doubles the flattened machine for nothing` });
    }
  }
  return issues;
}

// Canonical valuation key. Sorted so two routes to the same valuation produce
// the same flat state instead of two copies of it.
export function valsKey(vals, flags) {
  return flags.map(f => (vals[f] ? '1' : '0')).join('');
}
