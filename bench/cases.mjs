// Every case the benchmark runs, by suite.
//
// A case is `{ name, per, setup }`. `setup(env)` builds its machine and input
// and returns `{ run, count }`: `run()` is what is timed, and what it returns
// is the case's *check* — a verdict, a step count — which is recorded beside
// the time so that a faster engine giving a different answer is caught rather
// than celebrated. `count` is how many `per`s one run covers, so a result
// reads as a cost per symbol, per step or per word.
//
// A memory case (`kind: 'memory'`) returns `{ make, count }` instead, and is
// reported as the bytes `make()`'s result keeps alive, per `per`.
//
// Names are the keys a baseline is compared by: rename one and it becomes a
// new case.

import {
  balancedBrackets, binary, busyBeaver5, gridMachine, loadExample, parsed,
  randomDFA, randomNFA, randomString, randomTokens, runawayTM, sweeperTM
} from './machines.mjs';
import { rng } from './measure.mjs';

// Searches and two-way heads stop at a configured budget; the benchmark asks
// how long the work takes, so it lifts the budget out of the way.
function unbudgeted(App) {
  App.config.maxPdaSteps = 1e8;
  App.config.maxTmSteps = 1e8;
}

const decideCase = (m, input, opts) => env => () => env.c.decideMachine(m, input, opts).verdict;

// ── deciding a word ─────────────────────────────────────────────────
// decideMachine, the DOM-free verdict the Test Words table, the Language
// panel and StateMate all use.

const finiteWords = [
  ...[[10, 2, 200000], [1000, 2, 200000], [100000, 2, 20000], [1000, 200, 20000]].map(([n, k, len]) => ({
    name: `DFA, ${n.toLocaleString('en')} states × ${k} symbols`,
    per: 'symbol',
    setup(env) {
      const syms = randomDFA(env, n, k);
      const w = randomTokens(syms, len);
      return { run: decideCase('DFA', w)(env), count: len };
    }
  })),
  ...[[64, 20000], [1024, 1000]].map(([n, len]) => ({
    name: `NFA, ${n.toLocaleString('en')} states`,
    per: 'symbol',
    setup(env) {
      randomNFA(env, n);
      const w = randomTokens(['a', 'b'], len, 3);
      return { run: decideCase('NFA', w)(env), count: len };
    }
  })),
  {
    name: 'DFA example (divisible by 5), 200k bits',
    per: 'symbol',
    setup(env) {
      loadExample(env, 'dfa');
      const w = parsed(env, binary(200000, 4));
      return { run: decideCase('DFA', w)(env), count: w.length };
    }
  },
  {
    name: 'ε-NFA example (float regex), 20k symbols',
    per: 'symbol',
    setup(env) {
      loadExample(env, 'enfa');
      // A number the pattern accepts, so the set of states never empties and
      // the run reads every symbol.
      const w = parsed(env, '-' + 'd'.repeat(10000) + '.' + 'd'.repeat(9998));
      return { run: decideCase('ε-NFA', w)(env), count: w.length };
    }
  },
  {
    name: 'Moore example (combination lock), 50k bits',
    per: 'symbol',
    setup(env) {
      loadExample(env, 'moore');
      const w = parsed(env, randomString(['0', '1'], 50000, 6));
      return { run: decideCase('Moore', w)(env), count: w.length };
    }
  },
  {
    name: 'Mealy example (serial adder), 50k pairs',
    per: 'symbol',
    setup(env) {
      loadExample(env, 'mealy');
      const w = parsed(env, randomTokens(['00', '01', '10', '11'], 50000, 7).join(' '));
      return { run: decideCase('Mealy', w)(env), count: w.length };
    }
  },
  {
    name: 'PFA example (noisy channel), 20k symbols',
    per: 'symbol',
    setup(env) {
      loadExample(env, 'pfa');
      const w = parsed(env, randomString(['a', 'b'], 20000, 8));
      return { run: decideCase('PFA', w)(env), count: w.length };
    }
  },
  ...[['dba', 'DBA'], ['buchi', 'NBA'], ['dpa', 'DPA']].map(([file, m]) => ({
    name: `${m} example, u(v) with |u| = |v| = 500`,
    per: 'word',
    setup(env) {
      loadExample(env, file);
      const input = parsed(env, `${randomString(['a', 'b'], 500, 10)}(${randomString(['a', 'b'], 499, 11)}b)`);
      return { run: decideCase(m, input)(env), count: 1 };
    }
  }))
];

