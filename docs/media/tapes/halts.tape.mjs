// automata halts on nine Turing machines: the BB(2), BB(2,4) and BB(5)
// champions halt; five machines are proved never to halt, each by a different
// method; and Antihydra comes back unknown, because whether it halts is an
// open problem. check-proof then re-checks every proof that was written.
export default {
  about: 'halts and check-proof: nine machines, three verdicts, eight proofs checked',
  title: 'automata halts',
  cols: 118,
  rows: 31,
  async run(t) {
    await t.run('cat machines.txt', { pause: 2000 });
    await t.clear();
    await t.run('automata halts machines.txt --budget 10000000 --far 5 --proof proofs', { pause: 3400 });
    await t.clear();
    await t.run('automata check-proof proofs/*.json', { pause: 1500 });
  }
};
