// Extracts glyph outlines from the app's canvas fonts into small JSON tables,
// which js/glyphs.js uses to convert an exported diagram's <text> into <path>.
//
//   npm run glyphs
//
// Why this exists rather than a runtime font parser: browsers expose no
// glyph-outline API, so turning text into paths needs the font binary parsed
// somewhere. Doing it at runtime would mean shipping a parser (~180KB) plus
// font files the parser can read -- and it cannot be the woff2 the page already
// loads, because woff2 is brotli-compressed. Doing it here instead costs the
// app nothing at all: the parser is this file, run by hand, and what ships is a
// table of path strings fetched only when someone exports.
//
// The output is committed, the same arrangement scripts/build-icons.mjs uses,
// so an ordinary `npm run build` never touches the network.
//
// Sources are Google Fonts' v1 CSS API, which serves plain TrueType to a client
// that does not advertise woff2 support -- the v2 API used by index.html serves
// woff2 only. Same font, same version, a container this file can read.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'js/glyphs');

// The v1 API keys off the User-Agent. Anything that predates woff2 gets ttf.
const LEGACY_UA = 'Wget/1.21';

// Everything the curated charset below can reach. Asking for the subsets by
// name is what gets the full face rather than the latin-only default.
const SUBSETS = 'latin,latin-ext,greek,greek-ext,cyrillic,cyrillic-ext,vietnamese';

// The symbols, listed rather than taken as ranges. U+2200..U+22FF alone is 256
// characters and the app can emit about a dozen of them -- carrying the rest
// costs ~90KB to cover integrals nobody is going to draw on an automaton. A
// symbol outside this list is not an error: js/glyphs.js leaves the one label
// containing it as text.
const MATH_CHARS =
  '∅∈∉⊂⊃⊄⊆⊇∪∩∖∀∃∄¬∧∨'   // sets and logic
  + '⊕⊗⊤⊥⊨⊢⊣≡≢≠≤≥≪≫≈≅∼'   // relations, and both end markers
  + '→←↑↓↔⇒⇐⇔↦⟶⟵⟹⟺↺↻⇝↩'   // arrows
  + '∞∑∏∫√∂∇⋅∘×÷±∓∗⋆†'         // operators
  + '⋯⋮⋱⊔⊓□■◦●○▪✓✗⌈⌉⌊⌋'   // the blank, ellipses, marks, brackets
  + '⟨⟩ℤℕℝℚℂ';                                                                     // angle brackets and number sets

// ── what to extract ──────────────────────────────────────────────────────────
//
// Only the faces the *canvas* draws with -- css/canvas.css asks for var(--mono)
// everywhere except .divider-label, which is var(--sans). Crimson Pro is not
// used on the canvas at all, so it is deliberately absent: the aux views that
// set it in serif are HTML, and never reach an export.
//
// The weights are the ones with real masters behind them. .state-sub (600),
// .priority-value (700) and .edge-pill-beginner (550) are already synthesised
// by the browser today -- JetBrains Mono is loaded at 300/400/500, see the font
// link in index.html -- so js/glyphs.js synthesises them the same way, from the
// nearest master, rather than this file pretending a master exists.
const FACES = [
  { id: 'mono-400', family: 'JetBrains Mono', weight: 400, query: 'JetBrains+Mono:400' },
  { id: 'mono-500', family: 'JetBrains Mono', weight: 500, query: 'JetBrains+Mono:500' },
  { id: 'sans-400', family: 'DM Sans', weight: 400, query: 'DM+Sans:400' },
  // The last resort, and the reason it has to exist: JetBrains Mono carries no
  // U+2294 SQUARE CUP, U+22A2 RIGHT TACK or U+22A3 LEFT TACK -- which are the
  // blank and both end markers in App.config.sym, i.e. the symbols on every
  // Turing machine and LBA the app can draw. The browser already falls back for
  // them today, to whatever the reader's system happens to offer, so pinning
  // them to one face makes the export *more* predictable rather than less.
  // Restricted to the symbols above; the font itself is 780KB.
  { id: 'math-400', family: 'Noto Sans Math', weight: 400, query: 'Noto+Sans+Math', only: MATH_CHARS }
];

