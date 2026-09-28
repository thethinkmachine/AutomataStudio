import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// js/machines/tm-behaviour.js proves what a Turing machine does: it halts, it
// never halts, or it does not know — and names the method that proved it.
// Every verdict is a claim about the machine, so every one is checked here
// against an oracle that shares none of its code — a plain Map tape stepped
// one transition at a time — rather than against the classifier's own idea
// of itself:
//
//   simulation  the oracle halts at exactly that step, with that many ones.
//   cycler      the configurations at μ and μ + λ are the same, and λ and μ
//               are the smallest that work.
//   translated  the same state and window of tape recur, shifted, for twenty
//               more periods, and the machine never halts in between.
//   backward    its witness, placed on a real tape, halts in exactly L steps;
//               no random configuration halts later than L; and the run does
//               not halt within the budget.
//   unknown     the oracle does not halt within the budget either.
//
// The halting champions are checked against their published step counts, and
// thousands of random small machines on both tape models are checked against
// the oracle — which is what reaches the one-way tape's wall rule.

const harness = createHarness();
const { context } = harness;

/** Load a machine written in the standard notation, on either tape model. */
function load(src, machine = 'ITM') {
  harness.resetApp();
  const d = context.readStandardTM(src, context.App.config.sym);
  context.loadData({
    format: context.WORKSPACE_FORMAT, schema: context.SCHEMA_VERSION,
    machine, sigma: d.sigma, stackAlpha: d.stackAlpha, tapeCount: 1,
    states: d.states.map((s, i) => ({ ...s, x: i * 80, y: 0 })),
    transitions: d.transitions, startId: d.startId, accepts: d.accepts, notes: [], dividers: []
  }, true);
  if (machine === 'TM') context.App.config.twoWayTape = false;
  const p = context.compileBehaviourMachine([]);
  assert.ok(p.ok, p.error);
  return p;
}

// ── the oracle ────────────────────────────────────────────────────

/** The machine stepped on a Map tape, from its start or from `from`: { state, head, tape }. */
function oracle(p, from = null) {
  const tape = from ? new Map(from.tape) : new Map();
  if (!from) p.input.forEach((c, x) => { if (c) tape.set(x, c); });
  const o = { state: from ? from.state : p.start, head: from ? from.head : 0, t: 0, halted: null, tape };
  o.step = () => {
    if (p.accept[o.state]) { o.halted = 'accept'; return false; }
    const c = tape.get(o.head) || 0;
    const e = o.state * p.K + c;
    if (p.next[e] < 0) { o.halted = 'none'; return false; }
    if (p.write[e]) tape.set(o.head, p.write[e]); else tape.delete(o.head);
    const h = o.head + p.move[e];
    if (p.twoWay || h >= 0) o.head = h;
    o.state = p.next[e];
    o.t++;
    return true;
  };
  o.key = () => `${o.state}|${o.head}|${[...tape].sort((a, b) => a[0] - b[0]).map(([x, c]) => `${x}:${c}`).join(',')}`;
  o.at = x => tape.get(x) || 0;
  o.to = t => { while (o.t < t && o.step()); return o.t === t; };
  return o;
}

/**
 * Backward reasoning's witness on a real tape: on a one-way tape its wall is
 * cell 0, and with no wall it is put far enough right never to meet one. A
 * cell any symbol will do for is left blank.
 */
function placeWitness(p, w) {
  const shift = w.wall !== null ? -w.wall : p.twoWay ? 0 : 3 - w.lo;
  const tape = new Map();
  w.cells.forEach((c, k) => { if (c > 0) tape.set(w.lo + k + shift, c); });
  return { state: w.state, head: w.head + shift, tape };
}

