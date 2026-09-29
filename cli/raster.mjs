// ══════════════════════════════════════════════════════════════════
//  PIXELS WITHOUT A BROWSER
// ══════════════════════════════════════════════════════════════════
// Space-time diagrams are grids of cells, which is exactly what an indexed
// image is — so they can be encoded here with no rasterizer and no dependency:
// PNG through Node's own zlib, and GIF (for animation) through a small LZW
// encoder. Both take a palette and one byte per pixel.

import { deflateSync } from 'node:zlib';

export class Indexed {
  constructor(w, h, palette) {
    this.w = w;
    this.h = h;
    this.palette = palette; // [[r, g, b], …], at most 256
    this.px = new Uint8Array(w * h);
  }
  fill(c) { this.px.fill(c); return this; }
  set(x, y, c) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c; }
  rect(x, y, w, h, c) {
    for (let j = Math.max(0, y); j < Math.min(this.h, y + h); j++) {
      this.px.fill(c, j * this.w + Math.max(0, x), j * this.w + Math.min(this.w, x + w));
    }
  }
  /** Scale up by whole pixels, for a small diagram that should stay sharp. */
  scaled(kx, ky = kx) {
    if (kx === 1 && ky === 1) return this;
    const out = new Indexed(this.w * kx, this.h * ky, this.palette);
    for (let y = 0; y < out.h; y++) {
      const src = Math.floor(y / ky) * this.w;
      for (let x = 0; x < out.w; x++) out.px[y * out.w + x] = this.px[src + Math.floor(x / kx)];
    }
    return out;
  }
}

// ── PNG ───────────────────────────────────────────────────────────

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePNG(img) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit indexed
  const plte = Buffer.alloc(img.palette.length * 3);
  img.palette.forEach(([r, g, b], i) => { plte[i * 3] = r; plte[i * 3 + 1] = g; plte[i * 3 + 2] = b; });
  const raw = Buffer.alloc((img.w + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    raw[y * (img.w + 1)] = 0;
    Buffer.from(img.px.buffer, img.px.byteOffset + y * img.w, img.w).copy(raw, y * (img.w + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── GIF ───────────────────────────────────────────────────────────

function lzw(px, minCode) {
  const clear = 1 << minCode, eoi = clear + 1;
  const out = [];
  let cur = 0, bits = 0;
  let size = minCode + 1;
  const emit = code => {
    cur |= code << bits;
    bits += size;
    while (bits >= 8) { out.push(cur & 0xff); cur >>>= 8; bits -= 8; }
  };
  let dict = new Map();
  let next = eoi + 1;
  emit(clear);
  let prefix = px[0];
  for (let i = 1; i < px.length; i++) {
    const c = px[i];
    const key = prefix * 4096 + c;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << size) && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map();
      next = eoi + 1;
      size = minCode + 1;
    }
    prefix = c;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(cur & 0xff);
  return out;
}

/** Frames of one size and palette → an animated GIF. `delay` in hundredths of a second. */
export function encodeGIF(frames, { delay = 8, loop = true } = {}) {
  const { w, h, palette } = frames[0];
  let depth = 1;
  while ((1 << depth) < palette.length) depth++;
  const size = 1 << depth;
  const bytes = [];
  const u16 = v => bytes.push(v & 0xff, (v >> 8) & 0xff);
  bytes.push(...Buffer.from('GIF89a'));
  u16(w); u16(h);
  bytes.push(0x80 | ((depth - 1) << 4) | (depth - 1), 0, 0);
  for (let i = 0; i < size; i++) {
    const [r, g, b] = palette[i] || [0, 0, 0];
    bytes.push(r, g, b);
  }
  if (loop) bytes.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0);
  const minCode = Math.max(2, depth);
  frames.forEach((f, i) => {
    const d = Array.isArray(delay) ? delay[i] : delay;
    bytes.push(0x21, 0xf9, 4, 0, d & 0xff, (d >> 8) & 0xff, 0, 0);
    bytes.push(0x2c); u16(0); u16(0); u16(w); u16(h); bytes.push(0);
    bytes.push(minCode);
    const data = lzw(f.px, minCode);
    for (let j = 0; j < data.length; j += 255) {
      const n = Math.min(255, data.length - j);
      bytes.push(n, ...data.slice(j, j + n));
    }
    bytes.push(0);
  });
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

/** The palette space-time pictures use: ground, then one colour per symbol, then the head. */
export const TAPE_PALETTE = [
  [13, 19, 34],    // 0 blank
  [255, 158, 107], // 1
  [79, 195, 247],  // 2
  [105, 240, 174], // 3
  [179, 136, 255], // 4
  [255, 213, 79],  // 5
  [244, 143, 177], // 6
  [128, 222, 234], // 7
  [220, 220, 220], // 8
  [150, 150, 150], // 9
  [255, 255, 255]  // 10: the head
];
export const HEAD = 10;
