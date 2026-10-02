// The busy beaver references' deciders, ported: bbchallenge's halting segment
// (js/machines/halting-segment.js), finite automata reduction
// (js/machines/far.js) and bouncers (js/machines/bouncers.js); Coq-BB5's
// loops, n-gram CPS and repeated word list (loop1.js, ngram-cps.js,
// repwl.js); the seed database's format (cli/tm/seed-db.mjs); and
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
import { loop1 } from '../js/machines/loop1.js';
import { ngramCps, COQ_BB4_NGRAM } from '../js/machines/ngram-cps.js';
import { repwl } from '../js/machines/repwl.js';
import { bouncers } from '../js/machines/bouncers.js';
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
    const r = bbStep(node, { budget: 200, segment: 0, far: 0, loops: 0, ngram: null, repwl: [], bouncers: false, cpsMax: 0, inductionMs: 0 });
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

// ── Coq-BB5's deciders: loops, n-gram CPS, repeated word list ─────
// Ports of the BB(5) proof's own Coq (Deciders/Decider_Loop.v,
// Decider_NGramCPS.v, Decider_RepWL.v). Each is pinned to the proof's output:
// machines from its published BB(4) enumeration (BB4_verified_enumeration.csv)
// with the status and the pipeline stage that decided them, replayed here
// through the same pipeline; and entries of its BB(5) hardcoded tables, each
// decided with its own parameters and the proof's gas.


const BB4_PIPELINE = [
  ['LOOP1_params_107', p => loop1(p, 107)],
  ...COQ_BB4_NGRAM.map(q => [
    q.variant === 'impl2' ? `NGRAM_CPS_IMPL2_params_${q.lenL}_${q.lenR}_${q.gas}`
      : q.variant === 'lru' ? `NGRAM_CPS_LRU_params_${q.lenL}_${q.lenR}_${q.gas}`
      : `NGRAM_CPS_IMPL1_params_${q.lenH}_${q.lenL}_${q.lenR}_${q.gas}`,
    p => ngramCps(p, q)
  ]),
  ['REPWL_params_4_3_320_10000', p => repwl(p, { len: 4, minRep: 3, maxT: 320, gas: 10000 })]
];

