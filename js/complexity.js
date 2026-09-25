// ══════════════════════════════════════════════════════════════════
//  THE COMPLEXITY PROFILE — how a machine's runs grow with its input
// ══════════════════════════════════════════════════════════════════
//  Run the machine on inputs of length 1, 2, … n and measure each run:
//  how many steps it took and how much store it used. Plotted against n,
//  "this machine is O(n²)" stops being a claim and becomes a curve.
//
//  Two ways to choose the inputs, because they answer different
//  questions:
//
//  • **Every word of length n** — worst case over Σⁿ, which is what a time
//    bound is a statement about. Σⁿ is exponential, so past a cap the words
//    are a *sample*: always the homogeneous words (aaaa, bbbb), which are
//    the worst case for a remarkable number of textbook machines, plus a
//    seeded random draw, so the same profile run twice is the same profile.
//  • **A family** — `a^n b^n`, `1^n+1^n`, `(ab)^{2n}`: one structured input
//    per n. Most machines worth profiling only do real work on inputs of a
//    shape, and a random word of Σⁿ is rejected on its first symbol.
//
//  Measuring never touches the run on screen: `traceMachine` runs from the
//  machine's own start, paints nothing and puts the player's run back.
//
//  DOM-free. The section around it is js/complexity-ui.js.
// ══════════════════════════════════════════════════════════════════

import { App } from './state.js';
import { parseMachineInput, traceMachine } from './machines/index.js';
import { stepJournals } from './tape-log.js';

// ── a family of inputs ────────────────────────────────────────────
//
//   pattern := item*
//   item    := atom ( '^' count )?
//   atom    := '(' pattern ')' | any other character
//   count   := 'n' | digits | '{' a·n + b '}'      e.g. {2n}, {n+1}, {2n-1}
//
// Whitespace is kept: the run box already splits symbols on it, so
// `ab^n c` means what it reads as.

function parseCount(src, i) {
  if (src[i] === 'n') return { at: i + 1, a: 1, b: 0 };
  let m = /^\d+/.exec(src.slice(i));
  if (m) return { at: i + m[0].length, a: 0, b: Number(m[0]) };
  if (src[i] !== '{') throw new Error(`After ^ put n, a number, or {2n+1} — found “${src[i] ?? 'the end'}”`);
  const close = src.indexOf('}', i);
  if (close < 0) throw new Error('A { after ^ needs its }');
  const body = src.slice(i + 1, close).replace(/\s+/g, '');
  m = /^(\d*)n(?:([+-])(\d+))?$/.exec(body) || /^(\d+)$/.exec(body);
  if (!m) throw new Error(`“{${body}}” is not a count — write it as {n}, {2n}, {n+1} or {2n-1}`);
  if (m.length === 2) return { at: close + 1, a: 0, b: Number(m[1]) };
  const a = m[1] === '' ? 1 : Number(m[1]);
  const b = m[2] ? (m[2] === '-' ? -1 : 1) * Number(m[3]) : 0;
  return { at: close + 1, a, b };
}

function parseSeq(src, i, depth) {
  const items = [];
  while (i < src.length) {
    const c = src[i];
    if (c === ')') {
      if (!depth) throw new Error('A ) with no ( before it');
      return { items, at: i };
    }
    let atom;
    if (c === '(') {
      const inner = parseSeq(src, i + 1, depth + 1);
      if (src[inner.at] !== ')') throw new Error('A ( with no ) after it');
      atom = { group: inner.items };
      i = inner.at + 1;
    } else if (c === '^' || c === '{' || c === '}') {
      throw new Error(`“${c}” has nothing before it to repeat`);
    } else {
      atom = { text: c };
      i += 1;
    }
    if (src[i] === '^') {
      const count = parseCount(src, i + 1);
      atom.count = count;
      i = count.at;
    }
    items.push(atom);
  }
  if (depth) throw new Error('A ( with no ) after it');
  return { items, at: i };
}