function checkVerdict(p, v, budget, label) {
  const o = oracle(p);
  assert.equal(v.verdict, v.method ? context.METHODS[v.method].verdict : 'unknown', `${label}: the method's verdict`);
  if (v.method === 'simulation') {
    o.to(v.steps);
    assert.equal(o.t, v.steps, `${label}: steps`);
    assert.equal(o.step(), false, `${label}: halts at ${v.steps}`);
    assert.equal(o.halted, v.how, `${label}: how it halted`);
    assert.equal(o.tape.size, v.ones, `${label}: ones`);
  } else if (v.method === 'cycler') {
    const { from: mu, period: lam } = v;
    assert.ok(lam >= 1, `${label}: period`);
    const keys = new Map();
    o.to(Math.max(0, mu - 1));
    const before = mu > 0 ? o.key() : null;
    if (mu > 0) o.step();
    const start = o.key();
    // λ is the smallest period: nothing in between repeats the start.
    for (let k = 1; k < lam; k++) {
      assert.ok(o.step(), `${label}: halted inside its cycle`);
      if (lam <= 400) keys.set(k, o.key());
    }
    assert.ok(o.step(), `${label}: halted inside its cycle`);
    assert.equal(o.key(), start, `${label}: μ + λ repeats μ`);
    for (const [k, key] of keys) assert.notEqual(key, start, `${label}: repeats sooner, at ${k}`);
    // μ is the smallest start: one step earlier did not repeat.
    if (before !== null) {
      const o2 = oracle(p);
      o2.to(mu - 1 + lam);
      assert.notEqual(o2.key(), before, `${label}: the cycle starts before ${mu}`);
    }
  } else if (v.method === 'translated') {
    const { from, period, shift, before } = v;
    for (let j = 0; j <= 20; j++) {
      assert.ok(o.to(from + j * period), `${label}: halted in period ${j}`);
      assert.equal(o.state, v.state, `${label}: state in period ${j}`);
      assert.equal(o.head, before.head + j * shift, `${label}: head in period ${j}`);
      before.cells.forEach((c, k) => assert.equal(o.at(before.lo + j * shift + k), c, `${label}: window cell ${k} in period ${j}`));
    }
  } else if (v.method === 'backward') {
    const L = v.longest;
    assert.ok(o.to(budget), `${label}: halted within the budget, but backward reasoning said never`);
    assert.equal(v.steps, L + 1, `${label}: settled the step after L`);
    assert.equal(v.halts.length === 0, L === -1, `${label}: L is −1 exactly when there is no way to halt`);
    assert.equal(Math.max(-1, ...v.halts.map(h => h.depth)), L, `${label}: L is the deepest halt's`);
    if (L >= 0) {
      // L is not only a bound but met: the witness halts in exactly L steps.
      const w = oracle(p, placeWitness(p, v.witness));
      assert.ok(w.to(L), `${label}: the witness halts before L`);
      assert.equal(w.step(), false, `${label}: the witness halts at L`);
      assert.equal(w.state, v.witness.halt.state, `${label}: in the halt it names`);
      assert.equal(w.halted, v.witness.halt.read < 0 ? 'accept' : 'none', `${label}: how the witness halts`);
    }
  } else {
    assert.equal(v.verdict, 'unknown');
    assert.equal(v.method, null);
    assert.ok(o.to(budget), `${label}: halted within the budget, but was called unknown`);
  }
}

// ── champions ─────────────────────────────────────────────────────
// Published step counts and ones, from the bbchallenge wiki and Shawn
// Ligocki's machine files. A 1RZ halt is a transition into the accepting
// halt state, so it counts as a step — which is how these are counted.

const CHAMPIONS = [
  ['BB(2)', '1RB1LB_1LA1RZ', 6, 4],
  ['BB(3), steps', '1RB1RZ_1LB0RC_1LC1LA', 21, 5],
  ['BB(3), ones', '1RB1RZ_0RC1RB_1LC1LA', 14, 6],
  ['BB(4)', '1RB1LB_1LA0LC_1RZ1LD_1RD0RA', 107, 13],
  ['BB(2,3)', '1RB2LB1RZ_2LA2RB1LB', 38, 9],
  ['BB(2,4)', '1RB2LA1RA1RA_1LB1LA3RB1RZ', 3932964, 2050],
  ['BB(5)', '1RB1LC_1RC1RB_1RD0LE_1LA1LD_1RZ0LA', 47176870, 4098]
];

