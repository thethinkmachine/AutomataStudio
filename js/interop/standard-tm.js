// ══════════════════════════════════════════════════════════════════
//  THE STANDARD TURING MACHINE TEXT FORMAT
// ══════════════════════════════════════════════════════════════════
// The one-line notation bbchallenge.org, the Busy Beaver wiki and most of the
// literature write a small Turing machine in:
//
//     1RB1LC_1RC1RB_1RD0LE_1LA1LD_1RZ0LA
//
// One `_`-separated segment per state, named A, B, C, … in order, A the start.
// Each segment is one triple per symbol read, 0 first: the symbol written, the
// move (L or R), and the next state. `---` is a transition left undefined. A
// letter past the last state — Z by convention, H in older papers — is halt.
//
// What it becomes here:
//
//   0         the blank. Every machine in this notation starts on a blank
//             tape, so the empty word is the run the notation is about.
//   1 … k-1   Σ, and Γ with the blank.
//   halt      one accepting state, whichever letter named it. The notation
//             has no accept/reject distinction — a machine halts or it does
//             not — and accepting is how a halt reads as a verdict here.
//   ---       no edge. The simulator stops there without accepting, which
//             is a halt the verdict cannot tell from a rejection, so the
//             reader says how many there were.
//   ITM       the two-way infinite tape the notation assumes; the head of a
//             busy beaver wanders left of where it started almost at once.
//
// Import-free and DOM-free: positions are the caller's business, since the
// notation carries none. Throws StandardTMError, with a sentence the status
// bar can show, for text that is recognisably this notation but malformed.

export class StandardTMError extends Error {}

const TRIPLE = /^(?:([0-9])([LR])([A-Z])|---)$/;

/**
 * The notation in `text`, normalised, or null when the text is not trying to
 * be it. Deliberately looser than the reader: text that *looks* like a machine
 * with a typo in it should be told what the typo is, not be silently treated
 * as something else.
 */
export function standardTMText(text) {
  if (typeof text !== 'string') return null;
  const src = text.trim().toUpperCase();
  if (src.length < 3 || src.length > 2000) return null;
  if (!/^[0-9A-Z_-]+$/.test(src)) return null;
  // The first triple is the fingerprint: nothing else anyone pastes starts
  // with a digit, a direction and a state letter.
  return /^(?:[0-9][LR][A-Z]|---)/.test(src) ? src : null;
}

function letter(i) {
  return String.fromCharCode(65 + i);
}

/**
 * Notation → the loadData fields, plus `title`, `meta` and `warnings`.
 * `sym` is App.config.sym, for the blank.
 */
export function readStandardTM(text, sym) {
  const src = standardTMText(text);
  if (!src) throw new StandardTMError('Not a Turing machine in the standard text format (e.g. 1RB1LB_1LA1RZ).');

  const segments = src.split('_');
  if (segments.some(s => !s)) throw new StandardTMError('Empty state in the machine — two underscores in a row, or one at an end.');
  if (segments.length > 26) throw new StandardTMError(`${segments.length} states — the notation names states A to Z, so it can describe at most 26.`);
  const bad = segments.findIndex(s => s.length % 3);
  if (bad >= 0) {
    throw new StandardTMError(`State ${letter(bad)} is "${segments[bad]}", ${segments[bad].length} characters — each state is one 3-character transition per symbol.`);
  }
  const k = segments[0].length / 3;
  const uneven = segments.findIndex(s => s.length / 3 !== k);
  if (uneven >= 0) {
    throw new StandardTMError(`State ${letter(uneven)} has ${segments[uneven].length / 3} transitions but state A has ${k} — every state needs one per symbol.`);
  }

  const n = segments.length;
  const blank = sym?.blank ?? '⊔';
  const symbolOf = d => (d === 0 ? blank : String(d));

  const states = segments.map((_, i) => ({ id: `s${i + 1}`, name: letter(i) }));
  const haltId = `s${n + 1}`;
  let haltUsed = false;
  let undefinedCount = 0;
  const transitions = [];

  segments.forEach((seg, i) => {
    for (let read = 0; read < k; read++) {
      const triple = seg.slice(read * 3, read * 3 + 3);
      const m = TRIPLE.exec(triple);
      if (!m) {
        throw new StandardTMError(`"${triple}" in state ${letter(i)} (reading ${read}) is not a transition — expected a digit written, L or R, and a state letter, or --- for undefined.`);
      }
      if (!m[1]) { undefinedCount++; continue; }
      const write = Number(m[1]);
      if (write >= k) {
        throw new StandardTMError(`"${triple}" in state ${letter(i)} writes ${write}, but a machine with ${k} transitions per state has only the symbols 0–${k - 1}.`);
      }
      const target = m[3].charCodeAt(0) - 65;
      const to = target < n ? states[target].id : haltId;
      if (target >= n) haltUsed = true;
      transitions.push({
        id: `t${transitions.length + 1}`,
        from: states[i].id,
        to,
        symbol: symbolOf(read),
        write: symbolOf(write),
        dir: m[2]
      });
    }
  });

  if (haltUsed) states.push({ id: haltId, name: 'halt' });

  const digits = Array.from({ length: k - 1 }, (_, d) => String(d + 1));
  const warnings = [];
  if (undefinedCount) {
    warnings.push(`${undefinedCount} undefined transition${undefinedCount > 1 ? 's' : ''} (---) left out: reaching one stops the machine without accepting.`);
  }
  if (!haltUsed) warnings.push('No transition halts, so no run of this machine can accept.');

  const title = `${n}-state ${k}-symbol Turing machine`;
  const blurb = [
    src,
    'Run it on the empty word: the notation starts every machine on a blank tape, with 0 as the blank.',
    ...warnings
  ].join('\n\n');

  return {
    machine: 'ITM',
    sigma: digits,
    stackAlpha: [...digits, blank],
    tapeCount: 1,
    states,
    transitions,
    startId: states[0].id,
    accepts: haltUsed ? [haltId] : [],
    source: src,
    title,
    warnings,
    meta: {
      title,
      blurb,
      inputs: [{ w: 'ε', label: 'blank tape' }]
    }
  };
}

