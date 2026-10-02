// ══════════════════════════════════════════════════════════════════
//  BOUNCERS — bbchallenge's decider, ported
// ══════════════════════════════════════════════════════════════════
// The reference is bbchallenge-deciders/decider-bouncers-reproduction (Rust,
// after Tony Guilfoyle's decider), the last decider bbchallenge applied to
// its index before the BB(5) proof. This is a port of it: the directional
// tape (directional_tm/mod.rs), formula tapes (formula_tape/mod.rs), their
// alignment, shift-rule detection and special-case test, the greedy
// formula-tape guess, and the decider loop — so it decides the machines the
// reference decides, with the same certificate: the same formula tape, found
// at the same step, closing after the same number of macro steps.
//
// What it does. A bouncer sweeps back and forth over a tape that grows by a
// fixed word each sweep, so its run is, from some point, a formula tape —
// fixed words with repeated words `(w)` between them — that recurs with every
// repeater one copy longer. The decider:
//
//   1. runs the machine (a directional machine: the head sits between two
//      cells, facing one) and keeps, per head, every tape on which the head
//      is about to read fresh blank tape (a record);
//   2. for four records of one head whose lengths are evenly spaced and whose
//      step counts are a quadratic, fits a formula tape to the first three;
//   3. runs the formula tape: where the head faces a repeater it applies a
//      shift rule (the head crosses a whole repeater in one macro step,
//      proved by running the machine on one copy of it), and otherwise steps
//      the machine. If the formula tape returns to a special case of itself —
//      the same, with repeaters at least as long — it does so forever.
//
// Import-free and DOM-free.

import { bbMachine } from './bb-table.js';

/**
 * The reference's parameters for its BB(5) run (main.rs), and one of the
 * port's own: `recordCells` bounds the cells kept across all record tapes. The
 * reference keeps every record whole, which is fine on what it was run on —
 * machines the translated cyclers had already taken out — but a machine
 * that walks off down the tape breaks a record every step, and 250,000
 * growing copies would not fit in a page. Past the bound the answer is
 * unknown, said so; none of the reference's 32,632 machines comes near it.
 */
export const BOUNCER_LIMITS = { steps: 250000, macroSteps: 50000, formulas: 20, recordCells: 1 << 26 };

const INF = -1;     // TapeContent::InfiniteZero
const HEAD = -2;    // TapeContent::Head, whose value is in `head`
const R = 1, L = -1;

class Halted extends Error {}       // TMError::MachineHasHalted
class OutOfTape extends Error {}    // TMError::OutOfTapeError
class Invalid extends Error {}      // InvalidTapeError, InvalidFormulaTapeError, …
class NoShiftRule extends Error {}  // FormulaTapeError::NoShiftRule

// ── the directional tape ──────────────────────────────────────────

class Tape {
  constructor(m, c, headPos, head, stepCount = 0) {
    this.m = m;
    this.c = c;               // cells: INF, HEAD or a symbol
    this.headPos = headPos;
    this.head = head;         // { state, dir }
    this.stepCount = stepCount;
  }

  static initial(m) {
    return new Tape(m, [INF, HEAD, INF], 1, { state: m.start, dir: R });
  }

  clone() {
    return new Tape(this.m, this.c.slice(), this.headPos, { ...this.head }, this.stepCount);
  }

  get len() { return this.c.length; }

  // valid_tape_after_direction
  after(pos, dir) {
    const p = pos + dir;
    if (p < 0 || p >= this.c.length) throw new OutOfTape();
    return p;
  }

  content(pos) {
    if (pos >= this.c.length) throw new OutOfTape();
    const x = this.c[pos];
    if (x === INF) { if (pos === 0 || pos === this.c.length - 1) return INF; throw new Invalid(); }
    if (x === HEAD) { if (pos === this.headPos) return HEAD; throw new Invalid(); }
    return x;
  }

  readPos() {
    if (this.content(this.headPos) !== HEAD) throw new Invalid();
    return this.after(this.headPos, this.head.dir);
  }