for (const [name, src, steps, ones] of CHAMPIONS) {
  test(`the ${name} champion halts after ${steps.toLocaleString('en')} steps with ${ones} ones`, () => {
    const v = context.classifyBehaviourNow(load(src), { budget: 5e7 });
    assert.equal(v.verdict, 'halts');
    assert.equal(v.method, 'simulation');
    assert.equal(v.how, 'accept');
    assert.equal(v.steps, steps);
    assert.equal(v.ones, ones);
  });
}

// ── hand-made machines ────────────────────────────────────────────
// Each of the run's own methods is shown on a machine that *could* halt from
// some tape — just not this one — so backward reasoning cannot settle it
// first. Where it could, `backward: false` leaves it out.

test('a machine that shuttles between two cells is a cycler', () => {
  const p = load('0RB0RB_0LA0LA');
  const v = context.classifyBehaviourNow(p, { budget: 1000, backward: false });
  assert.equal(v.verdict, 'never');
  assert.equal(v.method, 'cycler');
  assert.equal(v.period, 2);
  assert.equal(v.from, 0);
  checkVerdict(p, v, 1000, 'shuttle');
});

test('a machine that writes 1 and moves right forever is a translated cycler', () => {
  // It would halt on reading a 1, and a tape with a 1 ahead of it reaches
  // that from as far back as you like — so backward reasoning gives up.
  const p = load('1RA0RZ');
  const v = context.classifyBehaviourNow(p, { budget: 1000 });
  assert.equal(v.verdict, 'never');
  assert.equal(v.method, 'translated');
  assert.equal(v.direction, 'right');
  assert.equal(v.period, 1);
  assert.equal(v.shift, 1);
  checkVerdict(p, v, 1000, 'runaway');
});

test('the same, going left on a two-way tape, is a translated cycler going left', () => {
  const p = load('1LA0LZ');
  const v = context.classifyBehaviourNow(p, { budget: 1000 });
  assert.equal(v.method, 'translated');
  assert.equal(v.direction, 'left');
  checkVerdict(p, v, 1000, 'runaway left');
});

test('going left on a one-way tape is stopped by the wall: a cycler, not a traveller', () => {
  const p = load('1LA1LA', 'TM');
  const v = context.classifyBehaviourNow(p, { budget: 1000, backward: false });
  assert.equal(v.method, 'cycler');
  checkVerdict(p, v, 1000, 'against the wall');
});

const COUNTER = '1RB1LA---_0LA0RB0RB_2RC2RC2RC';

test('a binary counter is neither, and is reported unknown rather than guessed', () => {
  // Counts up in binary forever (Ligocki's 2x2-Counter): it never repeats
  // and never settles into a translation — the textbook case for "unknown".
  // A state it never enters writes a third symbol, and A has no move on it:
  // a way to halt that some other tape reaches from arbitrarily far back, so
  // backward reasoning cannot settle it. (A symbol nothing writes would not
  // do — the machine can never meet it, so it is no way to halt.)
  const p = load(COUNTER);
  const budget = 20000;
  const v = context.classifyBehaviourNow(p, { budget });
  assert.equal(v.verdict, 'unknown');
  assert.equal(v.method, null);
  assert.equal(v.steps, budget);
  assert.equal(v.backward.reason, 'depth', 'backward reasoning found a path back that did not die');
  checkVerdict(p, v, budget, 'counter');
});

test('a classification runs a slice at a time and stops at its budget', () => {
  const p = load(COUNTER);
  const c = context.classifyBehaviour(p, { budget: 5000 });
  assert.equal(c.advance(100), null);
  assert.equal(c.steps, 100);
  let v;
  while (!(v = c.advance(700)));
  assert.equal(v.verdict, 'unknown');
  assert.equal(v.steps, 5000);
  assert.equal(c.advance(10), v, 'a finished classification answers the same again');
});