// [machine, status, decider], as the BB(4) proof's enumeration lists them.
const BB4_ENUMERATION = [
  ['------_------_------_------', 'halt', 'LOOP1_params_107'],
  ['0RA---_------_------_------', 'nonhalt', 'LOOP1_params_107'],
  ['1RA---_------_------_------', 'nonhalt', 'LOOP1_params_107'],
  ['0RB---_------_------_------', 'halt', 'LOOP1_params_107'],
  ['0RB0LA_1LA1RB_------_------', 'nonhalt', 'NGRAM_CPS_IMPL2_params_1_1_100'],
  ['0RB1LA_1LA1RB_------_------', 'nonhalt', 'NGRAM_CPS_IMPL2_params_1_1_100'],
  ['0RB0LC_1LA1RB_0LD0LA_0RA---', 'nonhalt', 'NGRAM_CPS_IMPL2_params_2_2_200'],
  ['0RB0LC_1LA1RB_0LD1LA_0RA---', 'nonhalt', 'NGRAM_CPS_IMPL2_params_2_2_200'],
  ['0RB1LC_1LA1RB_0LA0LD_---1RB', 'nonhalt', 'NGRAM_CPS_IMPL1_params_2_2_2_1600'],
  ['0RB1LC_1LA1RB_0LA1LD_---1LA', 'nonhalt', 'NGRAM_CPS_IMPL1_params_2_2_2_1600'],
  ['0RB1LC_1LA1RB_0LA1LD_---0LB', 'nonhalt', 'NGRAM_CPS_IMPL1_params_2_3_3_1600'],
  ['0RB1LC_1LA1RB_1LA1LD_---0RA', 'nonhalt', 'NGRAM_CPS_IMPL1_params_4_2_2_600'],
  ['0RB1LC_1LA1RB_1RC1LD_---1LA', 'nonhalt', 'NGRAM_CPS_IMPL1_params_4_2_2_600'],
  ['0RB0RD_1LA0LC_1LD---_1RA0LC', 'nonhalt', 'NGRAM_CPS_IMPL2_params_3_3_400'],
  ['0RB---_1LA0LC_1LD0RD_1RC0LA', 'nonhalt', 'NGRAM_CPS_IMPL2_params_3_3_400'],
  ['0RB0LA_1LA1RC_1LD---_1RB1RD', 'nonhalt', 'NGRAM_CPS_IMPL1_params_2_3_3_1600'],
  ['0RB1LA_1LC1RB_1LA1LD_---0LA', 'nonhalt', 'NGRAM_CPS_LRU_params_2_2_10000'],
  ['0RB1LA_1LC1RB_1RA1LD_---0LA', 'nonhalt', 'NGRAM_CPS_LRU_params_2_2_10000'],
  ['0RB1RB_1LC1RD_1RA0LA_---1RA', 'nonhalt', 'NGRAM_CPS_IMPL1_params_4_3_3_1600'],
  ['0RB1LA_1LC1RB_1RB1LD_---0LA', 'nonhalt', 'NGRAM_CPS_LRU_params_2_2_10000'],
  ['0RB---_1LC0RC_0LD0LA_1RA1LB', 'nonhalt', 'NGRAM_CPS_IMPL1_params_6_3_3_3200'],
  ['0RB0RC_1LC1RD_0LD---_1RA0LA', 'nonhalt', 'NGRAM_CPS_IMPL1_params_6_3_3_3200'],
  ['0RB1LB_1RC0RD_1LA0LC_1RA---', 'nonhalt', 'NGRAM_CPS_IMPL1_params_4_3_3_1600'],
  ['0RB---_1RC1RB_1LD1LC_1RA0LD', 'nonhalt', 'NGRAM_CPS_IMPL1_params_10_4_4_10000'],
  ['1RB1LA_1LA0RC_1LD1RC_---0LA', 'nonhalt', 'REPWL_params_4_3_320_10000'],
  ['1RB1LA_1LA1RC_---0RD_0LA1RD', 'nonhalt', 'NGRAM_CPS_LRU_params_2_2_10000'],
  ['1RB0LC_1LB1LA_1RC0LD_---0RA', 'nonhalt', 'NGRAM_CPS_IMPL1_params_8_2_2_1600'],
  ['1RB0RB_1LB0LC_0LD---_1RD0RA', 'nonhalt', 'NGRAM_CPS_IMPL1_params_8_2_2_1600'],
  ['1RB0RB_0LC1RB_1RD1LC_---1RA', 'nonhalt', 'NGRAM_CPS_LRU_params_2_2_10000'],
  ['1RB0LD_1LC1RB_---1LA_0RB1LD', 'nonhalt', 'NGRAM_CPS_LRU_params_2_2_10000'],
  ['1RB0RA_1LC0LD_1RA1LA_---1LB', 'nonhalt', 'NGRAM_CPS_IMPL1_params_10_4_4_10000'],
  ['1RB1LB_1LC0LD_---1LA_1RA0RD', 'nonhalt', 'NGRAM_CPS_IMPL1_params_8_3_3_1600'],
  ['1RB0RB_1LC0LA_1LD1RA_---0LA', 'nonhalt', 'NGRAM_CPS_IMPL1_params_6_2_2_3200'],
  ['1RB0RA_1LC0RD_1RA0LB_0RC---', 'nonhalt', 'NGRAM_CPS_IMPL1_params_6_2_2_3200'],
  ['1RB1RA_1LC1LB_1RD0LC_0RA---', 'nonhalt', 'NGRAM_CPS_IMPL1_params_10_4_4_10000'],
  ['1RB1LA_1LC1RD_0LA1RC_---0RC', 'nonhalt', 'NGRAM_CPS_LRU_params_2_2_10000'],
  ['1RB0RB_1LC1RB_---0LD_1RA1LD', 'nonhalt', 'REPWL_params_4_3_320_10000'],
  ['1RB0LA_0RC---_1RD1RC_1LA1LD', 'nonhalt', 'NGRAM_CPS_IMPL1_params_8_3_3_1600'],
  ['1RB1LA_1RC1RD_0LA1RC_---0RC', 'nonhalt', 'NGRAM_CPS_LRU_params_2_2_10000'],
  ['1RB1LB_1RC0RB_1LA0LD_---1LC', 'nonhalt', 'NGRAM_CPS_IMPL1_params_10_4_4_10000'],
];