  step() {
    let rp = this.readPos();
    const rc = this.content(rp);
    if (rc === HEAD) throw new Invalid();
    const sym = rc === INF ? 0 : rc;
    const { K, next, write, move } = this.m;
    const e = this.head.state * K + sym;
    if (next[e] < 0) throw new Halted();
    const nh = { state: next[e], dir: move[e] };
    if (rc === INF) {
      if (rp !== 0) this.c.push(INF);
      else { this.c.unshift(INF); this.headPos++; rp++; }
    }
    this.c[this.headPos] = HEAD;
    this.c[rp] = write[e];
    const same = this.head.dir === nh.dir;
    this.head = nh;
    if (same) {
      this.c[this.headPos] = this.c[rp];
      this.c[rp] = HEAD;
      this.headPos = this.after(this.headPos, nh.dir);
    }
    this.stepCount++;
  }

  // finite_words_left_right_of_head
  words() {
    const left = [];
    let i = 0;
    while (i < this.c.length && this.c[i] === INF) i++;
    for (; i < this.c.length && this.c[i] !== HEAD; i++) {
      if (this.c[i] === INF) throw new Invalid();
      left.push(this.c[i]);
    }
    const right = [];
    for (let j = this.headPos + 1; j < this.c.length && this.c[j] !== INF; j++) {
      if (this.c[j] === HEAD) throw new Invalid();
      right.push(this.c[j]);
    }
    return [left, right];
  }

  firstNonInf() { const i = this.c.findIndex(x => x !== INF); return i < 0 ? null : i; }
  lastNonInf() { for (let i = this.c.length - 1; i >= 0; i--) if (this.c[i] !== INF) return i; return null; }

  sub(start, end) {
    if (end <= start || end > this.c.length) return null;
    return new Tape(this.m, this.c.slice(start, end), this.headPos - start, { ...this.head }, this.stepCount);
  }

  toString() {
    let s = '';
    for (const x of this.c) {
      if (x === INF) s += '0∞';
      else if (x === HEAD) s += this.head.dir === R ? `${letter(this.head.state)}>` : `<${letter(this.head.state)}`;
      else s += x;
    }
    return s;
  }
}

const letter = q => String.fromCharCode(65 + q);
const headEq = (a, b) => a.state === b.state && a.dir === b.dir;
const arrEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Rust's `binary_search_by_key` (before 1.82, the version the reference was
// built with): Ok(index) or Err(insertion point). Keys here never repeat.
function bsearch(arr, key, keyOf) {
  let size = arr.length, left = 0, right = size;
  while (left < right) {
    const mid = left + (size >> 1);
    const k = keyOf(arr[mid]);
    if (k < key) left = mid + 1;
    else if (k > key) right = mid;
    else return { ok: true, i: mid };
    size = right - left;
  }
  return { ok: false, i: left };
}

// ── formula tapes ─────────────────────────────────────────────────

class FormulaTape {
  constructor(tape, reps) {
    this.tape = tape;
    this.reps = reps;    // [{ beg, end }], sorted
  }

  clone() { return new FormulaTape(this.tape.clone(), this.reps.map(r => ({ ...r }))); }

  word(i) {
    const r = this.reps[i];
    if (!r) throw new Invalid();
    const w = [];
    for (let p = r.beg; p < r.end; p++) {
      const x = this.tape.c[p];
      if (x === undefined || x < 0) throw new Invalid();
      w.push(x);
    }
    if (!w.length) throw new Invalid();
    return w;
  }

  isBeg(pos) { return bsearch(this.reps, pos, r => r.beg).ok; }
  isEnd(pos) { return bsearch(this.reps, pos, r => r.end).ok; }

  repRight(pos) {
    const b = bsearch(this.reps, pos, r => r.beg);
    if (b.ok) return this.reps[b.i];
    return b.i === this.reps.length ? null : this.reps[b.i];
  }

  repLeft(pos) {
    const b = bsearch(this.reps, pos, r => r.beg);
    if (b.ok) return this.reps[b.i];
    return b.i === 0 ? null : this.reps[b.i - 1];
  }

