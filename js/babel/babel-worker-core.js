// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY OF BABEL — WHAT THE WORKER DOES
// ══════════════════════════════════════════════════════════════════
// Split from babel.worker.js so it can be called directly: by the client when
// there is no Worker (the test DOM, a CSP that refuses one), and by tests.
//
//   { type: 'classify', key, params, volumes: [string] }  → { classes: [key] }
//   { type: 'behaviour', key, params, volume, budget }     → { verdict }
//   { type: 'tile', key, params, level, tx, ty, samples }  → { cells, spp }
//
// A tile is the deep map's (deep-map.js): one block's children, read in
// number order, `samples` machines a cell; `cells` holds class indices.
//
// Volumes travel as strings: a BigInt survives a structured clone, but a
// string survives every hop, the test stub included. Imports the engine and
// the machine layer only, both DOM-free.

import { wingByKey } from './wings.js';
import { classifyVolume, tmBehaviour } from './census.js';
import { volumeAt } from './volumes.js';
import { deepLayout, mapClassifier, readTile } from './deep-map.js';

// The fields of a halting verdict worth sending: primitives only.
const VERDICT_FIELDS = ['verdict', 'method', 'steps', 'ones', 'cells', 'period', 'from', 'shift', 'direction', 'longest', 'how', 'size', 'depth'];

export function plainVerdict(v) {
  if (!v) return null;
  const out = {};
  for (const k of VERDICT_FIELDS) if (v[k] !== undefined && v[k] !== null && typeof v[k] !== 'object') out[k] = v[k];
  return out;
}

// One classifier per room: a DFA's allocates its arrays once.
const classifiers = new Map();
function classifierFor(wing, params) {
  const id = `${wing.key}:${params.join('-')}`;
  let c = classifiers.get(id);
  if (!c) {
    if (classifiers.size > 16) classifiers.clear();
    classifiers.set(id, c = mapClassifier(wing, params));
  }
  return c;
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
    if (msg.type === 'tile') {
      const layout = deepLayout(wing, msg.params);
      if (!layout || !(msg.level >= 0 && msg.level < layout.D)) return { id: msg.id, type: 'failed', error: 'no such tile' };
      const t = readTile(layout, msg.level, BigInt(msg.tx), BigInt(msg.ty), classifierFor(wing, msg.params), msg.samples);
      return { id: msg.id, type: 'tile', cells: t.cells, spp: t.spp };
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
