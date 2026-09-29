// fuzz — the machine against a program that says what the language is meant
// to be. The program is the specification; the machine is under test.
import { spawnSync } from 'node:child_process';

import { App, getMachineConfig } from '../../js/state.js';
import { decideRaw, outputText } from '../../js/library/analyze.js';
import { readMachine, CliError } from '../io.mjs';
import { lettersOf, seeded } from '../fa.mjs';
import { c, print, printJson } from '../out.mjs';

const YES = /^(1|true|yes|y|accept|acc|a|✓)$/i;
const NO = /^(0|false|no|n|reject|rej|r|✗)$/i;

function wordText(w) {
  return w.every(s => [...s].length === 1) ? w.join('') : w.join(' ');
}

/**
 * The oracle, one word at a time: `{}` in the command is the word (quoted),
 * and the word is also on stdin and in $AUTOMATA_WORD. `mode` is how it
 * answers: `exit` (0 accept, anything else reject), `stdout` (a yes/no word on
 * the first line) or `output` (the first line is a transducer's output).
 */
function oneShotOracle(cmd, mode, timeout) {
  return w => {
    const text = wordText(w);
    const line = cmd.includes('{}') ? cmd.split('{}').join(JSON.stringify(text)) : `${cmd} ${JSON.stringify(text)}`;
    const r = spawnSync(line, { shell: true, input: text + '\n', encoding: 'utf8', timeout, env: { ...process.env, AUTOMATA_WORD: text } });
    if (r.error) throw new CliError(`The oracle could not be run: ${r.error.message}`);
    return interpret(mode, r.status, r.stdout ?? '');
  };
}

function interpret(mode, status, stdout) {
  const first = String(stdout).split(/\r?\n/)[0].trim();
  if (mode === 'exit') return { verdict: status === 0 ? 'acc' : 'rej' };
  if (mode === 'output') return { output: first };
  if (YES.test(first)) return { verdict: 'acc' };
  if (NO.test(first)) return { verdict: 'rej' };
  throw new CliError(`The oracle answered "${first}", which is neither yes nor no.`);
}

/** Batch: one process, every word on its own line of stdin, one answer per line of stdout. */
function batchOracle(cmd, mode, timeout) {
  return list => {
    const input = list.map(wordText).join('\n') + '\n';
    const r = spawnSync(cmd, { shell: true, input, encoding: 'utf8', timeout, maxBuffer: 1 << 28 });
    if (r.error) throw new CliError(`The oracle could not be run: ${r.error.message}`);
    const lines = String(r.stdout).split(/\r?\n/);
    if (lines.length < list.length) throw new CliError(`The oracle answered ${lines.length} lines for ${list.length} words.`);
    return list.map((_, i) => interpret(mode === 'exit' ? 'stdout' : mode, 0, lines[i]));
  };
}

function* randomWords(sigma, maxLen, count, rnd) {
  // Every word up to length 3 first — the edge cases live there — then random.
  let level = [[]];
  let made = 0;
  for (let len = 0; len <= Math.min(3, maxLen) && made < count; len++) {
    for (const w of level) { if (made++ >= count) return; yield w; }
    const next = [];
    for (const w of level) for (const a of sigma) next.push([...w, a]);
    level = next;
  }
  while (made++ < count) {
    const len = Math.floor(rnd() * (maxLen + 1));
    yield Array.from({ length: len }, () => sigma[Math.floor(rnd() * sigma.length)]);
  }
}

/**
 * Delta debugging over one disagreement: remove chunks (halves, quarters, …,
 * single symbols) while the machine and the oracle still disagree, then try
 * replacing each symbol with the first one of Σ. Returns a word no single
 * removal or replacement can shrink further.
 */
export function shrink(word, disagrees, sigma) {
  let w = word;
  for (let chunk = Math.max(1, Math.floor(w.length / 2)); chunk >= 1; chunk = Math.floor(chunk / 2)) {
    let i = 0;
    while (i < w.length) {
      const cand = [...w.slice(0, i), ...w.slice(i + chunk)];
      if (disagrees(cand)) w = cand; else i += chunk;
    }
    if (chunk === 1) break;
  }
  for (let i = 0; i < w.length; i++) {
    for (const a of sigma) {
      if (a >= w[i]) break;
      const cand = [...w]; cand[i] = a;
      if (disagrees(cand)) { w = cand; break; }
    }
  }
  return w;
}

