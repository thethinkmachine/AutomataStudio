// ══════════════════════════════════════════════════════════════════
//  INDUCTIVE RULES OVER A RUN-LENGTH TAPE
// ══════════════════════════════════════════════════════════════════
// A prover for the machines the other methods leave unknown because their tape
// never repeats: bouncers, whose sweeps grow a region block by block, and the
// counters whose runs shrink by a fixed step and then reset larger. It is the
// idea behind Marxen and Buntrock's macro machines and the busy beaver
// hunters' "proof system":
//
//   blocks    the tape is cut into blocks of B cells and run-length encoded,
//             as two stacks of runs (b, n) either side of the head
//   chain     when reading block b in state q carries the head straight
//             through, still in state q, a whole run b^n is crossed in one
//             step, whatever n is
//   rules     when a configuration recurs with the same runs in the same
//             order, the stretch between is replayed *symbolically*: an
//             exponent that changed by d is written |d|·x + e for an unknown
//             x ≥ 0 (every value it would take on further passes). If the
//             replay never has to ask anything that depends on x, it ends in
//             the same shape with each exponent an affine function of the x's,
//             and the stretch is a rule, valid for every x.
//   forever   a rule whose output always satisfies its own precondition —
//             each exponent at least its minimum and in its residue class, for
//             every x — applies to its own result forever, so the machine
//             never halts. That is the proof.
//   nesting   a rule that is not forever is kept, and applied as one step to
//             later configurations, concrete and symbolic. One with a single
//             shrinking exponent is applied as many times as that exponent
//             allows, in one step; with a symbolic exponent m·y + c falling by
//             m each time the count is linear in y, so every other exponent
//             stays linear. This is what proves the outer loop of a bouncer —
//             a marker walking back across a growing region — whose replay
//             applies the inner rule a symbolic number of times.
//
// Soundness rests on the symbolic replay doing what every concrete instance
// would. A chain crosses a run of any length. A single step needs its run
// known non-empty; a rule needs its precondition known to hold, and its
// repeat count known to be linear; anything that would depend on x aborts
// the proof rather than guessing.

// ── Exponents: c + Σ a·x over x ≥ 0, every a ≥ 0 ──────────────────

const E = {
  num: c => ({ c, v: null }),
  term: (x, a, c) => ({ c, v: new Map([[x, a]]) }),
  add(a, b) {
    const v = new Map(a.v || []);
    for (const [x, k] of b.v || []) v.set(x, (v.get(x) || 0) + k);
    for (const [x, k] of v) if (k === 0) v.delete(x);
    return { c: a.c + b.c, v: v.size ? v : null };
  },
  scale(a, k) {
    if (!a.v) return { c: a.c * k, v: null };
    return { c: a.c * k, v: new Map([...a.v].map(([x, q]) => [x, q * k])) };
  },
  inc: (a, d) => ({ c: a.c + d, v: a.v }),
  concrete: a => !a.v,
  min: a => a.c,
  isZero: a => !a.v && a.c === 0,
  coeffs: a => (a.v ? [...a.v.values()] : []),
  nonNegative: a => a.c >= 0 && (!a.v || [...a.v.values()].every(k => k >= 0)),
  // (a − k)/m as a form, or null when it is not an integer for every x.
  shiftDiv(a, k, m) {
    if ((a.c - k) % m !== 0 || E.coeffs(a).some(q => q % m !== 0)) return null;
    return { c: (a.c - k) / m, v: a.v ? new Map([...a.v].map(([x, q]) => [x, q / m])) : null };
  },
  // Substitute forms for the variables of `a`.
  sub(a, forms) {
    let out = E.num(a.c);
    for (const [x, q] of a.v || []) out = E.add(out, E.scale(forms.get(x) ?? E.num(0), q));
    return out;
  },
  same(a, b) {
    if (a.c !== b.c) return false;
    const av = a.v || new Map(), bv = b.v || new Map();
    if (av.size !== bv.size) return false;
    for (const [x, k] of av) if (bv.get(x) !== k) return false;
    return true;
  }
};

const AMBIGUOUS = 'ambiguous';

// ── The macro machine ─────────────────────────────────────────────

/**
 * One block, entered at the edge the head faces, run until the head leaves.
 * `{ halt }`, `{ loop }` (the head never leaves: it runs forever in B cells),
 * or `{ q, block, exit }` with exit +1 (out the right) or −1 (out the left).
 */
