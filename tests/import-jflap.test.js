import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';

// JFLAP 6.1 interop.
//
// 6.1 added a notation 4.x has no equivalent for: a <read> may name a set
// of symbols bound to a variable — "y, a } w" — with <write>w</write>
// meaning "put back what you just read". One edge therefore stands for one
// transition per listed symbol.
//
// The reason this file exists is that getting it wrong is *silent*. Read
// literally, "y, a } w" is an eight-character tape symbol no cell can ever
// hold: the edge draws, the alphabet fills with garbage, and the machine
// rejects everything with no error anywhere. So the assertions below are
// mostly about what did *not* end up in Σ and Γ.

const harness = createHarness();
const { context } = harness;

function reset() { harness.resetApp(); }

const {
  jflapParseRead, jflapWritesVariable, addStackSymbols,
  jflapParseXML, jflapToWorkspace
} = context;

// A cut-down aⁿbⁿcⁿ machine in JFLAP 6.1's own output, variable edges and all.
const TM_6_1 = `<!-- Created with JFLAP 6.1. -->
<structure>
<type>turing</type>
<automaton>
<state id="0" name="q0"><x>208.0</x><y>-10.0</y><initial/></state>
<state id="1" name="q1"><x>41.0</x><y>39.0</y></state>
<state id="2" name="q2"><x>-79.0</x><y>-44.0</y><final/></state>
<transition><from>0</from><to>1</to><read>a</read><write>x</write><move>R</move></transition>
<transition><from>1</from><to>1</to><read>y, a } w</read><write>w</write><move>R</move></transition>
<transition><from>1</from><to>2</to><read/><write/><move>S</move></transition>
</automaton>
</structure>`;

function convert(xml) {
  return jflapToWorkspace(jflapParseXML(xml));
}

test('jflapParseRead reads the three <read> forms', () => {
  assert.deepEqual(jflapParseRead('a'), { kind: 'plain', symbol: 'a' });
  assert.deepEqual(jflapParseRead(''), { kind: 'plain', symbol: '' });
  assert.deepEqual(jflapParseRead('y, a } w'),
    { kind: 'set', symbols: ['y', 'a'], variable: 'w' });
  assert.deepEqual(jflapParseRead('! a, b } w'),
    { kind: 'not', symbols: ['a', 'b'], variable: 'w' });
});

test('jflapParseRead leaves a malformed variable form as a literal symbol', () => {
  // Nothing bound, or nothing to bind: not the variable notation.
  assert.deepEqual(jflapParseRead('} w'), { kind: 'plain', symbol: '} w' });
  assert.deepEqual(jflapParseRead('a, b }'), { kind: 'plain', symbol: 'a, b }' });
});

test('jflapWritesVariable distinguishes a copy-through from a constant write', () => {
  assert.equal(jflapWritesVariable('w', 'w'), true);
  assert.equal(jflapWritesVariable('x', 'w'), false);
  assert.equal(jflapWritesVariable(null, 'w'), false);
});

test('a variable transition expands to one transition per symbol', () => {
  reset();
  const d = convert(TM_6_1);
  const loops = d.transitions.filter(t => t.from === t.to);
  assert.equal(loops.length, 2, 'the "y, a } w" edge should become two loops');
  assert.deepEqual(loops.map(t => t.symbol).sort(), ['a', 'y']);
  // <write>w</write> copies the bound symbol through unchanged.
  loops.forEach(t => assert.equal(t.write, t.symbol));
  assert.equal(new Set(d.transitions.map(t => t.id)).size, d.transitions.length,
    'expanded transitions need distinct ids');
});

test('the variable text never reaches the alphabets', () => {
  reset();
  const d = convert(TM_6_1);
  // The bug this file is about: Σ and Γ used to carry "y, a } w" and "w".
  for (const alphabet of [d.sigma, d.stackAlpha]) {
    assert.ok(!alphabet.some(s => s.includes('}')), `stray variable text in ${alphabet}`);
    assert.ok(!alphabet.includes('w'), 'the variable name is not a symbol');
  }
  // 'x' is only ever written, never read, so it is a tape symbol and not
  // an input one.
  assert.deepEqual(d.sigma.sort(), ['a', 'y']);
  assert.ok(d.stackAlpha.includes('x'));
});

