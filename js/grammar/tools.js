import {
  END, classify, cnfViolations, firstSets, followSets, generatingSet,
  gnfViolations, leftRecursionCycles, nullableSet, properties, reachableSet, usefulCycle
} from './analysis.js';
import * as B from './blocks.js';
import { cfgToPda, faToRegularGrammar, pdaToCfg, regularGrammarToFA } from './convert.js';
import { exampleGroups } from './examples.js';
import { eps, grammarText, rulesFor, terminalsOf } from './model.js';
import {
  ambiguityWitness, cykFrames, cykTable, derivationOf, generateWords,
  ll1Table, ll1Trace, member, parseTrees
} from './parsing.js';
import { defineGroup, defineTool } from './registry.js';
import {
  leftFactor, removeEpsilon, removeLeftRecursion, removeUnit, removeUseless, toCNF, toGNF
} from './transform.js';
import { frontier, layoutTree } from './tree.js';

// ══════════════════════════════════════════════════════════════════
//  THE TOOLS
// ══════════════════════════════════════════════════════════════════
//  One `defineTool` per thing the workbench can do. Every `run` is a pure
//  function of the grammar and the reader's inputs and answers with blocks —
//  it never reaches for `$`, never writes HTML and never mutates the grammar.
//  Applying a result to the editor is an *action* the view performs, which is
//  what keeps the canvas-is-written-once property the wizard and StateMate
//  have: a tool that goes wrong leaves the reader's grammar exactly as it was.
//
//  Declaration order here is the order of the navigation rail.

defineGroup('inspect', 'Inspect', 'What this grammar is');
defineGroup('normalize', 'Normalize', 'Rewrite it, language unchanged');
defineGroup('parse', 'Parse', 'Run words through it');
defineGroup('decide', 'Decide', 'Questions with a yes or no');
defineGroup('convert', 'Convert', 'To and from the canvas');
defineGroup('library', 'Library', 'Grammars to start from');

const set = s => (s && s.size ? `{ ${[...s].join(', ')} }` : '∅');
const list = a => (a && a.length ? `{ ${a.join(', ')} }` : '∅');
const ruleText = r => `${r.lhs} → ${r.rhsArr.length ? r.rhsArr.join(' ') : eps()}`;
const wordText = t => (t && t.length ? t.join('') : eps());

/** Indexed by the type number, so 2 is context-free and 3 is regular. */
const CLASS_NAMES = ['Unrestricted', 'Context-sensitive', 'Context-free', 'Regular'];

/** Every transform reports the same way: the stages, the result, and Apply. */
function transformBlocks(res, title) {
  const out = [];
  res.notes.forEach(n => out.push(B.note(n)));
  if (res.stages.length) out.push(B.steps(res.stages));
  out.push(B.sec(title,
    B.rules(res.grammar),
    B.facts([
      { k: 'Rules', v: String(res.grammar.rules.length) },
      { k: 'Variables', v: String(res.grammar.vars.size) }
    ])));
  out.push(B.actions([
    { act: 'apply', label: 'Apply to the editor', kind: 'primary', arg: grammarText(res.grammar) },
    { act: 'copy', label: 'Copy', arg: grammarText(res.grammar) }
  ]));
  return out;
}

// ══════════════════════════════════════════════════════════════════
//  INSPECT
// ══════════════════════════════════════════════════════════════════

defineTool({
  id: 'overview',
  group: 'inspect',
  label: 'Overview',
  blurb: 'The tuple, the rules, and every property worth knowing at a glance.',
  run({ g }) {
    if (!g.rules.length) {
      return {
        blocks: [
          B.note('Nothing has been written yet. Type a rule into the editor above — or start from a grammar in the library.'),
          B.actions([{ act: 'openTool', label: 'Open the library', kind: 'primary', arg: 'examples' }])
        ]
      };
    }
    const P = properties(g);
    const cls = P.classify;

    // Each chip links to the tool that acts on it, so "has ε-rules" is one
    // click from removing them rather than a fact with nowhere to go.
    const chips = [
      { ok: null, label: `Type ${cls.type}`, detail: CLASS_NAMES[cls.type] || '', tool: 'classify' },
      { ok: !P.epsRules.length, label: `${P.epsRules.length} ε-rule${P.epsRules.length === 1 ? '' : 's'}`, tool: 'eps' },
      { ok: !P.unitRules.length, label: `${P.unitRules.length} unit rule${P.unitRules.length === 1 ? '' : 's'}`, tool: 'unit' },
      { ok: !P.nonGenerating.length && !P.unreachable.length, label: `${P.nonGenerating.length + P.unreachable.length} useless symbol${P.nonGenerating.length + P.unreachable.length === 1 ? '' : 's'}`, tool: 'useless' },
      { ok: !P.leftRecursion.length, label: P.leftRecursion.length ? 'Left-recursive' : 'No left recursion', tool: 'leftrec' },
      { ok: !P.cnf.length, label: P.cnf.length ? 'Not in CNF' : 'In CNF', tool: 'cnf' },
      { ok: !P.gnf.length, label: P.gnf.length ? 'Not in GNF' : 'In GNF', tool: 'gnf' },
      { ok: !P.empty, label: P.empty ? 'L(G) = ∅' : (P.infinite ? 'Infinite' : 'Finite'), tool: P.empty ? 'empty' : 'finite' }
    ];

    return {
      blocks: [
        B.facts([
          { k: 'G', v: `( V, Σ, R, ${g.start || '—'} )`, mono: true },
          { k: 'V', v: set(g.vars), mono: true },
          { k: 'Σ', v: set(P.terminals), mono: true },
          { k: 'R', v: `${g.rules.length} rule${g.rules.length === 1 ? '' : 's'}` }
        ]),
        B.chips(chips),
        B.sec('Rules', B.rules(g)),
        P.derivesEmpty ? B.note(`ε ∈ L(G) — <code>${g.start}</code> derives the empty string.`) : null,
        !g.start ? B.err('No start symbol. The first rule’s left-hand side is used by default; pick another with the selector in the editor.') : null
      ].filter(Boolean)
    };
  }
});