// ── backward reasoning ────────────────────────────────────────────

test('a machine with no way to halt is settled by backward reasoning before it takes a step', () => {
  // The two-symbol counter: a move for every state and symbol, and nothing
  // accepting. Nothing can stop it, which is a better reason than any run.
  for (const tape of ['ITM', 'TM']) {
    const p = load('1RB1LA_0LA0RB', tape);
    const v = context.classifyBehaviourNow(p, { budget: 1000 });
    assert.equal(v.verdict, 'never');
    assert.equal(v.method, 'backward');
    assert.equal(v.longest, -1);
    assert.equal(v.steps, 0);
    assert.deepEqual(v.halts, []);
    assert.equal(v.witness, null);
    checkVerdict(p, v, 1000, `counter, ${tape}`);
  }
});

test('backward reasoning proves a halt unreachable from more than three steps back', () => {
  // B reading 1 is the only way to stop, and every path back to it dies
  // within three steps — found among the random machines below.
  const p = load('1LB0RC_0RA---_1LB0LA');
  const v = context.classifyBehaviourNow(p, { budget: 1000 });
  assert.equal(v.method, 'backward');
  assert.equal(v.longest, 3);
  assert.equal(v.steps, 4, 'settled once the run has gone past L');
  assert.deepEqual(v.halts, [{ state: 1, read: 1, depth: 3 }]);
  checkVerdict(p, v, 1000, 'three back');
});

test('a symbol the machine can never meet is no way to halt', () => {
  // The same counter with a third symbol nothing writes: A has no move on it,
  // but no run from a blank tape can ever read it. From a tape that has one,
  // it can.
  const blank = load('1RB1LA---_0LA0RB---');
  const v = context.classifyBehaviourNow(blank, { budget: 1000 });
  assert.equal(v.method, 'backward');
  assert.equal(v.longest, -1);
  assert.deepEqual([...context.symbolsMet(blank)], [1, 1, 0]);
  const p = context.compileBehaviourMachine([blank.symbols[2]]);
  assert.ok(p.ok, p.error);
  assert.equal(context.classifyBehaviourNow(p, { budget: 1000 }).verdict, 'halts', 'starting on it, A reads it and stops');
});

test('a machine that halts is never called "never" by backward reasoning', () => {
  // Halting runs are paths back of any length, so the search runs out of
  // depth rather than out of paths — on the champions too.
  for (const [, src] of CHAMPIONS) {
    const b = context.backwardReasoning(load(src));
    assert.equal(b.ok, false, src);
  }
});

test('on a one-way tape, a left move stopped by the wall is a way back of its own', () => {
  // A at cell 0 writes 1 and tries to move left; the wall holds it there, so
  // B reads the 1 it just wrote and goes right, and the machine comes back to
  // halt on it at step 4. A search that only moved the head found every path
  // back dead within three steps and called this machine "never" — found by
  // taking the wall's branch out and sweeping random one-way machines.
  const p = load('1LB---_---1RA', 'TM');
  const b = context.backwardReasoning(p);
  assert.ok(!b.ok || b.longest >= 4, `L = ${b.longest}, but it halts at step 4`);
  const v = context.classifyBehaviourNow(p, { budget: 1000 });
  assert.equal(v.verdict, 'halts');
  assert.equal(v.steps, 4);
  checkVerdict(p, v, 1000, 'bump');
});