test('a negated variable read expands to every other symbol', () => {
  reset();
  const d = convert(`<structure><type>fa</type><automaton>
<state id="0" name="q0"><initial/></state>
<state id="1" name="q1"><final/></state>
<transition><from>0</from><to>1</to><read>a</read></transition>
<transition><from>0</from><to>1</to><read>b</read></transition>
<transition><from>0</from><to>1</to><read>c</read></transition>
<transition><from>1</from><to>1</to><read>! a } v</read></transition>
</automaton></structure>`);
  const loops = d.transitions.filter(t => t.from === t.to).map(t => t.symbol).sort();
  // Σ is {a,b,c}; "everything but a" is {b,c}, and is only computable once
  // every other transition has been read.
  assert.deepEqual(loops, ['b', 'c']);
});

test('the empty <read/> with <write/> stays a blank, not a variable', () => {
  reset();
  const d = convert(TM_6_1);
  const halt = d.transitions.find(t => t.from !== t.to && t.to === 's2');
  assert.equal(halt.symbol, context.App.config.sym.blank);
  assert.equal(halt.write, context.App.config.sym.blank);
});

test('a declared <tapes> count outranks the widest transition', () => {
  reset();
  // Three tapes declared, but no transition mentions the third.
  const d = convert(`<structure><type>turing</type><automaton><tapes>3</tapes>
<state id="0" name="q0"><initial/></state>
<state id="1" name="q1"><final/></state>
<transition><from>0</from><to>1</to>
<read tape="1">a</read><write tape="1">a</write><move tape="1">R</move>
<read tape="2">b</read><write tape="2">b</write><move tape="2">R</move>
</transition>
</automaton></structure>`);
  assert.equal(d.machine, 'MTM');
  assert.equal(d.tapeCount, 3, 'a 3-tape file must not import as 2-tape');
});

test('a second initial state is dropped, and said so', () => {
  reset();
  const d = convert(`<structure><type>fa</type><automaton>
<state id="0" name="q0"><initial/></state>
<state id="1" name="q1"><initial/><final/></state>
<transition><from>0</from><to>1</to><read>a</read></transition>
</automaton></structure>`);
  assert.equal(d.startId, 's0');
  assert.ok(d.warnings.some(w => /initial states/.test(w)));
});

test('a PDA with no final states warns about empty-stack acceptance', () => {
  reset();
  const d = convert(`<structure><type>pda</type><automaton>
<state id="0" name="q0"><initial/></state>
<transition><from>0</from><to>0</to><read>a</read><pop>Z</pop><push>AZ</push></transition>
</automaton></structure>`);
  assert.ok(d.warnings.some(w => /empty stack/.test(w)),
    'acceptance mode does not survive the import and must be flagged');
});

test('building blocks import as states, and say their interiors were lost', () => {
  reset();
  const d = convert(`<structure><type>turing</type><automaton>
<state id="0" name="q0"><initial/></state>
<block id="1" name="sub"><x>10</x><y>10</y><final/>
  <structure><type>turing</type><automaton>
    <state id="0" name="inner"><initial/></state>
  </automaton></structure>
</block>
<transition><from>0</from><to>1</to><read>a</read><write>a</write><move>R</move></transition>
</automaton></structure>`);
  assert.equal(d.states.length, 2);
  assert.ok(d.warnings.some(w => /building block/.test(w)));
});

test('a <push> string contributes its characters, not itself', () => {
  // "AZ" pushes A then Z. A stack symbol named "AZ" would match nothing.
  assert.deepEqual([...addStackSymbols('AZ', new Set())].sort(), ['A', 'Z']);
  assert.deepEqual([...addStackSymbols('A', new Set())], ['A']);
});

test('a PDA push string does not leak into the stack alphabet', () => {
  reset();
  const d = convert(`<structure><type>pda</type><automaton>
<state id="0" name="q0"><initial/></state>
<state id="1" name="q1"><final/></state>
<transition><from>0</from><to>0</to><read>a</read><pop>Z</pop><push>AZ</push></transition>
<transition><from>0</from><to>1</to><read>b</read><pop>A</pop><push/></transition>
</automaton></structure>`);
  assert.ok(!d.stackAlpha.includes('AZ'), 'the push string is not a symbol');
  assert.ok(['A', 'Z'].every(c => d.stackAlpha.includes(c)));
});

