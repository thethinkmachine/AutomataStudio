// ══════════════════════════════════════════════════════════════════
//  ω-AUTOMATA — DBA, DcoBA, DPA, DWA, NBA, NcoBA, NPA, NWA
// ══════════════════════════════════════════════════════════════════
// Eight types, one structure, two axes: determinism, and the acceptance
// condition α that judges inf(r). Both are named by the type, so the label
// on screen is always the machine you have and there is no config knob to
// disagree with it.
//
// All four conditions judge the same object — inf(r), which on an
// ultimately periodic word is exactly the states on the run's lasso cycle
// — so exploreOmega serves all eight by choosing an anchor node and an
// `allow` filter over cycles. The filter constrains the *cycle* only,
// since a finite stem cannot affect inf(r), which is what lets co-Büchi
// pass through F on the way in.
//
// The two axes decide expressive power, and not uniformly: DBA ⊊ NBA, but
// DPA = NPA = the full ω-regular class and DcoBA = NcoBA ⊊ ω-regular.
// Büchi is the only cell where determinism costs languages.

import { App, getState, omegaAcceptanceOf, statePriority } from '../state.js';
import { renderSimStep } from './paint.js';
import { findOmegaDeterminismConflict } from './predicates.js';
import { accepted, firstOverlappingTransition, nameOfState, tokenize } from './runtime.js';
import { defineFamily } from './registry.js';

// Only ultimately periodic ω-words are decidable by inspection, and they are
// exactly the ones a user can type: u·vᵂ, written "u(v)".
export function parseOmegaWord(raw) {
  const m = String(raw ?? '').trim().match(/^(.*?)\(([^()]*)\)\s*(?:ω|\^ω|\^w|w)?$/);
  if (!m) return null;
  return { prefix: m[1].trim(), period: m[2].trim() };
}

// Positions along u·vᵂ: 0..|u|-1 index the prefix, |u|..|u|+|v|-1 the period,
// and the period's last position wraps back to |u|. That makes the graph of
// (state, position) pairs finite, which turns "some run visits F infinitely
// often" into plain reachability: is there a reachable cycle through an
// F-state? Both the verdict and the witness lasso fall out of that.
export function buchiSymbolAt(u, v, pos) {
  return pos < u.length ? u[pos] : v[(pos - u.length) % v.length];
}

export function buchiNextPos(u, v, pos) {
  return pos + 1 < u.length + v.length ? pos + 1 : u.length;
}

export function buchiSuccessors(u, v, state, pos) {
  const any = App.config.sym.any;
  const sym = buchiSymbolAt(u, v, pos);
  const nextPos = buchiNextPos(u, v, pos);
  const out = [];
  for (const t of App.transitions) {
    if (t.from !== state) continue;
    if (t.symbol !== sym && t.symbol !== any) continue;
    out.push({ state: t.to, pos: nextPos, via: t });
  }
  return out;
}

const buchiKey = (state, pos) => `${state}|${pos}`;

// Shortest cycle from `node` back to itself, as the list of nodes entered
// (so the last element is `node` again). null when `node` is on no cycle.
// `allow` restricts which states the cycle may pass through, which is how the
// conditions other than Büchi are expressed: co-Büchi searches for a cycle
// inside Q∖F, parity for one inside the states of priority ≥ some p. The
// restriction applies to the cycle only — the stem that reaches `node` is free
// to pass anywhere, because a finite prefix cannot affect inf(r).
export function buchiFindCycle(u, v, node, allow = null) {
  const target = buchiKey(node.state, node.pos);
  const parent = new Map();
  const queue = [];
  const relax = (from, nx) => {
    const k = buchiKey(nx.state, nx.pos);
    if (k === target) return true;
    if (allow && !allow(nx.state)) return false;
    if (parent.has(k)) return false;
    parent.set(k, { from, via: nx.via });
    queue.push({ state: nx.state, pos: nx.pos });
    return false;
  };
  const rebuild = (from, closing) => {
    const path = [{ state: closing.state, pos: closing.pos, via: closing.via }];
    let cur = from;
    while (buchiKey(cur.state, cur.pos) !== target) {
      const p = parent.get(buchiKey(cur.state, cur.pos));
      path.unshift({ state: cur.state, pos: cur.pos, via: p.via });
      cur = p.from;
    }
    return path;
  };
  for (const nx of buchiSuccessors(u, v, node.state, node.pos)) {
    if (relax(node, nx)) return rebuild(node, nx);
  }
  while (queue.length) {
    const cur = queue.shift();
    for (const nx of buchiSuccessors(u, v, cur.state, cur.pos)) {
      if (relax(cur, nx)) return rebuild(cur, nx);
    }
  }
  return null;
}

