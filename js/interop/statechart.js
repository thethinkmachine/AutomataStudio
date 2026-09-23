// ══════════════════════════════════════════════════════════════════
//  STATECHARTS IN — XState and SCXML, flattened to a machine
// ══════════════════════════════════════════════════════════════════
// The export side has existed for a while (codegenXState / codegenSCXML in
// js/codegen.js); this is the way back, and the way in for a statechart
// someone wrote for a real application.
//
// Import-free: the two readers above it are, and the symbol table comes in
// as an argument. The UI half — clearing the canvas, loading the result,
// writing the caveats to the machine card — is js/import-statechart.js, the
// same split js/import-jflap.js makes between reading and placing.
//
// A statechart is a *hierarchical* machine and this app's machines are flat,
// so the heart of this is flattening, and it has one rule per statechart
// feature:
//
//   compound state   Entering it enters its initial child, recursively, so
//                    the flat machine has a state per *leaf*, named by its
//                    path (`active.loading`).
//   inherited `on`   A leaf handles an event if it or any ancestor does, and
//                    the deepest handler wins — XState's and SCXML's rule —
//                    so each leaf gets its own copy of every ancestor edge it
//                    does not override.
//   final state      An accepting state. `meta.accepting` (what
//                    codegenXState writes), an `accepting` tag, or SCXML's
//                    <data id="accepting"> (what codegenSCXML writes) also
//                    mark one, since a statechart has no acceptance of its own.
//   outputs          `{type: 'emit', params: {output}}` on a transition makes
//                    a Mealy machine and `meta.output` / <onentry><log
//                    label="output"> a Moore one — again the conventions the
//                    exporters use, so an export comes back as itself.
//   guards           Not evaluated: they are code. Two guarded edges on one
//                    event become a nondeterministic choice, and the result
//                    is an NFA — said in a warning, never done silently.
//   eventless        `always` / an SCXML <transition> with no event becomes an
//                    ε-edge. Not identical — a statechart takes an eventless
//                    transition eagerly, an ε-NFA may take it — and said so.
//   parallel         Refused. Orthogonal regions are a product of machines;
//                    flattening one silently would multiply the state count
//                    behind the reader's back.
//   delays, invokes, history, actions other than output
//                    Dropped, each with a warning naming what was dropped.
//
// Nothing here throws for a caveat. It throws StatechartError for a file it
// cannot turn into a machine at all, with a sentence the status bar can show.

import { extractMachineLiteral, LiteralError } from './objlit.js';
import { parseXml, XmlError } from './xml.js';

export class StatechartError extends Error {}

// ── the neutral tree ──────────────────────────────────────────────
// { key, id, kind: 'atomic'|'compound'|'parallel'|'final'|'history',
//   initial, children, parent, transitions: [{ events | null, targets,
//   guarded, output }], accepting, output }

function node(key, parent) {
  return { key, id: null, kind: 'atomic', initial: null, children: [], parent, transitions: [], accepting: false, output: null };
}

function pathOf(n) {
  const parts = [];
  for (let c = n; c && c.parent; c = c.parent) parts.unshift(c.key);
  return parts;
}

// ── XState ────────────────────────────────────────────────────────

const isExpr = v => v && typeof v === 'object' && !Array.isArray(v) && '__expr' in v;

function asArray(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }

function xstateOutputOf(actions, note) {
  let output = null;
  asArray(actions).forEach(a => {
    if (a && typeof a === 'object' && !isExpr(a) && a.type === 'emit' && a.params && a.params.output !== undefined) {
      output = String(a.params.output);
    } else note('actions');
  });
  return output;
}

function xstateTransitions(spec, events, note) {
  return asArray(spec).map(s => {
    if (typeof s === 'string') return { events, targets: [s], guarded: false, output: null };
    if (!s || typeof s !== 'object' || isExpr(s)) { note('expressions'); return null; }
    const guarded = !!(s.guard || s.cond || s.in);
    if (guarded) note('guards');
    const targets = asArray(s.target).filter(t => typeof t === 'string');
    return { events, targets, guarded, output: xstateOutputOf(s.actions, note) };
  }).filter(Boolean);
}

