// ══════════════════════════════════════════════════════════════════
//  CHECKING A PROOF WITHOUT TRUSTING THE PROVER
// ══════════════════════════════════════════════════════════════════
// A proof file (written by `automata halts --proof`) carries the machine as a
// table and the evidence its method produced. This module re-checks that
// evidence and shares no code with the deciders: its own tape (a Map), its own
// stepper, its own reading of the standard notation. A bug in the classifier
// would have to be made twice, the same way, to get past it.
//
//   simulation   run exactly `steps` transitions; the next one must halt
//   cycler       the configurations at μ and μ + λ must be identical
//   translated   two records in the same state, the window behind the head
//                identical, the head never further back than the window
//                between them — so the period repeats forever, shifted
//   cps          the gram sets must be closed under δ from the blank start,
//                with no halting window — checked by exploring with the sets
//                frozen, so a set that is not closed is caught, not repaired
//   bound        run S + 1 transitions without halting, in the model the
//                busy beaver value is proved for (cited, not re-proved)
//   backward     the one method re-checked by the prover itself: the app's
//                backward search is re-run with the same limits. Said so.

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

export function checkProof(proof, { classify = null } = {}) {
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
      const r = new Plain(m);
      (proof.input || []).forEach((c, x) => c && r.tape.set(x, c));
      if (!r.runTo(ev.steps)) return fail(`the machine halted before step ${ev.steps}`);
      if (r.step()) return fail(`the machine did not halt after step ${ev.steps}`);
      return pass(`halts after exactly ${ev.steps} steps`);
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
      return pass(`the ${w + 1} cells behind the head recur ${Math.abs(r.head - first.head)} cells further ${d > 0 ? 'right' : 'left'}, every ${t2 - t1} steps`);
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
    case 'backward': {
      if (!classify) return fail('backward reasoning is re-checked by re-running the search, which needs the app loaded');
      const again = classify(m);
      if (again.verdict === 'never' && again.method === 'backward' && again.longest === ev.longest) {
        return pass(`backward reasoning again finds no halting configuration more than ${ev.longest} steps back`, false);
      }
      return fail('re-running backward reasoning did not reproduce the proof');
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