test('Coq-BB5\'s BB(4) pipeline, replayed with the ports, decides each machine as the proof did', () => {
  // The whole 858,908-machine enumeration was replayed the same way with no
  // difference; these are rows for every stage of the pipeline.
  for (const [code, status, decider] of BB4_ENUMERATION) {
    const p = tableFromStandard(code);
    let got = ['unknown', 'none'];
    for (const [id, run] of BB4_PIPELINE) {
      const r = run(p);
      if (r.result === 'halt' || r.result === 'never') { got = [r.result === 'halt' ? 'halt' : 'nonhalt', id]; break; }
    }
    assert.deepEqual(got, [status, decider], code);
  }
  assert.ok(new Set(BB4_ENUMERATION.map(r => r[2])).size === BB4_PIPELINE.length, 'every stage is exercised');
});

// [machine, the BB(5) proof's DeciderType] from its hardcoded tables.
const BB5_HARDCODED = [
  ['0RB---_1LA1LC_1RD0LD_1LB1RE_1LC0RE', 'NG 0 11'],
  ['0RB---_0LC1RB_1RD0LE_1LB1RA_0RA1LC', 'NG 0 2'],
  ['0RB---_1LC1RA_1LD0RA_1RE0LC_0LD0RE', 'NG 2 2'],
  ['0RB0LA_1RC---_1RD0LC_1LE0RE_1RA1LC', 'NG 2 9'],
  ['0RB0LE_1LA1RC_1RD---_0LD1RB_0RC0LA', 'NG 2 4'],
  ['0RB---_0LC1RB_1LD1LC_1RE1LA_0LA0RE', 'NG_LRU 2'],
  ['0RB0LA_1LA0LC_0RD1LC_1RE1RD_1RB---', 'NG_LRU 2'],
  ['0RB0LA_1RC0RD_1LA1LC_---1RE_1RB1RE', 'NG_LRU 2'],
  ['0RB---_1LA0LC_1RD1LC_1LC0RE_1LB1RE', 'RWL 2 3'],
  ['1RB1RA_1LC1LB_1RA1RD_1RA0LE_---1LD', 'RWL 2 2'],
  ['0RB---_1LA0RC_1RD1RC_1LE0LB_1RC0LD', 'RWL 9 2'],
  ['0RB---_1LA1RC_1LD1RE_1RD0LE_0LD1RA', 'RWL 4 3'],
  ['0RB---_0LC0RA_1RD1LC_1RB0LE_1LD0LE', 'RWL 28 3'],
  ['0RB---_0LC1RA_1RD1LD_1RB0LE_0LD0RC', 'RWL 7 3'],
  ['0RB---_0LC0RB_1RD0LE_1RE0RA_1LC1LB', 'RWL 3 3'],
  ['0RB---_0LC0LD_1RD1LB_1RE0RC_1LD0RA', 'RWL 6 2'],
  ['0RB---_0LC0RD_1LA1LE_1RE0LE_1RB1LB', 'RWL 5 2']
];

test('the BB(5) proof\'s hardcoded n-gram CPS and RepWL entries are decided with their own parameters', () => {
  // BB5_Deciders_Hardcoded.v `getDecider`: NG h n → NGramCPS (impl2 when
  // h = 0, else impl1 with history h) on windows of n, gas 5,000,001;
  // NG_LRU n → the LRU variant; RWL n m → RepWL_ES_decider n m 320 150001.
  // All 7,992 entries were checked this way; none failed.
  for (const [code, d] of BB5_HARDCODED) {
    const p = tableFromStandard(code);
    const [kind, a, b] = d.split(' ').map((x, i) => (i ? Number(x) : x));
    const r = kind === 'NG' ? ngramCps(p, a === 0 ? { variant: 'impl2', lenL: b, lenR: b, gas: 5000001 } : { variant: 'impl1', lenH: a, lenL: b, lenR: b, gas: 5000001 })
      : kind === 'NG_LRU' ? ngramCps(p, { variant: 'lru', lenL: a, lenR: a, gas: 5000001 })
      : repwl(p, { len: a, minRep: b, maxT: 320, gas: 150001 });
    assert.equal(r.result, 'never', `${code} ${d}`);
  }
});

