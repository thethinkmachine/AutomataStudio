import { validateGuards } from './guards.js';
import { commit, snapshot } from './history.js';
import { $, App, activeComponentId, bindComponent, ensureRootComponent, flushActiveComponent, getComponent, hasCallStack, newComponentId } from './state.js';
import { Change, batch, emit, subscribe } from './store.js';
import {
  MEM_UNSET, childIndex, defaultEntry, flattenComponent, isSuperstate, leavesUnder,
  subtreeIds, uniqueRegionName, validateSuperstates
} from './superstates.js';
import { newId, newTId } from './states-transitions.js';
import { showStatus } from './utils.js';

// Hierarchical machines: navigation, component CRUD, and the compiler.
//
// A component is a DOCUMENT, not an instance. Ten boxes invoking `Expr` are ten
// call sites for one editable machine, so descending into a component already
// on the breadcrumb navigates to it rather than nesting another copy — which is
// also what makes a recursive machine editable at all, since Expr invoking
// itself would otherwise open an unbounded chain of identical canvases.
//
// The call stack that recursion really does need is a simulation concern, and
// lives in the compiled PDA rather than in the editor's breadcrumb.

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ══════════════════════════════════════════════════════════════════
//  COMPONENT CRUD
// ══════════════════════════════════════════════════════════════════

export function uniqueComponentName(base) {
  const want = String(base || 'Sub').trim() || 'Sub';
  const taken = new Set(App.components.map(c => c.name));
  if (!taken.has(want)) return want;
  let n = 2;
  while (taken.has(`${want} ${n}`)) n++;
  return `${want} ${n}`;
}

export function createComponent(name) {
  ensureRootComponent();
  const c = {
    id: newComponentId(),
    name: uniqueComponentName(name),
    states: [], transitions: [], startId: null, accepts: [], exitIds: [],
    cam: { x: 0, y: 0, z: 1 }
  };
  App.components.push(c);
  return c;
}

// Read/write access to one component that works whether or not it is the one
// on canvas.
//
// This exists because the obvious thing is wrong. The active component's truth
// is App.states / App.transitions / App.startId / App.accepts; its record in
// App.components is a cache. So pushing a state onto `getComponent(id).states`
// for the component you are standing in appears to work and is silently undone
// by the next flush. Anything walking or building the tree should go through
// here rather than touching records directly.
export function componentView(id) {
  const c = getComponent(id);
  if (!c) return null;
  const live = () => id === activeComponentId();
  return {
    id,
    get name() { return c.name; },
    set name(v) { c.name = v; },
    get states() { return live() ? App.states : (c.states || (c.states = [])); },
    get transitions() { return live() ? App.transitions : (c.transitions || (c.transitions = [])); },
    get startId() { return live() ? App.startId : c.startId; },
    set startId(v) { if (live()) App.startId = v; else c.startId = v; },
    get accepts() { return live() ? [...App.accepts] : [...(c.accepts || [])]; },
    isAccept(sid) { return live() ? App.accepts.has(sid) : (c.accepts || []).includes(sid); },
    addAccept(sid) {
      if (live()) App.accepts.add(sid);
      else { c.accepts = c.accepts || []; if (!c.accepts.includes(sid)) c.accepts.push(sid); }
    }
  };
}

// Every box pointing at a component, across the whole tree — the question
// "is anything still calling this?" has to look past the component on canvas.
export function callSites(componentId) {
  const out = [];
  for (const c of App.components) {
    for (const s of componentView(c.id).states) {
      if (s.callee === componentId) out.push({ component: c, state: s });
    }
  }
  return out;
}

export function renameComponent(id, name) {
  const c = getComponent(id);
  if (!c) return false;
  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed === c.name) return false;
  snapshot();
  c.name = uniqueComponentName(trimmed);
  emit(Change.GRAPH);
  return true;
}

// Turns an ordinary state into a call site. The state keeps its id, its name and
// every edge already attached to it: an incoming edge becomes a call, an
// outgoing edge becomes what happens on return.
export function promoteToSubmachine(stateId, name) {
  const s = App.states.find(st => st.id === stateId);
  if (!s) return false;
  if (s.callee) { showStatus('That is already a sub-machine'); return false; }
  // A region already holds states inline; turning it into an empty call site
  // would strand them. Extract is the move that means what this one would.
  if (isSuperstate(s)) { showStatus(`'${s.name}' is a region — use Extract as Sub-machine`); return false; }
  snapshot();
  const c = createComponent(name || s.name);
  s.callee = c.id;
  emit(Change.GRAPH);
  showStatus(`'${s.name}' now invokes '${c.name}' — double-click to open it`);
  return true;
}

// The inverse. The component itself is left alone unless nothing else calls it,
// so demoting one of several call sites cannot silently delete shared work.
export function demoteToState(stateId) {
  const s = App.states.find(st => st.id === stateId);
  if (!s || !s.callee) return false;
  const componentId = s.callee;
  snapshot();
  delete s.callee;
  const others = callSites(componentId);
  const orphan = others.length === 0 && componentId !== App.rootComponentId;
  if (orphan) App.components = App.components.filter(c => c.id !== componentId);
  emit(Change.GRAPH);
  showStatus(orphan ? 'Sub-machine removed — nothing else called it' : 'Call site removed; the sub-machine is still used elsewhere');
  return true;
}

export function deleteComponent(id) {
  if (id === App.rootComponentId) { showStatus('The root machine cannot be deleted'); return false; }
  const c = getComponent(id);
  if (!c) return false;
  snapshot();
  // Drop the component and turn every box that called it back into a plain
  // state, so no call site is left pointing at nothing.
  for (const site of callSites(id)) delete site.state.callee;
  App.components = App.components.filter(x => x.id !== id);
  if (App.componentPath.includes(id)) {
    const idx = App.componentPath.indexOf(id);
    const fallback = App.componentPath[idx - 1] || App.rootComponentId;
    bindComponent(fallback, App.componentPath.slice(0, Math.max(1, idx)));
  }
  emit(Change.GRAPH);
  return true;
}

