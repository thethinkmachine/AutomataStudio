// ══════════════════════════════════════════════════════════════════
//  EXERCISES — the section a student works in, the dialog an author uses
// ══════════════════════════════════════════════════════════════════
// The data lives in js/exercise/model.js and the grading in
// js/exercise/grade.js; this is the only DOM-bound module of the three.
//
// Two surfaces:
//
//   #rp-exercise    A right-panel section, first in the stack and shown only
//                   when the tab carries an exercise. It is a section rather
//                   than a card over the canvas because it belongs beside the
//                   run box: the counterexample it reports is a word you are
//                   meant to run. Being a section also gives it collapse,
//                   reorder and tear-off from the registry for nothing.
//
//   #exercise-modal The author's dialog, opened from the More menu. The
//                   machine (or grammar) on screen becomes the sealed
//                   reference, and the result is a *document* — a blank
//                   workspace with Σ set and the exercise attached — which can
//                   be opened here to try, downloaded as .automaton, or copied
//                   as a share link. Opening an exercise is opening a file;
//                   there is no second format and no server.
//
// Nothing here is reached from an on* attribute — every listener is attached
// at creation — so this module adds nothing to js/bridge.js.

import { exportDownload } from './export-core.js';
import { EXERCISE_LIMITS, normalizeExercise, sealTarget, unsealTarget } from './exercise/model.js';
import {
  defaultAllowFor, grammarDecider, gradeExercise, grammarTargetFromApp, listTypes, machineIsGradable,
  machineTargetFromApp, recordAttempt, wordText
} from './exercise/grade.js';
import { showExampleCard } from './machine-card.js';
import { renderMarkdown } from './markdown.js';
import { closeModal, registerModal, showOverlay } from './modal.js';
import { SCHEMA_VERSION, WORKSPACE_FORMAT, copyLinkToClipboard, getWorkspaceData, loadData, shareLinkFor } from './persistence.js';
import { runSim } from './simulation.js';
import { $, App, MachineCategories, activeWorkspaceId, getMachineConfig } from './state.js';
import { Change, emit, subscribe } from './store.js';
import { createTab, revealPanel, setRPSectionCollapsed } from './ui.js';
import { showStatus } from './utils.js';
import { hideMoreMenu, setView } from './view.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function button(label, cls, onClick) {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

const typeLabel = m => getMachineConfig(m)?.label || m;

// ══════════════════════════════════════════════════════════════════
//  THE STUDENT'S SIDE
// ══════════════════════════════════════════════════════════════════

// The last grading result, for this tab and this exercise only. Session state:
// the persisted record is `progress.last`, which says how the last attempt
// went but not the counterexample — a word the student has since fixed their
// machine for would be a stale accusation on reopening the file.
let lastResult = null;
// Two-step confirmations, so neither needs a dialog of its own.
let armed = null;

function currentResult() {
  const ex = App.exercise;
  if (!lastResult || !ex || lastResult.id !== ex.id || lastResult.ws !== activeWorkspaceId) return null;
  return lastResult.result;
}

function quoteWord(tokens) { return `“${wordText(tokens)}”`; }

function outputText(o) { return o == null || o === '' ? 'nothing' : `“${Array.isArray(o) ? o.join('') : o}”`; }

const capital = s => s[0].toUpperCase() + s.slice(1);

