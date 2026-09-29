// The halting provers the command line adds — closed position sets, inductive
// rules over a run-length tape, the busy beaver bound — are judged against
// ground truth rather than against themselves.
//
// The ground truth is the busy beaver function. Every 3-state, 2-symbol
// machine that halts from a blank tape does so within S(3) = 21 steps, every
// 2-state 3-symbol one within S(2, 3) = 38, every 4-state one within
// S(4) = 107 — partial machines included, since an undefined transition is a
// halt. So a machine a prover calls "never halts" must still be running
// after that many steps, and every such claim over the whole tree-normal-form
// enumeration is checked. A prover that is wrong once fails here.
import '../cli/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyBehaviourNow } from '../js/machines/tm-behaviour.js';
import { cpsProve, decide, run, standardFromTable, tableFromStandard, growthOf, boundFor } from '../cli/tm/core.mjs';
import { induction, proveByInduction } from '../cli/tm/induction.mjs';
import { checkProof, PROOF_FORMAT } from '../cli/tm/check.mjs';
import { bbStep, rootNode } from '../cli/tm/search.mjs';

function tableOfNode(node) {
  const accept = new Uint8Array(node.n + 1);
  accept[node.n] = 1;
  return {
    ok: true, Q: node.n + 1, K: node.k, next: Int32Array.from(node.next), write: Int32Array.from(node.write),
    move: Int8Array.from(node.move), accept, start: 0, twoWay: true, input: []
  };
}

/** Every node of the TNF tree for n states, k symbols. */
function* tree(n, k) {
  const queue = [rootNode(n, k)];
  while (queue.length) {
    const node = queue.pop();
    yield node;
    const r = bbStep(node, { budget: 200, cpsMax: 0, inductionMs: 0 });
    if (r.verdict === 'branch') queue.push(...r.children);
  }
}

function sweep(n, k, S, { cpsMax, inductionMs }) {
  let claims = 0;
  for (const node of tree(n, k)) {
    const p = tableOfNode(node);
    const halts = !!run(p, S + 5).halted;
    for (let size = 1; size <= cpsMax; size++) {
      if (cpsProve(p, size)) {
        claims++;
        assert.ok(!halts, `CPS(${size}) called ${standardFromTable(p)} non-halting, and it halts`);
        break;
      }
    }
    const r = inductionMs ? induction(p, { maxB: 4, maxMacroSteps: 4000, ms: inductionMs }) : null;
    if (r) {
      claims++;
      assert.ok(!halts, `induction (${r.method}, B=${r.B}) called ${standardFromTable(p)} non-halting, and it halts`);
    }
  }
  return claims;
}

test('closed position sets never claim a halting 3-state machine', () => {
  const claims = sweep(3, 2, 21, { cpsMax: 5, inductionMs: 0 });
  assert.ok(claims > 1000, `only ${claims} claims were made — the sweep is not exercising CPS`);
});

test('inductive rules never claim a halting 3-state machine', () => {
  const claims = sweep(3, 2, 21, { cpsMax: 0, inductionMs: 30 });
  assert.ok(claims > 500, `only ${claims} claims were made`);
});

test('neither prover claims a halting 2-state 3-symbol machine', () => {
  sweep(2, 3, 38, { cpsMax: 4, inductionMs: 20 });
});

test('neither prover claims a halting 4-state machine, on a random sample', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
  let claims = 0;
  for (let i = 0; i < 400; i++) {
    const segs = [];
    for (let q = 0; q < 4; q++) {
      let seg = '';
      for (let s = 0; s < 2; s++) seg += rnd() < 0.12 ? '---' : `${rnd() < 0.5 ? 1 : 0}${rnd() < 0.5 ? 'L' : 'R'}${'ABCD'[Math.floor(rnd() * 4)]}`;
      segs.push(seg);
    }
    const p = tableFromStandard(segs.join('_'));
    const halts = !!run(p, 120).halted;
    const v = decide(p, { budget: 2000, cpsMax: 5, inductionMs: 20, bound: false });
    if (v.verdict === 'never') {
      claims++;
      assert.ok(!halts, `${v.method} called ${segs.join('_')} non-halting, and it halts`);
    }
    if (v.verdict === 'halts') assert.ok(halts, `${segs.join('_')} was said to halt and does not within 120 steps`);
  }
  assert.ok(claims > 100);
});

test('the bound applies only in the model it is proved for', () => {
  assert.deepEqual(boundFor(tableFromStandard('1RB1LB_1LA1RZ')), { n: 2, k: 2, S: 6 });
  assert.equal(boundFor(tableFromStandard('1RB---_0RC0RD_1RD1RA_1LD0LE_1LB0LA')).S, 47176870);
  // Six states: no proved value.
  assert.equal(boundFor(tableFromStandard('1RB---_1RC---_1RD---_1RE---_1RF---_1RA---')), null);
  // A one-way tape is not the busy beaver model.
  assert.equal(boundFor({ ...tableFromStandard('1RB1LB_1LA1RZ'), twoWay: false }), null);
  // Nor is a stay move.
  const stay = tableFromStandard('1RB1LB_1LA1RZ');
  stay.move[0] = 0;
  assert.equal(boundFor(stay), null);
});