// Each condition reduces to "is there a reachable cycle of this shape?", and
// each returns the anchor node the cycle must pass through plus the states the
// cycle may use. Justifications, since they are not all equally obvious:
//
//   Büchi    — a cycle through some state of F is exactly inf(r) ∩ F ≠ ∅.
//   co-Büchi — inf(r) ∩ F = ∅ means the run eventually stays outside F, i.e. a
//              cycle lying wholly in Q∖F. Reaching it may cross F any number of
//              times, which is why `allow` constrains only the cycle.
//   parity   — anchor on a state of even priority p and forbid anything below
//              p. The cycle then has minimum exactly p: p occurs on it, and
//              nothing smaller is permitted. Conversely any accepting run's
//              inf(r) is strongly connected with even minimum p, and the state
//              carrying p sits on a cycle within it — so nothing is missed.
//   weak     — judged as Büchi. Its extra content is a constraint on the
//              automaton, checked separately by findWeakViolation.
function omegaCycleCandidates(order) {
  const cond = omegaAcceptanceOf();
  if (cond === 'cobuchi') {
    const outside = q => !App.accepts.has(q);
    return order.filter(n => outside(n.state)).map(n => ({ node: n, allow: outside }));
  }
  if (cond === 'parity') {
    const priOf = q => statePriority(getState(q));
    return order
      .filter(n => priOf(n.state) % 2 === 0)
      .map(n => {
        const p = priOf(n.state);
        return { node: n, allow: q => priOf(q) >= p };
      });
  }
  // buchi and weak
  return order.filter(n => App.accepts.has(n.state)).map(n => ({ node: n, allow: null }));
}

export function exploreOmega(u, v) {
  if (!v.length) return { accepted: false, reason: 'empty-period', stem: [], loop: [] };
  if (!App.startId) return { accepted: false, reason: 'no-start', stem: [], loop: [] };

  const start = { state: App.startId, pos: 0, via: null };
  const parent = new Map([[buchiKey(start.state, start.pos), null]]);
  const order = [start];
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const nx of buchiSuccessors(u, v, cur.state, cur.pos)) {
      const k = buchiKey(nx.state, nx.pos);
      if (parent.has(k)) continue;
      parent.set(k, { from: cur, via: nx.via });
      const node = { state: nx.state, pos: nx.pos, via: nx.via };
      order.push(node);
      queue.push(node);
    }
  }

  const traceStem = (node) => {
    const path = [];
    let cur = { state: node.state, pos: node.pos };
    for (;;) {
      const p = parent.get(buchiKey(cur.state, cur.pos));
      path.unshift({ state: cur.state, pos: cur.pos, via: p ? p.via : null });
      if (!p) break;
      cur = p.from;
    }
    return path;
  };

  for (const { node, allow } of omegaCycleCandidates(order)) {
    const loop = buchiFindCycle(u, v, node, allow);
    if (loop) return { accepted: true, stem: traceStem(node), loop, reason: null };
  }

  // No accepting cycle. The stem to the furthest reachable node is still the
  // most informative thing to show — it is where the run actually gets to.
  const deepest = order[order.length - 1] || start;
  return { accepted: false, stem: traceStem(deepest), loop: [], reason: order.length > 1 ? 'no-accepting-cycle' : 'stuck' };
}

