import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';
import { layoutNoteMarkdown, noteNaturalWidth } from '../js/canvas/note-layout.js';

// A note's Markdown laid out as SVG-drawable lines: a monospace grid, so a
// table is box-drawing characters and stays text the PNG export and the glyph
// outlines both handle.

const plain = lines => lines.map(line => line.map(r => r.text).join(''));

const TABLE = [
  '| state | status |',
  '|:---|---:|',
  '| NEW | `OPEN` |',
  '| INTAKE_REVIEW | *x* |'
].join('\n');

test('a table is drawn as a grid, its header bold and its alignment honoured', () => {
  const lines = layoutNoteMarkdown(TABLE, 60);
  assert.deepEqual(plain(lines), [
    '┌───────────────┬────────┐',
    '│ state         │ status │',
    '├───────────────┼────────┤',
    '│ NEW           │   OPEN │',
    '│ INTAKE_REVIEW │      x │',
    '└───────────────┴────────┘'
  ]);
  const header = lines[1].filter(r => r.text.trim() && !r.rule);
  assert.ok(header.every(r => r.bold), 'the header is bold');
  assert.ok(lines[3].some(r => r.code && r.text === 'OPEN'), 'a cell keeps its inline styles');
  assert.ok(lines[0].every(r => r.rule), 'borders are drawing, not text');
});

test('a table wider than the note shares the room and wraps its cells', () => {
  const lines = plain(layoutNoteMarkdown('| a | a long cell that has to wrap |\n|---|---|\n| b | c |', 24));
  assert.ok(lines.every(line => [...line].length <= 24), lines.join('\n'));
  assert.equal(lines[1].slice(0, 5), '│ a │', 'a short column keeps the width it needs');
  assert.ok(lines.length > 5, 'the long cell wraps onto more lines');
});

test('too many columns for a grid, and the rows are written out instead', () => {
  const wide = '| a | b | c | d | e | f |\n|---|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 | 6 |';
  assert.deepEqual(plain(layoutNoteMarkdown(wide, 20)), ['a · b · c · d · e ·', 'f', '1 · 2 · 3 · 4 · 5 ·', '6']);
});

test('lists hang their markers, nest, and keep their numbering', () => {
  const lines = plain(layoutNoteMarkdown('- one\n- two words that wrap\n  3. nested\n  4. again', 16));
  assert.deepEqual(lines, ['• one', '• two words that', '  wrap', '  3. nested', '  4. again']);
});

test('quotes, code blocks and rules', () => {
  assert.deepEqual(plain(layoutNoteMarkdown('> quoted', 20)), ['│ quoted']);
  assert.deepEqual(plain(layoutNoteMarkdown('```\na*b* `x`\n```', 20)), ['a*b* `x`']);
  assert.ok(layoutNoteMarkdown('```\nraw\n```', 20)[0][0].code);
  assert.deepEqual(plain(layoutNoteMarkdown('---', 8)), ['────────']);
});

test('every line the author ended stays a line, and blank lines are kept', () => {
  assert.deepEqual(plain(layoutNoteMarkdown('one\ntwo\n\n\nthree', 20)), ['one', 'two', '', '', 'three']);
});

test('an auto-sized note widens for a table, and only for one', () => {
  const { context } = createHarness();
  const narrow = context.noteBoxLayout({ text: 'just a sentence of text', x: 0, y: 0 });
  assert.equal(narrow.w, context.NOTE_WIDTH);
  const wide = context.noteBoxLayout({ text: TABLE, x: 0, y: 0 });
  assert.equal(noteNaturalWidth(TABLE), 26);
  assert.ok(wide.w > context.NOTE_WIDTH, `${wide.w}`);
  assert.equal(context.noteCharsPerLine(wide.w), 26, 'exactly as wide as the table needs');
  const huge = context.noteBoxLayout({ text: `| ${'x'.repeat(400)} |\n|---|\n| y |`, x: 0, y: 0 });
  assert.equal(huge.w, context.noteWidthForChars(context.noteCharsPerLine(context.NOTE_MAX_W)), 'never past the maximum');
});
