// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// Testing a submachine.
//
// Drilling into a block used to change what you could see and nothing about
// what you could do: the run box ran the whole machine from its own start
// state, so pressing play inside CPU/ALU/add ran the CPU, and if control never
// reached the adder on that word you learned nothing about the adder.
//
// Two questions that look like two features and are one — a **run boundary**:
//
//     subject   run this block: start at its entry, stop when control leaves
//     break     run the whole machine, pause when control first enters
//
// The invariants these pin:
//
//   * **The machine layer is not taught anything.** A boundary is a bound on
//     the player's cursor, so the steps a block run shows are exactly the steps
//     the whole-machine run would have shown from that point. The one thing the
//     machine layer reads is *where to start*, and that is one declaration.
//   * **A block has no verdict.** Its accepting marks are dropped when it is
//     inlined, so the answer is which exit control left by.
//   * **Nothing reaches a serializer.** A file that recorded a start state
//     which is not the machine's start would be a file that lies.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, context, getElement } from './harness.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const harness = createHarness();
const BLANK = '⊔';
const ANY = 'Σ';

// A TM whose interesting part is a block.
//
//   host:  h0 --a--> B.scan
//   B:     scan --a--> scan          (loop while there are a's)
//          scan --b--> yes           (declared exit "yes")
//          scan --⊔--> no            (declared exit "no")
//          yes  --Σ/Σ,S--> h1        (out of the block)
//          no   --Σ/Σ,S--> h2        (out of the block)
function hostWithBlock() {
  harness.resetApp();
  const { App } = context;
  App.machine = 'TM';
  App.sigma = new Set(['a', 'b']);
  App.stackAlpha = new Set(['a', 'b', BLANK]);
  App.states = [
    { id: 'h0', name: 'h0', x: -200, y: 0 },
    { id: 'h1', name: 'h1', x: 300, y: -80 },
    { id: 'h2', name: 'h2', x: 300, y: 80 },
    { id: 'sc', name: 'B/scan', x: 0, y: 0, blockId: 'B' },
    { id: 'yy', name: 'B/yes', x: 120, y: -60, blockId: 'B' },
    { id: 'nn', name: 'B/no', x: 120, y: 60, blockId: 'B' }
  ];
  App.blocks = [{
    id: 'B', name: 'B', parent: null, entry: 'sc',
    exits: [{ id: 'yy', label: 'yes' }, { id: 'nn', label: 'no' }], x: 0, y: 0
  }];
  App.startId = 'h0';
  App.accepts = new Set(['h1']);
  App.transitions = [
    { id: 't0', from: 'h0', to: 'sc', symbol: ANY, write: ANY, dir: 'S' },
    { id: 't1', from: 'sc', to: 'sc', symbol: 'a', write: 'a', dir: 'R' },
    { id: 't2', from: 'sc', to: 'yy', symbol: 'b', write: 'b', dir: 'R' },
    { id: 't3', from: 'sc', to: 'nn', symbol: BLANK, write: BLANK, dir: 'S' },
    { id: 't4', from: 'yy', to: 'h1', symbol: ANY, write: ANY, dir: 'S' },
    { id: 't5', from: 'nn', to: 'h2', symbol: ANY, write: ANY, dir: 'S' }
  ];
  context.invalidateBlockIndex();
  context.invalidateViewGraph();
  context.invalidateRunScope();
  return App;
}

function run(word) {
  getElement('sim-in').value = word;
  context.runSim();
  context.stopAutoPlay();
  context.stepToEnd();
  return context.App;
}

const statesOf = () => context.App.simSteps.map(s => s.state);

// ── where a run begins ────────────────────────────────────────────

test('the machine layer asks one function where a run starts', () => {
  // App.startId draws the start arrow, is q0 in the formal definition and is
  // what every exporter writes; a run starting elsewhere must not move it. So
  // the override is a second field and runStartId() is the single read — a
  // parameter threaded through twenty-five simulators would be twenty-four
  // passing it on and one quietly deciding from the wrong state.
  hostWithBlock();
  assert.equal(context.runStartId(), 'h0');
  context.setRunSubject('B');
  assert.equal(context.runStartId(), 'sc', 'the block entry');
  assert.equal(context.App.startId, 'h0', 'and the machine start has not moved');
});

