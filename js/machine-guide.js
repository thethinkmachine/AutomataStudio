import { math, mathLines, note, p, sec, ul } from './guide-blocks.js';

// ══════════════════════════════════════════════════════════════════
//  MACHINE GUIDE — CONTENT
// ══════════════════════════════════════════════════════════════════
// One explainer per machine the app can build, plus a single orientation
// entry. This module is data only: js/reference.js turns it into the
// Reference view. Its one import is js/guide-blocks.js, which is itself
// import-free, so this stays a leaf.
//
// The keys of `MachineGuides` are exactly the keys of `MachineTypes` in
// js/state.js, minus 'PDA' (a hidden alias of DPDA that the model picker does
// not list). js/reference.js walks `MachineCategories` to build its navigation,
// so a machine added to state.js without an entry here shows up in the nav
// with nothing behind it — add the guide in the same change.
//
// Concepts that are not a machine live in js/concept-guide.js.
//
// Formal definitions are kept in step with `updateFormalDef()` in js/render.js:
// the tuple a guide states is the tuple the Formal Definition box prints for
// that machine. If one moves, move the other.
//
// Writing conventions are documented in js/guide-blocks.js.

// ──────────────────────────────────────────────────────────────────
//  ORIENTATION
// ──────────────────────────────────────────────────────────────────
export const GuideOverview = {
  slug: 'overview',
  abbr: 'Overview',
  title: 'How to read these machines',
  tagline: 'The vocabulary every model on this list shares',
  accent: 'var(--accent)',
  klass: 'Orientation',
  sections: [
    sec('What an automaton is',
      p(`An automaton is a machine defined entirely by a finite set of rules for moving between finitely many <b>states</b>. It is given a word — a finite (or, for the ω-automata, infinite) sequence of symbols — and it processes that word one symbol at a time. What distinguishes one model from the next is not the states but everything <em>around</em> them: whether the machine may follow several rules at once, whether it has storage beside its state, whether the head that reads the input may go backwards, and what condition decides that a run was a success.`),
      p(`Every model here answers the same two questions in its own way. <b>What is a configuration?</b> — the complete description of the machine mid-computation, which must be finite even when the set of possible configurations is not. <b>When is a run accepting?</b> — the condition on that sequence of configurations that decides yes or no.`)),

    sec('The common vocabulary',
      ul(
        `<b>Q</b> — the finite set of states. Every model here has one. It is drawn as the circles on the canvas.`,
        `<b>Σ</b> — the input alphabet: the symbols a word may be built from. Edited in the left panel.`,
        `<b>Γ</b> — auxiliary storage alphabet, where the model has storage. It is the stack alphabet for the pushdown family and the tape alphabet for the Turing family, and it always contains at least one symbol that Σ does not: the stack bottom marker Z, or the blank ⊔.`,
        `<b>Δ</b> — the output alphabet, for the transducers, which emit a word instead of (or alongside) answering yes/no.`,
        `<b>δ</b> — the transition function or relation. Its exact signature is the single most informative line in a model's definition, and it is printed live in the Formal Definition box on the canvas.`,
        `<b>q₀</b> — the start state, marked on the canvas by the incoming arrow from nowhere.`,
        `<b>F</b> — the set of accepting states, drawn as a double ring. Two models replace it: a parity automaton uses a priority number per state, and a pure transducer may not use acceptance at all.`),
      p(`A <b>run</b> is the sequence of configurations the machine passes through on a given input. A <b>deterministic</b> model has exactly one run per input, because δ prescribes exactly one next move for every situation. A <b>nondeterministic</b> model may have many, and by convention it accepts if <em>at least one</em> of them is accepting — nondeterminism is a guess that is always assumed to be lucky, not a machine that tries every option in sequence.`)),

    sec('The five families in this app',
      ul(
        `<b>Finite automata</b> — no storage at all. The state is the entire memory, so what these machines can recognise is bounded by how many distinct situations a fixed number of states can distinguish. They define the <em>regular</em> languages.`,
        `<b>ω-automata</b> — finite automata whose input never ends. Because there is no last configuration, acceptance has to be a property of what recurs forever rather than of where the machine stopped. They define the <em>ω-regular</em> languages.`,
        `<b>Memory automata</b> — a finite automaton plus one disciplined store: a stack, a queue, a counter, or two stacks. What the discipline allows decides everything; a single stack gives the <em>context-free</em> languages, while a queue or a second stack is already as strong as a Turing machine.`,
        `<b>Turing machines</b> — a read/write head on an unbounded tape, free to move in both directions. This is the standard model of general computation; its bounded cousin, the linear bounded automaton, defines the <em>context-sensitive</em> languages.`,
        `<b>Transducers</b> — machines that emit output rather than only deciding membership. They compute functions and relations on words instead of defining languages.`)),

    sec('How the models are compared',
      p(`Two machines are <b>equivalent</b> when they accept exactly the same set of words, and a model <b>A</b> is at least as powerful as a model <b>B</b> when every language some B-machine accepts is accepted by some A-machine. Written with ⊆ and ⊊ between classes, the picture the app covers is:`),
      math(`\\text{Regular} \\subsetneq \\text{Context-Free} \\subsetneq \\text{Context-Sensitive} \\subsetneq \\text{Recursively Enumerable}`),
      p(`Two facts about this chain are worth holding on to. First, the inclusions are <em>strict</em>: at each step there is a concrete language the smaller class cannot reach, and the standard witnesses are {aⁿbⁿ : n ≥ 0} for the first step and {aⁿbⁿcⁿ : n ≥ 0} for the second. Second, adding nondeterminism moves a model along this chain in only one case in the whole app — the pushdown automaton. Everywhere else it changes how compactly a language can be described, not which languages are describable.`),
      p(`The ω-automata sit outside this chain because they classify infinite words, not finite ones. They have their own small hierarchy, described on each of their pages.`)),

    sec('Reading a machine on the canvas',
      ul(
        `An arrow from nowhere marks q₀; a double ring marks a state in F. Both are set from the state's context menu, and a double-click toggles acceptance.`,
        `Edge labels show whatever the current model needs: just a symbol for a finite automaton, <code>read, pop → push</code> for a pushdown machine, <code>read → write, direction</code> for a tape machine, and <code>read / output</code> for a transducer.`,
        `<b>Σ</b> used as a read symbol on an edge is a wildcard that matches any input symbol. Where a model is deterministic, an edge naming a concrete symbol always wins over a wildcard edge out of the same state, so the wildcard behaves as "anything else". The ω-automata are the exception: their simulator follows every matching edge, so a wildcard alongside a concrete symbol is a genuine branch there and the editor treats it as one.`,
        `<b>ε</b> as a read symbol means the move consumes no input. Only the models whose definition permits it will accept an ε edge.`,
        `The Formal Definition box beneath the canvas prints the tuple for the machine you are currently editing, filled in with your actual Q, Σ and F.`)),

    sec('What the simulator can and cannot tell you',
      p(`For the models that always halt, the verdict shown is the truth: accept or reject. For the models that may run forever — the Turing family, the two-way machines, and any pushdown machine with ε-loops — a run that has not finished is reported as <b>no verdict</b> and never as a rejection. That distinction is the whole content of the difference between deciding a language and merely recognising it, so the app refuses to blur it.`),
      p(`Where a deterministic machine revisits a configuration it has already been in, the app says so explicitly: a deterministic machine that repeats a configuration will repeat it forever, so this is a <em>proof</em> of non-termination rather than a timeout. Step budgets for the pushdown and tape machines are adjustable in Settings.`))
  ]
};

