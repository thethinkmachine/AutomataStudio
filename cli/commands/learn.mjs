// learn — a DFA from examples (RPNI) or from a teacher (L*).
import { App } from '../../js/state.js';
import { decideRaw } from '../../js/library/analyze.js';
import { parseBatchLine } from '../../js/machines/batch.js';
import { readMachine, readSpecText, emit, CliError } from '../io.mjs';
import { formatFor, serialize } from '../writers.mjs';
import { lettersOf, seeded } from '../fa.mjs';
import { compare } from './compare.mjs';
import { batchOracle, oneShotOracle } from './fuzz.mjs';
import { accepts, lstar, rpni } from '../learn.mjs';
import { c, print } from '../out.mjs';

function splitWord(text, eps) {
  const t = text.trim();
  if (t === '' || t === eps || /^(eps|epsilon|ε)$/i.test(t)) return [];
  return /\s/.test(t) ? t.split(/\s+/) : [...t];
}

function rpniTarget(m) {
  const t = { kind: 'machine', machine: 'DFA', sigma: m.sigma, stackAlpha: [], outputAlpha: [], tapeCount: 1, blocks: [], config: {}, states: [], transitions: [], accepts: [] };
  for (let q = 0; q < m.states; q++) t.states.push({ id: `q${q}`, name: `q${q}` });
  t.startId = `q${m.start}`;
  t.accepts = [...m.accept].map(q => `q${q}`);
  let n = 0;
  for (const [q, out] of m.delta) for (const [a, to] of out) t.transitions.push({ id: `t${++n}`, from: `q${q}`, to: `q${to}`, symbol: a });
  return t;
}

function hypTarget(h) {
  const t = { kind: 'machine', machine: 'DFA', sigma: h.sigma, stackAlpha: [], outputAlpha: [], tapeCount: 1, blocks: [], config: {}, states: [], transitions: [], accepts: [] };
  for (let q = 0; q < h.states; q++) t.states.push({ id: `q${q}`, name: `q${q}` });
  t.startId = `q${h.start}`;
  t.accepts = [...h.accept].map(q => `q${q}`);
  let n = 0;
  h.delta.forEach((row, q) => row.forEach((to, i) => t.transitions.push({ id: `t${++n}`, from: `q${q}`, to: `q${to}`, symbol: h.sigma[i] })));
  return t;
}

function* testWords(sigma, exhaustive, count, maxLen, rnd) {
  let level = [[]];
  for (let len = 0; len <= exhaustive; len++) {
    yield* level;
    const next = [];
    for (const w of level) for (const a of sigma) next.push([...w, a]);
    level = next;
  }
  for (let i = 0; i < count; i++) {
    const len = Math.floor(rnd() * (maxLen + 1));
    yield Array.from({ length: len }, () => sigma[Math.floor(rnd() * sigma.length)]);
  }
}

