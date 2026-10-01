import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.js';
import { SMTFError, machineCodeText, readMachineCode, writeMachineCode } from '../js/interop/smtf.js';

// The standard machine text format (js/interop/smtf.js). What is pinned here is
// what makes it a standard rather than an export: that every machine the app
// ships survives the round trip *as a machine* — the same verdicts and outputs,
// through the app's own deciders — and comes back to the same text; that the
// text does not depend on how the machine was drawn or numbered; that
// bbchallenge's strings are read and written unchanged; and that a machine
// built from blocks keeps its blocks, with each definition written once.

const harness = createHarness();
const { context } = harness;
const { App } = context;
const EXAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'examples');
const pristine = JSON.parse(JSON.stringify(App.config));
const sym = pristine.sym;
const code = (doc, opts) => writeMachineCode(doc, { sym, ...opts }).code;

function install(d) {
  harness.resetApp();
  App.config = { ...JSON.parse(JSON.stringify(pristine)), ...(d.config || {}) };
  App.machine = d.machine;
  App.sigma = new Set(d.sigma || []);
  App.stackAlpha = new Set(d.stackAlpha || [sym.stackBottom]);
  App.outputAlpha = new Set(d.outputAlpha || []);
  if (d.tapeCount) App.tapeCount = d.tapeCount;
  App.states = JSON.parse(JSON.stringify(d.states));
  App.transitions = JSON.parse(JSON.stringify(d.transitions));
  App.blocks = JSON.parse(JSON.stringify(d.blocks || []));
  context.invalidateTransitionIndex();
  context.invalidateBlockIndex();
  App.startId = d.startId;
  App.accepts = new Set(d.accepts || []);
}

// Sample inputs, plus every word up to the length that keeps it cheap. An
// ω-automaton's input is a lasso and a multi-tape machine's is one word per
// tape, so those two are held to their samples.
function wordsFor(d) {
  const ws = new Set((d.meta?.inputs || []).map(i => i.w));
  if (!context.MachineTypes[d.machine]?.isOmega && d.machine !== 'MTM') {
    const sigma = (d.sigma || []).filter(s => s !== sym.eps && s !== sym.any);
    let layer = [[]];
    for (let len = 0; len <= 6 && layer.length <= 200; len++) {
      if (len) layer = layer.flatMap(w => sigma.map(s => [...w, s]));
      for (const w of layer) ws.add(w.length ? w.join(',') : '');
    }
  }
  return [...ws];
}

function verdicts(d, words) {
  install(d);
  return words.map(w => {
    const parsed = context.parseMachineInput(d.machine, w === 'ε' ? '' : w);
    if (!parsed.ok) return 'unreadable';
    const r = context.decideMachine(d.machine, parsed.input);
    return `${r.verdict}|${Array.isArray(r.output) ? r.output.join('') : r.output ?? ''}`;
  });
}

const examples = fs.readdirSync(EXAMPLES).filter(f => f.endsWith('.json')).sort()
  .map(f => ({ file: f, doc: JSON.parse(fs.readFileSync(path.join(EXAMPLES, f), 'utf8')) }));

// ── every machine the app ships ───────────────────────────────────

test('every bundled example decides the same after a round trip, and re-encodes to the same code', () => {
  for (const { file, doc } of examples) {
    const c = code(doc);
    const back = readMachineCode(c, { sym });
    assert.equal(code(back), c, `${file}: the decoded machine writes a different code`);
    const words = wordsFor(doc);
    const a = verdicts(doc, words), b = verdicts(back, words);
    words.forEach((w, i) => assert.equal(b[i], a[i], `${file} on "${w}"`));
  }
});

test('the code does not depend on state ids, names, order or alphabet order', () => {
  for (const { file, doc } of examples) {
    const base = code(doc, { labels: false });
    const ids = new Map(doc.states.map((s, i) => [s.id, `x${(i * 7919) % 1009}`]));
    const shuffled = {
      ...doc,
      sigma: [...doc.sigma].reverse(),
      states: doc.states.map(s => ({ ...s, id: ids.get(s.id), name: 'renamed' })).reverse(),
      transitions: doc.transitions.map(t => ({ ...t, from: ids.get(t.from), to: ids.get(t.to) })).reverse(),
      startId: ids.get(doc.startId),
      accepts: (doc.accepts || []).map(a => ids.get(a))
    };
    assert.equal(code(shuffled, { labels: false }), base, file);
  }
});

