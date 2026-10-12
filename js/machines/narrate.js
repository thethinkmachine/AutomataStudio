// The branch log a nondeterministic search keeps for the Algorithms view's
// simulators: one entry per branch it narrates, as markup. The NPDA, the EPDA
// and the NDTM all say the same three things, so they say them through here,
// where the state names and configurations — which are the reader's text —
// are escaped once rather than at each of nine call sites.

import { html } from '../html.js';

const subLines = lines => html`<span class="step-sub">${lines.map((line, i) => html`${i ? html`<br>` : ''}${line}`)}</span>`;

export function narrateAccept(branch, ...lines) {
  return String(html`<span class="step-acc">Branch ${branch}: ACCEPT ✓</span>${subLines(lines)}`);
}

export function narrateStuck(branch, ...lines) {
  return String(html`Branch ${branch}: <span class="step-dead">stuck</span>${subLines(lines)}`);
}

export function narrateExplore(branch, stateName, lines) {
  return String(html`Branch ${branch}: exploring <em>${stateName}</em>${subLines(lines)}`);
}

export function narrateEnd(headline, ...lines) {
  return String(html`${headline}${subLines(lines)}`);
}
