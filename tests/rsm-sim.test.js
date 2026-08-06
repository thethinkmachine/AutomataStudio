import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Simulating a recursive state machine.
//
// The acceptance criterion is the whole point, and it has three clauses that
// must hold at once: the input is consumed, the call stack is EMPTY, and the
// machine sits on an accepting node of the ROOT component. Drop the middle one
// and this is a finite automaton wearing a costume -- it would accept "((("
// for a bracket matcher, because the machine really is sitting on an accepting
// node, three calls deep.
//
// So the tests below are mostly language tests: build a machine whose language
// is provably non-regular, and check membership word by word.

// Everything goes through componentView, which is the only safe way to build a
// component that might be the one on canvas: the active component's states live
// in App.states, and writing to its record instead is silently undone by the
// next flush.
function wrap(h, id) {
  const v = h.context.componentView(id);
  return {
    id,
    view: v,
    state(name, x = 0, y = 0) {
      const s = { id: h.context.newId(), x, y, name };
      v.states.push(s);
      if (!v.startId) v.startId = s.id;
      return s;
    },
    box(name, callee, x = 0, y = 0) {
      const s = this.state(name, x, y);
      s.callee = callee;
      return s;
    },
    edge(from, to, symbol) {
      v.transitions.push({ id: h.context.newTId(), from: from.id, to: to.id, symbol });
    },
    start(s) { v.startId = s.id; },
    accept(s) { v.addAccept(s.id); }
  };
}

function comp(h, name) {
  return wrap(h, h.context.createComponent(name).id);
}

function rsm(h) {
  h.context.applyMachineSwitch('RSM');
  h.context.ensureRootComponent();
  const root = wrap(h, h.context.App.rootComponentId);
  root.view.name = 'Main';
  return root;
}

const accepts = (h, word) => {
  const tokens = word === '' ? [] : word.split('');
  return h.context.exploreRSM(tokens).status === 'accept';
};

// S -> ( S ) S | ε  as a recursive component: the canonical CFL, and one no
// finite automaton can recognise.
function balancedParens(h) {
  const eps = h.context.App.config.sym.eps;
  const S = rsm(h);
  S.view.name = 'S';

  const q0 = S.state('q0'), q1 = S.state('q1'), q2 = S.state('q2'), q3 = S.state('q3');
  q1.callee = S.id;   // the inner S
  q3.callee = S.id;   // the trailing S
  S.start(q0);
  S.accept(q0);       // ε
  S.accept(q3);       // ... or after the trailing S returns

  S.edge(q0, q1, '(');   // read '(' then call S
  S.edge(q1, q2, ')');   // S returned; read ')'
  S.edge(q2, q3, eps);   // then call S again
  h.context.App.sigma = new Set(['(', ')']);
  return S;
}

test('the balanced-parens machine accepts exactly the balanced words', () => {
  const h = createHarness();
  balancedParens(h);

  for (const w of ['', '()', '()()', '(())', '(()())', '((()))'])
    assert.equal(accepts(h, w), true, `should accept "${w}"`);

  for (const w of ['(', ')', '(()', '())', ')(', '(('])
    assert.equal(accepts(h, w), false, `should reject "${w}"`);
});

// The clause everyone forgets, isolated.
test('an accepting node with calls still pending is not acceptance', () => {
  const h = createHarness();
  balancedParens(h);

  // "(((" walks into three nested calls and stops on S's accepting entry node
  // each time. Every one of those configurations is on an accepting state --
  // and none of them is an accepting configuration, because the stack is deep.
  assert.equal(accepts(h, '((('), false,
    'the call stack must be empty for a word to be accepted');
});

test('a machine that never returns rejects rather than accepting early', () => {
  const h = createHarness();
  const sub = comp(h, 'Never');
  const s0 = sub.state('s0');
  sub.start(s0);
  // No accepting state in the sub-machine, so a call into it cannot return.

  const root = rsm(h);
  const a = root.state('a');
  const b = root.box('call', sub.id);
  const c = root.state('c');
  root.start(a);
  root.edge(a, b, 'x');
  root.edge(b, c, 'y');
  root.accept(c);

  assert.equal(accepts(h, 'xy'), false, 'the call never comes back');
  const issues = h.context.validateHierarchy();
  assert.ok(issues.some(i => i.level === 'error' && /never return/.test(i.message)),
    'and the user is told why');
});