test('determinism is read off δ, never written: DFA and NFA share one type', () => {
  const dfa = examples.find(e => e.doc.machine === 'DFA').doc;
  const nfa = examples.find(e => e.doc.machine === 'NFA').doc;
  assert.match(code(dfa), /^fa\./);
  assert.match(code(nfa), /^fa\./);
  assert.equal(readMachineCode(code(dfa), { sym }).machine, 'DFA');
  assert.equal(readMachineCode(code(nfa), { sym }).machine, 'NFA');
});

// ── bbchallenge ───────────────────────────────────────────────────

test("bbchallenge's strings are the rows of a tm, byte for byte", () => {
  for (const stf of ['1RB1LB_1LA1RZ', '1RB1LC_1RC1RB_1RD0LE_1LA1LD_1RZ0LA', '1RB2LB1RZ_2LA2RB1LB', '1RB1RZ_0LC1RB_1LA---']) {
    const d = readMachineCode(stf, { sym });
    assert.equal(d.machine, 'ITM');
    assert.equal(code(d, { labels: false }).split(':')[1], stf);
  }
  // BB(2) halts, with the halt as its one accepting state.
  const bb2 = readMachineCode('tm.1:1RB1LB_1LA1RZ', { sym });
  install(bb2);
  assert.equal(context.decideMachine('ITM', []).verdict, 'acc');
});

// ── blocks ────────────────────────────────────────────────────────
// aⁿbⁿ from four subroutines: `cmp` branches three ways and is placed twice,
// `left` scans to a blank, and `toEnd` is itself built from a `right` block —
// so the definition is shared, and a block's first step is a block.

const B = '⊔', ANY = 'Σ';
let tid = 0;
const tr = (from, to, symbol, write, dir) => ({ id: `x${++tid}`, from, to, symbol, write, dir });
const exitTo = (from, to) => tr(from, to, ANY, ANY, 'S');
const def = (name, states, transitions, entry, exits) => ({ name, machine: 'TM', states, transitions, entry, startId: entry, exits, accepts: [] });
const scan = dir => def(dir === 'R' ? 'right' : 'left',
  [{ id: 'r', name: 'scan' }, { id: 'd', name: 'at blank' }],
  [tr('r', 'r', 'a', 'a', dir), tr('r', 'r', 'b', 'b', dir), tr('r', 'd', B, B, 'S')], 'r', [{ id: 'd', label: 'blank' }]);
const cmp = () => def('cmp',
  [{ id: 't', name: 'test' }, { id: 'A', name: 'is a' }, { id: 'Bb', name: 'is b' }, { id: 'E', name: 'is blank' }],
  [tr('t', 'A', 'a', 'a', 'S'), tr('t', 'Bb', 'b', 'b', 'S'), tr('t', 'E', B, B, 'S')], 't',
  [{ id: 'A', label: 'a' }, { id: 'Bb', label: 'b' }, { id: 'E', label: 'blank' }]);

function freshTM() {
  harness.resetApp();
  App.config = JSON.parse(JSON.stringify(pristine));
  App.machine = 'TM';
  App.sigma = new Set(['a', 'b']);
  App.stackAlpha = new Set(['a', 'b', B]);
  App.states = []; App.transitions = []; App.blocks = [];
  App.accepts = new Set(); App.startId = null;
}

