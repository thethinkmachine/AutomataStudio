// ══════════════════════════════════════════════════════════════════
//  MACHINES, DRAWN IN THE THEME'S INK
// ══════════════════════════════════════════════════════════════════
// The Library's pictures, drawn here in the app rather than fetched as images:
// a machine's diagram, the words of its language, and a Turing machine's run
// from a blank tape. Each is an SVG string whose parts carry classes, not
// colours — css/library.css inks them from the theme — so a picture reads as a
// figure on the page in every one of the app's themes, the way the canvas
// does, instead of as a dark screen pasted onto a light one.
//
// Everything a card needs travels in the index: a machine's compact sketch
// (`entry.sketch`, packed by packSketch), its minimal DFA (`entry.dfa`) and its
// standard code (`entry.standard`). So a page of cards costs no image requests
// and draws offline from the cached index.
//
// Import-free apart from graph-thumb.js, which is itself import-free: the
// minimap's arithmetic, so a sketch frames a machine the way the minimap does.

import { thumbBounds, thumbEdgePairs, thumbFit } from '../graph-thumb.js';

const r1 = v => Math.round(v * 10) / 10;

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ── A machine's shape ─────────────────────────────────────────────

/**
 * A target (or any { states, transitions, blocks, startId, accepts }) → its
 * top level: a state inside a block is its outermost block, the way the canvas
 * shows a closed block. `labelOf(t)` names a transition, or omit it.
 */
export function sketchFromTarget(target, labelOf = null) {
  const blockById = new Map((target.blocks || []).map(b => [b.id, b]));
  const topOf = s => {
    let b = s.blockId ? blockById.get(s.blockId) : null;
    const seen = new Set();
    while (b && b.parent && !seen.has(b.id)) { seen.add(b.id); b = blockById.get(b.parent) || null; }
    return b;
  };
  const accepts = new Set(target.accepts || []);
  const nodes = [];
  const rootOf = new Map();
  for (const s of target.states || []) {
    const b = topOf(s);
    rootOf.set(s.id, b ? b.id : s.id);
    if (!b) nodes.push({ id: s.id, x: s.x || 0, y: s.y || 0, name: String(s.name ?? s.id), start: s.id === target.startId, accept: accepts.has(s.id), block: false });
  }
  for (const b of (target.blocks || []).filter(b => !b.parent)) {
    nodes.push({ id: b.id, x: b.x || 0, y: b.y || 0, name: String(b.name || ''), start: false, accept: false, block: true });
  }
  const ids = new Set(nodes.map(n => n.id));
  const byKey = new Map();
  for (const t of target.transitions || []) {
    const from = rootOf.get(t.from) || t.from, to = rootOf.get(t.to) || t.to;
    if (!ids.has(from) || !ids.has(to)) continue;
    const key = `${from}|${to}`;
    let e = byKey.get(key);
    if (!e) { e = { key, from, to, labels: [], curve: null, loopAngle: null }; byKey.set(key, e); }
    if (e.curve === null && Number.isFinite(t.curve)) e.curve = t.curve;
    if (e.loopAngle === null && Number.isFinite(t.loopAngle)) e.loopAngle = t.loopAngle;
    const l = labelOf ? labelOf(t) : null;
    if (l !== null && l !== undefined && l !== '' && !e.labels.includes(l)) e.labels.push(l);
  }
  const edges = [...byKey.values()].map(e => ({ key: e.key, from: e.from, to: e.to, curve: e.curve, loopAngle: e.loopAngle, label: e.labels.join(', ') }));
  return { nodes, edges, rootOf };
}

/** The most a sketch carries in the index. Past it a card shows the build's picture. */
export const SKETCH_MAX = { nodes: 60, edges: 240 };