defineTool({
  id: 'classify',
  group: 'inspect',
  label: 'Chomsky class',
  blurb: 'Where in the hierarchy this grammar sits, and which rule keeps it there.',
  needs: { rules: true },
  run({ g }) {
    const c = classify(g);
    const names = {
      3: ['Type 3 — Regular', 'Recognised by a finite automaton.'],
      2: ['Type 2 — Context-free', 'Recognised by a pushdown automaton.'],
      1: ['Type 1 — Context-sensitive', 'Recognised by a linear-bounded automaton.'],
      0: ['Type 0 — Unrestricted', 'Recognised by a Turing machine, and no less.']
    };
    const [title, detail] = names[c.type];

    const rows = [
      ['Type 3 — Regular', c.regular ? { v: 'yes', k: 'yes' } : { v: 'no', k: 'no' },
        c.regular
          ? (c.rightLinear && c.leftLinear ? 'Both right- and left-linear.' : c.rightLinear ? 'Right-linear.' : 'Left-linear.')
          : (c.blockers.regular ? `<code>${ruleText(c.blockers.regular)}</code> is neither right- nor left-linear.` : 'Not context-free, so not regular.')],
      ['Type 2 — Context-free', c.contextFree ? { v: 'yes', k: 'yes' } : { v: 'no', k: 'no' },
        c.contextFree ? 'Every left-hand side is one variable.'
          : `<code>${ruleText(c.blockers.contextFree)}</code> has ${c.blockers.contextFree.lhsArr.length} symbols on the left.`],
      ['Type 1 — Context-sensitive', c.nonContracting ? { v: 'yes', k: 'yes' } : { v: 'no', k: 'no' },
        c.nonContracting ? 'No rule shortens the sentential form.'
          : `<code>${ruleText(c.blockers.contextSensitive)}</code> is contracting — the right side is shorter than the left.`],
      ['Type 0 — Unrestricted', { v: 'yes', k: 'yes' }, 'Every grammar is Type 0.']
    ];

    return {
      blocks: [
        B.verdict(true, title, detail),
        B.table(['Class', 'Holds', 'Why'], rows),
        B.note('The hierarchy nests: every Type 3 grammar is Type 2, every Type 2 is Type 1 provided it has no ε-rule outside the start symbol, and every grammar is Type 0. The class reported above is the <em>tightest</em> one this grammar satisfies.'),
        c.type === 1 && !c.contextFree
          ? B.note('A multi-symbol left-hand side is what puts this above context-free — the rules that need it are the ones with context on the left, which is exactly what the name says.')
          : null,
        c.regular ? B.actions([{ act: 'openTool', label: 'Build the automaton', kind: 'primary', arg: 'g2fa' }]) : null
      ].filter(Boolean)
    };
  }
});

defineTool({
  id: 'symbols',
  group: 'inspect',
  label: 'Symbols',
  blurb: 'Every variable, what it can do, and where it is used.',
  needs: { rules: true },
  run({ g }) {
    const nullable = nullableSet(g);
    const gen = generatingSet(g);
    const reach = reachableSet(g);
    const direct = new Set(g.rules.filter(r => r.rhsArr[0] === r.lhsArr[0]).map(r => r.lhsArr[0]));
    const cycles = leftRecursionCycles(g);
    const inCycle = new Set(cycles.flat());

    const rows = [...g.vars].map(v => {
      const defs = rulesFor(g, v).length;
      const uses = g.rules.filter(r => r.rhsArr.includes(v)).length;
      const flag = (on, yes, no) => (on ? { v: yes, k: 'yes' } : { v: no || '—', k: 'na' });
      return [
        v === g.start ? `${v} · start` : v,
        String(defs),
        String(uses),
        flag(nullable.has(v), 'nullable'),
        gen.has(v) ? { v: 'generating', k: 'yes' } : { v: 'derives nothing', k: 'no' },
        reach.has(v) ? { v: 'reachable', k: 'yes' } : { v: 'unreachable', k: 'no' },
        direct.has(v) ? { v: 'direct', k: 'no' } : inCycle.has(v) ? { v: 'indirect', k: 'semi' } : { v: '—', k: 'na' }
      ];
    });

    const terms = [...terminalsOf(g)].map(t => [
      t,
      String(g.rules.filter(r => r.rhsArr.includes(t)).length)
    ]);

    return {
      blocks: [
        B.sec('Variables',
          B.table(['Variable', 'Rules', 'Uses', 'ε', 'Generating', 'Reachable', 'Left recursion'], rows)),
        B.sec('Terminals',
          terms.length ? B.table(['Terminal', 'Uses'], terms) : B.note('This grammar has no terminals — every symbol on a right-hand side is also defined by a rule.')),
        cycles.length
          ? B.note(`Left-recursive through ${cycles.map(c => `<code>${c.join(' → ')}</code>`).join(', ')}.`)
          : null
      ].filter(Boolean)
    };
  }
});