export function testOmega(u, v) {
  return exploreOmega(u, v).accepted;
}

// Tarjan over the *automaton* graph — states and transitions, with no input
// word involved, because weakness is a property of the machine rather than of
// a run. Returns the first SCC that straddles F, or null when every one of
// them lies wholly inside or wholly outside it.
//
// A single state counts as an SCC only when it carries a self-loop; a state
// with no way back to itself is on no cycle, so it cannot be in any inf(r) and
// cannot break weakness.
export function findWeakViolation() {
  const succ = new Map();
  for (const s of App.states) succ.set(s.id, []);
  for (const t of App.transitions) if (succ.has(t.from)) succ.get(t.from).push(t.to);

  const index = new Map(), low = new Map(), onStack = new Set(), stack = [];
  let counter = 0, violation = null;

  const straddles = (comp) => {
    const inF = comp.filter(q => App.accepts.has(q)).length;
    return inF > 0 && inF < comp.length;
  };

  // Iterative: a deep machine would blow the call stack, and the app happily
  // loads 150-state graphs.
  const strongConnect = (root) => {
    const work = [{ v: root, i: 0 }];
    index.set(root, counter); low.set(root, counter); counter++;
    stack.push(root); onStack.add(root);
    while (work.length) {
      const frame = work[work.length - 1];
      const edges = succ.get(frame.v) || [];
      if (frame.i < edges.length) {
        const w = edges[frame.i++];
        if (!index.has(w)) {
          index.set(w, counter); low.set(w, counter); counter++;
          stack.push(w); onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(low.get(frame.v), index.get(w)));
        }
        continue;
      }
      work.pop();
      if (work.length) {
        const parentV = work[work.length - 1].v;
        low.set(parentV, Math.min(low.get(parentV), low.get(frame.v)));
      }
      if (low.get(frame.v) === index.get(frame.v)) {
        const comp = [];
        for (;;) {
          const w = stack.pop();
          onStack.delete(w);
          comp.push(w);
          if (w === frame.v) break;
        }
        const isCycle = comp.length > 1 || (succ.get(comp[0]) || []).includes(comp[0]);
        if (isCycle && !violation && straddles(comp)) violation = comp;
      }
    }
  };

  for (const s of App.states) if (!index.has(s.id)) strongConnect(s.id);
  return violation;
}

// How a state is annotated mid-run, and how the verdict is explained, both
// depend on α — under co-Büchi an F-state is a liability rather than a prize,
// and under parity the interesting fact about a state is its number.
function omegaStateNote(stateId) {
  const cond = omegaAcceptanceOf();
  if (cond === 'parity') return ` · priority ${statePriority(getState(stateId))}`;
  if (!App.accepts.has(stateId)) return '';
  return cond === 'cobuchi' ? ' ✗ (in F — must stop recurring)' : ' ✓ (accepting)';
}

function omegaVerdictNote(result) {
  const cond = omegaAcceptanceOf();
  const names = result.loop.map(n => getState(n.state)?.name || n.state);
  const cycle = [...new Set(names)].join(' → ');
  if (result.accepted) {
    if (cond === 'cobuchi') return ` — ACCEPT: the cycle ${cycle} repeats forever and never touches F again`;
    if (cond === 'parity') {
      const min = Math.min(...result.loop.map(n => statePriority(getState(n.state))));
      return ` — ACCEPT: the cycle ${cycle} repeats forever and its least priority is ${min}, which is even`;
    }
    return ` — ACCEPT: the cycle ${cycle} repeats forever and visits an accepting state each time`;
  }
  if (result.reason === 'stuck') return ' — REJECT: no run survives the ω-word';
  if (cond === 'cobuchi') return ' — REJECT: every reachable cycle touches F, so no run can leave it behind for good';
  if (cond === 'parity') return ' — REJECT: every reachable cycle has an odd least priority';
  return ' — REJECT: every reachable cycle avoids F, so no run visits an accepting state infinitely often';
}