test('backward reasoning holds up on random configurations, not just the blank tape', () => {
  // L is a claim about every configuration: none halts more than L steps
  // later. So drop each proved machine into random ones — random state,
  // random cells around the head, and on a one-way tape a random distance
  // from the wall — and check that none does. Machines with many halting
  // transitions, so that most proofs are about a real halt, not an absent one.
  // The claim is over the symbols the machine can meet, so the random cells
  // are drawn from those, worked out here rather than asked of the module.
  let s = 12345;
  const r = n => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) % n);
  const seen = { proofs: 0, deep: 0, walled: 0 };
  for (const tape of ['ITM', 'TM']) {
    for (let i = 0; i < 600; i++) {
      const n = 2 + r(3), k = 2 + r(2);
      const rows = [];
      for (let q = 0; q < n; q++) {
        let row = '';
        for (let c = 0; c < k; c++) row += r(100) < 22 ? '---' : `${r(k)}${r(2) ? 'L' : 'R'}${String.fromCharCode(65 + r(n))}`;
        rows.push(row);
      }
      const src = rows.join('_');
      const p = load(src, tape);
      const b = context.backwardReasoning(p);
      if (!b.ok) continue;
      seen.proofs++;
      if (b.longest >= 2) seen.deep++;
      if (b.witness && b.witness.wall !== null) seen.walled++;
      const met = new Set([0]);
      for (let grew = true; grew;) {
        grew = false;
        for (let e = 0; e < p.Q * p.K; e++) {
          if (p.next[e] >= 0 && met.has(e % p.K) && !met.has(p.write[e])) { met.add(p.write[e]); grew = true; }
        }
      }
      const syms = [...met];
      for (let j = 0; j < 60; j++) {
        const from = { state: r(p.Q), head: 0, tape: new Map() };
        const lo = p.twoWay ? -6 : 0;
        from.head = lo + r(7);
        for (let x = lo; x < lo + 13; x++) { const c = syms[r(syms.length)]; if (c) from.tape.set(x, c); }
        const o = oracle(p, from);
        o.to(b.longest + 40);
        assert.ok(o.halted === null || o.t <= b.longest, `${tape} ${src}: a configuration halts after ${o.t} steps, but L = ${b.longest}`);
      }
      const v = context.classifyBehaviourNow(p, { budget: 2000 });
      checkVerdict(p, v, 2000, `${tape} ${src}`);
    }
  }
  assert.ok(seen.proofs >= 200 && seen.deep >= 30 && seen.walled >= 10, JSON.stringify(seen));
});

// ── random machines, against the oracle ───────────────────────────

function randomMachine(seed) {
  let s = seed >>> 0 || 1;
  const r = () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
  const n = 2 + Math.floor(r() * 3), k = r() < 0.75 ? 2 : 3;
  const rows = [];
  for (let q = 0; q < n; q++) {
    let row = '';
    for (let c = 0; c < k; c++) {
      if (r() < 0.06) { row += '---'; continue; }
      const to = r() < 0.07 ? 'Z' : String.fromCharCode(65 + Math.floor(r() * n));
      row += `${Math.floor(r() * k)}${r() < 0.5 ? 'L' : 'R'}${to}`;
    }
    rows.push(row);
  }
  return rows.join('_');
}

for (const tape of ['ITM', 'TM']) {
  test(`random machines on a ${tape === 'ITM' ? 'two-way' : 'one-way'} tape: every verdict holds up against the oracle`, () => {
    // Each machine is classified twice, with backward reasoning and without:
    // it settles most of these first, and would leave too few cyclers to
    // test. The two runs' proofs are independent, so where both found one
    // they must agree on the answer.
    const seen = { simulation: 0, cycler: 0, translated: 0, backward: 0, unknown: 0 };
    const budget = 3000;
    for (let seed = 1; seed <= 1500; seed++) {
      const src = randomMachine(seed * 7919 + (tape === 'TM' ? 1 : 0));
      const p = load(src, tape);
      const both = [true, false].map(backward => context.classifyBehaviourNow(p, { budget, backward }));
      for (const v of both) {
        seen[v.method ?? 'unknown']++;
        checkVerdict(p, v, budget, `${tape} ${src}`);
      }
      const [a, b] = both.map(v => v.verdict);
      if (a !== 'unknown' && b !== 'unknown') assert.equal(a, b, `${tape} ${src}: ${both[0].method} and ${both[1].method} disagree`);
    }
    // Only worth something if every method was actually exercised. Unknown is
    // rare among machines this small, so it is asked for a handful.
    for (const kind of Object.keys(seen)) assert.ok(seen[kind] >= (kind === 'unknown' ? 3 : 15), `${kind}: only ${seen[kind]} (${JSON.stringify(seen)})`);
  });
}

