// The machines the benchmark runs. Two sources, for two different questions:
//
//   synthetic   built here at a chosen size, to ask how a cost scales with the
//               machine — 10 states against 100,000, 2 symbols against 200.
//   examples    the files in js/examples, to ask what a machine a reader
//               actually opens costs, on input it is meant for.
//
// Everything is seeded, so a run builds exactly the machines and words the
// last run did and a changed verdict means the engine changed, not the dice.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rng, pickWith } from './measure.mjs';

const EXAMPLES = fileURLToPath(new URL('../js/examples/', import.meta.url));

/** Load a bundled example onto a fresh App. */
export function loadExample({ h, c }, file) {
  h.resetApp();
  c.loadData(JSON.parse(readFileSync(EXAMPLES + file + '.json', 'utf8')), true);
  return c.App;
}

/** Parse typed input the way the run box does, and fail loudly if it cannot. */
export function parsed({ c }, raw) {
  const p = c.parseMachineInput(c.App.machine, raw);
  if (!p.ok) throw new Error(`${c.App.machine} cannot read ${JSON.stringify(raw.slice(0, 40))}: ${p.error}`);
  return p.input;
}

function fresh({ h, c }, type, nStates) {
  h.resetApp();
  c.setMachine(type);
  const App = c.App;
  for (let i = 0; i < nStates; i++) App.states.push({ id: 's' + i, name: 'q' + i, x: (i % 40) * 90, y: Math.floor(i / 40) * 90 });
  App.startId = 's0';
  return App;
}

/** A complete DFA: n states, k symbols, random targets. Returns Σ as a list. */
export function randomDFA(env, n, k, seed = 1) {
  const App = fresh(env, 'DFA', n);
  const syms = Array.from({ length: k }, (_, i) => (k <= 26 ? 'abcdefghijklmnopqrstuvwxyz'[i] : 's' + i));
  App.sigma = new Set(syms);
  App.accepts.add('s0');
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) App.transitions.push({ id: `t${i}_${a}`, from: 's' + i, to: 's' + Math.floor(r() * n), symbol: syms[a] });
  }
  return syms;
}

/** An NFA with three random targets per (state, symbol) over {a, b}. */
export function randomNFA(env, n, seed = 2) {
  const App = fresh(env, 'NFA', n);
  App.sigma = new Set(['a', 'b']);
  App.accepts.add('s0');
  const r = rng(seed);
  let id = 0;
  for (let s = 0; s < n; s++) {
    for (const a of ['a', 'b']) {
      for (let k = 0; k < 3; k++) App.transitions.push({ id: 't' + id++, from: 's' + s, to: 's' + Math.floor(r() * n), symbol: a });
    }
  }
}

/**
 * A Turing machine that never stops: each state flips a run of a's and b's
 * as it sweeps, and a blank turns it round into the next state. The tape
 * grows every sweep, so no configuration repeats and the run lasts exactly
 * as long as its budget.
 */
export function sweeperTM(env, n) {
  const App = fresh(env, 'TM', n);
  const B = App.config.sym.blank;
  App.sigma = new Set(['a', 'b']);
  App.tapeAlphabet = new Set(['a', 'b', B]);
  App.config.twoWayTape = true;
  for (let i = 0; i < n; i++) {
    const next = 's' + ((i + 1) % n), dir = i % 2 === 0 ? 'R' : 'L';
    App.transitions.push({ id: `t${i}_a`, from: 's' + i, to: 's' + i, symbol: 'a', write: 'b', dir });
    App.transitions.push({ id: `t${i}_b`, from: 's' + i, to: 's' + i, symbol: 'b', write: 'a', dir });
    App.transitions.push({ id: `t${i}_B`, from: 's' + i, to: next, symbol: B, write: 'a', dir: dir === 'R' ? 'L' : 'R' });
  }
}

/**
 * The five-state busy beaver champion (Marxen & Buntrock, 1989): on a blank
 * two-way tape it halts after 47,176,870 steps leaving 4,098 ones. The blank
 * is its 0, and halting is entering the accepting state H.
 *
 *   A0 1RB  A1 1LC   B0 1RC  B1 1RB   C0 1RD  C1 0LE
 *   D0 1LA  D1 1LD   E0 1RH  E1 0LA
 */
export function busyBeaver5(env) {
  const App = fresh(env, 'TM', 0);
  const B = App.config.sym.blank;
  for (const s of ['A', 'B', 'C', 'D', 'E', 'H']) App.states.push({ id: s, name: s, x: 0, y: 0 });
  App.startId = 'A';
  App.accepts.add('H');
  App.sigma = new Set(['1']);
  App.tapeAlphabet = new Set(['1', B]);
  App.config.twoWayTape = true;
  const rules = [
    ['A', B, '1', 'R', 'B'], ['A', '1', '1', 'L', 'C'],
    ['B', B, '1', 'R', 'C'], ['B', '1', '1', 'R', 'B'],
    ['C', B, '1', 'R', 'D'], ['C', '1', B, 'L', 'E'],
    ['D', B, '1', 'L', 'A'], ['D', '1', '1', 'L', 'D'],
    ['E', B, '1', 'R', 'H'], ['E', '1', B, 'L', 'A']
  ];
  rules.forEach(([from, symbol, write, dir, to], i) => App.transitions.push({ id: 't' + i, from, to, symbol, write, dir }));
}

/**
 * The large-machine layout used by tests/large-machines.test.js: n states on
 * a grid, m transitions wired by a fixed stride, so the drawing is the same
 * every run.
 */
export function gridMachine({ h, c }, n, m) {
  h.resetApp();
  const App = c.App;
  App.machine = 'TM';
  App.sigma = new Set(['a', 'b']);
  App.states = [];
  App.transitions = [];
  App.accepts = new Set();
  for (let i = 0; i < n; i++) App.states.push({ id: 's' + i, name: 'q' + i, x: 100 + (i % 40) * 90, y: 100 + Math.floor(i / 40) * 90 });
  App.startId = 's0';
  App.accepts.add('s' + (n - 1));
  App.stateN = n;
  for (let i = 0; i < m; i++) {
    App.transitions.push({
      id: 't' + i, from: 's' + (i % n), to: 's' + ((i * 7 + 3) % n),
      symbol: i % 2 ? 'a' : 'b', read: i % 2 ? 'a' : 'b', write: i % 2 ? 'b' : 'a', dir: i % 2 ? 'R' : 'L'
    });
  }
  App.transN = m;
}

// ── words ─────────────────────────────────────────────────────────

/** n symbols drawn from `syms`, as a token array. */
export function randomTokens(syms, n, seed = 9) {
  const pick = pickWith(rng(seed));
  return Array.from({ length: n }, () => pick(syms));
}

/** n symbols drawn from `syms`, typed as one string (single-character Σ). */
export const randomString = (syms, n, seed) => randomTokens(syms, n, seed).join('');

/** A balanced bracket string of about n characters. */
export function balancedBrackets(n, seed = 5) {
  const pick = pickWith(rng(seed));
  const pairs = [['(', ')'], ['[', ']'], ['{', '}']];
  const out = [], open = [];
  while (out.length + open.length < n) {
    if (open.length && pick([0, 1]) === 1) out.push(open.pop());
    else { const [a, b] = pick(pairs); out.push(a); open.push(b); }
  }
  while (open.length) out.push(open.pop());
  return out.join('');
}

/** n binary digits as a string, most significant first, never all zero. */
export const binary = (n, seed) => '1' + randomString(['0', '1'], n - 1, seed);
