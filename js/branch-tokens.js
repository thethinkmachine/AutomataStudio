// ══════════════════════════════════════════════════════════════════
//  BRANCH TOKENS — a nondeterministic run, marked on the canvas
// ══════════════════════════════════════════════════════════════════
// A coloured Petri net marks each place with the tokens it holds, and a
// token's colour is the data it carries. Here a place is a state, a token is
// a branch of the run, and its colour is its place in the computation tree
// (js/machines/branch-tree.js) — so two tokens of nearly the same colour are
// two branches that forked a moment ago, and a token alone in its hue is one
// that has been on its own since early in the run.
//
// Per step the canvas shows every branch alive at the playhead's depth, not
// only the one the trace follows. Stepping forward, each token travels the
// edge its branch took: a fork is one token leaving and two arriving in
// neighbouring hues, a branch with no move fades where it stood, and one that
// reached a configuration another branch already had flies in and dissolves
// into it.
//
// Every token lives in #sim-anim-g, above the states, like the deterministic
// token they replace. A state's resting tokens are one group translated to its
// centre, and the state keeps a handle on it (`grp.__brToks`) so a state
// dragged while a run is paused carries its tokens along — updateFastDOM moves
// the group with the state.
//
// Not *inside* the state's group, which is where they started: that subtree is
// the most heavily styled on the canvas, and adding and removing children in it
// on every step cost ~0.8ms of style and layout per step in Chromium, eight
// times the token code itself. In the animation layer the same writes are
// nearly free.
// ══════════════════════════════════════════════════════════════════

import { makeSVG } from './render.js';
import { $, App, R } from './state.js';
import { viewGraph, visibleNodeIdFor } from './view-graph.js';
import { branchTreeOf } from './machines/branch-tree.js';

/** The most tokens sent flying, or fading, in one step; the rest simply appear or go. */
const MAX_FLIGHTS = 32;

/**
 * The most tokens drawn on one state. Past it the ring is closed and a count
 * says how many more there are — the tree card has every one of them, and a
 * state wearing four hundred dots is a paint cost, not a picture.
 */
const MAX_PER_NODE = 24;

// What the last paint put down: the per-node token groups, and where each
// branch's token stood, so the next step's flights know where to leave from.
let groups = new Map();      // drawn node id → <g class="br-toks">
let lastSlots = new Map();   // tree node id → { x, y }
let lastTree = null;
// What the resting tokens were drawn for, so a step that changes nothing but
// the branch under the playhead — most of an NDTM's search, which expands a
// level's configurations one step at a time — moves one outline instead of
// rebuilding every token (see "A paint is a diff" in the simulation notes).
let lastKey = '';
let lastFocus = -1;
let lastDots = new Map();
let flights = [];
const fades = new Set();

/** Whether this run has branches to draw. */
export function runHasBranches(steps = App.simSteps) {
  return !!branchTreeOf(steps);
}

/** Take everything down: resting tokens, flights and fades. */
export function clearBranchTokens() {
  for (const [nodeId, g] of groups) { g.remove(); forget(nodeId, g); }
  groups = new Map();
  stopFlights();
  fades.clear();
  for (const dot of pool) dot.remove();
  const layer = $('sim-anim-g');
  if (layer) for (const dot of [...layer.children]) if (dot.classList && dot.classList.contains('br-tok')) dot.remove();
  pool = [];
  lastSlots = new Map();
  lastTree = null;
  lastKey = '';
  lastFocus = -1;
  lastDots = new Map();
}

// The state group keeps a handle for the drag path; a stale one would have
// updateFastDOM moving a group that is no longer on screen.
function forget(nodeId, g) {
  const grp = App.domCache.states.get(nodeId);
  if (grp && grp.__brToks === g) grp.__brToks = null;
}

function stopFlights() {
  for (const f of flights) { cancelAnimationFrame(f.raf); releaseDot(f.el); }
  flights = [];
}

// ── the dots in motion ──────────────────────────────────────────
// A flying or fading token lasts one step, and a step can send a few dozen.
// They are drawn from a pool and hidden when done rather than created and
// removed, for the reason the resting tokens are: adding or removing a node in
// the canvas SVG is the one write here that costs a layout pass.
let pool = [];

