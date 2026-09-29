// The automata command, run as a process: exit codes, pipes, --json, and the
// commands whose value is what they do to files. The engine underneath is
// tested in process by cli-engine.test.js and cli-provers.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = new URL('../cli/automata.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const tmp = mkdtempSync(join(tmpdir(), 'automata-cli-'));

function cli(args, { input = '', env = {} } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, input, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ...env }, timeout: 120000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('help, version, and a mistyped command', () => {
  const h = cli(['--help']);
  assert.equal(h.code, 0);
  assert.match(h.out, /Usage: automata <command>/);
  assert.match(cli(['--version']).out, /^\d+\.\d+\.\d+/);
  const bad = cli(['rnu', 'x']);
  assert.equal(bad.code, 3);
  assert.match(bad.err, /Did you mean "run"/);
  assert.match(cli(['run', '--help']).out, /Usage: automata run/);
});

test('run exits with the verdict: 0 accept, 1 reject, 2 unknown, 3 unreadable', () => {
  assert.equal(cli(['run', 'js/examples/dfa.json', '0']).code, 0);
  assert.equal(cli(['run', 'js/examples/dfa.json', '1']).code, 1);
  // A Turing machine that runs right forever: no verdict inside the budget.
  assert.equal(cli(['run', '1RB---_0RA---', '', '--max-steps', '50']).code, 2);
  assert.equal(cli(['run', 'js/examples/dfa.json', 'xyz']).code, 3);
  assert.equal(cli(['run', 'missing.automaton', '0']).code, 3);
  const j = JSON.parse(cli(['run', 'js/examples/dfa.json', '0', '1', '--json']).out);
  assert.deepEqual(j.map(r => r.verdict), ['acc', 'rej']);
});

test('test reads expectations and exits with the worst outcome', () => {
  const pass = join(tmp, 'pass.txt'), fail = join(tmp, 'fail.txt');
  writeFileSync(pass, '# multiples of five\n0 => accept\n101 => accept\n11 => reject\n');
  writeFileSync(fail, '11 => accept\n');
  assert.equal(cli(['test', 'js/examples/dfa.json', pass]).code, 0);
  const r = cli(['test', 'js/examples/dfa.json', fail, '--json']);
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.out).summary.fail, 1);
});

test('machines travel down a pipe', () => {
  const nfa = cli(['from-regex', '(a|b)*abb']);
  const min = cli(['minimize', '-'], { input: nfa.out });
  const info = JSON.parse(cli(['info', '-', '--json'], { input: min.out }).out);
  assert.equal(info.type, 'DFA');
  assert.equal(info.states, 4);
  assert.equal(info.minimal, true);
  const hoa = cli(['convert', 'js/examples/buchi.json', '--to', 'hoa']);
  assert.match(hoa.out, /^HOA: v1/);
  const back = cli(['equiv', '-', 'js/examples/buchi.json'], { input: hoa.out });
  assert.equal(back.code, 0);
});

test('equiv, diff and eval answer with exit codes', () => {
  assert.equal(cli(['equiv', 'js/examples/nfa.json', 'js/examples/nfa.json']).code, 0);
  const d = cli(['equiv', 'js/examples/nfa.json', 'js/examples/nfa-classic.json']);
  assert.equal(d.code, 1);
  assert.match(d.out, /different/);
  assert.equal(cli(['eval', '/a*/ <= /(a|b)*/']).code, 0);
  assert.equal(cli(['eval', '/(a|b)*/ <= /a*/']).code, 1);
  const text = cli(['diff', '--textconv', 'js/examples/dfa.json']);
  assert.match(text.out, /^machine DFA/);
});

test('lint exits 1 on a finding and 0 on a clean machine', () => {
  assert.equal(cli(['lint', 'js/examples/dfa.json']).code, 0);
  const doc = JSON.parse(readFileSync(join(ROOT, 'js/examples/dfa.json'), 'utf8'));
  doc.states.push({ id: 'lost', name: 'lost', x: 0, y: 0 });
  const f = join(tmp, 'lost.json');
  writeFileSync(f, JSON.stringify(doc));
  const r = cli(['lint', f, '--json']);
  assert.equal(r.code, 1);
  assert.ok(JSON.parse(r.out).findings.some(x => x.rule === 'unreachable'));
});

test('halts reads a list, names a typo\'s fix, and writes proofs that check', () => {
  const list = join(tmp, 'list.txt');
  writeFileSync(list, 'RB1LB_1LA1RZ\n1RB1LB_1LA1RZ\n1RB---_0RA---\n');
  const r = cli(['halts', list, '--workers', '1']);
  assert.equal(r.code, 3);
  assert.match(r.out, /did you mean 1RB1LB_1LA1RZ/);
  writeFileSync(list, '1RB1LB_1LA1RZ\n1RB---_0RA---\n1RB0LB_1LC1RB_---1LA\n');
  const dir = join(tmp, 'proofs');
  const ok = cli(['halts', list, '--workers', '2', '--proof', dir, '--json']);
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual(JSON.parse(ok.out).map(x => x.verdict), ['halts', 'never', 'never']);
  assert.equal(readdirSync(dir).length, 3);
  assert.equal(cli(['check-proof', dir]).code, 0);
});

