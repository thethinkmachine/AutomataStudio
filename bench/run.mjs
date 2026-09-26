// ══════════════════════════════════════════════════════════════════
//  THE BENCHMARK
// ══════════════════════════════════════════════════════════════════
//   npm run bench                        every case, compared with bench/baseline.json
//   npm run bench -- npda player         only cases whose "suite/name" contains a word
//   npm run bench -- --quick             one round of fewer repetitions, for a first look
//   npm run bench -- --rounds 5          more rounds, for a steadier answer (default 3)
//   npm run bench -- --save              run, then make this run the baseline
//   npm run bench -- --out results.json  also write this run to a file
//   npm run bench -- --baseline other.json   compare against another run
//   npm run bench -- --list              the cases, without running them
//
// It measures the app's own code — js/machines/** and the renderer, loaded
// through tests/harness.js exactly as the tests load them — not a copy of it.
// Seven suites (bench/cases.mjs): deciding a word on every machine type, the
// searches, reading input, the player's cost per step, the player's memory per
// step, the JavaScript half of drawing the canvas, and the space-time diagram.
//
// **It is run by hand and never gates CI.** Timings move with the machine, the
// power plan and whatever else is running; a build that failed on them would
// fail at random. Correctness has the tests. This is for the question the tests
// cannot answer — did that change make it slower — so the comparison marks a
// case only when it moved by more than its own run-to-run spread, and a
// changed *check* (a verdict, a step count) is marked whatever the timing did.
//
// **Most of the noise is between processes, not within one.** Two runs of the
// same code in two processes differ by more than the repetitions inside one
// process do — each process makes its own compilation and heap decisions — so
// a spread measured inside one run under-reports it, and an unchanged tree
// was marked slower by 82% on one case. So each suite runs in `--rounds`
// separate processes, alternating the order, and a case keeps its fastest
// median; its spread is the larger of the within-run spread and how far the
// rounds disagreed.
//
// A baseline is only comparable on the machine that recorded it, which is why
// it carries that machine's description and the comparison says when it differs.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { suites } from './cases.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const valued = new Set(['--out', '--baseline', '--rounds']);
const filters = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
const mode = flag('--quick') ? 'quick' : 'full';
const rounds = Math.max(1, Number(option('--rounds')) || (mode === 'quick' ? 1 : 3));
const baselinePath = option('--baseline') || here + 'baseline.json';

const matches = (suite, name) => !filters.length || filters.some(f => `${suite}/${name}`.toLowerCase().includes(f.toLowerCase()));

if (flag('--list')) {
  for (const [suite, cases] of Object.entries(suites)) {
    for (const c of cases) if (matches(suite, c.name)) console.log(`${suite}/${c.name}`);
  }
  process.exit(0);
}

// ── run ─────────────────────────────────────────────────────────────

const git = (...a) => { try { return execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim(); } catch { return ''; } };
const meta = {
  date: new Date().toISOString(),
  commit: git('rev-parse', '--short', 'HEAD') + (git('status', '--porcelain', '--', 'js') ? '+dirty' : ''),
  node: process.version,
  cpu: os.cpus()[0]?.model?.trim() || 'unknown',
  cores: os.cpus().length,
  platform: `${os.platform()} ${os.arch()}`,
  memoryGB: Math.round(os.totalmem() / 2 ** 30),
  mode,
  rounds
};

function runSuite(suite, wanted) {
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [
      '--expose-gc', '--conditions=browser', '--conditions=development', '--max-old-space-size=8192',
      here + 'suite.mjs', suite, mode, ...filters
    ], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'inherit'] });
  } catch (e) {
    stdout = e.stdout || '';
    if (!stdout.includes('@@bench@@')) {
      return wanted.map(c => ({ suite, name: c.name, per: c.per, error: `the suite process failed: ${e.message.split('\n')[0]}` }));
    }
  }
  const line = stdout.split('\n').find(l => l.startsWith('@@bench@@'));
  return JSON.parse(line.slice('@@bench@@'.length));
}

// Every round's rows, by case, then one row per case: the fastest median, and
// a spread that includes the disagreement between rounds.
function merge(runs) {
  const ok = runs.filter(r => !r.error && !r.skipped);
  if (!ok.length) return runs[0];
  const best = ok.reduce((a, b) => (b.value < a.value ? b : a));
  const lo = Math.min(...ok.map(r => r.value)), hi = Math.max(...ok.map(r => r.value));
  const between = ok.length > 1 && lo > 0 ? (hi - lo) / lo : 0;
  const checks = new Set(ok.map(r => JSON.stringify(r.check ?? null)));
  return {
    ...best,
    spread: best.kind === 'memory' ? between : Math.max(best.spread || 0, between),
    rounds: ok.length,
    // A check that differs between rounds of the same code is a finding in itself.
    ...(checks.size > 1 ? { error: `the check differed between rounds: ${[...checks].join(' / ')}` } : {})
  };
}