test('nothing under js/machines reads App.startId directly', () => {
  // The claim runStartId() rests on, asserted against the source rather than
  // trusted: twenty-five reads of the start state, and one of them left behind
  // is one simulator quietly deciding from a state the run did not start at.
  // The same shape of assertion tests/parallel.test.js makes about the layer's
  // imports, and for the same reason — a new simulator inherits the rule only
  // if something fails when it does not.
  const dir = join(process.cwd(), 'js', 'machines');
  const offenders = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.js')) continue;
    if (/App\.startId/.test(readFileSync(join(dir, f), 'utf8'))) offenders.push(f);
  }
  assert.deepEqual(offenders, [], 'use runStartId() from js/state.js');
});

test('deciding is about the machine, however the run box is pointed', () => {
  // The subject scopes the *player*. Deciding is a different question and it
  // was quietly getting the same answer: with a subject picked, every row of
  // the Test Words table and every cell of the Language fingerprint started
  // from the block's entry, so a word could flip from reject to accept with
  // nothing anywhere saying why. It is wrong rather than merely surprising —
  // a block has no F, which is the whole reason a block run reports an exit
  // instead of a verdict, and the Language panel prints the machine's own q0
  // and F right beside the grid it would have scoped.
  const App = hostWithBlock();
  // `b` cannot reach the block from h0, and accepts from inside it.
  App.transitions[0] = { id: 't0', from: 'h0', to: 'sc', symbol: 'a', write: 'a', dir: 'S' };
  context.invalidateRunScope();
  const verdicts = () => context.computeBatchResults(['aab', 'b']).results.map(r => r.verdict);
  const machineSays = verdicts();
  assert.deepEqual(machineSays, ['accept', 'reject'], 'from the machine start');

  context.setRunSubject('B');
  assert.equal(context.runStartId(), 'sc', 'the player does start inside the block');
  assert.deepEqual(verdicts(), machineSays, 'and the table still answers about the machine');
  assert.equal(context.App.simStart, 'sc', 'the override is lifted, not cleared');
});

test('the worker snapshot decides from the machine start, like the main thread', () => {
  hostWithBlock();
  context.setRunSubject('B');
  const snap = context.snapshotMachine();
  assert.equal(snap.startId, 'h0');
  assert.equal(snap.simStart, undefined,
    'a worker only ever decides, and deciding is about the machine');
  assert.ok(structuredClone(snap), 'and it is still postable');
});

// ── running one block ─────────────────────────────────────────────

test('a block run starts at the entry and never shows a step outside', () => {
  hostWithBlock();
  context.setRunSubject('B');
  run('aab');
  const inside = new Set(['sc', 'yy', 'nn']);
  assert.ok(statesOf().length > 1, 'it ran');
  assert.equal(statesOf()[0], 'sc', 'from the entry, not from h0');
  const shown = context.App.simSteps.slice(0, context.App.simIdx + 1);
  assert.ok(shown.every(s => inside.has(s.state)),
    'every step the reader can reach is inside the block');
});

test('the answer is which exit it left by, not accept or reject', () => {
  hostWithBlock();
  context.setRunSubject('B');
  run('aab');
  const exit = context.App.simExit;
  assert.ok(exit, 'control left');
  assert.equal(exit.label, 'yes');
  assert.equal(exit.declared, true);
  assert.equal(exit.fromName, 'yes', 'named in the block’s own terms');
  assert.equal(exit.toName, 'h1', 'and where the host took it');
});

test('a different word leaves by a different exit', () => {
  hostWithBlock();
  context.setRunSubject('B');
  run('aa');
  assert.equal(context.App.simExit.label, 'no');
});

