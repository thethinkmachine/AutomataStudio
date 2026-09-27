// ══════════════════════════════════════════════════════════════════
//  A RUN — one simulation's steps, materialized on demand
// ══════════════════════════════════════════════════════════════════
// The app used to precompute a whole run and then visualize it: every
// simulator ran to completion, wrote `App.simSteps`, and the player scrubbed
// the finished array. That is fine for a DFA, whose run is |w|+1 steps, and it
// is what freezes the tab on a Turing machine, whose run is `maxTmSteps` steps
// each carrying a tape snapshot — ten thousand of them built before the first
// frame is drawn.
//
// So a run is now a *cursor* over a step source rather than an array of steps,
// and the array is what it has materialized so far. Two producers feed it and
// the player cannot tell them apart:
//
//   * a **generator**, for the simulators that build one step per iteration
//     (the tape machines, the finite automata, the two transducers that walk
//     the input once). These stream: step n is computed when something asks
//     for it, so playback is what drives the computation.
//   * an **array**, for the simulators that cannot stream even in principle —
//     every search-based one. `simNPDA`, `sim2NFA`, `simFST` and the ω-automata
//     explore the configuration space first and only then linearize the winning
//     path, so no prefix of their trace is knowable until the search has
//     finished. Wrapping the finished array here is not a workaround; it is the
//     honest shape of that computation.
//
// `steps` is the same array object for the life of a run, which is what lets
// every existing reader — the trace log's tail, `trailUpTo`, the minimap,
// StateMate's trace tool — go on treating `App.simSteps` as a plain array. It
// simply grows now instead of arriving complete.
//
// Import-free on purpose. A run is a cursor over an iterator; it has no
// business knowing about App, the page, or which machine produced it — which
// is why the one thing it needs from a machine, how to rebuild a step, is
// handed in (`opts.columnsOf`) rather than imported.
//
// **A producer may answer with many steps at once.** The cursor says how many
// it wants — `iter.next(n)`, which a generator reads as the value of its
// `yield` — and a producer that can compute a stretch of steps faster than it
// can hand them over one by one (js/machines/fast-tm.js, which records into
// columns directly) yields `batch(count, last, at)`: `count` steps now exist,
// the newest is `last`, and `at(i)` builds any of the others. It never yields
// more than it was asked for, so a caller that pulls in slices — the drain,
// which scans each slice for a block boundary — sees exactly the granularity
// it asked for. A consumer that calls `next()` with no count, `playEagerly` and
// a plain `for…of`, gets one step per iteration as before.
//
// A batch is told apart by its class. A Symbol-keyed field was the first
// version, and asking every step object for a key it does not have — step
// objects come in a dozen shapes — cost Moore's one-step pulls a fifth of
// their time.
class Batch {
  constructor(count, last, at) { this.count = count; this.last = last; this.at = at; }
}

/** Several steps at once, for a producer the cursor asked for `count` or more. */
export const batch = (count, last, at) => new Batch(count, last, at);

/**
 * @param source a generator/iterator/iterable of steps, or a finished array.
 * @param opts   { columnsOf(step) -> step columns | null } — see columnarSteps.
 * @returns a cursor: { steps, streaming, done, known, pull, at, drain }
 */
export function makeRun(source, opts = {}) {
  let steps;
  let append;
  let appendMany = (count, last, at) => {
    const from = steps.length;
    for (let i = from; i < from + count - 1; i++) append(at(i));
    append(last);
  };
  let iter = null;
  let done = false;
  let result;

  if (Array.isArray(source)) {
    // Adopted by reference rather than copied: these arrays run to maxTmSteps
    // and the copy would be the cost this module exists to avoid.
    steps = source;
    done = true;
  } else {
    if (source && typeof source.next === 'function') iter = source;
    else if (source && typeof source[Symbol.iterator] === 'function') iter = source[Symbol.iterator]();
    else done = true;
    if (iter && opts.columnsOf) ({ steps, push: append, pushMany: appendMany } = columnarSteps(opts.columnsOf));
    else { steps = []; append = s => steps.push(s); }
  }

  // The newest step `take` added — read back from here rather than from
  // `steps`, which for a columnar run is a Proxy: two traps a pull, and on
  // playback's one-step pulls that was a third of the time.
  let newest;

  /** Ask for up to `want` more steps. Returns how many arrived: 0 at the end. */
  function take(want) {
    if (done) return 0;
    const r = iter.next(want);
    // A finished generator still holds its frame — the live tape it was
    // driving, which on a machine that walks off down its tape is as long as
    // the run — so the cursor lets go of it once there is nothing left to pull.
    if (r.done) { done = true; result = r.value; iter = null; newest = undefined; return 0; }
    const v = r.value;
    if (!(v instanceof Batch)) { append(v); newest = v; return 1; }
    appendMany(v.count, v.last, v.at);
    newest = v.last;
    return v.count;
  }

  /** Materialize one more step. Returns it, or undefined at the end. */
  function pull() {
    take(1);
    return newest;
  }

  return {
    steps,

    /** True when the source can actually be pulled from — see the note above
     *  about the search-based simulators, for which this is false and the run
     *  arrives complete however the reader has set the execution mode. */
    streaming: iter !== null,

    /** True once the source is exhausted, i.e. `steps` is the whole run. */
    get done() { return done; },

    /** Whatever the generator returned when it finished — run statistics for
     *  the simulators that answer with them. Undefined until `done`. */
    get result() { return result; },

    /** How many steps exist *so far*. Not the length of the run unless done. */
    get known() { return steps.length; },

    pull,

    /** Materialize up to index i. Returns steps[i], or undefined past the end. */
    at(i) {
      while (!done && steps.length <= i) take(i + 1 - steps.length);
      return steps[i];
    },

    /**
     * Pull up to `cap` more steps. Returns true if the run finished.
     *
     * The cap is what keeps "go to the end" from being an unbounded loop on
     * the main thread: the caller drains in slices and yields between them,
     * so a ten-thousand-step machine stays interruptible while it runs.
     */
    drain(cap = Infinity) {
      let n = 0;
      while (!done && n < cap) n += take(cap - n);
      return done;
    }
  };
}