const turing = [
  ...[[10, 200000], [1000, 50000], [100000, 5000]].map(([n, steps]) => ({
    name: `TM sweeper, ${n.toLocaleString('en')} states, ${steps.toLocaleString('en')} steps`,
    per: 'step',
    setup(env) {
      sweeperTM(env, n);
      const w = randomTokens(['a', 'b'], 1000, 12);
      return { run: decideCase('TM', w, { budget: steps })(env), count: steps };
    }
  })),
  {
    name: 'BB(5) champion, first 2M steps',
    per: 'step',
    setup(env) {
      busyBeaver5(env);
      return { run: decideCase('TM', [], { budget: 2e6 })(env), count: 2e6 };
    }
  },
  {
    // The example adds by counting the second number down, so its run grows
    // with that number's value, not its length: 10 bits is 18,414 steps, 300
    // would never finish.
    name: 'TM example (binary addition), 300-bit + 10-bit',
    per: 'word',
    setup(env) {
      loadExample(env, 'tm');
      const input = parsed(env, binary(300, 13) + '+' + binary(10, 14));
      return { run: decideCase('TM', input, { budget: 1e8 })(env), count: 1 };
    }
  },
  {
    name: 'LBA example (powers of two), a^1024',
    per: 'word',
    setup(env) {
      loadExample(env, 'lba');
      const input = parsed(env, 'a'.repeat(1024));
      return { run: decideCase('LBA', input, { budget: 1e8 })(env), count: 1 };
    }
  },
  {
    name: 'MTM example (3-tape adder), 2,000 bits',
    per: 'word',
    setup(env) {
      loadExample(env, 'mtm');
      const input = parsed(env, binary(2000, 15));
      return { run: decideCase('MTM', input, { budget: 1e8 })(env), count: 1 };
    }
  },
  {
    name: 'ITM example (BB(4)), blank tape',
    per: 'word',
    setup(env) {
      loadExample(env, 'ittm');
      return { run: decideCase('ITM', parsed(env, ''), { budget: 1e6 })(env), count: 1 };
    }
  },
  ...[31, 60].map(n => ({
    name: `NDTM example (composite?), n = ${n}`,
    per: 'word',
    setup(env) {
      loadExample(env, 'ndtm');
      return { run: decideCase('NDTM', parsed(env, '1'.repeat(n)), { budget: 1e8 })(env), count: 1 };
    }
  }))
];

