// bbchallenge's reference deciders, ported: halting segment
// (js/machines/halting-segment.js) and finite automata reduction
// (js/machines/far.js), the seed database's format (cli/tm/seed-db.mjs), and
// bbchallenge's step count.
//
// "Matches the reference" is pinned against the reference's own output, not
// against this code's idea of itself:
//
//   halting segment   the reference's unit tests (decider-halting-segment-
//                     reproduction/src/main.rs): the same machines, the same
//                     segment sizes, the same node counts
//   FAR               proofs computed by bbchallenge's Python reproduction
//                     (decider_FAR_direct.py, DFA sizes up to 4) on random
//                     5-state machines: the same scan direction, the same DFA
//                     and the same accepted set — and for one, the whole NFA
//
// and soundness against ground truth: over the whole tree-normal-form
// enumeration of 3-state and 2-state 3-symbol machines, neither ever calls a
// machine that halts within S(n, k) non-halting.
import '../cli/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classifyBehaviourNow } from '../js/machines/tm-behaviour.js';
import { haltingSegment, haltingSegmentRun } from '../js/machines/halting-segment.js';
import { finiteAutomataReduction } from '../js/machines/far.js';
import { decide, run, standardFromTable, tableFromStandard } from '../cli/tm/core.mjs';
import { checkProof, PROOF_FORMAT } from '../cli/tm/check.mjs';
import { bbStep, rootNode } from '../cli/tm/search.mjs';
import { openSeedDb, parseSeedIds, readSeedIndex, seedDbBytes, seedIndexBytes, seedRecordToStandard, standardToSeedRecord } from '../cli/tm/seed-db.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'automata-bbc-'));

// ── halting segment ───────────────────────────────────────────────

// The reference's tests, by bbchallenge machine ID (the codes are
// api.bbchallenge.org's), segment size, start position and node count.
const SEGMENT_CASES = [
  ['chaotic machine, #76708232', '1RB1LB_1LC0RE_0LD0RA_1RA0LD_---0RC', 5, 2, 7],
  ['complex counter, #10936909', '1RB1LA_0LA0RC_0LC1RD_1RE0LA_0RB---', 7, 3, 38],
  ['#108115', '1RB---_0RC0RE_0LD0RA_1LB1LE_0LC1LC', 3, 1, 18]
];

for (const [name, code, size, pos, nodes] of SEGMENT_CASES) {
  test(`halting segment: the reference's ${name} closes over ${size} cells with ${nodes} nodes`, () => {
    assert.deepEqual(haltingSegmentRun(tableFromStandard(code), size, pos, { nodeLimit: 1000 }), { result: 'never', nodes });
  });
}

test('halting segment: the reference\'s strategy proves #23367211 at 15 cells, and not by 11', () => {
  // Iijil_strategy_updated_23367211: "Segment size 15 = 2*7+1".
  const p = tableFromStandard('1RB---_1RC0LC_1LD0RE_1LB1LE_0RB1LA');
  const r = haltingSegment(p, { distance: 7 });
  assert.equal(r.ok, true);
  assert.equal(r.size, 15);
  assert.deepEqual(r.tried.map(t => t.size), [3, 5, 7, 9, 11, 13]);
  assert.ok(r.tried.every(t => t.result === 'start'));
  assert.equal(haltingSegment(p).reason, 'start', 'the default, 11 cells, is not enough');
});

test('halting segment: a 1RZ halt is the same halt as ---', () => {
  for (const [, code, size, pos, nodes] of SEGMENT_CASES) {
    const z = code.replace('---', '1RZ');
    assert.deepEqual(haltingSegmentRun(tableFromStandard(z), size, pos), { result: 'never', nodes }, z);
  }
});

test('halting segment: refused outside the busy beaver model, not approximated', () => {
  const p = tableFromStandard('1RB1LB_1LC0RE_0LD0RA_1RA0LD_---0RC');
  assert.equal(haltingSegment({ ...p, twoWay: false }).reason, 'model');
  assert.equal(haltingSegment({ ...p, input: [1] }).reason, 'model');
  const stay = tableFromStandard('1RB1LB_1LC0RE_0LD0RA_1RA0LD_---0RC');
  stay.move[2] = 0;
  assert.equal(haltingSegment(stay).reason, 'model');
});

