import { exportPNG, exportSVG, getContentBounds, wrap } from './canvas.js';
import { buildMachineIR, exportCanTrace, exportCopyText, exportCoverageWords, exportDefaultMaxLength, exportDownload, exportFilename, exportRequireMachine, exportRouteDepth, exportSampleWords } from './export-core.js';
import { LANG_TRACE_DEPTH_CAP } from './language.js';
import { exportBatchText, exportCoverageText, exportSamplesText, exportToDot, exportToTikz, exportTransitionTable } from './export-formats.js';
import { ExportFormats } from './export-registry.js';
import { closeModal, registerModal, showOverlay } from './modal.js';
import { getWorkspaceData } from './persistence.js';
import { $, App } from './state.js';
import { escapeHtml, showStatus } from './utils.js';

// ══════════════════════════════════════════════════════════════════
//  EXPORT DIALOGS
// ══════════════════════════════════════════════════════════════════
//  Two dialogs, split by what the user is trying to produce:
//
//    Export as Image  — a picture of the machine (PNG, SVG)
//    Export as Code   — a text representation of it (DOT, TikZ,
//                       tables, language samples, batch results)
//
//  Formats are entries in ExportFormats rather than branches in a
//  renderer. Each one declares its label, extension, and option
//  schema, and the dialog builds its own controls from that — so a new
//  format is one object, and the preview/copy/download plumbing comes
//  for free.
// ══════════════════════════════════════════════════════════════════

// ── image dialog ──────────────────────────────────────────────────
export const ExportImageOpts = {
  format: 'png',
  scale: 2,
  crop: true,
  padding: 40,
  background: 'transparent',
  customColor: '#ffffff',
  includeNotes: true,
  includeDividers: true,
  embedData: true
};

registerModal('export-image-modal', {
  dismissOnBackdrop: true,
  submit: () => runImageExport()
});

export function openExportImageModal() {
  if (!exportRequireMachine()) return;
  ExportImageOpts.scale = App.config.exportRes || 2;
  renderExportImageModal();
  showOverlay('export-image-modal');
}

export function setExportImageOpt(key, value) {
  if (key === 'scale' || key === 'padding') value = Number(value);
  if (key === 'crop' || key === 'includeNotes' || key === 'includeDividers' || key === 'embedData') value = !!value;
  ExportImageOpts[key] = value;
  if (key === 'scale') App.config.exportRes = value;
  renderExportImageModal();
}

