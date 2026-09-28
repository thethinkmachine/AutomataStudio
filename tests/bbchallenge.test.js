import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { context } from './harness.js';
import {
  canonicalCode, codesIn, collectMachines, entryBlurb, entryTitle, machinesOnPage, pagesFromExport, stripWiki, tablesIn, wikiUrl
} from '../scripts/library/bbchallenge.mjs';
import { bbchallengeEntries } from '../scripts/library/seed.mjs';
import { buildLibrary } from '../scripts/library/build.mjs';

// The bbchallenge wiki importer: which machines on a page count as documented,
// and what an entry made from one says. The fixtures are written for these
// tests in the wiki's markup; they are not copies of wiki pages, and the codes
// are machines whose behaviour the rest of the suite already pins.

const BB2 = '1RB1LB_1LA1RZ';
const BB4 = '1RB1LB_1LA0LC_1RZ1LD_1RD0RA';
const CYCLER = '0LB1RZ_1RA1RA_1RC1RB';
const MARCHER = '1RB1RA_1RC1RZ_0LA0LC';

test('a code is found in running text and templates, and one machine has one spelling', () => {
  assert.deepEqual(codesIn(`The machine {{TM|${BB2}}} and [https://bbchallenge.org/${BB4} this one].`), [BB2, BB4]);
  assert.equal(canonicalCode('1rb1lb_1la1rh'), BB2, 'H is a halt as much as Z is');
  assert.deepEqual(codesIn('1RB1LB_1LA1RH and 1RB1LB_1LA1RZ'), [BB2]);
  assert.deepEqual(codesIn('R2D2 and 1RB alone are not machines'), []);
});

test('wikitext is read down to what the reader sees', () => {
  assert.equal(stripWiki("'''[[Antihydra|The Beast]]'''<ref>x</ref> {{cite|y}}"), 'The Beast');
});

test('a page with an infobox documents its machine, under the page title', () => {
  const { machines } = machinesOnPage({ title: 'Marcher', text: `{{Infobox machine\n| code = {{TM|${MARCHER}}}\n}}\n'''Marcher''' is a machine.` });
  assert.deepEqual(machines, [{ code: MARCHER, name: 'Marcher', role: 'page' }]);
});

test('a page titled by its code takes its name from the bold lede', () => {
  const { machines } = machinesOnPage({ title: BB2, text: `'''Little Beaver''' is the champion.\n== History ==\nSee also '''${BB4}'''.` });
  assert.equal(machines[0].name, 'Little Beaver');
  assert.equal(machines[0].role, 'page');
});

test('a topic page is not about the machine in its infobox', () => {
  const { machines } = machinesOnPage({ title: 'BB(4)', text: `{{Infobox machine|code=${BB4}}}` });
  assert.equal(machines[0].role, 'example');
});

test('a table names machines only through a Name column', () => {
  const text = [
    '{| class="wikitable"', '! Name !! Machine !! Status',
    '|-', `| [[Cycler Bob]] || {{TM|${CYCLER}}} || Nonhalting`,
    '|-', `| style="x" | Marcher || {{TM|${MARCHER}}} || Nonhalting`,
    '|}',
    '{| class="wikitable"', '! Machine !! Status',
    '|-', `| ${BB4} || Halt`,
    '|}'
  ].join('\n');
  assert.equal(tablesIn(text).length, 2);
  const { machines } = machinesOnPage({ title: 'Some machines', text });
  const by = Object.fromEntries(machines.map(m => [m.code, m]));
  assert.deepEqual(by[CYCLER], { code: CYCLER, name: 'Cycler Bob', role: 'named' });
  assert.equal(by[MARCHER].name, 'Marcher');
  assert.deepEqual(by[BB4], { code: BB4, name: null, role: 'example' }, 'a status column is not a name');
});

test('a page listing many unnamed codes is a list, and is left out', () => {
  const text = [BB2, BB4, CYCLER, MARCHER].join('\n');
  assert.equal(machinesOnPage({ title: 'Holdouts', text }, { exampleCap: 3 }).machines.length, 0);
  assert.equal(machinesOnPage({ title: 'Holdouts', text }, { exampleCap: 3 }).skipped, 4);
  assert.equal(machinesOnPage({ title: 'Holdouts', text }, { exampleCap: 4 }).machines.length, 4);
});

