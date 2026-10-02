#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  HOA FIXTURES FROM SPOT
// ══════════════════════════════════════════════════════════════════
// Writes tests/fixtures/spot-hoa/: automata as Spot's ltl2tgba writes them,
// in each acceptance and each output shape it has, with Spot's own verdict on
// a set of ultimately periodic words. tests/cli-hoa-spot.test.js reads them,
// so CI checks the HOA reader against a real tool without having Spot.
//
// The reader's own round-trip tests could not have caught what this caught:
// Spot names two-colour min odd parity "Rabin 1" and max odd "Streett 1", and
// a reader that went by acc-name refused them. Only real output says how real
// tools write a format.
//
// Needs Spot's ltl2tgba and autfilt on PATH (https://spot.lre.epita.fr).
//   node scripts/hoa-fixtures.mjs

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'tests/fixtures/spot-hoa';
const WORDS = 24;

// Each mode is one way Spot writes an automaton: the acceptance it builds
// (-B Büchi, -S state-based generalized, --parity, --cobuchi, -G anything),
// and the shape of the file (-H: aliases, implicit and state labels, one
// line, mixed or forced transition-based marks, version 1.1, verbose).
const MODES = {
  'tgba': [],
  'buchi': ['-B'],
  'gen-state': ['-S'],
  'parity-min-even': ['-D', '--parity=min even'],
  'parity-min-odd': ['-D', '--parity=min odd'],
  'parity-max-even': ['-D', '--parity=max even'],
  'parity-max-odd': ['-D', '--parity=max odd'],
  'cobuchi': ['--cobuchi'],
  'generic-det': ['-D', '-G'],
  'aliases': ['-Hb'],
  'implicit-labels': ['-D', '-Hi'],
  'state-labels': ['-Hk'],
  'one-line': ['-Hl'],
  'mixed-marks': ['-D', '--parity=max odd', '-Hm'],
  'transition-marks': ['-B', '-Ht'],
  'hoa-1.1': ['-D', '--parity=min odd', '-H1.1'],
  'verbose': ['-Hv']
};

const FORMULAS = [
  'GF a & GF b', 'FG a', 'G(a -> F b)', 'a U b', 'GF a -> GF b', 'FG a | GF b',
  'G(a -> X(b U c))', 'GF(a & X b)', '(FG a) xor (GF b)', 'X(a R b)', 'F(a & G !b) | G F c', 'G a'
];

// Cases the reader must refuse: real Rabin and Streett, past what parity says.
const REFUSE = [['(GF a -> GF b) & (GF c -> FG a)', 'generic-det'], ['(FG a & GF b) | (FG c & GF !a)', 'generic-det']];

// mulberry32: a fixed sequence of words, so a regenerated file only changes
// where Spot's answer did.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ltl2tgba = (args, f) => execFileSync('ltl2tgba', [...args, '-f', f], { encoding: 'utf8' });
const apsOf = hoa => [...(/AP:\s*\d+((?:\s*"[^"]*")*)/.exec(hoa)?.[1] ?? '').matchAll(/"([^"]*)"/g)].map(m => m[1]);

/** Every valuation of the APs, as the reader names a letter: ∅, or the true APs joined by &. */
function letters(aps) {
  const out = [];
  for (let bits = 0; bits < 1 << aps.length; bits++) {
    const on = aps.filter((_, i) => bits & (1 << i));
    out.push({ name: on.length ? on.join('&') : '∅', spot: aps.length ? aps.map(a => (on.includes(a) ? a : `!${a}`)).join(' & ') : '1' });
  }
  return out;
}

function spotAccepts(file, u, v) {
  const word = [...u.map(l => l.spot), `cycle{${v.map(l => l.spot).join('; ')}}`].join('; ');
  const r = spawnSync('autfilt', ['-q', `--accept-word=${word}`, file]);
  if (r.status > 1 || r.error) throw new Error(`autfilt failed on ${file}: ${r.stderr}`);
  return r.status === 0;
}

const version = execFileSync('ltl2tgba', ['--version'], { encoding: 'utf8' }).split('\n')[0];
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const cases = [];
Object.entries(MODES).forEach(([mode, args], i) => {
  for (let j = 0; j < 3; j++) cases.push({ formula: FORMULAS[(i * 3 + j) % FORMULAS.length], mode, args });
});
cases.push({ formula: 'false', mode: 'tgba', args: [] });
for (const [formula, mode] of REFUSE) cases.push({ formula, mode, args: MODES[mode], refuse: true });

const manifest = { spot: version, generator: 'scripts/hoa-fixtures.mjs', cases: [] };
cases.forEach(({ formula, mode, args, refuse }, n) => {
  const hoa = ltl2tgba(args, formula);
  const file = `${String(n + 1).padStart(2, '0')}-${mode}.hoa`;
  writeFileSync(join(OUT, file), hoa);
  const entry = { file, formula, command: ['ltl2tgba', ...args, '-f', formula].join(' '), acceptance: /Acceptance:\s*(.*?)\s*(?:\b[A-Za-z][\w-]*:|--BODY--|$)/m.exec(hoa)?.[1] ?? null };
  if (refuse) {
    if (!/Fin\(\d+\).*Fin\(\d+\)/.test(hoa)) throw new Error(`${file}: expected a multi-pair condition, got ${entry.acceptance}`);
    manifest.cases.push({ ...entry, refuse: true });
    return;
  }
  const ls = letters(apsOf(hoa));
  const random = rng(n + 1);
  const pick = k => Array.from({ length: k }, () => ls[Math.floor(random() * ls.length)]);
  const words = [];
  for (let w = 0; w < WORDS; w++) {
    const u = pick(Math.floor(random() * 4));
    const v = pick(1 + Math.floor(random() * 3));
    const text = `${u.map(l => l.name).join(' ')}${u.length ? ' ' : ''}(${v.map(l => l.name).join(' ')})`;
    words.push([text, spotAccepts(join(OUT, file), u, v) ? 'acc' : 'rej']);
  }
  manifest.cases.push({ ...entry, words });
});

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(`${manifest.cases.length} automata from ${version} → ${OUT} (${readdirSync(OUT).length - 1} .hoa files)`);
