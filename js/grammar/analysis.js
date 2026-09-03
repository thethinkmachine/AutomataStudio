import { eps, isContextFree, rulesFor, terminalsOf } from './model.js';

// ══════════════════════════════════════════════════════════════════
//  ANALYSIS
// ══════════════════════════════════════════════════════════════════
//  Everything here is a pure function of a grammar model. No DOM, no `App`
//  beyond the ε symbol, and no HTML — which is what lets the whole workbench
//  be tested by comparing sets rather than by matching against printed
//  markup, the only thing the old grammar view's tests could do.
//
//  The fixed-point loops all share one shape: start from what is certainly
//  true, apply every rule, repeat until nothing changes. Each terminates
//  because each round adds at least one symbol to a finite set.

/** Variables that derive the empty string. */
export function nullableSet(g) {
  const nullable = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    g.rules.forEach(r => {
      if (r.lhsArr.length !== 1) return;
      const A = r.lhsArr[0];
      if (nullable.has(A)) return;
      if (r.rhsArr.every(s => nullable.has(s))) { nullable.add(A); changed = true; }
    });
  }
  return nullable;
}

/**
 * Variables that derive *some* terminal string. Seeded with the terminals
 * themselves, because a rule is generating exactly when everything on its
 * right-hand side is.
 */
export function generatingSet(g) {
  const gen = new Set(terminalsOf(g));
  let changed = true;
  while (changed) {
    changed = false;
    g.rules.forEach(r => {
      if (r.lhsArr.length !== 1) return;
      const A = r.lhsArr[0];
      if (gen.has(A)) return;
      if (r.rhsArr.every(s => gen.has(s))) { gen.add(A); changed = true; }
    });
  }
  return new Set([...gen].filter(s => g.vars.has(s)));
}

/** Symbols reachable from the start symbol, variables and terminals alike. */
export function reachableSet(g) {
  const reach = new Set(g.start ? [g.start] : []);
  let changed = true;
  while (changed) {
    changed = false;
    g.rules.forEach(r => {
      if (!r.lhsArr.every(s => reach.has(s) || !g.vars.has(s))) return;
      if (!r.lhsArr.some(s => reach.has(s))) return;
      r.rhsArr.forEach(s => { if (!reach.has(s)) { reach.add(s); changed = true; } });
    });
  }
  return reach;
}

/** A ⇒* B through unit rules only, including A itself. */
export function unitClosure(g, A) {
  const reach = new Set([A]);
  let changed = true;
  while (changed) {
    changed = false;
    g.rules.forEach(r => {
      if (r.lhsArr.length !== 1 || !reach.has(r.lhsArr[0])) return;
      if (r.rhsArr.length !== 1) return;
      const B = r.rhsArr[0];
      if (g.vars.has(B) && !reach.has(B)) { reach.add(B); changed = true; }
    });
  }
  return reach;
}

// ── FIRST and FOLLOW ──────────────────────────────────────────────
//  ε is a member of a FIRST set, never of a FOLLOW set. FOLLOW carries the
//  end marker `$` instead, which is the convention every LL(1) table is built
//  against and the reason the two are computed together rather than shared.

export const END = '$';

/** FIRST of a sequence, given FIRST over the variables. */
export function firstOfSeq(seq, first, g) {
  const E = eps();
  const out = new Set();
  for (const sym of seq) {
    if (!g.vars.has(sym)) { out.add(sym); return { set: out, nullable: false }; }
    const f = first[sym] || new Set();
    f.forEach(x => { if (x !== E) out.add(x); });
    if (!f.has(E)) return { set: out, nullable: false };
  }
  return { set: out, nullable: true };
}

export function firstSets(g) {
  const E = eps();
  const first = {};
  g.vars.forEach(v => { first[v] = new Set(); });
  let changed = true;
  while (changed) {
    changed = false;
    g.rules.forEach(r => {
      if (r.lhsArr.length !== 1) return;
      const A = r.lhsArr[0];
      if (!first[A]) first[A] = new Set();
      const before = first[A].size;
      const { set, nullable } = firstOfSeq(r.rhsArr, first, g);
      set.forEach(x => first[A].add(x));
      if (nullable) first[A].add(E);
      if (first[A].size !== before) changed = true;
    });
  }
  return first;
}

export function followSets(g, first = firstSets(g)) {
  const follow = {};
  g.vars.forEach(v => { follow[v] = new Set(); });
  if (g.start && follow[g.start]) follow[g.start].add(END);

  let changed = true;
  while (changed) {
    changed = false;
    g.rules.forEach(r => {
      if (r.lhsArr.length !== 1) return;
      const A = r.lhsArr[0];
      r.rhsArr.forEach((B, i) => {
        if (!g.vars.has(B)) return;
        if (!follow[B]) follow[B] = new Set();
        const before = follow[B].size;
        const rest = firstOfSeq(r.rhsArr.slice(i + 1), first, g);
        rest.set.forEach(x => follow[B].add(x));
        if (rest.nullable) (follow[A] || new Set()).forEach(x => follow[B].add(x));
        if (follow[B].size !== before) changed = true;
      });
    });
  }
  return follow;
}

