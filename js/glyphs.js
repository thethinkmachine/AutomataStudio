// ══════════════════════════════════════════════════════════════════
//  TEXT → OUTLINES  (export only)
// ══════════════════════════════════════════════════════════════════
//  An exported diagram used to carry font *names* and no fonts. The
//  scraped stylesheet in buildExportSVG cannot include the @font-face
//  rules — the Google Fonts sheet is cross-origin, so `sheet.cssRules`
//  throws and the rules are skipped — and even with them, PNG would
//  still lose: exportPNG rasterises through `img.src = blob:`, and an
//  SVG loaded as an *image* fetches no external resources at all. So a
//  label rendered anywhere without DM Sans and JetBrains Mono installed
//  fell back to a generic, at widths the layout pass never planned for.
//
//  Converting the text to paths fixes both formats at once, because it
//  removes the dependency rather than working around it: a path needs
//  no font. It is also what keeps the file small — an embedded subset
//  of the three families is ~120KB per export, where the outlines of
//  the glyphs a diagram actually uses are ~5-15KB, since a machine
//  reuses `q`, `0` and `1` far more than it introduces new characters.
//  Every distinct glyph is emitted once into <defs> and referenced by
//  <use>, so a second `q` costs a reference rather than an outline.
//
//  Two things make this cheap enough to do at all:
//
//  - **The outlines are extracted at build time**, by
//    scripts/build-glyphs.mjs, into js/glyphs/*.json. Browsers expose
//    no glyph-outline API, so the alternative is shipping a font parser
//    and font binaries it can read. Here the parser is a script run by
//    hand and what ships is a table of path strings, fetched only when
//    someone exports and only for the faces that export actually uses.
//
//  - **Positions are measured, not computed.** getStartPositionOfChar
//    reports where the browser actually put each character, so
//    text-anchor, dominant-baseline, the em-relative `dy` stacking on
//    multi-line labels, letter-spacing and kerning all come out right
//    without this module knowing any of them exist. Re-deriving that
//    layout would be a second implementation of text shaping that could
//    disagree with the one the reader sees on screen.
//
//  **Nothing here is a fallback for missing outlines: a run this module
//  cannot fully convert is left as <text>.** Half a label in paths and
//  half in text would be worse than either, and the residual text is
//  what tells exportPNG it still needs to embed fonts.
//
//  The module imports nothing and reads no App — it is handed the live
//  SVG and the clone, the same way js/tape-view.js is handed a
//  descriptor. That is what makes it testable without a machine.

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

// Fetched on demand and cached for the session. `null` records a face that
// failed to load, so a missing file costs one request rather than one per
// export — and reads back as "no glyphs", which leaves labels as text.
const faces = new Map();

// The heaviest master each family ships here. scripts/build-glyphs.mjs takes
// only real masters; 600 and 700 are synthesised below, which is what the
// browser already does for them — JetBrains Mono is loaded at 300/400/500.
const MASTERS = {
  mono: [{ weight: 400, id: 'mono-400' }, { weight: 500, id: 'mono-500' }],
  sans: [{ weight: 400, id: 'sans-400' }]
};

// The last resort, per character rather than per run. JetBrains Mono has no
// U+2294 SQUARE CUP, U+22A2 RIGHT TACK or U+22A3 LEFT TACK — the blank and
// both end markers in App.config.sym, i.e. the symbols on every tape machine
// the app can draw. The browser already substitutes for them today, out of
// whatever the reader has installed.
const FALLBACK_FACE = 'math-400';

// Roughly what a rasteriser's synthetic emboldening comes to: the outline is
// stroked in its own colour, by an amount proportional to how far past the
// heaviest real master the requested weight is.
const SYNTHETIC_BOLD = (weight, master, fontSize) =>
  weight > master ? fontSize * (weight - master) / 5000 : 0;

// A shear of about 14°, which is the usual synthetic oblique.
const SYNTHETIC_ITALIC_SHEAR = 0.25;

// Copied onto the replacing <g>. Everything about *text layout* is deliberately
// absent — the glyphs carry their own positions by then, and a stray
// text-anchor or dy on the group would move them.
const DROP_ATTRS = new Set([
  'x', 'y', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust',
  'text-anchor', 'dominant-baseline', 'alignment-baseline', 'baseline-shift',
  'font', 'font-size', 'font-family', 'font-weight', 'font-style',
  'font-stretch', 'font-variant', 'letter-spacing', 'word-spacing',
  'text-decoration', 'writing-mode', 'xml:space',
  // The paint is resolved from the computed style and written inline, so the
  // class must not come along: a CSS rule from the scraped stylesheet would
  // outrank a presentation attribute and could repaint the group. Several of
  // those rules select the element type — `.edge-pill text { fill: … }` — and
  // would stop matching anyway once the <text> is a <g>.
  'class'
]);

