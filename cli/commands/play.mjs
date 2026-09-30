// play, animate — a run you can watch.
import { writeFileSync } from 'node:fs';

import { App } from '../../js/state.js';
import { readMachine, emit, CliError } from '../io.mjs';
import { endingCode, endingWord, traceSteps } from './run.mjs';
import { animatedRun } from '../figure.mjs';
import { Indexed, encodeGIF, TAPE_PALETTE, HEAD } from '../raster.mjs';
import {
  PALETTE, bar, bg, box, c, columns, isTTY, pad, print, statePill, styled, symbolColour, tapeCells
} from '../out.mjs';

function symbolCodes(steps, blank) {
  const code = new Map([[blank, 0], ['', 0]]);
  for (const s of steps) for (const t of [s.tape, ...(s.tapes || [])]) for (const x of t || []) if (!code.has(x)) code.set(x, code.size - 1);
  return code;
}

// ── The frame ─────────────────────────────────────────────────────
//  One pure function from (run, step index, view settings) to lines, so the
//  interactive screen and the piped output are the same picture.

const SPEEDS = [0.5, 1, 2, 3, 6, 10, 15, 25, 40, 60];

/** Every symbol any tape or store holds during the run, in order of appearance: the colour key. */
function alphabetOf(steps, target, blank) {
  const seen = [];
  const add = x => { if (x != null && x !== '' && x !== blank && !seen.includes(x)) seen.push(x); };
  (target.sigma || []).forEach(add);
  for (const s of steps) {
    for (const t of [s.tape, ...(s.tapes || []), s.stack, s.stack2, ...(s.store || [])]) (t || []).forEach(add);
  }
  return seen;
}

/** A tape as cells between `lo` and `hi` (absolute), the head marked, the window kept round it. */
function tapeRows(tape, origin, head, { alphabet, blank, cells }) {
  const lo = origin, hi = origin + tape.length - 1;
  const abs = origin + head;
  // The head in the middle, blank tape either side of what has been written:
  // the tape is infinite, and a window hugging the written part hides where
  // the head can go next.
  const from = abs - Math.floor(cells / 2);
  const view = [];
  for (let x = from; x < from + cells; x++) view.push(x >= lo && x <= hi ? tape[x - lo] : blank);
  const row = tapeCells(view, abs, { alphabet, blank, from });
  const left = from > lo ? c.faint('◀ ') : '  ';
  const right = from + cells - 1 < hi ? c.faint(' ▶') : '';
  const pointer = '  ' + ' '.repeat((abs - from) * 3 + 1) + c.yellow('▼');
  const numbers = '  ' + view.map((_, i) => {
    const n = from + i;
    return n === abs ? c.bold(c.yellow(pad(String(n), 3, 'center'))) : c.faint(n % 5 === 0 ? pad(String(n), 3, 'center') : '   ');
  }).join('');
  return [pointer, left + row + right, numbers];
}

/** A stack as cells, bottom first, the top marked. */
function stackRow(stack, alphabet, blank) {
  if (!stack.length) return c.faint('(empty)');
  return tapeCells(stack, -1, { alphabet, blank }) + c.faint(' ◀ top');
}