/** Parse a family pattern once; throws with a sentence a reader can act on. */
export function parseFamily(pattern) {
  const src = String(pattern ?? '');
  if (!src.trim()) throw new Error('Write a pattern such as a^n b^n');
  const { items } = parseSeq(src, 0, 0);
  if (!usesN(items)) throw new Error('The pattern never uses n, so every length gives the same word');
  return items;
}

function usesN(items) {
  return items.some(it => (it.count && it.count.a > 0) || (it.group && usesN(it.group)));
}

function expandItems(items, n) {
  let out = '';
  for (const it of items) {
    const body = it.group ? expandItems(it.group, n) : it.text;
    const times = it.count ? Math.max(0, it.count.a * n + it.count.b) : 1;
    out += body.repeat(times);
  }
  return out;
}

/** The family's word for this n. */
export function expandFamily(pattern, n) {
  return expandItems(parseFamily(pattern), n);
}

// ── every word of a length, or a fair sample of them ─────────────

/** A small seeded generator, so a sampled profile is the same profile twice. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Words of length n over `symbols`, as raw run-box text. All of them when
 * there are at most `cap`; otherwise the homogeneous words and a seeded
 * random draw up to `cap`.
 */
export function wordsOfLength(symbols, n, cap = 64) {
  const syms = [...symbols];
  if (!syms.length) return [];
  const joiner = syms.some(s => String(s).length > 1) ? ' ' : '';
  const text = arr => arr.join(joiner);
  if (n === 0) return [''];
  const total = Math.pow(syms.length, n);
  if (total <= cap) {
    const out = [];
    const idx = new Array(n).fill(0);
    for (let k = 0; k < total; k++) {
      out.push(text(idx.map(i => syms[i])));
      for (let p = n - 1; p >= 0; p--) {
        if (++idx[p] < syms.length) break;
        idx[p] = 0;
      }
    }
    return out;
  }
  const seen = new Set();
  const out = [];
  const add = w => { if (!seen.has(w)) { seen.add(w); out.push(w); } };
  syms.forEach(s => add(text(new Array(n).fill(s))));
  const rnd = mulberry32(0x9e3779b9 ^ (n * 2654435761));
  let guard = cap * 20;
  while (out.length < cap && guard-- > 0) {
    add(text(Array.from({ length: n }, () => syms[Math.floor(rnd() * syms.length)])));
  }
  return out;
}

/** The symbols a run box word is made of: Σ, less ε. */
export function inputSymbols() {
  return [...(App.sigma || [])].filter(s => s !== App.config.sym.eps);
}

// ── measuring one run ─────────────────────────────────────────────

/**
 * How far the heads travelled, summed over tapes: the cells visited, which is
 * what space complexity counts. Read from the tape journals when the run has
 * them — one array per tape, no window rebuilt per step.
 */
