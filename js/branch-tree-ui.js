// ══════════════════════════════════════════════════════════════════
//  THE COMPUTATION TREE SECTION — every branch, beside the one traced
// ══════════════════════════════════════════════════════════════════
//  A right-panel section (`rp-branches`), shown on the machines whose runs
//  carry a tree (`machineBranches`). The tree is Sipser's picture of a
//  nondeterministic computation drawn top-down: the root is the start
//  configuration, a row is a depth, a fork is a node with several children,
//  and each leaf says how its branch ended — accepted, stuck, merged into a
//  configuration another branch already had, or never explored because the
//  search stopped first.
//
//  Colour is the same as on the canvas (js/branch-tokens.js) and means the
//  same thing: a branch's slice of the hue range, inherited from its parent.
//  So the token on a state and the node in this tree are one branch, and can
//  be matched by eye.
//
//  It follows the player the way the space-time diagram does: the playhead's
//  depth is a band across the tree, the branches below it are dimmed until
//  the run gets there, and clicking a node scrubs to it.
//
//  Listeners are attached at creation, so nothing here is in bridge.js.
// ══════════════════════════════════════════════════════════════════

import { $, App, getState } from './state.js';
import { getTransition, transLabel } from './states-transitions.js';
import { makeSVG, setSectionCount } from './render.js';
import { setSectionStatus } from './section-status.js';
import { syncPanelEmpty } from './panel-float.js';
import { machineBranches } from './machines/index.js';
import { branchTreeOf } from './machines/branch-tree.js';
import { Change, subscribe } from './store.js';
import { scrubSim } from './simulation.js';

export const BRANCHES_SECTION = 'rp-branches';

// Geometry, in CSS pixels. A row is a depth; a sub-row is an ε-move that
// stays at its parent's position (an NFA's), drawn a little lower so it does
// not lie flat along the row.
const ROW = 36;
const SUB = 15;
const PAD = 16;
const NODE_R = 5.5;
/** Past this many leaves the state names go into tooltips only. */
const LABEL_LEAVES = 48;

/**
 * While playing, how often a tree that is still growing (an NDTM's search) is
 * redrawn. The rebuild is a whole SVG — up to TREE_NODE_CAP nodes, their edges
 * and labels — and the search grows the tree on nearly every step, so at a
 * rebuild per frame the card would cost more than the rest of the paint. The
 * playhead band and the focus keep moving between rebuilds; paused, the card
 * catches up at once.
 */
const REBUILD_EVERY_MS = 250;

let els = null;
let built = null;      // { tree, version, rows, nodeEls, band, L }
let builtAt = 0;
let catchUp = 0;
let shownDepth = -1;
let shownFocus = -1;
let statusKey = null;
let raf = 0;

/** Show the section on the machines that record a tree, hide it elsewhere. */
export function syncBranchTreeSection() {
  const el = $(BRANCHES_SECTION);
  if (!el || !el.style) return;
  const want = machineBranches() ? '' : 'none';
  if (el.style.display === want) return;
  el.style.display = want;
  syncPanelEmpty('rpanel');
  if (want === '') refreshBranchTree();
}

subscribe(Change.GRAPH, syncBranchTreeSection);

function sectionShowing() {
  const el = $(BRANCHES_SECTION);
  if (!el || !els) return false;
  if (el.style && el.style.display === 'none') return false;
  return !(el.classList && el.classList.contains('collapsed'));
}

function ensureBuilt() {
  if (els) return els;
  const body = $('bt-body');
  if (!body) return null;
  body.innerHTML = '';
  const view = document.createElement('div');
  view.className = 'bt-view';
  const svg = makeSVG('svg');
  svg.classList.add('bt-svg');
  svg.setAttribute('role', 'img');
  view.appendChild(svg);
  const empty = document.createElement('div');
  empty.className = 'bt-empty';
  const foot = document.createElement('div');
  foot.className = 'bt-foot';
  const summary = document.createElement('div');
  summary.className = 'bt-summary';
  const legend = document.createElement('div');
  legend.className = 'bt-legend';
  legend.innerHTML = [
    ['acc', 'accepted'], ['dead', 'stuck'], ['merged', 'merged'], ['open', 'unexplored']
  ].map(([k, say]) => `<span class="bt-key"><svg viewBox="-8 -8 16 16" width="12" height="12">${keyGlyph(k)}</svg>${say}</span>`).join('');
  foot.append(summary, legend);
  body.append(empty, view, foot);
  els = { body, view, svg, empty, summary, legend };

  svg.addEventListener('click', onClick);
  if (typeof ResizeObserver === 'function') {
    // Opening a collapsed section, or popping it into a window, is a resize.
    new ResizeObserver(() => requestPaint()).observe(view);
  }
  return els;
}