defineTool({
  id: 'firstfollow',
  group: 'inspect',
  label: 'FIRST & FOLLOW',
  blurb: 'The two sets every top-down parser is built out of.',
  needs: { rules: true, contextFree: true },
  run({ g }) {
    const first = firstSets(g);
    const follow = followSets(g, first);
    const rows = [...g.vars].map(v => [v, set(first[v]), set(follow[v])]);
    return {
      blocks: [
        B.table(['Variable', 'FIRST', 'FOLLOW'], rows),
        B.note(`<b>FIRST(A)</b> is every terminal that can begin a string A derives, plus <code>${eps()}</code> when A derives the empty string. <b>FOLLOW(A)</b> is every terminal that can appear directly after A in some sentential form, plus <code>${END}</code> when A can end one. <code>${eps()}</code> is never in a FOLLOW set — <code>${END}</code> is what stands in its place.`),
        B.actions([{ act: 'openTool', label: 'Build the LL(1) table', kind: 'primary', arg: 'll1' }])
      ]
    };
  }
});

// ══════════════════════════════════════════════════════════════════
//  NORMALIZE
// ══════════════════════════════════════════════════════════════════

defineTool({
  id: 'eps',
  group: 'normalize',
  label: 'Remove ε-rules',
  blurb: 'Every A → ε goes, and L(G) does not change.',
  needs: { rules: true, contextFree: true },
  run({ g }) { return { blocks: transformBlocks(removeEpsilon(g), 'Without ε-rules') }; }
});

defineTool({
  id: 'unit',
  group: 'normalize',
  label: 'Remove unit rules',
  blurb: 'Every A → B goes, replaced by what B could already do.',
  needs: { rules: true, contextFree: true },
  run({ g }) { return { blocks: transformBlocks(removeUnit(g), 'Without unit rules') }; }
});

defineTool({
  id: 'useless',
  group: 'normalize',
  label: 'Remove useless symbols',
  blurb: 'Symbols that derive nothing, then symbols nothing reaches.',
  needs: { rules: true, contextFree: true },
  run({ g }) {
    const res = removeUseless(g);
    return {
      blocks: [
        B.note('The order is not a preference: removing non-generating symbols can strand a symbol that was only reachable through one, so reachability has to be decided afterwards.'),
        ...transformBlocks(res, 'Reduced grammar')
      ]
    };
  }
});

defineTool({
  id: 'cnf',
  group: 'normalize',
  label: 'Chomsky normal form',
  blurb: 'Every rule becomes A → B C or A → a. This is what CYK runs on.',
  needs: { rules: true, contextFree: true },
  run({ g }) {
    const left = cnfViolations(g);
    const res = toCNF(g);
    return {
      blocks: [
        left.length
          ? B.note(`${left.length} rule${left.length === 1 ? '' : 's'} not yet in Chomsky normal form. The five stages below are Sipser’s order.`)
          : B.verdict(true, 'Already in Chomsky normal form', 'The conversion below leaves it unchanged.'),
        ...transformBlocks(res, 'Chomsky normal form'),
        B.note('The only ε-rule a CNF grammar may keep is the start symbol’s, and only when ε is in the language. That is why the conversion begins by introducing a fresh start symbol — the old one has to be free to appear on a right-hand side.')
      ]
    };
  }
});

defineTool({
  id: 'gnf',
  group: 'normalize',
  label: 'Greibach normal form',
  blurb: 'Every rule becomes A → a α: one terminal, then variables only.',
  needs: { rules: true, contextFree: true },
  run({ g }) {
    const res = toGNF(g);
    const left = gnfViolations(res.grammar);
    return {
      blocks: [
        ...transformBlocks(res, 'Greibach normal form'),
        left.length
          ? B.warn(`${left.length} rule${left.length === 1 ? ' is' : 's are'} still outside Greibach normal form. That is a bug worth reporting — the construction is supposed to be total on context-free grammars.`)
          : B.verdict(true, 'Every rule is A → a α', 'One terminal at the head, variables behind it — so each step of a derivation consumes exactly one input symbol, which is what makes the corresponding PDA real-time.'),
        B.note('GNF is usually much larger than the grammar it came from: the forward substitution multiplies each variable’s rules by the rules of everything below it. That growth is inherent to the construction, not a fault in this one.')
      ]
    };
  }
});