  facingRepeater() {
    const h = this.tape.head;
    if (this.tape.content(this.tape.headPos) !== HEAD) throw new Invalid();
    return (this.isBeg(this.tape.headPos + 1) && h.dir === R) || (this.isEnd(this.tape.headPos) && h.dir === L);
  }

  shiftRuleTape() {
    if (!this.facingRepeater()) throw new NoShiftRule();
    const hp = this.tape.headPos, dir = this.tape.head.dir;
    let beg, end;
    if (dir === R) {
      const lr = this.repLeft(hp);
      beg = lr ? lr.end : this.tape.firstNonInf();
      end = this.repRight(hp).end;
    } else {
      beg = this.repLeft(hp).beg;
      const rr = this.repRight(hp);
      end = rr ? rr.beg : this.tape.lastNonInf() + 1;
    }
    const t = this.tape.sub(beg, end);
    if (!t) throw new Invalid();
    return t;
  }

  detectShiftRule() {
    const st = this.shiftRuleTape();
    const initial = st.clone();
    const ih = { ...initial.head };
    const seen = new Set([initial.toString()]);
    const [lw, rw] = initial.words();
    const lhs = ih.dir === R ? rw : lw;
    if (!lhs.length) throw new Invalid();
    let minRead = st.readPos(), maxRead = minRead, steps = 0;
    for (;;) {
      try {
        st.step();
      } catch (e) {
        if (!(e instanceof OutOfTape)) throw e;
        if (!headEq(ih, st.head)) throw new NoShiftRule();
        const [fl, fr] = st.words();
        if (ih.dir === R) {
          if (minRead >= initial.headPos) {
            if (fl.length < lhs.length) throw new NoShiftRule();
            return { head: ih, tail: [], lhs, rhs: fl.slice(fl.length - lhs.length), steps };
          }
          const a = initial.sub(minRead, initial.len), b = st.sub(minRead, st.len);
          if (!a || !b) throw new NoShiftRule();
          const [tail] = a.words(), [repTail] = b.words();
          if (repTail.length < lhs.length || !arrEq(tail, repTail.slice(lhs.length))) throw new NoShiftRule();
          return { head: ih, tail, lhs, rhs: repTail.slice(0, lhs.length), steps };
        }
        if (maxRead <= initial.headPos) {
          if (fr.length < lhs.length) throw new NoShiftRule();
          return { head: ih, tail: [], lhs, rhs: fr.slice(0, lhs.length), steps };
        }
        const a = initial.sub(0, maxRead + 1), b = st.sub(0, maxRead + 1);
        if (!a || !b) throw new NoShiftRule();
        const [, tail] = a.words(), [, tailRep] = b.words();
        if (tailRep.length < tail.length || !arrEq(tail, tailRep.slice(0, tail.length))) throw new NoShiftRule();
        return { head: ih, tail, lhs, rhs: tailRep.slice(tail.length), steps };
      }
      const s = st.toString();
      if (seen.has(s)) throw new NoShiftRule();
      seen.add(s);
      let rp;
      try { rp = st.readPos(); } catch { rp = null; }
      if (rp !== null) { if (rp < minRead) minRead = rp; if (rp > maxRead) maxRead = rp; }
      steps++;
    }
  }

  applyShiftRule(rule) {
    if (!this.facingRepeater()) throw new Invalid();
    const dir = this.tape.head.dir, hp = this.tape.headPos;
    const lhsPos = dir === R ? this.repRight(hp) : this.repLeft(hp);
    const idx = bsearch(this.reps, lhsPos.beg, r => r.beg).i;
    const n = lhsPos.end - lhsPos.beg;
    const nb = dir === R ? lhsPos.beg - rule.tail.length - 1 : lhsPos.beg + rule.tail.length + 1;
    if (nb < 0) throw new Invalid();
    const np = { beg: nb, end: nb + n };
    this.reps[idx] = np;
    const c = this.tape.c;
    for (let i = 0; i < Math.min(n, rule.rhs.length); i++) c[lhsPos.beg + i] = rule.rhs[i];
    if (dir === R) {
      // rotate_right(n) on [np.beg, lhsPos.end)
      const seg = c.slice(np.beg, lhsPos.end);
      const rot = seg.slice(seg.length - n).concat(seg.slice(0, seg.length - n));
      for (let i = 0; i < rot.length; i++) c[np.beg + i] = rot[i];
      this.tape.headPos += n;
    } else {
      // rotate_left(n) on [lhsPos.beg, np.end)
      const seg = c.slice(lhsPos.beg, np.end);
      const rot = seg.slice(n).concat(seg.slice(0, n));
      for (let i = 0; i < rot.length; i++) c[lhsPos.beg + i] = rot[i];
      this.tape.headPos -= n;
    }
  }