// ── Left recursion ────────────────────────────────────────────────

/**
 * A -> B when some rule A → α B γ has α entirely nullable, so B can be the
 * leftmost symbol of a sentential form A derives. A cycle in that graph is
 * left recursion; a self-loop is the direct kind.
 */
export function leftGraph(g, nullable = nullableSet(g)) {
  const edges = new Map();
  g.vars.forEach(v => edges.set(v, new Set()));
  g.rules.forEach(r => {
    if (r.lhsArr.length !== 1) return;
    const A = r.lhsArr[0];
    if (!edges.has(A)) edges.set(A, new Set());
    for (const sym of r.rhsArr) {
      if (g.vars.has(sym)) edges.get(A).add(sym);
      if (!nullable.has(sym)) break;
    }
  });
  return edges;
}

/**
 * Every cycle found, shortest first: [[A, B, A], …]. Empty when there is none.
 *
 * Cycles are keyed by their *set* of variables rather than by the path, so the
 * two rotations of one cycle are reported once. A grey node on the stack is a
 * cycle; a black one is finished and cannot be on any further path, which is
 * what keeps this linear rather than re-walking every predecessor.
 */
export function leftRecursionCycles(g) {
  const edges = leftGraph(g);
  const cycles = [];
  const seen = new Set();
  const colour = new Map();   // undefined = white, 1 = on stack, 2 = done
  const path = [];

  function walk(v) {
    colour.set(v, 1);
    path.push(v);
    for (const w of edges.get(v) || []) {
      if (colour.get(w) === 1) {
        const cycle = path.slice(path.indexOf(w)).concat(w);
        const key = [...new Set(cycle)].sort().join(',');
        if (!seen.has(key)) { seen.add(key); cycles.push(cycle); }
      } else if (!colour.has(w)) {
        walk(w);
      }
    }
    path.pop();
    colour.set(v, 2);
  }
  [...g.vars].forEach(v => { if (!colour.has(v)) walk(v); });
  return cycles.sort((a, b) => a.length - b.length);
}

/** Variables A with a rule A → A γ. */
export function directLeftRecursive(g) {
  return new Set(g.rules
    .filter(r => r.lhsArr.length === 1 && r.rhsArr[0] === r.lhsArr[0])
    .map(r => r.lhsArr[0]));
}

// ── Cycles that make a language infinite ──────────────────────────

/**
 * A ⇒+ α A β with αβ ≠ ε, restricted to symbols that are both generating and
 * reachable. That is exactly the pumping condition, so it is the finiteness
 * test as well as the cyclicity one.
 */
export function usefulCycle(g) {
  const gen = generatingSet(g);
  const reach = reachableSet(g);
  const live = v => gen.has(v) && reach.has(v);
  const edges = new Map();
  [...g.vars].filter(live).forEach(v => edges.set(v, new Set()));
  g.rules.forEach(r => {
    if (r.lhsArr.length !== 1) return;
    const A = r.lhsArr[0];
    if (!live(A)) return;
    if (!r.rhsArr.every(s => gen.has(s) || !g.vars.has(s))) return;
    r.rhsArr.forEach(s => { if (g.vars.has(s) && live(s)) edges.get(A).add(s); });
  });

  const colour = new Map();
  const stack = [];
  let found = null;
  function walk(v) {
    if (found) return;
    colour.set(v, 1);
    stack.push(v);
    for (const w of edges.get(v) || []) {
      if (found) break;
      if (colour.get(w) === 1) { found = stack.slice(stack.indexOf(w)).concat(w); break; }
      if (!colour.has(w)) walk(w);
    }
    stack.pop();
    if (!found) colour.set(v, 2);
  }
  [...edges.keys()].forEach(v => { if (!colour.has(v) && !found) walk(v); });
  return found;
}

// ── Chomsky classification ────────────────────────────────────────
//  The old classifier collapsed Type 0 and Type 1 into one bucket and never
//  tested the non-contracting condition, so a genuinely context-sensitive
//  grammar and an unrestricted one were reported identically. Each class is
//  now its own predicate, and the rule that *blocks* the next class up is
//  named — "not regular" with no reason is not a classification.

const linearShape = (r, g, side) => {
  const vars = r.rhsArr.map((s, i) => (g.vars.has(s) ? i : -1)).filter(i => i >= 0);
  if (vars.length === 0) return true;
  if (vars.length > 1) return false;
  return side === 'right' ? vars[0] === r.rhsArr.length - 1 : vars[0] === 0;
};

