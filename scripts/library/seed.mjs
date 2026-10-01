#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  START A LIBRARY CHECKOUT
// ══════════════════════════════════════════════════════════════════
// Creates the library repository's contents in a directory: the scaffolding in
// library-template/ (workflows, the issue form, README, licence), then the first
// machines — every example bundled with the app, the published busy beaver
// champions, a few non-halters and a few collections.
//
//   npm run library:init -- ../automata-library [--author thethinkmachine]
//
// Existing files are left alone unless --force is given, so it is safe to run
// over a checkout to add what is missing.

import './env.mjs';
import { App } from './env.mjs';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MachineExamples, MachineTypes, getMachineConfig } from '../../js/state.js';
import { readStandardTM } from '../../js/interop/standard-tm.js';
import { sugiyamaLayout } from '../../js/canvas.js';
import { SCHEMA_VERSION, WORKSPACE_FORMAT } from '../../js/persistence.js';
import { APP_VERSION } from '../../js/state.js';
import { categoryOf } from '../../js/library/analyze.js';
import { machineIdOf } from '../../js/library/hash.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '../..');

export const FOLDER_OF = { fa: 'finite', omega: 'omega', mem: 'memory', tm: 'turing', special: 'transducers' };

export function slugify(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ⁿ/g, 'n').replace(/ʳ/g, 'r').replace(/[·•]/g, ' ')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'machine';
}

/** Where a machine of this type lives: machines/<family>/<type>/. */
export function folderFor(machine) {
  const cfg = getMachineConfig(machine) || {};
  return `machines/${FOLDER_OF[categoryOf(machine)] || 'other'}/${slugify(cfg.file || machine)}`;
}

/** A Turing machine in the standard text format, laid out, as a library document. */
export function docFromStandardTM(src, { title, blurb, tags = [], author, license = 'CC-BY-4.0', chapter } = {}) {
  const d = readStandardTM(src, App.config.sym);
  sugiyamaLayout(d.states, d.transitions, d.startId);
  return {
    format: WORKSPACE_FORMAT, schema: SCHEMA_VERSION, app: APP_VERSION,
    machine: d.machine, config: { twoWayTape: true, sym: { ...App.config.sym } },
    sigma: d.sigma, stackAlpha: d.stackAlpha, outputAlpha: [], tapeCount: 1,
    states: d.states.map(s => ({ ...s, x: Math.round(s.x), y: Math.round(s.y) })),
    transitions: d.transitions, startId: d.startId, accepts: d.accepts,
    notes: [], dividers: [], blocks: [],
    meta: {
      title: title || d.title,
      blurb: blurb || `${src} — the standard text format. Run it on the empty word.`,
      library: { author: { login: author }, license, tags: ['standard-format', ...tags], ...(chapter ? { chapter } : {}) }
    }
  };
}

// Published step counts and ones: the bbchallenge wiki and Shawn Ligocki's
// machine files. tests/tm-behaviour.test.js checks the same numbers.
export const BUSY_BEAVERS = [
  { slug: 'bb2', src: '1RB1LB_1LA1RZ', title: 'BB(2) champion', blurb: 'The two-state, two-symbol busy beaver: 6 steps, 4 ones. The largest number of steps any halting 2-state machine takes on a blank tape.' },
  { slug: 'bb3-steps', src: '1RB1RZ_1LB0RC_1LC1LA', title: 'BB(3) champion — most steps', blurb: 'Three states, 21 steps: the longest-running halting 3-state machine.' },
  { slug: 'bb3-ones', src: '1RB1RZ_0RC1RB_1LC1LA', title: 'BB(3) champion — most ones', blurb: 'Three states, 6 ones: Σ(3). A different machine from the one that runs longest.' },
  { slug: 'bb4', src: '1RB1LB_1LA0LC_1RZ1LD_1RD0RA', title: 'BB(4) champion', blurb: 'Brady’s four-state champion: 107 steps and 13 ones, proven optimal in 1983.' },
  { slug: 'bb2x3', src: '1RB2LB1RZ_2LA2RB1LB', title: 'BB(2,3) champion', blurb: 'Two states, three symbols: 38 steps.' },
  { slug: 'bb2x4', src: '1RB2LA1RA1RA_1LB1LA3RB1RZ', title: 'BB(2,4) champion', blurb: 'Two states, four symbols: 3,932,964 steps and 2,050 non-blank cells.' },
  { slug: 'bb5', src: '1RB1LC_1RC1RB_1RD0LE_1LA1LD_1RZ0LA', title: 'BB(5) champion', blurb: 'Marxen and Buntrock’s five-state machine: 47,176,870 steps and 4,098 ones. The bbchallenge project proved in 2024 that no halting 5-state machine runs longer.' }
];

