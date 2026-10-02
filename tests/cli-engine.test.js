// The command line's own engine, in process: the finite-automaton operations,
// the formats it adds, the learners, the word tools and the encoders. Where
// an answer can be checked against the app — exact equivalence, the simulators
// — it is, rather than against a fixed expectation.
import '../cli/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

import { compareMachines } from '../js/exercise/grade.js';
import { decideRaw } from '../js/library/analyze.js';
import { readJFLAPText } from '../js/import-jflap.js';
import { readMachine, readMachineText } from '../cli/io.mjs';
import {
  complement, concat, countByLength, determinize, epsilonFree, fromRegex, listAccepted, minimize,
  product, reverse, sampleAccepted, seeded, star, toRegex, union
} from '../cli/fa.mjs';
import { evaluate, answerComparison } from '../cli/commands/ops.mjs';
import { hoaText, readHOA } from '../cli/formats/hoa.mjs';
import { baText, readBA } from '../cli/formats/ba.mjs';
import { jffText } from '../cli/formats/jff.mjs';
import { compareOmega, compare, structuralDiff, textListing, signatureOf } from '../cli/commands/compare.mjs';
import { lintTarget, languageFacts } from '../cli/commands/info.mjs';
import { serialize, formatFor } from '../cli/writers.mjs';
import { rpni, lstar, accepts } from '../cli/learn.mjs';
import { shrink } from '../cli/commands/fuzz.mjs';
import { normalizeStandard } from '../cli/commands/tm.mjs';
import { Indexed, encodePNG, encodeGIF, TAPE_PALETTE } from '../cli/raster.mjs';
import { App } from '../js/state.js';

const ex = name => readMachine(`js/examples/${name}.json`).target;
const same = (a, b) => compareMachines(a, b, { maxLength: 8 }).equal;
const words = (sigma, maxLen) => {
  const out = [[]];
  let level = [[]];
  for (let n = 1; n <= maxLen; n++) { level = level.flatMap(w => sigma.map(a => [...w, a])); out.push(...level); }
  return out;
};
const acc = (t, w) => decideRaw(t, w.join(' ')).verdict === 'acc';

// ── Finite automata ───────────────────────────────────────────────

test('determinize and minimize keep the language', () => {
  for (const name of ['nfa', 'nfa-classic', 'enfa', 'enfa-classic', 'dfa', 'dfa-classic']) {
    const t = ex(name);
    assert.equal(same(t, determinize(t)), true, `${name}: determinize changed the language`);
    assert.equal(same(t, minimize(t)), true, `${name}: minimize changed the language`);
    assert.equal(determinize(t).machine, 'DFA');
  }
});

test('minimize is minimal and canonical', () => {
  const a = minimize(fromRegex('(a|b)*abb'));
  assert.equal(a.states.length, 4);
  // Two drawings of one language minimize to the same table.
  const b = minimize(determinize(fromRegex('(a|b)*a(b)(b)')));
  assert.deepEqual(a.transitions.map(t => [t.from, t.symbol, t.to]), b.transitions.map(t => [t.from, t.symbol, t.to]));
});

test('complement, products and the regular operations mean what they say, word by word', () => {
  const A = fromRegex('(a|b)*a'), B = fromRegex('b(a|b)*');
  const cases = [
    [complement(A), w => !acc(A, w)],
    [product(A, B, 'and'), w => acc(A, w) && acc(B, w)],
    [product(A, B, 'or'), w => acc(A, w) || acc(B, w)],
    [product(A, B, 'xor'), w => acc(A, w) !== acc(B, w)],
    [product(A, B, 'diff'), w => acc(A, w) && !acc(B, w)],
    [union(A, B), w => acc(A, w) || acc(B, w)],
    [reverse(A), w => acc(A, [...w].reverse())],
    [epsilonFree(star(A)), w => w.length === 0 || acc(star(A), w)]
  ];
  for (const w of words(['a', 'b'], 6)) {
    for (const [m, want] of cases) assert.equal(acc(m, w), want(w), `${m.machine} on ${w.join('') || 'ε'}`);
  }
  // Concatenation: some split works.
  const C = concat(A, B);
  for (const w of words(['a', 'b'], 6)) {
    const want = w.some((_, i) => acc(A, w.slice(0, i + 1)) && acc(B, w.slice(i + 1))) || (acc(A, []) && acc(B, w));
    assert.equal(acc(C, w), want, `concat on ${w.join('')}`);
  }
});

