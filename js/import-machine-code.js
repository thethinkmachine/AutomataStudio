// ══════════════════════════════════════════════════════════════════
//  PLACING A MACHINE CODE
// ══════════════════════════════════════════════════════════════════
// js/interop/smtf.js reads a code into the loadData shape and stops there: a
// code carries no positions, deliberately, since two drawings of one machine
// are one machine. This is the half that draws it, split off the way
// import-jflap.js and import-statechart.js split reading from placing.
//
// A flat machine gets the layout Arrange would give it. A machine built from
// blocks is laid out one level at a time, because that is how it is looked at:
// the top level is its own states and one node per block, and each block's
// interior is laid out on its own, beside its box, for when the reader drills
// in. A layout computed for circles leaves the boxes touching, so after the
// load the same spreading pass the JFLAP importer runs makes room for them.

import { App } from './state.js';
import { circularLayout, sugiyamaLayout } from './canvas.js';
import { resolveNodeOverlaps } from './geometry.js';
import { spreadForBlocks } from './import-jflap.js';
import { SMTFError, machineCodeText, readMachineCode } from './interop/smtf.js';
import { Change, emit } from './store.js';
import { viewStates } from './view-graph.js';

export { SMTFError, machineCodeText };

/** A code → the loadData fields, laid out. Throws SMTFError. */
export function readMachineCodeText(text) {
  const src = machineCodeText(text) || String(text ?? '').trim();
  const data = readMachineCode(src, { sym: App.config.sym });
  layoutByLevel(data);
  return data;
}

function layout(nodes, edges, start) {
  if (App.config.layout.algorithm === 'circular') circularLayout(nodes);
  else sugiyamaLayout(nodes, edges, start);
}

// One layout per level, top-down, so a block's interior can be placed beside
// the box its parent's layout has just put it at — which is where inlineBlock
// puts a placed block's states too.
function layoutByLevel(data) {
  const blocks = data.blocks || [];
  if (!blocks.length) { layout(data.states, data.transitions, data.startId); return; }
  const byId = new Map(blocks.map(b => [b.id, b]));
  const containerOf = new Map(data.states.map(s => [s.id, s.blockId || null]));
  // The node that stands for `stateId` at the level of `scope`: the state
  // itself, or the child block it is somewhere inside — null if neither.
  const nodeAt = (stateId, scope) => {
    let c = containerOf.get(stateId);
    if (c === undefined) return null;
    if (c === scope) return stateId;
    while (c && byId.get(c)?.parent !== scope) c = byId.get(c)?.parent || null;
    return c ? '#' + c : null;
  };
  const place = (scope, ox, oy) => {
    const b = scope ? byId.get(scope) : null;
    const states = data.states.filter(s => containerOf.get(s.id) === scope);
    const boxes = blocks.filter(c => (c.parent || null) === scope).map(c => ({ id: '#' + c.id, block: c, x: 0, y: 0 }));
    const nodes = [...states, ...boxes];
    if (!nodes.length) return;
    const edges = [];
    for (const t of data.transitions) {
      const from = nodeAt(t.from, scope), to = nodeAt(t.to, scope);
      if (from && to) edges.push({ from, to });
    }
    layout(nodes, edges, nodeAt(b ? b.entry : data.startId, scope));
    for (const n of nodes) { n.x += ox; n.y += oy; }
    for (const box of boxes) {
      box.block.x = box.x;
      box.block.y = box.y;
      place(box.block.id, box.x, box.y);
    }
  };
  place(null, 0, 0);
}

/**
 * After loadData: make room for the boxes. Nothing to do on a flat machine.
 * loadData has already emitted, so the move is announced, or the render that
 * drew the boxes would be the one from before the spread.
 */
export function settleMachineCodeBlocks() {
  if (!(App.blocks || []).length) return;
  spreadForBlocks();
  resolveNodeOverlaps(viewStates());
  emit(Change.GRAPH);
}
