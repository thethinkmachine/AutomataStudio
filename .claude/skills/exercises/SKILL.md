---
name: exercises
description: AutomataStudio: exercises and the lexer generator - the exercise document, sealing the reference, exact vs bounded grading, the right-panel Exercise section and the Create Exercise dialog; and the lexer generator's pattern language, construction, diagnostics, code emitters and its Algorithms page. Read before touching js/exercise/, js/exercise-ui.js, js/lexer/ or js/lexer-ui.js.
---

### Exercises

**An exercise is a task attached to a workspace, and it rides in the workspace document** as the optional `exercise` field. A file, a share link, a PNG payload and a tab all carry it with no second format, so *opening an exercise is opening a document*: the student's copy is a blank workspace with Σ set and the exercise attached, and every existing way in — Open, a drop, a link, a double-click — already works for it. There is no server.

```
js/exercise/
  model.js      import-free. The shape, normalizeExercise/validateExercise,
                sealTarget/unsealTarget.
  grade.js      DOM-free. The reference as data, withMachine, the two
                grading methods, recordAttempt.
js/exercise-ui.js   the #rp-exercise section and the #exercise-modal dialog.
```

**The reference is sealed, not secret.** `sealTarget` XORs and base64s it so a student opening the `.automaton` in an editor does not read the answer off the first screen. It is not encryption and says so in the dialog: everything grading needs runs in the browser, so what the grader can read a determined student can too. An exam that must be tamper-proof needs a server.

**Two grading methods, and the result always names which one answered**, because they make different claims:

- **exact** — both sides are DFA / NFA / ε-NFA. The product of their subset constructions is explored breadth-first, so the verdict is a proof and a disagreement comes with a *shortest* distinguishing word. `subsetSide` reproduces the simulators' semantics (a DFA prefers an explicit symbol over the Σ wildcard, an NFA takes every match and closes under ε), and [tests/exercise.test.js](../../../tests/exercise.test.js) checks that against `decideWord` word by word. Past `EXACT_PAIR_CAP` it falls back to bounded and says so.
- **bounded** — everything else (PDAs, TMs, transducers, grammars). Σ\* is enumerated in shortlex order up to `maxLength`, capped at `maxWords`, and both sides decide every word. Shortlex is what makes the first disagreement a shortest one. A pass is reported as `passed` with the exact span checked, never as `correct`. A word the *reference* cannot decide is skipped and counted; a word only the *answer* cannot decide makes the result `inconclusive`, not a pass.

**A transducer's output is compared whatever its verdict.** A Mealy or Moore machine usually has no F, so every run "rejects", and a comparison gated on acceptance would pass any machine of the right shape. That exact bug was in the first draft and the Mealy test caught it.

**Deciding the reference borrows `App`.** The machine layer reads `App`, so `withMachine(target, fn)` swaps the reference in and restores in a `finally` — `parallel/snapshot.js`'s hydrate, made reversible. It is safe on the main thread because assigning a Set field replaces the `ReactiveSet` behind the accessor **without notifying** (see `installReactiveSetField`), so no memo recomputes against the borrowed machine, and nothing inside emits. A grammar is read the same way: `grammarModelOf` borrows `App.grammar` for one `readGrammar()` call so the tokenizer rules are not re-implemented. Grammars must be context-free; CNF is computed once per check and CYK decides each word.

**What an exercise survives, and why.** It is document content, so it is in `getWorkspaceData` (only when present — a workspace without one saves exactly the file it always did), `exportWorkspaceState`/`importWorkspaceState`, `blankWorkspaceData` and `loadData`. It is deliberately **not on the undo stack**: undo takes back an edit to the answer, and taking back "Check" would hand the attempt back. For the same reason StateMate's `restoreCheckpoint` carries the current exercise across, and `resetWorkspace` (Clear) and `loadExampleFile` keep it — the exercise is what the tab is *for*, the machine is the answer. `workspaceIsUntouched` counts it as content, so opening a file never reads over a task.

**`Change.EXERCISE` is its own kind** for the reasons `META` is: persisted, so it dirties the tab; not the machine, so writing progress must not redraw the diagram it just graded. Every rehydrate path announces it, next to `META` and `GRAMMAR`.

**The student document leaks nothing that could be the answer**: no states, no grammar, no notes, no card, Γ reset to the stack bottom. Δ is kept for a transducer, since the output alphabet is part of the task. The dialog does not pre-fill the task from `App.meta.blurb` for the same reason — a machine's description says how it works.

The section and the dialog attach every listener at creation, so neither adds a name to `bridge.js`. The menu item `#menu-exercise-create` is wired from the module. The last grading result is session state keyed on exercise id *and* tab: the persisted `progress.last` records how an attempt went but not the counterexample, which would be a stale accusation on reopening a file the student has since fixed.