// ──────────────────────────────────────────────────────────────────
//  FINITE AUTOMATA
// ──────────────────────────────────────────────────────────────────
const FA_GUIDES = {
  'DFA': {
    slug: 'dfa',
    title: 'Deterministic Finite Automaton',
    tagline: 'Finitely many states, one move per symbol, no storage',
    accent: 'var(--accent)',
    klass: 'Regular languages',
    sections: [
      sec('What it is',
        p(`A DFA reads its input once, from left to right, one symbol at a time, and its only memory is which of finitely many states it is currently in. There is no stack, no tape, no counter and no way to look back at a symbol already read. Whatever the machine needs to remember about the prefix it has consumed must be encoded in the identity of the state it is sitting in.`),
        p(`Because the machine is deterministic, the current state and the next symbol together determine the next state completely. A DFA therefore has exactly one run on each input, and that run has exactly as many steps as the input has symbols.`)),

      sec('Formal definition',
        p(`A DFA is a five-tuple:`),
        math(`M = (Q,\\ \\Sigma,\\ \\delta,\\ q_0,\\ F)`),
        ul(
          `<b>Q</b> is a finite, non-empty set of states.`,
          `<b>Σ</b> is a finite input alphabet.`,
          `<b>δ : Q × Σ → Q</b> is the transition function. It is <em>total</em>: for every state and every symbol it must give an answer.`,
          `<b>q₀ ∈ Q</b> is the start state.`,
          `<b>F ⊆ Q</b> is the set of accepting states. F may be empty, and it may be all of Q.`),
        p(`It is convenient to extend δ from single symbols to whole words. The <b>extended transition function</b> δ̂ : Q × Σ* → Q is defined by recursion on the word:`),
        math(`\\hat\\delta(q, \\varepsilon) = q \\qquad \\hat\\delta(q, wa) = \\delta\\big(\\hat\\delta(q, w),\\, a\\big)`),
        p(`Read the second clause as: to process w followed by a, first process w, then take one more step on a.`)),

      sec('How a run works',
        p(`A configuration is a pair (q, w) — the state the machine is in, and the part of the input it has not read yet. The step relation is:`),
        math(`(q,\\ a\\,w) \\ \\vdash\\ (\\delta(q,a),\\ w)`),
        p(`Starting from (q₀, w) the machine takes |w| steps and arrives at a configuration whose second component is ε. No choice is ever made, so this sequence is unique.`)),

      sec('Acceptance',
        p(`The word w is accepted exactly when the state reached after reading all of it is accepting:`),
        math(`w \\in L(M) \\iff \\hat\\delta(q_0, w) \\in F`),
        p(`The set of all accepted words is <b>L(M)</b>, the language of the machine. Note that acceptance is decided only at the end: passing through an accepting state part-way through means nothing.`)),

      sec('What it can and cannot express',
        p(`The languages accepted by DFAs are exactly the <b>regular</b> languages — the same class as the nondeterministic finite automata, the ε-automata, the regular expressions and the regular grammars. Every one of those four descriptions can be converted into any other.`),
        p(`Regular languages are closed under every operation you would naturally reach for: union, intersection, complement, set difference, symmetric difference, concatenation, Kleene star, reversal, homomorphism and inverse homomorphism. Closure under complement is nearly free for a DFA — swap F for Q ∖ F, which works precisely because δ is total and every input has exactly one run. Union and intersection come from the <b>product construction</b>, which runs two machines side by side on the same input by taking Q₁ × Q₂ as its state set.`),
        p(`Every question one usually asks about a DFA is decidable, and cheaply so: membership in time proportional to the length of the word; emptiness by asking whether any accepting state is reachable from q₀; finiteness by asking whether any cycle sits on a path from q₀ to an accepting state; universality by complementing and testing emptiness; and equivalence of two DFAs by testing whether the machine for their symmetric difference has empty language.`),
        p(`The limit of the model is that a DFA cannot count without bound. {aⁿbⁿ : n ≥ 0} is not regular, and neither are the palindromes or {ww : w ∈ Σ*}. The two standard tools for proving such a claim are the pumping lemma — if L is regular there is a length p such that every word of L of length at least p can be split as xyz with |xy| ≤ p and |y| ≥ 1 so that xyⁱz ∈ L for every i ≥ 0 — and the Myhill–Nerode theorem below, which is the sharper of the two.`)),

      sec('Minimality and the Myhill–Nerode theorem',
        p(`Call two words x and y <b>indistinguishable</b> for L when no suffix separates them: for every z, xz ∈ L exactly when yz ∈ L. This is an equivalence relation on Σ*, and its classes are exactly the distinct "futures" a machine would have to keep apart.`),
        p(`The theorem says that L is regular if and only if this relation has finitely many classes, and in that case the number of classes is exactly the number of states of the smallest DFA for L. That minimal DFA is unique up to renaming its states. This is why minimisation is a well-posed problem with one right answer, and why an infinite family of pairwise distinguishable words is a complete proof of non-regularity.`)),

      sec('In this editor',
        ul(
          `The editor enforces determinism: it refuses a second edge leaving the same state on the same symbol, and tells you to switch to NFA if branching is what you wanted.`,
          `δ is allowed to be partial on the canvas. A missing (state, symbol) pair behaves as an implicit trap: the run stops there and rejects. Adding an explicit trap state with all the missing edges routed into it changes nothing about the language, only about the drawing.`,
          `A <b>Σ</b> wildcard edge matches any symbol, and a concrete edge out of the same state takes precedence over it. This is a drawing convenience; the machine it denotes is still an ordinary DFA.`,
          `The Algorithms view carries the constructions that go with this model: subset construction, minimisation by table-filling, complement, product, dead-state analysis, and the emptiness, finiteness, universality and equivalence tests.`))
    ]
  },

  'NFA': {
    slug: 'nfa',
    title: 'Nondeterministic Finite Automaton',
    tagline: 'Many moves at once; accepts if any one of them works out',
    accent: 'var(--accent)',
    klass: 'Regular languages',
    sections: [
      sec('What it is',
        p(`An NFA is a DFA that is allowed to be undecided. From a given state, on a given symbol, it may have several outgoing edges, or none at all. Instead of a single run there is now a tree of runs, and the machine accepts a word if <em>some</em> branch of that tree consumes the whole word and ends in an accepting state.`),
        p(`It helps to read nondeterminism as guessing rather than as searching. The machine is not trying all the options one after another; it is permitted to guess the right one, and it is judged on whether a right guess exists. This is what makes NFAs so much easier to write by hand — you may defer a decision until later evidence has arrived, which is exactly what the "guess the penultimate 1" example does.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\delta,\\ q_0,\\ F)`),
        p(`Every component is as in a DFA except δ, which now returns a <em>set</em> of states:`),
        math(`\\delta : Q \\times \\Sigma \\to \\mathcal{P}(Q)`),
        p(`𝒫(Q) is the power set — the set of all subsets of Q. Returning ∅ is legitimate and is how "no move" is expressed, so unlike a DFA's δ there is nothing partial about it. The extended function lifts to sets of states:`),
        math(`\\hat\\delta(S, \\varepsilon) = S \\qquad \\hat\\delta(S, wa) = \\bigcup_{q \\in \\hat\\delta(S,\\,w)} \\delta(q, a)`)),

      sec('How a run works',
        p(`A single run is a sequence q₀, q₁, …, q_n of states with q_{i+1} ∈ δ(q_i, a_{i+1}) for each i. There may be many such sequences, or none. The equivalent set-based view — track the whole set of states the machine could be in, and advance the set on each symbol — is one step away from being the subset construction below.`),
        p(`A branch that reaches a state with no outgoing edge on the next symbol simply dies. That is not a rejection of the word; it is one branch failing, and other branches may still succeed.`)),

      sec('Acceptance',
        math(`w \\in L(M) \\iff \\hat\\delta(\\{q_0\\},\\, w) \\cap F \\neq \\emptyset`),
        p(`Equivalently: there exists at least one run on w that ends in an accepting state. The asymmetry is worth naming — one accepting branch suffices for acceptance, but rejection requires that <em>every</em> branch fails.`)),

      sec('What it can and cannot express',
        p(`Exactly the regular languages: the same class as the DFA. One direction is immediate, since every DFA is an NFA whose δ happens to return singletons. The other is the <b>subset construction</b>, which builds a DFA whose states are sets of NFA states:`),
        math(`Q' = \\mathcal{P}(Q), \\quad \\delta'(S, a) = \\bigcup_{q \\in S} \\delta(q,a), \\quad q_0' = \\{q_0\\}, \\quad F' = \\{S : S \\cap F \\neq \\emptyset\\}`),
        p(`In practice only the subsets reachable from {q₀} are built, which is usually far fewer than 2ⁿ. But the exponential is not merely a weakness of the algorithm: there are regular languages — the classic being "the n-th symbol from the end is a 1" — where an NFA of n + 1 states is matched only by a DFA of 2ⁿ states. Nondeterminism buys succinctness, not power.`),
        p(`This gap shows up in the cost of operations. Union and concatenation of NFAs are trivial, since you can simply lay the machines side by side. Complement is the awkward one: it requires determinising first, because flipping F on an NFA does <em>not</em> complement its language — a word can have both an accepting and a rejecting run.`)),

      sec('In this editor',
        ul(
          `Several edges leaving one state on the same symbol are permitted and are the point of the model.`,
          `This NFA has no ε moves. Choose <b>ε-NFA</b> if you want them; the machine is otherwise identical.`,
          `The simulator explores branches and reports an accepting one when it finds it, so the trace you scrub through is a witness run rather than an arbitrary path.`,
          `Subset construction is in the Algorithms view and will put the resulting DFA on the canvas.`))
    ]
  },

  'ε-NFA': {
    slug: 'enfa',
    title: 'Finite Automaton with ε-Transitions',
    tagline: 'Nondeterminism plus moves that consume no input',
    accent: 'var(--accent)',
    klass: 'Regular languages',
    sections: [
      sec('What it is',
        p(`An ε-NFA is an NFA that may also change state without reading anything. An ε edge is a free move: the machine may take it at any moment, and taking it does not advance the position in the input.`),
        p(`This is purely a convenience — it adds no power — but it is a decisive one for building machines mechanically. Gluing two automata together in sequence, or offering a choice between two automata, becomes a matter of drawing an ε edge instead of rewiring transition tables. That is exactly how a regular expression is compiled into an automaton.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\delta,\\ q_0,\\ F) \\qquad \\delta : Q \\times (\\Sigma \\cup \\{\\varepsilon\\}) \\to \\mathcal{P}(Q)`),
        p(`Note that ε is <em>not</em> a member of Σ. It is a separate label on the transition function's domain, denoting the absence of a symbol. Adding ε to the input alphabet itself would be a modelling error: it would make ε a symbol that words could contain.`)),

      sec('ε-closure',
        p(`The central definition is the <b>ε-closure</b> of a state q, written E(q): the set of all states reachable from q by following zero or more ε edges, including q itself. Extended to a set of states, E(S) is the union of the closures of its members.`),
        p(`E(q) answers the question "which states is the machine already effectively in, before it reads anything?" — and with it, the extended transition function becomes:`),
        math(`\\hat\\delta(S, \\varepsilon) = E(S) \\qquad \\hat\\delta(S, wa) = E\\Big( \\bigcup_{q \\in \\hat\\delta(S,\\,w)} \\delta(q,a) \\Big)`),
        p(`The closure is taken both at the start and after each real symbol, which is what makes ε moves invisible from the outside.`)),

      sec('Acceptance',
        math(`w \\in L(M) \\iff \\hat\\delta(\\{q_0\\},\\, w) \\cap F \\neq \\emptyset`),
        p(`Identical in shape to the NFA rule, with the closure folded into δ̂. In particular the empty word is accepted exactly when E(q₀) contains an accepting state.`)),

      sec('Removing ε moves',
        p(`Every ε-NFA has an equivalent ordinary NFA on the same state set. Define:`),
        math(`\\delta'(q, a) = E\\big(\\delta(E(q),\\, a)\\big) \\qquad F' = \\{\\, q : E(q) \\cap F \\neq \\emptyset \\,\\}`),
        p(`In words: to take a real step, first drift along ε edges as far as you like, then read the symbol, then drift again; and a state counts as accepting if an accepting state is reachable from it by ε moves alone. Composing this with the subset construction gives a DFA, which is why all three finite-automaton models define the same class.`)),

      sec('What it can and cannot express',
        p(`Exactly the regular languages. Its practical significance is as the target of <b>Thompson's construction</b>, which compiles a regular expression into an ε-NFA compositionally: a single symbol becomes one edge; a union forks with two ε edges and rejoins with two more; a concatenation joins the exit of the first machine to the entry of the second with an ε edge; and a star wraps a machine in a new entry and exit pair with ε edges permitting zero or more passes. Each construct adds a constant number of states, so the resulting machine is linear in the size of the expression.`),
        p(`The converse direction — automaton back to expression — goes through state elimination on a generalised automaton whose edges carry whole expressions. Together the two directions prove that regular expressions and finite automata describe the same languages.`)),

      sec('In this editor',
        ul(
          `Use ε as the read symbol on an edge (the symbol itself is configurable in Settings). It is accepted only by models whose definition allows it.`,
          `ε elimination and Thompson's construction are both in the Algorithms view, the latter with a step-by-step visualiser.`,
          `Watch for cycles of ε edges: they are legal and the closure handles them correctly, but they mean the machine can sit still indefinitely, which makes a hand-traced run harder to follow than the simulator's.`))
    ]
  },

  '2DFA': {
    slug: 'twodfa',
    title: 'Two-Way Deterministic Finite Automaton',
    tagline: 'A read-only head that may go back over the input',
    accent: 'var(--accent)',
    klass: 'Regular languages',
    sections: [
      sec('What it is',
        p(`A 2DFA has the same finite memory as a DFA, but its head may move left as well as right, or stay where it is. The input sits on a read-only tape framed by two <b>endmarkers</b>, ⊢ on the left and ⊣ on the right, so the machine can tell where the word begins and ends and can therefore make as many passes over it as it likes.`),
        p(`The surprise of this model is that all that freedom buys nothing: a 2DFA recognises exactly the regular languages. Being able to re-read the input does not let a finite-state machine remember more, because everything it learns on a pass has to be carried in the same finite state set.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\delta,\\ q_0,\\ F) \\qquad \\delta : Q \\times (\\Sigma \\cup \\{\\vdash, \\dashv\\}) \\to Q \\times \\{L, R, S\\}`),
        p(`Each move names the next state and a head direction: L for left, R for right, S for stay. The endmarkers are readable symbols but are not members of Σ — no input word contains them, and the machine may not write, so they are permanent.`)),

      sec('How a run works',
        p(`The tape holds ⊢ w ⊣ and the head starts on the ⊢ cell in state q₀, so the first move is always a decision made with the left marker in view. A configuration is a pair (q, i), the state and the head position on that fixed tape. Since the tape never changes, the number of distinct configurations is |Q| × (|w| + 2) — a finite number, which is the key to everything else about the model.`),
        p(`The head may not leave the marked region. An attempt to move left of ⊢ or right of ⊣ is a halting error.`)),

      sec('Acceptance and looping',
        p(`The machine accepts by entering an accepting state, at whatever head position. It rejects by halting with no applicable transition, or by trying to move outside the endmarkers.`),
        p(`The third possibility is genuinely different from anything a DFA can do: a 2DFA may <b>loop forever</b>, walking back and forth without ever halting. Since the configuration space is finite, a deterministic run that has not halted must eventually repeat a configuration, and from then on it repeats the same cycle forever. That gives a decision procedure — run until you halt or repeat — and it is also why membership stays decidable despite the possibility of non-termination.`)),

      sec('What it can and cannot express',
        p(`Exactly the regular languages. The conversion to a one-way machine works by summarising, for each position of the input, the finite table of "if the head enters this position from the right in state q, it eventually comes back out in state q′ (or never comes out)". This table is a finite object, so a one-way machine can compute it symbol by symbol.`),
        p(`What two-way motion does buy is <b>succinctness</b>. Problems naturally phrased as several independent passes — check one property scanning right, then another scanning left — need only the sum of the states for each pass on a 2DFA, whereas a one-way DFA must track them all at once and can need the product. Converting a 2DFA to a DFA may blow up exponentially, and this cost is genuinely necessary in the worst case.`)),

      sec('In this editor',
        ul(
          `⊢ and ⊣ are reserved symbols. They are valid read symbols on an edge but the left panel will not let you add them to Σ.`,
          `The editor enforces determinism, refusing two moves for the same state and read symbol.`,
          `The simulator halts and reports <em>no verdict</em> if the step budget runs out, rather than calling a non-halting run a rejection.`,
          `Symbols are resolved most-specific-first, so a concrete edge wins over a <b>Σ</b> wildcard edge out of the same state.`))
    ]
  },

  '2NFA': {
    slug: 'twonfa',
    title: 'Two-Way Nondeterministic Finite Automaton',
    tagline: 'Two-way motion and branching, still only regular',
    accent: 'var(--accent)',
    klass: 'Regular languages',
    sections: [
      sec('What it is',
        p(`A 2NFA combines the two features that each, on their own, leave the class of regular languages untouched: a head that may move in both directions over the endmarked input, and a transition relation that may offer several moves at once. Combining them changes nothing either — a 2NFA still recognises exactly the regular languages.`),
        p(`The model earns its place as the natural home for "guess and check" algorithms. A machine may guess a position or a property on one pass and go back to verify it on another, which is often the clearest way to express a language even though a one-way machine could do it with more states.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\delta,\\ q_0,\\ F) \\qquad \\delta : Q \\times (\\Sigma \\cup \\{\\vdash, \\dashv\\}) \\to \\mathcal{P}(Q \\times \\{L, R, S\\})`),
        p(`The only change from a 2DFA is the power set on the right: a state and read symbol may yield any set of (next state, direction) pairs, including the empty set.`)),

      sec('How a run works',
        p(`As with the 2DFA, a configuration is a pair (q, i) over the fixed tape ⊢ w ⊣, and the configuration space has size |Q| × (|w| + 2). A run is any path through that space consistent with δ, starting at (q₀, 0).`),
        p(`Because the space is finite, the reachable configurations can be enumerated exhaustively. That is what makes the model safe to simulate: unlike a nondeterministic tape machine, a 2NFA cannot escape into an unbounded configuration space, so a breadth-first exploration always terminates with a definite answer.`)),

      sec('Acceptance',
        p(`The word is accepted if <em>some</em> run reaches an accepting state. A branch that halts with no applicable move, or that tries to step outside the endmarkers, dies without affecting the others.`)),

      sec('What it can and cannot express',
        p(`Exactly the regular languages, so 2NFA, 2DFA, NFA, ε-NFA and DFA all define one class. The chain of conversions is: a 2NFA's accepting runs can be summarised by the same finite "entry state to exit state" tables used for the 2DFA, but now as relations rather than functions; and relations over a finite set are still finite objects, so a one-way nondeterministic machine can track them.`),
        p(`The interesting question about this model is not power but size. Whether a 2NFA can always be converted to a 2DFA with only a polynomial increase in states is a well-known open problem, and it is closely tied to questions about deterministic and nondeterministic logarithmic space.`)),

      sec('In this editor',
        ul(
          `Branching is permitted, and ⊢ / ⊣ are reserved read symbols exactly as for the 2DFA.`,
          `Exploration is breadth-first over configurations, so a looping branch does not stall the search — the simulator reports the first accepting run it finds and linearises it for scrubbing.`,
          `Because the configuration space is finite, a reported rejection here is a genuine exhaustive rejection, not a budget expiring.`))
    ]
  },

  'PFA': {
    slug: 'pfa',
    title: 'Probabilistic Finite Automaton',
    tagline: 'Transitions carry probabilities; acceptance is a threshold',
    accent: 'var(--accent)',
    klass: 'Cut-point languages',
    sections: [
      sec('What it is',
        p(`A PFA replaces the yes/no branching of an NFA with a probability distribution. Every edge carries a number in [0, 1], and out of each state, for each input symbol, those numbers must sum to one. The machine is not in a state; it is in a <em>distribution</em> over states, and reading a symbol pushes that distribution forward.`),
        p(`This means the machine does not answer yes or no directly. It produces a number — the probability that it ends in an accepting state — and the language is defined by comparing that number to a threshold called the <b>cut-point</b>.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\delta,\\ q_0,\\ F,\\ \\lambda)`),
        ul(
          `<b>δ : Q × Σ × Q → [0, 1]</b> gives the probability of moving from one state to another on a symbol.`,
          `The <b>stochasticity condition</b> must hold for every state q and symbol a: the outgoing probabilities sum to one.`,
          `<b>λ ∈ [0, 1)</b> is the cut-point.`),
        math(`\\sum_{q' \\in Q} \\delta(q, a, q') = 1 \\quad \\text{for all } q \\in Q,\\ a \\in \\Sigma`),
        p(`Equivalently, each symbol a is a |Q| × |Q| <b>stochastic matrix</b> M_a whose rows sum to one, and the machine's behaviour is matrix multiplication.`)),

      sec('How a run works',
        p(`A configuration is a row vector v over Q with non-negative entries summing to one — the current distribution. It starts as the indicator vector of q₀, all mass on the start state, and each symbol advances it by one matrix product:`),
        math(`v_0 = e_{q_0}, \\qquad v_{i} = v_{i-1} \\, M_{a_i}, \\qquad P_M(w) = \\sum_{q \\in F} v_{|w|}(q)`),
        p(`P_M(w) is the <b>acceptance probability</b> of w: the total mass sitting on accepting states once the whole word has been read. Unlike every other model here, there is no branching to explore — the distribution is a single object that carries all branches at once, weighted.`)),

      sec('Acceptance',
        p(`The language is defined by strict comparison against the cut-point:`),
        math(`L(M) = \\{\\, w \\in \\Sigma^* \\ :\\ P_M(w) > \\lambda \\,\\}`),
        p(`The strictness matters. It is what makes the notion of an <b>isolated</b> cut-point meaningful: λ is isolated if there is some ε > 0 such that no word's acceptance probability lands within ε of λ on either side. Setting λ = 0 recovers a familiar reading — the word is accepted if some run has positive probability — which gives exactly the NFA underneath the weights.`)),

      sec('What it can and cannot express',
        p(`This is the one finite-state model in the app that can leave the regular languages behind. Two facts frame it:`),
        ul(
          `If the cut-point is <b>isolated</b>, L(M) is regular. Isolation gives a uniform margin, and a machine can round the distribution to finitely many buckets without ever changing the verdict.`,
          `Without isolation, a PFA can accept non-regular languages. Probabilities that are irrational relative to one another let the distribution encode unboundedly fine information, and a threshold can read that information back out.`),
        p(`The price is decidability. For general PFAs, the emptiness question — is there any word whose acceptance probability exceeds λ? — is undecidable, as is the question of whether the supremum of acceptance probabilities equals one. Whether a given cut-point is isolated is also undecidable. So this model sits oddly in the hierarchy: finite-state in structure, yet with unsolvable basic questions.`)),

      sec('In this editor',
        ul(
          `Each edge carries a probability alongside its symbol. Because the stochasticity condition is a property of a whole row and not of any single edge, the editor cannot catch a violation as you draw it — instead rows that do not sum to one are flagged when you run the machine, rather than being silently renormalised.`,
          `The cut-point is a setting; it defaults to 0.5 and is printed in the Formal Definition box as λ.`,
          `The simulator shows the whole distribution at each step, together with the accumulated mass on F, so you can watch probability drain towards or away from acceptance.`,
          `Because acceptance is a numeric threshold rather than a reachability property, the language tools that enumerate words treat a PFA as a decision procedure per word, not as a graph to search.`))
    ]
  }
};

