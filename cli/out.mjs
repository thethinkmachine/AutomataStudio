// ══════════════════════════════════════════════════════════════════
//  THE TERMINAL'S LOOK
// ══════════════════════════════════════════════════════════════════
// One palette for every command, taken from the app's dark theme so the
// terminal and the canvas read as one product: the accent blue, green for
// accept, red for reject, amber for "no verdict", violet for states, and a
// fixed colour per tape symbol (the same order the space-time diagrams use).
//
// Colour depth is detected, not assumed: truecolor where the terminal says so
// (COLORTERM, Windows Terminal, iTerm, VS Code), 256 colours where TERM does,
// the 16 basic ones otherwise, and none at all when output is not a terminal
// or NO_COLOR is set. FORCE_COLOR=1/2/3 overrides, for a pager (`| less -R`).
// JSON output bypasses all of it.

const env = process.env;

function colorLevel() {
  if ('NO_COLOR' in env && env.NO_COLOR !== '') return 0;
  if (env.FORCE_COLOR !== undefined) {
    const f = env.FORCE_COLOR === '' || env.FORCE_COLOR === 'true' ? 1 : Number(env.FORCE_COLOR);
    return Math.max(0, Math.min(3, Number.isFinite(f) ? f : 1));
  }
  if (!process.stdout.isTTY || env.TERM === 'dumb') return 0;
  if (/^(truecolor|24bit)$/i.test(env.COLORTERM || '')) return 3;
  if (env.WT_SESSION || env.TERM_PROGRAM === 'iTerm.app' || env.TERM_PROGRAM === 'vscode' || env.TERM_PROGRAM === 'WezTerm') return 3;
  if (/256/.test(env.TERM || '')) return 2;
  return process.platform === 'win32' ? 3 : 1;
}

export const level = colorLevel();
export const isTTY = !!process.stdout.isTTY;
/** Whether styling is on at all. */
export const styled = level > 0;

// ── Colours ───────────────────────────────────────────────────────

const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

