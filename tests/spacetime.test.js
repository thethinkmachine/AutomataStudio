import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHarness } from './harness.js';

// Space-time diagrams: js/spacetime.js (the model, layout and painter) and
// js/spacetime-ui.js (the section).
//
// The invariant everything rests on is the first test: **row i of the diagram
// is the tape the tracker shows at step i**, cell for cell at absolute
// positions, with the head where the tracker puts it. The model replays the
// tape log itself rather than asking each step for its window, so it is a
// second reading of the same journal — and a second reading is only worth
// having if it cannot disagree with the first.

const harness = createHarness();
const { context } = harness;

function loadExample(name) {
  harness.resetApp();
  const data = JSON.parse(readFileSync(new URL(`../js/examples/${name}.json`, import.meta.url), 'utf8'));
  context.loadData(data, true);
  return data;
}

function runWord(word) {
  const { App, streamMachine, parseMachineInput } = context;
  const parsed = parseMachineInput(App.machine, word);
  assert.ok(parsed.ok, `input ${word} should parse`);
  const run = streamMachine(App.machine, parsed.input);
  run.drain();
  return run;
}

function modelFor(run) {
  const { App, makeSpaceTime } = context;
  const model = makeSpaceTime(run.steps, { alphabet: [...App.sigma, ...App.stackAlpha] });
  model.extend(run.steps.length);
  return model;
}

/** Every row against the tracker's own view of the same step. */
function assertRowsMatchTracker(model, steps, label) {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const views = s.views || [s.view];
    views.forEach((v, t) => {
      const tr = model.tapes[t];
      const cur = model.cursor(t, i, tr.lo, tr.hi);
      v.cells.forEach((sym, k) => {
        const x = v.origin + k;
        assert.equal(cur.cells[x - tr.lo], sym, `${label}: step ${i}, tape ${t}, cell ${x}`);
      });
      assert.equal(model.headAt(t, i), v.origin + v.head, `${label}: step ${i}, tape ${t}, head`);
    });
  }
}

test('each row is the tape the tracker shows at that step', () => {
  const cases = [
    ['tm', '1011+11'],
    ['ittm', ''],
    ['lba', 'aaaa'],
    ['mtm', '1101,111,ε'],
    ['mtm-palindrome', 'abba,ε'],
    ['twdfa', 'babab']
  ];
  for (const [name, word] of cases) {
    loadExample(name);
    const run = runWord(word);
    const model = modelFor(run);
    assert.ok(model.supported, `${name}: supported`);
    assert.equal(model.rows, run.steps.length, `${name}: one row per step`);
    assertRowsMatchTracker(model, run.steps, name);
  }
});

test('rows read the same in any order, including across replay checkpoints', () => {
  // A runaway TM: walks right writing x forever, so the run is as long as the
  // budget and crosses several checkpoints.
  harness.resetApp();
  const { App, setMachine } = context;
  setMachine('TM');
  App.states.push({ id: 's0', name: 'q0', x: 0, y: 0 });
  App.startId = 's0';
  App.sigma = new Set(['a']);
  App.stackAlpha = new Set(['a', 'x', App.config.sym.blank]);
  App.transitions.push(
    { id: 't0', from: 's0', to: 's0', symbol: 'a', write: 'x', dir: 'R' },
    { id: 't1', from: 's0', to: 's0', symbol: App.config.sym.blank, write: 'x', dir: 'R' }
  );
  App.config.maxTmSteps = 900;
  const run = runWord('aaa');
  const model = modelFor(run);
  assert.ok(model.rows > 600, 'long enough to cross checkpoints');

  const tr = model.tapes[0];
  const read = i => model.cursor(0, i, tr.lo, tr.hi).cells.join('');
  const forward = [];
  const cur = model.cursor(0, 0, tr.lo, tr.hi);
  for (let i = 0; i < model.rows; i++) {
    forward.push(cur.cells.join(''));
    if (i < model.rows - 1) cur.next();
  }
  for (const i of [model.rows - 1, 0, 255, 256, 257, 511, 513, 700, 3]) {
    assert.equal(read(i), forward[i], `random access to row ${i}`);
    assert.equal(read(i), run.steps[i].view.cells.join('') + App.config.sym.blank.repeat(tr.hi - tr.lo + 1 - run.steps[i].view.cells.length),
      `row ${i} against the step's own view`);
  }
});