/** A sketch → the index's compact form: `{ n: [[x, y, flags]], e: [[i, j]] }`. Null when too large. */
export function packSketch(sk) {
  if (!sk || sk.nodes.length > SKETCH_MAX.nodes || sk.edges.length > SKETCH_MAX.edges || !sk.nodes.length) return null;
  const at = new Map(sk.nodes.map((n, i) => [n.id, i]));
  return {
    n: sk.nodes.map(n => [Math.round(n.x), Math.round(n.y), (n.start ? 1 : 0) | (n.accept ? 2 : 0) | (n.block ? 4 : 0)]),
    e: sk.edges.map(e => [at.get(e.from), at.get(e.to)])
  };
}

/** The index's compact form → a sketch, or null when it is not one. */
export function unpackSketch(raw) {
  if (!raw || !Array.isArray(raw.n) || !Array.isArray(raw.e) || !raw.n.length || raw.n.length > SKETCH_MAX.nodes || raw.e.length > SKETCH_MAX.edges) return null;
  const nodes = [];
  for (let i = 0; i < raw.n.length; i++) {
    const [x, y, f] = raw.n[i] || [];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    nodes.push({ id: `n${i}`, x, y, name: '', start: !!(f & 1), accept: !!(f & 2), block: !!(f & 4) });
  }
  const edges = [];
  for (const pair of raw.e) {
    const [i, j] = Array.isArray(pair) ? pair : [];
    if (!nodes[i] || !nodes[j]) continue;
    edges.push({ key: `n${i}|n${j}`, from: `n${i}`, to: `n${j}`, curve: null, loopAngle: null, label: '' });
  }
  return { nodes, edges };
}

// ── The diagram ───────────────────────────────────────────────────

/**
 * The proportions a figure of this machine should have, width over height:
 * its own, within bounds — so a row of three states is not a speck in a tall
 * well, and a tall machine is not squeezed into a letterbox.
 */
export function sketchAspect(sk, { min = 1.5, max = 2.8 } = {}) {
  const b = thumbBounds(sk?.nodes || [], 30, n => (n.block ? 60 : 30));
  if (!b) return 1.6;
  const a = (b.x1 - b.x0 + 140) / (b.y1 - b.y0 + 140);
  return Math.max(min, Math.min(max, a));
}

function arrowHead(x, y, dx, dy, len) {
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  const w = len * 0.42;
  const bx = x - ux * len, by = y - uy * len;
  return `M${r1(x)} ${r1(y)}L${r1(bx - uy * w)} ${r1(by + ux * w)}L${r1(bx + uy * w)} ${r1(by - ux * w)}Z`;
}

/**
 * A sketch as a diagram — the figure a textbook would print: edges stop at the
 * circles and end in arrowheads, a self-loop is a loop with its own head, the
 * start state has an arrow in, an accepting state a second ring.
 *
 *   w, h       the figure's size
 *   names      write state names inside the circles (when they are big enough)
 *   labels     write each edge's label
 *   live       every node a `data-s` group and every edge a `data-e` group,
 *              so a run can be painted on it (the Library's Try it)
 */