test('regex round-trips through state elimination', () => {
  for (const re of ['(a|b)*abb', 'a*b*', '(ab|ba)*', 'a(a|b)*a|a']) {
    const m = fromRegex(re);
    const back = fromRegex(toRegex(minimize(m)).replace(/·/g, '').replace(/\s/g, '').replace(/Σ/g, '(a|b)'), { sigma: ['a', 'b'] });
    assert.equal(same(m, back), true, re);
  }
});

test('counting words matches brute force, and sampling is uniform', () => {
  const m = fromRegex('(a|b)*abb');
  const counts = countByLength(m, 8);
  for (let n = 0; n <= 8; n++) assert.equal(Number(counts[n]), words(['a', 'b'], n).filter(w => w.length === n && acc(m, w)).length);
  // Every accepted word of length 6 is drawn at roughly its share.
  const { total, words: drawn } = sampleAccepted(m, 6, 4000, seeded(42));
  assert.equal(total, 8n);
  const tally = new Map();
  for (const w of drawn) { assert.equal(acc(m, w), true); tally.set(w.join(''), (tally.get(w.join('')) || 0) + 1); }
  assert.equal(tally.size, 8);
  for (const n of tally.values()) assert.ok(n > 350 && n < 650, `a word was drawn ${n} times of 4000`);
});

test('listing accepted words is shortlex and complete', () => {
  const m = fromRegex('(a|b)*abb');
  const listed = listAccepted(m, 5, 100).map(w => w.join(''));
  const brute = words(['a', 'b'], 5).filter(w => acc(m, w)).map(w => w.join(''));
  assert.deepEqual(listed, brute);
});

test('language facts are exact', () => {
  assert.deepEqual(pick(languageFacts(fromRegex('a|b'))), { empty: false, finite: true, universal: false });
  assert.deepEqual(pick(languageFacts(fromRegex('(a|b)*'))), { empty: false, finite: false, universal: true });
  assert.deepEqual(pick(languageFacts(product(fromRegex('a*'), fromRegex('b(a|b)*'), 'and'))), { empty: true, finite: true, universal: false });
  function pick(f) { return { empty: f.empty, finite: f.finite, universal: f.universal }; }
});

test('the expression language', () => {
  const env = new Map([['A', fromRegex('(a|b)*a')]]);
  assert.equal(same(evaluate('min(det(A) & ~/b*/)', env, { sigma: ['a', 'b'] }), product(fromRegex('(a|b)*a'), complement(fromRegex('b*'), ['a', 'b']), 'and')), true);
  assert.equal(answerComparison(evaluate('/a*/ <= /(a|b)*/', env)).ok, true);
  const no = answerComparison(evaluate('/(a|b)*/ <= /a*/', env));
  assert.equal(no.ok, false);
  assert.deepEqual(no.word, ['b']);
  assert.equal(answerComparison(evaluate('A == /(a|b)*a/', env)).ok, true);
  assert.throws(() => evaluate('min(A', env), /Expected/);
  assert.throws(() => evaluate('Q', env), /not bound/);
});

// ── Formats ───────────────────────────────────────────────────────

test('every ω-automaton survives HOA and back', () => {
  for (const name of ['buchi', 'buchi-classic', 'dba', 'dba-classic', 'dcoba', 'dpa', 'dwa', 'ncoba', 'npa', 'nwa']) {
    const t = ex(name);
    const back = readMachineText(hoaText(t)).target;
    const r = compareOmega(t, back, { size: 5 });
    assert.equal(r.equal, true, `${name}: ${JSON.stringify(r)}`);
  }
});

test('HOA with transition-based and generalized Büchi acceptance', () => {
  // GF a ∧ GF b over one state, marks on the edges, the way Spot writes it.
  const text = `HOA: v1
States: 1
Start: 0
AP: 2 "a" "b"
acc-name: generalized-Buchi 2
Acceptance: 2 Inf(0)&Inf(1)
--BODY--
State: 0
[0&!1] 0 {0}
[!0&1] 0 {1}
--END--`;
  const t = readMachineText(text).target;
  assert.equal(t.machine, 'DBA');
  const say = (u, v) => decideRaw(t, `${u}(${v})`).verdict;
  assert.equal(say('', 'ab'), 'acc');
  assert.equal(say('', 'a'), 'rej');
  assert.equal(say('ab', 'b'), 'rej');
  // Parity max odd, translated to the app's min even.
  const parity = readHOA(`HOA: v1
States: 2
Start: 0
AP: 1 "a"
acc-name: parity max odd 3
Acceptance: 3 Fin(2) & (Inf(1) | Fin(0))
--BODY--
State: 0 {1}
[0] 1
[!0] 0
State: 1 {2}
[0] 1
[!0] 0
--END--`, App.config.sym);
  const p = readMachineText(JSON.stringify({ ...parity, format: undefined })).target;
  // Max odd: 2 (even) seen infinitely → reject; only 1 (odd) → accept.
  const v = w => decideRaw(p, w).verdict;
  assert.equal(v('(a)'), 'rej');
});

