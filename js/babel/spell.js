// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY OF BABEL — A NUMBER, SPELLED
// ══════════════════════════════════════════════════════════════════
// A volume's number written as the rules it encodes. In a finite room the
// number is mixed radix, so it spells as tiles, one per digit, each with its
// value and its place: the tiles add up to the number on screen, and changing
// one digit is moving to the volume that differs in exactly that rule. In an
// endless room a machine can always grow, so it spells as its parts with their
// sizes, and the number as (volumes of every smaller size) + (its rank at its
// own size).
//
// Generic over the shape: the top level is read as a tuple of parts, a table
// spelled element by element, a set member by member. The wing names what a
// tile is (wing.tile, wing.move); where it does not, the tile says what part of
// the shape it is.

import { roomShape, rankInSize } from './volumes.js';
import { volumeOf } from './shape.js';

const PART_NAMES = { bits: 'set', fin: 'choice', option: 'choice', fraction: 'fraction', nat: 'number', seq: 'string', subset: 'set', table: 'table', tuple: 'part', oneOf: 'choice' };

/**
 * The top level's parts and the body's values for them, with wrapping choices
 * (conventions: acceptance on or off, the stack's convention) unwrapped. For a
 * finite room, `offset` is what the choices add before the parts' digits.
 */
function topParts(shape, body) {
  const conventions = [];
  let offset = 0n;
  while (shape.part === 'oneOf' && body && Number.isInteger(body.tag)) {
    conventions.push(body.tag);
    if (shape.finite) for (let i = 0; i < body.tag; i++) offset += shape.parts[i].total;
    shape = shape.parts[body.tag];
    body = body.value;
  }
  if (shape.part === 'tuple' && Array.isArray(shape.parts)) {
    return { conventions, offset, parts: shape.parts.map((p, i) => ({ shape: p, value: body[i], index: i })) };
  }
  return { conventions, offset, parts: [{ shape, value: body, index: 0 }] };
}

/** The convention a volume was read under, in words — or null when its wing has none. */
export function conventionsOf(wing, params, body) {
  const list = [...topParts(roomShape(wing, params), body).conventions];
  const out = [];
  if (wing.conventions && list.length) out.push(wing.conventions[list.shift()]);
  if (wing.store && !wing.explicitOnly && list.length) {
    out.push(list[0] === 0 ? 'a bottom marker Z, acceptance by final state' : 'acceptance by empty stack');
  } else if (wing.store) out.push('a bottom marker Z, acceptance by final state');
  return out;
}

/**
 * The spelled form of a finite-room volume: { tiles, offset }, tiles with
 * { path, key, value, digit, radix, place } — offset plus digit × place summed
 * over the tiles is the volume.
 */
export function finiteTiles(wing, params, body) {
  const shape = roomShape(wing, params);
  if (!shape.finite) return null;
  const { parts, offset } = topParts(shape, body);
  const tiles = [];
  tiles.offset = offset;
  let place = 1n;
  const label = (path, value) => (wing.tile ? wing.tile(path, value, params) : null) || { key: PART_NAMES[shapeAt(shape, path)?.part] || 'part', value: JSON.stringify(value) };
  for (const { shape: p, value, index } of parts) {
    if (p.part === 'table') {
      const B = p.of.total;
      value.forEach((v, j) => {
        tiles.push({ path: [index, j], ...label([index, j], v), digit: p.of.rank(v).r, radix: B, place });
        place *= B;
      });
    } else {
      tiles.push({ path: [index], ...label([index], value), digit: p.rank(value).r, radix: p.total, place });
      place *= p.total;
    }
  }
  return tiles;
}

function shapeAt(shape, path) {
  let s = shape;
  if (s.part === 'tuple') s = s.parts[path[0]];
  if (path.length > 1 && s.part === 'table') s = s.of;
  return s;
}

/**
 * The volume that differs from this one in one tile's digit, by `delta`
 * (wrapping within the tile's radix).
 */
export function nudge(tiles, volume, tileIndex, delta) {
  const t = tiles[tileIndex];
  const d = ((t.digit + BigInt(delta)) % t.radix + t.radix) % t.radix;
  return BigInt(volume) + (d - t.digit) * t.place;
}

/**
 * The spelled form of an endless-room volume: its parts with their sizes, and
 * where its size falls in the room.
 */
export function endlessSpelling(wing, params, body) {
  const shape = roomShape(wing, params);
  if (shape.finite) return null;
  const { conventions, parts } = topParts(shape, body);
  const items = [];
  for (const { shape: p, value, index } of parts) {
    if (p.part === 'subset') {
      for (const m of value) {
        items.push({ key: 'a move', value: wing.move ? wing.move(m, params) : JSON.stringify(m), size: p.finite ? 0 : p.of.rank(m).s + 1 });
      }
      if (!value.length) items.push({ key: 'moves', value: 'none', size: 0 });
    } else if (p.part === 'table') {
      value.forEach((v, j) => {
        const lab = wing.tile ? wing.tile([index, j], v, params) : null;
        items.push({ key: lab?.key || `${index}.${j}`, value: lab?.value ?? JSON.stringify(v), size: p.of.rank(v).s });
      });
    } else {
      const lab = wing.tile ? wing.tile([index], value, params) : null;
      const isF = p.part === 'bits' && index === 0;
      const fallback = isF ? { key: 'F', value: `{${value.map((b, q) => (b ? `q${q}` : null)).filter(Boolean).join(', ')}}` } : null;
      items.push({ key: lab?.key || fallback?.key || PART_NAMES[p.part] || 'part', value: lab?.value ?? fallback?.value ?? JSON.stringify(value), size: p.rank(value).s });
    }
  }
  const where = rankInSize(wing, params, body);
  const counts = [];
  for (let s = 0; s <= where.size + 1; s++) counts.push(shape.count(s));
  return { conventions, items, ...where, counts, volume: volumeOf(shape, body) };
}

/**
 * Volumes one rule away in a finite room: every single-digit change, with the
 * new volume number. `limit` caps how many come back.
 */
export function neighbours(wing, params, body, volume, { limit = 15 } = {}) {
  const tiles = finiteTiles(wing, params, body);
  if (!tiles) return [];
  const out = [];
  tiles.forEach((t, i) => {
    for (let d = 1n; d < t.radix && out.length < limit; d++) {
      const digit = (t.digit + d) % t.radix;
      out.push({ tile: i, digit, volume: BigInt(volume) + (digit - t.digit) * t.place });
      if (t.radix > 4n) break; // one change per wide tile, so every rule is represented
    }
  });
  return out.slice(0, limit);
}
