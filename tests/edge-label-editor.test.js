import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.js';

// Editing a transition on its label — js/edge-label-editor.js — and the
// function it shares with the dialog, saveTransition().
//
// Pinned: the double-click is two presses (a browser never delivers the native
// dblclick to an edge, see edgeDoublePress in render.js), the row and the pill
// that were hit decide what is edited, the fields come from the machine's
// schema, a save is one undo point and an unchanged one is none, and the
// machine's own rules refuse what the dialog would refuse.

const harness = createHarness();
const { context } = harness;
const App = () => context.App;

const press = (node, extra = {}) => node._listeners.pointerdown({
  button: 0, pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0,
  preventDefault() {}, stopPropagation() {}, ...extra
});
const key = (k, target, extra = {}) => ({
  key: k, target, shiftKey: false, preventDefault() {}, stopPropagation() {}, ...extra
});

function tm() {
  harness.resetApp();
  context.applyMachineSwitch('TM');
  context.App.tool = 'pointer';
  context.App.sigma = new Set(['1', '2', '3']);
  context.App.stackAlpha = new Set(['1', '2', '3']);
  const a = context.createState(100, 100, 'A');
  const b = context.createState(300, 100, 'B');
  context.App.startId = a.id;
  const t1 = { id: 'tx1', from: a.id, to: b.id, symbol: '1', write: '1', dir: 'L' };
  const t2 = { id: 'tx2', from: a.id, to: b.id, symbol: '2', write: '3', dir: 'R' };
  context.App.transitions.push(t1, t2);
  context.renderAll();
  return { a: a.id, b: b.id, key: `${a.id}|${b.id}` };
}

function editorEl() {
  const input = context.edgeLabelEditorInput('on');
  let el = input;
  while (el && el.className !== 'ele') el = el.parentNode;
  return el;
}

// ── saveTransition ────────────────────────────────────────────────

test('saveTransition refuses what the machine refuses, and changes nothing', () => {
  const { a, b } = tm();
  const before = JSON.stringify(App().transitions);
  const depth = App().history.length;
  const r = context.saveTransition({ from: a, to: b, symbol: '2', write: '1', dir: 'L' }, 'tx1');
  assert.equal(r.ok, false);
  assert.match(r.error, /already has δ/);
  assert.equal(JSON.stringify(App().transitions), before);
  assert.equal(App().history.length, depth, 'no undo point for a refused edit');
});

test('saveTransition edits in place as one undo point, and adds with a fresh id', () => {
  const { a, b } = tm();
  const depth = App().history.length;
  const r = context.saveTransition({ from: a, to: b, symbol: '1', write: '2', dir: 'R' }, 'tx1');
  assert.deepEqual(r, { ok: true, id: 'tx1' });
  const t = App().transitions.find(x => x.id === 'tx1');
  assert.equal(t.write, '2');
  assert.equal(t.dir, 'R');
  assert.equal(App().history.length, depth + 1);

  const added = context.saveTransition({ from: b, to: a, symbol: '3', write: '3', dir: 'S' });
  assert.equal(added.ok, true);
  assert.notEqual(added.id, 'tx1');
  assert.ok(App().transitions.some(x => x.id === added.id && x.from === b));
});

test('saveTransition says when the transition it was editing is gone', () => {
  const { a, b } = tm();
  const r = context.saveTransition({ from: a, to: b, symbol: '1', write: '1', dir: 'L' }, 'nope');
  assert.equal(r.ok, false);
  assert.equal(r.gone, true);
});

// ── opening it ────────────────────────────────────────────────────

test('a double-click on a label row opens that row, focused on the pill that was hit', () => {
  const { key: k } = tm();
  const node = App().domCache.transitions.get(k);
  const { pillEl, textEl } = node.__parts;
  assert.equal(node._listeners.dblclick, undefined, 'nothing listens for the dblclick a browser never sends');

  const pillTarget = { closest: sel => sel === '[data-row]' ? { getAttribute: () => '1' } : { getAttribute: () => 'write' } };
  press(pillEl, { target: pillTarget });
  assert.equal(context.edgeLabelEditorState(), null, 'one press selects the edge');
  assert.ok(App().selectedTransitions.has('tx1') && App().selectedTransitions.has('tx2'));
  press(pillEl, { target: pillTarget });
  const st = context.edgeLabelEditorState();
  assert.ok(st, 'the second press opens the editor');
  assert.equal(st.tid, 'tx2');
  assert.deepEqual(st.fields, { on: '2', write: '3', move: 'R' });
  assert.equal(st.rows, 2);
  context.closeEdgeLabelEditor();

  // The compact label is hit as one box, so the row is how far down it landed.
  press(textEl, { clientY: 10 });
  press(textEl, { clientY: 10 });
  assert.equal(context.edgeLabelEditorState().tid, 'tx1');
});

