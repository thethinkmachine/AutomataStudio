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
  App.stackAlpha = new Set(config.stackAlpha || [App.config.sym.stackBottom]);
  App.outputAlpha = new Set(config.outputAlpha || []);
  if (typeof config.tapeCount === 'number') App.tapeCount = config.tapeCount;
  App.states = config.states.map(s => ({ ...s }));
  App.transitions = config.transitions.map(t => ({ ...t }));
  App.startId = config.startId;
  App.accepts = new Set(config.accepts || []);
  App.stateN = App.states.length;
  App.transN = App.transitions.length;
  return App;
}

function configureGrammar(h, grammar) {
  const App = h.context.App;
  App.grammar.vars = new Set(grammar.vars || []);
  App.grammar.start = grammar.start || '';
  App.grammar.productions = (grammar.productions || []).map(p => ({ ...p }));
}

function setSingleTapeTransitionForm(h, values) {
  h.getElement('m-from').value = values.from;
  h.getElement('m-to').value = values.to;
  h.getElement('m-sym').value = values.symbol;
  h.getElement('m-write').value = values.write;
  h.getElement('m-dir').value = values.dir;
}

function setStackTransitionForm(h, values) {
  h.getElement('m-from').value = values.from;
  h.getElement('m-to').value = values.to;
  h.getElement('m-sym').value = values.symbol;
  h.getElement('m-pop').value = values.pop;
  h.getElement('m-push').value = values.push;
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

test('PDA simulation honors epsilon-pop transitions in explicit mode', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'PDA',
    sigma: ['a'],
    states: [makeState('s0', 'q0'), makeState('s1', 'qa')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: 'a', pop: 'ε', push: 'ε' }
    ],
    startId: 's0',
    accepts: ['s1']
  });
  h.context.App.config.pdaParadigm = 'explicit';
  h.context.simPDA(['a']);
  assert.equal(h.context.App.simSteps.at(-1).final, 'accept');
});

test('TM stays deterministic while NDTM allows duplicate read choices', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'TM',
    sigma: ['0'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1'), makeState('s2', 'q2')],
    transitions: [],
    startId: 's0',
    accepts: []
  });
  setSingleTapeTransitionForm(h, { from: 's0', to: 's1', symbol: '0', write: '0', dir: 'R' });
  h.context.confirmTrans();
  setSingleTapeTransitionForm(h, { from: 's0', to: 's2', symbol: '0', write: '0', dir: 'R' });
  h.context.confirmTrans();
  assert.equal(h.context.App.transitions.length, 1);

  configureAppMachine(h, {
    machine: 'NDTM',
    sigma: ['0'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1'), makeState('s2', 'q2')],
    transitions: [],
    startId: 's0',
    accepts: []
  });
  setSingleTapeTransitionForm(h, { from: 's0', to: 's1', symbol: '0', write: '0', dir: 'R' });
  h.context.confirmTrans();
  setSingleTapeTransitionForm(h, { from: 's0', to: 's2', symbol: '0', write: '0', dir: 'S' });
  h.context.confirmTrans();
  assert.equal(h.context.App.transitions.length, 2);
});

test('PDA stays deterministic while NPDA allows overlapping stack moves', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'PDA',
    sigma: ['a'],
    stackAlpha: ['A', 'Z'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1'), makeState('s2', 'q2')],
    transitions: [],
    startId: 's0',
    accepts: []
  });
  setStackTransitionForm(h, { from: 's0', to: 's1', symbol: 'a', pop: 'Z', push: 'AZ' });
  h.context.confirmTrans();
  setStackTransitionForm(h, { from: 's0', to: 's2', symbol: 'ε', pop: 'Z', push: 'Z' });
  h.context.confirmTrans();
  assert.equal(h.context.App.transitions.length, 1);

  configureAppMachine(h, {
    machine: 'NPDA',
    sigma: ['a'],
    stackAlpha: ['A', 'Z'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1'), makeState('s2', 'q2')],
    transitions: [],
    startId: 's0',
    accepts: []
  });
  setStackTransitionForm(h, { from: 's0', to: 's1', symbol: 'a', pop: 'Z', push: 'AZ' });
  h.context.confirmTrans();
  setStackTransitionForm(h, { from: 's0', to: 's2', symbol: 'ε', pop: 'Z', push: 'Z' });
  h.context.confirmTrans();
  assert.equal(h.context.App.transitions.length, 2);
});