// A curated charset rather than the whole font. Everything the app itself can
// put on the canvas, plus the range a state name or an alphabet symbol
// realistically lands in. Anything outside it is not a failure -- js/glyphs.js
// leaves a text element it cannot fully convert as text, so an unusual symbol
// costs that one label its outlines and nothing else.
function charset() {
  const out = new Set();
  const add = (from, to) => { for (let c = from; c <= to; c++) out.add(c); };
  add(0x20, 0x7e);        // ASCII printable
  add(0xa0, 0xff);        // Latin-1 supplement -- accented state names
  add(0x100, 0x17f);      // Latin Extended-A
  add(0x370, 0x3ff);      // Greek -- the app's own epsilon, lambda, sigma
  add(0x2010, 0x203a);    // dashes, quotes, dagger, bullet, ellipsis, primes
  add(0x2070, 0x209f);    // super- and subscripts: q_0 written as q-sub-zero
  for (const ch of MATH_CHARS) out.add(ch.codePointAt(0));
  return out;
}

// ── sfnt ─────────────────────────────────────────────────────────────────────

function reader(buf) {
  let p = 0;
  const r = {
    get pos() { return p; },
    seek(n) { p = n; return r; },
    skip(n) { p += n; return r; },
    u8() { return buf[p++]; },
    i8() { const v = buf.readInt8(p); p += 1; return v; },
    u16() { const v = buf.readUInt16BE(p); p += 2; return v; },
    i16() { const v = buf.readInt16BE(p); p += 2; return v; },
    u32() { const v = buf.readUInt32BE(p); p += 4; return v; },
    tag() { const v = buf.toString('latin1', p, p + 4); p += 4; return v; }
  };
  return r;
}

function tableDirectory(buf) {
  const r = reader(buf);
  const version = r.u32();
  if (version !== 0x00010000 && version !== 0x74727565) {
    throw new Error(`not a TrueType outline font (sfnt version 0x${version.toString(16)})`);
  }
  const numTables = r.u16();
  r.skip(6);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const tag = r.tag();
    r.skip(4);
    tables[tag] = { offset: r.u32(), length: r.u32() };
  }
  return tables;
}

// ── cmap: unicode -> glyph id ────────────────────────────────────────────────

function parseCmap(buf, table) {
  const base = table.offset;
  const r = reader(buf).seek(base);
  r.skip(2);
  const numTables = r.u16();
  let best = null, bestScore = -1;
  for (let i = 0; i < numTables; i++) {
    const platform = r.u16(), encoding = r.u16(), offset = r.u32();
    // Prefer a full-repertoire subtable, then the BMP one.
    const score = platform === 3 && encoding === 10 ? 4
      : platform === 0 && encoding >= 4 ? 3
      : platform === 3 && encoding === 1 ? 2
      : platform === 0 ? 1 : 0;
    if (score > bestScore) { bestScore = score; best = base + offset; }
  }
  if (best === null) throw new Error('no usable cmap subtable');

  const sr = reader(buf).seek(best);
  const format = sr.u16();
  const map = new Map();

  if (format === 4) {
    sr.skip(4);
    const segCount = sr.u16() / 2;
    sr.skip(6);
    const end = [], start = [], delta = [], rangeOffset = [], rangeOffsetAt = [];
    for (let i = 0; i < segCount; i++) end.push(sr.u16());
    sr.skip(2);
    for (let i = 0; i < segCount; i++) start.push(sr.u16());
    for (let i = 0; i < segCount; i++) delta.push(sr.i16());
    for (let i = 0; i < segCount; i++) { rangeOffsetAt.push(sr.pos); rangeOffset.push(sr.u16()); }
    for (let i = 0; i < segCount; i++) {
      for (let c = start[i]; c <= end[i] && c !== 0xffff; c++) {
        let gid;
        if (rangeOffset[i] === 0) {
          gid = (c + delta[i]) & 0xffff;
        } else {
          // The spec's famously indirect addressing: the offset is measured
          // from the position of the idRangeOffset entry itself.
          const at = rangeOffsetAt[i] + rangeOffset[i] + (c - start[i]) * 2;
          if (at + 1 >= buf.length) continue;
          gid = buf.readUInt16BE(at);
          if (gid !== 0) gid = (gid + delta[i]) & 0xffff;
        }
        if (gid) map.set(c, gid);
      }
    }
  } else if (format === 12) {
    sr.skip(10);
    const nGroups = sr.u32();
    for (let i = 0; i < nGroups; i++) {
      const first = sr.u32(), last = sr.u32(), startGid = sr.u32();
      for (let c = first; c <= last; c++) map.set(c, startGid + (c - first));
    }
  } else {
    throw new Error(`unsupported cmap format ${format}`);
  }
  return map;
}