test('bb-search reproduces BB(2)', () => {
  const r = JSON.parse(cli(['bb-search', '-n', '2', '--json']).out);
  assert.equal(r.champion.steps, 6);
  assert.equal(r.onesChampion.ones, 4);
  assert.equal(r.holdouts.length, 0);
});

test('generate writes exercises the grader marks correct against their keys', () => {
  const dir = join(tmp, 'ex');
  assert.equal(cli(['generate', '--states', '3', '--count', '2', '--seed', '9', '-o', dir]).code, 0);
  const ex = JSON.parse(readFileSync(join(dir, 'exercise-1.automaton'), 'utf8'));
  assert.ok(ex.exercise && ex.states.length === 0, 'a student gets a blank canvas');
  const csv = join(tmp, 'grades.csv');
  const r = cli(['grade', join(dir, 'exercise-1.automaton'), join(dir, 'key-1.automaton'), join(dir, 'key-2.automaton'), '--csv', csv]);
  assert.equal(r.code, 1, 'key-2 answers a different exercise');
  const rows = readFileSync(csv, 'utf8').trim().split('\n');
  assert.match(rows[1], /,correct,exact,1,/);
  assert.match(rows[2], /,incorrect,exact,0,/);
});

test('learn recovers the DFA from its own words', () => {
  const words = cli(['words', 'js/examples/dfa.json', '--max-len', '7', '--limit', '1000']).out.trim().split('\n').map(w => `${w} => accept`);
  const rej = cli(['words', 'js/examples/dfa.json', '--rejected', '--max-len', '7', '--limit', '1000']).out.trim().split('\n').map(w => `${w} => reject`);
  const f = join(tmp, 'samples.txt');
  writeFileSync(f, [...words, ...rej].join('\n'));
  const learned = cli(['learn', '--from', f]);
  assert.equal(cli(['equiv', '-', 'js/examples/dfa.json'], { input: learned.out }).code, 0);
});

test('codegen, svg and animate write what they say', () => {
  assert.match(cli(['codegen', 'js/examples/dfa.json', '--lang', 'py']).out, /def accepts/);
  assert.match(cli(['svg', 'js/examples/dfa.json']).out, /^<svg[^>]*><style>/);
  assert.match(cli(['animate', 'js/examples/dfa.json', '101']).out, /@keyframes/);
  const gif = join(tmp, 'run.gif');
  assert.equal(cli(['animate', '1RB1LB_1LA1RZ', '', '--gif', '-o', gif]).code, 0);
  assert.equal(readFileSync(gif).subarray(0, 6).toString(), 'GIF89a');
});

test('mcp answers a session over stdio', () => {
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'decide', arguments: { machine: 'js/examples/dfa.json', words: ['0', '1'] } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'info', arguments: { machine: 'nope.automaton' } } }
  ].map(m => JSON.stringify(m)).join('\n') + '\n';
  const r = cli(['mcp'], { input: lines });
  const msgs = r.out.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(msgs.length, 4, 'a notification gets no reply');
  assert.equal(msgs[0].result.serverInfo.name, 'automata');
  assert.ok(msgs[1].result.tools.some(t => t.name === 'halts'));
  assert.deepEqual(JSON.parse(msgs[2].result.content[0].text).map(x => x.verdict), ['accept', 'reject']);
  assert.equal(msgs[3].result.isError, true);
});

test('library reads a local checkout', { skip: !existsSync(join(ROOT, '..', 'automata-library', '_site', 'index.json')) && 'no built local library' }, () => {
  const r = cli(['library', 'search', 'dfa', '--json', '--library', join(ROOT, '..', 'automata-library')]);
  assert.equal(r.code, 0);
  assert.ok(JSON.parse(r.out).length > 0);
});

// ── Regressions from running every command by hand ────────────────

test('a run that halts exactly at the limit was not cut short', () => {
  const t = cli(['trace', '1RB1LB_1LA1RZ', '', '--limit', '6']);
  assert.equal(t.code, 0);
  assert.doesNotMatch(t.out, /stopped after/);
  const cut = cli(['trace', '1RB1LB_1LA1RZ', '', '--limit', '3']);
  assert.equal(cut.code, 2);
  assert.match(cut.out, /stopped after 3 steps/);
});