/** A grading result → what the section says. Exported for the tests. */
export function describeResult(result, ex) {
  const whose = ex.answer === 'grammar' ? 'your grammar' : 'your machine';
  const does = v => (ex.answer === 'grammar'
    ? (v === 'acc' ? 'generates it' : 'does not generate it')
    : (v === 'acc' ? 'accepts it' : 'rejects it'));
  const should = v => (v === 'acc' ? 'should be accepted' : 'should be rejected');
  switch (result.status) {
    case 'correct':
      return {
        tone: 'ok', headline: 'Correct.',
        detail: [`${capital(whose)} and the reference accept exactly the same language. This was proved by comparing the two automata state by state, not by testing words.`]
      };
    case 'passed': {
      const c = result.checked;
      const span = c.truncated
        ? `the first ${c.words.toLocaleString()} words in length order (every word up to length ${c.completeLength})`
        : `all ${c.words.toLocaleString()} words up to length ${c.completeLength}`;
      return {
        tone: 'ok', headline: 'Passes every test.',
        detail: [`${capital(whose)} agrees with the reference on ${span}. Equivalence cannot be decided in general for this kind of machine, so this is as far as a check can go.`]
      };
    }
    case 'incorrect': {
      const { tokens, expected, got } = result.counterexample;
      const w = quoteWord(tokens);
      const headline = expected.verdict === got.verdict
        ? `Not yet: on ${w} the output should be ${outputText(expected.output)}, but ${whose} gives ${outputText(got.output)}.`
        : `Not yet: ${w} ${should(expected.verdict)}, but ${whose} ${does(got.verdict)}.`;
      const how = result.method === 'exact'
        ? 'No shorter word tells the two apart.'
        : 'It is the first word, in length order, on which the two differ.';
      return { tone: 'fail', headline, detail: [how], word: ex.answer === 'machine' ? tokens : null };
    }
    case 'inconclusive': {
      const { tokens, expected } = result.counterexample;
      return {
        tone: 'warn',
        headline: `No verdict: ${whose} was still running on ${quoteWord(tokens)} when the step budget ran out. The reference ${expected.verdict === 'acc' ? 'accepts' : 'rejects'} it.`,
        detail: ['Every other word checked agreed. A machine that runs forever on a word does not accept it — is there a loop that should halt?'],
        word: ex.answer === 'machine' ? tokens : null
      };
    }
    default:
      return { tone: 'warn', headline: 'This answer can’t be checked yet.', detail: result.problems || [] };
  }
}

function rulesOf(ex, target) {
  const out = [];
  if (ex.answer === 'grammar') out.push('Answer with a context-free grammar in the Grammar view');
  else if (ex.allow.length) out.push(`Answer with a ${listTypes(ex.allow)}`);
  if (ex.maxStates != null && ex.answer === 'machine') out.push(`At most ${ex.maxStates} state${ex.maxStates === 1 ? '' : 's'}`);
  const sigma = target?.sigma || [];
  if (sigma.length) out.push(`Σ = {${sigma.join(', ')}}`);
  if (target?.kind === 'machine' && getMachineConfig(target.machine).isTransducer) out.push('The output is checked, not only the verdict');
  return out;
}

/** Draw #rp-exercise from App.exercise. Subscribed to Change.EXERCISE. */
export function renderExerciseSection() {
  const sec = $('rp-exercise');
  const body = $('exercise-body');
  if (!sec || !body) return;
  const ex = App.exercise;
  sec.style.display = ex ? '' : 'none';
  body.innerHTML = '';   // clearing only
  if (!ex) return;

  let target = null;
  try { target = unsealTarget(ex.target); } catch { /* reported below */ }

  const head = el('div', 'ex-head');
  head.append(el('span', 'ex-title', ex.title));
  if (ex.progress.solved) head.append(el('span', 'ex-badge is-solved', 'Solved'));
  body.append(head);

  if (ex.prompt) {
    const prompt = el('div', 'ex-prompt');
    renderMarkdown(ex.prompt, prompt);
    body.append(prompt);
  }

  const rules = el('ul', 'ex-rules');
  rulesOf(ex, target).forEach(r => rules.append(el('li', null, r)));
  if (rules.children.length) body.append(rules);

  if (!target) {
    body.append(el('div', 'ex-result is-warn', 'This exercise’s reference could not be read, so answers cannot be checked.'));
    return;
  }

  const actions = el('div', 'ex-actions');
  const check = button(ex.answer === 'grammar' ? 'Check grammar' : 'Check answer', 'run-btn ex-check', () => runCheck(check));
  actions.append(check);
  if (ex.progress.attempts) {
    actions.append(el('span', 'ex-attempts', `${ex.progress.attempts} attempt${ex.progress.attempts === 1 ? '' : 's'}`));
  }
  body.append(actions);

  const result = currentResult();
  const live = el('div', 'ex-result-wrap');
  live.setAttribute('aria-live', 'polite');
  if (result) live.append(resultNode(result, ex));
  body.append(live);

  if (ex.hints.length) {
    const hints = el('div', 'ex-hints');
    ex.hints.slice(0, ex.progress.hintsShown).forEach((h, i) => {
      const row = el('div', 'ex-hint');
      row.append(el('span', 'ex-hint-n', `Hint ${i + 1}`), el('span', 'ex-hint-text', h));
      hints.append(row);
    });
    if (ex.progress.hintsShown < ex.hints.length) {
      hints.append(button(`Show a hint (${ex.progress.hintsShown + 1} of ${ex.hints.length})`, 'ex-link', showHint));
    }
    body.append(hints);
  }

  const foot = el('div', 'ex-foot');
  if (ex.reveal) {
    foot.append(button(armed === 'reveal' ? 'Open the reference answer?' : 'Show a solution', `ex-link${armed === 'reveal' ? ' is-armed' : ''}`, revealSolution));
  }
  foot.append(button(armed === 'leave' ? 'Remove the exercise from this tab?' : 'Leave exercise', `ex-link ex-link-quiet${armed === 'leave' ? ' is-armed' : ''}`, leaveExercise));
  body.append(foot);
}

