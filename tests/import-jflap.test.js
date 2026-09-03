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

// ── building blocks ───────────────────────────────────────────────
// A JFLAP <block> is this app's building block seen from the other side: an
// interior automaton entered at its own start state and left from the states
// it halts in. The two models line up, so the interior is expanded rather than
// dropped — and the machine is flat afterwards, exactly as js/blocks.js keeps
// it, with the block a *grouping* over it.

// One block with two halting states, wired in and out at the top level.
const TM_BLOCK = `<structure><type>turing</type><automaton>
<state id="0" name="q0"><x>0</x><y>0</y><initial/></state>
<state id="2" name="q2"><x>400</x><y>0</y><final/></state>
<block id="1" name="cmp"><x>200</x><y>0</y>
  <structure><type>turing</type><automaton>
    <state id="0" name="scan"><x>0</x><y>0</y><initial/></state>
    <state id="1" name="equal"><x>50</x><y>0</y><final/></state>
    <state id="2" name="differ"><x>50</x><y>50</y><final/></state>
    <transition><from>0</from><to>1</to><read>a</read><write>a</write><move>R</move></transition>
    <transition><from>0</from><to>2</to><read>b</read><write>b</write><move>R</move></transition>
  </automaton></structure>
</block>
<transition><from>0</from><to>1</to><read>a</read><write>a</write><move>R</move></transition>
<transition><from>1</from><to>2</to><read>c</read><write>c</write><move>R</move></transition>
</automaton></structure>`;

test('a building block is expanded, and the machine stays flat', () => {
  reset();
  const d = convert(TM_BLOCK);
  // Two outer states plus the block's three: every interior state is a state
  // of the machine, which is what keeps every simulator and exporter working.
  assert.equal(d.states.length, 5);
  assert.equal(d.blocks.length, 1);
  const b = d.blocks[0];
  assert.equal(b.parent, null);
  const byId = new Map(d.states.map(s => [s.id, s]));
  // The interior belongs to the block and carries the path as its name.
  const inside = d.states.filter(s => s.blockId === b.id);
  assert.equal(inside.length, 3);
  assert.deepEqual(inside.map(s => s.name).sort(), ['cmp/differ', 'cmp/equal', 'cmp/scan']);
  assert.equal(byId.get(b.entry).name, 'cmp/scan');
  // Exits default to the interior's halting states — one per answer.
  assert.deepEqual(b.exits.map(e => e.label).sort(), ['differ', 'equal']);
  // A block finishing is not the machine accepting: only the outer <final/>
  // state is in F.
  assert.deepEqual(d.accepts.map(id => byId.get(id).name), ['q2']);
});

test('an edge into a block lands on its entry, and one out leaves from every exit', () => {
  reset();
  const d = convert(TM_BLOCK);
  const byId = new Map(d.states.map(s => [s.id, s]));
  const named = d.transitions.map(t => `${byId.get(t.from).name}->${byId.get(t.to).name}`);
  assert.ok(named.includes('q0->cmp/scan'), 'the incoming edge is wired to the entry');
  // JFLAP's block has one implicit exit — reaching any final state hands
  // control on — so the outgoing edge is one edge per exit here.
  assert.ok(named.includes('cmp/equal->q2'));
  assert.ok(named.includes('cmp/differ->q2'));
});

test('a block marked initial or final travels as its entry and its exits', () => {
  reset();
  const d = convert(`<structure><type>turing</type><automaton>
<block id="0" name="sub"><x>0</x><y>0</y><initial/><final/>
  <structure><type>turing</type><automaton>
    <state id="0" name="go"><initial/></state>
    <state id="1" name="done"><final/></state>
    <transition><from>0</from><to>1</to><read>a</read><write>a</write><move>R</move></transition>
  </automaton></structure>
</block>
</automaton></structure>`);
  const byId = new Map(d.states.map(s => [s.id, s]));
  assert.equal(byId.get(d.startId).name, 'sub/go', 'starting in a block starts at its entry');
  assert.deepEqual(d.accepts.map(id => byId.get(id).name), ['sub/done'],
    'a block marked final accepts where it halts');
});

test('blocks nest, and the names accumulate into a path', () => {
  reset();
  const d = convert(`<structure><type>turing</type><automaton>
<state id="0" name="q0"><initial/></state>
<block id="1" name="alu"><x>0</x><y>0</y>
  <structure><type>turing</type><automaton>
    <block id="0" name="add"><x>10</x><y>10</y>
      <structure><type>turing</type><automaton>
        <state id="0" name="scan"><initial/></state>
        <state id="1" name="done"><final/></state>
        <transition><from>0</from><to>1</to><read>a</read><write>a</write><move>R</move></transition>
      </automaton></structure>
    </block>
  </automaton></structure>
</block>
<transition><from>0</from><to>1</to><read>a</read><write>a</write><move>R</move></transition>
</automaton></structure>`);
  assert.equal(d.blocks.length, 2);
  const outer = d.blocks.find(b => b.name === 'alu');
  const inner = d.blocks.find(b => b.name === 'add');
  assert.equal(inner.parent, outer.id, 'containment is a tree');
  assert.ok(d.states.some(s => s.name === 'alu/add/scan'),
    'one prefix per level accumulates into the path');
});