// ── a run kept as columns ─────────────────────────────────────────
// A long run's cost was never the machine: it was an object per step, kept
// for as long as the run is on screen. Measured on the five-state busy beaver,
// 250 bytes a step, 10.6 GiB to its halt. A deterministic tape machine's step
// is a handful of small numbers the tape log already records as columns (see
// js/tape-log.js), so the run keeps the columns and lets the objects go.
//
// `steps` is still an array to everyone who reads it — `Array.isArray` holds,
// `steps[i]`, `length`, `slice`, `for…of` all work — because it is a Proxy
// over one, and a step is built when it is read. That is deliberate: the
// steps array has sixty-odd readers (the player, the trace log, the trail, the
// minimap, StateMate, the complexity profile, the space-time diagram) and
// every one of them would otherwise have to learn a second way to ask for
// step i, with a missed one failing silently as `undefined`. A trap costs
// tens of nanoseconds, and a reader asks for a step per frame, not per cell;
// the whole-run readers (the space-time diagram, cells visited) read the tape
// journal and never come through here.
//
// Three things keep it exact:
//   * **the newest step is held whole.** Its producer may still mark it — a
//     run that hits its budget is stamped `timeout` after the step was handed
//     over — so it is the object the producer holds, not a rebuild.
//   * **a step with anything of its own is held whole.** `columns.plain(step)`
//     is true only for a step carrying its address and nothing else; `final`,
//     `loopFrom`, a note appended to — any of those and the object is kept.
//   * **a step read twice in a row is the same object**, from a small cache,
//     and the object handed out while it was newest is the one cached.

const CACHE = 64;

function isIndex(k) {
  if (typeof k !== 'string' || k.length === 0) return false;
  const c = k.charCodeAt(0);
  return c >= 48 && c <= 57;
}

function columnarSteps(columnsOf) {
  let cols;                  // decided by the first step; null: none can be rebuilt
  let n = 0;
  let tail;                  // steps[n - 1], always the producer's own object
  const kept = new Map();    // steps the columns cannot rebuild, held whole
  const cacheAt = new Float64Array(CACHE).fill(-1);
  const cacheStep = new Array(CACHE);

  const remember = (i, s) => { const slot = i & (CACHE - 1); cacheAt[slot] = i; cacheStep[slot] = s; };

  function at(i) {
    if (!(i >= 0 && i < n) || !Number.isInteger(i)) return undefined;
    if (i === n - 1) return tail;
    const slot = i & (CACHE - 1);
    if (cacheAt[slot] === i) return cacheStep[slot];
    const s = (kept.size && kept.get(i)) || cols.at(i);
    remember(i, s);
    return s;
  }

  function push(step) {
    if (n === 0) cols = columnsOf(step);
    else {
      const i = n - 1;
      if (!cols || !cols.plain(tail, i)) kept.set(i, tail);
      remember(i, tail);
    }
    tail = step;
    n++;
  }

  // `count` steps, the newest `last`. The ones between were recorded straight
  // into the columns and never handed over as objects, so each is plain — a
  // rebuild is exactly it — and nothing needs holding but the old tail.
  function pushMany(count, last, at) {
    if (count === 1) { push(last); return; }
    const first = n;
    push(at(first));
    if (!cols) {
      // Not rebuildable after all: hold every one of them whole.
      for (let i = first + 1; i < first + count - 1; i++) push(at(i));
      push(last);
      return;
    }
    // Steps first..first+count-2 are plain; only the tail is special.
    n = first + count;
    tail = last;
  }

  function put(i, v) {
    if (i === n) { push(v); return true; }
    if (!(i >= 0 && i < n) || !Number.isInteger(i)) return false;
    if (i === n - 1) tail = v; else kept.set(i, v);
    remember(i, v);
    return true;
  }

  const target = [];
  const steps = new Proxy(target, {
    get(t, k, r) {
      if (isIndex(k)) return at(+k);
      if (k === 'length') return n;
      return Reflect.get(t, k, r);
    },
    set(t, k, v, r) {
      if (isIndex(k)) return put(+k, v);
      // Truncating would mean truncating the columns; nothing does it, and a
      // silent no-op would be worse than the TypeError a false gives.
      if (k === 'length') return v === n;
      return Reflect.set(t, k, v, r);
    },
    has(t, k) {
      if (isIndex(k)) { const i = +k; return i >= 0 && i < n && Number.isInteger(i); }
      return Reflect.has(t, k);
    },
    getOwnPropertyDescriptor(t, k) {
      if (isIndex(k)) {
        const s = at(+k);
        return s === undefined ? undefined : { value: s, writable: true, enumerable: true, configurable: true };
      }
      if (k === 'length') return { value: n, writable: true, enumerable: false, configurable: false };
      return Reflect.getOwnPropertyDescriptor(t, k);
    },
    defineProperty(t, k, d) {
      if (isIndex(k) && 'value' in d) return put(+k, d.value);
      return Reflect.defineProperty(t, k, d);
    },
    deleteProperty(t, k) {
      return isIndex(k) ? false : Reflect.deleteProperty(t, k);
    },
    ownKeys(t) {
      const keys = [];
      for (let i = 0; i < n; i++) keys.push(String(i));
      return keys.concat(Reflect.ownKeys(t));
    }
  });
  return { steps, push, pushMany };
}