test('a press on a label selects its edge without starting a bend', () => {
  const { key: k } = tm();
  const node = App().domCache.transitions.get(k);
  press(node.__parts.textEl);
  assert.ok(App().selectedTransitions.has('tx1'));
  assert.ok(!App().dragCurve, 'the bend would snap the edge to the label on the first pixel of movement');
  node.__lastDownAt = 0;
  press(node);
  assert.ok(App().dragCurve, 'the line itself still bends');
});

test('only a plain Select-tool double press opens it', () => {
  const { key: k } = tm();
  const node = App().domCache.transitions.get(k);
  press(node, { shiftKey: true });
  press(node, { shiftKey: true });
  assert.equal(context.edgeLabelEditorState(), null, 'a modified press is multi-select');

  press(node, { pointerType: 'touch' });
  press(node, { pointerType: 'touch' });
  assert.equal(context.edgeLabelEditorState(), null, 'a touch double tap is not an edit');

  context.App.tool = 'del';
  const before = App().transitions.length;
  press(node.__parts.textEl);
  assert.equal(App().transitions.length, before - 2, 'with Delete, a press on the label is a press on the edge');
});

test('a double-click on the edge line opens the first row', () => {
  const { key: k } = tm();
  const node = App().domCache.transitions.get(k);
  press(node);
  press(node);
  assert.equal(context.edgeLabelEditorState().tid, 'tx1');
});

test('the fields are the machine\'s schema, in the label\'s order', () => {
  const cases = {
    DFA: ['on'],
    TM: ['on', 'write', 'move'],
    NPDA: ['on', 'pop', 'push'],
    '2PDA': ['on', 'pop', 'push', 'pop2', 'push2'],
    Mealy: ['on', 'out'],
    PFA: ['on', 'weight'],
    '2DFA': ['on', 'move'],
    EPDA: ['on', 'pop', 'push', 'below', 'above']
  };
  for (const [m, want] of Object.entries(cases)) {
    assert.deepEqual(context.labelEditorFields(m), want, m);
  }
});

// ── multi-tape ────────────────────────────────────────────────────

function mtm(tapes = 2) {
  harness.resetApp();
  context.applyMachineSwitch('MTM');
  context.App.tool = 'pointer';
  context.setTapeCount(tapes);
  context.App.sigma = new Set(['0', '1']);
  context.App.stackAlpha = new Set(['0', '1']);
  const a = context.createState(100, 100, 'A');
  const b = context.createState(300, 100, 'B');
  const B = context.App.config.sym.blank;
  context.App.transitions.push(
    { id: 'm1', from: a.id, to: b.id, symbol: '0', tapeSyms: ['0', B], tapeWrites: ['0', '0'], tapeDirs: ['R', 'R'] },
    { id: 'm2', from: a.id, to: b.id, symbol: '1', tapeSyms: ['1', B], tapeWrites: ['1', '1'], tapeDirs: ['R', 'S'] }
  );
  context.renderAll();
  return { key: `${a.id}|${b.id}`, B };
}

test('a multi-tape edge gets a read, a write and a move per tape', () => {
  const { key: k, B } = mtm(2);
  assert.deepEqual(context.labelEditorFields('MTM'),
    ['tapeSyms.0', 'tapeWrites.0', 'tapeDirs.0', 'tapeSyms.1', 'tapeWrites.1', 'tapeDirs.1']);
  assert.equal(context.openEdgeLabelEditor(k, { row: 1 }), true, 'inline, not the dialog');
  assert.deepEqual(context.edgeLabelEditorState().fields, {
    'tapeSyms.0': '1', 'tapeWrites.0': '1', 'tapeDirs.0': 'R',
    'tapeSyms.1': B, 'tapeWrites.1': '1', 'tapeDirs.1': 'S'
  });
});