const search = [
  {
    name: 'DPDA example (brackets), 20k symbols',
    per: 'symbol',
    setup(env) {
      unbudgeted(loadExample(env, 'pda'));
      const w = parsed(env, balancedBrackets(20000));
      return { run: decideCase(env.c.App.machine, w)(env), count: w.length };
    }
  },
  ...[200, 500].map(n => ({
    name: `NPDA example (ww^R), a^${n}b`,
    per: 'word',
    setup(env) {
      unbudgeted(loadExample(env, 'npda'));
      return { run: decideCase('NPDA', parsed(env, 'a'.repeat(n) + 'b'))(env), count: 1 };
    }
  })),
  {
    name: 'Counter example (bank account), 20k operations',
    per: 'symbol',
    setup(env) {
      unbudgeted(loadExample(env, 'counter'));
      // Never overdrawn, so the run reads every operation.
      const r = rng(16);
      let bal = 0, s = '';
      for (let i = 0; i < 20000; i++) { const dep = bal === 0 || r() < 0.55; bal += dep ? 1 : -1; s += dep ? '+' : '-'; }
      const w = parsed(env, s);
      return { run: decideCase('Counter', w)(env), count: w.length };
    }
  },
  ...[200, 800].map(n => ({
    name: `PDT example (reverse), ${n} symbols`,
    per: 'symbol',
    setup(env) {
      unbudgeted(loadExample(env, 'pdt'));
      const w = parsed(env, randomString(['a', 'b'], n, 17));
      return { run: decideCase('PDT', w)(env), count: n };
    }
  })),
  {
    name: 'FST example (Gray code), 5,000 bits',
    per: 'symbol',
    setup(env) {
      unbudgeted(loadExample(env, 'fst'));
      const w = parsed(env, randomString(['0', '1'], 5000, 18));
      return { run: decideCase('FST', w)(env), count: 5000 };
    }
  },
  ...[100, 1000].map(n => ({
    name: `2PDA example, a^${n}b^${n}c^${n}`,
    per: 'symbol',
    setup(env) {
      unbudgeted(loadExample(env, 'twopda'));
      return { run: decideCase('2PDA', parsed(env, 'a'.repeat(n) + 'b'.repeat(n) + 'c'.repeat(n)))(env), count: 3 * n };
    }
  })),
  ...[50, 300].map(n => ({
    name: `QA example (w#w), |w| = ${n}`,
    per: 'symbol',
    setup(env) {
      unbudgeted(loadExample(env, 'queue'));
      const u = randomString(['a', 'b'], n, 19);
      return { run: decideCase('QA', parsed(env, `${u}#${u}`))(env), count: 2 * n + 1 };
    }
  })),
  ...[20, 100].map(n => ({
    name: `EPDA example, a^${n}b^${n}c^${n}d^${n}`,
    per: 'symbol',
    setup(env) {
      unbudgeted(loadExample(env, 'epda'));
      return { run: decideCase('EPDA', parsed(env, ['a', 'b', 'c', 'd'].map(x => x.repeat(n)).join('')))(env), count: 4 * n };
    }
  })),
  ...[['twdfa', '2DFA', 2000], ['twnfa', '2NFA', 2000], ['twodft', '2DFT', 2000]].map(([file, m, n]) => ({
    name: `${m} example, ${n.toLocaleString('en')} symbols`,
    per: 'symbol',
    setup(env) {
      unbudgeted(loadExample(env, file));
      const w = parsed(env, randomString(['a', 'b'], n, 20));
      return { run: decideCase(m, w)(env), count: n };
    }
  }))
];

// ── reading the input ───────────────────────────────────────────────

const tokenize = [
  {
    name: '100k symbols typed without separators',
    per: 'char',
    setup(env) {
      loadExample(env, 'dfa');
      const s = randomString(['0', '1'], 100000, 21);
      return { run: () => env.c.tokenize(s).length, count: s.length };
    }
  },
  {
    name: '100k symbols separated by spaces',
    per: 'char',
    setup(env) {
      loadExample(env, 'dfa');
      const s = randomTokens(['0', '1'], 100000, 22).join(' ');
      return { run: () => env.c.tokenize(s).length, count: s.length };
    }
  },
  {
    name: '50k two-character symbols without separators',
    per: 'char',
    setup(env) {
      loadExample(env, 'mealy');
      const s = randomTokens(['00', '01', '10', '11'], 50000, 23).join('');
      return { run: () => env.c.tokenize(s).length, count: s.length };
    }
  }
];

// ── the player ──────────────────────────────────────────────────────
// traceMachine: the same stream the player pulls, run to the end with the
// painter off. What a reader waits for when they press ⏭, minus the paint.

const traceCase = (m, input) => env => () => env.c.traceMachine(m, input).steps.length;