test('checkpoints on a growing tape cost the run, not its square', () => {
  // Each checkpoint copies the whole tape, and this tape is as wide as the run
  // is long — a copy every 256 rows would be rows² / 256 cells (7 GB at
  // 300,000 steps). Spaced by what they copy, they sum to about the rows.
  harness.resetApp();
  const { App, setMachine } = context;
  setMachine('TM');
  App.states.push({ id: 's0', name: 'q0', x: 0, y: 0 });
  App.startId = 's0';
  App.sigma = new Set(['a']);
  App.stackAlpha = new Set(['a', 'x', App.config.sym.blank]);
  App.transitions.push({ id: 't0', from: 's0', to: 's0', symbol: App.config.sym.blank, write: 'x', dir: 'R' });
  App.config.maxTmSteps = 6000;
  const run = runWord('');
  const model = modelFor(run);
  const tr = model.tapes[0];
  assert.ok(model.rows > 5000);

  const copied = tr.checkpoints.reduce((n, c) => n + c.cells.size, 0);
  assert.ok(copied <= 2 * model.rows, `${copied} cells copied for ${model.rows} rows`);
  const rows = tr.checkpoints.map(c => c.row);
  assert.deepEqual(rows.slice(0, 2), [0, 256], 'a narrow tape still gets one every 256 rows');
  assert.ok(rows.at(-1) - rows.at(-2) > 1000, 'and a wide one spaces them out');

  // Uneven spacing must not change what a row reads, least of all at the seams.
  const read = i => model.cursor(0, i, tr.lo, tr.hi).cells.join('');
  const cur = model.cursor(0, 0, tr.lo, tr.hi);
  const probes = new Set([0, model.rows - 1, 4321]);
  for (const r of rows) for (const d of [-1, 0, 1]) if (r + d >= 0 && r + d < model.rows) probes.add(r + d);
  const want = new Map();
  for (let i = 0; i < model.rows; i++) {
    if (probes.has(i)) want.set(i, cur.cells.join(''));
    if (i < model.rows - 1) cur.next();
  }
  for (const i of probes) assert.equal(read(i), want.get(i), `random access to row ${i}`);
});

test('building the diagram never pulls a step from a streaming run', () => {
  harness.resetApp();
  const { App, setMachine, streamMachine, parseMachineInput, makeSpaceTime } = context;
  setMachine('TM');
  App.states.push({ id: 's0', name: 'q0', x: 0, y: 0 });
  App.startId = 's0';
  App.sigma = new Set(['a']);
  App.stackAlpha = new Set(['a', App.config.sym.blank]);
  App.transitions.push({ id: 't0', from: 's0', to: 's0', symbol: App.config.sym.blank, write: 'a', dir: 'R' });
  App.config.maxTmSteps = 10000;

  const run = streamMachine('TM', parseMachineInput('TM', '').input);
  run.at(5);
  const known = run.known;
  const model = makeSpaceTime(run.steps, {});
  model.extend(10000);
  assert.equal(run.known, known, 'asking for more rows than exist computed nothing');
  assert.equal(model.rows, known, 'the model covers exactly what exists');

  // And it grows when the run does, from where it left off.
  run.at(40);
  model.extend(run.known);
  assert.equal(model.rows, 41);
  assertRowsMatchTracker(model, run.steps.slice(0, 41), 'grown');
});

test('columns are absolute: a two-way tape keeps every cell it ever reached', () => {
  loadExample('ittm');
  const run = runWord('');
  const model = modelFor(run);
  const lo = Math.min(...run.steps.map(s => s.view.origin));
  const hi = Math.max(...run.steps.map(s => s.view.origin + s.view.cells.length - 1));
  assert.ok(lo < 0, 'the example grows leftward');
  assert.equal(model.tapes[0].lo, lo);
  assert.equal(model.tapes[0].hi, hi);
  assert.equal(model.tapes[0].leftBound, null, 'no wall on the left');
});

test('a symbol takes its colour from Γ, not from the order it turns up in', () => {
  loadExample('tm');
  const run = runWord('1011+11');
  const { makeSpaceTime } = context;
  const a = makeSpaceTime(run.steps, { alphabet: ['0', '1', '+'] });
  const b = makeSpaceTime(run.steps, { alphabet: ['+', '1', '0'] });
  a.extend(run.steps.length);
  b.extend(run.steps.length);
  assert.deepEqual(['0', '1', '+'].map(a.slotOf), [0, 1, 2]);
  assert.deepEqual(['0', '1', '+'].map(b.slotOf), [2, 1, 0]);
  assert.equal(a.slotOf(context.App.config.sym.blank), -1, 'the blank is drawn as nothing');
  assert.deepEqual(a.symbols, ['0', '1', '+'], 'the legend is in slot order');
});

