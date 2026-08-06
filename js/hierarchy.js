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
    components.set(c.id, {
      id: c.id,
      name: c.name,
      states: c.states || [],
      transitions: c.transitions || [],
      startId: c.startId || null,
      accepts: new Set(c.accepts || []),
      stateById: new Map((c.states || []).map(s => [s.id, s]))
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
  const steps = path.map(cfg => ({
    state: cfg.state,
    component: cfg.comp,
    // Component ids from the root down to the one currently executing. The
    // breadcrumb binds straight to this, so it doubles as a depth gauge:
    // Main > Expr > Expr is a machine two calls deep into itself.
    frames: [...cfg.stack.map(f => f.comp), cfg.comp],
    callStack: [...cfg.stack.map(f => tree.components.get(f.comp)?.name || '?'),
      tree.components.get(cfg.comp)?.name || '?'],
    tokens,
    remaining: tokens.slice(cfg.i),
    tid: cfg.via?.id,
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
