// ══════════════════════════════════════════════════════════════════
//  THE FAST LANE — a deterministic one-tape run as a table and a loop
// ══════════════════════════════════════════════════════════════════
// streamTM spends about 300ns a step, and none of it on the machine: a Map
// tape of strings, a transition lookup by state name and symbol, a reactive
// Set asked whether the state accepts, a fingerprint hashed for the loop
// detector, two calls into the tape log and one into the step columns, and a
// generator handing the step over. Measured on the five-state busy beaver,
// that is 14 seconds to its halt; the same steps as table lookups over a byte
// array take a fifth of a second.
//
// So once the loop detector has stopped looking (it gives up after
// LOOP_TRACK_MAX configurations, and is off when the reader turned it off),
// streamTM hands the rest of the run to this: states and symbols as small
// integers, δ as flat typed arrays filled in the first time each (state,
// symbol) pair is met, and the tape as the log's own copy of it in codes.
// Steps are recorded straight into the log's and the step columns' arrays —
// the same entries, in the same order, `begin`/`noteWrite`/`step` would have
// made — so nothing downstream can tell which loop produced a step.
// tests/fast-tm.test.js holds it to that, column for column.
//
// **A batch is as many steps as the cursor asked for, and no more.** The run
// cursor says how many it wants (see `batch` in js/machines/run.js); a drain
// asks for a slice, playback for one. The last step of a batch is handed over
// *before* its write, exactly as the slow loop yields a step before writing,
// so a run paused on it is in the same state either way.
//
// **The table is re-checked every time the cursor comes back.** The app does
// not reset a paused run when the machine is edited, and the slow loop carries
// on under the edit — though not under every edit. *Which* transition fires is
// fixed per state the first time the run is in it (`singleTapeLookup` builds a
// state's row once and keeps it for the run), so the table can fill an entry
// the first time it is met and never ask again. But the slow loop reads the
// chosen transition's `to`, `write` and `dir` off the object on every step, and
// asks `App.accepts` every step, so an edit to either shows up from the next
// step on. The table copies those, so before each batch it compares its copies
// with the objects and re-reads the accepting marks, and starts over if
// anything moved. An edit cannot land inside a batch: a batch is synchronous.
//
// **A single step skips the table altogether.** Playback asks for one step at
// a time, and a re-check per step would cost more than the step: it made
// playback at Max 2.8× slower before this path existed. So a batch of one is
// answered the way the slow loop answers it — the lookup and the accepting
// set asked directly, the transition's fields read on resume — with only the
// Map tape and the fingerprint gone.

import { App } from '../state.js';
import { DELETED, NO_WRITE } from '../tape-log.js';
import { batch } from './run.js';
import { markTimeoutStep } from './runtime.js';

// Whether streamTM may hand over at all. A seam for `setJumpRoute`'s reason:
// the fast lane is on for every long run, so the slow loop past step 5,000 is
// a path nothing would otherwise test — and the slow loop is the oracle
// tests/fast-tm.test.js holds this one to.
let enabled = true;

export function setFastLane(on) {
  enabled = on !== false;
  return enabled;
}

export const fastLaneEnabled = () => enabled;

const UNRESOLVED = -2;
const NONE = -1;   // no transition fires: the step rejects
const SAME = -1;   // the write puts back what was read (no write, or the wildcard)

const moveOf = dir => (dir === 'R' ? 1 : dir === 'L' ? -1 : 0);

/**
 * The rest of a streamTM run, from step `n`.
 *
 * @param ctx.log, ctx.cols  the run's tape log and step columns
 * @param ctx.fires          the slow loop's transition lookup, (state, sym) → t
 * @param ctx.blank          the blank symbol
 * @param ctx.twoWay         whether the head may go left of cell 0
 * @param ctx.n              the index of the next step
 * @param ctx.state, ctx.via the state at step n and the transition into it
 * @param ctx.head           the head at step n
 * @param ctx.last           the step handed over most recently, which the
 *                           budget running out is stamped on
 * @param ctx.want           how many steps the cursor last asked for
 */
