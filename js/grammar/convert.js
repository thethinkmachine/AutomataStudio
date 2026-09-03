import { App, getState } from '../state.js';
import { classify } from './analysis.js';
import { eps, grammarOf, makeRule, terminalsOf } from './model.js';

// ══════════════════════════════════════════════════════════════════
//  CONVERSIONS
// ══════════════════════════════════════════════════════════════════
//  Grammars in one direction, machines in the other. Every function here is
//  DOM-free: it answers a machine *description* — states, transitions, a
//  start and an accept set — and js/grammar-ui.js is what puts one on the
//  canvas. That is the same split `algorithms-fa.js` documents (`build*`
//  computes, `load*Result` applies) and it is what makes a construction
//  assertable without a canvas.
//
//  Reading `App` is confined to the two directions that genuinely start from
//  the machine on it.

const Z = () => App.config.sym.stackBottom;

// ── CFG → NPDA ────────────────────────────────────────────────────

/**
 * Both standard constructions, over one state machine each.
 *
 * **Top-down** is the leftmost derivation made mechanical: the stack holds
 * the unexpanded tail of a sentential form, a variable on top is replaced by
 * the right-hand side of some rule, and a terminal on top must match the next
 * input symbol. An accepting run *is* a leftmost derivation.
 *
 * **Bottom-up** is shift-reduce: input symbols are pushed, and a right-hand
 * side sitting on the stack is popped and replaced by its left-hand side.
 * Because a PDA move pops one symbol, a reduction of k symbols needs k−1
 * intermediate states, which is why this construction is bigger than it
 * looks on paper.
 */
export function cfgToPda(g, mode = 'topdown') {
  const E = eps();
  const bottom = Z();
  const states = new Set(['q_start', 'q_loop', 'q_accept']);
  const trans = [];
  const warnings = [];
  const terminals = [...terminalsOf(g)];

  // A push is a *string* on this app's PDA, split back into symbols one
  // character at a time — so a multi-character symbol cannot survive one.
  // Saying so is the honest answer; silently pushing `Expr` as four stack
  // symbols is not.
  const wide = [...g.vars, ...terminals].filter(s => s.length > 1);
  if (wide.length) {
    warnings.push(`The stack alphabet is read one character at a time, so the multi-character symbol${wide.length === 1 ? '' : 's'} <b>${wide.join(', ')}</b> cannot be pushed as ${wide.length === 1 ? 'a single symbol' : 'single symbols'}. Rename ${wide.length === 1 ? 'it' : 'them'} to one character each before loading this onto the canvas.`);
  }

  if (mode === 'topdown') {
    trans.push({ from: 'q_start', to: 'q_loop', symbol: E, pop: bottom, push: g.start + bottom });
    g.rules.forEach(r => {
      trans.push({
        from: 'q_loop', to: 'q_loop', symbol: E,
        pop: r.lhsArr[0], push: r.rhsArr.length ? r.rhsArr.join('') : E
      });
    });
    terminals.forEach(a => trans.push({ from: 'q_loop', to: 'q_loop', symbol: a, pop: a, push: E }));
    trans.push({ from: 'q_loop', to: 'q_accept', symbol: E, pop: bottom, push: E });
  } else {
    trans.push({ from: 'q_start', to: 'q_loop', symbol: E, pop: bottom, push: bottom });
    terminals.forEach(a => trans.push({ from: 'q_loop', to: 'q_loop', symbol: a, pop: E, push: a }));
    g.rules.forEach((r, idx) => {
      const A = r.lhsArr[0];
      if (!r.rhsArr.length) {
        trans.push({ from: 'q_loop', to: 'q_loop', symbol: E, pop: E, push: A });
        return;
      }
      if (r.rhsArr.length === 1) {
        trans.push({ from: 'q_loop', to: 'q_loop', symbol: E, pop: r.rhsArr[0], push: A });
        return;
      }
      let from = 'q_loop';
      for (let i = r.rhsArr.length - 1; i >= 0; i--) {
        const last = i === 0;
        const to = last ? 'q_loop' : `q_reduce_${idx + 1}_${i}`;
        if (!last) states.add(to);
        trans.push({ from, to, symbol: E, pop: r.rhsArr[i], push: last ? A : E });
        from = to;
      }
    });
    trans.push({ from: 'q_loop', to: 'q_accept', symbol: E, pop: g.start, push: E });
  }

  return {
    mode,
    states: [...states],
    transitions: trans.map((t, i) => ({ id: 't' + (i + 1), ...t })),
    start: 'q_start',
    accepts: ['q_accept'],
    sigma: terminals,
    stackAlpha: [...new Set([bottom, ...g.vars, ...terminals])],
    warnings
  };
}

