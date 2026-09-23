import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { context, resetApp } from './harness.js';
import { RegexError, parseLexerRegex } from '../js/lexer/regex.js';
import {
  DEFAULT_LEXER_RULES, DEFAULT_LEXER_SAMPLE, buildLexer, lexerToMachine, normalizeLexerDoc, runLexer
} from '../js/lexer/build.js';
import { emitLexerC, emitLexerJS, emitLexerPython } from '../js/lexer/emit.js';
import { withMachine } from '../js/exercise/grade.js';

const INPUTS = [
  DEFAULT_LEXER_SAMPLE,
  'ifx if else elsewhere',
  'x = "a \\" quote"\n  # comment\ny >= 10.25',
  '',
  'a ! b',          // '!' alone is no token
  'naïve'            // outside the universe
];

const visible = r => r.tokens.filter(t => !t.skip).map(({ type, text, line, col }) => ({ type, text, line, col }));

function have(cmd, args) {
  try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; }
}

// ── the pattern language ──────────────────────────────────────────

test('patterns refuse what a lexer cannot mean, and say where', () => {
  const cases = [
    ['^abc', /anchors/],
    ['a*?', /lazy/],
    ['(a)\\1', /backreferences/],
    ['\\q', /unknown escape/],
    ['(ab', /expected '\)'/],
    ['ab)', /unmatched/],
    ['[z-a]', /backwards/],
    ['*a', /nothing before/],
    ['(?=a)', /lookaround/]
  ];
  for (const [src, msg] of cases) {
    assert.throws(() => parseLexerRegex(src), e => e instanceof RegexError && msg.test(e.message), src);
  }
});

test('escapes, classes and counted repetition parse to the characters they name', () => {
  const lx = buildLexer('A \\x41\\u0042[\\d_]{2}\\.\nB [^\\n]');
  assert.ok(lx.ok, JSON.stringify(lx.diagnostics));
  assert.deepEqual(visible(runLexer(lx, 'AB1_.')).map(t => t.type), ['A']);
  assert.deepEqual(visible(runLexer(lx, 'AB12')).map(t => t.type), ['B', 'B', 'B', 'B']);
});

// ── the semantics of a lexer ──────────────────────────────────────

test('the longest match wins, and a tie goes to the rule listed first', () => {
  const lx = buildLexer(DEFAULT_LEXER_RULES);
  assert.ok(lx.ok);
  const toks = visible(runLexer(lx, 'if ifx else elsewhere >= ='));
  assert.deepEqual(toks.map(t => `${t.type}:${t.text}`), [
    'IF:if', 'IDENT:ifx', 'ELSE:else', 'IDENT:elsewhere', 'OP:>=', 'OP:='
  ]);
});

test('positions count lines and columns, and an unmatched character stops the lexer there', () => {
  const lx = buildLexer(DEFAULT_LEXER_RULES);
  const r = runLexer(lx, 'a\n  b ?');
  assert.deepEqual(visible(r).map(t => [t.text, t.line, t.col]), [['a', 1, 1], ['b', 2, 3]]);
  assert.deepEqual({ line: r.error.line, col: r.error.col, char: r.error.char }, { line: 2, col: 5, char: '?' });
});

test('a rule that matches the empty string is refused, not warned about', () => {
  const lx = buildLexer('WS [ ]*\nX x');
  assert.equal(lx.ok, false);
  assert.match(lx.diagnostics[0].message, /empty string/);
  assert.equal(lx.diagnostics[0].line, 1);
});

test('a rule every match of which is claimed by an earlier one is reported as dead', () => {
  const lx = buildLexer('IDENT [a-z]+\nIF if');
  assert.ok(lx.ok);
  const w = lx.diagnostics.find(d => d.level === 'warning');
  assert.match(w.message, /IF can never be produced.*IDENT/);
  assert.equal(w.line, 2);
});

test('characters no pattern tells apart share one class', () => {
  const lx = buildLexer('ID [a-z]+\nNUM [0-9]+');
  // a-z, 0-9, and nothing else is readable.
  assert.equal(lx.nClasses, 2);
  assert.ok(lx.nStates <= 3, `minimal DFA, got ${lx.nStates} states`);
});

