// What is wrong with an essay, as the build reports it. Apart from essay.js so
// that the app, which imports essay.js for its facts, does not load the
// Markdown parser until an essay is on screen.

import { ARTICLE_MAX_CHARS, renderArticle } from './article.js';
import { essayFacts, essayFigureSpec, essayLinkTarget } from './essay.js';

/**
 * What is wrong with an essay, as the build reports it on the entry: a fact
 * the library does not know, a figure the machine cannot draw, a link to
 * nothing, a note never written, a file past the length the renderer reads.
 * Nothing is drawn — the check asks only whether it could be — so this is
 * cheap enough to run on every build, and an author sees it on their pull
 * request instead of on the published page.
 */
export function essayWarnings(md, index, self = null) {
  const byId = new Map((index?.entries || []).map(e => [e.id, e]));
  const could = { html: '' };
  const figure = (name, args) => {
    if (name === 'machines') return args._.length && args._.every(id => byId.has(id)) ? could : null;
    return essayFigureSpec(name, args, args.id ? byId.get(args.id) : self) ? could : null;
  };
  const { warnings } = renderArticle(md, { fact: essayFacts(index, self), figure, link: id => (essayLinkTarget(index, id) ? '#' : null) });
  const out = warnings.map(w => `Essay: ${w}`);
  if (String(md).length > ARTICLE_MAX_CHARS) out.push(`Essay: longer than ${ARTICLE_MAX_CHARS.toLocaleString('en-US')} characters; the rest is not shown.`);
  return out;
}