// The nearest of the xterm 256 colours (the 6×6×6 cube and the grey ramp).
function to256([r, g, b]) {
  if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  const q = v => Math.round((v / 255) * 5);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

// The nearest of the 16 basic colours, by hue family.
function to16([r, g, b], bg) {
  const bright = Math.max(r, g, b) > 180;
  const idx = (r > 127 ? 1 : 0) | (g > 127 ? 2 : 0) | (b > 127 ? 4 : 0);
  return (bg ? 40 : 30) + idx + (bright ? 60 : 0);
}

function sgr(hex, bg = false) {
  const rgb = hexRgb(hex);
  if (level >= 3) return `${bg ? 48 : 38};2;${rgb.join(';')}`;
  if (level === 2) return `${bg ? 48 : 38};5;${to256(rgb)}`;
  return String(to16(rgb, bg));
}

const paint = (open, close) => s => (styled ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

/** Foreground in a hex colour. */
export const fg = hex => paint(sgr(hex), 39);
/** Background in a hex colour, with a readable foreground. */
export const bg = (hex, ink = '#0d1322') => s => (styled ? `\x1b[${sgr(hex, true)};${sgr(ink)}m${s}\x1b[39;49m` : String(s));

export const PALETTE = {
  accent: '#7aa2ff',
  green: '#69f0ae',
  red: '#ff6b6b',
  amber: '#ffd54f',
  cyan: '#4fc3f7',
  violet: '#b388ff',
  orange: '#ff9e6b',
  pink: '#f48fb1',
  teal: '#80deea',
  text: '#dfe8ff',
  muted: '#8894b0',
  faint: '#4a5578',
  well: '#131b2e',
  ground: '#0d1322'
};

export const c = {
  bold: paint(1, 22),
  dim: paint(2, 22),
  italic: paint(3, 23),
  underline: paint(4, 24),
  inverse: paint(7, 27),
  accent: fg(PALETTE.accent),
  red: fg(PALETTE.red),
  green: fg(PALETTE.green),
  yellow: fg(PALETTE.amber),
  cyan: fg(PALETTE.cyan),
  magenta: fg(PALETTE.pink),
  violet: fg(PALETTE.violet),
  orange: fg(PALETTE.orange),
  teal: fg(PALETTE.teal),
  muted: fg(PALETTE.muted),
  faint: fg(PALETTE.faint)
};

// A colour per symbol, in the order the space-time diagrams use: the blank is
// the ground, and every other symbol the same colour every time it appears.
const SYMBOL_COLOURS = ['#ff9e6b', '#4fc3f7', '#69f0ae', '#b388ff', '#ffd54f', '#f48fb1', '#80deea', '#c5e1a5', '#ffab91', '#9fa8da'];

/** A stable colour for a symbol, given the alphabet it belongs to. */
export function symbolColour(sym, alphabet, blank = '⊔') {
  if (sym === blank || sym === '' || sym == null) return PALETTE.faint;
  const i = alphabet.indexOf(sym);
  return SYMBOL_COLOURS[(i < 0 ? [...String(sym)].reduce((h, ch) => h + ch.codePointAt(0), 0) : i) % SYMBOL_COLOURS.length];
}

// ── Shapes ────────────────────────────────────────────────────────

const visible = s => String(s).replace(/\x1b\[[0-9;]*m/g, '');
export const width = s => [...visible(s)].length;
export const columns = () => Math.max(40, process.stdout.columns || 100);

/** Pad (or cut) to a visible width. */
export function pad(s, w, align = 'left') {
  const n = width(s);
  if (n >= w) return s;
  const gap = ' '.repeat(w - n);
  return align === 'right' ? gap + s : align === 'center' ? ' '.repeat(Math.floor((w - n) / 2)) + s + ' '.repeat(Math.ceil((w - n) / 2)) : s + gap;
}

/** A filled label: ` text ` on a colour. */
export function pill(text, hex = PALETTE.accent, ink = PALETTE.ground) {
  return styled ? bg(hex, ink)(` ${text} `) : `[${text}]`;
}

/** A section rule: ── Title ───────── */
export function rule(title = '', w = Math.min(columns(), 80)) {
  const head = title ? `${c.faint('──')} ${c.bold(c.accent(title))} ` : '';
  return head + c.faint('─'.repeat(Math.max(2, w - width(head))));
}

/** A rounded box around lines, with an optional title in the top border. */
export function box(lines, { title = '', w = null, colour = PALETTE.faint } = {}) {
  const inner = w ?? Math.max(width(title) + 4, ...lines.map(width)) + 2;
  const edge = fg(colour);
  const t = title ? ` ${title} ` : '';
  const top = edge('╭─') + (t ? c.bold(t) : '') + edge('─'.repeat(Math.max(0, inner - width(t) - 1)) + '╮');
  const body = lines.map(l => edge('│') + ' ' + pad(l, inner - 2) + ' ' + edge('│'));
  return [top, ...body, edge('╰' + '─'.repeat(inner) + '╯')].join('\n');
}

/** A progress bar of `w` cells. */
export function bar(frac, w = 20, hex = PALETTE.accent) {
  const f = Math.max(0, Math.min(1, frac));
  const eighths = Math.round(f * w * 8);
  const full = Math.floor(eighths / 8), part = eighths % 8;
  const partial = part ? '▏▎▍▌▋▊▉'[part - 1] : '';
  const empty = w - full - (part ? 1 : 0);
  return fg(hex)('█'.repeat(full) + partial) + c.faint('░'.repeat(Math.max(0, empty)));
}

// ── Output ────────────────────────────────────────────────────────

export function print(...parts) {
  process.stdout.write(parts.join(' ') + '\n');
}

export function printJson(value) {
  process.stdout.write(JSON.stringify(value, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n');
}

export function warn(msg) {
  process.stderr.write(`${c.yellow('▲ warning')} ${msg}\n`);
}

/** The verdict words the CLI prints, with a glyph and coloured by meaning. */
export function verdictWord(v) {
  if (v === 'acc' || v === 'accept') return c.green('✔ accept');
  if (v === 'rej' || v === 'reject') return c.red('✘ reject');
  if (v === 'err' || v === 'error') return c.magenta('! error');
  return c.yellow('? unknown');
}

/**
 * Words of `s` in lines of at most `room` visible columns. Colour codes ride
 * along inside the words they colour; a word longer than a line keeps a line
 * of its own rather than being cut.
 */
function wrapWords(s, room) {
  const lines = [];
  let line = '';
  for (const word of String(s).split(' ')) {
    if (line && width(line) + 1 + width(word) > room) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  lines.push(line);
  return lines;
}

/**
 * Rows of cells → aligned columns. The last column is not padded. On a
 * terminal, a last cell too long for the line wraps under itself rather than
 * letting the terminal wrap it back to the left edge, through the columns
 * before it; piped, each row stays one line, for scripts.
 */
export function table(rows, { head = null, gap = 2, wrap = isTTY } = {}) {
  const all = head ? [head.map(h => c.bold(c.muted(h))), ...rows] : rows;
  if (!all.length) return '';
  const w = [];
  for (const r of all) r.forEach((cell, i) => { w[i] = Math.max(w[i] || 0, width(cell)); });
  const total = columns();
  return all.map(r => {
    const lead = r.slice(0, -1).map((cell, i) => pad(String(cell), w[i] + gap)).join('');
    const last = String(r.at(-1) ?? '');
    const indent = width(lead);
    if (!wrap || r.length < 2 || total - indent < 24 || indent + width(last) <= total) return lead + last;
    return wrapWords(last, total - indent).map((l, k) => (k ? ' '.repeat(indent) : lead) + l).join('\n');
  }).join('\n');
}

/** A word's tokens as a reader would type them, with ε for the empty word. */
export function wordOf(tokens, eps = 'ε') {
  if (!tokens || !tokens.length) return eps;
  return tokens.every(t => [...t].length === 1) ? tokens.join('') : tokens.join(' ');
}

/**
 * A row of tape cells, each on its symbol's colour, the head's cell bright
 * and marked. Plain text draws `[x]` around the head.
 */
export function tapeCells(cells, head, { alphabet = [], blank = '⊔', from = 0 } = {}) {
  return cells.map((s, i) => {
    const sym = s === '' || s == null ? blank : String(s);
    const isHead = from + i === head;
    if (!styled) return isHead ? `[${sym}]` : ` ${sym} `;
    const col = symbolColour(sym, alphabet, blank);
    if (isHead) return `\x1b[1m${bg('#ffffff', PALETTE.ground)(` ${sym} `)}\x1b[22m`;
    return sym === blank ? c.faint(` ${sym} `) : bg(col, PALETTE.ground)(` ${sym} `);
  }).join(styled ? '' : '');
}

/** A state name as a pill: violet, green if accepting, amber if it is the current one. */
export function statePill(name, { current = false, accepting = false } = {}) {
  if (!styled) return current ? `(${name})` : ` ${name} `;
  if (current) return pill(name, accepting ? PALETTE.green : PALETTE.amber);
  return accepting ? c.green(`((${name}))`) : c.violet(` ${name} `);
}

/**
 * A word as a table shows it: whole when it fits, otherwise its two ends and
 * its length — a 200,000-symbol word would otherwise bury the verdict. The
 * --json output always carries the whole word.
 */
export function shortWord(w, max = 60) {
  const chars = [...String(w)];
  if (chars.length <= max) return String(w);
  return `${chars.slice(0, 32).join('')}…${chars.slice(-12).join('')} (${chars.length.toLocaleString('en-US')} symbols)`;
}