function blockMachine() {
  freshTM();
  const right = context.inlineBlock(scan('R'), { name: 'right' });
  App.states.push({ id: 's900', name: 'back' }, { id: 's901', name: 'on last' });
  App.transitions.push(exitTo(right.block.exits[0].id, 's900'), tr('s900', 's901', B, B, 'L'));
  App.startId = right.block.entry;
  App.accepts = new Set(['s901']);
  const toEnd = context.machineAsBlockDefinition({ name: 'toEnd' });

  freshTM();
  const first = context.inlineBlock(cmp(), { name: 'first' }).block;
  App.states.push({ id: 's500', name: 'erase a' });
  const end = context.inlineBlock(toEnd, { name: 'toEnd' }).block;
  const last = context.inlineBlock(cmp(), { name: 'last' }).block;
  const left = context.inlineBlock(scan('L'), { name: 'left' }).block;
  App.states.push({ id: 's501', name: 'erase b' }, { id: 's502', name: 'step in' }, { id: 's503', name: 'accept' });
  const exit = (b, label) => b.exits.find(e => e.label === label).id;
  App.transitions.push(
    exitTo(exit(first, 'a'), 's500'), exitTo(exit(first, 'blank'), 's503'),
    tr('s500', end.entry, 'a', B, 'R'),
    exitTo(end.exits[0].id, last.entry),
    exitTo(exit(last, 'b'), 's501'),
    tr('s501', left.entry, 'b', B, 'L'),
    exitTo(left.exits[0].id, 's502'),
    tr('s502', first.entry, B, B, 'R'));
  App.startId = first.entry;
  App.accepts = new Set(['s503']);
  return JSON.parse(JSON.stringify({
    machine: 'TM', sigma: ['a', 'b'], stackAlpha: ['a', 'b', B],
    states: App.states, transitions: App.transitions, blocks: App.blocks,
    startId: App.startId, accepts: [...App.accepts], config: { twoWayTape: false }
  }));
}

const aNbN = w => /^a*b*$/.test(w) && w.split('a').length === w.split('b').length;
const blockWords = [''];
for (let len = 1; len <= 6; len++) for (let i = 0; i < 2 ** len; i++) blockWords.push(i.toString(2).padStart(len, '0').replace(/0/g, 'a').replace(/1/g, 'b'));

test('a machine built from blocks keeps its blocks, and writes a shared definition once', () => {
  const doc = blockMachine();
  const { code: c, warnings } = writeMachineCode(doc, { sym });
  assert.deepEqual(warnings, []);
  const [body] = c.split('~');
  assert.equal(body.split(':')[1].split(';').length, 5, 'the machine and four definitions — cmp once for two placements');
  assert.equal((body.match(/=0/g) || []).length, 2, 'cmp is placed twice');

  const back = readMachineCode(c, { sym });
  assert.equal(code(back), c);
  const vs = verdicts(back, blockWords);
  blockWords.forEach((w, i) => assert.equal(vs[i].split('|')[0], aNbN(w) ? 'acc' : 'rej', `"${w}"`));

  const byName = new Map(back.blocks.map(b => [b.name, b]));
  assert.deepEqual([...byName.keys()].sort(), ['first', 'last', 'left', 'right', 'toEnd']);
  assert.equal(byName.get('right').parent, byName.get('toEnd').id, 'nesting survives');
  assert.deepEqual(byName.get('first').exits.map(e => e.label), ['a', 'b', 'blank']);
  assert.ok(back.states.some(s => s.name === 'toEnd/right/scan'), 'names are paths, as inlineBlock writes them');

  // And the app keeps every one of them — including toEnd, whose entry is
  // its nested block's entry.
  install(back);
  context.pruneBlocks();
  assert.equal(App.blocks.length, 5);
});

test('a block machine has one code however it is numbered', () => {
  const doc = blockMachine();
  const base = code(doc, { labels: false });
  const ids = new Map();
  const id = x => { if (x && !ids.has(x)) ids.set(x, `z${ids.size * 37 % 101}_${ids.size}`); return x && ids.get(x); };
  const moved = {
    ...doc,
    states: doc.states.map(s => ({ ...s, id: id(s.id), blockId: id(s.blockId) })).reverse(),
    transitions: doc.transitions.map(t => ({ ...t, from: id(t.from), to: id(t.to) })).reverse(),
    blocks: doc.blocks.map(b => ({ ...b, id: id(b.id), parent: id(b.parent), entry: id(b.entry), exits: b.exits.map(e => ({ ...e, id: id(e.id) })) })).reverse(),
    startId: id(doc.startId), accepts: doc.accepts.map(id)
  };
  assert.equal(code(moved, { labels: false }), base);
});

test('a block that is not a clean subroutine is written flat, says why, and is the same machine', () => {
  const doc = blockMachine();
  const inside = doc.states.find(s => s.name === 'toEnd/back');
  doc.transitions.push({ id: 'stray', from: 's502', to: inside.id, symbol: 'b', write: 'b', dir: 'S' });
  const { code: c, warnings } = writeMachineCode(doc, { sym });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /toEnd.*enters it past its entry/);
  const back = readMachineCode(c, { sym });
  assert.ok(!back.blocks.some(b => b.name === 'toEnd'));
  assert.deepEqual(verdicts(back, blockWords), verdicts(doc, blockWords));
});