export function* fastTM({ log, cols, fires, blank, twoWay, n, state, via, head, last, want }) {
  const A = log.appender();
  const { live, heads, reads, writes, syms, blankCode } = A;
  const { states, tids, stateCol, tidCol } = cols.appender();
  const vals = syms.values;
  const tidCode = id => (id === null || id === undefined ? 0 : tids.code(id));

  // ── states, by index ──────────────────────────────────────────────
  // Interned into the step columns only when a step is first recorded in
  // them, as the slow loop does, so the two agree on every code.
  const ids = [], index = new Map(), scode = [], acc = [];
  function idxOf(id) {
    let k = index.get(id);
    if (k === undefined) {
      k = ids.length;
      index.set(id, k);
      ids.push(id);
      scode.push(-1);
      acc.push(App.accepts.has(id) ? 1 : 0);
    }
    return k;
  }

  // ── δ, as flat arrays over (state << kbits) | symbol code ─────────
  let kbits = 3, Q = 8;
  let nxt, wr, mv, tc, tobj, tsnap, filled;
  function allocate() {
    const size = Q << kbits;
    nxt = new Int32Array(size).fill(UNRESOLVED);
    wr = new Int32Array(size);
    mv = new Int8Array(size);
    tc = new Int32Array(size);
    tobj = new Array(size);
    tsnap = new Array(size);
    filled = [];
  }
  // Room for state index s and symbol code c. Growing empties the table;
  // refilling it interns nothing new, since everything it names already is.
  function ensure(s, c) {
    if (s < Q && c < 1 << kbits) return;
    while (s >= Q) Q *= 2;
    while (c >= 1 << kbits) kbits++;
    allocate();
  }
  allocate();

  let any = App.config.sym.any;
  const snapshot = t => (t ? [t.to, t.write, t.dir, t.id] : null);
  const same = (t, snap) => (t === null ? snap === null : snap !== null &&
    t.to === snap[0] && t.write === snap[1] && t.dir === snap[2] && t.id === snap[3]);

  // Fill the entry for state s reading code c. Returns the next state index,
  // or NONE. The symbol a write names is interned here, which is the step that
  // first writes it — where the slow loop's noteWrite interns it.
  function resolve(s, c) {
    const t = fires(ids[s], vals[c]) ?? null;
    let to = NONE, w = SAME, d = 0, id = 0;
    if (t) {
      to = idxOf(t.to);
      w = (!t.write || t.write === any) ? SAME : (t.write === blank ? 0 : syms.code(t.write));
      d = moveOf(t.dir);
      id = tidCode(t.id);
    }
    ensure(Math.max(s, to), Math.max(c, w));
    const e = (s << kbits) | c;
    nxt[e] = to; wr[e] = w; mv[e] = d; tc[e] = id;
    tobj[e] = t; tsnap[e] = snapshot(t);
    filled.push(e);
    return to;
  }

  // Everything the table copied, looked at again — see the header for why the
  // lookup itself need not be.
  function revalidate() {
    for (let k = 0; k < ids.length; k++) acc[k] = App.accepts.has(ids[k]) ? 1 : 0;
    let stale = App.config.sym.any !== any;
    for (let k = 0; !stale && k < filled.length; k++) {
      const e = filled[k];
      stale = !same(tobj[e], tsnap[e]);
    }
    if (stale) { any = App.config.sym.any; allocate(); }
  }

  // ── the loop ──────────────────────────────────────────────────────
  let s = idxOf(state), h = head, i = n, tid = tidCode(via);
  // What the batch left for the resume: how it ended, and the last step's read.
  let ended = null, lastC = 0, lastRc = 0, lastT = null;

  // A step's five numbers go into these first and into the columns a block at
  // a time: five typed-array stores a step instead of five calls, each with a
  // chunk lookup and a widening check. Nothing reads the columns while a batch
  // runs — it is synchronous — so they are whole again before anyone could.
  const BUF = 4096;
  const hB = new Int32Array(BUF), rB = new Uint32Array(BUF), wB = new Uint32Array(BUF);
  const sB = new Uint32Array(BUF), tB = new Uint32Array(BUF);
  function flush(n) {
    if (n === 0) return;
    heads.pushMany(hB, n);
    reads.pushMany(rB, n);
    writes.pushMany(wB, n);
    stateCol.pushMany(sB, n);
    tidCol.pushMany(tB, n);
  }

  // Record up to `lim` steps from step i. Stops early at an accepting state or
  // a missing transition. Every step but the last is written and moved; the
  // last is recorded with no write yet, which `finish` supplies on resume.
  function run(lim) {
    let S = s, H = h, I = i, T = tid;
    let nextCp = A.nextCheckpoint;
    let K = kbits, N = nxt, W = wr, M = mv, C = tc;
    let count = 0, b = 0;
    // Locals, not the closure's: a context-slot load per store adds up here.
    const hb = hB, rb = rB, wb = wB, sb = sB, tb = tB, sc_ = scode, ac = acc, blk = blankCode, two = twoWay;
    // The tape read straight out of its buffer; re-read after any write that
    // may have grown it.
    let tbuf = live.buf, tbase = live.base, tlen = tbuf.length;
    ended = null;
    for (;;) {
      if (b === BUF) { flush(b); b = 0; }
      if (I >= nextCp) nextCp = A.checkpoint(I);
      const tk = H - tbase;
      const c = tk >= 0 && tk < tlen ? tbuf[tk] : 0;
      const rc = c === 0 ? blk : c;
      hb[b] = H;
      rb[b] = rc;
      let sc = sc_[S];
      if (sc < 0) sc = sc_[S] = states.code(ids[S]);
      sb[b] = sc;
      tb[b] = T;
      count++;
      if (ac[S] === 1) { wb[b++] = NO_WRITE; ended = 'accept'; break; }
      if (S >= Q || rc >= 1 << K) { ensure(S, rc); K = kbits; N = nxt; W = wr; M = mv; C = tc; }
      let e = (S << K) | rc;
      let to = N[e];
      if (to === UNRESOLVED) {
        to = resolve(S, rc);
        K = kbits; N = nxt; W = wr; M = mv; C = tc;
        e = (S << K) | rc;
      }
      if (to === NONE) { wb[b++] = NO_WRITE; ended = 'reject'; break; }
      if (count === lim) {
        wb[b++] = NO_WRITE;
        lastC = c; lastRc = rc; lastT = tobj[e];
        break;
      }
      const w = W[e];
      const now = w === SAME ? (rc === blk ? 0 : rc) : w;
      wb[b++] = now === 0 ? DELETED : now + 1;
      // The one cell whose read does not say what it held: an explicit blank
      // from the input, where the blank is otherwise the absence of a cell.
      if (c === blk) A.undoException(I, c);
      // A cell left as it was needs no store — the log has the write either way.
      if (now !== c) { live.set(H, now); tbuf = live.buf; tbase = live.base; tlen = tbuf.length; }
      T = C[e];
      S = to;
      const d = M[e];
      if (two || H + d >= 0) H += d;
      I++;
    }
    flush(b);
    s = S; h = H; i = I; tid = T;
    return count;
  }

  // A batch of one, asked the way the slow loop asks: see the header.
  function one() {
    const I = i;
    if (I >= A.nextCheckpoint) A.checkpoint(I);
    const c = live.get(h);
    const rc = c === 0 ? blankCode : c;
    heads.push(h);
    reads.push(rc);
    let sc = scode[s];
    if (sc < 0) sc = scode[s] = states.code(ids[s]);
    stateCol.push(sc);
    tidCol.push(tid);
    writes.push(NO_WRITE);
    ended = null;
    if (App.accepts.has(ids[s])) { ended = 'accept'; return 1; }
    const t = fires(ids[s], vals[rc]) ?? null;
    if (!t) { ended = 'reject'; return 1; }
    lastC = c; lastRc = rc; lastT = t;
    return 1;
  }

  // The last step of a batch writes and moves now, as the slow loop does after
  // its yield — from the transition object as it stands, since that is what
  // the slow loop reads on resume.
  function finish() {
    const t = lastT;
    const sym = vals[lastRc];
    const put = (!t.write || t.write === App.config.sym.any) ? sym : t.write;
    const now = put === blank ? 0 : syms.code(put);
    writes.set(i, now === 0 ? DELETED : now + 1);
    if (lastC === blankCode) A.undoException(i, lastC);
    live.set(h, now);
    tid = tidCode(t.id);
    s = idxOf(t.to);
    const d = moveOf(t.dir);
    if (twoWay || h + d >= 0) h += d;
    i++;
  }

  for (;;) {
    const max = App.config.maxTmSteps;
    if (i >= max) {
      if (last && !last.final) markTimeoutStep(last);
      return;
    }
    const lim = Math.min(want >= 1 ? want : 1, max - i);
    let count;
    if (lim === 1) count = one();
    else { revalidate(); count = run(lim); }
    const step = cols.at(i);
    if (ended === 'accept') { step.final = 'accept'; step.note += ' — ACCEPT'; }
    else if (ended === 'reject') { step.final = 'reject'; step.note += ' — REJECT'; }
    last = step;
    want = yield count === 1 ? step : batch(count, step, cols.at);
    if (ended) return;
    finish();
  }
}
