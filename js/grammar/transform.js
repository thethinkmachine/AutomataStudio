import { generatingSet, nullableSet, reachableSet, unitClosure } from './analysis.js';
import { cloneGrammar, grammarOf, makeRule } from './model.js';

// ══════════════════════════════════════════════════════════════════
//  TRANSFORMS
// ══════════════════════════════════════════════════════════════════
//  Every transform is a pure function of a grammar model and answers
//  `{ grammar, stages, notes }` — never HTML, and never a partially applied
//  edit. `stages` is the worked construction, one entry per textbook step with
//  the grammar it left behind, which is what the view scrubs through and what
//  a test asserts on.
//
//  **A transform states what it assumed.** `notes` is where a precondition it
//  had to establish itself goes — GNF needs Chomsky normal form and left
//  recursion removal needs ε-rules gone, and silently doing either is how a
//  reader ends up with a correct answer to a question they did not ask.

const stage = (label, note, grammar) => ({ label, note, grammar: cloneGrammar(grammar) });

/** A name not already in use. `S` → `S₀`, then `S₀'`, `S₀''`, … */
function freshName(taken, base, mark = '₀') {
  let name = base + mark;
  while (taken.has(name)) name += "'";
  taken.add(name);
  return name;
}

// ── ε-productions ─────────────────────────────────────────────────

/**
 * Removes every A → ε, keeping the language identical: wherever a nullable
 * symbol occurs, the rule is repeated with that occurrence dropped, over
 * every subset of the nullable positions.
 *
 * The one ε that may survive is the start symbol's, because ε ∈ L(G) has to
 * stay expressible. When the start symbol also appears on a right-hand side
 * that is not enough — the surviving S → ε would then be usable *inside* a
 * derivation — so a fresh start is introduced first. That is the standard
 * START step and it is applied only when it is needed.
 */
