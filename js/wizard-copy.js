// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Shreyan Chaubey. See LICENSE.
//
// ══════════════════════════════════════════════════════════════════
//  MACHINE WIZARD — WHAT THE QUESTIONS SAY
// ══════════════════════════════════════════════════════════════════
//  The wizard exists so that building a machine is a conversation rather
//  than a blank canvas, and this module is the half of it that talks. It is
//  data only: js/wizard.js decides *which* copy applies, js/wizard-ui.js
//  draws it, and neither of them contains a sentence.
//
//  Two rules for anything added here.
//
//  **A description says what the thing is, not what the field wants.**
//  "Enter your input alphabet" tells a reader who already knew the answer
//  that they were right. The person this feature is for does not know what
//  an alphabet is, and the question is their first chance to find out.
//
//  **Variants are keyed by flavour, never by machine name.** `states.stack`
//  is what every machine with a stack says; there is no `states.NPDA`. The
//  flavours are chosen in js/wizard.js from the capability flags in
//  MachineTypes, so a machine added to js/state.js inherits the right copy
//  without an edit here. A genuinely per-machine sentence — the queue's
//  "dequeue" for what every other store calls "pop" — lives in
//  FIELD_COPY_BY_MACHINE, which is deliberately small.
//
//  This module imports nothing and must stay that way.

// ──────────────────────────────────────────────────────────────────
//  STEPS
// ──────────────────────────────────────────────────────────────────
//  `short`       one or two words for the step rail — it has to fit a chip
//  `question`    the heading, in the second person, ending in a question mark
//  `description` one or two sentences of plain English underneath it
//  `examples`    optional, and clickable in the UI — a reader who cannot
//                start from nothing can start from one of these
//  `variants`    flavour → description, overriding the base description