test('an undeclared way out is reported as one rather than rounded to a label', () => {
  // It is a real result, and it is also exactly what stops the block being
  // reusable: a copy placed elsewhere would have that wire hanging off a state
  // the definition never mentioned.
  const App = hostWithBlock();
  App.blocks[0].exits = [{ id: 'yy', label: 'yes' }];   // `no` is no longer declared
  context.invalidateBlockIndex();
  context.setRunSubject('B');
  run('aa');
  assert.equal(context.App.simExit.declared, false);
  assert.equal(context.App.simExit.label, null);
  assert.equal(context.App.simExit.fromName, 'no');
});

test('a run that never leaves says so instead of borrowing a verdict', () => {
  const App = hostWithBlock();
  App.transitions = App.transitions.filter(t => t.id !== 't4' && t.id !== 't5');
  context.setRunSubject('B');
  run('aab');
  assert.equal(context.App.simExit, null, 'no exit, and none invented');
  assert.equal(context.App.simStopAt, null, 'the boundary was never crossed');
});

test('a block run is step-for-step the whole-machine run from that point', () => {
  // The invariant the whole design rests on: a boundary bounds the cursor, it
  // does not change the computation. Teaching twenty-five simulators to halt at
  // a subtree would be twenty-five ways to disagree with this.
  hostWithBlock();
  run('aab');
  const whole = context.App.simSteps.map(s => s.state);
  const enters = whole.indexOf('sc');

  hostWithBlock();
  context.setRunSubject('B');
  run('aab');
  const block = statesOf().slice(0, context.App.simIdx + 1);
  assert.deepEqual(block, whole.slice(enters, enters + block.length));
});

// ── breaking in ───────────────────────────────────────────────────

test('a break scope pauses playback where control enters, and stops nothing', () => {
  hostWithBlock();
  context.setBreakScope('B');
  getElement('sim-in').value = 'aab';
  context.runSim();
  // runSim starts playback; the tick that materializes the entering step is
  // what pauses it. Driven here rather than waited on: a test that slept for
  // the interval would be a slow test asserting a race.
  context.stopAutoPlay();
  context.stepToEnd();
  assert.equal(context.App.simStopAt, null, 'the run is untouched — it is a pause, not a stop');
  assert.ok(statesOf().includes('h1'), 'and the whole run is still reachable');
});

test('breaking in is offered only while the subject is the machine', () => {
  // "Stop when you get here" and "start here" are the same question asked two
  // ways, and asking to stop on entering the block you are starting inside has
  // no answer.
  const App = hostWithBlock();
  App.scope = ['B'];
  context.invalidateViewGraph();
  context.setBreakScope('B');
  context.setRunSubject('B');
  context.syncRunSubjectUI();
  assert.equal(getElement('sim-break-lbl').hidden, true);
  assert.equal(context.App.simBreakAt, null);
});

// ── the control ───────────────────────────────────────────────────

test('the picker offers the machine and every block you are standing inside', () => {
  const App = hostWithBlock();
  App.scope = ['B'];
  context.invalidateViewGraph();
  assert.deepEqual(context.runSubjects().map(x => x.id), [null, 'B']);
});

test('at the top level there is nothing to choose, so the row is not shown', () => {
  hostWithBlock();
  context.syncRunSubjectUI();
  assert.equal(getElement('sim-subject-row').hidden, true);
  assert.deepEqual(context.runSubjects().map(x => x.id), [null]);
});

test('walking out of a block drops the subject it named', () => {
  const App = hostWithBlock();
  App.scope = ['B'];
  context.invalidateViewGraph();
  context.setRunSubject('B');
  App.scope = [];
  context.invalidateViewGraph();
  assert.equal(context.syncRunSubject(), null);
});

// ── it is session state ───────────────────────────────────────────

