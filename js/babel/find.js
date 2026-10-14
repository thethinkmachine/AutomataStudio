// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY OF BABEL — FINDING A VOLUME
// ══════════════════════════════════════════════════════════════════
// Borges's librarians never find the book they want; these can, because every
// machine converts straight to its number. One box, and what is typed decides
// what it does:
//
//   1537              that number in the chosen wing
//   dfa-3-2/977       an address: a volume, a room (dfa-3-2) or a wing (dfa)
//   (ab)*             a regular expression: its minimal DFA, numbered
//                     breadth-first — its canonical copy
//   fa.01:…, 1RB1LB_… a machine code or a standard TM code: that machine
//   canvas            the machine on the canvas, exactly as drawn
//
// Main thread: the canvas and the regex builder live there.

import { App } from '../core/state.js';
import { getWorkspaceData } from '../io/persistence.js';
import { thompsonBuild } from '../algorithms/thompson.js';
import { readStandardTM, standardTMText } from '../interop/standard-tm.js';
import { machineCodeText, readMachineCode } from '../interop/smtf.js';
import { formatAddress, parseAddress, parseNumber } from './address.js';
import { dfaOf, minimiseDfa } from './facts.js';
import { fromWingNumber, locateDocument, volumeNumber } from './volumes.js';
import { wingByKey } from './wings.js';

/**
 * Text → what it names:
 *   { kind: 'volume', key, params, volume, address, how, names?, notes? }
 *   { kind: 'room', key, params } · { kind: 'wing', key }
 *   { kind: 'error', error } · null for nothing typed.
 */
export function findVolume(text, { wing: wingKey = 'dfa' } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  if (/^canvas$/i.test(raw)) return fromDocument(getWorkspaceData(), 'the machine on the canvas');

  const n = parseNumber(raw);
  if (n !== null) {
    const wing = wingByKey(wingKey);
    if (!wing) return { kind: 'error', error: `There is no wing called “${wingKey}”.` };
    try {
      const { params, volume } = fromWingNumber(wing, n);
      return { kind: 'volume', key: wing.key, params, volume, address: formatAddress({ key: wing.key, params, volume }), how: `${wing.type} № ${raw}` };
    } catch (e) {
      return { kind: 'error', error: e.message };
    }
  }

  const addr = parseAddress(raw);
  if (addr && wingByKey(addr.key)) {
    const wing = wingByKey(addr.key);
    if (!addr.params && addr.wingNumber === null) return { kind: 'wing', key: wing.key };
    if (addr.params && addr.volume === null) return { kind: 'room', key: wing.key, params: addr.params };
    if (!addr.params) {
      try {
        const { params, volume } = fromWingNumber(wing, addr.wingNumber);
        return { kind: 'volume', key: wing.key, params, volume, address: formatAddress({ key: wing.key, params, volume }), how: 'the address' };
      } catch (e) { return { kind: 'error', error: e.message }; }
    }
    return { kind: 'volume', key: wing.key, params: addr.params, volume: addr.volume, address: formatAddress({ key: wing.key, params: addr.params, volume: addr.volume }), how: 'the address' };
  }

  const stm = standardTMText(raw);
  if (stm) {
    try {
      const doc = { ...readStandardTM(stm, App.config.sym), machine: 'ITM' };
      return fromDocument(doc, 'the standard code');
    } catch (e) { return { kind: 'error', error: e.message }; }
  }

  const code = machineCodeText(raw);
  if (code) {
    try { return fromDocument(readMachineCode(code), 'the machine code'); }
    catch (e) { return { kind: 'error', error: e.message }; }
  }

  return fromRegex(raw);
}

function fromDocument(doc, how) {
  const r = locateDocument(doc);
  if (r.error) return { kind: 'error', error: r.error };
  return { kind: 'volume', key: r.wing.key, params: r.params, volume: r.volume, address: r.address, how, names: r.names, notes: r.notes };
}

/** A regular expression → its minimal DFA's canonical volume. */
export function fromRegex(re) {
  let nfa;
  try { nfa = thompsonBuild(re); }
  catch (e) { return { kind: 'error', error: `Not a number, an address, a code or a regular expression: ${e.message}` }; }
  const eps = App.config.sym.eps;
  const letters = [...new Set(nfa.trans.map(t => t.sym).filter(s => s !== eps))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!letters.length) return { kind: 'error', error: 'That expression uses no letters, so it has no alphabet to be a DFA over.' };
  const ids = [nfa.start, ...nfa.states.filter(s => s !== nfa.start)];
  const at = new Map(ids.map((s, i) => [s, i]));
  const k = letters.length;
  const moves = nfa.trans.map(t => [at.get(t.from), t.sym === eps ? k : letters.indexOf(t.sym), at.get(t.to)]);
  const acc = ids.map(s => (s === nfa.accept ? 1 : 0));
  const dfa = dfaOf('ε-NFA', [ids.length, k], [acc, moves]);
  if (!dfa) return { kind: 'error', error: 'Its subset construction grew past what the Finder will build.' };
  const min = minimiseDfa(dfa);
  const wing = wingByKey('dfa');
  const params = [min.n, k];
  const body = [Array.from(min.acc), Array.from(min.delta)];
  const volume = volumeNumber(wing, params, body);
  return {
    kind: 'volume', key: 'dfa', params, volume,
    address: formatAddress({ key: 'dfa', params, volume }),
    how: `the minimal DFA for ${re}`, names: { sigma: letters }, regex: re
  };
}