defineTool({
  id: 'leftrec',
  group: 'normalize',
  label: 'Remove left recursion',
  blurb: 'Direct and indirect. What top-down parsing needs gone.',
  needs: { rules: true, contextFree: true },
  run({ g }) {
    const cycles = leftRecursionCycles(g);
    const res = removeLeftRecursion(g);
    return {
      blocks: [
        cycles.length
          ? B.sec('What was found', B.table(['Cycle', 'Kind'], cycles.map(c => [
            c.join(' → '),
            c.length === 2 ? { v: 'direct', k: 'no' } : { v: 'indirect', k: 'semi' }
          ])))
          : B.verdict(true, 'Not left-recursive', 'No variable can derive a sentential form it heads.'),
        ...transformBlocks(res, 'Without left recursion'),
        B.note('Indirect recursion is what makes this more than a rewrite of one rule: <code>A → B a, B → A b</code> has neither rule looking recursive. Fixing an order on the variables and substituting each earlier one out is what turns every indirect cycle into a direct one first.'),
        leftRecursionCycles(res.grammar).length
          ? B.warn('Some left recursion survives — see the notes above for which variable was left alone and why.')
          : null
      ].filter(Boolean)
    };
  }
});

defineTool({
  id: 'factor',
  group: 'normalize',
  label: 'Left factoring',
  blurb: 'Alternatives that start alike, factored apart. The other half of LL(1).',
  needs: { rules: true, contextFree: true },
  run({ g }) {
    const res = leftFactor(g);
    return {
      blocks: [
        ...transformBlocks(res, 'Left-factored'),
        B.note('A predictive parser chooses a rule from one lookahead symbol, so two alternatives beginning with the same symbol are a conflict it cannot resolve. Factoring the shared prefix out defers the choice until after it has been read.')
      ]
    };
  }
});

// ══════════════════════════════════════════════════════════════════
//  PARSE
// ══════════════════════════════════════════════════════════════════

const WORD_INPUT = [{ id: 'word', label: 'Word', placeholder: 'aabb', kind: 'word' }];

defineTool({
  id: 'parse',
  group: 'parse',
  label: 'Parse a word',
  blurb: 'The verdict, both derivations and the tree — over the rules you wrote.',
  needs: { rules: true, contextFree: true, word: true },
  inputs: WORD_INPUT,
  run({ g, word }) {
    const m = member(g, word.tokens);
    if (!m.accepted) {
      return {
        blocks: [
          B.verdict(false, `${wordText(word.tokens)} ∉ L(G)`, `No derivation from ${g.start} produces this word. Decided by CYK over the Chomsky normal form.`),
          B.actions([{ act: 'openTool', label: 'See the CYK table', arg: 'cyk' }])
        ]
      };
    }
    const { trees, exhausted } = parseTrees(g, word.tokens, 1);
    if (!trees.length) {
      return {
        blocks: [
          B.verdict(true, `${wordText(word.tokens)} ∈ L(G)`, 'CYK accepts it.'),
          B.warn(exhausted
            ? 'The tree search ran out of budget before it found a derivation. The word is in the language — CYK is the authority on that — but the tree is not shown.'
            : 'CYK accepts the word but no cycle-free derivation was found, which happens when every derivation of it passes through a repeated symbol over the same span.')
        ]
      };
    }
    const tree = trees[0];
    return {
      blocks: [
        B.verdict(true, `${wordText(word.tokens)} ∈ L(G)`, `${derivationOf(tree).length - 1} derivation steps.`),
        B.sec('Parse tree', B.tree(layoutTree(tree, { eps: eps() }), { frontier: frontier(tree, eps()) })),
        B.split(
          B.sec('Leftmost derivation', B.derivation(derivationOf(tree, 'leftmost'), { eps: eps() })),
          B.sec('Rightmost derivation', B.derivation(derivationOf(tree, 'rightmost'), { eps: eps() }))
        ),
        B.note('Both derivations come from the same tree: a parse tree records <em>which</em> rules were used and where, and leftmost and rightmost are two orders of reading them off. Two genuinely different trees for one word is what ambiguity means.'),
        B.actions([{ act: 'openTool', label: 'Check this word for ambiguity', arg: 'ambiguity' }])
      ]
    };
  }
});

defineTool({
  id: 'cyk',
  group: 'parse',
  label: 'CYK table',
  blurb: 'The cubic membership algorithm, filled one span at a time.',
  needs: { rules: true, contextFree: true, word: true },
  inputs: WORD_INPUT,
  run({ g, word }) {
    const cnf = toCNF(g).grammar;
    if (!word.tokens.length) {
      const ok = cnf.rules.some(r => r.lhsArr[0] === cnf.start && !r.rhsArr.length);
      return {
        blocks: [
          B.verdict(ok, `${eps()} ${ok ? '∈' : '∉'} L(G)`,
            `A table over the empty word has no cells; the question is settled by whether ${cnf.start} → ${eps()} survives the conversion.`),
          B.sec('Chomsky normal form', B.rules(cnf))
        ]
      };
    }
    const { cells } = cykTable(cnf, word.tokens);
    const accepted = cells[0][word.tokens.length - 1].has(cnf.start);
    const frames = cykFrames(cnf, word.tokens);
    return {
      blocks: [
        B.verdict(accepted,
          accepted ? `${wordText(word.tokens)} ∈ L(G)` : `${wordText(word.tokens)} ∉ L(G)`,
          `${cnf.start} ${accepted ? 'is' : 'is not'} in T[0][${word.tokens.length - 1}], the cell for the whole word.`),
        B.scrub(frames.map(f => ({
          note: f.note,
          block: B.cyk(f.cells, word.tokens, { start: cnf.start, active: { i: f.i, j: f.j }, added: f.added })
        })), { label: 'Fill step' }),
        B.sec('Chomsky normal form', B.rules(cnf),
          B.note('CYK is defined on Chomsky normal form, so it is this grammar the table is about — the variable names in the cells are the converted ones.'))
      ]
    };
  }
});

