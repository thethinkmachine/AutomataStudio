// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY OF BABEL — VOLUMES
// ══════════════════════════════════════════════════════════════════
// Rooms, volumes and wing numbers, on top of the wings and the shape engine.
//
// A wing lays all of its machines on one shelf by *size*: the room's sizes
// above their minimums, plus the machine's own size in its room. Each size
// holds finitely many machines, in room order (fewer states first, then fewer
// letters, …) and then volume order — so every machine of every size has one
// finite wing number, and every natural number is a machine. In a wing whose
// rooms are all finite the machine's own size is always 0, and the shelf is
// just the rooms end to end.
//
// DOM-free and App-free.

import { formatAddress } from './address.js';
import { valueAt, volumeOf, volumesBefore } from './shape.js';
import { documentOf, readDocument, roomId, roomProblem, roomShape, wingByKey } from './wings.js';

export { roomId, roomShape };

/** A room's weight: how far its sizes are above the wing's minimums. */
export function roomWeight(wing, params) {
  return params.reduce((s, p, i) => s + p - wing.params[i].min, 0);
}

/** Every room of the given weight, in order: lexicographic in the wing's parameters. */
export function roomsOfWeight(wing, weight) {
  const out = [];
  const k = wing.params.length;
  const rec = (i, left, acc) => {
    if (i === k - 1) { out.push([...acc, wing.params[i].min + left]); return; }
    for (let d = 0; d <= left; d++) rec(i + 1, left - d, [...acc, wing.params[i].min + d]);
  };
  rec(0, weight, []);
  return out;
}

/** The number of volumes in a room, or null for an endless one. */
export function roomTotal(wing, params) {
  const s = roomShape(wing, params);
  return s.finite ? s.total : null;
}

/** A volume → { body, size }. Throws a RangeError past a finite room's end. */
export function volumeAt(wing, params, volume) {
  const problem = roomProblem(wing, params);
  if (problem) throw new RangeError(problem);
  const { value, size } = valueAt(roomShape(wing, params), volume);
  return { body: value, size };
}

/** A body → its volume number in its room. */
export function volumeNumber(wing, params, body) {
  return volumeOf(roomShape(wing, params), body);
}

/** The size of a body in its room (0 in a finite room). */
export function bodySize(wing, params, body) {
  return roomShape(wing, params).rank(body).s;
}

/** A body's rank among the volumes of its own size, and how many volumes come before that size. */
export function rankInSize(wing, params, body) {
  const shape = roomShape(wing, params);
  const { s, r } = shape.rank(body);
  return { size: s, rank: r, before: volumesBefore(shape, s), atSize: shape.count(s) };
}

// The machines of total size T, room by room: rooms of weight ≤ T, the room
// contributing its volumes of size T − weight.
function* stretch(wing, T) {
  for (let w = 0; w <= T; w++) {
    for (const params of roomsOfWeight(wing, w)) {
      const c = roomShape(wing, params).count(T - w);
      if (c) yield { params, count: c, size: T - w };
    }
  }
}

/** How many machines of total size T or less the wing holds. */
export function wingCountUpTo(wing, T) {
  let n = 0n;
  for (let t = 0; t <= T; t++) for (const part of stretch(wing, t)) n += part.count;
  return n;
}

/** A volume → its wing number. */
export function wingNumberOf(wing, params, volume) {
  const shape = roomShape(wing, params);
  const { value, size } = valueAt(shape, volume);
  const { r } = shape.rank(value);
  const T = roomWeight(wing, params) + size;
  let n = 0n;
  for (let t = 0; t < T; t++) for (const part of stretch(wing, t)) n += part.count;
  for (const part of stretch(wing, T)) {
    if (part.params.every((p, i) => p === params[i])) return n + r;
    n += part.count;
  }
  throw new RangeError('this room is not on its own wing’s shelf');
}

/** A wing number → { params, volume }. */
export function fromWingNumber(wing, number, { maxT = 4000 } = {}) {
  let n = BigInt(number);
  if (n < 0n) throw new RangeError('wing numbers start at 0');
  for (let T = 0; T <= maxT; T++) {
    for (const part of stretch(wing, T)) {
      if (n < part.count) {
        const shape = roomShape(wing, part.params);
        return { params: part.params, volume: volumesBefore(shape, part.size) + n };
      }
      n -= part.count;
    }
  }
  throw new RangeError('this wing number is past the sizes the engine will search');
}

/**
 * Everything about one volume: its body, its size, its document and its
 * address. `addr` is { key, params, volume } or { key, wingNumber }.
 */
export function openVolume(addr) {
  const wing = typeof addr.wing === 'object' ? addr.wing : wingByKey(addr.key);
  if (!wing) throw new RangeError(`There is no wing called “${addr.key}”.`);
  let { params, volume } = addr;
  if (!params) {
    if (addr.wingNumber === null || addr.wingNumber === undefined) throw new RangeError('A volume needs a room and a number, or a wing number.');
    ({ params, volume } = fromWingNumber(wing, addr.wingNumber));
  }
  volume = BigInt(volume);
  const { body, size } = volumeAt(wing, params, volume);
  const doc = documentOf(wing, params, body);
  doc.meta = { ...(doc.meta || {}), babel: { room: roomId(wing, params), volume: volume.toString() } };
  return { wing, params, volume, body, size, doc, address: formatAddress({ key: wing.key, params, volume }) };
}

/** A document → its volume (the drawing exactly as it is), or { error }. */
export function locateDocument(doc) {
  const r = readDocument(doc);
  if (r.error) return r;
  const volume = volumeNumber(r.wing, r.params, r.body);
  return { ...r, volume, address: formatAddress({ key: r.wing.key, params: r.params, volume }) };
}

/** A uniform volume of the room — of one size in an endless room. `rand(n)` → BigInt in [0, n). */
export function randomVolume(wing, params, { size = null, rand = randomBelow } = {}) {
  const shape = roomShape(wing, params);
  if (shape.finite) return rand(shape.total);
  const s = size ?? 0;
  const c = shape.count(s);
  if (!c) return null;
  return volumesBefore(shape, s) + rand(c);
}

/** A uniform BigInt in [0, n), from the platform's randomness. */
export function randomBelow(n) {
  n = BigInt(n);
  if (n <= 1n) return 0n;
  const bitsNeeded = n.toString(2).length;
  const bytes = Math.ceil(bitsNeeded / 8);
  const buf = new Uint8Array(bytes);
  const mask = (1n << BigInt(bitsNeeded)) - 1n;
  for (;;) {
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(buf);
    else for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
    let x = 0n;
    for (const b of buf) x = (x << 8n) | BigInt(b);
    x &= mask;
    if (x < n) return x;
  }
}

/**
 * A small, seeded generator of BigInts below n — the room map's samples, the
 * same for every reader. Seeded from a string.
 */
export function seededBelow(seed) {
  let h = 2166136261 >>> 0;
  for (const ch of String(seed)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  let state = h || 1;
  const next32 = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state;
  };
  return n => {
    n = BigInt(n);
    if (n <= 1n) return 0n;
    const words = Math.ceil(n.toString(2).length / 32) + 1;
    let x = 0n;
    for (let i = 0; i < words; i++) x = (x << 32n) | BigInt(next32());
    return x % n;
  };
}
