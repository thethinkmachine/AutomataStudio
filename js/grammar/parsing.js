import { END, firstOfSeq, firstSets, followSets, nullableSet } from './analysis.js';
import { eps, rulesFor } from './model.js';
import { toCNF } from './transform.js';

// ══════════════════════════════════════════════════════════════════
//  PARSING
// ══════════════════════════════════════════════════════════════════
//  Membership, derivations, parse trees, ambiguity, LL(1) and word
//  generation. All of it pure over a grammar model and a token array.
//
//  **Two engines, and the split is deliberate.**
//
//  CYK decides membership. It is cubic, total, and defined on Chomsky normal
//  form — so it always answers, and it answers about the *converted* grammar,
//  which is exactly what the CYK table on screen is a table of.
//
//  Everything a reader *reads* — a derivation, a parse tree, an ambiguity
//  witness — has to be about the grammar they wrote, not about its CNF. A
//  CNF parse tree is binary, full of X₁ and T_a, and shares no shape with the
//  one in the textbook. So trees come from a separate top-down search over
//  the original rules, which CYK gates: the search is only ever run on a word
//  already known to be in the language, which is what keeps its worst case
//  off the screen.

/** A derivation search that has not finished is reported, never rounded off. */
export const PARSE_BUDGET = 400000;
export const GENERATE_BUDGET = 200000;

// ── CYK ───────────────────────────────────────────────────────────

/**
 * The triangular table over a CNF grammar. `cells[i][j]` is the set of
 * variables deriving w[i..j], and `back` records one witness per entry so a
 * cell can say *why* it holds what it holds.
 */
export function cykTable(cnf, tokens) {
  const n = tokens.length;
  const cells = Array.from({ length: n }, () => Array.from({ length: n }, () => new Set()));
  const back = new Map();   // "i,j,A" -> {term} | {k, B, C}

  for (let i = 0; i < n; i++) {
    cnf.rules.forEach(r => {
      if (r.rhsArr.length === 1 && r.rhsArr[0] === tokens[i]) {
        const A = r.lhsArr[0];
        if (!cells[i][i].has(A)) {
          cells[i][i].add(A);
          back.set(`${i},${i},${A}`, { term: tokens[i], rule: r });
        }
      }
    });
  }
  for (let len = 2; len <= n; len++) {
    for (let i = 0; i + len - 1 < n; i++) {
      const j = i + len - 1;
      for (let k = i; k < j; k++) {
        cnf.rules.forEach(r => {
          if (r.rhsArr.length !== 2) return;
          const [B, C] = r.rhsArr;
          if (!cells[i][k].has(B) || !cells[k + 1][j].has(C)) return;
          const A = r.lhsArr[0];
          if (cells[i][j].has(A)) return;
          cells[i][j].add(A);
          back.set(`${i},${j},${A}`, { k, B, C, rule: r });
        });
      }
    }
  }
  return { cells, back, n };
}

/**
 * Every write the fill performs, in order, each with the table as it stood
 * afterwards — what the step-through scrubs. Frames are built once and
 * scrubbed without re-running, which is why the scrubber can go backwards.
 */
