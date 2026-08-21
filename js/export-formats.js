import { exportIdent, exportUniqueIdents, exportWordText } from './export-core.js';

// ══════════════════════════════════════════════════════════════════
//  EXPORT FORMATS
// ══════════════════════════════════════════════════════════════════
//  Pure functions: machine IR (or a batch/sample record) in, string
//  out. Nothing here touches the DOM or App — buildMachineIR() already
//  did that — which is what lets every format be tested directly.
// ══════════════════════════════════════════════════════════════════

// ── escaping ──────────────────────────────────────────────────────
export function csvCell(v) {
  const s = v == null ? '' : String(v);
  // Quote when the value could otherwise break the row apart. A leading
  // =, +, - or @ is quoted too: spreadsheets treat those as formulas, and
  // a state named "-1" should not become one.
  return /[",\n\r]|^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRows(rows) {
  // CRLF is what RFC 4180 specifies and what Excel expects on import.
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}

export function mdCell(v) {
  // A pipe would end the column early; a backslash-pipe renders literally.
  return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function mdTable(header, rows) {
  const head = `| ${header.map(mdCell).join(' | ')} |`;
  const rule = `| ${header.map(() => '---').join(' | ')} |`;
  const body = rows.map(r => `| ${r.map(mdCell).join(' | ')} |`).join('\n');
  return rows.length ? `${head}\n${rule}\n${body}` : `${head}\n${rule}`;
}

export function dotEscape(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// The symbols the app draws are Unicode; a LaTeX document that isn't set up
// for them fails to build. Mapping the ones this app actually emits to their
// math-mode commands keeps the output portable to a bare pdflatex run.
export const TIKZ_SYMBOL_MAP = {
  'ε': '\\varepsilon', 'λ': '\\lambda', 'Σ': '\\Sigma', 'Γ': '\\Gamma', 'Δ': '\\Delta',
  '⊔': '\\sqcup', '⊢': '\\vdash', '⊣': '\\dashv', '→': '\\rightarrow', '←': '\\leftarrow',
  '∅': '\\emptyset', '×': '\\times', '∪': '\\cup', '∩': '\\cap', '·': '\\cdot'
};

export function texEscape(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    if (TIKZ_SYMBOL_MAP[ch]) { out += `$${TIKZ_SYMBOL_MAP[ch]}$`; continue; }
    if ('#$%&_{}'.includes(ch)) { out += '\\' + ch; continue; }
    if (ch === '\\') { out += '\\textbackslash{}'; continue; }
    if (ch === '^') { out += '\\textasciicircum{}'; continue; }
    if (ch === '~') { out += '\\textasciitilde{}'; continue; }
    out += ch;
  }
  return out;
}

// ── grouping ──────────────────────────────────────────────────────
// Parallel edges (same source, same target, different symbol) are one
// arrow with a comma-joined label in every drawn notation. Keeping them
// separate produces a diagram with three arrows stacked on one another.
export function groupParallelEdges(transitions) {
  const groups = new Map();
  for (const t of transitions) {
    // Serialised rather than concatenated: state ids come from imported
    // files as well as this app, so no single separator character is
    // guaranteed absent from them.
    const key = JSON.stringify([t.from, t.to]);
    if (!groups.has(key)) groups.set(key, { from: t.from, to: t.to, fromName: t.fromName, toName: t.toName, labels: [], isSelfLoop: t.isSelfLoop });
    groups.get(key).labels.push(t.label);
  }
  return [...groups.values()];
}

// ══════════════════════════════════════════════════════════════════
//  GRAPHVIZ DOT
// ══════════════════════════════════════════════════════════════════
export function exportToDot(ir, opts = {}) {
  const merge = opts.mergeParallel !== false;
  const rankdir = opts.rankdir || 'LR';
  const usePositions = !!opts.usePositions;
  const ids = exportUniqueIdents(ir.states, s => s);

  const lines = [];
  lines.push(`digraph ${exportIdent(ir.machine, 'Automaton')} {`);
  lines.push(`  rankdir=${rankdir};`);
  lines.push('  fontname="Helvetica";');
  lines.push('  node [shape=circle, fontname="Helvetica", fixedsize=false];');
  lines.push('  edge [fontname="Helvetica", fontsize=11];');
  lines.push('');

  // The start marker is a conventional invisible node with an arrow into
  // q0 — Graphviz has no "initial state" concept of its own.
  if (ir.startId) {
    lines.push('  __start [shape=none, label="", width=0, height=0];');
  }

  for (const s of ir.states) {
    const attrs = [`label="${dotEscape(s.name)}"`];
    if (s.isAccept) attrs.push('shape=doublecircle');
    if (usePositions) {
      // Graphviz points are 1/72 inch and y grows upward, opposite the canvas.
      attrs.push(`pos="${(s.x / 72).toFixed(3)},${(-s.y / 72).toFixed(3)}!"`);
    }
    if (ir.isTransducer && s.output != null && s.output !== '') {
      attrs[0] = `label="${dotEscape(s.name)} / ${dotEscape(s.output)}"`;
    }
    lines.push(`  ${ids.get(s.id)} [${attrs.join(', ')}];`);
  }

  lines.push('');
  if (ir.startId) lines.push(`  __start -> ${ids.get(ir.startId)};`);

  const edges = merge ? groupParallelEdges(ir.transitions) : ir.transitions.map(t => ({ ...t, labels: [t.label] }));
  for (const e of edges) {
    const label = e.labels.join(', ');
    lines.push(`  ${ids.get(e.from)} -> ${ids.get(e.to)} [label="${dotEscape(label)}"];`);
  }

  lines.push('}');
  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════════
//  TikZ / LaTeX
// ══════════════════════════════════════════════════════════════════
// Absolute coordinates rather than TikZ's relative `right=of` chains: the
// user already arranged the machine on the canvas, and that layout is the
// thing worth carrying into the paper.
export function exportToTikz(ir, opts = {}) {
  const merge = opts.mergeParallel !== false;
  const scale = opts.scale || 0.02;   // canvas px → cm
  const standalone = !!opts.standalone;
  const ids = exportUniqueIdents(ir.states, s => s);

  const body = [];
  body.push('\\begin{tikzpicture}[shorten >=1pt, node distance=2.8cm, on grid, auto,');
  body.push('    every state/.style={draw, circle, minimum size=1.1cm, inner sep=1pt}]');

  for (const s of ir.states) {
    const style = ['state'];
    if (s.isStart) style.push('initial');
    if (s.isAccept) style.push('accepting');
    // TikZ y grows upward; the canvas grows downward.
    const x = (s.x * scale).toFixed(3);
    const y = (-s.y * scale).toFixed(3);
    const label = ir.isTransducer && s.output != null && s.output !== ''
      ? `${texEscape(s.name)} / ${texEscape(s.output)}`
      : texEscape(s.name);
    body.push(`  \\node[${style.join(',')}] (${ids.get(s.id)}) at (${x},${y}) {${label}};`);
  }

  body.push('');
  body.push('  \\path[->]');
  const edges = merge ? groupParallelEdges(ir.transitions) : ir.transitions.map(t => ({ ...t, labels: [t.label] }));
  const drawn = edges.map(e => {
    const label = texEscape(e.labels.join(', '));
    if (e.from === e.to) return `    (${ids.get(e.from)}) edge [loop above] node {${label}} ()`;
    // `bend left` keeps a mutual pair from drawing one arrow over the other.
    const reciprocal = edges.some(o => o.from === e.to && o.to === e.from);
    const bend = reciprocal ? ' [bend left=20]' : '';
    return `    (${ids.get(e.from)}) edge${bend} node {${label}} (${ids.get(e.to)})`;
  });
  body.push(drawn.join('\n') + ';');
  body.push('\\end{tikzpicture}');

  const picture = body.join('\n');
  if (!standalone) return picture;

  return [
    '\\documentclass[border=6pt]{standalone}',
    '\\usepackage{tikz}',
    '\\usetikzlibrary{automata, positioning, arrows.meta}',
    '\\begin{document}',
    picture,
    '\\end{document}'
  ].join('\n');
}

// ══════════════════════════════════════════════════════════════════
//  TRANSITION TABLES
// ══════════════════════════════════════════════════════════════════
// Two shapes, because one does not fit every machine. The matrix is the
// δ: Q × Σ → … grid a textbook prints, and it only reads correctly when
// an edge is keyed by its input symbol alone. Stack and tape machines
// key on more than that, so they get the flat list instead — the same
// information, without pretending to a 2-D layout it does not have.
// A weighted machine's cell is a distribution, not a destination, and a
// two-way head's is a (destination, move) pair — neither collapses into the
// one-entry-per-symbol grid, so both take the flat list.
export function exportSupportsMatrix(ir) {
  return !ir.hasStack && !ir.hasTape && !ir.isWeighted && !ir.hasEndMarkers;
}

export function buildTransitionMatrix(ir) {
  const cols = [...ir.sigma];
  if (ir.hasEpsilon) cols.push(ir.sym.eps);
  const header = ['State', ...cols];
  if (ir.hasStateOutput) header.push('Output');

  const rows = ir.states.map(s => {
    const mark = `${s.isStart ? '→' : ''}${s.isAccept ? '*' : ''}`;
    const cells = cols.map(sym => {
      const dests = ir.transitions
        .filter(t => t.from === s.id && t.symbol === sym)
        .map(t => t.toName);
      if (!dests.length) return '—';
      // Mealy/FST print the emitted symbol alongside the destination;
      // the destination alone would lose the whole output function.
      if (ir.isTransducer && !ir.hasStateOutput) {
        return ir.transitions
          .filter(t => t.from === s.id && t.symbol === sym)
          .map(t => `${t.toName}/${t.output != null && t.output !== '' ? t.output : ir.sym.lambda}`)
          .join(', ');
      }
      return dests.length > 1 ? `{${dests.join(', ')}}` : dests[0];
    });
    const row = [`${mark}${s.name}`, ...cells];
    if (ir.hasStateOutput) row.push(s.output != null ? s.output : '');
    return row;
  });

  return { header, rows };
}

export function buildTransitionList(ir) {
  const header = ['From', 'Read'];
  if (ir.hasStack && !ir.hasTape) header.push('Pop', 'Push');
  if (ir.hasTape) header.push('Write', 'Move');
  if (!ir.hasTape && ir.hasEndMarkers) header.push('Move');
  if (ir.isTransducer) header.push('Output');
  if (ir.isWeighted) header.push('P');
  header.push('To');

  const rows = ir.transitions.map(t => {
    const row = [t.fromName, t.symbol];
    if (ir.hasStack && !ir.hasTape) row.push(t.pop ?? '', t.push ?? '');
    if (ir.hasTape) {
      row.push(
        t.tapeWrites ? t.tapeWrites.join(' | ') : (t.write ?? ''),
        t.tapeDirs ? t.tapeDirs.join(' | ') : (t.dir ?? '')
      );
    }
    if (!ir.hasTape && ir.hasEndMarkers) row.push(t.dir ?? '');
    if (ir.isTransducer) row.push(t.output ?? '');
    if (ir.isWeighted) row.push(t.weight ?? 1);
    row.push(t.toName);
    return row;
  });

  return { header, rows };
}

export function exportTransitionTable(ir, opts = {}) {
  const shape = opts.shape === 'matrix' && exportSupportsMatrix(ir) ? 'matrix' : 'list';
  const { header, rows } = shape === 'matrix' ? buildTransitionMatrix(ir) : buildTransitionList(ir);
  if (opts.format === 'markdown') {
    const title = `### ${ir.machineLabel} — transition ${shape === 'matrix' ? 'table' : 'list'}\n\n`;
    const legend = shape === 'matrix' ? '\n\n`→` start · `*` accepting\n' : '\n';
    return title + mdTable(header, rows) + legend;
  }
  return csvRows([header, ...rows]);
}

// ══════════════════════════════════════════════════════════════════
//  LANGUAGE SAMPLES  (accepted + rejected words)
// ══════════════════════════════════════════════════════════════════
// Says whether a column is everything, and if not what to change. A test
// suite generated from a truncated list is missing cases silently, so the
// note is part of the artifact rather than something the dialog whispers.
// " from q0 to q2" — omitting either end when it is the machine's own.
export function exportRouteNote(rec) {
  const parts = [];
  if (rec.origin) parts.push(` from ${rec.origin}`);
  if (rec.target) parts.push(` to ${rec.target}`);
  return parts.join('');
}

export function exportLimitNote(samples) {
  const why = {
    rows: 'the requested word count was reached — raise it for more',
    length: 'no word of that length or less is left — raise the max length for more',
    'word-budget': 'the Σ* walk hit its budget — narrow Σ or the length band',
    'search-budget': 'the graph search hit its budget — lower the max length'
  };
  const lim = samples.limits || {};
  const lines = ['accepted', 'rejected']
    .filter(col => lim[col])
    .map(col => `- ${col}: incomplete — ${why[lim[col]] || lim[col]}`);
  if (!lines.length) return '\nComplete: every word the request describes is listed.\n';
  return '\n' + lines.join('\n') + '\n';
}

export function exportSamplesText(samples, ir, opts = {}) {
  const fmt = opts.format || 'csv';
  const acc = samples.accepted.map(w => exportWordText(w, ir));
  const rej = samples.rejected.map(w => exportWordText(w, ir));

  if (fmt === 'json') {
    return JSON.stringify({
      machine: ir.machine,
      alphabet: ir.sigma,
      origin: samples.origin,
      target: samples.target || null,
      generated: new Date().toISOString(),
      accepted: acc,
      rejected: rej,
      undecided: samples.undecided,
      truncated: !!samples.truncated,
      // What stopped each column, or null if nothing did. `truncated` above
      // cannot distinguish these and is kept only for older consumers.
      limits: samples.limits || { accepted: null, rejected: null }
    }, null, 2);
  }

  if (fmt === 'batch') {
    // Deliberately the Batch Test panel's own input syntax, so a generated
    // sample set can be pasted straight back in as a regression check.
    return [
      ...acc.map(w => `${w} => accept`),
      ...rej.map(w => `${w} => reject`)
    ].join('\n');
  }

  if (fmt === 'markdown') {
    const rows = [
      ...acc.map(w => [w, 'accept', [...w].length]),
      ...rej.map(w => [w, 'reject', [...w].length])
    ];
    return `### ${ir.machineLabel} — language samples`
      + exportRouteNote(samples) + '\n\n'
      + mdTable(['Word', 'Verdict', 'Length'], rows) + '\n'
      + exportLimitNote(samples);
  }

  return csvRows([
    ['word', 'verdict', 'length'],
    ...acc.map(w => [w, 'accept', [...w].length]),
    ...rej.map(w => [w, 'reject', [...w].length])
  ]);
}

// ══════════════════════════════════════════════════════════════════
//  TRANSITION COVERAGE  (one accepted word per edge)
// ══════════════════════════════════════════════════════════════════
// One row per transition either way, covered or not: a coverage report
// whose uncovered edges are missing from the file is not a report. The
// reason takes the `status` cell, so the table stays one shape and sorts
// and filters in a spreadsheet the way a reader expects.
export function exportCoverageText(cov, ir, opts = {}) {
  const fmt = opts.format || 'csv';
  const withUncovered = opts.includeUncovered !== false;

  const covered = cov.rows.map(r => ({ ...r, text: exportWordText(r.word, ir) }));
  const missing = withUncovered ? cov.uncovered : [];

  if (fmt === 'json') {
    return JSON.stringify({
      machine: ir.machine,
      alphabet: ir.sigma,
      origin: cov.origin,
      target: cov.target || null,
      generated: new Date().toISOString(),
      covered: covered.map(r => ({
        from: r.from, symbol: r.symbol, to: r.to, word: r.text, length: r.word.length, accept: r.accept
      })),
      uncovered: missing.map(r => ({ from: r.from, symbol: r.symbol, to: r.to, reason: r.reason })),
      transitions: cov.rows.length + cov.uncovered.length
    }, null, 2);
  }

  if (fmt === 'batch') {
    // Every covered word is accepted by construction, so the whole file is
    // a regression suite the Batch Test panel can run as-is.
    return covered.map(r => `${r.text} => accept`).join('\n');
  }

  const header = ['from', 'symbol', 'to', 'word', 'length', 'accept', 'status'];
  const rows = [
    ...covered.map(r => [r.from, r.symbol, r.to, r.text, String(r.word.length), r.accept, 'covered']),
    ...missing.map(r => [r.from, r.symbol, r.to, '', '', '', r.reason])
  ];

  if (fmt === 'markdown') {
    const n = cov.rows.length, total = n + cov.uncovered.length;
    return `### ${ir.machineLabel} — transition coverage\n\n`
      + `${n} of ${total} transition${total === 1 ? '' : 's'} covered`
      + (cov.origin ? `, routed${exportRouteNote(cov)}` : '') + '.\n\n'
      + mdTable(header, rows) + '\n';
  }
  return csvRows([header, ...rows]);
}

// ══════════════════════════════════════════════════════════════════
//  BATCH RESULTS
// ══════════════════════════════════════════════════════════════════
export function exportBatchText(batch, opts = {}) {
  const fmt = opts.format || 'csv';
  const rows = batch.results.map(r => ({
    input: r.str,
    expected: r.expect || '',
    verdict: r.error ? 'error' : (r.verdict === undefined ? '' : r.verdict),
    pass: r.expect && !r.error ? String(r.verdict === r.expect) : '',
    output: r.output == null ? '' : r.output
  }));

  if (fmt === 'json') {
    return JSON.stringify({
      machine: batch.machine,
      generated: new Date().toISOString(),
      expectations: batch.expected,
      passed: batch.passCount,
      undecided: batch.unknowns,
      stepBudget: batch.budget,
      results: rows
    }, null, 2);
  }

  if (fmt === 'markdown') {
    const head = batch.expected
      ? `### Batch test — ${batch.passCount} / ${batch.expected} expectations passed\n\n`
      : `### Batch test — ${rows.length} input${rows.length === 1 ? '' : 's'}\n\n`;
    const table = mdTable(
      ['Input', 'Expected', 'Verdict', 'Pass', 'Output'],
      rows.map(r => [r.input, r.expected || '—', r.verdict || '—', r.pass === '' ? '—' : (r.pass === 'true' ? '✓' : '✗'), r.output || '—'])
    );
    const note = batch.unknowns
      ? `\n\n> ${batch.unknowns} input${batch.unknowns === 1 ? '' : 's'} had no verdict inside ${batch.budget} steps — not a rejection.\n`
      : '\n';
    return head + table + note;
  }

  return csvRows([
    ['input', 'expected', 'verdict', 'pass', 'output'],
    ...rows.map(r => [r.input, r.expected, r.verdict, r.pass, r.output])
  ]);
}
