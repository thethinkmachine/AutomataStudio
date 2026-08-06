import { commit, snapshot } from './history.js';
import { $, App, activeComponentId, bindComponent, ensureRootComponent, flushActiveComponent, getComponent, newComponentId } from './state.js';
import { Change, emit, subscribe } from './store.js';
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

// Every box pointing at a component, across the whole tree — the question
// "is anything still calling this?" has to look past the component on canvas.
export function callSites(componentId) {
  const out = [];
  for (const c of App.components) {
    const states = c.id === activeComponentId() ? App.states : (c.states || []);
    for (const s of states) if (s.callee === componentId) out.push({ component: c, state: s });
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