function blockStep(p, B, q, dir, block, cache) {
  const key = `${q}|${dir}|${block}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cells = [...block].map(Number);
  let pos = dir > 0 ? 0 : B - 1, state = q;
  const limit = p.Q * B * p.K ** B + 1;
  let res = null;
  for (let t = 0; t <= limit; t++) {
    if (p.accept[state]) { res = { halt: true }; break; }
    const e = state * p.K + cells[pos];
    const to = p.next[e];
    if (to < 0) { res = { halt: true }; break; }
    cells[pos] = p.write[e];
    pos += p.move[e];
    state = to;
    if (pos < 0 || pos >= B) { res = { q: state, block: cells.join(''), exit: pos < 0 ? -1 : 1 }; break; }
  }
  if (!res) res = { loop: true };
  cache.set(key, res);
  return res;
}

class Config {
  constructor(q, dir, L, R) { this.q = q; this.dir = dir; this.L = L; this.R = R; }
  clone() { return new Config(this.q, this.dir, this.L.map(r => ({ ...r })), this.R.map(r => ({ ...r }))); }
  signature() { return `${this.q}${this.dir > 0 ? '>' : '<'}${this.L.map(r => r.b).join(',')}|${this.R.map(r => r.b).join(',')}`; }
  runs() { return [...this.L, ...this.R]; }
  setExponent(i, e) {
    if (i < this.L.length) this.L[i] = { b: this.L[i].b, e };
    else this.R[i - this.L.length] = { b: this.R[i - this.L.length].b, e };
  }
  /**
   * No run that is empty for every x, no two equal neighbours, no blank run
   * against the blank beyond. Sound for a symbolic configuration too: it only
   * removes runs whose exponent is the constant 0, and merging adds forms.
   */
  normalize(blank) {
    for (const s of [this.L, this.R]) {
      for (let i = s.length - 1; i >= 0; i--) if (E.isZero(s[i].e)) s.splice(i, 1);
      for (let i = s.length - 2; i >= 0; i--) {
        if (s[i].b === s[i + 1].b) { s[i] = { b: s[i].b, e: E.add(s[i].e, s[i + 1].e) }; s.splice(i + 1, 1); }
      }
      while (s.length && s[s.length - 1].b === blank) s.pop();
    }
  }
}

/** Push a block onto a stack (index 0 is next to the head), merging equal neighbours. */
function push(stack, b, e, blank) {
  if (stack.length && stack[0].b === b) { stack[0] = { b, e: E.add(stack[0].e, e) }; return; }
  if (!stack.length && b === blank) return; // blank onto the blank beyond: nothing
  stack.unshift({ b, e });
}

// ── Rules ─────────────────────────────────────────────────────────
//  spec[i] is { fixed: c } or { min, mod } (the run is mod·x_i + min);
//  end[i] is run i's exponent afterwards, as a form over the x's.

/** Whether the rule's precondition holds for `e` at run i: 'yes', 'no' or AMBIGUOUS. */
function fits(spec, e) {
  if (spec.fixed !== undefined) {
    if (E.concrete(e)) return e.c === spec.fixed ? 'yes' : 'no';
    return E.min(e) > spec.fixed ? 'no' : AMBIGUOUS;
  }
  if (E.concrete(e)) return e.c >= spec.min && (e.c - spec.min) % spec.mod === 0 ? 'yes' : 'no';
  if (E.min(e) >= spec.min && E.shiftDiv(e, spec.min, spec.mod)) return 'yes';
  // Every value is ≡ c (mod m) when the coefficients are multiples of m, and
  // then a wrong residue can never fit.
  if (E.coeffs(e).every(q => q % spec.mod === 0) && (e.c - spec.min) % spec.mod !== 0) return 'no';
  return AMBIGUOUS;
}

/** A rule whose every output fits its own precondition, for every x. */
function isForever(rule) {
  return rule.spec.every((s, i) => {
    const e = rule.end[i];
    if (s.fixed !== undefined) return E.same(e, E.num(s.fixed));
    return E.min(e) >= s.min && (e.c - s.min) % s.mod === 0 && E.coeffs(e).every(q => q % s.mod === 0);
  });
}

/**
 * Apply `rule` to `c` in place. 'no' (it does not match), 'ok', or AMBIGUOUS.
 * An additive rule with one shrinking run is applied as many times as that
 * run allows; any other rule once.
 */
function applyRule(c, rule, blank) {
  if (c.signature() !== rule.sig) return 'no';
  const runs = c.runs();
  const xs = new Map();
  for (let i = 0; i < runs.length; i++) {
    const f = fits(rule.spec[i], runs[i].e);
    if (f !== 'yes') return f;
    if (rule.spec[i].fixed === undefined) xs.set(i, E.shiftDiv(runs[i].e, rule.spec[i].min, rule.spec[i].mod));
  }
  if (isForever(rule)) return AMBIGUOUS; // never a step: it does not finish
  let next;
  if (rule.additive && rule.shrinking.length) {
    // n applications, each moving run i by d[i]: while every shrinking run
    // still fits. For a shrinking run, x counts the applications left minus
    // one (its step is its modulus), so n = x + 1.
    let n;
    if (rule.shrinking.every(i => E.concrete(xs.get(i)))) n = E.num(Math.min(...rule.shrinking.map(i => xs.get(i).c)) + 1);
    else if (rule.shrinking.length === 1) n = E.inc(xs.get(rule.shrinking[0]), 1);
    else return AMBIGUOUS;
    next = runs.map((r, i) => (rule.spec[i].fixed !== undefined ? r.e : E.add(r.e, E.scale(n, rule.d[i]))));
  } else {
    next = rule.end.map(f => E.sub(f, xs));
  }
  if (next.some(e => !E.nonNegative(e))) return AMBIGUOUS;
  next.forEach((e, i) => c.setExponent(i, e));
  // Always, symbolic or not: a run whose exponent is the constant 0 is empty
  // for every x, and the concrete run and its symbolic replay have to agree on
  // the shape they are compared by.
  c.normalize(blank);
  return 'ok';
}

/**
 * One macro step, in place: a rule if one applies, else the chain rule, else
 * one block. 'ok', 'halt', 'loop', or AMBIGUOUS.
 */
function macroStep(p, B, c, cache, blank, rules) {
  for (const rule of rules) {
    const r = applyRule(c, rule, blank);
    if (r === 'ok') return 'ok';
    if (r === AMBIGUOUS) return AMBIGUOUS;
  }
  const facing = c.dir > 0 ? c.R : c.L;
  const behind = c.dir > 0 ? c.L : c.R;
  const top = facing[0];
  const b = top ? top.b : blank;
  const r = blockStep(p, B, c.q, c.dir, b, cache);
  if (r.halt) return 'halt';
  if (r.loop) return 'loop';
  if (top && r.q === c.q && r.exit === c.dir) {
    facing.shift();
    push(behind, r.block, top.e, blank);
    return 'ok';
  }
  if (top) {
    if (E.min(top.e) < 1) return AMBIGUOUS;
    const left = E.inc(top.e, -1);
    if (E.isZero(left)) facing.shift(); else facing[0] = { b, e: left };
  }
  if (r.exit === c.dir) push(behind, r.block, E.num(1), blank);
  else push(facing, r.block, E.num(1), blank);
  c.q = r.q;
  c.dir = r.exit;
  return 'ok';
}

// How general a rule to attempt, most general first. `free` leaves a run the
// stretch did not change as a variable instead of pinning its value; `least`
// claims the rule from the smallest exponent in the observed one's residue
// class instead of from the observed one. Whatever is claimed is exactly what
// the symbolic replay then has to verify, so a more general variant can only
// fail to prove, never prove something false.
const VARIANTS = [
  { free: true, least: true },
  { free: true, least: false },
  { free: false, least: false }
];

/**
 * Try to make a rule of the stretch from `start` (concrete) that took `n`
 * macro steps and changed the exponents by `d`, trying the variants in turn.
 */
function proveRule(p, B, start, d, n, blank, rules, cache, log = null) {
  for (const variant of VARIANTS) {
    const rule = proveRuleAs(p, B, start, d, n, blank, rules, cache, log, variant);
    if (rule) return rule;
  }
  return null;
}

function proveRuleAs(p, B, start, d, n, blank, rules, cache, log, { free, least }) {
  const c = start.clone();
  const runs = c.runs();
  const spec = runs.map((r, i) => {
    if (d[i] === 0) return free ? { min: least ? 1 : r.e.c, mod: 1 } : { fixed: r.e.c };
    const mod = Math.abs(d[i]);
    const min = least ? ((r.e.c - 1) % mod) + 1 : r.e.c;
    return { min, mod };
  });
  // A shrinking run must still be at least its step after one pass, or the
  // rule's own end would leave it below the minimum: the observed value is
  // the least that is known to work there.
  spec.forEach((s, i) => { if (d[i] < 0 && s.min + d[i] < 1) s.min = runs[i].e.c; });
  runs.forEach((r, i) => { if (spec[i].fixed === undefined) c.setExponent(i, E.term(i, spec[i].mod, spec[i].min)); });
  const shape = c.signature();
  for (let k = 0; k < n; k++) {
    const r = macroStep(p, B, c, cache, blank, rules);
    if (r !== 'ok') { log?.('abort', r, k, n, describe(c)); return null; }
  }
  if (c.signature() !== shape) { log?.('shape', describe(c)); return null; }
  const end = c.runs().map(r => r.e);
  if (end.some(e => !E.nonNegative(e))) return null;
  // Additive: every run moved by a constant (its own variable untouched).
  const additive = spec.every((s, i) => {
    const want = s.fixed !== undefined ? E.num(s.fixed) : d[i] === 0 && s.mod === 1 ? E.term(i, 1, s.min) : E.term(i, s.mod, s.min + d[i]);
    return E.same(end[i], want);
  });
  const shrinking = additive ? spec.map((s, i) => (s.fixed === undefined && d[i] < 0 ? i : -1)).filter(i => i >= 0) : [];
  return { sig: shape, spec, end, d, steps: n, additive, shrinking };
}

/**
 * Try to prove non-halting with block size B. Returns a proof object, or
 * `{ halts: true }` when it halts within the budget, or null.
 */
export function proveByInduction(p, B, { maxMacroSteps = 20000, history = 6, maxRules = 64, maxStretch = 4000, deadline = Infinity, log = null } = {}) {
  if (!p.twoWay || p.input.some(c => c !== 0)) return null;
  const blank = '0'.repeat(B);
  const cache = new Map();
  const rules = [];
  const c = new Config(p.start, 1, [], []);
  const seen = new Map();
  // A shape whose recurrences keep failing to prove is not tried forever:
  // each attempt replays the whole stretch.
  const failures = new Map();
  for (let t = 0; t < maxMacroSteps; t++) {
    if ((t & 255) === 0 && performance.now() > deadline) return null;
    const sig = c.signature();
    const exps = c.runs().map(r => r.e.c);
    const prior = seen.get(sig);
    let learned = false;
    if (prior) {
      for (const past of [...prior].reverse()) {
        const d = exps.map((x, i) => x - past.exps[i]);
        if (d.every(x => x === 0)) return { method: 'cycler-macro', B, from: past.t, period: t - past.t };
        if (rules.length >= maxRules || t - past.t > maxStretch || (failures.get(sig) || 0) >= 8) continue;
        log?.('try', t, past.t, d.join(','), describe(past.config), '->', describe(c));
        const rule = proveRule(p, B, past.config, d, t - past.t, blank, rules, cache, log);
        if (!rule) { failures.set(sig, (failures.get(sig) || 0) + 1); continue; }
        if (isForever(rule)) return { method: 'induction', B, rules: rules.length + 1, start: describe(past.config), steps: rule.steps, grows: d };
        // Only a rule that accelerates is worth keeping: additive, with a
        // shrinking run to count applications by. Anything else is applied
        // once, which is the steps it came from — and a chain moving a whole
        // run across the head would otherwise "prove" a new such rule on
        // every pass and flush the history each time.
        if (!rule.additive || !rule.shrinking.length) { failures.set(sig, (failures.get(sig) || 0) + 1); continue; }
        log?.('rule', rule.sig, JSON.stringify(rule.spec), rule.d.join(','), rule.additive, rule.steps);
        rules.push(rule);
        learned = true;
        break;
      }
      if (learned) { seen.clear(); failures.clear(); }
      else {
        prior.push({ t, exps, config: c.clone() });
        if (prior.length > history) prior.shift();
      }
    } else seen.set(sig, [{ t, exps, config: c.clone() }]);
    const r = macroStep(p, B, c, cache, blank, rules);
    if (r === 'halt') return { halts: true };
    if (r === 'loop') return { method: 'block-loop', B };
    if (r !== 'ok') return null;
  }
  return null;
}

function describe(c) {
  const run = r => `${r.b}^${r.e.c}`;
  return `${c.q}${c.dir > 0 ? '→' : '←'} L[${c.L.map(run).join(' ')}] R[${c.R.map(run).join(' ')}]`;
}

/** Every block size up to `maxB`, smallest first, within `ms` in all. */
export function induction(p, { maxB = 6, maxMacroSteps = 20000, ms = 3000 } = {}) {
  const deadline = performance.now() + ms;
  for (let B = 1; B <= maxB; B++) {
    if (performance.now() > deadline) return null;
    const r = proveByInduction(p, B, { maxMacroSteps, deadline });
    if (r && !r.halts) return r;
    if (r && r.halts) return null;
  }
  return null;
}