test('a transducer that finishes is done, and a proven loop is a reject', () => {
  const m = cli(['trace', 'js/examples/mealy.json', '01 11']);
  assert.equal(m.code, 0);
  assert.match(m.out, /\ndone\n?$/);
  const loop = cli(['trace', '1RB1RB_1LA1LA', '']);
  assert.equal(loop.code, 1);
  assert.match(loop.out, /reject \(it loops/);
});

test('trace shows a PDT\'s real output, both stacks of a 2PDA, and an EPDA\'s whole store', () => {
  assert.match(cli(['trace', 'js/examples/pdt.json', 'ab']).out, /out ba\n/);
  assert.doesNotMatch(cli(['trace', 'js/examples/pdt.json', 'ab']).out, /λ/);
  assert.match(cli(['trace', 'js/examples/twopda.json', 'aabb', '--limit', '3']).out, /stack₂ ZB/);
  assert.match(cli(['trace', 'js/examples/epda.json', 'abc', '--limit', '1']).out, /stacks \[E\]\[D\]\[ZA\]/);
});

test('info and lint know a PDA that accepts by empty stack', () => {
  assert.equal(cli(['lint', 'js/examples/pda.json']).code, 0);
  assert.equal(cli(['lint', 'js/examples/queue.json']).code, 0);
  assert.equal(JSON.parse(cli(['info', 'js/examples/pda.json', '--json']).out).acceptance, 'empty store');
  assert.deepEqual(Object.values(JSON.parse(cli(['info', 'js/examples/dpa.json', '--json']).out).priorities).sort(), [1, 2]);
});

test('words and profile refuse what they cannot answer, and say why', () => {
  const w = cli(['words', 'js/examples/mealy.json']);
  assert.equal(w.code, 3);
  assert.match(w.err, /a Mealy has no accept\/reject verdict/i);
  const p = cli(['profile', 'js/examples/tm.json', '--family', 'a^n b^n', '--to', '3']);
  assert.equal(p.code, 3);
  assert.match(p.err, /No input could be measured/);
});

test('two transducers are compared on their outputs, and the witness agrees', () => {
  const r = cli(['equiv', 'js/examples/mealy.json', 'js/examples/mealy-classic.json']);
  assert.equal(r.code, 1);
  assert.match(r.out, /mealy\.json outputs 0, .*mealy-classic\.json cannot read the whole word/);
});

test('a refused code target fails instead of writing a comment file', () => {
  const r = cli(['codegen', 'js/examples/nfa.json', '--lang', 'c']);
  assert.equal(r.code, 3);
  assert.equal(r.out, '');
  assert.match(r.err, /deterministic finite automata only/);
  assert.match(cli(['codegen', 'js/examples/nfa.json', '--lang', 'xstate']).err, /automata determinize/);
  assert.equal(cli(['export', 'js/examples/dfa.json', '-f', 'batch']).code, 3);
  assert.match(cli(['export', 'js/examples/dfa.json', '-f', 'json']).out, /"format": "automata-studio\/workspace"/);
  assert.doesNotMatch(cli(['export', '--list']).out, /^batch\b/m);
});

test('from-regex reads what to-regex writes', () => {
  const re = cli(['to-regex', 'js/examples/dfa.json']).out.trim();
  const back = cli(['from-regex', re, '--sigma', '01']);
  assert.equal(cli(['equiv', '-', 'js/examples/dfa.json'], { input: back.out }).code, 0);
  assert.match(cli(['to-regex', 'js/examples/enfa.json']).err, /also uses as an operator/);
});

test('svg labels a Turing machine\'s edges; the contact sheet\'s captions do not collide', () => {
  const svg = cli(['svg', 'js/examples/tm.json']).out;
  assert.match(svg, /<tspan[^>]*>0 → 0, R<\/tspan>/);
  const sheet = cli(['sheet', '1RB1LB_1LA1RZ', '1RB---_0RA---', '--steps', '200']).out;
  assert.match(sheet, /steps · \d+ cells<\/text>/);
  assert.doesNotMatch(sheet, /text-anchor="end">[\d,]+ steps/);
});

test('generate takes a regex\'s own alphabet, and refuses Σ*', () => {
  assert.equal(cli(['generate', '--from-regex', 'a*|b*|(a|b)*', '-o', join(tmp, 'g1')]).code, 3);
  assert.equal(cli(['generate', '--from-regex', '(ab)*', '-o', join(tmp, 'g2')]).code, 0);
  assert.match(readFileSync(join(tmp, 'g2', 'exercise-1.automaton'), 'utf8'), /over \{a, b\}/);
});

test('empty input and a directory are named for what they are', () => {
  assert.match(cli(['run', '-', '0']).err, /is empty/);
  assert.match(cli(['info', 'js/examples']).err, /is a directory/);
  assert.match(cli(['halts', 'js/examples/mtm.json']).out, /an MTM/);
});
