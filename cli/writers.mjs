// ══════════════════════════════════════════════════════════════════
//  ONE MACHINE, EVERY WAY OUT
// ══════════════════════════════════════════════════════════════════
// Every command that produces a machine ends here, so `--to` and the output
// file's extension mean the same thing everywhere. The app's own export
// registry (js/export-registry.js) supplies the diagram, table, code and test
// formats; they are built from the machine IR exactly as the export dialog
// builds them, with the target swapped in for the canvas's machine.

import { extname } from 'node:path';

import { App } from '../js/state.js';
import { ExportFormats } from '../js/export-registry.js';
import '../js/export-ui.js';
import '../js/codegen.js';
import { buildMachineIR } from '../js/export-core.js';
import { withMachine } from '../js/exercise/grade.js';
import { drawSketch, sketchAspect, sketchFromTarget } from '../js/library/sketch.js';
import { transLabel } from '../js/states-transitions.js';
import { writeStandardTM } from '../js/interop/standard-tm.js';
import { writeMachineCode } from '../js/interop/smtf.js';
import { CliError } from './errors.mjs';
import { docFromTarget, docText } from './io.mjs';
import { hoaText } from './formats/hoa.mjs';
import { baText, timbukText } from './formats/ba.mjs';
import { jffText } from './formats/jff.mjs';
import { standalone } from './figure.mjs';

const BY_EXT = {
  '.automaton': 'automaton', '.json': 'automaton',
  '.hoa': 'hoa', '.ba': 'ba', '.timbuk': 'timbuk', '.tmb': 'timbuk',
  '.jff': 'jff', '.txt': 'code', '.svg': 'svg',
  '.dot': 'dot', '.gv': 'dot', '.tex': 'tikz', '.csv': 'table-csv', '.md': 'table-md',
  '.js': 'code-js', '.py': 'code-py', '.java': 'code-java', '.c': 'code-c', '.scxml': 'code-scxml'
};

const OWN = ['automaton', 'hoa', 'ba', 'timbuk', 'jff', 'code', 'standard', 'svg'];

// The registry entries the command line offers. `batch` is the Batch Test
// panel's last run, which a terminal does not have (automata test is the
// same thing); `json` is the canvas's workspace, which here is `automaton`.
export function cliExportFormats() {
  return Object.keys(ExportFormats).filter(k => k !== 'batch' && k !== 'json');
}

export function formatNames() {
  return [...OWN, ...cliExportFormats()];
}

/** `--to` wins, then the output file's extension, then the default. */
export function formatFor(to, path, fallback = 'automaton') {
  if (to) {
    // The registry's "json" is the canvas's workspace; for a machine that
    // is our own document, which is what "automaton" writes.
    if (to === 'json' || to === 'automaton') return 'automaton';
    if (!formatNames().includes(to)) throw new CliError(`"${to}" is not a format. One of: ${formatNames().join(', ')}.`);
    return to;
  }
  if (path && path !== '-') {
    const ext = extname(path).toLowerCase();
    if (path.toLowerCase().endsWith('.test.js')) return 'test-jest';
    if (BY_EXT[ext]) return BY_EXT[ext];
  }
  return fallback;
}

/**
 * The option values an export format takes: its declared defaults, with
 * `key=value` overrides typed by the option's own type.
 */
export function exportOptions(key, overrides = []) {
  const spec = ExportFormats[key];
  const val = v => (typeof v === 'function' ? v() : v);
  const opts = {};
  for (const o of spec.options || []) opts[o.id] = val(o.def);
  for (const pair of overrides) {
    const eq = pair.indexOf('=');
    if (eq < 0) throw new CliError(`--opt takes key=value, not "${pair}".`);
    const k = pair.slice(0, eq), v = pair.slice(eq + 1);
    const o = (spec.options || []).find(x => x.id === k);
    if (!o) throw new CliError(`${key} has no option "${k}". Options: ${(spec.options || []).map(x => x.id).join(', ') || 'none'}.`);
    if (o.type === 'check') opts[k] = !/^(0|false|no|off)$/i.test(v);
    else if (o.type === 'number') opts[k] = Number(v);
    else if (o.type === 'select') {
      const choices = val(o.choices) || [];
      if (choices.length && !choices.some(([id]) => String(id) === v)) throw new CliError(`${key} ${k} is one of: ${choices.map(([id]) => id).join(', ')}.`);
      opts[k] = v;
    } else opts[k] = v;
  }
  return opts;
}