// ──────────────────────────────────────────────────────────────────
//  ω-AUTOMATA
// ──────────────────────────────────────────────────────────────────
// Eight machines, one structure, two axes: determinism × acceptance condition.
// Each guide repeats just enough of the shared setup to stand alone, then
// concentrates on what its own cell of the grid actually decides.
const OMEGA_SHARED_RUN = sec('How a run works',
  p(`The input is an infinite word α ∈ Σ<sup>ω</sup>. A <b>run</b> is an infinite sequence of states ρ = q₀ q₁ q₂ … with each step licensed by δ. Since the run never ends, there is no final state to inspect; acceptance must instead be a property of what happens <em>infinitely often</em>.`),
  p(`The object every condition here judges is:`),
  math(`\\mathrm{Inf}(\\rho) = \\{\\, q \\in Q \\ :\\ q_i = q \\text{ for infinitely many } i \\,\\}`),
  p(`This app restricts inputs to <b>ultimately periodic</b> words — a finite stem u followed by a finite period v repeated forever, written <code>u(v)</code> and denoting u·v<sup>ω</sup>. This is not a limitation on the languages you can study: every non-empty ω-regular language contains an ultimately periodic word, and two ω-regular languages are equal precisely when they contain the same ultimately periodic words.`),
  p(`On such a word the pair (state, position-in-u(v)) ranges over a finite set, so every run is a <b>lasso</b>: a finite stem leading into a cycle repeated forever. Inf(ρ) is then exactly the set of states on that cycle, and every acceptance question becomes a question about reachable cycles in a finite graph.`));