// ── The other way ─────────────────────────────────────────────────

/**
 * A one-tape Turing machine → the notation, or null when it cannot be written
 * in it. The reverse of readStandardTM, and exact on what that reader produces:
 * a machine read from the notation writes back the same string.
 *
 * What the notation can say is narrow, and anything outside it answers null
 * rather than an approximation: the blank and the digits 1 … k-1 as the only
 * symbols (k ≤ 10), L and R as the only moves, a concrete symbol written, at
 * most 26 working states. The start state is A and the rest follow in the
 * machine's own order; a state that accepts and has no moves out is the halt,
 * and every edge into one is written with Z.
 *
 * `m` is the loadData shape — machine, states, transitions, startId, accepts —
 * and `sym` the symbols it was drawn with.
 */
export function writeStandardTM(m, sym) {
  if (!m || (m.machine !== 'TM' && m.machine !== 'ITM')) return null;
  const blank = sym?.blank ?? '⊔';
  const any = sym?.any;
  const states = m.states || [], transitions = m.transitions || [];
  const out = new Map();
  for (const t of transitions) {
    if (!out.has(t.from)) out.set(t.from, []);
    out.get(t.from).push(t);
  }
  const accepts = new Set(m.accepts || []);
  const halts = new Set(states.filter(s => accepts.has(s.id) && !out.has(s.id)).map(s => s.id));
  const start = states.find(s => s.id === m.startId);
  if (!start || halts.has(start.id)) return null;
  const working = [start, ...states.filter(s => s !== start && !halts.has(s.id))];
  if (working.length > 26) return null;
  const letterOf = new Map(working.map((s, i) => [s.id, letter(i)]));
  // Every non-halting state that accepts would change the verdict of a run
  // the notation cannot describe, so it is refused rather than dropped.
  if (working.some(s => accepts.has(s.id))) return null;

  const digit = s => (s === blank ? 0 : /^[1-9]$/.test(String(s)) ? Number(s) : -1);
  let k = 2;
  for (const t of transitions) {
    const r = digit(t.symbol), w = digit(t.write);
    if (r < 0 || w < 0 || (any && (t.symbol === any || t.write === any))) return null;
    if (t.dir !== 'L' && t.dir !== 'R') return null;
    k = Math.max(k, r + 1, w + 1);
  }
  const segments = working.map(s => {
    let seg = '';
    for (let c = 0; c < k; c++) {
      const hits = (out.get(s.id) || []).filter(t => digit(t.symbol) === c);
      if (hits.length > 1) return null;
      const t = hits[0];
      if (!t) { seg += '---'; continue; }
      const to = halts.has(t.to) ? 'Z' : letterOf.get(t.to);
      if (!to) return null;
      seg += `${digit(t.write)}${t.dir}${to}`;
    }
    return seg;
  });
  return segments.includes(null) ? null : segments.join('_');
}

/** bbchallenge.org's page for a machine in the notation. */
export function bbchallengeUrl(code, { halts = false } = {}) {
  return `https://bbchallenge.org/${code}${halts ? '&status=halt' : ''}`;
}