**StateMate follows the exercise, per tab.** `exercise.assist` is `off` (the default), `tutor` or `on`, and `assistPolicy(App.exercise)` in model.js is the one reading of it — `'on'` when the tab has no exercise. It is enforced in the pipeline, not the console, because the console is only one of the routes in:

- **`runStateMate` refuses `off` before anything is sent**, so the composer, ⌘K, "ask about this selection", a retry, a branch and an agentic resume are all covered by one line. The console refuses earlier as well, the way it refuses an unconfigured provider, only so the sentence stays on screen.
- **`tutor` forces `ask` and withholds the agentic tools.** Several tools build (`minimize_dfa`, `replace_candidate_from_spec`), and a finished private candidate is a solution whether or not it is drawn. `buildUserMessage` puts a tutoring block where the ask-mode block would go — *instead of* it, because ask mode invites the model to describe the machine it would build, which for a student is the answer in prose. A `machine` answer is thrown out as `exercise-tutor` before compile, so no diff, title or state count reaches the card or the thread.
- **`applyPending` refuses while a restricted exercise is open**, which covers a proposal held from before the tab became an exercise. `applyCandidate` itself is not gated: the wizard uses it, and the wizard is an editor, not an assistant.
- The console's authority chip is replaced by what the tab allows while an exercise restricts it — cycling a setting the run will ignore would be a control that lies — and `offerBuild` is suppressed.

The prompt half of `tutor` can only be asked for; what is enforced is that nothing is built, drawn or kept. The whole policy is client-side, like the sealed reference: a student can leave the exercise, or copy their machine into a tab that has none. It keeps an honest student honest, which is what a worksheet needs.

[tests/exercise.test.js](../../../tests/exercise.test.js) pins the grader; [tests/exercise-statemate.test.js](../../../tests/exercise-statemate.test.js) pins the StateMate policy through `runStateMate` and `applyPending` themselves; [tests/exercise-ui.test.js](../../../tests/exercise-ui.test.js) pins the document (no leak, validates), the section's messages, and what survives save / tab / Clear.

### The lexer generator

**Regular expressions in, one minimal DFA, a tokenizer out** — the constructions the Algorithms view teaches, run to their practical end. It lives on the Algorithms view as *Lexer Generator* (`data-algo="lexer"`, group "Engineering").

```
js/lexer/
  regex.js   import-free. The pattern language → AST.
  build.js   import-free but for regex.js. Spec → NFA → classes → DFA →
             minimal DFA; runLexer; lexerToMachine.
  emit.js    tables + maximal-munch driver, as JS / Python / C.
js/lexer-ui.js   the page.
```

**It has its own pattern parser, and not `parseRE`.** That one reads the textbook notation over Σ — no escapes, `.` meaning a symbol of the alphabet — which is right for drawing Thompson's construction and wrong for a lexer, whose rules are about characters (`\(`, `\n`, `\d`, `[^"\\]`). Growing escapes into the textbook parser would change what an existing regex means in the Algorithms view. Anchors, lazy quantifiers, backreferences and lookaround are refused, each with a sentence saying why it has no meaning here.

**Characters are cut into classes before the subset construction**, so the DFA has a column per class rather than per character: characters no pattern tells apart share one. The universe is ASCII plus any non-ASCII character a rule names literally; `.` and negated classes resolve against it.

**"Earlier rule wins" is decided at build time**: a DFA state accepts the lowest-numbered rule among the NFA finals it contains, and minimization starts from the partition by token so states accepting different tokens are never merged. Longest match is the driver's job at run time. Two diagnostics come out of this for free and are the two most common lexer bugs: a rule that matches ε is **refused** (the lexer would emit zero-length tokens forever), and a rule that never wins any state is **warned about** by name, with the rules that shadow it (IDENT above the keywords).

**The page's tokenizer and the generated code are the same program.** `runLexer` in build.js is the driver every emitter writes out. [tests/lexer.test.js](../../../tests/lexer.test.js) runs the JavaScript output in a vm, and the Python and C outputs where `python3` / `cc` exist, and compares token streams — including the error position.

**Σ labels for classes must be enterable again**, so `lexerToMachine` escapes whitespace and commas (Σ is typed as a whitespace/comma-separated list) and draws a class covering most of the universe as the complement of what it lacks. "Load DFA onto canvas" opens a **new tab** with a copy of the rules: the DFA has nothing to do with the tab's machine, which may be a student's answer.

`App.lexer` stays **null until the reader edits something**, so opening the page to look does not turn a workspace into one that carries a lexer; the page reads defaults instead. It follows the grammar workbench's rule for re-rendering on keystrokes: the frame is built once and only the results are replaced, and fields are written back only when a tab switch or a load made them disagree with `App.lexer`.