test('a machine on several pages is one machine, named by the page that documents it best', () => {
  const { machines, report } = collectMachines([
    { title: 'Overview', text: `Examples: ${BB2}, 1RB1LB_1LA` },
    { title: 'Little Beaver', text: `{{Infobox machine|code=${BB2}}}\n[[Category:Champions]]` },
    { title: 'Nicknames', text: `{|\n! Nickname !! Code\n|-\n| Tiny || ${BB2}\n|}` }
  ]);
  assert.equal(machines.length, 1);
  assert.equal(machines[0].name, 'Little Beaver');
  assert.equal(machines[0].pages[0].title, 'Little Beaver');
  assert.deepEqual(machines[0].categories, ['Champions']);
  assert.equal(report.unreadable.length, 1, 'a malformed code is reported, not dropped silently');
});

test('an export dump reads as articles, without redirects or other namespaces', () => {
  const xml = `<mediawiki>
  <page><title>A &amp; B</title><ns>0</ns><revision><text xml:space="preserve">x &lt;b&gt; ${BB2}</text></revision></page>
  <page><title>Talk:A</title><ns>1</ns><revision><text>${BB4}</text></revision></page>
  <page><title>Old</title><ns>0</ns><redirect title="A" /><revision><text>#REDIRECT</text></revision></page>
</mediawiki>`;
  const pages = pagesFromExport(xml);
  assert.deepEqual(pages.map(p => p.title), ['A & B']);
  assert.match(pages[0].text, /<b>/);
});

test('an entry is written in the library\'s words and links back to the wiki', () => {
  const m = { code: CYCLER, name: null, role: 'example', pages: [{ title: 'Cyclers', role: 'example' }], categories: [] };
  assert.equal(entryTitle(m), CYCLER);
  assert.match(entryBlurb(m), /3-state, 2-symbol Turing machine discussed on the bbchallenge wiki \(Cyclers\)/);
  assert.equal(wikiUrl('Busy Beaver 6'), 'https://wiki.bbchallenge.org/wiki/Busy_Beaver_6');
});

test('seeded entries build, carry the analysis\'s badges, and skip machines seeded by hand', async () => {
  const data = collectMachines([
    { title: 'Champions', text: `{|\n! Name !! Code\n|-\n| Two || ${BB2}\n|-\n| Four || ${BB4}\n|}\n[[Category:Champions]]` },
    { title: 'Cycler Bob', text: `{{Infobox machine|code=${CYCLER}}}\n[[Category:Nonhalters]]` },
    { title: 'Marcher', text: `{{Infobox machine|code=${MARCHER}}}\n[[Category:Nonhalters]]` },
    { title: 'Also', text: `{{Infobox machine|code=1RB0RA_1LC1RB_1LA0LC}}\n[[Category:Nonhalters]]` }
  ]);
  const { entries, collections } = await bbchallengeEntries({ author: 'alice', skip: [BB2], data });
  assert.equal(entries.length, 4, 'BB(2) is already seeded by hand');
  assert.ok(entries.every(e => e.path.startsWith('machines/turing/bbchallenge/bb')));
  assert.deepEqual(Object.keys(collections).sort(), ['bbchallenge-bb3', 'bbchallenge-nonhalters']);

  const root = await mkdtemp(join(tmpdir(), 'bbc-lib-'));
  for (const e of entries) {
    await mkdir(join(root, e.path, '..'), { recursive: true });
    await writeFile(join(root, e.path), JSON.stringify(e.doc));
  }
  const out = await buildLibrary({ library: root, commit: '', site: 'https://example.test/lib/' });
  const index = context.normalizeIndex(JSON.parse(JSON.stringify(out.raw)));
  const four = index.entries.find(e => e.title === 'Four');
  assert.ok(four.badges.some(b => (b.id || b) === 'halts'));
  assert.equal(four.standard, BB4);
  const bob = index.entries.find(e => e.title === 'Cycler Bob');
  assert.ok(bob.badges.some(b => (b.id || b) === 'never-halts'));
  assert.ok(bob.tags.includes('bbchallenge') && bob.tags.includes('nonhalters'));
});