test('a double-click on a tape\'s pill focuses that tape', () => {
  const { key: k } = mtm(2);
  const { pillEl } = App().domCache.transitions.get(k).__parts;
  const attrs = { 'data-row': '0', 'data-role': 'tape', 'data-part': '1' };
  const target = { closest: sel => ({ getAttribute: name => attrs[name] ?? null, sel }) };
  press(pillEl, { target });
  press(pillEl, { target });
  const st = context.edgeLabelEditorState();
  assert.equal(st.tid, 'm1');
  // The stub's focus() records nothing, so the field is asserted through the
  // function that picks it.
  assert.equal(context.edgeLabelEditorInput('tapeSyms.1').getAttribute('aria-label'), 'tape 2 read');
});

test('a per-tape edit saves the arrays as one undo point, through the read-tuple rule', () => {
  const { key: k, B } = mtm(2);
  context.openEdgeLabelEditor(k, { row: 0 });
  const depth = App().history.length;
  context.edgeLabelEditorInput('tapeWrites.1').value = '1';
  context.edgeLabelEditorInput('tapeDirs.1').value = 'L';
  assert.equal(context.commitEdgeLabelEditor(), true);
  const t = App().transitions.find(x => x.id === 'm1');
  assert.deepEqual(t.tapeSyms, ['0', B]);
  assert.deepEqual(t.tapeWrites, ['0', '1']);
  assert.deepEqual(t.tapeDirs, ['R', 'L']);
  assert.equal(t.symbol, '0');
  assert.equal(App().history.length, depth + 1);

  // Reading (1, ⊔) on row 0 is the tuple row 1 already reads.
  context.openEdgeLabelEditor(k, { row: 0 });
  context.edgeLabelEditorInput('tapeSyms.0').value = '1';
  assert.equal(context.commitEdgeLabelEditor(), false);
  assert.match(context.edgeLabelEditorState().error, /read tuple must be unique/);
  assert.deepEqual(App().transitions.find(x => x.id === 'm1').tapeSyms, ['0', B], 'a refusal leaves the arrays alone');

  context.edgeLabelEditorInput('tapeSyms.0').value = 'z';
  assert.equal(context.commitEdgeLabelEditor(), false);
  assert.match(context.edgeLabelEditorState().error, /'z' is not in Γ/);
});

test('adding a tape closes an open strip, whose fields no longer match', () => {
  const { key: k } = mtm(2);
  context.openEdgeLabelEditor(k);
  context.setTapeCount(3);
  assert.equal(context.edgeLabelEditorState(), null);
  context.openEdgeLabelEditor(k);
  assert.equal(Object.keys(context.edgeLabelEditorState().fields).length, 9, 'three tapes, three fields each');
});

// ── saving it ─────────────────────────────────────────────────────

test('Enter saves the row as one undo point', () => {
  const { key: k } = tm();
  context.openEdgeLabelEditor(k, { row: 0 });
  const depth = App().history.length;
  const write = context.edgeLabelEditorInput('write');
  write.value = '2';
  context.edgeLabelEditorInput('move').value = 'S';
  editorEl()._listeners.keydown(key('Enter', write));
  assert.equal(context.edgeLabelEditorState(), null, 'closed');
  const t = App().transitions.find(x => x.id === 'tx1');
  assert.equal(t.write, '2');
  assert.equal(t.dir, 'S');
  assert.equal(App().history.length, depth + 1);
  context.undo();
  const back = App().transitions.find(x => x.id === 'tx1');
  assert.equal(back.write, '1');
  assert.equal(back.dir, 'L');
});

test('Escape puts it back, and an unchanged Enter takes no undo point', () => {
  const { key: k } = tm();
  context.openEdgeLabelEditor(k);
  const write = context.edgeLabelEditorInput('write');
  write.value = '3';
  editorEl()._listeners.keydown(key('Escape', write));
  assert.equal(context.edgeLabelEditorState(), null);
  assert.equal(App().transitions.find(x => x.id === 'tx1').write, '1');

  context.openEdgeLabelEditor(k);
  const depth = App().history.length;
  editorEl()._listeners.keydown(key('Enter', context.edgeLabelEditorInput('on')));
  assert.equal(context.edgeLabelEditorState(), null);
  assert.equal(App().history.length, depth, 'nothing changed, so nothing to undo');
});