// This is what JFLAP 6.1 actually writes, and it is the shape jflap.org's own
// building-block samples are in — replaceAsWithXs.jff, asfirst.jff, countas.jff,
// duplicateString.jff. Three things about it are easy to read literally and get
// silently wrong: where the interior lives, `~`, and a bare `!A`.
const TM_61_BLOCKS = `<!--Created with JFLAP 6.1.--><structure>
<type>turing</type>
<automaton>
  <state id="0" name="q0"><x>44</x><y>46</y><initial/></state>
  <state id="1" name="q1"><x>142</x><y>225</y></state>
  <block id="2" name="rightUntilA"><tag>rightUntilA.jff</tag><x>149</x><y>106</y></block>
  <block id="3" name="goBack"><tag>goBack.jff</tag><x>472</x><y>108</y><final/></block>
  <transition><from>0</from><to>2</to><read>~</read><write>~</write><move>L</move></transition>
  <transition><from>2</from><to>1</to><read>A</read><write>X</write><move>S</move></transition>
  <transition><from>1</from><to>3</to><read>~</read><write>~</write><move>S</move></transition>
  <!--The list of automata-->
  <rightUntilA.jff>
    <state id="0" name="go"><initial/></state>
    <state id="1" name="found"><final/></state>
    <transition><from>0</from><to>0</to><read>!A</read><write>~</write><move>R</move></transition>
    <transition><from>0</from><to>1</to><read>A</read><write>A</write><move>S</move></transition>
  </rightUntilA.jff>
  <goBack.jff>
    <state id="0" name="left"><initial/></state>
    <state id="1" name="home"><final/></state>
    <transition><from>0</from><to>0</to><read>!□</read><write>~</write><move>L</move></transition>
    <transition><from>0</from><to>1</to><read/><write/><move>R</move></transition>
  </goBack.jff>
</automaton>
</structure>`;

test("6.1 keeps a block's interior inside <automaton>, under the block's tag", () => {
  reset();
  // The tag is a *reference*, not containment — and where the referenced
  // element sits differs between writers, so both places are searched. Read as
  // containment, every one of jflap.org's own samples finds no interior and
  // degrades to a plain state.
  const d = convert(TM_61_BLOCKS);
  assert.equal(d.blocks.length, 2);
  assert.deepEqual(d.blocks.map(b => b.name), ['rightUntilA', 'goBack']);
  assert.ok(d.states.some(s => s.name === 'rightUntilA/go'));
  const byId = new Map(d.states.map(s => [s.id, s]));
  // In at the entry, out of the exit — with the outer edge's own read/write.
  const into = d.transitions.find(t => byId.get(t.from).name === 'q0');
  assert.equal(byId.get(into.to).name, 'rightUntilA/go');
  const outOf = d.transitions.find(t => byId.get(t.from).name === 'rightUntilA/found');
  assert.equal(outOf.symbol, 'A');
  assert.equal(outOf.write, 'X');
  // The block marked <final/> is where halting accepts.
  assert.deepEqual(d.accepts.map(id => byId.get(id).name), ['goBack/home']);
});

test('`~` is the wildcard, not a tape symbol named "~"', () => {
  reset();
  const d = convert(TM_61_BLOCKS);
  const any = context.App.config.sym.any;
  const into = d.transitions.find(t => t.symbol === any);
  assert.ok(into, 'the wildcard read is Σ');
  assert.equal(into.write, any, 'and writing it back is what `~` as a write means');
  // The whole failure mode: read literally, "~" is a tape symbol no cell can
  // hold, so the edge draws and matches nothing.
  for (const alphabet of [d.sigma, d.stackAlpha]) {
    assert.ok(!alphabet.includes('~'), `"~" reached ${JSON.stringify(alphabet)}`);
    assert.ok(!alphabet.includes(any), 'the wildcard stands for the alphabet, it is not in it');
  }
});

test('a bare `!A` is a negation, and expands once Σ is known', () => {
  reset();
  const d = convert(TM_61_BLOCKS);
  const byId = new Map(d.states.map(s => [s.id, s]));
  const loops = d.transitions.filter(t => t.from === t.to && byId.get(t.from).name === 'rightUntilA/go');
  // Γ here is {A, X, ⊔}; "anything but A" is X, and `<write>~</write>` puts it
  // back. Read literally, "!A" is a two-character symbol nothing matches.
  assert.deepEqual(loops.map(t => t.symbol), ['X']);
  loops.forEach(t => assert.equal(t.write, t.symbol));
  assert.ok(!d.stackAlpha.some(s => s.startsWith('!')), 'no "!A" in Γ');
});