// ══════════════════════════════════════════════════════════════════
//  THE TOGGLE:  CONTAINMENT  ⇄  REFERENCE
// ══════════════════════════════════════════════════════════════════
// The same picture, drawn two ways, sitting on opposite sides of the REG/CFL
// boundary. Extracting a region turns containment into reference; inlining a
// sub-machine turns reference back into containment — and REFUSES when the
// component is recursive, because inlining a thing that contains itself does not
// terminate. That refusal is not an implementation limit. It is the proof: a
// component you cannot inline is one no finite picture can express, which is
// exactly what it means for the language to be beyond regular.
//
// Both directions preserve the language, and both use the same three facts:
//
//   entry(region)   ≡  start state of the component
//   exits(region)   ≡  accepting states of the component
//   an arrow out of a region  ≡  an arrow out of the box, taken after return

/**
 * Region → sub-machine. Its contents move into a new component, the region node
 * keeps its id and becomes the box that calls it, and every arrow that crossed
 * the boundary is re-attached to the box.
 */
export function extractRegionToSubmachine(stateId, name) {
  const region = App.states.find(s => s.id === stateId);
  if (!isSuperstate(region)) { showStatus('Only a region can be extracted'); return false; }
  const inside = subtreeIds(stateId).filter(id => id !== stateId);
  if (!inside.length) { showStatus('That region is empty — put something in it first'); return false; }

  const idx = childIndex(App.states);
  const insideSet = new Set(inside);
  const entry = defaultEntry(stateId, App.states, idx);
  const innerLeaves = leavesUnder(stateId, App.states, idx);

  // A region has as many ways in as it has states; a component has exactly one.
  // An arrow aimed past the default entry therefore cannot survive the move, and
  // silently changing the language would be far worse than refusing to.
  const nameOf = id => App.states.find(s => s.id === id)?.name || id;
  const misAimed = App.transitions.find(t => insideSet.has(t.to) && t.to !== entry && !insideSet.has(t.from));
  if (misAimed) {
    showStatus(`A sub-machine has one way in, but an arrow aims at '${nameOf(misAimed.to)}' inside the region — make that the default entry first`);
    return false;
  }
  if (insideSet.has(App.startId) && App.startId !== entry) {
    showStatus(`The machine starts at '${nameOf(App.startId)}' inside the region — make it the default entry first`);
    return false;
  }

  snapshot();
  const c = createComponent(name || region.name);

  // Everything that crossed the boundary re-attaches to the box, because a call
  // enters at one point and returns to one point. States that had an arrow
  // leaving the region become the component's exits — the accept ring in a
  // sub-machine means "return to my caller".
  const exits = new Set();
  const outer = [], innerT = [];
  // Several inner states leaving on the same symbol collapse to one arrow off
  // the box, which is the whole economy of the move.
  const seenOuter = new Set();
  const push = t => {
    const k = `${t.from}${t.to}${t.symbol}`;
    if (seenOuter.has(k)) return;
    seenOuter.add(k);
    outer.push(t);
  };
  for (const t of App.transitions) {
    const fromIn = insideSet.has(t.from), toIn = insideSet.has(t.to);
    if (fromIn && toIn) { innerT.push(t); continue; }
    // An arrow drawn on the REGION means "from anywhere inside it", so after the
    // move every leaf has to be able to return and the box takes the arrow.
    // Returning consumes no input, so leaf → return → arrow is the same run.
    if (t.from === stateId) {
      for (const leaf of innerLeaves) exits.add(leaf);
      push(toIn ? { ...t, to: stateId } : t);
      continue;
    }
    if (fromIn) { exits.add(t.from); push({ ...t, from: stateId }); continue; }
    if (toIn) { push({ ...t, to: stateId }); continue; }
    push(t);
  }
  // The machine starting inside the region now starts by calling it.
  if (App.startId === entry) App.startId = stateId;
  // An accepting state inside the region has to keep accepting: it becomes an
  // exit, and the box becomes accepting so that returning from it accepts.
  let boxAccepts = false;
  for (const id of inside) {
    if (!App.accepts.has(id)) continue;
    App.accepts.delete(id);
    exits.add(id);
    boxAccepts = true;
  }
  if (boxAccepts) App.accepts.add(stateId);

  c.states = App.states.filter(s => insideSet.has(s.id));
  // The states are leaving this component, so their outermost level inside it
  // becomes top-level in the new one.
  for (const s of c.states) if (s.parent === stateId) delete s.parent;
  c.transitions = innerT;
  c.startId = entry;
  c.accepts = [...exits];

  App.states = App.states.filter(s => !insideSet.has(s.id));
  App.transitions = outer;
  delete region.super;
  delete region.initial;
  region.callee = c.id;
  App.selectedStates.clear();

  emit(Change.GRAPH);
  showStatus(`'${region.name}' is now a call site for sub-machine '${c.name}' — the language is unchanged, but the model is not`);
  return true;
}

/**
 * Sub-machine → region. A copy of the component is inlined as the box's
 * contents, with fresh ids so the other call sites keep their own component.
 *
 * Refuses on a recursive component, and says why: that refusal is the REG/CFL
 * boundary showing up as an error message.
 */