// ── the app's machine, not just the notation ──────────────────────

test('wildcards, a stay-put move and an input word mean what they mean in the player', () => {
  harness.resetApp();
  const { App, setMachine } = context;
  setMachine('TM');
  const B = App.config.sym.blank, any = App.config.sym.any;
  App.states.push({ id: 'a', name: 'a', x: 0, y: 0 }, { id: 'b', name: 'b', x: 0, y: 0 }, { id: 'h', name: 'h', x: 0, y: 0 });
  App.startId = 'a';
  App.accepts.add('h');
  App.sigma = new Set(['x', 'y']);
  App.tapeAlphabet = new Set(['x', 'y', B]);
  App.transitions.push(
    { id: '1', from: 'a', to: 'a', symbol: any, write: any, dir: 'R' },   // skip the word
    { id: '2', from: 'a', to: 'b', symbol: B, write: 'y', dir: 'S' },     // stay put once
    { id: '3', from: 'b', to: 'h', symbol: 'y', write: 'x', dir: 'L' }
  );
  const p = context.compileBehaviourMachine(['x', 'y', 'x']);
  assert.ok(p.ok);
  const v = context.classifyBehaviourNow(p, { budget: 100 });
  assert.equal(v.verdict, 'halts');
  assert.equal(v.how, 'accept');
  // Against the player on the same word: the same number of steps.
  App.config.maxTmSteps = 100;
  const run = context.traceMachine('TM', ['x', 'y', 'x']);
  assert.equal(run.steps.length - 1, v.steps);
  assert.equal(run.steps[run.steps.length - 1].final, 'accept');
  checkVerdict(p, v, 100, 'wildcards');
});

test('only a deterministic one-tape machine is offered', () => {
  harness.resetApp();
  context.setMachine('NDTM');
  assert.equal(context.compileBehaviourMachine([]).ok, false);
});

// ── the section ───────────────────────────────────────────────────

const until = async (pred, ms = 20000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 5));
  }
};

/** The header index.html gives the section, so its folded status chip has a home. */
function withHeader() {
  const el = context.$('rp-behaviour');
  delete el.__secStatus;
  const header = context.document.createElement('div');
  header.className = 'rp-section-header';
  const arrow = context.document.createElement('span');
  arrow.className = 'rp-toggle-arrow';
  header.appendChild(arrow);
  header.querySelector = sel => (sel.includes('rp-toggle-arrow') ? arrow : null);
  el.appendChild(header);
}

test('the Behaviour section is offered for TM and ITM only', () => {
  harness.resetApp();
  const { PANEL_SECTIONS } = context;
  assert.equal(PANEL_SECTIONS.rpanel.sections.find(s => s.id === 'rp-behaviour').fill, '.bh-out');
  const sec = harness.getElement('rp-behaviour');
  for (const [m, shown] of [['TM', true], ['ITM', true], ['NDTM', false], ['DFA', false], ['LBA', false]]) {
    context.setMachine(m);
    context.syncBehaviourSection();
    assert.equal(sec.style.display === '', shown, `${m} ${shown ? 'shows' : 'hides'} it`);
  }
});

test('Classify runs a slice at a time and shows the verdict with its evidence', async () => {
  load('1RB1LB_1LA0LC_1RZ1LD_1RD0RA');   // BB(4)
  withHeader();
  context.syncBehaviourSection();
  context.startClassify();
  await until(() => !context._behaviourTests.running);
  const v = context._behaviourTests.result;
  assert.equal(v.verdict, 'halts');
  assert.equal(v.steps, 107);
  const body = harness.getElement('bh-body');
  assert.match(body.innerHTML, /Halts/);
  assert.match(body.innerHTML, /107/);
  assert.deepEqual(context.sectionStatus('rp-behaviour'), { text: 'halts', tone: 'acc' });
});