test('NPDA simulation finds an accepting branch for midpoint guessing', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'NPDA',
    sigma: ['a', 'b'],
    stackAlpha: ['A', 'B', 'Z'],
    states: [makeState('s0', 'push'), makeState('s1', 'pop'), makeState('s2', 'acc')],
    transitions: [
      { id: 't1', from: 's0', to: 's0', symbol: 'a', pop: 'Z', push: 'AZ' },
      { id: 't2', from: 's0', to: 's0', symbol: 'a', pop: 'A', push: 'AA' },
      { id: 't3', from: 's0', to: 's0', symbol: 'a', pop: 'B', push: 'AB' },
      { id: 't4', from: 's0', to: 's0', symbol: 'b', pop: 'Z', push: 'BZ' },
      { id: 't5', from: 's0', to: 's0', symbol: 'b', pop: 'A', push: 'BA' },
      { id: 't6', from: 's0', to: 's0', symbol: 'b', pop: 'B', push: 'BB' },
      { id: 't7', from: 's0', to: 's1', symbol: 'ε', pop: 'Z', push: 'Z' },
      { id: 't8', from: 's0', to: 's1', symbol: 'ε', pop: 'A', push: 'A' },
      { id: 't9', from: 's0', to: 's1', symbol: 'ε', pop: 'B', push: 'B' },
      { id: 't10', from: 's1', to: 's1', symbol: 'a', pop: 'A', push: 'ε' },
      { id: 't11', from: 's1', to: 's1', symbol: 'b', pop: 'B', push: 'ε' },
      { id: 't12', from: 's1', to: 's2', symbol: 'ε', pop: 'Z', push: 'Z' }
    ],
    startId: 's0',
    accepts: ['s2']
  });
  h.context.App.config.pdaParadigm = 'explicit';
  const result = h.context.simNPDA(['a', 'b', 'b', 'a']);
  assert.equal(result.accepted, true);
  assert.equal(h.context.App.simSteps.at(-1).final, 'accept');
  assert.match(h.context.App.simSteps.at(-1).note, /ACCEPT/);
});

test('NPDA batch testing explores branching paths', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'NPDA',
    sigma: ['a', 'b'],
    stackAlpha: ['A', 'B', 'Z'],
    states: [makeState('s0', 'push'), makeState('s1', 'pop'), makeState('s2', 'acc')],
    transitions: [
      { id: 't1', from: 's0', to: 's0', symbol: 'a', pop: 'Z', push: 'AZ' },
      { id: 't2', from: 's0', to: 's0', symbol: 'a', pop: 'A', push: 'AA' },
      { id: 't3', from: 's0', to: 's0', symbol: 'a', pop: 'B', push: 'AB' },
      { id: 't4', from: 's0', to: 's0', symbol: 'b', pop: 'Z', push: 'BZ' },
      { id: 't5', from: 's0', to: 's0', symbol: 'b', pop: 'A', push: 'BA' },
      { id: 't6', from: 's0', to: 's0', symbol: 'b', pop: 'B', push: 'BB' },
      { id: 't7', from: 's0', to: 's1', symbol: 'ε', pop: 'Z', push: 'Z' },
      { id: 't8', from: 's0', to: 's1', symbol: 'ε', pop: 'A', push: 'A' },
      { id: 't9', from: 's0', to: 's1', symbol: 'ε', pop: 'B', push: 'B' },
      { id: 't10', from: 's1', to: 's1', symbol: 'a', pop: 'A', push: 'ε' },
      { id: 't11', from: 's1', to: 's1', symbol: 'b', pop: 'B', push: 'ε' },
      { id: 't12', from: 's1', to: 's2', symbol: 'ε', pop: 'Z', push: 'Z' }
    ],
    startId: 's0',
    accepts: ['s2']
  });
  h.context.App.config.pdaParadigm = 'explicit';
  h.getElement('batch-in').value = 'abba\nabab';
  h.context.runBatch();
  const html = h.getElement('batch-result').innerHTML;
  assert.match(html, /✓ "abba"|âœ“ "abba"/);
  assert.match(html, /✗ "abab"|âœ— "abab"/);
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
    machine: 'NDTM',
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
  assert.equal(h.context.App.simSteps.at(-1).final, 'accept');
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

  configureAppMachine(h, {
    machine: 'NDTM',
    sigma: ['a'],
    states: [makeState('s0', 'q0'), makeState('s1', 'qa')],
    transitions: [
      { id: 't0', from: 's0', to: 's0', symbol: 'a', write: 'a', dir: 'R' },
      { id: 't1', from: 's0', to: 's1', symbol: 'a', write: 'a', dir: 'S' }
    ],
    startId: 's0',
    accepts: ['s1']
  });
  h.context.algoTM2Grammar(card);
  assert.match(card.innerHTML, /Generated Type 0 Productions/);
});

