// git diff on a machine: first as git sees it — JSON, coordinates and all —
// then with automata as the textconv, which lists what changed in the machine
// rather than in the file, and difftool, which also says whether the language
// changed and gives the shortest word that shows it.
export default {
  about: 'git diff on an .automaton file, before and after the textconv',
  title: 'git diff',
  cols: 100,
  rows: 28,
  maxIdle: 2400,
  async setup(t) {
    t.sh('git init -q -b main . && git config core.autocrlf false && git config user.name demo && git config user.email demo@example.com');
    t.sh('git add div5.automaton && git commit -qm div5');
    // An edit made in the app: two states dragged, and one edge pointed somewhere else.
    const doc = JSON.parse(t.read('div5.automaton'));
    doc.states[1].x += 40;
    doc.states[3].y -= 30;
    doc.transitions.find(e => e.from === 's3' && e.symbol === '1').to = 's4';
    t.file('div5.automaton', JSON.stringify(doc, null, 2) + '\n');
  },
  async run(t) {
    await t.run('git diff --stat', { pause: 900 });
    await t.run('git --no-pager diff | head -24', { pause: 2200 });
    await t.clear();
    await t.run('git config diff.automaton.textconv "automata diff --textconv"', { pause: 200 });
    await t.run('echo "*.automaton diff=automaton" >> .gitattributes', { pause: 400 });
    await t.run('git --no-pager diff div5.automaton', { pause: 2400 });
    await t.run('git difftool -y -x "automata diff" div5.automaton', { pause: 1500 });
  }
};
