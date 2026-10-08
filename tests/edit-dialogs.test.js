import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHarness, context } from './harness.js';

// The state and transition dialogs, against every machine the app has.
//
// Opening a rule in the transition dialog and saving it untouched must give the
// rule back exactly. It did not on the two-way automata: their head moves but
// never writes, and the save path wrote `write` for every machine with a head,
// so each 2DFA, 2NFA or 2DFT rule that passed through the dialog — or the label
// editor on the canvas, which saves through the same function — came back with
// a field the machine does not have, and the file grew it on the next save.
// The per-machine sweep that found it opened one rule per machine in a
// browser; this opens every rule of every example, so a field a future
// machine's dialog drops, invents or rewrites fails here by name.

const ROOT = join(import.meta.dirname, '..');
const EXAMPLES = join(ROOT, 'js/examples');

function examplesByMachine() {
  const out = new Map();
  for (const f of readdirSync(EXAMPLES)) {
    if (!f.endsWith('.json')) continue;
    let d;
    try { d = JSON.parse(readFileSync(join(EXAMPLES, f), 'utf8')); } catch { continue; }
    if (!d.machine || !Array.isArray(d.transitions)) continue;
    if (!out.has(d.machine)) out.set(d.machine, []);
    out.get(d.machine).push({ file: f, data: d });
  }
  return out;
}

// A hand-set bend or loop angle is drawing, not the rule, and is not a field
// the dialog edits.
const ruleOf = t => {
  const c = { ...t };
  delete c.id; delete c.curve; delete c.loopAngle;
  return c;
};

const load = data => {
  createHarness();
  context.performClear();
  context.loadData(JSON.parse(JSON.stringify(data)), true);
};

test('every machine type has an example to check its dialogs against', () => {
  const have = examplesByMachine();
  // PDA is the hidden alias of DPDA and re-derives from whether δ branches,
  // so an example saved as one loads as either.
  const missing = Object.keys(context.MachineTypes).filter(k => !have.has(k) && !(k === 'DPDA' && have.has('PDA')));
  assert.deepEqual(missing, [], 'a machine with no example is a machine this file cannot test');
});

for (const [machine, files] of examplesByMachine()) {
  test(`${machine}: a rule saved from the dialog unchanged comes back unchanged`, () => {
    for (const { file, data } of files) {
      load(data);
      const { App } = context;
      for (const original of App.transitions.slice()) {
        const before = ruleOf(original);
        context.openTransModal(original.from, original.to, { mode: 'edit', transId: original.id });
        context.confirmTrans();
        const after = App.transitions.find(t => t.id === original.id);
        assert.ok(after, `${file}: ${original.id} vanished on save`);
        assert.deepEqual(ruleOf(after), before, `${file}: ${original.id} changed on an unchanged save`);
      }
    }
  });

  test(`${machine}: a state saved from the dialog unchanged comes back unchanged`, () => {
    for (const { file, data } of files) {
      load(data);
      const { App } = context;
      for (const s of App.states.filter(x => x.kind === undefined)) {
        const snap = () => JSON.stringify({
          state: App.states.find(x => x.id === s.id),
          accept: App.accepts.has(s.id),
          start: App.startId === s.id,
          outputs: App.transitions.filter(t => t.from === s.id).map(t => t.output ?? null)
        });
        const before = snap();
        context.openStateModal(s.id);
        context.confirmState();
        assert.equal(snap(), before, `${file}: state ${s.name} changed on an unchanged save`);
      }
    }
  });
}

test('a two-way head saves a move and no write', () => {
  createHarness();
  const { App } = context;
  for (const machine of ['2DFA', '2NFA', '2DFT']) {
    App.machine = machine;
    App.states = [{ id: 's1', x: 0, y: 0, name: 'q0' }, { id: 's2', x: 90, y: 0, name: 'q1' }];
    App.transitions = [];
    const r = context.saveTransition({ from: 's1', to: 's2', symbol: 'a', dir: 'R', write: 'a', output: '' }, null);
    assert.ok(r.ok, `${machine}: ${r.error}`);
    const t = App.transitions.find(x => x.id === r.id);
    assert.equal(t.dir, 'R');
    assert.ok(!('write' in t), `${machine}: a head that cannot write was given a write`);
  }
});