test('HOA parity is read from the Acceptance formula, not acc-name', () => {
  // Spot names two colours of min odd "Rabin 1" and of max odd "Streett 1";
  // they are the same conditions. Mark 0 on a, mark 1 on b, over one state.
  const body = `--BODY--
State: 0
[0&!1] 0 {0}
[!0&1] 0 {1}
[!0&!1] 0
--END--`;
  const hoa = (name, acc) => `HOA: v1\nStates: 1\nStart: 0\nAP: 2 "a" "b"\n${name ? `acc-name: ${name}\n` : ''}Acceptance: 2 ${acc}\n${body}`;
  const verdicts = text => {
    const t = readMachineText(text).target;
    return ['(a)', '(b)', '(ab)', '(∅)'].map(w => decideRaw(t, w).verdict).join(' ');
  };
  // Fin(0) & Inf(1): b infinitely often and a only finitely often.
  assert.equal(verdicts(hoa('Rabin 1', 'Fin(0) & Inf(1)')), 'rej acc rej rej');
  assert.equal(verdicts(hoa(null, 'Fin(0) & Inf(1)')), 'rej acc rej rej');
  // Fin(0) | Inf(1): b infinitely often, or a only finitely often.
  assert.equal(verdicts(hoa('Streett 1', 'Fin(0) | Inf(1)')), 'rej acc acc acc');
  // A wrong acc-name does not override the formula.
  assert.equal(verdicts(hoa('parity min even 2', 'Fin(0) & Inf(1)')), 'rej acc rej rej');
  // Real Rabin and Streett, past what parity can say, are still refused.
  assert.throws(() => readHOA('HOA: v1\nStates: 1\nStart: 0\nAP: 1 "a"\nAcceptance: 4 (Fin(0) & Inf(1)) | (Fin(2) & Inf(3))\n--BODY--\nState: 0\n[t] 0\n--END--', App.config.sym), /not Büchi/);
});

test('BA round-trip', () => {
  const nba = ex('buchi');
  const back = readMachineText(baText(nba), 'x.ba').target;
  assert.equal(compareOmega(nba, back, { size: 5 }).equal, true);
  assert.throws(() => baText({ ...nba, accepts: [] }), /every state accepts/);
});

test('JFLAP export reads back as the same machine', () => {
  for (const name of ['dfa', 'nfa', 'enfa', 'npda', 'tm', 'mealy', 'moore']) {
    const t = ex(name);
    const data = readJFLAPText(jffText(t));
    const back = readMachineText(JSON.stringify(data)).target;
    for (const w of words(t.sigma.filter(s => s !== App.config.sym.eps), 4)) {
      const x = decideRaw(t, w.join(' ')), y = decideRaw(back, w.join(' '));
      assert.equal(y.verdict, x.verdict, `${name} on ${w.join('') || 'ε'}`);
      assert.equal(String(y.output ?? ''), String(x.output ?? ''), `${name} output on ${w.join('')}`);
    }
  }
});

test('a PDA accepting by empty stack is exported with a warning, not silently', () => {
  const said = [];
  jffText(ex('pda'), { warn: m => said.push(m) });
  assert.equal(said.length, 1);
  assert.match(said[0], /empty stack/);
});

test('every export format builds for a DFA, and the extension picks the format', () => {
  const t = ex('dfa');
  for (const f of ['automaton', 'jff', 'code', 'svg', 'dot', 'tikz', 'table-csv', 'table-md', 'code-js', 'code-py', 'code-java', 'code-c', 'code-xstate', 'code-scxml', 'test-jest', 'test-pytest', 'samples', 'coverage']) {
    const out = serialize(t, f);
    assert.ok(out.length > 20, f);
  }
  assert.equal(formatFor(null, 'x.hoa'), 'hoa');
  assert.equal(formatFor(null, 'x.test.js'), 'test-jest');
  assert.equal(formatFor('json', null), 'automaton');
  assert.match(serialize(t, 'svg'), /<style>/);
});

