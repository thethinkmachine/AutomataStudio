// automata fuzz: a DFA meant to accept the words containing aab, checked
// against a four-line program that says what that means. Nothing up to length
// 3 tells them apart; a random word does, and shrinking cuts it down to the
// smallest word that shows the bug. trace then shows the bug itself: after
// aa, another a sends the machine back to the start.
export default {
  about: 'fuzz: a substring matcher against its spec, shrunk to aaab, then traced',
  title: 'automata fuzz',
  cols: 100,
  rows: 26,
  async run(t) {
    await t.run('automata run contains-aab.automaton aab baab abaab', { pause: 1600 });
    await t.run(`automata fuzz contains-aab.automaton --oracle "node contains-aab.mjs" \\
    --batch --mode stdout --seed 4 -v`, { pause: 2600 });
    await t.run('automata trace contains-aab.automaton aaab', { pause: 1200 });
  }
};