export function simOmega(u, v) {
  const result = exploreOmega(u, v);
  const unrollings = 2;
  const run = result.accepted
    ? [...result.stem, ...result.loop, ...result.loop].slice(0, result.stem.length + result.loop.length * unrollings)
    : result.stem;
  const loopFrom = result.accepted ? result.stem.length - 1 : -1;

  const reps = Math.max(1, Math.ceil((run.length + 1) / Math.max(1, v.length)) + 1);
  const tape = [...u];
  for (let i = 0; i < reps; i++) tape.push(...v);

  App.simSteps = run.map((node, idx) => {
    const stateName = getState(node.state)?.name || node.state;
    const inLoop = loopFrom >= 0 && idx >= loopFrom;
    let note;
    if (idx === 0) {
      note = `Start: ${stateName}`;
    } else {
      const fromName = getState(run[idx - 1].state)?.name || run[idx - 1].state;
      note = `Read '${tape[idx - 1]}': ${fromName} → ${stateName}`;
    }
    note += omegaStateNote(node.state);
    if (inLoop) note += ` · loop iteration ${Math.floor((idx - loopFrom) / Math.max(1, result.loop.length)) + 1}`;
    return {
      state: node.state,
      tokens: [...u, ...v],
      tape: [...tape],
      head: idx,
      // An ω-word is bounded on the left and runs on forever to the right —
      // but not into blank tape the way an ITM's does. What continues is v,
      // over and over, so the view says so and the tracker draws the
      // repetition rather than an ellipsis that means "nothing more".
      view: {
        kind: 'tape',
        cells: [...tape],
        head: idx,
        origin: 0,
        leftBound: 0,
        rightBound: null,
        markers: [],
        blank: App.config.sym.blank,
        readOnly: true,
        periodFrom: u.length,
        periodLen: v.length
      },
      tid: node.via?.id,
      omegaLoopFrom: loopFrom,
      note
    };
  });

  const last = App.simSteps[App.simSteps.length - 1];
  if (last) {
    last.final = result.accepted ? 'accept' : 'reject';
    last.note += omegaVerdictNote(result);
  }
  App.simIdx = 0;
  renderSimStep();
  return result;
}

// ── the input ─────────────────────────────────────────────────────
// An ω-automaton reads u·vᵂ, not a finite string, so it never reaches the
// finite-word tokenizer: it parses its own format and hands back the two
// halves the whole family is written against.

export function parseOmegaInput(raw) {
  const parsed = parseOmegaWord(raw);
  if (!parsed) {
    return {
      ok: false,
      error: `${App.machine} reads an infinite word. Write it as <em>u(v)</em> — a finite prefix followed by the repeating period in parentheses, e.g. <em>ab(ba)</em> or <em>(a)</em>.`
    };
  }
  const prefixStr = parsed.prefix === App.config.sym.eps ? '' : parsed.prefix;
  const u = tokenize(prefixStr);
  const v = tokenize(parsed.period);
  if (u === null || v === null) {
    return { ok: false, error: `Input cannot be tokenized using alphabet {${[...App.sigma].join(', ')}}.` };
  }
  if (!v.length) {
    return { ok: false, error: 'The repeating period must be non-empty — <em>u()</em> is a finite word, not an ω-word.' };
  }
  return { ok: true, input: { u, v }, tokens: [...u, ...v] };
}

// ── the guards ────────────────────────────────────────────────────
// Two claims a run can be started under, and they are claims about the
// *machine* rather than about this word — which is why they are guards on
// the type rather than branches inside the simulator, and why only the
// types that make the claim carry them.

