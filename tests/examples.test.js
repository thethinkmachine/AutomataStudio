import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { createHarness } from './harness.js';

// Every bundled example ships a meta.inputs list of sample strings with the
// verdict (and, for transducers/TMs, the expected output or final tape) the
// machine must produce. This suite loads each example into the VM harness and
// replays those samples through the real simulators, so a broken example can
// never ship silently.

const EXAMPLES_DIR = path.join(__dirname, '..', 'js', 'examples');

function loadExampleData(file) {
  return JSON.parse(fs.readFileSync(path.join(EXAMPLES_DIR, file + '.json'), 'utf8'));
}

function installExample(h, data) {
  const App = h.context.App;
  h.resetApp();
  App.machine = data.machine;
  App.sigma = new Set(data.sigma || []);
  App.stackAlpha = new Set(data.stackAlpha || [App.config?.sym?.stackBottom || 'Z']);
  App.outputAlpha = new Set(data.outputAlpha || []);
  if (data.tapeCount) App.tapeCount = data.tapeCount;
  App.states = data.states;
  App.transitions = data.transitions;
  App.startId = data.startId;
  App.accepts = new Set(data.accepts || []);
  if (data.config) App.config = { ...App.config, ...data.config };
  return App;
}

function toTokens(ctx, w) {
  if (w === 'ε' || w === '') return [];
  const tokens = ctx.tokenize(w);
  assert.notEqual(tokens, null, `input "${w}" must tokenize with the example's Σ`);
  return tokens;
}

function stripBlanks(cells, ctx) {
  const blank = ctx.App.config.sym.blank;
  const s = (cells || []).join('');
  const esc = blank.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return s.replace(new RegExp(`^(?:${esc})+|(?:${esc})+$`, 'g'), '');
}

// Runs one sample through the machine's simulator; returns { accepted, last }.
function runSample(h, data, w) {
  const ctx = h.context;
  const App = ctx.App;
  const m = data.machine;

  if (m === 'MTM') {
    const parts = w.split(',');
    assert.equal(parts.length, App.tapeCount, `MTM input "${w}" needs one segment per tape`);
    const tapeTokens = parts.map(p => toTokens(ctx, p.trim()));
    ctx.simMTM(tapeTokens[0], tapeTokens);
    const last = App.simSteps[App.simSteps.length - 1];
    return { accepted: last.final === 'accept', last };
  }

  // ω-automata take "u(v)", not a finite word, so they never reach toTokens.
  // Both types and all four acceptance conditions share simOmega — they differ
  // in which machines are legal and which cycles count, not in how a run is
  // explored.
  if (ctx.isOmegaAutomaton(m)) {
    const parsed = ctx.parseOmegaWord(w);
    assert.ok(parsed, `ω-automaton input "${w}" must be written u(v)`);
    const u = toTokens(ctx, parsed.prefix);
    const v = toTokens(ctx, parsed.period);
    const res = ctx.simOmega(u, v);
    return { accepted: res.accepted, last: App.simSteps[App.simSteps.length - 1] };
  }

  const tokens = toTokens(ctx, w);
  let result = null;
  if (m === 'DFA') ctx.simDFA(tokens);
  else if (m === 'NFA' || m === 'ε-NFA') ctx.simNFA(tokens);
  else if (m === 'PDA' || m === 'DPDA') result = ctx.simPDA(tokens);
  else if (m === 'NPDA' || m === 'QA' || m === 'Counter' || m === '2PDA') result = ctx.simNPDA(tokens);
  else if (m === '2DFA') result = ctx.sim2DFA(tokens);
  else if (m === '2NFA') result = ctx.sim2NFA(tokens);
  else if (m === 'Moore') ctx.simMoore(tokens);
  else if (m === 'Mealy') ctx.simMealy(tokens);
  else if (m === 'FST') result = ctx.simFST(tokens);
  else if (m === 'PFA') result = ctx.simPFA(tokens);
  else if (m === 'PDT') result = ctx.simPDT(tokens);
  else if (m === '2DFT') result = ctx.sim2DFT(tokens);
  else if (m === 'NDTM') result = ctx.simNDTM(tokens);
  else if (m === 'LBA') ctx.simLBA(tokens);
  else if (m === 'ITM') ctx.simITM(tokens);
  else if (m === 'TM') ctx.simTM(tokens);
  else assert.fail(`no simulator dispatch for machine ${m}`);

  const last = App.simSteps[App.simSteps.length - 1];
  const accepted = result && typeof result.accepted === 'boolean'
    ? result.accepted
    : last.final === 'accept';
  return { accepted, last };
}

