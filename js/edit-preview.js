// ══════════════════════════════════════════════════════════════════
//  EDIT PREVIEWS
// ══════════════════════════════════════════════════════════════════
// The state and transition dialogs each end in a small drawing of what they
// will make: a state with its marks, or an edge with every rule on it. It is
// drawn by the canvas's own code, not a likeness of it — the node and edge
// classes css/canvas.css paints (`.sn`, `.bd`, `.acc-ring`, `.state-sub`,
// `.priority-badge`, `.tarr`, `.tlbl`, the pills), the shapes geometry.js
// computes (edgeGeometryFor, selfLoopPath, labelRestPoint), and the label
// writers render.js draws the diagram's labels with. So the theme, the label
// style, name wrapping, the bend a reverse edge forces and the loop's shape
// all follow the canvas, and a change to any of them reaches both at once.
//
// What it does not take from the canvas is the layout. The dialog shows the
// part of the machine being edited, laid out to fit: From on the left, To on
// the right, wherever they sit in the diagram. Nothing here touches
// App.domCache — the canvas's renderer owns that registry, and a preview is
// a throwaway drawing, rebuilt whole on every keystroke.

import { App, R } from './state.js';
import {
  edgeGeometryFor, estimatePillLabelSize, estimateTextLabelSize, labelRestPoint,
  selfLoopMetrics, selfLoopPath, UP
} from './geometry.js';
import {
  edgeLabelLines, edgeLabelMode, makeSVG, setStateLabelLines, splitStateLabel, startArrowD,
  writePillLabelRows, writeTextLabelRows
} from './render.js';

const PAD = 14;
const MIN_SPAN = 170;

const renderCfg = () => (App.config && App.config.render) || {};
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * A preview node: `{ id, name, x, y, start?, accept?, output?, priority? }`.
 * `output` is a Moore state's output (drawn under the name, `—` when empty);
 * `priority` a parity state's (drawn as the canvas's badge).
 */
function drawState(g, n, bounds) {
  const node = makeSVG('g');
  node.classList.add('sn');
  node.classList.toggle('start-st', !!n.start);
  node.classList.toggle('acc-st', !!n.accept);

  const circle = makeSVG('circle');
  circle.classList.add('bd');
  circle.setAttribute('cx', n.x);
  circle.setAttribute('cy', n.y);
  circle.setAttribute('r', R);
  node.appendChild(circle);

  if (n.accept) {
    const ring = makeSVG('circle');
    ring.classList.add('acc-ring');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', 'var(--gold)');
    ring.setAttribute('stroke-width', '1.5');
    ring.setAttribute('cx', n.x);
    ring.setAttribute('cy', n.y);
    ring.setAttribute('r', R - 5);
    node.appendChild(ring);
  }

  const hasSub = n.output !== undefined;
  const label = makeSVG('text');
  label.classList.add('slbl');
  label.setAttribute('x', n.x);
  label.setAttribute('y', hasSub ? n.y - num(renderCfg().textMargin, 8) : n.y);
  setStateLabelLines(label, splitStateLabel(n.name), n.x);
  node.appendChild(label);

  if (hasSub) {
    const sub = makeSVG('text');
    sub.classList.add('state-sub');
    sub.setAttribute('x', n.x);
    sub.setAttribute('y', n.y + num(renderCfg().mooreTextMargin, 9));
    sub.textContent = n.output !== '' ? n.output : '—';
    node.appendChild(sub);
  }

  if (n.priority !== undefined) {
    const bx = n.x + R * 0.88, by = n.y + R * 0.62;
    const badge = makeSVG('g');
    badge.classList.add('priority-badge');
    const bg = makeSVG('rect');
    bg.setAttribute('x', bx - 10);
    bg.setAttribute('y', by - 8);
    bg.setAttribute('width', 20);
    bg.setAttribute('height', 16);
    bg.setAttribute('rx', 8);
    const text = makeSVG('text');
    text.classList.add('priority-value');
    text.setAttribute('x', bx);
    text.setAttribute('y', by);
    text.textContent = String(n.priority);
    badge.append(bg, text);
    node.appendChild(badge);
    grow(bounds, bx + 10, by + 8);
  }

  const title = makeSVG('title');
  title.textContent = n.name;
  node.appendChild(title);
  g.appendChild(node);
  grow(bounds, n.x - R, n.y - R);
  grow(bounds, n.x + R, n.y + R);
}

function grow(b, x, y) {
  if (x < b.x0) b.x0 = x;
  if (y < b.y0) b.y0 = y;
  if (x > b.x1) b.x1 = x;
  if (y > b.y1) b.y1 = y;
}

// The lines the canvas would draw for this edge — merged and capped by the
// canvas's own rule — with the rule being edited kept in view rather than
// counted in `+k more`.
function labelLines(e, mode) {
  return edgeLabelLines(e.ts, { pills: mode.pills, beginner: mode.beginner, keep: e.focus ?? null });
}

function labelSize(lines, mode) {
  return mode.pills ? estimatePillLabelSize(lines.map(l => l.parts)) : estimateTextLabelSize(lines.map(l => l.text));
}

/**
 * An edge: `{ from, to, ts, focus?, context? }`. `ts` is every rule on it in
 * the canvas's order; `focus` is the id of the rule being edited, whose line is
 * marked so the reader can
 * find it in a stack; `context` dims an edge drawn only because it shapes the
 * one being edited (a reverse edge bends both).
 */