test('a refusal keeps the strip open with the reason, and changes nothing', () => {
  const { key: k } = tm();
  context.openEdgeLabelEditor(k, { row: 0 });
  const on = context.edgeLabelEditorInput('on');
  on.value = '2';
  assert.equal(context.commitEdgeLabelEditor(), false);
  assert.match(context.edgeLabelEditorState().error, /already has δ/, 'the determinism rule, as the dialog says it');
  on.value = 'z';
  assert.equal(context.commitEdgeLabelEditor(), false);
  assert.match(context.edgeLabelEditorState().error, /'z' is not in Γ/, 'a symbol the Read menu could not have held');
  assert.equal(App().transitions.find(x => x.id === 'tx1').symbol, '1');
});

test('the blank write and the eps spelling mean what they mean in the dialog', () => {
  harness.resetApp();
  context.applyMachineSwitch('NPDA');
  context.App.sigma = new Set(['a']);
  context.App.stackAlpha = new Set(['A']);
  const p = context.createState(100, 100, 'p');
  context.App.transitions.push({ id: 'p1', from: p.id, to: p.id, symbol: 'a', pop: 'Z', push: 'AZ' });
  context.renderAll();
  context.openEdgeLabelEditor(`${p.id}|${p.id}`);
  context.edgeLabelEditorInput('pop').value = 'eps';
  context.edgeLabelEditorInput('push').value = '';
  assert.equal(context.commitEdgeLabelEditor(), true);
  const t = App().transitions.find(x => x.id === 'p1');
  assert.equal(t.pop, App().config.sym.eps);
  assert.equal(t.push, App().config.sym.eps);
});

test('↓ saves and moves to the next row; the last row stays put', () => {
  const { key: k } = tm();
  context.openEdgeLabelEditor(k, { row: 0 });
  const write = context.edgeLabelEditorInput('write');
  write.value = '3';
  editorEl()._listeners.keydown(key('ArrowDown', write));
  assert.equal(App().transitions.find(x => x.id === 'tx1').write, '3', 'the row it left was saved');
  const st = context.edgeLabelEditorState();
  assert.equal(st.tid, 'tx2');
  assert.equal(st.row, 1);
  editorEl()._listeners.keydown(key('ArrowDown', context.edgeLabelEditorInput('write')));
  assert.equal(context.edgeLabelEditorState().row, 1);
});

test('an undo underneath the open strip closes it rather than saving into a stale object', () => {
  const { key: k } = tm();
  context.saveTransition({ ...App().transitions.find(x => x.id === 'tx1'), write: '2' }, 'tx1');
  context.openEdgeLabelEditor(k, { row: 0 });
  context.undo();
  assert.equal(context.edgeLabelEditorState(), null);
});

test('it opens where the label is not drawn, over the point the label would take', () => {
  const { key: k } = tm();
  context.App.config.edgeLabelStyle = 'none';
  context.renderAll();
  const a = context.edgeLabelAnchor(k);
  assert.ok(a, 'the edge is laid out');
  assert.equal(a.drawn, false);
  assert.equal(context.openEdgeLabelEditor(k), true);
  const el = editorEl();
  assert.equal(el.style.left, `${App().cam.x + a.x * App().cam.z}px`);
});

// ── every machine ─────────────────────────────────────────────────
//
// Walked off MachineTypes, against the bundled examples, so a machine added
// to the app is covered the day it has an example — and fails here until it
// does. DPDA has no example of its own: its examples are saved under the PDA
// alias, so those run as both.

const EXAMPLES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'examples');

function exampleRuns() {
  const runs = [];
  for (const file of fs.readdirSync(EXAMPLES_DIR).filter(f => f.endsWith('.json'))) {
    const data = JSON.parse(fs.readFileSync(path.join(EXAMPLES_DIR, file), 'utf8'));
    runs.push({ file, data, m: data.machine });
    if (data.machine === 'PDA') runs.push({ file: `${file} as DPDA`, data, m: 'DPDA' });
  }
  return runs;
}