// The editor refuses to draw a branching D-type, but a loaded or imported
// machine has not been through the editor. So it is checked again here,
// the way DPDA is.
function refuseIfNondeterministic() {
  const clash = findOmegaDeterminismConflict(App.transitions);
  if (!clash) return null;
  const where = getState(clash[0].from)?.name || clash[0].from;
  return {
    refuse: `Nondeterministic overlap in ${App.machine} mode: ${where} has two moves on '${clash[0].symbol}'. Switch to ${App.machine.replace(/^D/, 'N')} to explore both branches.`
  };
}

// Weakness does not change the verdict — acceptance is still Büchi — so a
// violation is a warning and the run continues underneath it.
function warnIfNotWeak() {
  const scc = findWeakViolation();
  if (!scc) return null;
  const names = scc.map(q => getState(q)?.name || q).join(', ');
  return {
    warn: `Not a weak automaton: the cycle {${names}} contains both accepting and non-accepting states. A weak condition needs every SCC to sit wholly inside F or wholly outside it. Running it as a Büchi automaton.`
  };
}

// ── the definitions ───────────────────────────────────────────────
// Determinism × α, spelled out. Every entry runs the same simulator and
// the same decider; what a type contributes is which guards apply, and
// what its tuple's last slot is called.

const omega = {
  family: 'omega',
  parseInput: parseOmegaInput,
  simulate: ({ u, v }) => simOmega(u, v),
  decide: ({ u, v }) => accepted(testOmega(u, v)),
  schema: {
    transitionFields: ['from', 'to', 'on'],
    stateFields: ['name', 'start', 'accept'],
    alphabetFields: ['sigma']
  }
};

// Parity replaces F with a per-state priority: there is no accepting set
// to mark, so the tuple's last slot changes name as well as meaning and
// the state carries a number instead of a flag.
const parityShape = {
  schema: { ...omega.schema, stateFields: ['name', 'start', 'priority'] }
};

// Overlap, not equality: buchiSuccessors takes every matching edge rather
// than resolving to the most specific one, so a wildcard alongside a
// concrete symbol is a genuine branch here even though a DFA tolerates it.
const omegaDeterminism = {
  conflict: (c, editId) => firstOverlappingTransition(c.from, c.symbol, editId),
  say: c => `${App.machine} already has a move from ${nameOfState(c.from)} on '${c.symbol}'. Switch to ${App.machine.replace(/^D/, 'N')} if you want to branch on the same symbol.`
};

const detFormal = { tuple: () => ['Q', 'Σ', 'δ', 'q₀', 'F'], delta: () => 'Q × Σ → Q' };
const nonDetFormal = { tuple: () => ['Q', 'Σ', 'δ', 'q₀', 'F'], delta: () => 'Q × Σ → P(Q)' };
const detParityFormal = { tuple: () => ['Q', 'Σ', 'δ', 'q₀', 'Ω'], delta: () => 'Q × Σ → Q' };
const nonDetParityFormal = { tuple: () => ['Q', 'Σ', 'δ', 'q₀', 'Ω'], delta: () => 'Q × Σ → P(Q)' };

defineFamily(omega, {
  'DBA': { deterministicDelta: true, determinism: omegaDeterminism, guards: [refuseIfNondeterministic], formal: detFormal },
  'DcoBA': { deterministicDelta: true, determinism: omegaDeterminism, guards: [refuseIfNondeterministic], formal: detFormal },
  'DPA': { deterministicDelta: true, determinism: omegaDeterminism, guards: [refuseIfNondeterministic], formal: detParityFormal, ...parityShape },
  'DWA': { deterministicDelta: true, determinism: omegaDeterminism, guards: [refuseIfNondeterministic, warnIfNotWeak], formal: detFormal },
  'NBA': { guards: [], formal: nonDetFormal },
  'NcoBA': { guards: [], formal: nonDetFormal },
  'NPA': { guards: [], formal: nonDetParityFormal, ...parityShape },
  'NWA': { guards: [warnIfNotWeak], formal: nonDetFormal }
});
