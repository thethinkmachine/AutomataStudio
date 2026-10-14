// The Library of Babel: every machine numbered, and the pages that read them.
//
// The numbering is pinned exhaustively where rooms are small, and by the
// app's own machines — every bundled example must read into a volume that
// decides as the original does. The pages are drawn under the DOM stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { context, resetApp } from './harness.js';
import { bits, distribution, distributionOf, fin, fraction, nat, oneOf, option, seq, subset, table, tuple, valueAt, volumeOf } from '../js/babel/shape.js';
import { WINGS, WINGLESS_ALIASES, readDocument, wingByKey, wingOf, withReaderNames } from '../js/babel/wings.js';
import {
  fromWingNumber, locateDocument, openVolume, roomShape, volumeAt, volumeNumber, wingNumberOf
} from '../js/babel/volumes.js';
import { formatAddress, fromBase64url, parseAddress, showNumber, toBase64url } from '../js/babel/address.js';
import { canonicalOf } from '../js/babel/canon.js';
import { classifyBody, decideText, tmBehaviour, withVolumeLoaded } from '../js/babel/census.js';
import { dfaOf, languageClass, minimiseDfa, weakViolation } from '../js/babel/facts.js';
import { endlessSpelling, finiteTiles, nudge } from '../js/babel/spell.js';
import { findVolume } from '../js/babel/find.js';
import { handleBabelMessage } from '../js/babel/babel-worker-core.js';
import { MachineTypes } from '../js/core/state.js';
import { minimalDfaOf, targetFromDoc } from '../js/library/analyze.js';
import { machineIdOf } from '../js/library/hash.js';
import { parseLibraryHash, parseLibraryProtocolUrl } from '../js/library/config.js';
import { writeStandardTM } from '../js/interop/standard-tm.js';

const EXAMPLES = join(import.meta.dirname, '..', 'js', 'examples');

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

/** rank(unrank(r)) = r for every object up to `maxS`, at most `cap` per size. */
function roundTrips(shape, maxS, cap = 400n) {
  let n = 0;
  for (let s = 0; s <= maxS; s++) {
    const c = shape.count(s);
    for (let r = 0n; r < c && r < cap; r++) {
      const back = shape.rank(shape.unrank(s, r));
      assert.equal(back.s, s);
      assert.equal(back.r, r);
      n++;
    }
  }
  return n;
}

// ── The engine ────────────────────────────────────────────────────

test('every part of a shape is a bijection, size by size', () => {
  assert.ok(roundTrips(seq(fin(2)), 7) > 200);
  roundTrips(seq(fin(3), { min: 1 }), 5);
  roundTrips(seq(seq(fin(2), { min: 1 })), 6);
  roundTrips(subset(tuple(fin(1), fin(3), fin(1), seq(fin(2)))), 7);
  roundTrips(subset(tuple(fin(2), fin(2))), 0, 1000n);
  roundTrips(oneOf(tuple(fin(2), seq(fin(2))), table(2, option(tuple(fin(2), seq(fin(3)))))), 6);
  roundTrips(fraction({ zero: true }), 12);
  roundTrips(tuple(table(3, nat()), table(4, fin(3))), 6);
  roundTrips(tuple(bits(3), table(6, fin(3))), 0, 6000n);
});

test('counts are what the parts say: strings, sets, fractions', () => {
  assert.equal(seq(fin(2)).count(3), 8n);
  assert.equal(fraction().count(4), 4n, 'φ(5) = 4: 1/5, 2/5, 3/5, 4/5');
  assert.equal(fraction({ zero: true }).count(0), 2n, '0/1 and 1/1');
  assert.equal(subset(fin(5)).count(0), 32n, 'a set of a finite thing is bits');
  assert.equal(tuple(bits(3), table(6, fin(3))).total, 5832n);
});

test('a room is its objects end to end, smaller first', () => {
  const s = tuple(bits(1), subset(tuple(fin(1), fin(3), fin(1), seq(fin(2)))));
  for (let v = 0n; v < 300n; v++) assert.equal(volumeOf(s, valueAt(s, v).value), v);
});