test('a call consumes input inside the sub-machine', () => {
  const h = createHarness();
  const sub = comp(h, 'AB');
  const p0 = sub.state('p0'), p1 = sub.state('p1'), p2 = sub.state('p2');
  sub.start(p0);
  sub.edge(p0, p1, 'a');
  sub.edge(p1, p2, 'b');
  sub.accept(p2);

  const root = rsm(h);
  const q0 = root.state('q0');
  const call = root.box('call', sub.id);
  const q2 = root.state('q2');
  root.start(q0);
  root.edge(q0, call, 'x');
  root.edge(call, q2, 'z');
  root.accept(q2);

  h.context.App.sigma = new Set(['a', 'b', 'x', 'z']);
  assert.equal(accepts(h, 'xabz'), true, 'x, then the sub-machine reads ab, then z');
  assert.equal(accepts(h, 'xaz'), false, 'the sub-machine did not finish');
  assert.equal(accepts(h, 'xz'), false, 'the sub-machine must consume something');
});

test('the same component invoked from two call sites behaves identically', () => {
  const h = createHarness();
  const sub = comp(h, 'One');
  const p0 = sub.state('p0'), p1 = sub.state('p1');
  sub.start(p0); sub.edge(p0, p1, 'a'); sub.accept(p1);

  const root = rsm(h);
  const q0 = root.state('q0');
  const c1 = root.box('c1', sub.id);
  const c2 = root.box('c2', sub.id);
  const q3 = root.state('q3');
  root.start(q0);
  root.edge(q0, c1, 'x');
  root.edge(c1, c2, 'y');
  root.edge(c2, q3, 'z');
  root.accept(q3);

  h.context.App.sigma = new Set(['a', 'x', 'y', 'z']);
  assert.equal(accepts(h, 'xayaz'), true, 'both call sites run the same machine');
  assert.equal(accepts(h, 'xayz'), false, 'the second call still has to consume its a');
});

test('runaway recursion is cut off and says so', () => {
  const h = createHarness();
  const { App } = h.context;
  App.config.maxCallDepth = 12;
  // A component whose only move is to call itself: no base case.
  const S = rsm(h);
  S.view.name = 'S';
  const q0 = S.state('q0');
  q0.callee = S.id;
  S.start(q0);

  const res = h.context.exploreRSM([]);
  assert.equal(res.status, 'depth', 'the depth cap should be what stops it');

  h.context.simRSM([]);
  const last = App.simSteps[App.simSteps.length - 1];
  assert.match(last.note, /base case/, 'and the message should point at the cause');
});

// ── Step artifacts the UI consumes ──

test('every step carries the frames the canvas follows', () => {
  const h = createHarness();
  const { App } = h.context;
  const sub = comp(h, 'Inner');
  const p0 = sub.state('p0'), p1 = sub.state('p1');
  sub.start(p0); sub.edge(p0, p1, 'a'); sub.accept(p1);

  const root = rsm(h);
  const q0 = root.state('q0');
  const call = root.box('call', sub.id);
  root.start(q0);
  root.edge(q0, call, 'x');
  root.accept(call);

  App.sigma = new Set(['a', 'x']);
  const out = h.context.simRSM(['x', 'a']);
  assert.equal(out.accepted, true);

  const frames = App.simSteps.map(s => s.frames.length);
  assert.ok(Math.max(...frames) > 1, 'the run goes at least one call deep');
  assert.equal(frames[0], 1, 'and starts at the root');
  assert.equal(frames[frames.length - 1], 1, 'and comes back out to accept');

  const called = App.simSteps.find(s => /^Call /.test(s.note));
  assert.ok(called, 'a call is narrated');
  assert.ok(App.simSteps.some(s => /^Return /.test(s.note)), 'and so is the return');
});

test('the call stack grows and shrinks with the recursion', () => {
  const h = createHarness();
  const { App } = h.context;
  balancedParens(h);
  h.context.simRSM(['(', '(', ')', ')']);

  const depths = App.simSteps.map(s => s.callStack.length);
  assert.equal(depths[0], 1, 'starts with just the root frame');
  assert.ok(Math.max(...depths) >= 3, `nested parens should nest calls, saw ${depths}`);
  assert.equal(depths[depths.length - 1], 1, 'and unwinds completely before accepting');
  assert.equal(App.simSteps[App.simSteps.length - 1].final, 'accept');
});