// ── glyf: outlines ───────────────────────────────────────────────────────────

const ON_CURVE = 1, X_SHORT = 2, Y_SHORT = 4, REPEAT = 8, X_SAME = 16, Y_SAME = 32;
const ARG_WORDS = 1, ARGS_XY = 2, HAVE_SCALE = 8, MORE_COMPONENTS = 32,
      HAVE_XY_SCALE = 64, HAVE_2X2 = 128;

// Returns a list of contours, each a list of {x, y, on}. Composite glyphs are
// flattened against their components, so the caller never sees one.
function glyphContours(buf, loca, glyf, gid, depth = 0) {
  if (depth > 5) return [];
  const from = loca[gid], to = loca[gid + 1];
  if (from === undefined || from >= to) return [];   // empty glyph, e.g. space

  const r = reader(buf).seek(glyf.offset + from);
  const numberOfContours = r.i16();
  r.skip(8);

  if (numberOfContours < 0) {
    const contours = [];
    for (;;) {
      const flags = r.u16(), glyphIndex = r.u16();
      let dx, dy;
      if (flags & ARG_WORDS) { dx = r.i16(); dy = r.i16(); } else { dx = r.i8(); dy = r.i8(); }
      let a = 1, b = 0, c = 0, d = 1;
      const f2dot14 = () => r.i16() / 16384;
      if (flags & HAVE_SCALE) { a = d = f2dot14(); }
      else if (flags & HAVE_XY_SCALE) { a = f2dot14(); d = f2dot14(); }
      else if (flags & HAVE_2X2) { a = f2dot14(); b = f2dot14(); c = f2dot14(); d = f2dot14(); }
      // ARGS_XY unset means the args are point indices to align rather than an
      // offset. No font in this set uses it, and reading them as an offset
      // would silently misplace the component, so skip it instead.
      if (flags & ARGS_XY) {
        const at = r.pos;
        for (const contour of glyphContours(buf, loca, glyf, glyphIndex, depth + 1)) {
          contours.push(contour.map(pt => ({
            x: a * pt.x + c * pt.y + dx,
            y: b * pt.x + d * pt.y + dy,
            on: pt.on
          })));
        }
        r.seek(at);
      }
      if (!(flags & MORE_COMPONENTS)) break;
    }
    return contours;
  }

  const endPts = [];
  for (let i = 0; i < numberOfContours; i++) endPts.push(r.u16());
  const numPoints = numberOfContours ? endPts[numberOfContours - 1] + 1 : 0;
  r.skip(r.u16());   // hinting instructions

  const flags = [];
  while (flags.length < numPoints) {
    const f = r.u8();
    flags.push(f);
    if (f & REPEAT) { let n = r.u8(); while (n-- > 0 && flags.length < numPoints) flags.push(f); }
  }

  const readCoords = (shortBit, sameBit) => {
    const out = [];
    let v = 0;
    for (const f of flags) {
      if (f & shortBit) { const d = r.u8(); v += (f & sameBit) ? d : -d; }
      else if (!(f & sameBit)) { v += r.i16(); }
      out.push(v);
    }
    return out;
  };
  const xs = readCoords(X_SHORT, X_SAME);
  const ys = readCoords(Y_SHORT, Y_SAME);

  const contours = [];
  let start = 0;
  for (const end of endPts) {
    const pts = [];
    for (let i = start; i <= end; i++) pts.push({ x: xs[i], y: ys[i], on: !!(flags[i] & ON_CURVE) });
    if (pts.length) contours.push(pts);
    start = end + 1;
  }
  return contours;
}