function keyGlyph(kind) {
  const h = 'style="--h:222"';
  if (kind === 'acc') return `<circle class="bt-node is-acc" r="4.5" ${h}/>`;
  if (kind === 'dead') return `<circle class="bt-node is-dead" r="4.5" ${h}/><path class="bt-x" d="M-3 -3L3 3M3 -3L-3 3"/>`;
  if (kind === 'merged') return `<circle class="bt-node is-merged" r="4" ${h}/>`;
  return `<circle class="bt-node is-open" r="4" ${h}/>`;
}

/**
 * The player moved or the run changed. Coalesced to a frame, like the
 * space-time diagram — and nothing at all on a machine that does not branch,
 * where the section is hidden: this is called on every paint of every run.
 */
export function refreshBranchTree() {
  const sec = $(BRANCHES_SECTION);
  if (!sec || (sec.style && sec.style.display === 'none')) return;
  if (!els && !$('bt-body')) return;
  ensureBuilt();
  requestPaint();
}

function requestPaint() {
  if (!els || raf) return;
  if (typeof requestAnimationFrame !== 'function') { paint(); return; }
  raf = requestAnimationFrame(() => { raf = 0; paint(); });
}

function paint() {
  const tree = branchTreeOf(App.simSteps);
  syncStatus(tree);
  if (!sectionShowing()) return;
  if (!tree) {
    if (built) { els.svg.innerHTML = ''; built = null; }
    els.empty.textContent = App.simSteps && App.simSteps.length
      ? 'This run has no branches to show.'
      : 'Run a word to see every branch the machine tries, not only the one it follows.';
    els.empty.hidden = false;
    els.view.hidden = true;
    els.summary.textContent = '';
    return;
  }
  els.empty.hidden = true;
  els.view.hidden = false;
  if (!built || built.tree !== tree || built.version !== tree.version) {
    const now = typeof performance === 'object' ? performance.now() : Date.now();
    const growing = built && built.tree === tree;
    const wait = REBUILD_EVERY_MS - (now - builtAt);
    if (!growing || !App.autoTimer || wait <= 0) {
      build(tree);
      builtAt = now;
    } else if (!catchUp) {
      // Held back: come back for it, so the last growth of a run that has just
      // stopped playing is drawn rather than left behind.
      catchUp = setTimeout(() => { catchUp = 0; requestPaint(); }, wait);
    }
  }
  const frame = tree.frameAt(App.simSteps, App.simIdx) || { depth: 0, focus: -1 };
  follow(tree, frame);
}

// ── the header, folded or not ────────────────────────────────────
function syncStatus(tree) {
  // Called every frame; written only when there is something new to say.
  const key = tree ? `${tree.nodes.length}|${tree.done}|${tree.acceptedAt}|${tree.version}` : '';
  if (statusKey === key) return;
  statusKey = key;
  const count = $('rp-count-branches');
  if (!tree) {
    setSectionCount(count, 0);
    setSectionStatus(BRANCHES_SECTION, '');
    return;
  }
  const leaves = tree.leafCount();
  setSectionCount(count, leaves);
  const found = tree.acceptedAt >= 0;
  const say = `${leaves} branch${leaves === 1 ? '' : 'es'}${found ? ' · accepted' : tree.done ? '' : ' · searching'}`;
  setSectionStatus(BRANCHES_SECTION, say, found ? 'acc' : '');
}

// ── layout ───────────────────────────────────────────────────────
// Leaves are laid out left to right in the order the search produced them,
// and a parent sits over the middle of its children — the textbook tree, with
// nothing clever about it, because the order is the search's and that is a
// thing worth being able to read off the picture.
function layout(tree, dx) {
  const n = tree.nodes.length;
  const x = new Float64Array(n), sub = new Uint16Array(n);
  let maxSub = 0, leaf = 0, maxDepth = 0;
  // Depth-first without recursion: a thousand-deep NDTM branch is a
  // thousand-deep call stack otherwise.
  const order = [];
  const stack = [0];
  while (stack.length) {
    const id = stack.pop();
    order.push(id);
    const node = tree.nodes[id];
    if (node.parent >= 0 && tree.nodes[node.parent].depth === node.depth) {
      sub[id] = sub[node.parent] + 1;
      if (sub[id] > maxSub) maxSub = sub[id];
    }
    if (node.depth > maxDepth) maxDepth = node.depth;
    for (let k = node.kids.length - 1; k >= 0; k--) stack.push(node.kids[k]);
  }
  for (const id of order) if (!tree.nodes[id].kids.length) x[id] = PAD + (leaf++) * dx;
  for (let i = order.length - 1; i >= 0; i--) {
    const node = tree.nodes[order[i]];
    if (node.kids.length) x[node.id] = (x[node.kids[0]] + x[node.kids[node.kids.length - 1]]) / 2;
  }
  const rowH = ROW + Math.min(maxSub, 3) * SUB;
  const y = id => PAD + tree.nodes[id].depth * rowH + Math.min(sub[id], 3) * SUB;
  return { x, y, rowH, leaves: leaf, maxDepth };
}

