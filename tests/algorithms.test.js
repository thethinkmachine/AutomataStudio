const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./harness');

function makeState(id, name) {
  return { id, name, x: 0, y: 0 };
}

function runGenericDFA(machine, input) {
  let cur = machine.startId;
  for (const sym of input) {
    const t = machine.transitions.find(tr => tr.from === cur && (tr.symbol ?? tr.sym) === sym);
    if (!t) return false;
    cur = t.to;
  }
  return (machine.accepts instanceof Set ? machine.accepts : new Set(machine.accepts)).has(cur);
}

function epsClosureOf(machine, seeds, eps = 'ε') {
  const seen = new Set(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const state = queue.shift();
    machine.transitions
      .filter(t => t.from === state && (t.symbol ?? t.sym) === eps)
      .forEach(t => {
        if (!seen.has(t.to)) {
          seen.add(t.to);
          queue.push(t.to);
        }
      });
  }
  return seen;
}

function runGenericNFA(machine, input, eps = 'ε') {
  let cur = epsClosureOf(machine, [machine.startId], eps);
  for (const sym of input) {
    const next = new Set();
    cur.forEach(state => {
      machine.transitions
        .filter(t => t.from === state && (t.symbol ?? t.sym) === sym)
        .forEach(t => next.add(t.to));
    });
    cur = epsClosureOf(machine, [...next], eps);
  }
  const accepts = machine.accepts instanceof Set ? machine.accepts : new Set(machine.accepts);
  return [...cur].some(state => accepts.has(state));
}

function configureAppMachine(h, config) {
  const { context } = h;
  h.resetApp();
  const App = context.App;
  App.machine = config.machine || 'DFA';
  App.sigma = new Set(config.sigma || []);
  App.states = config.states.map(s => ({ ...s }));
  App.transitions = config.transitions.map(t => ({ ...t }));
  App.startId = config.startId;
  App.accepts = new Set(config.accepts || []);
  App.stateN = App.states.length;
  App.transN = App.transitions.length;
  return App;
}

test('theme button icon reflects the active theme', () => {
  const h = createHarness();
  const btn = h.getElement('theme-btn');
  h.context.applyTheme('dark', false);
  assert.match(btn.innerHTML, /viewBox="0 0 24 24"/);
  assert.match(btn.innerHTML, /M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z/);

  h.context.applyTheme('light', false);
  assert.match(btn.innerHTML, /circle cx="12" cy="12" r="4"/);
});

test('PDA settings modal reflects the active formalism', () => {
  const h = createHarness();
  h.context.App.config.pdaParadigm = 'empty';
  h.context.openSettingsModal();
  assert.equal(h.getElement('set-pda-paradigm').value, 'empty');
});

test('workspace export preserves the PDA formalism setting', () => {
  const h = createHarness();
  h.context.App.config.pdaParadigm = 'empty';
  const data = h.context.getWorkspaceData();
  assert.equal(data.config.pdaParadigm, 'empty');
});

test('PDA simulation accepts by empty stack when that formalism is selected', () => {
  const h = createHarness();
  h.context.App.machine = 'PDA';
  h.context.App.config.pdaParadigm = 'empty';
  h.context.App.states = [makeState('s0', 'q0')];
  h.context.App.startId = 's0';
  h.context.App.accepts = new Set();
  h.context.simPDA([]);
  assert.equal(h.context.App.simSteps.at(-1).final, 'accept');
});

test('PDA batch testing works in final-state mode', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'PDA',
    sigma: ['a', 'b'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1'), makeState('s2', 'qa')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: 'a', pop: 'Z', push: 'Z' },
      { id: 't1', from: 's1', to: 's2', symbol: 'b', pop: 'Z', push: 'Z' }
    ],
    startId: 's0',
    accepts: ['s2']
  });
  h.context.App.config.pdaParadigm = 'explicit';
  h.getElement('batch-in').value = 'ab\na';
  h.context.runBatch();
  const html = h.getElement('batch-result').innerHTML;
  assert.match(html, /✓ "ab"/);
  assert.match(html, /✗ "a"/);
});

test('PDA batch testing works in empty-stack mode', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'PDA',
    sigma: ['a', 'b'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: 'a', pop: 'ε', push: 'Z' },
      { id: 't1', from: 's1', to: 's1', symbol: 'b', pop: 'Z', push: 'ε' }
    ],
    startId: 's0',
    accepts: []
  });
  h.context.App.config.pdaParadigm = 'empty';
  h.getElement('batch-in').value = 'ab\naba';
  h.context.runBatch();
  const html = h.getElement('batch-result').innerHTML;
  assert.match(html, /✓ "ab"/);
  assert.match(html, /✗ "aba"/);
});