const OMEGA_GUIDES = {
  'DBA': {
    slug: 'dba',
    title: 'Deterministic Büchi Automaton',
    tagline: 'Some accepting state must recur forever',
    accent: 'var(--purple)',
    klass: 'Deterministic Büchi ⊊ ω-regular',
    sections: [
      sec('What it is',
        p(`A DBA looks exactly like a DFA — same Q, Σ, δ and F — but it reads an infinite word, and it accepts when the run passes through F infinitely often. It expresses properties of the form "this keeps happening": a request is always eventually granted, a process is scheduled infinitely often, a signal never stops arriving.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\delta,\\ q_0,\\ F) \\qquad \\delta : Q \\times \\Sigma \\to Q`),
        p(`δ is single-valued and total, so each infinite word has exactly one run ρ_α.`)),

      OMEGA_SHARED_RUN,

      sec('Acceptance',
        math(`L(M) = \\{\\, \\alpha \\in \\Sigma^\\omega \\ :\\ \\mathrm{Inf}(\\rho_\\alpha) \\cap F \\neq \\emptyset \\,\\}`),
        p(`Note carefully what this does <em>not</em> say. It does not require the run to stay inside F, and it does not require F to be entered at any particular time. It requires only that the run cannot stop returning to F.`)),

      sec('What it can and cannot express',
        p(`Deterministic Büchi automata are strictly weaker than the full ω-regular class, and this is the only place in the whole ω family where determinism costs expressive power.`),
        p(`The canonical language it cannot recognise is <b>"eventually always b"</b> — the words with only finitely many a's. Intuitively, a DBA would have to commit to visiting F infinitely often, but at no finite point can it be sure that no further a is coming; any state it declares accepting can be reached again after another a. This language is easy for a co-Büchi or parity automaton, and easy for a <em>nondeterministic</em> Büchi automaton, which may simply guess where the a's stop.`),
        p(`There is a clean characterisation of what a DBA can do: L is DBA-recognisable exactly when there is a regular language W of finite words such that L is the set of infinite words having infinitely many prefixes in W. That "infinitely many prefixes" shape is precisely the recurrence pattern the Büchi condition tests.`),
        p(`Closure: DBA-recognisable languages are closed under union and intersection, but <b>not under complement</b> — the complement of a DBA language is co-Büchi recognisable, which is a different class.`)),

      sec('In this editor',
        ul(
          `Determinism is enforced three times: the editor refuses an overlapping move as you draw it, a check runs again before each simulation (a loaded or imported machine never passed through the editor), and the model picker names the machine so the label always matches the object.`,
          `The editor's determinism test is on symbol <em>overlap</em>, not equality. A <b>Σ</b> wildcard alongside a concrete symbol out of the same state is a real branch here, because the ω simulator follows every matching edge rather than resolving to the most specific one.`,
          `Enter the input as <code>u(v)</code>, for example <code>ab(ba)</code>. The period may not be empty.`,
          `An accepting run is shown as a lasso: the stem, then the cycle that is repeated forever.`))
    ]
  },

  'DcoBA': {
    slug: 'dcoba',
    title: 'Deterministic co-Büchi Automaton',
    tagline: 'The run must eventually leave F for good',
    accent: 'var(--purple)',
    klass: 'co-Büchi ⊊ ω-regular',
    sections: [
      sec('What it is',
        p(`A co-Büchi automaton has the same shape as a Büchi automaton and inverts its verdict on Inf. It accepts when the states of F are visited only <em>finitely</em> often — that is, when the run eventually settles into Q ∖ F and never comes back.`),
        p(`This expresses properties of the form "this stops happening" or, dually, "from some point on, things are always fine": errors eventually cease, a system stabilises, a variable is eventually constant.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\delta,\\ q_0,\\ F) \\qquad \\delta : Q \\times \\Sigma \\to Q`),
        p(`Identical in components to a DBA. Only the acceptance condition differs, and the app records that difference in the machine type itself rather than as a setting.`)),

      OMEGA_SHARED_RUN,

      sec('Acceptance',
        math(`L(M) = \\{\\, \\alpha \\in \\Sigma^\\omega \\ :\\ \\mathrm{Inf}(\\rho_\\alpha) \\cap F = \\emptyset \\,\\}`),
        p(`Because the run may pass through F any number of times before settling, F here is best read as a set of "bad" states that must eventually be abandoned, not as a set of good ones.`)),

      sec('What it can and cannot express',
        p(`The co-Büchi condition is the exact dual of the Büchi one: a language is co-Büchi recognisable by a deterministic automaton exactly when its complement is Büchi recognisable by a deterministic automaton. So "eventually always b" — the language no DBA can accept — is recognised here by the obvious two-state machine, while "infinitely often a", which is trivial for a DBA, is out of reach for a DcoBA.`),
        p(`Unlike Büchi, the co-Büchi condition <b>does not lose anything to determinism</b>: every nondeterministic co-Büchi automaton has an equivalent deterministic one, so DcoBA and NcoBA define the same class. That class is still a strict subset of the ω-regular languages — neither Büchi nor co-Büchi alone is enough for all of them.`)),

      sec('How the app decides it',
        p(`Acceptance reduces to a reachability question, exactly as it does for Büchi but with the search constrained differently. The simulator looks for a reachable cycle that lies <em>wholly inside</em> Q ∖ F. The stem that reaches such a cycle may pass through F as often as it likes, since a finite prefix cannot affect Inf(ρ) — the constraint applies only to the cycle. That single asymmetry is the whole implementation difference between the two conditions.`)),

      sec('In this editor',
        ul(
          `Determinism is enforced on symbol overlap, as for every deterministic ω type.`,
          `F is drawn with the usual double ring, but remember that here the ring marks the states the run must ultimately escape.`,
          `Input is an ultimately periodic word <code>u(v)</code>.`))
    ]
  },

  'DPA': {
    slug: 'dpa',
    title: 'Deterministic Parity Automaton',
    tagline: 'Priorities on states; the least recurring one must be even',
    accent: 'var(--purple)',
    klass: 'ω-regular (the full class)',
    sections: [
      sec('What it is',
        p(`A parity automaton replaces the accepting set F with a <b>priority</b>: a natural number attached to every state. A run is accepting when the smallest priority that occurs infinitely often is even.`),
        p(`The value of this condition is that it is expressive enough to capture every ω-regular language while staying deterministic, and that it is closed under complement almost for free — add one to every priority and even and odd swap roles. That combination is why parity is the standard condition when a construction needs a deterministic ω-automaton.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\delta,\\ q_0,\\ \\Omega) \\qquad \\delta : Q \\times \\Sigma \\to Q, \\qquad \\Omega : Q \\to \\mathbb{N}`),
        p(`Ω replaces F entirely — a parity automaton has no accepting set. The number of distinct priorities used is called the <b>index</b> of the automaton, and it is a real measure of difficulty: two priorities is exactly Büchi or co-Büchi power, and each additional pair of priorities strictly increases what can be expressed.`)),

      OMEGA_SHARED_RUN,

      sec('Acceptance',
        p(`This app uses the <b>min-even</b> convention:`),
        math(`L(M) = \\{\\, \\alpha \\in \\Sigma^\\omega \\ :\\ \\min \\Omega(\\mathrm{Inf}(\\rho_\\alpha)) \\equiv 0 \\pmod 2 \\,\\}`),
        p(`Read it as a priority ordering where lower numbers dominate: whichever of the recurring states has the smallest priority decides the verdict, and it decides in favour of acceptance when that priority is even. A run that keeps returning to priority 1 is rejected no matter how often it also visits priority 2, because 1 is smaller.`),
        p(`Büchi and co-Büchi are both special cases. Assign priority 0 to F and 1 to everything else and you have Büchi acceptance; assign 1 to F and 2 to everything else and you have co-Büchi.`)),

      sec('What it can and cannot express',
        p(`Deterministic parity automata recognise <b>exactly the ω-regular languages</b> — the whole class. Nondeterminism adds nothing here, so DPA and NPA are equally powerful, and both match the nondeterministic Büchi automata.`),
        p(`This makes the parity condition the natural normal form for the family. Every nondeterministic Büchi automaton can be converted to an equivalent deterministic parity automaton, and complementation, which is genuinely difficult for Büchi automata, is a one-line operation on priorities.`)),

      sec('In this editor',
        ul(
          `Choosing a parity type changes the data model, not just a label. The accepting set and its double ring disappear, the double-click accept toggle does nothing, and each state carries an integer instead — shown in the sub-label slot underneath the state's name, the same slot a Moore machine uses for its output.`,
          `Set a state's priority from its editor. Priorities are ordinary natural numbers; only their relative order and their parity matter.`,
          `The simulator finds an accepting lasso by anchoring on a state of even priority p and searching for a cycle through it that never touches a priority below p. The minimum on such a cycle is then exactly p.`,
          `Input is an ultimately periodic word <code>u(v)</code>.`))
    ]
  },

  'DWA': {
    slug: 'dwa',
    title: 'Deterministic Weak Automaton',
    tagline: 'Büchi acceptance on an automaton whose components cannot straddle F',
    accent: 'var(--purple)',
    klass: 'Büchi ∩ co-Büchi recognisable',
    sections: [
      sec('What it is',
        p(`A weak automaton is a Büchi automaton with a <b>structural</b> restriction: every strongly connected component of the transition graph must lie entirely inside F or entirely outside it. No component may contain both accepting and non-accepting states.`),
        p(`The restriction has a striking consequence. Any run eventually gets trapped in a single strongly connected component and stays there, and that component is uniformly accepting or uniformly rejecting. So the run either visits F infinitely often or stops visiting it at all — there is no middle case. On a weak automaton, Büchi and co-Büchi acceptance therefore coincide.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\delta,\\ q_0,\\ F) \\qquad \\delta : Q \\times \\Sigma \\to Q`),
        p(`Plus the weakness constraint, which is a condition on the automaton rather than on any single run:`),
        math(`\\forall\\, C \\in \\mathrm{SCC}(M): \\quad C \\subseteq F \\quad \\text{or} \\quad C \\cap F = \\emptyset`)),

      OMEGA_SHARED_RUN,

      sec('Acceptance',
        math(`L(M) = \\{\\, \\alpha \\in \\Sigma^\\omega \\ :\\ \\mathrm{Inf}(\\rho_\\alpha) \\cap F \\neq \\emptyset \\,\\}`),
        p(`Decided exactly as Büchi. The entire additional content of the model is the structural constraint above; it does not change how a run is judged, only which automata are legal.`)),

      sec('What it can and cannot express',
        p(`Weak automata recognise exactly those ω-regular languages that are recognisable both by a deterministic Büchi automaton and by a deterministic co-Büchi automaton. That is a strict subset of the ω-regular languages, and it is strictly smaller than either Büchi or co-Büchi alone.`),
        p(`Determinism costs nothing here: DWA and NWA define the same class. What the model buys is simplicity — because acceptance is settled as soon as you know which component the run ends in, weak automata are the easiest ω-automata to reason about, to complement (swap F for Q ∖ F, which is sound precisely because no component straddles the boundary), and to minimise.`),
        p(`"Never two a's in a row" is a typical weak language: it is a safety property, decided by whether the run ever leaves a good component, and it is recognisable by both a DBA and a DcoBA.`)),

      sec('In this editor',
        ul(
          `The weakness constraint is checked by a pass over the automaton's strongly connected components, and a component that straddles F is reported to you as a violation rather than being silently accepted.`,
          `Determinism is enforced on symbol overlap, as for every deterministic ω type.`,
          `Input is an ultimately periodic word <code>u(v)</code>.`))
    ]
  },

  'NBA': {
    slug: 'nba',
    title: 'Nondeterministic Büchi Automaton',
    tagline: 'The canonical acceptor for the ω-regular languages',
    accent: 'var(--purple)',
    klass: 'ω-regular (the full class)',
    sections: [
      sec('What it is',
        p(`An NBA is a Büchi automaton whose transition relation may branch. It accepts an infinite word if <em>some</em> run on that word visits F infinitely often. Nondeterminism here does what it does everywhere: it allows the machine to guess something it could not yet have verified — most usefully, to guess the moment after which the input's behaviour changes.`),
        p(`This is the reference model for infinite words. The languages it accepts are called the <b>ω-regular</b> languages, and every other ω-automaton in this app is measured against it.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\delta,\\ q_0,\\ F) \\qquad \\delta : Q \\times \\Sigma \\to \\mathcal{P}(Q)`)),

      OMEGA_SHARED_RUN,

      sec('Acceptance',
        math(`L(M) = \\{\\, \\alpha \\in \\Sigma^\\omega \\ :\\ \\exists\\, \\rho \\text{ a run on } \\alpha,\\ \\mathrm{Inf}(\\rho) \\cap F \\neq \\emptyset \\,\\}`),
        p(`As with a finite-word NFA, one good run is enough; rejection requires that every run fails.`)),

      sec('What it can and cannot express',
        p(`Exactly the ω-regular languages, which have an equivalent description with no automaton in sight: L is ω-regular precisely when it is a finite union of sets of the form U · V<sup>ω</sup>, where U and V are ordinary regular languages of finite words and V does not contain the empty word. The finite stem is U, the repeated part is V, and the union is the nondeterministic choice between finitely many shapes of behaviour.`),
        p(`Nondeterminism is essential to this model in a way it is not for finite words: <b>DBA ⊊ NBA</b>. "Eventually always b" is accepted by a two-state NBA that guesses when the a's stop and then verifies its guess, and by no DBA at all.`),
        p(`Closure properties are all positive but not all cheap. Union is trivial. Intersection needs a product construction with a small counter that alternates between tracking the two accepting sets. <b>Complement</b> is the hard one: the constructions are intricate and the state blow-up is worse than exponential in general — a marked contrast to the finite-word case, where complementing a DFA takes no work at all. This difficulty is exactly why deterministic parity automata are worth having.`)),

      sec('In this editor',
        ul(
          `Branching is permitted and is the point of the model. The simulator explores runs over (state, position) pairs and reports an accepting lasso when one exists.`,
          `Because every matching edge is followed, a <b>Σ</b> wildcard next to a concrete symbol genuinely branches.`,
          `Input is an ultimately periodic word <code>u(v)</code>, for example <code>ab(ba)</code>.`))
    ]
  },

  'NcoBA': {
    slug: 'ncoba',
    title: 'Nondeterministic co-Büchi Automaton',
    tagline: 'Some run must eventually abandon F forever',
    accent: 'var(--purple)',
    klass: 'co-Büchi ⊊ ω-regular',
    sections: [
      sec('What it is',
        p(`An NcoBA branches like an NBA and judges like a co-Büchi automaton: it accepts when <em>some</em> run visits F only finitely often. The natural reading is "there is a way for the system to eventually behave", where F marks the states counted as misbehaviour.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\delta,\\ q_0,\\ F) \\qquad \\delta : Q \\times \\Sigma \\to \\mathcal{P}(Q)`)),

      OMEGA_SHARED_RUN,

      sec('Acceptance',
        math(`L(M) = \\{\\, \\alpha \\in \\Sigma^\\omega \\ :\\ \\exists\\, \\rho \\text{ a run on } \\alpha,\\ \\mathrm{Inf}(\\rho) \\cap F = \\emptyset \\,\\}`)),

      sec('What it can and cannot express',
        p(`Exactly the same class as the deterministic co-Büchi automata: <b>NcoBA = DcoBA</b>. Every nondeterministic co-Büchi automaton can be determinised, which is the sharpest available contrast with the Büchi condition, where determinisation is impossible in general.`),
        p(`The intuition behind determinisability is that the co-Büchi condition asks the run to <em>settle</em>, and a deterministic machine can track all the branches at once and watch for the moment when some branch has settled — a bounded amount of extra bookkeeping, unlike the unbounded ordering information a Büchi determinisation would need.`),
        p(`The class remains a strict subset of the ω-regular languages. "Infinitely often a" cannot be expressed here, deterministically or otherwise.`)),

      sec('In this editor',
        ul(
          `Branching is permitted. Because nondeterminism adds no power to this condition, a nondeterministic co-Büchi automaton drawn here is often a deterministic one with a redundant guess — useful for seeing exactly what the guess is failing to buy.`,
          `The simulator searches for a reachable cycle lying wholly in Q ∖ F, over any run; the stem leading to it may cross F freely.`,
          `Input is an ultimately periodic word <code>u(v)</code>.`))
    ]
  },

  'NPA': {
    slug: 'npa',
    title: 'Nondeterministic Parity Automaton',
    tagline: 'Branching plus priorities; still exactly the ω-regular languages',
    accent: 'var(--purple)',
    klass: 'ω-regular (the full class)',
    sections: [
      sec('What it is',
        p(`An NPA carries a priority on each state like a DPA, and branches like an NBA. It accepts when some run's least infinitely-recurring priority is even.`),
        p(`Because the deterministic version already captures every ω-regular language, nondeterminism here adds no expressive power. What it adds is convenience: some languages have a much smaller nondeterministic parity automaton than a deterministic one, and combining machines (union in particular) is easier when branching is available.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\delta,\\ q_0,\\ \\Omega) \\qquad \\delta : Q \\times \\Sigma \\to \\mathcal{P}(Q), \\qquad \\Omega : Q \\to \\mathbb{N}`),
        p(`There is no F; Ω replaces it entirely.`)),

      OMEGA_SHARED_RUN,

      sec('Acceptance',
        math(`L(M) = \\{\\, \\alpha \\in \\Sigma^\\omega \\ :\\ \\exists\\, \\rho,\\ \\min \\Omega(\\mathrm{Inf}(\\rho)) \\equiv 0 \\pmod 2 \\,\\}`),
        p(`The min-even convention, quantified over runs. Both quantifiers matter and they nest in this order: choose a run, then look at the minimum priority recurring on it.`)),

      sec('What it can and cannot express',
        p(`Exactly the ω-regular languages. The full chain of equalities across the family is worth stating in one place:`),
        ul(
          `<b>NBA = NPA = DPA</b> = the ω-regular languages.`,
          `<b>DBA ⊊ NBA</b> — the only cell where determinism costs languages.`,
          `<b>DcoBA = NcoBA ⊊</b> ω-regular, and a language is co-Büchi recognisable exactly when its complement is deterministic-Büchi recognisable.`,
          `<b>DWA = NWA</b> = the languages that are both Büchi and co-Büchi recognisable, the smallest class of the four.`)),

      sec('In this editor',
        ul(
          `Branching is permitted; priorities replace the accepting set and appear in the sub-label under each state's name.`,
          `The accepting-lasso search anchors on an even-priority state and forbids the cycle from dipping below that priority, so the minimum on the discovered cycle is exactly the anchor's.`,
          `Input is an ultimately periodic word <code>u(v)</code>.`))
    ]
  },

  'NWA': {
    slug: 'nwa',
    title: 'Nondeterministic Weak Automaton',
    tagline: 'Branching, plus the constraint that no component straddles F',
    accent: 'var(--purple)',
    klass: 'Büchi ∩ co-Büchi recognisable',
    sections: [
      sec('What it is',
        p(`An NWA is a nondeterministic Büchi automaton subject to the weakness constraint: every strongly connected component lies entirely inside F or entirely outside it. It accepts when some run visits F infinitely often — which, given the constraint, is the same as some run eventually settling inside an accepting component.`)),

      sec('Formal definition',
        mathLines(
          `M = (Q,\\ \\Sigma,\\ \\delta,\\ q_0,\\ F) \\qquad \\delta : Q \\times \\Sigma \\to \\mathcal{P}(Q)`,
          `\\forall\\, C \\in \\mathrm{SCC}(M): \\quad C \\subseteq F \\quad \\text{or} \\quad C \\cap F = \\emptyset`)),

      OMEGA_SHARED_RUN,

      sec('Acceptance',
        math(`L(M) = \\{\\, \\alpha \\in \\Sigma^\\omega \\ :\\ \\exists\\, \\rho,\\ \\mathrm{Inf}(\\rho) \\cap F \\neq \\emptyset \\,\\}`),
        p(`Judged as Büchi, over runs. As with the deterministic weak automaton, the structural constraint makes Büchi and co-Büchi acceptance agree, so the same machine could equally be read either way.`)),

      sec('What it can and cannot express',
        p(`The same class as the deterministic weak automata — <b>NWA = DWA</b> — namely the ω-regular languages recognisable both by a deterministic Büchi and by a deterministic co-Büchi automaton. Nondeterminism adds nothing.`),
        p(`This makes weak automata the one cell of the grid where both axes are inert: neither determinism nor the choice between Büchi and co-Büchi reading changes anything. What remains is a model that is small, easy to complement and easy to reason about, at the cost of being the least expressive of the eight.`)),

      sec('In this editor',
        ul(
          `The strongly-connected-component check runs on the automaton and reports any component that mixes accepting and non-accepting states.`,
          `Branching is permitted; since it buys no power, a machine drawn here typically contains a guess that a deterministic weak automaton would not need.`,
          `Input is an ultimately periodic word <code>u(v)</code>.`))
    ]
  }
};

