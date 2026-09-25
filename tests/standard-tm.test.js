import test from 'node:test';
import assert from 'node:assert';
import { createHarness } from './harness.js';

const harness = createHarness();
const { context } = harness;

// The standard TM text format (bbchallenge, the Busy Beaver wiki): pasted on
// the canvas, it opens as a machine. The reader is pinned against the known
// champions, whose step and ones counts are the published values — a reader
// that swapped L and R, or read the triples in the wrong order, would still
// produce a plausible-looking diagram and get the counts wrong.

const BB4 = '1RB1LB_1LA0LC_1RZ1LD_1RD0RA';        // s = 107, Σ = 13
const BB5 = '1RB1LC_1RC1RB_1RD0LE_1LA1LD_1RZ0LA'; // s = 47,176,870
const BB23 = '1RB2LB1RZ_2LA2RB1LB';                // 2 states, 3 symbols: s = 38, Σ = 9

function freshWorkspace() {
  harness.resetApp();
  context.Workspaces.length = 0;
  context.setActiveWorkspaceId(null);
  context.Workspaces.push({ id: 'w0', name: 'Workspace 1', dirty: false, data: context.exportWorkspaceState() });
  context.setActiveWorkspaceId('w0');
}

function run() {
  context.simITM([]);
  return context.App.simSteps[context.App.simSteps.length - 1];
}

const status = () => harness.getElement('status-bar').textContent;

// ── the reader ────────────────────────────────────────────────────

test('the BB(5) champion reads as five states, a halt and ten transitions', () => {
  const d = context.readStandardTM(BB5, { blank: '⊔' });
  assert.equal(d.machine, 'ITM');
  assert.deepEqual(d.states.map(s => s.name), ['A', 'B', 'C', 'D', 'E', 'halt']);
  assert.equal(d.transitions.length, 10);
  assert.equal(d.startId, d.states[0].id);
  assert.deepEqual(d.accepts, [d.states[5].id]);
  assert.deepEqual(d.sigma, ['1']);
  assert.deepEqual(d.stackAlpha, ['1', '⊔']);
  // E reading 0: 1RZ — write 1, move right, halt.
  const e0 = d.transitions.find(t => t.from === d.states[4].id && t.symbol === '⊔');
  assert.deepEqual([e0.write, e0.dir, e0.to], ['1', 'R', d.states[5].id]);
  // D reading 1: 1LD — a self-loop, not a halt.
  const d1 = d.transitions.find(t => t.from === d.states[3].id && t.symbol === '1');
  assert.deepEqual([d1.write, d1.dir, d1.to], ['1', 'L', d.states[3].id]);
});

test('0 is the blank both read and written', () => {
  const d = context.readStandardTM('0LA1RZ', { blank: 'B' });
  const [t0] = d.transitions;
  assert.equal(t0.symbol, 'B');
  assert.equal(t0.write, 'B');
});

test('--- is no edge, and the reader says so', () => {
  const d = context.readStandardTM('1RB---_1LA1RZ', { blank: '⊔' });
  assert.equal(d.transitions.length, 3);
  assert.match(d.warnings.join(' '), /1 undefined transition/);
});

test('a machine that never halts has no accepting state and says why', () => {
  const d = context.readStandardTM('1RB1LA_1LA1RB', { blank: '⊔' });
  assert.equal(d.states.length, 2);
  assert.deepEqual(d.accepts, []);
  assert.match(d.warnings.join(' '), /No transition halts/);
});

test('H halts as well as Z, and lowercase is read', () => {
  const d = context.readStandardTM('1rb1rh_1la1lb', { blank: '⊔' });
  assert.equal(d.states.at(-1).name, 'halt');
  assert.equal(d.accepts.length, 1);
});

test('malformed machines are refused with the problem named', () => {
  const bad = [
    ['1RB1LC_1RC', /state B has 1 transitions but state A has 2/i],
    ['1RB1L_1LA1RZ', /state A is "1RB1L", 5 characters/i],
    ['1RB1XA_1LA1RZ', /"1XA" in state A \(reading 1\)/],
    ['1RB2LA_1LA1RZ', /writes 2.*only the symbols 0–1/],
    ['1RB__1LA1RZ', /Empty state/]
  ];
  for (const [src, msg] of bad) {
    assert.throws(() => context.readStandardTM(src, { blank: '⊔' }), err => err instanceof context.StandardTMError && msg.test(err.message), src);
  }
});