export function cykFrames(cnf, tokens) {
  const n = tokens.length;
  const cells = Array.from({ length: n }, () => Array.from({ length: n }, () => new Set()));
  const frames = [];
  const snap = () => cells.map(row => row.map(c => new Set(c)));
  const push = (i, j, k, added, note) => frames.push({ i, j, k, added, note, cells: snap() });

  for (let i = 0; i < n; i++) {
    let fired = false;
    cnf.rules.forEach(r => {
      if (r.rhsArr.length !== 1 || r.rhsArr[0] !== tokens[i] || cells[i][i].has(r.lhsArr[0])) return;
      cells[i][i].add(r.lhsArr[0]);
      push(i, i, null, r.lhsArr[0],
        `<b>Base.</b> <code>${r.lhsArr[0]} → ${tokens[i]}</code> matches position ${i}, so T[${i}][${i}] gains ${r.lhsArr[0]}.`);
      fired = true;
    });
    if (!fired) push(i, i, null, null, `<b>Base.</b> No rule derives <code>${tokens[i]}</code> on its own, so T[${i}][${i}] stays empty.`);
  }
  for (let len = 2; len <= n; len++) {
    for (let i = 0; i + len - 1 < n; i++) {
      const j = i + len - 1;
      let fired = false;
      for (let k = i; k < j; k++) {
        cnf.rules.forEach(r => {
          if (r.rhsArr.length !== 2) return;
          const [B, C] = r.rhsArr;
          if (!cells[i][k].has(B) || !cells[k + 1][j].has(C) || cells[i][j].has(r.lhsArr[0])) return;
          cells[i][j].add(r.lhsArr[0]);
          push(i, j, k, r.lhsArr[0],
            `<b>Span ${i}–${j}.</b> Split at k = ${k}: T[${i}][${k}] holds ${B} and T[${k + 1}][${j}] holds ${C}, so <code>${r.lhsArr[0]} → ${B} ${C}</code> adds ${r.lhsArr[0]}.`);
          fired = true;
        });
      }
      if (!fired) push(i, j, null, null, `<b>Span ${i}–${j}.</b> No split lets any rule fire, so T[${i}][${j}] stays empty.`);
    }
  }
  return frames;
}

/**
 * The decision. ε is settled directly rather than through the table, since a
 * table over a zero-length word has no cells to consult.
 */
export function member(g, tokens) {
  const cnf = toCNF(g).grammar;
  if (!tokens.length) {
    return { accepted: cnf.rules.some(r => r.lhsArr[0] === cnf.start && r.rhsArr.length === 0), cnf, table: null };
  }
  const table = cykTable(cnf, tokens);
  return { accepted: table.cells[0][tokens.length - 1].has(cnf.start), cnf, table };
}

// ── Parse trees over the grammar the reader wrote ─────────────────

/** The shortest terminal string each symbol can derive — the search's floor. */
function minYield(g) {
  const min = new Map();
  g.vars.forEach(v => min.set(v, Infinity));
  let changed = true;
  while (changed) {
    changed = false;
    g.rules.forEach(r => {
      if (r.lhsArr.length !== 1) return;
      const A = r.lhsArr[0];
      const sum = r.rhsArr.reduce((acc, s) => acc + (g.vars.has(s) ? (min.get(s) ?? Infinity) : 1), 0);
      if (sum < (min.get(A) ?? Infinity)) { min.set(A, sum); changed = true; }
    });
  }
  return sym => (g.vars.has(sym) ? (min.get(sym) ?? Infinity) : 1);
}

/**
 * Up to `limit` distinct parse trees for `tokens`.
 *
 * A tree is `{ sym, rule, children }`, with `children: null` on a terminal
 * leaf and `[]` on a variable that used an ε-rule. Cycles are cut on the
 * (symbol, span) currently being expanded: a derivation that re-enters the
 * same symbol over the same span is one that could be repeated forever, so
 * there are infinitely many of them and none is a witness to anything.
 */