// ──────────────────────────────────────────────────────────────────
//  MEMORY AUTOMATA
// ──────────────────────────────────────────────────────────────────
const MEM_GUIDES = {
  'DPDA': {
    slug: 'dpda',
    title: 'Deterministic Pushdown Automaton',
    tagline: 'A finite automaton with one stack and no guessing',
    accent: 'var(--green)',
    klass: 'Deterministic context-free languages',
    sections: [
      sec('What it is',
        p(`A DPDA is a finite automaton with a <b>stack</b>: an unbounded store that may only be read and modified at one end. Each move looks at the current state, optionally the next input symbol, and the symbol on top of the stack; it then changes state, consumes the input symbol (or not), pops the top symbol and pushes a string in its place.`),
        p(`The stack is what lets the machine handle nesting. The state set is still finite, but the stack can grow without bound, so the machine can remember how deeply nested it currently is — which is precisely what a finite automaton cannot do.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\Gamma,\\ \\delta,\\ q_0,\\ Z_0,\\ F)`),
        ul(
          `<b>Γ</b> is the stack alphabet, disjoint in role from Σ.`,
          `<b>Z₀ ∈ Γ</b> is the initial stack symbol, the bottom marker.`,
          `<b>δ : Q × (Σ ∪ {ε}) × Γ → Q × Γ*</b> — one move, or none.`),
        p(`Determinism is a two-part condition, and the second part is easy to overlook. For every state q and stack symbol X: at most one move is defined for each input symbol a; and if an ε-move δ(q, ε, X) is defined, then no move on any actual input symbol may be defined for that same (q, X). Otherwise the machine would have to choose between reading and not reading.`)),

      sec('How a run works',
        p(`A configuration — traditionally called an <b>instantaneous description</b> — is a triple (q, w, γ): the state, the unread input, and the entire stack contents with the top on the left. The step relation is:`),
        math(`(q,\\ a\\,w,\\ X\\gamma) \\ \\vdash\\ (p,\\ w,\\ \\beta\\gamma) \\quad \\text{when } \\delta(q,a,X) = (p, \\beta)`),
        p(`Pushing β = ε is a pure pop; pushing β = X leaves the stack unchanged; pushing β = YX pushes Y on top of the untouched X. An ε-move is the same relation with a in place of a·w unchanged — the input is not advanced.`)),

      sec('Acceptance',
        p(`Two conventions are in use, and this app supports both as a setting.`),
        ul(
          `<b>By final state</b> (the app's "explicit" paradigm): the stack starts with Z₀ on it, and the machine accepts when the input is exhausted and the current state is in F. Whatever is left on the stack is irrelevant.`,
          `<b>By empty stack</b>: the stack starts empty, F plays no role, and the machine accepts when the input is exhausted and the stack is empty.`),
        p(`For <em>nondeterministic</em> pushdown automata the two conventions are interchangeable and each can be converted to the other. For deterministic ones they are not: acceptance by empty stack forces the language to be <b>prefix-free</b>, because once the stack empties the machine has stopped, so no accepted word can be a proper prefix of another accepted word. Acceptance by final state is therefore the more useful convention here.`)),

      sec('What it can and cannot express',
        p(`The deterministic context-free languages, or DCFLs — a strict subset of the context-free languages. They are exactly the languages a deterministic parser can handle with a single unbounded stack and no backtracking, which is why the class is the theoretical backdrop to practical parsing.`),
        p(`Closure behaviour is unusual and worth memorising, because it is almost the opposite of the nondeterministic case:`),
        ul(
          `<b>Closed</b> under complement — a genuinely non-obvious result, since the machine may fail to consume its input, and the construction has to handle ε-loops and dead ends before flipping the accepting states. Also closed under intersection with a regular language, and under inverse homomorphism.`,
          `<b>Not closed</b> under union, intersection, concatenation, Kleene star, reversal or homomorphism. The classic witness: {aⁿbⁿcᵐ} and {aⁿbᵐcᵐ} are both DCFLs, but their union is context-free and not deterministic, and their intersection {aⁿbⁿcⁿ} is not even context-free.`),
        p(`Decidability is better than for the general model: membership is linear, emptiness and finiteness are decidable, universality is decidable (by complementing), and — a deep result — <b>equivalence of two DPDAs is decidable</b>, in sharp contrast to the undecidability of equivalence for nondeterministic pushdown automata.`),
        p(`Typical DCFLs: balanced brackets over any number of bracket types, {aⁿbⁿ}, and {wcw<sup>R</sup>} where an explicit centre marker c tells the machine when to switch from pushing to popping. Typical non-DCFL: the even-length palindromes {ww<sup>R</sup>}, where without a marker the machine must guess the midpoint.`)),

      sec('In this editor',
        ul(
          `The editor refuses an overlapping move and tells you to switch to NPDA if branching is intended. If an overlap survives into a run — from a loaded or imported file — the simulator reports it rather than silently picking a branch.`,
          `The pop field takes exactly one symbol (or ε); the push field takes a string, written top-of-stack first, so pushing <code>AB</code> leaves A above B.`,
          `A <b>Σ</b> in the push field re-pushes whatever was just popped, which is a convenient way to write "look at the top without disturbing it".`,
          `Choose the acceptance paradigm in Settings. The Formal Definition box changes shape with it — the 7-tuple with Z₀ and F for final-state acceptance, the 5-tuple without them for empty-stack.`,
          `<b>PDA</b> in saved files is an alias for this model and behaves identically.`))
    ]
  },

  'NPDA': {
    slug: 'npda',
    title: 'Nondeterministic Pushdown Automaton',
    tagline: 'One stack plus guessing: exactly the context-free languages',
    accent: 'var(--green)',
    klass: 'Context-free languages',
    sections: [
      sec('What it is',
        p(`An NPDA is a pushdown automaton that may offer several moves for the same configuration. It accepts a word if some sequence of choices leads to acceptance. That freedom is not cosmetic here — unlike every other model in this app, nondeterminism genuinely increases what a pushdown machine can recognise.`),
        p(`The reason is easy to see with palindromes. To recognise {w w<sup>R</sup>} the machine must push the first half and pop the second, and nothing in the input marks where the halves meet. A nondeterministic machine simply guesses the midpoint; a deterministic one has no way to find it.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\Gamma,\\ \\delta,\\ q_0,\\ Z_0,\\ F) \\qquad \\delta : Q \\times (\\Sigma \\cup \\{\\varepsilon\\}) \\times \\Gamma \\to \\mathcal{P}(Q \\times \\Gamma^*)`),
        p(`The image is a <em>finite set</em> of (next state, push string) pairs. Everything else matches the deterministic definition, minus the determinism conditions.`)),

      sec('How a run works',
        p(`Configurations are instantaneous descriptions (q, w, γ) as before, but ⊢ is now a relation with branching. A single input word induces a tree of configurations, and the machine may also have infinite branches, because an ε-move that pushes without consuming input can repeat forever.`)),

      sec('Acceptance',
        p(`By final state with input consumed, or by empty stack with input consumed — the two conventions are equivalent for nondeterministic machines, and each converts to the other with a few extra states and a fresh bottom marker. Acceptance requires <em>some</em> branch to succeed.`)),

      sec('Equivalence with context-free grammars',
        p(`The languages accepted by NPDAs are exactly those generated by context-free grammars, and both directions of the equivalence are constructions this app implements.`),
        p(`<b>Grammar to machine (top-down).</b> Use one state. Put the start variable on the stack. If the top of the stack is a variable A, nondeterministically replace it by the right-hand side of some production A → α. If the top is a terminal, it must match the next input symbol; consume and pop. The stack is then a partially expanded sentential form, and an accepting run is exactly a leftmost derivation.`),
        p(`<b>Machine to grammar.</b> Introduce a variable [p A q] for every state pair and stack symbol, intended to generate exactly the words that take the machine from state p with A on top to state q with that A removed. The productions mirror the moves: pushing several symbols becomes a chain of such variables, one per symbol that must eventually be popped. The start variable is [q₀ Z₀ f] summed over accepting f.`)),

      sec('What it can and cannot express',
        p(`Exactly the context-free languages. Closure behaviour, again nearly the mirror image of the deterministic case:`),
        ul(
          `<b>Closed</b> under union, concatenation, Kleene star, reversal, homomorphism, inverse homomorphism, and — importantly — <b>intersection with a regular language</b>. The last is proved by a product construction that runs a finite automaton alongside the pushdown machine, and it is the workhorse of most non-context-freeness proofs.`,
          `<b>Not closed</b> under intersection or complement. A pushdown machine has one stack, and checking the intersection of two context-free conditions generally needs two independent stacks — which, as the two-stack model shows, is already full Turing power. The standard witness: {aⁿbⁿcᵐ} ∩ {aᵐbⁿcⁿ} = {aⁿbⁿcⁿ}, which is not context-free.`),
        p(`Decidability splits sharply. <b>Decidable:</b> membership (in cubic time, by the CYK algorithm on a grammar in Chomsky normal form), emptiness, and finiteness. <b>Undecidable:</b> equivalence of two context-free languages, universality, whether the language is regular, whether a grammar is ambiguous, and whether the intersection of two context-free languages is empty.`),
        p(`The pumping lemma for this class splits a long word into five parts, w = uvxyz with |vxy| ≤ p and |vy| ≥ 1, such that uvⁱxyⁱz ∈ L for all i ≥ 0 — two segments pumped in lockstep, reflecting the two sides of a nested structure. It is what shows {aⁿbⁿcⁿ} and {ww} are not context-free.`)),

      sec('In this editor',
        ul(
          `Branching is permitted; the simulator explores configurations breadth-first and reports the first accepting branch, then linearises it into a scrubable trace.`,
          `Breadth-first is not an implementation detail. A depth-first search could descend forever into an ε-loop that pushes without consuming, and never reach the accepting branch beside it.`,
          `The step budget is <code>maxPdaSteps</code> in Settings; exhausting it is reported as an exploration limit, not as a rejection.`,
          `Push strings are written top-of-stack first, and <b>Σ</b> in the push field re-pushes what was popped.`))
    ]
  },

  'QA': {
    slug: 'qa',
    title: 'Queue Automaton',
    tagline: 'Swap the stack for a queue and you have a Turing machine',
    accent: 'var(--green)',
    klass: 'Recursively enumerable',
    sections: [
      sec('What it is',
        p(`A queue automaton has the same shape as a pushdown automaton with one change of discipline: its store is a <b>queue</b> rather than a stack. Symbols are removed from the front and appended at the back — first in, first out — instead of both operations happening at the top.`),
        p(`This single change is dramatic. A stack can only be examined in reverse order, so a pushdown machine forgets the bottom of its store until everything above it is gone. A queue can be <em>rotated</em>: dequeue a symbol from the front and immediately enqueue it at the back, and after one full pass the contents are unchanged but every symbol has been inspected. That ability to walk over the whole store without destroying it is exactly what a Turing machine tape provides.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\Gamma,\\ \\delta,\\ q_0,\\ F) \\qquad \\delta : Q \\times (\\Sigma \\cup \\{\\varepsilon\\}) \\times (\\Gamma \\cup \\{\\varepsilon\\}) \\to \\mathcal{P}(Q \\times \\Gamma^*)`),
        p(`The third argument is the symbol dequeued from the front — ε meaning "do not dequeue" — and the Γ* in the image is the string appended at the back, in order, so enqueueing <code>AB</code> puts A ahead of B.`)),

      sec('How a run works',
        p(`A configuration is (q, w, γ) where γ is the queue contents written front-first. A move optionally reads an input symbol, optionally removes the front symbol of the queue, and appends a string at the back.`),
        math(`(q,\\ a\\,w,\\ X\\gamma) \\ \\vdash\\ (p,\\ w,\\ \\gamma\\beta) \\quad \\text{when } (p,\\beta) \\in \\delta(q,a,X)`),
        p(`Compare this with the pushdown step relation: there, β is placed where X was, at the front; here it goes to the far end. That is the whole difference between the two models.`)),

      sec('Acceptance',
        p(`As for the pushdown family, either by reaching an accepting state with the input consumed, or by emptying the queue with the input consumed, according to the paradigm setting.`)),

      sec('What it can and cannot express',
        p(`A queue automaton is <b>Turing-equivalent</b>: it recognises exactly the recursively enumerable languages, no more and no less. The simulation of a tape machine keeps the entire tape contents in the queue with a marker for the head position, and simulates one tape step by rotating the queue once, rewriting the marked cell as it passes.`),
        p(`Everything that is undecidable for Turing machines is therefore undecidable here. Membership is only semi-decidable — a machine may run forever on a word it does not accept — and emptiness, finiteness, equivalence and universality are all undecidable.`),
        p(`The pedagogical value of the model is precisely this contrast. Nothing about a queue looks more powerful than a stack; it holds the same symbols, one at a time, with the same finite control. The jump comes entirely from the order in which the store may be revisited.`)),

      sec('In this editor',
        ul(
          `The transition modal reuses the pushdown fields, so the pop field means "dequeue from the front" and the push field means "append at the back".`,
          `The trace shows the queue front-first, and labels the inspected end <em>queue front</em> rather than stack top.`,
          `A <b>Σ</b> in the append field re-appends whatever was just dequeued — which is the rotation primitive, and therefore the most useful single idiom in this model.`,
          `Exploration is breadth-first with a step budget, and an exhausted budget is reported as no verdict rather than as rejection — appropriate for a model where non-termination is unavoidable.`))
    ]
  },

  'Counter': {
    slug: 'counter',
    title: 'Counter Machine',
    tagline: 'A pushdown automaton whose stack holds a single number',
    accent: 'var(--green)',
    klass: 'One-counter languages',
    sections: [
      sec('What it is',
        p(`A counter machine is a pushdown automaton whose stack alphabet has been cut down to two symbols: one counter symbol, and the bottom marker Z. A stack over such an alphabet holds no information beyond its height, so it <em>is</em> a natural number, and the only operations are increment, decrement, and testing whether it is zero.`),
        p(`The zero test is what the bottom marker provides. Seeing Z on top means the counter is empty; seeing the counter symbol means it is positive. Without such a test the model would be strictly weaker, because it could never react to having counted back down.`)),

      sec('Formal definition',
        mathLines(
          `M = (Q,\\ \\Sigma,\\ \\{c, Z\\},\\ \\delta,\\ q_0,\\ F)`,
          `\\delta : Q \\times (\\Sigma \\cup \\{\\varepsilon\\}) \\times \\{c, Z, \\varepsilon\\} \\to \\mathcal{P}(Q \\times \\{c, Z, \\varepsilon\\}^*)`),
        p(`This is exactly a pushdown automaton's signature with Γ fixed at two symbols. Writing the store as a number n ≥ 0 instead, a move is: read a (or nothing), observe whether n = 0, then set n to n + 1, n − 1, or n.`)),

      sec('How a run works',
        p(`A configuration is (q, w, n) — state, unread input, counter value. Popping c decrements; pushing cc after popping c increments; leaving Z alone and pushing nothing is the zero test. The counter can never go negative, because a decrement requires the counter symbol to be on top.`)),

      sec('Acceptance',
        p(`By accepting state with the input consumed, or by empty store with the input consumed, following the same paradigm setting as the rest of the pushdown family. Note that "empty store" for a counter machine means the counter has returned to zero and the bottom marker has been removed.`)),

      sec('What it can and cannot express',
        p(`The one-counter languages sit strictly between the regular and the context-free languages:`),
        math(`\\text{Regular} \\subsetneq \\text{One-counter} \\subsetneq \\text{Context-free}`),
        p(`{aⁿbⁿ : n ≥ 0} shows the first inclusion is strict — count up on a's, down on b's, check for zero at the end. Balanced brackets over two different bracket types shows the second is strict: a counter records how deep the nesting is but not which kind of bracket is at each level, so it cannot reject <code>([)]</code>.`),
        p(`The sharp fact about this model is what a <em>second</em> counter would do. A machine with two counters, each with a zero test, is already Turing-equivalent: a tape can be encoded as a pair of numbers, and any number of counters can be simulated by two through prime-power encodings. So one counter is a genuinely intermediate model, and adding one more skips the entire context-free and context-sensitive levels at once.`),
        p(`Emptiness and membership are decidable for one-counter machines; equivalence is undecidable for the nondeterministic version.`)),

      sec('In this editor',
        ul(
          `Switching to this model rewrites Γ to exactly two symbols — the bottom marker and one counter symbol — and the transition editor rejects anything else in the pop and push fields.`,
          `Increment by popping the counter symbol and pushing two of them; decrement by popping one and pushing nothing; test for zero by popping Z and pushing it straight back.`,
          `Everything else — branching, breadth-first exploration, step budget, acceptance paradigm — behaves as for the nondeterministic pushdown automaton.`))
    ]
  },

  '2PDA': {
    slug: 'twopda',
    title: 'Two-Stack Pushdown Automaton',
    tagline: 'A second stack is all it takes to reach Turing power',
    accent: 'var(--green)',
    klass: 'Recursively enumerable',
    sections: [
      sec('What it is',
        p(`A two-stack pushdown automaton has the finite control of an ordinary pushdown machine and two independent stacks. Each move may inspect and modify both at once.`),
        p(`This is the cleanest demonstration in the app that Turing power is not far away. One stack gives the context-free languages; two give everything a Turing machine can do. The reason is a two-line simulation: put the tape contents to the left of the head on stack one with the nearest cell on top, and the contents from the head rightwards on stack two. Moving the head one cell right is popping from stack two and pushing onto stack one, and moving left is the reverse. Writing is popping and pushing a different symbol on stack two.`)),

      sec('Formal definition',
        mathLines(
          `M = (Q,\\ \\Sigma,\\ \\Gamma_1,\\ \\Gamma_2,\\ \\delta,\\ q_0,\\ F)`,
          `\\delta : Q \\times (\\Sigma \\cup \\{\\varepsilon\\}) \\times (\\Gamma_1 \\cup \\{\\varepsilon\\}) \\times (\\Gamma_2 \\cup \\{\\varepsilon\\}) \\to \\mathcal{P}(Q \\times \\Gamma_1^* \\times \\Gamma_2^*)`),
        p(`A move names an input symbol (or ε), a symbol to pop from each stack (or ε for "do not pop"), a next state, and a string to push onto each stack. In this app the two stacks share one alphabet, so Γ₁ = Γ₂ = Γ.`)),

      sec('How a run works',
        p(`A configuration is (q, w, γ₁, γ₂) — state, unread input, and both stack contents written top-first. The two stacks are entirely independent: a move may touch one, the other, both, or neither.`)),

      sec('Acceptance',
        p(`By accepting state with the input consumed, or by empty store with the input consumed. Under the empty-store convention <b>both</b> stacks must be empty — a partial emptying is not acceptance.`)),

      sec('What it can and cannot express',
        p(`Exactly the recursively enumerable languages: the same class as a Turing machine, a queue automaton, or a machine with two counters. Membership is semi-decidable only, and emptiness, finiteness, equivalence and universality are all undecidable.`),
        p(`The languages that motivate the model are the ones a single stack cannot reach. {aⁿbⁿcⁿ} is the standard example — count the a's onto stack one, match the b's off it while counting onto stack two, then match the c's off that. {ww} is another: copy the first half onto one stack, transfer it to the other to reverse it back into order, then compare.`),
        p(`It is worth noticing exactly where the second stack helps. The obstacle for one stack is that popping destroys: after matching a's against b's, the record of how many there were is gone. A second stack is somewhere to put a copy, and once you can keep and re-read arbitrary intermediate results, nothing is left to withhold.`)),

      sec('In this editor',
        ul(
          `The transition editor shows two pop fields and two push fields; the edge label writes them as <code>read, pop₁/pop₂ → push₁/push₂</code>.`,
          `The trace shows both stacks in the instantaneous description, separated by a semicolon.`,
          `Exploration is breadth-first over configurations with the pushdown step budget. Because the model is Turing-equivalent, an exhausted budget genuinely means no verdict — there is no way in general to tell a long computation from a non-terminating one.`))
    ]
  }
};