test('workspace validation accepts NDTM as a machine type', () => {
  const h = createHarness();
  assert.doesNotThrow(() => h.context.validateSchema({
    machine: 'NDTM',
    sigma: ['0', '1'],
    states: [],
    transitions: [],
    accepts: [],
    tapeCount: 1
  }));
});

test('workspace validation accepts NPDA as a machine type', () => {
  const h = createHarness();
  assert.doesNotThrow(() => h.context.validateSchema({
    machine: 'NPDA',
    sigma: ['a', 'b'],
    stackAlpha: ['A', 'Z'],
    states: [],
    transitions: [],
    accepts: []
  }));
});

test('loading a legacy TM with duplicate read choices upgrades it to NDTM', () => {
  const h = createHarness();
  h.context.loadData({
    machine: 'TM',
    sigma: ['0'],
    stackAlpha: ['0', '⊔'],
    tapeCount: 1,
    states: [makeState('s0', 'q0'), makeState('s1', 'q1'), makeState('s2', 'q2')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: '0', write: '0', dir: 'R' },
      { id: 't1', from: 's0', to: 's2', symbol: '0', write: '0', dir: 'S' }
    ],
    startId: 's0',
    accepts: ['s2']
  });
  assert.equal(h.context.App.machine, 'NDTM');
});

test('loading a legacy PDA with overlapping stack moves upgrades it to NPDA', () => {
  const h = createHarness();
  h.context.loadData({
    machine: 'PDA',
    sigma: ['a'],
    stackAlpha: ['A', 'Z'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1'), makeState('s2', 'q2')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: 'a', pop: 'Z', push: 'AZ' },
      { id: 't1', from: 's0', to: 's2', symbol: 'ε', pop: 'Z', push: 'Z' }
    ],
    startId: 's0',
    accepts: ['s2']
  });
  assert.equal(h.context.App.machine, 'NPDA');
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

test('legacy grammar productions are normalized when loaded from workspace data', () => {
  const h = createHarness();
  h.context.loadData({
    machine: 'DFA',
    sigma: ['a'],
    states: [],
    transitions: [],
    startId: null,
    accepts: [],
    grammar: {
      vars: ['S'],
      start: 'S',
      productions: [{ lhs: 'S', rhs: 'a' }]
    }
  });
  assert.equal(JSON.stringify(h.context.App.grammar.productions[0].rhsArr), JSON.stringify(['a']));
  assert.doesNotThrow(() => h.context.runFirstFollow());
  assert.match(h.getElement('gram-output').innerHTML, /First & Follow Sets/);
});

test('left recursion removal leaves recursive-only grammars unchanged and warns', () => {
  const h = createHarness();
  configureGrammar(h, {
    vars: ['S'],
    start: 'S',
    productions: [{ lhs: 'S', rhs: 'Sa', rhsArr: ['S', 'a'] }]
  });
  h.context.runLeftRecursionRemoval();
  const html = h.getElement('gram-output').innerHTML;
  assert.match(html, /Skipped S/);
  assert.match(html, />S<\/span> → Sa</);
  assert.doesNotMatch(html, /aS'/);
});

test('pruned PDA to CFG reports empty language instead of inventing epsilon', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'PDA',
    sigma: ['a'],
    states: [makeState('s0', 'q0')],
    transitions: [],
    startId: 's0',
    accepts: []
  });
  h.context.App.config.pdaParadigm = 'explicit';
  h.context.runPDA2CFG('pruned');
  const html = h.getElement('gram-output').innerHTML;
  assert.match(html, /empty language/i);
  assert.match(html, /Generated rules: 0/);
  assert.doesNotMatch(html, />ε</);
});

