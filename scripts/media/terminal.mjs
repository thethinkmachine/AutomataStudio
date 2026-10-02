// ══════════════════════════════════════════════════════════════════
//  A REAL SHELL, TYPED INTO
// ══════════════════════════════════════════════════════════════════
// A tape types into bash running on a pseudo-terminal, so what is filmed is
// what a reader would see: colour because stdout is a terminal, `play` taking
// over the screen because stdin is one too, pipes and `cd` and Ctrl+C doing
// what they do. `automata` on the PATH is a two-line shim that runs this
// checkout's source.
//
// The shell reports each prompt by appending its exit status to a file
// (PROMPT_COMMAND), which is how `enter()` knows a command has finished —
// more reliable than reading the screen for a prompt, and it carries the exit
// code, which a tape can assert on.

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pty from 'node-pty';

const ROOT = new URL('../../', import.meta.url);
export const CLI = decodeURIComponent(new URL('cli/automata.mjs', ROOT).pathname).replace(/^\/([A-Za-z]:)/, '$1');

const sleep = ms => new Promise(r => setTimeout(r, ms));

export function findBash() {
  if (process.platform !== 'win32') return '/bin/bash';
  const git = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout?.trim();
  const tries = [
    process.env.AUTOMATA_MEDIA_BASH,
    git && join(git, '..', '..', '..', 'bin', 'bash.exe'),
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
  ].filter(Boolean);
  const hit = tries.find(p => existsSync(p));
  if (!hit) throw new Error('Recording needs bash (on Windows, Git for Windows). Set AUTOMATA_MEDIA_BASH to its bash.exe.');
  return hit;
}

