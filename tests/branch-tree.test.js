import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHarness } from './harness.js';

// The computation tree: every branch a nondeterministic run took, kept beside
// the one path the trace follows. See js/machines/branch-tree.js.
//
// What these pin, in order of how quietly each would break:
//   • a branch's colour is inherited and never changes once given, so a
//     growing tree does not repaint what is already on screen;
//   • each step of the trace lands on the node it is showing, which is the
//     whole of what lets the canvas put tokens where the run is;
//   • an NFA's level of the tree *is* the set the trace prints;
//   • the tree belongs to its run, so a quiet run cannot swap it.

const h = createHarness();
const ctx = h.context;

function load(file) {
  h.resetApp();
  ctx.loadData(JSON.parse(fs.readFileSync(new URL(`../js/examples/${file}.json`, import.meta.url), 'utf8')));
}

function run(word) {
  const m = ctx.App.machine;
  const parsed = ctx.parseMachineInput(m, word);
  assert.ok(parsed.ok, parsed.error);
  // As the player runs it: asking for the tree.
  return ctx.withBranchTrees(() => {
    const r = ctx.streamMachine(m, parsed.input);
    r.drain();
    return r.steps;
  });
}

/** Sipser's N₁: strings containing 101 or 11, with an ε-move out of q₂. */
function sipserN1() {
  h.resetApp();
  const { App, setMachine } = ctx;
  setMachine('ε-NFA');
  ['q1', 'q2', 'q3', 'q4'].forEach((id, i) => App.states.push({ id, name: id, x: i * 120, y: 0 }));
  App.startId = 'q1';
  App.accepts.add('q4');
  App.sigma = new Set(['0', '1']);
  const eps = App.config.sym.eps;
  [['q1', 'q1', '0'], ['q1', 'q1', '1'], ['q1', 'q2', '1'], ['q2', 'q3', '0'], ['q2', 'q3', eps],
    ['q3', 'q4', '1'], ['q4', 'q4', '0'], ['q4', 'q4', '1']]
    .forEach(([from, to, symbol], i) => App.transitions.push({ id: `t${i}`, from, to, symbol }));
}

// ── colour ─────────────────────────────────────────────────────────

test('a branch takes a slice of its parent’s hue, and an only child keeps it whole', () => {
  const { BranchTree, HUE_LO, HUE_HI } = ctx;
  const t = new BranchTree();
  const root = t.root('a');
  const [only] = t.expand(root, [{ state: 'a', fresh: true }]);
  assert.equal(t.hue(only), t.hue(root), 'a run that has not forked is one colour');
  assert.equal(t.node(only).lo, HUE_LO);
  assert.equal(t.node(only).hi, HUE_HI);

  const kids = t.expand(only, [{ state: 'b', fresh: true }, { state: 'c', fresh: true }, { state: 'd', fresh: true }]);
  const slices = kids.map(id => t.node(id));
  for (const s of slices) {
    assert.ok(s.lo >= t.node(only).lo && s.hi <= t.node(only).hi, 'inside the parent’s slice');
  }
  for (let i = 1; i < slices.length; i++) {
    assert.ok(slices[i - 1].hi < slices[i].lo, 'siblings are disjoint, with a gap between');
  }
  // Given once: expanding a node again is refused rather than re-split.
  const before = kids.map(id => t.hue(id));
  assert.deepEqual(t.expand(only, [{ state: 'x', fresh: true }]), [-1]);
  assert.deepEqual(kids.map(id => t.hue(id)), before);
});

test('a tree past its cap says so, and stops growing', () => {
  const { BranchTree, TREE_NODE_CAP } = ctx;
  const t = new BranchTree();
  let frontier = [t.root('s')];
  while (frontier.length && !t.truncated) {
    const next = [];
    for (const id of frontier) next.push(...t.expand(id, [{ state: 's', fresh: true }, { state: 's', fresh: true }]).filter(k => k >= 0));
    frontier = next;
  }
  assert.ok(t.truncated);
  assert.equal(t.nodes.length, TREE_NODE_CAP);
});

// ── NFA ────────────────────────────────────────────────────────────

test('a level of an NFA’s tree is exactly the set its trace prints', () => {
  sipserN1();
  const steps = run('010110');
  const tree = ctx.branchTreeOf(steps);
  assert.ok(tree, 'the run carries a tree');
  assert.equal(tree.mode, 'level');
  steps.forEach((step, i) => {
    const f = tree.frameAt(steps, i);
    assert.equal(f.depth, i);
    const live = tree.liveAt(f.depth).map(id => tree.node(id).state).sort();
    assert.deepEqual(live, [...step.states].sort(), `step ${i}`);
  });
  // The word is accepted, and the tree says where.
  const accepting = tree.nodes.filter(n => tree.fateOf(n.id) === 'acc');
  assert.ok(accepting.length > 0);
  assert.ok(accepting.every(n => n.depth === 6 && n.state === 'q4'));
});

