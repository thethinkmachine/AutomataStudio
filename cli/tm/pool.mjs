// A small worker pool: jobs out, results back in order. Falls back to running
// in this thread when there is one job, one core, or --workers 1.
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

export function workerCount(requested, jobs) {
  if (requested !== undefined && requested !== null) return Math.max(1, Math.min(Number(requested) || 1, jobs));
  if (jobs < 3) return 1;
  return Math.max(1, Math.min(availableParallelism() - 1, jobs, 16));
}

/**
 * Run `jobs` (messages) through `n` workers. `local(job)` is the same work in
 * this thread, used when n is 1. `onDone(i, result)` fires as each finishes.
 * Resolves with the results in job order.
 */
export async function runPool(jobs, n, local, onDone = () => {}) {
  const results = new Array(jobs.length);
  if (n <= 1) {
    jobs.forEach((job, i) => { results[i] = local(job); onDone(i, results[i]); });
    return results;
  }
  let nextJob = 0, finished = 0;
  const url = new URL('./worker.mjs', import.meta.url);
  return new Promise((resolve, reject) => {
    const workers = [];
    const feed = w => {
      if (nextJob >= jobs.length) { w.terminate(); return; }
      const i = nextJob++;
      w.postMessage({ ...jobs[i], id: i });
    };
    for (let k = 0; k < n; k++) {
      const w = new Worker(url);
      workers.push(w);
      w.on('message', msg => {
        if (msg.ready) { feed(w); return; }
        if (msg.error) results[msg.id] = { error: msg.error };
        else results[msg.id] = msg.result;
        onDone(msg.id, results[msg.id]);
        if (++finished === jobs.length) { workers.forEach(x => x.terminate()); resolve(results); return; }
        feed(w);
      });
      w.on('error', reject);
    }
  });
}
