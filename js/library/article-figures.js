// ══════════════════════════════════════════════════════════════════
//  AN ESSAY'S FIGURES, DRAWN FROM THE MACHINE
// ══════════════════════════════════════════════════════════════════
// What `::: spacetime` and `::: growth` draw in an article (article.js). Each
// is computed from the machine's standard code at build time — the essay says
// what to look at, the machine supplies the picture — and returned as an SVG
// string inked by classes, like every other figure in the library
// (sketch.js), so it is right in the light scheme and the dark one.
//
// Import-free. A run is bounded by `maxSteps`: BB(5) is 47 million steps and
// takes about half a second here; a machine that has not halted by the budget
// is drawn up to it, and the caption's numbers come from the library's own
// analysis rather than from this loop.

function tableOf(code) {
  const groups = String(code || '').split('_').filter(Boolean);
  if (!groups.length || groups[0].length % 3) return null;
  const K = groups[0].length / 3;
  const table = [];
  for (const g of groups) {
    if (g.length !== K * 3) return null;
    const row = [];
    for (let s = 0; s < K; s++) {
      const m = /^(\d)([LR])([A-Z])$/.exec(g.slice(s * 3, s * 3 + 3));
      if (!m) { row.push(null); continue; }
      const next = m[3].charCodeAt(0) - 65;
      row.push({ write: Number(m[1]), move: m[2] === 'L' ? -1 : 1, next: next < groups.length ? next : -1 });
    }
    table.push(row);
  }
  return table;
}

/**
 * Run a standard-format machine from a blank tape, calling `see(t, tape, head,
 * ones)` before step t for every t that `want(t)` accepts. Returns the run's
 * end: { steps, ones, halted, lo, hi } with lo/hi the cells visited.
 */
export function runStandard(code, { maxSteps = 1e8, want = () => false, see = () => {} } = {}) {
  const table = tableOf(code);
  if (!table) return null;
  const N = 1 << 20;
  const tape = new Uint8Array(N);
  let head = N >> 1, state = 0, t = 0, ones = 0, lo = head, hi = head, halted = false;
  while (t < maxSteps) {
    if (want(t)) see(t, tape, head, ones);
    const op = table[state]?.[tape[head]];
    if (!op) { halted = true; break; }
    ones += (op.write ? 1 : 0) - (tape[head] ? 1 : 0);
    tape[head] = op.write;
    head += op.move;
    t++;
    if (head < lo) lo = head;
    if (head > hi) hi = head;
    if (op.next < 0) { halted = true; break; }
    if (head <= 0 || head >= N - 1) break;
    state = op.next;
  }
  see(t, tape, head, ones);
  return { steps: t, ones, halted, lo: lo - (N >> 1), hi: hi - (N >> 1) };
}

const r1 = v => Math.round(v * 10) / 10;
const count = n => Number(n).toLocaleString('en-US');

/**
 * The run's first `steps` steps as a space-time diagram: time runs down, one
 * row per sampled step, a cell inked when it holds a non-blank symbol, and the
 * head's path drawn over the top in the family's hue.
 */
export function spacetimeSvg(code, { steps = 2000, w = 680, h = 420 } = {}) {
  const rows = [];
  const every = Math.max(1, Math.ceil(steps / h));
  const end = runStandard(code, {
    maxSteps: steps,
    want: t => t % every === 0,
    see: (t, tape, head) => {
      const on = [];
      let a = -1;
      // Store the tape as runs of non-blank cells, relative to the start.
      const mid = tape.length >> 1;
      for (let x = mid - 4096; x <= mid + 4096; x++) {
        const v = tape[x];
        if (v && a < 0) a = x;
        if (!v && a >= 0) { on.push([a - mid, x - mid, tape[a]]); a = -1; }
      }
      rows.push({ t, head: head - mid, on });
    }
  });
  if (!end) return null;
  let lo = 0, hi = 0;
  for (const r of rows) { lo = Math.min(lo, r.head); hi = Math.max(hi, r.head); for (const [a, b] of r.on) { lo = Math.min(lo, a); hi = Math.max(hi, b - 1); } }
  const pad = 14, span = hi - lo + 1;
  const cw = (w - 2 * pad) / span, rh = (h - 2 * pad) / rows.length;
  const X = c => pad + (c - lo) * cw, Y = i => pad + i * rh;
  const out = [`<svg class="sk sk-run essay-st" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Space-time diagram of the first ${count(end.steps)} steps from a blank tape">`];
  rows.forEach((r, i) => {
    for (const [a, b, v] of r.on) out.push(`<rect class="rn-${Math.min(v, 4)}" x="${r1(X(a))}" y="${r1(Y(i))}" width="${r1(Math.max(cw * (b - a), .6))}" height="${r1(rh + .15)}"/>`);
  });
  // The head's path, only when every step has its row: sampled, it would join
  // positions many steps apart and draw a zigzag the machine never made.
  if (every === 1) out.push(`<path class="st-head" d="${rows.map((r, i) => `${i ? 'L' : 'M'}${r1(X(r.head) + cw / 2)} ${r1(Y(i) + rh / 2)}`).join('')}"/>`);
  out.push('</svg>');
  return out.join('');
}