test('the text export brackets the head and ends with the verdict', () => {
  loadExample('lba');
  const run = runWord('aaaa');
  const model = modelFor(run);
  const { spaceTimeText, getState } = context;
  const text = spaceTimeText(model, { stateName: id => getState(id)?.name });
  const rows = text.split('\n').filter(l => /^\s*\d+\s/.test(l));
  assert.equal(rows.length, run.steps.length);
  rows.forEach((line, i) => {
    const v = run.steps[i].view;
    assert.ok(line.includes(`[${v.cells[v.head]}`), `row ${i} brackets the symbol under the head`);
    assert.equal((line.match(/\[/g) || []).length, 1, `row ${i} has one head`);
  });
  assert.match(text, /# ACCEPT\s*$/);
});

test('the CSV has one line per step and tape, over one shared set of columns', () => {
  loadExample('mtm');
  const run = runWord('1101,111,ε');
  const model = modelFor(run);
  const csv = context.spaceTimeCSV(model, {}).trim().split('\n');
  const header = csv[0].split(',');
  assert.deepEqual(header.slice(0, 4), ['step', 'state', 'tape', 'head']);
  assert.equal(csv.length - 1, run.steps.length * model.tapes.length);
  const lo = Math.min(...model.tapes.map(t => t.lo));
  assert.equal(header[4], String(lo));
});

test('the SVG stands alone: every colour inline, no stylesheet, no classes', () => {
  loadExample('tm');
  const run = runWord('1011+11');
  const model = modelFor(run);
  const { spaceTimeLayout, spaceTimeSVG, PRINT_STYLE, getState } = context;
  for (const cell of [3, 8, 20]) {
    const L = spaceTimeLayout(model, {
      cell, stateName: id => getState(id)?.name, caption: { title: 'Binary addition', sub: 'TM' }, legend: true
    });
    const svg = spaceTimeSVG(model, L, PRINT_STYLE, { headPath: true });
    assert.ok(svg.startsWith('<?xml'), `${cell}px: a document`);
    assert.ok(!/<style|class=|var\(--/.test(svg), `${cell}px: nothing that depends on the page`);
    assert.match(svg, /width="[\d.]+" height="[\d.]+"/);
    assert.ok(svg.includes('>ACCEPT<'), `${cell}px: the verdict is drawn`);
    assert.ok(svg.includes('>Binary addition<'), `${cell}px: the caption is drawn`);
    // Symbols are printed only once they fit in their cells.
    assert.equal(svg.includes('font-weight="500"'), cell >= 13,
      `${cell}px: glyphs drawn iff the cell holds one`);
  }
});

test('a transparent export draws no ground, and keeps the halo under the path', () => {
  loadExample('tm');
  const run = runWord('10+1');
  const model = modelFor(run);
  const { spaceTimeLayout, spaceTimeSVG, PRINT_STYLE } = context;
  const L = spaceTimeLayout(model, { cell: 6 });
  const solid = spaceTimeSVG(model, L, PRINT_STYLE, {});
  const clear = spaceTimeSVG(model, L, PRINT_STYLE, { transparent: true });
  assert.ok(solid.includes(`fill="${PRINT_STYLE.bg}"`));
  assert.ok(!clear.includes(`fill="${PRINT_STYLE.gutterBg}"`), 'no gutter panel');
  assert.ok(clear.includes(`stroke="${PRINT_STYLE.bg}"`), 'the path still has its halo');
});

test('which machines get a diagram, and of what', () => {
  const { spaceTimeKind } = context;
  for (const m of ['TM', 'ITM', 'LBA', 'MTM', '2DFA', '2NFA', '2DFT']) assert.equal(spaceTimeKind(m), 'tape', m);
  for (const m of ['DPDA', 'NPDA', 'PDA', 'QA', 'Counter', '2PDA', 'PDT']) assert.equal(spaceTimeKind(m), 'store', m);
  assert.equal(spaceTimeKind('NDTM'), 'branch', 'a search draws the branch that accepted');
  // A stack of stacks is not a row of cells, and a finite automaton has no store.
  for (const m of ['EPDA', 'DFA', 'NFA', 'Mealy', 'NBA', 'PFA']) assert.equal(spaceTimeKind(m), null, m);
});

test('the section follows the machine, and is a window-ready panel section', () => {
  harness.resetApp();
  const { App, setMachine, syncSpaceTimeSection, PANEL_SECTIONS } = context;
  const { getElement } = harness;
  const entry = PANEL_SECTIONS.rpanel.sections.find(s => s.id === 'rp-spacetime');
  assert.ok(entry, 'registered');
  assert.equal(entry.fill, '.st-view', 'the diagram is what takes a window’s spare height');
  assert.equal(entry.collapsed, true, 'collapsed in the sidebar until asked for');

  const el = getElement('rp-spacetime');
  setMachine('DFA');
  syncSpaceTimeSection();
  assert.equal(el.style.display, 'none');
  setMachine('TM');
  syncSpaceTimeSection();
  assert.equal(el.style.display, '');
  assert.equal(App.machine, 'TM');
});

test('the export plan refuses what it cannot make, and says why', () => {
  harness.resetApp();
  const { App, setMachine, _spaceTimeTests, SpaceTimeExportOpts } = context;
  const { getElement } = harness;
  setMachine('TM');
  App.states.push({ id: 's0', name: 'q0', x: 0, y: 0 });
  App.startId = 's0';
  App.sigma = new Set(['a']);
  App.stackAlpha = new Set(['a', App.config.sym.blank]);
  App.transitions.push({ id: 't0', from: 's0', to: 's0', symbol: App.config.sym.blank, write: 'a', dir: 'R' });
  App.config.maxTmSteps = 3000;
  // Stand the section up the way the page has it, so the UI's model is live.
  const sec = getElement('rp-spacetime');
  sec.style.display = '';
  sec.classList.remove('collapsed');
  const run = runWord('');
  App.simSteps = run.steps;
  App.simRun = run;
  const m = _spaceTimeTests.syncModel();
  assert.ok(m && m.rows === run.steps.length, 'the section reads the run on screen');

  const saved = { ...SpaceTimeExportOpts };
  try {
    // The head walks right every step, so this is 3000 rows by ~3000 cells.
    Object.assign(SpaceTimeExportOpts, { format: 'png', range: 'all', cell: 1, scale: 1 });
    assert.equal(_spaceTimeTests.exportPlan(m).ok, true, 'a pixel a cell fits');

    // At 8px and 3x it is ~72,000px on a side: past what one image holds.
    Object.assign(SpaceTimeExportOpts, { cell: 8, scale: 3 });
    const big = _spaceTimeTests.exportPlan(m);
    assert.equal(big.ok, false);
    assert.match(big.why, /range of steps/, 'the refusal names the way out');

    // ...and so is a vector file of it, for the same reason at a different size.
    Object.assign(SpaceTimeExportOpts, { format: 'svg', cell: 1 });
    assert.equal(_spaceTimeTests.exportPlan(m).ok, false, 'nine million cells is not an SVG');

    Object.assign(SpaceTimeExportOpts, { format: 'text', range: 'all' });
    const text = _spaceTimeTests.exportPlan(m);
    assert.equal(text.ok, true);
    assert.match(text.dim, /3,?000 lines/);
  } finally {
    Object.assign(SpaceTimeExportOpts, saved);
  }
});

// ── the overview ─────────────────────────────────────────────────
// The strip and the whole-run export count *durations* rather than reading
// every cell of every row, and merge bins as the run outgrows them. Both are
// shortcuts, so both are checked against the plain count they stand in for.

/** Every (row, cell) of the run, counted into the grid's own bins. */
function bruteGrid(model, t, grid, from = 0) {
  const { nx, ny, w, binRows, cell0, rows } = grid;
  const counts = new Uint32Array(ny * nx * 10);
  const headMin = new Array(ny).fill(Infinity);
  const headMax = new Array(ny).fill(-Infinity);
  const tr = model.tapes[t];
  const cur = model.cursor(t, from, tr.lo, tr.hi);
  for (let q = 0; q < rows; q++) {
    const i = Math.floor(q / binRows);
    cur.cells.forEach((sym, k) => {
      const s = model.slotOf(sym);
      if (s === -1) return;
      const slot = s === -2 ? 9 : Math.min(s, 8);
      const xi = Math.floor((tr.lo + k - cell0) / w);
      counts[(i * nx + xi) * 10 + slot]++;
    });
    const h = model.headAt(t, q + from);
    if (h !== null) {
      headMin[i] = Math.min(headMin[i], h);
      headMax[i] = Math.max(headMax[i], h);
    }
    if (q < rows - 1) cur.next();
  }
  return { counts, headMin, headMax };
}

function assertGridMatches(model, ov, label, from = 0) {
  const { overviewGrid } = context;
  model.tapes.forEach((_, t) => {
    const grid = overviewGrid(ov, t);
    const brute = bruteGrid(model, t, grid, from);
    assert.deepEqual([...grid.counts], [...brute.counts], `${label}: tape ${t} counts`);
    for (let i = 0; i < grid.ny; i++) {
      if (brute.headMin[i] === Infinity) continue;
      assert.equal(grid.headMin[i], brute.headMin[i], `${label}: tape ${t} bin ${i} leftmost head`);
      assert.equal(grid.headMax[i], brute.headMax[i], `${label}: tape ${t} bin ${i} rightmost head`);
    }
  });
}

/** A TM on a two-way tape that sweeps a little further each way every pass. */
function widener(limit) {
  harness.resetApp();
  const { App, setMachine } = context;
  setMachine('ITM');
  const B = App.config.sym.blank;
  App.states.push({ id: 'r', name: 'right', x: 0, y: 0 }, { id: 'l', name: 'left', x: 0, y: 0 });
  App.startId = 'r';
  App.sigma = new Set(['a']);
  App.stackAlpha = new Set(['a', 'x', B]);
  App.transitions.push(
    { id: '1', from: 'r', to: 'r', symbol: 'x', write: 'x', dir: 'R' },
    { id: '2', from: 'r', to: 'l', symbol: B, write: 'x', dir: 'L' },
    { id: '3', from: 'l', to: 'l', symbol: 'x', write: 'x', dir: 'L' },
    { id: '4', from: 'l', to: 'r', symbol: B, write: 'x', dir: 'R' },
    { id: '5', from: 'r', to: 'r', symbol: 'a', write: 'x', dir: 'R' }
  );
  App.config.maxTmSteps = limit;
}

test('the overview counts what a cell-by-cell count would, through every merge', () => {
  const { makeOverview } = context;
  const cases = [['tm', '1001+101'], ['ittm', ''], ['lba', 'aaaaaaaa'], ['mtm', '1101,111,ε'], ['twdfa', 'babab']];
  for (const [name, word] of cases) {
    loadExample(name);
    const run = runWord(word);
    const model = modelFor(run);
    // Tiny bin budgets, so a short example still merges in both directions.
    const ov = makeOverview(model, { binsY: 4, binsX: 3 });
    ov.extend();
    assert.ok(ov.binRows > 1 || model.rows <= 4, `${name}: time bins merged`);
    assertGridMatches(model, ov, name);
  }
});

test('the overview grows with a streaming run and matches a fresh build', () => {
  widener(600);
  const { streamMachine, parseMachineInput, makeSpaceTime, makeOverview, overviewGrid } = context;
  const run = streamMachine('ITM', parseMachineInput('ITM', 'a').input);
  const model = makeSpaceTime(run.steps, {});
  const grown = makeOverview(model, { binsY: 16, binsX: 8 });
  for (const upto of [3, 17, 64, 65, 200, 599]) {
    run.at(upto);
    model.extend(run.known);
    grown.extend();
    assertGridMatches(model, grown, `after ${model.rows} rows`);
  }
  assert.ok(model.tapes[0].lo < -5, 'the tape grew left while the overview was built');
  const fresh = makeOverview(model, { binsY: 16, binsX: 8 });
  fresh.extend();
  const a = overviewGrid(grown, 0);
  const b = overviewGrid(fresh, 0);
  assert.equal(a.binRows, b.binRows);
  assert.equal(a.w, b.w);
  assert.deepEqual([...a.counts], [...b.counts], 'grown by merging equals built at once');
});

test('one pass over a finished run sizes its columns before it fills them', () => {
  // A finished run reaches the strip in one extend() — ⏭, or the section
  // opened late. The columns were widened only at the end of that pass, so it
  // first made one per cell at width 1: on a tape as wide as the run, a
  // 1600 × 10 array for each of 100,000 cells, 21 seconds to merge away.
  harness.resetApp();
  const { App, setMachine, makeOverview } = context;
  setMachine('TM');
  App.states.push({ id: 's0', name: 'q0', x: 0, y: 0 });
  App.startId = 's0';
  App.sigma = new Set(['a']);
  App.stackAlpha = new Set(['a', 'x', App.config.sym.blank]);
  App.transitions.push({ id: 't0', from: 's0', to: 's0', symbol: App.config.sym.blank, write: 'x', dir: 'R' });
  App.config.maxTmSteps = 3000;
  const model = modelFor(runWord(''));
  const BY = 64, BX = 20;
  const Real = globalThis.Uint32Array;
  let columns = 0;
  globalThis.Uint32Array = class extends Real {
    constructor(...a) { super(...a); if (a[0] === BY * 10) columns++; }
  };
  let ov;
  try {
    ov = makeOverview(model, { binsY: BY, binsX: BX });
    ov.extend();
  } finally {
    globalThis.Uint32Array = Real;
  }
  assert.ok(model.tapes[0].hi - model.tapes[0].lo > 2000, 'a tape far wider than the strip');
  assert.ok(columns <= BX + 1, `${columns} columns made for a strip ${BX} wide`);
  assertGridMatches(model, ov, 'sized up front');
});

test('building an overview pulls nothing from the run', () => {
  widener(10000);
  const { streamMachine, parseMachineInput, makeSpaceTime, makeOverview } = context;
  const run = streamMachine('ITM', parseMachineInput('ITM', 'a').input);
  run.at(30);
  const known = run.known;
  const model = makeSpaceTime(run.steps, {});
  model.extend(10000);
  const ov = makeOverview(model, {});
  ov.extend();
  assert.equal(run.known, known);
  assert.equal(ov.rows, known);
});

test('a whole-run export fits any run into a bounded picture', () => {
  widener(5000);
  const {
    makeOverview, overviewGrid, wholeRunBins, wholeRunLayout,
    paintWholeRun, svgContext, PRINT_STYLE, WHOLE_RUN_MAX
  } = context;
  const run = runWord('a');
  const model = modelFor(run);
  assert.equal(model.rows, 5000);

  const bins = wholeRunBins(model, 0, model.rows - 1);
  const ov = makeOverview(model, { fixed: true, ...bins });
  ov.extend();
  assertGridMatches(model, ov, 'fixed bins');
  const grids = model.tapes.map((_, t) => overviewGrid(ov, t));
  const EL = wholeRunLayout(grids, { caption: { title: 'Widener' }, legend: true });
  assert.ok(EL.plotH <= WHOLE_RUN_MAX.h, 'the plot is bounded however long the run');
  assert.ok(EL.height < WHOLE_RUN_MAX.h + 200);

  // An SVG of it embeds the cells as one image and draws the rest as shapes.
  const fakeImg = { toDataURL: () => 'data:image/png;base64,AAAA' };
  const ctx = svgContext(EL.width, EL.height);
  paintWholeRun(ctx, model, grids, grids.map(() => fakeImg), PRINT_STYLE, EL, { legend: true, complete: true });
  const svg = ctx.toString();
  assert.equal((svg.match(/<image /g) || []).length, 1);
  assert.match(svg, /image-rendering="pixelated"/);
  assert.match(svg, /each pixel row is \d+ steps/, 'says how much it was squeezed');

  // A range starts from the tape as it stood at its first step.
  const part = makeOverview(model, { fixed: true, rowFrom: 1200, rowTo: 1300, binsY: 50, binsX: 20 });
  part.extend();
  assertGridMatches(model, part, 'a range', 1200);
});

// ── stores, branches and traces ──────────────────────────────────

/** A pushdown example's model, built the way the section builds it. */
function storeModel(name, word) {
  loadExample(name);
  const run = runWord(word);
  const { App, makeSpaceTime, _spaceTimeTests } = context;
  const model = makeSpaceTime(run.steps, {
    alphabet: [...App.sigma, ...App.stackAlpha],
    tracks: _spaceTimeTests.storeTracks(App.machine)
  });
  model.extend(run.steps.length);
  return { run, model };
}

test('a pushdown run draws its input and its store, the top as the head', () => {
  const cases = [
    ['pda', '{[()()]}', ['stack']],
    ['npda', 'abba', ['stack']],
    ['queue', 'abb#abb', ['stack']],
    ['counter', '++--', ['stack']],
    ['twopda', 'aabbcc', ['stack', 'stack2']],
    ['pdt', 'aab', ['stack']]
  ];
  for (const [name, word, stores] of cases) {
    const { run, model } = storeModel(name, word);
    const { App, isQueueAutomaton } = context;
    const transducer = context.getMachineConfig(App.machine).isTransducer;
    assert.equal(model.tapes.length, 1 + stores.length + (transducer ? 1 : 0), `${name}: one row per store`);
    run.steps.forEach((s, i) => {
      // The input, with the head on the symbol about to be read.
      const tokens = s.tokens || [];
      const inRow = model.cursor(0, i, 0, Math.max(0, tokens.length - 1)).cells;
      tokens.forEach((t, k) => assert.equal(inRow[k], t, `${name} step ${i}: input ${k}`));
      assert.equal(model.headAt(0, i), s.pos < tokens.length ? s.pos : null, `${name} step ${i}: input head`);
      stores.forEach((field, j) => {
        const t = 1 + j;
        const st = s[field] || [];
        const tr = model.tapes[t];
        const row = model.cursor(t, i, tr.lo, tr.hi).cells;
        st.forEach((sym, k) => assert.equal(row[k - tr.lo], sym, `${name} step ${i}: ${field}[${k}]`));
        for (let k = st.length; k <= tr.hi; k++) assert.equal(row[k - tr.lo], undefined, `${name} step ${i}: nothing above the top`);
        const head = isQueueAutomaton(App.machine) ? (st.length ? 0 : null) : (st.length ? st.length - 1 : null);
        assert.equal(model.headAt(t, i), head, `${name} step ${i}: ${field} head is its ${isQueueAutomaton(App.machine) ? 'front' : 'top'}`);
      });
    });
    assert.equal(model.tapes[1].leftBound, 0, `${name}: the bottom is a wall`);
    assert.equal(model.tapes[1].rightBound, null, `${name}: the top is open`);
  }
});

test('the overview follows a store as exactly as it follows a tape', () => {
  const { makeOverview } = context;
  for (const [name, word] of [['pda', '{[()()]}'], ['queue', 'abb#abb'], ['twopda', 'aaabbbccc'], ['pdt', 'abab']]) {
    const { model } = storeModel(name, word);
    const ov = makeOverview(model, { binsY: 4, binsX: 3 });
    ov.extend();
    assertGridMatches(model, ov, name);
  }
});

test('who wrote a cell: the last write, and nothing since', () => {
  for (const [name, word] of [['tm', '1011+11'], ['ittm', ''], ['mtm', '1101,111,ε']]) {
    loadExample(name);
    const run = runWord(word);
    const model = modelFor(run);
    model.tapes.forEach((tr, t) => {
      for (let row = 0; row < model.rows; row += 3) {
        for (let x = tr.lo; x <= tr.hi; x++) {
          const info = model.lastWrite(t, row, x);
          const now = model.cursor(t, row, x, x).cells[0];
          if (!info) {
            // Never written: it holds what it held at the start.
            assert.equal(model.cursor(t, 0, x, x).cells[0], now, `${name} T${t} @${x} row ${row}: unwritten means unchanged`);
            assert.ok(!tr.j.wCell.slice(0, row).includes(x), `${name} T${t} @${x} row ${row}: and no journal entry says otherwise`);
            continue;
          }
          assert.equal(tr.j.wCell[info.by], x, `${name}: step ${info.by} wrote cell ${x}`);
          assert.equal(info.row, info.by + 1);
          assert.ok(info.row <= row);
          assert.ok(!tr.j.wCell.slice(info.row, row).includes(x), `${name} T${t} @${x}: no later write before row ${row}`);
          assert.equal(model.cursor(t, info.row, x, x).cells[0], now, `${name}: what it wrote is what is there`);
        }
      }
    });
  }
});

test('who wrote a stack cell: the step that changed it', () => {
  const { model } = storeModel('pda', '{[()()]}');
  const t = 1;
  const tr = model.tapes[t];
  for (let row = 1; row < model.rows; row++) {
    for (let x = tr.lo; x <= tr.hi; x++) {
      const info = model.lastWrite(t, row, x);
      const at = r => model.cursor(t, r, x, x).cells[0];
      if (!info) { for (let r = 1; r <= row; r++) assert.equal(at(r), at(0)); continue; }
      assert.notEqual(at(info.row), at(info.by), 'the write changed the cell');
      for (let r = info.row; r <= row; r++) assert.equal(at(r), at(row), 'and nothing changed it since');
    }
  }
  assert.equal(model.lastWrite(0, 5, 0), null, 'the input is never written');
});

test("an NDTM's accepting branch is a real computation, root to accept", () => {
  loadExample('ndtm');
  const run = runWord('111111');
  const { acceptingBranch, getTransition, App } = context;
  const last = run.steps[run.steps.length - 1];
  assert.equal(last.final, 'accept');
  const path = acceptingBranch(run.steps);
  assert.ok(path, 'found');
  assert.equal(path.steps[0].parent, null, 'it starts at the root');
  assert.equal(path.steps[path.steps.length - 1], last, 'it ends on the accept');
  assert.equal(path.steps.length - 1, last.depth, 'one row per level of the search');
  for (let r = 1; r < path.steps.length; r++) {
    const a = path.steps[r - 1];
    const b = path.steps[r];
    assert.equal(b.parent, a.branch, `row ${r} was expanded from row ${r - 1}`);
    const tr = getTransition(b.via);
    assert.ok(tr, `row ${r} names the transition that led to it`);
    assert.equal(tr.from, a.state);
    assert.equal(tr.to, b.state);
    assert.equal(run.steps[path.stepOfRow[r]], b, 'and the way back to the search step');
    assert.equal(path.rowOfStep.get(path.stepOfRow[r]), r);
  }
  // Drawn, it is a timeline like any other: every row is its step's tape.
  const model = context.makeSpaceTime(path.steps, { alphabet: [...App.sigma, ...App.stackAlpha] });
  model.extend(path.steps.length);
  assertRowsMatchTracker(model, path.steps, 'accepting branch');

  // A rejected word has no branch to draw.
  const rejected = runWord('11111');
  assert.equal(acceptingBranch(rejected.steps), null);
});

test('measuring a run leaves the player exactly where it was', () => {
  loadExample('pda');
  const { App, traceMachine, parseMachineInput, runSim } = context;
  const { getElement } = harness;
  getElement('sim-in').value = '()';
  runSim();
  const steps = App.simSteps;
  const idx = App.simIdx;
  const run = App.simRun;
  const traced = traceMachine('PDA', parseMachineInput('PDA', '{[()()]}').input);
  assert.ok(traced.done && traced.steps.length > steps.length, 'the measured run is its own');
  assert.equal(App.simSteps, steps, 'the steps on screen are still the ones on screen');
  assert.equal(App.simIdx, idx);
  assert.equal(App.simRun, run);
});

test('a reset puts the overview strip away with the diagram', () => {
  loadExample('ittm');
  const { App, runSim, resetSim, stepToEnd, _spaceTimeTests: t } = context;
  const sec = harness.getElement('rp-spacetime');
  sec.style.display = '';
  sec.classList.remove('collapsed');
  harness.getElement('sim-in').value = '';
  runSim();
  stepToEnd();
  assert.ok(App.simSteps.length > 100, 'a run long enough to want a strip');
  assert.equal(t.stripOn, true, 'the strip is out beside a long diagram');
  assert.equal(t.els.strip.hidden, false);

  resetSim();
  assert.equal(t.stripOn, false, 'reset takes the strip away');
  assert.equal(t.els.strip.hidden, true, 'and it is no longer on screen');
  assert.equal(t.els.scroll.style.right, '', 'the diagram gets its width back');
  assert.equal(t.overview, null, 'nothing of the old run is kept');

  // And the next run brings it back, built from that run.
  runSim();
  stepToEnd();
  assert.equal(t.stripOn, true);
  assert.equal(t.els.strip.hidden, false);
});

test('a reset lets go of the diagram even with the section folded away', () => {
  // The diagram only indexes for a section someone can see, and it used to
  // only let go there too: fold it, reset, and the model kept every step of
  // the run alive — 819 MB for a 100,000-step runaway machine.
  loadExample('ittm');
  const { App, runSim, resetSim, stepToEnd, _spaceTimeTests: t } = context;
  const sec = harness.getElement('rp-spacetime');
  sec.style.display = '';
  sec.classList.remove('collapsed');
  harness.getElement('sim-in').value = '';
  runSim();
  stepToEnd();
  assert.ok(t.model && t.model.source === App.simSteps, 'the open section built a model');

  sec.classList.add('collapsed');
  resetSim();
  assert.equal(t.model, null, 'the model goes with the run');
  assert.equal(t.layout, null);
  assert.equal(t.overview, null);

  // A new run while folded is the same case: the old model is not the run on screen.
  sec.classList.remove('collapsed');
  runSim();
  stepToEnd();
  const first = t.model;
  sec.classList.add('collapsed');
  runSim();
  assert.notEqual(t.model, first, 'the previous run is not kept for a folded section');
});

test('a reset drops the whole-run export built from the old run', () => {
  loadExample('ittm');
  const { App, runSim, resetSim, stepToEnd, SpaceTimeExportOpts, _spaceTimeTests: t } = context;
  const sec = harness.getElement('rp-spacetime');
  sec.style.display = '';
  sec.classList.remove('collapsed');
  harness.getElement('sim-in').value = '';
  runSim();
  stepToEnd();
  const saved = { ...SpaceTimeExportOpts };
  try {
    Object.assign(SpaceTimeExportOpts, { format: 'png', size: 'whole', range: 'all' });
    t.exportPlan(t.syncModel());
    assert.ok(t.wholeCache && t.wholeCache.model.source === App.simSteps, 'the export cached the run');
    resetSim();
    assert.equal(t.wholeCache, null, 'and the cache goes with it');
  } finally {
    Object.assign(SpaceTimeExportOpts, saved);
  }
});