test('text that is not trying to be a machine is not recognised', () => {
  for (const text of ['', 'hello', '{"states":[]}', 'q0 -> q1', 'ABC_DEF', '1 RB 1LC']) {
    assert.equal(context.standardTMText(text), null, JSON.stringify(text));
  }
  assert.equal(context.standardTMText(`  ${BB4}\n`), BB4);
});

// ── the machines it produces run as published ─────────────────────

test('the pasted BB(4) champion runs 107 steps and prints 13 ones', () => {
  freshWorkspace();
  assert.equal(context.applyPastedText(BB4), true);
  assert.equal(context.App.machine, 'ITM');
  const last = run();
  assert.equal(last.final, 'accept');
  assert.equal(last.tape.filter(c => c === '1').length, 13);
  assert.equal(context.App.simSteps.length, 108);
});

test('a 3-symbol machine runs as published: BB(2,3) is 38 steps and 9 non-blanks', () => {
  freshWorkspace();
  context.applyPastedText(BB23);
  assert.deepEqual([...context.App.stackAlpha].sort(), ['1', '2', '⊔']);
  const last = run();
  assert.equal(last.final, 'accept');
  assert.equal(last.tape.filter(c => c === '1' || c === '2').length, 9);
  assert.equal(context.App.simSteps.length, 39);
});

test('every pasted state has a position', () => {
  freshWorkspace();
  context.applyPastedText(BB5);
  for (const s of context.App.states) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y), s.name);
  }
  const at = new Set(context.App.states.map(s => `${s.x},${s.y}`));
  assert.equal(at.size, context.App.states.length, 'no two states stacked');
});

// ── where it lands ────────────────────────────────────────────────

test('an untouched tab is read into; an occupied one keeps its machine', () => {
  freshWorkspace();
  context.applyPastedText(BB4);
  assert.equal(context.Workspaces.length, 1, 'the empty tab was used');

  context.applyPastedText(BB5);
  assert.equal(context.Workspaces.length, 2, 'the BB(4) tab was not overwritten');
  assert.equal(context.App.states.length, 6);
  const first = context.Workspaces.find(w => w.id === 'w0');
  assert.equal(first.data.states.length, 5, 'BB(4) is still in its own tab');
});

test('a malformed paste changes nothing and names the problem', () => {
  freshWorkspace();
  context.applyPastedText(BB4);
  const before = context.App.states.length;
  assert.equal(context.applyPastedText('1RB1LC_1RC'), true, 'recognised, so not handed to the in-app paste');
  assert.equal(context.App.states.length, before);
  assert.equal(context.Workspaces.length, 1, 'no tab opened for it');
  assert.match(status(), /state B has 1 transitions/i);
});

test('a paste that is not a machine is left for the in-app clipboard', () => {
  freshWorkspace();
  assert.equal(context.applyPastedText('just some words'), false);
  assert.equal(context.App.states.length, 0);
});

// ── Ctrl+V ────────────────────────────────────────────────────────

function ctrlV(text) {
  harness.dispatchDocumentEvent('keydown', { key: 'v', ctrlKey: true });
  return harness.dispatchDocumentEvent('paste', {
    clipboardData: { getData: type => (type === 'text/plain' ? text : '') }
  });
}

test('Ctrl+V with a machine on the system clipboard opens it', () => {
  freshWorkspace();
  const ev = ctrlV(BB4);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(context.App.states.length, 5);
});

test('Ctrl+V with other text pastes the states copied in the app', () => {
  freshWorkspace();
  context.App.machine = 'DFA';
  context.App.states = [{ id: 's1', name: 'q0', x: 0, y: 0 }];
  context.App.selectedStates.add('s1');
  context.copySelection();
  ctrlV('not a machine');
  assert.equal(context.App.states.length, 2);
});

test('a paste event nobody armed is left alone', () => {
  freshWorkspace();
  const ev = harness.dispatchDocumentEvent('paste', {
    clipboardData: { getData: () => BB4 }
  });
  assert.equal(ev.defaultPrevented, false);
  assert.equal(context.App.states.length, 0);
});

test('with no paste event, Ctrl+V still pastes the in-app clipboard', async () => {
  freshWorkspace();
  context.App.machine = 'DFA';
  context.App.states = [{ id: 's1', name: 'q0', x: 0, y: 0 }];
  context.App.selectedStates.add('s1');
  context.copySelection();
  harness.dispatchDocumentEvent('keydown', { key: 'v', ctrlKey: true });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(context.App.states.length, 2);
});
