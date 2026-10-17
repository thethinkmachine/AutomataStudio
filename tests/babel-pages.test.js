// What a reader sees on Babel's pages, as a browser review found it wanting:
// a Turing machine's run figure, its labels, its lede and its ε chip; the
// census class for a machine that stops before its first step; and the plate
// numbers on a shelf whose neighbours share their leading digits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { context, resetApp } from './harness.js';
import { wingByKey } from '../js/babel/wings.js';
import { cellClassesOf, classifyVolume } from '../js/babel/census.js';
import { resetBabelUiForTests } from '../js/babel/babel-ui.js';
import { drawRun } from '../js/library/sketch.js';
import { edgeLabelOf } from '../js/library/analyze.js';
import { volumeAt, wingNumberBelow, wingNumberOf } from '../js/babel/volumes.js';
import { formatAddress, fromBase64url, groupDigits, toBase64url } from '../js/babel/address.js';
import { finiteTiles } from '../js/babel/spell.js';

function textOf(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.textContent;
  return (node.textContent || '') + (node.children || []).map(textOf).join('');
}

function findAll(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  (node.children || []).forEach(c => findAll(c, pred, out));
  return out;
}

const has = cls => n => n.classList?.contains(cls);

function seedTab() {
  resetApp();
  context.Workspaces.length = 0;
  context.setActiveWorkspaceId(null);
  context.Workspaces.push({ id: 'w0', name: 'Mine', dirty: false, data: context.exportWorkspaceState() });
  context.setActiveWorkspaceId('w0');
}