function installRun({ data, m }, extraSymbols = []) {
  const d = JSON.parse(JSON.stringify(data));
  harness.resetApp();
  const A = context.App;
  A.machine = m;
  A.sigma = new Set([...(d.sigma || []), ...extraSymbols]);
  A.stackAlpha = new Set([...(d.stackAlpha || [A.config.sym.stackBottom]), ...extraSymbols]);
  A.outputAlpha = new Set(d.outputAlpha || []);
  if (d.tapeCount) A.tapeCount = d.tapeCount;
  if (d.config) A.config = { ...A.config, ...d.config, sym: { ...A.config.sym, ...(d.config.sym || {}) } };
  A.states = d.states;
  A.transitions = d.transitions;
  A.startId = d.startId;
  A.accepts = new Set(d.accepts || []);
  if (d.blocks) A.blocks = d.blocks;
  context.renderAll();
}

/** Opens the strip on `t`'s row of the edge it is drawn on, or returns false. */
function openOn(t) {
  const key = context.viewEdgeKeyFor(t.id);
  const group = key ? context.viewEdgeGroup(key) : null;
  if (!group) return false;
  return context.openEdgeLabelEditor(key, { row: group.findIndex(x => x.id === t.id) });
}

const sorted = o => JSON.stringify(Object.keys(o).sort().reduce((a, k) => (a[k] = o[k], a), {}));

test('every machine type has an example to be checked against', () => {
  const have = new Set(exampleRuns().map(r => r.m));
  const missing = Object.keys(context.MachineTypes).filter(m => !have.has(m));
  assert.deepEqual(missing, [], 'a machine with no example is a machine this file cannot check');
});

test('every transition of every machine opens on its own row and saves back unchanged', () => {
  let checked = 0;
  for (const run of exampleRuns()) {
    installRun(run);
    for (const t of [...App().transitions]) {
      const before = sorted(t);
      assert.equal(openOn(t), true, `${run.file}: ${t.id} opens inline`);
      assert.equal(context.edgeLabelEditorState().tid, t.id, `${run.file}: ${t.id} is the row opened`);
      const read = context.edgeLabelEditorValues();
      assert.equal(read.error, undefined, `${run.file}: ${t.id} reads back without an error`);
      assert.equal(context.saveTransition(read.values, t.id).ok, true, `${run.file}: ${t.id} saves`);
      context.closeEdgeLabelEditor();
      const now = { ...App().transitions.find(x => x.id === t.id) };
      // Both are the dialog's own normalisations, which saveTransition shares:
      // a read-only head is saved with write = symbol, and a multi-tape rule's
      // `symbol` is its first tape's read. Neither is read by a simulator.
      const was = JSON.parse(before);
      if (context.isReadOnlyHeadMachine(run.m) && !('write' in was) && now.write === now.symbol) delete now.write;
      if (now.tapeSyms) { now.symbol = was.symbol; }
      assert.equal(sorted(now), before, `${run.file}: ${t.id} is unchanged by a save that changed nothing`);
      checked++;
    }
  }
  assert.ok(checked > 400, `checked ${checked} transitions`);
});

test('every pill of every machine\'s label focuses a field the strip has', () => {
  for (const run of exampleRuns()) {
    installRun(run);
    const fields = context.labelEditorFields(run.m);
    for (const t of App().transitions) {
      context.transLabelParts(t).forEach((part, i) => {
        const field = context.labelEditorFieldForPill(part.role, i, run.m);
        assert.ok(fields.includes(field), `${run.file}: the ${part.role} pill (#${i}) focuses ${field}`);
      });
    }
  }
});

test('every transition of every machine takes an edit to its read, as one undo point', () => {
  for (const run of exampleRuns()) {
    installRun(run, ['ζ']);
    const readField = context.labelEditorFields(run.m)[0];
    for (const t of [...App().transitions]) {
      openOn(t);
      const depth = App().history.length;
      context.edgeLabelEditorInput(readField).value = 'ζ';
      assert.equal(context.commitEdgeLabelEditor(), true, `${run.file}: ${t.id} — ${context.edgeLabelEditorState()?.error}`);
      const now = App().transitions.find(x => x.id === t.id);
      assert.equal(readField === 'on' ? now.symbol : now.tapeSyms[0], 'ζ', `${run.file}: ${t.id} reads ζ`);
      assert.equal(App().history.length, depth + 1, `${run.file}: ${t.id} is one undo point`);
      context.undo();
      context.renderAll();
    }
  }
});

