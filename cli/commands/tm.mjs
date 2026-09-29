// halts, check-proof, bb-search, tm-normalize, sheet — Turing machines.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { withMachine } from '../../js/exercise/grade.js';
import { BEHAVIOUR_MACHINES, classifyBehaviourNow, compileBehaviourMachine } from '../../js/machines/tm-behaviour.js';
import { parseMachineInput } from '../../js/machines/index.js';
import { readInline, readMachine, readSpecText, isFile, emit, CliError } from '../io.mjs';
import { METHOD_NAMES, decide, growthOf, run, standardFromTable, tableFromStandard } from '../tm/core.mjs';
import { PROOF_FORMAT, checkProof } from '../tm/check.mjs';
import { runPool, workerCount } from '../tm/pool.mjs';
import { bbStep, rootNode } from '../tm/search.mjs';
import { proveByInduction } from '../tm/induction.mjs';
import { Indexed, encodePNG, TAPE_PALETTE, HEAD } from '../raster.mjs';
import { c, isTTY, print, printJson, table, warn } from '../out.mjs';

const num = x => Number(x).toLocaleString('en-US');

// ── Reading many machines ─────────────────────────────────────────

/**
 * Specs → `[{ label, p, code, error }]`. A text file whose lines are machine
 * codes is a list, one machine per line (the first word of the line; # starts
 * a comment). A malformed line is kept as an error — with a guess at the fix
 * when one character would repair it — rather than stopping the batch.
 */