function resultNode(result, ex) {
  const d = describeResult(result, ex);
  const box = el('div', `ex-result is-${d.tone}`);
  box.append(el('div', 'ex-result-head', d.headline));
  d.detail.forEach(t => box.append(el('div', 'ex-result-detail', t)));
  (result.notes || []).forEach(t => box.append(el('div', 'ex-result-note', t)));
  if (d.word) box.append(button('Run this word', 'ex-link', () => runWord(d.word)));
  return box;
}

/** Grade the answer on screen now. Exported for the tests; the button defers it a tick. */
export function checkExerciseNow() {
  const ex = App.exercise;
  if (!ex) return null;
  let result;
  try {
    const answer = ex.answer === 'grammar' ? grammarTargetFromApp() : machineTargetFromApp();
    result = gradeExercise(ex, answer);
  } catch (e) {
    console.error(e);
    result = { status: 'invalid', method: null, problems: [`The check failed: ${e.message}`], notes: [] };
  }
  lastResult = { id: ex.id, ws: activeWorkspaceId, result };
  // An answer that could not be graded is not an attempt.
  if (result.status !== 'invalid' && App.exercise) {
    App.exercise = { ...App.exercise, progress: recordAttempt(App.exercise.progress, result) };
  }
  emit(Change.EXERCISE);
  if (result.status === 'correct' || result.status === 'passed') showStatus('Exercise solved!');
  return result;
}

function runCheck(btn) {
  if (!App.exercise) return;
  armed = null;
  btn.disabled = true;
  btn.classList.add('is-busy');
  btn.textContent = 'Checking…';
  // A tick first, so the busy state paints before a bounded check of a Turing
  // machine takes its second.
  setTimeout(checkExerciseNow, 0);
}

function runWord(tokens) {
  setView('build');
  const input = $('sim-in');
  if (input) input.value = wordText(tokens);
  runSim();
}

function showHint() {
  const ex = App.exercise;
  if (!ex) return;
  armed = null;
  App.exercise = { ...ex, progress: { ...ex.progress, hintsShown: Math.min(ex.hints.length, ex.progress.hintsShown + 1) } };
  emit(Change.EXERCISE);
}

function revealSolution() {
  const ex = App.exercise;
  if (!ex) return;
  if (armed !== 'reveal') { armed = 'reveal'; renderExerciseSection(); return; }
  armed = null;
  let target;
  try { target = unsealTarget(ex.target); } catch { return; }
  createTab(`Solution: ${ex.title}`.slice(0, 60));
  loadData(targetDocument(target));
  showExampleCard(null);
  showStatus('The reference answer is open in a new tab.');
}

function leaveExercise() {
  if (armed !== 'leave') { armed = 'leave'; renderExerciseSection(); return; }
  armed = null;
  lastResult = null;
  App.exercise = null;
  emit(Change.EXERCISE);
  showStatus('Exercise removed from this tab. Reopen the file or link to get it back.');
}