export function removeEpsilon(g0) {
  const g = cloneGrammar(g0);
  const stages = [];
  const notes = [];
  const nullable = nullableSet(g);
  // Whether ε is in the language is a fact about the grammar as it arrived,
  // so it is read from the *original* start symbol. Testing the fresh one
  // instead is the whole of how a conversion loses the empty word: S₀ is not
  // in `nullable`, which was computed before S₀ existed.
  const epsInLanguage = nullable.has(g.start);

  const startOnRhs = g.rules.some(r => r.rhsArr.includes(g.start));
  if (epsInLanguage && startOnRhs) {
    const S0 = freshName(new Set(g.vars), g.start);
    g.rules = [makeRule([S0], [g.start]), ...g.rules];
    g.vars.add(S0);
    g.start = S0;
    notes.push(`The start symbol appeared on a right-hand side, so a fresh start <b>${S0} → ${g0.start}</b> was added first — otherwise the surviving ${S0} → ε could be used inside a derivation rather than only as the whole of one.`);
    stages.push(stage('New start symbol', `${S0} → ${g0.start}`, g));
  }

  stages.push(stage('Nullable variables',
    nullable.size ? `{ ${[...nullable].join(', ')} } derive ε.` : 'No variable derives ε — nothing to remove.', g));

  const out = [];
  const seen = new Set();
  const push = (lhsArr, rhsArr) => {
    const key = `${lhsArr.join(' ')} ${rhsArr.join(' ')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(makeRule(lhsArr, rhsArr));
  };

  g.rules.forEach(r => {
    if (r.rhsArr.length === 0) return;           // dropped; re-added below if allowed
    const spots = r.rhsArr.map((s, i) => (nullable.has(s) ? i : -1)).filter(i => i >= 0);
    // 2^k subsets of the nullable positions. Bounded in practice by the rule
    // length, which is why this is exhaustive rather than incremental.
    for (let mask = 0; mask < (1 << spots.length); mask++) {
      const kept = r.rhsArr.filter((s, i) => {
        const at = spots.indexOf(i);
        return at === -1 || !(mask & (1 << at));
      });
      if (kept.length) push(r.lhsArr, kept);
    }
  });

  if (epsInLanguage) {
    push([g.start], []);
    notes.push(`ε ∈ L(G), so <b>${g.start} → ε</b> is kept — it is the only ε-rule the language allows.`);
  }

  const result = grammarOf(out, g.start, g.vars);
  stages.push(stage('ε-rules removed',
    'Each rule is repeated with every combination of its nullable symbols omitted.', result));
  return { grammar: result, stages, notes };
}

// ── Unit productions ──────────────────────────────────────────────

/** Removes every A → B: A takes on the non-unit rules of everything it reaches. */
export function removeUnit(g0) {
  const g = cloneGrammar(g0);
  const stages = [];
  const closures = new Map();
  [...g.vars].forEach(A => closures.set(A, unitClosure(g, A)));

  const chains = [...closures.entries()].filter(([A, s]) => s.size > 1);
  stages.push(stage('Unit closures',
    chains.length
      ? chains.map(([A, s]) => `${A} ⇒* { ${[...s].join(', ')} }`).join(' · ')
      : 'No unit rules — nothing to remove.', g));

  const out = [];
  [...g.vars].forEach(A => {
    (closures.get(A) || new Set([A])).forEach(B => {
      g.rules.forEach(r => {
        if (r.lhsArr.length !== 1 || r.lhsArr[0] !== B) return;
        if (r.rhsArr.length === 1 && g.vars.has(r.rhsArr[0])) return;   // itself a unit rule
        out.push(makeRule([A], r.rhsArr));
      });
    });
  });
  // A rule whose left-hand side is not a single variable is not a unit rule
  // and is not this transform's to touch.
  g.rules.forEach(r => { if (r.lhsArr.length !== 1) out.push(makeRule(r.lhsArr, r.rhsArr)); });

  const result = grammarOf(out, g.start, g.vars);
  stages.push(stage('Unit rules removed',
    'Every A → B is replaced by A taking B’s own right-hand sides directly.', result));
  return { grammar: result, stages, notes: [] };
}

// ── Useless symbols ───────────────────────────────────────────────

/**
 * Non-generating symbols first, then unreachable ones — **in that order**.
 * Reversed, removing a non-generating variable can strand a symbol that was
 * reachable only through it, and the result still contains useless rules.
 */
export function removeUseless(g0) {
  const g = cloneGrammar(g0);
  const stages = [];
  const notes = [];

  const gen = generatingSet(g);
  const dead = [...g.vars].filter(v => !gen.has(v));
  let rules = g.rules.filter(r =>
    r.lhsArr.every(s => !g.vars.has(s) || gen.has(s))
    && r.rhsArr.every(s => !g.vars.has(s) || gen.has(s)));
  const afterGen = grammarOf(rules, g.start, [...g.vars].filter(v => gen.has(v)));
  stages.push(stage('Non-generating symbols removed',
    dead.length ? `{ ${dead.join(', ')} } derive no terminal string.` : 'Every variable derives some terminal string.',
    afterGen));

  const reach = reachableSet(afterGen);
  const unreachable = [...afterGen.vars].filter(v => !reach.has(v));
  rules = afterGen.rules.filter(r => r.lhsArr.every(s => reach.has(s)));
  const result = grammarOf(rules, afterGen.start, [...afterGen.vars].filter(v => reach.has(v)));
  stages.push(stage('Unreachable symbols removed',
    unreachable.length ? `{ ${unreachable.join(', ')} } cannot be reached from ${g.start}.` : `Every variable is reachable from ${g.start}.`,
    result));

  if (!result.rules.length) {
    notes.push('Nothing survived: the start symbol derives no terminal string, so L(G) = ∅.');
  }
  return { grammar: result, stages, notes };
}

// ── Chomsky normal form ───────────────────────────────────────────

/**
 * START → DEL → UNIT → TERM → BIN, which is Sipser's order. Every rule ends
 * up A → B C or A → a, with S → ε the single exception when ε ∈ L(G).
 */
export function toCNF(g0) {
  const stages = [];
  const notes = [];
  let g = cloneGrammar(g0);

  // START — unconditional here, unlike in ε-removal: the binarisation step
  // below forbids the start symbol on a right-hand side, so the fresh start
  // is a precondition of the *form* rather than of the ε rule.
  if (g.rules.some(r => r.rhsArr.includes(g.start)) || !g.start) {
    const S0 = freshName(new Set(g.vars), g.start || 'S');
    g.rules = [makeRule([S0], g.start ? [g.start] : []), ...g.rules];
    g.vars.add(S0);
    const old = g.start;
    g.start = S0;
    stages.push(stage('START', `Add ${S0} → ${old} so the start symbol never appears on a right-hand side.`, g));
  }

  const del = removeEpsilon(g);
  g = del.grammar;
  stages.push(stage('DEL', 'Remove ε-rules.', g));
  del.notes.forEach(n => notes.push(n));

  const unit = removeUnit(g);
  g = unit.grammar;
  stages.push(stage('UNIT', 'Remove unit rules A → B.', g));

  // TERM — a terminal may only stand alone. Anywhere else it is replaced by
  // a variable that derives it, one per terminal and reused.
  const termVar = new Map();
  const taken = new Set(g.vars);
  const withTerm = [];
  const varFor = t => {
    if (!termVar.has(t)) {
      const name = freshName(taken, 'T', '_' + t);
      termVar.set(t, name);
      withTerm.push(makeRule([name], [t]));
    }
    return termVar.get(t);
  };
  g.rules.forEach(r => {
    if (r.rhsArr.length < 2) { withTerm.push(makeRule(r.lhsArr, r.rhsArr)); return; }
    withTerm.push(makeRule(r.lhsArr, r.rhsArr.map(s => (g.vars.has(s) ? s : varFor(s)))));
  });
  g = grammarOf(withTerm, g.start, taken);
  stages.push(stage('TERM',
    termVar.size
      ? `Introduce ${[...termVar.entries()].map(([t, v]) => `${v} → ${t}`).join(', ')} so a terminal only ever stands alone.`
      : 'Every terminal already stands alone.', g));

  // BIN — a right-hand side longer than two is chained through fresh
  // variables, sharing a pair wherever it recurs.
  const binVar = new Map();
  const withBin = [];
  let n = 0;
  g.rules.forEach(r => {
    if (r.rhsArr.length <= 2) { withBin.push(makeRule(r.lhsArr, r.rhsArr)); return; }
    const syms = [...r.rhsArr];
    while (syms.length > 2) {
      const b = syms.pop();
      const a = syms.pop();
      const key = `${a} ${b}`;
      if (!binVar.has(key)) {
        const name = freshName(taken, 'X', '_' + (++n));
        binVar.set(key, name);
        withBin.push(makeRule([name], [a, b]));
      }
      syms.push(binVar.get(key));
    }
    withBin.push(makeRule(r.lhsArr, syms));
  });
  g = grammarOf(withBin, g.start, taken);
  stages.push(stage('BIN',
    binVar.size ? `Chain long right-hand sides through ${binVar.size} fresh variable${binVar.size === 1 ? '' : 's'}.`
      : 'No right-hand side was longer than two symbols.', g));

  return { grammar: g, stages, notes };
}

// ── Left recursion ────────────────────────────────────────────────

/**
 * A → A α  ⇒  A → β A', A' → α A' | ε, over one variable.
 *
 * `epsFree` writes the same rewrite without the ε: A → β | β A' and
 * A' → α | α A'. It is what GNF needs, since an ε-rule on a variable that is
 * not the start symbol is exactly what Greibach normal form forbids — the
 * ε form would leave the construction one rule short of its own definition.
 */
function removeDirect(rules, A, taken, epsFree = false) {
  const mine = rules.filter(r => r.lhsArr.length === 1 && r.lhsArr[0] === A);
  // A → A is left-recursive and also says nothing, and rewriting it would put
  // A' → A' in its place — an unproductive rule standing in for an
  // unproductive one. Drop it instead.
  const trivial = mine.filter(r => r.rhsArr.length === 1 && r.rhsArr[0] === A);
  const recursive = mine.filter(r => r.rhsArr[0] === A && !trivial.includes(r));
  if (!recursive.length) {
    return trivial.length ? { rules: rules.filter(r => !trivial.includes(r)), added: null } : { rules, added: null };
  }
  const rest = mine.filter(r => r.rhsArr[0] !== A);
  if (!rest.length) {
    // Every alternative is left-recursive, so A derives nothing at all and
    // there is no β to anchor the rewrite. Rewriting anyway would invent a
    // language; leaving it alone and saying so is the honest answer.
    return { rules, added: null, blocked: true };
  }
  const A2 = freshName(taken, A, "'");
  const out = rules.filter(r => !(r.lhsArr.length === 1 && r.lhsArr[0] === A));
  rest.forEach(r => {
    out.push(makeRule([A], [...r.rhsArr, A2]));
    if (epsFree) out.push(makeRule([A], [...r.rhsArr]));
  });
  recursive.forEach(r => {
    out.push(makeRule([A2], [...r.rhsArr.slice(1), A2]));
    if (epsFree) out.push(makeRule([A2], [...r.rhsArr.slice(1)]));
  });
  if (!epsFree) out.push(makeRule([A2], []));
  return { rules: out, added: A2 };
}

/**
 * Direct *and* indirect. The old tool did only the direct kind, which leaves
 * `A → B a, B → A b` exactly as left-recursive as it found it.
 *
 * The algorithm is the standard one: fix an order on the variables, and for
 * each Aᵢ substitute out every rule Aᵢ → Aⱼ γ with j < i before removing what
 * direct recursion that exposes. It needs no ε-rules and no unit cycles to be
 * sound, so those are established first and said out loud.
 */
export function removeLeftRecursion(g0) {
  const stages = [];
  const notes = [];
  let g = cloneGrammar(g0);

  if (g.rules.some(r => r.rhsArr.length === 0 && r.lhsArr[0] !== g.start)) {
    const cleaned = removeEpsilon(g);
    g = cleaned.grammar;
    notes.push('The grammar had ε-rules, which the substitution step is not sound over, so they were removed first.');
    stages.push(stage('ε-rules removed', 'A precondition of the substitution below.', g));
  }

  const order = [...g.vars];
  const taken = new Set(g.vars);
  const added = [];
  const blocked = [];
  let rules = g.rules.map(r => makeRule(r.lhsArr, r.rhsArr));

  for (let i = 0; i < order.length; i++) {
    const Ai = order[i];
    for (let j = 0; j < i; j++) {
      const Aj = order[j];
      const hits = rules.filter(r => r.lhsArr.length === 1 && r.lhsArr[0] === Ai && r.rhsArr[0] === Aj);
      if (!hits.length) continue;
      const jRules = rules.filter(r => r.lhsArr.length === 1 && r.lhsArr[0] === Aj);
      rules = rules.filter(r => !hits.includes(r));
      hits.forEach(h => jRules.forEach(jr => {
        rules.push(makeRule([Ai], [...jr.rhsArr, ...h.rhsArr.slice(1)]));
      }));
      stages.push(stage(`Substitute ${Aj} into ${Ai}`,
        `${Ai} → ${Aj} γ is replaced by ${Ai} → δ γ for every ${Aj} → δ, which turns indirect recursion through ${Aj} into direct recursion on ${Ai}.`,
        grammarOf(rules, g.start, taken)));
    }
    const step = removeDirect(rules, Ai, taken);
    if (step.blocked) {
      blocked.push(Ai);
      notes.push(`<b>${Ai}</b> was left alone: every one of its alternatives is left-recursive, so it derives nothing and there is no non-recursive alternative to anchor the rewrite on. Removing the recursion would change the language rather than preserve it.`);
      continue;
    }
    if (step.added) {
      rules = step.rules;
      added.push(step.added);
      stages.push(stage(`Direct recursion on ${Ai}`,
        `${Ai} → ${Ai} α becomes ${Ai} → β ${step.added} with ${step.added} → α ${step.added} | ε.`,
        grammarOf(rules, g.start, taken)));
    }
  }

  const result = grammarOf(rules, g.start, taken);
  if (!added.length && !blocked.length) {
    notes.push('The grammar was not left-recursive; nothing changed.');
  }
  return { grammar: result, stages, notes, added, blocked };
}

// ── Greibach normal form ──────────────────────────────────────────

/**
 * A real conversion. The old tool printed which rules already started with a
 * terminal and stopped, over a note calling itself a "simplified pedagogical
 * version" — so the one thing it was named for, it did not do.
 *
 * The construction, from Chomsky normal form (which is what makes the tail of
 * every rule a string of variables, so nothing has to be re-terminalised at
 * the end):
 *
 *   1. Order the variables A₁ … Aₙ.
 *   2. Forward pass. For i ascending and j < i, substitute out Aᵢ → Aⱼ γ,
 *      then remove the direct left recursion that exposes, introducing Aᵢ'.
 *      After this every Aᵢ → Aⱼ γ has j > i.
 *   3. Backward pass. For i descending, the rules of Aᵢ₊₁ … Aₙ already start
 *      with a terminal, so substituting them into Aᵢ finishes Aᵢ.
 *   4. The Aᵢ' introduced in step 2 have right-hand sides drawn from the
 *      original tails, so they are finished by one more substitution.
 */
export function toGNF(g0) {
  const stages = [];
  const notes = [];

  const cnf = toCNF(g0);
  let g = cnf.grammar;
  notes.push('Greibach normal form is built from Chomsky normal form, so the grammar was converted to CNF first — that is what leaves every rule’s tail a string of variables, with no terminal left to move.');
  stages.push(stage('Chomsky normal form', 'The starting point.', g));

  const order = [...g.vars];
  const taken = new Set(g.vars);
  const primes = [];
  let rules = g.rules.map(r => makeRule(r.lhsArr, r.rhsArr));

  const isVar = s => taken.has(s);
  const rulesOf = A => rules.filter(r => r.lhsArr.length === 1 && r.lhsArr[0] === A);

  // 2 — forward
  for (let i = 0; i < order.length; i++) {
    const Ai = order[i];
    for (let j = 0; j < i; j++) {
      const Aj = order[j];
      const hits = rulesOf(Ai).filter(r => r.rhsArr[0] === Aj);
      if (!hits.length) continue;
      const jRules = rulesOf(Aj);
      rules = rules.filter(r => !hits.includes(r));
      hits.forEach(h => jRules.forEach(jr => rules.push(makeRule([Ai], [...jr.rhsArr, ...h.rhsArr.slice(1)]))));
    }
    const step = removeDirect(rules, Ai, taken, true);
    if (step.added) { rules = step.rules; primes.push(step.added); }
  }
  stages.push(stage('Forward substitution',
    'Every Aᵢ → Aⱼ γ with j < i is substituted out and the direct left recursion it exposes is removed, so each variable now refers only forward.',
    grammarOf(rules, g.start, taken)));

  // 3 — backward
  for (let i = order.length - 2; i >= 0; i--) {
    const Ai = order[i];
    let again = true;
    let guard = 0;
    while (again && guard++ < order.length + 2) {
      again = false;
      const hits = rulesOf(Ai).filter(r => r.rhsArr.length && isVar(r.rhsArr[0]));
      if (!hits.length) break;
      hits.forEach(h => {
        const head = h.rhsArr[0];
        const donors = rulesOf(head).filter(r => r !== h);
        if (!donors.length) return;
        rules = rules.filter(r => r !== h);
        donors.forEach(d => rules.push(makeRule([Ai], [...d.rhsArr, ...h.rhsArr.slice(1)])));
        again = true;
      });
    }
  }
  stages.push(stage('Backward substitution',
    'Taken in descending order, every variable a rule starts with is already finished, so substituting it in finishes this one too.',
    grammarOf(rules, g.start, taken)));

  // 4 — the primes
  primes.forEach(P => {
    let again = true;
    let guard = 0;
    while (again && guard++ < order.length + 2) {
      again = false;
      const hits = rules.filter(r => r.lhsArr[0] === P && r.rhsArr.length && isVar(r.rhsArr[0]));
      hits.forEach(h => {
        const donors = rulesOf(h.rhsArr[0]).filter(r => r !== h);
        if (!donors.length) return;
        rules = rules.filter(r => r !== h);
        donors.forEach(d => rules.push(makeRule([P], [...d.rhsArr, ...h.rhsArr.slice(1)])));
        again = true;
      });
    }
  });
  if (primes.length) {
    stages.push(stage('Finish the introduced variables',
      `${primes.join(', ')} came out of the left-recursion removal and are finished the same way.`,
      grammarOf(rules, g.start, taken)));
  }

  // The terminal variables CNF introduced are mostly dead by now — a terminal
  // that only ever appeared at the head of a rule is written literally in GNF,
  // so its T_ variable is unreachable. Leaving them in would triple the size
  // of the answer with rules nothing can use.
  const pruned = removeUseless(grammarOf(rules, g.start, taken));
  if (pruned.grammar.rules.length && pruned.grammar.rules.length !== rules.length) {
    stages.push(stage('Prune',
      'The terminal variables CNF introduced are unreachable once the terminals are written literally.',
      pruned.grammar));
  }
  const result = pruned.grammar.rules.length ? pruned.grammar : grammarOf(rules, g.start, taken);
  return { grammar: result, stages, notes };
}

// ── Left factoring ────────────────────────────────────────────────

/**
 * A → α β | α γ  ⇒  A → α A', A' → β | γ, repeated until no two alternatives
 * of one variable share a first symbol. The companion to left-recursion
 * removal: together they are what an LL(1) grammar has to survive.
 */
export function leftFactor(g0) {
  const g = cloneGrammar(g0);
  const stages = [];
  const taken = new Set(g.vars);
  let rules = g.rules.map(r => makeRule(r.lhsArr, r.rhsArr));
  let factored = 0;
  let guard = 0;

  for (;;) {
    if (guard++ > 200) break;
    let hit = null;
    for (const A of [...taken]) {
      const mine = rules.filter(r => r.lhsArr.length === 1 && r.lhsArr[0] === A && r.rhsArr.length);
      const heads = new Map();
      mine.forEach(r => {
        const h = r.rhsArr[0];
        if (!heads.has(h)) heads.set(h, []);
        heads.get(h).push(r);
      });
      const group = [...heads.entries()].find(([, list]) => list.length > 1);
      if (group) { hit = { A, group: group[1] }; break; }
    }
    if (!hit) break;

    // The longest prefix every member of the group shares, not just the first
    // symbol — factoring one symbol at a time would introduce a fresh variable
    // per symbol of a common prefix.
    const group = hit.group;
    let k = 0;
    for (;;) {
      const sym = group[0].rhsArr[k];
      if (sym === undefined) break;
      if (!group.every(r => r.rhsArr[k] === sym)) break;
      k++;
    }
    const prefix = group[0].rhsArr.slice(0, k);
    const A2 = freshName(taken, hit.A, "'");
    rules = rules.filter(r => !group.includes(r));
    rules.push(makeRule([hit.A], [...prefix, A2]));
    group.forEach(r => rules.push(makeRule([A2], r.rhsArr.slice(k))));
    factored++;
    stages.push(stage(`Factor ${prefix.join(' ')} out of ${hit.A}`,
      `${group.length} alternatives shared the prefix <b>${prefix.join(' ')}</b>; the tails move to ${A2}.`,
      grammarOf(rules, g.start, taken)));
  }

  const result = grammarOf(rules, g.start, taken);
  return {
    grammar: result, stages,
    notes: factored ? [] : ['No two alternatives of any variable share a first symbol; the grammar is already left-factored.']
  };
}