export function inlineSubmachineAsRegion(stateId) {
  const box = App.states.find(s => s.id === stateId);
  if (!box || !box.callee) { showStatus('Only a sub-machine call site can be inlined'); return false; }
  const target = getComponent(box.callee);
  if (!target) { showStatus('That sub-machine no longer exists'); return false; }

  const tree = machineTree();
  if (recursiveComponents(tree).has(box.callee)) {
    showStatus(`'${target.name}' invokes itself, so it cannot be drawn inline — that is exactly why this machine is context-free and not regular`);
    return false;
  }
  const flat = flattenComponent(target);
  if (!flat.states.length || !flat.startId) { showStatus(`'${target.name}' is empty — nothing to inline`); return false; }

  snapshot();
  const componentId = box.callee;
  // Fresh ids: a component may have several call sites, and inlining one of
  // them must not move states out from under the others.
  const idMap = new Map();
  const taken = new Set(App.states.map(s => s.name));
  // Dropped in around where the box was, keeping the sub-machine's own layout.
  const cx = flat.states.reduce((a, s) => a + s.x, 0) / flat.states.length;
  const cy = flat.states.reduce((a, s) => a + s.y, 0) / flat.states.length;
  const copies = flat.states.map(s => {
    const id = newId();
    idMap.set(s.id, id);
    let name = s.name;
    while (taken.has(name)) name += '′';
    taken.add(name);
    return { ...s, id, name, parent: stateId, x: box.x + (s.x - cx), y: box.y + (s.y - cy) };
  });
  const copyTrans = flat.transitions.map(t => {
    const rec = { ...t, id: newTId(), from: idMap.get(t.from), to: idMap.get(t.to) };
    delete rec.origin;
    return rec;
  });

  // Arrows out of the box were "what happens after the call returns", so they
  // now leave the states that were the component's exits — not the region as a
  // whole, which would let them fire from anywhere inside it.
  const exitIds = flat.accepts.map(id => idMap.get(id)).filter(Boolean);
  const rewired = [];
  for (const t of App.transitions) {
    if (t.from !== stateId) { rewired.push(t); continue; }
    for (const exit of exitIds) rewired.push({ ...t, id: newTId(), from: exit });
  }
  // Likewise the box's own accept mark: it meant "accept once this has
  // returned", which is now the exits accepting.
  if (App.accepts.has(stateId)) {
    App.accepts.delete(stateId);
    for (const exit of exitIds) App.accepts.add(exit);
  }

  delete box.callee;
  box.super = true;
  box.initial = idMap.get(flat.startId);
  App.states.push(...copies);
  App.transitions = rewired.concat(copyTrans);

  // Drop the component if this was its last caller, the same rule demoteToState
  // uses — shared work is never deleted out from under another call site.
  const orphan = componentId !== App.rootComponentId && callSites(componentId).length === 0;
  if (orphan) App.components = App.components.filter(x => x.id !== componentId);

  emit(Change.GRAPH);
  showStatus(orphan
    ? `'${target.name}' inlined as a region — no stack needed, so this part is regular`
    : `'${target.name}' inlined here; its other call sites still use the sub-machine`);
  return true;
}

// ══════════════════════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════════════════════

export function enterComponent(componentId) {
  const target = getComponent(componentId);
  if (!target) { showStatus('That sub-machine no longer exists'); return false; }
  if (componentId === activeComponentId()) {
    showStatus(`Already editing '${target.name}'`);
    return false;
  }
  flushActiveComponent();
  // Revisiting a component already on the path navigates to it — see the note
  // at the top of this file about components being documents, not instances.
  const seen = App.componentPath.indexOf(componentId);
  const path = seen >= 0
    ? App.componentPath.slice(0, seen + 1)
    : [...App.componentPath, componentId];
  bindComponent(componentId, path);
  emit(Change.GRAPH);
  return true;
}

export function descendIntoBox(stateId) {
  const s = App.states.find(st => st.id === stateId);
  if (!s || !s.callee) return false;
  const target = getComponent(s.callee);
  if (target && s.callee === activeComponentId()) {
    showStatus(`'${target.name}' calls itself — you are already editing it`);
    return false;
  }
  return enterComponent(s.callee);
}

export function ascendTo(componentId) {
  const idx = App.componentPath.indexOf(componentId);
  if (idx < 0 || componentId === activeComponentId()) return false;
  flushActiveComponent();
  bindComponent(componentId, App.componentPath.slice(0, idx + 1));
  emit(Change.GRAPH);
  return true;
}

export function ascendOne() {
  const path = App.componentPath;
  if (path.length < 2) return false;
  return ascendTo(path[path.length - 2]);
}

// ══════════════════════════════════════════════════════════════════
//  BREADCRUMB
// ══════════════════════════════════════════════════════════════════
// Rendered as an overlay above the canvas rather than as an element inside
// #canvas-wrap. canvas.js resolves that wrap once at module scope and uses its
// getBoundingClientRect() as the screen-to-world mapping, so a child that took
// up layout height would offset every pointer coordinate in the app.

export function renderBreadcrumb() {
  const el = $('hier-crumbs');
  if (!el) return;
  const path = App.componentPath.length ? App.componentPath : (App.rootComponentId ? [App.rootComponentId] : []);
  // A flat machine is a tree of one, and a one-item breadcrumb is just clutter.
  const show = App.components.length > 1 && path.length > 0;
  el.style.display = show ? '' : 'none';
  if (!show) { el.innerHTML = ''; return; }

  el.innerHTML = path.map((id, i) => {
    const c = getComponent(id);
    const name = esc(c ? c.name : '?');
    const last = i === path.length - 1;
    const crumb = last
      ? `<span class="crumb crumb-here" aria-current="true">${name}</span>`
      : `<button class="crumb" type="button" onclick="ascendTo('${id}')" data-tip="Back to ${name}">${name}</button>`;
    return crumb + (last ? '' : '<span class="crumb-sep" aria-hidden="true">›</span>');
  }).join('');
}

