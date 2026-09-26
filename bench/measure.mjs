// How a case is measured. Two kinds, because the engine is judged on both:
//
//   time    the median of repeated runs, after one warm-up run the JIT is
//           given to settle on. The median rather than the minimum, since
//           the question is what a reader will see, and the spread (the
//           interquartile range over the median) is reported beside it so a
//           comparison can tell a real change from this machine's noise.
//   memory  the heap a result keeps alive, per step, between two forced
//           collections. It needs `node --expose-gc`, which `npm run bench`
//           passes; without it the memory cases are skipped, not guessed.

export const hasGC = typeof globalThis.gc === 'function';

const MODES = {
  full: { minMs: 400, minReps: 5, maxReps: 25 },
  quick: { minMs: 60, minReps: 2, maxReps: 5 }
};

/**
 * Time `fn`. Returns the median and the spread in milliseconds, how many
 * runs made them, and what the last run returned — the case's check value.
 */
export function timeIt(fn, mode = 'full') {
  const { minMs, minReps, maxReps } = MODES[mode] || MODES.full;
  let check = fn();
  // One collection before timing starts, so the runs are not charged for the
  // garbage the case's setup left. Deliberately not one before every run:
  // after a full collection V8 shrinks its young generation, and the next run
  // pays to grow it back — which made allocating cases up to 1.7× slower than
  // any real run is, trading a truthful number for a steady one.
  if (hasGC) globalThis.gc();
  const times = [];
  const started = performance.now();
  while (times.length < minReps || (times.length < maxReps && performance.now() - started < minMs)) {
    const t0 = performance.now();
    check = fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const q = p => times[Math.min(times.length - 1, Math.floor(p * (times.length - 1) + 0.5))];
  const median = q(0.5);
  return { ms: median, spread: median > 0 ? (q(0.75) - q(0.25)) / median : 0, reps: times.length, check };
}

function heapNow() {
  globalThis.gc();
  globalThis.gc();
  const m = process.memoryUsage();
  return m.heapUsed + m.arrayBuffers;
}

/**
 * The bytes `make()`'s result keeps alive. The result is held until after
 * the second reading, so it cannot be collected before it is counted.
 */
export function retainedBytes(make) {
  const before = heapNow();
  const kept = make();
  const after = heapNow();
  return { bytes: after - before, kept };
}

/** A seeded generator, so every run builds the same machines and words. */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export const pickWith = r => xs => xs[Math.floor(r() * xs.length)];