  step() {
    if (!this.facingRepeater()) {
      const oldDir = this.tape.head.dir, oldLen = this.tape.len;
      this.tape.step();
      if (this.tape.len > oldLen && oldDir === L) for (const r of this.reps) { r.beg++; r.end++; }
      return null;
    }
    const rule = this.detectShiftRule();
    this.applyShiftRule(rule);
    return rule;
  }

  // finite_word_left_of_repeater
  leftOf(i) {
    const r = this.reps[i];
    if (!r) throw new Invalid();
    if (this.isEnd(r.beg)) return [];
    const w = [];
    for (let pos = r.beg - 1; pos >= 0; pos--) {
      const x = this.tape.c[pos];
      if (x === HEAD || x === INF) break;
      w.push(x);
      if (this.isEnd(pos)) break;
    }
    return w.reverse();
  }

  // finite_word_right_of_repeater
  rightOf(i) {
    const r = this.reps[i];
    if (!r) throw new Invalid();
    const w = [];
    for (let pos = r.end; pos < this.tape.len && !this.isBeg(pos); pos++) {
      const x = this.tape.c[pos];
      if (x === HEAD || x === INF) break;
      w.push(x);
    }
    return w;
  }

  align() {
    for (let i = 0; i < this.reps.length; i++) {
      const rw = this.word(i), r = this.reps[i];
      if (r.beg > this.tape.headPos) break;
      if (r.beg === this.tape.headPos) throw new Invalid();
      const lw = this.leftOf(i);
      for (let k = 0; k < lw.length; k++) {
        const suffix = lw.slice(k);
        const comp = suffix.concat(rw);
        if (arrEq(comp.slice(rw.length), suffix)) {
          this.reps[i] = { beg: r.beg - suffix.length, end: r.end - suffix.length };
          break;
        }
      }
    }
    for (let i = this.reps.length - 1; i >= 0; i--) {
      const rw = this.word(i), r = this.reps[i];
      if (r.beg < this.tape.headPos) break;
      if (r.beg <= this.tape.headPos) throw new Invalid();
      const rw2 = this.rightOf(i);
      for (let k = rw2.length; k >= 1; k--) {
        const prefix = rw2.slice(0, k);
        const comp = rw.concat(prefix);
        if (arrEq(comp.slice(0, prefix.length), prefix)) {
          this.reps[i] = { beg: r.beg + prefix.length, end: r.end + prefix.length };
          break;
        }
      }
    }
  }

