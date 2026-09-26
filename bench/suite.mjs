// One suite, in a process of its own — started by bench/run.mjs, not by hand.
//
//   node --expose-gc --conditions=browser --conditions=development bench/suite.mjs <suite> <mode> <filter…>
//
// A process per suite keeps each suite's JIT history and heap out of the next
// one's numbers. The app logs as it loads and runs; that is silenced, and the
// results go out as one JSON line after a marker the parent looks for.

import { hasGC, retainedBytes, timeIt } from './measure.mjs';

const [suiteName, mode, ...filters] = process.argv.slice(2);
const out = process.stdout.write.bind(process.stdout);
for (const k of ['log', 'info', 'warn', 'debug']) console[k] = () => {};

const { createHarness } = await import('../tests/harness.js');
const { suites } = await import('./cases.mjs');
const h = createHarness();
const env = { h, c: h.context };

const matches = name => !filters.length || filters.some(f => `${suiteName}/${name}`.toLowerCase().includes(f.toLowerCase()));
const results = [];

for (const kase of suites[suiteName] || []) {
  if (!matches(kase.name)) continue;
  const row = { suite: suiteName, name: kase.name, per: kase.per, kind: kase.kind || 'time' };
  try {
    if (row.kind === 'memory') {
      if (!hasGC) { row.skipped = 'needs node --expose-gc'; results.push(row); continue; }
      const { make, count } = kase.setup(env);
      make();   // warm-up, so the first run's compiled code is not counted as retained
      const { bytes, kept } = retainedBytes(make);
      row.value = bytes / count;
      row.check = kept?.steps?.length ?? null;
    } else {
      const { run, count } = kase.setup(env);
      const t = timeIt(run, mode);
      row.value = (t.ms * 1e6) / count;   // nanoseconds per unit
      row.spread = t.spread;
      row.reps = t.reps;
      row.check = t.check;
    }
  } catch (e) {
    row.error = String(e?.message || e);
  }
  results.push(row);
  process.stderr.write('.');
}

out('\n@@bench@@' + JSON.stringify(results) + '\n');