// Machines the classifier proves never halt, one per method, so the badge's
// three proofs each have a page to point at.
export const NON_HALTERS = [
  { slug: 'two-cell-cycler', src: '0LB1RZ_1RA1RA_1RC1RB', title: 'Two cells, forever', blurb: 'It has a halt — state A reading a 1 — and never reaches it: after two steps it bounces between two cells, and its whole configuration repeats every 2 steps. Proof: a cycler.' },
  { slug: 'translated-cycler', src: '1RB1RA_1RC1RZ_0LA0LC', title: 'Marching right forever', blurb: 'Never halts, and never repeats a configuration either: every 4 steps it is back in the same state with the same tape behind it, two cells further right. Proof: a translated cycler.' },
  { slug: 'unreachable-halt', src: '1LB0RC_0RA---_1LB0LA', title: 'A halt nothing leads to', blurb: 'State B has no move for a 1, so reading one would stop it. Searching backwards from that configuration shows nothing it can ever reach leads there. Proof: backward reasoning.' }
];

async function writeIfAbsent(file, text, force) {
  if (!force && existsSync(file)) return false;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  return true;
}

const pretty = doc => JSON.stringify(doc, null, 2) + '\n';

function exampleTitle(file, machine, meta) {
  if (meta?.title) return meta.title;
  const opt = (MachineExamples[machine] || []).find(o => o.file === file)
    || Object.values(MachineExamples).flat().find(o => o.file === file);
  return (opt?.label || file).replace(/^Classic:\s*/, '');
}

