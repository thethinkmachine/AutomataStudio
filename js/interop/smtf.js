// ══════════════════════════════════════════════════════════════════
//  SMTF — THE STANDARD MACHINE TEXT FORMAT
// ══════════════════════════════════════════════════════════════════
// bbchallenge's Standard TM Text Format (js/interop/standard-tm.js),
// generalised to every machine the app draws and to machines built out of
// blocks. One line, URL-safe, and one spelling per machine:
//
//     tm.1:1RB1LC_1RC1RB_1RD0LE_1LA1LD_1RZ0LA          BB(5), unchanged
//     fa.01:+AB_BA                                      even number of 1s
//     pda.ab.ZA:(010A111A)1B_-1B00Z                     aⁿbⁿ
//
//   code  = head ":" rows *( ";" rows ) [ "~" labels ]
//   head  = type *( "." alphabet ) *( "@" option )
//   rows  = row *( "_" row )           one row per state; A is the start
//   row   = [mark] *cell               a state
//         | "=" n *wire                a placed block: definition n, then
//                                      where each of its exits goes
//   cell  = "-" | action | "(" 1*action ")"      ("---" in tm and lba)
//
// ── The table ─────────────────────────────────────────────────────
// Columns are what the head reads: Σ — Γ on a tape, blank first — then the
// type's extras (⊢ ⊣ for a two-way head or an LBA, ε where moves may read
// nothing), then `*`, which means "otherwise". Everything else a move reads — a
// stack top, the other tapes — is part of the action, so every machine is the
// same shape of table and there is one layout rather than a dense one and a
// sparse one. A row lists every alphabet column, which is what keeps STF
// strings byte-identical; the extra columns are dropped from the end when empty.
//
// An action ends in its target: an uppercase state, `Z` for the halt, or a
// lowercase letter naming one of the enclosing block's exits.
//
//   fa, ba, cba, pa, moore   target                 (fa with Δ: output first)
//   pfa                      target weight          (.5 — omitted when 1)
//   2fa                      [output] move target
//   tm, lba                  write move target      (STF's triple)
//   tmK                      reads of tapes 2..K, then write+move per tape
//   pda, qa                  pop push [,output]
//   pda2                     pop pop push,push
//   epda                     pop below,push,above   (stack lists split by +)
//
// Symbols are digits indexing their alphabet (0 is the blank on a tape and the
// bottom marker on a stack), `.` is ε, `*` is "any" in a read and "what was
// read" in a write, `l` and `r` are the end markers. A row may open with a mark:
// `+` accepting, a priority on a parity automaton, the output on a Moore state.
//
// ── What is not written ───────────────────────────────────────────
// Anything derivable: determinism (DFA/NFA, TM/NDTM, DPDA/NPDA are one type
// each, told apart by δ, exactly as STF never says "deterministic"); the number
// of states; empty trailing extra columns; accepting dead ends, which merge into
// the halt the way STF's are; names that equal the reader's defaults. Only four
// options exist: @h a one-way tape, @e acceptance by empty store, @v a
// transducer that also has a verdict, @c the cut point of a PFA.
//
// ── Blocks ────────────────────────────────────────────────────────
// Every machine is a block whose exits are lowercase letters; at the top level
// the one exit is the halt, which is where STF's Z comes from. A placed block
// is one row of its parent, `=n` then a target per exit, and each definition is
// written once, after a `;`, however many times it is placed — definitions are
// keyed by their own text, so two copies that still agree are one definition.
// Only a clean subroutine is written as one: entered at its entry and left only
// from an exit along Σ/Σ,S. Anything else is written flat and the writer says
// which block and why. Inlining is the semantics (js/blocks.js), so either way
// the machine is the same.
//
// ── Identity ──────────────────────────────────────────────────────
// Everything before `~` is the machine. States are numbered by a BFS from the
// start in column order, with colour refinement breaking the ties a BFS cannot
// see; alphabets are sorted. So renaming or reordering states never changes the
// code: exactly for deterministic machines, and for nondeterministic ones in
// every case short of the graph-isomorphism ones refinement cannot separate.
//
// Import-free and DOM-free. Positions are the caller's business — see
// js/import-machine-code.js. Throws SMTFError with a sentence the status bar
// can show.

export class SMTFError extends Error {}

export const DEFAULT_SYM = { eps: 'ε', any: 'Σ', blank: '⊔', leftMarker: '⊢', rightMarker: '⊣', stackBottom: 'Z' };

// App type → [SMTF type, whether the app runs it by "every match" rather than
// by "most specific"]. The second is what the wildcard has to be translated
// through, since SMTF has one meaning for it.
const APP_TYPES = {
  DFA: ['fa', 0], NFA: ['fa', 1], 'ε-NFA': ['fa', 1], Mealy: ['fa', 0], FST: ['fa', 1],
  PFA: ['pfa', 1], DBA: ['ba', 0], NBA: ['ba', 1], DWA: ['ba', 0], NWA: ['ba', 1],
  DcoBA: ['cba', 0], NcoBA: ['cba', 1], DPA: ['pa', 0], NPA: ['pa', 1], Moore: ['moore', 0],
  '2DFA': ['2fa', 0], '2NFA': ['2fa', 1], '2DFT': ['2fa', 0],
  TM: ['tm', 0], ITM: ['tm', 0], NDTM: ['tm', 1], LBA: ['lba', 0], MTM: ['tm', 0],
  DPDA: ['pda', 1], PDA: ['pda', 1], NPDA: ['pda', 1], Counter: ['pda', 1], PDT: ['pda', 1],
  QA: ['qa', 1], '2PDA': ['pda2', 1], EPDA: ['epda', 1]
};
const TYPES = ['fa', 'pfa', 'ba', 'cba', 'pa', 'moore', '2fa', 'tm', 'lba', 'pda', 'qa', 'pda2', 'epda'];
const TRANSDUCERS = new Set(['Mealy', 'FST', '2DFT', 'PDT', 'Moore']);
const TAPE = new Set(['tm', 'lba', 'tmk']);
const STORE = new Set(['pda', 'qa', 'pda2', 'epda']);
const EPS_COLUMN = new Set(['fa', 'pda', 'qa', 'pda2', 'epda']);
const MARKER_COLUMNS = new Set(['2fa', 'lba']);
const T = { eps: '.', any: '*', left: 'l', right: 'r', none: '-' };