test('workspace validation accepts newly added machine types', () => {
  const h = createHarness();
  const base = {
    sigma: ['a'],
    states: [],
    transitions: [],
    accepts: []
  };

  assert.doesNotThrow(() => h.context.validateSchema({ ...base, machine: '2DFA' }));
  assert.doesNotThrow(() => h.context.validateSchema({ ...base, machine: '2NFA' }));
  assert.doesNotThrow(() => h.context.validateSchema({ ...base, machine: 'QA', stackAlpha: ['A', 'Z'] }));
  assert.doesNotThrow(() => h.context.validateSchema({ ...base, machine: 'Counter', stackAlpha: ['1', 'Z'] }));
  assert.doesNotThrow(() => h.context.validateSchema({ ...base, machine: '2PDA', stackAlpha: ['A', 'Z'] }));
  assert.doesNotThrow(() => h.context.validateSchema({ ...base, machine: 'LBA', tapeCount: 1 }));
  assert.doesNotThrow(() => h.context.validateSchema({ ...base, machine: 'ITM', tapeCount: 1 }));
  assert.doesNotThrow(() => h.context.validateSchema({ ...base, machine: 'FST', outputAlpha: ['0', '1'] }));
});

test('transition modal exposes reserved endmarkers for marker-based machines', () => {
  const h = createHarness();

  configureAppMachine(h, {
    machine: '2DFA',
    sigma: ['a', 'b'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1')],
    transitions: [],
    startId: 's0',
    accepts: []
  });
  h.context.populateTransitionModal(null);
  const twoWayHtml = h.getElement('m-sym').innerHTML;
  assert.match(twoWayHtml, /⊢/);
  assert.match(twoWayHtml, /⊣/);
  assert.doesNotMatch(twoWayHtml, /⊔/);

  configureAppMachine(h, {
    machine: 'LBA',
    sigma: ['a', 'b'],
    stackAlpha: ['a', 'b', '⊔'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1')],
    transitions: [],
    startId: 's0',
    accepts: [],
    tapeCount: 1
  });
  h.context.populateTransitionModal(null);
  const lbaHtml = h.getElement('m-sym').innerHTML;
  assert.match(lbaHtml, /⊢/);
  assert.match(lbaHtml, /⊣/);
  assert.match(lbaHtml, /⊔/);
});

test('workspace import normalizes boundary symbols for LBA', () => {
  const h = createHarness();
  h.context.importWorkspaceState({
    machine: 'LBA',
    sigma: ['a', '⊢', '⊣'],
    stackAlpha: ['a', '⊔'],
    outputAlpha: ['0'],
    tapeCount: 1,
    states: [],
    transitions: [],
    startId: null,
    accepts: [],
    config: {
      sym: { eps: 'ε', any: 'Σ', blank: '⊔', stackBottom: 'Z', lambda: 'λ' }
    }
  });
  assert.equal(h.context.App.sigma.has('⊢'), false);
  assert.equal(h.context.App.sigma.has('⊣'), false);
  assert.equal(h.context.App.stackAlpha.has('⊢'), true);
  assert.equal(h.context.App.stackAlpha.has('⊣'), true);
});

test('2DFA accepts when the right boundary marker is reached in an accepting state', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: '2DFA',
    sigma: ['a'],
    states: [makeState('s0', 'q0'), makeState('s1', 'scan'), makeState('s2', 'qa')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: '⊢', dir: 'R' },
      { id: 't1', from: 's1', to: 's1', symbol: 'a', dir: 'R' },
      { id: 't2', from: 's1', to: 's2', symbol: '⊣', dir: 'S' }
    ],
    startId: 's0',
    accepts: ['s2']
  });

  const result = h.context.sim2DFA(['a']);
  assert.equal(result.accepted, true);
  assert.equal(h.context.App.simSteps.at(-1).final, 'accept');
  assert.equal(h.context.App.simSteps[0].tape[0], '⊢');
  assert.equal(h.context.App.simSteps[0].tape.at(-1), '⊣');
});