test('an ε-move stays at its position, and a branch that dies says so', () => {
  sipserN1();
  const steps = run('1');
  const tree = ctx.branchTreeOf(steps);
  // q1 reads 1 into q1 and q2; q2 closes under ε to q3 at the same position.
  const lvl1 = tree.liveAt(1).map(id => tree.node(id));
  const q3 = lvl1.find(n => n.state === 'q3');
  assert.ok(q3, 'q3 is alive after one symbol');
  assert.equal(tree.node(q3.parent).state, 'q2');
  assert.equal(tree.node(q3.parent).depth, 1, 'the ε-child is at its parent’s position');
  // On 1 then 0, q3 has no move on 0: that branch is dead.
  const steps2 = run('10');
  const t2 = ctx.branchTreeOf(steps2);
  const deadQ3 = t2.byDepth[1].map(id => t2.node(id)).find(n => n.state === 'q3');
  assert.equal(t2.fateOf(deadQ3.id), 'dead');
});

test('an NFA’s branches merge as its set does, so the tree stays |Q| wide', () => {
  h.resetApp();
  const { App, setMachine } = ctx;
  setMachine('NFA');
  App.states.push({ id: 'a', name: 'a', x: 0, y: 0 }, { id: 'b', name: 'b', x: 100, y: 0 });
  App.startId = 'a';
  App.sigma = new Set(['x']);
  // Unmerged, the branch count is Fibonacci in the word's length.
  App.transitions.push({ id: 't0', from: 'a', to: 'a', symbol: 'x' });
  App.transitions.push({ id: 't1', from: 'a', to: 'b', symbol: 'x' });
  App.transitions.push({ id: 't2', from: 'b', to: 'a', symbol: 'x' });
  const steps = run('x'.repeat(40));
  const tree = ctx.branchTreeOf(steps);
  assert.equal(tree.truncated, false);
  for (let d = 0; d <= 40; d++) assert.ok(tree.liveAt(d).length <= 2, `depth ${d}`);
  const merged = tree.nodes.filter(n => n.fate === 'merged');
  assert.ok(merged.length > 0);
  assert.ok(merged.every(n => n.into >= 0 && tree.node(n.into).state === n.state && tree.node(n.into).depth === n.depth),
    'a merge names the branch it joined');
});

// ── the searches ───────────────────────────────────────────────────

test('an NPDA’s trace walks one branch of its tree, step for step', () => {
  load('npda');
  for (const word of ['abba', 'abab']) {
    const steps = run(word);
    const tree = ctx.branchTreeOf(steps);
    assert.ok(tree && tree.mode === 'path' && tree.done);
    assert.ok(tree.path && tree.path.length > 0);
    // The summary step a reject ends with is no configuration; every other is.
    const configs = steps.filter(s => s.tid !== undefined || s === steps[0]).length;
    for (let i = 0; i < Math.min(configs, tree.path.length); i++) {
      const f = tree.frameAt(steps, i);
      assert.equal(tree.node(f.focus).state, steps[i].state, `${word} step ${i}`);
      assert.equal(f.depth, i);
      if (i > 0) assert.equal(tree.node(f.focus).tid, steps[i].tid);
      assert.ok(tree.liveAt(f.depth).includes(f.focus), 'the branch on screen is one of the live ones');
    }
    const accepted = tree.nodes.some(n => n.fate === 'acc');
    assert.equal(accepted, word === 'abba');
  }
});

test('the other searches record a tree too, and the deterministic machines do not', () => {
  for (const [file, word] of [['twnfa', ''], ['fst-classic', ''], ['epda', 'abcd']]) {
    load(file);
    const sample = JSON.parse(fs.readFileSync(new URL(`../js/examples/${file}.json`, import.meta.url), 'utf8')).meta?.inputs?.[0]?.w;
    const steps = run(sample ?? word);
    assert.ok(ctx.branchTreeOf(steps), `${file} carries a tree`);
  }
  load('dfa');
  assert.equal(ctx.branchTreeOf(run('01')), null);
});

