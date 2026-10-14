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
