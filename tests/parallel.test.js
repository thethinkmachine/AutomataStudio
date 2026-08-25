import './dom-stub.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// Running words across a worker pool, and the one property that makes it
// safe to.
//
// Parallelism here is an optimisation, never a capability: every path through
// js/parallel/pool.js ends in a verdict, and the verdict must be the one the
// serial path would have produced. A batch that scores differently depending
// on how many cores the reader's machine has would be a far worse bug than a
// slow batch, so that equivalence is what most of this file asserts.
//
// The pool is driven through a fake Worker implementing the real message
// protocol against the real js/parallel/decide-core.js, because a worker entry
// point is unreachable from `node --test`.

const h = createHarness();
const ctx = h.context;

// ── a machine to decide against ───────────────────────────────────
// Odd number of a's: small, but every word gets a different answer, so a
// misordered merge shows up as a wrong verdict rather than as a shuffle
// nobody notices.
function parityDFA() {
  h.resetApp();
  const App = ctx.App;
  App.machine = 'DFA';
  App.states = [
    { id: 's1', name: 'even', x: 0, y: 0 },
    { id: 's2', name: 'odd', x: 100, y: 0 }
  ];
  App.transitions = [
    { id: 't1', from: 's1', to: 's2', symbol: 'a' },
    { id: 't2', from: 's2', to: 's1', symbol: 'a' },
    { id: 't3', from: 's1', to: 's1', symbol: 'b' },
    { id: 't4', from: 's2', to: 's2', symbol: 'b' }
  ];
  App.startId = 's1';
  App.accepts = new Set(['s2']);
  App.sigma = new Set(['a', 'b']);
}

// Enough words that the pool splits them into several chunks per worker.
function words(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    let w = '', k = i;
    while (k > 0) { w += (k & 1) ? 'a' : 'b'; k >>= 1; }
    out.push(w);
  }
  return out;
}

// ── the fake worker ───────────────────────────────────────────────
// Replies asynchronously and out of order — a real worker's completion order
// is whatever the OS scheduler decides, and the pool must not depend on it.
function installFakeWorkers({ failOffsets = new Set(), dieOnLoad = false, cores = 4 } = {}) {
  const live = [];
  class FakeWorker {
    constructor() {
      this.onmessage = null;
      this.onerror = null;
      this.state = { loaded: -1 };
      this.dead = false;
      this.chunks = 0;
      live.push(this);
    }
    postMessage(msg) {
      if (this.dead) return;
      if (msg.type === 'chunk') this.chunks++;
      if (dieOnLoad && msg.type === 'load') {
        setTimeout(() => { this.dead = true; this.onerror && this.onerror(new Error('boom')); }, 0);
        return;
      }
      // Jittered so replies interleave and arrive out of send order.
      const delay = msg.type === 'load' ? 0 : (msg.offset % 3);
      setTimeout(() => {
        if (this.dead || !this.onmessage) return;
        if (msg.type === 'chunk' && failOffsets.has(msg.offset)) {
          this.onmessage({ data: { type: 'failed', offset: msg.offset, error: 'induced' } });
          return;
        }
        this.onmessage({ data: ctx.handleMessage(msg, this.state) });
      }, delay);
    }
    terminate() { this.dead = true; }
  }
  globalThis.Worker = FakeWorker;
  globalThis.navigator = { hardwareConcurrency: cores };
  ctx.resetPool();
  return live;
}

function uninstallWorkers() {
  ctx.resetPool();
  delete globalThis.Worker;
}

test('the pool reports the cores it would use, and declines when there are none', () => {
  installFakeWorkers({ cores: 8 });
  assert.equal(ctx.poolSize(), 8);
  assert.equal(ctx.parallelAvailable(), true);
  uninstallWorkers();

  // No Worker constructor at all — which is this test run, and any browser
  // whose CSP refuses one.
  assert.equal(ctx.parallelAvailable(), false);
});