export function exportImageDimensions() {
  const o = ExportImageOpts;
  let w, h;
  if (o.crop) {
    const b = typeof getContentBounds === 'function' ? getContentBounds(App.config.radius + 4) : null;
    if (b) { w = Math.round(b.width + o.padding * 2); h = Math.round(b.height + o.padding * 2); }
  }
  if (w === undefined) {
    const wrap = $('canvas-wrap');
    w = (wrap && wrap.clientWidth) || 800;
    h = (wrap && wrap.clientHeight) || 600;
  }
  const scale = o.format === 'png' ? o.scale : 1;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

export function renderExportImageModal() {
  const host = $('export-image-body');
  if (!host) return;
  const o = ExportImageOpts;
  const isPng = o.format === 'png';
  const dim = exportImageDimensions();

  const seg = (key, val, label, current) =>
    `<button type="button" class="exp-seg${current === val ? ' on' : ''}" onclick="setExportImageOpt('${key}', ${typeof val === 'number' ? val : `'${val}'`})">${label}</button>`;

  const check = (key, label, hint) =>
    `<label class="exp-check"><input type="checkbox" ${ExportImageOpts[key] ? 'checked' : ''}
      onchange="setExportImageOpt('${key}', this.checked)"><span>${label}</span>${hint ? `<em>${hint}</em>` : ''}</label>`;

  host.innerHTML = `
    <div class="exp-row">
      <span class="exp-lbl">Format</span>
      <div class="exp-segs">
        ${seg('format', 'png', 'PNG', o.format)}
        ${seg('format', 'svg', 'SVG', o.format)}
      </div>
    </div>
    ${isPng ? `
    <div class="exp-row">
      <span class="exp-lbl">Resolution</span>
      <div class="exp-segs">
        ${[1, 2, 3, 4].map(n => seg('scale', n, n + '×', o.scale)).join('')}
      </div>
    </div>` : `
    <div class="exp-note">SVG is resolution independent — it stays sharp at any size.</div>`}
    <div class="exp-row">
      <span class="exp-lbl">Framing</span>
      <div class="exp-segs">
        ${seg('crop', true, 'Crop to content', o.crop)}
        ${seg('crop', false, 'Current view', o.crop)}
      </div>
    </div>
    ${o.crop ? `
    <div class="exp-row">
      <span class="exp-lbl">Padding</span>
      <input class="inp exp-num" type="number" min="0" max="400" step="10" value="${o.padding}"
        onchange="setExportImageOpt('padding', this.value)">
    </div>` : ''}
    <div class="exp-row">
      <span class="exp-lbl">Background</span>
      <div class="exp-segs">
        ${seg('background', 'transparent', 'Transparent', o.background)}
        ${seg('background', 'theme', 'Theme', o.background)}
        ${seg('background', 'custom', 'Custom', o.background)}
      </div>
    </div>
    ${o.background === 'custom' ? `
    <div class="exp-row">
      <span class="exp-lbl">Colour</span>
      <input class="exp-color" type="color" value="${o.customColor}"
        onchange="setExportImageOpt('customColor', this.value)">
    </div>` : ''}
    <div class="exp-row exp-row-stack">
      <span class="exp-lbl">Include</span>
      <div class="exp-checks">
        ${check('includeNotes', 'Notes')}
        ${check('includeDividers', 'Dividers &amp; regions')}
        ${isPng ? check('embedData', 'Workspace data', 'reopenable by dropping the PNG back in') : ''}
      </div>
    </div>
    <div class="exp-dim">Output — <strong>${dim.w} × ${dim.h}</strong> px</div>
  `;
}

// Resolves the background choice to something buildExportSVG understands.
export function exportResolveBackground() {
  const o = ExportImageOpts;
  if (o.background === 'transparent') return 'transparent';
  if (o.background === 'custom') return o.customColor;
  // 'theme' — read what the canvas is actually painted, so the export
  // matches the app rather than a hardcoded guess at the palette.
  try {
    const wrap = $('canvas-wrap');
    const bg = getComputedStyle(wrap).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
  } catch (e) { /* fall through */ }
  return App.config.export.bg || '#ffffff';
}

export function runImageExport() {
  const o = ExportImageOpts;
  const opts = {
    crop: o.crop,
    padding: o.padding,
    includeNotes: o.includeNotes,
    includeDividers: o.includeDividers,
    background: exportResolveBackground()
  };
  closeModal('export-image-modal');
  if (o.format === 'svg') exportSVG(opts);
  else exportPNG({ ...opts, scale: o.scale, embedData: o.embedData });
}

// ══════════════════════════════════════════════════════════════════
//  CODE / CONFIG / SPEC DIALOG
// ══════════════════════════════════════════════════════════════════

// Diagram, table and sample-word targets. The code and test-suite targets are
// added by js/codegen.js; both sides write into the registry from
// js/export-registry.js. Option schema types: 'check', 'select', 'number'.
// ── option conflicts ──────────────────────────────────────────────
// The controls in the Language group are independent knobs over one search,
// and a few combinations mean something other than what they read like. Each
// is legal and does exactly what it says; the warning is there because what
// it says is not what a reader assumes. Shown only when the combination is
// actually selected, so the common case stays uncluttered.

// Batch-test input is the one sub-format that claims to be re-runnable, and
// the only one with nowhere to record the route it was generated for: it is
// bare `word => accept` lines, and parseBatchLine has no comment syntax to
// hide a note in. Pasted back, those lines are judged against the machine's
// own start and accept set, so a re-aimed route fails.
function routeBatchWarning(o) {
  if (o.format !== 'batch') return null;
  const ends = [];
  if (o.origin) ends.push('Start from');
  if (o.target) ends.push('End at');
  if (!ends.length) return null;
  return `${ends.join(' and ')} ${ends.length > 1 ? 'are' : 'is'} off the default, so these lines describe that route — not the machine as drawn. Pasted into Batch Test they will fail.`;
}

// Below the route's own depth, some transition cannot appear in any exported
// word. The default is right for the machine's own route; re-aiming it after
// the dialog opened does not move the spinner.
function routeDepthWarning(o) {
  if (!o.maxLength) return null;
  const need = exportRouteDepth(o);
  if (!need || o.maxLength >= need) return null;
  return `Max length ${o.maxLength} is below the ${need} this route needs, so some transitions cannot appear in any word.`;
}

function samplesWarnings(o) {
  const out = [routeBatchWarning(o), routeDepthWarning(o)];

  // "Reject" stops meaning "the machine rejects it" and starts meaning "it
  // does not end there" — which includes words the machine really accepts.
  if (o.target && o.rejected > 0) {
    out.push('With End at set, the rejected words are the ones that do not finish there — including words the machine itself accepts.');
  }
  // The quota is one word per route, and the shortest word on a route is the
  // one that takes its loops fewest times. Skip the short ones and the quota
  // goes to a pumped word instead.
  if (o.expandLoops === false && o.minLength > 0) {
    out.push('Min length is skipping the shortest word on each route, so the one kept in its place has already been round a loop.');
  }
  // The loop switch rides on the graph walk, which only some machines get.
  if (o.expandLoops === false && !exportCanTrace()) {
    out.push('This machine is sampled by enumerating Σ* rather than by walking its graph, so there are no routes to collapse and Expand loops does nothing.');
  }
  return out.filter(Boolean);
}

function coverageWarnings(o) {
  return [routeBatchWarning(o)].filter(Boolean);
}

// Every text format that offers a sub-format picker names its file the same
// way; three copies of this drifted apart the moment one gained an option.
const textExtFor = o => (o.format === 'json' ? 'json' : o.format === 'markdown' ? 'md' : o.format === 'batch' ? 'txt' : 'csv');

Object.assign(ExportFormats, {
  dot: {
    label: 'Graphviz DOT', group: 'Diagram', ext: 'dot', mime: 'text/vnd.graphviz',
    blurb: 'Render with <code>dot -Tpng machine.dot</code>, or paste into any Graphviz viewer.',
    options: [
      { id: 'mergeParallel', type: 'check', label: 'Merge parallel edges', def: true },
      { id: 'rankdir', type: 'select', label: 'Direction', def: 'LR', choices: [['LR', 'Left → right'], ['TB', 'Top → bottom']] },
      { id: 'usePositions', type: 'check', label: 'Keep canvas positions', def: false, hint: 'needs -Kneato' }
    ],
    build: (ir, o) => exportToDot(ir, o)
  },
  tikz: {
    label: 'TikZ / LaTeX', group: 'Diagram', ext: 'tex', mime: 'text/x-tex',
    blurb: 'Needs <code>\\usetikzlibrary{automata, positioning}</code> in the preamble.',
    options: [
      { id: 'standalone', type: 'check', label: 'Complete document', def: false, hint: 'wrap in a compilable file' },
      { id: 'mergeParallel', type: 'check', label: 'Merge parallel edges', def: true },
      { id: 'scale', type: 'number', label: 'Scale (px → cm)', def: 0.02, step: 0.005, min: 0.005, max: 0.2 }
    ],
    build: (ir, o) => exportToTikz(ir, o)
  },
  'table-csv': {
    label: 'Transition table (CSV)', group: 'Tables', ext: 'csv', mime: 'text/csv',
    options: [
      { id: 'shape', type: 'select', label: 'Shape', def: 'matrix', choices: [['matrix', 'δ matrix'], ['list', 'Edge list']] }
    ],
    build: (ir, o) => exportTransitionTable(ir, { ...o, format: 'csv' })
  },
  'table-md': {
    label: 'Transition table (Markdown)', group: 'Tables', ext: 'md', mime: 'text/markdown',
    options: [
      { id: 'shape', type: 'select', label: 'Shape', def: 'matrix', choices: [['matrix', 'δ matrix'], ['list', 'Edge list']] }
    ],
    build: (ir, o) => exportTransitionTable(ir, { ...o, format: 'markdown' })
  },
  samples: {
    label: 'Language samples', group: 'Language', ext: 'csv', mime: 'text/csv',
    blurb: 'Accepted and rejected words in shortlex order, derived from the machine itself. A repeating configuration counts as reject; a run with no verdict inside the step limit is skipped as undecided.',
    warn: samplesWarnings,
    warnProbe: { format: 'batch', origin: '\u0000probe', target: '\u0000probe', minLength: 1, maxLength: 1, expandLoops: false, rejected: 25 },
    options: [
      { id: 'format', type: 'select', label: 'As', def: 'csv', choices: [['csv', 'CSV'], ['json', 'JSON'], ['batch', 'Batch-test input'], ['markdown', 'Markdown']] },
      { id: 'origin', type: 'select', label: 'Start from', def: '',
        choices: () => [['', 'Start state'], ...App.states.map(st => [st.id, st.name])] },
      { id: 'target', type: 'select', label: 'End at', def: '',
        choices: () => [['', 'Any accept state'], ...App.states.map(st => [st.id, st.name])] },
      // Row counts are output size, not cost — the search budgets bound the
      // work, so these are set where a spreadsheet stops coping rather than
      // where the search would. Max length defaults to the machine's own
      // route depth; see exportDefaultMaxLength().
      { id: 'accepted', type: 'number', label: 'Accepted words', def: 25, min: 0, max: 10000, step: 5 },
      { id: 'rejected', type: 'number', label: 'Rejected words', def: 25, min: 0, max: 10000, step: 5 },
      { id: 'minLength', type: 'number', label: 'Min length', def: 0, min: 0, max: () => LANG_TRACE_DEPTH_CAP, step: 1 },
      { id: 'maxLength', type: 'number', label: 'Max length', def: () => exportDefaultMaxLength(), min: 1, max: () => LANG_TRACE_DEPTH_CAP, step: 1 },
      { id: 'expandLoops', type: 'check', label: 'Expand loops', def: true, hint: 'off: one word per route' }
    ],
    extFor: textExtFor,
    build: (ir, o) => {
      const samples = exportSampleWords(o);
      if (!samples.decidable) return '# This machine has no accept/reject notion, so L(M) cannot be sampled.';
      return exportSamplesText(samples, ir, { format: o.format });
    }
  },
  coverage: {
    label: 'Transition coverage', group: 'Language', ext: 'csv', mime: 'text/csv',
    blurb: 'One accepted word per transition — a shortest route in, the edge, then a shortest route on to an accept. Every loop gets exercised exactly once. Edges with no such word are listed with the reason.',
    warn: coverageWarnings,
    warnProbe: { format: 'batch', origin: '\u0000probe', target: '\u0000probe' },
    options: [
      { id: 'format', type: 'select', label: 'As', def: 'csv', choices: [['csv', 'CSV'], ['json', 'JSON'], ['batch', 'Batch-test input'], ['markdown', 'Markdown']] },
      { id: 'origin', type: 'select', label: 'Start from', def: '',
        choices: () => [['', 'Start state'], ...App.states.map(st => [st.id, st.name])] },
      { id: 'target', type: 'select', label: 'End at', def: '',
        choices: () => [['', 'Any accept state'], ...App.states.map(st => [st.id, st.name])] },
      { id: 'includeUncovered', type: 'check', label: 'List uncovered edges', def: true }
    ],
    extFor: textExtFor,
    build: (ir, o) => {
      const cov = exportCoverageWords(o);
      if (!cov.decidable) return '# This machine has no accept/reject notion, so there is nothing to route towards.';
      // Pairing an edge with a word means a path through the graph *is* a
      // word — which a two-way head or a tape breaks by revisiting cells.
      if (!cov.traceable) return `# Coverage needs a machine whose graph paths are words: DFA, NFA, ε-NFA, or the PDA family. ${ir.machineLabel} is outside that set.`;
      if (cov.reason) return `# No coverage: ${cov.reason}.`;
      return exportCoverageText(cov, ir, o);
    }
  },
  batch: {
    label: 'Batch test results', group: 'Results', ext: 'csv', mime: 'text/csv',
    blurb: 'The most recent run from the Batch Test panel.',
    options: [
      { id: 'format', type: 'select', label: 'As', def: 'csv', choices: [['csv', 'CSV'], ['json', 'JSON'], ['markdown', 'Markdown']] }
    ],
    extFor: textExtFor,
    available: () => !!App.lastBatch,
    unavailableNote: 'Run a batch test first — the Batch Test panel is in the right sidebar.',
    build: (ir, o) => exportBatchText(App.lastBatch, { format: o.format })
  },
  json: {
    label: 'Workspace JSON', group: 'Data', ext: 'json', mime: 'application/json',
    blurb: 'The native save format — states, transitions, alphabets, notes.',
    options: [],
    build: () => JSON.stringify(getWorkspaceData(), null, 2)
  }
});

export const ExportUI = { format: 'dot', opts: {}, cache: '' };

registerModal('export-code-modal', {
  dismissOnBackdrop: true,
  submit: () => exportCodeDownload()
});

// A schema field may be a function, evaluated when the dialog renders rather
// than when the registry is declared. Two reasons, and both are load-bearing:
// the origin picker and the max-length default depend on the machine, and
// language.js imports this module, so reading its consts at module scope
// would be a use-before-initialisation across that cycle.
const optValue = v => (typeof v === 'function' ? v() : v);

export function exportDefaultOpts(key) {
  const spec = ExportFormats[key];
  const o = {};
  // `def` may be a function: the max-length default is derived from the
  // machine, which is not known when the registry is declared.
  (spec.options || []).forEach(opt => { o[opt.id] = optValue(opt.def); });
  return o;
}

export function openExportCodeModal(initial) {
  if (!exportRequireMachine()) return;
  const key = initial && ExportFormats[initial] ? initial : ExportUI.format;
  selectExportFormat(key, true);
  sizeExportCodeOptions();
  showOverlay('export-code-modal');
}

export function selectExportFormat(key, keepOpen) {
  if (!ExportFormats[key]) return;
  ExportUI.format = key;
  ExportUI.opts = exportDefaultOpts(key);
  renderExportCodeModal();
  if (!keepOpen) renderExportCodePreview();
}

export function setExportCodeOpt(id, value, type) {
  if (type === 'number') value = Number(value);
  if (type === 'check') value = !!value;
  ExportUI.opts[id] = value;
  renderExportCodeModal();
}

export function exportCurrentSpec() { return ExportFormats[ExportUI.format]; }

export function exportCurrentText() {
  const spec = exportCurrentSpec();
  if (!spec) return '';
  if (spec.available && !spec.available()) return spec.unavailableNote || 'Not available yet.';
  try {
    return spec.build(buildMachineIR(), ExportUI.opts);
  } catch (err) {
    console.error(err);
    return `# Export failed: ${err.message}`;
  }
}

// Shared by the live render and by sizeExportCodeOptions (which renders
// every format's controls offscreen just to measure them).
export function exportCodeOptionsHtml(spec, opts) {
  const controls = (spec.options || []).map(opt => {
    const val = opts[opt.id];
    if (opt.type === 'check') {
      return `<label class="exp-check"><input type="checkbox" ${val ? 'checked' : ''}
        onchange="setExportCodeOpt('${opt.id}', this.checked, 'check')"><span>${opt.label}</span>${opt.hint ? `<em>${opt.hint}</em>` : ''}</label>`;
    }
    if (opt.type === 'select') {
      // Choices may be a function: the origin picker lists the machine's
      // states, which are not known when the registry is declared. Both the
      // value and the label are escaped because a state name is user text.
      const choices = optValue(opt.choices);
      return `<label class="exp-field"><span>${opt.label}</span>
        <select class="inp" onchange="setExportCodeOpt('${opt.id}', this.value, 'select')">
          ${choices.map(([v, l]) => `<option value="${escapeHtml(v)}" ${val === v ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}
        </select></label>`;
    }
    if (opt.type === 'text') {
      return `<label class="exp-field"><span>${opt.label}</span>
        <input class="inp" type="text" value="${escapeHtml(val)}"
          onchange="setExportCodeOpt('${opt.id}', this.value, 'text')"></label>`;
    }
    const min = optValue(opt.min), max = optValue(opt.max);
    return `<label class="exp-field"><span>${opt.label}</span>
      <input class="inp exp-num" type="number" value="${val}"
        ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''}
        ${opt.step !== undefined ? `step="${opt.step}"` : ''}
        onchange="setExportCodeOpt('${opt.id}', this.value, 'number')"></label>`;
  }).join('');

  // A warning is a function of the current options, so it appears only when
  // it applies. Escaped: it can quote an option label.
  const warnings = typeof spec.warn === 'function' ? (spec.warn(opts) || []) : [];
  const list = [].concat(warnings).filter(Boolean);

  return (spec.blurb ? `<div class="exp-blurb">${spec.blurb}</div>` : '')
    + (controls ? `<div class="exp-opts">${controls}</div>` : '')
    + (list.length ? `<div class="exp-warn">${list.map(w => `<p>${escapeHtml(w)}</p>`).join('')}</div>` : '');
}

export function renderExportCodeModal() {
  const listHost = $('export-format-list');
  const optHost = $('export-code-options');
  const spec = exportCurrentSpec();
  if (!listHost || !optHost || !spec) return;

  // Format picker, grouped in declaration order.
  const groups = [];
  Object.entries(ExportFormats).forEach(([key, f]) => {
    let g = groups.find(x => x.name === f.group);
    if (!g) { g = { name: f.group, items: [] }; groups.push(g); }
    g.items.push({ key, f });
  });

  listHost.innerHTML = groups.map(g => `
    <div class="exp-group">
      <div class="exp-group-name">${g.name}</div>
      ${g.items.map(({ key, f }) => {
        const off = f.available && !f.available();
        return `<button type="button" class="exp-fmt${key === ExportUI.format ? ' on' : ''}${off ? ' off' : ''}"
          onclick="selectExportFormat('${key}')">${escapeHtml(f.label)}</button>`;
      }).join('')}
    </div>`).join('');

  optHost.innerHTML = exportCodeOptionsHtml(spec, ExportUI.opts);

  renderExportCodePreview();
}

// Formats range from a bare JSON dump (no options) to Language Samples
// (a blurb plus six fields) — swapping the options block between them
// as-is made the modal resize with every format click, the same jarring
// jump the Settings tabs had. Render each format's options offscreen once
// per open, take the tallest, and lock the block to that so it stays put.
export function sizeExportCodeOptions() {
  const optHost = $('export-code-options');
  if (!optHost) return;
  const liveHtml = optHost.innerHTML;

  let max = 0;
  Object.keys(ExportFormats).forEach(key => {
    const spec = ExportFormats[key];
    const defs = exportDefaultOpts(key);
    // Defaults alone would under-measure any format that can show a warning:
    // no default triggers one, so the block would grow past the height it was
    // just locked to and jump exactly as this function exists to prevent.
    // `warnProbe` is the option set that makes warn() fire, measured too.
    const cases = spec.warnProbe ? [defs, { ...defs, ...spec.warnProbe }] : [defs];
    for (const o of cases) {
      optHost.style.minHeight = '';
      optHost.innerHTML = exportCodeOptionsHtml(spec, o);
      max = Math.max(max, optHost.scrollHeight);
    }
  });

  optHost.innerHTML = liveHtml;
  optHost.style.minHeight = max + 'px';
}

export function renderExportCodePreview() {
  const pre = $('export-code-preview');
  if (!pre) return;
  const text = exportCurrentText();
  ExportUI.cache = text;
  pre.textContent = text;
  const meta = $('export-code-meta');
  if (meta) {
    const lines = text ? text.split('\n').length : 0;
    meta.textContent = `${lines} line${lines === 1 ? '' : 's'} · ${exportCodeFilename()}`;
  }
}

export function exportCodeFilename() {
  const spec = exportCurrentSpec();
  const ext = spec.extFor ? spec.extFor(ExportUI.opts) : spec.ext;
  return exportFilename(ext);
}

export function exportCodeCopy() {
  exportCopyText(ExportUI.cache || exportCurrentText(), `Copied ${exportCurrentSpec().label}`);
}

export function exportCodeDownload() {
  const spec = exportCurrentSpec();
  const text = ExportUI.cache || exportCurrentText();
  exportDownload(exportCodeFilename(), text, spec.mime);
  showStatus(`Exported ${spec.label}`);
}

// ── shortcuts used from the panels ────────────────────────────────
// The Language and Batch panels each open the dialog already pointed at
// the format that panel produces, so the common path is one click.
export function exportOpenSamples() { openExportCodeModal('samples'); }
export function exportOpenBatch() {
  if (!App.lastBatch) { showStatus('Run a batch test first'); return; }
  openExportCodeModal('batch');
}

export function exportCopyBatchQuick() {
  if (!App.lastBatch) { showStatus('Run a batch test first'); return; }
  exportCopyText(exportBatchText(App.lastBatch, { format: 'markdown' }), 'Batch results copied as Markdown');
}