// ──────────────────────────────────────────────────────────────────
//  TURING MACHINES
// ──────────────────────────────────────────────────────────────────
const TM_GUIDES = {
  'TM': {
    slug: 'tm',
    title: 'Deterministic Turing Machine',
    tagline: 'A read/write head on an unbounded tape',
    accent: 'var(--orange)',
    klass: 'Recursively enumerable (decidable when it always halts)',
    sections: [
      sec('What it is',
        p(`A Turing machine has a finite control and an unbounded <b>tape</b> divided into cells, with a head that reads the cell under it, writes a symbol back, and moves one cell left or right (or stays put). The input is written on the tape at the start; every other cell holds the blank symbol.`),
        p(`Two features distinguish it from everything below it in the hierarchy. The store can be re-read in any order and any number of times, unlike a stack. And the machine controls when it stops: it is not obliged to consume its input and halt, and may run forever.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\Gamma,\\ \\delta,\\ q_0,\\ F) \\qquad \\delta : Q \\times \\Gamma \\to Q \\times \\Gamma \\times \\{L, R, S\\}`),
        ul(
          `<b>Γ ⊇ Σ</b> is the tape alphabet and always contains the blank symbol ⊔, which is not in Σ. The blank being outside Σ is what lets the machine tell where the input ends.`,
          `<b>δ</b> is partial: an undefined entry means the machine halts.`,
          `<b>F</b> is the set of accepting states. Some presentations use a single q_accept and a single q_reject instead; the difference is cosmetic, and this app uses an accepting set for consistency with the other models.`)),

      sec('How a run works',
        p(`A configuration is the entire tape contents, the head position and the state. It is written compactly as u q v — the tape to the left of the head, the state, and the tape from the head rightwards — which is finite because all but finitely many cells are blank. One step reads the symbol under the head, writes, moves, and changes state, exactly as δ prescribes.`),
        p(`In this app the tape is infinite to the right and bounded on the left at cell 0; a move left from cell 0 leaves the head where it is. Choose the <b>two-way infinite</b> variant if you want an unbounded tape in both directions; it recognises the same languages.`)),

      sec('Acceptance, and the three outcomes',
        p(`Unlike every model above, a run has three possible fates, not two:`),
        ul(
          `<b>Accept</b> — the machine enters an accepting state.`,
          `<b>Reject</b> — the machine halts in a non-accepting state, with no applicable transition.`,
          `<b>Never halts</b> — the machine runs forever.`),
        p(`This is the distinction that organises all of computability. M <b>recognises</b> L if it accepts exactly the words of L, and is allowed to run forever on the ones outside. M <b>decides</b> L if additionally it halts on every input. A language with a recogniser is <em>recursively enumerable</em>; a language with a decider is <em>recursive</em>, or decidable. Every decidable language is recursively enumerable and the inclusion is strict.`),
        p(`The useful characterisation is: L is decidable exactly when both L and its complement are recursively enumerable. If you can eventually confirm membership and eventually confirm non-membership, running both procedures side by side decides L.`)),

      sec('What it can and cannot express',
        p(`The <b>Church–Turing thesis</b> is the claim — not a theorem, since "effectively calculable" is not a formal notion — that anything computable by any mechanical procedure whatsoever is computable by a Turing machine. Its evidence is the remarkable convergence of every alternative model proposed: multi-tape machines, two-stack machines, queue machines, two-counter machines, register machines, lambda calculus and general recursive functions all define exactly the same class of computable functions.`),
        p(`What lies outside is described by the undecidability results:`),
        ul(
          `<b>A<sub>TM</sub> = {⟨M, w⟩ : M accepts w}</b> is undecidable. The proof is a diagonal argument: assume a decider H, build a machine D that runs H on ⟨D, D⟩ and does the opposite, and ask what D does on itself.`,
          `<b>HALT<sub>TM</sub></b>, the question of whether a given machine halts on a given input, is undecidable — proved by reducing A<sub>TM</sub> to it.`,
          `<b>Rice's theorem</b> generalises all of these: <em>every</em> non-trivial property of the language a machine recognises is undecidable. "Non-trivial" means some machine has it and some machine does not, and "property of the language" means it depends on L(M), not on how M is written. So emptiness, finiteness, regularity and "does it accept 01?" are all undecidable, while "does M have seven states?" is decidable because it is a property of the description rather than of the language.`),
        p(`Reductions are the tool for spreading these results. If A reduces to B then a decider for B yields a decider for A — so easiness flows backwards along a reduction, and hardness flows forwards.`)),

      sec('In this editor',
        ul(
          `δ must be single-valued; the editor refuses a second transition for the same state and read symbol. Choose <b>NDTM</b> for branching.`,
          `Missing transition means halt-and-reject. Enter an accepting state and the run stops immediately with an accept.`,
          `A <b>Σ</b> in the write field leaves the cell unchanged, which is the usual way to write a move that only scans.`,
          `The simulator detects a repeated configuration and reports it as a <em>proven</em> non-halt rather than a timeout: a deterministic machine that repeats a configuration will repeat it forever. If instead the step budget expires the verdict is <em>no verdict</em> — never a rejection, since that would be asserting something the machine did not decide.`))
    ]
  },

  'NDTM': {
    slug: 'ndtm',
    title: 'Nondeterministic Turing Machine',
    tagline: 'Branching computation; the same languages, a different cost',
    accent: 'var(--orange)',
    klass: 'Recursively enumerable',
    sections: [
      sec('What it is',
        p(`An NDTM may have several applicable moves in a configuration, and it accepts if <em>some</em> sequence of choices leads to an accepting state. Its computation is a tree of configurations rather than a single line.`),
        p(`Nondeterminism does not increase what a tape machine can recognise. What it changes is how naturally certain algorithms can be written — "guess a factor, then verify it" is one line here and a search loop on a deterministic machine — and how efficiently they run, which is where the model earns its real importance.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\Gamma,\\ \\delta,\\ q_0,\\ F) \\qquad \\delta : Q \\times \\Gamma \\to \\mathcal{P}(Q \\times \\Gamma \\times \\{L, R, S\\})`),
        p(`Every component but δ is unchanged from the deterministic machine.`)),

      sec('How a run works',
        p(`Each node of the computation tree is a full configuration; each edge is one applicable move. A branch may accept, may halt without accepting, or may go on forever. The word is accepted if any branch — anywhere in the tree, at any depth — reaches an accepting state.`)),

      sec('Simulation by a deterministic machine',
        p(`The construction that shows NDTM and TM recognise the same class is worth understanding, because the naive version of it is wrong. Simulating one branch to completion before trying the next fails: if the first branch never halts, the simulator never reaches the accepting branch beside it, and a machine that would have accepted instead runs forever.`),
        p(`The fix is <b>breadth-first</b> exploration, sometimes called dovetailing: enumerate configurations by depth, running every branch one step at a time in parallel. Any accepting branch is at some finite depth, so it is reached in finite time. The cost is exponential — a tree of branching factor b to depth d has up to b<sup>d</sup> nodes — and no substantially better general method is known.`),
        p(`That cost is the whole content of the P versus NP question. NP is the class of languages a nondeterministic machine decides in polynomial time; P is the class a deterministic one does. Whether the exponential simulation overhead is avoidable in general is exactly the open problem.`)),

      sec('What it can and cannot express',
        p(`Exactly the recursively enumerable languages — identical to the deterministic machine. All the undecidability results transfer unchanged.`),
        p(`One asymmetry is worth flagging. Acceptance requires only one good branch, but rejection requires that <em>every</em> branch halts without accepting. So a machine that rejects must have a finite computation tree, and detecting that is exactly as hard as the halting problem.`)),

      sec('In this editor',
        ul(
          `Several transitions may share a state and read symbol; that is the model.`,
          `Exploration is breadth-first over configurations, so a diverging branch cannot hide an accepting one.`,
          `The trace reports how many branches were explored and the maximum depth reached, and when the budget runs out with branches still queued it says <em>exploration limit reached</em> — not <em>reject</em>, because branches remain that might yet accept.`,
          `The Algorithms view has a dedicated nondeterministic run panel for stepping through the branch tree.`))
    ]
  },

  'MTM': {
    slug: 'mtm',
    title: 'Multi-Tape Turing Machine',
    tagline: 'Several tapes and heads moving independently',
    accent: 'var(--orange)',
    klass: 'Recursively enumerable',
    sections: [
      sec('What it is',
        p(`A k-tape Turing machine has k tapes, each with its own head. A single move reads the symbol under every head at once, then writes a symbol on every tape and moves every head, all in one step. The input starts on tape 1 and the rest begin blank.`),
        p(`It recognises no more than a one-tape machine, but it is enormously more convenient. Copying a string, comparing two strings symbol by symbol, or keeping a counter beside a scratch computation are all direct on separate tapes and require laborious back-and-forth on a single one.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\Gamma,\\ \\delta,\\ q_0,\\ F) \\qquad \\delta : Q \\times \\Gamma^{k} \\to Q \\times \\Gamma^{k} \\times \\{L, R, S\\}^{k}`),
        p(`δ consumes a k-tuple of read symbols and produces a next state, a k-tuple of symbols to write, and a k-tuple of head directions. The heads move independently — one may go left while another goes right or stays.`)),

      sec('How a run works',
        p(`A configuration is the state together with all k tape contents and all k head positions. Because the whole tuple is read and written atomically, there is no notion of one tape being "current".`)),

      sec('Simulation by a single tape',
        p(`A one-tape machine simulates a k-tape one by dividing its tape into 2k <b>tracks</b> — one holding each tape's contents, one marking each head's position — with all tracks packed into a single cell alphabet Γ<sup>2k</sup>. To simulate one multi-tape step the simulator scans across the whole used region once to collect the k marked symbols, then scans back to write and shift the marks.`),
        p(`If the multi-tape machine runs for t steps, the used region is at most O(t) cells wide, so each simulated step costs O(t) and the total is <b>O(t²)</b>. This quadratic overhead is the reason complexity classes closed under polynomial change — P, NP, PSPACE — do not depend on how many tapes the model has. It also shows why the number of tapes matters for fine-grained results: some problems are provably faster with two tapes than with one.`)),

      sec('What it can and cannot express',
        p(`Exactly the recursively enumerable languages, for every fixed k ≥ 1. Adding tapes changes speed, never power.`)),

      sec('In this editor',
        ul(
          `The tape count is a control on the toolbar and ranges from two to four. Changing it clears the existing transitions, because a transition's read tuple has a fixed arity and a two-tape rule is not a three-tape rule.`,
          `Each transition names one read symbol, one write symbol and one direction per tape. The editor refuses two transitions whose read tuples overlap, so δ stays single-valued.`,
          `The batch runner accepts a separate initial word per tape, so you can start the machine with data already staged on tapes 2 and above.`,
          `Loop detection covers the whole configuration — every tape and every head — so a repeated configuration is reported as a proven non-halt.`))
    ]
  },

  'LBA': {
    slug: 'lba',
    title: 'Linear Bounded Automaton',
    tagline: 'A Turing machine confined to the space its input occupies',
    accent: 'var(--orange)',
    klass: 'Context-sensitive languages',
    sections: [
      sec('What it is',
        p(`An LBA is a Turing machine whose tape is exactly the region the input occupies, framed by the endmarkers ⊢ and ⊣. It may read and write freely inside that region and move in both directions, but it may not move past either marker and may not overwrite them.`),
        p(`Restricting space rather than time is what makes this model interesting. It is far stronger than a pushdown automaton, because it may revisit and rewrite any cell, yet it retains the one property a general Turing machine lacks: it always has a decidable membership problem.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\Gamma,\\ \\delta,\\ q_0,\\ F) \\qquad \\delta : Q \\times \\Gamma \\to Q \\times \\Gamma \\times \\{L, R, S\\}`),
        p(`The signature is a Turing machine's; the model is the signature plus the space constraint:`),
        math(`|\\text{tape}| \\le |w| \\quad \\text{with } \\vdash \\text{ and } \\dashv \\text{ fixed at the ends}`),
        p(`The name comes from the general version, where the tape may be any <em>linear</em> function of the input length — c · |w| cells for a constant c. That adds nothing, since a larger alphabet packs c cells into one, which is why the definition can be stated with exactly |w| cells.`)),

      sec('How a run works',
        p(`A configuration is (state, tape contents, head position) over a tape of fixed length n + 2. The number of distinct configurations is therefore finite:`),
        math(`|Q| \\times (n+2) \\times |\\Gamma|^{\\,n+2}`),
        p(`Large, but finite — and everything else about the model follows from that one fact.`)),

      sec('Acceptance and decidability',
        p(`The machine accepts by entering an accepting state, and rejects by halting with no applicable transition or by attempting to move past a marker.`),
        p(`Because the configuration space is finite, membership is <b>decidable</b>: run the machine and count steps; if it exceeds the number of possible configurations without halting, it must have repeated one, and a deterministic machine that repeats a configuration loops forever. This is the sharpest available illustration of how bounding a resource converts recognition into decision.`),
        p(`Almost everything else remains undecidable. Emptiness, finiteness, equivalence and universality for LBAs are all undecidable — bounding the space per input does not bound the set of inputs.`)),

      sec('What it can and cannot express',
        p(`<b>Nondeterministic</b> LBAs recognise exactly the <b>context-sensitive</b> languages — the Type 1 languages, generated by grammars whose productions never shorten the sentential form (α → β with |α| ≤ |β|). The non-shortening condition is precisely what keeps a derivation inside the space its result occupies, which is the grammatical face of the same restriction.`),
        p(`{aⁿbⁿcⁿ} is the standard example: not context-free, but easily checked in place by repeatedly crossing off one a, one b and one c. Context-sensitive languages are closed under union, intersection, complement, concatenation and star. Closure under complement is a striking result — for a nondeterministic space-bounded machine, the complement can be recognised within the same space bound by counting reachable configurations.`),
        p(`Whether <em>deterministic</em> LBAs are as powerful as nondeterministic ones is a long-standing open question. This app's LBA is deterministic.`)),

      sec('In this editor',
        ul(
          `⊢ and ⊣ are reserved symbols: valid to read, but the left panel will not add them to Σ, and a write to a marker cell is ignored so the frame cannot be destroyed.`,
          `A move that would take the head outside the marked region halts the run with a rejection, naming the boundary it tried to cross.`,
          `δ must be single-valued; the editor enforces it.`,
          `Loop detection applies, and because the configuration space is finite it will always eventually fire on a non-halting run — the reason membership here is genuinely decidable rather than merely usually terminating.`))
    ]
  },

  'ITM': {
    slug: 'itm',
    title: 'Two-Way Infinite Turing Machine',
    tagline: 'The same machine, with no left edge to the tape',
    accent: 'var(--orange)',
    klass: 'Recursively enumerable',
    sections: [
      sec('What it is',
        p(`This is an ordinary deterministic Turing machine whose tape extends without bound in <em>both</em> directions. The cells are indexed by the integers rather than the naturals, so there is no leftmost cell and no boundary to bump into.`),
        p(`It is a convenience variant. Algorithms that naturally build a result to the left of their input, or that want scratch space on either side, are simpler to write without a left edge to manage.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\Gamma,\\ \\delta,\\ q_0,\\ F) \\qquad \\delta : Q \\times \\Gamma \\to Q \\times \\Gamma \\times \\{L, R, S\\}`),
        p(`Identical to the one-way machine's, with one change to the model rather than the tuple: the tape index set is ℤ. The input occupies cells 0 through |w| − 1 and every other cell is blank.`)),

      sec('How a run works',
        p(`A configuration is the state, the head's integer position, and the contents of the finitely many non-blank cells. Steps proceed exactly as for a one-way machine; the only difference is that a move left from cell 0 goes to cell −1 rather than being blocked.`)),

      sec('Why it has the same power',
        p(`A one-way infinite tape can simulate a two-way one by <b>folding</b>. Cut the two-way tape at the origin and lay the two halves on top of each other, so that one-way cell i holds the pair (cell i, cell −i − 1) of the original. The tape alphabet becomes Γ × Γ, and the machine's state records which of the two tracks it is currently working on, flipping the meaning of "left" and "right" when it crosses the fold.`),
        p(`Simulation in the other direction is trivial — just never use the negative cells. So both variants recognise exactly the recursively enumerable languages, and the choice between them is purely a matter of which is more comfortable to program.`)),

      sec('In this editor',
        ul(
          `The tape is stored sparsely over ℤ, so negative positions cost nothing; the displayed window grows to cover whichever cells have been visited or written.`,
          `Writing a blank removes the cell from the store rather than recording it, which keeps the displayed tape trimmed to the interesting region.`,
          `δ must be single-valued, and loop detection compares the whole visited tape and normalised head position, so a repeated configuration is reported as a proven non-halt.`,
          `An expired step budget is reported as no verdict, not as a rejection.`))
    ]
  }
};

