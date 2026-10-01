#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  WHO MAY CHANGE AN ENTRY
// ══════════════════════════════════════════════════════════════════
// The PR check's second half. Analysis says whether a machine is sound; this
// says whether the person proposing it may make the change. An entry is
// credited to a GitHub account, and a pull request that edits or deletes it,
// or rewrites whom it credits, has to come from that account — or from a
// maintainer listed in library.config.json *on the base branch*: the list a
// pull request proposes is part of what is being reviewed, and one that added
// its own author would otherwise wave itself through. A new entry has to
// credit the account that opens the pull request; collections and the config
// are the maintainers' to change.
//
// An essay beside a machine (bb5.md beside bb5.automaton) carries no credit of
// its own — it is Markdown — so it is credited as its machine is: the
// machine's author, or a maintainer, may write it, and nobody else may attach
// one to their machine. A collection's essay is the collection's, and so the
// maintainers'.
//
// Pull requests opened by the submission workflow are exempt: that workflow
// sets the credit from the issue's author itself (issue-to-entry.mjs), which
// is the check this one would otherwise be repeating.
//
//   node scripts/library/guard.mjs --base origin/main --author octocat
//
// Import-free of the app: it reads JSON and runs git, nothing else.

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BOTS = new Set(['github-actions[bot]', 'automata-library[bot]']);

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

const creditOf = text => {
  try { return String(JSON.parse(text)?.meta?.library?.author?.login || '').toLowerCase(); } catch { return ''; }
};

/** The maintainers as the base branch lists them — never as the change proposes. */
export function maintainersAt(root, base) {
  try {
    const config = JSON.parse(git(['show', `${base}:library.config.json`], root));
    return Array.isArray(config.maintainers) ? config.maintainers : [];
  } catch {
    return [];
  }
}

const isEssay = path => /^machines\/.+\.md$/.test(path || '');

/**
 * Whether `who` may write the essay at `path`: whoever the machine beside it
 * credits — as the base branch has it, or, for a machine this change adds, as
 * the change has it (the check below it already holds that to `who`).
 */
async function essayProblems(root, base, path, who) {
  const machine = path.replace(/\.md$/, '.automaton');
  let atBase = '';
  try { atBase = git(['show', `${base}:${machine}`], root); } catch { atBase = ''; }
  const now = await readFile(resolve(root, machine), 'utf8').catch(() => '');
  const owner = creditOf(atBase) || creditOf(now);
  if (!owner) return [`\`${path}\`: an essay sits beside the machine it is about, and there is no \`${machine}\`.`];
  if (owner !== who) return [`\`${path}\` is the essay of \`${machine}\`, credited to @${owner}; only they or a maintainer can write it.`];
  return [];
}

/** Problems with the change, as sentences. Empty when it may go in. */
export async function guardChanges({ root, base, author, maintainers = [] }) {
  const who = String(author || '').toLowerCase();
  if (BOTS.has(who)) return [];
  const trusted = new Set(maintainers.map(m => String(m).toLowerCase()));
  if (trusted.has(who)) return [];
  const problems = [];
  const changed = git(['diff', '--name-status', '--find-renames', `${base}...HEAD`, '--', 'machines', 'collections', 'library.config.json'], root)
    .trim().split('\n').filter(Boolean).map(line => line.split('\t'));
  for (const [status, a, b] of changed) {
    const before = a;
    const after = status.startsWith('R') ? b : a;
    if (!before.startsWith('machines/') && !after.startsWith('machines/')) {
      problems.push(`\`${after || before}\`: collections and the library's config are changed by maintainers.`);
      continue;
    }
    if (isEssay(before) || isEssay(after)) {
      for (const path of new Set([before, after].filter(isEssay))) problems.push(...await essayProblems(root, base, path, who));
      continue;
    }
    let old = '';
    if (status !== 'A') { try { old = git(['show', `${base}:${before}`], root); } catch { old = ''; } }
    const now = status === 'D' ? '' : await readFile(resolve(root, after), 'utf8').catch(() => '');
    const owner = creditOf(old);
    if (old && owner && owner !== who) {
      problems.push(`\`${before}\` is credited to @${owner}; only they or a maintainer can ${status === 'D' ? 'delete' : 'change'} it. A remix belongs in a new file with \`meta.library.forkOf\` set.`);
      continue;
    }
    if (now && creditOf(now) !== who) {
      problems.push(`\`${after}\` credits @${creditOf(now) || '(nobody)'}, but this pull request is from @${who}. An entry is credited to the account that submits it.`);
    }
  }
  return problems;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const root = resolve(arg('--library', '.'));
  const base = arg('--base', 'origin/main');
  const problems = await guardChanges({ root, base, author: arg('--author', process.env.PR_AUTHOR), maintainers: maintainersAt(root, base) });
  for (const p of problems) console.log(`- ❌ ${p}`);
  if (!problems.length) console.log('Every change is by the author it credits.');
  process.exitCode = problems.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