subscribe(Change.GRAPH, renderBreadcrumb);

/**
 * The component tree as a list of things you can point at.
 *
 * The breadcrumb shows one PATH; this shows the whole SET, which is the thing
 * regions get for free by being on the canvas and components never had. It is
 * also the only home rename and delete have ever had — both were written,
 * exported, and called from nowhere.
 *
 * The badges are the facts a call site cannot show you: how many boxes invoke
 * this, whether it reaches itself (which is why the machine needs a stack), and
 * whether anything reaches it at all.
 */
export function renderComponentList() {
  const el = $('components-list');
  if (!el) return;
  const sec = $('components-sec');
  const show = hasCallStack() && App.components.length > 0;
  if (sec) sec.style.display = show ? '' : 'none';
  const count = $('lp-count-components');
  if (count) {
    count.textContent = String(App.components.length);
    if (App.components.length) count.removeAttribute('data-empty');
    else count.setAttribute('data-empty', '1');
  }
  if (!show) { el.innerHTML = ''; return; }

  // Cheap reads only — this runs on every graph change. rawCallGraph walks the
  // component records; it does not flatten anything.
  const graph = rawCallGraph();
  const recursive = recursiveComponentIds(graph);
  const reached = new Set();
  const stack = App.rootComponentId ? [App.rootComponentId] : [];
  while (stack.length) {
    const n = stack.pop();
    if (reached.has(n)) continue;
    reached.add(n);
    for (const m of graph.get(n) || []) stack.push(m);
  }

  const active = activeComponentId();
  el.innerHTML = App.components.map(c => {
    const isRoot = c.id === App.rootComponentId;
    const sites = callSites(c.id).length;
    const states = componentView(c.id).states.length;
    const badges = [];
    if (isRoot) badges.push('<span class="cmp-badge cmp-root">root</span>');
    if (recursive.has(c.id)) badges.push('<span class="cmp-badge cmp-rec" data-tip="Invokes itself — this is what makes the machine context-free rather than regular, and why it cannot be inlined as a region">recursive</span>');
    if (!isRoot && !reached.has(c.id)) badges.push('<span class="cmp-badge cmp-orphan" data-tip="Nothing reaches this from the root machine">unreachable</span>');
    const sitesLbl = isRoot ? '' : `<span class="cmp-sites" data-tip="Call sites that invoke it">×${sites}</span>`;
    return `<div class="si cmp-row ${c.id === active ? 'lp-selected' : ''}"
  onclick="enterComponent('${c.id}')" ondblclick="promptRenameComponent('${c.id}')"
  data-tip="${esc(c.name)} — ${states} state${states === 1 ? '' : 's'}. Click to open, double-click to rename.">
  ${esc(c.name)}${sitesLbl}${badges.join('')}
  ${isRoot ? '' : `<span class="dx" onclick="event.stopPropagation(); promptDeleteComponent('${c.id}')" data-tip="Delete this sub-machine — its call sites become plain states"><svg viewBox="0 0 256 256" width="10" height="10" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg></span>`}
</div>`;
  }).join('');
}

subscribe(Change.GRAPH, renderComponentList);

/** Rename from the list. Wires up renameComponent, which had no caller. */
export function promptRenameComponent(id) {
  const c = getComponent(id);
  if (!c) return;
  const next = prompt(`Rename '${c.name}' to:`, c.name);
  if (next === null) return;
  if (renameComponent(id, next)) showStatus(`Renamed to '${getComponent(id).name}'`);
}

/**
 * Delete from the list. Wires up deleteComponent, which had no caller.
 *
 * Says how many call sites it is about to turn back into plain states, because
 * that is the part that is not visible from here.
 */
export function promptDeleteComponent(id) {
  const c = getComponent(id);
  if (!c) return;
  const sites = callSites(id).length;
  const warn = sites
    ? `Delete '${c.name}'? ${sites} call site${sites === 1 ? '' : 's'} will become ${sites === 1 ? 'a plain state' : 'plain states'}.`
    : `Delete '${c.name}'? Nothing calls it.`;
  if (!confirm(warn)) return;
  if (deleteComponent(id)) showStatus(`Deleted '${c.name}'`);
}

// ══════════════════════════════════════════════════════════════════
//  THE MACHINE AS A WHOLE
// ══════════════════════════════════════════════════════════════════
// Everything below reads the entire component tree, so it flushes first.
//
// The semantics, stated once:
//
//   entry(c)  is c.startId
//   exits(c)  are c.accepts -- in a sub-machine the accept ring means
//             "return to my caller"; in the root it means "accept"
//
//   arriving at a box       pushes a return context and continues at
//                           entry(callee)
//   reaching an exit        pops, and continues AT the box in the caller,
//                           from which the box's outgoing edges are taken
//
//   a word is accepted when the input is consumed, the call stack is EMPTY,
//   and the machine is at an accepting node of the root component
//
// That empty-stack clause is the whole difference between this and a finite
// automaton. Sitting on an accepting node with calls still pending is not
// acceptance -- it is a PDA in a final state with a non-empty stack.