defineTool({
  id: 'ambiguity',
  group: 'parse',
  label: 'Check ambiguity',
  blurb: 'A witness, not a decision — ambiguity of a grammar is undecidable.',
  needs: { rules: true, contextFree: true, word: true },
  inputs: WORD_INPUT,
  run({ g, word }) {
    const res = ambiguityWitness(g, word.tokens);
    if (!res.trees.length) {
      return {
        blocks: [
          B.verdict(false, `${wordText(word.tokens)} ∉ L(G)`, 'No derivation at all, so there is nothing to be ambiguous about.')
        ]
      };
    }
    if (!res.ambiguous) {
      return {
        blocks: [
          B.verdict(true, 'One parse tree found', `Only one cycle-free derivation of ${wordText(word.tokens)} exists${res.exhausted ? ', within the search budget' : ''}. That is evidence, not proof: another word may still be ambiguous, and whether a grammar is ambiguous at all is undecidable.`),
          B.sec('The tree', B.tree(layoutTree(res.trees[0], { eps: eps() }), { frontier: frontier(res.trees[0], eps()) })),
          B.note('This tool is a <em>witness finder</em>. Finding two trees is conclusive — the grammar is ambiguous and both are on screen. Finding one is not: it reports only that this word had a single derivation within the depth searched.')
        ]
      };
    }
    const [a, b] = res.trees;
    return {
      blocks: [
        B.verdict(false, 'Ambiguous', `${wordText(word.tokens)} has two structurally different parse trees, so the grammar is ambiguous. This is conclusive.`),
        B.split(
          B.sec('First tree', B.tree(layoutTree(a, { eps: eps() }))),
          B.sec('Second tree', B.tree(layoutTree(b, { eps: eps() }))),
          { stack: true }
        ),
        B.sec('The two leftmost derivations', B.split(
          B.derivation(derivationOf(a), { eps: eps() }),
          B.derivation(derivationOf(b), { eps: eps() })
        )),
        B.note('The two trees use the same rules and arrive at the same word; what differs is the <em>shape</em>, which is what makes this ambiguity structural rather than an artefact of the order the rules were applied in. Compare the roots: they group the word differently, and that grouping is what a compiler would go on to evaluate.')
      ]
    };
  }
});

defineTool({
  id: 'll1',
  group: 'parse',
  label: 'LL(1) analysis',
  blurb: 'The predictive parsing table, its conflicts, and a parse to watch.',
  needs: { rules: true, contextFree: true },
  inputs: WORD_INPUT,
  run({ g, word }) {
    const built = ll1Table(g);
    const header = ['', ...built.terminals];
    const rows = [...g.vars].map(v => [
      v,
      ...built.terminals.map(a => {
        const cell = built.table.get(`${v}|${a}`) || [];
        if (!cell.length) return { v: '', k: 'na' };
        if (cell.length === 1) return { v: `${v} → ${cell[0].rhsArr.length ? cell[0].rhsArr.join(' ') : eps()}`, k: 'yes' };
        return { v: cell.map(r => (r.rhsArr.length ? r.rhsArr.join(' ') : eps())).join(' / '), k: 'no' };
      })
    ]);

    const blocks = [
      B.verdict(built.isLL1,
        built.isLL1 ? 'This grammar is LL(1)' : `Not LL(1) — ${built.conflicts.length} conflicted cell${built.conflicts.length === 1 ? '' : 's'}`,
        built.isLL1
          ? 'Every cell holds at most one rule, so one lookahead symbol always decides which to use.'
          : 'A cell holding two rules is a choice one lookahead symbol cannot make.'),
      B.table(header, rows, { wide: true })
    ];

    if (!built.isLL1) {
      blocks.push(B.sec('Conflicts', B.table(['Cell', 'Competing rules'],
        built.conflicts.map(c => [`M[${c.variable}, ${c.lookahead}]`, c.rules.map(ruleText).join('   ·   ')]))));
      const cycles = leftRecursionCycles(g);
      const causes = [];
      if (cycles.length) causes.push({ act: 'openTool', label: 'Remove left recursion', arg: 'leftrec', kind: 'primary' });
      causes.push({ act: 'openTool', label: 'Left-factor', arg: 'factor' });
      blocks.push(B.note('Left recursion and a shared prefix are the two usual causes, and both have a fix that preserves the language.'));
      blocks.push(B.actions(causes));
    }

    if (word.raw && !word.ok) {
      // The table is about the grammar and stands whatever was typed, so this
      // tool declares no `needs.word` — it reports the unreadable word and
      // goes on showing what it can.
      blocks.push(B.warn(`“${word.error}” is not a symbol this grammar uses, so there is no parse to trace. The table above is unaffected.`));
    } else if (word.raw) {
      const trace = ll1Trace(g, word.tokens, built);
      blocks.push(B.sec(`Predictive parse of ${wordText(word.tokens)}`,
        B.table(['Stack', 'Remaining input', 'Action'],
          trace.rows.map(r => [
            { v: r.stack.slice().reverse().join(' '), k: 'na' },
            { v: r.rest.join(' '), k: 'na' },
            { v: r.action, k: r.kind === 'error' ? 'no' : r.kind === 'accept' ? 'yes' : r.kind === 'conflict' ? 'semi' : 'na' }
          ]), { wide: true }),
        trace.status === 'accept'
          ? B.verdict(true, 'Accepted', 'The stack emptied exactly as the input ran out.')
          : B.verdict(false, 'Rejected', 'The parse stopped before consuming the input.')));
      if (!built.isLL1) {
        blocks.push(B.warn('The table has conflicts, so this trace takes the first rule in each conflicted cell. It shows where a predictive parser would go, not what one would decide.'));
      }
    } else {
      blocks.push(B.note('Type a word above to watch the predictive parser run against this table.'));
    }
    return { blocks };
  }
});