export const STEP_COPY = {
  model: {
    short: 'Machine',
    question: 'What kind of machine do you want to build?',
    description: `Every model on this list reads a sequence of symbols and decides something about it. They differ in what they are allowed to remember while they read — nothing at all, one stack, a whole tape — and that is what decides which problems each one can solve.`
  },

  sigma: {
    short: 'Alphabet',
    question: 'What alphabet does your machine use?',
    description: `An alphabet is the vocabulary used to form input sequences for your automaton. Every word it reads is a sequence of these symbols and nothing else, so this is the first thing to pin down.`,
    examples: [
      { label: '0, 1', hint: 'bits' },
      { label: 'a, b, c, d', hint: 'letters' },
      { label: 'userClicksGetStarted, userSignsIn, userRegisters', hint: 'events' }
    ],
    variants: {
      tape: `An alphabet is the vocabulary used to form input sequences for your automaton. This is what may appear in the word you hand it — the machine gets its own, wider set of symbols to scribble with on the next screen.`,
      omega: `An alphabet is the vocabulary used to form input sequences for your automaton. This machine reads words that never end, so a word here is written as a beginning and then a part that repeats forever — but it is still built from these symbols.`
    }
  },

  gamma: {
    short: 'Stack',
    shortVariants: { tape: 'Tape', queue: 'Queue', counter: 'Counter', twoStack: 'Stacks' },
    question: 'What can your machine keep on its stack?',
    description: `A stack is scratch memory with one rule: you can only reach the thing you put down most recently. The stack alphabet is the set of symbols the machine is allowed to push onto it. It is a separate vocabulary from the input — Z sits at the bottom and is always there, so the machine can tell when the stack is empty.`,
    examples: [
      { label: 'Z, A', hint: 'one marker to count with' },
      { label: 'Z, X, Y', hint: 'remember which of two things you saw' }
    ],
    variants: {
      tape: `The tape alphabet is everything a single cell of the tape may hold: your input symbols, any extra symbols the machine writes as working notes, and the blank that fills every cell it has not written to yet.`,
      queue: `A queue is scratch memory with one rule: what goes in first comes out first. The queue alphabet is the set of symbols the machine is allowed to add to it, and it is a separate vocabulary from the input.`,
      counter: `A counter is a stack that only ever holds one kind of symbol, so counting up is pushing and counting down is popping. Z marks zero and is always there.`,
      twoStack: `Both stacks draw on the same alphabet. Two stacks instead of one is what lifts this machine to the power of a Turing machine, so the second one is worth spending on something the first cannot hold.`
    }
  },

  delta: {
    short: 'Output',
    question: 'What can your machine write?',
    description: `A transducer does not answer yes or no — it answers with a word. The output alphabet is the vocabulary it writes that word in, and it can be completely different from the one it reads.`,
    examples: [
      { label: '0, 1', hint: 'bits out' },
      { label: 'yes, no', hint: 'a verdict per symbol' }
    ]
  },

  options: {
    short: 'Settings',
    question: 'A couple of settings for this machine',
    description: `These are particular to the model you picked. The defaults are the textbook ones, so leaving them alone is a reasonable choice.`
  },

  states: {
    short: 'States',
    question: 'What states does your machine have?',
    description: `A state represents where the machine currently is, as it processes a sequence of inputs. One state is where it starts; the accepting ones are the ones that mean "yes, this word is in the language".`,
    examples: [
      { label: 'even, odd', hint: 'what you have seen so far' },
      { label: 'start, seen-a, seen-ab, done', hint: 'progress through a pattern' }
    ],
    variants: {
      omega: `A state represents where the machine currently is, as it processes a sequence of inputs. This machine's input never ends, so what matters is not where it stops but which states it keeps coming back to forever — the accepting ones are the states you want it to keep returning to.`,
      cobuchi: `A state represents where the machine currently is, as it processes a sequence of inputs. This machine's input never ends, and it accepts when the marked states are visited only finitely often — so mark the states the run must eventually stop returning to.`,
      parity: `A state represents where the machine currently is, as it processes a sequence of inputs. This model has no accepting states: each state carries a priority number instead, and a run is accepted when the smallest priority it keeps returning to forever is even.`,
      moore: `A state represents where the machine currently is, as it processes a sequence of inputs. In a Moore machine each state also prints an output symbol, every time the machine arrives in it.`,
      transducer: `A state represents where the machine currently is, as it processes a sequence of inputs. This machine's real answer is the word it writes, so marking accepting states is optional — use them if you want it to also say whether the input was well-formed.`,
      tape: `A state represents where the machine currently is, as it processes a sequence of inputs. A tape machine stops the moment it reaches an accepting state, whatever is left on the tape and wherever the head happens to be.`
    }
  },

  transitions: {
    short: 'Transitions',
    question: 'What transitions does your machine have?',
    description: `A transition is one rule: when the machine is in this state and reads this symbol, move to that state. Together, the rules are everything your machine does — there is nothing else to it.`,
    variants: {
      deterministic: `A transition is one rule: when the machine is in this state and reads this symbol, move to that state. This model is deterministic, which means no state may have two rules for the same symbol — there is never a choice to make.`,
      nondeterministic: `A transition is one rule: when the machine is in this state and reads this symbol, move to that state. This model may have several rules that fit at once; it is taken to accept if any one of the paths through them works out.`,
      stack: `A transition is one rule: when the machine is in this state, reads this symbol and finds this on top of the stack, it moves to that state and changes the stack. Popping ε means "do not look at the stack"; pushing ε means "put nothing back".`,
      queue: `A transition is one rule: when the machine is in this state, reads this symbol and finds this at the front of the queue, it moves to that state and adds to the back. Dequeuing ε means "leave the queue alone".`,
      tape: `A transition is one rule: when the machine is in this state and the head reads this cell, it writes a symbol into that cell, moves the head one step, and goes to that state. Reading and writing the same symbol leaves the tape as it was.`,
      multiTape: `A transition is one rule that fires when every head reads what the rule expects. Each tape then gets its own written symbol and its own direction, all in the same step.`,
      transducer: `A transition is one rule: when the machine is in this state and reads this symbol, it prints something and moves to that state. The printed symbols, joined up, are the machine's answer.`,
      weighted: `A transition is one rule, and every rule carries the probability of being the one taken. The probabilities on the rules leaving a state for one symbol should add up to 1.`,
      twoWay: `A transition is one rule: when the machine is in this state and reads this symbol, it moves to that state and sends the head left or right. The head may go back over input it has already read, which is what makes this model two-way.`
    }
  },

  describe: {
    short: 'Describe',
    question: 'What should this machine be called?',
    description: `Optional, and easy to change later. The title and sentence become the info card over the canvas, and any test words you list turn into chips you can run with one click.`
  },

  review: {
    short: 'Review',
    question: 'Ready to draw it?',
    description: `This is what will be created. Anything worth knowing about it is listed below — none of it stops you, and nothing has been drawn yet.`
  }
};

// ──────────────────────────────────────────────────────────────────
//  FIELDS
// ──────────────────────────────────────────────────────────────────
//  Keyed by the spec dialect's own field names, so transitionFieldsFor()
//  in js/statemate-spec.js decides which of these a machine shows and this
//  list never needs to know which machine it is talking about.

