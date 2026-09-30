// run, test, trace — deciding words.
import { readFileSync, watch } from 'node:fs';

import { App, getMachineConfig } from '../../js/state.js';
import { decideRaw, outputText } from '../../js/library/analyze.js';
import { parseBatchLine } from '../../js/machines/batch.js';
import { withMachine } from '../../js/exercise/grade.js';
import { machineGuards, parseMachineInput, streamMachine } from '../../js/machines/index.js';
import { withPainterSuppressed } from '../../js/machines/paint.js';
import { CliError, readMachine, readSpecText, readStdin } from '../io.mjs';
import { c, print, printJson, shortWord, styled, table, tapeCells, verdictWord, warn } from '../out.mjs';

// ── verdicts → exit codes ─────────────────────────────────────────
// Worst wins: an error over an unknown over a reject over an accept.
const RANK = { acc: 0, rej: 1, unk: 2, err: 3 };
export function worst(codes) {
  return codes.reduce((m, v) => Math.max(m, v), 0);
}

/** Whether a verdict means anything for this machine (a transducer's may not). */
export function verdictMatters(target) {
  const cfg = getMachineConfig(target.machine) || {};
  return !cfg.isTransducer || !!target.config?.transducerAccepts;
}

function wordsFrom(args, spec) {
  if (args.length) return args;
  if (spec === '-') throw new CliError('The machine came from standard input, so give the words as arguments.');
  return readStdin().split(/\r?\n/).filter(l => l.trim() && !l.trimStart().startsWith('#'));
}

const run = {
  usage: `automata run <machine> [word ...]

Decide each word. With no words, reads one word per line from standard input.
The empty word is "" or ε. An ω-automaton reads u(v). A transducer prints its
output after the verdict.

  --json            one object per word
  --max-steps N     step budget per word (default 100000)

Exit: 0 all accepted, 1 some rejected, 2 some had no verdict within the budget,
3 a word could not be read.`,
  options: {},
  async run({ args, opts }) {
    const [spec, ...words] = args;
    const { target, warnings } = readMachine(spec);
    if (!opts.quiet) warnings.forEach(warn);
    const list = wordsFrom(words, spec);
    const matters = verdictMatters(target);
    const transducer = !!getMachineConfig(target.machine)?.isTransducer;
    const results = list.map(w => {
      const r = decideRaw(target, w);
      return { word: w, verdict: r.verdict, output: r.output != null ? outputText(r.output) : null, error: r.error || null };
    });
    if (opts.json) printJson(results.length === 1 ? results[0] : results);
    else {
      print(table(results.map(r => {
        const shown = r.word === '' ? c.faint(App.config.sym.eps) : c.bold(shortWord(r.word));
        const v = r.verdict === 'err' ? `${verdictWord('err')}  ${c.magenta(r.error.replace(/<[^>]+>/g, ''))}`
          : matters ? verdictWord(r.verdict) : (r.verdict === 'unk' ? verdictWord('unk') : c.muted('● done'));
        return transducer && r.verdict !== 'err' ? [shown, v, `${c.faint('→')} ${r.output ? c.teal(r.output) : c.faint('(nothing)')}`] : [shown, v];
      })));
    }
    return worst(results.map(r => {
      if (r.verdict === 'err' || r.verdict === 'unk') return RANK[r.verdict];
      return matters ? RANK[r.verdict] : 0;
    }));
  }
};

// ── test ──────────────────────────────────────────────────────────

function runBatch(target, lines) {
  const matters = verdictMatters(target);
  const rows = [];
  for (const raw of lines) {
    const { input, expect } = parseBatchLine(raw);
    const r = decideRaw(target, input);
    const got = r.verdict === 'acc' ? 'accept' : r.verdict === 'rej' ? 'reject' : r.verdict === 'unk' ? 'unknown' : 'error';
    let status = 'probe';
    if (r.verdict === 'err') status = 'error';
    else if (expect) status = r.verdict === 'unk' ? 'unknown' : (matters && got === expect) ? 'pass' : 'fail';
    rows.push({ word: input, expect, got, output: r.output != null ? outputText(r.output) : null, status, error: r.error || null });
  }
  const count = s => rows.filter(r => r.status === s).length;
  const summary = { words: rows.length, pass: count('pass'), fail: count('fail'), unknown: count('unknown'), error: count('error'), probe: count('probe') };
  const code = summary.error ? 3 : summary.fail ? 1 : summary.unknown ? 2 : 0;
  return { rows, summary, code };
}

function readLines(spec) {
  const file = readSpecText(spec);
  if (!file) throw new CliError(`${spec}: no such file.`);
  return file.text.split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim() && !l.trimStart().startsWith('#'));
}