test('a distribution is its parts over their least common denominator, and nothing else', () => {
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  for (const n of [1, 2, 3, 4]) {
    const D = distribution(n);
    roundTrips(D, 8);
    for (let s = 0; s <= 8; s++) {
      // Every way to split d = s + 1 into n whole parts that share no factor.
      let brute = 0;
      const walk = (i, m, g) => {
        if (i === n - 1) { if (gcd(g, m) === 1) brute++; return; }
        for (let x = 0; x <= m; x++) walk(i + 1, m - x, gcd(g, x));
      };
      walk(0, s + 1, 0);
      assert.equal(D.count(s), BigInt(brute), `n = ${n}, size ${s}`);
    }
  }
  assert.equal(distribution(3).count(0), 3n, 'size 0 is the three certainties');
  assert.deepEqual(distributionOf([0.5, 0.25, 0.25]), { d: 4, parts: [2, 1, 1] });
  assert.equal(distributionOf([0.5, 0.4]), null, 'weights that do not sum to 1 are no distribution');
});

// ── Wings ─────────────────────────────────────────────────────────

test('every machine type has a wing, and the alias has its target\'s', () => {
  for (const type of Object.keys(MachineTypes)) {
    assert.ok(wingOf(type), `${type} has no wing — declare its shape in js/babel/wings.js`);
  }
  assert.equal(WINGS.length, Object.keys(MachineTypes).length - Object.keys(WINGLESS_ALIASES).length);
  assert.equal(new Set(WINGS.map(w => w.key)).size, WINGS.length, 'wing keys are unique');
});

test('every PFA volume is a probabilistic automaton: each row sums to 1, or is absent', () => {
  const wing = wingByKey('pfa');
  for (let v = 0n; v < 400n; v++) {
    const { doc } = openVolume({ wing, params: [2, 2], volume: v * 97n });
    const rows = new Map();
    for (const t of doc.transitions) rows.set(`${t.from}|${t.symbol}`, (rows.get(`${t.from}|${t.symbol}`) || 0) + t.weight);
    for (const [key, total] of rows) assert.ok(Math.abs(total - 1) < 1e-9, `pfa-2-2/${v * 97n}: row ${key} sums to ${total}`);
  }
  const bad = openVolume({ wing, params: [2, 1], volume: 40n }).doc;
  bad.transitions = [{ id: 't1', from: 's0', to: 's1', symbol: 'a', weight: 0.5 }, { id: 't2', from: 's0', to: 's0', symbol: 'a', weight: 0.4 }];
  assert.match(readDocument(bad).error, /add to 0.9, not 1/);
});

test('a weak automaton is shelved with the Büchi automata, and its page says whether it is weak', () => {
  assert.equal(wingOf('DWA'), wingByKey('dba'));
  assert.equal(wingOf('NWA'), wingByKey('nba'));
  assert.equal(wingByKey('dwa'), wingByKey('dba'), 'an old dwa address still finds its wing');
  const v = openVolume({ key: 'dba', params: [2, 2], volume: 5n });
  const r = readDocument({ ...v.doc, machine: 'DWA' });
  assert.equal(r.wing.type, 'DBA');
  assert.match(r.notes[0], /decides as a Büchi automaton does/);
  // s0 ↔ s1 on a cycle with only s1 accepting straddles F; a cycle wholly in F does not.
  const doc = { states: [{ id: 'p' }, { id: 'q' }], transitions: [{ from: 'p', to: 'q' }, { from: 'q', to: 'p' }], accepts: ['q'] };
  assert.deepEqual(weakViolation(doc)?.sort(), ['p', 'q']);
  assert.equal(weakViolation({ ...doc, accepts: ['p', 'q'] }), null);
  assert.equal(weakViolation({ ...doc, transitions: [{ from: 'p', to: 'q' }] }), null, 'no cycle, nothing to break');
});

test('a TM volume carries its tape, so no reader setting changes what it is', () => {
  const tm = openVolume({ key: 'tm', params: [2, 2], volume: 1234n });
  assert.equal(tm.doc.config.twoWayTape, false);
  assert.equal(openVolume({ key: 'itm', params: [2, 2], volume: 1234n }).doc.config.twoWayTape, true);
  // A TM document with a two-way tape is an ITM's machine.
  const r = locateDocument({ ...tm.doc, config: { ...tm.doc.config, twoWayTape: true } });
  assert.equal(r.wing.type, 'ITM');
  assert.equal(r.volume, 1234n);
  assert.match(r.notes[0], /two-way/);
  // The halting verdict reads the wing's tape, not the reader's.
  const held = context.App.config.twoWayTape;
  try {
    const verdicts = [false, true].map(on => {
      context.App.config.twoWayTape = on;
      return [0n, 77n, 1234n, 4001n].map(n => tmBehaviour(tm.wing, [2, 2], openVolume({ key: 'tm', params: [2, 2], volume: n }).body)?.verdict);
    });
    assert.deepEqual(verdicts[0], verdicts[1]);
  } finally { context.App.config.twoWayTape = held; }
  // NDTM and MTM hold the tape as the first choice of the number.
  for (const key of ['ndtm', 'mtm']) {
    const wing = wingByKey(key);
    const params = wing.params.map(p => p.min);
    const shape = roomShape(wing, params);
    const half = shape.finite ? shape.total / 2n : null;
    if (half === null) continue;
    assert.equal(openVolume({ wing, params, volume: 0n }).doc.config.twoWayTape, false, key);
    assert.equal(openVolume({ wing, params, volume: half }).doc.config.twoWayTape, true, key);
  }
});