export async function seedLibrary(dir, { author = 'thethinkmachine', force = false } = {}) {
  const root = resolve(dir);
  const written = [];
  const skipped = [];
  await cp(join(APP_ROOT, 'library-template'), root, { recursive: true, force, errorOnExist: false });

  // A library lists a machine once, and the build refuses a second copy
  // (build.mjs, "the same machine, twice") — so the seed must not write one.
  // The bundled examples repeat themselves: BB(4) is also the two-way TM
  // example, the Büchi example is the classic DBA, the weak example is the DBA
  // retyped. The champions are claimed first, so BB(4) is listed where a
  // reader of the Hall of Fame looks for it; after that, first come first kept.
  const claimed = new Map();   // machine id → the entry id that has it
  const bbDocs = [...BUSY_BEAVERS, ...NON_HALTERS].map(bb => {
    const busy = BUSY_BEAVERS.includes(bb);
    const doc = docFromStandardTM(bb.src, {
      title: bb.title, blurb: bb.blurb, author,
      tags: busy ? ['busy-beaver', 'champion'] : ['non-halting', 'proof'],
      chapter: busy ? 'Radó 1962, “On non-computable functions”' : undefined
    });
    const path = `machines/turing/${busy ? 'busy-beaver' : 'non-halting'}/${bb.slug}.automaton`;
    const id = path.replace(/^machines\//, '').replace(/\.automaton$/, '');
    const mid = machineIdOf(doc);
    if (mid && !claimed.has(mid)) claimed.set(mid, id);
    return { doc, path, id };
  });

  // ── the bundled examples ──
  const ids = { byFile: new Map() };
  for (const f of (await readdir(join(APP_ROOT, 'js/examples'))).filter(x => x.endsWith('.json')).sort()) {
    const doc = JSON.parse(await readFile(join(APP_ROOT, 'js/examples', f), 'utf8'));
    const file = f.replace(/\.json$/, '');
    const machine = doc.machine === 'PDA' ? 'DPDA' : doc.machine;
    if (!MachineTypes[machine]) continue;
    const title = exampleTitle(file, doc.machine, doc.meta);
    const classic = /-classic$/.test(file);
    doc.format = WORKSPACE_FORMAT;
    doc.schema = doc.schema || SCHEMA_VERSION;
    doc.app = doc.app || APP_VERSION;
    doc.meta = {
      ...(doc.meta || {}),
      title: title.slice(0, 70),
      blurb: (doc.meta?.blurb || `The ${classic ? 'textbook' : 'bundled'} ${getMachineConfig(machine).fullName || machine} example.`).slice(0, 400),
      library: {
        author: { login: author }, license: 'CC-BY-4.0',
        tags: [classic ? 'textbook' : 'showcase', slugify(machine)],
        difficulty: classic ? 'intro' : 'intermediate'
      }
    };
    const path = `${folderFor(machine)}/${slugify(title)}.automaton`;
    const id = path.replace(/^machines\//, '').replace(/\.automaton$/, '');
    // A copy is not written; a collection naming it gets the one that was.
    const mid = machineIdOf(doc);
    if (mid && claimed.has(mid)) { ids.byFile.set(file, claimed.get(mid)); skipped.push({ path, sameAs: claimed.get(mid) }); continue; }
    if (mid) claimed.set(mid, id);
    ids.byFile.set(file, id);
    if (await writeIfAbsent(join(root, path), pretty(doc), force)) written.push(path);
  }

  // ── Turing machines in the standard format ──
  const bbIds = [];
  for (const { doc, path, id } of bbDocs) {
    bbIds.push(id);
    if (await writeIfAbsent(join(root, path), pretty(doc), force)) written.push(path);
  }

  // ── binary divisibility by 3 ──
  // The minimal DFA has three states, one per remainder.
  const div3 = {
    states: [{ id: 's1', name: 'r0', x: 150, y: 200 }, { id: 's2', name: 'r1', x: 350, y: 200 }, { id: 's3', name: 'r2', x: 550, y: 200 }],
    transitions: [
      { id: 't1', from: 's1', to: 's1', symbol: '0' }, { id: 't2', from: 's1', to: 's2', symbol: '1' },
      { id: 't3', from: 's2', to: 's1', symbol: '1' }, { id: 't4', from: 's2', to: 's3', symbol: '0' },
      { id: 't5', from: 's3', to: 's2', symbol: '0' }, { id: 't6', from: 's3', to: 's3', symbol: '1' }
    ]
  };
  const solution = {
    format: WORKSPACE_FORMAT, schema: SCHEMA_VERSION, app: APP_VERSION,
    machine: 'DFA', config: { sym: { ...App.config.sym } }, sigma: ['0', '1'], stackAlpha: [], outputAlpha: [], tapeCount: 1,
    states: div3.states, transitions: div3.transitions, startId: 's1', accepts: ['s1'], notes: [], dividers: [], blocks: [],
    meta: {
      title: 'Binary divisibility by 3',
      blurb: 'Three states, one per remainder mod 3. Reading bit b takes remainder r to (2r + b) mod 3.',
      inputs: [{ w: '', expect: 'accept', label: '0' }, { w: '11', expect: 'accept', label: '3' }, { w: '110', expect: 'accept', label: '6' }, { w: '1001', expect: 'accept', label: '9' }, { w: '10', expect: 'reject', label: '2' }, { w: '111', expect: 'reject', label: '7' }],
      library: { author: { login: author }, license: 'CC-BY-4.0', tags: ['divisibility', 'remainder'], difficulty: 'intro' }
    }
  };
  if (await writeIfAbsent(join(root, 'machines/finite/dfa/binary-divisibility-by-3.automaton'), pretty(solution), force)) written.push('machines/finite/dfa/binary-divisibility-by-3.automaton');

  // ── collections ──
  // Deduplicated: two examples that are one machine map to one entry.
  const pick = files => [...new Set(files.map(f => ids.byFile.get(f)).filter(Boolean))];
  const collections = {
    'busy-beavers': { title: 'Busy Beaver Hall of Fame', blurb: 'The champions: for each size, the halting machine that runs longest from a blank tape. Every step count here was checked by running the machine to its halt.', curator: author, entries: bbIds.filter(id => id.includes('busy-beaver')) },
    'halting-proofs': { title: 'Three ways to never halt', blurb: 'One machine per non-halting proof the library can make: an exact cycle, a cycle that drifts along the tape, and a halt that can never be reached.', curator: author, entries: bbIds.filter(id => id.includes('non-halting')) },
    'regular-languages': { title: 'Regular languages, start to finish', blurb: 'DFAs, NFAs, ε-NFAs and two-way automata — the finite-memory machines, from the textbook classics to the showcase examples.', curator: author, entries: [...pick(['dfa-classic', 'dfa', 'nfa-classic', 'nfa', 'enfa-classic', 'enfa', 'twdfa', 'twnfa']), 'finite/dfa/binary-divisibility-by-3'] },
    'omega-zoo': { title: 'The ω-automata zoo', blurb: 'All eight acceptance conditions × determinism: Büchi, co-Büchi, parity and weak, deterministic and not — and the languages that tell them apart.', curator: author, entries: pick(['dba', 'dba-classic', 'dcoba', 'dpa', 'dwa', 'buchi', 'buchi-classic', 'ncoba', 'npa', 'nwa']) },
    'beyond-regular': { title: 'Beyond regular', blurb: 'Stacks, queues, counters and tapes: what each kind of memory buys.', curator: author, entries: pick(['pda-classic', 'pda', 'npda', 'counter', 'queue', 'twopda', 'epda', 'lba', 'tm', 'mtm-palindrome']) },
    'transducers': { title: 'Machines that write', blurb: 'Moore and Mealy machines, finite-state and pushdown transducers, and a two-way transducer that copies its input.', curator: author, entries: pick(['moore', 'moore-classic', 'mealy', 'mealy-classic', 'fst', 'pdt', 'twodft']) }
  };
  for (const [id, c] of Object.entries(collections)) {
    if (await writeIfAbsent(join(root, `collections/${id}.json`), pretty(c), force)) written.push(`collections/${id}.json`);
  }
  return { root, written, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find(a => !a.startsWith('--'));
  if (!dir) { console.error('Usage: seed.mjs <library-dir> [--author login] [--force]'); process.exitCode = 1; return; }
  const ai = args.indexOf('--author');
  const { root, written, skipped } = await seedLibrary(dir, { author: ai >= 0 ? args[ai + 1] : undefined, force: args.includes('--force') });
  for (const s of skipped) console.log(`  skipped ${s.path} — the same machine as ${s.sameAs}`);
  console.log(`${written.length} files written into ${root}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
