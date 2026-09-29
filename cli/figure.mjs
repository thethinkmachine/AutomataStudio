// ══════════════════════════════════════════════════════════════════
//  A DIAGRAM THAT STANDS ALONE
// ══════════════════════════════════════════════════════════════════
// The library's figures (js/library/sketch.js) are drawn with classes and
// styled by the page they sit in — css/library.css in the app, site.css on the
// website. A file on disk has no page, so the rules are inlined here with the
// theme's variables resolved to colours, and a background laid under them.
// The same rules, plus keyframes, animate a run: each state and edge is lit
// for the steps it is active, and the last frame holds in the verdict's colour.

import { liveDiagram, traceWord } from '../js/library/analyze.js';

export const THEMES = {
  light: { bg: '#fbfaf7', well: '#ffffff', text: '#1d2433', text2: '#5a6478', accent: '#3b6fe0', green: '#1f9d55', red: '#d64545' },
  dark: { bg: '#0d1322', well: '#131b2e', text: '#dfe8ff', text2: '#8894b0', accent: '#7aa2ff', green: '#69f0ae', red: '#ff6b6b' }
};

function rules(t) {
  return [
    `.bg{fill:${t.bg}}`,
    `.sk-e{fill:none;stroke:${t.text2};stroke-width:1.15;stroke-linecap:round}`,
    `.sk-ah{fill:${t.text2}}`,
    `.sk-n{fill:${t.well};stroke:${t.text};stroke-width:1.3}`,
    `.sk-a{fill:none;stroke:${t.text};stroke-width:1}`,
    `.sk-s{fill:none;stroke:${t.accent};stroke-width:1.6;stroke-linecap:round}`,
    `.sk-sh{fill:${t.accent}}`,
    `.sk-name{fill:${t.text};font-family:Georgia,'Times New Roman',serif;font-style:italic}`,
    `.sk-l{fill:${t.text2};font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:16px;paint-order:stroke;stroke:${t.well};stroke-width:3px;stroke-linejoin:round}`,
    '.sk.is-thin .sk-n{stroke-width:1}',
    '.sk.is-thin .sk-e{stroke-width:.9}'
  ].join('');
}

/** Put a stylesheet and a background into a sketch SVG. */
export function standalone(svg, { theme = 'light', extraCss = '' } = {}) {
  const t = THEMES[theme] || THEMES.light;
  const open = svg.indexOf('>') + 1;
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const [w, h] = vb ? [vb[1], vb[2]] : ['100%', '100%'];
  const head = svg.slice(0, open).replace('<svg ', `<svg width="${w}" height="${h}" `);
  return `${head}<style>${rules(t)}${extraCss}</style><rect class="bg" width="${w}" height="${h}"/>${svg.slice(open)}`;
}

const cssId = s => String(s).replace(/[^A-Za-z0-9_-]/g, c => `_${c.charCodeAt(0).toString(16)}`);

/**
 * The machine's run on `word`, as an SVG that plays itself: `stepMs` per step,
 * then the last frame held for `holdMs`, looping. Returns `{ svg, steps, final }`
 * or `{ error }`.
 */
export function animatedRun(target, word, { theme = 'light', stepMs = 600, holdMs = 1800, cap = 200, width = 720 } = {}) {
  const run = traceWord(target, word, cap);
  if (run.error) return { error: run.error };
  const d = liveDiagram(target, { w: width });
  const t = THEMES[theme] || THEMES.light;
  const steps = run.steps;
  const n = steps.length;
  const total = n * stepMs + holdMs;
  const pct = ms => `${((ms / total) * 100).toFixed(4)}%`;
  const verdictColour = run.final === 'accept' ? t.green : run.final === 'reject' ? t.red : t.accent;

  // Which drawn node and edge each step lights.
  const litNodes = steps.map(s => new Set(s.states.map(id => d.rootOf.get(id) || id)));
  const litEdges = steps.map(s => new Set(s.tid != null && d.edgeOf.has(s.tid) ? [d.edgeOf.get(s.tid)] : []));
  const nodes = new Set(litNodes.flatMap(s => [...s]));
  const edges = new Set(litEdges.flatMap(s => [...s]));

  const frames = (isLit, on, off, lastOn) => {
    // One keyframe at every step boundary where the value changes.
    const k = [`0%{${isLit(0) ? on : off}}`];
    for (let i = 1; i < n; i++) if (isLit(i) !== isLit(i - 1)) k.push(`${pct(i * stepMs)}{${isLit(i) ? on : off}}`);
    k.push(`${pct(n * stepMs)}{${isLit(n - 1) ? lastOn : off}}`, `100%{${isLit(n - 1) ? lastOn : off}}`);
    return k.join('');
  };
  const css = [];
  const anim = name => `animation:${name} ${total}ms step-end infinite`;
  for (const id of nodes) {
    const k = `n${cssId(id)}`;
    css.push(`@keyframes ${k}{${frames(i => litNodes[i].has(id), `fill:${t.accent};stroke:${t.accent}`, `fill:${t.well};stroke:${t.text}`, `fill:${verdictColour};stroke:${verdictColour}`)}}`);
    css.push(`.s[data-s="${id}"] .sk-n{${anim(k)}}`);
    const kt = `t${cssId(id)}`;
    css.push(`@keyframes ${kt}{${frames(i => litNodes[i].has(id), `fill:${t.well}`, `fill:${t.text}`, `fill:${t.well}`)}}`);
    css.push(`.s[data-s="${id}"] .sk-name{${anim(kt)}}`);
  }
  for (const key of edges) {
    const k = `e${cssId(key)}`;
    css.push(`@keyframes ${k}{${frames(i => litEdges[i].has(key), `stroke:${t.accent};stroke-width:2.4`, `stroke:${t.text2};stroke-width:1.15`, `stroke:${t.text2};stroke-width:1.15`)}}`);
    css.push(`.e[data-e="${key.replace(/"/g, '\\"')}"] .sk-e{${anim(k)}}`);
  }
  return { svg: standalone(d.svg, { theme, extraCss: css.join('') }), steps: n, final: run.final, cut: run.cut };
}
