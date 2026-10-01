// ══════════════════════════════════════════════════════════════════
//  BBCHALLENGE'S SEED DATABASE, AND ITS INDEX FILES
// ══════════════════════════════════════════════════════════════════
// The format is bbchallenge-seed's (README, "Database Format"):
//
//   a 30-byte header: three big-endian uint32 — machines undecided by the
//   time limit, by the space limit, and in all — then a byte, 1 when the
//   database is sorted; the rest of the header is unused
//
//   then one 30-byte record per machine, machine i at byte 30·(i + 1): for
//   each state A…E and each symbol 0, 1, three bytes — the symbol written,
//   the move (0 = R, 1 = L), and the next state, 1-based, with 0 for an
//   undefined transition. A next state past the last is a halt (the README's
//   own example writes BB(5)'s halt as 1RH, state 6).
//
// An index file (the undecided index, or a decider's output) is a run of
// big-endian uint32 machine IDs.
//
// The database is 2.3 GB, so it is read a record at a time, never whole.

import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';

export const SEED_RECORD = 30;
const STATES = 5;

/** One record → the standard notation. `---` for an undefined transition, Z for a halt. */
export function seedRecordToStandard(bytes, states = STATES) {
  const segs = [];
  for (let q = 0; q < states; q++) {
    let seg = '';
    for (let s = 0; s < 2; s++) {
      const o = 6 * q + 3 * s;
      const write = bytes[o], move = bytes[o + 1], to = bytes[o + 2];
      if (to === 0) { seg += '---'; continue; }
      if (write > 1 || move > 1) throw new Error(`byte ${o} of the record is not a transition (${write}, ${move}, ${to})`);
      seg += `${write}${move ? 'L' : 'R'}${to <= states ? String.fromCharCode(64 + to) : 'Z'}`;
    }
    segs.push(seg);
  }
  return segs.join('_');
}

/** The standard notation → one record: the inverse, for 5-state 2-symbol machines. */
export function standardToSeedRecord(code, states = STATES) {
  const segs = String(code).trim().toUpperCase().split('_');
  if (segs.length !== states || segs.some(s => s.length !== 6)) throw new Error(`"${code}" is not a ${states}-state, 2-symbol machine`);
  const out = new Uint8Array(6 * states);
  segs.forEach((seg, q) => {
    for (let s = 0; s < 2; s++) {
      const tr = seg.slice(3 * s, 3 * s + 3), o = 6 * q + 3 * s;
      if (tr === '---') continue;
      const to = tr.charCodeAt(2) - 64;
      out[o] = Number(tr[0]);
      out[o + 1] = tr[1] === 'L' ? 1 : 0;
      out[o + 2] = to >= 1 && to <= states ? to : states + 1;
    }
  });
  return out;
}

/** A seed database opened for reading: { count, header, code(id), close() }. */
export function openSeedDb(path) {
  const fd = openSync(path, 'r');
  const size = fstatSync(fd).size;
  if (size < SEED_RECORD || size % SEED_RECORD) {
    closeSync(fd);
    throw new Error(`${path} is not a seed database: its size, ${size} bytes, is not a whole number of ${SEED_RECORD}-byte records`);
  }
  const head = Buffer.alloc(SEED_RECORD);
  readSync(fd, head, 0, SEED_RECORD, 0);
  const header = { time: head.readUInt32BE(0), space: head.readUInt32BE(4), total: head.readUInt32BE(8), sorted: head[12] === 1 };
  const count = size / SEED_RECORD - 1;
  if (header.total !== count) {
    closeSync(fd);
    throw new Error(`${path} is not a seed database: its header says ${header.total} machines and it holds ${count}`);
  }
  const rec = Buffer.alloc(SEED_RECORD);
  return {
    count, header,
    code(id) {
      if (!Number.isInteger(id) || id < 0 || id >= count) throw new Error(`machine #${id} is not in the database (it holds #0–#${count - 1})`);
      readSync(fd, rec, 0, SEED_RECORD, SEED_RECORD * (id + 1));
      return seedRecordToStandard(rec);
    },
    close() { closeSync(fd); }
  };
}

/** A database file's bytes for `codes`, header included — for tests and small extracts. */
export function seedDbBytes(codes, { time = codes.length, sorted = true } = {}) {
  const out = Buffer.alloc(SEED_RECORD * (codes.length + 1));
  out.writeUInt32BE(time, 0);
  out.writeUInt32BE(codes.length - time, 4);
  out.writeUInt32BE(codes.length, 8);
  out[12] = sorted ? 1 : 0;
  codes.forEach((c, i) => out.set(standardToSeedRecord(c), SEED_RECORD * (i + 1)));
  return out;
}

/** An index file → its machine IDs. */
export function readSeedIndex(path) {
  const buf = readFileSync(path);
  if (buf.length % 4) throw new Error(`${path} is not an index file: ${buf.length} bytes is not a whole number of 4-byte IDs`);
  const ids = new Array(buf.length / 4);
  for (let i = 0; i < ids.length; i++) ids[i] = buf.readUInt32BE(4 * i);
  return ids;
}

/** Machine IDs → an index file's bytes. */
export function seedIndexBytes(ids) {
  const out = Buffer.alloc(4 * ids.length);
  ids.forEach((id, i) => out.writeUInt32BE(id, 4 * i));
  return out;
}

/**
 * Arguments naming machines in the database → IDs. Each is an ID (`108115`
 * or `#108115`) or an inclusive range (`0-999`).
 */
export function parseSeedIds(args) {
  const ids = [];
  for (const raw of args) {
    const a = String(raw).replace(/^#/, '');
    const range = /^(\d+)-(\d+)$/.exec(a);
    if (range) {
      const lo = Number(range[1]), hi = Number(range[2]);
      if (hi < lo) throw new Error(`"${raw}" is a range that runs backwards`);
      for (let i = lo; i <= hi; i++) ids.push(i);
    } else if (/^\d+$/.test(a)) ids.push(Number(a));
    else throw new Error(`"${raw}" is not a machine ID (a number, #number, or a range like 0-99)`);
  }
  return ids;
}