const fuzz = {
  usage: `automata fuzz <machine> --oracle '<command>'

Runs the machine and the oracle on the same words — every word up to length 3,
then random ones — and stops at the first disagreement, which it shrinks to a
minimal counterexample.

The oracle gets the word as {} in the command (or appended), on stdin, and in
$AUTOMATA_WORD, and answers by
  --mode exit       exit code 0 = accept (default)
  --mode stdout     yes/no, true/false, 1/0, accept/reject on its first line
  --mode output     its first line is the expected output (transducers)
  --batch           one process for all words: a word per stdin line, an answer per stdout line

  --count N         words to try (default 500)
  --max-len N       longest random word (default 12)
  --seed S          repeatable words
  --timeout MS      per oracle call (default 5000)
  --no-shrink
  --json

  automata fuzz even-ones.automaton --oracle 'python -c "import sys; print(sys.argv[1].count(\\"1\\") % 2 == 0)" {}' --mode stdout

Exit: 0 no disagreement, 1 a disagreement, 2 the machine had no verdict on some word.`,
  options: {
    oracle: { type: 'string' }, mode: { type: 'string' }, batch: { type: 'boolean' }, count: { type: 'string' },
    'max-len': { type: 'string' }, seed: { type: 'string' }, timeout: { type: 'string' }, 'no-shrink': { type: 'boolean' }
  },
  async run({ args, opts }) {
    const { target } = readMachine(args[0] ?? '-');
    if (!opts.oracle) throw new CliError('Give the oracle command with --oracle.');
    const mode = opts.mode || 'exit';
    if (!['exit', 'stdout', 'output'].includes(mode)) throw new CliError('--mode is exit, stdout or output.');
    const cfg = getMachineConfig(target.machine) || {};
    if (cfg.isOmega) throw new CliError('fuzz runs finite words; an ω-automaton reads u(v).');
    if (mode === 'output' && !cfg.isTransducer) throw new CliError('--mode output is for transducers; this machine has no output.');
    const sigma = lettersOf(target);
    if (!sigma.length) throw new CliError('The machine has an empty Σ, so there are no words to try.');
    const rnd = opts.seed !== undefined ? seeded(opts.seed) : Math.random;
    const timeout = Number(opts.timeout ?? 5000);
    const eps = App.config.sym.eps;

    const machineSays = w => {
      const r = decideRaw(target, w.join(' '));
      return { verdict: r.verdict, output: r.output != null ? outputText(r.output) : '' };
    };
    const differ = (m, o) => (mode === 'output' ? m.output !== o.output : m.verdict !== o.verdict);
    const list = [...randomWords(sigma, Number(opts['max-len'] ?? 12), Number(opts.count ?? 500), rnd)];

    let answers;
    // Shrinking asks one word at a time, and has to ask in the protocol the
    // oracle speaks: a batch program answers on stdout, not by exit code.
    const batch = opts.batch ? batchOracle(opts.oracle, mode, timeout * 10) : null;
    const one = batch ? w => batch([w])[0] : oneShotOracle(opts.oracle, mode, timeout);
    if (batch) answers = batch(list);
    let undecided = 0, bad = null;
    for (let i = 0; i < list.length; i++) {
      const m = machineSays(list[i]);
      if (m.verdict === 'unk' || m.verdict === 'err') { undecided++; continue; }
      const o = answers ? answers[i] : one(list[i]);
      if (differ(m, o)) { bad = { word: list[i], machine: m, oracle: o, tried: i + 1 }; break; }
    }
    if (bad && !opts['no-shrink']) {
      const disagrees = w => {
        const m = machineSays(w);
        if (m.verdict === 'unk' || m.verdict === 'err') return false;
        return differ(m, one(w));
      };
      const small = shrink(bad.word, disagrees, sigma);
      bad.shrunk = small;
      bad.machineShrunk = machineSays(small);
      bad.oracleShrunk = one(small);
    }
    const say = r => (mode === 'output' ? `→ ${r.output || eps}` : r.verdict === 'acc' ? 'accept' : 'reject');
    if (opts.json) {
      printJson(bad ? {
        agree: false, tried: bad.tried, word: wordText(bad.word) || eps, counterexample: bad.shrunk ? wordText(bad.shrunk) || eps : null,
        machine: say(bad.machineShrunk || bad.machine), oracle: say(bad.oracleShrunk || bad.oracle)
      } : { agree: true, tried: list.length, undecided });
    } else if (bad) {
      const w = bad.shrunk ?? bad.word;
      print(c.red(`disagreement after ${bad.tried} words`));
      print(`  ${c.bold(wordText(w) || eps)}: the machine says ${say(bad.machineShrunk || bad.machine)}, the oracle ${say(bad.oracleShrunk || bad.oracle)}`);
      if (bad.shrunk && bad.shrunk.length < bad.word.length) print(c.dim(`  (shrunk from ${wordText(bad.word)})`));
    } else {
      print(c.green(`agree on ${list.length - undecided} words`) + (undecided ? c.yellow(` — ${undecided} had no verdict within the budget`) : ''));
    }
    return bad ? 1 : undecided ? 2 : 0;
  }
};

export const commands = { fuzz };