test('halting segment: a node limit is reported, never taken for an answer', () => {
  const r = haltingSegment(tableFromStandard('1RB1LA_0LA0RC_0LC1RD_1RE0LA_0RB---'), { nodeLimit: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'nodes');
});

// ── finite automata reduction ─────────────────────────────────────

// decider_FAR_direct.py, -l 4, on machines from this file's corpus: what it
// found, or that it found nothing. `accepted` pins the NFA's closure.
const FAR_REFERENCE = [
  { code: '1RB1LB_1LC0RE_0LD0RA_1RA0LD_---0RC', side: 'R', depth: 2, dfa: [[0, 1], [0, 1]], accepted: [1, 4, 9, 10] },
  { code: '1RB1LA_0LA0RC_0LC1RD_1RE0LA_0RB---', side: 'R', depth: 4, dfa: [[0, 1], [2, 3], [0, 1], [2, 3]], accepted: [20] },
  { code: '1RB---_0RC0RE_0LD0RA_1LB1LE_0LC1LC', side: 'R', depth: 3, dfa: [[0, 1], [0, 2], [2, 2]], accepted: [5, 10, 11, 12, 13, 14, 15] },
  { code: '1RB---_1RC0LC_1LD0RE_1LB1LE_0RB1LA', side: 'L', depth: 2, dfa: [[0, 1], [0, 1]], accepted: [10] },
  { code: '1RB0LE_1LC0RD_---1LD_1RE0LA_1LA0RE', side: 'L', depth: 1, dfa: [[0, 0]], accepted: [1, 2, 5] },
  { code: '1RB0RC_0LC1LE_0RD1LB_1RA1RC_0LB---', none: true },
  { code: '1RB---_0RC---_1LD0LA_0LC1RB_0LD0RB', side: 'L', depth: 3, dfa: [[0, 1], [2, 1], [0, 1]], accepted: [5, 6, 10, 15] },
  { code: '1RB1LD_0LB1LB_---1RB_1RA0LA_0LA---', side: 'R', depth: 1, dfa: [[0, 0]], accepted: [2, 5] },
  { code: '1RB0RB_1RB---_1RC1LC_0LE1LB_0LC0RB', side: 'R', depth: 1, dfa: [[0, 0]], accepted: [5] },
  { code: '1RB---_1LB1RE_1RB0RE_0RE1RE_1LD1LB', side: 'R', depth: 1, dfa: [[0, 0]], accepted: [5] },
  { code: '1RB0RC_1LA---_0LA1RA_0LD0LC_1RA0LC', side: 'R', depth: 2, dfa: [[0, 1], [0, 1]], accepted: [1, 10] },
  { code: '1RB0RD_0RE1RE_0LD0RD_------_1LC1LD', none: true },
  { code: '1RB---_1LD1RE_0LC0RA_0LC1LC_1LE---', side: 'L', depth: 2, dfa: [[0, 1], [0, 1]], accepted: [5, 10] },
  { code: '1RB1RB_1RE1LA_0LD0RB_0LE---_0RC0LB', side: 'L', depth: 1, dfa: [[0, 0]], accepted: [5] },
  { code: '1RB0RC_0LB---_1RB1LE_0RA0RB_0RB0RE', none: true },
  { code: '1RB---_0RE0LA_1RE0LD_0LA1RA_0LA0LD', side: 'R', depth: 2, dfa: [[0, 1], [0, 1]], accepted: [2, 7, 8, 9, 10] },
  { code: '1RB1LE_0LD1RB_1LB0RA_0LE0RD_0RD---', side: 'L', depth: 1, dfa: [[0, 0]], accepted: [5] },
  { code: '1RB1LE_0LC0RA_0LE0RB_1RB0RA_0LB---', side: 'L', depth: 2, dfa: [[0, 1], [0, 1]], accepted: [5, 8, 10] },
  { code: '1RB0RA_0LB1LC_0RA0RD_1RD---_1RD1RA', side: 'R', depth: 3, dfa: [[0, 1], [0, 2], [0, 2]], accepted: [1, 5, 10, 11, 15] }
];

test('FAR finds the proof bbchallenge\'s reproduction finds, or none where it finds none', () => {
  for (const ref of FAR_REFERENCE) {
    const r = finiteAutomataReduction(tableFromStandard(ref.code), { depth: 4 });
    if (ref.none) { assert.equal(r.ok, false, ref.code); assert.equal(r.reason, 'none'); continue; }
    assert.equal(r.ok, true, ref.code);
    assert.deepEqual({ side: r.side, depth: r.depth, dfa: r.dfa, accepted: r.accepted }, { side: ref.side, depth: ref.depth, dfa: ref.dfa, accepted: ref.accepted }, ref.code);
  }
});

test('FAR builds the reference\'s NFA, edge for edge', () => {
  const r = finiteAutomataReduction(tableFromStandard('1RB1LB_1LC0RE_0LD0RA_1RA0LD_---0RC'), { depth: 4 });
  assert.deepEqual(r.nfa, [
    [[6], [0, 2, 4], [6], [5], [10], [6], [0, 2], [0, 2, 6], [5], [10], [10]],
    [[0, 2], [4], [0], [6], [2], [2], [4], [0], [0, 2, 6], [2], [10]]
  ]);
  assert.equal(r.states, 11);
});

test('FAR: a 1RZ halt is the same halt as ---, and a work limit is reported', () => {
  const ref = FAR_REFERENCE[0];
  const r = finiteAutomataReduction(tableFromStandard(ref.code.replace('---', '1RZ')), { depth: 4 });
  assert.deepEqual([r.side, r.depth, r.dfa, r.accepted], [ref.side, ref.depth, ref.dfa, ref.accepted]);
  assert.equal(finiteAutomataReduction(tableFromStandard(FAR_REFERENCE[1].code), { depth: 4, work: 3 }).reason, 'budget');
  assert.equal(finiteAutomataReduction({ ...tableFromStandard(ref.code), twoWay: false }).reason, 'model');
});

function farProof(code, r) {
  const p = tableFromStandard(code);
  return {
    format: PROOF_FORMAT, version: 1, machine: code, standard: code, input: [],
    table: { Q: p.Q, K: p.K, start: 0, twoWay: true, next: [...p.next], write: [...p.write], move: [...p.move], accept: [...p.accept] },
    verdict: 'never', method: 'far',
    evidence: { side: r.side, depth: r.depth, dfa: r.dfa, nfa: r.nfa, accepted: r.accepted, states: r.states }
  };
}

test('check-proof verifies a FAR proof by bbchallenge\'s conditions, and catches a broken one', () => {
  let proofs = 0, caught = 0, tries = 0;
  for (const ref of FAR_REFERENCE.filter(x => !x.none)) {
    const r = finiteAutomataReduction(tableFromStandard(ref.code), { depth: 4 });
    const proof = farProof(ref.code, r);
    const c = checkProof(proof);
    assert.equal(c.ok, true, `${ref.code}: ${c.why}`);
    proofs++;
    // Drop each NFA edge in turn: the NFA is the least one the conditions
    // force, so losing any edge breaks one of them.
    proof.evidence.nfa.forEach((rows, b) => rows.forEach((succ, i) => succ.forEach(j => {
      const bad = JSON.parse(JSON.stringify(proof));
      bad.evidence.nfa[b][i] = succ.filter(x => x !== j);
      tries++;
      if (!checkProof(bad).ok) caught++;
    })));
    // Accept the start: condition 8.
    const bad = JSON.parse(JSON.stringify(proof));
    bad.evidence.accepted = [...new Set([0, ...bad.evidence.accepted])];
    assert.equal(checkProof(bad).ok, false, `${ref.code}: an accepted start passed`);
    // A different machine under the same proof.
    const other = JSON.parse(JSON.stringify(proof));
    other.table.next[0] = -1;
    other.standard = undefined;
    assert.equal(checkProof(other).ok, false, `${ref.code}: the proof passed for a machine that halts at once`);
  }
  assert.equal(caught, tries, `${tries - caught} of ${tries} single-edge deletions passed`);
  assert.ok(proofs >= 15);
});

// ── soundness, against the busy beaver function ───────────────────

function tableOfNode(node) {
  const accept = new Uint8Array(node.n + 1);
  accept[node.n] = 1;
  return {
    ok: true, Q: node.n + 1, K: node.k, next: Int32Array.from(node.next), write: Int32Array.from(node.write),
    move: Int8Array.from(node.move), accept, start: 0, twoWay: true, input: []
  };
}

function* tree(n, k) {
  const queue = [rootNode(n, k)];
  while (queue.length) {
    const node = queue.pop();
    yield node;
    const r = bbStep(node, { budget: 200, segment: 0, far: 0, cpsMax: 0, inductionMs: 0 });
    if (r.verdict === 'branch') queue.push(...r.children);
  }
}

for (const [n, k, S, far] of [[3, 2, 21, 4], [2, 3, 38, 3]]) {
  test(`neither decider calls a halting ${n}-state ${k}-symbol machine non-halting`, () => {
    // An undefined transition is a halt, so a partial machine halts within S
    // if it halts at all: every claim over the whole enumeration is checked.
    const claims = { segment: 0, far: 0 };
    for (const node of tree(n, k)) {
      const p = tableOfNode(node);
      const halts = !!run(p, S + 5).halted;
      const code = standardFromTable(p);
      if (haltingSegment(p).ok) { claims.segment++; assert.ok(!halts, `halting segment called ${code} non-halting, and it halts`); }
      const r = finiteAutomataReduction(p, { depth: far });
      if (r.ok) {
        claims.far++;
        assert.ok(!halts, `FAR called ${code} non-halting, and it halts`);
        if (claims.far % 50 === 0) assert.ok(checkProof(farProof(code, r)).ok, `${code}: the FAR proof does not check`);
      }
    }
    assert.ok(claims.segment > 300 && claims.far > 1000, JSON.stringify(claims));
  });
}

test('the 3-state machines the run-based methods left are settled without the bound', () => {
  // The six holdouts of `bb-search -n 3` before these deciders, four of which
  // only the busy beaver bound settled — which assumes the answer.
  for (const code of ['0RB0LA_1RC---_1LA1RB', '0RB0LA_1LA1RC_1RB---', '1RB1LC_0LA0RB_1LA---', '1RB0LC_0LC1RA_---1LA', '1RB0LC_1LB1RA_---1LA', '1RB---_1LC1RA_0RA0LC']) {
    const v = decide(tableFromStandard(code), { budget: 10000, cpsMax: 0, inductionMs: 0, bound: false });
    assert.equal(v.verdict, 'never', code);
    assert.ok(['segment', 'far'].includes(v.method), `${code}: ${v.method}`);
  }
});

// ── bbchallenge's step count ──────────────────────────────────────

test('a halt on an undefined transition counts the step that reads it, as bbchallenge-go does', () => {
  // TmSimulate executes the step that finds next state 0 and counts it.
  for (const [code, steps] of [['1RB1LB_1LA---', 6], ['1RB1LB_1LA1RZ', 6], ['1RB1RZ_1LB0RC_1LC1LA', 21], ['1RB---_1LB0RC_1LC1LA', 21]]) {
    const v = classifyBehaviourNow(tableFromStandard(code), { budget: 1000 });
    assert.equal(v.steps, steps, code);
  }
  // check-proof counts the same way, with its own stepper.
  const p = tableFromStandard('1RB1LB_1LA---');
  const proof = {
    format: PROOF_FORMAT, version: 1, input: [], verdict: 'halts', method: 'simulation', evidence: { steps: 6 },
    table: { Q: p.Q, K: p.K, start: 0, twoWay: true, next: [...p.next], write: [...p.write], move: [...p.move], accept: [...p.accept] }
  };
  assert.equal(checkProof(proof).ok, true, checkProof(proof).why);
  assert.equal(checkProof({ ...proof, evidence: { steps: 5 } }).ok, false, 'the old count');
});

// ── the seed database ─────────────────────────────────────────────

test('a seed database record reads as the README says', () => {
  // bbchallenge-seed's README: the BB(5) champion, R = 0, L = 1, A = 1, and
  // its halt written as state 6.
  const bytes = [1, 0, 2, 1, 1, 3, 1, 0, 3, 1, 0, 2, 1, 0, 4, 0, 1, 5, 1, 1, 1, 1, 1, 4, 1, 0, 6, 0, 1, 1];
  assert.equal(seedRecordToStandard(bytes), '1RB1LC_1RC1RB_1RD0LE_1LA1LD_1RZ0LA');
  // bbchallenge-go's GetBB5Winner leaves it undefined instead: 1, R, 0.
  bytes[26] = 0;
  assert.equal(seedRecordToStandard(bytes), '1RB1LC_1RC1RB_1RD0LE_1LA1LD_---0LA');
  for (const code of ['1RB1LC_1RC1RB_1RD0LE_1LA1LD_---0LA', '1RB---_0RC0RE_0LD0RA_1LB1LE_0LC1LC', '1RB0RD_0RE1RE_0LD0RD_------_1LC1LD']) {
    assert.equal(seedRecordToStandard(standardToSeedRecord(code)), code);
  }
});

test('a seed database is read by ID, with its header checked, and an index file by its IDs', () => {
  const codes = SEGMENT_CASES.map(c => c[1]).concat('1RB1LC_1RC1RB_1RD0LE_1LA1LD_---0LA');
  const file = join(tmp, 'db');
  writeFileSync(file, seedDbBytes(codes, { time: 1 }));
  const db = openSeedDb(file);
  try {
    assert.equal(db.count, 4);
    assert.deepEqual(db.header, { time: 1, space: 3, total: 4, sorted: true });
    assert.deepEqual([0, 1, 2, 3].map(i => db.code(i)), codes);
    assert.throws(() => db.code(4), /not in the database/);
  } finally { db.close(); }
  writeFileSync(join(tmp, 'bad'), Buffer.alloc(45));
  assert.throws(() => openSeedDb(join(tmp, 'bad')), /not a seed database/);
  const idx = join(tmp, 'idx');
  writeFileSync(idx, seedIndexBytes([3, 108115, 88664063]));
  assert.deepEqual(readSeedIndex(idx), [3, 108115, 88664063]);
  assert.deepEqual(parseSeedIds(['#7', '2-4', '10']), [7, 2, 3, 4, 10]);
  assert.throws(() => parseSeedIds(['4-2']), /backwards/);
});