const player = [
  {
    name: 'TM sweeper, 10 states, 100k steps',
    per: 'step',
    setup(env) {
      sweeperTM(env, 10);
      env.c.App.config.maxTmSteps = 100000;
      return { run: traceCase('TM', randomTokens(['a', 'b'], 1000, 12))(env), count: 100000 };
    }
  },
  {
    name: 'BB(5) champion, first 1M steps',
    per: 'step',
    setup(env) {
      busyBeaver5(env);
      env.c.App.config.maxTmSteps = 1e6;
      return { run: traceCase('TM', [])(env), count: 1e6 };
    }
  },
  {
    name: 'DFA, 1,000 states, 100k symbols',
    per: 'step',
    setup(env) {
      const syms = randomDFA(env, 1000, 2);
      return { run: traceCase('DFA', randomTokens(syms, 100000))(env), count: 100001 };
    }
  },
  {
    name: 'NFA, 64 states, 20k symbols',
    per: 'step',
    setup(env) {
      randomNFA(env, 64);
      return { run: traceCase('NFA', randomTokens(['a', 'b'], 20000, 3))(env), count: 20001 };
    }
  },
  {
    name: 'Moore example, 50k bits',
    per: 'step',
    setup(env) {
      loadExample(env, 'moore');
      const w = parsed(env, randomString(['0', '1'], 50000, 6));
      return { run: traceCase('Moore', w)(env), count: w.length + 1 };
    }
  },
  {
    name: 'NDTM example (composite?), n = 31',
    per: 'run',
    setup(env) {
      unbudgeted(loadExample(env, 'ndtm'));
      return { run: traceCase('NDTM', parsed(env, '1'.repeat(31)))(env), count: 1 };
    }
  },
  {
    name: 'NPDA example (ww^R), a^200b',
    per: 'run',
    setup(env) {
      unbudgeted(loadExample(env, 'npda'));
      return { run: traceCase('NPDA', parsed(env, 'a'.repeat(200) + 'b'))(env), count: 1 };
    }
  },
  {
    // The tape a step shows is rebuilt from the run's journal of writes, so
    // scrubbing costs in proportion to the distance travelled.
    name: 'scrub across half of a 1M-step run',
    per: 'jump',
    setup(env) {
      busyBeaver5(env);
      env.c.App.config.maxTmSteps = 1e6;
      const steps = env.c.traceMachine('TM', []).steps;
      const n = steps.length;
      let k = 0;
      return { run: () => steps[k++ % 2 ? n - 1 : n >> 1].tape.length, count: 1 };
    }
  }
];

// ── memory ──────────────────────────────────────────────────────────
// What a finished run keeps alive, per step: the price of a long run in the
// player, and the number the checkpointed player is meant to cut.

const memory = [
  {
    name: 'player: BB(5) champion, 1M steps',
    kind: 'memory',
    per: 'step',
    setup(env) {
      busyBeaver5(env);
      env.c.App.config.maxTmSteps = 1e6;
      return { make: () => env.c.traceMachine('TM', []), count: 1e6 };
    }
  },
  {
    name: 'player: DFA, 10 states, 1M symbols',
    kind: 'memory',
    per: 'step',
    setup(env) {
      const syms = randomDFA(env, 10, 2);
      const w = randomTokens(syms, 1e6);
      return { make: () => env.c.traceMachine('DFA', w), count: 1e6 + 1 };
    }
  },
  {
    name: 'player: NFA, 64 states, 100k symbols',
    kind: 'memory',
    per: 'step',
    setup(env) {
      randomNFA(env, 64);
      const w = randomTokens(['a', 'b'], 1e5, 3);
      return { make: () => env.c.traceMachine('NFA', w), count: 1e5 + 1 };
    }
  },
  {
    name: 'player: Moore example, 200k bits',
    kind: 'memory',
    per: 'step',
    setup(env) {
      loadExample(env, 'moore');
      const w = parsed(env, randomString(['0', '1'], 2e5, 6));
      return { make: () => env.c.traceMachine('Moore', w), count: w.length + 1 };
    }
  }
];

// ── the canvas ──────────────────────────────────────────────────────
// Against the test DOM, so this is the JavaScript half of a frame — the layout
// pass and the diff — and none of the browser's style, layout or paint.

const layout = [200, 1000].flatMap(n => [
  {
    name: `first render, ${n} states`,
    per: 'render',
    setup(env) {
      return { run: () => { gridMachine(env, n, 2 * n); env.c.renderAll(); return env.c.App.domCache.states.size; }, count: 1 };
    }
  },
  {
    name: `idle re-render, ${n} states`,
    per: 'render',
    setup(env) {
      gridMachine(env, n, 2 * n);
      env.c.renderAll();
      return { run: () => { env.c.renderAll(); return env.c.App.domCache.states.size; }, count: 1 };
    }
  },
  {
    name: `drag frame, ${n} states`,
    per: 'frame',
    setup(env) {
      gridMachine(env, n, 2 * n);
      env.c.renderAll();
      const s = env.c.App.states[Math.floor(n / 2)];
      let k = 0;
      return { run: () => { s.x += k++ % 2 ? -7 : 7; env.c.updateFastDOM(); return env.c.App.domCache.states.size; }, count: 1 };
    }
  },
  {
    name: `full layout pass, ${n} states`,
    per: 'pass',
    setup(env) {
      gridMachine(env, n, 2 * n);
      return { run: () => env.c.buildLayoutContext().groups.length, count: 1 };
    }
  }
]);

