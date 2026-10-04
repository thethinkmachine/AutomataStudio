// Copies package.json's version into the places that state it as text:
// CITATION.cff and the README's two citations.
//
//   npm version 3.2.0                    bump, sync, commit and tag, in one step
//   node scripts/sync-version.mjs         sync to package.json by hand
//   node scripts/sync-version.mjs --check [--expect 3.2.0]
//
// Why this exists: releases used to take their version from the tag alone --
// the release workflow rewrote package.json on the runner and never committed
// it -- so the tags reached v3.1.3 while the repository still said 2.9.0. The
// website is built from the repository, so its About dialog showed 2.9.0, and
// so did the "cite this version" text people copy into papers.
//
// package.json is the one source now. `npm version` runs this file as its
// `version` hook, after it has bumped package.json and before it commits, so
// the bump, these copies and the tag land in one commit. `--check` is what CI
// runs on a tag: it fails a release whose repository disagrees with its tag,
// before anything is built, rather than shipping one more mismatch.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Each copy is one pattern of exactly three groups, the version in the middle
// (the third may match nothing, which keeps the replacer's arguments lined up;
// it takes a CR so a CRLF checkout on Windows matches too). A pattern that
// stops matching is an error, not a silent skip: a reworded README would
// otherwise leave a stale version that nothing checks any more.
export const VERSION_SITES = [
  { file: 'CITATION.cff', label: 'CITATION.cff version', pattern: /^(version: )(\S+)(\r?)$/m },
  { file: 'README.md', label: 'README BibTeX version', pattern: /^(\s*version\s*=\s*\{)([^}]+)(\},?\r?)$/m },
  { file: 'README.md', label: 'README APA citation', pattern: /(\(Version )([^)]+)(\))/ },
];

export function packageVersion(root = ROOT) {
  return JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
}

// Every site with the version it currently states (null when the pattern no
// longer matches anything).
export function statedVersions(root = ROOT) {
  return VERSION_SITES.map(site => {
    const m = readFileSync(resolve(root, site.file), 'utf8').match(site.pattern);
    return { ...site, found: m ? m[2] : null };
  });
}

function sync(version) {
  const byFile = new Map();
  for (const site of VERSION_SITES) {
    const text = byFile.get(site.file) ?? readFileSync(resolve(ROOT, site.file), 'utf8');
    if (!site.pattern.test(text)) throw new Error(`${site.label}: pattern no longer matches ${site.file}`);
    byFile.set(site.file, text.replace(site.pattern, (_, pre, _old, post) => `${pre}${version}${post}`));
  }
  for (const [file, text] of byFile) writeFileSync(resolve(ROOT, file), text);
}

function main(argv) {
  const version = packageVersion();
  if (!argv.includes('--check')) {
    sync(version);
    console.log(`Synced CITATION.cff and README.md to ${version}.`);
    return 0;
  }

  const problems = [];
  const at = argv.indexOf('--expect');
  const expected = at >= 0 ? argv[at + 1] : null;
  if (expected && expected !== version) problems.push(`package.json says ${version}, the tag says ${expected}`);
  for (const s of statedVersions()) {
    if (s.found === null) problems.push(`${s.label}: pattern no longer matches ${s.file}`);
    else if (s.found !== version) problems.push(`${s.label} says ${s.found}, package.json says ${version}`);
  }
  if (!problems.length) {
    console.log(`Version ${version} is consistent.`);
    return 0;
  }
  console.error(problems.map(p => `- ${p}`).join('\n'));
  console.error(`\nRelease with \`npm version ${expected || '<x.y.z>'}\`, which bumps, syncs, commits and tags in one step.`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