test('an NDTM’s tree grows as its search is pulled, and every step names its node', () => {
  load('ndtm-classic');
  const m = ctx.App.machine;
  const parsed = ctx.parseMachineInput(m, '');
  // The first pull is where a streaming search decides to record.
  const r = ctx.streamMachine(m, parsed.input);
  ctx.withBranchTrees(() => r.at(0));
  const tree = ctx.branchTreeOf(r.steps);
  assert.equal(tree.mode, 'search');
  assert.equal(tree.done, false, 'a streamed search is not finished after one step');
  const early = tree.nodes.length;
  r.drain();
  assert.equal(tree.done, true);
  assert.ok(tree.nodes.length >= early);
  r.steps.forEach((s, i) => {
    if (s.tn == null || s.tn < 0) return;
    assert.equal(tree.node(s.tn).state, s.state);
    assert.equal(tree.node(s.tn).step, i);
    assert.equal(tree.frameAt(r.steps, i).focus, s.tn);
  });
});

// ── ownership and cost ─────────────────────────────────────────────

test('a run nobody asked a tree of records none, whatever the machine', () => {
  // StateMate's trace tool and the complexity profile run the same simulators
  // and read only the steps; recording for them would be pure cost.
  for (const [file, word] of [['npda', 'abba'], ['nfa-classic', '0110'], ['ndtm-classic', ''], ['twnfa', ''], ['epda', 'abcd']]) {
    load(file);
    const m = ctx.App.machine;
    const r = ctx.streamMachine(m, ctx.parseMachineInput(m, word).input);
    r.drain();
    assert.equal(ctx.branchTreeOf(r.steps), null, file);
  }
});

test('past its cap a tree takes no more children, so a long search costs what it did', () => {
  h.resetApp();
  const { App, setMachine } = ctx;
  setMachine('NDTM');
  App.states.push({ id: 's0', name: 'q0', x: 0, y: 0 });
  App.startId = 's0';
  App.sigma = new Set(['a']);
  App.tapeAlphabet = new Set(['a', 'b', App.config.sym.blank]);
  const any = App.config.sym.any;
  App.transitions.push({ id: 't0', from: 's0', to: 's0', symbol: any, write: 'a', dir: 'R' });
  App.transitions.push({ id: 't1', from: 's0', to: 's0', symbol: any, write: 'b', dir: 'R' });
  App.config.detectLoops = false;
  App.config.maxTmSteps = 5000;
  let expansions = 0;
  const proto = ctx.BranchTree.prototype;
  const real = proto.expandCfgs;
  proto.expandCfgs = function (...args) { expansions++; return real.apply(this, args); };
  try {
    const steps = run('a');
    const tree = ctx.branchTreeOf(steps);
    assert.ok(tree.full && tree.truncated);
    assert.ok(steps.length > 4000, 'the search itself ran on to its budget');
    assert.ok(expansions < ctx.TREE_NODE_CAP, `${expansions} expansions recorded for ${steps.length} steps`);
  } finally {
    proto.expandCfgs = real;
  }
});


test('the tree is the run’s, not a global a quiet run can replace', () => {
  load('npda');
  ctx.$('sim-in').value = 'abba';
  ctx.runSim();
  ctx.stopAutoPlay();
  const mine = ctx.branchTreeOf(ctx.App.simSteps);
  assert.ok(mine);
  // The complexity profile measures runs of its own.
  ctx.traceMachine('NPDA', ctx.parseMachineInput('NPDA', 'abab').input);
  assert.equal(ctx.branchTreeOf(ctx.App.simSteps), mine);
  // And it rides along invisibly: nothing that copies a step picks it up.
  assert.equal(Object.keys(ctx.App.simSteps[0]).includes('branchTree'), false);
  assert.equal(JSON.stringify(ctx.App.simSteps[0]).includes('byDepth'), false);
});

// ── the card ───────────────────────────────────────────────────────

function openCard() {
  const sec = h.getElement('rp-branches');
  ctx.setRPSectionCollapsed('rp-branches', false, false);
  return sec;
}

function play(word) {
  ctx.$('sim-in').value = word;
  ctx.runSim();
  ctx.stopAutoPlay();
}

test('the Computation Tree card is there on the machines that branch, and only those', () => {
  load('nfa-classic');
  ctx.syncBranchTreeSection();
  assert.equal(h.getElement('rp-branches').style.display, '');
  load('dfa');
  ctx.syncBranchTreeSection();
  assert.equal(h.getElement('rp-branches').style.display, 'none');
  for (const m of ['NFA', 'ε-NFA', 'NPDA', 'QA', 'Counter', '2PDA', 'PDT', 'EPDA', 'NDTM', 'FST', '2NFA']) {
    assert.equal(ctx.machineBranches(m), true, m);
  }
  for (const m of ['DFA', 'DPDA', 'TM', 'Moore', 'Mealy', '2DFA', 'PFA', 'NBA', 'DBA']) {
    assert.equal(ctx.machineBranches(m), false, m);
  }
});