/**
 * Non-blank cells on the tape against time, over the whole run (or up to the
 * budget), with time on a log scale by default — so a run that spends 64% of
 * itself in its last stage still shows its first ones.
 */
export function growthSvg(code, { maxSteps = 1e8, w = 680, h = 300, scale = 'log', yScale = 'linear' } = {}) {
  const pts = [];
  const log = scale === 'log';
  // Sample points: log-spaced, dense enough that each stage's plateau is drawn.
  const marks = new Set();
  if (log) for (let k = 0; k <= 2400; k++) marks.add(Math.floor(Math.pow(10, k / 300)));
  let every = 0;
  const end0 = log ? null : runStandard(code, { maxSteps });
  if (!log) every = Math.max(1, Math.floor((end0?.steps || maxSteps) / 1200));
  let peak = 0;
  const end = runStandard(code, {
    maxSteps,
    want: t => (log ? marks.has(t) : t % every === 0),
    see: (t, _tape, _h, ones) => { pts.push([t, ones]); if (ones > peak) peak = ones; }
  });
  if (!end || pts.length < 2) return null;
  const T = Math.max(end.steps, 10);
  const ylog = yScale === 'log';
  const Ymax = ylog ? 10 ** Math.ceil(Math.log10(Math.max(peak, 10))) : niceCeil(Math.max(peak, end.ones, 1));
  const L = 64, R = 16, Tp = 14, B = 34;
  const xOf = t => L + (log ? Math.log10(Math.max(t, 1)) / Math.log10(T) : t / T) * (w - L - R);
  const yOf = v => h - B - (ylog ? Math.log10(Math.max(v, 1)) / Math.log10(Ymax) : v / Ymax) * (h - Tp - B);
  const out = [`<svg class="sk essay-growth" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Non-blank cells against steps${log ? ', steps on a log scale' : ''}">`];
  // Axes: gridlines at powers of ten along time, four along cells.
  const xt = log ? Array.from({ length: Math.floor(Math.log10(T)) + 1 }, (_, k) => 10 ** k) : niceTicks(T);
  for (const t of xt) {
    const x = r1(xOf(t));
    out.push(`<line class="gr-grid" x1="${x}" y1="${Tp}" x2="${x}" y2="${h - B}"/>`);
    out.push(`<text class="gr-tick" x="${x}" y="${h - B + 18}" text-anchor="middle">${log ? tenTo(t) : count(t)}</text>`);
  }
  for (const v of ylog ? Array.from({ length: Math.log10(Ymax) + 1 }, (_, k) => 10 ** k) : niceTicks(Ymax)) {
    const y = r1(yOf(v));
    out.push(`<line class="gr-grid" x1="${L}" y1="${y}" x2="${w - R}" y2="${y}"/>`);
    out.push(`<text class="gr-tick" x="${L - 8}" y="${y + 4}" text-anchor="end">${count(v)}</text>`);
  }
  out.push(`<line class="gr-axis" x1="${L}" y1="${h - B}" x2="${w - R}" y2="${h - B}"/>`);
  // A step curve: the count holds until the next sample.
  let d = '';
  pts.forEach(([t, v], i) => { const x = r1(xOf(t)), y = r1(yOf(v)); d += i ? `H${x}V${y}` : `M${x} ${y}`; });
  out.push(`<path class="gr-line" d="${d}"/>`);
  if (end.halted) out.push(`<circle class="gr-end" cx="${r1(xOf(end.steps))}" cy="${r1(yOf(end.ones))}" r="3.5"/>`);
  out.push('</svg>');
  return out.join('');
}

function tenTo(t) {
  const k = Math.round(Math.log10(t));
  const sup = String(k).split('').map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]).join('');
  return k === 0 ? '1' : k === 1 ? '10' : `10${sup}`;
}
function niceCeil(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
function niceTicks(max) {
  const p = 10 ** Math.floor(Math.log10(max / 4));
  const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(x => max / x <= 6) || max / 4;
  const out = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

/** A figure by kind — what the worker and the build both call. */
export function drawStandardFigure(kind, code, opts = {}) {
  if (kind === 'spacetime') return spacetimeSvg(code, opts);
  if (kind === 'growth') return growthSvg(code, opts);
  return null;
}
