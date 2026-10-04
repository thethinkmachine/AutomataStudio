import test from 'node:test';
import assert from 'node:assert/strict';
import { packageVersion, statedVersions } from '../scripts/sync-version.mjs';

// package.json is the version's one source; CITATION.cff and the README's
// citations repeat it as text, and `npm version` keeps them in step through
// scripts/sync-version.mjs. Tags once ran ahead of all three by four minor
// versions, so the website's About and the citation people copy both named a
// release that was long gone.
test('every stated version matches package.json', () => {
  const version = packageVersion();
  for (const site of statedVersions()) {
    assert.notEqual(site.found, null, `${site.label}: pattern no longer matches ${site.file}`);
    assert.equal(site.found, version, `${site.label} says ${site.found}; run \`node scripts/sync-version.mjs\``);
  }
});