function takeDot(layer, tree, id, tr) {
  let dot = pool.pop();
  while (dot && dot.parentNode !== layer) dot = pool.pop();
  if (!dot) { dot = makeSVG('circle'); layer.appendChild(dot); }
  dot.__use = (dot.__use || 0) + 1;
  dot.__spare = false;
  dot.onanimationend = null;
  dot.setAttribute('class', tree.fateOf(id) === 'acc' ? 'br-tok is-acc' : 'br-tok');
  dot.setAttribute('r', tr);
  setHue(dot, tree.hue(id));
  return dot;
}

/** Back to the pool. `use` guards a late second release of the same loan. */
function releaseDot(dot, use = dot.__use) {
  if (dot.__spare || dot.__use !== use) return;
  dot.__spare = true;
  dot.onanimationend = null;
  dot.setAttribute('class', 'br-tok is-spare');
  pool.push(dot);
}

function tokenRadius() {
  return Math.max(4, 4.5 / (App.cam?.z || 1));
}

// ── where a token sits ──────────────────────────────────────────
// On the rim of a state, fanned out from the top, a token's width apart; a
// crowd wider than the circle closes the ring. On a block's box, along its top
// edge. Offsets are from the node's centre.
function centreOf(grp) {
  const p = grp.__parts || {};
  if ((grp.__kind === 'block' || grp.__kind === 'port') && p.body) {
    const x = +p.body.getAttribute('x'), y = +p.body.getAttribute('y');
    const w = +p.body.getAttribute('width'), h = +p.body.getAttribute('height');
    return { x: x + w / 2, y: y + h / 2, box: { w, h } };
  }
  const c = p.circle || (grp.querySelector && grp.querySelector('circle.bd'));
  if (!c) return null;
  return { x: +c.getAttribute('cx'), y: +c.getAttribute('cy'), box: null };
}

export function slotOffsets(k, tr, box = null) {
  if (box) {
    const gap = tr * 2.6;
    const span = Math.min(box.w - tr * 2, gap * (k - 1));
    const step = k > 1 ? span / (k - 1) : 0;
    return Array.from({ length: k }, (_, j) => ({ x: -span / 2 + j * step, y: -box.h / 2 }));
  }
  const min = (tr * 2.5) / R;
  const s = k * min > Math.PI * 2 ? (Math.PI * 2) / k : min;
  return Array.from({ length: k }, (_, j) => {
    const a = -Math.PI / 2 + (j - (k - 1) / 2) * s;
    return { x: Math.cos(a) * R, y: Math.sin(a) * R };
  });
}

function setHue(el, hue) {
  if (el.style && typeof el.style.setProperty === 'function') el.style.setProperty('--h', hue.toFixed(1));
  else el.setAttribute('style', `--h:${hue.toFixed(1)}`);
}

/**
 * Put the branches alive at step `idx` on the canvas.
 *
 * `opts.advancedOne` is a single forward step, the only move that animates;
 * `opts.flightMs` is how long a flight takes, or 0 for none; `opts.defer`
 * queues the part that measures paths until the frame's writes are done.
 * Returns false when the run has no tree, so the caller keeps its own token.
 */