/** A target (and, when it came from a file, its document) → text in `format`. */
export function serialize(target, format, { doc = null, opts = [], name = null, theme = null, warn = () => {} } = {}) {
  const sym = { ...App.config.sym, ...(target.config?.sym || {}) };
  if (format === 'json') format = 'automaton';
  if (format === 'batch') throw new CliError('The batch format is the Batch Test panel\'s last run; from the command line that is automata test <machine> <words-file>.');
  switch (format) {
    case 'automaton': return docText(doc || docFromTarget(target));
    case 'hoa': return hoaText(target, { name, warn });
    case 'ba': return baText(target, { warn });
    case 'timbuk': return timbukText(target);
    case 'jff': return jffText(target, { warn });
    case 'code': {
      // The document is written in its own symbols; a target from elsewhere
      // is already in the standard ones (io.mjs withDefaultSymbols).
      const codeSym = doc ? { ...App.config.sym, ...(doc.config?.sym || {}) } : sym;
      const { code } = writeMachineCode(doc || docFromTarget(target), { sym: codeSym });
      return code + '\n';
    }
    case 'standard': {
      const s = writeStandardTM(target, sym);
      if (!s) throw new CliError('Only a one-tape Turing machine over the digits, with L/R moves and one halt, has a standard-notation string.');
      return s + '\n';
    }
    case 'svg': {
      // The sketch is drawn with classes; a file has no page to style it, so
      // the rules come with it.
      const placed = doc ? { ...target, states: doc.states } : { ...target, states: docFromTarget(target).states };
      return standalone(diagramSvg(placed), { theme: theme || 'light' }) + '\n';
    }
    default: {
      const spec = ExportFormats[format];
      if (!spec) throw new CliError(`"${format}" is not a format.`);
      const placed = doc || docFromTarget(target);
      const withPositions = { ...target, states: placed.states };
      return withMachine(withPositions, () => {
        if (spec.available && !spec.available()) throw new CliError(spec.unavailableNote || `${format} is not available for this machine.`);
        const ir = buildMachineIR();
        const out = spec.build(ir, exportOptions(format, opts));
        // In the dialog a refusal is a file you can read; on the command line a
        // "file" that only says it could not be written is a failure, and has
        // to exit as one rather than land in a build as generated code.
        const refused = /^\s*(\/\/|#|\/\*|<!--) Cannot generate code for this machine\.\n/.exec(out);
        if (refused) {
          const marker = refused[1];
          const reason = out.split('\n').slice(2).map(l => l.replace(marker, '').replace(/-->\s*$/, '').trim()).filter(Boolean).join(' ')
            // The app's advice names a menu; here the same step is a command.
            .replace(/Run Algorithms › NFA → DFA \(subset construction\) first, then export the result\./, 'Determinize it first: automata determinize <machine> | automata codegen - …');
          throw new CliError(`${spec.label} cannot be generated for this machine: ${reason}`);
        }
        return out.endsWith('\n') ? out : out + '\n';
      });
    }
  }
}

/**
 * The machine drawn to be read on its own: names in the states, and every
 * edge labelled the way the canvas labels it — each transition on its own line,
 * uncut — up to the size where labels would only overprint each other.
 */
export function diagramSvg(target, { w = 720 } = {}) {
  const labels = withMachine(target, () => new Map(target.transitions.map(t => [t.id, transLabel(t)])));
  const sk = sketchFromTarget(target, t => labels.get(t.id));
  const h = Math.round(w / sketchAspect(sk));
  const readable = sk.nodes.length <= 30 && sk.edges.length <= 80;
  return drawSketch(sk, { w, h, names: true, labels: readable, stacked: true });
}