test('loops: a halt within the gas is a halt, counted as bbchallenge counts it, and a machine outside the model is refused', () => {
  assert.deepEqual(loop1(tableFromStandard('1RB1LB_1LA---'), 107), { result: 'halt', steps: 6, state: 1, read: 1 });
  assert.equal(loop1(tableFromStandard('1RB1LB_1LA0LC_1RZ1LD_1RD0RA'), 107).result, 'halt');
  assert.equal(loop1(tableFromStandard('1RB1LB_1LA0LC_1RZ1LD_1RD0RA'), 106).result, 'unknown');
  assert.equal(loop1({ ...tableFromStandard('1RB1LB_1LA---'), twoWay: false }, 107).result, 'model');
});

// ── bbchallenge's bouncers ────────────────────────────────────────
// [machine, formula tape, step it was read off at, macro steps until it
// recurred], from the reference's own output
// (bouncers_certs_250k_steps_50k_macro_steps_20_formula_limit.csv). The port
// reproduces every one of its 29,799 certificates exactly, and decides none
// of the 2,833 machines it left.
const BOUNCER_CERTS = [
  ['1RB---_0RC---_0RD0LD_1LE0RE_0LA1LC', '.<A010110(0110).', 109, 42],
  ['1RB---_0RC---_0RD1LD_0LE0LA_1LE1LC', '.<A0110110(110).', 189, 62],
  ['1RB---_0RC---_0LD1RD_1LE0RB_1RD0LC', '.<C011001(1001).', 104, 35],
  ['1RB---_0RC---_1RD0LA_0LE0RE_1LB1LD', '.<B101010(1010).', 79, 29],
  ['1RB---_0LC0RB_1LD1LB_0LE1LC_1RE0RA', '.<B111110(111110).', 167, 61],
  ['1RB---_1RC0LE_1LD0RB_---1LB_1RA1LD', '.<B1101(011011).', 102, 34],
  ['1RB0RD_0RC0RA_1LD1LA_1LD0LE_1LA---', '.<A1000110(00110)11.', 306, 102],
  ['1RB0LD_1RC0RC_1RD---_1LA1LE_0RA1RE', '.<A10(1001010010)010.', 236, 74],
  ['1RB1LC_0LA0RE_0LD1LB_1RD1RA_---0RC', '.<A011010(11010).', 114, 40],
  ['1RB1LB_0RC1LE_1LD1RC_0LA1LA_---1LD', '.<A01111(1111).', 63, 23],
];

test('bouncers gives the reference\'s certificate, formula tape and all', () => {
  for (const [code, formula, steps, macroSteps] of BOUNCER_CERTS) {
    assert.deepEqual(bouncers(tableFromStandard(code)), { result: 'never', formula, steps, macroSteps }, code);
  }
});

test('bouncers leaves undecided what the reference left undecided', () => {
  for (const code of ['1RB---_0RC0RD_1RD1RA_1LD0LE_1LB0LA', '1RB---_0LC1RC_0RC1LD_1LE1RE_1LA0LE', '1RB0LA_0RC1RE_1LD0RC_1LA1RA_---1RD', '1RB1LA_0LA0RC_0RD0RE_1LD0LA_---1RD']) {
    assert.equal(bouncers(tableFromStandard(code)).result, 'unknown', code);
  }
  assert.equal(bouncers(tableFromStandard('1RB1LB_1LA---')).result, 'halt');
});

test('bouncers gives up, said so, on a machine whose records would not fit, rather than running out of memory', () => {
  // Walking right forever, every step is a record: kept whole, as the
  // reference keeps them, 250,000 growing tapes would be ~31 billion cells.
  const t0 = Date.now();
  assert.deepEqual(bouncers(tableFromStandard('1RA---')), { result: 'unknown', reason: 'records' });
  assert.ok(Date.now() - t0 < 5000);
});
