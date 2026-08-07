import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

test('markdown is rendered inside the editor and serializes back losslessly', () => {
  const { context, getElement } = createHarness();
  const editor = getElement('note-text');
  context.setNoteEditorMarkdown(editor, '**important** and *italic*');
  assert.equal(context.noteEditorMarkdown(editor), '**important** and *italic*');
});

test('markdown parsing preserves automata notation that is not valid markup', () => {
  const { context, getElement } = createHarness();
  const runs = context.parseNoteRuns('**bold** a*b* Σ* q_start');
  assert.equal(runs.map(run => run.text).join(''), 'bold a*b* Σ* q_start');
  assert.equal(runs[0].bold, true);
});

test('markdown parsing preserves composite styles', () => {
  const { context } = createHarness();
  const runs = context.parseNoteRuns('**bold __underlined__** and __*two styles*__ plus ***bold italic***');
  assert.equal(runs.find(run => run.text === 'underlined').bold, true);
  assert.equal(runs.find(run => run.text === 'underlined').underline, true);
  const two = runs.find(run => run.text === 'two styles');
  assert.equal(two.italic, true);
  assert.equal(two.underline, true);
  const boldItalic = runs.find(run => run.text === 'bold italic');
  assert.equal(boldItalic.bold, true);
  assert.equal(boldItalic.italic, true);
});

test('cancelling a newly-created note removes it and its no-op undo entry', () => {
  const { context } = createHarness();
  const note = context.createNote(20, 30);
  assert.equal(context.App.notes.length, 1);
  assert.equal(context.App.history.length, 1);

  context.openNoteModal(note.id, { isNew: true });
  context.closeModal('note-modal');

  assert.equal(context.App.notes.length, 0);
  assert.equal(context.App.history.length, 0);
});

test('saving an unchanged existing note does not create an undo point', () => {
  const { context } = createHarness();
  context.App.notes.push({ id: 'n1', text: 'same', color: 'yellow', x: 0, y: 0, anchorStates: [], anchorTransitions: [] });

  context.openNoteModal('n1');
  context.confirmNote();

  assert.equal(context.App.history.length, 0);
  assert.equal(context.App.notes[0].text, 'same');
});