export function parseTrees(g, tokens, limit = 1) {
  const floor = minYield(g);
  let budget = PARSE_BUDGET;
  const active = new Set();
  let exhausted = false;

  function derive(sym, i, j, out) {
    if (budget-- <= 0) { exhausted = true; return; }
    if (!g.vars.has(sym)) {
      if (j - i === 1 && tokens[i] === sym) out.push({ sym, rule: null, children: null });
      return;
    }
    if (floor(sym) > j - i) return;
    const key = `${sym}|${i}|${j}`;
    if (active.has(key)) return;
    active.add(key);
    for (const r of rulesFor(g, sym)) {
      if (out.length >= limit || budget <= 0) break;
      cover(r.rhsArr, 0, i, j, [], list => {
        out.push({ sym, rule: r, children: list });
        return out.length >= limit;
      });
    }
    active.delete(key);
  }

  /** Walks the ways seq[at..] can cover w[i..j). `emit` returning true stops. */
  function cover(seq, at, i, j, acc, emit) {
    if (budget-- <= 0) { exhausted = true; return true; }
    if (at === seq.length) return i === j ? emit(acc.slice()) : false;
    const rest = seq.slice(at + 1).reduce((a, s) => a + floor(s), 0);
    const head = seq[at];
    // The head must take at least its own floor and leave the tail theirs, so
    // only that window of split points can succeed. Without it a rule with a
    // long right-hand side tries every split of every span.
    const lo = Math.max(i, i + floor(head));
    const hi = Math.min(j, j - rest);
    for (let k = lo; k <= hi; k++) {
      const sub = [];
      derive(head, i, k, sub);
      for (const t of sub) {
        acc.push(t);
        const stop = cover(seq, at + 1, k, j, acc, emit);
        acc.pop();
        if (stop) return true;
      }
    }
    return false;
  }

  const trees = [];
  if (g.start) derive(g.start, 0, tokens.length, trees);
  return { trees: trees.slice(0, limit), exhausted };
}

/** A tree's shape, for telling two of them apart. */
export function treeSignature(node) {
  if (!node.children) return node.sym;
  return `${node.sym}(${node.children.map(treeSignature).join(' ')})`;
}

/**
 * A tree -> the derivation that built it. `order` picks which variable is
 * expanded next, and that is the *whole* difference between a leftmost and a
 * rightmost derivation — they are two readings of one tree, which is why they
 * share this function rather than being two searches.
 */
export function derivationOf(tree, order = 'leftmost') {
  const steps = [{ form: [tree.sym], rule: null, at: -1 }];
  let frontier = [tree];
  let guard = 0;
  for (;;) {
    if (guard++ > 5000) break;
    let at = -1;
    if (order === 'rightmost') {
      for (let i = frontier.length - 1; i >= 0; i--) if (frontier[i].children) { at = i; break; }
    } else {
      at = frontier.findIndex(n => n.children);
    }
    if (at < 0) break;
    const node = frontier[at];
    frontier = [...frontier.slice(0, at), ...node.children, ...frontier.slice(at + 1)];
    steps.push({ form: frontier.map(n => n.sym), rule: node.rule, at });
  }
  return steps;
}

/** Two structurally different trees for one word, or null. */
export function ambiguityWitness(g, tokens) {
  const { trees, exhausted } = parseTrees(g, tokens, 2);
  if (trees.length < 2) return { trees, exhausted, ambiguous: false };
  return {
    trees, exhausted,
    ambiguous: treeSignature(trees[0]) !== treeSignature(trees[1])
  };
}

// ── LL(1) ─────────────────────────────────────────────────────────

/**
 * M[A][a] -> the rules that may be chosen. A cell with more than one is a
 * conflict, and the table reports the set rather than the first arrival: which
 * rules collide is the whole content of "this grammar is not LL(1)".
 */
export function ll1Table(g) {
  const first = firstSets(g);
  const follow = followSets(g, first);
  const E = eps();
  const terminals = new Set();
  g.rules.forEach(r => r.rhsArr.forEach(s => { if (!g.vars.has(s)) terminals.add(s); }));
  terminals.add(END);

  const table = new Map();     // "A|a" -> [rule]
  const put = (A, a, rule) => {
    const key = `${A}|${a}`;
    if (!table.has(key)) table.set(key, []);
    if (!table.get(key).includes(rule)) table.get(key).push(rule);
  };

  g.rules.forEach(r => {
    if (r.lhsArr.length !== 1) return;
    const A = r.lhsArr[0];
    const { set, nullable } = firstOfSeq(r.rhsArr, first, g);
    set.forEach(a => { if (a !== E) put(A, a, r); });
    if (nullable) (follow[A] || new Set()).forEach(a => put(A, a, r));
  });

  const conflicts = [...table.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ variable: key.split('|')[0], lookahead: key.split('|')[1], rules: list }));

  return { table, first, follow, terminals: [...terminals].sort(), conflicts, isLL1: conflicts.length === 0 };
}