test('the published champions halt where they should', () => {
  assert.deepEqual(
    [['1RB1LB_1LA1RZ', 6], ['1RB1RZ_1LB0RC_1LC1LA', 21], ['1RB1LB_1LA0LC_1RZ1LD_1RD0RA', 107]].map(([c]) => [c, run(tableFromStandard(c), 1000).steps]),
    [['1RB1LB_1LA1RZ', 6], ['1RB1RZ_1LB0RC_1LC1LA', 21], ['1RB1LB_1LA0LC_1RZ1LD_1RD0RA', 107]]
  );
  const v = decide(tableFromStandard('1RB1LC_1RC1RB_1RD0LE_1LA1LD_1RZ0LA'), { budget: 5e7, cpsMax: 0, inductionMs: 0 });
  assert.equal(v.verdict, 'halts');
  assert.equal(v.steps, 47176870);
});

test('the fast run agrees with the classifier on where machines stop', () => {
  for (const code of ['1RB1LB_1LA1RZ', '1RB---_0RC0RB_1LC1LA', '1RB2LB1RZ_2LA2RB1LB']) {
    const p = tableFromStandard(code);
    const a = run(p, 500);
    const b = classifyBehaviourNow(p, { budget: 500, backward: false });
    if (b.verdict === 'halts') assert.equal(a.steps, b.steps, code);
    else assert.equal(a.halted, null, code);
  }
});

test('standard notation round-trips through the table', () => {
  for (const code of ['1RB1LB_1LA1RZ', '1RB---_0RC0RD_1LD0RA_0LE0LC_1RB0LB', '1RB2LB1RZ_2LA2RB1LB']) {
    assert.equal(standardFromTable(tableFromStandard(code)), code);
  }
});

test('growth reads a counter as logarithmic and a bouncer as a square root', () => {
  assert.equal(growthOf(tableFromStandard('1RB---_0RC0RD_1RD1RA_1LD0LE_1LB0LA'), { from: 5, to: 6 }).shape, 'logarithmic');
  assert.equal(growthOf(tableFromStandard('1RB---_0RC0RD_1LD0RA_0LE0LC_1RB0LB'), { from: 5, to: 6 }).shape, 'square-root');
});

test('a nested rule proves the bouncer a flat one cannot', () => {
  const r = proveByInduction(tableFromStandard('1RB0LB_1LC1RB_---1LA'), 1, { maxMacroSteps: 5000 });
  assert.equal(r.method, 'induction');
  assert.ok(r.rules >= 2);
});

// ── Proof files ───────────────────────────────────────────────────

function proofFor(code, v) {
  const p = tableFromStandard(code);
  const evidence = {};
  for (const k of ['steps', 'period', 'from', 'at', 'window', 'direction', 'longest', 'n', 'k', 'S', 'left', 'right', 'B']) if (v[k] !== undefined) evidence[k] = v[k];
  return {
    format: PROOF_FORMAT, version: 1, machine: code, standard: code, input: [],
    table: { Q: p.Q, K: p.K, start: 0, twoWay: true, next: [...p.next], write: [...p.write], move: [...p.move], accept: [...p.accept] },
    verdict: v.verdict, method: v.method, evidence
  };
}

test('check-proof accepts each method\'s proof and rejects a tampered one', () => {
  const cases = {
    simulation: '1RB1LB_1LA1RZ',
    cycler: '1RB1RB_1LA1LA',
    translated: '1RB---_0RA---',
    cps: '1RB---_0RC0RD_1RD1RA_1LD0LE_1LB0LA',
    bound: '1RB---_0RC0RD_1LD0RA_0LE0LC_1RB0LB'
  };
  for (const [method, code] of Object.entries(cases)) {
    const p = tableFromStandard(code);
    let v;
    if (method === 'cps') { const c = cpsProve(p, 7); v = { verdict: 'never', method, n: c.n, left: c.left, right: c.right }; }
    else if (method === 'bound') v = { verdict: 'never', method, n: 5, k: 2, S: 47176870 };
    else v = classifyBehaviourNow(p, { budget: 1e5, backward: false });
    assert.equal(v.method, method, `${code} was not proved by ${method}`);
    const proof = proofFor(code, v);
    assert.equal(checkProof(proof).ok, true, `${method}: ${checkProof(proof).why}`);
    // Tamper: the first move made undefined, so the machine halts at once —
    // which contradicts every proof here, halting ones included.
    const bad = JSON.parse(JSON.stringify(proof));
    bad.table.next[0] = -1;
    bad.standard = undefined;
    const r = checkProof(bad);
    assert.equal(r.ok, false, `${method}: a tampered proof passed`);
  }
});

test('a closed position set with a gram removed is caught, not repaired', () => {
  const code = '1RB---_0RC0RD_1RD1RA_1LD0LE_1LB0LA';
  const c = cpsProve(tableFromStandard(code), 7);
  const whole = proofFor(code, { verdict: 'never', method: 'cps', n: 7, left: c.left, right: c.right });
  assert.equal(checkProof(whole).ok, true);
  // Drop each non-blank gram in turn: the set is minimal-ish, so dropping any
  // one it needs must be caught.
  let caught = 0;
  for (const g of c.left.filter(x => x !== '0000000')) {
    const proof = proofFor(code, { verdict: 'never', method: 'cps', n: 7, left: c.left.filter(x => x !== g), right: c.right });
    if (!checkProof(proof).ok) caught++;
  }
  assert.ok(caught > 0, 'no removed gram was noticed');
});
