import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHarness } from './harness.js';
import { Tools, ToolGroups, grammarToolNav } from '../js/grammar/registry.js';
import { GrammarExamples } from '../js/grammar/examples.js';
import { parseGrammarText } from '../js/grammar/parse.js';
import { member } from '../js/grammar/parsing.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI_SRC = readFileSync(join(ROOT, 'js/grammar-ui.js'), 'utf8');

// The workbench: the tool registry, the block vocabulary, and the seam between
// the two.
//
// **The property this file exists for is that a tool computes and the view
// writes.** Every `run` is a pure function of the grammar and the reader's
// inputs, answering with blocks — so a tool that goes wrong, or one whose
// result the reader simply reads and moves on from, leaves the grammar and the
// canvas exactly as they were. That is the same invariant the wizard and
// StateMate hold, and it is what the old view could not: each of its eighteen
// buttons reached for `$('gram-output')` and wrote a string of HTML, so
// nothing it computed could be asserted on without a document.

const G = text => {
  const p = parseGrammarText(text);
  return { vars: p.vars, start: p.start, rules: p.rules };
};
const CTX = g => ({
  g,
  word: { ok: true, tokens: ['a', 'b'], raw: 'ab' },
  inputs: { word: 'ab', words: 'ab\naabb' },
  tokenize: raw => ({ ok: true, tokens: raw ? raw.split('') : [] })
});

const SAMPLE = 'S -> a S b | ε';

// ── The registry ──────────────────────────────────────────────────

test('every tool declares a group that exists, and every group has tools', () => {
  const ids = new Set(ToolGroups.map(g => g.id));
  Tools.forEach(t => assert.ok(ids.has(t.group), `${t.id} names an unknown group "${t.group}"`));
  grammarToolNav().forEach(g => assert.ok(g.tools.length, `${g.id} is an empty group`));
});

test('a tool declares everything the rail and the result head need', () => {
  Tools.forEach(t => {
    assert.match(t.id, /^[a-z0-9-]+$/, `${t.id} is not a slug`);
    assert.ok(t.label, `${t.id} has no label`);
    assert.ok(t.blurb, `${t.id} has no blurb — the result head prints it`);
    assert.equal(typeof t.run, 'function', `${t.id} has no run`);
    t.inputs.forEach(f => {
      assert.ok(f.id && f.label, `${t.id} has an unlabelled input`);
    });
  });
});

test('the navigation is generated from the registry, in declaration order', () => {
  const nav = grammarToolNav();
  assert.deepEqual(nav.map(g => g.id), ToolGroups.filter(g =>
    [...Tools.values()].some(t => t.group === g.id)).map(g => g.id));
  assert.ok(nav[0].tools[0].id === 'overview', 'the view opens on the Overview');
});

// ── Tools are pure ────────────────────────────────────────────────

test('every tool runs and answers with blocks', () => {
  const h = createHarness();
  h.context.App.machine = 'NPDA';
  const g = G(SAMPLE);
  Tools.forEach(t => {
    const res = t.run(CTX(g));
    assert.ok(res && Array.isArray(res.blocks), `${t.id} did not answer with blocks`);
    res.blocks.forEach(b => assert.ok(b && b.t, `${t.id} produced a block with no kind`));
  });
});

test('no tool mutates the grammar it was handed', () => {
  const g = G('S -> A S A | a B\nA -> B | S\nB -> b | ε');
  const snapshot = JSON.stringify({ start: g.start, vars: [...g.vars].sort(), rules: g.rules });
  Tools.forEach(t => {
    try { t.run(CTX(g)); } catch { /* a tool needing a canvas may refuse; that is not a mutation */ }
    assert.equal(
      JSON.stringify({ start: g.start, vars: [...g.vars].sort(), rules: g.rules }), snapshot,
      `${t.id} mutated the grammar it was handed`);
  });
});

