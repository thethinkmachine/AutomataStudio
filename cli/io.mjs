// ══════════════════════════════════════════════════════════════════
//  MACHINES IN, MACHINES OUT
// ══════════════════════════════════════════════════════════════════
// Every command takes a machine the same way and every command that makes one
// writes it the same way, so a machine can travel down a pipe:
//
//     automata from-regex '(a|b)*abb' | automata minimize - | automata export - -f code-c
//
// A machine spec is one of:
//
//   path.automaton | path.json     the app's own document
//   path.jff                       JFLAP
//   path.scxml | path.js | …       a statechart (XState or SCXML)
//   path.hoa                       Hanoi Omega-Automata
//   path.ba | path.timbuk          RABIT/GOAL Büchi, Timbuk tree/word automata
//   -                              standard input, recognised by its content
//   1RB1LB_1LA1RZ                  a Turing machine in the standard notation
//   fa.01:+AB_BA                   a machine code (js/interop/smtf.js)
//
// What comes back is always the same pair: `doc`, the document as the app
// would save it, and `target`, the grader's shape the analysis functions take
// (js/library/analyze.js targetFromDoc). Readers hand back the loadData shape
// with no positions; `withLayout` gives a document positions before it is
// written, so a machine a command made opens as a drawing rather than a pile.

import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';

import { App, APP_VERSION } from '../js/state.js';
import { SCHEMA_VERSION, WORKSPACE_FORMAT, migrateWorkspaceDoc, validateSchema } from '../js/persistence.js';
import { targetFromDoc } from '../js/library/analyze.js';
import { readJFLAPText } from '../js/import-jflap.js';
import { readStandardTM, standardTMText } from '../js/interop/standard-tm.js';
import { machineCodeText, readMachineCode } from '../js/interop/smtf.js';
import { readStatechart, statechartKindOf } from '../js/interop/statechart.js';
import { CliError } from './errors.mjs';
import { hoaText, readHOA } from './formats/hoa.mjs';
import { readBA, readTimbuk } from './formats/ba.mjs';

let stdinCache = null;

/** All of standard input, once — a pipe can only be read one time. */
export function readStdin() {
  if (stdinCache !== null) return stdinCache;
  try {
    stdinCache = readFileSync(0, 'utf8');
  } catch (e) {
    if (e.code === 'EAGAIN' || e.code === 'EOF') stdinCache = '';
    else throw e;
  }
  return stdinCache;
}

/** A spec is a file when it names one; `-` is standard input. */
export function readSpecText(spec) {
  if (spec === '-') return { text: readStdin(), name: '<stdin>' };
  if (isFile(spec)) return { text: readFileSync(spec, 'utf8'), name: spec };
  return null;
}

export function isFile(p) {
  try { return existsSync(p) && statSync(p).isFile(); } catch { return false; }
}

const sym = () => App.config.sym;

/**
 * A spec → `{ doc, target, name, warnings }`. Throws CliError with a sentence
 * the terminal can show.
 */
export function readMachine(spec) {
  if (spec == null || spec === '') throw new CliError('No machine given.');
  const file = readSpecText(spec);
  if (!file) {
    // Not a file: an inline code, or a typo in a path.
    const doc = readInline(spec);
    if (doc) return finish(doc, spec);
    throw new CliError(`${spec}: no such file, and not a machine code or a Turing machine in the standard notation.`);
  }
  return finish(parseText(file.text, file.name), file.name);
}

/** Text recognised by its name first and its content second. */
export function parseText(text, name = '') {
  const ext = extname(name).toLowerCase();
  const trimmed = text.trim();
  try {
    if (ext === '.jff') return readJFLAPText(text);
    if (ext === '.hoa' || /^HOA:/.test(trimmed)) return readHOA(text, sym());
    if (ext === '.ba') return readBA(text, sym());
    if (ext === '.timbuk' || /^Ops\b/.test(trimmed)) return readTimbuk(text, sym());
    const chart = statechartKindOf(name, text);
    if (chart) return readStatechart(chart, text, sym());
    if (trimmed.startsWith('{')) {
      const doc = JSON.parse(trimmed);
      if (doc && !doc.format && doc.states && !Array.isArray(doc.states)) return readStatechart('xstate', text, sym());
      return doc;
    }
    if (trimmed.startsWith('<')) {
      if (/<scxml[\s>]/.test(trimmed)) return readStatechart('scxml', text, sym());
      return readJFLAPText(text);
    }
    const inline = readInline(trimmed);
    if (inline) return inline;
  } catch (e) {
    throw new CliError(`${name || 'input'}: ${e.message}`);
  }
  throw new CliError(`${name || 'input'}: not a machine this reads — a .automaton/.json document, .jff, .scxml, XState, HOA, BA, Timbuk, a machine code or a standard-notation Turing machine.`);
}