function nameOf(id) {
  return getState(id)?.name ?? String(id);
}

function build(tree) {
  const svg = els.svg;
  svg.innerHTML = '';
  const names = tree.nodes.length ? tree.nodes.map(n => nameOf(n.state)) : [];
  const leaves = tree.leafCount();
  const labelled = leaves <= LABEL_LEAVES;
  const longest = labelled ? names.reduce((m, s) => Math.max(m, Math.min(s.length, 8)), 1) : 0;
  const dx = labelled ? Math.max(24, Math.min(64, 16 + longest * 6)) : 16;
  const L = layout(tree, dx);
  const width = PAD * 2 + Math.max(0, L.leaves - 1) * dx + (labelled ? longest * 6 + 6 : 0);
  const height = PAD * 2 + L.maxDepth * L.rowH + 3 * SUB;
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const band = makeSVG('rect');
  band.classList.add('bt-now');
  band.setAttribute('rx', 6);
  band.setAttribute('x', 0);
  band.setAttribute('width', width);
  band.setAttribute('height', L.rowH - 8);
  svg.appendChild(band);

  const onPath = new Set(tree.path || []);
  const edges = makeSVG('g'), nodes = makeSVG('g'), labels = makeSVG('g');
  edges.classList.add('bt-edges');
  labels.classList.add('bt-labels');
  const nodeEls = new Array(tree.nodes.length);
  const rows = [];

  for (const node of tree.nodes) {
    const cx = L.x[node.id], cy = L.y(node.id);
    const hue = tree.hue(node.id).toFixed(1);
    (rows[node.depth] || (rows[node.depth] = [])).push(node.id);
    const parts = [];
    if (node.parent >= 0) {
      const px = L.x[node.parent], py = L.y(node.parent);
      const e = makeSVG('path');
      const my = (py + cy) / 2;
      e.setAttribute('d', `M${px} ${py}C${px} ${my} ${cx} ${my} ${cx} ${cy}`);
      e.classList.add('bt-edge');
      if (onPath.has(node.id)) e.classList.add('on-path');
      e.setAttribute('style', `--h:${hue}`);
      edges.appendChild(e);
      parts.push(e);
    }
    const g = makeSVG('g');
    g.classList.add('bt-n');
    g.setAttribute('transform', `translate(${cx},${cy})`);
    g.setAttribute('data-node', node.id);
    const c = makeSVG('circle');
    c.classList.add('bt-node');
    const fate = tree.fateOf(node.id);
    if (fate) c.classList.add(`is-${fate}`);
    if (onPath.has(node.id)) c.classList.add('on-path');
    c.setAttribute('r', fate === 'merged' || fate === 'open' ? NODE_R - 1 : NODE_R);
    c.setAttribute('style', `--h:${hue}`);
    g.appendChild(c);
    if (fate === 'dead') {
      const x = makeSVG('path');
      x.classList.add('bt-x');
      x.setAttribute('d', 'M-3.5 -3.5L3.5 3.5M3.5 -3.5L-3.5 3.5');
      g.appendChild(x);
    }
    const title = makeSVG('title');
    title.textContent = describe(tree, node, fate);
    g.appendChild(title);
    nodes.appendChild(g);
    parts.push(g);
    if (labelled) {
      const t = makeSVG('text');
      t.classList.add('bt-label');
      t.setAttribute('x', cx + NODE_R + 3);
      t.setAttribute('y', cy + 3.5);
      const nm = names[node.id];
      t.textContent = nm.length > 8 ? nm.slice(0, 7) + '…' : nm;
      labels.appendChild(t);
      parts.push(t);
    }
    nodeEls[node.id] = { g, c, parts, cx, cy };
  }
  svg.append(edges, nodes, labels);
  svg.setAttribute('aria-label', `Computation tree: ${tree.nodes.length} configurations, ${leaves} branches`);

  built = { tree, version: tree.version, rows, nodeEls, band, L };
  shownDepth = -1;
  shownFocus = -1;

  const bits = [
    `${leaves} branch${leaves === 1 ? '' : 'es'}`,
    `${tree.nodes.length} configuration${tree.nodes.length === 1 ? '' : 's'}`,
    `depth ${L.maxDepth}`
  ];
  if (!tree.done) bits.push('still searching');
  if (tree.truncated) bits.push(`only the first ${tree.nodes.length} recorded`);
  els.summary.textContent = bits.join(' · ');
}