test('no tool writes to App — the canvas is written only by an action', () => {
  const h = createHarness();
  const { App } = h.context;
  h.context.App.machine = 'NPDA';
  const g = G(SAMPLE);
  const before = JSON.stringify(h.context.exportWorkspaceState());
  Tools.forEach(t => {
    try { t.run(CTX(g)); } catch { /* ignore */ }
  });
  assert.equal(JSON.stringify(h.context.exportWorkspaceState()), before,
    'running every tool in the workbench must leave the workspace byte for byte unchanged');
  assert.equal(App.states.length, 0);
});

// ── Blocks ────────────────────────────────────────────────────────

test('every block kind a tool emits has a renderer case', () => {
  const cases = new Set([...UI_SRC.matchAll(/case '([a-z]+)':/g)].map(m => m[1]));
  const emitted = new Set();
  const walk = b => {
    if (!b || !b.t) return;
    emitted.add(b.t);
    (b.blocks || []).forEach(walk);
    if (b.left) walk(b.left);
    if (b.right) walk(b.right);
    (b.frames || []).forEach(f => walk(f.block));
  };
  const h = createHarness();
  h.context.App.machine = 'NPDA';
  Tools.forEach(t => {
    try { (t.run(CTX(G(SAMPLE))).blocks || []).forEach(walk); } catch { /* ignore */ }
  });
  assert.ok(emitted.size > 8, 'the sweep should reach most of the vocabulary');
  emitted.forEach(kind => assert.ok(cases.has(kind),
    `js/grammar-ui.js has no renderBlock case for "${kind}" — the block would silently draw nothing`));
});

// ── The seam ──────────────────────────────────────────────────────

test('the workbench adds no name to the on* bridge', () => {
  const bridge = readFileSync(join(ROOT, 'js/bridge.js'), 'utf8');
  assert.ok(!/algorithms-cfg/.test(bridge), 'the old module is gone');
  for (const gone of ['runCNF', 'runCYK', 'parseRawGrammar', 'runGNF', 'runChomskyClassify',
    'runFirstFollow', 'runLL1Table', 'runParseTree', 'runAmbiguityCheck', 'loadCFGPDA']) {
    assert.ok(!bridge.includes(gone), `${gone} should no longer be on window`);
  }
  assert.ok(!/from '\.\/grammar-ui\.js'/.test(bridge),
    'every listener in the workbench is attached at creation, so it needs no bridge entry at all');
});

test('the grammar view carries no on* attribute except the shared mobile sheet toggle', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const view = html.slice(html.indexOf('<div id="v-grammar"'), html.indexOf('<!-- ─── REFERENCE VIEW ─── -->'));
  const handlers = [...view.matchAll(/\son[a-z]+\s*=\s*"([^"]*)"/g)].map(m => m[1]);
  assert.deepEqual(handlers, ["toggleMobilePanel('gram-nav')"],
    'the mobile sheet toggle is shared chrome; everything else is wired in JS');
});