export function paintBranchTokens(steps, idx, opts = {}) {
  const tree = branchTreeOf(steps);
  if (!tree) { if (groups.size || lastSlots.size) clearBranchTokens(); return false; }
  const frame = tree.frameAt(steps, idx);
  if (!frame) return true;
  const fresh = tree !== lastTree;
  const animate = !fresh && opts.advancedOne && opts.flightMs > 0;
  const tr = tokenRadius();
  const live = tree.liveAt(frame.depth);

  // The same branches on the same states as last paint: only the outline moves.
  // Even on a forward step — at one depth there is nowhere for a token to go.
  const key = `${frame.depth}|${live.length}|${tr.toFixed(2)}|${App.scope ? App.scope.join('/') : ''}`;
  if (!fresh && key === lastKey) {
    moveFocus(tree, frame.focus, tr);
    return true;
  }

  // Flights from the last step go — a fast enough step can overtake them. The
  // resting tokens are diffed below rather than torn down.
  stopFlights();
  const byNode = new Map();
  for (const id of live) {
    const drawn = visibleNodeIdFor(tree.node(id).state);
    if (!drawn) continue;
    const list = byNode.get(drawn);
    if (list) list.push(id); else byNode.set(drawn, [id]);
  }

  const slots = new Map();
  const dots = new Map();
  const layer = $('sim-anim-g');
  if (!layer) return true;

  // **A paint is a diff**, as the rest of the canvas's run marks are, and it
  // never adds or removes an element once the run has drawn one. Measured in
  // Chromium, inserting or removing a single node anywhere in the canvas SVG
  // costs ~0.5ms of layout; moving a dot, recolouring it or toggling a class
  // costs nothing measurable. So a state keeps its group for the whole run and
  // a group keeps its dots, and what is not in use this step is hidden with a
  // class (`is-spare`). The spares are bounded — a group per state the run has
  // visited, at most MAX_PER_NODE dots each — and go when the run does.
  const used = new Set();
  for (const [nodeId, ids] of byNode) {
    const grp = App.domCache.states.get(nodeId);
    const c = grp && centreOf(grp);
    if (!c) continue;
    let g = groups.get(nodeId);
    if (!g || g.parentNode !== layer) {
      g = makeSVG('g');
      g.classList.add('br-toks');
      g.__dots = [];
      g.__more = null;
      layer.appendChild(g);
      groups.set(nodeId, g);
    }
    spare(g, false);
    setIfChanged(g, 'transform', `translate(${c.x},${c.y})`);
    const shown = ids.length > MAX_PER_NODE ? ids.slice(0, MAX_PER_NODE) : ids;
    const offs = slotOffsets(shown.length, tr, c.box);
    const pool = g.__dots;
    for (let j = shown.length; j < pool.length; j++) spare(pool[j], true);
    shown.forEach((id, j) => {
      let dot = pool[j];
      if (!dot) {
        dot = makeSVG('circle');
        dot.classList.add('br-tok');
        g.insertBefore(dot, g.__more);
        pool.push(dot);
      }
      spare(dot, false);
      syncDot(dot, tree, id, tr, frame.focus, offs[j]);
      // The centre rides along so a flight can slide round the rim to its slot.
      slots.set(id, { x: c.x + offs[j].x, y: c.y + offs[j].y, cx: c.x, cy: c.y, box: !!c.box });
      dots.set(id, dot);
    });
    syncMore(g, ids.length - shown.length, c.box, tr);
    grp.__brToks = g;
    used.add(nodeId);
  }
  // States that held tokens before and hold none now: hidden, not removed.
  for (const [nodeId, g] of groups) {
    if (used.has(nodeId)) continue;
    spare(g, true);
    forget(nodeId, g);
  }

  if (animate) {
    const prev = lastSlots;
    const plan = [];
    const leaving = new Set();
    for (const id of live) {
      const n = tree.node(id);
      if (!slots.has(id) || n.tid == null || n.parent < 0) continue;
      // From where its parent stood last step — or, for an ε-move that stays
      // at this position, from where the parent stands now.
      const from = prev.get(n.parent) || (tree.node(n.parent).depth === frame.depth ? slots.get(n.parent) : null);
      if (!from) continue;
      leaving.add(n.parent);
      plan.push({ id, tid: n.tid, from, to: slots.get(id), dot: dots.get(id), fade: false });
    }
    // Branches that reached a configuration another already held: they make
    // the trip, then dissolve into the one they joined.
    for (const id of tree.byDepth[frame.depth] || []) {
      const n = tree.node(id);
      if (n.fate !== 'merged' || n.tid == null) continue;
      const from = prev.get(n.parent);
      const into = n.into >= 0 ? slots.get(n.into) : null;
      const target = into || slotNear(tree.node(id).state, tr);
      if (!from || !target) continue;
      leaving.add(n.parent);
      plan.push({ id, tid: n.tid, from, to: target, dot: null, fade: true });
    }
    // Everything that stood last step and went nowhere: its branch ended there.
    let fading = 0;
    for (const [id, at] of prev) {
      if (leaving.has(id) || slots.has(id)) continue;
      if (fading++ >= MAX_FLIGHTS) break;
      fadeAt(tree, id, at, tr);
    }
    const flying = plan.slice(0, MAX_FLIGHTS);
    for (const p of flying) if (p.dot) p.dot.classList.add('is-arriving');
    const launch = () => flying.forEach(p => fly(tree, p, tr, opts.flightMs));
    if (opts.defer) opts.defer(launch); else launch();
  }

  lastSlots = slots;
  lastTree = tree;
  lastKey = key;
  lastDots = dots;
  lastFocus = frame.focus;
  return true;
}