// TrueType curves are quadratic, and a run of two off-curve points implies an
// on-curve point at their midpoint -- so a contour can legally begin off-curve
// and have no explicit on-curve point at all.
function contoursToPath(contours) {
  const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, on: true });
  // Relative commands, because a delta between adjacent points is one or two
  // digits where the absolute coordinate is three or four -- and coordinates
  // are essentially the whole file. Rounding happens on the *deltas*, with the
  // rounded position carried forward, so the error cannot accumulate along a
  // contour the way rounding each delta independently would let it.
  let d = '';
  let cx = 0, cy = 0;
  const emitted = [];
  const step = (cmd, ...pts) => {
    // Every coordinate pair in an SVG relative command is measured from the
    // current point at the *start* of that command -- they are not chained. A
    // `q` therefore gives its control point and its end point a shared origin,
    // and advancing the current point between the two puts the end of every
    // curve out by the control point's offset. Straight-line glyphs come out
    // perfect either way, which is what makes the mistake hard to see.
    const ox = cx, oy = cy;
    let out = cmd;
    for (const pt of pts) {
      const dx = Math.round(pt.x - ox), dy = Math.round(pt.y - oy);
      out += `${dx < 0 ? '' : ' '}${dx}${dy < 0 ? '' : ' '}${dy}`;
      cx = ox + dx; cy = oy + dy;
      emitted.push([cx, cy]);
    }
    d += out;
  };

  for (const pts of contours) {
    if (!pts.length) continue;

    let ordered = pts;
    const firstOn = pts.findIndex(p => p.on);
    if (firstOn > 0) ordered = pts.slice(firstOn).concat(pts.slice(0, firstOn));
    else if (firstOn === -1) ordered = [mid(pts[pts.length - 1], pts[0]), ...pts];

    const startPt = ordered[0];
    step('m', startPt);
    const startX = cx, startY = cy;
    let ctrl = null;
    const emitTo = pt => {
      if (ctrl) { step('q', ctrl, pt); ctrl = null; }
      else { step('l', pt); }
    };
    for (let i = 1; i <= ordered.length; i++) {
      const pt = i === ordered.length ? startPt : ordered[i];
      if (pt.on) emitTo(pt);
      else if (ctrl) { emitTo(mid(ctrl, pt)); ctrl = pt; }
      else ctrl = pt;
    }
    if (ctrl) step('q', ctrl, startPt);
    d += 'z';
    // 'z' returns the point to the start of the subpath, so the next 'm' is
    // measured from there rather than from wherever the last curve ended.
    cx = startX; cy = startY;
  }
  // Decoding what was just written, against the spec rather than against the
  // encoder, and checking it lands on the same points. The relative form exists
  // only to make the tables smaller, so it must not be able to change a shape;
  // this is what turns a silent distortion into a failed build.
  const check = decodePath(d);
  if (check.length !== emitted.length) {
    throw new Error(`path round-trip: wrote ${emitted.length} points, read back ${check.length}`);
  }
  for (let i = 0; i < check.length; i++) {
    if (check[i][0] !== emitted[i][0] || check[i][1] !== emitted[i][1]) {
      throw new Error(`path round-trip: point ${i} written as `
        + `${emitted[i]} reads back as ${check[i]}`);
    }
  }
  return d;
}