async function loadFace(id) {
  if (faces.has(id)) return faces.get(id);
  const pending = fetch(`js/glyphs/${id}.json`)
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null)
    .then(table => {
      const value = table && table.glyphs ? table : null;
      faces.set(id, value);
      return value;
    });
  faces.set(id, pending);
  return pending;
}

// Exposed for tests: a face already resolved to `null` is a permanent refusal
// for the rest of the session, which is exactly the state that would leak
// between test cases.
export function resetGlyphCache() {
  faces.clear();
}

// The computed font-family is the whole stack — `"JetBrains Mono", monospace`.
// A family this app does not have outlines for returns null, and its text is
// left alone rather than drawn in the wrong face.
function familyKey(fontFamily) {
  const stack = String(fontFamily || '').toLowerCase();
  if (stack.includes('jetbrains')) return 'mono';
  if (stack.includes('dm sans')) return 'sans';
  return null;
}

// The heaviest master at or below the requested weight, so 600 and 700 both
// resolve to the 500 cut and get the rest of the way by stroking.
function masterFor(key, weight) {
  const list = MASTERS[key];
  let pick = list[0];
  for (const m of list) if (m.weight <= weight) pick = m;
  return pick;
}

function numeric(value, fallback) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

// The elements that directly hold text. A label built from tspans is measured
// per tspan rather than through the parent, because a tspan is itself an
// SVGTextContentElement with its own character indices — which is what lets a
// note's bold and italic runs each resolve their own style.
function runsOf(textEl) {
  const tspans = textEl.getElementsByTagName
    ? Array.from(textEl.getElementsByTagName('tspan'))
    : [];
  const leaves = tspans.filter(t => !t.getElementsByTagName('tspan').length);
  return leaves.length ? leaves : [textEl];
}

function ownText(run) {
  return run.textContent || '';
}

/**
 * Reads what every <text> in the diagram would need, without fetching anything
 * and without touching either tree.
 *
 * `live` must be the element `clone` was copied from, still in the document and
 * laid out: this reads character positions off it. The two are walked as
 * parallel lists, so it has to run before any structural edit to the clone.
 *
 * Split from the applying half because the tables are *fetched*, and the
 * measurement has to happen inside render.js's withFullRender — which restores
 * the windowed render in a `finally`, so it cannot be held open across an await.
 *
 * @returns {{jobs: object[], needed: Set<string>, total: number}}
 */
export function planOutlines(live, clone) {
  const liveTexts = Array.from(live.querySelectorAll('text'));
  const cloneTexts = Array.from(clone.querySelectorAll('text'));
  const plan = { jobs: [], needed: new Set(), total: cloneTexts.length };

  // Structurally identical trees are the whole basis for pairing them by index.
  // Anything else is a caller that edited the clone first, and silently
  // outlining the wrong elements would be far worse than not outlining at all.
  if (!liveTexts.length || liveTexts.length !== cloneTexts.length) return plan;

  // Without the measuring API there is nothing to measure — the Node test DOM,
  // and any other environment that stubs SVG. Leave every label as text.
  if (typeof liveTexts[0].getStartPositionOfChar !== 'function') return plan;

  for (let i = 0; i < liveTexts.length; i++) {
    const job = planText(liveTexts[i], cloneTexts[i]);
    if (!job) continue;
    plan.jobs.push(job);
    for (const run of job.runs) plan.needed.add(run.faceId);
  }
  return plan;
}

/**
 * Fetches the faces a plan asked for, plus the symbol fallback. Only the faces
 * that plan actually uses: a diagram with no divider label never asks for DM
 * Sans, and one with no symbols never pays for the maths face.
 */
export async function loadGlyphTables(plan) {
  const tables = new Map();
  if (!plan || !plan.jobs.length) return tables;
  const ids = new Set(plan.needed);
  ids.add(FALLBACK_FACE);
  await Promise.all([...ids].map(async id => { tables.set(id, await loadFace(id)); }));
  return tables;
}

/**
 * Swaps each planned <text> in the clone for a <g> of <use> references into a
 * <defs> glyph cache. Elements whose glyphs are not all available are left
 * exactly as they were.
 *
 * @returns {{converted: number, left: number}} how many became outlines, and
 *   how many are still text — the second is what tells the caller whether an
 *   embedded font is still needed.
 */
export function applyOutlines(plan, tables, clone) {
  const result = { converted: 0, left: plan ? plan.total : 0 };
  if (!plan || !plan.jobs.length) return result;

  const cache = new GlyphCache(clone);
  for (const job of plan.jobs) {
    // The caller is free to have dropped notes or dividers from the clone
    // between planning and here; a job whose element is no longer in the
    // document has nothing to replace.
    if (!job.cloneEl.parentNode) { result.left--; continue; }
    if (emitOutlines(job, tables, cache)) {
      result.converted++;
      result.left--;
    }
  }
  cache.flush();
  return result;
}