test('none of it reaches a serializer', () => {
  // A saved machine whose start state is not its start state would be a file
  // that lies. The same reasoning js/scope.js gives for the per-scope cameras.
  hostWithBlock();
  context.setRunSubject('B');
  context.setBreakScope('B');
  run('aab');

  const blobs = [
    JSON.stringify(context.exportWorkspaceState()),
    JSON.stringify(context.getWorkspaceData()),
    JSON.stringify(context.App.history.length ? context.App.history : ['-'])
  ];
  for (const blob of blobs) {
    for (const key of ['runSubject', 'simStart', 'simBreakAt', 'simStopAt', 'simExit']) {
      assert.ok(!blob.includes(key), `${key} must not be saved`);
    }
    assert.ok(JSON.parse(blob).startId === 'h0' || !('startId' in JSON.parse(blob)),
      'and the machine start is the one that is written');
  }
});

test('replacing the machine drops the subject; running another word does not', () => {
  hostWithBlock();
  context.setRunSubject('B');
  run('aab');
  context.resetSim();
  assert.equal(context.App.runSubject, 'B', 'the subject is what you are investigating');
  assert.equal(context.App.simStopAt, null, 'where the last run stopped goes with it');

  context.resetWorkspace();
  assert.equal(context.App.runSubject, null, 'but the block it named has gone');
  assert.equal(context.App.simStart, null);
});

// ── the boundary must not cost the run its laziness ───────────────

test('a subject does not drain a streaming run to find its boundary', () => {
  // The hazard the scan exists to avoid, and it is the one worth a test because
  // it looks like nothing: "how far may the reader go" is asked on every render,
  // and answered by walking the cursor it would pull every step of the run on
  // the first frame — which is exactly the frozen tab lazy execution prevents.
  // So the scan reads `steps` directly and never pulls.
  const App = hostWithBlock();
  App.config.execMode = 'lazy';
  App.config.maxTmSteps = 5000;
  // A machine that never leaves the block and never halts: nothing can find a
  // boundary, so any pulling here would run to the budget.
  App.transitions = [
    { id: 't0', from: 'h0', to: 'sc', symbol: ANY, write: ANY, dir: 'S' },
    { id: 't1', from: 'sc', to: 'sc', symbol: ANY, write: ANY, dir: 'R' }
  ];
  context.setRunSubject('B');

  getElement('sim-in').value = 'aaaa';
  context.runSim();
  context.stopAutoPlay();

  assert.ok(context.App.simSteps.length < 50,
    `a lazy run should still be lazy with a subject set (computed ${context.App.simSteps.length} steps)`);
  assert.equal(context.App.simStopAt, null, 'and no boundary has been found, because none was crossed');
});

test('the scan is amortized, not repeated per ask', () => {
  // Keyed on the steps array with a cursor, so a run is walked once across all
  // the times anything asks — a render, a step, a scrub. Asserted as an
  // invariant on the work done rather than as a timing.
  const App = hostWithBlock();
  App.transitions = [
    { id: 't0', from: 'h0', to: 'sc', symbol: ANY, write: ANY, dir: 'S' },
    { id: 't1', from: 'sc', to: 'sc', symbol: 'a', write: 'a', dir: 'R' },
    { id: 't2', from: 'sc', to: 'yy', symbol: BLANK, write: BLANK, dir: 'S' },
    { id: 't4', from: 'yy', to: 'h1', symbol: ANY, write: ANY, dir: 'S' }
  ];
  context.setRunSubject('B');
  run('a'.repeat(200));

  const stopped = context.App.simStopAt;
  assert.ok(stopped > 100, 'it ran the whole word inside the block');
  // Every later ask is answered from the recorded bound, so scrubbing back and
  // forth cannot re-walk the trace.
  for (let i = 0; i < 20; i++) context.scrubSim(String(i % (stopped + 1)));
  assert.equal(context.App.simStopAt, stopped);
});

// ── what the reader is actually shown ─────────────────────────────
//
// Every test above reaches the end of a run through stepToEnd(), which was the
// one control that worked. Play and step-forward — the two anyone uses — did
// not, and nothing here noticed because nothing here pressed them.

const verdictEl = () => getElement('sim-verdict');
const verdictText = () =>
  verdictEl().innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Step forward the way the play button does, until the run stops moving. */
