import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The two tabbed dialogs -- Engine Settings and Keyboard Shortcuts -- share one
// switcher (switchModalTab in js/ui.js), which pairs a tab with its panel by
// string: the tab id inside the onclick becomes `<prefix><id>` and that is
// looked up with getElementById. Nothing checks that the pair exists. Rename a
// panel id, or add a tab and forget the panel, and the tab is simply inert when
// clicked -- no error anywhere.
//
// This is a static read of index.html rather than a DOM test because the DOM
// stub's getElementById creates elements on demand, so a missing panel would
// still come back as an object and take the `active` class.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

const DIALOGS = [
  { name: 'Engine Settings', rail: 'settings-tabs', handler: 'switchSettingsTab', prefix: 'tab-' },
  { name: 'Keyboard Shortcuts', rail: 'help-tabs', handler: 'switchHelpTab', prefix: 'help-tab-' },
];

// The rail element's inner markup, from its id to the next closing div at the
// same nesting depth. The tabs are leaf divs, so depth counting is enough.
function railMarkup(railId) {
  const start = html.indexOf(`id="${railId}"`);
  assert.notEqual(start, -1, `no element with id="${railId}"`);
  const open = html.indexOf('>', start) + 1;
  let depth = 1, i = open;
  const tag = /<(\/?)div\b[^>]*>/g;
  tag.lastIndex = open;
  let m;
  while ((m = tag.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) { i = m.index; break; }
  }
  return html.slice(open, i);
}

for (const { name, rail, handler, prefix } of DIALOGS) {
  test(`${name}: every tab has a panel and exactly one of each starts active`, () => {
    const markup = railMarkup(rail);

    const tabs = [...markup.matchAll(new RegExp(`${handler}\\('([^']+)'\\)`, 'g'))].map(m => m[1]);
    assert.ok(tabs.length > 1, `${rail} has ${tabs.length} tabs`);
    assert.equal(new Set(tabs).size, tabs.length, `${rail} lists a tab id twice`);

    for (const id of tabs) {
      assert.ok(
        html.includes(`id="${prefix}${id}"`),
        `tab '${id}' points at #${prefix}${id}, which is not in index.html`
      );
    }

    // Every panel should be reachable from the rail, or it is dead markup.
    const panels = [...html.matchAll(new RegExp(`class="modal-tab-content[^"]*" id="${prefix}([^"]+)"`, 'g'))]
      .map(m => m[1]);
    assert.deepEqual(panels.slice().sort(), tabs.slice().sort(),
      `${name}: panels and tabs disagree`);

    // switchModalTab clears `active` before setting it, so the initial pair in
    // the markup is the only thing deciding what an unopened dialog shows.
    const activeTabs = [...markup.matchAll(/class="modal-tab active"/g)].length;
    assert.equal(activeTabs, 1, `${rail} should mark exactly one tab active, found ${activeTabs}`);

    const activePanels = tabs.filter(id =>
      new RegExp(`class="modal-tab-content active" id="${prefix}${id}"`).test(html)).length;
    assert.equal(activePanels, 1, `${name} should mark exactly one panel active, found ${activePanels}`);
  });
}