export function loadTuringMachines(specs, { input = null } = {}) {
  const items = [];
  const fromTarget = (target, label) => {
    if (!BEHAVIOUR_MACHINES.has(target.machine)) return { label, error: `a ${target.machine} — only a deterministic one-tape Turing machine (TM, ITM) can be classified` };
    return withMachine(target, () => {
      let tokens = [];
      if (input !== null) {
        const parsed = parseMachineInput(target.machine, input);
        if (!parsed.ok) return { label, error: parsed.error.replace(/<[^>]+>/g, '') };
        tokens = parsed.input;
      }
      const p = compileBehaviourMachine(tokens, target.machine);
      if (!p.ok) return { label, error: p.error };
      return { label, p, code: standardFromTable(p) };
    });
  };
  const fromLine = (line, label) => {
    const code = line.trim().split(/\s+/)[0];
    try {
      if (input === null) return { label: code, p: tableFromStandard(code), code };
    } catch { /* not the standard notation: try the other readers */ }
    try {
      const doc = readInline(code);
      if (doc) return fromTarget(readMachine(code).target, code);
    } catch { /* fall through to the hint */ }
    const hint = ['1', '0'].map(d => d + code).find(fix => { try { tableFromStandard(fix); return true; } catch { return false; } });
    return { label: label || code, error: `not a machine in the standard notation${hint ? ` — did you mean ${hint}?` : ''}` };
  };
  for (const spec of specs) {
    const file = readSpecText(spec);
    if (!file) { items.push(fromLine(spec, spec)); continue; }
    const text = file.text.trim();
    const looksLikeList = !text.startsWith('{') && !text.startsWith('<') && !/^HOA:/.test(text);
    if (looksLikeList) {
      text.split(/\r?\n/).forEach((raw, i) => {
        const line = raw.replace(/#.*$/, '').trim();
        if (line) items.push({ ...fromLine(line), line: i + 1, file: file.name });
      });
      continue;
    }
    items.push(fromTarget(readMachine(spec).target, file.name));
  }
  return items;
}

function detailOf(v) {
  switch (v.method) {
    case 'simulation': return `after ${num(v.steps)} steps, ${num(v.ones ?? 0)} non-blank cells${v.how === 'none' ? ' (an undefined transition)' : ''}`;
    case 'cycler': return `repeats every ${num(v.period)} steps from step ${num(v.from)}`;
    case 'translated': return `repeats ${Math.abs(v.shift)} cells further ${v.direction} every ${num(v.period)} steps`;
    case 'backward': return `no halting configuration is reachable more than ${v.longest} steps back`;
    case 'cps': return `closed set of ${num(v.contexts)} windows, ${v.n} cells either side`;
    case 'bound': return `ran ${num(v.steps)} steps, past S(${v.n}, ${v.k}) = ${num(v.S)}`;
    case 'induction': return `an inductive rule over blocks of ${v.B} applies forever${v.rules > 1 ? ` (${v.rules} rules, nested)` : ''}`;
    case 'cycler-macro': return `the tape repeats exactly, over blocks of ${v.B}`;
    case 'block-loop': return `the head never leaves a block of ${v.B} cells`;
    default: return v.growth ? v.growth.say : `no proof within ${num(v.steps ?? 0)} steps`;
  }
}

function proofOf(item, v) {
  const { p } = item;
  const evidence = {};
  for (const k of ['steps', 'ones', 'period', 'from', 'at', 'shift', 'window', 'direction', 'longest', 'n', 'k', 'S', 'left', 'right', 'contexts', 'how', 'B', 'rules', 'ruleSteps', 'grows', 'start']) {
    if (v[k] !== undefined) evidence[k] = v[k];
  }
  return {
    format: PROOF_FORMAT,
    version: 1,
    machine: item.label,
    standard: item.code || undefined,
    input: [...(p.input || [])],
    table: {
      Q: p.Q, K: p.K, start: p.start, twoWay: !!p.twoWay,
      next: [...p.next], write: [...p.write], move: [...p.move], accept: [...p.accept]
    },
    verdict: v.verdict,
    method: v.method,
    evidence
  };
}

const halts = {
  usage: `automata halts <machine | list.txt | code ...>

Does each machine halt from a blank tape (or --input)? Methods, cheapest first:
simulation, cycler, translated cycler and backward reasoning (the app's own),
then n-gram closed position sets, then the busy beaver bound for machines in
the model whose S(n, k) is proved. What is still unknown gets a growth reading:
how fast its tape grows — logarithmic (counter-like), √t (bouncer-like), …

A text file is a list: one machine per line, in the standard notation or as a
machine code; # starts a comment.

  --budget N        steps for the simulation-based methods (default 1000000)
  --cps N           largest closed-position-set window (default 10; 0 = off)
  --induction-ms N  time for the inductive-rule prover per machine (default 2000; 0 = off)
  --no-bound        skip the busy beaver bound
  --no-growth       skip the growth reading for unknowns
  --input w         run on w instead of a blank tape (.automaton machines)
  --workers N       worker threads (default: one per core, for 3+ machines)
  --proof DIR       write one proof file per decided machine (check-proof reads them)
  --json

Exit: 0 every machine decided, 2 some unknown, 3 some could not be read.`,
  options: {
    budget: { type: 'string' }, cps: { type: 'string' }, 'induction-ms': { type: 'string' }, 'no-bound': { type: 'boolean' }, 'no-growth': { type: 'boolean' },
    input: { type: 'string' }, workers: { type: 'string' }, proof: { type: 'string' }
  },
  async run({ args, opts }) {
    if (!args.length) args = ['-'];
    const items = loadTuringMachines(args, { input: opts.input ?? null });
    const settings = {
      budget: Number(opts.budget ?? 1e6),
      cpsMax: Number(opts.cps ?? 10),
      inductionMs: Number(opts['induction-ms'] ?? 2000),
      bound: !opts['no-bound'],
      growth: !opts['no-growth']
    };
    const good = items.filter(it => it.p);
    const n = workerCount(opts.workers, good.length);
    let done = 0;
    const progress = () => { if (isTTY && !opts.json && good.length > 1) process.stderr.write(`\r${c.dim(`classified ${done}/${good.length}`)}`); };
    const results = await runPool(good.map(it => ({ p: it.p, opts: settings })), n, job => decide(job.p, job.opts), () => { done++; progress(); });
    if (isTTY && !opts.json && good.length > 1) process.stderr.write('\r\x1b[K');
    good.forEach((it, i) => { it.result = results[i]; });

    if (opts.proof) {
      mkdirSync(opts.proof, { recursive: true });
      let k = 0;
      for (const it of good) {
        k++;
        if (!it.result || it.result.error || it.result.verdict === 'unknown') continue;
        writeFileSync(join(opts.proof, `${String(k).padStart(4, '0')}.json`), JSON.stringify(proofOf(it, it.result), null, 1) + '\n');
      }
    }

    if (opts.json) {
      printJson(items.map(it => ({
        machine: it.label, ...(it.line ? { line: it.line } : {}),
        ...(it.error ? { error: it.error } : it.result.error ? { error: it.result.error } : {
          verdict: it.result.verdict, method: it.result.method, detail: detailOf(it.result),
          ...(it.result.growth ? { growth: { shape: it.result.growth.shape, slope: it.result.growth.slope, samples: it.result.growth.samples } } : {}),
          steps: it.result.steps
        })
      })));
    } else {
      const colour = { halts: c.green, never: c.red, unknown: c.yellow };
      print(table(items.map((it, i) => {
        if (it.error) return [c.dim(String(i + 1)), it.label, c.magenta('error'), '', it.error];
        const v = it.result;
        if (v.error) return [c.dim(String(i + 1)), it.label, c.magenta('error'), '', v.error];
        return [c.dim(String(i + 1)), it.label, colour[v.verdict](v.verdict), c.dim(METHOD_NAMES[v.method] || (v.growth ? v.growth.shape : '')), detailOf(v)];
      })));
      const count = x => items.filter(it => it.result?.verdict === x).length;
      const errs = items.filter(it => it.error || it.result?.error).length;
      const parts = [`${count('halts')} halt`, `${count('never')} never halt`, `${count('unknown')} unknown`];
      if (errs) parts.push(`${errs} could not be read`);
      print(`\n${parts.join(', ')}${opts.proof ? c.dim(` — proofs in ${opts.proof}`) : ''}`);
    }
    if (items.some(it => it.error || it.result?.error)) return 3;
    return items.some(it => it.result?.verdict === 'unknown') ? 2 : 0;
  }
};

// ── check-proof ───────────────────────────────────────────────────

const checkProofCmd = {
  usage: `automata check-proof <proof.json | dir ...>

Re-checks each proof with code that shares nothing with the prover: its own
tape, its own stepper, its own reading of the notation. Backward reasoning is
the exception — it is re-run with the app's search, and marked as such.

Exit: 0 every proof holds, 1 one does not.`,
  options: {},
  async run({ args, opts }) {
    const files = [];
    for (const a of args.length ? args : ['.']) {
      if (statSync(a).isDirectory()) readdirSync(a).filter(f => f.endsWith('.json')).sort().forEach(f => files.push(join(a, f)));
      else files.push(a);
    }
    const classify = m => classifyBehaviourNow({
      ok: true, Q: m.Q, K: m.K, start: m.start, twoWay: m.twoWay, input: [],
      next: Int32Array.from(m.next), write: Int32Array.from(m.write), move: Int8Array.from(m.move), accept: Uint8Array.from(m.accept)
    }, { budget: 1e7 });
    const tableOf = m => ({
      ok: true, Q: m.Q, K: m.K, start: m.start, twoWay: m.twoWay, input: [],
      next: Int32Array.from(m.next), write: Int32Array.from(m.write), move: Int8Array.from(m.move), accept: Uint8Array.from(m.accept)
    });
    const reprove = (m, ev) => proveByInduction(tableOf(m), ev.B, { maxMacroSteps: 200000 });
    const out = files.map(f => {
      let proof;
      try { proof = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { return { file: f, ok: false, why: `not JSON: ${e.message}` }; }
      return { file: f, machine: proof.machine, method: proof.method, verdict: proof.verdict, ...checkProof(proof, { classify, reprove }) };
    });
    if (opts.json) printJson(out);
    else {
      print(table(out.map(r => [r.ok ? c.green('✓') : c.red('✗'), r.file, r.machine ?? '', c.dim(r.method ?? ''), r.why + (r.ok && r.independent !== true ? c.dim(` (${r.independent === false ? 're-run by the prover' : r.independent})`) : '')])));
      const bad = out.filter(r => !r.ok).length;
      print(`\n${bad ? c.red(`${bad} of ${out.length} did not check`) : c.green(`all ${out.length} proofs check`)}`);
    }
    return out.every(r => r.ok) ? 0 : 1;
  }
};

// ── bb-search ─────────────────────────────────────────────────────

const bbSearch = {
  usage: `automata bb-search --states N [--symbols K]

Enumerates every N-state, K-symbol Turing machine in tree normal form and
classifies each one: it halts (the champion is the busy beaver candidate),
provably never halts (by method), or is a holdout. Does not use the busy beaver
bound, which would assume the answer. 2×2 and 3×2 take moments; 4×2 minutes.

  --budget N        steps per machine (default 100000)
  --cps N           largest closed-position-set window (default 4)
  --induction-ms N  inductive-rule prover time per machine (default 300)
  --workers N
  --holdouts FILE   write the unknown machines here, one per line
  --json`,
  options: {
    states: { type: 'string', short: 'n' }, symbols: { type: 'string', short: 'k' },
    budget: { type: 'string' }, cps: { type: 'string' }, 'induction-ms': { type: 'string' }, workers: { type: 'string' }, holdouts: { type: 'string' }
  },
  async run({ opts }) {
    const n = Number(opts.states), k = Number(opts.symbols ?? 2);
    if (!(n >= 1 && n <= 6 && k >= 2 && k <= 6)) throw new CliError('--states is 1–6 and --symbols 2–6.');
    const settings = { budget: Number(opts.budget ?? 1e5), cpsMax: Number(opts.cps ?? 4), inductionMs: Number(opts['induction-ms'] ?? 300) };
    let frontier = [rootNode(n, k)];
    const stats = { nodes: 0, halting: 0, never: {}, holdouts: [] };
    let champion = null, onesChampion = null;
    const workers = workerCount(opts.workers, 1000);
    const t0 = performance.now();
    while (frontier.length) {
      const results = await runPool(frontier.map(node => ({ kind: 'search', node, opts: settings })), frontier.length >= 64 ? workers : 1, job => bbStep(job.node, job.opts));
      const next = [];
      for (const r of results) {
        stats.nodes++;
        if (r.error) throw new CliError(r.error);
        if (r.verdict === 'branch') {
          stats.halting++;
          if (!champion || r.halt.steps > champion.steps) champion = r.halt;
          if (!onesChampion || r.halt.ones > onesChampion.ones) onesChampion = r.halt;
          next.push(...r.children);
        } else if (r.verdict === 'never') stats.never[r.method] = (stats.never[r.method] || 0) + 1;
        else stats.holdouts.push(r.code);
      }
      frontier = next;
      if (isTTY && !opts.json) process.stderr.write(`\r${c.dim(`${num(stats.nodes)} machines, ${num(frontier.length)} to go`)}\x1b[K`);
    }
    if (isTTY && !opts.json) process.stderr.write('\r\x1b[K');
    if (opts.holdouts) writeFileSync(opts.holdouts, stats.holdouts.join('\n') + (stats.holdouts.length ? '\n' : ''));
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const neverTotal = Object.values(stats.never).reduce((a, b) => a + b, 0);
    if (opts.json) printJson({ states: n, symbols: k, machines: stats.nodes, halting: stats.halting, never: stats.never, holdouts: stats.holdouts, champion, onesChampion, seconds: Number(secs) });
    else {
      print(`${c.bold(`${n}-state, ${k}-symbol`)} — ${num(stats.nodes)} machines in tree normal form, ${secs}s`);
      print(`  halting        ${num(stats.halting)}`);
      print(`  never halt     ${num(neverTotal)}${neverTotal ? c.dim(`  (${Object.entries(stats.never).map(([m, x]) => `${METHOD_NAMES[m] || m} ${num(x)}`).join(', ')})`) : ''}`);
      print(`  holdouts       ${stats.holdouts.length ? c.yellow(num(stats.holdouts.length)) : '0'}${opts.holdouts && stats.holdouts.length ? c.dim(`  → ${opts.holdouts}`) : ''}`);
      if (champion) print(`\n  most steps     ${c.bold(num(champion.steps))}  ${champion.code}`);
      if (onesChampion) print(`  most ones      ${c.bold(num(onesChampion.ones))}  ${onesChampion.code}`);
      if (stats.holdouts.length) print(c.yellow(`\n  The values above are lower bounds until the holdouts are settled.`));
    }
    return stats.holdouts.length ? 2 : 0;
  }
};

// ── tm-normalize ──────────────────────────────────────────────────

/**
 * A machine in the standard notation → its normal form: mirrored so the first
 * move from a blank tape is to the right, states renamed in the order a
 * breadth-first walk from A meets them (by symbol read), and — with `prune` —
 * states that walk never meets dropped. Two machines that differ only in state
 * names or by mirroring come out identical.
 */
export function normalizeStandard(code, { prune = false } = {}) {
  const p = tableFromStandard(code);
  const n = p.Q - 1, k = p.K;
  const mirror = p.next[0] >= 0 && p.move[0] < 0;
  const order = [0];
  for (let i = 0; i < order.length; i++) {
    for (let s = 0; s < k; s++) {
      const to = p.next[order[i] * k + s];
      if (to >= 0 && to < n && !order.includes(to)) order.push(to);
    }
  }
  if (!prune) for (let q = 0; q < n; q++) if (!order.includes(q)) order.push(q);
  const letter = new Map(order.map((q, i) => [q, String.fromCharCode(65 + i)]));
  return order.map(q => {
    let seg = '';
    for (let s = 0; s < k; s++) {
      const e = q * k + s;
      const to = p.next[e];
      if (to < 0) { seg += '---'; continue; }
      const d = p.move[e] > 0 ? 'R' : 'L';
      seg += `${p.write[e]}${mirror ? (d === 'R' ? 'L' : 'R') : d}${to >= n ? 'Z' : letter.get(to)}`;
    }
    return seg;
  }).join('_');
}

const tmNormalize = {
  usage: `automata tm-normalize <list.txt | code ...> [--prune]

Prints each machine's normal form, dropping duplicates: mirrored so the first
move is R, states renamed breadth-first from A. --prune drops states that
cannot be reached. The count of duplicates goes to standard error.

  --keep-order      print every line (normalised), duplicates included
  --json            [{ machine, normal, duplicateOf }]`,
  options: { prune: { type: 'boolean' }, 'keep-order': { type: 'boolean' } },
  async run({ args, opts }) {
    const codes = [];
    for (const a of args.length ? args : ['-']) {
      const file = readSpecText(a);
      if (file) file.text.split(/\r?\n/).map(l => l.replace(/#.*$/, '').trim().split(/\s+/)[0]).filter(Boolean).forEach(x => codes.push(x));
      else codes.push(a);
    }
    const seen = new Map();
    const rows = codes.map(code => {
      try {
        const normal = normalizeStandard(code, { prune: !!opts.prune });
        const dup = seen.get(normal) ?? null;
        if (!dup) seen.set(normal, code);
        return { machine: code, normal, duplicateOf: dup };
      } catch (e) { return { machine: code, error: e.message }; }
    });
    if (opts.json) { printJson(rows); return rows.some(r => r.error) ? 3 : 0; }
    for (const r of rows) {
      if (r.error) { warn(`${r.machine}: ${r.error}`); continue; }
      if (r.duplicateOf && !opts['keep-order']) continue;
      print(r.normal);
    }
    const dups = rows.filter(r => r.duplicateOf).length;
    process.stderr.write(c.dim(`${rows.length} machines, ${seen.size} distinct, ${dups} duplicate${dups === 1 ? '' : 's'}\n`));
    return rows.some(r => r.error) ? 3 : 0;
  }
};

// ── sheet ─────────────────────────────────────────────────────────

/**
 * A space-time picture of `steps` steps: one row per `stride` steps over the
 * whole range of cells the run used, a head mark on each row. Wider than
 * `maxW` cells, columns are binned (a bin shows any non-blank symbol in it).
 */
export function spaceTimeImage(p, { steps = 5000, rows = 300, maxW = 320 } = {}) {
  const extent = run(p, steps);
  const lo = extent.lo, hi = extent.hi;
  const span = hi - lo + 1;
  const bin = Math.max(1, Math.ceil(span / maxW));
  const w = Math.ceil(span / bin);
  const stride = Math.max(1, Math.ceil(extent.steps / rows));
  const h = Math.max(1, Math.ceil((extent.steps + 1) / stride));
  const img = new Indexed(w, h, TAPE_PALETTE).fill(0);
  // Replay, drawing every stride-th configuration.
  const tape = new Map();
  let head = 0, state = p.start;
  const { K, next, write, move, accept, twoWay } = p;
  p.input.forEach((c0, x) => c0 && tape.set(x, c0));
  let y = 0;
  for (let t = 0; t <= extent.steps; t++) {
    if (t % stride === 0 && y < h) {
      for (const [x, s] of tape) {
        const col = Math.floor((x - lo) / bin);
        const i = y * w + col;
        if (s && col >= 0 && col < w && img.px[i] === 0) img.px[i] = Math.min(9, s);
      }
      img.set(Math.floor((head - lo) / bin), y, HEAD);
      y++;
    }
    if (t === extent.steps || accept[state]) break;
    const e = state * K + (tape.get(head) || 0);
    if (next[e] < 0) break;
    if (write[e]) tape.set(head, write[e]); else tape.delete(head);
    head += move[e];
    if (!twoWay && head < 0) head = 0;
    state = next[e];
  }
  return { img, lo, hi, steps: extent.steps, stride, bin };
}

const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

const sheet = {
  usage: `automata sheet <list.txt | machine ...> [-o sheet.svg]

A contact sheet: one space-time diagram per machine (time down, tape across,
the head in white), captioned with the machine and — unless --no-classify —
its halting verdict. Counters and bouncers are told apart at a glance.

  --steps N         steps drawn per machine (default 20000)
  --cols N          diagrams per row (default 3)
  --size N          diagram width and height in pixels (default 240)
  --png             write one PNG per machine instead, into the -o directory`,
  options: {
    output: { type: 'string', short: 'o' }, steps: { type: 'string' }, cols: { type: 'string' }, size: { type: 'string' },
    'no-classify': { type: 'boolean' }, png: { type: 'boolean' }
  },
  async run({ args, opts }) {
    const items = loadTuringMachines(args.length ? args : ['-']).filter(it => {
      if (it.error) warn(`${it.label}: ${it.error}`);
      return !!it.p;
    });
    if (!items.length) throw new CliError('No Turing machines to draw.');
    const steps = Number(opts.steps ?? 20000), size = Number(opts.size ?? 240), cols = Math.max(1, Number(opts.cols ?? 3));
    const pics = items.map(it => {
      const pic = spaceTimeImage(it.p, { steps, rows: size, maxW: size });
      const verdict = opts['no-classify'] ? null : decide(it.p, { budget: 1e5, cpsMax: 8, bound: true, growth: true });
      return { it, pic, verdict };
    });
    if (opts.png) {
      const dir = opts.output || '.';
      mkdirSync(dir, { recursive: true });
      pics.forEach(({ pic }, i) => {
        // Each axis on its own: a counter's tape is a few cells wide and
        // thousands of rows tall, and a shared factor would leave it a sliver.
        const kx = Math.max(1, Math.floor(size / pic.img.w)), ky = Math.max(1, Math.floor(size / pic.img.h));
        writeFileSync(join(dir, `${String(i + 1).padStart(3, '0')}.png`), encodePNG(pic.img.scaled(kx, ky)));
      });
      print(`${pics.length} PNGs in ${dir}`);
      return 0;
    }
    const pad = 14, capH = 44;
    const cellW = size + pad * 2, cellH = size + capH + pad * 2;
    const rowsN = Math.ceil(pics.length / cols);
    const W = cellW * Math.min(cols, pics.length), H = cellH * rowsN;
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, Menlo, Consolas, monospace">`, `<rect width="${W}" height="${H}" fill="#0b0f1a"/>`];
    const tone = { halts: '#69f0ae', never: '#ff6b6b', unknown: '#ffd54f' };
    pics.forEach(({ it, pic, verdict }, i) => {
      const x = (i % cols) * cellW + pad, y = Math.floor(i / cols) * cellH + pad;
      const png = encodePNG(pic.img).toString('base64');
      parts.push(`<image x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="none" style="image-rendering:pixelated" href="data:image/png;base64,${png}"/>`);
      parts.push(`<rect x="${x - 0.5}" y="${y - 0.5}" width="${size + 1}" height="${size + 1}" fill="none" stroke="#2a3350"/>`);
      const label = it.label.length > 38 ? it.label.slice(0, 37) + '…' : it.label;
      parts.push(`<text x="${x}" y="${y + size + 16}" font-size="10.5" fill="#dfe8ff">${esc(label)}</text>`);
      const say = verdict ? `${verdict.verdict}${verdict.method ? ` · ${METHOD_NAMES[verdict.method]}` : verdict.growth ? ` · ${verdict.growth.shape}` : ''}` : '';
      parts.push(`<text x="${x}" y="${y + size + 31}" font-size="10" fill="${verdict ? tone[verdict.verdict] : '#8894b0'}">${esc(say)}</text>`);
      parts.push(`<text x="${x + size}" y="${y + size + 31}" font-size="10" fill="#8894b0" text-anchor="end">${num(pic.steps)} steps · ${num(pic.hi - pic.lo + 1)} cells</text>`);
    });
    parts.push('</svg>');
    emit(parts.join('\n'), opts.output);
    return 0;
  }
};

export const commands = { halts, 'check-proof': checkProofCmd, 'bb-search': bbSearch, 'tm-normalize': tmNormalize, sheet };