  isSpecialCaseOf(model) {
    if (!headEq(this.tape.head, model.tape.head)) return false;
    const a = this.clone(); a.align();
    const b = model.clone(); b.align();
    if (a.reps.length !== b.reps.length) return false;
    if (!a.reps.length) throw new Invalid();
    if (a.reps[0].beg < a.tape.headPos) {
      if (!arrEq(a.leftOf(0), b.leftOf(0))) return false;
    } else if (!arrEq(a.tape.c.slice(0, a.tape.headPos), b.tape.c.slice(0, b.tape.headPos))) return false;

    for (let i = 0; i < this.reps.length; i++) {
      const rw = this.word(i), r = this.reps[i];
      if (r.beg > this.tape.headPos) break;
      if (r.beg === this.tape.headPos) throw new Invalid();
      const sw = a.rightOf(i), mw = b.rightOf(i);
      if (mw.length > sw.length) return false;
      if ((sw.length - mw.length) % rw.length) return false;
      const reps = (sw.length - mw.length) / rw.length;
      if (!arrEq(sw.slice(reps * rw.length), mw)) return false;
      for (let j = 0; j < reps * rw.length; j++) if (sw[j] !== rw[j % rw.length]) return false;
    }
    for (let i = this.reps.length - 1; i >= 0; i--) {
      const rw = this.word(i), r = this.reps[i];
      if (r.beg < this.tape.headPos) break;
      if (r.beg <= this.tape.headPos) throw new Invalid();
      const sw = a.leftOf(i), mw = b.leftOf(i);
      if (mw.length > sw.length) return false;
      if ((sw.length - mw.length) % rw.length) return false;
      const reps = (sw.length - mw.length) / rw.length;
      if (!arrEq(sw.slice(0, mw.length), mw)) return false;
      for (let j = 0; j < reps * rw.length; j++) if (sw[mw.length + j] !== rw[j % rw.length]) return false;
    }
    const last = a.reps.length - 1;
    if (a.reps[last].beg > a.tape.headPos) {
      if (!arrEq(a.rightOf(last), b.rightOf(b.reps.length - 1))) return false;
    } else if (!sameCells(a.tape, a.tape.headPos, b.tape, b.tape.headPos)) return false;
    return true;
  }

  proveNonHalt(macroLimit) {
    const initial = this.clone();
    this.align();
    for (let k = 0; k < macroLimit; k++) {
      this.step();
      this.align();
      if (this.isSpecialCaseOf(initial)) return k + 1;
    }
    return null;
  }

  // As the reference's published certificates print it, blank tape as `.`.
  toString() {
    let s = '';
    this.tape.c.forEach((x, i) => {
      if (x === INF) s += '.';
      else if (x === HEAD) s += this.tape.head.dir === R ? `${letter(this.tape.head.state)}>` : `<${letter(this.tape.head.state)}`;
      else {
        const b = this.isBeg(i), e = this.isEnd(i + 1);
        s += b && e ? `(${x})` : b ? `(${x}` : e ? `${x})` : `${x}`;
      }
    });
    return s;
  }
}

// The tails from `from` on, compared cell for cell — a head compared as a head.
function sameCells(ta, fa, tb, fb) {
  if (ta.c.length - fa !== tb.c.length - fb) return false;
  for (let i = 0; i < ta.c.length - fa; i++) {
    const x = ta.c[fa + i], y = tb.c[fb + i];
    if (x !== y) return false;
    if (x === HEAD && !headEq(ta.head, tb.head)) return false;
  }
  return true;
}

// ── guessing a formula tape from three records ────────────────────

const symbolsOf = t => Array.from(t.cells.filter(x => x >= 0));

// A record as the guess reads it: its length, step count and head, and its
// cells a byte each (INF and HEAD fit in an Int8).
const snapshot = t => ({ len: t.len, stepCount: t.stepCount, head: { ...t.head }, cells: Int8Array.from(t.c) });

function protoToFormula(m, head, proto) {
  const content = [], reps = [];
  const offset = head.dir === L ? 2 : 1;
  let repOffset = 0;
  proto.forEach((atom, i) => {
    if (typeof atom === 'number') content.push(atom);
    else {
      content.push(...atom);
      reps.push({ beg: offset + repOffset + i, end: offset + repOffset + i + atom.length });
      repOffset += atom.length - 1;
    }
  });
  const c = head.dir === L ? [INF, HEAD, ...content, INF] : [INF, ...content, HEAD, INF];
  const tape = new Tape(m, c, head.dir === L ? 1 : content.length + 1, { ...head });
  return new FormulaTape(tape, reps);
}