// ── the space-time diagram ──────────────────────────────────────────
// js/spacetime.js, the half with no page attached: indexing a finished run,
// painting a viewport of it, and the overview strip beside it. Two shapes of
// tape, because they fail differently — BB(5) stays a few thousand cells wide
// over a million rows, and the runaway machine's tape is as wide as the run
// is long, which is where a checkpoint every 256 rows went quadratic (498 MB
// at 80,000 steps).

// Built once per process and shared: the run is the input here, not the work.
const runs = new Map();
function finishedRun(env, which) {
  if (!runs.has(which)) {
    if (which === 'runaway') runawayTM(env); else busyBeaver5(env);
    env.c.App.config.maxTmSteps = which === 'runaway' ? 1e5 : 1e6;
    runs.set(which, env.c.traceMachine('TM', []).steps);
  }
  return runs.get(which);
}

const RUNS = [['runaway', 'runaway TM, 100k rows'], ['bb5', 'BB(5), 1M rows']];

function indexed(env, which) {
  const steps = finishedRun(env, which);
  const m = env.c.makeSpaceTime(steps, { alphabet: ['a', 'x', '1'] });
  m.extend(steps.length);
  return m;
}

// Only the methods paintSpaceTime calls, as plain functions: a Proxy would
// charge every call for its trap and time the stand-in instead of the painter.
function countingContext() {
  const ctx = { calls: 0 };
  const count = () => { ctx.calls++; };
  const noop = () => {};
  for (const k of ['fillRect', 'fillText', 'strokeRect', 'strokeText', 'fill', 'stroke']) ctx[k] = count;
  for (const k of ['beginPath', 'moveTo', 'lineTo', 'rect', 'clip', 'save', 'restore', 'setLineDash']) ctx[k] = noop;
  return ctx;
}

const spacetime = [
  ...RUNS.map(([which, label]) => ({
    name: `index, ${label}`,
    per: 'row',
    setup(env) {
      const steps = finishedRun(env, which);
      return { run: () => indexed(env, which).rows, count: steps.length };
    }
  })),
  ...RUNS.map(([which, label]) => ({
    // Twenty 600×400 viewports at 8px cells, at fixed places down the run —
    // the painter's cost per frame, which is dominated by reaching the first
    // row from a checkpoint.
    name: `viewport frame, ${label}`,
    per: 'frame',
    setup(env) {
      const m = indexed(env, which);
      const L = env.c.spaceTimeLayout(m, { cell: 8, stateName: id => String(id), complete: true });
      const r = rng(21);
      const views = Array.from({ length: 20 }, () => ({
        sx: Math.floor(r() * Math.max(1, L.width - 600)),
        sy: Math.floor(r() * Math.max(1, L.height - 400)),
        vw: 600, vh: 400, clip: true
      }));
      return {
        run: () => {
          const ctx = countingContext();
          for (const V of views) env.c.paintSpaceTime(ctx, m, L, env.c.PRINT_STYLE, { ...V, playhead: Math.floor(V.sy / 8) });
          return ctx.calls;
        },
        count: views.length
      };
    }
  })),
  ...RUNS.map(([which, label]) => ({
    // The strip beside a long diagram, sized as a 200×800 strip at 2× asks.
    name: `overview strip, ${label}`,
    per: 'run',
    setup(env) {
      const m = indexed(env, which);
      return {
        run: () => {
          const ov = env.c.makeOverview(m, { binsY: 1600, binsX: 400 });
          ov.extend();
          const g = env.c.overviewGrid(ov, 0);
          return `${ov.rows}:${g ? g.counts.length : 0}`;
        },
        count: 1
      };
    }
  })),
  ...RUNS.map(([which, label]) => ({
    // What the indexed diagram keeps alive beyond the run it was built from.
    name: `model memory, ${label}`,
    kind: 'memory',
    per: 'row',
    setup(env) {
      const steps = finishedRun(env, which);
      return { make: () => indexed(env, which), count: steps.length };
    }
  }))
];

export const suites = { decide: [...finiteWords, ...turing], search, tokenize, player, memory, layout, spacetime };