function showBatch({ rows, summary }, opts) {
  if (opts.json) { printJson({ summary, rows }); return; }
  const mark = { pass: c.green('✓'), fail: c.red('✗'), unknown: c.yellow('?'), error: c.magenta('!'), probe: c.dim('·') };
  const show = opts.failures ? rows.filter(r => r.status !== 'pass' && r.status !== 'probe') : rows;
  print(table(show.map(r => [
    mark[r.status],
    r.word === '' ? App.config.sym.eps : shortWord(r.word),
    r.status === 'error' ? c.magenta(r.error.replace(/<[^>]+>/g, '')) : verdictWord(r.got) + (r.output != null ? ` → ${r.output || '(nothing)'}` : ''),
    r.expect ? c.dim(`expected ${r.expect}`) : ''
  ])));
  const parts = [`${summary.pass} passed`, `${summary.fail} failed`];
  if (summary.unknown) parts.push(`${summary.unknown} unknown`);
  if (summary.error) parts.push(`${summary.error} could not be read`);
  if (summary.probe) parts.push(`${summary.probe} without an expectation`);
  print(`\n${summary.fail || summary.error ? c.red(parts.join(', ')) : c.green(parts.join(', '))}`);
}

const test = {
  usage: `automata test <machine> <words-file | ->

One word per line; "w => accept" or "w => reject" (also acc/rej, a/r, ✓/✗) makes
the line an expectation. Blank lines and lines starting with # are skipped.

  --watch           rerun whenever the machine or the words file changes
  --failures        show only the lines that did not pass
  --json            summary and rows as JSON

Exit: 0 every expectation held, 1 one failed, 2 one had no verdict, 3 a line
could not be read.`,
  options: { watch: { type: 'boolean', short: 'w' }, failures: { type: 'boolean' } },
  async run({ args, opts }) {
    const [spec, wordsSpec] = args;
    if (!spec || !wordsSpec) throw new CliError('Give a machine and a words file.');
    const once = () => {
      const { target } = readMachine(spec);
      const result = runBatch(target, readLines(wordsSpec));
      showBatch(result, opts);
      return result.code;
    };
    if (!opts.watch) return once();
    if (spec === '-' || wordsSpec === '-') throw new CliError('--watch needs files to watch, not standard input.');
    const rerun = () => {
      process.stdout.write('\x1b[2J\x1b[H');
      print(c.dim(`${new Date().toLocaleTimeString()} — watching ${spec} and ${wordsSpec} (Ctrl+C to stop)\n`));
      try { once(); } catch (e) { print(c.red(e.message)); }
    };
    rerun();
    let timer = null;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(rerun, 120); };
    for (const f of [spec, wordsSpec]) watch(f, schedule);
    return new Promise(() => {});
  }
};

// ── trace ─────────────────────────────────────────────────────────

const strip = s => String(s ?? '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function tapeText(tape, head, blank, alphabet = []) {
  if (!Array.isArray(tape)) return '';
  return tapeCells(tape, head, { alphabet, blank });
}

// A store as text: plain, it is its symbols run together (what scripts read);
// in colour, each symbol on its own colour.
function storeText(stack, alphabet, blank) {
  return styled ? tapeCells(stack, -1, { alphabet, blank }) : stack.join('');
}

/** The steps of a word's run, as plain objects. Pulls at most `cap` + 1. */
export function traceSteps(target, raw, cap) {
  return withMachine(target, () => {
    const saved = [App.simSteps, App.simIdx, App.simRun, App.simStart];
    App.simStart = null;
    try {
      const parsed = parseMachineInput(target.machine, String(raw ?? ''));
      if (!parsed.ok) throw new CliError(strip(parsed.error));
      const refusal = machineGuards(target.machine, parsed.input).find(g => g.refuse);
      if (refusal) throw new CliError(strip(refusal.message || refusal.say || 'This machine cannot be run as drawn.'));
      const r = withPainterSuppressed(() => { const run = streamMachine(target.machine, parsed.input); run.drain(cap + 1); return run; });
      const name = new Map(target.states.map(s => [s.id, String(s.name ?? s.id)]));
      const sym = App.config.sym;
      const steps = [];
      for (let i = 0; i < Math.min(r.known, cap + 1); i++) {
        const st = r.at(i);
        if (!st) break;
        const ids = st.states ? [...st.states] : st.state != null ? [st.state] : [];
        steps.push({
          step: i,
          states: ids.map(id => name.get(id) ?? id),
          note: strip(st.note),
          tape: Array.isArray(st.tape) ? [...st.tape] : null,
          head: Number.isInteger(st.head) ? st.head : null,
          // The window's first cell as an absolute cell number: a two-way tape
          // renumbers its window when it grows left, and a picture of the run
          // has to hold still under that.
          origin: Number.isInteger(st.view?.origin) ? st.view.origin : 0,
          tapes: Array.isArray(st.tapes) ? st.tapes.map(t => [...t]) : null,
          heads: Array.isArray(st.heads) ? [...st.heads] : null,
          stack: Array.isArray(st.stack) ? [...st.stack] : null,
          // A two-stack PDA's second stack, and an EPDA's whole store (a
          // stack of stacks; `stack` alone is only its top one).
          stack2: Array.isArray(st.stack2) ? [...st.stack2] : null,
          store: target.machine === 'EPDA' && Array.isArray(st.store) ? st.store.map(s => [...s]) : null,
          remaining: Array.isArray(st.remaining) ? [...st.remaining] : null,
          // λ and ε in the output are "nothing emitted on this step", not symbols.
          output: Array.isArray(st.outToks) ? st.outToks.filter(x => x !== sym.lambda && x !== sym.eps).join('') : null,
          final: st.final || null
        });
      }
      // Cut short only when the last step shown has no verdict and there is
      // more run behind it: a machine that halts exactly at the limit was not
      // cut, whatever the cursor says about pulling one step further.
      const last = steps[steps.length - 1];
      return { steps, cut: !last?.final && (!r.done || r.known > steps.length) };
    } finally {
      [App.simSteps, App.simIdx, App.simRun, App.simStart] = saved;
    }
  });
}

