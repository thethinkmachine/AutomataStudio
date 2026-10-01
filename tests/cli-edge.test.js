// The automata command against what it was not written for: JSON that is not
// a document, machines drawn with their own symbols, labels and state names
// that collide with a file format's syntax, numeric flags that are not
// numbers, very long words, oracles that hang or cannot be found, a shell
// that would expand a word's symbols, and an MCP client that sends the wrong
// arguments. Each case is one the edge-case pass found failing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../cli/automata.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'automata-edge-'));

function cli(args, { input = '' } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, input, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, timeout: 120000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const doc = (machine, sigma, states, transitions, startId, accepts, extra = {}) =>
  JSON.stringify({ format: 'automata-studio/workspace', schema: 1, machine, sigma, stackAlpha: [], outputAlpha: [], tapeCount: 1, blocks: [], states, transitions, startId, accepts, ...extra });

const TWO = [{ id: 'a', name: 'p', x: 0, y: 0 }, { id: 'b', name: 'q', x: 150, y: 0 }];

test('a JSON value that is not a document is named, not read as a machine of type undefined', () => {
  for (const text of ['{}', '[]', '42', 'null']) {
    const r = cli(['info', '-'], { input: text });
    assert.equal(r.code, 3, text);
    assert.doesNotMatch(r.err, /undefined|TypeError|at .*\.mjs/, text);
  }
  assert.match(cli(['info', '-'], { input: '{}' }).err, /no machine type/);
});

test('a machine drawn with its own ε and Σ symbols is the same machine as one with the defaults', () => {
  const custom = join(tmp, 'custom-sym.automaton'), plain = join(tmp, 'plain-sym.automaton');
  const edges = (eps, any) => [
    { id: 't1', from: 'a', to: 'b', symbol: eps },
    { id: 't2', from: 'b', to: 'b', symbol: any },
    { id: 't3', from: 'a', to: 'a', symbol: 'a' }
  ];
  const sym = { eps: 'e', any: '*', blank: '_', leftMarker: '<', rightMarker: '>', stackBottom: '$' };
  writeFileSync(custom, doc('ε-NFA', ['a', 'b'], TWO, edges('e', '*'), 'a', ['b'], { config: { sym } }));
  writeFileSync(plain, doc('ε-NFA', ['a', 'b'], TWO, edges('ε', 'Σ'), 'a', ['b']));
  assert.equal(cli(['equiv', custom, plain]).code, 0);
  // Through the machine code and back: the code is written in the document's own symbols.
  const code = cli(['convert', custom, '--to', 'code']).out.trim();
  assert.equal(cli(['equiv', custom, code]).code, 0);
});

test('BA carries labels with #, commas and brackets, and renames state names that would end a field', () => {
  const st = [{ id: 'a', name: 'q[0]', x: 0, y: 0 }, { id: 'b', name: 'q 1 -> x', x: 150, y: 0 }];
  const tr = [
    { id: 't1', from: 'a', to: 'b', symbol: '#x' },
    { id: 't2', from: 'b', to: 'a', symbol: 'a,b' },
    { id: 't3', from: 'b', to: 'b', symbol: '[y]' }
  ];
  const m = join(tmp, 'hostile.automaton');
  writeFileSync(m, doc('NBA', ['#x', 'a,b', '[y]'], st, tr, 'a', ['b']));
  const ba = cli(['convert', m, '--to', 'ba']);
  assert.equal(ba.code, 0, ba.err);
  assert.doesNotMatch(ba.out, /q\[0\]|q 1/, 'unsafe state names are renamed');
  const back = join(tmp, 'hostile.ba');
  writeFileSync(back, ba.out);
  assert.equal(cli(['equiv', m, back]).code, 0);
});

test('Timbuk refuses a symbol it cannot hold; HOA renames one and says so', () => {
  const m = join(tmp, 'syntax.automaton');
  writeFileSync(m, doc('NFA', ['a,b', 'c'], TWO, [{ id: 't1', from: 'a', to: 'b', symbol: 'a,b' }], 'a', ['b']));
  const tb = cli(['convert', m, '--to', 'timbuk']);
  assert.equal(tb.code, 3);
  assert.match(tb.err, /"a,b" cannot be written/);
  writeFileSync(m, doc('NBA', ['c d', 'e'], TWO, [{ id: 't1', from: 'a', to: 'b', symbol: 'c d' }, { id: 't2', from: 'b', to: 'b', symbol: 'e' }], 'a', ['b']));
  const hoa = cli(['convert', m, '--to', 'hoa']);
  assert.equal(hoa.code, 0);
  assert.match(hoa.err, /warning/);
  assert.equal(cli(['info', '-'], { input: hoa.out }).code, 0);
});

test('numeric flags are checked: a word, a fraction, zero and too much are refused by name', () => {
  const cases = [
    [['words', 'js/examples/dfa.json', '--limit', 'abc'], /--limit takes a number, not "abc"/],
    [['words', 'js/examples/dfa.json', '--limit', '0'], /--limit is at least 1/],
    [['words', 'js/examples/dfa.json', '--max-len', '99999'], /--max-len is at most/],
    [['halts', '1RB1LB_1LA---', '--budget', '2.5'], /--budget takes a whole number/],
    [['run', 'js/examples/dfa.json', '0', '--max-steps', 'lots'], /--max-steps takes a number/],
    [['bb-search', '--states', '2', '--workers', '0'], /--workers is at least 1/]
  ];
  for (const [args, want] of cases) {
    const r = cli(args);
    assert.equal(r.code, 3, args.join(' '));
    assert.match(r.err, want);
  }
  assert.equal(cli(['halts', '1RB1LB_1LA---', '--budget', '1e3']).code, 0, '1e3 is a whole number');
});

test('a long word is shortened in the table, with its length', () => {
  const file = join(tmp, 'long.txt');
  writeFileSync(file, '0'.repeat(5000) + ' => accept\n');
  const r = cli(['test', 'js/examples/dfa.json', file]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /…0{12} \(5,000 symbols\)/);
  assert.ok(r.out.length < 600);
});

test('info says why it has no minimal DFA when the subset construction is too large', () => {
  const nfa = cli(['from-regex', '(a|b)*a(a|b){12}']).out;
  const info = JSON.parse(cli(['info', '-', '--json'], { input: nfa }).out);
  assert.match(info.minimalDfaSkipped, /passed 4096 states/);
});

test('trace --json exits with the verdict, like the table does', () => {
  assert.equal(cli(['trace', 'js/examples/dfa.json', '0', '--json']).code, 0);
  assert.equal(cli(['trace', 'js/examples/dfa.json', '1', '--json']).code, 1);
  assert.equal(cli(['trace', 'js/examples/dfa.json', '1']).code, 1);
});

test('an oracle gets every word as itself, whatever the shell would make of its symbols', () => {
  // Σ* over symbols a shell expands, runs or splits on. The oracle accepts
  // exactly when the argument it got is the word it was sent, so a quoting
  // failure anywhere shows up as a disagreement.
  const syms = ['$', '&', '\\', '\'', '`', '%', '|', '<', '!', '^', ';', '*', '(', ' '];
  const m = join(tmp, 'shell-hostile.automaton');
  const loops = syms.filter(s => s !== ' ').map((s, i) => ({ id: `t${i}`, from: 'a', to: 'a', symbol: s }));
  writeFileSync(m, doc('DFA', syms.filter(s => s !== ' '), [TWO[0]], loops, 'a', ['a']));
  const check = join(tmp, 'echo-oracle.cjs');
  writeFileSync(check, 'process.exit(process.argv[2] === (process.env.AUTOMATA_WORD ?? "") && process.argv.length === 3 ? 0 : 1);\n');
  const r = cli(['fuzz', m, '--oracle', `node "${check}" {}`, '--count', '150', '--max-len', '6', '--seed', '7']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /agree on 150 words/);
});

test('an oracle that hangs, cannot be found or says nothing is reported as such, not as a reject', () => {
  const hang = join(tmp, 'hang.cjs'), mute = join(tmp, 'mute.cjs');
  writeFileSync(hang, 'setTimeout(Date.now, 20000);\n');
  writeFileSync(mute, 'process.exit(4);\n');
  const t = cli(['fuzz', 'js/examples/dfa.json', '--oracle', `node "${hang}"`, '--timeout', '300', '--count', '2']);
  assert.equal(t.code, 3);
  assert.match(t.err, /took longer than 300 ms on the empty word/);
  const n = cli(['fuzz', 'js/examples/dfa.json', '--oracle', 'definitely-not-a-program-xyz', '--count', '2']);
  assert.equal(n.code, 3);
  assert.match(n.err, /not found/);
  const s = cli(['fuzz', 'js/examples/dfa.json', '--oracle', `node "${mute}"`, '--mode', 'stdout', '--count', '2']);
  assert.equal(s.code, 3);
  assert.match(s.err, /printed nothing and exited 4/);
});

test('mcp checks a tool\'s arguments against its schema and survives malformed messages', () => {
  const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const lines = [
    call(1, 'decide', { machine: 'js/examples/dfa.json', words: '101' }),
    call(2, 'decide', { machine: 'js/examples/dfa.json' }),
    call(3, 'equiv', { a: 'js/examples/dfa.json', b: 'js/examples/dfa.json', 'max-length': 3 }),
    call(4, 'words', { machine: 'js/examples/dfa.json', max_length: 1e9 }),
    call(5, 'transform', { machine: 'js/examples/dfa.json', op: 'explode' }),
    call(6, 'toString', {}),
    null, [], 42,
    call(7, 'decide', { machine: 'js/examples/dfa.json', words: ['0'] })
  ].map(m => JSON.stringify(m)).join('\n') + '\n';
  const msgs = cli(['mcp'], { input: lines }).out.trim().split('\n').map(l => JSON.parse(l));
  const text = id => msgs.find(m => m.id === id).result.content[0].text;
  assert.match(text(1), /"words" should be a list of strings/);
  assert.match(text(2), /decide needs "words"/);
  assert.match(text(3), /no argument "max-length"; it takes .*"max_length"/);
  assert.match(text(4), /"max_length" is at most 64/);
  assert.match(text(5), /"op" is one of/);
  assert.equal(msgs.find(m => m.id === 6).error.code, -32602);
  assert.equal(msgs.filter(m => m.id === null && m.error?.code === -32600).length, 3);
  assert.equal(JSON.parse(text(7))[0].verdict, 'accept', 'the session goes on after the bad lines');
});