defineTool({
  id: 'batch',
  group: 'parse',
  label: 'Test many words',
  blurb: 'A list of words, one verdict each — the batch tester for grammars.',
  needs: { rules: true, contextFree: true },
  inputs: [{ id: 'words', label: 'Words', placeholder: 'one per line', kind: 'multiline' }],
  run({ g, inputs, tokenize }) {
    const raw = String(inputs.words || '').split('\n').map(s => s.trim()).filter((s, i, a) => s !== '' || a.indexOf(s) === i);
    if (!raw.length) {
      return {
        blocks: [
          B.note('One word per line. The empty line is read as ε, so a blank first line tests the empty word.'),
          B.actions([{ act: 'fillWords', label: 'Use the shortest words in L(G)', kind: 'primary' }])
        ]
      };
    }
    // CNF once for the whole batch: converting per word is the same work
    // repeated, and on a long list it is most of the time spent.
    const cnf = toCNF(g).grammar;
    const acceptsEmpty = cnf.rules.some(r => r.lhsArr[0] === cnf.start && !r.rhsArr.length);
    let accepted = 0;
    const rows = raw.map(line => {
      const w = tokenize(line);
      if (!w.ok) return [{ v: line || eps(), k: 'na' }, { v: `unknown symbol ${w.error}`, k: 'no' }, ''];
      const ok = w.tokens.length
        ? cykTable(cnf, w.tokens).cells[0][w.tokens.length - 1].has(cnf.start)
        : acceptsEmpty;
      if (ok) accepted++;
      return [
        { v: wordText(w.tokens), k: 'na' },
        ok ? { v: 'accept', k: 'yes' } : { v: 'reject', k: 'no' },
        String(w.tokens.length)
      ];
    });
    return {
      blocks: [
        B.facts([
          { k: 'Words', v: String(raw.length) },
          { k: 'In L(G)', v: String(accepted) },
          { k: 'Not in L(G)', v: String(raw.length - accepted) }
        ]),
        B.table(['Word', 'Verdict', 'Length'], rows)
      ]
    };
  }
});

defineTool({
  id: 'generate',
  group: 'parse',
  label: 'Generate words',
  blurb: 'The shortest words the grammar derives — the fastest way to see what it does.',
  needs: { rules: true, contextFree: true },
  run({ g }) {
    const res = generateWords(g, { count: 40, maxLen: 14 });
    if (!res.words.length) {
      return { blocks: [B.verdict(false, 'No words found', 'Either L(G) is empty or every word it derives is longer than the search bound.')] };
    }
    return {
      blocks: [
        B.facts([
          { k: 'Found', v: String(res.words.length) },
          { k: 'Shortest', v: wordText(res.words[0]), mono: true },
          { k: 'Language', v: res.complete ? 'finite — this is all of it' : 'more words exist' }
        ]),
        B.words(res.words.map(w => wordText(w))),
        res.complete
          ? B.verdict(true, 'That is the whole language', 'The search exhausted every sentential form within the bound and found nothing further.')
          : B.note('The search is breadth-first over sentential forms and stops at the word count or the length bound, whichever comes first — so these are the shortest words, not the first ones a depth-first walk would have reached.'),
        B.actions([{ act: 'fillWords', label: 'Send these to the batch tester', kind: 'primary' }])
      ]
    };
  }
});

// ══════════════════════════════════════════════════════════════════
//  DECIDE
// ══════════════════════════════════════════════════════════════════