test('a clash with a sibling is refused exactly where the machine is deterministic', () => {
  for (const run of exampleRuns()) {
    installRun(run);
    const deterministic = !!context.machineDeterminism(run.m);
    const readSide = context.labelEditorFields(run.m).filter(f => /^(on|pop|pop2|tapeSyms\.\d+)$/.test(f));
    for (const t of [...App().transitions]) {
      const sib = App().transitions.find(x => x.from === t.from && x.id !== t.id);
      if (!sib) continue;
      openOn(t);
      for (const f of readSide) {
        const [base, i] = f.split('.');
        context.edgeLabelEditorInput(f).value = base === 'on' ? sib.symbol
          : base === 'tapeSyms' ? (sib.tapeSyms?.[i] ?? sib.symbol)
          : (sib[base] ?? App().config.sym.eps);
      }
      const before = sorted(App().transitions.find(x => x.id === t.id));
      const saved = context.commitEdgeLabelEditor();
      if (deterministic) {
        assert.equal(saved, false, `${run.file}: ${t.id} copying ${sib.id}'s read is refused`);
        assert.equal(sorted(App().transitions.find(x => x.id === t.id)), before, `${run.file}: ${t.id} untouched`);
        context.closeEdgeLabelEditor();
      } else if (saved) {
        context.undo();
        context.renderAll();
      } else {
        // A branching machine may still refuse for a reason of its own — a
        // counter's bottom marker, an LBA's fixed boundary — never for the clash.
        assert.doesNotMatch(context.edgeLabelEditorState().error, /already has/, `${run.file}: ${t.id}`);
        context.closeEdgeLabelEditor();
      }
    }
  }
});

// ── found in review ───────────────────────────────────────────────

test('a stray value the transition already has does not lock its other fields', () => {
  const { key: k } = tm();
  // A symbol removed from Γ after the rule that reads it was drawn.
  context.App.transitions.find(x => x.id === 'tx1').symbol = '9';
  context.renderAll();
  context.openEdgeLabelEditor(k, { row: 0 });
  context.edgeLabelEditorInput('move').value = 'S';
  assert.equal(context.commitEdgeLabelEditor(), true, context.edgeLabelEditorState()?.error);
  const t = App().transitions.find(x => x.id === 'tx1');
  assert.equal(t.symbol, '9', 'kept, as the dialog keeps it');
  assert.equal(t.dir, 'S');

  context.openEdgeLabelEditor(k, { row: 0 });
  context.edgeLabelEditorInput('on').value = '8';
  assert.equal(context.commitEdgeLabelEditor(), false, 'a new stray symbol is still refused');
});

test('the move is not inside a <label>, so a press on its caption cannot click a move', () => {
  const { key: k } = tm();
  context.openEdgeLabelEditor(k);
  assert.equal(context.edgeLabelEditorInput('move').parentNode.tagName, 'SPAN');
  assert.equal(context.edgeLabelEditorInput('write').parentNode.tagName, 'LABEL');
});

test('Tab from a pressed move button goes round the strip rather than out of it', () => {
  const { key: k } = tm();
  context.openEdgeLabelEditor(k);
  const group = context.edgeLabelEditorInput('move');
  const button = group.children[0];
  button.closest = sel => (sel === '[data-field]' ? group : null);
  let prevented = false;
  editorEl()._listeners.keydown(key('Tab', button, { preventDefault() { prevented = true; } }));
  assert.ok(prevented, 'the strip handled the Tab');
});

test('a tape machine\'s write suggestions are Γ, not only Σ', () => {
  harness.resetApp();
  context.applyMachineSwitch('TM');
  context.App.sigma = new Set(['a']);
  context.App.stackAlpha = new Set(['a', 'X']);
  const el = context.document.createElement('input');
  el.value = 'X';
  assert.equal(context.getWriteSymbolSuggestState(el).mode, 'none', 'X is a tape symbol, not a mistake');
  el.value = '';
  const st = context.getWriteSymbolSuggestState(el);
  assert.ok(st.candidates.includes('X'));
  assert.equal(st.alphabetLabel, 'Γ');
});