const trace = {
  usage: `automata trace <machine> <word>

The run the player would show, one line per step: the state(s), what happened,
and the tape, stack, unread input or output where the machine has them.

  --limit N         at most N steps (default 200)
  --json            the steps as JSON`,
  options: { limit: { type: 'string', short: 'n' } },
  async run({ args, opts }) {
    const [spec, word = ''] = args;
    const { target } = readMachine(spec);
    const cap = Number(opts.limit ?? 200);
    const { steps, cut } = traceSteps(target, word, cap);
    if (opts.json) { printJson({ steps, cut }); return cut ? 2 : endingCode(steps.at(-1)?.final); }
    const blank = App.config.sym.blank;
    const alphabet = [];
    for (const st of steps) for (const t of [st.tape, ...(st.tapes || []), st.stack, st.stack2, ...(st.store || [])]) for (const x of t || []) if (x && x !== blank && !alphabet.includes(x)) alphabet.push(x);
    const rows = steps.map(s => {
      const where = [];
      if (s.tape) where.push(tapeText(s.tape, s.head, blank, alphabet));
      if (s.tapes) s.tapes.forEach((t, k) => where.push(`${c.muted(`${k + 1}:`)}${tapeText(t, s.heads?.[k], blank, alphabet)}`));
      if (s.store) where.push(`${c.muted('stacks')} ${s.store.map(x => (styled ? storeText(x, alphabet, blank) : `[${x.join('')}]`)).join(styled ? c.faint(' │ ') : '')}`);
      else if (s.stack) where.push(`${c.muted('stack')} ${storeText(s.stack, alphabet, blank)}`);
      if (s.stack2) where.push(`${c.muted('stack₂')} ${storeText(s.stack2, alphabet, blank)}`);
      if (s.remaining && !s.tape) where.push(`${c.muted('rest')} ${s.remaining.join('') || c.faint(App.config.sym.eps)}`);
      if (s.output != null) where.push(`${c.muted('out')} ${s.output ? c.teal(s.output) : c.faint(App.config.sym.eps)}`);
      const note = s.final === 'accept' ? c.green(s.note) : s.final === 'reject' || s.final === 'loop' ? c.red(s.note) : s.note;
      return [c.faint(String(s.step)), c.violet(`{${s.states.join(',')}}`), note, where.join('  ')];
    });
    print(table(rows));
    const last = steps.at(-1);
    if (cut) print(c.yellow(`\n… stopped after ${cap} steps (--limit to see more)`));
    else print(`\n${endingWord(last?.final)}`);
    return cut ? 2 : endingCode(last?.final);
  }
};

// How a run that was not cut short ended. A proven loop is a decision — the
// word is not accepted — so it reads and exits as a reject; a step budget
// running out is the one "unknown"; and a run with no verdict at all is a
// transducer that simply finished.
export function endingCode(final) {
  if (final === 'accept') return 0;
  if (final === 'reject' || final === 'loop') return 1;
  if (!final) return 0;
  return 2;
}

export function endingWord(final) {
  if (final === 'accept') return verdictWord('acc');
  if (final === 'reject') return verdictWord('rej');
  if (final === 'loop') return `${verdictWord('rej')} ${c.dim('(it loops: a configuration repeated)')}`;
  if (!final) return c.dim('done');
  return `${verdictWord('unk')} ${c.dim(`(${final})`)}`;
}

export const commands = { run, test, trace };