const FLAGSHIPS = [
  'dfa', 'nfa', 'enfa', 'twdfa', 'twnfa',
  'pda', 'npda', 'queue', 'counter', 'twopda',
  'tm', 'ndtm', 'mtm', 'lba', 'ittm',
  'moore', 'mealy', 'fst',
  'pfa', 'dba', 'buchi', 'pdt', 'twodft'
];

// The flagships, plus one example per remaining ω-type. Each names its own
// machine, so replaying their samples is what proves the acceptance condition
// really is read off the type.
const SAMPLED = [...FLAGSHIPS, 'dcoba', 'dpa', 'dwa', 'ncoba', 'npa', 'nwa'];

for (const file of SAMPLED) {
  test(`example ${file}: sample inputs behave as documented`, () => {
    const data = loadExampleData(file);
    assert.ok(data.meta && Array.isArray(data.meta.inputs) && data.meta.inputs.length,
      'flagship examples must declare meta.inputs');
    const h = createHarness();

    for (const sample of data.meta.inputs) {
      installExample(h, data);
      const { accepted, last } = runSample(h, data, sample.w);

      if (sample.expect) {
        assert.equal(accepted, sample.expect === 'accept',
          `"${sample.w}" should ${sample.expect} (got ${accepted ? 'accept' : 'reject'})`);
      }
      if (sample.out !== undefined) {
        assert.equal(last.outSoFar, sample.out, `"${sample.w}" output`);
      }
      if (sample.tape !== undefined) {
        const cells = data.machine === 'MTM' ? last.tapes[last.tapes.length - 1] : last.tape;
        assert.equal(stripBlanks(cells, h.context), sample.tape, `"${sample.w}" final tape`);
      }
    }
  });
}

test('example ittm: busy beaver runs 107 steps and prints 13 ones', () => {
  const data = loadExampleData('ittm');
  const h = createHarness();
  const App = installExample(h, data);
  h.context.simITM([]);
  const last = App.simSteps[App.simSteps.length - 1];
  assert.equal(last.final, 'accept');
  assert.equal(last.tape.filter(c => c === '1').length, 13, 'Σ(4) = 13 ones');
  // 107 moves → 108 configurations recorded (initial + one per move)
  assert.equal(App.simSteps.length, 108, 's(4) = 107 steps');
});

test('every example JSON (flagship and classic) parses and references valid states', () => {
  for (const f of fs.readdirSync(EXAMPLES_DIR).filter(f => f.endsWith('.json'))) {
    const data = JSON.parse(fs.readFileSync(path.join(EXAMPLES_DIR, f), 'utf8'));
    const ids = new Set(data.states.map(s => s.id));
    assert.ok(ids.has(data.startId), `${f}: startId exists`);
    for (const a of data.accepts || []) assert.ok(ids.has(a), `${f}: accept ${a} exists`);
    for (const t of data.transitions) {
      assert.ok(ids.has(t.from) && ids.has(t.to), `${f}: transition ${t.id} endpoints exist`);
    }
    for (const n of data.notes || []) {
      assert.ok(n.text.length <= 2000, `${f}: note ${n.id} within 2000 chars`);
    }
  }
});
