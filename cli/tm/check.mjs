// ══════════════════════════════════════════════════════════════════
//  CHECKING A PROOF WITHOUT TRUSTING THE PROVER
// ══════════════════════════════════════════════════════════════════
// A proof file (written by `automata halts --proof`) carries the machine as a
// table and the evidence its method produced. This module re-checks that
// evidence and shares no code with the deciders: its own tape (a Map), its own
// stepper, its own reading of the standard notation. A bug in the classifier
// would have to be made twice, the same way, to get past it.
//
//   simulation   run to the halt; it must come at exactly `steps`, counting
//                the read of a missing transition as bbchallenge does
//   cycler       the configurations at μ and μ + λ must be identical
//   translated   two records in the same state, the window behind the head
//                identical, the head never further back than the window
//                between them — so the period repeats forever, shifted
//   cps          the gram sets must be closed under δ from the blank start,
//                with no halting window — checked by exploring with the sets
//                frozen, so a set that is not closed is caught, not repaired
//   bound        run S + 1 transitions without halting, in the model the
//                busy beaver value is proved for (cited, not re-proved)
//   far          bbchallenge's verifier conditions (verifier_FAR_NFA_DFA.py,
//                and proof.rs in the Rust decider), checked on the DFA, NFA
//                and accepted set the proof carries: leading and trailing
//                blanks ignored, the steady state accepted and steady, every
//                halt recognised, every transition closed, the start rejected
//   backward     re-checked by the prover itself: the app's backward search
//                is re-run with the same limits. Said so.
//   segment      likewise: the halting segment search is re-run at the size
//                the proof names, and must close with the same node count.
//   loops, ngram, repwl, bouncers
//                likewise: re-run with the parameters the proof names.

export const PROOF_FORMAT = 'automata-studio/tm-proof';

function parseStandard(code) {
  const segs = String(code).trim().toUpperCase().split('_');
  const n = segs.length, k = segs[0].length / 3;
  const Q = n + 1;
  const next = Array(Q * k).fill(-1), write = Array(Q * k).fill(0), move = Array(Q * k).fill(0);
  const accept = Array(Q).fill(0);
  accept[n] = 1;
  segs.forEach((seg, q) => {
    for (let s = 0; s < k; s++) {
      const tr = seg.slice(3 * s, 3 * s + 3);
      if (tr === '---') continue;
      const to = tr.charCodeAt(2) - 65;
      next[q * k + s] = to < n ? to : n;
      write[q * k + s] = Number(tr[0]);
      move[q * k + s] = tr[1] === 'R' ? 1 : -1;
    }
  });
  return { Q, K: k, next, write, move, accept, start: 0, twoWay: true };
}

function sameTable(a, b) {
  if (a.Q !== b.Q || a.K !== b.K || a.start !== b.start) return false;
  for (let e = 0; e < a.Q * a.K; e++) {
    if (a.next[e] !== b.next[e]) return false;
    if (a.next[e] >= 0 && (a.write[e] !== b.write[e] || a.move[e] !== b.move[e])) return false;
  }
  for (let q = 0; q < a.Q; q++) if (!!a.accept[q] !== !!b.accept[q]) return false;
  return true;
}

/** A deliberately plain machine: Map tape, one step at a time. */
class Plain {
  constructor(m) {
    this.m = m;
    this.tape = new Map();
    this.head = 0;
    this.state = m.start;
    this.t = 0;
    this.lo = 0;
    this.hi = 0;
    this.halted = false;
  }
  read(x) { return this.tape.get(x) || 0; }
  step() {
    const { m } = this;
    if (m.accept[this.state]) { this.halted = true; return false; }
    const e = this.state * m.K + this.read(this.head);
    if (m.next[e] < 0) { this.halted = true; return false; }
    if (m.write[e]) this.tape.set(this.head, m.write[e]); else this.tape.delete(this.head);
    let h = this.head + m.move[e];
    if (!m.twoWay && h < 0) { h = 0; this.bumped = true; }
    this.head = h;
    this.lo = Math.min(this.lo, h);
    this.hi = Math.max(this.hi, h);
    this.state = m.next[e];
    this.t++;
    return true;
  }
  runTo(t) {
    while (this.t < t) if (!this.step()) return false;
    return true;
  }
  key() {
    const cells = [...this.tape.entries()].sort((a, b) => a[0] - b[0]).map(([x, c]) => `${x - this.head}:${c}`);
    return `${this.state}|${cells.join(',')}`;
  }
}

const fail = why => ({ ok: false, why });
const pass = (why, independent = true) => ({ ok: true, why, independent });

