// ══════════════════════════════════════════════════════════════════
//  THE LIBRARY'S PAGES — NODES
// ══════════════════════════════════════════════════════════════════
// The few helpers every Library page is built with, shared by the catalogue
// (library-ui.js) and the Library of Babel (js/babel/babel-ui.js) so both
// build their pages the same way. Nodes carry their listeners from creation,
// the way reference.js and statemate-ui.js do it; text goes in as text.
//
// Import-free.

/** An element: `h('div', { class, text, on: { click }, data: { … } }, ...children)`. */
export function h(tag, props, ...kids) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
      else if (k === 'data') for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
      else if (k === 'style') node.setAttribute('style', v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(node, kids);
  return node;
}

export function append(node, kids) {
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    if (Array.isArray(kid)) append(node, kid);
    else if (typeof kid === 'string' || typeof kid === 'number') node.append(document.createTextNode(String(kid)));
    else node.append(kid);
  }
}

/**
 * The name of a part of AutomataStudio, set the way the app sets its own name:
 * the diamond mark (index.html's #logo-mark symbol, so it is the app's logo and
 * not a copy of it), the wordmark, and the part's name in the serif —
 * "AutomataStudio Library", "AutomataStudio Babel". The website's header
 * (scripts/library/site.mjs brandHtml) is the same lockup.
 */
export function brandLockup(part) {
  const mark = h('span', { class: 'lib-brand-mark', 'aria-hidden': 'true' });
  mark.innerHTML = '<svg><use href="#logo-mark"/></svg>';
  return h('span', { class: 'lib-brand' }, mark,
    h('span', { class: 'lib-brand-logo' }, 'Automata', h('em', { text: 'Studio' })),
    h('span', { class: 'lib-brand-sub', text: part }));
}

/** The header's Back: a chevron, the same on every Library page. */
export function backButton(onClick) {
  const b = h('button', { type: 'button', class: 'lib-back', title: 'Back', 'aria-label': 'Back', on: { click: onClick } });
  b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return b;
}

export function button(label, onClick, cls = 'btn-g', extra = {}) {
  return h('button', { type: 'button', class: cls, on: { click: onClick }, ...extra }, label);
}

/** An SVG string drawn by sketch.js → a node. Every string it makes escapes its text. */
export function svgFigure(svg, cls = '') {
  const box = h('div', { class: `lib-fig${cls ? ` ${cls}` : ''}` });
  box.innerHTML = svg;
  return box;
}

/** A section's heading: a title on a hairline, and what else there is to say or do. */
export function sectionHead(title, aside = null) {
  return h('div', { class: 'lib-sechead' }, h('h3', { class: 'lib-sechead-title', text: title }), aside);
}