function setIfChanged(el, name, value) {
  const v = String(value);
  if (el.getAttribute(name) !== v) el.setAttribute(name, v);
}

/** One resting token, written only where it differs from what it shows now. */
function syncDot(dot, tree, id, tr, focus, off) {
  const on = id === focus;
  const hue = tree.hue(id).toFixed(1);
  const acc = tree.fateOf(id) === 'acc';
  const k = `${off.x.toFixed(2)}|${off.y.toFixed(2)}|${tr.toFixed(2)}|${on}|${acc}|${hue}`;
  // A reused dot may still be hidden from a flight the last step began.
  dot.classList.remove('is-arriving');
  if (dot.__k === k) return;
  dot.__k = k;
  setIfChanged(dot, 'cx', off.x);
  setIfChanged(dot, 'cy', off.y);
  setIfChanged(dot, 'r', on ? tr * 1.35 : tr);
  dot.classList.toggle('is-focus', on);
  dot.classList.toggle('is-acc', acc);
  setHue(dot, +hue);
}

function spare(el, on) {
  if (el.__spare === on) return;
  el.__spare = on;
  el.classList.toggle('is-spare', on);
}

function syncMore(g, n, box, tr) {
  if (n <= 0) {
    if (g.__more) spare(g.__more, true);
    return;
  }
  if (!g.__more) { g.__more = moreLabel(n, box, tr); g.appendChild(g.__more); }
  spare(g.__more, false);
  const say = `+${n}`;
  if (g.__more.textContent !== say) g.__more.textContent = say;
}

function setFocused(tree, dot, id, on, tr) {
  dot.__k = null;   // no longer what syncDot last wrote
  dot.classList.toggle('is-focus', on);
  dot.setAttribute('r', on ? tr * 1.35 : tr);
  // The branch under the playhead is the one that can have just accepted.
  if (on) dot.classList.toggle('is-acc', tree.fateOf(id) === 'acc');
}

function moveFocus(tree, focus, tr) {
  if (focus === lastFocus) return;
  const was = lastDots.get(lastFocus), now = lastDots.get(focus);
  if (was) setFocused(tree, was, lastFocus, false, tr);
  if (now) setFocused(tree, now, focus, true, tr);
  lastFocus = focus;
}

function moreLabel(n, box, tr) {
  const t = makeSVG('text');
  t.classList.add('br-more');
  t.setAttribute('x', 0);
  t.setAttribute('y', box ? -box.h / 2 - tr * 2.2 : -R - tr * 2.2);
  t.textContent = `+${n}`;
  return t;
}

// A merge into a branch that is not drawn this step (it can be culled, or
// capped out of the tree): the rim of the state it arrived at will do.
function slotNear(stateId, tr) {
  const drawn = visibleNodeIdFor(stateId);
  const grp = drawn && App.domCache.states.get(drawn);
  const c = grp && centreOf(grp);
  return c ? { x: c.x, y: c.y - (c.box ? c.box.h / 2 : R), cx: c.x, cy: c.y, box: !!c.box } : null;
}

function fadeAt(tree, id, at, tr) {
  const layer = $('sim-anim-g');
  if (!layer) return;
  const dot = takeDot(layer, tree, id, tr);
  dot.setAttribute('cx', at.x);
  dot.setAttribute('cy', at.y);
  dot.classList.add('is-dying');
  fades.add(dot);
  const use = dot.__use;
  const drop = () => { fades.delete(dot); releaseDot(dot, use); };
  dot.onanimationend = drop;
  setTimeout(drop, 900);   // animations off, or the tab hidden
}

/**
 * One token along one edge, in three legs.
 *
 * A token rests in a slot on its state's rim, and the edge leaves that rim
 * somewhere else — usually a quarter of the way round. So the token slides
 * round the rim from its slot to where the edge begins, rides the edge itself,
 * and slides round the next state's rim into its new slot. Every point of the
 * trip is on something drawn.
 *
 * The first version blended the slot offset in across the whole flight, which
 * carried the token along a line parallel to the edge and a state's radius
 * away from it — a dot drifting over the canvas, never on the transition it
 * was supposed to be taking.
 */
