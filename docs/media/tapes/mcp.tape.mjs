// automata mcp: Claude Code with the engine as tools, asked whether the
// draft substring matcher from the fuzz clip is right. A real session — the
// tool calls and the answer are whatever the model did on the day, so each
// re-recording reads a little differently. Needs `claude` on the PATH and
// signed in; it is skipped when there is none.
//
// Launching it and trusting the folder happen off camera; the server is given
// by a config file in the working directory rather than `claude mcp add`, so
// recording never changes the recorder's own Claude Code configuration.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Refuse rather than publish someone's account: checked when filming starts
// and again at the end, in case a full repaint brought the panel back.
async function assertNoAccount(t) {
  const screen = (await t.stage.lines()).join('\n');
  if (/Welcome back|Tips for getting started|Claude (Pro|Max|Team|Enterprise)|@[\w.-]+\.\w+/.test(screen)) {
    throw new Error('account details are on screen; not filming them');
  }
}

export default {
  about: 'mcp: Claude Code (Sonnet 5.5) asks the engine whether a machine is right (real session; needs claude)',
  title: 'claude — with automata mcp',
  cols: 100,
  rows: 30,
  maxIdle: 1500,
  available() {
    const r = spawnSync('claude --version', { encoding: 'utf8', shell: true });
    if (r.status !== 0) return 'claude is not on the PATH';
    // Claude Code used only from an editor has never been through its terminal
    // first run, and the tape would film the onboarding screens. Only read:
    // finishing it is the recorder's own choice.
    try {
      const config = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'));
      if (!config.hasCompletedOnboarding) return 'Claude Code has not been set up in a terminal yet: run `claude` once and finish its first-run steps';
    } catch { return 'Claude Code has not been set up in a terminal yet: run `claude` once'; }
    return null;
  },
  async setup(t) {
    const cli = t.root.replace(/\\/g, '/') + 'cli/automata.mjs';
    t.file('mcp.json', JSON.stringify({ mcpServers: { automata: { command: 'node', args: [cli, 'mcp'] } } }, null, 2));
  },
  async run(t) {
    // The welcome panel carries the recorder's name, plan and paths, and a
    // full repaint brings it back mid-session, so it is redacted at the stage
    // before it is ever painted. It is the only thing Claude Code draws with a
    // box character in the first column (its own output is indented), so the
    // rows from the first such row to the last are blanked — a line of the
    // panel that wrapped included, and whichever edge a repaint scrolled away.
    await t.stage.redact(/^[╭│╰]/);
    t.hide();
    // No built-in tools: the answer has to come through automata's, which is
    // what the clip is about, rather than from reading the file.
    await t.type('claude --mcp-config mcp.json --strict-mcp-config --allowedTools "mcp__automata__*" --tools "" --model claude-sonnet-5-5', { speed: 1 });
    await t.enter({ wait: false });
    // The first run in a folder asks whether to trust it; the answer is yes.
    for (let i = 0; i < 120; i++) {
      const screen = (await t.stage.lines()).join('\n');
      if (/for shortcuts|Try "/.test(screen)) break;
      if (/trust/i.test(screen) && /Yes/.test(screen)) { await t.key('enter', { show: false }); await t.sleep(1500); continue; }
      await t.sleep(500);
    }
    await t.sleep(1000);
    await t.show();
    await assertNoAccount(t);
    await t.sleep(600);
    await t.type('Does contains-aab.automaton accept exactly the words over {a,b} that contain aab? If not, give me the shortest word it gets wrong.');
    await t.sleep(400);
    await t.key('enter', { show: false });
    // Until the answer is in: the screen quiet for a while, with a word in it.
    await t.waitFor(/aaab/, { timeout: 300000 });
    await t.settle(6000);
    await assertNoAccount(t);
    await t.sleep(2500);
    t.hide();
    await t.key('ctrl+c', { show: false });
    await t.sleep(300);
    await t.key('ctrl+c', { show: false });
  }
};
