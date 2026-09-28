// ══════════════════════════════════════════════════════════════════
//  A CONTENT HASH, SYNCHRONOUS
// ══════════════════════════════════════════════════════════════════
// Two 32-bit lanes of a multiply-xorshift mix (cyrb53's construction, widened
// to 64 bits), printed as 16 hex digits.
//
// It is not a security primitive and nothing here needs one. The library uses
// it in two places: to say whether the file a reader has open is still the file
// the index lists ("update available"), and to fingerprint a minimal DFA so two
// entries for the same language find each other. The first is compared against
// a value the same function wrote; the second is always confirmed by an exact
// equivalence check before anything is claimed. A collision costs a redundant
// check, never a wrong answer.
//
// Synchronous on purpose: `crypto.subtle.digest` is asynchronous, which would
// make every caller asynchronous, and Node's `crypto` is not the browser's.
// This one is the same function in the app, in the test suite and in the
// library's CI, which is the property that matters.
//
// Import-free, so CI can use it without evaluating the app.

export function hash64(input) {
  const str = String(input ?? '');
  let h1 = 0xdeadbeef ^ str.length, h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return hex32(h2) + hex32(h1);
}

function hex32(n) {
  return (n >>> 0).toString(16).padStart(8, '0');
}

/**
 * The machine a document describes, hashed without where anything was drawn:
 * type, alphabets, states by id and name, transitions by every field but their
 * shape, start and accepting states. Two documents with the same structure hash
 * are the same machine however it was laid out — which is what the submit
 * dialog asks of a library machine opened and sent straight back.
 */
export function machineStructureHash(doc) {
  const d = doc || {};
  const drop = new Set(['x', 'y', 'curve', 'loopAngle', 'labelOffset']);
  const strip = o => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !drop.has(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const byId = (a, b) => String(a.id).localeCompare(String(b.id));
  return hash64(JSON.stringify([
    d.machine, [...(d.sigma || [])].sort(), [...(d.stackAlpha || [])].sort(), [...(d.outputAlpha || [])].sort(), d.tapeCount || 1,
    [...(d.states || [])].map(strip).sort(byId), [...(d.transitions || [])].map(strip).sort(byId),
    d.startId || null, [...(d.accepts || [])].sort()
  ]));
}

/**
 * The hash of a file's text, after the one normalisation Git itself applies on
 * Windows: CRLF → LF. Without it the same entry hashes differently depending on
 * which machine checked the repository out, and every reader on Windows would
 * be told an update is waiting that does not exist.
 */
export function contentHash(text) {
  return hash64(String(text ?? '').replace(/\r\n/g, '\n'));
}