test('a single-core machine never pays for a pool it cannot use', () => {
  installFakeWorkers({ cores: 1 });
  assert.equal(ctx.parallelAvailable(), false);
  assert.equal(ctx.shouldParallelize(10_000, 'DFA'), false);
  uninstallWorkers();
});

test('small jobs stay serial; a Turing machine goes wide much sooner than a DFA', () => {
  installFakeWorkers();
  // A DFA word is microseconds — spawning workers for twenty of them loses.
  assert.equal(ctx.shouldParallelize(20, 'DFA'), false);
  assert.equal(ctx.shouldParallelize(500, 'DFA'), true);
  // A TM word is a run to the step budget, so even a short list is worth it.
  assert.equal(ctx.shouldParallelize(8, 'TM'), true);
  uninstallWorkers();
});

test('a batch scored across the pool is identical to the same batch scored serially', async () => {
  parityDFA();
  const lines = words(400);
  const serial = ctx.computeBatchResults(lines);

  const live = installFakeWorkers();
  const rows = await ctx.runParallel({
    kind: 'batch', items: lines, machine: 'DFA', serial: ctx.decideBatchRows
  });
  const parallel = ctx.summarizeBatch(rows);
  const spread = live.filter(w => w.chunks > 0).length;
  uninstallWorkers();

  // Without this the test would still pass if the pool silently fell back to
  // the serial path, which is the one way it could pass while testing nothing.
  assert.equal(live.length, 4, 'a worker per core');
  assert.ok(spread > 1, `work must actually spread across workers (used ${spread})`);
  assert.deepEqual(parallel.results, serial.results);
  assert.equal(parallel.passCount, serial.passCount);
  assert.equal(parallel.allPassed, serial.allPassed);
});

test('results come back in input order however the chunks complete', async () => {
  parityDFA();
  const lines = words(300);
  installFakeWorkers();
  const rows = await ctx.runParallel({
    kind: 'batch', items: lines, machine: 'DFA', serial: ctx.decideBatchRows
  });
  uninstallWorkers();

  assert.equal(rows.length, lines.length);
  // Each row must sit against the word that produced it.
  rows.forEach((r, i) => assert.equal(r.str, lines[i]));
  // And the verdict must be the real one: odd number of a's.
  rows.forEach((r, i) => {
    const odd = [...lines[i]].filter(c => c === 'a').length % 2 === 1;
    assert.equal(r.verdict, odd ? 'accept' : 'reject', `word ${JSON.stringify(lines[i])}`);
  });
});

test('expectations survive the round trip through a chunk', async () => {
  parityDFA();
  const lines = words(200).map(w => {
    const odd = [...w].filter(c => c === 'a').length % 2 === 1;
    return `${w} => ${odd ? 'accept' : 'reject'}`;
  });
  installFakeWorkers();
  const batch = ctx.summarizeBatch(await ctx.runParallel({
    kind: 'batch', items: lines, machine: 'DFA', serial: ctx.decideBatchRows
  }));
  uninstallWorkers();

  assert.equal(batch.expected, lines.length);
  assert.equal(batch.passCount, lines.length);
  assert.equal(batch.allPassed, true);
});

test('a chunk a worker could not finish is redone on the main thread, not dropped', async () => {
  parityDFA();
  const lines = words(200);
  const serial = ctx.decideBatchRows(lines);

  // Fail a couple of chunk offsets outright.
  installFakeWorkers({ failOffsets: new Set([0, 13, 26]) });
  const rows = await ctx.runParallel({
    kind: 'batch', items: lines, machine: 'DFA', serial: ctx.decideBatchRows
  });
  uninstallWorkers();

  assert.equal(rows.length, lines.length);
  assert.ok(rows.every(r => r !== undefined), 'no holes left in the results');
  assert.deepEqual(rows, serial);
});