export function machineTree() {
  flushActiveComponent();
  const components = new Map();
  for (const c of App.components) {
    // Containment is resolved here, once, so that everything downstream — the
    // simulator, the validator, the RSM→PDA compiler, every export target —
    // sees a component whose states are a flat set. Regions are the family that
    // adds no power, and flattening is the constructive proof of it; making it
    // the tree's entry point is what stops the other family from ever having to
    // know regions exist. Leaf ids survive, so highlighting still lands on the
    // nodes the user drew.
    const flat = flattenComponent(c);
    components.set(c.id, {
      id: c.id,
      name: c.name,
      states: flat.states,
      transitions: flat.transitions,
      startId: flat.startId,
      accepts: new Set(flat.accepts),
      stateById: new Map(flat.states.map(s => [s.id, s])),
      // Entry actions of the start leaf, which no transition can carry.
      startOutput: flat.startOutput || '',
      truncated: !!flat.truncated,
      hasActions: !!(flat.startOutput || flat.transitions.some(t => t.output)),
      // The component as drawn, for anything that has to report on the picture
      // rather than on what it denotes.
      raw: c,
      expanded: flat.expanded
    });
  }
  return { root: App.rootComponentId, components };
}

// Which components each component can invoke. A cycle here is recursion, and
// recursion is exactly what lifts the machine from regular to context-free.
export function callGraph(tree = machineTree()) {
  const g = new Map();
  for (const [id, c] of tree.components) {
    const out = new Set();
    for (const s of c.states) if (s.callee) out.add(s.callee);
    g.set(id, out);
  }
  return g;
}

/**
 * The call graph straight off the component records, without flattening.
 *
 * `callGraph(machineTree())` is the honest version and the one every analysis
 * uses, but machineTree() flattens every component — far too much work for the
 * renderer, which only wants to know which boxes to mark and asks once per
 * pass. Whether a state has a `callee` is not something flattening changes, so
 * the cheap read is also the correct one here.
 */
export function rawCallGraph() {
  const g = new Map();
  for (const c of App.components) {
    const out = new Set();
    for (const s of componentView(c.id).states) if (s.callee) out.add(s.callee);
    g.set(c.id, out);
  }
  return g;
}

/** Which components reach themselves — the ones that make the stack necessary. */
export function recursiveComponentIds(g = rawCallGraph()) {
  const found = new Set();
  for (const start of g.keys()) {
    const seen = new Set();
    const stack = [...(g.get(start) || [])];
    while (stack.length) {
      const n = stack.pop();
      if (n === start) { found.add(start); break; }
      if (seen.has(n)) continue;
      seen.add(n);
      for (const m of g.get(n) || []) stack.push(m);
    }
  }
  return found;
}

export function recursiveComponents(tree = machineTree()) {
  const g = callGraph(tree);
  const found = new Set();
  // A component is recursive if it can reach itself through the call graph.
  for (const start of g.keys()) {
    const seen = new Set();
    const stack = [...(g.get(start) || [])];
    while (stack.length) {
      const n = stack.pop();
      if (n === start) { found.add(start); break; }
      if (seen.has(n)) continue;
      seen.add(n);
      for (const m of g.get(n) || []) stack.push(m);
    }
  }
  return found;
}

export function reachableComponents(tree = machineTree()) {
  const g = callGraph(tree);
  const seen = new Set();
  const stack = tree.root ? [tree.root] : [];
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of g.get(n) || []) stack.push(m);
  }
  return seen;
}

// Problems worth telling the user about before they wonder why nothing runs.
export function validateHierarchy(tree = machineTree()) {
  const issues = [];
  const reachable = reachableComponents(tree);
  for (const [id, c] of tree.components) {
    if (!c.startId && (id === tree.root || reachable.has(id))) {
      issues.push({ level: 'error', component: id, message: `'${c.name}' has no start state, so it can never be entered` });
    }
    if (id !== tree.root && !c.accepts.size && reachable.has(id)) {
      issues.push({ level: 'error', component: id, message: `'${c.name}' has no accepting state, so a call into it can never return` });
    }
    for (const s of c.states) {
      if (s.callee && !tree.components.has(s.callee)) {
        issues.push({ level: 'error', component: id, message: `Box '${s.name}' in '${c.name}' invokes a sub-machine that no longer exists` });
      }
    }
    if (!reachable.has(id)) {
      issues.push({ level: 'warn', component: id, message: `'${c.name}' is never invoked from the root machine` });
    }
    // Containment problems are reported against the picture, not against the
    // flattened result — by the time a region has been flattened away there is
    // nothing left to complain about.
    if (c.raw) {
      for (const issue of validateSuperstates(c.raw)) {
        issues.push({ ...issue, component: id });
      }
      for (const issue of validateGuards(c.raw.transitions || [], App.flags || [])) {
        issues.push({ ...issue, component: id });
      }
    }
    if (c.truncated) {
      issues.push({
        level: 'error', component: id,
        message: `'${c.name}' flattens to more than ${App.config.maxFlatStates} states — raise the limit in Settings, or use fewer history regions and flags`
      });
    }
  }
  return issues;
}

// ══════════════════════════════════════════════════════════════════
//  SIMULATION
// ══════════════════════════════════════════════════════════════════
// A configuration is (component, state, input position, call stack, phase).
// `phase` only matters on a box: arriving at one calls its component, and
// coming back lands on the same box in phase 'returned', from which the box's
// outgoing edges are taken. Without that distinction a return would
// immediately call again and every machine would loop forever.

function cfgKey(c) {
  return `${c.comp}${c.state}${c.i}${c.phase}` +
    c.stack.map(f => `${f.comp}:${f.box}`).join('|');
}

