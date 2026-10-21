// automata test --watch beside the desktop app: the machine has one accepting
// state too many, so three expectations fail; double-clicking the state in the
// app unmarks it, Ctrl+S saves the file, and the terminal reruns by itself.
// This is the real app on the real file — the save is what the watcher sees.
export default {
  about: 'test --watch beside the desktop app: fix a machine, save, watch it pass',
  title: 'automata test --watch',
  cols: 100,
  rows: 16,
  side: { position: 'above', height: 572, bare: true, background: '#0d1322' },
  app: {
    file: 'div5.automaton',
    width: 1200,
    height: 760,
    async ready(page) {
      await page.waitForSelector('[data-id="s2"]', { timeout: 30000 });
      await page.waitForTimeout(1500);
    }
  },
  async setup(t) {
    // The slip being fixed: r1 (remainder 1) marked accepting beside r0.
    const doc = JSON.parse(t.read('div5.automaton'));
    doc.accepts = ['s1', 's2'];
    t.file('div5.automaton', JSON.stringify(doc, null, 2) + '\n');
  },
  async run(t) {
    await t.sleep(800);
    await t.type('automata test --watch div5.automaton words.txt');
    await t.enter({ wait: false });
    await t.waitFor(/[1-9] failed/);
    await t.sleep(2600);
    await t.app.doubleClickState('r1');
    await t.sleep(1000);
    await t.app.press('Control+s', 'ctrl S');
    await t.waitFor('10 passed');
    await t.sleep(2400);
  }
};