test('following a run into a sub-machine moves the canvas', () => {
  const h = createHarness();
  const { App } = h.context;
  const sub = comp(h, 'Inner');
  const p0 = sub.state('p0'), p1 = sub.state('p1');
  sub.start(p0); sub.edge(p0, p1, 'a'); sub.accept(p1);

  const root = rsm(h);
  const q0 = root.state('q0');
  const call = root.box('call', sub.id);
  root.start(q0);
  root.edge(q0, call, 'x');
  root.accept(call);
  App.sigma = new Set(['a', 'x']);

  h.context.simRSM(['x', 'a']);
  const inside = App.simSteps.find(s => s.component === sub.id);
  assert.ok(inside, 'the run does enter the sub-machine');

  assert.equal(h.context.followSimFrames(inside.frames), true);
  assert.equal(h.context.activeComponentId(), sub.id, 'the canvas descends to follow it');
  assert.equal(App.states[0].id, p0.id, 'and shows that component');
});

// ── Structure analysis ──

test('recursion is detected, directly and through a cycle', () => {
  const h = createHarness();
  balancedParens(h);
  const rec = h.context.recursiveComponents();
  assert.equal(rec.size, 1, 'S calls itself');

  const h2 = createHarness();
  const root2 = rsm(h2);
  const b = comp(h2, 'B');
  const bx = root2.box('toB', b.id);
  root2.start(bx);
  // B calls back into the root: a two-step cycle.
  const back = b.state('back');
  back.callee = root2.id;
  b.start(back);

  const rec2 = h2.context.recursiveComponents();
  assert.equal(rec2.size, 2, 'both components are on the cycle');
});

test('a non-recursive tree reports no recursion', () => {
  const h = createHarness();
  const sub = comp(h, 'Leaf');
  const p = sub.state('p'); sub.start(p); sub.accept(p);
  const root = rsm(h);
  const bx = root.box('call', sub.id);
  root.start(bx); root.accept(bx);


  assert.equal(h.context.recursiveComponents().size, 0);
});

test('a component nothing calls is flagged as unreachable', () => {
  const h = createHarness();
  const orphan = comp(h, 'Orphan');
  const p = orphan.state('p'); orphan.start(p); orphan.accept(p);
  const root = rsm(h);
  const q = root.state('q'); root.start(q); root.accept(q);


  const issues = h.context.validateHierarchy();
  assert.ok(issues.some(i => i.level === 'warn' && /never invoked/.test(i.message)));
  assert.equal(h.context.reachableComponents().has(orphan.id), false);
});

// ── RSM → PDA ──
//
// The construction is only worth anything if the PDA decides the same language,
// so that is what this checks: run the compiled machine on the same words with
// the app's own PDA simulator and demand the same verdicts. This is the trick
// codegen.test.js uses, and it catches far more than shape assertions would.

function runCompiledOn(h, compiled, word) {
  const { App } = h.context;
  App.machine = compiled.machine;
  App.states = compiled.states;
  App.transitions = compiled.transitions;
  App.startId = compiled.startId;
  App.accepts = new Set(compiled.accepts);
  App.stackAlpha = new Set(compiled.stackAlpha);
  App.components = []; App.rootComponentId = null; App.componentPath = [];
  const out = h.context.exploreNPDA(word === '' ? [] : word.split(''));
  return !!(out && out.accepted);
}

test('the compiled PDA accepts the same words as the RSM', () => {
  const words = ['', '()', '()()', '(())', '((()))', '(', ')', '(()', '())', ')(' ];

  const expected = words.map(w => {
    const h = createHarness();
    balancedParens(h);
    return accepts(h, w);
  });

  const compiled = (() => {
    const h = createHarness();
    balancedParens(h);
    return h.context.compileToPDA();
  })();
  assert.ok(compiled, 'the machine compiles');

  words.forEach((w, i) => {
    const h = createHarness();
    assert.equal(runCompiledOn(h, compiled, w), expected[i],
      `compiled PDA disagrees with the RSM on "${w}" (RSM says ${expected[i]})`);
  });
});