// The rail's id was renamed when the view was rebuilt, and js/ui.js names it
// in three places the CSS cannot: the panel that starts collapsed on a phone,
// the sheet the Grammar view's bar button belongs to, and the tap that closes
// it once a tool is chosen. A name that no longer matches an element is silent
// — `$(id)` answers null and `setMobilePanelCollapsed` returns — so the sheet
// simply opens over the view and never closes.
test('the mobile sheet the Grammar view opens is the rail the markup carries', () => {
  const h = createHarness();
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const view = html.slice(html.indexOf('<div id="v-grammar"'), html.indexOf('<!-- ─── REFERENCE VIEW ─── -->'));
  const railId = /<div class="[^"]*" id="([^"]+)"/.exec(view)[1];

  assert.equal(h.context.MOBILE_AUX_PANEL_BY_VIEW.grammar, railId);
  assert.ok(h.context.MOBILE_AUX_PANEL_IDS.includes(railId),
    'the rail has to be in the list initMobilePanels collapses, or it opens over the view on load');

  const ui = readFileSync(join(ROOT, 'js/ui.js'), 'utf8');
  assert.ok(ui.includes(`#${railId} .gram-nav-link`),
    'choosing a tool has to close the sheet covering the result it just drew');
});

test('Change.GRAMMAR is its own kind, and it dirties the tab', () => {
  const h = createHarness();
  const { Change } = h.context;
  assert.equal(Change.GRAMMAR, 'grammar');
  h.context.Workspaces.push({ id: 'w0', name: 'A', dirty: false, data: h.context.exportWorkspaceState() });
  h.context.setActiveWorkspaceId('w0');
  const tab = h.context.Workspaces[0];
  h.context.emit(Change.GRAMMAR);
  assert.equal(tab.dirty, true,
    'the grammar is part of what getWorkspaceData saves, so editing one is an unsaved change');
});

test('Change.GRAMMAR does not drag the diagram through a re-render', () => {
  const h = createHarness();
  const { Change } = h.context;
  let graphRepaints = 0;
  const off = h.context.subscribe(Change.GRAPH, () => { graphRepaints++; });
  h.context.emit(Change.GRAMMAR);
  off();
  assert.equal(graphRepaints, 0,
    'retyping a production must not re-render the canvas, the panels and the formal definition');
});

test('the grammar survives a save and a reload', () => {
  const h = createHarness();
  const { grammar } = h.context.grammarFromText("E -> E + T | T\nT -> id");
  h.context.writeGrammar(grammar);
  const blob = h.context.getWorkspaceData();
  h.context.resetWorkspace();
  assert.equal(h.context.readGrammar().rules.length, 0, 'the reset clears it');
  h.context.loadData(blob);
  assert.equal(h.context.grammarText(h.context.readGrammar()), h.context.grammarText(grammar));
});

// ── The library ───────────────────────────────────────────────────

test('every example parses cleanly and is the grammar it claims to be', () => {
  GrammarExamples.forEach(ex => {
    const p = parseGrammarText(ex.text);
    assert.deepEqual(p.diagnostics.filter(d => d.kind === 'error'), [],
      `${ex.id} does not parse`);
    assert.ok(p.rules.length, `${ex.id} has no rules`);
    assert.ok(ex.name && ex.blurb && ex.group, `${ex.id} is missing its card copy`);
  });
});

test('example ids are unique', () => {
  const ids = GrammarExamples.map(e => e.id);
  assert.deepEqual([...new Set(ids)].length, ids.length);
});

test('an example’s listed words decide the way the example says they do', () => {
  // Every context-free example lists words worth trying; at least the first
  // has to actually be in the language, or the card is teaching the wrong
  // thing the moment it is loaded.
  const cf = GrammarExamples.filter(e => !['ancbn', 'empty'].includes(e.id));
  cf.forEach(ex => {
    const p = parseGrammarText(ex.text);
    const g = { vars: p.vars, start: p.start, rules: p.rules };
    const alphabet = new Set();
    g.rules.forEach(r => r.rhsArr.forEach(s => { if (!g.vars.has(s)) alphabet.add(s); }));
    const first = ex.words[0];
    const tokens = first ? tokenizeAgainst(first, alphabet) : [];
    if (tokens === null) return;   // a word the card spells loosely; not this test's business
    assert.ok(member(g, tokens).accepted, `${ex.id}: "${first || 'ε'}" should be in L(G)`);
  });
});

function tokenizeAgainst(word, alphabet) {
  const known = [...alphabet].sort((a, b) => b.length - a.length);
  const out = [];
  for (let i = 0; i < word.length;) {
    const hit = known.find(s => word.startsWith(s, i));
    if (!hit) return null;
    out.push(hit);
    i += hit.length;
  }
  return out;
}

// ── Conversions ───────────────────────────────────────────────────

test('CFG → NPDA builds both machines, with a start and an accept state', () => {
  const h = createHarness();
  const g = G(SAMPLE);
  for (const mode of ['topdown', 'bottomup']) {
    const res = h.context.cfgToPda(g, mode);
    assert.ok(res.states.includes(res.start));
    res.accepts.forEach(a => assert.ok(res.states.includes(a)));
    assert.ok(res.transitions.length);
    res.transitions.forEach(t => {
      assert.ok(res.states.includes(t.from), `${t.from} is not a state`);
      assert.ok(res.states.includes(t.to), `${t.to} is not a state`);
    });
  }
});

test('the top-down machine has one working state and a rule per production', () => {
  const h = createHarness();
  const g = G(SAMPLE);
  const res = h.context.cfgToPda(g, 'topdown');
  const expand = res.transitions.filter(t => t.from === 'q_loop' && t.to === 'q_loop' && t.symbol === h.context.App.config.sym.eps);
  assert.equal(expand.length, g.rules.length, 'one expand move per production');
});

test('the bottom-up machine spends intermediate states on long reductions', () => {
  const h = createHarness();
  const res = h.context.cfgToPda(G('S -> a b c'), 'bottomup');
  assert.ok(res.states.some(s => /reduce/.test(s)),
    'a PDA move pops one symbol, so reducing three takes two extra states');
});

test('a multi-character symbol is refused rather than pushed one character at a time', () => {
  const h = createHarness();
  const res = h.context.cfgToPda(G('Expr -> a Expr b | ε'), 'topdown');
  assert.ok(res.warnings.some(msg => /Expr/.test(msg)),
    'the stack is read one character at a time, so this cannot survive the canvas');
});

test('an automaton on the canvas becomes a right-linear grammar and back again', () => {
  const h = createHarness();
  const { App } = h.context;
  App.machine = 'DFA';
  App.sigma = new Set(['a', 'b']);
  App.states = [{ id: 's1', name: 'A', x: 0, y: 0 }, { id: 's2', name: 'B', x: 0, y: 0 }];
  App.transitions = [
    { id: 't1', from: 's1', to: 's2', symbol: 'a' },
    { id: 't2', from: 's2', to: 's2', symbol: 'b' }
  ];
  App.startId = 's1';
  App.accepts = new Set(['s2']);

  const res = h.context.faToRegularGrammar();
  assert.ok(!res.error);
  assert.equal(res.grammar.start, 'A');
  assert.equal(h.context.classify(res.grammar).type, 3, 'the construction is exact — it is a Type 3 grammar');
  assert.ok(res.grammar.rules.some(r => r.lhs === 'B' && !r.rhsArr.length), 'B accepts, so B → ε');

  const back = h.context.regularGrammarToFA(res.grammar);
  assert.ok(!back.error);
  assert.ok(back.states.length >= 2);
  assert.equal(back.orientation, 'right-linear');
});

test('a non-regular grammar is refused by the automaton construction, with the rule named', () => {
  const h = createHarness();
  const res = h.context.regularGrammarToFA(G(SAMPLE));
  assert.ok(res.error);
  assert.ok(res.blocker, 'the reader needs to know which rule blocks it');
});

test('a left-linear grammar builds a machine that runs the other way round', () => {
  const h = createHarness();
  const res = h.context.regularGrammarToFA(G('S -> S a | b'));
  assert.equal(res.orientation, 'left-linear');
  assert.notEqual(res.startId, res.accepts[0], 'the helper is the start, and S the accepting state');
});

test('PDA → CFG prunes the rules the construction generates and cannot use', () => {
  const h = createHarness();
  const { App } = h.context;
  App.machine = 'NPDA';
  App.config.pdaParadigm = 'explicit';
  App.sigma = new Set(['a']);
  App.states = [{ id: 's1', name: 'q0', x: 0, y: 0 }];
  App.transitions = [];
  App.startId = 's1';
  App.accepts = new Set();
  const res = h.context.pdaToCfg({ mode: 'pruned' });
  assert.ok(res.empty, 'nothing accepts, so the grammar is the empty language');
  assert.equal(res.grammar.rules.length, 0,
    'and it says so rather than inventing an ε-rule to have something to print');
});