function cellsVisited(steps) {
  const journals = stepJournals(steps[0]);
  if (journals) {
    let sum = 0;
    for (const j of journals) {
      let lo = Infinity;
      let hi = -Infinity;
      const n = Math.min(steps.length, j.heads.length);
      for (let i = 0; i < n; i++) {
        const h = j.heads[i];
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
      if (hi >= lo) sum += hi - lo + 1;
    }
    return sum;
  }
  // Stored views — the two-way heads, an NDTM branch.
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of steps) {
    const views = s.views || (s.view ? [s.view] : []);
    for (const v of views) {
      if (!v || v.head < 0) continue;
      const h = (v.origin || 0) + v.head;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  return hi >= lo ? hi - lo + 1 : 0;
}

/** The tallest the store got: both stacks of a 2PDA together. */
function storeHeight(steps) {
  let max = 0;
  for (const s of steps) {
    const h = (s.stack ? s.stack.length : 0) + (s.stack2 ? s.stack2.length : 0);
    if (h > max) max = h;
  }
  return max;
}

/**
 * One word, run and measured: `{ steps, space, verdict }`, or `{ error }` when
 * the word is not one this machine can read.
 *
 * `steps` is the transitions taken on the run the player would show — for a
 * search-based machine, the computation it found, not the search.
 */
export function measureWord(m, raw, space = 'cells') {
  const parsed = parseMachineInput(m, raw);
  if (!parsed.ok) return { error: parsed.error };
  const run = traceMachine(m, parsed.input);
  const steps = run.steps;
  if (!steps.length) return { error: 'The machine produced no steps.' };
  const last = steps[steps.length - 1];
  return {
    steps: steps.length - 1,
    space: space === 'store' ? storeHeight(steps) : cellsVisited(steps),
    verdict: last.final || 'reject',
    limited: last.final === 'timeout'
  };
}

// ── the profile ───────────────────────────────────────────────────

/**
 * The inputs a profile will run, length by length.
 * @param plan { mode: 'all' | 'family', pattern, from, to, cap }
 */
export function profileInputs(plan) {
  const out = [];
  const from = Math.max(0, Math.floor(plan.from));
  const to = Math.max(from, Math.floor(plan.to));
  const items = plan.mode === 'family' ? parseFamily(plan.pattern) : null;
  const syms = plan.symbols || inputSymbols();
  for (let n = from; n <= to; n++) {
    out.push({ n, words: items ? [expandItems(items, n)] : wordsOfLength(syms, n, plan.cap || 64) });
  }
  return out;
}

function emptyRow(n, words) {
  return {
    n,
    size: words.length,
    wordLength: n,
    count: 0,
    worst: null,
    worstWord: null,
    sum: 0,
    spaceWorst: null,
    spaceWord: null,
    spaceSum: 0,
    verdicts: { accept: 0, reject: 0, loop: 0, timeout: 0 },
    limited: 0,
    errors: 0,
    error: null
  };
}

/**
 * The profile, a word at a time.
 *
 * A generator so the caller decides how much to run before giving the page
 * back — a Turing machine word can be its whole step budget, and a profile is
 * dozens of them. Yields `{ row, word, index, total }` after every word and
 * `{ row, done: true }` when a length is finished; `row` accumulates.
 */
export function* profileRun(m, plan) {
  const lengths = profileInputs(plan);
  const total = lengths.reduce((k, l) => k + l.words.length, 0);
  let index = 0;
  for (const { n, words } of lengths) {
    const row = emptyRow(n, words);
    for (const w of words) {
      const r = measureWord(m, w, plan.space);
      index++;
      if (r.error) {
        row.errors++;
        row.error = r.error;
      } else {
        row.count++;
        row.sum += r.steps;
        row.spaceSum += r.space;
        if (row.worst === null || r.steps > row.worst) { row.worst = r.steps; row.worstWord = w; }
        if (row.spaceWorst === null || r.space > row.spaceWorst) { row.spaceWorst = r.space; row.spaceWord = w; }
        const v = r.verdict in row.verdicts ? r.verdict : 'reject';
        row.verdicts[v]++;
        if (r.limited) row.limited++;
      }
      yield { row, word: w, index, total };
    }
    yield { row, done: true, index, total };
  }
}

// ── how it grows ──────────────────────────────────────────────────

function fitLine(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 1;
  return { slope, r2 };
}

/** Every value within `tol` of their mean, relative to it. */
function steady(xs, tol) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (!mean) return false;
  return xs.every(x => Math.abs(x - mean) <= Math.abs(mean) * tol);
}

const SUPERSCRIPT = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '.': '˙' };
const sup = s => String(s).split('').map(c => SUPERSCRIPT[c] ?? c).join('');

/**
 * A reading of how `points` grow, from the points themselves: a power of n
 * (the slope on log–log axes) or, when each step up in n multiplies the value
 * by about the same factor, an exponential. It is an estimate from a handful
 * of lengths, and says so — `null` when there are too few to say anything.
 *
 * @param points [{ n, v, limited }] — limited points (the run hit its budget)
 *        are left out: their true value is only known to be at least v.
 */