function fly(tree, p, tr, dur) {
  const layer = $('sim-anim-g');
  const key = viewGraph().keyOf.get(p.tid);
  const grp = key && (App.domCache.transitions.get(key) || null);
  const pathEl = grp && grp.querySelector && grp.querySelector('.tarr');
  let len = 0;
  try { len = pathEl && layer ? pathEl.getTotalLength() : 0; } catch (e) { }
  if (!len) { land(p); return; }
  const dot = takeDot(layer, tree, p.id, tr);
  dot.classList.add('is-flying');
  if (p.fade) dot.classList.add('is-merging');
  let a = pathEl.getPointAtLength(0), b = pathEl.getPointAtLength(len);
  // The drawn edge is keyed by its endpoints and should run from→to; if it was
  // drawn the other way round, ride it backwards rather than across the canvas.
  const reversed = dist2(a, p.from) + dist2(b, p.to) > dist2(b, p.from) + dist2(a, p.to);
  if (reversed) [a, b] = [b, a];
  dot.setAttribute('cx', p.from.x);
  dot.setAttribute('cy', p.from.y);
  const f = { el: dot, raf: 0, use: dot.__use };
  flights.push(f);
  const t0 = performance.now();
  const tick = now => {
    if (!pathEl.isConnected) { finish(); return; }
    const t = Math.min(1, (now - t0) / dur);
    const leg = flightAt(t);
    const pt = leg.leg === 0 ? rimPoint(p.from, p.from, a, leg.u)
      : leg.leg === 2 ? rimPoint(p.to, b, p.to, leg.u)
        : pathEl.getPointAtLength(len * (reversed ? 1 - leg.u : leg.u));
    dot.setAttribute('cx', pt.x);
    dot.setAttribute('cy', pt.y);
    if (t < 1) f.raf = requestAnimationFrame(tick);
    else finish();
  };
  const finish = () => {
    releaseDot(dot, f.use);
    flights = flights.filter(x => x !== f);
    land(p);
  };
  f.raf = requestAnimationFrame(tick);
}

function dist2(p, q) {
  return (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
}

// The share of a flight spent sliding round a rim, at each end.
const RIM_SHARE = 0.2;

const smooth = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const easeInOut = u => (u < 0.5 ? 2 * u * u : -1 + (4 - 2 * u) * u);

/**
 * Which leg a flight is on at time t ∈ [0, 1], and how far through it (`u`):
 * 0 round the rim it leaves from, 1 along the edge, 2 round the rim it
 * arrives at. The rims are short and the edge is long, so the edge gets the
 * middle of the time and an ease that is fastest in its middle.
 */
export function flightAt(t) {
  if (t < RIM_SHARE) return { leg: 0, u: smooth(t / RIM_SHARE) };
  if (t > 1 - RIM_SHARE) return { leg: 2, u: smooth((t - (1 - RIM_SHARE)) / RIM_SHARE) };
  return { leg: 1, u: easeInOut((t - RIM_SHARE) / (1 - 2 * RIM_SHARE)) };
}

/**
 * A point a share `u` of the way from `a` to `b` round the rim of the node
 * `at` (which carries the centre, `cx`/`cy`) — the short way round a circle,
 * straight across on a block's box.
 */
function rimPoint(at, a, b, u) {
  if (at.box || at.cx == null) return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  const a0 = Math.atan2(a.y - at.cy, a.x - at.cx);
  let da = Math.atan2(b.y - at.cy, b.x - at.cx) - a0;
  if (da > Math.PI) da -= Math.PI * 2;
  if (da < -Math.PI) da += Math.PI * 2;
  const r0 = Math.hypot(a.x - at.cx, a.y - at.cy), r1 = Math.hypot(b.x - at.cx, b.y - at.cy);
  const th = a0 + da * u, r = r0 + (r1 - r0) * u;
  return { x: at.cx + Math.cos(th) * r, y: at.cy + Math.sin(th) * r };
}

function land(p) {
  if (p.dot) p.dot.classList.remove('is-arriving');
}

// Test seam.
export const _branchTokenTests = {
  get groups() { return groups; },
  get lastSlots() { return lastSlots; },
  get flights() { return flights; },
  get fades() { return fades; }
};
