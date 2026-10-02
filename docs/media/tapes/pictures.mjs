// The pictures the command line draws itself — no recording involved, just the
// commands the guide shows, run on the files in examples/cli/ and written
// straight into docs/media/. The SVGs come in both themes so the guide can
// hand GitHub a <picture> that follows the reader's.

import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';

export const PICTURES = [
  // [file, arguments] — run in examples/cli/, written to docs/media/<file>
  ['cli-svg-light.svg', ['svg', 'div5.automaton']],
  ['cli-svg-dark.svg', ['svg', 'div5.automaton', '--theme', 'dark']],
  ['cli-animate-light.svg', ['animate', 'div5.automaton', '1100100']],
  ['cli-animate-dark.svg', ['animate', 'div5.automaton', '1100100', '--theme', 'dark']],
  // The BB(4) champion, run to its halt: all 107 steps, the number bb-search finds.
  ['cli-animate.gif', ['animate', '1RB1LB_1LA0LC_1RZ1LD_1RD0RA', '', '--gif', '--cell', '6']],
  ['cli-sheet.svg', ['sheet', 'machines.txt', '--budget', '50000000', '--far', '5']]
];

export async function drawPictures({ root, fixtures, out }) {
  const cli = join(root, 'cli', 'automata.mjs');
  const made = [];
  for (const [file, args] of PICTURES) {
    const target = join(out, file);
    const r = spawnSync(process.execPath, [cli, ...args, '-o', target], { cwd: fixtures, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    if (r.status !== 0) throw new Error(`automata ${args.join(' ')} exited ${r.status}: ${r.stderr}`);
    made.push([file, statSync(target).size]);
  }
  return made;
}
