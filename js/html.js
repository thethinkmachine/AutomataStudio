// ══════════════════════════════════════════════════════════════════
//  MARKUP FROM TEMPLATES, ESCAPED BY DEFAULT
// ══════════════════════════════════════════════════════════════════
// `html` is a tag for template literals. Every interpolated value is escaped
// unless it is itself markup — the result of another `html` or of `raw` — so
// a state named `q<b>0</b>` reads as those eight characters wherever a card
// prints it, and a template only ever has to say when something is *not* text:
//
//   html`<td>${state.name}</td>`              escaped
//   html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>`   nested, not re-escaped
//   html`<button>${raw(ICON)} Load</button>`  a constant the module owns
//
// Arrays are joined, and null, undefined and false print nothing, so an
// optional fragment is `${cond && html`…`}`. The result is an `Html`, which
// `innerHTML` accepts through its toString.
//
// Import-free, so the machine layer — which narrates its branch logs as markup
// and must import nothing that needs a document — can use it as well.

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ENTITIES[c]);
}

export class Html {
  constructor(markup) { this.markup = markup; }
  toString() { return this.markup; }
}

/** Markup that is already safe: a constant, or a string `html` built earlier. */
export function raw(markup) {
  return markup instanceof Html ? markup : new Html(String(markup ?? ''));
}

function piece(value) {
  if (value == null || value === false) return '';
  if (value instanceof Html) return value.markup;
  if (Array.isArray(value)) return value.map(piece).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += piece(values[i]) + strings[i + 1];
  return new Html(out);
}