// A target shape → a workspace document, for "show a solution".
function targetDocument(target) {
  const base = { format: WORKSPACE_FORMAT, schema: SCHEMA_VERSION, config: getWorkspaceData().config };
  if (target.kind === 'grammar') {
    return { ...base, machine: App.machine, sigma: target.sigma, states: [], transitions: [], accepts: [], grammar: target.grammar };
  }
  const { kind, config, ...m } = target;
  return { ...base, ...m, config: { ...base.config, ...(config || {}) } };
}

// A document that arrives carrying an exercise — a file, a link, a tab
// switched to — opens with the task in view rather than behind a collapsed
// header. Once per exercise, so collapsing it by hand sticks.
let shownFor = null;
subscribe(Change.EXERCISE, () => {
  // A half-made decision does not survive the exercise it was about.
  if (armed && !App.exercise) armed = null;
  renderExerciseSection();
  const id = App.exercise?.id || null;
  if (id && id !== shownFor) revealExerciseSection();
  shownFor = id;
});

/** Bring the section into view: panel shown, section expanded. */
export function revealExerciseSection() {
  revealPanel('rpanel');
  setRPSectionCollapsed('rp-exercise', false, false);
}

// ══════════════════════════════════════════════════════════════════
//  THE AUTHOR'S SIDE
// ══════════════════════════════════════════════════════════════════

const draft = {
  title: '', prompt: '', source: 'machine', answer: 'machine',
  allow: new Set(), maxStates: '', maxLength: EXERCISE_LIMITS.maxLengthDefault, hints: '', reveal: false
};

registerModal('exercise-modal', {
  dismissOnBackdrop: false,
  initialFocus: '#ex-f-title',
  submit: () => { if (!draftProblem()) openDraftHere(); }
});

function grammarUsable() {
  if (!(App.grammar.productions || []).length) return 'The Grammar view has no rules.';
  const d = grammarDecider(grammarTargetFromApp().grammar);
  return d.ok ? null : d.error;
}

function machineUsable() {
  if (!App.states.length) return 'The canvas is empty.';
  if (!machineIsGradable(App.machine)) return `A ${typeLabel(App.machine)} does not read finite words, so it cannot be an exercise yet.`;
  if (!App.startId) return 'The machine has no start state.';
  return null;
}

/** Why the draft cannot be published yet, or null. */
function draftProblem() {
  const src = draft.source === 'grammar' ? grammarUsable() : machineUsable();
  if (src) return src;
  if (draft.answer === 'machine' && !draft.allow.size) return 'Pick at least one machine type a student may answer with.';
  return null;
}

export function openExerciseAuthor() {
  hideMoreMenu();
  const machineOk = !machineUsable();
  const grammarOk = !grammarUsable();
  if (!machineOk && !grammarOk) {
    showStatus(`Build the reference answer first. ${machineUsable()}`);
    return;
  }
  draft.title = App.meta?.title || '';
  // Deliberately not the machine's description: that says how the machine
  // works — "each state remembers the remainder" — which is the answer.
  draft.prompt = '';
  draft.source = machineOk ? 'machine' : 'grammar';
  draft.answer = 'machine';
  draft.allow = new Set(machineOk ? defaultAllowFor(App.machine) : ['NPDA', 'DPDA']);
  draft.maxStates = '';
  draft.maxLength = EXERCISE_LIMITS.maxLengthDefault;
  draft.hints = '';
  draft.reveal = false;
  renderAuthor();
  showOverlay('exercise-modal');
}

function field(label, control, hint) {
  const wrap = el('div', 'ex-field');
  wrap.append(el('span', 'ex-field-label', label), control);
  if (hint) wrap.append(el('span', 'ex-field-hint', hint));
  return wrap;
}

