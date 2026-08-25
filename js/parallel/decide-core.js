// ══════════════════════════════════════════════════════════════════
//  WHAT THE WORKER DOES, AS A FUNCTION
// ══════════════════════════════════════════════════════════════════
// Split out of decide.worker.js so it can be called directly. A worker entry
// point is unreachable from `node --test` — `self` and `postMessage` do not
// exist there — which would leave the one piece of this feature that decides
// anything as the one piece with no test over it.
//
// So the worker file is now three lines of plumbing around this, and
// tests/parallel.test.js drives the same protocol through a fake Worker to
// assert the thing that actually matters: a batch scored across the pool is
// identical, row for row, to the same batch scored serially.
import { decideBatchRows } from '../machines/batch.js';
import { decideWord } from '../machines/index.js';
import { hydrateMachine } from './snapshot.js';

/**
 * One message in, one message out. `state` is the worker's own scratch
 * ({ loaded }), held by the caller so this function stays pure-ish and a test
 * can run several independent "workers" over one module registry.
 */
export function handleMessage(msg, state) {
  if (msg.type === 'load') {
    hydrateMachine(msg.snapshot);
    state.loaded = msg.epoch;
    return { type: 'ready', epoch: msg.epoch };
  }

  if (msg.type === 'chunk') {
    // A chunk for a machine this worker was never given — or was given and has
    // since had replaced — is refused rather than answered from a stale graph.
    // The pool re-runs a refused chunk on the main thread.
    if (msg.epoch !== state.loaded) return { type: 'stale', id: msg.id, offset: msg.offset };
    try {
      const rows = msg.kind === 'words'
        // The Language panel's path: tokens in, bare verdict out.
        ? msg.items.map(tokens => {
          try { return decideWord(msg.machine, tokens)?.verdict ?? 'unk'; }
          catch { return 'unk'; }
        })
        // The batch tester's path: the identical function the serial path runs.
        : decideBatchRows(msg.items);
      return { type: 'done', offset: msg.offset, rows };
    } catch (err) {
      // A throwing simulator must not take the pool down with it.
      return { type: 'failed', offset: msg.offset, error: String((err && err.message) || err) };
    }
  }

  return { type: 'ignored' };
}
