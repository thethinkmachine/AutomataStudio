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
import { namedDiagram } from '../js/library/analyze.js';
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

export function formatNames() {
  return [...OWN, ...Object.keys(ExportFormats)];
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
export function serialize(target, format, { doc = null, opts = [], name = null, theme = null } = {}) {
  const sym = { ...App.config.sym, ...(target.config?.sym || {}) };
  switch (format) {
    case 'automaton': return docText(doc || docFromTarget(target));
    case 'hoa': return hoaText(target, { name });
    case 'ba': return baText(target);
    case 'timbuk': return timbukText(target);
    case 'jff': return jffText(target);
    case 'code': {
      const { code } = writeMachineCode(doc || docFromTarget(target), { sym });
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
      return standalone(namedDiagram(placed, { w: 720 }).svg, { theme: theme || 'light' }) + '\n';
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
        return out.endsWith('\n') ? out : out + '\n';
      });
    }
  }
}
