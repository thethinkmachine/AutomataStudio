// ══════════════════════════════════════════════════════════════════
//  ANIMATED WEBP, ONE CHANGED RECTANGLE AT A TIME
// ══════════════════════════════════════════════════════════════════
// sharp can join frames into an animation, but only by decoding every frame
// at once — a two-minute terminal clip at twice the pixel density is a few
// gigabytes of RGBA. A terminal frame differs from the one before it in a few
// cells, so this keeps only the previous frame, crops each new one to the
// rectangle that changed, encodes that crop as a lossless still, and muxes
// the stills into the container by hand (the RIFF layout below is the whole
// of the format that is needed).
//
//   RIFF <size> WEBP
//     VP8X  flags (animation, alpha), canvas width − 1, height − 1
//     ANIM  background colour, loop count
//     ANMF  x/2, y/2, width − 1, height − 1, duration, flags, then the
//           frame's own VP8L (or ALPH + VP8) chunks          … one per frame
//
// Offsets are stored halved, so every rectangle starts on an even pixel.
// Frames replace their rectangle rather than blending into it: the window
// has transparent rounded corners, and blending a crop over itself would
// keep alpha that the new frame no longer has.

import sharp from 'sharp';

const u24 = (buf, at, v) => { buf[at] = v & 255; buf[at + 1] = (v >> 8) & 255; buf[at + 2] = (v >> 16) & 255; };

function chunk(tag, body) {
  const pad = body.length & 1;
  const out = Buffer.alloc(8 + body.length + pad);
  out.write(tag, 0, 'ascii');
  out.writeUInt32LE(body.length, 4);
  body.copy(out, 8);
  return out;
}

// The image chunks of a still WebP file: everything after the RIFF header that
// an ANMF frame may carry (VP8X, and any metadata, are the container's).
function imageChunks(file) {
  const parts = [];
  for (let at = 12; at + 8 <= file.length;) {
    const tag = file.toString('ascii', at, at + 4);
    const size = file.readUInt32LE(at + 4);
    const end = at + 8 + size + (size & 1);
    if (tag === 'VP8 ' || tag === 'VP8L' || tag === 'ALPH') parts.push(file.subarray(at, end));
    at = end;
  }
  return Buffer.concat(parts);
}

/** The smallest even-aligned rectangle where two RGBA frames differ, or null. */
export function changedRect(prev, next, width, height) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    const a = y * row;
    // Rows are compared whole first: most rows of a terminal frame are unchanged.
    if (prev.compare(next, a, a + row, a, a + row) === 0) continue;
    if (y < y0) y0 = y;
    y1 = y;
    for (let x = 0; x < width; x++) {
      const i = a + x * 4;
      if (prev[i] !== next[i] || prev[i + 1] !== next[i + 1] || prev[i + 2] !== next[i + 2] || prev[i + 3] !== next[i + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
  }
  if (x1 < 0) return null;
  x0 &= ~1; y0 &= ~1;
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * An encoder fed one frame at a time. `add(png, ms)` takes a PNG (any size
 * equal to the first) and how long it stays on screen; `finish()` returns the
 * file. A frame identical to the one before it only lengthens that one.
 */
export class AnimatedWebP {
  constructor({ loop = 0, lossless = true, quality = 90, effort = 4, nearLossless = 0 } = {}) {
    Object.assign(this, { loop, lossless, quality, effort, nearLossless });
    this.frames = [];
    this.prev = null;
    this.width = 0;
    this.height = 0;
  }

  async add(png, ms) {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (!this.prev) {
      this.width = info.width;
      this.height = info.height;
    } else if (info.width !== this.width || info.height !== this.height) {
      throw new Error(`frame is ${info.width}×${info.height}, the animation ${this.width}×${this.height}`);
    }
    const rect = this.prev ? changedRect(this.prev, data, this.width, this.height) : { left: 0, top: 0, width: this.width, height: this.height };
    if (!rect) {
      if (this.frames.length) this.frames.at(-1).ms += ms;
      return;
    }
    const still = await sharp(data, { raw: { width: this.width, height: this.height, channels: 4 } })
      .extract(rect)
      .webp(this.nearLossless ? { lossless: true, nearLossless: true, quality: this.nearLossless, effort: this.effort } : this.lossless ? { lossless: true, effort: this.effort } : { quality: this.quality, alphaQuality: 100, effort: this.effort, smartSubsample: true })
      .toBuffer();
    this.frames.push({ rect, ms, data: imageChunks(still) });
    this.prev = data;
  }

  /** Lengthen the last frame — the hold at the end of a clip. */
  hold(ms) {
    if (this.frames.length) this.frames.at(-1).ms += ms;
  }

  finish() {
    if (!this.frames.length) throw new Error('no frames');
    const vp8x = Buffer.alloc(10);
    vp8x[0] = 0x02 | 0x10; // animation, alpha
    u24(vp8x, 4, this.width - 1);
    u24(vp8x, 7, this.height - 1);
    const anim = Buffer.alloc(6);
    anim.writeUInt32LE(0x00000000, 0); // transparent background
    anim.writeUInt16LE(this.loop, 4);
    const body = [Buffer.from('WEBP', 'ascii'), chunk('VP8X', vp8x), chunk('ANIM', anim)];
    for (const f of this.frames) {
      const head = Buffer.alloc(16);
      u24(head, 0, f.rect.left / 2);
      u24(head, 3, f.rect.top / 2);
      u24(head, 6, f.rect.width - 1);
      u24(head, 9, f.rect.height - 1);
      // A frame's duration field is 24 bits of milliseconds.
      u24(head, 12, Math.max(1, Math.min(0xffffff, Math.round(f.ms))));
      head[15] = 0x02; // do not blend; no disposal
      body.push(chunk('ANMF', Buffer.concat([head, f.data])));
    }
    const payload = Buffer.concat(body);
    const riff = Buffer.alloc(8);
    riff.write('RIFF', 0, 'ascii');
    riff.writeUInt32LE(payload.length, 4);
    return Buffer.concat([riff, payload]);
  }
}
