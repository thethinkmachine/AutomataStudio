import './dom-stub.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHarness } from './harness.js';

// The embedded pushdown automaton, whose store is a stack of stacks.
//
// Two things are worth pinning rather than eyeballing. The first is that the
// machine decides the right language — checked word by word against the
// bundled example rather than on a handful of witnesses, since a machine that
// accepts everything passes any test built only from members. The second is
// that the two fields this machine adds, `below` and `above`, survive every
// journey a transition takes: each of those drops an unknown key *silently*,
// and the machine goes on running against rules missing the half that said
// what they do.

const h = createHarness();
const ctx = h.context;

/** Every word over `alphabet` up to `maxLen`, shortest first. */
function allWords(alphabet, maxLen) {
  const A = [...alphabet];
  const out = [];
  for (let L = 0; L <= maxLen; L++) {
    const idx = new Array(L).fill(0);
    for (;;) {
      out.push(idx.map(i => A[i]).join(''));
      let k = L - 1;
      while (k >= 0 && ++idx[k] === A.length) idx[k--] = 0;
      if (k < 0) break;
    }
  }
  return out;
}

function decide(word) {
  const parsed = ctx.parseMachineInput('EPDA', word);
  assert.ok(parsed.ok, `could not read ${JSON.stringify(word)}`);
  return ctx.decideMachine('EPDA', parsed.input).verdict;
}

// ══════════════════════════════════════════════════════════════════
//  THE LANGUAGE
// ══════════════════════════════════════════════════════════════════

test('the bundled example decides aⁿbⁿcⁿdⁿ exactly, on every word up to length 6', () => {
  h.resetApp();
  const data = JSON.parse(fs.readFileSync(new URL('../js/examples/epda.json', import.meta.url), 'utf8'));
  ctx.loadData(data);
  assert.equal(ctx.App.machine, 'EPDA');

  const member = w => {
    const m = /^(a*)(b*)(c*)(d*)$/.exec(w);
    if (!m) return false;
    const n = m[1].length;
    return n > 0 && m[2].length === n && m[3].length === n && m[4].length === n;
  };
  for (const w of allWords('abcd', 6)) {
    assert.equal(decide(w), member(w) ? 'acc' : 'rej', JSON.stringify(w));
  }
  // Past the exhaustive range, the two ways a four-count machine usually goes
  // wrong: a short final block, and a parked stack left unused.
  assert.equal(decide('aaabbbcccddd'), 'acc');
  assert.equal(decide('aaabbbcccdd'), 'rej');
  assert.equal(decide('aaabbbccddd'), 'rej');
});

test('an EPDA with no below/above is the pushdown machine it generalises', () => {
  const App = ctx.App;
  h.resetApp();
  App.machine = 'EPDA';
  App.sigma = new Set(['a', 'b']);
  App.stackAlpha = new Set(['Z', 'A']);
  App.states = [
    { id: 's1', x: 0, y: 0, name: 'push' },
    { id: 's2', x: 100, y: 0, name: 'pop' },
    { id: 's3', x: 200, y: 0, name: 'done' }
  ];
  App.startId = 's1';
  // The final ε-move popping Z is what makes this aⁿbⁿ rather than aⁿbᵐ:
  // under the explicit paradigm acceptance is a state and a consumed word, and
  // says nothing whatever about the store — so the machine has to check the
  // store itself, by arranging to be able to reach the accepting state only
  // once the bottom marker is back on top.
  App.accepts = new Set(['s3']);
  const e = App.config.sym.eps;
  App.transitions = [
    { id: 't1', from: 's1', to: 's1', symbol: 'a', pop: e, push: 'A', below: e, above: e },
    { id: 't2', from: 's1', to: 's2', symbol: 'b', pop: 'A', push: e, below: e, above: e },
    { id: 't3', from: 's2', to: 's2', symbol: 'b', pop: 'A', push: e, below: e, above: e },
    { id: 't4', from: 's2', to: 's3', symbol: e, pop: 'Z', push: 'Z', below: e, above: e }
  ];
  App.config.pdaParadigm = 'explicit';
  assert.equal(ctx.decideMachine('EPDA', 'aabb'.split('')).verdict, 'acc');
  assert.equal(ctx.decideMachine('EPDA', 'aab'.split('')).verdict, 'rej');
  assert.equal(ctx.decideMachine('EPDA', 'aabbb'.split('')).verdict, 'rej');
});