test('every wing: a volume becomes a document and reads back as the same volume', () => {
  for (const wing of WINGS) {
    const params = wing.params.map(p => Math.max(p.min, p.id === 'states' ? 2 : 1, p.id === 'tape symbols' ? 2 : 0, p.id === 'tapes' ? 2 : 0));
    const shape = roomShape(wing, params);
    for (let i = 0; i < 12; i++) {
      const volume = shape.finite ? (shape.total * BigInt(i * 7919 + 13)) / 175000n % shape.total : BigInt(i * 37);
      const v = openVolume({ wing, params, volume });
      const back = locateDocument(v.doc);
      assert.ok(!back.error, `${wing.key}: ${back.error}`);
      assert.equal(back.volume, volume, `${wing.key} volume ${volume}`);
      assert.deepEqual(back.params, params);
      // And the machine layer can run it.
      withVolumeLoaded(v.doc, () => assert.ok(['acc', 'rej', 'unk', 'err'].includes(decideText(v.doc.machine, '').verdict)));
    }
  }
});

test('every bundled example reads into a volume that decides as the original does', () => {
  for (const f of readdirSync(EXAMPLES).filter(f => f.endsWith('.json'))) {
    const doc = JSON.parse(readFileSync(join(EXAMPLES, f), 'utf8'));
    const loc = locateDocument(doc);
    assert.ok(!loc.error, `${f}: ${loc.error}`);
    const v = openVolume({ wing: loc.wing, params: loc.params, volume: loc.volume });
    const cfg = MachineTypes[doc.machine] || {};
    if (cfg.isOmega || loc.wing.kind === 'tm' || ['MTM', 'LBA', 'NDTM', 'PFA'].includes(doc.machine)) continue;
    const sigma = loc.names.sigma || [];
    const sep = sigma.some(s => s.length > 1) ? ' ' : '';
    const words = [[]];
    for (const a of sigma.keys()) words.push([a]);
    for (const a of sigma.keys()) for (const b of sigma.keys()) words.push([a, b]);
    for (const w of words.slice(0, 40)) {
      const was = withVolumeLoaded(doc, () => decideText(doc.machine, w.map(i => sigma[i]).join(sep)));
      const now = withVolumeLoaded(v.doc, () => decideText(v.doc.machine, w.map(i => v.doc.sigma[i]).join('')));
      assert.equal(now.verdict, was.verdict, `${f} on ${JSON.stringify(w)}`);
    }
  }
});

test('a volume given its reader\'s letters back decides as the original, in those letters', () => {
  let renamed = 0;
  for (const f of readdirSync(EXAMPLES).filter(f => f.endsWith('.json'))) {
    const doc = JSON.parse(readFileSync(join(EXAMPLES, f), 'utf8'));
    const loc = locateDocument(doc);
    const v = openVolume({ wing: loc.wing, params: loc.params, volume: loc.volume });
    const own = withReaderNames(v.doc, loc.names);
    // Every document it makes is one the wing reads back to the same volume.
    const back = locateDocument(own);
    assert.ok(!back.error, `${f}: ${back.error}`);
    assert.equal(back.volume, loc.volume, `${f}: the reader's letters do not change the number`);
    if (own !== v.doc) renamed++;
    const cfg = MachineTypes[doc.machine] || {};
    if (cfg.isOmega || loc.wing.kind === 'tm' || ['MTM', 'LBA', 'NDTM', 'PFA'].includes(doc.machine)) continue;
    const sigma = loc.names.sigma || [];
    if (own === v.doc || !sigma.length) continue;
    assert.deepEqual(own.sigma, sigma, `${f}: drawn over the reader's alphabet`);
    const sep = sigma.some(s => s.length > 1) ? ' ' : '';
    const words = [[]];
    for (const a of sigma.keys()) words.push([a]);
    for (const a of sigma.keys()) for (const b of sigma.keys()) words.push([a, b]);
    for (const w of words.slice(0, 40)) {
      const text = w.map(i => sigma[i]).join(sep);
      const was = withVolumeLoaded(doc, () => decideText(doc.machine, text));
      const now = withVolumeLoaded(own, () => decideText(own.machine, text));
      assert.equal(now.verdict, was.verdict, `${f} on ${JSON.stringify(text)}`);
      assert.deepEqual(now.output ?? null, was.output ?? null, `${f} emits the same on ${JSON.stringify(text)}`);
    }
  }
  assert.ok(renamed > 10, `most examples are written in letters of their own (${renamed})`);
});