// ── the text itself ───────────────────────────────────────────────

test('names the reader would make up anyway are not written', () => {
  const c = 'fa.01:+AB_BA';
  assert.equal(code(readMachineCode(c, { sym })), c);
  assert.equal(code(readMachineCode(`${c}~Even+ones~even,odd`, { sym })), `${c}~Even+ones~even,odd`);
});

test('a malformed code is named, not guessed at', () => {
  const bad = [
    ['dfa.01:AB_BA', /not a machine type/],
    ['fa.01@x:AB_BA', /@x is not an option/],
    ['fa.01:AB9_BA', /expected/],
    ['fa.01:ABAAA_BA', /more cells than/],
    ['tm.1:=0Z;=0a', /places itself/],
    ['tm.1:=1Z;1Ra', /does not give/],
    ['fa.01:Aa_BA', /has none/]
  ];
  for (const [c, why] of bad) assert.throws(() => readMachineCode(c, { sym }), e => e instanceof SMTFError && why.test(e.message), c);
  assert.throws(() => writeMachineCode({ machine: 'DFA', sigma: ['a'], states: [{ id: 's1' }], transitions: [], startId: null, accepts: [] }, { sym }), /no start state/);
});

test('a code is recognised on its own or in a link inside a sentence', () => {
  assert.equal(machineCodeText('fa.01:+AB_BA'), 'fa.01:+AB_BA');
  assert.equal(machineCodeText('try https://x.test/#m=fa.01:+AB_BA.'), 'fa.01:+AB_BA');
  assert.equal(machineCodeText('1RB1LB_1LA1RZ'), null, 'a bare STF string is the STF reader\'s');
  assert.equal(machineCodeText('ratio: 3:4'), null);
  // A client that percent-encoded the link on its way through.
  assert.equal(readMachineCode('fa.01:%2BAB_BA', { sym }).accepts.length, 1);
});

// ── in the app ────────────────────────────────────────────────────

function emptyWorkspace() {
  harness.resetApp();
  context.Workspaces.length = 0;
  context.setActiveWorkspaceId(null);
  context.Workspaces.push({ id: 'w0', name: 'Workspace 1', dirty: false, data: context.exportWorkspaceState() });
  context.setActiveWorkspaceId('w0');
}

test('a pasted machine code opens the machine, laid out', async () => {
  emptyWorkspace();
  assert.equal(await context.applyPastedText('fa.ab:A(AB)_+-B~Ends+in+b'), true);
  assert.equal(App.machine, 'NFA');
  assert.equal(App.states.length, 2);
  assert.equal(App.meta?.title, 'Ends in b');
  assert.ok(App.states.some(s => s.x !== App.states[0].x || s.y !== App.states[0].y), 'states are not stacked');
});

test('a pasted block machine opens with its blocks, boxes apart', async () => {
  const c = code(blockMachine());
  emptyWorkspace();
  assert.equal(await context.applyPastedText(c), true);
  context.pruneBlocks();
  assert.equal(App.blocks.length, 5);
  const top = App.blocks.filter(b => !b.parent);
  const spots = new Set(top.map(b => `${Math.round(b.x)},${Math.round(b.y)}`));
  assert.equal(spots.size, top.length, 'every top-level box has a place of its own');
});

test('a #m= link opens at boot and clears the hash', async () => {
  emptyWorkspace();
  let replaced = false;
  context.history = { ...context.history, replaceState: () => { replaced = true; } };
  context.location = { ...context.location, hash: '#m=tm.1:1RB1LB_1LA1RZ' };
  assert.equal(await context.loadSharedLinkFromURL(), true);
  assert.ok(replaced);
  assert.equal(App.machine, 'ITM');
  assert.equal(App.states.length, 3);
});

test('the canvas writes its own code, and a broken one leaves the canvas alone', async () => {
  emptyWorkspace();
  await context.applyPastedText('fa.01:+AB_BA~Even+ones');
  assert.equal(context.machineCodeOfCanvas().code, 'fa.01:+AB_BA~Even+ones');
  const before = JSON.stringify(context.exportWorkspaceState());
  assert.equal(await context.applyPastedText('fa.01:AB9_BA'), false);
  assert.equal(JSON.stringify(context.exportWorkspaceState()), before);
});