function playToEnd(limit = 200) {
  for (let i = 0; i < limit; i++) {
    const at = context.App.simIdx;
    context.stepFwd();
    if (context.App.simIdx === at) return;
  }
}

test('stepping a block run to its end shows the exit it left by', () => {
  // The step that trips the boundary is materialized inside stepAt and then
  // refused, so the exit becomes known *after* the last frame was drawn — and
  // with nothing to redraw it, the reader was left looking at the verdict from
  // before control left. Which for a block run is "No exit", the one answer
  // certain to be wrong by then.
  hostWithBlock();
  context.setRunSubject('B');
  getElement('sim-in').value = 'aab';
  context.runSim();
  context.stopAutoPlay();
  playToEnd();

  assert.equal(context.App.simExit?.label, 'yes', 'control did leave by "yes"');
  assert.match(verdictText(), /yes/, 'and the banner says so');
  assert.doesNotMatch(verdictText(), /No exit/);
  assert.equal(context.App.simIdx, context.App.simStopAt,
    'held at the last step still inside');
});

test('a block run says nothing until there is something to say', () => {
  // On a streaming run the newest materialized step is always the last one, so
  // `isLast` is true on every tick — and this branch drew a banner where an
  // ordinary machine falls through to a hidden one. "No exit — control never
  // left B" flashed past on every frame of a run still inside the block.
  hostWithBlock();
  context.setRunSubject('B');
  getElement('sim-in').value = 'aab';
  context.runSim();
  context.stopAutoPlay();

  for (let i = 0; i < 3; i++) {
    context.stepFwd();
    if (context.App.simStopAt != null) break;
    assert.equal(verdictEl().style.display, 'none',
      `mid-run, step ${context.App.simIdx}: no verdict is known yet`);
  }
});

test('a run that never leaves still says so at the end', () => {
  const App = hostWithBlock();
  App.transitions = App.transitions.filter(t => t.id !== 't4' && t.id !== 't5');
  context.setRunSubject('B');
  getElement('sim-in').value = 'aab';
  context.runSim();
  context.stopAutoPlay();
  playToEnd();

  assert.equal(context.App.simExit, null);
  assert.match(verdictText(), /No exit/,
    'the block never handed control back, which is what a caller would wait on');
});

test('the trace count is the prefix the reader can reach', () => {
  // The steps past the boundary have been computed and belong to the host
  // machine, so counting them had the Trace header say 5 over a scrubber
  // reading "4 / 4".
  hostWithBlock();
  context.setRunSubject('B');
  run('aab');
  assert.ok(context.App.simSteps.length > context.App.simStopAt + 1,
    'a step past the boundary really was computed');
  assert.equal(getElement('rp-count-trace').textContent,
    String(context.App.simStopAt + 1));
});

test('picking a subject drops a run that was not about it', () => {
  // A finished whole-machine run — one that went through the block and out to
  // an accepting state — was relabelled the moment the reader picked that
  // block: ACCEPT became "No exit, control never left B", which is false about
  // the very trace still drawn under it. And it could not correct itself: the
  // boundary scan is a cursor over an array it had already walked to the end.
  hostWithBlock();
  getElement('sim-in').value = 'aab';
  run('aab');
  assert.ok(context.App.simSteps.length > 1, 'the machine ran');

  context.App.scope = ['B'];
  context.invalidateViewGraph();
  context.setRunSubjectFromUI('B');

  assert.equal(context.App.simSteps.length, 0, 'the run went with the subject');
  assert.equal(verdictEl().style.display, 'none', 'and so did its verdict');
  assert.equal(context.App.runSubject, 'B', 'the subject itself is set');
});

test('turning the break scope on and off does not relabel the run on screen', () => {
  hostWithBlock();
  context.App.scope = ['B'];
  context.invalidateViewGraph();
  run('aab');
  assert.ok(context.App.simSteps.length > 1);
  context.setBreakScopeFromUI(true);
  assert.equal(context.App.simSteps.length, 0,
    'where playback would pause is decided by a scan already at the end of its array');
});
