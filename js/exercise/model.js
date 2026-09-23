// ══════════════════════════════════════════════════════════════════
//  AN EXERCISE — what it is, as data
// ══════════════════════════════════════════════════════════════════
// An exercise is a task attached to a workspace: a prompt, a hidden
// reference (a machine or a grammar), and the rules an answer has to
// follow. It rides in the workspace document as the optional `exercise`
// field, so a file, a share link, a PNG payload and a tab all carry it
// with no second format — opening an exercise is opening a document.
//
// Import-free, like js/machines/registry.js: the persistence layer, the
// grader and the card all read this shape, and a leaf is what keeps every
// one of them free to import it.
//
// **The reference is sealed, not secret.** It is XORed and base64'd so a
// student opening the .automaton in a text editor does not read the answer
// off the first screen. It is not encryption and does not pretend to be:
// everything needed to grade runs in the browser, so anything the grader can
// read, a determined student can too. An exam that has to be tamper-proof
// needs a server; this is a worksheet.

export const EXERCISE_VERSION = 1;

// How much StateMate may help while this exercise is the tab's task.
//
//   off    StateMate refuses in the tab.
//   tutor  It may answer questions, but it cannot build or edit a machine:
//          every turn is read-only, the agentic tools are withheld, the
//          prompt tells it to coach rather than solve, and a machine it
//          returns anyway is discarded unseen.
//   on     No restriction — the exercise is practice with an assistant.
//
// `off` is the default because it is the one an author cannot be surprised
// by: an exercise written before this setting existed reads as "work it out
// yourself", which is what it was written as.
export const EXERCISE_ASSIST = Object.freeze(['off', 'tutor', 'on']);

export const EXERCISE_LIMITS = {
  titleMax: 120,
  promptMax: 4000,
  hintsMax: 12,
  hintMax: 400,
  // Bounded checking enumerates Σ* in shortlex order. The length is the
  // author's promise ("every word up to 8"); the word cap is the app's, so a
  // five-letter alphabet cannot turn a click into a minute of Turing machine.
  maxLengthDefault: 8,
  maxLengthCap: 16,
  maxWordsDefault: 5000,
  maxWordsCap: 50000
};

const SEAL_PREFIX = 'x1.';
const SEAL_KEY = 'automata-studio/exercise';

function xorBytes(bytes) {
  const key = new TextEncoder().encode(SEAL_KEY);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ key[i % key.length];
  return out;
}

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The reference, as the string that sits in the document. */
export function sealTarget(target) {
  const bytes = new TextEncoder().encode(JSON.stringify(target));
  return SEAL_PREFIX + bytesToB64(xorBytes(bytes));
}

/** The inverse. Throws on anything that is not a sealed reference. */
export function unsealTarget(sealed) {
  if (typeof sealed !== 'string' || !sealed.startsWith(SEAL_PREFIX)) {
    throw new Error('the exercise reference is not in a format this build can read');
  }
  const raw = atob(sealed.slice(SEAL_PREFIX.length));
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(xorBytes(bytes)));
}

function clampInt(v, lo, hi, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** The student's side: what has happened on this exercise so far. */
export function blankProgress() {
  return { attempts: 0, hintsShown: 0, solved: false, solvedAt: null, last: null };
}

/**
 * Anything → a well-formed exercise, or null when there is none.
 *
 * Tolerant in the way every reader in persistence.js is tolerant: a missing
 * optional field takes its default. The two fields without a default — the
 * sealed reference and what the answer is — are what `validateExercise`
 * refuses on, so a document that got past validation always normalizes.
 */
export function normalizeExercise(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.target !== 'string') return null;
  const L = EXERCISE_LIMITS;
  const progress = raw.progress && typeof raw.progress === 'object' ? raw.progress : {};
  return {
    version: EXERCISE_VERSION,
    id: str(raw.id, 64) || `ex-${Date.now().toString(36)}`,
    title: str(raw.title, L.titleMax) || 'Exercise',
    prompt: str(raw.prompt, L.promptMax),
    target: raw.target,
    answer: raw.answer === 'grammar' ? 'grammar' : 'machine',
    allow: Array.isArray(raw.allow) ? raw.allow.filter(m => typeof m === 'string').slice(0, 64) : [],
    maxStates: raw.maxStates == null || raw.maxStates === '' ? null : clampInt(raw.maxStates, 1, 10000, null),
    maxLength: clampInt(raw.maxLength, 0, L.maxLengthCap, L.maxLengthDefault),
    maxWords: clampInt(raw.maxWords, 1, L.maxWordsCap, L.maxWordsDefault),
    hints: Array.isArray(raw.hints)
      ? raw.hints.filter(h => typeof h === 'string' && h.trim()).map(h => h.slice(0, L.hintMax)).slice(0, L.hintsMax)
      : [],
    reveal: !!raw.reveal,
    assist: EXERCISE_ASSIST.includes(raw.assist) ? raw.assist : 'off',
    progress: {
      attempts: clampInt(progress.attempts, 0, 1e6, 0),
      hintsShown: clampInt(progress.hintsShown, 0, L.hintsMax, 0),
      solved: !!progress.solved,
      solvedAt: typeof progress.solvedAt === 'string' ? progress.solvedAt : null,
      last: progress.last && typeof progress.last === 'object' ? progress.last : null
    }
  };
}

/**
 * What StateMate may do in a tab holding `ex` — 'on' when there is no
 * exercise. One function, read by the pipeline and by the console, so the two
 * cannot disagree about which tab is restricted.
 */
export function assistPolicy(ex) {
  if (!ex) return 'on';
  return EXERCISE_ASSIST.includes(ex.assist) ? ex.assist : 'off';
}

/**
 * The shape check `validateSchema` runs on a document that carries one.
 * Throws a sentence naming the field, the way every other check there does.
 */
export function validateExercise(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error("'exercise' must be an object.");
  if (typeof raw.target !== 'string') throw new Error("'exercise.target' must be a sealed reference string.");
  let target;
  try { target = unsealTarget(raw.target); }
  catch (e) { throw new Error(`'exercise.target' could not be read: ${e.message}.`); }
  if (!target || (target.kind !== 'machine' && target.kind !== 'grammar')) {
    throw new Error("'exercise.target' must describe a machine or a grammar.");
  }
  if (raw.answer != null && raw.answer !== 'machine' && raw.answer !== 'grammar') {
    throw new Error("'exercise.answer' must be 'machine' or 'grammar'.");
  }
  if (raw.allow != null && !Array.isArray(raw.allow)) throw new Error("'exercise.allow' must be an array.");
  if (raw.hints != null && !Array.isArray(raw.hints)) throw new Error("'exercise.hints' must be an array.");
}
