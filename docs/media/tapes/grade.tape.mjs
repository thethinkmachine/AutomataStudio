// Teaching: an exercise made from a regular expression, a class graded against
// it, and the submissions grouped by the language they accept — which puts
// two students who handed in the same wrong answer side by side.
export default {
  about: 'grade and similar: a class of nine graded, the same wrong answer found twice',
  title: 'automata grade',
  cols: 104,
  rows: 28,
  async setup(t) {
    t.sh('mv class/* . && rmdir class && rm exercise.automaton key.automaton');
  },
  async run(t) {
    await t.run('automata generate --from-regex "(ab|ba)*" --max-states 6 -o week3', { pause: 900 });
    await t.run('automata grade week3/exercise-1.automaton submissions/*.automaton', { pause: 2600 });
    await t.run('automata similar submissions/*.automaton', { pause: 1200 });
  }
};
