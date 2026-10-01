// ══════════════════════════════════════════════════════════════════
//  HALTING SEGMENT — bbchallenge's decider, ported
// ══════════════════════════════════════════════════════════════════
// The reference is bbchallenge's reproduction of Iijil's decider,
// bbchallenge-deciders/decider-halting-segment-reproduction (Rust), and this
// is a line-for-line port of it: the same nodes, the same neighbours in the
// same order, the same breadth-first walk over an insertion-ordered set, and
// the same strategy — odd segment sizes 3, 5, …, 2·d + 1, the halt in the
// middle, no node limit — so it decides exactly the machines the reference
// does and expands exactly as many nodes doing it.
//
// The idea (backward reasoning, but finite). Fix a segment of S cells and
// look at the tape only through it. A node is what is known of a
// configuration: the cells of the segment that are known (the rest
// unallocated), and either the state and the head's cell in the segment, or
// "outside" — the head is somewhere beyond the segment's edge, in any state.
// Start from every halting configuration — a state reading a symbol it has
// no transition for (or one into a halt state) — with the head mid-segment.
// A node's neighbours are its possible predecessors one step back:
//
//   inside   every transition into this node's state whose write agrees with
//            the cell the head came from, and whose move put the head here;
//            one that came in from beyond the edge gives an outside node
//   outside  every transition that would carry the head off the segment from
//            its edge cell, writing what that cell holds
//
// Walk the set closed. If it never meets a node the start could be — no
// non-blank cell in the segment, and the head outside it or in the start
// state there — then no configuration that leads to a halt can be reached
// from a blank tape, and the machine never halts. A node that could be the
// start ends that segment size; the next, wider one is tried.
//
// It is about the busy beaver model, as the reference is: a blank two-way
// tape, L and R moves only. Anything else is refused, not approximated.
//
// Import-free and DOM-free: it reads the classifier's table (tm-behaviour.js)
// and nothing else.

/** The reference's default: segments up to 2·5 + 1 = 11 cells. */
export const HALTING_SEGMENT_DISTANCE = 5;

const OUTSIDE = -1;

/**
 * Whether the table is in the model the decider is about: a blank two-way
 * tape and L/R moves. Returns null when it is, else a sentence saying why not.
 */
export function haltingSegmentModel(p) {
  if (!p.twoWay) return 'it is about a two-way tape';
  if (p.input.some(c => c !== 0)) return 'it is about a blank starting tape';
  if (p.accept[p.start]) return 'the start state halts at once';
  for (let q = 0; q < p.Q; q++) {
    if (p.accept[q]) continue;
    for (let c = 0; c < p.K; c++) {
      const e = q * p.K + c;
      if (p.next[e] >= 0 && !p.accept[p.next[e]] && p.move[e] === 0) return 'it is about L and R moves only';
    }
  }
  return null;
}

/**
 * One segment size: the reference's `halting_segment_decider`. Returns
 * { result: 'never' | 'start' | 'nodes', nodes } — `nodes` is the reference's
 * `idx_seen`, the nodes taken from the set when it stopped.
 */
