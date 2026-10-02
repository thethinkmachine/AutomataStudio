// automata play: a Turing machine adding 5 and 3, with its space-time history.
// Pausing, stepping back and forward, and speeding up are all shown, each key
// labelled on screen as it is pressed.
export default {
  about: 'play: the binary-addition TM, paused, stepped, sped up',
  title: 'automata play',
  cols: 100,
  rows: 30,
  async run(t) {
    await t.type('automata play add.automaton 0101+11 --history');
    await t.enter({ wait: false });
    const back = t.prompts() + 1;
    await t.sleep(3200);
    await t.key('space', { pause: 1100 });
    for (let i = 0; i < 3; i++) await t.key('left', { pause: 450 });
    await t.sleep(500);
    for (let i = 0; i < 2; i++) await t.key('right', { pause: 450 });
    await t.sleep(400);
    await t.key('+', { pause: 300 });
    await t.key('+', { pause: 300 });
    await t.key('space');
    await t.waitFor('✔ accept');
    await t.sleep(1000);
    // The clip ends on the verdict; quitting is not worth the frames.
    t.hide();
    await t.key('q', { show: false });
    await t.waitPrompt(back);
  }
};