export function drawSketch(sk, { w = 320, h = 200, names = false, labels = false, live = false, label = 'The machine’s diagram' } = {}) {
  const nodes = sk?.nodes || [];
  const pad = labels ? 30 : 12;
  const fit = thumbFit(thumbBounds(nodes, 30, n => (n.block ? 60 : 30)), { x: pad + 10, y: pad, w: w - pad * 2 - 10, h: h - pad * 2 });
  // A figure with names is read, so its states are drawn to be read; a card's
  // are drawn to be recognised, and stay small beside the shape they make.
  const r = Math.max(3.2, Math.min(names ? 24 : 12, (names ? 30 : 24) * fit.scale));
  const byId = new Map(nodes.map(n => [n.id, { ...n, px: fit.px(n.x), py: fit.py(n.y) }]));
  const pairs = thumbEdgePairs(sk.edges.map(e => ({ from: e.from, to: e.to, curve: e.curve, loopAngle: e.loopAngle })));
  const head = Math.max(3.2, Math.min(7, r * 0.5));
  const stroke = r < 6 ? 'thin' : '';
  const out = [`<svg class="sk${stroke ? ' is-thin' : ''}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">`];
  const edgeParts = [], labelParts = [];

  for (const e of sk.edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    const ra = a.block ? r * 1.5 : r, rb = b.block ? r * 1.5 : r;
    let d, arrow, lx, ly;
    if (a === b) {
      const ang = Number.isFinite(e.loopAngle) ? e.loopAngle : -Math.PI / 2;
      const spread = 0.5, reach = ra * 2.6;
      const p = t => [a.px + Math.cos(ang + t) * ra, a.py + Math.sin(ang + t) * ra];
      const c = t => [a.px + Math.cos(ang + t) * (ra + reach), a.py + Math.sin(ang + t) * (ra + reach)];
      const [x1, y1] = p(-spread), [x2, y2] = p(spread), [c1x, c1y] = c(-spread * 1.5), [c2x, c2y] = c(spread * 1.5);
      d = `M${r1(x1)} ${r1(y1)}C${r1(c1x)} ${r1(c1y)} ${r1(c2x)} ${r1(c2y)} ${r1(x2)} ${r1(y2)}`;
      arrow = arrowHead(x2, y2, x2 - c2x, y2 - c2y, head);
      lx = a.px + Math.cos(ang) * (ra + reach * 0.82 + 7);
      ly = a.py + Math.sin(ang) * (ra + reach * 0.82 + 7);
    } else {
      const dx = b.px - a.px, dy = b.py - a.py, dist = Math.hypot(dx, dy) || 1;
      const pair = pairs.get(e.key);
      const bend = pair?.curve !== null && pair?.curve !== undefined ? pair.curve * fit.scale : pairs.has(`${e.to}|${e.from}`) ? Math.min(dist * 0.22, 26) : 0;
      const nx = -dy / dist, ny = dx / dist;
      const cx = (a.px + b.px) / 2 + nx * bend, cy = (a.py + b.py) / 2 + ny * bend;
      const toward = (fx, fy, tx, ty, by) => { const l = Math.hypot(tx - fx, ty - fy) || 1; return [fx + (tx - fx) / l * by, fy + (ty - fy) / l * by]; };
      const [sx, sy] = toward(a.px, a.py, cx, cy, ra);
      const [ex, ey] = toward(b.px, b.py, cx, cy, rb + 0.6);
      d = bend ? `M${r1(sx)} ${r1(sy)}Q${r1(cx)} ${r1(cy)} ${r1(ex)} ${r1(ey)}` : `M${r1(sx)} ${r1(sy)}L${r1(ex)} ${r1(ey)}`;
      arrow = arrowHead(ex, ey, ex - cx, ey - cy, head);
      // The label sits off the edge's middle, on the outside of its bend.
      const mx = bend ? 0.25 * sx + 0.5 * cx + 0.25 * ex : (sx + ex) / 2;
      const my = bend ? 0.25 * sy + 0.5 * cy + 0.25 * ey : (sy + ey) / 2;
      const side = bend >= 0 ? 1 : -1;
      lx = mx + nx * 9 * side;
      ly = my + ny * 9 * side;
    }
    const inner = `<path class="sk-e" d="${d}"/><path class="sk-ah" d="${arrow}"/>`;
    edgeParts.push(live ? `<g class="e" data-e="${esc(e.key)}">${inner}</g>` : inner);
    if (labels && e.label) labelParts.push(`<text class="sk-l" x="${r1(lx)}" y="${r1(ly + 3.5)}" text-anchor="middle">${esc(e.label.length > 14 ? `${e.label.slice(0, 13)}…` : e.label)}</text>`);
  }
  out.push(`<g class="sk-edges">${edgeParts.join('')}</g>`);

  const nodeParts = [];
  for (const n of byId.values()) {
    const x = r1(n.px), y = r1(n.py);
    const parts = [];
    if (n.block) {
      const bw = r1(r * 3.2), bh = r1(r * 2.1);
      parts.push(`<rect class="sk-n sk-b" x="${r1(n.px - bw / 2)}" y="${r1(n.py - bh / 2)}" width="${bw}" height="${bh}" rx="${r1(Math.min(6, r * 0.4))}"/>`);
      if (names && r >= 9 && n.name) parts.push(`<text class="sk-name" x="${x}" y="${r1(n.py + r * 0.24)}" text-anchor="middle">${esc(n.name.slice(0, 8))}</text>`);
    } else {
      parts.push(`<circle class="sk-n" cx="${x}" cy="${y}" r="${r1(r)}"/>`);
      if (n.accept) parts.push(`<circle class="sk-a" cx="${x}" cy="${y}" r="${r1(Math.max(r - Math.max(2.2, r * 0.2), r * 0.62))}"/>`);
      if (names && r >= 9 && n.name) parts.push(`<text class="sk-name" x="${x}" y="${r1(n.py + r * 0.26)}" text-anchor="middle" font-size="${r1(Math.max(8, r * (n.name.length > 3 ? 0.62 : 0.78)))}">${esc(n.name.slice(0, live ? 6 : 4))}</text>`);
    }
    if (n.start) {
      const x0 = n.px - r - Math.max(10, r * 1.1), x1 = n.px - r - 0.6;
      parts.push(`<path class="sk-s" d="M${r1(x0)} ${y}L${r1(x1)} ${y}"/><path class="sk-sh" d="${arrowHead(x1, n.py, 1, 0, head)}"/>`);
    }
    nodeParts.push(live ? `<g class="s" data-s="${esc(n.id)}">${parts.join('')}</g>` : parts.join(''));
  }
  out.push(`<g class="sk-nodes">${nodeParts.join('')}</g>`);
  if (labelParts.length) out.push(`<g class="sk-labels">${labelParts.join('')}</g>`);
  out.push('</svg>');
  return out.join('');
}

