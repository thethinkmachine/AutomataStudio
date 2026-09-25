// What a folded section says about itself.
//
// A collapsed section is its header, and a minimized window is the same thing
// — a title strip. Both used to say only their name: "SIMULATE", with the
// verdict of the run the reader had just made folded away under it. So a
// section that has something worth knowing at a glance reports it here, and
// the header shows it **only while the section is folded** — open, the body
// says the same thing at full size, and a second copy beside the title would
// be noise. See `.sec-status` in css/panels.css.
//
// Import-free, and addressed by section id rather than by element, for the
// reason js/panel-state.js is: the renderers that know what to say
// (simulation.js, the batch tester, the Machine section) and the panel code
// that owns the header should not have to import each other to meet.
//
// The chip is injected rather than written into the markup of every section —
// the same rule the reorder grip and the pop-out button follow — and it is
// created on first use, so a section that never reports never grows one.

/** The tones a status can take: its verdict colour, or none. */
export const STATUS_TONES = Object.freeze(['acc', 'rej', 'warn', '']);

function headerOf(section) {
  for (const child of [...(section.children || [])]) {
    const cls = child.classList;
    if (cls && (cls.contains('lp-section-header') || cls.contains('rp-section-header'))) return child;
  }
  return null;
}

/**
 * The chip, placed after the title and the count and before the controls.
 *
 * The pop-out button and the collapse arrow are both inserted before the arrow,
 * so going in before the first of them keeps the header reading name → what
 * it knows → what you can do with it, whichever was installed first.
 */
function chipFor(id) {
  const section = document.getElementById(id);
  if (!section) return null;
  if (section.__secStatus) return section.__secStatus;
  const header = headerOf(section);
  if (!header) return null;
  const chip = document.createElement('span');
  chip.className = 'sec-status';
  const before = typeof header.querySelector === 'function'
    ? header.querySelector('.panel-float-btn, .lp-toggle-arrow, .rp-toggle-arrow')
    : null;
  if (before) header.insertBefore(chip, before);
  else header.appendChild(chip);
  section.__secStatus = chip;
  return chip;
}

/**
 * Sets what a section says while folded. An empty `text` says nothing, and the
 * chip is hidden by its own `:empty` rather than by a second flag to keep in
 * step with the first.
 *
 * `tone` is one of `STATUS_TONES`, and anything else reads as none: a status is
 * decoration on a header, and a typo in a caller must not throw from inside a
 * renderer.
 */
export function setSectionStatus(id, text = '', tone = '') {
  const value = text == null ? '' : String(text);
  // Nothing to say and nothing said yet: do not build a chip just to empty it.
  const section = document.getElementById(id);
  if (!value && !(section && section.__secStatus)) return;
  const chip = chipFor(id);
  if (!chip) return;
  if (chip.textContent !== value) chip.textContent = value;
  const t = STATUS_TONES.includes(tone) ? tone : '';
  if (t) chip.setAttribute('data-tone', t);
  else chip.removeAttribute('data-tone');
  // The full text for a header too narrow to show all of it.
  if (value) chip.setAttribute('data-tip', value);
  else chip.removeAttribute('data-tip');
}

/** What a section is saying right now — the tests' way in. */
export function sectionStatus(id) {
  const section = document.getElementById(id);
  const chip = section && section.__secStatus;
  return chip ? { text: chip.textContent, tone: chip.getAttribute('data-tone') || '' } : { text: '', tone: '' };
}
