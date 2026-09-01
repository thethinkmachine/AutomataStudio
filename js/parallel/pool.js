// ══════════════════════════════════════════════════════════════════
//  THE WORKER POOL
// ══════════════════════════════════════════════════════════════════
// The app decides words one at a time on the thread that also draws the
// diagram. For a DFA that is invisible; for a batch of Turing machine runs at
// maxTmSteps, or the Language panel walking Σ*, it is a frozen tab on one
// core of however many the machine has.
//
// Every one of those workloads is the same shape — N independent runs over one
// unchanging machine — so this is a work queue over `hardwareConcurrency`
// workers, not a general actor system. What it has to get right is narrow:
//
//   • Order. Results are displayed against the words that produced them, so
//     every chunk carries the offset it started at and is written back into
//     place. Nothing depends on completion order.
//   • Sameness. A worker runs the identical function the serial path runs
//     (js/machines/batch.js), so the two cannot score a batch differently.
//   • Falling back. `Worker` does not exist under `node --test`, may be
//     refused by a CSP, and a worker can throw. Every one of those paths ends
//     in the serial computation rather than in an error: parallelism here is
//     an optimisation, never a capability, and nothing above it may need it.
//   • Not making small work slower. Spawning eight workers to decide twenty
//     DFA words costs more than deciding them. See shouldParallelize().
import { hasExpensiveRuns } from '../state.js';
import { snapshotMachine } from './snapshot.js';

// One worker per hardware thread. The main thread is blocked awaiting the
// result for the whole of a batch run, so leaving a core for it buys nothing;
// what the cap avoids is spawning 128 workers on a many-core server, where
// the startup cost would dwarf the work.
const MAX_WORKERS = 16;

// Below this many items the pool is skipped outright — worker startup and the
// structured clone of the graph cost more than the runs would. Tuned against
// the cheap end (a DFA), because that is the case where the overhead shows.
const MIN_ITEMS_FOR_POOL = 32;

// Machines whose per-word cost is high enough that even a short list is worth
// spreading. A TM at maxTmSteps is ~10,000 steps of work for one word.
//
// The judgement itself is hasExpensiveRuns() in js/state.js, which the player
// also reads to decide whether to stream a run rather than precompute it —
// the same fact about the machine, asked by two callers. It used to be a set
// of type names here, which a machine added to MachineTypes falls silently out
// of: no parallelism, no error, nothing to notice.
const MIN_ITEMS_EXPENSIVE = 4;

// Workers are kept warm between runs — a Language panel re-render or a second
// batch usually follows within seconds — and torn down after a quiet spell so
// an idle tab is not holding a copy of the module graph per core.
const IDLE_TEARDOWN_MS = 60_000;

let workers = [];        // { w, busy, epoch }
let epoch = 0;           // bumped per job; stamps snapshots so a worker cannot answer from a stale graph
let disabled = false;    // set once if workers turn out to be unavailable here
let teardownTimer = null;

/** How many workers this machine would use. 1 means "no point". */
export function poolSize() {
  const n = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 1;
  return Math.max(1, Math.min(MAX_WORKERS, n));
}

/** Whether a pool can be built here at all. */
export function parallelAvailable() {
  return !disabled && typeof Worker !== 'undefined' && poolSize() > 1;
}

/**
 * Is this job big enough to be worth spreading?
 *
 * Exported because it is a judgement rather than a fact, and the two callers
 * weigh it differently — a batch of 40 words and a Σ* enumeration of 40 words
 * are the same size and not the same amount of work.
 */
export function shouldParallelize(count, machine) {
  if (!parallelAvailable()) return false;
  const floor = hasExpensiveRuns(machine) ? MIN_ITEMS_EXPENSIVE : MIN_ITEMS_FOR_POOL;
  return count >= floor;
}

function spawn() {
  if (workers.length) return true;
  try {
    const n = poolSize();
    for (let i = 0; i < n; i++) {
      // This exact form is what Vite recognises to emit a worker bundle.
      const w = new Worker(new URL('./decide.worker.js', import.meta.url), { type: 'module' });
      w.onerror = () => { disabled = true; };
      workers.push({ w, busy: false, epoch: -1 });
    }
    return true;
  } catch {
    // A CSP, a stale browser, or a packaging problem. Say so once and stop
    // trying; every caller already has a serial path.
    disabled = true;
    for (const { w } of workers) { try { w.terminate(); } catch { /* already gone */ } }
    workers = [];
    return false;
  }
}

