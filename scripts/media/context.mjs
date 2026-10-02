// What a tape is handed: the shell to type into, the stage to show things on,
// and a few things a tape does off camera (write a file, run a command it does
// not want filmed, open the desktop app).

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { closeApp, cursorTo, doubleClickState, installOverlay, openApp, pressKeys } from './app.mjs';
import { findBash, shellEnv } from './terminal.mjs';

export function tapeContext({ term, stage, dir, root }) {
  const t = {
    dir, root, term, stage,
    type: (s, o) => term.type(s, o),
    enter: o => term.enter(o),
    run: (s, o) => term.run(s, o),
    key: (k, o) => term.key(k, o),
    waitFor: (p, o) => term.waitFor(p, o),
    waitPrompt: (n, o) => term.waitPrompt(n, o),
    prompts: () => term.prompts().length,
    settle: ms => term.settle(ms),
    sleep: ms => term.sleep(ms),
    clear: () => term.clear(),
    hide: () => stage.hide(),
    /** Play what follows this many times faster (1 for real time). */
    speed: factor => stage.setSpeed(factor),
    show: () => stage.show(),

    /** A file in the working directory, written off camera. */
    file(name, text) { writeFileSync(join(dir, name), text); },
    read(name) { return readFileSync(join(dir, name), 'utf8'); },

    /** A shell command run off camera, in the working directory. Throws if it fails. */
    sh(command) {
      const r = spawnSync(findBash(), ['-c', command], { cwd: dir, encoding: 'utf8', env: shellEnv(join(dir, '.bin')) });
      if (r.status !== 0) throw new Error(`off-camera \`${command}\` exited ${r.status}: ${r.stderr}`);
      return r.stdout;
    },

    /**
     * Open the desktop app on a file in the working directory and film its
     * window into the side pane. Afterwards t.app drives it.
     */
    async openApp({ file, width, height, ready }) {
      const handle = await openApp({ root, file: join(dir, file), width, height });
      if (ready) await ready(handle.page);
      await installOverlay(handle.page);
      stage.attachApp(handle.page);
      t.app = {
        page: handle.page,
        doubleClickState: name => doubleClickState(handle.page, name),
        press: (keys, label) => pressKeys(handle.page, keys, label),
        cursorTo: (x, y) => cursorTo(handle.page, x, y)
      };
      t.closeApp = () => closeApp(handle);
    },

    /** Show an SVG file from the working directory in the side pane. */
    async preview(name, title = name) {
      await stage.setSideSvg(readFileSync(join(dir, name), 'utf8'), title);
    }
  };
  return t;
}