test('a box compiles to two states, so a return cannot re-call', () => {
  const h = createHarness();
  balancedParens(h);
  const compiled = h.context.compileToPDA();

  const returned = compiled.states.filter(s => s.name.endsWith('↵'));
  assert.equal(returned.length, 2, 'both boxes get a post-return state');
  // Every push is matched by a pop of the same symbol.
  const pushes = new Set(compiled.transitions.map(t => t.push).filter(p => p && p.startsWith('↵')));
  const pops = new Set(compiled.transitions.map(t => t.pop).filter(p => p && p.startsWith('↵')));
  assert.deepEqual([...pushes].sort(), [...pops].sort(),
    'every return address pushed must be popped somewhere');
});

test('the compiled PDA brackets the run with its own bottom marker', () => {
  const h = createHarness();
  const { App } = h.context;
  balancedParens(h);
  const compiled = h.context.compileToPDA();

  assert.equal(compiled.accepts.length, 1, 'one accepting state, reached only by popping the bottom');
  const accId = compiled.accepts[0];
  const into = compiled.transitions.filter(t => t.to === accId);
  assert.ok(into.length, 'something reaches it');

  const marker = into[0].pop;
  assert.ok(into.every(t => t.pop === marker),
    'a self-recursive root is reachable with calls pending, so acceptance must require the marker');
  assert.equal(compiled.transitions.filter(t => t.from === compiled.startId).every(t => t.push === marker), true,
    'and the run must push it first');
  assert.notEqual(marker, App.config.sym.stackBottom,
    'a marker of its own is what makes this work under both PDA paradigms — explicit mode already seeds Z');
});

test('every stack symbol the compiler emits is a single character', () => {
  const h = createHarness();
  balancedParens(h);
  const compiled = h.context.compileToPDA();
  const eps = h.context.App.config.sym.eps;

  for (const sym of compiled.stackAlpha) {
    assert.equal(sym.length, 1, `stack symbol ${JSON.stringify(sym)} must be one character`);
  }
  // applyPdaStoreTransition splits a push string into symbols, so a
  // multi-character address would push several and pop one.
  for (const t of compiled.transitions) {
    if (t.push && t.push !== eps) assert.equal(t.push.length, 1, `push ${t.push} is not one symbol`);
    if (t.pop && t.pop !== eps) assert.equal(t.pop.length, 1, `pop ${t.pop} is not one symbol`);
  }
});

test('exporting a hierarchical machine exports the PDA it denotes', () => {
  const h = createHarness();
  balancedParens(h);
  const ir = h.context.buildMachineIR();

  assert.equal(ir.compiledFrom, 'RSM', 'the IR records that it was compiled');
  assert.equal(ir.sourceMachine, 'RSM');
  assert.equal(ir.machine, 'NPDA', 'and presents a pushdown automaton downstream');
  assert.ok(ir.states.length > 4, 'the compiled machine is bigger than the drawing');
  assert.ok(ir.states.some(s => s.isStart), 'it has a start');
  assert.ok(ir.states.some(s => s.isAccept), 'and an accept');

  // The formats are pure functions of the IR, so this is enough to know they work.
  const dot = h.context.ExportFormats.dot.build(ir);
  assert.ok(dot.includes('digraph'), 'DOT export still produces a graph');
});

test('a flat machine is untouched by the compile step', () => {
  const h = createHarness();
  h.context.createState(0, 0, 'q0');
  const ir = h.context.buildMachineIR();
  assert.equal(ir.compiledFrom, null);
  assert.equal(ir.machine, 'DFA');
  assert.equal(ir.states.length, 1);
});

test('the shipped example loads and decides balanced brackets', async () => {
  const h = createHarness();
  const { App } = h.context;
  const { readFileSync } = await import('node:fs');
  const data = JSON.parse(readFileSync(new URL('../js/examples/rsm.json', import.meta.url), 'utf8'));

  h.context.loadData(data, true);

  assert.equal(App.machine, 'RSM');
  assert.equal(App.components.length, 1, 'one self-recursive component');
  assert.equal(h.context.recursiveComponents().size, 1, 'and it is recursive');
  assert.deepEqual(h.context.validateHierarchy().filter(i => i.level === 'error'), [],
    'a shipped example must not have modelling errors');

  for (const w of ['', '()', '(())', '(()())'])
    assert.equal(accepts(h, w), true, `example should accept "${w}"`);
  for (const w of ['(', ')(', '(()'])
    assert.equal(accepts(h, w), false, `example should reject "${w}"`);
});