export function classify(g) {
  const startOnRhs = g.rules.some(r => r.rhsArr.includes(g.start));
  const contextFree = isContextFree(g);

  // Type 1: |α| ≤ |β| everywhere, with S → ε allowed as long as S never
  // appears on a right-hand side — the standard exception that lets a
  // context-sensitive language contain the empty word.
  const contracting = g.rules.filter(r => {
    if (r.rhsArr.length >= r.lhsArr.length) return false;
    return !(r.rhsArr.length === 0 && r.lhsArr.length === 1
      && r.lhsArr[0] === g.start && !startOnRhs);
  });

  const notCF = g.rules.filter(r => !(r.lhsArr.length === 1 && g.vars.has(r.lhsArr[0])));
  const notRight = contextFree ? g.rules.filter(r => !linearShape(r, g, 'right')) : g.rules;
  const notLeft = contextFree ? g.rules.filter(r => !linearShape(r, g, 'left')) : g.rules;

  const rightLinear = contextFree && notRight.length === 0;
  const leftLinear = contextFree && notLeft.length === 0;
  const regular = rightLinear || leftLinear;

  let type;
  if (regular) type = 3;
  else if (contextFree) type = 2;
  else if (contracting.length === 0) type = 1;
  else type = 0;

  return {
    type, regular, rightLinear, leftLinear, contextFree,
    nonContracting: contracting.length === 0,
    // The first rule that stops the grammar climbing one class higher.
    blockers: {
      regular: regular ? null : (notRight[0] && notLeft[0] ? (notRight[0] === notLeft[0] ? notRight[0] : notRight[0]) : null),
      contextFree: contextFree ? null : notCF[0] || null,
      contextSensitive: contracting.length === 0 ? null : contracting[0] || null
    }
  };
}

// ── Normal-form membership ────────────────────────────────────────

/** A → B C with B, C variables and neither the start symbol, or A → a; plus S → ε. */
export function cnfViolations(g) {
  return g.rules.filter(r => {
    if (r.lhsArr.length !== 1 || !g.vars.has(r.lhsArr[0])) return true;
    if (r.rhsArr.length === 0) return r.lhsArr[0] !== g.start;
    if (r.rhsArr.length === 1) return g.vars.has(r.rhsArr[0]);
    if (r.rhsArr.length === 2) {
      return !r.rhsArr.every(s => g.vars.has(s) && s !== g.start);
    }
    return true;
  });
}

/** A → a α with a terminal and α a (possibly empty) string of variables. */
export function gnfViolations(g) {
  return g.rules.filter(r => {
    if (r.lhsArr.length !== 1 || !g.vars.has(r.lhsArr[0])) return true;
    if (r.rhsArr.length === 0) return r.lhsArr[0] !== g.start;
    if (g.vars.has(r.rhsArr[0])) return true;
    return !r.rhsArr.slice(1).every(s => g.vars.has(s));
  });
}

// ── The Overview's property strip ─────────────────────────────────
//  One pass over everything the landing page asserts, so the card and the
//  tool it links to cannot disagree about whether the grammar has ε-rules.

export function properties(g) {
  const E = eps();
  const nullable = nullableSet(g);
  const gen = generatingSet(g);
  const reach = reachableSet(g);
  const cls = classify(g);
  const cycles = leftRecursionCycles(g);

  const epsRules = g.rules.filter(r => r.rhsArr.length === 0);
  const unitRules = g.rules.filter(r =>
    r.lhsArr.length === 1 && r.rhsArr.length === 1 && g.vars.has(r.rhsArr[0]));
  const nonGenerating = [...g.vars].filter(v => !gen.has(v));
  const unreachable = [...g.vars].filter(v => !reach.has(v));

  return {
    eps: E,
    nullable, generating: gen, reachable: reach,
    classify: cls,
    epsRules, unitRules, nonGenerating, unreachable,
    leftRecursion: cycles,
    directLeftRecursion: directLeftRecursive(g),
    cnf: cnfViolations(g),
    gnf: gnfViolations(g),
    empty: !g.start || !gen.has(g.start),
    infinite: !!usefulCycle(g),
    derivesEmpty: nullable.has(g.start),
    terminals: terminalsOf(g),
    ruleCount: g.rules.length,
    varCount: g.vars.size
  };
}

/** Rules whose left-hand side has no definition at all — never possible from
 *  the parser (an LHS defines its own variable) but reachable from a `.json`
 *  that names a start symbol nothing derives. */
export function undefinedVars(g) {
  return [...g.vars].filter(v => rulesFor(g, v).length === 0);
}