export function checkProof(proof, { classify = null, reprove = null, segment = null, rederive = null } = {}) {
  if (!proof || proof.format !== PROOF_FORMAT) return fail('not a proof file this checker reads');
  const m = proof.table;
  if (!m || !Number.isInteger(m.Q) || !Number.isInteger(m.K)) return fail('the proof carries no machine table');
  if (proof.standard) {
    let parsed;
    try { parsed = parseStandard(proof.standard); } catch { return fail('the standard notation in the proof does not parse'); }
    if (!sameTable(parsed, m)) return fail('the machine table does not match the standard notation beside it');
  }
  const blank = !(proof.input || []).length;
  const v = proof.verdict, ev = proof.evidence || {};
  switch (proof.method) {
    case 'simulation': {
      if (v !== 'halts') return fail('simulation proves halting only');
      // Counted as bbchallenge counts: reading a missing transition is the
      // halting step, and it counts; arriving in a halt state is not a step.
      const r = new Plain(m);
      (proof.input || []).forEach((c, x) => c && r.tape.set(x, c));
      if (!Number.isInteger(ev.steps) || ev.steps < 0) return fail('the evidence gives no step count');
      while (r.t < ev.steps && r.step());
      if (!r.halted && r.step()) return fail(`the machine did not halt within ${ev.steps} steps`);
      const steps = r.t + (m.accept[r.state] ? 0 : 1);
      if (steps !== ev.steps) return fail(`the machine halts after ${steps} steps, not ${ev.steps}`);
      return pass(`halts after exactly ${Number(ev.steps).toLocaleString('en-US')} steps${m.accept[r.state] ? '' : ', the last reading a missing transition'}`);
    }
    case 'cycler': {
      if (v !== 'never') return fail('a cycler proves non-halting only');
      if (!blank) return fail('this checker re-checks cyclers from a blank tape only');
      const a = new Plain(m);
      if (!a.runTo(ev.from)) return fail(`the machine halted before step ${ev.from}`);
      const k1 = `${a.head}|${a.key()}`;
      if (!a.runTo(ev.from + ev.period)) return fail('the machine halted inside the cycle');
      const k2 = `${a.head}|${a.key()}`;
      if (k1 !== k2) return fail(`the configurations at steps ${ev.from} and ${ev.from + ev.period} differ`);
      return pass(`the configuration at step ${ev.from} recurs at step ${ev.from + ev.period}`);
    }
    case 'translated': {
      if (v !== 'never') return fail('a translated cycler proves non-halting only');
      if (!blank) return fail('this checker re-checks translated cyclers from a blank tape only');
      const d = ev.direction === 'left' ? -1 : 1;
      const t1 = ev.from, t2 = ev.at, w = ev.window - 1;
      if (!(Number.isInteger(t1) && Number.isInteger(t2) && t2 > t1 && w >= 0)) return fail('the evidence is incomplete');
      const r = new Plain(m);
      const windowAt = () => Array.from({ length: w + 1 }, (_, i) => r.read(r.head - d * i));
      // A record: the head further out, in direction d, than at any step before.
      let best = 0;
      let first = null, back = null, bumped = false;
      for (;;) {
        const isRecord = r.t > 0 && r.head * d > best * d;
        if (r.t === t1) {
          if (!isRecord) return fail(`the head is not at a new record at step ${t1}`);
          first = { state: r.state, head: r.head, cells: windowAt() };
          back = r.head;
        }
        if (r.t === t2) {
          if (!isRecord) return fail(`the head is not at a new record at step ${t2}`);
          break;
        }
        if (r.head * d > best * d) best = r.head;
        r.bumped = false;
        if (!r.step()) return fail(`the machine halted at step ${r.t}`);
        if (r.t > t1) {
          if (r.bumped) bumped = true;
          back = d > 0 ? Math.min(back, r.head) : Math.max(back, r.head);
        }
      }
      if (r.state !== first.state) return fail('the two records are in different states');
      if ((first.head - back) * d > w) return fail(`between the records the head went ${Math.abs(first.head - back)} cells back, past the window of ${w + 1}`);
      const now = windowAt();
      if (now.some((c, i) => c !== first.cells[i])) return fail('the windows behind the head differ');
      if (bumped) return fail('the head was stopped by the wall between the records');
      const n = (k, noun) => `${k} ${noun}${k === 1 ? '' : 's'}`;
      return pass(`the ${n(w + 1, 'cell')} behind the head ${w === 0 ? 'recurs' : 'recur'} ${n(Math.abs(r.head - first.head), 'cell')} further ${d > 0 ? 'right' : 'left'}, every ${t2 - t1 === 1 ? 'step' : n(t2 - t1, 'step')}`);
    }
    case 'cps': {
      if (v !== 'never') return fail('a closed position set proves non-halting only');
      if (!blank || !m.twoWay) return fail('closed position sets are checked on a blank two-way tape only');
      return checkCps(m, ev);
    }
    case 'bound': {
      if (v !== 'never') return fail('the busy beaver bound proves non-halting only');
      const KNOWN = { '1,2': 1, '2,2': 6, '3,2': 21, '4,2': 107, '5,2': 47176870, '2,3': 38, '2,4': 3932964 };
      if (KNOWN[`${ev.n},${ev.k}`] !== ev.S) return fail(`S(${ev.n}, ${ev.k}) = ${ev.S} is not a proved value this checker knows`);
      if (!blank || !m.twoWay) return fail('the bound holds for a blank two-way tape only');
      let working = 0;
      for (let q = 0; q < m.Q; q++) if (!m.accept[q]) working++;
      if (working > ev.n || m.K > ev.k) return fail(`the machine has ${working} states and ${m.K} symbols, more than (${ev.n}, ${ev.k})`);
      for (let e = 0; e < m.Q * m.K; e++) if (m.next[e] >= 0 && m.move[e] === 0) return fail('the machine has a stay move, outside the busy beaver model');
      const r = new Plain(m);
      if (!r.runTo(ev.S + 1)) return fail(`the machine halted at step ${r.t}`);
      return pass(`ran ${ev.S + 1} steps without halting, past S(${ev.n}, ${ev.k}) = ${ev.S}`, 'the value of S is cited, not re-proved');
    }
    case 'far': {
      if (v !== 'never') return fail('finite automata reduction proves non-halting only');
      if (!blank || !m.twoWay) return fail('finite automata reduction is about a blank two-way tape');
      return checkFar(m, ev);
    }
    case 'segment': {
      if (v !== 'never') return fail('a halting segment proves non-halting only');
      if (!segment) return fail('a halting segment is re-checked by re-running the search, which needs the app loaded');
      const again = segment(m, ev.size);
      if (again.result === 'never' && again.nodes === ev.nodes) {
        return pass(`the halting segment search over ${ev.size} cells again closes, with ${ev.nodes} configurations and none the start could be`, false);
      }
      return fail('re-running the halting segment search did not reproduce the proof');
    }
    case 'loops':
    case 'ngram':
    case 'repwl':
    case 'bouncers': {
      // Coq-BB5's and bbchallenge's deciders, re-run with the parameters
      // the proof names: the closed set (or the certificate) is the proof.
      if (v !== 'never') return fail(`${proof.method} proves non-halting only`);
      if (!rederive) return fail(`${proof.method} is re-checked by re-running the decider, which needs the app loaded`);
      return rederive(m, proof.method, ev)
        ? pass(`re-running ${proof.method} with the proof's parameters decides it again`, false)
        : fail(`re-running ${proof.method} with the proof's parameters did not reproduce the proof`);
    }
    case 'backward': {
      if (!classify) return fail('backward reasoning is re-checked by re-running the search, which needs the app loaded');
      const again = classify(m);
      if (again.verdict === 'never' && again.method === 'backward' && again.longest === ev.longest) {
        return pass(`backward reasoning again finds no halting configuration more than ${ev.longest} steps back`, false);
      }
      return fail('re-running backward reasoning did not reproduce the proof');
    }
    case 'induction':
    case 'cycler-macro':
    case 'block-loop': {
      // Re-derived, like backward reasoning: the symbolic replay is the proof,
      // and re-running it is the check.
      if (!reprove) return fail('an inductive proof is re-checked by re-running the prover, which needs the app loaded');
      const again = reprove(m, ev);
      if (again && again.method === proof.method && again.B === ev.B) return pass(`the prover again finds the ${proof.method === 'induction' ? 'inductive rule' : proof.method} over blocks of ${ev.B}`, false);
      return fail('re-running the prover did not reproduce the proof');
    }
    default:
      return fail(`no checker for the method "${proof.method}"`);
  }
}

