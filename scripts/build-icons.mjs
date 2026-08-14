// Rasterises the brand tile in svgs/ to build/icon.png, which is what
// electron-builder packages as the desktop application icon (see the
// `directories.buildResources` setting in package.json).
//
// Why this exists rather than a one-line ImageMagick call: the icon has to be a
// committed binary, and regenerating it should not depend on whichever converter
// happens to be installed. The artwork is four circles, four round-capped lines
// and a rounded rectangle, so it is cheaper to evaluate the shapes directly than
// to take on an SVG rasteriser. The SVG stays the single source of truth — this
// reads the geometry out of the file rather than restating it, so editing the
// artwork and re-running is enough.
//
//   npm run icons
//
// Everything is drawn from signed distance fields: for each pixel, the signed
// distance to the shape in user units, scaled to device pixels, gives antialiased
// coverage directly (a pixel whose centre sits half a pixel inside the edge is
// half covered). That is both simpler and smoother than supersampling.

import { deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'svgs/state-diamond-tile-dark.svg');
const OUTPUT = resolve(ROOT, 'build/icon.png');
const SIZE = 512;

// ── parse ────────────────────────────────────────────────────────────────────
// A deliberately narrow reader: it understands exactly the primitives the tile
// uses. Anything else in the file is a mistake rather than something to skip
// silently, so the element tally is asserted at the end.

const svg = readFileSync(SOURCE, 'utf8');

// The leading \s matters: an unanchored search for x=" also matches the x in
// rx="28", and one for width=" matches stroke-width=".
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
};
const num = (tag, name) => {
  const v = attr(tag, name);
  if (v === null) throw new Error(`${SOURCE}: <${tag.slice(1, 6)}…> has no ${name}`);
  return parseFloat(v);
};
// For attributes SVG gives a default to when omitted (x/y/rx on <rect>).
const numOr = (tag, name, fallback) => {
  const v = attr(tag, name);
  return v === null ? fallback : parseFloat(v);
};

const viewBox = svg.match(/viewBox="([^"]*)"/);
if (!viewBox) throw new Error(`${SOURCE}: no viewBox`);
const [, , vbW, vbH] = viewBox[1].trim().split(/\s+/).map(Number);
if (vbW !== vbH) throw new Error(`${SOURCE}: expected a square viewBox, got ${vbW}x${vbH}`);

// The tile wraps its glyph in a single translate+scale group. Shapes inside it
// are baked into viewBox coordinates here so the renderer sees a flat list.
const group = svg.match(/<g transform="translate\(([-\d.]+)\s+([-\d.]+)\)\s*scale\(([-\d.]+)\)"[^>]*>([\s\S]*?)<\/g>/);
if (!group) throw new Error(`${SOURCE}: expected one <g transform="translate(x y) scale(s)">`);
const [, gx, gy, gs, inner] = group;
const tx = parseFloat(gx), ty = parseFloat(gy), ts = parseFloat(gs);
const px = (x) => tx + x * ts;
const py = (y) => ty + y * ts;

const shapes = [];

for (const tag of svg.match(/<rect\b[^>]*>/g) ?? []) {
  shapes.push({
    kind: 'rect',
    x: numOr(tag, 'x', 0),
    y: numOr(tag, 'y', 0),
    w: num(tag, 'width'),
    h: num(tag, 'height'),
    r: numOr(tag, 'rx', 0),
    color: attr(tag, 'fill'),
  });
}
for (const tag of inner.match(/<line\b[^>]*>/g) ?? []) {
  shapes.push({
    kind: 'line',
    x1: px(num(tag, 'x1')), y1: py(num(tag, 'y1')),
    x2: px(num(tag, 'x2')), y2: py(num(tag, 'y2')),
    w: num(tag, 'stroke-width') * ts,
    color: attr(tag, 'stroke'),
  });
}
for (const tag of inner.match(/<circle\b[^>]*>/g) ?? []) {
  shapes.push({
    kind: 'circle',
    cx: px(num(tag, 'cx')), cy: py(num(tag, 'cy')),
    r: num(tag, 'r') * ts,
    color: attr(tag, 'fill'),
  });
}

// The tile is one background plus the eight-element glyph. If the artwork grows a
// shape this script cannot draw, fail here rather than quietly shipping a
// half-drawn icon.
const expected = { rect: 1, line: 4, circle: 4 };
for (const [kind, count] of Object.entries(expected)) {
  const got = shapes.filter((s) => s.kind === kind).length;
  if (got !== count) throw new Error(`${SOURCE}: expected ${count} <${kind}>, found ${got}`);
}

const rgb = (hex) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) throw new Error(`${SOURCE}: expected a #rrggbb colour, got ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
for (const s of shapes) s.rgb = rgb(s.color);

// ── rasterise ────────────────────────────────────────────────────────────────

const sdRoundRect = (x, y, s) => {
  const qx = Math.abs(x - (s.x + s.w / 2)) - (s.w / 2 - s.r);
  const qy = Math.abs(y - (s.y + s.h / 2)) - (s.h / 2 - s.r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return Math.min(Math.max(qx, qy), 0) + outside - s.r;
};

const sdCapsule = (x, y, s) => {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / len2));
  return Math.hypot(x - (s.x1 + t * dx), y - (s.y1 + t * dy)) - s.w / 2;
};

const sd = (x, y, s) => {
  if (s.kind === 'rect') return sdRoundRect(x, y, s);
  if (s.kind === 'line') return sdCapsule(x, y, s);
  return Math.hypot(x - s.cx, y - s.cy) - s.r;
};

const scale = SIZE / vbW;
const pixels = Buffer.alloc(SIZE * SIZE * 4);

for (let py_ = 0; py_ < SIZE; py_++) {
  for (let px_ = 0; px_ < SIZE; px_++) {
    // Pixel centre, back in viewBox units.
    const ux = (px_ + 0.5) / scale;
    const uy = (py_ + 0.5) / scale;
    let r = 0, g = 0, b = 0, a = 0;

    for (const s of shapes) {
      // Signed distance in device pixels -> coverage across a one-pixel band.
      const cov = Math.max(0, Math.min(1, 0.5 - sd(ux, uy, s) * scale));
      if (cov <= 0) continue;
      // Source-over, premultiplied.
      r = s.rgb[0] * cov + r * (1 - cov);
      g = s.rgb[1] * cov + g * (1 - cov);
      b = s.rgb[2] * cov + b * (1 - cov);
      a = cov + a * (1 - cov);
    }

    const i = (py_ * SIZE + px_) * 4;
    // Un-premultiply: PNG stores straight alpha.
    pixels[i] = a > 0 ? Math.round(r / a) : 0;
    pixels[i + 1] = a > 0 ? Math.round(g / a) : 0;
    pixels[i + 2] = a > 0 ? Math.round(b / a) : 0;
    pixels[i + 3] = Math.round(a * 255);
  }
}

// ── encode ───────────────────────────────────────────────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // colour type: RGBA
// 10..12 = compression, filter, interlace: all 0.

// One filter byte per scanline. Filter 0 (None) keeps this simple; the artwork is
// flat colour, so deflate handles the redundancy well regardless.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, png);
console.log(`wrote ${OUTPUT} (${SIZE}x${SIZE}, ${png.length} bytes) from ${SOURCE}`);