test('the card draws the run’s tree and follows the playhead down it', () => {
  load('nfa-classic');
  ctx.syncBranchTreeSection();
  openCard();
  play('0110');
  ctx.stepToStart();
  const t = ctx._branchTreeTests;
  const tree = ctx.branchTreeOf(ctx.App.simSteps);
  assert.ok(t.built && t.built.tree === tree, 'built from the run on screen');
  assert.equal(t.built.nodeEls.filter(Boolean).length, tree.nodes.length);

  ctx.scrubSim(2);
  const future = id => t.built.nodeEls[id].g.classList.contains('is-future');
  const now = id => t.built.nodeEls[id].g.classList.contains('is-now');
  for (const node of tree.nodes) {
    assert.equal(future(node.id), node.depth > 2, `node ${node.id} at depth ${node.depth}`);
    assert.equal(now(node.id), node.depth === 2);
  }
  // Back up: the rows in between change sides again.
  ctx.scrubSim(1);
  for (const node of tree.nodes) assert.equal(future(node.id), node.depth > 1);
  assert.equal(h.getElement('rp-count-branches').textContent, String(tree.leafCount()));
});

test('a node names the step that shows it', () => {
  load('npda');
  play('abba');
  const tree = ctx.branchTreeOf(ctx.App.simSteps);
  // On the path: its own step. Off it: the step at its depth, where it is one
  // of the tokens on the canvas.
  tree.path.forEach((id, i) => assert.equal(ctx.stepForNode(tree, id), i));
  const off = tree.nodes.find(n => !tree.path.includes(n.id) && n.depth < tree.path.length);
  assert.ok(off);
  assert.equal(ctx.stepForNode(tree, off.id), off.depth);
});

// ── the canvas ─────────────────────────────────────────────────────

// Unused groups and dots are hidden rather than removed (see branch-tokens.js).
const shownDots = g => g.classList.contains('is-spare') ? []
  : [...g.children].filter(c => c.classList.contains('br-tok') && !c.classList.contains('is-spare'));

function tokensOnCanvas() {
  let n = 0;
  for (const g of ctx._branchTokenTests.groups.values()) n += shownDots(g).length;
  return n;
}

test('every live branch has a token on its state, in its own hue', () => {
  load('nfa-classic');
  ctx.renderAll();
  play('0110');
  for (let i = 0; i < ctx.App.simSteps.length; i++) {
    ctx.scrubSim(i);
    const tree = ctx.branchTreeOf(ctx.App.simSteps);
    const live = tree.liveAt(tree.frameAt(ctx.App.simSteps, i).depth);
    assert.equal(tokensOnCanvas(), live.length, `step ${i}`);
  }
  // In the animation layer, not in the states' own subtree (see branch-tokens.js)
  // — and still carried along when the state is dragged.
  const shown = [...ctx._branchTokenTests.groups].filter(([, g]) => !g.classList.contains('is-spare'));
  assert.ok(shown.length > 0);
  for (const [nodeId, g] of ctx._branchTokenTests.groups) {
    assert.equal(g.parentNode, ctx.$('sim-anim-g'));
    // Only a group in use is a state's handle; a spare one is let go.
    const handle = ctx.App.domCache.states.get(nodeId).__brToks;
    assert.ok(g.classList.contains('is-spare') ? handle !== g : handle === g, `state ${nodeId}`);
  }
  const [nodeId, g] = shown[0];
  const s = ctx.App.states.find(st => st.id === nodeId);
  s.x += 57;
  ctx.updateFastDOM();
  assert.ok(g.getAttribute('transform').startsWith(`translate(${s.x},`), g.getAttribute('transform'));
});

test('a deterministic run, or a reset, leaves no branch tokens behind', () => {
  load('nfa-classic');
  ctx.renderAll();
  play('01');
  assert.ok(tokensOnCanvas() > 0);
  ctx.resetSim();
  assert.equal(tokensOnCanvas(), 0);
  load('dfa');
  ctx.renderAll();
  play('01');
  assert.equal(tokensOnCanvas(), 0);
});

test('tokens on one rim are spaced a token apart, and a crowd closes the ring', () => {
  const { slotOffsets, R } = ctx;
  const two = slotOffsets(2, 4);
  const gap = Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y);
  assert.ok(gap >= 8, 'two tokens do not overlap');
  for (const p of two) assert.ok(Math.abs(Math.hypot(p.x, p.y) - R) < 1e-9, 'on the rim');
  const crowd = slotOffsets(40, 4);
  const angles = crowd.map(p => Math.atan2(p.y, p.x));
  const spread = Math.max(...angles) - Math.min(...angles);
  assert.ok(spread <= Math.PI * 2 && spread > Math.PI * 1.8, 'forty tokens go all the way round');
});

