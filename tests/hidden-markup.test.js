import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// An element the markup ships `hidden` must actually be hidden. The user agent's
// `[hidden] { display: none }` loses to any author rule that sets a display, so a
// class like `.btn-p { display: inline-flex }` quietly overrides the attribute and
// the element draws anyway -- with no error, and with script that believes it hid
// it. That is how "Restart & Install" sat under "Up to Date" and, clicked, asked
// the updater to install nothing (UPD-99).
//
// The DOM stub computes no styles, so this reads the CSS: for each class on a
// statically hidden element, a rule that gives that class a display needs a
// `.class[hidden] { display: none }` beside it. Elements hidden only from script
// are not covered; the static ones are the ones that start out wrong.

const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');

test('no class on a hidden element overrides [hidden] with a display of its own', () => {
  const html = read('index.html');
  const css = fs.readdirSync(new URL('css/', root))
    .filter(f => f.endsWith('.css'))
    .map(f => read(`css/${f}`))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const hiddenClasses = new Map();
  for (const [, attrs] of html.matchAll(/<[a-z][a-z0-9-]*\b([^>]*)>/gi)) {
    if (!/(?:^|\s)hidden(?:[\s=/]|$)/.test(attrs)) continue;
    const classes = /\bclass="([^"]*)"/.exec(attrs)?.[1].split(/\s+/).filter(Boolean) ?? [];
    const id = /\bid="([^"]*)"/.exec(attrs)?.[1] ?? '(no id)';
    for (const cls of classes) hiddenClasses.set(cls, [...(hiddenClasses.get(cls) ?? []), id]);
  }
  assert.ok(hiddenClasses.size > 0, 'the scan found no hidden elements, so it is not reading the markup');

  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, sel, body]) => ({ selectors: sel.split(',').map(s => s.trim()), body }));

  const offenders = [];
  for (const [cls, ids] of hiddenClasses) {
    const shows = rules.some(r => /display\s*:\s*(?!none)/.test(r.body) && r.selectors.some(s => s.endsWith(`.${cls}`)));
    if (!shows) continue;
    const hides = rules.some(r => /display\s*:\s*none/.test(r.body) && r.selectors.some(s => s.includes(`.${cls}[hidden]`)));
    if (!hides) offenders.push(`.${cls} (on ${ids.join(', ')})`);
  }
  assert.deepEqual(offenders, [], 'add `.class[hidden] { display: none; }` beside the rule that sets the display');
});