test('a machine read from a file, a code, the standard notation or document text', () => {
  const byFile = readMachine('js/examples/dfa.json').target;
  const code = serialize(byFile, 'code').trim();
  const byCode = readMachine(code).target;
  assert.equal(same(byFile, byCode), true);
  const tm = readMachine('1RB1LB_1LA1RZ').target;
  assert.equal(tm.machine, 'ITM');
  const byText = readMachineText(readFileSync('js/examples/nfa.json', 'utf8')).target;
  assert.equal(same(byText, ex('nfa')), true);
  assert.throws(() => readMachine('no-such-file.automaton'), /no such file/);
});

// ── Comparing ─────────────────────────────────────────────────────

test('diff matches states by name and ignores positions', () => {
  const a = ex('dfa');
  const moved = { ...a, states: a.states.map(s => ({ ...s, x: (s.x || 0) + 50 })) };
  assert.equal(structuralDiff(a, moved).same, true);
  const renamed = { ...a, states: a.states.map(s => ({ ...s, name: `z${s.name}` })) };
  const d = structuralDiff(a, renamed);
  assert.equal(d.same, false);
  assert.equal(d.isomorphic, true);
  const listing = textListing(a);
  assert.doesNotMatch(listing, /\bx\b|"x"/);
  assert.match(listing, /^machine DFA/);
});

test('similar groups finite automata by language', () => {
  assert.equal(signatureOf(fromRegex('(a|b)*abb')).key, signatureOf(minimize(fromRegex('(a|b)*abb'))).key);
  assert.notEqual(signatureOf(fromRegex('(a|b)*abb')).key, signatureOf(fromRegex('(a|b)*ab')).key);
});

test('equivalence of ω-automata is bounded and says so', () => {
  const r = compare(ex('buchi'), ex('buchi'));
  assert.equal(r.method, 'lassos');
  assert.equal(r.equal, true);
  assert.throws(() => compare(ex('buchi'), ex('dfa')), /infinite words/);
});

// ── Lint ──────────────────────────────────────────────────────────

test('lint finds what is wrong and nothing on the examples', () => {
  for (const name of ['dfa', 'nfa', 'npda', 'dba', 'dpa', 'nwa']) {
    assert.deepEqual(lintTarget(ex(name)).filter(f => f.level !== 'info'), [], name);
  }
  const t = ex('dfa');
  const broken = {
    ...t,
    states: [...t.states, { id: 'lost', name: 'lost' }],
    transitions: [...t.transitions, { ...t.transitions[0], id: 'dup' }]
  };
  const rules = lintTarget(broken).map(f => f.rule);
  assert.ok(rules.includes('unreachable'));
  assert.ok(rules.includes('duplicate-edge'));
  assert.ok(rules.includes('branches'), 'a DFA with two edges on one symbol');
});

// ── Learning ──────────────────────────────────────────────────────

test('RPNI is consistent with its sample and exact from a characteristic one', () => {
  const target = ex('dfa');
  const samples = words(['0', '1'], 7).map(w => ({ word: w, accept: acc(target, w) }));
  const m = rpni(samples);
  const dfa = { kind: 'machine', machine: 'DFA', sigma: m.sigma, stackAlpha: [], outputAlpha: [], tapeCount: 1, blocks: [], config: {}, states: [], transitions: [], accepts: [] };
  for (let q = 0; q < m.states; q++) dfa.states.push({ id: `q${q}`, name: `q${q}` });
  dfa.startId = `q${m.start}`;
  dfa.accepts = [...m.accept].map(q => `q${q}`);
  for (const [q, out] of m.delta) for (const [a, to] of out) dfa.transitions.push({ id: `t${q}${a}`, from: `q${q}`, to: `q${to}`, symbol: a });
  for (const s of samples) assert.equal(acc(dfa, s.word), s.accept);
  assert.equal(same(dfa, target), true);
  assert.throws(() => rpni([{ word: ['a'], accept: true }, { word: ['a'], accept: false }]), /both accept and reject/);
});

test('L* learns the minimal DFA from a machine', async () => {
  const target = minimize(fromRegex('(a|b)*abb'));
  const member = async ws => ws.map(w => acc(target, w));
  const equivalent = async h => {
    for (const w of words(['a', 'b'], 8)) if (accepts(h, w) !== acc(target, w)) return w;
    return null;
  };
  const { dfa } = await lstar(['a', 'b'], member, equivalent);
  assert.equal(dfa.states, 4);
});

test('shrinking finds a minimal disagreement', () => {
  const disagrees = w => w.filter(x => x === 'b').length >= 2;
  assert.deepEqual(shrink(['a', 'b', 'a', 'a', 'b', 'a'], disagrees, ['a', 'b']), ['b', 'b']);
});