function radioRow(name, options, value, onPick) {
  const row = el('div', 'ex-radio-row');
  row.setAttribute('role', 'radiogroup');
  options.forEach(([v, label, disabledWhy]) => {
    const lab = el('label', 'ex-radio');
    const input = el('input');
    input.type = 'radio';
    input.name = name;
    input.value = v;
    input.checked = v === value;
    input.disabled = !!disabledWhy;
    input.addEventListener('change', () => onPick(v));
    lab.append(input, el('span', null, label));
    if (disabledWhy) lab.title = disabledWhy;
    row.append(lab);
  });
  return row;
}

function renderAuthor() {
  const body = $('exercise-modal-body');
  const foot = $('exercise-modal-foot');
  if (!body || !foot) return;
  body.innerHTML = '';   // clearing only
  foot.innerHTML = '';

  const title = el('input', 'inp');
  title.id = 'ex-f-title';
  title.maxLength = EXERCISE_LIMITS.titleMax;
  title.placeholder = 'e.g. Binary multiples of 3';
  title.setAttribute('aria-label', 'Title');
  title.value = draft.title;
  title.addEventListener('input', () => { draft.title = title.value; });
  body.append(field('Title', title));

  const prompt = el('textarea', 'inp ex-textarea');
  prompt.maxLength = EXERCISE_LIMITS.promptMax;
  prompt.rows = 4;
  prompt.placeholder = 'What should the student build? Markdown works.';
  prompt.setAttribute('aria-label', 'Task');
  prompt.value = draft.prompt;
  prompt.addEventListener('input', () => { draft.prompt = prompt.value; });
  body.append(field('Task', prompt));

  body.append(field('Reference answer', radioRow('ex-source', [
    ['machine', `The ${typeLabel(App.machine)} on the canvas`, machineUsable()],
    ['grammar', 'The grammar in the Grammar view', grammarUsable()]
  ], draft.source, v => { draft.source = v; renderAuthor(); }),
  'Hidden from the student. It is what every answer is compared against.'));

  body.append(field('The student answers with', radioRow('ex-answer', [
    ['machine', 'A machine'],
    ['grammar', 'A context-free grammar']
  ], draft.answer, v => { draft.answer = v; renderAuthor(); })));

  if (draft.answer === 'machine') {
    const chips = el('div', 'ex-type-chips');
    MachineCategories.forEach(cat => {
      const types = cat.machines.filter(machineIsGradable);
      if (!types.length) return;
      const group = el('div', 'ex-type-group');
      group.append(el('span', 'ex-type-cat', cat.label));
      types.forEach(m => {
        const on = draft.allow.has(m);
        const chip = button(typeLabel(m), `ex-chip${on ? ' is-on' : ''}`, () => {
          if (draft.allow.has(m)) draft.allow.delete(m); else draft.allow.add(m);
          renderAuthor();
        });
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        group.append(chip);
      });
      chips.append(group);
    });
    body.append(field('Allowed machine types', chips));

    const maxStates = el('input', 'inp ex-num');
    maxStates.type = 'number';
    maxStates.min = '1';
    maxStates.placeholder = 'No limit';
    maxStates.setAttribute('aria-label', 'Most states allowed');
    maxStates.value = draft.maxStates;
    maxStates.addEventListener('input', () => { draft.maxStates = maxStates.value; });
    body.append(field('Most states allowed', maxStates, 'Set it to the minimal DFA’s size to ask for the minimal machine.'));
  }

  const len = el('input', 'inp ex-num');
  len.type = 'number';
  len.min = '1';
  len.max = String(EXERCISE_LIMITS.maxLengthCap);
  len.setAttribute('aria-label', 'Check words up to length');
  len.value = String(draft.maxLength);
  len.addEventListener('input', () => { draft.maxLength = len.value; });
  body.append(field('Check words up to length', len,
    'Two finite automata are compared exactly. Anything else (a PDA, a Turing machine, a grammar, a transducer) is checked on every word up to this length.'));

  const hints = el('textarea', 'inp ex-textarea');
  hints.rows = 3;
  hints.placeholder = 'One hint per line, revealed one at a time.';
  hints.setAttribute('aria-label', 'Hints');
  hints.value = draft.hints;
  hints.addEventListener('input', () => { draft.hints = hints.value; });
  body.append(field('Hints', hints));

  const revealLab = el('label', 'ex-check-row');
  const reveal = el('input');
  reveal.type = 'checkbox';
  reveal.checked = draft.reveal;
  reveal.addEventListener('change', () => { draft.reveal = reveal.checked; });
  revealLab.append(reveal, el('span', null, 'Let students open the reference answer'));
  body.append(revealLab);

  body.append(el('p', 'ex-fine-print',
    'The reference travels inside the file, scrambled so it cannot be read at a glance. It is not encrypted: this is for practice and homework, not for an exam.'));

  const problem = draftProblem();
  if (problem) body.append(el('div', 'ex-result is-warn', problem));

  const cancel = button('Cancel', 'btn-g modal-foot-start', () => closeModal('exercise-modal'));
  const link = button('Copy link', 'btn-g', () => {
    if (draftProblem()) return;
    copyLinkToClipboard(shareLinkFor(draftDocument()), 'Exercise link copied. Whoever opens it gets the task, not the answer.');
  });
  const download = button('Download', 'btn-g', () => {
    if (draftProblem()) return;
    const doc = draftDocument();
    exportDownload(`${slug(doc.exercise.title)}.automaton`, JSON.stringify(doc, null, 2), 'application/json');
    showStatus('Exercise file downloaded.');
  });
  const open = button('Open as exercise', 'btn-p', openDraftHere);
  [link, download, open].forEach(b => { b.disabled = !!problem; });
  foot.append(cancel, link, download, open);
}