function xstateNode(key, def, parent, note) {
  const n = node(key, parent);
  if (!def || typeof def !== 'object' || isExpr(def)) return n;
  if (typeof def.id === 'string') n.id = def.id;
  const childDefs = def.states && typeof def.states === 'object' && !isExpr(def.states) ? def.states : {};
  const childKeys = Object.keys(childDefs);
  n.kind = def.type === 'parallel' ? 'parallel'
    : def.type === 'final' ? 'final'
      : def.type === 'history' ? 'history'
        : childKeys.length ? 'compound' : 'atomic';
  if (typeof def.initial === 'string') n.initial = def.initial;
  else if (def.initial && typeof def.initial === 'object' && typeof def.initial.target === 'string') n.initial = def.initial.target;
  if (typeof n.initial === 'string' && n.initial.startsWith('.')) n.initial = n.initial.slice(1);
  n.children = childKeys.map(k => xstateNode(k, childDefs[k], n, note));

  const on = def.on;
  if (Array.isArray(on)) {
    // XState v4's array form: [{ event, target, … }].
    on.forEach(t => { if (t && typeof t.event === 'string') n.transitions.push(...xstateTransitions(t, [t.event], note)); });
  } else if (on && typeof on === 'object' && !isExpr(on)) {
    Object.entries(on).forEach(([ev, spec]) => {
      const events = [ev === '' ? null : ev];
      n.transitions.push(...xstateTransitions(spec, ev === '' ? null : events, note));
    });
  }
  if (def.always) n.transitions.push(...xstateTransitions(def.always, null, note));
  if (def.after) note('delays');
  if (def.invoke || def.onDone || def.onError) note('invocations');
  if (def.entry || def.exit) note('actions');

  const meta = def.meta && typeof def.meta === 'object' && !isExpr(def.meta) ? def.meta : {};
  const tags = asArray(def.tags).filter(t => typeof t === 'string');
  n.accepting = n.kind === 'final' || meta.accepting === true || tags.includes('accepting') || tags.includes('accept');
  if (meta.output !== undefined && meta.output !== null && typeof meta.output !== 'object') n.output = String(meta.output);
  return n;
}

function xstateResolver(root) {
  const byId = new Map();
  const walk = n => { if (n.id) byId.set(n.id, n); n.children.forEach(walk); };
  walk(root);
  const down = (from, parts, raw) => {
    let cur = from;
    for (const p of parts) {
      cur = cur.children.find(c => c.key === p);
      if (!cur) throw new StatechartError(`The target "${raw}" names a state that does not exist.`);
    }
    return cur;
  };
  return (source, raw) => {
    if (raw.startsWith('#')) {
      const [id, ...rest] = raw.slice(1).split('.');
      const base = byId.get(id);
      if (!base) throw new StatechartError(`The target "${raw}" names an id no state has.`);
      return down(base, rest, raw);
    }
    if (raw.startsWith('.')) return down(source, raw.slice(1).split('.'), raw);
    return down(source.parent || root, raw.split('.'), raw);
  };
}

export function xstateToChart(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new StatechartError('An XState machine config is an object with `states`.');
  }
  const notes = new Set();
  const root = xstateNode('(machine)', config, null, k => notes.add(k));
  root.id = root.id || (typeof config.id === 'string' ? config.id : null);
  return { root, resolve: xstateResolver(root), notes, title: typeof config.id === 'string' ? config.id : null };
}

export function readXStateText(text) {
  let config;
  try { config = extractMachineLiteral(text); }
  catch (e) {
    if (e instanceof LiteralError) throw new StatechartError(`Could not read the XState machine: ${e.message}.`);
    throw e;
  }
  return xstateToChart(config);
}

// ── SCXML ─────────────────────────────────────────────────────────

const STATE_ELEMENTS = new Set(['state', 'parallel', 'final', 'history']);