function successors(cfg, tree, tokens) {
  const c = tree.components.get(cfg.comp);
  if (!c) return [];
  const s = c.stateById.get(cfg.state);
  if (!s) return [];
  const out = [];

  // A call site does nothing else until its component returns.
  if (s.callee && cfg.phase !== 'returned') {
    const callee = tree.components.get(s.callee);
    if (callee && callee.startId) {
      out.push({
        comp: s.callee, state: callee.startId, i: cfg.i, phase: 'enter',
        stack: [...cfg.stack, { comp: cfg.comp, box: s.id }],
        prev: cfg, kind: 'call', via: null
      });
    }
    return out;
  }

  if (c.accepts.has(cfg.state) && cfg.stack.length) {
    const top = cfg.stack[cfg.stack.length - 1];
    out.push({
      comp: top.comp, state: top.box, i: cfg.i, phase: 'returned',
      stack: cfg.stack.slice(0, -1), prev: cfg, kind: 'return', via: null
    });
  }

  const eps = App.config.sym.eps;
  for (const t of c.transitions) {
    if (t.from !== cfg.state) continue;
    if (t.symbol === eps) {
      out.push({ comp: cfg.comp, state: t.to, i: cfg.i, phase: 'enter', stack: cfg.stack, prev: cfg, kind: 'eps', via: t });
    } else if (cfg.i < tokens.length && tokens[cfg.i] === t.symbol) {
      out.push({ comp: cfg.comp, state: t.to, i: cfg.i + 1, phase: 'enter', stack: cfg.stack, prev: cfg, kind: 'read', via: t });
    }
  }
  return out;
}

function isAccepting(cfg, tree, tokens) {
  if (cfg.i !== tokens.length) return false;
  // The clause everyone forgets: every call must have returned.
  if (cfg.stack.length) return false;
  if (cfg.comp !== tree.root) return false;
  const c = tree.components.get(cfg.comp);
  if (!c) return false;
  const s = c.stateById.get(cfg.state);
  // An accepting box that has not run its component yet has not finished.
  if (s && s.callee && cfg.phase !== 'returned') return false;
  return c.accepts.has(cfg.state);
}

// Breadth-first, so the path shown is the shortest accepting one — which is
// also the most readable trace for a machine that recurses.
export function exploreRSM(tokens, tree = machineTree()) {
  const root = tree.components.get(tree.root);
  if (!root || !root.startId) return { status: 'nostart' };

  const maxDepth = App.config.maxCallDepth || 60;
  const budget = App.config.maxPdaSteps || 2000;
  const start = { comp: tree.root, state: root.startId, i: 0, phase: 'enter', stack: [], prev: null, kind: 'start', via: null };

  const queue = [start];
  const seen = new Set([cfgKey(start)]);
  let deepest = start, expanded = 0, hitDepth = false;

  while (queue.length) {
    const cur = queue.shift();
    if (isAccepting(cur, tree, tokens)) return { status: 'accept', node: cur };
    if (cur.i > deepest.i || (cur.i === deepest.i && cur.stack.length < deepest.stack.length)) deepest = cur;
    if (++expanded > budget) return { status: 'budget', node: deepest };

    for (const next of successors(cur, tree, tokens)) {
      if (next.stack.length > maxDepth) { hitDepth = true; continue; }
      const k = cfgKey(next);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(next);
    }
  }
  return { status: hitDepth ? 'depth' : 'reject', node: deepest };
}

function noteFor(cfg, tree) {
  const c = tree.components.get(cfg.comp);
  const nameOf = (comp, id) => tree.components.get(comp)?.stateById.get(id)?.name || id;
  switch (cfg.kind) {
    case 'start': return `Start in '${c?.name}' at ${nameOf(cfg.comp, cfg.state)}`;
    case 'call': {
      const caller = cfg.stack[cfg.stack.length - 1];
      return `Call '${c?.name}' from box ${nameOf(caller.comp, caller.box)} — push return address`;
    }
    case 'return':
      return `Return to '${c?.name}' at box ${nameOf(cfg.comp, cfg.state)} — pop return address`;
    case 'read':
      return `Read '${cfg.via.symbol}': ${nameOf(cfg.comp, cfg.via.from)} → ${nameOf(cfg.comp, cfg.via.to)}`;
    case 'eps':
      return `${App.config.sym.eps}-move: ${nameOf(cfg.comp, cfg.via.from)} → ${nameOf(cfg.comp, cfg.via.to)}`;
    default: return '';
  }
}