test('the design\'s numbers: (ab)*, DFA № 1,537 and BB(4)', () => {
  const dfa = wingByKey('dfa');
  const v = openVolume({ wing: dfa, params: [3, 2], volume: 977n });
  assert.deepEqual(v.body, [[1, 0, 0], [2, 1, 1, 1, 1, 0]]);
  assert.equal(wingNumberOf(dfa, [3, 2], 977n), 1537n);
  assert.deepEqual(fromWingNumber(dfa, 1537n), { params: [3, 2], volume: 977n });
  withVolumeLoaded(v.doc, () => {
    for (const w of ['', 'ab', 'abab']) assert.equal(decideText('DFA', w).verdict, 'acc', w);
    for (const w of ['a', 'b', 'aba', 'ba']) assert.equal(decideText('DFA', w).verdict, 'rej', w);
  });
  const c = canonicalOf(dfa, [3, 2], v.body);
  assert.equal(c.volume, 5385n, 'numbered breadth-first, q1 is the state after a');
  assert.equal(c.twins, 2n);
  assert.equal(findVolume('(ab)*').address, 'dfa-3-2/5385');

  const bb4 = findVolume('1RB1LB_1LA0LC_1RZ1LD_1RD0RA');
  assert.equal(bb4.address, 'itm-5-2/3285176140368');
  const tm = openVolume({ key: 'itm', params: [5, 2], volume: 3285176140368n });
  assert.equal(writeStandardTM(tm.doc, tm.doc.config.sym), '1RB1LB_1LA0LC_1RZ1LD_1RD0RA');
  const verdict = tmBehaviour(tm.wing, tm.params, tm.body, { budget: 1e4 });
  assert.equal(verdict.verdict, 'halts');
  assert.equal(verdict.steps, 107);
  const canon = canonicalOf(tm.wing, tm.params, tm.body);
  assert.equal(canon.volume, 3302418579046792n, 'the halt state is fourth breadth-first');
  assert.equal(canon.twins, 24n);
});

test('the Finder reads numbers, addresses, codes and the canvas', () => {
  assert.equal(findVolume('0').address, 'dfa-1-1/0');
  assert.equal(findVolume('dfa').kind, 'wing');
  assert.equal(findVolume('dfa-3-2').kind, 'room');
  assert.equal(findVolume('dfa/1537').address, 'dfa-3-2/977');
  assert.equal(findVolume('12', { wing: 'itm' }).kind, 'volume');
  assert.equal(findVolume('((').kind, 'error');
  resetApp();
  context.App.machine = 'DFA';
  context.App.states = [{ id: 'a', name: 'a', x: 0, y: 0 }];
  context.App.startId = 'a';
  context.App.sigma = new Set(['0']);
  context.App.transitions = [{ id: 't', from: 'a', to: 'a', symbol: '0' }];
  context.App.accepts = new Set(['a']);
  const f = findVolume('canvas');
  assert.equal(f.address, 'dfa-1-1/1', 'the one-state DFA accepting everything');
  assert.deepEqual(f.names.sigma, ['0'], 'the reader\'s letters are kept for display');
});

test('the Finder refuses a programmer\'s regex rather than reading its punctuation as letters', () => {
  const BS = '\\';
  // Backreferences, lookarounds, other (?…) groups, escapes and inner anchors:
  // each refused with its reason, never a DFA over an alphabet holding \ or =.
  for (const [re, why] of [
    [`^(?=(a+)(b+))(?=${BS}1(b+)c)${BS}1${BS}2${BS}3$`, /Backreferences/],
    [`(a*)b${BS}1`, /aⁿbaⁿ/],
    ['a(?=b)b', /Lookarounds/],
    ['a(?!b)', /Lookarounds/],
    ['(?<=a)b', /Lookarounds/],
    ['(?<x>a)b', /named groups/],
    ['(?R)', /recursion/],
    [`a${BS}.b`, /Escapes/],
    ['a^b', /only mean something at the two ends/],
    ['a$b*', /only mean something at the two ends/]
  ]) {
    const f = findVolume(re);
    assert.equal(f.kind, 'error', re);
    assert.equal(f.refused, true, re);
    assert.match(f.error, why, re);
  }
  // What does mean the same in the textbook notation is read: a non-capturing
  // group is a group, and anchors at the ends say what the Finder always does.
  const plain = findVolume('(a|b)*abb');
  assert.equal(findVolume('(?:a|b)*abb').address, plain.address);
  const anchored = findVolume('^(a|b)*abb$');
  assert.equal(anchored.address, plain.address);
  assert.deepEqual(anchored.names.sigma, ['a', 'b'], 'neither anchor is a letter');
  assert.match(anchored.notes.join(' '), /\^ and \$ were dropped/);
  assert.equal(plain.notes, undefined);
});