test('class labels are symbols Σ can hold: unique, no whitespace, no commas', () => {
  const lx = buildLexer(DEFAULT_LEXER_RULES + '\nCOMMA ,\nSEMI ;');
  assert.ok(lx.ok);
  assert.equal(new Set(lx.labels).size, lx.labels.length);
  lx.labels.forEach(l => assert.ok(!/[\s,]/.test(l), `label ${JSON.stringify(l)}`));
});

// ── the generated code is the same lexer ──────────────────────────

test('the generated JavaScript produces the in-app token stream, errors included', () => {
  const lx = buildLexer(DEFAULT_LEXER_RULES);
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(emitLexerJS(lx), sandbox);
  const { tokenize, LexError } = sandbox.module.exports;
  for (const input of INPUTS) {
    const ours = runLexer(lx, input);
    if (ours.error) {
      assert.throws(() => tokenize(input), e => e instanceof LexError && e.line === ours.error.line && e.col === ours.error.col, input);
      continue;
    }
    assert.deepEqual(JSON.parse(JSON.stringify(tokenize(input))), visible(ours), input);
  }
});

test('the generated Python produces the same token stream', { skip: !have('python3', ['--version']) && 'no python3' }, () => {
  const lx = buildLexer(DEFAULT_LEXER_RULES);
  const dir = mkdtempSync(join(tmpdir(), 'lexer-py-'));
  try {
    writeFileSync(join(dir, 'lexer.py'), emitLexerPython(lx));
    for (const input of INPUTS.filter(i => !runLexer(lx, i).error)) {
      const out = execFileSync('python3', [join(dir, 'lexer.py')], { input, encoding: 'utf8' });
      const toks = out.trim() ? out.trim().split('\n').map(l => JSON.parse(l)) : [];
      assert.deepEqual(toks, visible(runLexer(lx, input)), input);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the generated C produces the same token stream', { skip: !have('cc', ['--version']) && 'no C compiler' }, () => {
  const lx = buildLexer(DEFAULT_LEXER_RULES);
  const dir = mkdtempSync(join(tmpdir(), 'lexer-c-'));
  try {
    writeFileSync(join(dir, 'lexer.c'), emitLexerC(lx));
    execFileSync('cc', ['-std=c99', '-Wall', '-Werror', '-DLEXER_MAIN', '-o', join(dir, 'lexer'), join(dir, 'lexer.c')]);
    for (const input of INPUTS.filter(i => !runLexer(lx, i).error)) {
      const out = execFileSync(join(dir, 'lexer'), [], { input, encoding: 'utf8' });
      const expected = visible(runLexer(lx, input)).map(t => `${t.line}:${t.col} ${t.type} ${t.text}`);
      assert.deepEqual(out.trim() ? out.trim().split('\n') : [], expected, input);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the diagram ───────────────────────────────────────────────────

test('the DFA drawn on the canvas accepts exactly the single tokens', () => {
  resetApp();
  const lx = buildLexer(DEFAULT_LEXER_RULES);
  const m = { kind: 'machine', ...lexerToMachine(lx) };
  const labelOf = ch => lx.labels[lx.classOf.get(ch.codePointAt(0))];
  // Does the whole string drive the tables to an accepting state?
  const wholeToken = s => {
    let st = lx.start;
    for (const ch of s) {
      const k = lx.classOf.get(ch.codePointAt(0));
      if (k === undefined) return false;
      st = lx.trans[st * lx.nClasses + k];
      if (st < 0) return false;
    }
    return lx.accept[st] >= 0;
  };
  for (const s of ['if', 'ifx', '2.5', '2.', '"a"', '"', '>=', '=>', 'x1', '  ', '#c']) {
    const verdict = withMachine(m, () => context.decideWord('DFA', [...s].map(labelOf)).verdict);
    assert.equal(verdict === 'acc', wholeToken(s), s);
  }
  assert.ok(m.states.some(s => s.name === 'IF'), 'accepting states are named after their token');
});

test('the persisted shape is normalized', () => {
  assert.equal(normalizeLexerDoc(null), null);
  assert.deepEqual(normalizeLexerDoc({ rules: 'A a', sample: 'a', lang: 'cobol' }), { rules: 'A a', sample: 'a', lang: 'js' });
});
