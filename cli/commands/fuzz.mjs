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

export function wordText(w) {
  return w.every(s => [...s].length === 1) ? w.join('') : w.join(' ');
}

// The word goes to the shell as a reference to $AUTOMATA_WORD, never as text
// pasted into the command line: the shell expands the variable after it has
// parsed the line, so a $, a backquote, a backslash or an & in a word reaches
// the program as itself instead of being run. cmd.exe expands %VAR% before it
// parses, so there a word holding a double quote still cannot be passed as an
// argument — stdin and the variable itself carry it either way.
//
// Windows has two more wrinkles. It cannot hold an empty environment variable,
// and cmd.exe leaves an unset %VAR% as literal text, so the empty word is
// written as "" directly. And the C runtime reads \" as an escaped quote, so
// a word ending in backslashes has them doubled in the copy the command line
// refers to (%AUTOMATA_WORD_ARG%); %AUTOMATA_WORD% itself is left as it is.
const WIN = process.platform === 'win32';

/** The shell line an oracle command runs as for one word, and the variables it needs. */
export function oracleLine(cmd, text) {
  let ref = WIN ? '"%AUTOMATA_WORD_ARG%"' : '"$AUTOMATA_WORD"';
  const env = { AUTOMATA_WORD: text };
  if (WIN) {
    if (text === '') ref = '""';
    else if (text.includes('"')) {
      throw new CliError(`The word "${text}" holds a double quote, which cmd.exe cannot pass as an argument. Have the oracle read the word from standard input (use --batch) or from %AUTOMATA_WORD%.`);
    } else env.AUTOMATA_WORD_ARG = text.replace(/(\\+)$/, '$1$1');
  }
  return { line: cmd.includes('{}') ? cmd.split('{}').join(ref) : `${cmd} ${ref}`, env };
}

// A failed oracle call as the reader should see it: which word, and why.
function oracleFailure(r, text, timeout) {
  const on = text === undefined ? '' : text === '' ? ' on the empty word' : ` on the word "${text}"`;
  if (r.error?.code === 'ETIMEDOUT') {
    return new CliError(`The oracle took longer than ${timeout} ms${on} and was stopped. Raise --timeout, or check that it is not waiting for more input.`);
  }
  if (r.error) return new CliError(`The oracle could not be run: ${r.error.message}`);
  if (r.status === null) return new CliError(`The oracle was killed by ${r.signal}${on}.`);
  return null;
}

// The last lines the oracle wrote to stderr, for a message.
function tail(err) {
  const lines = String(err || '').trim().split(/\r?\n/).filter(Boolean).slice(-3);
  return lines.length ? '\n  ' + lines.join('\n  ') : '';
}

/**
 * The oracle, one word at a time: {} in the command is the word, and the word
 * is also on stdin and in $AUTOMATA_WORD. `mode` is how it answers: `exit`
 * (0 accept, anything else reject), `stdout` (a yes/no word on the first line)
 * or `output` (the first line is a transducer's output).
 */
export function oneShotOracle(cmd, mode, timeout) {
  return w => {
    const text = wordText(w);
    const { line, env } = oracleLine(cmd, text);
    const r = spawnSync(line, { shell: true, input: text + '\n', encoding: 'utf8', timeout, maxBuffer: 1 << 26, env: { ...process.env, ...env } });
    const failed = oracleFailure(r, text, timeout);
    if (failed) throw failed;
    // A shell that cannot find the program exits 127 (cmd.exe: 9009). That is
    // not a "reject", and reading it as one would fault the machine on every word.
    if (r.status === 127 || r.status === 9009 || (r.status === 1 && /is not recognized as an internal or external command/.test(r.stderr))) throw new CliError(`The oracle command was not found (exit ${r.status}).${tail(r.stderr)}`);
    return interpret(mode, r.status, r.stdout ?? '', text, r.stderr);
  };
}

function interpret(mode, status, stdout, text, stderr) {
  const first = String(stdout).split(/\r?\n/)[0].trim();
  if (mode === 'exit') return { verdict: status === 0 ? 'acc' : 'rej' };
  if (mode === 'output') return { output: first };
  if (YES.test(first)) return { verdict: 'acc' };
  if (NO.test(first)) return { verdict: 'rej' };
  const on = text === undefined ? '' : text === '' ? ' on the empty word' : ` on the word "${text}"`;
  const said = first ? `answered "${first}"` : `printed nothing${status ? ` and exited ${status}` : ''}`;
  throw new CliError(`The oracle ${said}${on}, which is neither yes nor no.${tail(stderr)}`);
}

/** Batch: one process, every word on its own line of stdin, one answer per line of stdout. */
export function batchOracle(cmd, mode, timeout) {
  return list => {
    const input = list.map(wordText).join('\n') + '\n';
    const r = spawnSync(cmd, { shell: true, input, encoding: 'utf8', timeout, maxBuffer: 1 << 28 });
    const failed = oracleFailure(r, undefined, timeout);
    if (failed) throw failed;
    const lines = String(r.stdout).split(/\r?\n/);
    if (lines[lines.length - 1] === '') lines.pop();
    if (lines.length < list.length) {
      throw new CliError(`The oracle answered ${lines.length} line${lines.length === 1 ? '' : 's'} for ${list.length} words${r.status ? ` and exited ${r.status}` : ''}.${tail(r.stderr)}`);
    }
    return list.map((w, i) => interpret(mode === 'exit' ? 'stdout' : mode, 0, lines[i], wordText(w)));
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

The oracle gets the word three ways: as {} in the command (or appended), on
stdin, and in $AUTOMATA_WORD. {} becomes a quoted reference to that variable
("$AUTOMATA_WORD", or "%AUTOMATA_WORD%" under cmd.exe), so a word's symbols
reach the program as themselves and are never run by the shell. Every {} is
replaced, so a script with braces of its own should read $AUTOMATA_WORD
instead. It answers by
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