export function buildRsmSteps(path, tokens, tree, finalStatus, finalNote) {
  // A machine with no boxes never calls anything, so a call-stack row showing
  // one unchanging frame is noise. This is the whole difference the UI needs to
  // know about between an HSM run and an RSM one.
  const showStack = hasBoxes(tree);
  // Actions are a running side effect, so they accumulate across the path rather
  // than being a property of any one configuration. A call enters a component,
  // which runs that component's start entry chain — the same rule as step 0.
  const showOut = [...tree.components.values()].some(c => c.hasActions);
  const outToks = [];
  let outStr = '';
  const emitAct = cfg => {
    let act = '';
    if (cfg.kind === 'start') act = tree.components.get(cfg.comp)?.startOutput || '';
    else if (cfg.kind === 'call') act = tree.components.get(cfg.comp)?.startOutput || '';
    else act = cfg.via?.output || '';
    if (act) { outToks.push(act); outStr += (outStr ? ' ' : '') + act; }
  };
  // History splits one drawn leaf into one flat state per thing the region might
  // remember, so `cfg.state` is synthetic in exactly the way `via.id` is. Both
  // carry `origin` back to the node the user drew, and highlighting names that.
  const originOf = (comp, id) => tree.components.get(comp)?.stateById.get(id)?.origin || id;
  // An orthogonal configuration is in several drawn leaves simultaneously.
  const originsOf = (comp, id) => tree.components.get(comp)?.stateById.get(id)?.origins;
  // The part of the configuration the picture cannot show. A run through a
  // guarded machine takes different arrows out of the same drawn state on
  // different visits, and without these the panel gives the reader no way to
  // see why — the whole point of a guard is state that is not in the diagram.
  const flatOf = (comp, id) => tree.components.get(comp)?.stateById.get(id);
  // Memory names a REGION and one of its CHILDREN — both drawn nodes, which
  // flattening removed. So this resolves against the component as drawn
  // (`raw`), not against stateById, which is keyed by synthesised flat ids and
  // would silently fall through to showing raw ids.
  const nameIn = (comp, id) =>
    tree.components.get(comp)?.raw?.states?.find(s => s.id === id)?.name || id;
  // Containment depth, the mirror of the call stack.
  //
  // The Call row makes "recursion is a stack" something you watch happen.
  // Containment depth is just as real and had no equivalent: a run through a
  // three-deep nest showed a highlighted leaf and nothing about where it sat.
  // Named against the component AS DRAWN for the same reason `mem` is — the
  // regions were flattened away, so stateById cannot see them.
  const rawOf = comp => tree.components.get(comp)?.raw;
  const nestOf = (comp, flatId) => {
    const raw = rawOf(comp);
    if (!raw || !raw.states?.some(isSuperstate)) return null;
    const leaf = originOf(comp, flatId);
    const byId = new Map(raw.states.map(s => [s.id, s]));
    const chain = [];
    for (let cur = byId.get(leaf); cur; cur = cur.parent ? byId.get(cur.parent) : null) {
      chain.unshift(cur.name);
      if (chain.length > raw.states.length) break;   // a hand-edited parent cycle
    }
    return chain.length > 1 ? chain : null;
  };

  const steps = path.map(cfg => (emitAct(cfg), {
    state: originOf(cfg.comp, cfg.state),
    states: originsOf(cfg.comp, cfg.state),
    nest: nestOf(cfg.comp, cfg.state),
    vals: flatOf(cfg.comp, cfg.state)?.vals || null,
    // Region name → the child it remembers, resolved to names for display.
    mem: (() => {
      const m = flatOf(cfg.comp, cfg.state)?.mem;
      if (!m) return null;
      const out = {};
      for (const [region, child] of Object.entries(m)) {
        out[nameIn(cfg.comp, region)] = child === MEM_UNSET || !child
          ? '—'
          : nameIn(cfg.comp, child);
      }
      return out;
    })(),
    component: cfg.comp,
    ...(showOut ? { outToks: [...outToks], outSoFar: outStr } : {}),
    // Component ids from the root down to the one currently executing. The
    // breadcrumb binds straight to this, so it doubles as a depth gauge:
    // Main > Expr > Expr is a machine two calls deep into itself.
    frames: [...cfg.stack.map(f => f.comp), cfg.comp],
    callStack: showStack
      ? [...cfg.stack.map(f => tree.components.get(f.comp)?.name || '?'),
        tree.components.get(cfg.comp)?.name || '?']
      : null,
    tokens,
    remaining: tokens.slice(cfg.i),
    // `origin` is the arrow the user drew; `id` is what flattening synthesised
    // for it. Highlighting has to name the former.
    tid: cfg.via?.origin || cfg.via?.id,
    note: noteFor(cfg, tree)
  }));
  if (steps.length && finalStatus) {
    const last = steps[steps.length - 1];
    last.final = finalStatus;
    last.note += finalStatus === 'accept' ? ' — ACCEPT' : ` — ${finalNote || 'REJECT'}`;
  }
  return steps;
}

function pathTo(node) {
  const out = [];
  for (let n = node; n; n = n.prev) out.push(n);
  return out.reverse();
}

export function simRSM(tokens) {
  const tree = machineTree();
  const problems = validateHierarchy(tree).filter(p => p.level === 'error');
  const result = exploreRSM(tokens, tree);

  if (result.status === 'nostart') {
    App.simSteps = [];
    showStatus('The root machine has no start state');
    return { accepted: false };
  }

  const path = pathTo(result.node);
  let status = 'reject', note = '';
  if (result.status === 'accept') status = 'accept';
  else if (result.status === 'budget') { status = 'timeout'; note = 'Step budget exhausted — raise it in Settings'; }
  else if (result.status === 'depth') { status = 'reject'; note = `Call depth limit (${App.config.maxCallDepth || 60}) reached — is there a base case?`; }
  else if (problems.length) note = problems[0].message;
  else note = 'No accepting run: input consumed, call stack empty and an accepting root state must all hold at once';

  // Truncation is not a property of the verdict, so it cannot ride on the
  // reject note: a truncated machine that ACCEPTS is the dangerous case, and
  // reporting it only when the run happens to fail is reporting it exactly
  // when it matters least. This answer is about a different machine, and that
  // has to be said whichever way it came out.
  const cut = [...tree.components.values()].filter(c => c.truncated);
  if (cut.length) {
    const over = `Flattening hit the ${App.config.maxFlatStates || 4000}-state ceiling in ${cut.map(c => `'${c.name}'`).join(', ')} — this verdict is for a truncated machine. Raise “Max Flattened States” in Settings → Hierarchical.`;
    note = note ? `${over} ${note}` : over;
    showStatus(over);
  }

  App.simSteps = buildRsmSteps(path, tokens, tree, status, note);
  App.simIdx = 0;
  return { accepted: status === 'accept' };
}

// ══════════════════════════════════════════════════════════════════
//  RSM → PDA
// ══════════════════════════════════════════════════════════════════
// The construction behind "recursive state machines are exactly the
// context-free languages". Every component becomes a block of PDA states, a
// call pushes a return address, an exit pops it.
//
// Two details carry the correctness:
//
//   A box becomes TWO states — the call site and the point after the callee
//   returned. Without that split, returning would land back on the call site
//   and immediately call again.
//
//   A dedicated bottom marker is pushed at the start and popped into the only
//   accepting state. Final-state acceptance alone would be wrong for a machine
//   whose ROOT is recursive: the root's states are then reachable with calls
//   still pending, and accepting there would accept unbalanced input.