function scheduleTeardown() {
  clearTimeout(teardownTimer);
  teardownTimer = setTimeout(shutdownPool, IDLE_TEARDOWN_MS);
}

/**
 * Terminate every worker and forget that workers were ever refused here.
 *
 * `disabled` is module state that deliberately survives an ordinary teardown —
 * once a CSP has refused a worker it will refuse the next one too, and retrying
 * per batch would cost a throw each time. That makes it exactly the kind of
 * state that leaks between tests, so js/tests/harness.js calls this from
 * resetModuleState(): without it, one test exercising the all-workers-died path
 * would quietly send every later test down the serial branch, and they would
 * still pass while testing nothing.
 */
export function resetPool() {
  shutdownPool();
  disabled = false;
  epoch = 0;
}

/** Terminate every worker. Safe to call at any time; the pool respawns. */
export function shutdownPool() {
  clearTimeout(teardownTimer);
  for (const { w } of workers) { try { w.terminate(); } catch { /* already gone */ } }
  workers = [];
}

/**
 * Run `items` across the pool and return the results in input order.
 *
 * `kind` is 'batch' (items are raw batch lines) or 'words' (items are token
 * arrays, and results are bare verdict strings). `serial` is the fallback the
 * caller would otherwise have run, and is used for the whole job when there is
 * no pool and for any chunk a worker could not finish.
 */
export async function runParallel({ kind, items, machine, serial }) {
  if (!items.length) return [];
  if (!spawn()) return serial(items);

  const myEpoch = ++epoch;
  const snapshot = snapshotMachine();
  const out = new Array(items.length);

  // ~4 chunks per worker: enough that a worker landing a slow word (a TM that
  // runs to budget) is not still on it while the others sit idle, few enough
  // that the per-message cost stays noise.
  const size = Math.max(1, Math.ceil(items.length / (workers.length * 4)));
  const queue = [];
  for (let i = 0; i < items.length; i += size) queue.push(i);

  let nextChunk = 0;
  let outstanding = 0;
  const failed = [];

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };

    const pump = (slot) => {
      if (nextChunk >= queue.length) {
        if (outstanding === 0) finish();
        return;
      }
      const offset = queue[nextChunk++];
      slot.busy = true;
      slot.offset = offset;
      outstanding++;
      slot.w.postMessage({
        type: 'chunk', kind, machine, epoch: myEpoch,
        offset, items: items.slice(offset, offset + size)
      });
    };

    // A worker that dies stops being a way for this job to make progress. If
    // every one of them dies — a bad worker URL, a CSP that only bites on
    // load — nothing would ever call finish() and the caller would await a
    // promise that never settles. So liveness is counted, and the job ends
    // when there is no one left to answer; the unfinished chunks are left as
    // holes, which the serial fill-in below turns back into real verdicts.
    let live = workers.length;

    for (const slot of workers) {
      slot.w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') { pump(slot); return; }
        if (m.type === 'done') {
          for (let i = 0; i < m.rows.length; i++) out[m.offset + i] = m.rows[i];
        } else if (m.type === 'failed' || m.type === 'stale') {
          // Re-run this slice inline rather than reporting a hole.
          failed.push(m.offset);
        }
        outstanding--;
        slot.busy = false;
        pump(slot);
      };
      slot.w.onerror = () => {
        // Lost a worker. Anything it was holding is redone on the main thread.
        if (slot.busy) { failed.push(slot.offset); outstanding--; slot.busy = false; }
        disabled = true;
        live--;
        if (live === 0 || (outstanding === 0 && nextChunk >= queue.length)) finish();
      };
      // Hand each worker the machine once; it answers 'ready' and the pump starts.
      slot.epoch = myEpoch;
      slot.w.postMessage({ type: 'load', snapshot, epoch: myEpoch });
    }
  });

  // Anything a worker could not do, done here. Usually empty.
  for (const offset of failed) {
    const slice = items.slice(offset, offset + size);
    const rows = serial(slice);
    for (let i = 0; i < rows.length; i++) out[offset + i] = rows[i];
  }
  // A hole means a message was lost, which should not happen — but a wrong
  // verdict is worse than a slow one, so fill any gap serially rather than
  // shipping `undefined` into a results table.
  for (let i = 0; i < out.length; i++) {
    if (out[i] === undefined) out[i] = serial([items[i]])[0];
  }

  scheduleTeardown();
  return out;
}