test('subset construction handles epsilon cycles and marks accepting subsets', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'ε-NFA',
    sigma: ['a', 'b'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1'), makeState('s2', 'q2')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: 'ε' },
      { id: 't1', from: 's1', to: 's0', symbol: 'ε' },
      { id: 't2', from: 's1', to: 's2', symbol: 'a' },
      { id: 't3', from: 's2', to: 's2', symbol: 'b' }
    ],
    startId: 's0',
    accepts: ['s2']
  });

  const result = h.context.subsetConstruction();
  assert.equal(result.states.length, 2);
  assert.equal(result.states[0].name, '{q0,q1}');
  assert.equal(result.trans[0].to, '{q2}');
  assert.equal(result.states.find(s => s.name === '{q2}').isAcc, true);
});

test('DFA minimization drops unreachable states before grouping', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'DFA',
    sigma: ['a'],
    states: [makeState('s0', 'A'), makeState('s1', 'B'), makeState('s2', 'C')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: 'a' },
      { id: 't1', from: 's1', to: 's1', symbol: 'a' },
      { id: 't2', from: 's2', to: 's2', symbol: 'a' }
    ],
    startId: 's0',
    accepts: ['s1']
  });

  const result = h.context.tableFillingMinimize();
  assert.equal(result.savedStates.length, 2);
  assert.equal(JSON.stringify(result.groups.map(g => [...g].sort())), JSON.stringify([['s0'], ['s1']]));
  assert.match(result.steps[0].html, /Discard 1 unreachable state/);
});

test('regex parser rejects trailing junk instead of silently truncating', () => {
  const h = createHarness();
  assert.throws(() => h.context.parseRE('a)'), /Unexpected token '\)'/);
  assert.throws(() => h.context.parseRE('(ab))'), /Unexpected token '\)'/);
});

test('Thompson construction preserves epsilon language for optional regex', () => {
  const h = createHarness();
  const nfa = h.context.thompsonBuild('a?');
  assert.equal(runGenericNFA({
    startId: nfa.start,
    transitions: nfa.trans,
    accepts: [nfa.accept]
  }, ''), true);
  assert.equal(runGenericNFA({
    startId: nfa.start,
    transitions: nfa.trans,
    accepts: [nfa.accept]
  }, 'a'), true);
  assert.equal(runGenericNFA({
    startId: nfa.start,
    transitions: nfa.trans,
    accepts: [nfa.accept]
  }, 'aa'), false);
});

test('GNFA elimination derives the expected regex for a one-edge automaton', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'NFA',
    sigma: ['a'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1')],
    transitions: [{ id: 't0', from: 's0', to: 's1', symbol: 'a' }],
    startId: 's0',
    accepts: ['s1']
  });
  assert.equal(h.context.deriveRegex(), 'a');
});

test('product construction uses trap states for alphabet mismatches', () => {
  const h = createHarness();
  const product = h.context.buildProductDFA(
    {
      machine: 'DFA',
      sigma: ['a'],
      states: [makeState('s0', 'p')],
      transitions: [{ id: 't0', from: 's0', to: 's0', symbol: 'a' }],
      startId: 's0',
      accepts: ['s0']
    },
    {
      machine: 'DFA',
      sigma: ['b'],
      states: [makeState('t0', 'q')],
      transitions: [{ id: 'u0', from: 't0', to: 't0', symbol: 'b' }],
      startId: 't0',
      accepts: []
    },
    'union'
  );

  assert.equal(JSON.stringify([...product.sigma].sort()), JSON.stringify(['a', 'b']));
  assert.ok(product.transitions.some(t => t.to.includes('__trap2__') && t.symbol === 'a'));
});

