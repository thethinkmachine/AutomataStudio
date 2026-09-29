// Terminal output: colour when it is a terminal and NO_COLOR is unset, plain
// text otherwise, and aligned tables. JSON output bypasses all of it.

const tty = !!process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
const wrap = (open, close) => s => (tty ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  cyan: wrap(36, 39),
  magenta: wrap(35, 39)
};

export const isTTY = tty;

export function print(...parts) {
  process.stdout.write(parts.join(' ') + '\n');
}

export function printJson(value) {
  process.stdout.write(JSON.stringify(value, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n');
}

export function warn(msg) {
  process.stderr.write(`${c.yellow('warning:')} ${msg}\n`);
}

/** The verdict words the CLI prints, coloured by meaning. */
export function verdictWord(v) {
  if (v === 'acc' || v === 'accept') return c.green('accept');
  if (v === 'rej' || v === 'reject') return c.red('reject');
  if (v === 'err' || v === 'error') return c.magenta('error');
  return c.yellow('unknown');
}

const visible = s => String(s).replace(/\x1b\[[0-9;]*m/g, '');

/** Rows of cells → aligned columns. The last column is not padded. */
export function table(rows, { head = null, gap = 2 } = {}) {
  const all = head ? [head.map(h => c.bold(h)), ...rows] : rows;
  if (!all.length) return '';
  const width = [];
  for (const r of all) r.forEach((cell, i) => { width[i] = Math.max(width[i] || 0, [...visible(cell)].length); });
  return all.map(r => r.map((cell, i) => (i === r.length - 1 ? String(cell) : String(cell) + ' '.repeat(width[i] - [...visible(cell)].length + gap))).join('')).join('\n');
}

/** A word's tokens as a reader would type them, with ε for the empty word. */
export function wordOf(tokens, eps = 'ε') {
  if (!tokens || !tokens.length) return eps;
  return tokens.every(t => [...t].length === 1) ? tokens.join('') : tokens.join(' ');
}