export function haltingSegmentRun(p, size, initialPos, { nodeLimit = Infinity } = {}) {
  const { Q, K, next, write, move, accept, start } = p;
  // A segment is a number in base K + 1, one digit a cell: 0 unallocated, c + 1
  // the symbol c. A node's key is that number with the state and the head's
  // cell folded in, so the set holds numbers, not strings.
  const B = K + 1;
  const pow = [1];
  for (let i = 1; i <= size; i++) pow.push(pow[i - 1] * B);
  if (pow[size] * size * (Q + 1) > Number.MAX_SAFE_INTEGER) return { result: 'size', nodes: 0 };
  const cell = (seg, i) => (Math.floor(seg / pow[i]) % B) - 1;
  const setCell = (seg, i, c) => seg + (c + 1 - (Math.floor(seg / pow[i]) % B)) * pow[i];
  const noOnes = seg => {
    for (let i = 0; i < size; i++) if (cell(seg, i) > 0) return false;
    return true;
  };

  const nodeState = [], nodeSeg = [], nodePos = [];
  const seen = new Set();
  const add = (state, seg, pos) => {
    const key = ((state + 1) * size + pos) * pow[size] + seg;
    if (seen.has(key)) return;
    seen.add(key);
    nodeState.push(state); nodeSeg.push(seg); nodePos.push(pos);
  };

  // The reference's rules, in its order: state, then the symbol read.
  // A transition into a halt state is a halt, as `1RZ` is `---` there.
  const halts = (q, r) => next[q * K + r] < 0 || accept[next[q * K + r]];
  const working = [];
  for (let q = 0; q < Q; q++) if (!accept[q]) working.push(q);

  // get_initial_nodes
  for (const q of working) {
    for (let r = 0; r < K; r++) {
      if (halts(q, r)) add(q, setCell(0, initialPos, r), initialPos);
    }
  }

  const last = size - 1;
  let idx = 0;
  while (idx < nodeState.length) {
    const state = nodeState[idx], seg = nodeSeg[idx], pos = nodePos[idx];
    idx++;
    // is_fatal: a node the blank start could be.
    if ((state === OUTSIDE || state === start) && noOnes(seg)) return { result: 'start', nodes: idx };
    if (idx > nodeLimit) return { result: 'nodes', nodes: idx };

    // get_neighbours; the reference dedups within a node's list and then
    // again across the set, and `add` does both.
    if (state === OUTSIDE) {
      for (const f of working) {
        for (let r = 0; r < K; r++) {
          if (halts(f, r)) continue;
          const e = f * K + r;
          // It must carry the head off the segment from its edge.
          if (!((pos === 0 && move[e] < 0) || (pos === last && move[e] > 0))) continue;
          const here = cell(seg, pos);
          if (here >= 0 && here !== write[e]) continue;
          add(f, setCell(seg, pos, r), pos);
        }
      }
    } else {
      for (const f of working) {
        for (let r = 0; r < K; r++) {
          if (halts(f, r)) continue;
          const e = f * K + r;
          if (next[e] !== state) continue;
          // Case 1: the head came in from beyond the edge. The position is
          // not updated, as in the reference.
          if ((pos === 0 && move[e] > 0) || (pos === last && move[e] < 0)) {
            add(OUTSIDE, seg, pos);
            continue;
          }
          // Case 2: it came from the neighbouring cell, which must hold what
          // the transition wrote, and held what it read.
          const from = move[e] > 0 ? pos - 1 : pos + 1;
          const there = cell(seg, from);
          if (there >= 0 && there !== write[e]) continue;
          add(f, setCell(seg, from, r), from);
        }
      }
    }
  }
  return { result: 'never', nodes: idx };
}

/**
 * The decider: the reference's `Iijil_strategy_updated`. Odd sizes 2d + 1 for
 * d = 1 … `distance`, starting mid-segment, stopping at the first proof.
 *
 * Returns { ok: true, size, distance, nodes, tried } when a segment size
 * proves the machine never halts — `nodes` is the size of the closed set,
 * `tried` what each smaller size expanded before it met the start — and
 * { ok: false, reason, tried } when none does: 'start' (every size met a node
 * the start could be), 'nodes' (`nodeLimit` was reached; the reference has
 * none, so its answer is not known), or 'model' with `why`.
 */
export function haltingSegment(p, { distance = HALTING_SEGMENT_DISTANCE, nodeLimit = Infinity } = {}) {
  const why = haltingSegmentModel(p);
  if (why) return { ok: false, reason: 'model', why, tried: [] };
  const tried = [];
  for (let d = 1; d <= distance; d++) {
    const size = 2 * d + 1;
    const r = haltingSegmentRun(p, size, d, { nodeLimit });
    if (r.result === 'never') return { ok: true, size, distance: d, nodes: r.nodes, tried };
    tried.push({ size, nodes: r.nodes, result: r.result });
    if (r.result === 'nodes' || r.result === 'size') return { ok: false, reason: r.result, tried };
  }
  return { ok: false, reason: 'start', tried };
}
