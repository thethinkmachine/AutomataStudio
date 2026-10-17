// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY OF BABEL — ADDRESSES
// ══════════════════════════════════════════════════════════════════
// What a volume is called, in a link, a search box or an essay:
//
//   dfa                 the DFA wing
//   dfa-3-2             a room: 3 states, 2 letters
//   dfa-3-2/977         a volume of that room
//   dfa/1537            the same machine by its number in the whole wing
//   dfa-1000-2/~AbC…    a long number, as base64url
//
// Import-free, so config.js can parse a link without loading the engine, and
// the website can ship it as it is.

const DIGITS = /^[0-9][0-9,]*$/;
const B64 = /^~[A-Za-z0-9_-]+$/;
const ADDRESS = /^([0-9]*[a-z][a-z0-9]*)((?:-[0-9]+)*)(?:\/(.+))?$/;

/** The most digits a volume number may have in an address — a link, not a library, limit. */
export const MAX_ADDRESS_CHARS = 200000;

/** Past this many digits a number travels as base64url. */
export const LONG_DIGITS = 40;

/**
 * Text → { key, params, volume, wingNumber } (params null for a wing, volume
 * and wingNumber null when absent), or null when it is not an address.
 */
export function parseAddress(text) {
  const t = String(text ?? '').trim().toLowerCase().replace(/^#?babel=/, '');
  if (!t || t.length > MAX_ADDRESS_CHARS) return null;
  // base64url is case-sensitive, so the volume part is read from the original.
  const raw = String(text).trim().replace(/^#?babel=/i, '');
  const m = ADDRESS.exec(t);
  if (!m) return null;
  const key = m[1];
  const params = m[2] ? m[2].slice(1).split('-').map(Number) : null;
  if (params && params.some(p => !Number.isSafeInteger(p))) return null;
  let number = null;
  if (m[3] !== undefined) {
    const tail = raw.slice(raw.indexOf('/') + 1);
    number = parseNumber(tail);
    if (number === null) return null;
  }
  return { key, params, volume: params ? number : null, wingNumber: params ? null : number };
}

/** A volume number as typed: digits (commas allowed) or ~base64url. Null when it is neither. */
export function parseNumber(text) {
  const s = String(text ?? '').trim();
  if (DIGITS.test(s)) return BigInt(s.replace(/,/g, ''));
  if (B64.test(s)) return fromBase64url(s.slice(1));
  return null;
}

/** { key, params, volume } → the address text; long numbers as base64url. */
export function formatAddress({ key, params = null, volume = null, wingNumber = null }) {
  let out = key;
  if (params) out += `-${params.join('-')}`;
  const n = params ? volume : wingNumber;
  if (n !== null && n !== undefined) out += `/${numberText(n)}`;
  return out;
}

/** A number for an address: digits, or ~base64url past LONG_DIGITS. */
export function numberText(n) {
  n = BigInt(n);
  // Compared, not measured: writing a long number in decimal to count its digits is the slow part.
  return n >= 10n ** BigInt(LONG_DIGITS) ? `~${toBase64url(n)}` : n.toString();
}

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Both directions go through the binary digits six at a time. Shifting the
// whole number by six bits a character was quadratic: 25 seconds for the
// addresses on one volume page of a 300-state DFA room.

/** A non-negative BigInt → base64url, most significant first, no padding. */
export function toBase64url(n) {
  n = BigInt(n);
  if (n === 0n) return 'A';
  const bin = n.toString(2);
  const bits = bin.padStart(Math.ceil(bin.length / 6) * 6, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 6) out += ALPHA[parseInt(bits.slice(i, i + 6), 2)];
  return out;
}

export function fromBase64url(s) {
  if (!s) return 0n;
  let bits = '';
  for (const ch of s) {
    const v = ALPHA.indexOf(ch);
    if (v < 0) return null;
    bits += v.toString(2).padStart(6, '0');
  }
  return BigInt(`0b${bits}`);
}

/** 6836674958 → "6,836,674,958". */
export function groupDigits(n) {
  // In threes from the right, by slicing: the lookahead regex this replaced
  // scanned to the end from every digit, seconds on a deep room's numbers.
  const s = BigInt(n).toString();
  const sign = s[0] === '-' ? '-' : '';
  const d = sign ? s.slice(1) : s;
  if (d.length <= 3) return s;
  const head = d.length % 3 || 3;
  const parts = [d.slice(0, head)];
  for (let i = head; i < d.length; i += 3) parts.push(d.slice(i, i + 3));
  return sign + parts.join(',');
}

/**
 * A number for the eye: grouped when short, its first and last digits around
 * an ellipsis when long. `{ text, digits, long }`.
 */
export function showNumber(n, { max = 24 } = {}) {
  const s = BigInt(n).toString();
  if (s.length <= max) return { text: groupDigits(n), digits: s.length, long: false };
  return { text: `${s.slice(0, 4)}…${s.slice(-3)}`, digits: s.length, long: true };
}

/** A big count for a sentence: exact when small, a power of ten when not. */
export function sayCount(n) {
  const s = BigInt(n).toString();
  if (s.length <= 9) return groupDigits(n);
  return `${s[0]}.${s[1]} × 10^${s.length - 1}`;
}