function checkCps(m, ev) {
  const n = ev.n, K = m.K;
  const left = new Set(ev.left || []), right = new Set(ev.right || []);
  const zero = '0'.repeat(n);
  if (!left.has(zero) || !right.has(zero)) return fail('the blank n-gram is missing from a gram set');
  const sym = c => c.toString(K);
  const seen = new Set();
  const queue = [[m.start, zero, 0, zero]];
  seen.add(`${m.start}|${zero}|0|${zero}`);
  const leftList = [...left], rightList = [...right];
  while (queue.length) {
    const [q, L, s, R] = queue.pop();
    if (m.accept[q]) return fail('a window in an accepting state is reachable');
    const e = q * K + s;
    if (m.next[e] < 0) return fail(`a halting window is reachable: state ${q} reading ${s}`);
    const to = m.next[e];
    if (m.accept[to]) return fail(`a window moving into a halt state is reachable`);
    const w = sym(m.write[e]);
    const succ = [];
    if (m.move[e] > 0) {
      const nL = L.slice(1) + w;
      if (!left.has(nL)) return fail(`the left gram set is not closed: ${nL} is formed and missing`);
      const ns = parseInt(R[0], K);
      for (const g of rightList) if (g.slice(0, n - 1) === R.slice(1)) succ.push([to, nL, ns, g]);
    } else if (m.move[e] < 0) {
      const nR = w + R.slice(0, n - 1);
      if (!right.has(nR)) return fail(`the right gram set is not closed: ${nR} is formed and missing`);
      const ns = parseInt(L[n - 1], K);
      for (const g of leftList) if (g.slice(1) === L.slice(0, n - 1)) succ.push([to, g, ns, nR]);
    } else succ.push([to, L, m.write[e], R]);
    for (const c of succ) {
      const k = c.join('|');
      if (!seen.has(k)) { seen.add(k); queue.push(c); }
    }
  }
  return pass(`${seen.size} windows of ${n} cells either side of the head are closed under δ and none halts`);
}