export function renderFrame(run, i, view) {
  const { steps, cut, target, title, alphabet, blank, eps } = run;
  const s = steps[i];
  const last = steps.length - 1;
  const W = Math.min(columns(), 110);
  const out = [];

  // Header: what is playing, where it is, how fast.
  const pos = `step ${i} / ${last}${cut ? '+' : ''}`;
  const status = view.playing ? c.green('▶ playing') : c.yellow('❚❚ paused');
  const speed = `${view.fps} step${view.fps === 1 ? '' : 's'}/s`;
  const barW = Math.max(10, W - 46);
  out.push(box([
    `${bar(last ? i / last : 1, barW)} ${c.bold(pad(`${Math.round((last ? i / last : 1) * 100)}%`, 4, 'right'))}   ${status} ${c.faint('·')} ${c.muted(speed)}`
  ], { title: `${c.accent('◆')} ${title} ${c.faint('·')} ${c.muted(pos)}`, w: W - 2 }));

  // The states: all of them when there are few enough to read, the current ones lit.
  const current = new Set(s.states);
  const acc = new Set((target.accepts || []).map(id => target.states.find(x => x.id === id)?.name ?? id).map(String));
  const names = target.states.map(x => String(x.name ?? x.id));
  const strip = names.length <= 14 ? names : [...current];
  out.push('');
  out.push(`  ${c.muted(pad('states', 8))}${strip.map(n => statePill(n, { current: current.has(n), accepting: acc.has(n) })).join(' ')}`);

  // What this step did.
  out.push(`  ${c.muted(pad('step', 8))}${s.note}`);
  out.push('');

  const cells = Math.max(8, Math.floor((W - 16) / 3));
  if (s.tape) {
    const [pointer, row, numbers] = tapeRows(s.tape, s.origin || 0, s.head ?? 0, { alphabet, blank, cells });
    out.push(`  ${' '.repeat(6)}${pointer}`);
    out.push(`  ${c.muted(pad('tape', 6))}${row}`);
    out.push(`  ${' '.repeat(6)}${numbers}`);
  }
  if (s.tapes) {
    s.tapes.forEach((t, k) => {
      const [pointer, row] = tapeRows(t, 0, s.heads?.[k] ?? 0, { alphabet, blank, cells });
      out.push(`  ${' '.repeat(6)}${pointer}`);
      out.push(`  ${c.muted(pad(`tape ${k + 1}`, 6))}${row}`);
    });
  }
  if (s.store) out.push(`  ${c.muted(pad('stacks', 8))}${s.store.map(x => stackRow(x, alphabet, blank)).join(c.faint('  │  '))}`);
  else if (s.stack) out.push(`  ${c.muted(pad('stack', 8))}${stackRow(s.stack, alphabet, blank)}`);
  if (s.stack2) out.push(`  ${c.muted(pad('stack₂', 8))}${stackRow(s.stack2, alphabet, blank)}`);
  if (s.remaining && !s.tape) {
    const all = run.word;
    const consumed = all.slice(0, all.length - s.remaining.length);
    const shown = consumed.length || s.remaining.length
      ? `${c.faint(consumed.join(run.joiner))}${c.yellow('│')}${c.bold(s.remaining.join(run.joiner))}`
      : c.faint(eps);
    out.push(`  ${c.muted(pad('input', 8))}${shown}`);
  }
  if (s.output != null) out.push(`  ${c.muted(pad('output', 8))}${s.output ? c.teal(s.output) : c.faint(eps)}`);

  // The space-time diagram so far, on absolute cell numbers so it holds still.
  if (view.history && s.tape) {
    const rows = Math.max(3, (process.stdout.rows || 30) - out.length - 8);
    const abs = (s.origin || 0) + (s.head ?? 0);
    const width2 = Math.floor((W - 12) / 2);
    const from = abs - Math.floor(width2 / 2);
    out.push('', `  ${c.muted('history')}`);
    for (let k = Math.max(0, i - rows + 1); k <= i; k++) {
      const st = steps[k];
      const o = st.origin || 0, h = o + (st.head ?? 0);
      let line = '';
      for (let x = from; x < from + width2; x++) {
        const sym = st.tape?.[x - o];
        const blankCell = sym == null || sym === '' || sym === blank;
        if (!styled) line += x === h ? '<>' : blankCell ? '  ' : `${String(sym)[0]} `;
        else line += x === h ? bg('#ffffff')('  ') : blankCell ? c.faint('· ') : bg(symbolColour(sym, alphabet, blank))('  ');
      }
      out.push(`  ${c.faint(pad(String(k), 6, 'right'))}  ${line}`);
    }
  }

  // The end.
  if (i === last) {
    out.push('');
    out.push(cut ? `  ${c.yellow(`… stopped after ${last} steps`)} ${c.faint('(raise --limit to see more)')}` : `  ${endingWord(s.final)}`);
  }
  // The key, for the symbols on screen.
  if (alphabet.length && styled) {
    out.push('', `  ${c.muted(pad('key', 8))}${alphabet.slice(0, 12).map(a => `${bg(symbolColour(a, alphabet, blank))(` ${a} `)}`).join(' ')}${alphabet.length > 12 ? c.faint(' …') : ''}`);
  }
  if (view.interactive) {
    out.push('', `  ${c.faint('space')} ${c.muted('play/pause')}  ${c.faint('← →')} ${c.muted('step')}  ${c.faint('+ −')} ${c.muted('speed')}  ${c.faint('home end')} ${c.muted('jump')}  ${c.faint('h')} ${c.muted('history')}  ${c.faint('r')} ${c.muted('replay')}  ${c.faint('q')} ${c.muted('quit')}`);
  }
  return out;
}