function describe(tree, node, fate) {
  const bits = [nameOf(node.state), `depth ${node.depth}`];
  if (node.tid != null) {
    const t = getTransition(node.tid);
    if (t) bits.push(`by ${nameOf(t.from)} → ${nameOf(t.to)} on ${transLabel(t)}`);
  }
  const say = { acc: 'accepts', dead: 'stuck — no move applies', merged: 'merged — another branch already reached this configuration', open: tree.done ? 'unexplored — the search stopped first' : 'not explored yet' }[fate];
  if (say) bits.push(say);
  return bits.join(' · ');
}

// ── following the player ─────────────────────────────────────────
// Per step only what changed is written: the rows between the old depth and
// the new one change sides of the playhead, and the focus moves. A rebuild is
// only for a tree that grew.
function follow(tree, frame) {
  const B = built;
  const depth = frame.depth;
  const moved = depth !== shownDepth || frame.focus !== shownFocus;
  if (depth !== shownDepth) {
    const lo = shownDepth < 0 ? 0 : Math.min(shownDepth, depth);
    const hi = shownDepth < 0 ? B.rows.length - 1 : Math.max(shownDepth, depth);
    for (let d = lo; d <= hi; d++) {
      for (const id of B.rows[d] || []) {
        const el = B.nodeEls[id];
        if (!el) continue;
        const future = d > depth;
        for (const p of el.parts) p.classList.toggle('is-future', future);
        el.g.classList.toggle('is-now', d === depth);
      }
    }
    const first = B.rows[depth] && B.rows[depth][0];
    const top = first != null ? B.L.y(first) : PAD + depth * B.L.rowH;
    B.band.setAttribute('y', top - (B.L.rowH - 8) / 2 + (B.L.rowH - ROW) / 2);
    shownDepth = depth;
  }
  if (frame.focus !== shownFocus) {
    if (shownFocus >= 0 && B.nodeEls[shownFocus]) B.nodeEls[shownFocus].g.classList.remove('is-focus');
    if (frame.focus >= 0 && B.nodeEls[frame.focus]) B.nodeEls[frame.focus].g.classList.add('is-focus');
    shownFocus = frame.focus;
  }
  if (moved) keepInView(frame);
}

// The playhead's row stays on screen, and so does the branch it is on. Only
// when the playhead moves: a reader who has scrolled off to look at another
// part of the tree while paused is left where they are.
function keepInView(frame) {
  const v = els.view;
  const B = built;
  const target = frame.focus >= 0 ? B.nodeEls[frame.focus] || null : null;
  const row = B.rows[frame.depth];
  const y = target ? target.cy : row && row.length ? B.L.y(row[0]) : 0;
  const vh = v.clientHeight || 0, vw = v.clientWidth || 0;
  if (vh && (y < v.scrollTop + 24 || y > v.scrollTop + vh - 24)) v.scrollTop = Math.max(0, y - vh * 0.4);
  if (target && vw && (target.cx < v.scrollLeft + 16 || target.cx > v.scrollLeft + vw - 16)) v.scrollLeft = Math.max(0, target.cx - vw / 2);
}

function onClick(e) {
  const g = e.target && e.target.closest ? e.target.closest('.bt-n') : null;
  if (!g) return;
  const tree = branchTreeOf(App.simSteps);
  const id = Number(g.getAttribute('data-node'));
  const idx = stepForNode(tree, id);
  if (idx == null) return;
  scrubSim(idx);
}

/**
 * The step that shows node `id`. On a path it is the node's depth — every
 * branch alive at a depth is on the canvas at the step of that depth — and in
 * an NDTM's search it is the step that expanded the node, if the search has
 * got that far.
 */
export function stepForNode(tree, id) {
  const node = tree && tree.node(id);
  if (!node) return null;
  if (tree.mode === 'search') return node.step >= 0 ? node.step : null;
  if (tree.mode === 'path' && tree.path) {
    const at = tree.path.indexOf(id);
    if (at >= 0) return at;
    return Math.min(node.depth, tree.path.length - 1);
  }
  return Math.min(node.depth, App.simSteps.length - 1);
}

/** Forget the elements this built into — the harness replaces them between tests. */
export function resetBranchTree() {
  if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
  raf = 0;
  if (catchUp) { clearTimeout(catchUp); catchUp = 0; }
  els = null;
  built = null;
  builtAt = 0;
  statusKey = null;
  shownDepth = -1;
  shownFocus = -1;
}

// Test seam.
export const _branchTreeTests = {
  get built() { return built; },
  get els() { return els; },
  paint, layout
};