test("JFLAP's own shape: an interior beside <automaton>, named by the block's tag", () => {
  reset();
  // This is what JFLAP actually writes. createBlockElement() puts a <tag> on
  // the block and createAutomatonElement() appends the interior to the
  // *document element*, named by that tag — so the tag is a reference into the
  // file rather than containment. Two blocks may therefore share one interior,
  // and each placement is its own copy.
  const d = convert(`<structure><type>turing</type>
<automaton>
  <block id="0" name="left"><tag>step</tag><x>0</x><y>0</y><initial/></block>
  <block id="1" name="right"><tag>step</tag><x>200</x><y>0</y></block>
  <state id="2" name="done"><x>400</x><y>0</y><final/></state>
  <transition block="true"><from>0</from><to>1</to><read>a</read></transition>
  <transition block="true"><from>1</from><to>2</to><read>a</read></transition>
</automaton>
<step>
  <state id="0" name="go"><initial/></state>
  <state id="1" name="out"><final/></state>
  <transition><from>0</from><to>1</to><read>a</read><write>a</write><move>R</move></transition>
</step>
</structure>`);
  assert.equal(d.blocks.length, 2, 'one placement each, from one interior');
  assert.equal(d.states.length, 5);
  assert.deepEqual(d.states.map(s => s.name).sort(),
    ['done', 'left/go', 'left/out', 'right/go', 'right/out']);
  // An edge between blocks carries a read and nothing else: leaving a block
  // writes back what it read and does not move.
  const byId = new Map(d.states.map(s => [s.id, s]));
  const out = d.transitions.find(t => byId.get(t.from).name === 'left/out');
  assert.equal(out.write, out.symbol);
  assert.equal(out.dir, 'S');
  assert.equal(byId.get(out.to).name, 'right/go', 'and it lands on the next block\'s entry');
});

test('a tag naming nothing is the 4.x arrangement, and falls back to a state', () => {
  reset();
  // JFLAP 4.x kept a block's interior in a separate .jff the file only points
  // at — jflap.org's own TMBBexamples are written this way.
  const d = convert(`<structure><type>turing</type><automaton>
<state id="0" name="q0"><initial/></state>
<block id="1" name="R"><tag>R.jff</tag><x>10</x><y>10</y><final/></block>
<transition block="true"><from>0</from><to>1</to><read>a</read></transition>
</automaton></structure>`);
  assert.equal(d.states.length, 2);
  assert.equal(d.blocks.length, 0);
  assert.ok(d.warnings.some(w => /no interior/.test(w)));
});

test('a box gets the room a circle did not need', () => {
  reset();
  // JFLAP drew the block as a node the size of a state; here it is a box about
  // four times that footprint, so the file's own layout arrives with the box
  // painted over its neighbours and the edges running under it — the diagram
  // hidden behind the thing meant to summarise it.
  context.importJFLAPText(TM_61_BLOCKS);
  const nodes = context.viewStates();
  const rOf = n => (n.box ? Math.hypot(n.box.w, n.box.h) / 2 : context.R);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= rOf(a) + rOf(b),
        `${a.name} and ${b.name} overlap`);
    }
  }
});

test('an import with no blocks keeps the author’s coordinates exactly', () => {
  reset();
  // The separation is the one place the import moves anything the file placed,
  // so it is gated on there being a box to make room for.
  context.importJFLAPText(`<structure><type>fa</type><automaton>
<state id="0" name="q0"><x>44</x><y>46</y><initial/></state>
<state id="1" name="q1"><x>60</x><y>50</y><final/></state>
<transition><from>0</from><to>1</to><read>a</read></transition>
</automaton></structure>`);
  // Deliberately closer together than the collision pass would allow.
  assert.deepEqual(context.App.states.map(s => [s.x, s.y]), [[44, 46], [60, 50]]);
});

test('a block with no interior still imports as a plain state', () => {
  reset();
  const d = convert(`<structure><type>turing</type><automaton>
<state id="0" name="q0"><initial/></state>
<block id="1" name="sub"><x>10</x><y>10</y><final/></block>
<transition><from>0</from><to>1</to><read>a</read><write>a</write><move>R</move></transition>
</automaton></structure>`);
  assert.equal(d.states.length, 2);
  assert.equal(d.blocks.length, 0);
  assert.ok(d.warnings.some(w => /no interior/.test(w)));
});

test('a family that cannot have blocks keeps every state and loses only the box', () => {
  reset();
  // Blocks need a stay move to leave without eating a symbol, so an FA has
  // none — but inlining is the semantics, so nothing about the machine is lost.
  const d = convert(`<structure><type>fa</type><automaton>
<state id="0" name="q0"><initial/></state>
<block id="1" name="sub"><x>0</x><y>0</y><final/>
  <structure><type>fa</type><automaton>
    <state id="0" name="in"><initial/></state>
    <state id="1" name="out"><final/></state>
    <transition><from>0</from><to>1</to><read>b</read></transition>
  </automaton></structure>
</block>
<transition><from>0</from><to>1</to><read>a</read></transition>
</automaton></structure>`);
  assert.equal(d.states.length, 3);
  assert.equal(d.blocks.length, 0);
  assert.ok(d.states.every(s => s.blockId === undefined), 'no state claims a block that has gone');
  assert.ok(d.warnings.some(w => /does not have blocks/.test(w)));
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
