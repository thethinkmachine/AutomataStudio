import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';
import { readdirSync, readFileSync } from 'node:fs';
import { markdownRuns } from '../js/markdown.js';
import { migrateLegacyNoteText, parseLegacyNoteRuns } from '../js/notes-legacy-markup.js';
import { insertTable, toggleInline, toggleList } from '../js/note-editor-text.js';

// ── A note is Markdown, with markdown-it's conventions (js/markdown.js) ──

const styled = runs => runs.map(r => `${['bold', 'italic', 'strike', 'code'].filter(s => r[s]).join('+')}[${r.text}]`).join(' ');

test('a note reads as Markdown: nested emphasis, strikethrough, code, and __ is bold', () => {
  const { context } = createHarness();
  const runs = context.markdownRuns('**bold *and italic*** ~~struck~~ `a*b*` __also bold__');
  assert.equal(styled(runs), 'bold[bold ] bold+italic[and italic] [ ] strike[struck] [ ] code[a*b*] [ ] bold[also bold]');
});

// ── The editor: the Markdown in a text box, the note beside it ──
// What is typed is saved as typed, and the preview is the canvas's own
// renderer. The toolbar's edits are pure functions of the text and selection
// (js/note-editor-text.js), tested without a DOM.

const apply = (text, edit) => text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
const selected = (text, edit) => apply(text, edit).slice(...edit.select);

test('bold wraps the selection, and the same button takes it away again', () => {
  const text = 'make this bold';
  const on = toggleInline(text, 5, 9, '**');
  assert.equal(apply(text, on), 'make **this** bold');
  assert.equal(selected(text, on), 'this', 'the word stays selected');
  const wrapped = apply(text, on);
  const off = toggleInline(wrapped, on.select[0], on.select[1], '**');
  assert.equal(apply(wrapped, off), text);
  const whole = toggleInline(wrapped, 5, 13, '**');
  assert.equal(apply(wrapped, whole), text, 'selecting the markers too unwraps');
});

test('a selection with spaces at its edges keeps them outside the markers', () => {
  const text = 'a word here';
  assert.equal(apply(text, toggleInline(text, 1, 7, '*')), 'a *word* here');
});

test('with nothing selected the markers go in with the caret between them', () => {
  const edit = toggleInline('ab', 1, 1, '`');
  assert.equal(apply('ab', edit), 'a``b');
  assert.deepEqual(edit.select, [2, 2]);
});

test('italic does not mistake bold for itself', () => {
  const text = '**bold**';
  assert.equal(apply(text, toggleInline(text, 2, 6, '*')), '***bold***');
});

test('lists mark every line the selection touches, and unmark them', () => {
  const text = 'one\ntwo\n\nthree';
  const bullets = toggleList(text, 0, text.length, 'bullet');
  assert.equal(apply(text, bullets), '- one\n- two\n\n- three');
  const back = apply(text, bullets);
  assert.equal(apply(back, toggleList(back, 0, back.length, 'bullet')), text);
  const numbered = toggleList(back, 0, back.length, 'numbered');
  assert.equal(apply(back, numbered), '1. one\n2. two\n\n3. three', 'a bullet list becomes a numbered one');
});

test('a table goes in on lines of its own, its first header selected', () => {
  const text = 'before\nafter';
  const edit = insertTable(text, 6, 6);
  assert.equal(apply(text, edit), 'before\n\n| Column | Column |\n| --- | --- |\n|  |  |\n\nafter');
  assert.equal(selected(text, edit), 'Column');
});

function fakeTextarea(el, value) {
  el.value = value;
  el.selectionStart = el.selectionEnd = 0;
  el.setSelectionRange = (a, b) => { el.selectionStart = a; el.selectionEnd = b; };
  el.setRangeText = (insert, a, b) => { el.value = el.value.slice(0, a) + insert + el.value.slice(b); };
  return el;
}

test('what is typed is what is saved: no escaping, no translation', () => {
  const { context, getElement } = createHarness();
  context.App.notes.push({ id: 'n1', text: '', color: 'yellow', x: 0, y: 0, anchorStates: [], anchorTransitions: [] });
  context.openNoteModal('n1');
  const editor = fakeTextarea(getElement('note-text'), '| a | b |\n|---|---|\n| `x` | a*b* |\r\nline');
  context.confirmNote();
  assert.equal(context.App.notes[0].text, '| a | b |\n|---|---|\n| `x` | a*b* |\nline');
  assert.equal(editor.value.includes('\r'), true, 'only the saved text is normalised');
});

