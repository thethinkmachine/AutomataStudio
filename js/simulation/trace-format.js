// How a step's note is drawn in the Trace card.
//
// A note is a sentence each machine family writes for itself — `Read 'a' → q1`,
// `State:q0 Read:'a' @3`, `Branch 1 depth 2: (q0, a, Z) → (q1, AZ)` — with two
// conventions every family shares: a verdict appended as ` — ACCEPT` (or
// REJECT, LOOP: …, NO VERDICT: …), and a transducer's output as
// ` | Output: "…"`. Drawn as one string, all of that read the same: symbols,
// states, arrows and the verdict in one colour, and a verdict that wrapped onto
// a line of its own.
//
// So the note is lifted into parts here, for the eye only — never for
// meaning: nothing downstream reads this HTML, the simulators do not change,
// and anything the patterns below do not recognise is drawn exactly as it was
// written. A family that words its notes differently loses nothing but the
// emphasis.
//
// Import-free and DOM-free, so it is testable on its own and costs nothing to
// run once per drawn row.

/** The verdicts a note can end in, and the badge each is drawn as. */
const VERDICTS = [
  ['Implicit REJECT', 'reject', 'reject'],
  ['NO VERDICT', 'timeout', 'no verdict'],
  ['ACCEPT', 'accept', 'accept'],
  ['REJECT', 'reject', 'reject'],
  ['HALT', 'reject', 'halt'],
  ['LOOP', 'loop', 'loop'],
  ['dead branch', 'reject', 'dead']
];

const VERDICT_RE = new RegExp(
  ` — (${VERDICTS.map(v => v[0]).join('|')})(?:[:,]\\s*([^|]*?))?\\s*$`);
const OUTPUT_RE = / \| (Outputs?): (.*)$/;

const BADGE_FOR_FINAL = {
  accept: ['accept', 'accept'],
  reject: ['reject', 'reject'],
  loop: ['loop', 'loop'],
  timeout: ['timeout', 'no verdict']
};

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The body of a note — everything but its verdict and its output — with emphasis. */
function emphasise(text) {
  let s = text;
  // "Branch 1 depth 2: " opens every step of a searched run. It is bookkeeping
  // about the search, not the move, so it is quiet.
  s = s.replace(/^Branch (\d+) depth (\d+): /,
    '<span class="tr-meta">branch $1 · depth $2</span> ');
  s = s.replace(/^Start configuration$/, '<span class="tr-tag">start</span>');
  s = s.replace(/^Start ε-closure: (.+?)(?= — |$)/,
    '<span class="tr-tag">start</span><span class="tr-tag">ε-closure</span><span class="tr-state">$1</span>');
  // A state name may have spaces in it ("carry 0"), so it runs to the next
  // separator rather than to the next space.
  s = s.replace(/^Start: (.+?)(?= — |$)/, '<span class="tr-tag">start</span><span class="tr-state">$1</span>');
  // A Turing machine's configuration: State:q0 Read:'a' @3
  s = s.replace(/^State:(.+?)(?= Read:| @|$)/, '<span class="tr-state">$1</span>');
  s = s.replace(/ Read:/, ' <span class="tr-tag">read</span>');
  s = s.replace(/^Read /, '<span class="tr-tag">read</span>');
  // A Mealy machine's per-step output rides on an em dash that is not a
  // verdict, so it is named rather than left to read as one.
  s = s.replace(/ — out: /, ' <span class="tr-tag">out</span>');
  // Quoted symbols become chips; the quotes were only there to fence them.
  s = s.replace(/&#39;([^&]*?)&#39;|'([^']*)'/g, (_m, a, b) => symChip(a ?? b));
  // The arrow, and the state (or set of states) it lands in.
  s = s.replace(/ → (\{[^}]*\}|(?!\()(?:(?! <span| — |, ).)+)/g,
    ' <span class="tr-arrow">→</span> <span class="tr-state">$1</span>');
  s = s.replace(/ → (?=\()/g, ' <span class="tr-arrow">→</span> ');
  return s;
}

function symChip(sym) {
  // The empty word is a symbol too, and a chip with nothing in it reads as a
  // rendering fault.
  return `<span class="tr-sym">${sym === '' ? 'ε' : sym}</span>`;
}

/**
 * A note as trace-row HTML: the body, a verdict badge, and any detail or
 * output on lines of their own under it.
 *
 * `final` is the step's verdict, used for the badge when the note words its
 * ending in a way the patterns do not know (a PDA's own `finalNote`).
 */
export function formatTraceNote(note, final = null) {
  const raw = note == null ? '' : String(note);
  // A note that carries its own markup (the NDTM's summary does) is drawn as
  // written: re-reading HTML with these patterns could only break it.
  if (raw.includes('<')) return raw;

  let text = escapeHtml(raw);
  let output = null;
  const out = text.match(OUTPUT_RE);
  if (out) {
    output = out[2];
    text = text.slice(0, out.index);
  }

  let badge = null;
  let detail = null;
  const v = text.match(VERDICT_RE);
  if (v) {
    const [, word] = v;
    const [, kind, label] = VERDICTS.find(x => x[0] === word);
    badge = { kind, label };
    detail = v[2] || null;
    text = text.slice(0, v.index);
  } else if (final && BADGE_FOR_FINAL[final]) {
    const [kind, label] = BADGE_FOR_FINAL[final];
    badge = { kind, label };
  }

  let html = emphasise(text);
  if (badge) html += ` <span class="tr-badge is-${badge.kind}">${badge.label}</span>`;
  if (detail) html += `<span class="tr-detail">${detail}</span>`;
  if (output != null) {
    html += `<span class="tr-out"><span class="tr-tag">output</span>${emphasiseOutput(output)}</span>`;
  }
  return html;
}

/** `"1001"` or `{"01", "10"}` — each string a chip. */
function emphasiseOutput(s) {
  return s.replace(/&quot;([^&]*?)&quot;/g, (_m, w) => symChip(w))
    .replace(/^\{|\}$/g, '');
}
