// ══════════════════════════════════════════════════════════════════
//  THE GRAMMAR LIBRARY
// ══════════════════════════════════════════════════════════════════
//  Import-free: text, a name and a line about what the grammar is for. The
//  old grammar view opened on an empty textarea with no example anywhere in
//  the app, which meant the first thing a reader had to do was recall a
//  grammar from memory and then guess at the notation it wanted.
//
//  Each entry names what is *interesting* about it rather than what it
//  generates, because the reason to load one is usually to have something to
//  point a tool at: the ambiguous expression grammar is here so that Check
//  ambiguity has something to find.

export const GrammarExamples = [
  {
    id: 'anbn',
    group: 'Classic',
    name: 'aⁿbⁿ',
    blurb: 'The smallest language that is context-free and not regular.',
    words: ['ab', 'aabb', 'aaabbb', ''],
    text: 'S → a S b | ε'
  },
  {
    id: 'balanced',
    group: 'Classic',
    name: 'Balanced parentheses',
    blurb: 'The Dyck language — matched brackets, nested to any depth.',
    words: ['()', '(())', '()()', '(()'],
    text: 'S → ( S ) | S S | ε'
  },
  {
    id: 'palindrome',
    group: 'Classic',
    name: 'Even palindromes',
    blurb: 'w wᴿ over {a, b}. Inherently non-deterministic — no DPDA accepts it.',
    words: ['abba', 'aa', 'abab', ''],
    text: 'S → a S a | b S b | ε'
  },
  {
    id: 'equal',
    group: 'Classic',
    name: 'Equally many a and b',
    blurb: 'Ambiguous as written, and a good first target for Check ambiguity.',
    words: ['ab', 'ba', 'aabb', 'abab'],
    text: 'S → a S b S | b S a S | ε'
  },
  {
    id: 'expr-ambiguous',
    group: 'Expressions',
    name: 'Arithmetic — ambiguous',
    blurb: 'No precedence and no associativity, so id + id * id has two trees.',
    words: ['id+id*id', 'id*id+id', 'id'],
    text: 'E → E + E | E * E | ( E ) | id'
  },
  {
    id: 'expr-precedence',
    group: 'Expressions',
    name: 'Arithmetic — with precedence',
    blurb: 'The same language, layered into E, T, F so every word has one tree. Left-recursive.',
    words: ['id+id*id', '(id+id)*id'],
    text: 'E → E + T | T\nT → T * F | F\nF → ( E ) | id'
  },
  {
    id: 'expr-ll1',
    group: 'Expressions',
    name: 'Arithmetic — LL(1)',
    blurb: 'The left recursion removed. This is what an LL(1) table is built from.',
    words: ['id+id*id', 'id'],
    text: "E → T E'\nE' → + T E' | ε\nT → F T'\nT' → * F T' | ε\nF → ( E ) | id"
  },
  {
    id: 'dangling-else',
    group: 'Expressions',
    name: 'The dangling else',
    blurb: 'The ambiguity every language with an optional else clause has to resolve.',
    words: ['ifbtifbtaea', 'a'],
    text: 'S → if b t S | if b t S e S | a'
  },
  {
    id: 'left-recursive',
    group: 'Awkward shapes',
    name: 'Indirect left recursion',
    blurb: 'A ⇒ S ⇒ A: left-recursive without any rule looking it.',
    words: ['b', 'ba', 'bda'],
    text: 'S → A a | b\nA → A c | S d | f'
  },
  {
    id: 'useless',
    group: 'Awkward shapes',
    name: 'Useless symbols',
    blurb: 'B derives nothing and C is unreachable — one of each kind of useless.',
    words: ['a'],
    text: 'S → a | B\nB → b B\nC → c'
  },
  {
    id: 'empty',
    group: 'Awkward shapes',
    name: 'The empty language',
    blurb: 'Every rule is well formed and L(G) = ∅ all the same.',
    words: ['a', ''],
    text: 'S → A B\nA → a A\nB → b'
  },
  {
    id: 'unit-chain',
    group: 'Awkward shapes',
    name: 'Unit chain and ε-rules',
    blurb: 'Something for every stage of the CNF conversion to have work to do.',
    words: ['a', 'ab', ''],
    text: 'S → A | ε\nA → B | a\nB → A b | b'
  },
  {
    id: 'ancbn',
    group: 'Beyond context-free',
    name: 'aⁿbⁿcⁿ',
    blurb: 'Context-sensitive and not context-free — a Type 1 grammar to classify.',
    words: ['abc', 'aabbcc'],
    text: 'S → a S B C | a B C\nC B → B C\na B → a b\nb B → b b\nb C → b c\nc C → c c'
  },
  {
    id: 'regular',
    group: 'Beyond context-free',
    name: 'A right-linear grammar',
    blurb: 'Type 3 — this one converts straight into a finite automaton.',
    words: ['ab', 'aab', 'b'],
    text: 'S → a S | b T\nT → b T | ε'
  }
];

export function grammarExample(id) {
  return GrammarExamples.find(e => e.id === id) || null;
}

/** Grouped in declaration order, for the picker. */
export function exampleGroups() {
  const out = [];
  GrammarExamples.forEach(e => {
    let g = out.find(x => x.label === e.group);
    if (!g) { g = { label: e.group, items: [] }; out.push(g); }
    g.items.push(e);
  });
  return out;
}
