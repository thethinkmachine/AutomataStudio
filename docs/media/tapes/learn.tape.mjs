// automata learn: L* asks the same program from the fuzz clip what is in the
// language, and builds the DFA it describes. equiv then names the word the
// hand-drawn draft gets wrong, and the learned machine is drawn.
export default {
  about: 'learn: L* builds the aab matcher from its spec; equiv and svg',
  title: 'automata learn',
  cols: 100,
  rows: 13,
  side: { position: 'below', height: 330, title: 'learned.svg', hidden: true },
  async run(t) {
    await t.run(`automata learn --oracle "node contains-aab.mjs" --batch \\
    --mode stdout --sigma ab -v -o learned.automaton`, { pause: 2000 });
    await t.run('automata equiv learned.automaton contains-aab.automaton', { pause: 1800 });
    await t.run('automata svg learned.automaton -o learned.svg', { pause: 300 });
    await t.preview('learned.svg');
    await t.sleep(1200);
  }
};