test('2NFA accepts if any branch reaches the accepting boundary marker', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: '2NFA',
    sigma: ['a'],
    states: [makeState('s0', 'q0'), makeState('s1', 'scan'), makeState('s2', 'found'), makeState('s3', 'qa')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: '⊢', dir: 'R' },
      { id: 't1', from: 's1', to: 's1', symbol: 'b', dir: 'R' },
      { id: 't2', from: 's1', to: 's1', symbol: 'a', dir: 'R' },
      { id: 't3', from: 's1', to: 's2', symbol: 'a', dir: 'R' },
      { id: 't4', from: 's2', to: 's2', symbol: 'a', dir: 'R' },
      { id: 't5', from: 's2', to: 's2', symbol: 'b', dir: 'R' },
      { id: 't6', from: 's2', to: 's3', symbol: '⊣', dir: 'S' }
    ],
    startId: 's0',
    accepts: ['s3']
  });

  const result = h.context.sim2NFA(['b', 'a']);
  assert.equal(result.accepted, true);
  assert.equal(h.context.App.simSteps.at(-1).final, 'accept');
  assert.equal(h.context.App.simSteps[0].tape[0], '⊢');
  assert.equal(h.context.App.simSteps[0].tape.at(-1), '⊣');
});

test('counter machine accepts matched increment and decrement steps', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'Counter',
    sigma: ['a', 'b'],
    stackAlpha: ['1', 'Z'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1'), makeState('s2', 'qa')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: 'a', pop: 'Z', push: '1Z' },
      { id: 't1', from: 's1', to: 's2', symbol: 'b', pop: '1', push: 'Z' }
    ],
    startId: 's0',
    accepts: ['s2']
  });
  h.context.App.config.pdaParadigm = 'explicit';

  const result = h.context.simNPDA(['a', 'b']);
  assert.equal(result.accepted, true);
});

test('queue automaton simulation uses FIFO pop semantics', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'QA',
    sigma: ['a', 'b'],
    stackAlpha: ['A', 'Z'],
    states: [makeState('s0', 'q0'), makeState('s1', 'q1'), makeState('s2', 'qa')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: 'a', pop: 'ε', push: 'A' },
      { id: 't1', from: 's1', to: 's2', symbol: 'b', pop: 'Z', push: 'ε' }
    ],
    startId: 's0',
    accepts: ['s2']
  });
  h.context.App.config.pdaParadigm = 'explicit';
  const result = h.context.simNPDA(['a', 'b']);
  assert.equal(result.accepted, true);
});

test('2-stack PDA transitions require second-stack pop conditions', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: '2PDA',
    sigma: ['a'],
    stackAlpha: ['A', 'Z'],
    states: [makeState('s0', 'q0'), makeState('s1', 'qa')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: 'a', pop: 'Z', push: 'Z', pop2: 'A', push2: 'A' }
    ],
    startId: 's0',
    accepts: ['s1']
  });
  h.context.App.config.pdaParadigm = 'explicit';
  const result = h.context.simNPDA(['a']);
  assert.equal(result.accepted, false);
});

test('LBA rejects transitions that move past the boundary markers', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'LBA',
    sigma: ['a'],
    states: [makeState('s0', 'q0')],
    transitions: [
      { id: 't0', from: 's0', to: 's0', symbol: '⊢', write: '⊢', dir: 'L' }
    ],
    startId: 's0',
    accepts: []
  });
  h.context.simLBA(['a']);
  assert.equal(h.context.App.simSteps.at(-1).final, 'reject');
  assert.match(h.context.App.simSteps.at(-1).note, /LBA bounds|boundary/);
});

test('infinite-tape TM can move left of index zero and continue', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'ITM',
    sigma: ['a'],
    states: [makeState('s0', 'q0'), makeState('s1', 'qa')],
    transitions: [
      { id: 't0', from: 's0', to: 's1', symbol: 'a', write: 'a', dir: 'L' }
    ],
    startId: 's0',
    accepts: ['s1']
  });
  h.context.simITM(['a']);
  assert.equal(h.context.App.simSteps.at(-1).final, 'accept');
  assert.ok(h.context.App.simSteps.some(step => /@-1/.test(step.note)));
});

test('FST batch helper returns multiple outputs for nondeterministic transduction', () => {
  const h = createHarness();
  configureAppMachine(h, {
    machine: 'FST',
    sigma: ['a'],
    outputAlpha: ['0', '1'],
    states: [makeState('s0', 'q0')],
    transitions: [
      { id: 't0', from: 's0', to: 's0', symbol: 'a', output: '0' },
      { id: 't1', from: 's0', to: 's0', symbol: 'a', output: '1' }
    ],
    startId: 's0',
    accepts: ['s0']
  });
  h.context.App.config.transducerAccepts = true;
  const result = h.context.testFST(['a']);
  assert.equal(result.accepted, true);
  assert.match(result.output, /0|1/);
});