// Return addresses have to be SINGLE characters: applyPdaStoreTransition treats
// a push string as a sequence of symbols and splits it, so a multi-character
// address would push five symbols and pop one. The box each stands for is still
// legible from the diagram — the push leaves the box's call state and the
// matching pop enters its ↵ twin.
const RETURN_SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function returnSymbol(i) {
  return i < RETURN_SYMBOLS.length ? RETURN_SYMBOLS[i] : String.fromCharCode(0x3b1 + (i - RETURN_SYMBOLS.length));
}

export function hasBoxes(tree = machineTree()) {
  for (const [, c] of tree.components) if (c.states.some(s => s.callee)) return true;
  return false;
}

export function compileToPDA(tree = machineTree()) {
  const root = tree.components.get(tree.root);
  // Deliberately NOT App.config.sym.stackBottom. A marker of its own is what
  // makes the construction correct under both PDA paradigms: in explicit mode
  // the run already starts with Z on the stack, and in empty-stack mode it
  // starts bare — pushing and popping our own marker brackets the run either
  // way without assuming which.
  const bottom = '⊥';
  const eps = App.config.sym.eps;
  if (!root || !root.startId) return null;

  const states = [], transitions = [], stackAlpha = new Set([bottom]);
  const idOf = new Map();        // "comp|state|phase" -> pda state id
  const returnFor = new Map();   // "comp|box"         -> its return symbol
  let n = 0, tn = 0, returnN = 0;
  const nid = () => 'p' + (++n);
  const tid = () => 'ct' + (++tn);

  const key = (comp, state, phase) => `${comp}|${state}|${phase}`;
  const place = (comp, state, phase, name, x, y) => {
    const id = nid();
    idOf.set(key(comp, state, phase), id);
    states.push({ id, x, y, name });
    return id;
  };

  // One row of PDA states per component, so the block structure survives the
  // translation and the diagram stays readable.
  let row = 0;
  for (const [cid, c] of tree.components) {
    let col = 0;
    for (const s of c.states) {
      const base = `${c.name}.${s.name}`;
      place(cid, s.id, 'enter', base, 140 + col * 170, 120 + row * 170);
      col++;
      if (s.callee) {
        // The "callee has returned" copy.
        place(cid, s.id, 'returned', `${base}↵`, 140 + col * 170, 120 + row * 170);
        col++;
      }
    }
    row++;
  }

  // A transition arriving at a box lands on its call site; one leaving a box
  // leaves from the returned copy.
  const arriveAt = (comp, stateId) => idOf.get(key(comp, stateId, 'enter'));
  const departFrom = (comp, c, stateId) => {
    const s = c.stateById.get(stateId);
    return idOf.get(key(comp, stateId, s && s.callee ? 'returned' : 'enter'));
  };

  for (const [cid, c] of tree.components) {
    for (const t of c.transitions) {
      const from = departFrom(cid, c, t.from);
      const to = arriveAt(cid, t.to);
      if (!from || !to) continue;
      transitions.push({ id: tid(), from, to, symbol: t.symbol, pop: eps, push: eps });
    }

    for (const s of c.states) {
      if (!s.callee) continue;
      const callee = tree.components.get(s.callee);
      if (!callee || !callee.startId) continue;
      const ret = returnSymbol(returnN++);   // this box's return address
      stackAlpha.add(ret);
      returnFor.set(`${cid}|${s.id}`, ret);

      const callFrom = idOf.get(key(cid, s.id, 'enter'));
      const calleeEntry = arriveAt(s.callee, callee.startId);
      if (callFrom && calleeEntry) {
        transitions.push({ id: tid(), from: callFrom, to: calleeEntry, symbol: eps, pop: eps, push: ret });
      }
      // Every exit of the callee returns here, popping this box's address.
      const backTo = idOf.get(key(cid, s.id, 'returned'));
      for (const exitId of callee.accepts) {
        const exitFrom = departFrom(s.callee, callee, exitId);
        if (exitFrom && backTo) {
          transitions.push({ id: tid(), from: exitFrom, to: backTo, symbol: eps, pop: ret, push: eps });
        }
      }
    }
  }

  // Bottom marker in, bottom marker out.
  const init = nid();
  states.push({ id: init, x: 20, y: 20, name: 'init' });
  const acc = nid();
  states.push({ id: acc, x: 20, y: 120 + row * 170, name: 'accept' });

  const rootEntry = arriveAt(tree.root, root.startId);
  if (rootEntry) transitions.push({ id: tid(), from: init, to: rootEntry, symbol: eps, pop: eps, push: bottom });
  for (const exitId of root.accepts) {
    const exitFrom = departFrom(tree.root, root, exitId);
    if (exitFrom) transitions.push({ id: tid(), from: exitFrom, to: acc, symbol: eps, pop: bottom, push: eps });
  }

  return {
    machine: 'NPDA',
    states, transitions,
    startId: init,
    accepts: [acc],
    sigma: [...App.sigma],
    stackAlpha: [...stackAlpha]
  };
}

// Navigation for the simulator. Unlike enterComponent this does NOT dedupe a
// repeated component, because during a run the repetition IS the information —
// and it announces nothing, since following the machine into a sub-machine is
// not an edit the user undoes or needs saved.
export function followSimFrames(frames) {
  if (!Array.isArray(frames) || !frames.length) return false;
  const target = frames[frames.length - 1];
  if (!getComponent(target)) return false;
  if (target === activeComponentId() && frames.length === App.componentPath.length) return false;
  flushActiveComponent();
  bindComponent(target, frames);
  return true;
}