test('Ctrl+B in the editor bolds the selection', () => {
  const { context, getElement } = createHarness();
  context.App.notes.push({ id: 'n1', text: '', color: 'yellow', x: 0, y: 0, anchorStates: [], anchorTransitions: [] });
  context.openNoteModal('n1');
  const editor = fakeTextarea(getElement('note-text'), 'a word');
  editor.setSelectionRange(2, 6);
  let prevented = false;
  context.handleNoteEditorKeydown({ key: 'b', ctrlKey: true, preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.ok(prevented);
  assert.equal(editor.value, 'a **word**');
});

test('the preview is the note drawn by the canvas renderer, from the draft', () => {
  const { context, getElement } = createHarness();
  context.App.notes.push({ id: 'n1', text: 'saved', color: 'yellow', x: 0, y: 0, anchorStates: [], anchorTransitions: [] });
  context.openNoteModal('n1');
  fakeTextarea(getElement('note-text'), 'draft **text**');
  context.renderNotePreview();
  const preview = getElement('note-preview');
  const svg = preview.children[0];
  assert.equal(String(svg.tagName).toLowerCase(), 'svg');
  const html = preview.innerHTML;
  assert.match(html, /note-g/, 'a note group, as on the canvas');
  assert.match(html, /draft/, 'from what is in the box, not what was saved');
  context.setNoteModalColor('green');
  assert.match(getElement('note-preview').innerHTML, /data-color="green"/, 'a colour shows at once');
  assert.equal(context.App.notes[0].text, 'saved', 'nothing is written until Save');
});

// ── Notes written before Markdown (schema 1 → 2) ──────────────────

test('an old note migrates to the Markdown that draws what it drew', () => {
  createHarness();
  const old = [
    'a*b* and (0|1)* stay literal',
    '**bold** *italic* __underline__ ***both***',
    'q_start to q_end, Σ*, x**y**z',
    '**unclosed and *also',
    '`ticks` ~~tildes~~ [x](y) &amp; $a_1$'
  ];
  for (const text of old) {
    const want = parseLegacyNoteRuns(text).map(r => ({ text: r.text, bold: r.bold || r.underline, italic: r.italic }));
    const got = markdownRuns(migrateLegacyNoteText(text));
    assert.equal(got.map(r => r.text).join(''), want.map(r => r.text).join(''), text);
    assert.equal(styled(got), styled(want.filter(r => r.text)), `${text} → ${migrateLegacyNoteText(text)}`);
  }
});

test('a schema 1 document has its notes migrated on the way in, once', () => {
  const { context } = createHarness();
  const doc = {
    format: context.WORKSPACE_FORMAT, schema: 1, machine: 'DFA',
    states: [], transitions: [], notes: [{ id: 'n1', text: 'a*b* __u__', x: 0, y: 0 }]
  };
  const migrated = context.migrateWorkspaceDoc(doc);
  assert.equal(migrated.schema, context.SCHEMA_VERSION);
  assert.equal(migrated.notes[0].text, 'a\\*b\\* **u**');
  assert.equal(context.migrateWorkspaceDoc(migrated).notes[0].text, 'a\\*b\\* **u**', 'idempotent');
});

test('every example note draws as it did before Markdown', () => {
  // The bundled examples carry no schema, so they are migrated as they load.
  createHarness();
  const dir = new URL('../js/examples/', import.meta.url);
  let seen = 0;
  for (const name of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const doc = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    for (const note of doc.notes || []) {
      for (const line of String(note.text || '').split('\n')) {
        const want = parseLegacyNoteRuns(line).map(r => ({ text: r.text, bold: r.bold || r.underline, italic: r.italic }));
        assert.equal(styled(markdownRuns(migrateLegacyNoteText(line))), styled(want.filter(r => r.text)), `${name}: ${line}`);
        seen++;
      }
    }
  }
  assert.ok(seen > 20, `${seen} example note lines`);
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