test('the structures with no <automaton> each get their own message', () => {
  reset();
  for (const [type, needle] of [['grammar', /grammar/], ['re', /regular-expression/], ['pumping', /pumping/]]) {
    assert.throws(
      () => convert(`<structure><type>${type}</type></structure>`),
      needle,
      `${type} should name itself in the error`
    );
  }
});
// ── the tape model ────────────────────────────────────────────────
// JFLAP's tape runs infinitely both ways, unconditionally, for every one
// of its Turing machines. That is a fact about the *file*, so the import
// carries it as the tape setting — there is nothing to detect from the
// transitions and no machine type to pick.

test('a JFLAP Turing machine asks for the two-way tape', () => {
  reset();
  const d = convert(`<structure><type>turing</type><automaton>
<state id="0" name="q0"><initial/></state>
<state id="1" name="q1"><final/></state>
<transition><from>0</from><to>1</to><read>a</read><write>a</write><move>R</move></transition>
</automaton></structure>`);
  assert.equal(d.twoWayTape, true);
});

test('a JFLAP finite automaton asks for nothing about tapes', () => {
  reset();
  const d = convert(`<structure><type>fa</type><automaton>
<state id="0" name="q0"><initial/></state>
<state id="1" name="q1"><final/></state>
<transition><from>0</from><to>1</to><read>a</read></transition>
</automaton></structure>`);
  assert.equal(d.twoWayTape, false);
});

test('importing a machine that scans left off its input decides correctly', () => {
  reset();
  // The regression this whole thread is about: q1 walks left over the x it
  // wrote, expecting to fall off the input onto a blank. On a bounded tape
  // the head sticks at cell 0, re-reads 'x' forever, and the loop detector
  // reports a *rejection* — indistinguishable from a real one.
  context.importJFLAPText(`<structure><type>turing</type><automaton>
<state id="0" name="q0"><initial/></state>
<state id="1" name="q1"></state>
<state id="2" name="q2"><final/></state>
<transition><from>0</from><to>1</to><read>a</read><write>x</write><move>L</move></transition>
<transition><from>1</from><to>1</to><read>x</read><write>x</write><move>L</move></transition>
<transition><from>1</from><to>2</to><read/><write/><move>R</move></transition>
</automaton></structure>`);
  assert.equal(context.App.config.twoWayTape, true, 'the import sets the tape model');
  assert.equal(context.testTMVerdict(context.tokenize('a')), 'acc');
});

test('import notes reach the machine card whole, never cut mid-word', () => {
  reset();
  // Enough warnings at once to overflow the card's blurb cap: a variable
  // expansion, a leftward scan, a second initial state and a block.
  context.importJFLAPText(`<structure><type>turing</type><automaton>
<state id="0" name="q0"><initial/></state>
<state id="1" name="q1"><initial/></state>
<block id="2" name="sub"><final/></block>
<transition><from>0</from><to>1</to><read>a, b } w</read><write>w</write><move>L</move></transition>
<transition><from>1</from><to>2</to><read/><write/><move>R</move></transition>
</automaton></structure>`);
  const blurb = context.App.meta.blurb;
  assert.ok(blurb.length <= context.CARD_BLURB_MAX, 'must fit the card');
  // The cap is what would otherwise sever the last note; every line that
  // survived has to be a whole one.
  blurb.split('\n').slice(1).forEach(line => {
    assert.match(line, /[.]$/, `note cut short: ${JSON.stringify(line)}`);
  });
});

test('a 4.x file still imports exactly as before', () => {
  reset();
  // No variable notation anywhere — the regression guard for the 6.1 work.
  const d = convert(`<structure><type>fa</type><automaton>
<state id="0" name="q0"><x>1</x><y>2</y><initial/></state>
<state id="1" name="q1"><x>3</x><y>4</y><final/></state>
<transition><from>0</from><to>1</to><read>a</read></transition>
<transition><from>1</from><to>1</to><read/></transition>
</automaton></structure>`);
  assert.equal(d.machine, 'ε-NFA');
  assert.deepEqual(d.sigma, ['a']);
  assert.equal(d.startId, 's0');
  assert.deepEqual(d.accepts, ['s1']);
  assert.deepEqual(d.warnings, []);
});