test('a translated cycler shows both windows, and an edit marks the answer stale', async () => {
  load('1RA0RZ');
  withHeader();
  context.syncBehaviourSection();
  context.startClassify();
  await until(() => !context._behaviourTests.running);
  assert.equal(context._behaviourTests.result.method, 'translated');
  const body = harness.getElement('bh-body');
  assert.match(body.innerHTML, /translated cycler/);
  assert.equal((body.innerHTML.match(/bh-strip"/g) || []).length, 2, 'two windows drawn');
  context.App.transitions[0].write = context.App.config.sym.blank;
  context.emit(context.Change.GRAPH);
  assert.equal(context._behaviourTests.stale, true);
  assert.match(context.sectionStatus('rp-behaviour').text, /stale/);
});

test('a backward-reasoning card names its method, draws its witness, and offers no jump into the run', async () => {
  load('1LB0RC_0RA---_1LB0LA');
  withHeader();
  context.syncBehaviourSection();
  context.startClassify();
  await until(() => !context._behaviourTests.running);
  const v = context._behaviourTests.result;
  assert.equal(v.method, 'backward');
  const body = harness.getElement('bh-body');
  assert.match(body.innerHTML, /Never halts/);
  assert.match(body.innerHTML, /bh-sub">backward reasoning</, "the method under the verdict");
  assert.match(body.innerHTML, /is-never/, 'coloured by its verdict, not its method');
  assert.equal((body.innerHTML.match(/bh-strip"/g) || []).length, 1, 'the witness drawn');
  assert.doesNotMatch(body.innerHTML, /Show in player/, 'the witness is not a step of this run');
  assert.deepEqual(context.sectionStatus('rp-behaviour'), { text: 'never halts', tone: 'rej' });
});

test('the cycle-start search compares the whole tape it used, not just the cell under the head', () => {
  // Found by looking at the card: the copies that search for μ kept no range
  // of their own, so the picture showed three cells of five — and the same
  // range is what confirms a hash match.
  const p = load('1RD0RB_0LB1LA_1RB1LC_1LC0RA');
  const v = context.classifyBehaviourNow(p, { budget: 1000, backward: false });
  assert.equal(v.method, 'cycler');
  assert.equal(v.cells, 5);
  assert.equal(v.at.cells.length, 5, 'the picture holds every cell the machine used');
  checkVerdict(p, v, 1000, 'five-cell cycler');
});

test('each workspace tab keeps its own answer', async () => {
  // Pasting a machine opens a new tab; the last tab's answer used to follow
  // it there, marked stale, as though the new machine had been edited.
  // The app always has a tab; the harness starts with none, so make one.
  harness.resetApp();
  context.createTab('first');
  const first = context.activeWorkspaceId;
  const d = context.readStandardTM('1RB1LB_1LA0LC_1RZ1LD_1RD0RA', context.App.config.sym);   // BB(4)
  context.loadData({
    format: context.WORKSPACE_FORMAT, schema: context.SCHEMA_VERSION,
    machine: 'ITM', sigma: d.sigma, stackAlpha: d.stackAlpha, tapeCount: 1,
    states: d.states.map((s, i) => ({ ...s, x: i * 80, y: 0 })),
    transitions: d.transitions, startId: d.startId, accepts: d.accepts, notes: [], dividers: []
  }, true);
  withHeader();
  context.syncBehaviourSection();
  context.startClassify();
  await until(() => !context._behaviourTests.running);
  assert.equal(context._behaviourTests.result.verdict, 'halts');

  context.createTab('another');
  context.syncBehaviourSection();
  assert.equal(context._behaviourTests.result, null, 'a new tab starts with no answer');
  assert.equal(context._behaviourTests.stale, false);

  context.switchTab(first);
  context.syncBehaviourSection();
  assert.equal(context._behaviourTests.result?.verdict, 'halts', 'and the first tab gets its answer back');
  assert.equal(context._behaviourTests.stale, false);
});
