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
const ExportImageOpts = {
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

function openExportImageModal() {
  if (!exportRequireMachine()) return;
  ExportImageOpts.scale = App.config.exportRes || 2;
  renderExportImageModal();
  showOverlay('export-image-modal');
}

function setExportImageOpt(key, value) {
  if (key === 'scale' || key === 'padding') value = Number(value);
  if (key === 'crop' || key === 'includeNotes' || key === 'includeDividers' || key === 'embedData') value = !!value;
  ExportImageOpts[key] = value;
  if (key === 'scale') App.config.exportRes = value;
  renderExportImageModal();
}

function exportImageDimensions() {
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

function renderExportImageModal() {
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
function exportResolveBackground() {
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

function runImageExport() {
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

// Option schema types: 'check' (boolean), 'select' (choices), 'number'.
const ExportFormats = {
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
    blurb: 'Accepted and rejected words in shortlex order, derived from the machine itself. A proven repeating configuration (loop) is counted as reject; runs that reach the step limit without a verdict are skipped as undecided (the JSON export includes their count).',
    options: [
      { id: 'format', type: 'select', label: 'As', def: 'csv', choices: [['csv', 'CSV'], ['json', 'JSON'], ['batch', 'Batch-test input'], ['markdown', 'Markdown']] },
      { id: 'accepted', type: 'number', label: 'Accepted words', def: 25, min: 0, max: 500, step: 5 },
      { id: 'rejected', type: 'number', label: 'Rejected words', def: 25, min: 0, max: 500, step: 5 },
      { id: 'maxLength', type: 'number', label: 'Max length', def: 10, min: 1, max: 24, step: 1 }
    ],
    extFor: o => (o.format === 'json' ? 'json' : o.format === 'markdown' ? 'md' : o.format === 'batch' ? 'txt' : 'csv'),
    build: (ir, o) => {
      const samples = exportSampleWords(o);
      if (!samples.decidable) return '# This machine has no accept/reject notion, so L(M) cannot be sampled.';
      return exportSamplesText(samples, ir, { format: o.format });
    }
  },
  batch: {
    label: 'Batch test results', group: 'Results', ext: 'csv', mime: 'text/csv',
    blurb: 'The most recent run from the Batch Test panel.',
    options: [
      { id: 'format', type: 'select', label: 'As', def: 'csv', choices: [['csv', 'CSV'], ['json', 'JSON'], ['markdown', 'Markdown']] }
    ],
    extFor: o => (o.format === 'json' ? 'json' : o.format === 'markdown' ? 'md' : 'csv'),
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
};

const ExportUI = { format: 'dot', opts: {}, cache: '' };

registerModal('export-code-modal', {
  dismissOnBackdrop: true,
  submit: () => exportCodeDownload()
});

function exportDefaultOpts(key) {
  const spec = ExportFormats[key];
  const o = {};
  (spec.options || []).forEach(opt => { o[opt.id] = opt.def; });
  return o;
}

function openExportCodeModal(initial) {
  if (!exportRequireMachine()) return;
  const key = initial && ExportFormats[initial] ? initial : ExportUI.format;
  selectExportFormat(key, true);
  showOverlay('export-code-modal');
}

function selectExportFormat(key, keepOpen) {
  if (!ExportFormats[key]) return;
  ExportUI.format = key;
  ExportUI.opts = exportDefaultOpts(key);
  renderExportCodeModal();
  if (!keepOpen) renderExportCodePreview();
}

function setExportCodeOpt(id, value, type) {
  if (type === 'number') value = Number(value);
  if (type === 'check') value = !!value;
  ExportUI.opts[id] = value;
  renderExportCodeModal();
}

function exportCurrentSpec() { return ExportFormats[ExportUI.format]; }

function exportCurrentText() {
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

function renderExportCodeModal() {
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

  const controls = (spec.options || []).map(opt => {
    const val = ExportUI.opts[opt.id];
    if (opt.type === 'check') {
      return `<label class="exp-check"><input type="checkbox" ${val ? 'checked' : ''}
        onchange="setExportCodeOpt('${opt.id}', this.checked, 'check')"><span>${opt.label}</span>${opt.hint ? `<em>${opt.hint}</em>` : ''}</label>`;
    }
    if (opt.type === 'select') {
      return `<label class="exp-field"><span>${opt.label}</span>
        <select class="inp" onchange="setExportCodeOpt('${opt.id}', this.value, 'select')">
          ${opt.choices.map(([v, l]) => `<option value="${v}" ${val === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>`;
    }
    if (opt.type === 'text') {
      return `<label class="exp-field"><span>${opt.label}</span>
        <input class="inp" type="text" value="${escapeHtml(val)}"
          onchange="setExportCodeOpt('${opt.id}', this.value, 'text')"></label>`;
    }
    return `<label class="exp-field"><span>${opt.label}</span>
      <input class="inp exp-num" type="number" value="${val}"
        ${opt.min !== undefined ? `min="${opt.min}"` : ''} ${opt.max !== undefined ? `max="${opt.max}"` : ''}
        ${opt.step !== undefined ? `step="${opt.step}"` : ''}
        onchange="setExportCodeOpt('${opt.id}', this.value, 'number')"></label>`;
  }).join('');

  optHost.innerHTML = (spec.blurb ? `<div class="exp-blurb">${spec.blurb}</div>` : '')
    + (controls ? `<div class="exp-opts">${controls}</div>` : '');

  renderExportCodePreview();
}

function renderExportCodePreview() {
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

function exportCodeFilename() {
  const spec = exportCurrentSpec();
  const ext = spec.extFor ? spec.extFor(ExportUI.opts) : spec.ext;
  return exportFilename(ext);
}

function exportCodeCopy() {
  exportCopyText(ExportUI.cache || exportCurrentText(), `Copied ${exportCurrentSpec().label}`);
}

function exportCodeDownload() {
  const spec = exportCurrentSpec();
  const text = ExportUI.cache || exportCurrentText();
  exportDownload(exportCodeFilename(), text, spec.mime);
  showStatus(`Exported ${spec.label}`);
}

// ── shortcuts used from the panels ────────────────────────────────
// The Language and Batch panels each open the dialog already pointed at
// the format that panel produces, so the common path is one click.
function exportOpenSamples() { openExportCodeModal('samples'); }
function exportOpenBatch() {
  if (!App.lastBatch) { showStatus('Run a batch test first'); return; }
  openExportCodeModal('batch');
}

function exportCopyBatchQuick() {
  if (!App.lastBatch) { showStatus('Run a batch test first'); return; }
  exportCopyText(exportBatchText(App.lastBatch, { format: 'markdown' }), 'Batch results copied as Markdown');
}