const play = {
  usage: `automata play <machine> <word> [options]

Plays the run in the terminal, one step at a time: the states (the current
one lit), what the step did, and the machine's memory — a tape in colour with
its head marked and cells numbered, a stack with its top, the input with what
has been read dimmed, and the output. Each symbol keeps one colour throughout.

In a terminal it takes over the screen and takes keys:

  space        play / pause           ← →             step back / forward
  + −          faster / slower        home end        first / last step
  h            history on or off      r               replay from the start
  q  esc       quit (the last frame is left on screen)

Piped or redirected, it prints every frame in turn instead.

Options:
  --fps N           steps per second to start at (default 6)
  --limit N         at most N steps (default 500)
  --history         show the space-time diagram under the tape: one row per
                    step, time running down
  --paused          start paused on step 0

Examples:
  $ automata play 1RB1LB_1LA1RZ ""            the 2-state busy beaver
  $ automata play machine.automaton 0110 --history --fps 15
  $ automata play js/examples/npda.json abba   watch the stack fill and empty

Exit: 0 accept (or a transducer finished), 1 reject, 2 cut short or no verdict.`,
  options: { fps: { type: 'string' }, limit: { type: 'string' }, history: { type: 'boolean' }, paused: { type: 'boolean' } },
  async run({ args, opts }) {
    const [spec, word = ''] = args;
    const { target, doc, name } = readMachine(spec);
    const { steps, cut } = traceSteps(target, word, Number(opts.limit ?? 500));
    if (!steps.length) throw new CliError('The run produced no steps.');
    const blank = App.config.sym.blank, eps = App.config.sym.eps;
    const tokens = steps[0].remaining || [];
    const run = {
      steps, cut, target, blank, eps,
      title: doc?.meta?.title || (name && !/[\\/]/.test(name) ? name : String(name || '').split(/[\\/]/).pop()),
      alphabet: alphabetOf(steps, target, blank),
      word: tokens,
      joiner: tokens.every(t => [...t].length === 1) ? '' : ' '
    };
    const code = () => (cut ? 2 : endingCode(steps.at(-1)?.final));
    const interactive = isTTY && process.stdin.isTTY && styled;
    const fps = Math.max(0.5, Number(opts.fps ?? 6));

    if (!interactive) {
      // Piped: every frame, in order, as text.
      for (let i = 0; i < steps.length; i++) print(renderFrame(run, i, { playing: true, fps, history: !!opts.history }).join('\n') + '\n');
      return code();
    }

    // The screen: the alternate buffer, no cursor, raw keys.
    const view = { playing: !opts.paused, fps, history: !!opts.history, interactive: true };
    let i = 0, timer = null, done = false;
    const draw = () => process.stdout.write('\x1b[H\x1b[2J' + renderFrame(run, i, view).join('\n') + '\n');
    const schedule = () => {
      clearTimeout(timer);
      if (!view.playing || done) return;
      timer = setTimeout(() => {
        if (i < steps.length - 1) { i++; draw(); schedule(); }
        else { view.playing = false; draw(); }
      }, 1000 / view.fps);
    };
    process.stdout.write('\x1b[?1049h\x1b[?25l');
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    return await new Promise(resolve => {
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        for (const sig of ['SIGINT', 'SIGTERM']) process.off(sig, finish);
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeAllListeners('data');
        process.stdout.off('resize', draw);
        process.stdout.write('\x1b[?25h\x1b[?1049l');
        // The last frame seen stays on the ordinary screen.
        process.stdout.write(renderFrame(run, i, { ...view, interactive: false }).join('\n') + '\n');
        resolve(code());
      };
      // Raw mode turns Ctrl+C into a key, handled below; a signal from outside
      // (kill, a closing session) still has to put the terminal back.
      for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, finish);
      process.stdout.on('resize', draw);
      stdin.on('data', buf => {
        const k = buf.toString();
        if (k === 'q' || k === '\x1b' || k === '\x03') return finish();
        if (k === ' ') { view.playing = !view.playing; if (view.playing && i === steps.length - 1) i = 0; }
        else if (k === '\x1b[C') { view.playing = false; i = Math.min(steps.length - 1, i + 1); }
        else if (k === '\x1b[D') { view.playing = false; i = Math.max(0, i - 1); }
        else if (k === '+' || k === '=') view.fps = SPEEDS.find(s => s > view.fps) ?? view.fps;
        else if (k === '-' || k === '_') view.fps = [...SPEEDS].reverse().find(s => s < view.fps) ?? view.fps;
        else if (k === '\x1b[H' || k === '\x1b[1~' || k === 'g') { view.playing = false; i = 0; }
        else if (k === '\x1b[F' || k === '\x1b[4~' || k === 'G') { view.playing = false; i = steps.length - 1; }
        else if (k === 'h') view.history = !view.history;
        else if (k === 'r') { i = 0; view.playing = true; }
        draw();
        schedule();
      });
      draw();
      schedule();
    });
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
                    space-time diagram growing one row per step. For video,
                    ffmpeg -i run.gif -pix_fmt yuv420p run.mp4
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
