// ══════════════════════════════════════════════════════════════════
//  EMBEDDED FONT FACES  (the PNG backstop)
// ══════════════════════════════════════════════════════════════════
//  js/glyphs.js turns the diagram's text into outlines, which is what
//  makes an export carry its own type. It refuses a label it cannot
//  convert *completely* — a character outside the built glyph tables,
//  or a run whose white space SVG collapsed — and leaves it as <text>.
//  This is what those leftovers get.
//
//  It exists for PNG and is deliberately not offered to SVG, because
//  the two pay for it differently. exportPNG rasterises through
//  `img.src = blob:`, so the @font-face rules are consumed while the
//  image is being drawn and never reach the .png: correct glyphs, and
//  the file does not grow by a single byte. In an .svg file the same
//  rules are ~120KB of base64 that would sit there permanently — which
//  is the cost the outlines were adopted to avoid.
//
//  Two things make it work where the naive version fails. The rules
//  cannot simply be scraped from document.styleSheets: the Google Fonts
//  sheet is cross-origin, so `sheet.cssRules` throws and buildExportSVG
//  skips it. And they cannot keep their `https://fonts.gstatic.com`
//  URLs either, because an SVG loaded as an *image* fetches no external
//  resources at all — hence base64. Both endpoints send
//  `Access-Control-Allow-Origin: *`, and the browser has already
//  downloaded these exact files to render the page, so the fetch is
//  normally served from cache.

// The families the canvas draws with, at the weights index.html loads. Crimson
// Pro is absent on purpose: css/canvas.css never asks for var(--serif), and the
// views that do are HTML and never reach an export.
const FAMILIES = 'family=JetBrains+Mono:wght@400;500&family=DM+Sans:wght@400;500';

// Latin covers the diagram; greek is where the app's own epsilon and lambda
// live, so leaving it out would lose exactly the characters this is for.
const WANTED_SUBSETS = /latin|greek/;

let cached = null;

// Exposed for tests — the memo is module state that would otherwise persist
// across a reset and hide a second call's behaviour.
export function resetFontCache() {
  cached = null;
}

const toBase64 = bytes => {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
};

/**
 * @returns {Promise<string>} `@font-face` rules with the font binaries inlined
 *   as data URIs, or '' if they could not be fetched — an export with a
 *   fallback face is worse than one with the right face and better than none.
 */
export async function fontFaceCSS() {
  if (cached !== null) return cached;
  try {
    const url = `https://fonts.googleapis.com/css2?${FAMILIES}&display=swap`;
    const sheet = await fetch(url).then(r => (r.ok ? r.text() : ''));

    // Each @font-face block is one weight of one subset. The comment above a
    // block names the subset, which is the only place that name appears --
    // unicode-range says which characters, never which cut.
    const blocks = sheet.split('@font-face').slice(1);
    const rules = await Promise.all(blocks.map(async (block, i) => {
      const before = sheet.split('@font-face')[i];
      const subset = before.match(/\/\*\s*([a-z-]+)\s*\*\/\s*$/)?.[1] || '';
      if (subset && !WANTED_SUBSETS.test(subset)) return '';

      const src = block.match(/url\((https:\/\/[^)]+)\)/)?.[1];
      if (!src) return '';
      const buf = await fetch(src).then(r => (r.ok ? r.arrayBuffer() : null));
      if (!buf) return '';
      const format = src.endsWith('.woff2') ? 'woff2' : 'woff';
      const inlined = `url(data:font/${format};base64,${toBase64(new Uint8Array(buf))}) format('${format}')`;
      // A @font-face block cannot nest braces, so the first '}' is its end and
      // everything the API declared -- family, weight, style, unicode-range --
      // is carried through unchanged with only the src rewritten.
      const body = block.slice(block.indexOf('{') + 1, block.indexOf('}'));
      return `@font-face{${body.replace(/src:[^;]+;/, `src:${inlined};`)}}`;
    }));

    cached = rules.filter(Boolean).join('\n');
  } catch (e) {
    cached = '';
  }
  return cached;
}