test('the store discards an emptied top stack, which is what lets a nested run finish', () => {
  const { normalizeStore, epdaTop } = ctx;
  assert.deepEqual(normalizeStore([['Z'], []]), [['Z']]);
  assert.deepEqual(normalizeStore([[]]), [[]], 'one stack always survives');
  assert.equal(epdaTop([['Z'], ['A', 'B']]), 'B');
});

test('a bracketed name is one store symbol however long it is', () => {
  assert.deepEqual(ctx.epdaSymbols('<a.1> <b.2>'), ['<a.1>', '<b.2>']);
  assert.deepEqual(ctx.epdaSymbols('<only>'), ['<only>'], 'one symbol has no whitespace to split on');
  assert.deepEqual(ctx.epdaSymbols('AZ'), ['A', 'Z'], 'and a PDA-style stack still reads per character');
});

// ══════════════════════════════════════════════════════════════════
//  THE FIELDS REACH THE MACHINE AND COME BACK
// ══════════════════════════════════════════════════════════════════

function epdaMachine(extra) {
  const App = ctx.App;
  h.resetApp();
  App.machine = 'EPDA';
  App.sigma = new Set(['a', 'b']);
  App.stackAlpha = new Set(['Z', 'A']);
  App.states = [{ id: 's1', x: 0, y: 0, name: 'q0' }];
  App.startId = 's1';
  App.accepts = new Set(['s1']);
  App.transitions = [{ id: 't1', from: 's1', to: 's1', symbol: 'a', pop: 'Z', push: 'Z', ...extra }];
  return App;
}

test('a saved workspace round-trips below and above', () => {
  epdaMachine({ below: 'A', above: 'AZ|B' });
  const blob = ctx.exportWorkspaceState();
  h.resetApp();
  ctx.importWorkspaceState(JSON.parse(JSON.stringify(blob)));
  assert.equal(ctx.App.transitions[0].below, 'A');
  assert.equal(ctx.App.transitions[0].above, 'AZ|B');
});

test('StateMate carries below and above in both directions', () => {
  epdaMachine({ below: 'A', above: 'B' });
  const spec = ctx.machineToSpec();
  assert.equal(spec.transitions[0].below, 'A');
  assert.equal(spec.transitions[0].above, 'B');
  // `below` is a stack *list*, so it must not go through the single-symbol
  // normalizer — which would refuse `A|BC` and leave the rule doing nothing.
  const back = ctx.validateSpec({ ...spec, transitions: [{ ...spec.transitions[0], below: 'AZ|B' }] });
  assert.equal(back.transitions[0].below, 'AZ|B');
});

test('the export IR carries what the edge label draws', () => {
  epdaMachine({ below: 'A', above: 'B' });
  const ir = ctx.buildMachineIR();
  assert.equal(ir.transitions[0].below, 'A');
  assert.equal(ir.transitions[0].above, 'B');
});

test('a machine with a store that is not one array keeps its pop and push', () => {
  // The save path used to ask `isAnyPDA`, which is false for this family — so
  // the dialog offered pop and push, took them, and deleted them on save.
  const fields = ctx.transitionFieldsOf('EPDA');
  assert.ok(fields.includes('pop') && fields.includes('push'));
  assert.ok(ctx.isEmbeddedMachine('EPDA') && !ctx.isAnyPDA('EPDA'),
    'EPDA has a store and is deliberately not in the pushdown family');
});

test('the edge label says what the move does to the stacks around the top one', () => {
  epdaMachine({ below: 'A', above: 'B' });
  const label = ctx.transLabel(ctx.App.transitions[0]);
  assert.match(label, /▼A/);
  assert.match(label, /▲B/);
});