// The absolute points an SVG renderer would arrive at, following the relative
// commands the way the specification defines them.
function decodePath(d) {
  const out = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  const re = /([mlqz])([^mlqz]*)/g;
  let m;
  while ((m = re.exec(d))) {
    if (m[1] === 'z') { x = sx; y = sy; continue; }
    const n = (m[2].match(/-?\d+/g) || []).map(Number);
    const ox = x, oy = y;
    for (let i = 0; i < n.length; i += 2) {
      x = ox + n[i]; y = oy + n[i + 1];
      out.push([x, y]);
    }
    if (m[1] === 'm') { sx = x; sy = y; }
  }
  return out;
}

// ── fetch ────────────────────────────────────────────────────────────────────

async function fetchFace(face) {
  // `subset` is what makes the difference between 215 glyphs and the whole
  // font: the v1 API's default TTF is the latin subset, which has none of the
  // symbols this app actually draws -- no epsilon, no blank, no end markers.
  const cssUrl = `https://fonts.googleapis.com/css?family=${face.query}&subset=${SUBSETS}`;
  const css = await fetch(cssUrl, { headers: { 'User-Agent': LEGACY_UA } }).then(r => {
    if (!r.ok) throw new Error(`${cssUrl} -> HTTP ${r.status}`);
    return r.text();
  });
  const url = css.match(/url\((https:\/\/[^)]+\.ttf)\)/)?.[1];
  if (!url) throw new Error(`no .ttf in the CSS for ${face.query} -- did the v1 API stop serving TrueType?`);
  const bytes = await fetch(url).then(r => {
    if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
    return r.arrayBuffer();
  });
  return { buf: Buffer.from(bytes), url };
}

// ── main ─────────────────────────────────────────────────────────────────────

const wanted = charset();
mkdirSync(OUT_DIR, { recursive: true });

for (const face of FACES) {
  const { buf, url } = await fetchFace(face);
  const tables = tableDirectory(buf);
  for (const need of ['head', 'maxp', 'loca', 'glyf', 'cmap']) {
    if (!tables[need]) throw new Error(`${face.id}: missing '${need}' table`);
  }

  const upem = buf.readUInt16BE(tables.head.offset + 18);
  const longLoca = buf.readInt16BE(tables.head.offset + 50) === 1;
  const numGlyphs = buf.readUInt16BE(tables.maxp.offset + 4);

  const loca = [];
  for (let i = 0; i <= numGlyphs; i++) {
    loca.push(longLoca
      ? buf.readUInt32BE(tables.loca.offset + i * 4)
      : buf.readUInt16BE(tables.loca.offset + i * 2) * 2);
  }

  const cmap = parseCmap(buf, tables.cmap);
  const glyphs = {};
  let covered = 0, blank = 0;
  const ask = face.only
    ? new Set([...face.only].map(ch => ch.codePointAt(0)))
    : wanted;
  for (const cp of ask) {
    const gid = cmap.get(cp);
    if (!gid) continue;
    covered++;
    const d = contoursToPath(glyphContours(buf, loca, tables.glyf, gid));
    // A space has a cmap entry and no outline. Recording it as "" is the point:
    // js/glyphs.js has to tell "this face has no glyph for that character" from
    // "that character is legitimately blank", and only the first is a reason to
    // leave a label as text.
    if (!d) blank++;
    glyphs[String.fromCodePoint(cp)] = d;
  }

  const out = { family: face.family, weight: face.weight, upem, source: url, glyphs };
  const json = JSON.stringify(out);
  writeFileSync(resolve(OUT_DIR, `${face.id}.json`), json);
  console.log(`${face.id}: ${covered}/${ask.size} glyphs (${blank} blank), upem ${upem}, `
    + `${(json.length / 1024).toFixed(1)}KB -> js/glyphs/${face.id}.json`);
}