// ── PDA → CFG ─────────────────────────────────────────────────────

/**
 * The Sipser triple construction. `[p A q]` generates exactly the words that
 * take the machine from p with A on top to q with that A gone, so the moves
 * translate rule for rule: a push of two symbols becomes a chain of two such
 * variables, one per symbol that must eventually come off.
 *
 * The machine is first normalised — a fresh bottom marker below Z₀, and a
 * drain state that empties the stack from every accepting state — because the
 * construction is stated for a machine that empties its stack to accept.
 */
export function pdaToCfg({ mode = 'pruned' } = {}) {
  const E = eps();
  const bottom = Z();
  const nameOf = id => getState(id)?.name || id;

  if (!App.states.length) return { error: 'The canvas has no states.' };
  if (!App.startId) return { error: 'The machine has no start state.' };

  const stackSymbols = new Set([bottom]);
  App.transitions.forEach(t => {
    if (t.pop && t.pop !== E && t.pop !== App.config.sym.any) stackSymbols.add(t.pop);
    if (t.push && t.push !== E && t.push !== App.config.sym.any) t.push.split('').forEach(s => stackSymbols.add(s));
  });

  const names = App.states.map(s => s.name);
  let fresh = ['$', '#', '@', '%', '&'].find(s => !stackSymbols.has(s)) || '$';
  while (stackSymbols.has(fresh)) fresh += '$';
  stackSymbols.add(fresh);

  let qStart = 'qStart';
  while (names.includes(qStart)) qStart += '_';
  let qDrain = 'qDrain';
  while (names.includes(qDrain) || qDrain === qStart) qDrain += '_';

  const allStates = [...names, qStart, qDrain];
  const moves = [{ from: qStart, to: nameOf(App.startId), symbol: E, pop: fresh, push: `${bottom}${fresh}` }];
  App.transitions.forEach(t => moves.push({
    from: nameOf(t.from), to: nameOf(t.to),
    symbol: t.symbol || E, pop: t.pop || E, push: t.push || E
  }));
  App.accepts.forEach(id => {
    [...stackSymbols].forEach(s => moves.push({ from: nameOf(id), to: qDrain, symbol: E, pop: s, push: E }));
  });
  [...stackSymbols].forEach(s => moves.push({ from: qDrain, to: qDrain, symbol: E, pop: s, push: E }));

  const V = (p, A, q) => `[${p},${A},${q}]`;
  const rules = [makeRule(['S'], [V(qStart, fresh, qDrain)])];
  let overlong = 0;

  moves.forEach(t => {
    const pushed = t.push === E ? [] : t.push.split('');
    const a = t.symbol === E ? [] : [t.symbol];
    if (pushed.length === 0) {
      rules.push(makeRule([V(t.from, t.pop, t.to)], a));
    } else if (pushed.length === 1) {
      allStates.forEach(r => rules.push(makeRule([V(t.from, t.pop, r)], [...a, V(t.to, pushed[0], r)])));
    } else if (pushed.length === 2) {
      allStates.forEach(s => allStates.forEach(r =>
        rules.push(makeRule([V(t.from, t.pop, r)], [...a, V(t.to, pushed[0], s), V(s, pushed[1], r)]))));
    } else {
      overlong++;
    }
  });

  let g = grammarOf(rules, 'S');
  const before = g.rules.length;
  let pruned = 0;

  if (mode === 'pruned') {
    // The construction generates a rule per state pair whether or not the
    // pair can occur, so the raw output is quadratic in |Q| and mostly dead.
    // Generating first, then reachable — the same order removeUseless uses,
    // and for the same reason.
    // Seeded with the *terminals*, which here means "not a triple". Using
    // terminalsOf would seed it with every `[p,A,q]` that no rule defines —
    // and those are precisely the dead ones, so everything would come back
    // generating and nothing would ever be pruned.
    let gen = new Set(g.rules.flatMap(r => r.rhsArr).filter(sym => !sym.startsWith('[')));
    let changed = true;
    while (changed) {
      changed = false;
      g.rules.forEach(r => {
        if (gen.has(r.lhsArr[0])) return;
        if (r.rhsArr.every(s => !s.startsWith('[') || gen.has(s))) { gen.add(r.lhsArr[0]); changed = true; }
      });
    }
    let kept = g.rules.filter(r => gen.has(r.lhsArr[0]) && r.rhsArr.every(s => !s.startsWith('[') || gen.has(s)));
    const reach = new Set(['S']);
    changed = true;
    while (changed) {
      changed = false;
      kept.forEach(r => {
        if (!reach.has(r.lhsArr[0])) return;
        r.rhsArr.forEach(s => { if (s.startsWith('[') && !reach.has(s)) { reach.add(s); changed = true; } });
      });
    }
    kept = kept.filter(r => reach.has(r.lhsArr[0]));
    pruned = before - kept.length;
    g = grammarOf(kept, 'S');
  }

  return {
    grammar: g, mode, pruned, raw: before,
    stateCount: allStates.length,
    freshBottom: fresh, qStart, qDrain,
    overlong,
    empty: g.rules.length === 0
  };
}