test('decision procedures distinguish useful cycles from unreachable cycles', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'DFA',
    sigma: ['a', 'b'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1'), makeState('s2', 'dead'), makeState('s3', 'iso')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: 'a' },
      { id: 't1', from: 's0', to: 's2', symbol: 'b' },
      { id: 't2', from: 's1', to: 's1', symbol: 'a' },
      { id: 't3', from: 's1', to: 's2', symbol: 'b' },
      { id: 't4', from: 's2', to: 's2', symbol: 'a' },
      { id: 't5', from: 's2', to: 's2', symbol: 'b' },
      { id: 't6', from: 's3', to: 's3', symbol: 'a' },
      { id: 't7', from: 's3', to: 's3', symbol: 'b' }
    ],
    startId: 's0',
    accepts: ['s1']
  });

  const classes = h.context.computeStateClassification();
  assert.equal(classes.get('s0'), 'live');
  assert.equal(classes.get('s1'), 'live');
  assert.equal(classes.get('s2'), 'dead');
  assert.equal(classes.get('s3'), 'unreachable');
  assert.equal(h.context.hasReachableCycle(new Set(['s0', 's1'])), true);
  assert.equal(h.context.hasReachableCycle(new Set(['s2'])), true);
});

test('NDTM simulation tokenizes input and supports wildcard plus stay transitions', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'TM',
    sigma: ['aa'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: 'aa', write: 'Σ', dir: 'S' }
    ],
    startId: 's0',
    accepts: ['s1']
  });

  const result = h.context.simNDTM(['aa']);
  assert.equal(result.accepted, true);
});

test('UTM simulator accepts, rejects, and reports loops correctly', () => {
  const h = createHarness();
  const acceptTM = {
    states: ['q0', 'qa'],
    start: 'q0',
    accept: ['qa'],
    transitions: [{ from: 'q0', read: '1', write: '1', dir: 'R', to: 'qa' }]
  };
  const rejectTM = {
    states: ['q0'],
    start: 'q0',
    accept: [],
    transitions: []
  };
  const loopTM = {
    states: ['q0'],
    start: 'q0',
    accept: [],
    transitions: [{ from: 'q0', read: '⊔', write: '⊔', dir: 'R', to: 'q0' }]
  };

  let steps = h.context.simUTM(acceptTM, '1');
  assert.equal(steps.at(-1).final, 'accept');

  steps = h.context.simUTM(rejectTM, '');
  assert.equal(steps.at(-1).final, 'reject');

  h.context.App.config.maxTmSteps = 3;
  steps = h.context.simUTM(loopTM, '');
  assert.equal(steps.at(-1).final, 'loop');
});

test('Moore to Mealy conversion labels outputs on destination transitions', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'Moore',
    sigma: ['a'],
    states: [
      { ...makeState('s0', 'q0'), output: '0' },
      { ...makeState('s1', 'q1'), output: '1' }
    ],
    transitions: [{ id: 't0', from: 's0', to: 's1', symbol: 'a' }],
    startId: 's0',
    accepts: []
  });

  h.context.loadMooreAsMealy();
  assert.equal(h.context.App.machine, 'Mealy');
  assert.equal(h.context.App.transitions[0].output, '1');
});

test('Mealy to Moore splits start state when it has incoming outputs', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'Mealy',
    sigma: ['a', 'b'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: 'a', output: 'x' },
      { id: 't1', from: 's1', to: 's0', symbol: 'b', output: 'y' }
    ],
    startId: 's0',
    accepts: ['s0']
  });

  const result = h.context.computeMealy2Moore();
  const startCopies = result.states.filter(s => s.origId === 's0');
  assert.equal(startCopies.length, 2);
  assert.ok(startCopies.some(s => s.output === ''));
  assert.ok(startCopies.some(s => s.output === 'y'));
});

test('TM to grammar rejects MTM and seeds Sigma-star in the start productions', () => {
  const h = createHarness();
  const card = h.getElement('algo-content');

  configureAppMachine(h, {
    machine: 'MTM',
    sigma: ['a'],
    states: [makeState('s0', 'q0')],
    transitions: [],
    startId: 's0',
    accepts: []
  });
  h.context.algoTM2Grammar(card);
  assert.match(card.innerHTML, /supports only single-tape TMs/);

  configureAppMachine(h, {
    machine: 'TM',
    sigma: ['a', 'b'],
    states: [makeState('s0', 'q0'), makeState('s1', 'qa')],
    transitions: [{ id: 't0', from: 's0', to: 's1', symbol: 'a', write: 'a', dir: 'R' }],
    startId: 's0',
    accepts: ['s1']
  });
  h.context.algoTM2Grammar(card);
  assert.match(card.innerHTML, /⟨W⟩/);
  assert.match(card.innerHTML, /a ⟨W⟩/);
  assert.match(card.innerHTML, /b ⟨W⟩/);
});