function slug(s) {
  return String(s || 'exercise').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'exercise';
}

/** Set the author's draft directly — for the tests. */
export function setExerciseDraft(values) {
  Object.assign(draft, values);
  if (values.allow) draft.allow = new Set(values.allow);
}

function draftExercise() {
  const target = draft.source === 'grammar' ? grammarTargetFromApp() : machineTargetFromApp();
  const allow = draft.answer === 'machine' ? [...draft.allow] : [];
  return {
    target,
    exercise: normalizeExercise({
      id: `ex-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      title: draft.title.trim() || 'Exercise',
      prompt: draft.prompt.trim(),
      target: sealTarget(target),
      answer: draft.answer,
      allow,
      maxStates: draft.answer === 'machine' ? draft.maxStates : null,
      maxLength: draft.maxLength,
      hints: String(draft.hints || '').split('\n').map(h => h.trim()).filter(Boolean),
      reveal: draft.reveal
    })
  };
}

/**
 * The document a student opens: the author's settings, a blank canvas of a
 * type the exercise allows, Σ (and Δ for a transducer) set, and nothing else —
 * no grammar, no notes, no description, since any of those could be the
 * answer written down.
 */
export function draftDocument() {
  const { target, exercise } = draftExercise();
  const base = getWorkspaceData();
  const starter = exercise.allow.includes(App.machine) ? App.machine : (exercise.allow[0] || App.machine);
  const transducer = target.kind === 'machine' && getMachineConfig(target.machine).isTransducer;
  return {
    format: base.format, schema: base.schema, app: base.app,
    machine: starter,
    config: base.config,
    sigma: [...target.sigma],
    stackAlpha: [App.config.sym.stackBottom],
    outputAlpha: transducer ? [...(target.outputAlpha || [])] : base.outputAlpha,
    tapeCount: base.tapeCount,
    states: [], transitions: [], startId: null, accepts: [],
    notes: [], dividers: [], blocks: [], scope: [],
    grammar: { vars: ['S'], start: 'S', productions: [] },
    cam: { x: 0, y: 0, z: 1 },
    meta: null,
    exercise
  };
}

function openDraftHere() {
  if (draftProblem()) return;
  const doc = draftDocument();
  closeModal('exercise-modal');
  createTab(doc.exercise.title.slice(0, 60));
  loadData(doc);
  // As applyDocument does after a load: the card is retargeted, not left
  // open over a canvas it no longer describes.
  showExampleCard(null);
  showStatus('Opened in a new tab. This is what a student sees.');
}

const menuItem = $('menu-exercise-create');
menuItem?.addEventListener('click', openExerciseAuthor);
menuItem?.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openExerciseAuthor(); }
});