function drawEdge(edgesG, labelsG, e, byId, bent, bounds, mode) {
  const from = byId.get(e.from), to = byId.get(e.to);
  if (!from || !to || !e.ts.length) return;
  const lines = labelLines(e, mode);
  const size = labelSize(lines, mode);
  let geo;
  if (from === to) {
    const manual = e.ts.find(t => Number.isFinite(t.loopAngle));
    const angle = manual ? manual.loopAngle : UP;
    const loop = selfLoopMetrics(from);
    geo = { isSelf: true, from, angle, loop, labelSize: size, d: selfLoopPath(from.x, from.y, angle, loop) };
    grow(bounds, from.x + loop.extent * Math.cos(angle) - loop.ss, from.y + loop.extent * Math.sin(angle) - loop.ss);
    grow(bounds, from.x + loop.extent * Math.cos(angle) + loop.ss, from.y + loop.extent * Math.sin(angle) + loop.ss);
  } else {
    // A hand-set bend is kept, as the canvas keeps it; otherwise an edge with
    // a reverse twin takes the canvas's `curveOff`, and a lone edge is straight.
    const manual = e.ts.find(t => Number.isFinite(t.curve));
    const crvVal = manual ? manual.curve : bent ? num(renderCfg().curveOff, 45) : 0;
    const edge = edgeGeometryFor(from, to, crvVal, R, R, num(renderCfg().arrowHeadSize, 6));
    if (!edge) return;
    geo = { isSelf: false, from, to, crvVal, labelSize: size, ...edge };
    grow(bounds, edge.mx, edge.my);
  }

  const path = makeSVG('path');
  path.classList.add('tarr');
  path.setAttribute('d', geo.d);
  path.setAttribute('marker-end', 'url(#arr)');
  const group = makeSVG('g');
  group.classList.add('edge-g');
  if (e.context) group.classList.add('edit-preview-context');
  group.appendChild(path);
  edgesG.appendChild(group);

  const at = labelRestPoint(geo);
  grow(bounds, at.x - size.w / 2, at.y - size.h / 2);
  grow(bounds, at.x + size.w / 2, at.y + size.h / 2);
  let label;
  if (mode.pills) {
    label = makeSVG('g');
    label.classList.add('tlbl', 'edge-pill-label');
    label.classList.toggle('edge-pill-beginner', mode.beginner);
    writePillLabelRows(label, lines.map(l => l.parts));
    label.setAttribute('transform', `translate(${at.x} ${at.y})`);
  } else {
    label = makeSVG('text');
    label.classList.add('tlbl');
    label.setAttribute('dominant-baseline', 'central');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('x', at.x);
    label.setAttribute('y', at.y);
    writeTextLabelRows(label, lines, at.x);
  }
  if (e.context) label.classList.add('edit-preview-context');
  if (e.focus && lines.length > 1) {
    lines.forEach((l, i) => {
      if (l.ids.includes(e.focus)) label.querySelector(`[data-row="${i}"]`)?.classList.add('edit-preview-focus');
    });
  }
  labelsG.appendChild(label);
}

/**
 * Draw `nodes` and `edges` into `svg`, in the canvas's paint order — start
 * arrow, edges, labels, states — and size the drawing to what it holds at the
 * canvas's own scale, shrinking only when the dialog is narrower than that.
 */
export function drawEditPreview(svg, { nodes = [], edges = [] } = {}) {
  if (!svg) return;
  svg.innerHTML = '';
  const bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const byId = new Map(nodes.map(n => [n.id, n]));
  const mode = edgeLabelMode();
  const edgesG = makeSVG('g');
  const labelsG = makeSVG('g');
  const statesG = makeSVG('g');

  const start = nodes.find(n => n.start);
  if (start) {
    const a = makeSVG('path');
    a.setAttribute('stroke', 'var(--green)');
    a.setAttribute('stroke-width', '1.5');
    a.setAttribute('fill', 'none');
    a.setAttribute('marker-end', 'url(#arr)');
    a.setAttribute('d', startArrowD(start));
    svg.appendChild(a);
    grow(bounds, start.x - R - num(renderCfg().startArrowLen, 28), start.y);
  }

  const pairs = new Set(edges.map(e => `${e.from}|${e.to}`));
  for (const e of edges) {
    const bent = e.from !== e.to && pairs.has(`${e.to}|${e.from}`);
    drawEdge(edgesG, labelsG, e, byId, bent, bounds, mode);
  }
  for (const n of nodes) drawState(statesG, n, bounds);
  svg.append(edgesG, labelsG, statesG);

  if (!Number.isFinite(bounds.x0)) return;
  const x = bounds.x0 - PAD, y = bounds.y0 - PAD;
  const w = bounds.x1 - bounds.x0 + PAD * 2, h = bounds.y1 - bounds.y0 + PAD * 2;
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  // Drawn at the canvas's 100% — a label in the preview is the size it will be
  // on the diagram — and CSS max-width scales it down only when it has to.
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
}

/**
 * How far apart to stand two states so their edge's labels fit between them,
 * the way they would on a diagram laid out with room for them.
 */
export function previewSpan(edges) {
  const mode = edgeLabelMode();
  let widest = 0;
  for (const e of edges) if (e.from !== e.to && e.ts.length) widest = Math.max(widest, labelSize(labelLines(e, mode), mode).w);
  return Math.max(MIN_SPAN, widest + 2 * R + 40);
}