test('right-linear and left-linear regular grammars load into equivalent automata', () => {
  const h = createHarness();
  h.getElement('rg-input').value = 'S → aA | ε\nA → b';
  h.getElement('rg-start').value = 'S';
  h.context.buildRG2NFA();
  h.context.loadRG2NFAToCanvas();
  assert.equal(h.context.App.machine, 'ε-NFA');
  assert.equal(h.context.testNFA(['a', 'b']), true);
  assert.equal(h.context.testNFA([]), true);

  h.resetApp();
  h.getElement('rg-input').value = 'S → ε | Aa\nA → b';
  h.getElement('rg-start').value = 'S';
  h.context.buildRG2NFA();
  h.context.loadRG2NFAToCanvas();
  assert.equal(h.context.testNFA(['b', 'a']), true);
  assert.equal(h.context.testNFA(['a', 'b']), false);
});

test('DFA to regular grammar includes epsilon productions for accepting states', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'DFA',
    sigma: ['a'],
    states: [makeState('s0', 'S'), makeState('s1', 'A')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: 'a' },
      { id: 't1', from: 's1', to: 's1', symbol: 'a' }
    ],
    startId: 's0',
    accepts: ['s1']
  });
  const card = h.getElement('algo-content');
  h.context.algoDFA2RG(card);
  assert.match(card.innerHTML, />ε<\/td>/);
  assert.match(card.innerHTML, />S<\/td><td style="color:var\(--text3\)">→<\/td><td>a/);
});

test('closure constructors preserve their intended languages on sample inputs', () => {
  const h = createHarness();
  const m1 = {
    machine: 'NFA',
    sigma: ['a'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1')],
    transitions: [{ id: 't0', from: 's0', to: 's1', symbol: 'a' }],
    startId: 's0',
    accepts: ['s1']
  };
  const star = h.context.buildNFAStar(m1);
  assert.equal(runGenericNFA(star, ''), true);
  assert.equal(runGenericNFA(star, 'a'), true);
  assert.equal(runGenericNFA(star, 'aa'), true);

  const reversal = h.context.buildNFAReversal({
    ...m1,
    sigma: ['a', 'b'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1'), makeState('s2', 'q2')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: 'a' },
      { id: 't1', from: 's1', to: 's2', symbol: 'b' }
    ],
    accepts: ['s2']
  });
  assert.equal(runGenericNFA(reversal, 'ba'), true);

  const union = h.context.buildNFAUnion(m1, {
    machine: 'NFA',
    sigma: ['b'],
    states: [makeState('t0', 'p0'), makeState('t1', 'p1')],
    transitions: [{ id: 'u0', from: 't0', to: 't1', symbol: 'b' }],
    startId: 't0',
    accepts: ['t1']
  });
  assert.equal(runGenericNFA(union, 'a'), true);
  assert.equal(runGenericNFA(union, 'b'), true);

  const concat = h.context.buildNFAConcat(m1, {
    machine: 'NFA',
    sigma: ['b'],
    states: [makeState('t0', 'p0'), makeState('t1', 'p1')],
    transitions: [{ id: 'u0', from: 't0', to: 't1', symbol: 'b' }],
    startId: 't0',
    accepts: ['t1']
  });
  assert.equal(runGenericNFA(concat, 'ab'), true);
  assert.equal(runGenericNFA(concat, 'a'), false);
});

test('universality, emptiness, and finiteness render correct classifications', () => {
  const h = createHarness();
  const card = h.getElement('algo-content');
  configureAppMachine(h, {
    machine: 'DFA',
    sigma: ['a'],
    states: [makeState('s0', 'q0')],
    transitions: [{ id: 't0', from: 's0', to: 's0', symbol: 'a' }],
    startId: 's0',
    accepts: ['s0']
  });
  h.context.algoIsUniversal(card);
  assert.match(card.innerHTML, /UNIVERSAL/);

  configureAppMachine(h, {
    machine: 'DFA',
    sigma: ['a'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1')],
    transitions: [{ id: 't0', from: 's0', to: 's0', symbol: 'a' }],
    startId: 's0',
    accepts: ['s1']
  });
  h.context.algoIsEmpty(card);
  assert.match(card.innerHTML, /EMPTY ∅/);

  configureAppMachine(h, {
    machine: 'DFA',
    sigma: ['a'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: 'a' },
      { id: 't1', from: 's1', to: 's1', symbol: 'a' }
    ],
    startId: 's0',
    accepts: ['s1']
  });
  h.context.algoIsFinite(card);
  assert.match(card.innerHTML, /INFINITE/);
});