export function growthEstimate(points) {
  const pts = points.filter(p => p.n >= 1 && p.v > 0 && !p.limited);
  if (pts.length < 4) return null;
  // The tail says more about growth than the start, where constant costs
  // dominate — the last six lengths, or all of them if fewer.
  const tail = pts.slice(-6);
  if (tail.every(p => p.v === tail[0].v)) {
    return { kind: 'constant', label: 'constant', detail: 'the same at every length' };
  }

  // Finite differences first, when the lengths are consecutive. A slope on
  // log–log axes is thrown by a constant: n + 1 over n = 1..7 has a slope of
  // 0.83 and would be called sublinear. Differences are not — the first
  // differences of any line are constant, the second of any parabola — and a
  // machine's step count is very often exactly such a polynomial.
  const consecutive = tail.every((p, i) => i === 0 || p.n === tail[i - 1].n + 1);
  if (consecutive) {
    let diffs = tail.map(p => p.v);
    for (const [deg, label] of [[1, 'linear'], [2, 'quadratic'], [3, 'cubic']]) {
      diffs = diffs.slice(1).map((v, i) => v - diffs[i]);
      if (diffs.length < 2) break;
      if (diffs.every(d => d > 0) && steady(diffs, 0.12)) {
        return { kind: 'power', label, detail: `the ${['', 'first', 'second', 'third'][deg]} differences are steady`, exponent: deg };
      }
    }
    // Exponential: each step up in n multiplies by the same factor. Over a
    // short tail a polynomial's ratios look nearly steady too — but they
    // drift down towards 1, and an exponential's do not.
    const ratios = tail.slice(1).map((p, i) => p.v / tail[i].v);
    const meanRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const drifting = ratios[ratios.length - 1] < ratios[0] * 0.93;
    if (meanRatio > 1.25 && !drifting && steady(ratios, 0.1)) {
      return { kind: 'exponential', label: `≈ ${meanRatio.toFixed(2)}ⁿ`, detail: `×${meanRatio.toFixed(2)} per extra symbol`, base: meanRatio };
    }
  }

  const poly = fitLine(tail.map(p => Math.log(p.n)), tail.map(p => Math.log(p.v)));
  const expo = fitLine(tail.map(p => p.n), tail.map(p => Math.log(p.v)));
  const base = Math.exp(expo.slope);
  if (base > 1.25 && expo.r2 > poly.r2 && expo.r2 > 0.97) {
    return { kind: 'exponential', label: `≈ ${base.toFixed(2)}ⁿ`, detail: `×${base.toFixed(2)} per extra symbol`, base };
  }
  const k = poly.slope;
  const near = (x, t) => Math.abs(k - x) <= t;
  let label;
  if (near(0, 0.2)) label = 'about constant';
  else if (k < 0.8) label = 'sublinear';
  else if (near(1, 0.2)) label = 'about linear';
  else if (k > 1.2 && k < 1.7) label = 'between n and n²';
  else if (near(2, 0.3)) label = 'about quadratic';
  else if (near(3, 0.3)) label = 'about cubic';
  else label = `≈ n${sup(k.toFixed(1))}`;
  return { kind: 'power', label, detail: `log–log slope ${k.toFixed(2)}`, exponent: k };
}

/** The profile as CSV, one line per length. */
export function profileCSV(rows, spaceName = 'cells') {
  const q = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['n', 'words', 'worst_steps', 'worst_word', 'mean_steps', `worst_${spaceName}`, `mean_${spaceName}`, 'accept', 'reject', 'loop', 'no_verdict'];
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([
      r.n, r.count, r.worst ?? '', q(r.worstWord), r.count ? (r.sum / r.count).toFixed(2) : '',
      r.spaceWorst ?? '', r.count ? (r.spaceSum / r.count).toFixed(2) : '',
      r.verdicts.accept, r.verdicts.reject, r.verdicts.loop, r.verdicts.timeout
    ].join(','));
  }
  return lines.join('\n') + '\n';
}
