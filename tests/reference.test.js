import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.js';
import { MachineCategories, MachineTypes } from '../js/state.js';
import { GuideOverview, MachineGuides } from '../js/machine-guide.js';
import { ConceptCategories, ConceptGuides } from '../js/concept-guide.js';
import { referencePages, renderReferenceView } from '../js/reference.js';

// The Reference view.
//
// The navigation is generated from MachineCategories rather than written out
// in index.html, which removes one way for the two to drift but not the other:
// a machine can still be added to js/state.js with no guide behind it. That is
// what the first test is for.
const harness = createHarness();

test('every machine the model picker offers has a guide', () => {
  const listed = MachineCategories.flatMap(cat => cat.machines);
  const missing = listed.filter(m => !MachineGuides[m]);
  assert.deepEqual(missing, [], `machines listed with no guide: ${missing.join(', ')}`);
});

test('every guide names a real machine type', () => {
  const unknown = Object.keys(MachineGuides).filter(m => !MachineTypes[m]);
  assert.deepEqual(unknown, [], `guides for machines that do not exist: ${unknown.join(', ')}`);
});

test('PDA is deliberately absent, being a hidden alias of DPDA', () => {
  assert.ok(MachineTypes['PDA'], 'PDA is still a machine type');
  assert.ok(!MachineCategories.some(c => c.machines.includes('PDA')), 'PDA is not in the picker');
  assert.ok(!MachineGuides['PDA'], 'PDA has no guide of its own');
  assert.match(JSON.stringify(MachineGuides['DPDA']), /alias/i, 'the DPDA guide says so');
});

// Machine and concept slugs share one id namespace (`ref-sec-<slug>`), so
// uniqueness has to be checked across both registries, not within each.
test('slugs are unique across both registries, since they become element ids', () => {
  const slugs = [
    GuideOverview.slug,
    ...Object.values(MachineGuides).map(g => g.slug),
    ...Object.values(ConceptGuides).map(g => g.slug)
  ];
  assert.equal(new Set(slugs).size, slugs.length, `duplicate slug in ${slugs.join(', ')}`);
  slugs.forEach(slug => assert.match(slug, /^[a-z0-9-]+$/, `slug is not id-safe: ${slug}`));
});

test('every concept page listed in a category exists', () => {
  for (const cat of ConceptCategories) {
    assert.ok(cat.label, `concept category ${cat.id} has no label`);
    assert.ok(cat.pages.length > 0, `concept category ${cat.id} is empty`);
    const missing = cat.pages.filter(slug => !ConceptGuides[slug]);
    assert.deepEqual(missing, [], `${cat.id} lists pages with no guide: ${missing.join(', ')}`);
  }
});

test('every concept guide is reachable from a category', () => {
  const listed = new Set(ConceptCategories.flatMap(c => c.pages));
  const orphans = Object.keys(ConceptGuides).filter(slug => !listed.has(slug));
  assert.deepEqual(orphans, [], `concept guides in no category: ${orphans.join(', ')}`);
});

test('a concept guide keys itself by its own slug', () => {
  for (const [key, g] of Object.entries(ConceptGuides)) {
    assert.equal(key, g.slug, `ConceptGuides['${key}'] carries slug '${g.slug}'`);
  }
});

test('each guide carries the fields the renderer reads', () => {
  const guides = [GuideOverview, ...Object.values(MachineGuides), ...Object.values(ConceptGuides)];
  for (const g of guides) {
    assert.ok(g.title, `missing title: ${g.slug}`);
    assert.ok(g.tagline, `missing tagline: ${g.slug}`);
    assert.ok(g.accent, `missing accent: ${g.slug}`);
    assert.ok(Array.isArray(g.sections) && g.sections.length >= 3,
      `${g.slug} should have at least three sections, has ${g.sections?.length}`);
    for (const section of g.sections) {
      assert.ok(section.h, `${g.slug} has a section with no heading`);
      assert.ok(section.blocks.length > 0, `${g.slug} / ${section.h} is empty`);
      for (const block of section.blocks) {
        assert.ok(['p', 'ul', 'math', 'note', 'table'].includes(block.t),
          `${g.slug} / ${section.h} has an unknown block kind ${block.t}`);
        if (block.t === 'ul') assert.ok(block.x.length > 0, `${g.slug} / ${section.h} has an empty list`);
        if (block.t === 'table') {
          assert.ok(block.rows.length > 0, `${g.slug} / ${section.h} has an empty table`);
          for (const row of block.rows) {
            assert.equal(row.length, block.head.length,
              `${g.slug} / ${section.h}: row of ${row.length} against ${block.head.length} columns`);
          }
        }
      }
    }
  }
});

test('every machine states its formal definition', () => {
  for (const [machine, g] of Object.entries(MachineGuides)) {
    const formal = g.sections.find(s => /formal definition/i.test(s.h));
    assert.ok(formal, `${machine} has no formal-definition section`);
    assert.ok(formal.blocks.some(b => b.t === 'math'),
      `${machine}'s formal definition has no display maths`);
  }
});

test('the page order is overview, then machines, then concepts', () => {
  const pages = referencePages();
  assert.equal(pages[0].guide, GuideOverview);
  assert.equal(pages[0].machine, null);

  const machines = MachineCategories.flatMap(cat => cat.machines.filter(m => MachineGuides[m]));
  const concepts = ConceptCategories.flatMap(cat => cat.pages.filter(s => ConceptGuides[s]));
  assert.equal(pages.length, 1 + machines.length + concepts.length);

  const machinePages = pages.slice(1, 1 + machines.length);
  assert.deepEqual(machinePages.map(pg => pg.machine), machines);

  // Concept pages carry no machine, which is what suppresses the machine chip.
  const conceptPages = pages.slice(1 + machines.length);
  assert.deepEqual(conceptPages.map(pg => pg.guide.slug), concepts);
  assert.deepEqual([...new Set(conceptPages.map(pg => pg.machine))], [null]);

  // The nav label is the compact name, which is what fits a 190px column.
  const npda = pages.find(pg => pg.machine === 'NPDA');
  assert.equal(npda.label, MachineTypes['NPDA'].label);
  assert.equal(npda.group, 'Memory Automata');
  assert.equal(pages.find(pg => pg.guide.slug === 'rice').group, 'Decidability');
});

test('renderReferenceView survives a DOM with nothing in it', () => {
  harness.resetApp();
  assert.doesNotThrow(() => renderReferenceView());
});