const learn = {
  usage: `automata learn --from samples.txt
       automata learn --oracle '<command>' --sigma 01
       automata learn --target machine.automaton

--from     RPNI: the smallest-looking DFA consistent with labelled words, one
           per line as "w => accept" / "w => reject" (the test command's
           syntax). Never contradicts the sample; exact with enough examples.
--oracle   L* against a program (the fuzz command's protocol, --mode and
           --batch included). Equivalence is tested on every word up to
           --exhaustive and --tests random words, so the result is exact only
           up to that testing — it says so.
--target   L* against a machine. For a finite automaton equivalence is exact.

  --sigma 01          the alphabet (required with --oracle)
  --exhaustive N      every word up to this length per equivalence test (default 6)
  --tests N           random words per equivalence test (default 1000)
  --max-len N         longest random test word (default 14)
  --seed S
  -o, --output FILE   write the DFA here (default: a document on stdout)
  -t, --to FORMAT`,
  options: {
    from: { type: 'string' }, oracle: { type: 'string' }, target: { type: 'string' }, sigma: { type: 'string' },
    mode: { type: 'string' }, batch: { type: 'boolean' }, timeout: { type: 'string' },
    exhaustive: { type: 'string' }, tests: { type: 'string' }, 'max-len': { type: 'string' }, seed: { type: 'string' },
    output: { type: 'string', short: 'o' }, to: { type: 'string', short: 't' }
  },
  async run({ opts }) {
    const eps = App.config.sym.eps;
    const write = t => emit(serialize(t, formatFor(opts.to, opts.output)), opts.output);

    if (opts.from) {
      const file = readSpecText(opts.from);
      if (!file) throw new CliError(`${opts.from}: no such file.`);
      const samples = [];
      for (const raw of file.text.split(/\r?\n/)) {
        if (!raw.trim() || raw.trim().startsWith('#')) continue;
        const { input, expect } = parseBatchLine(raw);
        if (!expect) throw new CliError(`"${raw.trim()}" has no label — write "w => accept" or "w => reject".`);
        samples.push({ word: splitWord(input, eps), accept: expect === 'accept' });
      }
      if (!samples.length) throw new CliError('The sample is empty.');
      let m;
      try { m = rpni(samples); } catch (e) { throw new CliError(e.message); }
      const t = rpniTarget(m);
      // It is consistent by construction; say so after checking it anyway.
      const wrong = samples.filter(s => (decideRaw(t, s.word.join(' ')).verdict === 'acc') !== s.accept);
      if (wrong.length) throw new CliError(`internal: the learned DFA disagrees with ${wrong.length} sample words.`);
      process.stderr.write(c.dim(`RPNI: ${samples.length} labelled words → ${m.states} states, consistent with every one\n`));
      write(t);
      return 0;
    }

    const rnd = opts.seed !== undefined ? seeded(opts.seed) : Math.random;
    const exhaustive = Number(opts.exhaustive ?? 6), tests = Number(opts.tests ?? 1000), maxLen = Number(opts['max-len'] ?? 14);

    if (opts.target) {
      const { target } = readMachine(opts.target);
      const sigma = opts.sigma ? splitWord(opts.sigma.replace(/,/g, ' '), eps) : lettersOf(target);
      const member = async ws => ws.map(w => decideRaw(target, w.join(' ')).verdict === 'acc');
      let exact = true;
      const equivalent = async h => {
        const r = compare(hypTarget(h), target, { maxLength: Math.max(exhaustive, 8) });
        if (r.method !== 'exact') exact = false;
        return r.equal === false ? r.tokens : null;
      };
      const { dfa, rounds, queries } = await lstar(sigma, member, equivalent);
      process.stderr.write(c.dim(`L*: ${dfa.states} states after ${rounds} equivalence ${rounds === 1 ? 'query' : 'queries'} and ${queries} membership queries${exact ? ' — equivalent to the target, exactly' : ' — checked on every word up to the bound, not exactly'}\n`));
      write(hypTarget(dfa));
      return 0;
    }

    if (opts.oracle) {
      if (!opts.sigma) throw new CliError('--oracle needs --sigma: the teacher is a program, and its alphabet cannot be read off it.');
      const sigma = opts.sigma.includes(',') ? opts.sigma.split(',').map(s => s.trim()).filter(Boolean) : [...opts.sigma];
      const mode = opts.mode || 'exit';
      if (mode === 'output') throw new CliError('L* learns acceptors; --mode output is for transducers.');
      const timeout = Number(opts.timeout ?? 5000);
      const ask = opts.batch ? batchOracle(opts.oracle, mode, timeout * 10) : null;
      const one = oneShotOracle(opts.oracle, mode, timeout);
      const member = async ws => (ask ? ask(ws) : ws.map(w => one(w))).map(r => r.verdict === 'acc');
      let tested = 0;
      const equivalent = async h => {
        const words = [...testWords(sigma, exhaustive, tests, maxLen, rnd)];
        tested += words.length;
        const truth = await member(words);
        const i = words.findIndex((w, k) => accepts(h, w) !== truth[k]);
        return i < 0 ? null : words[i];
      };
      const { dfa, rounds, queries } = await lstar(sigma, member, equivalent);
      process.stderr.write(c.dim(`L*: ${dfa.states} states after ${rounds} rounds, ${queries} membership queries and ${tested} test words — exact only as far as the testing reached\n`));
      write(hypTarget(dfa));
      return 0;
    }
    throw new CliError('Say what to learn from: --from samples, --oracle command, or --target machine.');
  }
};

export const commands = { learn };