// The three composed, which is what a caller with nothing to do in between
// wants — and what the tests exercise.
export async function outlineText(live, clone) {
  const plan = planOutlines(live, clone);
  return applyOutlines(plan, await loadGlyphTables(plan), clone);
}

// Reads everything about one <text> that the conversion needs, without touching
// either tree. Returns null when the element is not convertible at all.
function planText(liveEl, cloneEl) {
  const runs = [];
  for (const run of runsOf(liveEl)) {
    const count = run.getNumberOfChars ? run.getNumberOfChars() : 0;
    if (!count) continue;
    const text = ownText(run);
    // SVG collapses white space before assigning character indices, so a run
    // with doubled or leading spaces addresses fewer characters than its string
    // has — and every index after the collapse would name the wrong glyph.
    // Rare in generated labels, and cheaper to refuse than to reimplement.
    if (count !== text.length) return null;

    const cs = getComputedStyle(run);
    const key = familyKey(cs.fontFamily);
    if (!key) return null;

    const weight = numeric(cs.fontWeight, 400);
    const fontSize = numeric(cs.fontSize, 0);
    if (!(fontSize > 0)) return null;
    const master = masterFor(key, weight);

    const chars = [];
    for (let i = 0; i < count; i++) {
      const pos = run.getStartPositionOfChar(i);
      chars.push({ ch: text[i], x: pos.x, y: pos.y });
    }

    runs.push({
      faceId: master.id,
      chars,
      fontSize,
      bold: SYNTHETIC_BOLD(weight, master.weight, fontSize),
      italic: cs.fontStyle === 'italic' || cs.fontStyle === 'oblique',
      underline: String(cs.textDecorationLine || cs.textDecoration || '').includes('underline'),
      // Resolved rather than inherited: the paint has to survive the element
      // ceasing to be a <text>, and getComputedStyle has already turned every
      // theme variable into a literal colour.
      fill: cs.fill,
      fillOpacity: cs.fillOpacity,
      stroke: cs.stroke,
      strokeWidth: numeric(cs.strokeWidth, 0),
      strokeOpacity: cs.strokeOpacity,
      strokeLinejoin: cs.strokeLinejoin,
      opacity: cs.opacity,
      // A halo behind the label — .tlbl paints one so an edge does not run
      // through its own caption. It has to be laid down for the whole run
      // before any glyph is filled, or each glyph's halo covers the previous
      // glyph, so it becomes a separate pass rather than a paint-order hint.
      halo: String(cs.paintOrder || '').startsWith('stroke')
    });
  }
  return runs.length ? { cloneEl, runs } : null;
}

// Collects the distinct outlines an export uses into one <defs>, so a repeated
// character costs a <use> rather than a second copy of its path.
class GlyphCache {
  constructor(root) {
    this.root = root;
    this.defs = null;
    this.ids = new Map();
    this.entries = [];
  }

  // Returns the id to reference, or null when the character has no outline in
  // any face this export can reach.
  ref(faceId, ch, tables) {
    const key = `${faceId} ${ch}`;
    if (this.ids.has(key)) return this.ids.get(key);

    let table = tables.get(faceId);
    let from = faceId;
    let d = table && table.glyphs[ch];
    if (d === undefined) {
      table = tables.get(FALLBACK_FACE);
      from = FALLBACK_FACE;
      d = table && table.glyphs[ch];
    }
    if (d === undefined) { this.ids.set(key, null); return null; }

    // A space is in the table with an empty outline. That is not the same as a
    // character the face does not have, and only the second is a reason to
    // leave a label as text — so it resolves, to nothing to draw.
    const entry = d === ''
      ? { id: null, upem: table.upem }
      : { id: `gl-${from}-${ch.codePointAt(0).toString(16)}`, upem: table.upem, d };
    this.ids.set(key, entry);
    if (entry.id) this.entries.push(entry);
    return entry;
  }

  // Only the glyphs something referenced. A text element can resolve part of
  // its run and then be refused for a later character, and the outlines it
  // looked up on the way are not in the file it was refused from.
  flush() {
    const used = this.entries.filter(e => e.used);
    if (!used.length) return;
    this.defs = document.createElementNS(SVG_NS, 'defs');
    for (const entry of used) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('id', entry.id);
      path.setAttribute('d', entry.d);
      this.defs.appendChild(path);
    }
    this.root.insertBefore(this.defs, this.root.firstChild);
  }
}

