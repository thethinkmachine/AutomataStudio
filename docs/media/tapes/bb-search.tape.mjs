// automata bb-search: every 4-state Turing machine in tree normal form,
// classified — and BB(4) = 107 comes out the other end, with no holdouts.
// The tally counts as the machines come back; the search itself runs for
// about a minute, played here several times faster.
export default {
  about: 'bb-search -n 4: 858,909 machines classified, BB(4) = 107 (sped up)',
  title: 'automata bb-search',
  cols: 100,
  rows: 22,
  async run(t) {
    await t.type('automata bb-search -n 4');
    t.speed(8);
    await t.enter();
    t.speed(1);
    await t.sleep(600);
  }
};