export const FIELD_COPY = {
  from: { label: 'From', hint: 'The state the machine is in when this rule applies.' },
  to: { label: 'To', hint: 'The state it is in afterwards.' },
  on: { label: 'Reads', hint: 'The input symbol this rule responds to.' },
  write: { label: 'Writes', hint: 'What is left in the cell the head just read.' },
  move: { label: 'Head moves', hint: 'Which way the head goes next.' },
  pop: { label: 'Pops', hint: 'What must be on top of the stack. ε means the rule does not look.' },
  push: { label: 'Pushes', hint: 'What goes on top afterwards. ε means nothing is put back.' },
  pop2: { label: 'Pops (2nd stack)', hint: 'The same, for the second stack.' },
  push2: { label: 'Pushes (2nd stack)', hint: 'The same, for the second stack.' },
  out: { label: 'Writes out', hint: 'The output printed when this rule is taken.' },
  weight: { label: 'Probability', hint: 'How likely this rule is, between 0 and 1.' },
  tapeSyms: { label: 'Reads', hint: 'What each head must be looking at.' },
  tapeWrites: { label: 'Writes', hint: 'What each head leaves behind.' },
  tapeDirs: { label: 'Heads move', hint: 'Which way each head goes next.' }
};

// The exceptions, and there are only three. A queue's ends are not a stack's,
// and a counter's single symbol makes push and pop into plus and minus — using
// the general words for them would be technically true and useless.
export const FIELD_COPY_BY_MACHINE = {
  QA: {
    pop: { label: 'Takes from front', hint: 'What must be at the front of the queue. ε means the rule does not look.' },
    push: { label: 'Adds to back', hint: 'What joins the back of the queue. ε means nothing is added.' }
  },
  Counter: {
    pop: { label: 'Counter −', hint: 'What must be on the counter: a symbol to count one down, Z to test for zero, ε not to look.' },
    push: { label: 'Counter +', hint: 'What to count back up. ε leaves the counter one lower.' }
  },
  Moore: {
    out: { label: 'Prints', hint: 'Set on the state instead — a Moore machine prints on arrival.' }
  }
};

// The `on` field is the one every machine has and the one whose meaning moves
// most between them, so it gets flavours of its own.
export const READ_HINTS = {
  epsilon: 'The input symbol this rule responds to. ε means the machine may take this step without reading anything.',
  tape: 'What the head must find in the current cell for this rule to apply.',
  multiTape: 'What each head must find in its current cell.',
  wildcard: 'The input symbol this rule responds to. Σ stands for "any symbol not named by another rule".',
  omega: 'The input symbol this rule responds to. The input never ends, so every state needs a way onward.'
};

// ──────────────────────────────────────────────────────────────────
//  STATE FIELDS
// ──────────────────────────────────────────────────────────────────

export const STATE_FIELD_COPY = {
  name: { label: 'Name', hint: 'Anything you like. Names that say what the machine has seen are easier to debug than q0, q1, q2.' },
  start: { label: 'Start', hint: 'Exactly one state is where every run begins.' },
  accept: { label: 'Accepting', hint: 'Reaching one of these at the end of the word means yes.' },
  priority: { label: 'Priority', hint: 'A whole number. The smallest one seen infinitely often decides: even accepts, odd rejects.' },
  out: { label: 'Prints', hint: 'The symbol this state emits whenever the machine arrives in it.' }
};

// ──────────────────────────────────────────────────────────────────
//  MACHINE OPTIONS
// ──────────────────────────────────────────────────────────────────
//  The settings that are neither the alphabet nor the graph. Each is offered
//  only to the machines it means something for — see optionsFor() in
//  js/wizard.js.

export const OPTION_COPY = {
  tapeCount: {
    label: 'How many tapes?',
    hint: 'Each tape has its own head and its own contents. Every rule reads one cell per tape and moves each head separately. The input starts on the first tape; the rest begin blank.'
  },
  cutPoint: {
    label: 'Acceptance threshold',
    hint: 'This machine gives every word a probability rather than a verdict. A word is accepted when that probability is strictly greater than this number.'
  },
  twoWayTape: {
    label: 'Tape extends left of the input',
    hint: 'On a two-way tape the head may move left of where the input started and find blank cells there. On a one-way tape the front of the input is a wall. Textbooks and JFLAP both assume two-way.'
  }
};

// ──────────────────────────────────────────────────────────────────
//  ODDS AND ENDS
// ──────────────────────────────────────────────────────────────────

export const UI_COPY = {
  createTitle: 'Build a machine',
  editTitle: 'Edit this machine',
  createTip: 'Build a machine step by step',
  editTip: 'Edit this machine step by step',
  editNote: 'Filled in from the machine on your canvas. Change what you like — states you leave alone keep their place in the diagram.',
  startFresh: 'Start a new machine instead',
  startFreshHint: 'Empties every answer and puts the result in a new tab, leaving this machine alone.',
  emptyStates: 'No states yet.',
  emptyTransitions: 'No transitions yet. A machine with none is legal — it just rejects everything that is not already at an accepting start state.',
  wordsLabel: 'Test words',
  wordsHint: 'Words worth trying on this machine, with what you expect it to say. They become one-click chips on the info card.'
};
