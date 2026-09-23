// ══════════════════════════════════════════════════════════════════
//  KEYBOARD LABELS
// ══════════════════════════════════════════════════════════════════
//  How a shortcut is *written*, once. The app spoke three dialects of it: the
//  tooltips, the shortcut table and the boot hint said `Ctrl+Z`; the toolbox
//  keycaps and the tab menu said `⌘Z` and `⌘⇧T` — on every platform, Linux
//  included; and the note editor hedged with `Ctrl/Cmd+B`. None of them was
//  about what the key handlers accept, which is the same everywhere: every one
//  reads `ctrlKey || metaKey`.
//
//  So a label is a platform-neutral spec — `Mod+Shift+T` — and this is the one
//  place it becomes text: `⌘⇧T` on Apple platforms, `Ctrl+Shift+T` elsewhere.
//  `Ctrl` in a spec reads as `Mod`, because that is exactly what the handlers
//  do with it; the existing `data-tip-kbd="Ctrl+Z"` attributes are therefore
//  already specs, and did not all have to be rewritten to become one.
//
//  Import-free, so any module — the tooltip IIFE included — can reach it
//  without joining a cycle.

const APPLE = /Mac|iPhone|iPad|iPod/i;

export function isApplePlatform() {
  if (typeof navigator === 'undefined' || !navigator) return false;
  const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  return APPLE.test(p);
}

const APPLE_GLYPHS = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌘' };

/**
 * `Mod+Shift+T` → `⌘⇧T` on a Mac, `Ctrl+Shift+T` everywhere else.
 *
 * A `+` separates only when it stands between two keys, so the zoom-in key is
 * written `+` and stays one. On a Mac the modifiers are glyphs run together,
 * the platform's own convention, and anything that is not one keeps its `+` —
 * `Space+Drag` is a key and a gesture, not two glyphs.
 */
export function formatKbd(spec, apple = isApplePlatform()) {
  if (!spec) return '';
  const keys = String(spec).split(/(?<=.)\+(?=.)/).map(k => k.trim()).filter(Boolean);
  if (!apple) return keys.map(k => (k === 'Mod' ? 'Ctrl' : k)).join('+');
  let out = '';
  keys.forEach((k, i) => {
    const glyph = APPLE_GLYPHS[k];
    if (i > 0 && !APPLE_GLYPHS[keys[i - 1]]) out += '+';
    out += glyph || k;
  });
  return out;
}

/**
 * Writes every `[data-kbd]` element's text from its spec. The markup carries
 * the non-Apple spelling as its own text, so a page read before this runs, or
 * without it, still says something true.
 */
export function localizeKbdLabels(root = typeof document !== 'undefined' ? document : null) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const apple = isApplePlatform();
  root.querySelectorAll('[data-kbd]').forEach(el => {
    el.textContent = formatKbd(el.getAttribute('data-kbd'), apple);
  });
}
