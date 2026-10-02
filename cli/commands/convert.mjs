// convert, export, codegen, svg — every way a machine leaves.
import { ExportFormats } from '../../js/export-registry.js';
import { readMachine, emit, CliError } from '../io.mjs';
import { cliExportFormats, exportOptions, formatFor, formatNames, serialize } from '../writers.mjs';
import { determinize, epsilonFree, minimize } from '../fa.mjs';
import { print, printJson, table, warn, c } from '../out.mjs';

const convert = {
  usage: `automata convert <machine> [-o out.ext] [--to format]

Reads any machine the CLI reads and writes it in the format --to names, or the
one -o's extension implies, or as an .automaton document on standard output.

  Formats: automaton, jff, hoa, ba, code (machine code), standard (TM
  notation), svg, and every export format (automata export --list).

  --determinize, --minimize, --eps-elim   transform on the way (finite automata)
  --opt key=value                          options for an export format`,
  options: {
    output: { type: 'string', short: 'o' },
    to: { type: 'string', short: 't' },
    determinize: { type: 'boolean' },
    minimize: { type: 'boolean' },
    'eps-elim': { type: 'boolean' },
    opt: { type: 'string', multiple: true }
  },
  async run({ args, opts }) {
    const { target, doc, warnings } = readMachine(args[0] ?? '-');
    if (!opts.quiet) warnings.forEach(warn);
    let t = target;
    let d = doc;
    if (opts['eps-elim']) { t = epsilonFree(t); d = null; }
    if (opts.determinize) { t = determinize(t); d = null; }
    if (opts.minimize) { t = minimize(t); d = null; }
    const format = formatFor(opts.to, opts.output);
    emit(serialize(t, format, { doc: d, opts: opts.opt || [], name: doc?.meta?.title || null, warn: opts.quiet ? () => {} : warn }), opts.output);
    return 0;
  }
};

const exportCmd = {
  usage: `automata export <machine> -f <format> [--opt key=value ...] [-o file]
       automata export --list

The app's export dialog, from the command line: the same formats, the same
options, the same output.`,
  options: {
    format: { type: 'string', short: 'f' },
    output: { type: 'string', short: 'o' },
    opt: { type: 'string', multiple: true },
    list: { type: 'boolean' }
  },
  async run({ args, opts }) {
    if (opts.list) {
      const listed = Object.entries(ExportFormats).filter(([k]) => cliExportFormats().includes(k));
      const rows = listed.map(([k, f]) => [k, f.label, c.dim((f.options || []).map(o => {
        const choices = typeof o.choices === 'function' ? null : o.choices;
        return choices ? `${o.id}=${choices.map(x => x[0]).join('|')}` : `${o.id}=${o.type === 'check' ? 'true|false' : o.type}`;
      }).join('  '))]);
      if (opts.json) printJson(Object.fromEntries(listed.map(([k, f]) => [k, { label: f.label, group: f.group, ext: f.ext, options: (f.options || []).map(o => o.id) }])));
      else print(table(rows, { head: ['format', 'what', 'options'] }));
      return 0;
    }
    const { target, doc } = readMachine(args[0] ?? '-');
    const format = opts.format || formatFor(null, opts.output, null);
    if (!format) throw new CliError('Say which format with -f (automata export --list), or give -o a file with a known extension.');
    if (!formatNames().includes(format) && format !== 'json' && format !== 'batch') throw new CliError(`"${format}" is not a format. See automata export --list.`);
    emit(serialize(target, format, { doc, opts: opts.opt || [] }), opts.output);
    return 0;
  }
};

const LANGS = { js: 'code-js', javascript: 'code-js', py: 'code-py', python: 'code-py', java: 'code-java', c: 'code-c', xstate: 'code-xstate', scxml: 'code-scxml', jest: 'test-jest', pytest: 'test-pytest' };

const codegen = {
  usage: `automata codegen <machine> --lang js|py|java|c|xstate|scxml|jest|pytest [--style table|switch|class] [-o file]

The code the export dialog generates. --class-name sets Java's class.`,
  options: {
    lang: { type: 'string', short: 'l' },
    style: { type: 'string', short: 's' },
    'class-name': { type: 'string' },
    output: { type: 'string', short: 'o' },
    opt: { type: 'string', multiple: true }
  },
  async run({ args, opts }) {
    const { target, doc } = readMachine(args[0] ?? '-');
    const format = LANGS[(opts.lang || '').toLowerCase()] || (opts.output ? formatFor(null, opts.output, null) : null);
    if (!format || !format.startsWith('code-') && !format.startsWith('test-')) throw new CliError(`--lang is one of: ${Object.keys(LANGS).join(', ')}.`);
    const extra = [...(opts.opt || [])];
    if (opts.style) extra.push(`style=${opts.style}`);
    if (opts['class-name']) extra.push(`className=${opts['class-name']}`);
    // Check the option exists for this format, with the format's own message.
    exportOptions(format, extra);
    emit(serialize(target, format, { doc, opts: extra }), opts.output);
    return 0;
  }
};

const svg = {
  usage: 'automata svg <machine> [-o file.svg]\n\nThe machine drawn with state names, and edge labels where it is small enough to read them.',
  options: { output: { type: 'string', short: 'o' }, theme: { type: 'string' } },
  async run({ args, opts }) {
    const { target, doc } = readMachine(args[0] ?? '-');
    emit(serialize(target, 'svg', { doc, theme: opts.theme }), opts.output);
    return 0;
  }
};

export const commands = { convert, export: exportCmd, codegen, svg };