const byCase = new Map();
const started = performance.now();
const order = Object.keys(suites).filter(suite => suites[suite].some(c => matches(suite, c.name)));
for (let round = 0; round < rounds; round++) {
  for (const suite of round % 2 ? [...order].reverse() : order) {
    const wanted = suites[suite].filter(c => matches(suite, c.name));
    process.stderr.write(`${rounds > 1 ? `round ${round + 1}/${rounds} · ` : ''}${suite} (${wanted.length}) `);
    for (const r of runSuite(suite, wanted)) {
      const key = `${r.suite}/${r.name}`;
      if (!byCase.has(key)) byCase.set(key, []);
      byCase.get(key).push(r);
    }
    process.stderr.write('\n');
  }
}
const results = [...byCase.values()].map(merge);

// ── report ──────────────────────────────────────────────────────────

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;
const before = new Map((baseline?.results || []).map(r => [`${r.suite}/${r.name}`, r]));

function fmtTime(ns) {
  if (ns < 1e3) return `${ns.toFixed(ns < 10 ? 2 : 1)} ns`;
  if (ns < 1e6) return `${(ns / 1e3).toFixed(ns < 1e4 ? 2 : 1)} µs`;
  if (ns < 1e9) return `${(ns / 1e6).toFixed(ns < 1e7 ? 2 : 1)} ms`;
  return `${(ns / 1e9).toFixed(2)} s`;
}
function fmtBytes(b) {
  if (Math.abs(b) < 1024) return `${b.toFixed(0)} B`;
  if (Math.abs(b) < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
}
const fmt = r => (r.kind === 'memory' ? fmtBytes(r.value) : fmtTime(r.value));
const fmtCheck = v => (v === null || v === undefined ? '' : typeof v === 'number' ? v.toLocaleString('en') : String(v));

function compare(r) {
  const b = before.get(`${r.suite}/${r.name}`);
  if (!b || r.value === undefined || b.value === undefined) return { text: b ? '' : 'new' };
  const notes = [];
  if (fmtCheck(b.check) !== fmtCheck(r.check)) notes.push(`CHECK CHANGED (was ${fmtCheck(b.check)})`);
  const delta = (r.value - b.value) / b.value;
  // A move counts only when it is bigger than the noise either run showed.
  const noise = Math.max(0.1, 1.5 * Math.max(r.spread || 0, b.spread || 0));
  const pct = `${delta >= 0 ? '+' : '−'}${Math.abs(delta * 100).toFixed(0)}%`;
  const mark = delta > noise ? '▲ slower' : delta < -noise ? '▼ faster' : '';
  return { text: [pct, mark, ...notes].filter(Boolean).join('  '), slower: delta > noise, changed: notes.length > 0, faster: delta < -noise };
}

const W = 50;
const tally = { slower: 0, faster: 0, changed: 0, errors: 0 };
console.log(`\ncommit ${meta.commit} · node ${meta.node} · ${meta.cpu} (${meta.cores} threads) · ${meta.platform} · ${mode}`);
if (baseline) {
  const m = baseline.meta || {};
  console.log(`baseline ${m.commit || '?'} from ${m.date?.slice(0, 10) || '?'}${m.cpu && m.cpu !== meta.cpu ? `  — recorded on ${m.cpu}, so timings are not comparable` : ''}`);
}
for (const suite of Object.keys(suites)) {
  const rows = results.filter(r => r.suite === suite);
  if (!rows.length) continue;
  console.log(`\n── ${suite} ${'─'.repeat(Math.max(0, W + 40 - suite.length))}`);
  for (const r of rows) {
    if (r.error) { tally.errors++; console.log(`  ${r.name.padEnd(W)}  ERROR  ${r.error}`); continue; }
    if (r.skipped) { console.log(`  ${r.name.padEnd(W)}  skipped (${r.skipped})`); continue; }
    const c = compare(r);
    if (c.slower) tally.slower++;
    if (c.faster) tally.faster++;
    if (c.changed) tally.changed++;
    const spread = r.spread !== undefined ? `±${(r.spread * 100).toFixed(0)}%` : '';
    console.log(`  ${r.name.padEnd(W)} ${(fmt(r) + ' /' + r.per).padStart(18)} ${spread.padStart(5)}  ${fmtCheck(r.check).padEnd(9)} ${c.text}`);
  }
}
const secs = ((performance.now() - started) / 1000).toFixed(0);
console.log(`\n${results.length} cases in ${secs}s` + (baseline ? ` · ${tally.slower} slower · ${tally.faster} faster · ${tally.changed} changed checks` : ' · no baseline to compare with') + (tally.errors ? ` · ${tally.errors} errors` : ''));

const record = { meta, results };
if (option('--out')) writeFileSync(option('--out'), JSON.stringify(record, null, 1) + '\n');
if (flag('--save')) {
  if (filters.length) console.log('not saved: a baseline has to cover every case, and this run was filtered');
  else { writeFileSync(baselinePath, JSON.stringify(record, null, 1) + '\n'); console.log(`saved as the baseline: ${baselinePath}`); }
}
process.exit(tally.errors ? 1 : 0);