defineTool({
  id: 'empty',
  group: 'decide',
  label: 'Is L(G) empty?',
  blurb: 'Decidable, by asking which variables derive anything at all.',
  needs: { rules: true, contextFree: true },
  run({ g }) {
    const gen = generatingSet(g);
    const empty = !g.start || !gen.has(g.start);
    return {
      blocks: [
        B.verdict(!empty,
          empty ? 'L(G) = ∅' : 'L(G) ≠ ∅',
          empty
            ? `${g.start || 'The start symbol'} derives no terminal string, so the grammar generates nothing.`
            : `${g.start} derives at least one terminal string.`),
        B.table(['Variable', 'Derives a terminal string'],
          [...g.vars].map(v => [v, gen.has(v) ? { v: 'yes', k: 'yes' } : { v: 'no', k: 'no' }])),
        B.note('The iteration adds at least one variable per round and there are finitely many variables, so it terminates — which is the whole proof that emptiness is decidable.')
      ]
    };
  }
});

defineTool({
  id: 'finite',
  group: 'decide',
  label: 'Is L(G) finite?',
  blurb: 'Decidable, by looking for a cycle among the symbols that matter.',
  needs: { rules: true, contextFree: true },
  run({ g }) {
    const gen = generatingSet(g);
    if (!g.start || !gen.has(g.start)) {
      return { blocks: [B.verdict(true, 'Finite — L(G) = ∅', 'The empty language is finite. Nothing derives anything, so there is no cycle to find.')] };
    }
    const cycle = usefulCycle(g);
    const res = cycle
      ? generateWords(g, { count: 6, maxLen: 20 })
      : generateWords(g, { count: 400, maxLen: 40 });
    return {
      blocks: [
        B.verdict(!cycle,
          cycle ? 'Infinite' : 'Finite',
          cycle
            ? `<code>${cycle.join(' ⇒ ')}</code> is a cycle among symbols that are both reachable and generating, so it can be gone round any number of times.`
            : `No such cycle exists, so every derivation terminates in a bounded number of steps${res.complete ? ` — L(G) has ${res.words.length} word${res.words.length === 1 ? '' : 's'}` : ''}.`),
        cycle ? null : (res.complete ? B.words(res.words.map(w => wordText(w))) : null),
        B.note('A cycle has to be through symbols that are <em>both</em> reachable from the start and able to derive a terminal string. One that fails either test can be gone round forever and still contributes no word, which is why the two other tools have to run first.')
      ].filter(Boolean)
    };
  }
});

// ══════════════════════════════════════════════════════════════════
//  CONVERT
// ══════════════════════════════════════════════════════════════════

function pdaBlocks(res, title, explain) {
  return [
    B.verdict(true, title, explain),
    ...res.warnings.map(w => B.warn(w)),
    B.facts([
      { k: 'States', v: String(res.states.length) },
      { k: 'Transitions', v: String(res.transitions.length) },
      { k: 'Start', v: res.start, mono: true },
      { k: 'Accept', v: res.accepts.join(', '), mono: true }
    ]),
    B.table(['From', 'Read', 'Pop', 'Push', 'To'],
      res.transitions.map(t => [
        { v: t.from, k: 'na' }, { v: t.symbol, k: 'na' },
        { v: t.pop, k: 'na' }, { v: t.push, k: 'na' }, { v: t.to, k: 'na' }
      ]), { wide: true, scroll: true }),
    B.actions([{ act: 'loadPda', label: 'Load onto the canvas', kind: 'primary', arg: res }])
  ];
}

defineTool({
  id: 'cfg2pda-top',
  group: 'convert',
  label: 'Grammar → NPDA (top-down)',
  blurb: 'One state, the stack holding the unexpanded tail of a sentential form.',
  needs: { rules: true, contextFree: true },
  run({ g }) {
    return {
      blocks: [
        ...pdaBlocks(cfgToPda(g, 'topdown'), 'Top-down (expand and match)',
          'The stack holds what is left of a sentential form. A variable on top is replaced by the right-hand side of some rule; a terminal on top must match the next input symbol and is consumed. An accepting run is exactly a leftmost derivation.'),
        B.note('The machine is nondeterministic by construction — every rule for the variable on top is a legal move, and choosing between them is precisely the choice a leftmost derivation makes.')
      ]
    };
  }
});

defineTool({
  id: 'cfg2pda-bottom',
  group: 'convert',
  label: 'Grammar → NPDA (bottom-up)',
  blurb: 'Shift and reduce — the stack holds what has already been read.',
  needs: { rules: true, contextFree: true },
  run({ g }) {
    return {
      blocks: [
        ...pdaBlocks(cfgToPda(g, 'bottomup'), 'Bottom-up (shift and reduce)',
          'Input symbols are shifted onto the stack; a right-hand side sitting on top is popped and replaced by its left-hand side. Acceptance is the start symbol alone on the stack.'),
        B.note('A PDA move pops one symbol, so reducing a right-hand side of k symbols takes k−1 intermediate states. That is why this machine is larger than the top-down one for the same grammar, even though the idea is no harder.')
      ]
    };
  }
});