/** A one-line machine: the standard TM notation, or a machine code. */
export function readInline(text) {
  const src = String(text).trim();
  if (!src || /\s/.test(src)) return null;
  if (standardTMText(src) && !src.includes(':')) return readStandardTM(src, sym());
  if (machineCodeText(src)) return readMachineCode(src, { sym: sym() });
  return null;
}

function finish(raw, name) {
  let doc = raw;
  const warnings = [...(raw.warnings || [])];
  try {
    if (!doc.format) doc = { format: WORKSPACE_FORMAT, schema: SCHEMA_VERSION, app: APP_VERSION, config: {}, ...doc };
    validateSchema(doc);
    doc = migrateWorkspaceDoc(doc);
  } catch (e) {
    throw new CliError(`${name}: ${e.message}`);
  }
  const target = targetFromDoc(doc);
  if (!target.states.length) throw new CliError(`${name}: the machine has no states.`);
  return { doc, target, name, warnings };
}

// ── Writing ───────────────────────────────────────────────────────

/**
 * A target → the document the app saves, laid out if it has no positions.
 * `extra` rides along (meta, exercise, …).
 */
export function docFromTarget(target, extra = {}) {
  const doc = {
    format: WORKSPACE_FORMAT,
    schema: SCHEMA_VERSION,
    app: APP_VERSION,
    machine: target.machine,
    config: { ...(target.config || {}), sym: { ...sym(), ...(target.config?.sym || {}) } },
    sigma: [...(target.sigma || [])],
    stackAlpha: [...(target.stackAlpha || [])],
    outputAlpha: [...(target.outputAlpha || [])],
    tapeCount: target.tapeCount || 1,
    states: target.states.map(s => ({ ...s })),
    transitions: target.transitions.map(t => ({ ...t })),
    startId: target.startId,
    accepts: [...(target.accepts || [])],
    blocks: JSON.parse(JSON.stringify(target.blocks || [])),
    ...extra
  };
  return withLayout(doc);
}

/**
 * Positions for a machine that has none: layered by breadth-first distance
 * from the start, the way a reader would draw it on paper. States the start
 * cannot reach go in a last column. Coordinates already present are kept.
 */
export function withLayout(doc) {
  const states = doc.states || [];
  if (!states.length || states.every(s => Number.isFinite(s.x) && Number.isFinite(s.y))) return doc;
  const out = new Map(states.map(s => [s.id, []]));
  for (const t of doc.transitions || []) out.get(t.from)?.push(t.to);
  const depth = new Map();
  const queue = doc.startId && out.has(doc.startId) ? [doc.startId] : [];
  if (queue.length) depth.set(doc.startId, 0);
  for (let h = 0; h < queue.length; h++) {
    for (const to of out.get(queue[h]) || []) {
      if (!depth.has(to) && out.has(to)) { depth.set(to, depth.get(queue[h]) + 1); queue.push(to); }
    }
  }
  const maxDepth = Math.max(0, ...depth.values());
  const columns = new Map();
  for (const s of states) {
    const d = depth.has(s.id) ? depth.get(s.id) : maxDepth + 1;
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d).push(s);
  }
  const tallest = Math.max(...[...columns.values()].map(c => c.length));
  for (const [d, col] of columns) {
    col.forEach((s, i) => {
      if (Number.isFinite(s.x) && Number.isFinite(s.y)) return;
      s.x = 120 + d * 180;
      s.y = 120 + (i - (col.length - 1) / 2) * 130 + ((tallest - 1) / 2) * 130;
    });
  }
  return doc;
}

/** A document as file text. */
export function docText(doc) {
  return JSON.stringify(doc, null, 2) + '\n';
}

/** Write text to `path`, or to standard output when there is none (or it is `-`). */
export function emit(text, path) {
  if (!path || path === '-') {
    process.stdout.write(text.endsWith('\n') ? text : text + '\n');
    return;
  }
  writeFileSync(path, text);
}

export { CliError, hoaText };