// ── The language ──────────────────────────────────────────────────

/**
 * Every word up to length L over the minimal DFA's Σ, decided by its table, one
 * row per length — `null` when the alphabet leaves room for too few lengths, or
 * the language lights too little of it to be worth a picture.
 */
export function languageRows(dfa) {
  if (!dfa || !Array.isArray(dfa.sigma) || !dfa.sigma.length) return null;
  const k = dfa.sigma.length;
  let L = 0, total = 1;
  while (L < (k === 1 ? 14 : 10) && k ** (L + 1) <= 256 && total + k ** (L + 1) <= 511) { L++; total += k ** L; }
  if (L < 3) return null;
  const acc = new Set(dfa.acc);
  const rows = [];
  // Breadth-first over words, carrying each one's state: the row for length
  // n+1 is the row for n, each word extended by every symbol in order.
  let frontier = [dfa.start];
  for (let len = 0; len <= L; len++) {
    rows.push(frontier.map(q => q >= 0 && acc.has(q)));
    if (len === L) break;
    const next = [];
    for (const q of frontier) for (let a = 0; a < k; a++) next.push(q >= 0 ? dfa.delta[q * k + a] : -1);
    frontier = next;
  }
  const lit = rows.flat().filter(Boolean).length;
  const lengthsLit = rows.filter(r => r.includes(true)).length;
  if (lit < 3 || lengthsLit < 2) return null;
  return rows;
}

/** The rows as a picture: one band per length, an inked cell per accepted word. */
export function drawLanguage(rows, { w = 320, h = 200 } = {}) {
  if (!rows) return null;
  const pad = 12, rh = (h - pad * 2) / rows.length, iw = w - pad * 2;
  const out = [`<svg class="sk sk-lang" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Every word up to length ${rows.length - 1}, inked where accepted">`];
  rows.forEach((row, len) => {
    const n = row.length, cw = iw / n, y = r1(pad + len * rh + 1), hh = r1(Math.max(rh - 2.4, 1));
    out.push(`<rect class="lg-r" x="${pad}" y="${y}" width="${r1(iw)}" height="${hh}"/>`);
    let x0 = 0;
    while (x0 < n) {
      if (!row[x0]) { x0++; continue; }
      let run = 1;
      while (x0 + run < n && row[x0 + run]) run++;
      const gap = cw > 3 ? 0.6 : 0;
      out.push(`<rect class="lg-a" x="${r1(pad + x0 * cw)}" y="${y}" width="${r1(Math.max(run * cw - gap, 0.8))}" height="${hh}"/>`);
      x0 += run;
    }
  });
  out.push('</svg>');
  return out.join('');
}