/**
 * The predictive parse itself: stack, remaining input, action, one row per
 * move. Runs on a conflicted table too — it takes the first rule and says so
 * — because seeing *where* the parse goes wrong is the reason to look.
 */
export function ll1Trace(g, tokens, built = ll1Table(g)) {
  const input = [...tokens, END];
  let stack = [END, g.start];
  const rows = [];
  let pos = 0;
  let guard = 0;
  let status = 'accept';

  while (guard++ < 4000) {
    const top = stack[stack.length - 1];
    const look = input[pos];
    if (top === END && look === END) {
      rows.push({ stack: [...stack], rest: input.slice(pos), action: 'Accept', kind: 'accept' });
      break;
    }
    if (!g.vars.has(top)) {
      if (top === look) {
        rows.push({ stack: [...stack], rest: input.slice(pos), action: `Match ${top}`, kind: 'match' });
        stack.pop();
        pos++;
        continue;
      }
      rows.push({ stack: [...stack], rest: input.slice(pos), action: `Error — expected ${top}, saw ${look}`, kind: 'error' });
      status = 'reject';
      break;
    }
    const cell = built.table.get(`${top}|${look}`) || [];
    if (!cell.length) {
      rows.push({ stack: [...stack], rest: input.slice(pos), action: `Error — M[${top}, ${look}] is empty`, kind: 'error' });
      status = 'reject';
      break;
    }
    const rule = cell[0];
    rows.push({
      stack: [...stack], rest: input.slice(pos),
      action: `${top} → ${rule.rhsArr.length ? rule.rhsArr.join(' ') : eps()}`,
      kind: cell.length > 1 ? 'conflict' : 'expand'
    });
    stack.pop();
    for (let i = rule.rhsArr.length - 1; i >= 0; i--) stack.push(rule.rhsArr[i]);
  }
  if (guard >= 4000) status = 'budget';
  return { rows, status };
}

// ── Enumerating the language ──────────────────────────────────────

/**
 * The shortest words in L(G), by breadth-first expansion of sentential forms.
 *
 * The frontier is ordered by total length, so a form is only expanded when
 * everything shorter has been; that is what makes the answer *the* shortest
 * words rather than the first ones a depth-first walk happened to reach. A
 * form is dropped once its terminal floor passes `maxLen`, which is what
 * bounds an infinite language.
 */
export function generateWords(g, { count = 20, maxLen = 12 } = {}) {
  if (!g.start) return { words: [], exhausted: false, complete: true };
  const floor = minYield(g);
  const words = [];
  const seen = new Set();
  const visited = new Set([g.start]);
  let queue = [[g.start]];
  let budget = GENERATE_BUDGET;
  let exhausted = false;

  while (queue.length && words.length < count) {
    if (budget-- <= 0) { exhausted = true; break; }
    queue.sort((a, b) => a.length - b.length);
    const form = queue.shift();
    const at = form.findIndex(s => g.vars.has(s));
    if (at < 0) {
      const w = form.join(' ');
      if (!seen.has(w) && form.length <= maxLen) { seen.add(w); words.push([...form]); }
      continue;
    }
    for (const r of rulesFor(g, form[at])) {
      const next = [...form.slice(0, at), ...r.rhsArr, ...form.slice(at + 1)];
      if (next.reduce((a, s) => a + floor(s), 0) > maxLen) continue;
      const key = next.join(' ');
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push(next);
    }
  }
  words.sort((a, b) => a.length - b.length || a.join('').localeCompare(b.join('')));
  return { words, exhausted, complete: !exhausted && !queue.length };
}

/** ε ∈ L(G)? Cheaper than a parse and worth its own answer. */
export function derivesEmpty(g) {
  return nullableSet(g).has(g.start);
}
