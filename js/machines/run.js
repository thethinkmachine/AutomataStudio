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
// business knowing about App, the page, or which machine produced it.

/**
 * @param source a generator/iterator/iterable of steps, or a finished array.
 * @returns a cursor: { steps, streaming, done, known, pull, at, drain }
 */
export function makeRun(source) {
  let steps;
  let iter = null;
  let done = false;
  let result;

  if (Array.isArray(source)) {
    // Adopted by reference rather than copied: these arrays run to maxTmSteps
    // and the copy would be the cost this module exists to avoid.
    steps = source;
    done = true;
  } else {
    steps = [];
    if (source && typeof source.next === 'function') iter = source;
    else if (source && typeof source[Symbol.iterator] === 'function') iter = source[Symbol.iterator]();
    else done = true;
  }

  /** Materialize one more step. Returns it, or undefined at the end. */
  function pull() {
    if (done) return undefined;
    const r = iter.next();
    if (r.done) { done = true; result = r.value; return undefined; }
    steps.push(r.value);
    return r.value;
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
      while (!done && steps.length <= i) pull();
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
      while (!done && n < cap) { pull(); n++; }
      return done;
    }
  };
}

/** The run a player holds before anything has been run. */
export function emptyRun() {
  return makeRun([]);
}