test('a flight rounds the rim, rides the edge, and rounds the next rim — with no jump between legs', () => {
  const { flightAt } = ctx;
  assert.deepEqual(flightAt(0), { leg: 0, u: 0 });
  assert.deepEqual(flightAt(1), { leg: 2, u: 1 });
  // Most of the time is on the edge itself.
  const onEdge = Array.from({ length: 101 }, (_, i) => flightAt(i / 100)).filter(l => l.leg === 1).length;
  assert.ok(onEdge >= 55, `${onEdge}% of the flight on the edge`);
  // Each leg ends where the next begins.
  let prev = flightAt(0);
  for (let i = 1; i <= 1000; i++) {
    const cur = flightAt(i / 1000);
    if (cur.leg !== prev.leg) {
      assert.ok(prev.u > 0.99 && cur.u < 0.01, `leg ${prev.leg} → ${cur.leg} at t=${i / 1000}`);
    }
    prev = cur;
  }
});

// ── what a paint costs ─────────────────────────────────────────────

test('on a machine that does not branch, the card does nothing at all', () => {
  load('dfa');
  ctx.syncBranchTreeSection();
  play('01');
  ctx.stepFwd();
  // Never even built: refreshBranchTree runs on every paint of every run.
  assert.equal(ctx._branchTreeTests.els, null);
});

/** An NDTM that forks on every step and never repeats a configuration. */
function forkingNDTM(budget) {
  h.resetApp();
  const { App, setMachine } = ctx;
  setMachine('NDTM');
  App.states.push({ id: 's0', name: 'q0', x: 0, y: 0 });
  App.startId = 's0';
  App.sigma = new Set(['a']);
  App.tapeAlphabet = new Set(['a', 'b', App.config.sym.blank]);
  const any = App.config.sym.any;
  App.transitions.push({ id: 'u0', from: 's0', to: 's0', symbol: any, write: 'a', dir: 'R' });
  App.transitions.push({ id: 'u1', from: 's0', to: 's0', symbol: any, write: 'b', dir: 'R' });
  App.config.detectLoops = false;
  App.config.maxTmSteps = budget;
  ctx.renderAll();
}

test('a step that only moves the playhead between branches moves an outline, not the tokens', () => {
  forkingNDTM(60);
  play('a');
  ctx.stepToEnd();
  const steps = ctx.App.simSteps;
  const tree = ctx.branchTreeOf(steps);
  // Two consecutive steps expanding configurations at the same depth.
  let i = 1;
  while (i + 1 < steps.length && !(steps[i].tn >= 0 && steps[i + 1].tn >= 0 &&
    tree.node(steps[i].tn).depth === tree.node(steps[i + 1].tn).depth)) i++;
  assert.ok(i + 1 < steps.length);
  ctx.scrubSim(i);
  const before = [...ctx._branchTokenTests.groups.values()];
  const dotsBefore = before.flatMap(shownDots);
  ctx.scrubSim(i + 1);
  const after = [...ctx._branchTokenTests.groups.values()];
  assert.deepEqual(after, before, 'the same groups');
  assert.deepEqual(after.flatMap(shownDots), dotsBefore, 'the same tokens');
  const focused = dotsBefore.filter(d => d.classList.contains('is-focus'));
  assert.equal(focused.length, 1, 'one branch under the playhead');
  assert.equal(focused[0], shownDots(ctx._branchTokenTests.groups.values().next().value)[
    tree.liveAt(tree.node(steps[i + 1].tn).depth).indexOf(steps[i + 1].tn)], 'and it is the new one');
});

test('a crowded state draws a ring of tokens and a count, not every one', () => {
  // Configurations that differ in their tapes never merge, so one state can
  // hold hundreds of branches at once.
  forkingNDTM(400);
  play('a');
  ctx.stepToEnd();
  const tree = ctx.branchTreeOf(ctx.App.simSteps);
  const live = tree.liveAt(tree.frameAt(ctx.App.simSteps, ctx.App.simIdx).depth).length;
  assert.ok(live > 24, `${live} branches on q0`);
  const g = ctx._branchTokenTests.groups.values().next().value;
  assert.equal(shownDots(g).length, 24);
  const more = [...g.children].find(c => c.classList.contains('br-more'));
  assert.equal(more.textContent, `+${live - 24}`);
});