function unquoteExpr(expr) {
  const s = String(expr || '').trim();
  if (/^(".*"|'.*')$/s.test(s)) {
    try { return JSON.parse(s[0] === "'" ? '"' + s.slice(1, -1).replace(/"/g, '\\"') + '"' : s); }
    catch { return s.slice(1, -1); }
  }
  return s;
}

function outputLog(el) {
  const log = el.children.find(c => c.local === 'log' && c.attrs.label === 'output');
  return log ? unquoteExpr(log.attrs.expr) : null;
}

function scxmlNode(el, parent, note, counter) {
  const key = el.attrs.id || `_state${++counter.n}`;
  const n = node(key, parent);
  n.id = key;
  const kids = el.children.filter(c => STATE_ELEMENTS.has(c.local));
  n.kind = el.local === 'parallel' ? 'parallel'
    : el.local === 'final' ? 'final'
      : el.local === 'history' ? 'history'
        : kids.length ? 'compound' : 'atomic';
  n.children = kids.map(c => scxmlNode(c, n, note, counter));
  const initAttr = el.attrs.initial;
  const initEl = el.children.find(c => c.local === 'initial');
  const initTarget = initAttr || initEl?.children.find(c => c.local === 'transition')?.attrs.target;
  if (initTarget) n.initial = initTarget.trim().split(/\s+/)[0];

  el.children.filter(c => c.local === 'transition').forEach(t => {
    const events = t.attrs.event ? t.attrs.event.trim().split(/\s+/).map(e => e.replace(/\.\*$/, '')) : null;
    const guarded = !!t.attrs.cond;
    if (guarded) note('guards');
    const targets = t.attrs.target ? t.attrs.target.trim().split(/\s+/) : [];
    const output = outputLog(t);
    if (t.children.some(c => !(c.local === 'log' && c.attrs.label === 'output'))) note('actions');
    n.transitions.push({ events, targets, guarded, output });
  });
  const onentry = el.children.find(c => c.local === 'onentry');
  if (onentry) {
    n.output = outputLog(onentry);
    if (onentry.children.some(c => !(c.local === 'log' && c.attrs.label === 'output'))) note('actions');
  }
  if (el.children.some(c => c.local === 'onexit' || c.local === 'invoke')) note(el.children.some(c => c.local === 'invoke') ? 'invocations' : 'actions');
  const accepting = el.children.some(c => c.local === 'datamodel'
    && c.children.some(d => d.local === 'data' && d.attrs.id === 'accepting' && /^\s*true\s*$/.test(d.attrs.expr || d.text)));
  n.accepting = n.kind === 'final' || accepting;
  return n;
}

export function scxmlToChart(doc) {
  if (doc.local !== 'scxml') throw new StatechartError(`The root element is <${doc.name}>, not <scxml>.`);
  const notes = new Set();
  const note = k => notes.add(k);
  const root = node('(machine)', null);
  root.kind = 'compound';
  const counter = { n: 0 };
  root.children = doc.children.filter(c => STATE_ELEMENTS.has(c.local)).map(c => scxmlNode(c, root, note, counter));
  if (doc.attrs.initial) root.initial = doc.attrs.initial.trim().split(/\s+/)[0];
  if (doc.children.some(c => c.local === 'script')) note('scripts');
  const byId = new Map();
  const walk = n => { if (n.parent) byId.set(n.id, n); n.children.forEach(walk); };
  walk(root);
  const resolve = (_source, raw) => {
    const t = byId.get(raw);
    if (!t) throw new StatechartError(`The target "${raw}" names a state that does not exist.`);
    return t;
  };
  // SCXML's initial names an id anywhere below; turn it into a child key.
  const fixInitial = n => {
    if (n.initial && !n.children.some(c => c.key === n.initial) && byId.has(n.initial)) {
      let t = byId.get(n.initial);
      while (t && t.parent !== n) t = t.parent;
      n.initialDeep = byId.get(n.initial);
      n.initial = t ? t.key : null;
    }
    n.children.forEach(fixInitial);
  };
  fixInitial(root);
  return { root, resolve, notes, title: doc.attrs.name || null };
}

export function readSCXMLText(text) {
  let doc;
  try { doc = parseXml(text); }
  catch (e) {
    if (e instanceof XmlError) throw new StatechartError(`Could not read the SCXML: ${e.message}.`);
    throw e;
  }
  return scxmlToChart(doc);
}

// ── flattening ────────────────────────────────────────────────────

const NOTE_TEXT = {
  guards: 'Guards (cond/guard) were not evaluated — they are code. Edges they chose between are all kept, so the machine may be nondeterministic.',
  actions: 'Actions other than output were dropped.',
  expressions: 'Some transitions were written as code rather than as data and were skipped.',
  delays: 'Delayed transitions (after) were dropped: a machine here reads symbols, not time.',
  invocations: 'Invoked services and their done/error transitions were dropped.',
  scripts: 'Scripts were ignored.'
};

/**
 * A chart → the fields loadData() reads, plus `warnings`.
 * `sym` is App.config.sym: ε and the Σ wildcard are spelled per reader.
 */
export function flattenChart(chart, sym) {
  const { root, resolve } = chart;
  const warnings = [];
  const note = s => { if (!warnings.includes(s)) warnings.push(s); };

  const all = [];
  const walk = n => { all.push(n); n.children.forEach(walk); };
  walk(root);
  const parallel = all.find(n => n.kind === 'parallel');
  if (parallel) {
    throw new StatechartError(`"${pathOf(parallel).join('.') || 'The machine'}" is a parallel state. Orthogonal regions are a product of machines, which this import does not build — split the regions into separate machines, or flatten them by hand.`);
  }
  if (all.some(n => n.kind === 'history')) note('History states were read as their parent\'s initial state.');

  const leafOf = n => {
    let cur = n;
    const seen = new Set();
    while (cur.kind === 'compound' || cur.kind === 'history') {
      if (seen.has(cur)) throw new StatechartError('An initial state refers back to itself.');
      seen.add(cur);
      if (cur.kind === 'history') { cur = cur.parent; continue; }
      if (cur.initialDeep) { cur = cur.initialDeep; continue; }
      const next = cur.initial ? cur.children.find(c => c.key === cur.initial) : cur.children.find(c => c.kind !== 'history');
      if (!next) throw new StatechartError(`"${pathOf(cur).join('.') || 'The machine'}" names an initial state "${cur.initial}" it does not contain.`);
      cur = next;
    }
    return cur;
  };

  const leaves = all.filter(n => n !== root && (n.kind === 'atomic' || n.kind === 'final'));
  if (root.kind === 'atomic') leaves.push(root);
  if (!leaves.length) throw new StatechartError('The statechart has no states.');

  // Names: the dotted path, made unique and readable.
  const names = new Map();
  const taken = new Set();
  leaves.forEach(l => {
    let name = pathOf(l).join('.') || chart.title || 'q0';
    const base = name;
    let i = 2;
    while (taken.has(name)) name = `${base}_${i++}`;
    taken.add(name);
    names.set(l, name);
  });

  const symbolFor = new Map();
  const sigma = [];
  const symbolOf = ev => {
    if (ev === '*') return sym.any;
    if (symbolFor.has(ev)) return symbolFor.get(ev);
    let s = ev.replace(/[\s,]+/g, '_');
    if (s !== ev) note(`Event names cannot contain spaces or commas here, so "${ev}" became "${s}".`);
    if (s === sym.eps || s === sym.any) { s = `${s}_event`; }
    symbolFor.set(ev, s);
    if (!sigma.includes(s)) sigma.push(s);
    return s;
  };

  const ids = new Map(leaves.map((l, i) => [l, 's' + (i + 1)]));
  const transitions = [];
  let eventless = false, guardedChoice = false;
  leaves.forEach(leaf => {
    // Reaching a top-level final state ends the whole machine: no handler
    // anywhere above it runs again. A nested one only ends its parent's
    // region, and the ancestors' edges still apply.
    if (leaf.kind === 'final' && leaf.parent === root) return;
    const handled = new Set();
    let eventlessHandled = false;
    for (let level = leaf; level; level = level.parent) {
      const byEvent = new Map();
      level.transitions.forEach(t => {
        (t.events || [null]).forEach(ev => {
          const k = ev === null ? '\u0000' : ev;
          if (!byEvent.has(k)) byEvent.set(k, []);
          byEvent.get(k).push(t);
        });
      });
      byEvent.forEach((ts, k) => {
        const isEventless = k === '\u0000';
        if (isEventless ? eventlessHandled : handled.has(k)) return;
        if (isEventless) eventlessHandled = true; else handled.add(k);
        if (ts.length > 1) guardedChoice = true;
        ts.forEach(t => {
          if (t.targets.length > 1) throw new StatechartError(`A transition in "${pathOf(level).join('.') || 'the machine'}" has several targets, which only a parallel state can have.`);
          const to = t.targets.length ? leafOf(resolve(level, t.targets[0])) : leaf;
          const symbol = isEventless ? sym.eps : symbolOf(k);
          if (isEventless) eventless = true;
          transitions.push({ id: 't' + (transitions.length + 1), from: ids.get(leaf), to: ids.get(to), symbol, output: t.output });
        });
      });
    }
  });

  chart.notes.forEach(k => { if (NOTE_TEXT[k]) note(NOTE_TEXT[k]); });
  if (eventless) note('Eventless transitions (always / no event) became ε-moves. A statechart takes them at once; an ε-NFA only may.');

  const startLeaf = leafOf(root);
  const hasTransOut = transitions.some(t => t.output != null);
  const hasStateOut = leaves.some(l => l.output != null);
  const deterministic = !eventless && !transitions.some((t, i) => transitions.some((u, j) => j < i && u.from === t.from && u.symbol === t.symbol));
  let machine;
  if (hasTransOut && deterministic) machine = 'Mealy';
  else if (hasStateOut && !hasTransOut && deterministic) machine = 'Moore';
  else machine = eventless ? 'ε-NFA' : deterministic ? 'DFA' : 'NFA';
  if ((hasTransOut || hasStateOut) && !deterministic) note('The outputs were dropped: a Mealy or Moore machine has to be deterministic, and this one is not.');
  if (hasTransOut && hasStateOut && machine === 'Mealy') note('Both states and transitions carried output; the state outputs were dropped.');
  if (guardedChoice && !deterministic) note('Where one event led to several guarded targets, every target was kept.');

  // A layered layout: columns by distance from the start state.
  const depth = new Map([[ids.get(startLeaf), 0]]);
  const queue = [ids.get(startLeaf)];
  for (let h = 0; h < queue.length; h++) {
    transitions.filter(t => t.from === queue[h]).forEach(t => {
      if (!depth.has(t.to)) { depth.set(t.to, depth.get(queue[h]) + 1); queue.push(t.to); }
    });
  }
  const maxDepth = Math.max(0, ...depth.values());
  const rowAt = new Map();
  const states = leaves.map(l => {
    const id = ids.get(l);
    const d = depth.has(id) ? depth.get(id) : maxDepth + 1;
    const row = rowAt.get(d) || 0;
    rowAt.set(d, row + 1);
    const s = { id, name: names.get(l), x: 140 + d * 200, y: 140 + row * 130 };
    if (machine === 'Moore') s.output = l.output ?? '';
    return s;
  });
  if (machine !== 'Mealy') transitions.forEach(t => { delete t.output; });
  else transitions.forEach(t => { if (t.output == null) t.output = ''; });
  const outputs = new Set();
  if (machine === 'Mealy') transitions.forEach(t => { if (t.output) outputs.add(t.output); });
  if (machine === 'Moore') states.forEach(s => { if (s.output) outputs.add(s.output); });

  return {
    machine,
    sigma,
    outputAlpha: outputs.size ? [...outputs] : undefined,
    states,
    transitions,
    startId: ids.get(startLeaf),
    accepts: leaves.filter(l => l.accepting).map(l => ids.get(l)),
    warnings,
    title: chart.title
  };
}

/** Which statechart a filename or a JSON document is, or null. */
export function statechartKindOf(name, text) {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.scxml')) return 'scxml';
  if (/\.(m?js|ts|mts|cjs)$/.test(lower)) return 'xstate';
  if (lower.endsWith('.json')) {
    try {
      const d = JSON.parse(text);
      // Ours carries `format`; an XState config carries `states` and no
      // `format`, and never this app's `transitions` array.
      if (d && typeof d === 'object' && !d.format && d.states && !Array.isArray(d.states) && !Array.isArray(d.transitions)) return 'xstate';
    } catch { /* not JSON at all: the workspace reader will say so */ }
  }
  return null;
}

/** File text → the loadData fields. Throws StatechartError. */
export function readStatechart(kind, text, sym) {
  const chart = kind === 'scxml' ? readSCXMLText(text) : readXStateText(text);
  return flattenChart(chart, sym);
}
