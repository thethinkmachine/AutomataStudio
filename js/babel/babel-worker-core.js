// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY OF BABEL — WHAT THE WORKER DOES
// ══════════════════════════════════════════════════════════════════
// Split from babel.worker.js so it can be called directly: by the client when
// there is no Worker (the test DOM, a CSP that refuses one), and by tests.
//
//   { type: 'classify', key, params, volumes: [string] }  → { classes: [key] }
//   { type: 'behaviour', key, params, volume, budget }     → { verdict }
//
// Volumes travel as strings: a BigInt survives a structured clone, but a
// string survives every hop, the test stub included. Imports the engine and
// the machine layer only, both DOM-free.

import { wingByKey } from './wings.js';
import { classifyVolume, tmBehaviour } from './census.js';
import { volumeAt } from './volumes.js';

// The fields of a halting verdict worth sending: primitives only.
const VERDICT_FIELDS = ['verdict', 'method', 'steps', 'ones', 'cells', 'period', 'from', 'shift', 'direction', 'longest', 'how', 'size', 'depth'];

export function plainVerdict(v) {
  if (!v) return null;
  const out = {};
  for (const k of VERDICT_FIELDS) if (v[k] !== undefined && v[k] !== null && typeof v[k] !== 'object') out[k] = v[k];
  return out;
}

export function handleBabelMessage(msg) {
  try {
    const wing = wingByKey(msg.key);
    if (!wing) return { id: msg.id, type: 'failed', error: `no wing “${msg.key}”` };
    if (msg.type === 'classify') {
      const classes = msg.volumes.map(v => {
        try { return classifyVolume(wing, msg.params, BigInt(v)); } catch { return 'x'; }
      });
      return { id: msg.id, type: 'classes', classes };
    }
    if (msg.type === 'behaviour') {
      const { body } = volumeAt(wing, msg.params, BigInt(msg.volume));
      const v = tmBehaviour(wing, msg.params, body, { budget: msg.budget });
      return { id: msg.id, type: 'behaviour', verdict: plainVerdict(v) };
    }
    return { id: msg.id, type: 'ignored' };
  } catch (e) {
    return { id: msg.id, type: 'failed', error: String(e?.message || e) };
  }
}