// Paths as bash on this platform spells them: C:\x → /c/x under Git Bash.
export const bashPath = p => (process.platform === 'win32' ? p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`) : p);

/**
 * The environment a filmed command sees: this one, with the shim first on the
 * PATH and colour left to the terminal to decide. Windows spells it `Path`,
 * and a second `PATH` beside it would be a coin toss, so the variable is
 * found whatever its case.
 */
export function shellEnv(bin, extra = {}) {
  const env = {};
  let path = '';
  for (const [k, v] of Object.entries(process.env)) {
    if (k.toUpperCase() === 'PATH') { path = v; continue; }
    if (k === 'FORCE_COLOR' || k === 'NO_COLOR') continue;
    // Recording from inside a Claude Code session hands its variables down —
    // a session id, a messaging token — and a filmed `claude` would take itself
    // for a child of that session. Nothing filmed inherits the recorder's agent.
    if (/^CLAUDE/.test(k)) continue;
    env[k] = v;
  }
  env.PATH = `${bin}${process.platform === 'win32' ? ';' : ':'}${path}`;
  return { ...env, ...extra };
}

const KEYS = {
  enter: '\r', space: ' ', tab: '\t', esc: '\x1b', backspace: '\x7f',
  up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', home: '\x1b[H', end: '\x1b[F',
  'ctrl+c': '\x03', 'ctrl+d': '\x04', 'ctrl+l': '\x0c'
};
const KEY_LABELS = { space: 'space', right: '→', left: '←', up: '↑', down: '↓', esc: 'esc', home: 'home', end: 'end', 'ctrl+c': 'ctrl c', enter: '⏎' };

/**
 * The shell a tape drives. `dir` is the working directory, `stage` where the
 * output is shown.
 */
export class Terminal {
  constructor({ stage, dir, cols, rows, env = {}, prompt = '$' }) {
    Object.assign(this, { stage, dir, cols, rows });
    this.status = join(dir, '.prompts');
    writeFileSync(this.status, '');
    const bin = join(dir, '.bin');
    mkdirSync(bin, { recursive: true });
    const shim = join(bin, 'automata');
    writeFileSync(shim, `#!/bin/sh\nexec node "${bashPath(CLI)}" "$@"\n`);
    chmodSync(shim, 0o755);
    this.prompt = prompt;
    this.output = '';
    this.lastOutput = performance.now();
    this.proc = pty.spawn(findBash(), ['--noprofile', '--norc', '-i'], {
      name: 'xterm-256color', cols, rows, cwd: dir,
      env: shellEnv(bin, {
        TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8',
        HISTFILE: '/dev/null', BASH_SILENCE_DEPRECATION_WARNING: '1',
        PS1: `\\[\\e[38;2;122;162;255m\\]${prompt}\\[\\e[0m\\] `, PS2: '  ',
        PROMPT_COMMAND: `echo $? >> "${bashPath(this.status)}"`,
        ...env
      })
    });
    this.proc.onData(d => { this.output += d; this.lastOutput = performance.now(); stage.write(d); });
    this.exited = new Promise(r => this.proc.onExit(r));
  }

  prompts() { return readFileSync(this.status, 'utf8').split('\n').filter(Boolean); }

  /** Until the shell has drawn its first prompt. */
  async ready() {
    await this.until(() => this.prompts().length >= 1, 20000, 'the shell to start');
    await this.settle();
  }

  async until(test, timeout, what) {
    const end = performance.now() + timeout;
    while (!(await test())) {
      if (performance.now() > end) throw new Error(`timed out after ${timeout} ms waiting for ${what}`);
      await sleep(25);
    }
  }

  /** Until the output has been quiet for `ms`. */
  async settle(ms = 200) {
    await this.until(() => performance.now() - this.lastOutput > ms, 60000, 'the output to settle');
    await this.stage.writes;
  }

  // ── What a tape calls ──────────────────────────────────────────

  /** Type text a key at a time, at about a person's speed. */
  async type(text, { speed = 38 } = {}) {
    let i = 0;
    for (const ch of text) {
      // A newline in a tape is the enter key: \ then a newline continues a command.
      this.proc.write(ch === '\n' ? '\r' : ch);
      // A little unevenness reads as typing; a fixed sequence keeps reruns alike.
      await sleep(Math.max(0, speed + ((i++ * 7919) % 23) - 11 + (ch === ' ' ? 25 : 0)));
    }
  }

  /**
   * Press enter and wait for the command to finish — the shell's next
   * prompt — unless `wait` is false (a command a tape will talk to). Returns
   * the exit status.
   */
  async enter({ wait = true, timeout = 600000 } = {}) {
    const before = this.prompts().length;
    await sleep(250);
    this.proc.write('\r');
    if (!wait) { await sleep(100); return null; }
    await this.until(() => this.prompts().length > before, timeout, 'the command to finish');
    await this.settle(150);
    return Number(this.prompts().at(-1));
  }

  /** Type a command, run it, and pause on the result. */
  async run(command, { pause = 1800, wait = true, timeout, expect } = {}) {
    await this.type(command);
    const code = await this.enter({ wait, timeout });
    if (expect !== undefined && code !== expect) throw new Error(`\`${command}\` exited ${code}, expected ${expect}`);
    if (pause) await sleep(pause);
    return code;
  }

  /** A key (see KEYS), shown on screen as it is pressed unless `show` is false. */
  async key(name, { show = true, pause = 0 } = {}) {
    const seq = KEYS[name] ?? name;
    if (show) await this.stage.showKey(KEY_LABELS[name] ?? name);
    this.proc.write(seq);
    if (pause) await sleep(pause);
  }

  /** Until the screen shows `pattern` (a string or a RegExp). */
  async waitFor(pattern, { timeout = 120000 } = {}) {
    const test = async () => {
      const text = (await this.stage.lines()).join('\n');
      return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
    };
    await this.until(test, timeout, String(pattern));
  }

  /** Until the shell is back at its prompt (after a command run with wait: false). */
  async waitPrompt(count, { timeout = 600000 } = {}) {
    await this.until(() => this.prompts().length >= count, timeout, 'the prompt');
    await this.settle(150);
  }

  sleep(ms) { return sleep(ms); }

  /** Clear the screen the way a person would: ctrl+l. */
  async clear() {
    this.proc.write('\x0c');
    await this.settle(150);
  }

  /**
   * End the shell by asking it to exit. Killing it outright on Windows leaves
   * node-pty's console agent attaching to a process that is already gone.
   */
  async close() {
    this.proc.write('\x03');
    await sleep(100);
    this.proc.write('exit\r');
    const gone = await Promise.race([this.exited.then(() => true), sleep(3000).then(() => false)]);
    if (!gone) try { this.proc.kill(); } catch { /* already gone */ }
  }
}