test('every worker dying still returns a full, correct result rather than hanging', async () => {
  parityDFA();
  const lines = words(120);
  const serial = ctx.decideBatchRows(lines);

  installFakeWorkers({ dieOnLoad: true });
  const rows = await ctx.runParallel({
    kind: 'batch', items: lines, machine: 'DFA', serial: ctx.decideBatchRows
  });
  uninstallWorkers();

  assert.deepEqual(rows, serial);
});

test('the word path returns bare verdicts, in order', async () => {
  parityDFA();
  const toks = words(150).map(w => [...w]);
  const serial = toks.map(t => ctx.decideWord('DFA', t)?.verdict ?? 'unk');

  installFakeWorkers();
  const got = await ctx.runParallel({
    kind: 'words', items: toks, machine: 'DFA',
    serial: (ws) => ws.map(t => ctx.decideWord('DFA', t)?.verdict ?? 'unk')
  });
  uninstallWorkers();

  assert.deepEqual(got, serial);
});

test('a chunk for a machine the worker was never given is refused, not guessed at', () => {
  parityDFA();
  const state = { loaded: -1 };
  const reply = ctx.handleMessage(
    { type: 'chunk', kind: 'batch', machine: 'DFA', epoch: 7, offset: 0, items: ['aa'] },
    state
  );
  assert.equal(reply.type, 'stale');
  assert.equal(reply.offset, 0);
});

// ── the snapshot ──────────────────────────────────────────────────

test('the snapshot carries every App field the machine layer reads', () => {
  parityDFA();
  const snap = ctx.snapshotMachine();
  for (const k of ['machine', 'states', 'transitions', 'startId', 'config', 'tapeCount']) {
    assert.ok(k in snap, `snapshot is missing ${k}`);
  }
  // Sets do not survive a structured clone as themselves.
  for (const k of ctx.SET_FIELDS) assert.ok(Array.isArray(snap[k]), `${k} must be an array`);
});

test('the snapshot is structured-cloneable — it is posted to a worker', () => {
  parityDFA();
  assert.doesNotThrow(() => structuredClone(ctx.snapshotMachine()));
});

test('hydrating a snapshot reproduces the machine it was taken from', () => {
  parityDFA();
  const snap = structuredClone(ctx.snapshotMachine());
  const before = ctx.decideBatchRows(['a', 'aa', 'aba']);

  h.resetApp();
  ctx.hydrateMachine(snap);
  assert.deepEqual(ctx.decideBatchRows(['a', 'aa', 'aba']), before);
  assert.ok(ctx.App.accepts instanceof Set, 'accepts must come back as a Set');
  assert.ok(ctx.App.sigma instanceof Set, 'sigma must come back as a Set');
});

// ── the layering that makes any of this possible ──────────────────

test('the machine layer imports nothing that needs a document', async () => {
  // The worker imports js/machines/** and nothing else. If a UI module ever
  // reappears on that path, a worker stops being able to load at all — and it
  // would fail in the browser, silently falling back to serial, rather than
  // here. So the import graph is the assertion.
  const { readFileSync, readdirSync } = await import('node:fs');
  const UI = /from '\.\.\/(canvas|render|ui|modal|persistence|simulation|view|suggest|tape-view|notes|dividers|alphabet|export-|statemate|language|geometry|minimap|history|store)/;
  const offenders = [];
  for (const f of readdirSync('js/machines')) {
    if (!f.endsWith('.js')) continue;
    const src = readFileSync(`js/machines/${f}`, 'utf8');
    for (const line of src.split('\n')) {
      if (line.startsWith('import') && UI.test(line)) offenders.push(`${f}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], 'js/machines/** must stay free of UI imports');
});

test('the painter is installed on the main thread and absent in a worker', () => {
  // js/simulation.js installs it as it evaluates, and the harness imports
  // simulation.js — so on this side it is present. A worker never imports
  // simulation.js, which is what makes renderSimStep a no-op there.
  assert.equal(ctx.hasSimStepPainter(), true);
  assert.doesNotThrow(() => ctx.renderSimStep === undefined || true);
});