// ── primitives ────────────────────────────────────────────────────
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const digitsFor = size => String(Math.max(size - 1, 0)).length;
const symTok = (i, size) => String(i).padStart(digitsFor(size), '0');
// Rows plus one, so the top level always has a letter to spare for the halt —
// which is STF's 25-state limit for one-letter names.
const nameWidth = rows => { let w = 1; while (26 ** w < rows + 1) w++; return w; };
const letters = (i, w) => { let s = ''; for (let k = 0; k < w; k++) { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26); } return s; };
const unletters = s => [...s].reduce((i, c) => i * 26 + c.charCodeAt(0) - 65, 0);

// An alphabet in the head: single characters run together, anything longer
// comma-separated (a lone long symbol takes a trailing comma). `.`, `~`, `@`,
// `:` and `,` are the head's own punctuation and are percent-escaped.
const headEsc = s => encodeURIComponent(s).replace(/[.~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
function writeAlphabet(list) {
  if (list.every(s => [...s].length === 1)) return list.map(headEsc).join('');
  return list.length === 1 ? headEsc(list[0]) + ',' : list.map(headEsc).join(',');
}
function readAlphabet(v) {
  if (v.includes(',')) { const p = v.split(','); if (p[p.length - 1] === '') p.pop(); return p.map(decodeURIComponent); }
  return [...decodeURIComponent(v)];
}
// A label: form-encoded, so a space is `+`.
const labelEsc = s => encodeURIComponent(s).replace(/~/g, '%7E').replace(/%20/g, '+');
const labelUnesc = s => decodeURIComponent(s.replace(/\+/g, ' '));
function fmtNumber(x) { const s = String(Number(Number(x).toPrecision(12))); return s.startsWith('0.') ? s.slice(1) : s; }

function splitBy(s, alphabet) {
  const syms = [...alphabet].filter(Boolean).sort((a, b) => b.length - a.length);
  const out = [];
  for (let i = 0; i < s.length;) {
    const hit = syms.find(x => s.startsWith(x, i));
    if (hit) { out.push(hit); i += hit.length; } else { out.push(s[i]); i++; }
  }
  return out;
}

function columnsOf(t, A, sym) {
  const cols = TAPE.has(t) ? [...A.gamma] : [...A.sigma];
  if (MARKER_COLUMNS.has(t)) cols.push(sym.leftMarker, sym.rightMarker);
  if (EPS_COLUMN.has(t)) cols.push(sym.eps);
  cols.push(sym.any);
  return cols;
}

/**
 * The code in `text`, or null when the text is not trying to be one. Looser
 * than the reader, like standardTMText: a code with a typo in it should be told
 * what the typo is. Finds `#m=<code>` links anywhere in the text; a bare code
 * has to be the whole of it.
 */
export function machineCodeText(text) {
  if (typeof text !== 'string') return null;
  const link = /#m=([^\s"'<>]+)/.exec(text);
  // A link ending a sentence brings the sentence's full stop with it; a code
  // with no labels never ends in punctuation, so it is the sentence's.
  const src = link ? link[1].replace(/(?<=^[^~]*)[.,;!?]$/, '') : text.trim();
  if (!/^(?:fa|pfa|ba|cba|pa|moore|2fa|tm\d*|lba|pda2?|qa|epda)(?:\.[^.:@~\s]*)*(?:@[a-z][^:@~\s]*)*:\S/.test(src)) return null;
  return /\s/.test(src) ? null : src;
}

// ═══════════════════════════════════════════════════════════════════
//  WRITE
// ═══════════════════════════════════════════════════════════════════
/**
 * A machine → its code. `doc` is the loadData shape, plus `config` and `meta`.
 * Answers `{ code, warnings }`: a warning is a block written flat, and says why.
 */
export function writeMachineCode(doc, { sym = DEFAULT_SYM, labels = true } = {}) {
  const m = doc?.machine;
  if (!APP_TYPES[m]) throw new SMTFError(`${m} has no machine code.`);
  const [base, everyMatch] = APP_TYPES[m];
  const t = m === 'MTM' ? 'tmk' : base;
  const k = m === 'MTM' ? (doc.tapeCount || 2) : 1;
  // Row A is the start by definition, so a machine without one has no code:
  // writing it anyway would quietly promote whichever state came first.
  if (!(doc.states || []).some(s => s.id === doc.startId)) throw new SMTFError('The machine has no start state — set one first.');
  const cfg = doc.config || {};
  const emptyStore = STORE.has(t) && cfg.pdaParadigm === 'empty';
  // Copies: dissolving an unclean block re-parents states, and that is a
  // decision about the code, not about the reader's machine.
  const states = (doc.states || []).map(s => ({ ...s }));
  const ts = doc.transitions || [];
  // Accept marks an empty-store machine or a parity automaton never reads are
  // not part of it, and a normal form does not write what does nothing.
  const accepts = new Set(emptyStore || t === 'pa' ? [] : doc.accepts || []);
  const NONE = t === 'tm' || t === 'lba' ? '---' : T.none;

  // ── alphabets ──
  const special = new Set([sym.eps, sym.any, sym.blank, sym.leftMarker, sym.rightMarker]);
  const readOf = x => (t === 'tmk' ? x.tapeSyms?.[0] : x.symbol);
  const sigmaSet = new Set(doc.sigma || []);
  if (!TAPE.has(t)) for (const x of ts) if (readOf(x) != null) sigmaSet.add(readOf(x));
  const sigma = [...sigmaSet].filter(s => !special.has(s)).sort(cmp);
  const A = { sigma, gamma: null, out: null };
  const words = s => (t === 'epda' && /\s/.test(String(s).trim()) ? String(s).trim().split(/\s+/) : [...String(s)]);
  if (TAPE.has(t)) {
    const used = new Set(doc.stackAlpha || []);
    for (const x of ts) for (const v of [x.symbol, x.write, ...(x.tapeSyms || []), ...(x.tapeWrites || [])]) if (v) used.add(v);
    A.gamma = [sym.blank, ...sigma, ...[...used].filter(s => !special.has(s) && !sigma.includes(s)).sort(cmp)];
  } else if (STORE.has(t)) {
    const used = new Set(doc.stackAlpha || []);
    for (const x of ts) {
      for (const f of ['pop', 'pop2']) if (x[f]) used.add(x[f]);
      for (const f of ['push', 'push2']) if (x[f]) words(x[f]).forEach(c => used.add(c));
      for (const f of ['below', 'above']) if (x[f]) String(x[f]).split('|').forEach(st => words(st).forEach(c => used.add(c)));
    }
    const rest = [...used].filter(s => !special.has(s) && (emptyStore || s !== sym.stackBottom)).sort(cmp);
    A.gamma = emptyStore ? rest : [sym.stackBottom, ...rest];
  }
  if (TRANSDUCERS.has(m)) {
    const out = new Set(doc.outputAlpha || []);
    for (const x of [...ts, ...states]) if (x.output && x.output !== sym.eps) splitBy(x.output, out).forEach(c => out.add(c));
    A.out = [...out].filter(s => s && s !== sym.eps).sort(cmp);
  }
  const cols = columnsOf(t, A, sym);
  const fixedCols = TAPE.has(t) ? A.gamma.length : sigma.length;

  // ── one action, without its target ──
  const g = s => {
    if (s === sym.any || s === '' || s == null) return T.any;
    if (s === sym.leftMarker && MARKER_COLUMNS.has(t)) return T.left;
    if (s === sym.rightMarker && MARKER_COLUMNS.has(t)) return T.right;
    const i = A.gamma.indexOf(s);
    if (i < 0) throw new SMTFError(`"${s}" is written but is not a tape symbol.`);
    return symTok(i, A.gamma.length);
  };
  const p = s => {
    if (s == null || s === '' || s === sym.eps) return T.eps;
    if (s === sym.any) return T.any;
    const i = A.gamma.indexOf(s);
    if (i < 0) throw new SMTFError(`"${s}" is popped but is not a store symbol.`);
    return symTok(i, A.gamma.length);
  };
  const pstr = s => (!s || s === sym.eps ? '' : s === sym.any ? T.any : (t === 'epda' ? words(s) : splitBy(String(s), A.gamma)).map(p).join(''));
  const plist = s => (!s || s === sym.eps ? '' : String(s).split('|').map(pstr).join('+'));
  const o = s => (!s || s === sym.eps ? '' : splitBy(String(s), A.out).map(c => symTok(A.out.indexOf(c), A.out.length)).join(''));
  const action = x => {
    switch (t) {
      case 'fa': return A.out ? o(x.output) : '';
      case '2fa': return (A.out ? o(x.output) : '') + (x.dir || 'S');
      case 'tm': case 'lba': return g(x.write) + (x.dir || 'S');
      case 'tmk':
        if (x.tapeSyms?.length !== k) throw new SMTFError(`A transition reads ${x.tapeSyms?.length ?? 0} tapes on a ${k}-tape machine.`);
        return x.tapeSyms.slice(1).map(g).join('') + x.tapeWrites.map((w, i) => g(w) + (x.tapeDirs[i] || 'S')).join('');
      case 'pda': case 'qa': return p(x.pop) + pstr(x.push) + (A.out ? ',' + o(x.output) : '');
      case 'pda2': return p(x.pop) + p(x.pop2) + pstr(x.push) + ',' + pstr(x.push2);
      case 'epda': return p(x.pop) + plist(x.below) + ',' + pstr(x.push) + ',' + plist(x.above);
      default: return '';
    }
  };

  const outOf = new Map();
  for (const x of ts) { if (!outOf.has(x.from)) outOf.set(x.from, []); outOf.get(x.from).push(x); }

  // ── blocks: keep the clean subroutines, write the rest flat ──
  const warnings = [];
  const blocks = cleanBlocks({ ...doc, states }, outOf, sym, warnings);
  const container = new Map(states.map(s => [s.id, blocks.has(s.blockId) ? s.blockId : null]));
  const isExitEdge = x => (t === 'tmk'
    ? x.tapeSyms.every(v => v === sym.any) && x.tapeWrites.every(v => v === sym.any) && x.tapeDirs.every(d => d === 'S')
    : x.symbol === sym.any && (x.write === sym.any || !x.write) && x.dir === 'S');

  // Accepting dead ends at the top level are all one state — the halt.
  const halts = new Set(t === 'moore' ? [] : states
    .filter(s => container.get(s.id) === null && accepts.has(s.id) && !outOf.has(s.id) && s.id !== doc.startId)
    .map(s => s.id));

  // ── a scope: the rows of a block, or of the machine ──
  const scopes = new Map();
  const scopeOf = id => {
    if (scopes.has(id)) return scopes.get(id);
    const b = id ? blocks.get(id) : null;
    const exits = b ? b.exits.map(e => e.id) : [];
    const nodes = new Map();
    for (const s of states) if (container.get(s.id) === id && !exits.includes(s.id) && !halts.has(s.id)) nodes.set(s.id, { id: s.id, s });
    const entryOf = new Map();
    for (const c of blocks.values()) if (c.parent === id) { nodes.set('#' + c.id, { id: '#' + c.id, b: c }); entryOf.set(c.entry, '#' + c.id); }
    const resolve = to => {
      if (nodes.has(to)) return { node: to };
      if (entryOf.has(to)) return { node: entryOf.get(to) };
      if (b && exits.includes(to)) return { port: exits.indexOf(to) };
      if (!b && halts.has(to)) return { port: 0 };
      throw new SMTFError(`An edge into ${to} crosses a block boundary.`);
    };
    const entry = b ? b.entry : doc.startId;
    const sc = { id, b, nodes, resolve, exits, entry: nodes.has(entry) ? entry : entryOf.get(entry) };
    scopes.set(id, sc);
    return sc;
  };

  // A state's cells: per column, its moves as {act, to, w}. Where the app runs
  // "every match", the wildcard's moves are copied into every explicit column
  // that has moves of its own, so that SMTF's "otherwise" says the same thing;
  // the reader takes the copies back out for the types that need them.
  const cellsOf = (sc, s) => {
    const edges = outOf.get(s.id) || [];
    const cells = cols.map(c => edges.filter(x => readOf(x) === c).map(x => ({ act: action(x), to: sc.resolve(x.to), w: x.weight })));
    if (everyMatch) {
      const star = cells[cells.length - 1], eps = cols.indexOf(sym.eps);
      cells.forEach((cell, i) => {
        if (i === cells.length - 1 || i === eps || !cell.length) return;
        for (const e of star) if (!cell.some(x => x.act === e.act && x.to.node === e.to.node && x.to.port === e.to.port && x.w === e.w)) cell.push(e);
      });
    }
    return cells;
  };
  const wiring = (sc, node) => node.b.exits.map(e => {
    const edge = (outOf.get(e.id) || []).find(isExitEdge);
    return edge ? sc.resolve(edge.to) : null;
  });
  const mark = s => {
    if (t === 'pa') return s.priority ? String(s.priority) : '';
    return (accepts.has(s.id) ? '+' : '') + (t === 'moore' ? o(s.output) : '');
  };

  // ── canonical order: BFS from the entry, ties broken by colour refinement ──
  const defKey = new Map();
  function canonicalOrder(sc) {
    const nodes = [...sc.nodes.values()];
    const succ = n => (n.b
      ? wiring(sc, n).map(r => [null, r])
      : cellsOf(sc, n.s).flatMap((cell, ci) => cell.map(e => [`${String(ci).padStart(5, '0')}:${e.act}:${e.w ?? ''}`, e.to])));
    let colour = new Map(nodes.map(n => [n.id, n.b ? 'I' + defKey.get(n.b.id) : 'S' + mark(n.s)]));
    const c = r => (r == null ? '-' : r.node != null ? colour.get(r.node) : 'p' + r.port);
    for (let round = 0; round <= nodes.length; round++) {
      const sig = new Map(nodes.map(n => [n.id, colour.get(n.id) + '#' + succ(n).map(([a, r]) => `${a}>${c(r)}`).sort().join('/')]));
      const keys = [...new Set(sig.values())].sort();
      const next = new Map(nodes.map(n => [n.id, String(keys.indexOf(sig.get(n.id)))]));
      const stable = new Set(next.values()).size === new Set(colour.values()).size;
      colour = next;
      if (stable && round) break;
    }
    const order = [], seen = new Set();
    const visit = id => { if (id != null && !seen.has(id)) { seen.add(id); order.push(id); } };
    visit(sc.entry);
    for (let i = 0; ; i++) {
      if (i === order.length) {
        // Unreachable nodes follow, each opening a BFS of its own.
        const rest = nodes.filter(n => !seen.has(n.id)).sort((a, b) => cmp(colour.get(a.id), colour.get(b.id)))[0];
        if (!rest) break;
        visit(rest.id);
      }
      const n = sc.nodes.get(order[i]);
      succ(n).sort((a, b) => (a[0] === null ? 0 : cmp(a[0], b[0]) || cmp(c(a[1]), c(b[1]))))
        .forEach(([, r]) => r && r.node != null && visit(r.node));
    }
    return order;
  }

  // ── a scope's rows; definitions bottom-up, keyed by their own text ──
  const defs = new Map(); // key → { rows, names, defaults }
  const localName = x => String(x ?? '').split('/').pop();
  function encodeScope(id) {
    const sc = scopeOf(id);
    for (const n of sc.nodes.values()) if (n.b) encodeScope(n.b.id);
    const order = canonicalOrder(sc);
    const pos = new Map(order.map((nid, i) => [nid, i]));
    const w = nameWidth(order.length);
    const target = r => (r.node != null ? letters(pos.get(r.node), w) : id ? String.fromCharCode(97 + r.port) : 'Z'.repeat(w));
    const rows = order.map(nid => {
      const n = sc.nodes.get(nid);
      if (n.b) {
        const wires = wiring(sc, n).map(r => (r ? target(r) : T.none));
        while (wires.length && wires[wires.length - 1] === T.none) wires.pop();
        return { ref: defKey.get(n.b.id), tail: wires.join('') };
      }
      const cells = cellsOf(sc, n.s).map(cell => {
        const es = [...new Set(cell.map(e => e.act + target(e.to) + (e.w != null && Number(e.w) !== 1 ? fmtNumber(e.w) : '')))].sort(cmp);
        return !es.length ? NONE : es.length === 1 ? es[0] : `(${es.join('')})`;
      });
      while (cells.length > fixedCols && cells[cells.length - 1] === NONE) cells.pop();
      return { text: mark(n.s) + cells.join('') };
    });
    const names = order.map(nid => { const n = sc.nodes.get(nid); return n.b ? localName(n.b.name) : localName(n.s.name); });
    if (id) {
      const key = rows.map(r => (r.ref ? `=[${r.ref}]${r.tail}` : r.text)).join('_');
      defKey.set(id, key);
      const b = blocks.get(id);
      if (!defs.has(key)) defs.set(key, { rows, names: [localName(b.name), ...names, ...b.exits.map(e => e.label || '')] });
    }
    return { rows, names };
  }
  const main = encodeScope(null);

  // Definitions are numbered by first reference, walking down from the top.
  const index = new Map();
  const queue = [main.rows];
  while (queue.length) {
    for (const r of queue.shift()) if (r.ref && !index.has(r.ref)) { index.set(r.ref, index.size); queue.push(defs.get(r.ref).rows); }
  }
  const text = rows => rows.map(r => (r.ref ? `=${index.get(r.ref)}${r.tail}` : r.text)).join('_');
  const ordered = [...index.keys()].map(key => defs.get(key));

  // ── head ──
  let head = t === 'tmk' ? `tm${k}` : t;
  head += '.' + writeAlphabet(sigma);
  if (TAPE.has(t)) { const extra = A.gamma.slice(1 + sigma.length); if (extra.length) head += '.' + writeAlphabet(extra); }
  if (STORE.has(t)) head += '.' + writeAlphabet(A.gamma);
  if (A.out) head += '.' + writeAlphabet(A.out);
  if ((m === 'TM' || m === 'NDTM' || m === 'MTM') && !cfg.twoWayTape) head += '@h';
  if (emptyStore) head += '@e';
  if (TRANSDUCERS.has(m) && cfg.transducerAccepts) head += '@v';
  if (t === 'pfa' && cfg.pfaCutPoint != null && Number(cfg.pfaCutPoint) !== 0.5) head += '@c' + fmtNumber(cfg.pfaCutPoint);

  let code = `${head}:${[text(main.rows), ...ordered.map(d => text(d.rows))].join(';')}`;
  if (labels) {
    // A name the reader would have made up anyway is not written, so a
    // machine opened from a code and copied again carries no labels at all.
    const topDefault = i => (TAPE.has(t) && t !== 'tmk' && main.rows.length < 26 ? letters(i, 1) : `q${i}`);
    const mainNames = main.names.map((nm, i) => (main.rows[i].ref ? (nm === defaultInstanceName(ordered[index.get(main.rows[i].ref)]?.names[0]) ? '' : nm) : nm === topDefault(i) ? '' : nm));
    if (halts.size) { const h = states.find(s => halts.has(s.id))?.name ?? ''; mainNames.push(h === 'halt' ? '' : h); }
    const defNames = ordered.map(d => d.names.map((nm, i) => {
      if (i === 0) return nm === 'block' ? '' : nm;
      const row = i - 1, exit = row - d.rows.length;
      if (exit >= 0) return nm === `exit ${exit}` ? '' : nm;
      const r = d.rows[row];
      return r.ref ? (nm === defaultInstanceName(ordered[index.get(r.ref)]?.names[0]) ? '' : nm) : nm === `q${row}` ? '' : nm;
    }));
    const group = list => { const l = [...list]; while (l.length && l[l.length - 1] === '') l.pop(); return l.map(labelEsc).join(','); };
    const groups = [labelEsc(doc.meta?.title || ''), group(mainNames), ...defNames.map(group)];
    while (groups.length && groups[groups.length - 1] === '') groups.pop();
    if (groups.length) code += '~' + groups.join('~');
  }
  return { code, warnings };
}

const defaultInstanceName = defName => defName || 'block';

// A block is written as a subroutine only if it is one: entered only at its
// entry, left only from an exit along an exit edge (Σ/Σ,S), with no moves out
// of an exit but that one. Anything else is dissolved into its parent — the
// fixed point matters, since a dissolved block's states become its parent's.
function cleanBlocks(doc, outOf, sym, warnings) {
  const all = new Map((doc.blocks || []).map(b => [b.id, { ...b, parent: b.parent ?? null }]));
  const states = doc.states;
  const isExitEdge = x => (x.tapeSyms
    ? x.tapeSyms.every(v => v === sym.any) && (x.tapeDirs || []).every(d => d === 'S')
    : x.symbol === sym.any && x.dir === 'S' && (x.write === sym.any || !x.write));
  for (;;) {
    let dissolved = null;
    for (const b of all.values()) {
      const inBlock = new Set([b.id]);
      for (let grew = true; grew;) { grew = false; for (const c of all.values()) if (c.parent && inBlock.has(c.parent) && !inBlock.has(c.id)) { inBlock.add(c.id); grew = true; } }
      const inside = new Set(states.filter(s => inBlock.has(s.blockId)).map(s => s.id));
      const exits = (b.exits || []).map(e => e.id);
      let why = null;
      if (!inside.has(b.entry)) why = 'its entry is not inside it';
      else if (exits.includes(b.entry)) why = 'its entry is also an exit';
      else if (inside.has(doc.startId) && doc.startId !== b.entry) why = 'the machine starts inside it';
      else if (exits.some(e => (doc.accepts || []).includes(e))) why = 'an exit is an accepting state';
      else if (exits.some(e => (outOf.get(e) || []).length > 1)) why = 'an exit has more than one way out';
      else {
        for (const x of doc.transitions || []) {
          const from = inside.has(x.from), to = inside.has(x.to);
          if (!from && to && x.to !== b.entry) { why = 'an edge enters it past its entry'; break; }
          if (from && to && exits.includes(x.from)) { why = 'an exit has moves inside the block'; break; }
          if (from && !to && !exits.includes(x.from)) { why = 'an edge leaves it from a state that is not an exit'; break; }
          if (from && !to && !isExitEdge(x)) { why = 'an exit leaves on something other than Σ/Σ,S'; break; }
        }
      }
      if (why) { dissolved = b; warnings.push(`Block "${b.name}" is written flat: ${why}.`); break; }
    }
    if (!dissolved) return all;
    for (const c of all.values()) if (c.parent === dissolved.id) c.parent = dissolved.parent;
    for (const s of states) if (s.blockId === dissolved.id) s.blockId = dissolved.parent;
    all.delete(dissolved.id);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  READ
// ═══════════════════════════════════════════════════════════════════
/**
 * A code → the loadData fields, plus `blocks` and `meta`. Positions are left
 * for the caller. A bare STF string (no head) is read as the rows of a
 * two-way `tm` over the digits.
 */
export function readMachineCode(code, { sym = DEFAULT_SYM } = {}) {
  let src = String(code ?? '').trim();
  const link = /#m=([^\s"'<>]+)/.exec(src);
  if (link) src = link[1];
  if (!src.includes(':')) {
    const k = src.split('_')[0].length / 3;
    if (!Number.isInteger(k) || k < 2) throw new SMTFError('Not a machine code (e.g. fa.01:+AB_BA).');
    src = `tm.${Array.from({ length: k - 1 }, (_, i) => i + 1).join('')}:${src}`;
  }
  let [codePart, ...labelParts] = src.split('~');
  const colon = codePart.indexOf(':');
  // The body never contains %, so one that does came through a client that
  // percent-encoded the link on the way; the head and labels are left alone,
  // since their escapes are their own.
  if (codePart.slice(colon + 1).includes('%')) {
    codePart = codePart.slice(0, colon + 1) + decodeURIComponent(codePart.slice(colon + 1));
  }
  const [typeAndAlphabets, ...options] = codePart.slice(0, colon).split('@');
  const [tname, ...alphabets] = typeAndAlphabets.split('.');
  const tapes = /^tm(\d+)$/.exec(tname);
  const t = tapes ? 'tmk' : tname;
  const k = tapes ? Number(tapes[1]) : 1;
  if (!TYPES.includes(t) && t !== 'tmk') throw new SMTFError(`"${tname}" is not a machine type — one of ${TYPES.join(', ')}, or tm2, tm3, … for tapes.`);
  if (t === 'tmk' && k < 2) throw new SMTFError(`A multi-tape machine needs at least two tapes, not ${k}.`);
  const opt = { h: false, e: false, v: false, c: 0.5 };
  for (const o of options) {
    if (o === 'h' || o === 'e' || o === 'v') opt[o] = true;
    else if (o[0] === 'c' && Number.isFinite(Number(o.slice(1)))) opt.c = Number(o.slice(1));
    else throw new SMTFError(`@${o} is not an option this reader knows — it would change what the machine means, so it is refused rather than ignored.`);
  }

  const A = { sigma: readAlphabet(alphabets[0] ?? ''), gamma: null, out: null };
  let ai = 1;
  if (TAPE.has(t)) A.gamma = [sym.blank, ...A.sigma, ...readAlphabet(alphabets[ai++] ?? '')];
  if (STORE.has(t)) A.gamma = readAlphabet(alphabets[ai++] ?? '');
  if (alphabets[ai] != null || t === 'moore') A.out = readAlphabet(alphabets[ai++] ?? '');
  if (alphabets.length > ai) throw new SMTFError(`A ${tname} has ${ai} alphabet${ai > 1 ? 's' : ''}, and this code gives ${alphabets.length}.`);
  const cols = columnsOf(t, A, sym);
  const gw = A.gamma ? digitsFor(A.gamma.length) : 1, ow = A.out ? digitsFor(A.out.length) : 1;
  const labelGroups = labelParts.map(g => (g === '' ? [] : g.split(',').map(labelUnesc)));
  const title = labelParts.length ? labelUnesc(labelParts[0]) : '';

  const scopesSrc = codePart.slice(colon + 1).split(';');
  const out = { states: [], transitions: [], blocks: [], accepts: [] };
  let sN = 0, tN = 0, bN = 0;
  const addState = (name, blockId) => { const s = { id: `s${++sN}`, name }; if (blockId) s.blockId = blockId; out.states.push(s); return s; };
  const addEdge = x => out.transitions.push({ id: `t${++tN}`, ...x });
  const exitEdge = (from, to) => (t === 'tmk'
    ? { from, to, symbol: sym.any, tapeSyms: Array(k).fill(sym.any), tapeWrites: Array(k).fill(sym.any), tapeDirs: Array(k).fill('S') }
    : { from, to, symbol: sym.any, write: sym.any, dir: 'S' });
  let haltId = null, single = true, epsUsed = false;
  const finish = [];
  const building = new Set();

  // Scope `si` (0 is the machine), placed under `blockId` with state names
  // prefixed by `prefix`. Answers its entry and a function for its exits.
  function build(si, prefix, blockId, names) {
    if (scopesSrc[si] == null) throw new SMTFError(`The code places definition ${si - 1}, which it does not give.`);
    if (building.has(si)) throw new SMTFError(`Definition ${si - 1} places itself — a block cannot contain itself.`);
    building.add(si);
    const rowsSrc = scopesSrc[si].split('_');
    const n = rowsSrc.length;
    const w = nameWidth(n);
    const exitIds = [];
    const exitAt = i => {
      while (exitIds.length <= i) exitIds.push(addState(prefix + (names?.[1 + n + exitIds.length] || `exit ${exitIds.length}`), blockId).id);
      return exitIds[i];
    };
    const halt = () => {
      if (!haltId) { haltId = addState(names?.[n] || 'halt', null).id; out.accepts.push(haltId); }
      return haltId;
    };
    const nameAt = i => (si === 0 ? names?.[i] : names?.[i + 1]);
    const siblings = new Set();
    const nodes = rowsSrc.map((row, i) => {
      const inst = /^=(\d+)/.exec(row);
      if (!inst) {
        const fallback = si === 0 && t !== 'tmk' && TAPE.has(t) && n < 26 ? letters(i, 1) : `q${i}`;
        return { id: addState(prefix + (nameAt(i) || fallback), blockId).id, rest: row };
      }
      const di = Number(inst[1]) + 1;
      let name = nameAt(i) || defaultInstanceName(labelGroups[di + 1]?.[0]);
      for (let j = 2; siblings.has(name); j++) name = `${nameAt(i) || defaultInstanceName(labelGroups[di + 1]?.[0])} ${j}`;
      siblings.add(name);
      const rec = { id: `b${++bN}`, name, parent: blockId, entry: null, exits: [], x: 0, y: 0, w: null, h: null, source: null, version: 1, collapsed: true };
      out.blocks.push(rec);
      const inner = build(di, `${prefix}${name}/`, rec.id, labelGroups[di + 1]);
      rec.entry = inner.entry;
      // Exits are made on demand — by the definition reaching them or by a
      // parent wiring them — so they are read off once everything is built.
      finish.push(() => { rec.exits = inner.exitIds.map((id, j) => ({ id, label: labelGroups[di + 1]?.[1 + inner.n + j] || `exit ${j}` })); });
      return { inst: inner, rest: row.slice(inst[0].length) };
    });
    const nodeId = r => (r.inst ? r.inst.entry : r.id);
    const target = tk => {
      if (/^[a-z]$/.test(tk)) {
        if (si === 0) throw new SMTFError(`"${tk}" names an exit, and the machine itself has none — its halt is Z.`);
        return exitAt(tk.charCodeAt(0) - 97);
      }
      const i = unletters(tk);
      if (i < n) return nodeId(nodes[i]);
      if (si !== 0) throw new SMTFError(`State ${tk} is past the last row of definition ${si - 1}; its exits are lowercase.`);
      return halt();
    };

    nodes.forEach((r, i) => {
      const L = lexer(r.rest, w, `${si ? `definition ${si - 1}, ` : ''}row ${letters(i, w)}`);
      if (r.inst) {
        for (let j = 0; !L.done(); j++) {
          if (L.peek() === T.none) { L.take(T.none); continue; }
          addEdge(exitEdge(r.inst.exitAt(j), target(L.state())));
        }
        return;
      }
      const from = r.id;
      const state = out.states.find(s => s.id === from);
      if (t === 'pa') { const d = L.digits(); if (d) state.priority = Number(d); }
      else {
        if (L.peek() === '+') { L.take('+'); out.accepts.push(from); }
        if (t === 'moore') state.output = L.tokens(A.out, ow).join('');
      }
      for (let c = 0; !L.done(); c++) {
        if (c >= cols.length) throw L.error(`more cells than the ${cols.length} columns`);
        const col = cols[c];
        if (L.peek() === T.none) { L.take(T.none); if (t === 'tm' || t === 'lba') { L.take('-'); L.take('-'); } continue; }
        const group = L.peek() === '(';
        if (group) L.take('(');
        const acts = [];
        do acts.push(readAction(L, col)); while (group && L.peek() !== ')');
        if (group) L.take(')');
        if (acts.length > 1) single = false;
        if (col === sym.eps) epsUsed = true;
        for (const a of acts) addEdge({ from, ...a, to: target(a.to) });
      }
    });
    building.delete(si);
    return { entry: nodeId(nodes[0]), exitIds, exitAt, n };
  }

  function readAction(L, col) {
    const x = { symbol: col };
    const g = () => L.sym(A.gamma, gw, true);
    const p = () => (L.peek() === T.eps ? (L.take(T.eps), sym.eps) : L.sym(A.gamma, gw));
    const pstr = () => {
      if (L.peek() === T.any) { L.take(T.any); return sym.any; }
      const syms = L.tokens(A.gamma, gw);
      return syms.length ? syms.join(t === 'epda' && syms.some(s => s.length > 1) ? ' ' : '') : sym.eps;
    };
    const plist = () => { const xs = [pstr()]; while (L.peek() === '+') { L.take('+'); xs.push(pstr()); } return xs.length === 1 && xs[0] === sym.eps ? '' : xs.join('|'); };
    const o = () => L.tokens(A.out, ow).join('');
    switch (t) {
      case 'fa': if (A.out) x.output = o(); break;
      case '2fa': if (A.out) x.output = o(); x.dir = L.move(); break;
      case 'tm': case 'lba': x.write = g(); x.dir = L.move(); break;
      case 'tmk':
        x.tapeSyms = [col, ...Array.from({ length: k - 1 }, g)];
        x.tapeWrites = []; x.tapeDirs = [];
        for (let j = 0; j < k; j++) { x.tapeWrites.push(g()); x.tapeDirs.push(L.move()); }
        break;
      case 'pda': case 'qa': x.pop = p(); x.push = pstr(); if (A.out) { L.take(','); x.output = o(); } break;
      case 'pda2': x.pop = p(); x.pop2 = p(); x.push = pstr(); L.take(','); x.push2 = pstr(); break;
      case 'epda': x.pop = p(); x.below = plist(); L.take(','); x.push = pstr(); L.take(','); x.above = plist(); break;
    }
    x.to = L.state();
    if (t === 'pfa') x.weight = L.weight() ?? 1;
    return x;
  }

  function lexer(s, w, where) {
    let i = 0;
    const L = {
      error: what => new SMTFError(`${where[0].toUpperCase()}${where.slice(1)}: expected ${what} at "${s.slice(i, i + 8) || 'the end'}".`),
      peek: () => s[i],
      done: () => i >= s.length,
      take(c) { if (s[i] !== c) throw L.error(`"${c}"`); i++; },
      digits() { const d = /^\d*/.exec(s.slice(i))[0]; i += d.length; return d; },
      state() {
        if (/[a-z]/.test(s[i] || '')) return s[i++];
        const x = s.slice(i, i + w);
        if (x.length !== w || !/^[A-Z]+$/.test(x)) throw L.error(w > 1 ? `a ${w}-letter state` : 'a state');
        i += w; return x;
      },
      move() { const c = s[i]; if (c !== 'L' && c !== 'R' && c !== 'S') throw L.error('a move (L, R or S)'); i++; return c; },
      sym(list, width, markers = false) {
        const c = s[i];
        if (c === T.any) { i++; return sym.any; }
        if (markers && c === T.left) { i++; return sym.leftMarker; }
        if (markers && c === T.right) { i++; return sym.rightMarker; }
        const x = s.slice(i, i + width);
        if (x.length !== width || !/^\d+$/.test(x) || !list || list[Number(x)] === undefined) throw L.error(`a symbol (0–${Math.max((list?.length ?? 1) - 1, 0)})`);
        i += width; return list[Number(x)];
      },
      tokens(list, width) { const r = []; while (i < s.length && /\d/.test(s[i])) r.push(L.sym(list, width)); return r; },
      weight() { const m = /^(\d*\.\d+|\d+)/.exec(s.slice(i)); if (!m) return null; i += m[1].length; return Number(m[1]); }
    };
    return L;
  }

  const main = build(0, '', null, labelGroups[1]);
  finish.forEach(f => f());

  // ── which app type this is, read off δ ──
  const deterministic = single && !epsUsed;
  let machine;
  switch (t) {
    case 'fa': machine = A.out ? (deterministic ? 'Mealy' : 'FST') : deterministic ? 'DFA' : epsUsed ? 'ε-NFA' : 'NFA'; break;
    case 'pfa': machine = 'PFA'; break;
    case 'ba': machine = deterministic ? 'DBA' : 'NBA'; break;
    case 'cba': machine = deterministic ? 'DcoBA' : 'NcoBA'; break;
    case 'pa': machine = deterministic ? 'DPA' : 'NPA'; break;
    case 'moore': machine = 'Moore'; break;
    case '2fa': machine = A.out ? '2DFT' : deterministic ? '2DFA' : '2NFA'; break;
    case 'tm': machine = deterministic ? (opt.h ? 'TM' : 'ITM') : 'NDTM'; break;
    case 'lba': machine = 'LBA'; break;
    case 'tmk': machine = 'MTM'; break;
    case 'pda': machine = A.out ? 'PDT' : pushdownIsDeterministic(out.transitions, sym) ? 'DPDA' : 'NPDA'; break;
    case 'qa': machine = 'QA'; break;
    case 'pda2': machine = '2PDA'; break;
    case 'epda': machine = 'EPDA'; break;
  }
  // "Otherwise" back to "every match", for the types the app runs that way.
  if (APP_TYPES[machine][1]) {
    const same = x => JSON.stringify({ ...x, id: 0, symbol: 0 });
    const byState = new Map();
    for (const x of out.transitions) { if (!byState.has(x.from)) byState.set(x.from, []); byState.get(x.from).push(x); }
    const drop = new Set();
    for (const list of byState.values()) {
      const star = new Set(list.filter(x => x.symbol === sym.any).map(same));
      for (const x of list) if (x.symbol !== sym.any && x.symbol !== sym.eps && star.has(same(x))) drop.add(x.id);
    }
    out.transitions = out.transitions.filter(x => !drop.has(x.id));
  }

  const config = {};
  if (machine === 'TM' || machine === 'NDTM' || machine === 'MTM') config.twoWayTape = !opt.h;
  if (STORE.has(t)) config.pdaParadigm = opt.e ? 'empty' : 'explicit';
  if (t === 'pfa') config.pfaCutPoint = opt.c;
  if (TRANSDUCERS.has(machine)) config.transducerAccepts = opt.v;

  const data = {
    machine,
    sigma: A.sigma,
    // Γ as the app writes it: the blank included, and an LBA's markers too.
    stackAlpha: A.gamma ? [...A.gamma, ...(t === 'lba' ? [sym.leftMarker, sym.rightMarker] : [])] : undefined,
    outputAlpha: A.out || undefined,
    tapeCount: t === 'tmk' ? k : undefined,
    states: out.states,
    transitions: out.transitions,
    startId: main.entry,
    accepts: [...new Set(out.accepts)],
    blocks: out.blocks,
    config
  };
  if (title) data.meta = { title };
  return data;
}

// No two moves from one state can both apply: their reads agree or one is ε,
// and their pops agree or one is ε or any.
function pushdownIsDeterministic(transitions, sym) {
  const by = new Map();
  for (const x of transitions) { if (!by.has(x.from)) by.set(x.from, []); by.get(x.from).push(x); }
  const meet = (a, b) => a === b || a === sym.eps || b === sym.eps || a === sym.any || b === sym.any;
  for (const list of by.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (meet(list[i].symbol, list[j].symbol) && meet(list[i].pop, list[j].pop)) return false;
      }
    }
  }
  return true;
}