async function until(fn, what) {
  for (let i = 0; i < 150; i++) {
    if (fn()) return;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('a run that writes nothing still draws its head, on every row it draws', () => {
  // tm-2-2/1000: A on a blank writes a blank and moves right, for ever. Fitted
  // to all 90 frames its cells were 2px, too small for the head's outline, and
  // with nothing on the tape the figure was an empty box.
  const frames = Array.from({ length: 90 }, (_, t) => ({ head: t, cells: [] }));
  const svg = drawRun(frames, { w: 360, h: 240 });
  const heads = svg.match(/class="rn-hd?"/g) || [];
  assert.ok(heads.length >= 20, `drew ${heads.length} head marks`);
  // A narrow run keeps the outline the catalogue's figures always had.
  const still = drawRun(Array.from({ length: 10 }, () => ({ head: 0, cells: [[0, 1]] })), { w: 360, h: 240 });
  assert.match(still, /class="rn-h"/);
  assert.match(still, /class="rn-1"/);
});

test('a Turing machine that stops before its first step has a class of its own on the map', () => {
  const tm = wingByKey('tm');
  const keys = cellClassesOf(tm).map(c => c.key);
  assert.deepEqual(keys, ['h', 'z', 'n', 'x']);
  // The start state's acceptance is the number's lowest digit: every odd volume
  // halts at once, and was counted as "halts" beside the machines that run.
  assert.equal(classifyVolume(tm, [2, 2], 1001n), 'z');
  assert.equal(classifyVolume(tm, [2, 2], 1000n), 'n');
  let ran = null;
  for (let v = 0n; v < 400n && !ran; v += 2n) if (classifyVolume(tm, [2, 2], v) === 'h') ran = v;
  assert.ok(ran !== null, 'some even volume halts after a step or more');
});

test('a one-tape Turing machine’s edges are labelled with the whole rule, one to a line', () => {
  const rule = edgeLabelOf('TM');
  assert.ok(rule && rule.stacked);
  assert.equal(rule({ symbol: '1', write: '⊔', dir: 'R' }), '1 → ⊔, R');
  assert.ok(edgeLabelOf('ITM')?.stacked);
  // Several tapes are more than a figure prints; a finite automaton stays a letter.
  assert.equal(edgeLabelOf('MTM'), null);
  assert.ok(!edgeLabelOf('DFA').stacked);
});

test('a Turing machine’s volume page says what it does, labels its rules, and its ε chip agrees with the proof', async () => {
  seedTab();
  resetBabelUiForTests();
  context.renderLibraryView();
  context.go('babel-volume', 'tm-2-2/1000', { reset: true });
  const host = context.document.getElementById('lib-content');
  const lede = () => textOf(findAll(host, has('bab-lede'))[0]);
  await until(() => /Never halts/.test(lede()), 'the verdict');
  assert.equal(lede(), 'Never halts from a blank tape.');
  // The diagram carries the rules.
  const stage = findAll(host, has('bab-stage'))[0];
  assert.ok(stage, 'the volume has a figure');
  assert.match(stage.innerHTML || textOf(stage), /→ .*, [LRS]/);
  // The Behaviour figure is drawn: the head is there on a tape that stays blank.
  const run = findAll(host, has('lib-behaviour-fig'))[0];
  assert.match(run.innerHTML || '', /rn-hd?/);
  // ε is the blank tape: proved never to halt, it never accepts.
  await until(() => /ε → /.test(textOf(findAll(host, has('lib-try'))[0])), 'the shortest words');
  const tryText = textOf(findAll(host, has('lib-try'))[0]);
  assert.match(tryText, /ε → never halts/);
  assert.doesNotMatch(tryText, /ε → no verdict/);
});

test('a volume that halts at once says so, not "after 0 steps"', async () => {
  seedTab();
  resetBabelUiForTests();
  context.renderLibraryView();
  context.go('babel-volume', 'tm-2-2/1001', { reset: true });
  const host = context.document.getElementById('lib-content');
  await until(() => /Halts at once/.test(textOf(findAll(host, has('bab-lede'))[0])), 'the verdict');
  const page = textOf(host);
  assert.doesNotMatch(page, /after 0 steps/);
});

test('neighbouring volumes are told apart by the end of their numbers', () => {
  seedTab();
  resetBabelUiForTests();
  context.renderLibraryView();
  context.go('babel-volume', 'dfa-6-3/1573904772991524', { reset: true });
  const host = context.document.getElementById('lib-content');
  const nums = findAll(host, has('bab-near-num'));
  assert.ok(nums.length > 0);
  for (const n of nums) {
    assert.match(n.textContent, /^…\d{3},\d{3},\d{3}$/);
    assert.match(n.getAttribute('title'), /^№ 1,573,904,/);
  }
});

test('an ω-automaton’s page says whether its language is empty', () => {
  seedTab();
  resetBabelUiForTests();
  context.renderLibraryView();
  context.go('babel-volume', 'nba-2-2/300', { reset: true });
  const host = context.document.getElementById('lib-content');
  const facts = textOf(findAll(host, has('bab-margin'))[0]);
  assert.match(facts, /Language\s*empty/);
  assert.match(facts, /Weak/);
});

test('a short wing number is the exact one, and a long one is not worked out', () => {
  // The page shows a wing number only while it has 30 digits or fewer; the
  // capped sum must agree with the exact one wherever it answers.
  const cap = 10n ** 30n;
  for (const [k, p, v] of [['dfa', [3, 2], 977n], ['dfa', [1, 1], 1n], ['nfa', [2, 2], 40n], ['counter', [2, 2], 12345n], ['tm', [2, 2], 1000n], ['nba', [2, 2], 300n]]) {
    const wing = wingByKey(k);
    assert.equal(wingNumberBelow(wing, p, v, cap), wingNumberOf(wing, p, v), `${k}-${p.join('-')}/${v}`);
  }
  assert.equal(wingNumberBelow(wingByKey('dfa'), [3, 2], 977n, 100n), null);
  const started = performance.now();
  assert.equal(wingNumberBelow(wingByKey('dfa'), [150, 150], 5n, cap), null);
  assert.ok(performance.now() - started < 1000, 'answered from the lightest rooms');
});

test('long numbers are written and read in linear time, exactly as before', () => {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const slow = n => { let o = ''; if (n === 0n) return 'A'; while (n > 0n) { o = ALPHA[Number(n & 63n)] + o; n >>= 6n; } return o; };
  for (const n of [0n, 1n, 63n, 64n, 4096n, 10n ** 41n, (1n << 300n) - 7n]) {
    assert.equal(toBase64url(n), slow(n));
    assert.equal(fromBase64url(toBase64url(n)), n);
  }
  for (const n of [0n, 999n, 1000n, 1234567n, -1234567n, 10n ** 40n + 7n]) {
    assert.equal(groupDigits(n), n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  }
  const big = (1n << 740000n) - 12345n;
  const started = performance.now();
  assert.equal(fromBase64url(toBase64url(big)), big);
  groupDigits(big);
  assert.ok(performance.now() - started < 2000);
});

test('a tile’s place is its radices below it, worked out when read', () => {
  const wing = wingByKey('dfa'), params = [3, 2];
  const { body } = volumeAt(wing, params, 977n);
  const tiles = finiteTiles(wing, params, body);
  let place = 1n, sum = tiles.offset;
  for (const t of tiles) { assert.equal(t.place, place); sum += t.digit * t.place; place *= t.radix; }
  assert.equal(sum, 977n);
});

test('a volume page in a 150-state DFA room opens in a moment', () => {
  // The map now leads readers there: its page summed every room as heavy as
  // it for a wing number it never showed, spelled 22,500 terms it never
  // printed, and wrote its addresses a bit-shift a character.
  seedTab();
  resetBabelUiForTests();
  context.renderLibraryView();
  const started = performance.now();
  context.go('babel-volume', formatAddress({ key: 'dfa', params: [150, 150], volume: 10n ** 9000n + 7n }), { reset: true });
  assert.ok(performance.now() - started < 5000, `${(performance.now() - started).toFixed(0)} ms`);
  const host = context.document.getElementById('lib-content');
  assert.ok(findAll(host, has('bab-vol-head')).length === 1);
  resetBabelUiForTests();
});