// fit_formula_tape_from_triple_greedy_iterative_implem
function fitGreedy(m, t0, t1, t2) {
  const head = { ...t0.head };
  const a = symbolsOf(t0), b = symbolsOf(t1), c = symbolsOf(t2);
  const proto = [];
  let p0 = 0, total = 0;
  outer: for (;;) {
    const p1 = p0 + total, p2 = p0 + 2 * total;
    if (p0 === a.length && p1 === b.length) return protoToFormula(m, head, proto);
    if (p0 < a.length && p1 < b.length && p2 < c.length && a[p0] === b[p1] && b[p1] === c[p2]) {
      proto.push(a[p0]);
      p0++;
      continue;
    }
    const rem0 = a.length - p0, rem1 = b.length - p1;
    let longest = 0;
    while (longest < rem1 - rem0 && p1 + longest < b.length && p2 + longest < c.length && b[p1 + longest] === c[p2 + longest]) longest++;
    for (let k = longest; k >= 1; k--) {
      let ok = p2 + 2 * k <= c.length;
      for (let j = 0; ok && j < k; j++) if (c[p2 + j] !== c[p2 + k + j]) ok = false;
      if (ok) {
        proto.push(b.slice(p1, p1 + k));
        total += k;
        continue outer;
      }
    }
    return null;
  }
}

const isQuadratic = (a, b, c, d) => (c - b) - (b - a) === (d - c) - (c - b);

function solveForHead(tapes, macroLimit, formulaLimit, m) {
  if (tapes.length < 4) return null;
  let tested = 0;
  for (let i = 3; i < tapes.length; i++) {
    const t4 = tapes[i];
    for (let j = 2; j < i; j++) {
      const t3 = tapes[j];
      const diff = t4.len - t3.len;
      const len2 = t3.len - diff;
      if (len2 < 0) continue;
      const b2 = bsearch(tapes, len2, t => t.len);
      if (!b2.ok) continue;
      const t2 = tapes[b2.i];
      const len1 = t2.len - diff;
      if (len1 < 0) continue;
      const b1 = bsearch(tapes, len1, t => t.len);
      if (!b1.ok) continue;
      const t1 = tapes[b1.i];
      if (!isQuadratic(t1.stepCount, t2.stepCount, t3.stepCount, t4.stepCount)) continue;
      const ft = fitGreedy(m, t1, t2, t3);
      if (!ft) continue;
      const formula = ft.toString();
      let macro = null;
      try { macro = ft.proveNonHalt(macroLimit); } catch { macro = null; }
      if (macro !== null) return { formula, steps: t3.stepCount, macroSteps: macro };
      if (++tested === formulaLimit) return null;
    }
  }
  return null;
}

/**
 * The reference's `bouncers_decider(machine, steps, macroSteps, formulas)`.
 * Returns { result: 'never', formula, steps, macroSteps } — the certificate
 * as the reference prints it: the formula tape, the step it was read off at,
 * and the macro steps until it recurred as a special case of itself —
 * { result: 'halt' } when the run halts within `steps`, { result: 'unknown' },
 * or { result: 'model', why }.
 */
export function bouncers(p, { steps = BOUNCER_LIMITS.steps, macroSteps = BOUNCER_LIMITS.macroSteps, formulas = BOUNCER_LIMITS.formulas, recordCells = BOUNCER_LIMITS.recordCells } = {}) {
  const m = bbMachine(p);
  if (m.why) return { result: 'model', why: m.why };
  const tape = Tape.initial(m);
  const records = new Map();
  const keyOf = h => h.state * 2 + (h.dir === R ? 1 : 0);   // TapeHead's Ord: state, then LEFT < RIGHT
  records.set(keyOf(tape.head), [snapshot(tape)]);
  let kept = tape.len;
  try {
    for (let s = 0; s < steps; s++) {
      tape.step();
      const rp = tape.readPos();
      if (rp === 0 || rp === tape.len - 1) {
        const k = keyOf(tape.head);
        if (!records.has(k)) records.set(k, []);
        records.get(k).push(snapshot(tape));
        kept += tape.len;
        if (kept > recordCells) return { result: 'unknown', reason: 'records' };
      }
    }
  } catch (e) {
    if (e instanceof Halted) return { result: 'halt' };
    throw e;
  }
  for (const k of [...records.keys()].sort((a, b) => a - b)) {
    const cert = solveForHead(records.get(k), macroSteps, formulas, m);
    if (cert) return { result: 'never', ...cert };
  }
  return { result: 'unknown' };
}