/**
 * A finite automata reduction proof, checked as bbchallenge's verifier
 * checks it. The NFA's states are n·q + f for DFA state q and working state
 * f (the table's non-halting states, in order), and ⊥ last; `nfa[b][i]` lists
 * the states reading b takes state i to.
 */
function checkFar(m, ev) {
  const K = m.K;
  const working = [];
  for (let q = 0; q < m.Q; q++) if (!m.accept[q]) working.push(q);
  const n = working.length, idx = new Map(working.map((q, i) => [q, i]));
  const dfa = ev.dfa, D = Array.isArray(dfa) ? dfa.length : 0;
  if (!D || dfa.some(row => !Array.isArray(row) || row.length !== K || row.some(x => !Number.isInteger(x) || x < 0 || x >= D))) return fail('the DFA is not a table of its own states');
  const N = n * D + 1, bot = N - 1;
  if (ev.states !== undefined && ev.states !== N) return fail(`the NFA should have ${N} states, not ${ev.states}`);
  const nfa = ev.nfa;
  if (!Array.isArray(nfa) || nfa.length !== K || nfa.some(T => !Array.isArray(T) || T.length !== N)) return fail('the NFA is not one transition list per symbol and state');
  const T = nfa.map(rows => rows.map(r => new Set(r)));
  const acc = new Set(ev.accepted || []);
  const node = (q, f) => n * q + idx.get(f);
  const scan = ev.side === 'L' ? -1 : ev.side === 'R' ? 1 : 0;
  if (!scan) return fail('the proof names no scan direction');
  // Condition 1: leading blanks are ignored.
  if (dfa[0][0] !== 0) return fail('the DFA does not ignore leading blanks: δ(0, 0) ≠ 0');
  // Condition 2: trailing blanks are ignored — T_0 a = a.
  for (let i = 0; i < N; i++) {
    const hits = [...T[0][i]].some(j => acc.has(j));
    if (hits !== acc.has(i)) return fail(`the accepted set is not closed under trailing blanks at state ${i}`);
  }
  // Conditions 3 and 4: the steady state ⊥ is accepted and stays.
  if (!acc.has(bot)) return fail('the steady state is not accepted');
  for (let b = 0; b < K; b++) if (!T[b][bot].has(bot)) return fail(`the steady state does not stay on reading ${b}`);
  // Condition 8: the start, (0, A), is not recognised.
  if (m.accept[m.start]) return fail('the start state halts');
  if (acc.has(node(0, m.start))) return fail('the start configuration is recognised');
  // Conditions 5–7: one per transition.
  const subset = (a, bSet) => { for (const x of a) if (!bSet.has(x)) return false; return true; };
  for (const f of working) {
    for (let r = 0; r < K; r++) {
      const e = f * K + r, to = m.next[e];
      if (to < 0 || m.accept[to]) {
        for (let q = 0; q < D; q++) if (!T[r][node(q, f)].has(bot)) return fail(`the halt (${f}, ${r}) is not recognised from DFA state ${q}`);
        continue;
      }
      const w = m.write[e], d = m.move[e];
      if (d === 0) return fail('the machine has a stay move, outside the model');
      if (d === scan) {
        for (let q = 0; q < D; q++) {
          if (!T[r][node(q, f)].has(node(dfa[q][w], to))) return fail(`the transition (${f}, ${r}) is not closed at DFA state ${q}`);
        }
      } else {
        for (let q = 0; q < D; q++) {
          for (let b = 0; b < K; b++) {
            const need = new Set();
            for (const j of T[b][node(q, to)]) for (const x of T[w][j]) need.add(x);
            if (!subset(need, T[r][node(dfa[q][b], f)])) return fail(`the transition (${f}, ${r}) is not closed at DFA state ${q} reading ${b}`);
          }
        }
      }
    }
  }
  return pass(`a ${D}-state DFA and ${N}-state NFA recognise every configuration that leads to a halt, and not the start`);
}