// ── A Turing machine's run ────────────────────────────────────────

/**
 * The first `max` configurations of a machine in the standard text format
 * (1RB1LB_1LA1RZ) run from a blank tape: `[{ head, cells: [[pos, sym], …] }]`.
 * Null for a code this cannot read. A missing move (`---`) or a jump to a state
 * the code does not list is a halt, as the notation means it.
 */
export function framesFromStandard(code, max = 90) {
  const groups = String(code || '').split('_').filter(Boolean);
  if (!groups.length || groups[0].length % 3) return null;
  const K = groups[0].length / 3;
  const table = [];
  for (const g of groups) {
    if (g.length !== K * 3) return null;
    const row = [];
    for (let s = 0; s < K; s++) {
      const t = g.slice(s * 3, s * 3 + 3);
      if (t === '---' || /^-+$/.test(t)) { row.push(null); continue; }
      const m = /^(\d)([LR])([A-Z])$/.exec(t);
      if (!m) return null;
      const next = m[3].charCodeAt(0) - 65;
      row.push({ write: Number(m[1]), move: m[2] === 'L' ? -1 : 1, next: next < groups.length ? next : -1 });
    }
    table.push(row);
  }
  const tape = new Map();
  let head = 0, state = 0;
  const frames = [];
  for (let t = 0; t < max; t++) {
    frames.push({ head, cells: [...tape.entries()] });
    const op = table[state]?.[tape.get(head) || 0];
    if (!op) break;
    if (op.write) tape.set(head, op.write); else tape.delete(head);
    head += op.move;
    if (op.next < 0) { frames.push({ head, cells: [...tape.entries()] }); break; }
    state = op.next;
  }
  return frames;
}

/** A run's frames as a space-time picture: time runs down, one row per step. */
export function drawRun(frames, { w = 320, h = 200 } = {}) {
  if (!frames?.length) return null;
  let lo = 0, hi = 0;
  for (const f of frames) { lo = Math.min(lo, f.head); hi = Math.max(hi, f.head); }
  const span = hi - lo + 1;
  const s = Math.max(2, Math.min(14, Math.floor((h - 16) / frames.length), Math.floor((w - 16) / (span + 4))));
  const cols = Math.floor((w - 16) / s), rows = Math.min(frames.length, Math.floor((h - 16) / s));
  const left = Math.round((lo + hi) / 2) - Math.floor(cols / 2);
  const top = Math.round((h - rows * s) / 2), ox = Math.round((w - cols * s) / 2);
  const out = [`<svg class="sk sk-run" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="The first steps from a blank tape, time running down">`];
  for (let y = 0; y < rows; y++) {
    const f = frames[y];
    const at = new Map(f.cells);
    let x = 0;
    while (x < cols) {
      const c = at.get(left + x) || 0;
      let n = 1;
      while (x + n < cols && (at.get(left + x + n) || 0) === c) n++;
      if (c) out.push(`<rect class="rn-${Math.min(c, 4)}" x="${ox + x * s}" y="${top + y * s}" width="${n * s}" height="${s}"/>`);
      x += n;
    }
    const hx = f.head - left;
    if (hx >= 0 && hx < cols && s >= 3) out.push(`<rect class="rn-h" x="${ox + hx * s + 0.5}" y="${top + y * s + 0.5}" width="${s - 1}" height="${s - 1}"/>`);
  }
  out.push('</svg>');
  return out.join('');
}