test('a partial DFA is read with a sink, and says so', () => {
  const doc = { machine: 'DFA', states: [{ id: 'p' }, { id: 'q' }], startId: 'p', accepts: ['q'], sigma: ['a'], transitions: [{ id: 't', from: 'p', to: 'q', symbol: 'a' }] };
  const r = locateDocument(doc);
  assert.deepEqual(r.params, [3, 1]);
  assert.match(r.notes.join(' '), /sink/);
});

test('a deterministic type refuses a branching machine with a sentence', () => {
  const doc = { machine: 'DFA', states: [{ id: 'p' }, { id: 'q' }], startId: 'p', accepts: [], sigma: ['a'], transitions: [{ id: 't', from: 'p', to: 'q', symbol: 'a' }, { id: 'u', from: 'p', to: 'p', symbol: 'a' }] };
  assert.match(readDocument(doc).error, /two moves/);
});

// ── Facts, twins, the map ─────────────────────────────────────────

test('one minimiser: facts.js and analyze.js agree on every volume of dfa-2-2', () => {
  const dfa = wingByKey('dfa');
  const shape = roomShape(dfa, [2, 2]);
  for (let v = 0n; v < shape.total; v++) {
    const { body } = volumeAt(dfa, [2, 2], v);
    const mine = minimiseDfa(dfaOf('DFA', [2, 2], body));
    const theirs = minimalDfaOf(targetFromDoc(openVolume({ wing: dfa, params: [2, 2], volume: v }).doc));
    assert.equal(mine.n, theirs.n);
    assert.deepEqual(Array.from(mine.delta), theirs.delta);
    assert.deepEqual(Array.from(mine.acc).flatMap((x, q) => (x ? [q] : [])), theirs.acc);
  }
});

test('twins share a machine id, and the canonical copy is its own canonical copy', () => {
  const dfa = wingByKey('dfa');
  for (const v of [977n, 5385n, 1234n, 4000n]) {
    const { body } = volumeAt(dfa, [3, 2], v);
    const c = canonicalOf(dfa, [3, 2], body);
    const a = machineIdOf(openVolume({ wing: dfa, params: [3, 2], volume: v }).doc);
    const b = machineIdOf(openVolume({ wing: dfa, params: [3, 2], volume: c.volume }).doc);
    assert.equal(a, b);
    assert.equal(canonicalOf(dfa, [3, 2], c.body).volume, c.volume);
  }
  const nfa = wingByKey('nfa');
  const { body } = volumeAt(nfa, [2, 1], 21n);
  assert.ok(canonicalOf(nfa, [2, 1], body).exact, 'a small nondeterministic search finishes');
});

test('the census of dfa-3-2: two volumes in five accept nothing or everything', () => {
  const dfa = wingByKey('dfa');
  const shape = roomShape(dfa, [3, 2]);
  const tally = {};
  for (let v = 0n; v < shape.total; v++) {
    const c = classifyBody(dfa, [3, 2], shape.unrank(0, v));
    tally[c] = (tally[c] || 0) + 1;
  }
  assert.deepEqual(tally, { e: 1188, u: 1188, f: 208, o: 3248 });
  const t = dfaOf('DFA', [3, 2], shape.unrank(0, 977n));
  assert.equal(languageClass(t), 'o');
});

test('the worker\'s core classifies and runs, posting only strings and primitives', () => {
  const a = handleBabelMessage({ id: 1, type: 'classify', key: 'dfa', params: [3, 2], volumes: ['977', '0', '1'] });
  assert.deepEqual(a.classes, ['o', 'e', 'u']);
  const b = handleBabelMessage({ id: 2, type: 'behaviour', key: 'itm', params: [5, 2], volume: '3285176140368', budget: 1e4 });
  assert.equal(b.verdict.verdict, 'halts');
  assert.ok(Object.values(b.verdict).every(x => typeof x !== 'object'));
});

