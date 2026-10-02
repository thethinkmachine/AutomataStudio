// Machines down a pipe: a regular expression in, a minimal DFA drawn out.
// Then eval, which decides language questions in one expression.
export default {
  about: 'pipes and eval: from-regex | minimize | svg, then inclusion and equality',
  title: 'automata from-regex | minimize | svg',
  cols: 100,
  rows: 13,
  side: { position: 'below', height: 330, title: 'abb.svg', hidden: true },
  async run(t) {
    await t.run(`automata from-regex "(a|b)*abb" \\
  | automata minimize - \\
  | automata svg - -o abb.svg`, { pause: 300 });
    await t.preview('abb.svg');
    await t.sleep(1800);
    await t.run('automata eval "/(a|b)*abb/ <= /(a|b)*b/"', { pause: 1400 });
    await t.run('automata eval "/(a|b)*abb/ == /(a|b)*bb/"', { pause: 1400 });
  }
};
