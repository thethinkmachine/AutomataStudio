// play, animate — a run you can watch.
import { writeFileSync } from 'node:fs';

import { App } from '../../js/state.js';
import { readMachine, emit, CliError } from '../io.mjs';
import { traceSteps } from './run.mjs';
import { animatedRun } from '../figure.mjs';
import { Indexed, encodeGIF, TAPE_PALETTE, HEAD } from '../raster.mjs';
import { c, isTTY, print } from '../out.mjs';

// ANSI background colours per symbol code, for the tape and its history.
const BG = [
  '\x1b[48;5;236m', '\x1b[48;5;209m', '\x1b[48;5;39m', '\x1b[48;5;49m', '\x1b[48;5;141m',
  '\x1b[48;5;220m', '\x1b[48;5;211m', '\x1b[48;5;87m', '\x1b[48;5;252m', '\x1b[48;5;245m'
];
const RESET = '\x1b[0m';

function symbolCodes(steps, blank) {
  const code = new Map([[blank, 0], ['', 0]]);
  for (const s of steps) for (const t of [s.tape, ...(s.tapes || [])]) for (const x of t || []) if (!code.has(x)) code.set(x, code.size - 1);
  return code;
}

function tapeLine(tape, head, blank, width) {
  if (!tape) return '';
  const cells = tape.map(x => (x === '' || x == null ? blank : x));
  // Keep the head in view: a window of `width` cells around it.
  const from = Math.max(0, Math.min(head - Math.floor(width / 2), cells.length - width));
  const view = cells.slice(from, from + width);
  const left = from > 0 ? c.dim('… ') : '   ';
  const right = from + width < cells.length ? c.dim(' …') : '';
  return left + view.map((s, i) => (from + i === head ? `\x1b[7m ${s} \x1b[27m` : ` ${s} `)).join('') + right;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const play = {
  usage: `automata play <machine> <word>

Plays the run in the terminal: the state, the tape with its head (or the stack,
the unread input, the output), and what each step did. For a tape machine,
--history draws the space-time diagram as it grows, one row per step.

  --fps N           steps per second (default 6)
  --limit N         at most N steps (default 500)
  --history         the space-time diagram under the tape`,
  options: { fps: { type: 'string' }, limit: { type: 'string' }, history: { type: 'boolean' } },
  async run({ args, opts }) {
    const [spec, word = ''] = args;
    const { target } = readMachine(spec);
    const { steps, cut } = traceSteps(target, word, Number(opts.limit ?? 500));
    const blank = App.config.sym.blank;
    const delay = 1000 / Math.max(0.5, Number(opts.fps ?? 6));
    const cols = Math.max(20, Math.floor(((process.stdout.columns || 100) - 8) / 3));
    const codes = symbolCodes(steps, blank);
    const history = [];
    const rowsForHistory = Math.max(4, (process.stdout.rows || 30) - 12);
    let stop = false;
    process.on('SIGINT', () => { stop = true; });
    for (const s of steps) {
      if (stop) break;
      const out = [];
      out.push(`${c.bold(`step ${s.step}`)}${c.dim(` / ${steps.length - 1}${cut ? '+' : ''}`)}   ${c.cyan(`{${s.states.join(', ')}}`)}`);
      out.push('');
      if (s.tape) out.push(tapeLine(s.tape, s.head, blank, cols));
      if (s.tapes) s.tapes.forEach((t, k) => out.push(`${k + 1} ${tapeLine(t, s.heads?.[k] ?? 0, blank, cols - 1)}`));
      if (s.stack) out.push(`${c.dim('stack')}  ${s.stack.join(' ')}`);
      if (s.remaining && !s.tape) out.push(`${c.dim('input')}  ${s.remaining.join('') || App.config.sym.eps}`);
      if (s.output != null) out.push(`${c.dim('output')} ${s.output || App.config.sym.eps}`);
      out.push('', c.dim(s.note));
      if (opts.history && s.tape) {
        const from = Math.max(0, Math.min(s.head - Math.floor(cols / 2), s.tape.length - cols));
        const row = s.tape.slice(from, from + cols).map((x, i) => {
          const k = codes.get(x === '' || x == null ? blank : x) ?? 0;
          return from + i === s.head ? `\x1b[48;5;255m  ${RESET}` : `${BG[Math.min(k, 9)]}  ${RESET}`;
        }).join('');
        history.push(row);
        if (history.length > rowsForHistory) history.shift();
        out.push('', ...history);
      }
      if (s.final) out.push('', s.final === 'accept' ? c.green('ACCEPT') : s.final === 'reject' ? c.red('REJECT') : c.yellow(s.final.toUpperCase()));
      if (isTTY) process.stdout.write('\x1b[2J\x1b[H' + out.join('\n') + '\n');
      else print(out.join('\n') + '\n');
      if (isTTY) await sleep(delay);
    }
    if (cut) print(c.yellow(`… stopped after ${steps.length - 1} steps (--limit)`));
    const last = steps.at(-1)?.final;
    return last === 'accept' ? 0 : last === 'reject' || last === 'loop' ? 1 : 2;
  }
};

/** A tape machine's run as GIF frames: the space-time diagram growing a row a step. */
function tapeGif(steps, blank, { cell = 8, maxFrames = 240, delay = 6 }) {
  const codes = symbolCodes(steps, blank);
  // Absolute positions: the tape window can grow left, so align on origin.
  let lo = Infinity, hi = -Infinity;
  const rows = steps.map(s => {
    const origin = s.origin ?? 0;
    const cells = (s.tape || []).map((x, i) => [origin + i, codes.get(x === '' || x == null ? blank : x) ?? 0]);
    for (const [x] of cells) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    return { cells, head: origin + (s.head ?? 0) };
  });
  if (!Number.isFinite(lo)) throw new CliError('This run has no tape to draw.');
  const w = hi - lo + 1, h = rows.length;
  const full = new Indexed(w, h, TAPE_PALETTE).fill(0);
  rows.forEach((r, y) => {
    for (const [x, k] of r.cells) if (k) full.set(x - lo, y, Math.min(9, k));
    full.set(r.head - lo, y, HEAD);
  });
  const stride = Math.max(1, Math.ceil(h / maxFrames));
  const frames = [];
  for (let upTo = 1; upTo <= h; upTo += stride) {
    const f = new Indexed(w, h, TAPE_PALETTE).fill(0);
    f.px.set(full.px.subarray(0, Math.min(upTo, h) * w));
    frames.push(f.scaled(cell));
  }
  if (frames.length && (h - 1) % stride) { const f = new Indexed(w, h, TAPE_PALETTE); f.px.set(full.px); frames.push(f.scaled(cell)); }
  const delays = frames.map((_, i) => (i === frames.length - 1 ? 200 : delay));
  return encodeGIF(frames, { delay: delays });
}

const animate = {
  usage: `automata animate <machine> <word> [-o run.svg]

The run as an animated SVG of the diagram: each step lights the states the
machine is in and the edge it took, and the last frame holds in the verdict's
colour. Opens in any browser and drops into slides that take SVG.

  --gif             a tape machine's run as an animated GIF instead: the
                    space-time diagram growing one row per step
  --step-ms N       milliseconds per step (default 600)
  --theme dark      dark colours (default light)
  --limit N         at most N steps (default 200)`,
  options: {
    output: { type: 'string', short: 'o' }, gif: { type: 'boolean' }, 'step-ms': { type: 'string' },
    theme: { type: 'string' }, limit: { type: 'string' }, cell: { type: 'string' }
  },
  async run({ args, opts }) {
    const [spec, word = ''] = args;
    const { target } = readMachine(spec);
    const cap = Number(opts.limit ?? 200);
    if (opts.gif) {
      if (!opts.output) throw new CliError('A GIF is binary: give -o file.gif.');
      const { steps } = traceSteps(target, word, cap);
      if (!steps.some(s => s.tape)) throw new CliError('--gif draws a tape; this machine has none. Use the SVG animation.');
      writeFileSync(opts.output, tapeGif(steps, App.config.sym.blank, { cell: Number(opts.cell ?? 8) }));
      return 0;
    }
    const r = animatedRun(target, word, { theme: opts.theme || 'light', stepMs: Number(opts['step-ms'] ?? 600), cap });
    if (r.error) throw new CliError(r.error.replace(/<[^>]+>/g, ''));
    emit(r.svg, opts.output);
    return 0;
  }
};

export const commands = { play, animate };