test('tm-normalize identifies mirror images and renamings', () => {
  assert.equal(normalizeStandard('1LB1RB_1RA1LZ'), normalizeStandard('1RB1LB_1LA1RZ'));
  assert.equal(normalizeStandard('1RC1LC_------_1LA1RZ', { prune: true }), '1RB1LB_1LA1RZ');
});

// ── Encoders ──────────────────────────────────────────────────────

test('PNG decodes back to the pixels', () => {
  const img = new Indexed(5, 3, TAPE_PALETTE).fill(0);
  img.set(1, 1, 3); img.set(4, 2, 10);
  const png = encodePNG(img);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // Walk the chunks, inflate IDAT, strip filter bytes.
  let o = 8, idat = [];
  while (o < png.length) {
    const len = png.readUInt32BE(o), type = png.toString('ascii', o + 4, o + 8);
    if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = [];
  for (let y = 0; y < 3; y++) px.push(...raw.subarray(y * 6 + 1, y * 6 + 6));
  assert.deepEqual(px, [...img.px]);
});

/** A small GIF decoder, independent of the encoder, for the round trip. */
function decodeGIF(buf) {
  let o = 6;
  const w = buf.readUInt16LE(o), h = buf.readUInt16LE(o + 2);
  const flags = buf[o + 4];
  o += 7;
  if (flags & 0x80) o += 3 * (1 << ((flags & 7) + 1));
  const frames = [];
  while (o < buf.length) {
    const b = buf[o++];
    if (b === 0x3b) break;
    if (b === 0x21) { o++; while (buf[o]) o += buf[o] + 1; o++; continue; }
    if (b === 0x2c) {
      o += 9;
      const min = buf[o++];
      const data = [];
      while (buf[o]) { data.push(...buf.subarray(o + 1, o + 1 + buf[o])); o += buf[o] + 1; }
      o++;
      frames.push(lzwDecode(data, min, w * h));
    }
  }
  return { w, h, frames };
}

function lzwDecode(data, min, count) {
  const clear = 1 << min, eoi = clear + 1;
  let size = min + 1, dict, prev = null;
  const out = [];
  const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = []; dict[eoi] = []; size = min + 1; prev = null; };
  reset();
  let bit = 0;
  const read = () => {
    let v = 0;
    for (let i = 0; i < size; i++, bit++) if (data[bit >> 3] & (1 << (bit & 7))) v |= 1 << i;
    return v;
  };
  while (out.length < count) {
    const code = read();
    if (code === clear) { reset(); continue; }
    if (code === eoi) break;
    let entry;
    if (code < dict.length) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error('bad LZW code');
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === (1 << size) && size < 12) size++;
  }
  return out.slice(0, count);
}

test('GIF frames decode back to the pixels, across dictionary resets', () => {
  // Large, noisy frames force the 4096-entry dictionary to fill and clear.
  let s = 1;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const frames = [0, 1, 2].map(() => {
    const f = new Indexed(120, 90, TAPE_PALETTE);
    for (let i = 0; i < f.px.length; i++) f.px[i] = Math.floor(rnd() * 11);
    return f;
  });
  const gif = encodeGIF(frames, { delay: 5 });
  const back = decodeGIF(gif);
  assert.equal(back.frames.length, 3);
  back.frames.forEach((px, i) => assert.deepEqual(px, [...frames[i].px], `frame ${i}`));
});

test('articles follow how a machine type is said', async () => {
  const { aMachine } = await import('../cli/grammar.mjs');
  assert.deepEqual(['DFA', 'NFA', 'MTM', 'Mealy', 'FST', '2PDA', 'ε-NFA'].map(t => aMachine(t)), ['a DFA', 'an NFA', 'an MTM', 'a Mealy', 'an FST', 'a 2PDA', 'an ε-NFA']);
});

test('BA export of a finite automaton warns that BA tools read Büchi', () => {
  const said = [];
  baText(ex('dfa'), { warn: m => said.push(m) });
  assert.match(said[0] || '', /Büchi/);
});

test('each symbol keeps one colour, and the blank is the faint one', async () => {
  const { symbolColour, PALETTE } = await import('../cli/out.mjs');
  const alphabet = ['0', '1', '+'];
  assert.equal(symbolColour('1', alphabet), symbolColour('1', alphabet));
  assert.notEqual(symbolColour('0', alphabet), symbolColour('1', alphabet));
  assert.equal(symbolColour('⊔', alphabet), PALETTE.faint);
  assert.equal(symbolColour('', alphabet), PALETTE.faint);
});