// ── The number, spelled ───────────────────────────────────────────

test('a finite volume\'s tiles add up to its number, and ↑ moves one rule', () => {
  const dfa = wingByKey('dfa');
  const { body } = volumeAt(dfa, [3, 2], 977n);
  const tiles = finiteTiles(dfa, [3, 2], body);
  assert.equal(tiles.length, 7);
  assert.equal(tiles.reduce((s, t) => s + t.digit * t.place, tiles.offset), 977n);
  assert.equal(tiles[6].key, 'q2 · b');
  assert.equal(nudge(tiles, 977n, 6, 1), 2921n);
  const fst = wingByKey('fst');
  const sp = endlessSpelling(fst, [1, 2, 2], volumeAt(fst, [1, 2, 2], 40n).body);
  assert.equal(sp.before + sp.rank, 40n);
});

// ── Addresses and links ───────────────────────────────────────────

test('addresses parse, format and carry long numbers as base64url', () => {
  assert.deepEqual(parseAddress('dfa-3-2/977'), { key: 'dfa', params: [3, 2], volume: 977n, wingNumber: null });
  assert.deepEqual(parseAddress('dfa/1,537'), { key: 'dfa', params: null, volume: null, wingNumber: 1537n });
  assert.equal(parseAddress('../etc'), null);
  const big = 10n ** 60n + 7n;
  assert.equal(fromBase64url(toBase64url(big)), big);
  const text = formatAddress({ key: 'dfa', params: [40, 2], volume: big });
  assert.match(text, /^dfa-40-2\/~/);
  assert.equal(parseAddress(text).volume, big);
  assert.deepEqual(showNumber(6836674958n), { text: '6,836,674,958', digits: 10, long: false });
  assert.equal(showNumber(10n ** 50n).long, true);
});

test('#babel links are read by the Library\'s link parser, and checked', () => {
  assert.deepEqual(parseLibraryHash('#babel'), { action: 'babel', address: null });
  assert.deepEqual(parseLibraryHash('#babel=dfa-3-2%2F977'), { action: 'babel', address: 'dfa-3-2/977' });
  assert.equal(parseLibraryHash('#babel=..%2Fx'), null);
  assert.deepEqual(parseLibraryProtocolUrl('automata-studio://babel/dfa-3-2/977'), { action: 'babel', address: 'dfa-3-2/977' });
});

// ── Size ──────────────────────────────────────────────────────────

test('a 1,000-state DFA has a volume, and it comes back quickly', () => {
  const dfa = wingByKey('dfa');
  const n = 1000, k = 2;
  const body = [[1, ...new Array(n - 1).fill(0)], Array.from({ length: n * k }, (_, i) => (2 * Math.floor(i / 2) + (i % 2)) % n)];
  const t0 = Date.now();
  const v = volumeNumber(dfa, [n, k], body);
  assert.equal(v.toString().length, 6302);
  assert.deepEqual(volumeAt(dfa, [n, k], v).body, body);
  assert.ok(Date.now() - t0 < 4000, 'ranking a 1,000-state DFA stays well under a second or two');
});

// ── Boundaries ────────────────────────────────────────────────────

test('the engine imports no page: only babel-ui.js, find.js and babel-client.js reach past it', () => {
  const dir = join(import.meta.dirname, '..', 'js', 'babel');
  const allowed = /^(\.\/|\.\.\/machines\/|\.\.\/core\/state\.js$)/;
  for (const f of readdirSync(dir)) {
    if (['babel-ui.js', 'find.js'].includes(f)) continue;
    const src = readFileSync(join(dir, f), 'utf8');
    for (const m of src.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)) {
      assert.match(m[1], allowed, `${f} imports ${m[1]}`);
    }
  }
});

// ── The pages ─────────────────────────────────────────────────────

function seedTab() {
  resetApp();
  context.Workspaces.length = 0;
  context.setActiveWorkspaceId(null);
  context.Workspaces.push({ id: 'w0', name: 'Mine', dirty: false, data: context.exportWorkspaceState() });
  context.setActiveWorkspaceId('w0');
}