// Builds the replacement group and swaps it in. Returns false without touching
// the clone if any character turns out to have no outline — the check and the
// swap are separate passes for exactly that reason.
function emitOutlines(job, tables, cache) {
  const resolved = [];
  for (const run of job.runs) {
    const glyphs = [];
    for (const c of run.chars) {
      const entry = cache.ref(run.faceId, c.ch, tables);
      if (!entry) return false;
      glyphs.push({ entry, x: c.x, y: c.y });
    }
    resolved.push({ run, glyphs });
  }

  const g = document.createElementNS(SVG_NS, 'g');
  for (const attr of Array.from(job.cloneEl.attributes || [])) {
    if (!DROP_ATTRS.has(attr.name)) g.setAttribute(attr.name, attr.value);
  }

  for (const { run, glyphs } of resolved) {
    const place = entry => {
      // Font units are Y-up and the outline is stored unscaled, so each glyph
      // is flipped and scaled to the run's font size at the point the browser
      // put it. The shear goes inside that, where the glyph's own baseline is
      // y = 0 and leaning the top to the right is a positive x shift.
      const s = run.fontSize / entry.upem;
      const skew = run.italic ? ` matrix(1 0 ${SYNTHETIC_ITALIC_SHEAR} 1 0 0)` : '';
      return `translate(${round(entry.x)} ${round(entry.y)}) scale(${round(s, 6)} ${round(-s, 6)})${skew}`;
    };

    // The placements are worked out once and the nodes built per pass, because
    // a halo below needs the same glyphs at the same points as a second set of
    // elements. Two passes over one list rather than one pass and a clone.
    const placed = [];
    for (const { entry, x, y } of glyphs) {
      if (!entry.id) continue;      // a space: measured, nothing to draw
      entry.used = true;
      placed.push({ id: entry.id, transform: place({ ...entry, x, y }) });
    }
    const useNodes = () => placed.map(({ id, transform }) => {
      const use = document.createElementNS(SVG_NS, 'use');
      use.setAttribute('href', `#${id}`);
      // Consumers that predate SVG 2 read only the xlink form, and older
      // Illustrator and Inkscape are both in that group. It goes through
      // setAttributeNS so the serializer emits a real namespaced attribute;
      // finishExportSVG declares xmlns:xlink on the root to match.
      use.setAttributeNS(XLINK_NS, 'xlink:href', `#${id}`);
      use.setAttribute('transform', transform);
      return use;
    });

    if (run.halo && run.stroke && run.stroke !== 'none' && run.strokeWidth > 0) {
      const haloG = document.createElementNS(SVG_NS, 'g');
      haloG.setAttribute('fill', 'none');
      haloG.setAttribute('stroke', run.stroke);
      haloG.setAttribute('stroke-width', run.strokeWidth);
      haloG.setAttribute('stroke-linejoin', run.strokeLinejoin || 'round');
      if (run.strokeOpacity && run.strokeOpacity !== '1') {
        haloG.setAttribute('stroke-opacity', run.strokeOpacity);
      }
      for (const use of useNodes()) haloG.appendChild(use);
      g.appendChild(haloG);
    }

    const inkG = document.createElementNS(SVG_NS, 'g');
    inkG.setAttribute('fill', run.fill);
    if (run.fillOpacity && run.fillOpacity !== '1') inkG.setAttribute('fill-opacity', run.fillOpacity);
    if (run.opacity && run.opacity !== '1') inkG.setAttribute('opacity', run.opacity);
    if (run.bold > 0) {
      // Synthetic bold, the way a rasteriser does it: the glyph stroked in its
      // own colour. It is on the ink pass only, so a halo stays the width the
      // stylesheet asked for.
      inkG.setAttribute('stroke', run.fill);
      inkG.setAttribute('stroke-width', round(run.bold, 3));
      inkG.setAttribute('stroke-linejoin', 'round');
    }
    for (const use of useNodes()) inkG.appendChild(use);
    g.appendChild(inkG);

    if (run.underline && glyphs.length) {
      // The browser drew this and the outlines do not carry it. Measured off
      // the run's own glyph positions rather than assumed, so it spans exactly
      // the characters it decorated.
      const first = glyphs[0], last = glyphs[glyphs.length - 1];
      const rule = document.createElementNS(SVG_NS, 'rect');
      rule.setAttribute('x', round(first.x));
      rule.setAttribute('y', round(last.y + run.fontSize * 0.11));
      rule.setAttribute('width', round(Math.max(0, last.x - first.x + run.fontSize * 0.6)));
      rule.setAttribute('height', round(Math.max(0.5, run.fontSize * 0.06), 3));
      rule.setAttribute('fill', run.fill);
      g.appendChild(rule);
    }
  }

  job.cloneEl.replaceWith(g);
  return true;
}

function round(v, places = 2) {
  const f = 10 ** places;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}