// ──────────────────────────────────────────────────────────────────
//  TRANSDUCERS
// ──────────────────────────────────────────────────────────────────
const TRANSDUCER_GUIDES = {
  'Moore': {
    slug: 'moore',
    title: 'Moore Machine',
    tagline: 'Output attached to states, emitted on arrival',
    accent: 'var(--gold)',
    klass: 'Sequential functions',
    sections: [
      sec('What it is',
        p(`A Moore machine is a deterministic finite automaton that produces output instead of (or as well as) a yes/no answer. Each <em>state</em> carries an output symbol, and the machine emits that symbol whenever it is in that state.`),
        p(`The defining consequence is that output depends only on where the machine is, never on the symbol that brought it there. Since the machine is in q₀ before it has read anything, a Moore machine emits one symbol before any input arrives.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\Delta,\\ \\delta,\\ \\lambda,\\ q_0)`),
        ul(
          `<b>Δ</b> is the output alphabet.`,
          `<b>δ : Q × Σ → Q</b> is the transition function, total and single-valued.`,
          `<b>λ : Q → Δ</b> is the output function, defined on states.`),
        p(`There is no F in the basic definition: a transducer transforms rather than decides. This app can optionally add acceptance on top, which is what the "transducer accepts" setting controls.`)),

      sec('The output',
        p(`On input a₁a₂…a_n the machine passes through states q₀, q₁, …, q_n, and the output is:`),
        math(`\\lambda(q_0)\\, \\lambda(q_1) \\cdots \\lambda(q_n)`),
        p(`That is <b>n + 1</b> symbols for an input of length n. The leading λ(q₀) is emitted before any symbol is read and is a real part of the output, not an artefact — it is the machine's initial state made visible.`)),

      sec('Relationship to Mealy machines',
        p(`Moore and Mealy machines compute the same transformations, up to that leading symbol.`),
        p(`<b>Moore to Mealy</b> is easy: give each transition the output of the state it leads to, so λ′(q, a) = λ(δ(q, a)), and discard the initial λ(q₀). The state count is unchanged.`),
        p(`<b>Mealy to Moore</b> generally needs more states. Because a Moore state must have a single output but may be reached by transitions carrying different outputs, each state is split into one copy per incoming output symbol — up to |Q| × |Δ| states in the worst case. Both conversions are in the Algorithms view.`),
        p(`Practically, Moore machines are the natural fit where output must be stable between clock edges, since it changes only when the state does. Mealy machines react within the same step and are usually smaller.`)),

      sec('What it can and cannot express',
        p(`Moore machines compute exactly the <b>sequential functions</b> that are computable with finite memory: the i-th output symbol depends only on the first i input symbols, and the dependence is determined by finitely many distinguishable histories. They cannot reverse a string, duplicate it, or perform any transformation where an early output depends on a later input — for that you need a two-way transducer.`),
        p(`If every state's output is taken from {0, 1} and 1 is read as "accept", a Moore machine is exactly a DFA, which is why the model sits so close to the finite automata.`)),

      sec('In this editor',
        ul(
          `Output lives on the <em>state</em>, set from the state editor and drawn as a second line under the state's name. Edges carry no output for this model — the only transducer of which that is true.`,
          `δ must be single-valued: the editor refuses a second transition for the same state and symbol.`,
          `A missing transition halts the run; the output produced so far is kept and shown.`,
          `The "transducer accepts" setting decides whether F is used at all. With it off, the machine reports only its output; with it on, the double ring and an accept/reject verdict come back as well.`,
          `Note that the sub-label slot under a state name is shared with the parity automata's priority. The two never coexist, since no machine is both.`))
    ]
  },

  'Mealy': {
    slug: 'mealy',
    title: 'Mealy Machine',
    tagline: 'Output attached to transitions, emitted as each symbol is read',
    accent: 'var(--gold)',
    klass: 'Sequential functions',
    sections: [
      sec('What it is',
        p(`A Mealy machine attaches its output to <em>transitions</em> rather than to states. Reading a symbol emits a symbol, so the output depends on the current state and the symbol being read together.`),
        p(`This makes the machine react in the same step as the input arrives, and it makes the output exactly as long as the input. A serial adder is the archetypal example: each pair of bits produces its sum bit immediately, while the state carries only the carry.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\Delta,\\ \\delta,\\ \\lambda,\\ q_0)`),
        ul(
          `<b>δ : Q × Σ → Q</b> — the transition function, total and single-valued.`,
          `<b>λ : Q × Σ → Δ</b> — the output function, defined on state and input symbol.`),
        p(`As with Moore machines there is no F in the basic definition; acceptance is optional and controlled by a setting in this app.`)),

      sec('The output',
        p(`On input a₁a₂…a_n with states q₀, q₁, …, q_n the output is:`),
        math(`\\lambda(q_0, a_1)\\, \\lambda(q_1, a_2) \\cdots \\lambda(q_{n-1}, a_n)`),
        p(`Exactly <b>n</b> symbols for an input of length n, and nothing at all on the empty input. The one-to-one correspondence between input and output positions is the model's most useful property.`)),

      sec('Relationship to Moore machines',
        p(`The two models define the same class of transformations up to the leading symbol a Moore machine emits before reading. Converting <b>Moore to Mealy</b> keeps the state count: each edge takes the output of its destination state. Converting <b>Mealy to Moore</b> may multiply the states by up to |Δ|, since a Moore state must have one fixed output and so has to be split by the output of the transitions arriving at it.`),
        p(`For the same transformation, a Mealy machine is therefore never larger than the corresponding Moore machine and is often smaller. Both conversions are available in the Algorithms view.`)),

      sec('What it can and cannot express',
        p(`The same sequential functions as a Moore machine: each output symbol depends only on the input read so far. No finite-memory one-way transducer can reverse its input or emit a copy of it twice, because the first output symbol would have to depend on the last input symbol.`)),

      sec('In this editor',
        ul(
          `Output lives on the edge, alongside the read symbol; the label reads <code>read / output</code>.`,
          `δ must be single-valued — the editor refuses two transitions for the same state and symbol, since each input symbol must map to one output.`,
          `A missing transition halts the run and the output so far is reported.`,
          `The "transducer accepts" setting decides whether an accept/reject verdict is shown alongside the output.`))
    ]
  },

  'FST': {
    slug: 'fst',
    title: 'Finite State Transducer',
    tagline: 'Nondeterministic, with ε moves and whole strings as output',
    accent: 'var(--gold)',
    klass: 'Rational relations',
    sections: [
      sec('What it is',
        p(`An FST is the general one-way transducer: it may branch, it may move without consuming input, and each move may emit a string of any length — including the empty string — rather than exactly one symbol.`),
        p(`Because it may branch, an FST does not in general compute a function. One input may be related to many outputs, or to none. What it defines is a <b>relation</b> between input words and output words, and that generality is exactly what makes the model useful for describing rewriting, normalisation and alignment.`)),

      sec('Formal definition',
        math(`M = (Q,\\ \\Sigma,\\ \\Delta,\\ \\delta,\\ \\lambda,\\ q_0,\\ F)`),
        ul(
          `<b>δ : Q × (Σ ∪ {ε}) → 𝒫(Q)</b> — nondeterministic, with ε moves.`,
          `<b>λ : Q × (Σ ∪ {ε}) × Q → Δ*</b> — the output written when a particular edge is taken. Δ* rather than Δ, so a move may emit several symbols or none.`,
          `<b>F ⊆ Q</b> — used when the transducer is required to end in an accepting state.`),
        p(`The relation computed is the set of pairs (input consumed, output emitted) over all accepting runs.`)),

      sec('How a run works',
        p(`Each move consumes a symbol or nothing, moves to a next state, and appends its output string to what has been emitted so far. Different branches may produce different outputs from the same input, so a run must be identified with its whole path, not just its endpoint.`),
        p(`Because ε moves may emit output, an FST can produce output without consuming input — and a cycle of ε moves that emits can produce unboundedly long output from a fixed input.`)),

      sec('What it can and cannot express',
        p(`The relations computed by finite state transducers are the <b>rational relations</b>. Their properties are noticeably weaker than those of regular languages, and the differences are the point of the model:`),
        ul(
          `<b>Closed</b> under union, composition, inverse (swap the input and output labels on every edge), and Kleene star.`,
          `<b>Not closed</b> under intersection or complement. The intersection of two rational relations need not be rational, which is a real contrast with regular languages and follows from the fact that the two relations may consume their inputs at different rates.`,
          `The <b>image</b> of a regular language under a rational relation is regular, and so is the preimage. This is what makes transducers usable as language transformations rather than only as string transformations.`),
        p(`On decidability: whether a rational relation is empty is decidable, and so is whether a given transducer is <em>functional</em> — that is, whether it relates each input to at most one output. Equivalence of two rational relations is undecidable in general, but becomes decidable once both transducers are known to be functional.`),
        p(`Like the Moore and Mealy machines, an FST reads in one direction only, so it cannot reverse or duplicate its input. Nondeterminism does not help with that: the first output symbol still cannot depend on the last input symbol.`)),

      sec('In this editor',
        ul(
          `Branching and ε moves are both permitted, and the output field takes a string rather than a single symbol — leave it empty to emit nothing.`,
          `The simulator explores branches breadth-first and reports the output of the first accepting branch it reaches.`,
          `The "transducer accepts" setting decides whether F is consulted. With it off, any halting branch counts and the reported output is simply what that branch produced.`))
    ]
  },

  'PDT': {
    slug: 'pdt',
    title: 'Pushdown Transducer',
    tagline: 'A pushdown automaton that writes as it goes',
    accent: 'var(--gold)',
    klass: 'Pushdown transductions',
    sections: [
      sec('What it is',
        p(`A pushdown transducer is a nondeterministic pushdown automaton with an output string attached to every move. It has the stack of an NPDA and the output behaviour of an FST, which lets it transform nested structure rather than just recognise it.`),
        p(`This is the model behind syntax-directed translation: a parser that emits code, or reformatted text, or a tree, as it recognises the grammatical structure of its input.`)),

      sec('Formal definition',
        mathLines(
          `M = (Q,\\ \\Sigma,\\ \\Gamma,\\ \\Delta,\\ \\delta,\\ \\lambda,\\ q_0,\\ F)`,
          `\\delta : Q \\times (\\Sigma \\cup \\{\\varepsilon\\}) \\times \\Gamma \\to \\mathcal{P}(Q \\times \\Gamma^* \\times \\Delta^*)`),
        p(`Each move names a next state, a string to push in place of the popped symbol, and a string to emit. Reading the signature from the inside out: it is the NPDA's transition function with an extra Δ* component in the image.`)),

      sec('How a run works',
        p(`A configuration is (q, w, γ, y): state, unread input, stack contents, and output produced so far. A move optionally consumes an input symbol, pops the top of the stack, pushes a string in its place, and appends its output to y.`),
        p(`Since the model is nondeterministic, different branches produce different outputs, and the transduction is the set of (input, output) pairs from accepting runs.`)),

      sec('What it can and cannot express',
        p(`The relations computed are the <b>pushdown transductions</b>, and the useful facts about them mirror the pushdown language results:`),
        ul(
          `The <b>image of a regular language</b> under a pushdown transduction is context-free — a direct consequence of the stack being available to the machine that computes it.`,
          `The <b>domain</b> of a pushdown transducer, meaning the set of inputs on which some accepting run exists, is a context-free language. Its <b>range</b> is context-free too.`,
          `The class is closed under union and under composition with a rational relation, but not under intersection or complement, inheriting the pushdown model's asymmetries.`),
        p(`What the stack buys over an FST is transformations sensitive to nesting. Reversing an input is the simplest example — push every symbol, then pop and emit, and the output comes out backwards for free — and reversal is provably impossible for any one-way finite transducer. Mapping aⁿbⁿ to bⁿaⁿ is the same idea with a counted structure.`)),

      sec('In this editor',
        ul(
          `The transition editor shows the pushdown fields — read, pop, push — plus an output field; the edge label reads <code>read, pop → push / output</code>.`,
          `Branching is permitted; exploration is breadth-first over configurations with the pushdown step budget, and the trace carries the output produced at each step alongside the stack.`,
          `The acceptance paradigm setting applies here as it does to the other pushdown machines, and the "transducer accepts" setting decides whether a verdict is shown next to the output.`,
          `The stack is shown top-first in the instantaneous description, as for the NPDA.`))
    ]
  },

  '2DFT': {
    slug: 'twodft',
    title: 'Two-Way Deterministic Finite Transducer',
    tagline: 'A two-way head that emits output on every move',
    accent: 'var(--gold)',
    klass: 'Regular functions',
    sections: [
      sec('What it is',
        p(`A 2DFT is a two-way deterministic finite automaton — a read-only head over ⊢w⊣, free to move left, right or stay — that emits a string of output on every move. It has no stack and no writable tape; its only memory is its finite state and the position of its head.`),
        p(`Being able to re-read the input is what makes this model strictly stronger than every one-way transducer. A one-way machine has committed to its output prefix by the time it reaches the end of the input; a two-way machine can go back and read the input again, as many times as it likes.`)),

      sec('Formal definition',
        mathLines(
          `M = (Q,\\ \\Sigma,\\ \\Delta,\\ \\delta,\\ \\lambda,\\ q_0,\\ F)`,
          `\\delta : Q \\times (\\Sigma \\cup \\{\\vdash, \\dashv\\}) \\to Q \\times \\{L, R, S\\}`,
          `\\lambda : Q \\times (\\Sigma \\cup \\{\\vdash, \\dashv\\}) \\to \\Delta^*`),
        p(`δ gives the next state and head direction; λ gives the string emitted by that same move, possibly empty. Both are single-valued, so the machine has exactly one run per input.`)),

      sec('How a run works',
        p(`A configuration is (q, i, y): state, head position on the fixed tape ⊢w⊣, and output emitted so far. Each step reads the symbol under the head, appends λ's output to y, then moves as δ says. The head may not cross either endmarker.`),
        p(`Like a 2DFA, a 2DFT may loop forever — and unlike a 2DFA, a loop that emits output produces an unbounded result rather than merely failing to halt.`)),

      sec('What it can and cannot express',
        p(`Two-way deterministic transducers compute exactly the <b>regular functions</b> — the string-to-string functions definable in monadic second-order logic. This class strictly contains the sequential functions computed by Moore, Mealy and one-way finite transducers, and the separating examples are simple:`),
        ul(
          `<b>Reverse:</b> w ↦ w<sup>R</sup>. Walk to ⊣, then emit each symbol while walking back to ⊢. Impossible one-way, since the first output symbol is the last input symbol.`,
          `<b>Duplicate:</b> w ↦ ww. Scan the input emitting it, return to the start without emitting, then scan again emitting it a second time. Impossible one-way for the same reason: after producing the first copy the machine would have to produce it again from memory, and the memory is finite.`),
        p(`Regular functions have output at most linear in the input length for machines that always halt, and the class is closed under composition — composing two regular functions gives another regular function, which is not obvious given that the second machine's passes multiply the first's.`),
        p(`What it still cannot do is anything requiring unbounded storage that is not already in the input. It cannot sort, cannot compute arbitrary arithmetic on the represented values, and cannot produce output that grows faster than linearly in a halting run.`)),

      sec('In this editor',
        ul(
          `⊢ and ⊣ are reserved read symbols; the left panel will not add them to Σ.`,
          `Each edge carries a direction and an output string; leave the output empty to move without emitting. The trace shows the accumulated output beside the head position at every step.`,
          `The editor enforces determinism, and symbol resolution is most-specific-first, so a concrete edge wins over a <b>Σ</b> wildcard.`,
          `A run that exhausts the step budget is reported as no verdict rather than as a rejection — a two-way head can genuinely loop, and calling that a rejection would assert something the machine never decided.`,
          `The "transducer accepts" setting decides whether reaching F is reported as an accept alongside the output.`))
    ]
  }
};

// ──────────────────────────────────────────────────────────────────
//  REGISTRY
// ──────────────────────────────────────────────────────────────────
// Keys match MachineTypes in js/state.js. 'PDA' is deliberately absent: it is a
// hidden alias of DPDA that MachineCategories does not list, and the DPDA guide
// says so in its last bullet.
export const MachineGuides = {
  ...FA_GUIDES,
  ...OMEGA_GUIDES,
  ...MEM_GUIDES,
  ...TM_GUIDES,
  ...TRANSDUCER_GUIDES
};

export function guideFor(machine) {
  return MachineGuides[machine] || null;
}