test('the Entrance reads as you type and lists every wing', () => {
  seedTab();
  context.renderLibraryView();
  context.go('babel', null, { reset: true });
  const host = context.document.getElementById('lib-content');
  const page = textOf(host);
  assert.match(page, /Every machine that has ever been conceived,/);
  assert.match(page, /or ever will be\./);
  assert.match(page, /28 wings/);
  // One hexagon per wing: DWA and NWA read into DBA's and NBA's wings, and
  // used to draw those two hexagons a second time.
  const hexes = findAll(host, n => n.classList?.contains('bab-wing-link')).map(textOf);
  assert.equal(hexes.length, 28);
  assert.equal(new Set(hexes).size, 28, 'no wing is drawn twice');
  const input = findAll(host, n => n.classList?.contains('bab-typewriter'))[0];
  input.value = '1537';
  input._listeners.input({});
  assert.match(textOf(findAll(host, n => n.classList?.contains('bab-preview'))[0]), /977/);
});

test('a volume page: its number, its machine, its tiles and its neighbours', async () => {
  seedTab();
  context.renderLibraryView();
  context.go('babel-volume', 'dfa-3-2/977', { reset: true });
  const host = context.document.getElementById('lib-content');
  const page = textOf(host);
  assert.match(page, /977/);
  assert.match(page, /DFA № 1,537/);
  assert.match(page, /Accepts ε, ab, abab/);
  assert.match(page, /Minimal✓ already/);
  assert.match(page, /977, spelled/);
  assert.match(page, /You might be interested in/);
  assert.equal(findAll(host, n => n.classList?.contains('bab-tile')).length, 7);
  await new Promise(r => setTimeout(r, 20));
  assert.match(textOf(host), /canonical copy is/);
  assert.equal(context.libraryRoute().page, 'babel-volume');
});

test('a volume page offers what a catalogue entry does: actions, a definition, its code, words to try', async () => {
  seedTab();
  context.renderLibraryView();
  context.go('babel-volume', 'dfa-3-2/977', { reset: true });
  const host = context.document.getElementById('lib-content');
  const page = textOf(host);
  assert.match(page, /Deterministic Finite Automaton · infinite, co-infinite language/i, 'the kicker');
  assert.match(page, /3 states, 2 letters/);
  assert.match(page, /Accepts ε, ab, abab/, 'the lede');
  for (const label of ['Open in a new tab', 'Save']) assert.ok(findAll(host, n => n.tagName === 'BUTTON' && textOf(n) === label).length, label);
  const menu = findAll(host, n => n.classList?.contains('lib-more-menu'))[0];
  for (const item of [/Download the \.automaton file/, /Copy link/, /Copy the address/, /Copy the machine code/, /Submit it to the catalogue/]) assert.match(textOf(menu), item);
  assert.doesNotMatch(textOf(menu), /as a block/, 'a DFA takes no blocks, so none is offered');
  // The aside's definition and machine code, as a listing has them.
  assert.match(page, /Definition/);
  const code = findAll(host, n => n.classList?.contains('lib-code-text'))[0];
  const v = openVolume({ key: 'dfa', params: [3, 2], volume: 977n });
  assert.equal(textOf(code), context.canonicalCodeOf(v.doc));
  // The shortest words, each decided, each a chip that runs.
  await new Promise(r => setTimeout(r, 10));
  const chips = findAll(host, n => n.classList?.contains('lib-verdict'));
  assert.deepEqual(chips.map(textOf).slice(0, 3), ['ε → accept', 'a → reject', 'b → reject']);
  assert.ok(chips.some(c => textOf(c) === 'ab → accept'));
});

test('a long address keeps the bar to one line: its ends, with the whole a press away', () => {
  seedTab();
  context.renderLibraryView();
  const huge = openVolume({ key: 'dfa', params: [20, 11], volume: 10n ** 290n + 12345n });
  context.go('babel-volume', huge.address, { reset: true });
  const host = context.document.getElementById('lib-content');
  const here = findAll(host, n => n.classList?.contains('bab-crumb-seg') && n.classList.contains('is-here'))[0];
  const word = textOf(findAll(here, n => n.classList?.contains('bab-crumb-word'))[0]);
  assert.ok(word.length <= 20, `clipped to its ends: ${word}`);
  assert.match(word, /…/);
  assert.match(here.getAttribute('title'), new RegExp(huge.address.replace(/[~/]/g, m => `\\${m}`)), 'the tooltip carries all of it');
  assert.equal(here.tagName, 'BUTTON', 'a press copies the address');
  // A room the long way round reads in a power of ten, not a caret.
  assert.match(textOf(findAll(host, n => n.classList?.contains('bab-pos-say'))[0]), /10[⁰¹²³⁴⁵⁶⁷⁸⁹]+/);
});

