// The HOA reader against a real tool: automata as Spot's ltl2tgba writes them,
// in every acceptance and output shape it has, and Spot's own verdict on each
// word. The files and the verdicts are fixtures (tests/fixtures/spot-hoa/), so
// this needs no Spot; regenerate them with `node scripts/hoa-fixtures.mjs`
// where Spot is installed.
//
// Round trips through our own writer cannot catch a reader that disagrees
// with how other tools write the format — this caught Spot naming two-colour
// odd parity "Rabin 1" and "Streett 1", which the reader used to refuse.
import '../cli/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { decideRaw } from '../js/library/analyze.js';
import { readMachineText } from '../cli/io.mjs';
import { hoaText } from '../cli/formats/hoa.mjs';

const DIR = 'tests/fixtures/spot-hoa';
const manifest = JSON.parse(readFileSync(`${DIR}/manifest.json`, 'utf8'));
const lettersOf = word => word.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * Every word Spot decided, decided by the machine. A word over a letter the
 * reader left out of Σ has no run, so Spot must reject it too — which is how
 * a wrong Σ shows up.
 */
function agrees(t, words, what) {
  const sigma = new Set(t.sigma);
  for (const [word, want] of words) {
    if (lettersOf(word).some(l => !sigma.has(l))) {
      assert.equal(want, 'rej', `${what}: Spot accepts ${word}, over a letter outside Σ = {${[...sigma]}}`);
      continue;
    }
    assert.equal(decideRaw(t, word).verdict, want, `${what}: ${word}`);
  }
}

for (const c of manifest.cases) {
  test(`${c.file}: ${c.command}`, () => {
    const text = readFileSync(`${DIR}/${c.file}`, 'utf8');
    if (c.refuse) {
      assert.throws(() => readMachineText(text, c.file), /not Büchi, generalized Büchi, co-Büchi or parity/);
      return;
    }
    const t = readMachineText(text, c.file).target;
    agrees(t, c.words, 'read');
    // And through our writer and back: the letters keep their names.
    agrees(readMachineText(hoaText(t), 'back.hoa').target, c.words, 'written and read back');
  });
}

test('the fixtures cover every acceptance the reader maps', () => {
  const acc = manifest.cases.map(c => c.acceptance).join('\n');
  for (const shape of [/^1 Inf\(0\)$/m, /^2 Inf\(0\)&Inf\(1\)$/m, /^1 Fin\(0\)$/m, /^2 Fin\(0\) & Inf\(1\)$/m, /^2 Fin\(0\) \| Inf\(1\)$/m, /^0 t$/m, /^3 /m]) {
    assert.match(acc, shape);
  }
});