// ── Finite automaton ↔ regular grammar ────────────────────────────

/**
 * Every transition q --a--> p becomes q → a p, and every accepting state
 * q becomes q → ε. The grammar is right-linear by construction, so the
 * conversion is exact rather than approximate — the states *are* the
 * variables and a derivation *is* a run.
 */
export function faToRegularGrammar() {
  if (!App.states.length) return { error: 'The canvas has no states.' };
  if (!App.startId) return { error: 'The machine has no start state.' };
  const E = eps();
  const nameOf = id => getState(id)?.name || id;
  const rules = [];
  App.transitions.forEach(t => {
    const from = nameOf(t.from);
    const to = nameOf(t.to);
    if (!from || !to) return;
    rules.push(makeRule([from], t.symbol === E ? [to] : [t.symbol, to]));
  });
  App.accepts.forEach(id => rules.push(makeRule([nameOf(id)], [])));
  const start = nameOf(App.startId);
  const vars = App.states.map(s => s.name);
  return { grammar: grammarOf(rules, start, vars) };
}

/**
 * The other direction. One state per variable plus one helper — the accepting
 * state for a right-linear grammar, the start state for a left-linear one.
 *
 * **The orientation is read off the grammar and the two may not be mixed.** A
 * grammar with `A → a B` and `C → D a` in it describes no single automaton by
 * this construction, and building one from whichever rule was seen first is
 * how a machine ends up recognising a language nobody wrote.
 */
export function regularGrammarToFA(g) {
  const E = eps();
  const cls = classify(g);
  if (!cls.contextFree) return { error: 'Every rule needs a single variable on its left before this construction applies.' };
  if (!cls.regular) {
    return {
      error: 'This grammar is not regular: some rule is neither right-linear (a string of terminals, then at most one variable) nor left-linear.',
      blocker: cls.blockers.regular
    };
  }
  const right = cls.rightLinear;

  const helper = right ? 'qAcc' : 'qStart';
  let helperName = helper;
  while (g.vars.has(helperName)) helperName += '_';

  const ids = new Map();
  let n = 0;
  [...g.vars].forEach(v => ids.set(v, 's' + (++n)));
  ids.set(helperName, 's' + (++n));

  const states = [...ids.entries()].map(([name, id]) => ({ id, name }));
  const trans = [];
  const sigma = new Set();
  let tn = 0;

  // A right-linear rule is a run of terminals then at most one variable. A run
  // longer than one terminal needs its own chain of states, or `A → a b B`
  // would silently become a single-symbol move.
  const chain = (fromId, syms, toId) => {
    let cur = fromId;
    syms.forEach((s, i) => {
      sigma.add(s);
      const last = i === syms.length - 1;
      let next = toId;
      if (!last) {
        const id = 's' + (++n);
        states.push({ id, name: `q${id.slice(1)}` });
        next = id;
      }
      trans.push({ id: 't' + (++tn), from: cur, to: next, symbol: s });
      cur = next;
    });
    if (!syms.length) trans.push({ id: 't' + (++tn), from: fromId, to: toId, symbol: E });
  };

  g.rules.forEach(r => {
    const A = ids.get(r.lhsArr[0]);
    const varAt = r.rhsArr.findIndex(s => g.vars.has(s));
    if (right) {
      const terms = varAt < 0 ? r.rhsArr : r.rhsArr.slice(0, varAt);
      const target = varAt < 0 ? ids.get(helperName) : ids.get(r.rhsArr[varAt]);
      chain(A, terms, target);
    } else {
      // Left-linear: A → B w runs *backwards* — the machine reads w on its way
      // from B's state into A's, and the start state is the helper.
      const terms = varAt < 0 ? r.rhsArr : r.rhsArr.slice(varAt + 1);
      const source = varAt < 0 ? ids.get(helperName) : ids.get(r.rhsArr[varAt]);
      chain(source, terms, A);
    }
  });

  const startId = right ? ids.get(g.start) : ids.get(helperName);
  const accepts = right ? [ids.get(helperName)] : [ids.get(g.start)];
  return {
    states, transitions: trans, startId, accepts,
    sigma: [...sigma],
    orientation: right ? 'right-linear' : 'left-linear',
    machine: trans.some(t => t.symbol === E) ? 'ε-NFA' : 'NFA'
  };
}