test('a volume with no short word says so rather than "Accepts , …"', () => {
  seedTab();
  context.renderLibraryView();
  // A chain of twelve states: the only accepted words are eleven letters long.
  const n = 12;
  const doc = {
    machine: 'DFA', startId: 's0', accepts: [`s${n - 1}`], sigma: ['a'],
    states: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `q${i}`, x: 0, y: 0 })),
    transitions: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, from: `s${i}`, to: `s${Math.min(i + 1, n - 1)}`, symbol: 'a' }))
  };
  const loc = locateDocument(doc);
  context.go('babel-volume', loc.address, { reset: true });
  const page = textOf(context.document.getElementById('lib-content'));
  assert.match(page, /Accepts no word of 10 letters or fewer, and infinitely many longer ones\./);
  assert.doesNotMatch(page, /Accepts ,/);
});

test('a Turing machine volume gets the Behaviour section a listing has, once its verdict is in', async () => {
  seedTab();
  context.App.machine = 'TM';
  context.renderLibraryView();
  context.go('babel-volume', 'itm-5-2/3285176140368', { reset: true });
  const host = context.document.getElementById('lib-content');
  for (let i = 0; i < 40 && !/Halts from a blank tape after/.test(textOf(host)); i++) await new Promise(r => setTimeout(r, 25));
  const page = textOf(host);
  assert.match(page, /Behaviour/);
  assert.match(page, /Halts from a blank tape after 107 steps/);
  assert.match(page, /1RB1LB_1LA0LC_1RZ1LD_1RD0RA/);
  assert.ok(findAll(host, n => n.classList?.contains('lib-behaviour-fig') && n.children?.length).length, 'its run, drawn');
  // A Turing machine on the canvas can take it as a block, as it can a listing.
  const menu = findAll(host, n => n.classList?.contains('lib-more-menu'))[0];
  const insert = findAll(menu, n => n.tagName === 'BUTTON' && /Insert into my TM as a block/.test(textOf(n)))[0];
  assert.ok(insert, textOf(menu));
  const before = (context.App.blocks || []).length;
  insert._listeners.click({});
  assert.equal((context.App.blocks || []).length, before + 1);
});

test('the Entrance shows how a machine is a number, and the volumes a reader kept', async () => {
  seedTab();
  for (const r of await context.listMyLibrary()) await context.removeFromMyLibrary(r.id);
  context.renderLibraryView();
  context.go('babel', null, { reset: true });
  const host = context.document.getElementById('lib-content');
  let page = textOf(host);
  assert.match(page, /How a machine is a number/);
  assert.match(page, /1 \+ 16 \+ 24 \+ 72 \+ 216 \+ 648 \+ 0 =/);
  assert.match(page, /works offline/);
  assert.doesNotMatch(page, /Your volumes/, 'nothing kept, no shelf');
  context.go('babel-volume', 'dfa-3-2/977');
  findAll(host, n => n.tagName === 'BUTTON' && textOf(n) === 'Save')[0]._listeners.click({});
  await new Promise(r => setTimeout(r, 30));
  context.go('babel');
  page = textOf(host);
  assert.match(page, /Your volumes/);
  assert.match(page, /DFA № 1,537/);
  for (const r of await context.listMyLibrary()) await context.removeFromMyLibrary(r.id);
});

test('a room draws its map and its plates, and the Wings page its grid', async () => {
  seedTab();
  context.renderLibraryView();
  context.go('babel-room', 'dfa-3-2', { reset: true });
  const host = context.document.getElementById('lib-content');
  assert.match(textOf(host), /3 states, 2 letters/);
  assert.match(textOf(host), /5,832 volumes/);
  assert.ok(findAll(host, n => n.tagName === 'CANVAS' || n.tagName === 'canvas').length, 'the map is a canvas');
  const plates = findAll(host, n => n.classList?.contains('bab-toggle')).find(b => textOf(b) === 'Plates');
  plates._listeners.click({});
  assert.equal(findAll(host, n => n.classList?.contains('bab-plate')).length, 24);
  context.go('babel-wings', 'npda', { reset: true });
  assert.match(textOf(host), /counted by size/);
  context.go('babel-wings', 'dfa', { reset: true });
  assert.match(textOf(host), /5,832/);
});

test('an address that names nothing is a page that says so', () => {
  seedTab();
  context.renderLibraryView();
  context.go('babel-volume', 'dfa-3-2/99999999', { reset: true });
  assert.match(textOf(context.document.getElementById('lib-content')), /There is no such volume/);
  context.go('babel-room', 'nope-1', { reset: true });
  assert.match(textOf(context.document.getElementById('lib-content')), /There is no such room/);
});