defineTool({
  id: 'pda2cfg',
  group: 'convert',
  label: 'Canvas PDA → grammar',
  blurb: 'The Sipser triple construction, over the pushdown automaton on the canvas.',
  needs: { machine: 'pda' },
  run() {
    const res = pdaToCfg({ mode: 'pruned' });
    if (res.error) return { blocks: [B.err(res.error)] };
    if (res.empty) {
      return {
        blocks: [B.verdict(false, 'The resulting grammar is empty',
          `All ${res.raw} generated rules turned out to be useless, so the machine accepts nothing.`)]
      };
    }
    return {
      blocks: [
        B.verdict(true, 'Converted', `${res.grammar.rules.length} rules over ${res.grammar.vars.size} variables.`),
        B.facts([
          { k: 'Generated', v: String(res.raw) },
          { k: 'Pruned', v: String(res.pruned) },
          { k: 'Kept', v: String(res.grammar.rules.length) },
          { k: 'States', v: String(res.stateCount) }
        ]),
        B.note(`A variable <code>[p, A, q]</code> generates exactly the words that take the machine from state p with A on top of the stack to state q with that A removed. The moves translate rule for rule: pushing two symbols becomes a chain of two such variables, one per symbol that must eventually come off. The start variable is <code>[${res.qStart}, ${res.freshBottom}, ${res.qDrain}]</code>, reached through <code>S</code>.`),
        res.overlong
          ? B.warn(`${res.overlong} transition${res.overlong === 1 ? ' pushes' : 's push'} more than two stack symbols, which this construction does not cover. Split ${res.overlong === 1 ? 'it' : 'them'} into pushes of at most two before converting.`)
          : null,
        B.sec('Grammar', B.rules(res.grammar)),
        B.actions([
          { act: 'apply', label: 'Apply to the editor', kind: 'primary', arg: grammarText(res.grammar) },
          { act: 'copy', label: 'Copy', arg: grammarText(res.grammar) }
        ])
      ].filter(Boolean)
    };
  }
});

defineTool({
  id: 'g2fa',
  group: 'convert',
  label: 'Grammar → automaton',
  blurb: 'A regular grammar is a finite automaton written differently.',
  needs: { rules: true, contextFree: true },
  run({ g }) {
    const res = regularGrammarToFA(g);
    if (res.error) {
      return {
        blocks: [
          B.err(res.error),
          res.blocker ? B.note(`The rule that blocks it: <code>${ruleText(res.blocker)}</code>.`) : null,
          B.actions([{ act: 'openTool', label: 'See the classification', arg: 'classify' }])
        ].filter(Boolean)
      };
    }
    const nameOf = id => res.states.find(s => s.id === id)?.name || id;
    return {
      blocks: [
        B.verdict(true, `${res.machine} built`, `The grammar is ${res.orientation}, so each variable becomes a state and each rule becomes a move.`),
        B.facts([
          { k: 'States', v: String(res.states.length) },
          { k: 'Transitions', v: String(res.transitions.length) },
          { k: 'Start', v: nameOf(res.startId), mono: true },
          { k: 'Accept', v: res.accepts.map(nameOf).join(', '), mono: true }
        ]),
        B.table(['From', 'Read', 'To'],
          res.transitions.map(t => [{ v: nameOf(t.from), k: 'na' }, { v: t.symbol, k: 'na' }, { v: nameOf(t.to), k: 'na' }])),
        B.note(res.orientation === 'right-linear'
          ? 'A right-linear rule <code>A → a B</code> reads as "in state A, read a, go to B", and <code>A → ε</code> as "A accepts". One helper state stands in for the end of a rule with no variable.'
          : 'A left-linear rule <code>A → B a</code> runs backwards: the machine reads a on its way <em>into</em> A from B. So the helper state is the start and the grammar’s start symbol is the accepting state.'),
        B.actions([{ act: 'loadFa', label: 'Load onto the canvas', kind: 'primary', arg: res }])
      ]
    };
  }
});

defineTool({
  id: 'fa2g',
  group: 'convert',
  label: 'Canvas automaton → grammar',
  blurb: 'Every state a variable, every transition a rule.',
  needs: { machine: 'fa' },
  run() {
    const res = faToRegularGrammar();
    if (res.error) return { blocks: [B.err(res.error)] };
    return {
      blocks: [
        B.verdict(true, 'Right-linear grammar built',
          `${res.grammar.rules.length} rules over ${res.grammar.vars.size} variables — one per state.`),
        B.sec('Grammar', B.rules(res.grammar)),
        B.note('Each variable is a state and each rule is a move: <code>A → a B</code> for a transition, <code>A → ε</code> for an accepting state. The conversion is exact in both directions — a derivation and a run are the same object.'),
        B.actions([
          { act: 'apply', label: 'Apply to the editor', kind: 'primary', arg: grammarText(res.grammar) },
          { act: 'copy', label: 'Copy', arg: grammarText(res.grammar) }
        ])
      ]
    };
  }
});

// ══════════════════════════════════════════════════════════════════
//  LIBRARY
// ══════════════════════════════════════════════════════════════════

defineTool({
  id: 'examples',
  group: 'library',
  label: 'Example grammars',
  blurb: 'Something to point the other tools at.',
  run() {
    return {
      blocks: exampleGroups().map(group => B.sec(group.label, B.examples(group.items)))
    };
  }
});
