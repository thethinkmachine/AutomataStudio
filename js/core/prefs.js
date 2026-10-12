// ══════════════════════════════════════════════════════════════════
//  PER-READER PREFERENCES
// ══════════════════════════════════════════════════════════════════
// A preference is a convenience — a collapsed section, the last view, a
// theme — kept in localStorage. localStorage can throw on any call: in a
// private window, with site data blocked, past its quota. None of that is
// worth an error, and a preference that cannot be read is simply its default,
// so every read and write goes through here rather than through its own
// `try { … } catch (e) { }` — there used to be twenty-odd of them.
//
// Import-free: modules read their preferences at module scope.

export function readPref(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function writePref(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* not kept: the default returns next time */ }
}

export function forgetPref(key) {
  try { localStorage.removeItem(key); } catch { /* nothing kept to forget */ }
}

/** A flag stored as '1' / '0'; anything else is `fallback`. */
export function readFlag(key, fallback = false) {
  const value = readPref(key);
  return value === '1' ? true : value === '0' ? false : fallback;
}

export function writeFlag(key, on) {
  writePref(key, on ? '1' : '0');
}

/** A stored JSON value, or `fallback` when it is missing or does not parse. */
export function readJsonPref(key, fallback = null) {
  const raw = readPref(key);
  if (raw === null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function writeJsonPref(key, value) {
  writePref(key, JSON.stringify(value));
}
