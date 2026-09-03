import { math, mathLines, na, no, note, p, sec, semi, table, ul, yes } from './guide-blocks.js';

// ══════════════════════════════════════════════════════════════════
//  CONCEPT GUIDE — CONTENT
// ══════════════════════════════════════════════════════════════════
// The Reference pages that are not about one machine. Same block vocabulary
// and same record shape as js/machine-guide.js — slug, abbr, title, tagline,
// accent, klass, sections — so js/reference.js renders both through one path.
//
// `ConceptCategories` is the ordering: js/reference.js appends these groups
// after the machine categories, in the order given here, and a slug listed in
// a category with no entry in `ConceptGuides` is skipped rather than drawn
// empty. tests/reference.test.js fails on that gap.
//
// Accents carry meaning inside the Decidability group and are not decorative:
// green marks a page whose answers are all "yes, there is an algorithm", red
// marks one where the answers are "no", gold marks a mixed or summary page,
// and the framing pages take the neutral accent.

// ──────────────────────────────────────────────────────────────────
//  DECIDABILITY
// ──────────────────────────────────────────────────────────────────
const DECIDABILITY = {

  'decidable-recognizable': {
    slug: 'decidable-recognizable',
    abbr: 'Decide vs Recognize',
    title: 'Decidable, Recognizable, and Neither',
    tagline: 'The three fates of a computation, and why the difference is the whole subject',
    accent: 'var(--accent)',
    klass: 'Foundations',
    sections: [
      sec('The question this section answers',
        p(`Every page before this one describes a machine and asks what <em>it</em> does with a word. This section asks the harder question one level up: given a machine, or a pair of machines, or a description of a language, which questions <em>about</em> them can be answered by an algorithm at all?`),
        p(`The answer is not a matter of cleverness or of waiting for faster computers. For a large and important collection of questions it can be <em>proved</em> that no algorithm exists, and the proofs are short. What follows builds that boundary from the ground up: first the vocabulary, then the questions that stay answerable, then the ones that do not, then the two techniques that settle almost every case.`)),

      sec('Deciding versus recognizing',
        p(`Recall that a Turing machine has three possible fates on an input: it can accept, it can halt without accepting, or it can run forever. That third outcome is what forces the following pair of definitions apart.`),
        ul(
          `A machine <b>recognizes</b> L if it accepts exactly the words of L. On a word outside L it may reject, or it may run forever — either is permitted.`,
          `A machine <b>decides</b> L if it recognizes L <em>and</em> halts on every input. A decider always gives an answer.`),
        p(`The two definitions name two classes of languages:`),
        ul(
          `L is <b>decidable</b> (also <em>recursive</em>) if some machine decides it.`,
          `L is <b>recognizable</b> (also <em>recursively enumerable</em>, or RE) if some machine recognizes it.`),
        p(`Every decidable language is recognizable, since a decider is in particular a recognizer. The inclusion is strict, and the rest of this section is largely about the gap.`)),

      sec('Why "recognizable" is a real property and not a failure',
        p(`A recognizer sounds like a broken decider, but it corresponds to something you can genuinely do: search. If L is recognizable then membership is <b>semi-decidable</b> — a "yes" always arrives eventually, and only a "no" can leave you waiting forever.`),
        p(`The name <em>recursively enumerable</em> comes from an equivalent formulation. L is recognizable exactly when some machine can <b>enumerate</b> it: print an infinite list on which every member of L appears at least once, in any order, with repeats allowed.`),
        p(`The two directions of that equivalence are both worth seeing. From an enumerator you build a recognizer: on input w, generate list entries and accept as soon as w appears. From a recognizer M you build an enumerator by <b>dovetailing</b> — for k = 1, 2, 3, … run M for k steps on each of the first k words of Σ*, printing any word that has accepted by then. Dovetailing is what stops a single non-halting word from starving all the others, and it is the same trick a nondeterministic machine's breadth-first simulation uses.`)),

      sec('co-recognizable, and the theorem that pins a language down',
        p(`Write L̄ for the complement of L. A language is <b>co-recognizable</b> (co-RE) when its complement is recognizable — that is, when a "no" is what always arrives eventually and a "yes" is what can hang.`),
        p(`These three classes fit together through a single theorem, which is the workhorse of the whole subject:`),
        math(`L \\text{ is decidable} \\iff L \\text{ is recognizable and } \\overline{L} \\text{ is recognizable}`),
        p(`The proof one way is trivial: a decider for L is a recognizer for L, and flipping its answer gives a recognizer for L̄. The other way is the interesting one. Given a recognizer M for L and a recognizer N for L̄, run both on w in parallel, one step of each at a time. Every w is in exactly one of L and L̄, so exactly one of the two must eventually accept, and whichever does gives the verdict. The parallel run always halts, so it decides L.`),
        note(`This is the theorem to reach for when placing a new problem. To prove something undecidable it is enough to show that one of the two halves is not recognizable — and, conversely, once you know a language is recognizable but undecidable, you know immediately that its complement is not recognizable.`)),

      sec('Almost every language is not even recognizable',
        p(`Before any specific problem, a counting argument shows the situation is worse than one hard case here and there.`),
        p(`A Turing machine is a finite object, so it can be written down as a finite string over a fixed alphabet. The set of finite strings over a finite alphabet is <b>countable</b> — list the strings of length 0, then length 1, then length 2, and every string appears at some finite position. So there are only countably many machines, and therefore at most countably many recognizable languages.`),
        p(`But a language is an arbitrary subset of Σ*, and the set of all such subsets is <b>uncountable</b>. So:`),
        math(`|\\{\\text{Turing machines}\\}| = \\aleph_0 \\quad < \\quad |\\mathcal{P}(\\Sigma^*)| = 2^{\\aleph_0}`),
        p(`There are strictly more languages than machines. Almost every language over {a, b} has no machine that recognizes it, let alone decides it. This argument is <em>non-constructive</em> — it exhibits no particular hard language — but it settles the shape of the landscape: undecidability is the ordinary case, and the decidable languages are the thin, well-behaved exception. The rest of this section is about where that exception ends.`)),

      sec('Where the app makes the distinction visible',
        p(`The simulator's verdict is not a two-way switch, and that is deliberate. For the models whose configuration space is finite — every finite automaton, the two-way machines, the linear bounded automaton — a run always settles and the verdict shown is the truth.`),
        p(`For the Turing family, three things can appear instead:`),
        ul(
          `<b>Accept</b> or <b>reject</b>, when the machine halts.`,
          `<b>Loop</b>, when a deterministic machine revisits a configuration it has already been in. That is a <em>proof</em> of non-termination, not a guess, because a deterministic machine that repeats a configuration will repeat it forever.`,
          `<b>No verdict</b>, when the step budget runs out with the machine still going. The app never reports this as a rejection, because it has not decided anything — it has only stopped watching.`),
        p(`That last line is the decide/recognize distinction made operational. A tool that printed "reject" there would be claiming to decide a language it can only recognize.`))
    ]
  },

  'decide-finite': {
    slug: 'decide-finite',
    abbr: 'Deciding FA',
    title: 'Deciding Questions About Finite Automata',
    tagline: 'Every standard question, answered — and mostly in polynomial time',
    accent: 'var(--green)',
    klass: 'All decidable',
    sections: [
      sec('Why everything here is decidable',
        p(`A finite automaton is a finite labelled graph and nothing more. It has no store whose contents could grow, so the set of situations it can be in is bounded before the input arrives. Every question in this page therefore turns into a question about a finite graph, and graph questions have algorithms.`),
        p(`This is worth stating as a principle rather than as a fact about one model, because it is what changes at each later step of the hierarchy: bound a machine's resources and its questions become decidable; unbound them and they stop being.`)),

      sec('Membership',
        p(`Given M and w, is w ∈ L(M)? Run the machine.`),
        ul(
          `For a <b>DFA</b>, the run is unique and takes |w| steps, so membership is O(|w|) after the machine is loaded — independent of the number of states.`,
          `For an <b>NFA</b>, do not determinise first. Track the current <em>set</em> of states and advance the whole set on each symbol, which costs O(|w| · |Q|²) in the worst case and avoids ever materialising the exponentially many subsets.`,
          `For a <b>two-way</b> machine, the configuration is (state, head position) over a fixed tape, so there are |Q| · (|w| + 2) of them; run until you halt or repeat one.`)),

      sec('Emptiness',
        p(`Is L(M) = ∅? A word is accepted exactly when some path runs from q₀ to an accepting state, so:`),
        math(`L(M) = \\emptyset \\iff \\text{no state of } F \\text{ is reachable from } q_0`),
        p(`That is one graph search, linear in the size of the machine. The search is over the transition graph with the labels ignored entirely — which symbol an edge carries cannot affect whether a path exists.`),
        p(`The Algorithms view's <b>Is Empty?</b> runs exactly this and highlights the reachable set.`)),

      sec('Finiteness',
        p(`Is L(M) finite? A finite automaton accepts infinitely many words exactly when it can go round a loop arbitrarily often <em>on a path that matters</em>:`),
        math(`|L(M)| = \\infty \\iff \\exists \\text{ a cycle reachable from } q_0 \\text{ and co-reachable to } F`),
        p(`Both halves of the condition are load-bearing. A cycle that cannot be reached from the start state is never entered, and a cycle from which no accepting state can be reached contributes no accepted words. The clean way to run the test is to <b>trim</b> the machine first — delete every state that is unreachable from q₀ or that cannot reach F — and then simply ask whether any cycle remains at all.`),
        p(`This is the pumping lemma stated as a graph property. A cycle of length k on a useful path means that for every accepted word passing through it, inserting k more symbols yields another accepted word.`),
        p(`The Algorithms view's <b>Is Finite?</b> and <b>Dead State Analysis</b> are the two halves of this: the second is the trimming step on its own, classifying every state as live, dead or unreachable.`)),

      sec('Universality',
        p(`Is L(M) = Σ*, every word accepted? For a <b>complete DFA</b> — one whose δ is total — this is as easy as emptiness:`),
        math(`L(M) = \\Sigma^* \\iff \\text{every state reachable from } q_0 \\text{ is accepting}`),
        p(`Equivalently, complement the machine by swapping F for Q ∖ F and test the result for emptiness. Completeness matters: on a partial machine a missing transition is an implicit rejection, so the trap state has to be added before the states are counted.`),
        p(`For an <b>NFA</b> the picture changes sharply. Flipping the accepting set does <em>not</em> complement an NFA's language, because a word can have both an accepting and a rejecting run, so the only general route is to determinise first — and universality for NFAs is PSPACE-complete. The problem is still decidable; it is the cost that moves, and the exponential in the subset construction is not an artefact that a better algorithm would remove.`),
        p(`This is why the Algorithms view names its entry <b>Is Universal? (DFA)</b> rather than offering it for every finite-state model.`)),

      sec('Equivalence and containment',
        p(`Do two machines accept the same language? Build the machine for the <b>symmetric difference</b> and ask whether it is empty:`),
        math(`L(M_1) = L(M_2) \\iff \\big(L(M_1) \\cap \\overline{L(M_2)}\\big) \\cup \\big(\\overline{L(M_1)} \\cap L(M_2)\\big) = \\emptyset`),
        p(`The product construction supplies the machine: take Q₁ × Q₂ as the state set, run both components on the same symbol, and choose the accepting set to be the pairs where exactly one component accepts. Emptiness of that product is then one graph search. Containment is the same idea with one term instead of two — L₁ ⊆ L₂ exactly when L₁ ∩ L̄₂ = ∅.`),
        p(`There is a second route that avoids building a product at all. Since every regular language has a <em>unique</em> minimal DFA up to renaming of states, two DFAs are equivalent exactly when their minimal forms are isomorphic. Minimise both and compare.`),
        p(`For DFAs both routes are polynomial. For NFAs, equivalence — like universality, which is the special case where one machine accepts everything — is PSPACE-complete.`),
        p(`The Algorithms view carries <b>DFA Equivalence</b>, which builds the product and reports a distinguishing word when one exists, and <b>Full Equivalence</b>, which runs the check against the second workspace M₂.`)),

      sec('The same questions for ω-automata',
        p(`The eight ω-automata are finite-state too, so their questions stay decidable — but the objects being compared are sets of infinite words, and the algorithms change shape.`),
        ul(
          `<b>Emptiness</b> of a Büchi automaton is a reachable accepting cycle: does some cycle through F sit on a path from q₀? That is a strongly-connected-component computation, linear in the machine. It is precisely what the app's ω simulator does on the (state, position) graph of an ultimately periodic word, which is why an accepting run is reported as a lasso.`,
          `<b>Membership</b> of an ultimately periodic word u·v<sup>ω</sup> is decidable for the same reason: the pair (state, position within u(v)) ranges over a finite set.`,
          `<b>Universality</b> and <b>inclusion</b> are decidable but PSPACE-complete, because both need complementation, and complementing a nondeterministic Büchi automaton is the expensive operation of the whole theory — far harder than complementing a DFA, which is free.`,
          `<b>Finiteness</b> has no meaning here. An ω-language is a set of infinite words and is never finite in the sense the question intends.`),
        p(`This is also the practical argument for the parity condition: a deterministic parity automaton complements by adding one to every priority, which turns the hard question into an easy one.`))
    ]
  },

  'decide-cfl': {
    slug: 'decide-cfl',
    abbr: 'Deciding CFLs',
    title: 'Deciding Questions About Context-Free Languages',
    tagline: 'Membership yes, emptiness yes, equivalence no — and a clean rule for which is which',
    accent: 'var(--gold)',
    klass: 'Mixed',
    sections: [
      sec('The first place the answers split',
        p(`Context-free languages are where decidability stops being uniform. Three of the standard questions keep their algorithms and the rest lose them, and the boundary is sharp enough to be worth memorising as a pattern rather than as a list.`),
        p(`<b>Decidable:</b> membership, emptiness, finiteness. <b>Undecidable:</b> equivalence, universality, ambiguity, whether the intersection of two context-free languages is empty, and whether a context-free language is regular.`),
        p(`The pattern behind the split: a question that can be settled by examining the grammar's structure, or by a computation over one input word, stays decidable. A question that quantifies over <em>all</em> words at once, or that compares two grammars against each other, does not.`)),

      sec('Membership',
        p(`Given a grammar G and a word w, is w ∈ L(G)? Decidable, and the standard algorithm is <b>CYK</b>. It requires the grammar in Chomsky normal form, where every production is either A → BC or A → a, which makes every parse tree binary and every derivation of a length-n word exactly 2n − 1 steps long.`),
        p(`CYK is dynamic programming over the substrings of w. Let T[i, j] be the set of variables deriving the substring of length j starting at position i. The length-1 row comes straight from the terminal productions, and each longer entry is built from every way of splitting the substring in two:`),
        math(`T[i,j] = \\{\\, A \\ :\\ A \\to BC \\in R,\\ B \\in T[i,k],\\ C \\in T[i+k,\\,j-k],\\ 1 \\le k < j \\,\\}`),
        p(`The word is in the language exactly when the start variable appears in the single top cell T[1, n]. There are O(n²) cells and each costs O(n) splits, so the running time is <b>O(n³ · |G|)</b> — polynomial, but genuinely more expensive than the linear membership test a finite automaton enjoys.`),
        p(`The Grammar workbench's <b>CYK table</b> shows the finished triangle and scrubs through the fill one write at a time; <b>Parse a word</b> answers the same question and adds the derivation and the tree, over the rules you wrote rather than over their Chomsky normal form.`)),

      sec('Emptiness',
        p(`Is L(G) = ∅? Decidable by finding which variables can produce anything at all. Call a variable <b>productive</b> if some string of terminals can be derived from it, and compute the productive set by closure: a variable is productive if it has a production whose right-hand side consists entirely of terminals and already-productive variables. Start from the productions with all-terminal right-hand sides and iterate until nothing new is added.`),
        math(`L(G) = \\emptyset \\iff S \\text{ is not productive}`),
        p(`The iteration adds at least one variable per round and there are finitely many variables, so it terminates. The Grammar workbench's <b>Is L(G) empty?</b> shows the generating set it computed alongside the verdict.`)),

      sec('Finiteness',
        p(`Is L(G) finite? Decidable, and structurally the same argument as for finite automata: an infinite language needs a cycle that is both reachable and useful.`),
        p(`Remove the useless variables first — the non-productive ones and the unreachable ones — because a cycle among useless variables generates nothing. Then build the dependency graph on what remains, with an edge A → B whenever B appears on the right-hand side of a production of A. The language is infinite exactly when that graph has a cycle reachable from S.`),
        p(`A cycle means some variable derives a sentential form containing itself, A ⇒⁺ αAβ with αβ ≠ ε, which can be repeated any number of times. The Grammar workbench's <b>Is L(G) finite?</b> names the cycle it found — and when there is none, lists the language outright.`)),

      sec('What becomes undecidable, and the reason it does',
        p(`The undecidable questions about context-free languages all reduce from one combinatorial problem — the Post Correspondence Problem, which asks whether a finite set of domino-like string pairs can be laid in some order so that the concatenation of the tops equals the concatenation of the bottoms. That problem is undecidable, and grammars are expressive enough to encode it.`),
        p(`The catalogue, for two context-free grammars G, G₁, G₂ over Σ:`),
        ul(
          `Is L(G) = Σ*? <b>Undecidable.</b>`,
          `Is L(G₁) = L(G₂)? <b>Undecidable.</b>`,
          `Is L(G₁) ⊆ L(G₂)? <b>Undecidable.</b>`,
          `Is L(G₁) ∩ L(G₂) = ∅? <b>Undecidable</b> — and note that the intersection itself need not even be context-free.`,
          `Is L(G) regular? <b>Undecidable.</b>`,
          `Is G ambiguous? <b>Undecidable.</b>`,
          `Is L(G) inherently ambiguous — that is, does <em>every</em> grammar for it have an ambiguous string? <b>Undecidable.</b>`),
        p(`Contrast this with the finite-automaton page, where the identical list is decidable throughout. The single structural difference is the stack: it makes the configuration space infinite, and once the machine can distinguish unboundedly many situations, comparing two machines against each other stops being a finite check.`)),

      sec('Ambiguity, and what the app actually computes',
        p(`A grammar is <b>ambiguous</b> when some word has two distinct parse trees — equivalently, two distinct leftmost derivations. The classic case is an arithmetic-expression grammar with no precedence, where <code>id + id * id</code> can be read two ways.`),
        p(`Ambiguity of a grammar is undecidable, so no tool can settle it in general. The Grammar workbench's <b>Check ambiguity</b> is therefore a <em>witness finder</em>, not a decision procedure: it searches for two structurally different parse trees for one word you supply. Finding a pair is conclusive — the grammar is ambiguous, and both trees are drawn side by side. Finding one is not: it reports only that this word had a single derivation within the search it ran, and says so.`),
        note(`This is the honest shape for any tool built on an undecidable question. A positive answer can be a proof; a negative one can only ever be a failure to find a witness within a budget.`)),

      sec('Determinism buys the questions back',
        p(`The deterministic context-free languages — those accepted by a DPDA — behave much better, and the reason is closure under complement. A DCFL's complement is a DCFL, so the complement-and-test-emptiness route reopens:`),
        ul(
          `<b>Universality</b> of a DPDA is decidable: complement it and test for emptiness.`,
          `<b>Equivalence</b> of two DPDAs is decidable. This is a deep and hard-won result, and it stands in sharp contrast to the undecidability of equivalence for nondeterministic pushdown automata — the single feature separating the two models is exactly what separates a decidable question from an undecidable one.`,
          `<b>Inclusion</b> between two DPDAs remains <b>undecidable</b>, because the intersection of two DCFLs need not be a DCFL, so the L₁ ∩ L̄₂ = ∅ route is unavailable.`),
        p(`That last line is worth pausing on: equivalence is decidable while inclusion, which looks like the easier half of it, is not.`))
    ]
  },

  'decide-tm': {
    slug: 'decide-tm',
    abbr: 'TM Problems',
    title: 'Decision Problems About Turing Machines',
    tagline: 'The standard catalogue, and which side of the boundary each one falls on',
    accent: 'var(--red)',
    klass: 'Where the algorithms run out',
    sections: [
      sec('Turning machines into strings',
        p(`Every problem on this page is a <b>language</b>, which is only possible because a machine is a finite object and can be written down. Fix any reasonable encoding — states, alphabet, transitions and accepting set serialised into a string — and write ⟨M⟩ for the encoding of M and ⟨M, w⟩ for a machine paired with an input.`),
        p(`Nothing depends on which encoding is chosen, as long as it is decidable whether a given string encodes a machine at all, and the pieces can be read back out. With that fixed, "does this machine accept this word?" becomes an ordinary membership question about a set of strings, and the whole apparatus of the previous pages applies to it.`),
        p(`The <b>universal Turing machine</b> is what makes the encoding do work: given ⟨M, w⟩ it simulates M on w. It is the reason the first problem below is recognizable, and the ancestor of the stored-program computer — the observation that a description of a computation is itself just data.`)),

      sec('The catalogue',
        p(`The five standard problems, with their status. "RE" means recognizable, "co-RE" means the complement is recognizable.`),
        table(
          ['Problem', 'Asks', 'Decidable', 'RE', 'co-RE'],
          [`A<sub>TM</sub> = {⟨M,w⟩ : M accepts w}`, 'Does M accept w?', no('No'), yes('Yes'), no('No')],
          [`HALT<sub>TM</sub> = {⟨M,w⟩ : M halts on w}`, 'Does M halt on w?', no('No'), yes('Yes'), no('No')],
          [`E<sub>TM</sub> = {⟨M⟩ : L(M) = ∅}`, 'Is the language empty?', no('No'), no('No'), yes('Yes')],
          [`EQ<sub>TM</sub> = {⟨M₁,M₂⟩ : L(M₁) = L(M₂)}`, 'Do they agree?', no('No'), no('No'), no('No')],
          [`REGULAR<sub>TM</sub> = {⟨M⟩ : L(M) is regular}`, 'Is the language regular?', no('No'), no('No'), no('No')]),
        p(`Two of these deserve a sentence each. <b>A<sub>TM</sub> is recognizable</b> because the universal machine recognizes it: simulate M on w and accept if the simulation accepts. If M loops, so does the simulation — which is exactly the licence a recognizer has and a decider does not. <b>E<sub>TM</sub> is co-recognizable</b> because a "no" is finitely witnessed: if L(M) ≠ ∅ then some word is accepted, and dovetailing M over all inputs will eventually find it. A "yes" has no such witness, since no finite amount of searching establishes that nothing will ever be accepted.`)),

      sec('The quantifier rule of thumb',
        p(`The table has a pattern, and it is a reliable first guess when you meet a new problem. Look at the shape of the property once it is written out with quantifiers over strings or over steps:`),
        ul(
          `<b>∃ a finite witness</b> — "some word is accepted", "the machine halts", "M accepts w within some number of steps". Typically <b>RE</b>: search for the witness, and if one exists you find it.`,
          `<b>∀ over an infinite domain</b> — "every word is rejected", "the machine halts on all inputs", "no word longer than k is accepted". Typically <b>co-RE</b>: the failure is what is finitely witnessed.`,
          `<b>Both quantifiers, genuinely nested</b> — "for every word, there exists a run that…", "the two machines agree on all inputs". Typically <b>neither</b>, which is the position of EQ<sub>TM</sub> and REGULAR<sub>TM</sub>.`),
        p(`The rule is a heuristic and not a theorem — the quantifier form has to be the simplest one for the property, and finding that form is the real work. But it correctly predicts every row of the table above, and it composes with the theorem from the first page: a language that is both RE and co-RE is decidable, so a problem cannot be in the top two rows of that list simultaneously without being decidable.`)),

      sec('Bounding a resource, and what it buys',
        p(`Three variants show that the undecidability above comes from unbounded computation, not from tape machines as such.`),
        ul(
          `<b>Bounded halting</b> — "does M halt on w within k steps?", with k part of the input — is <b>decidable</b>. Simulate for k steps and look. Nothing about the machine is being reasoned about; it is simply being run for a finite time.`,
          `<b>Linear bounded automata</b> confine the tape to the marked input region, so the number of configurations is |Q| · (n+2) · |Γ|<sup>n+2</sup> — astronomically large but finite. <b>Membership is therefore decidable</b>: run until you halt or repeat a configuration, since a deterministic machine that repeats one loops forever. This is the operational reason the context-sensitive languages sit inside the decidable languages.`,
          `But bounding the tape per input does <em>not</em> bound the set of inputs, and so <b>emptiness, finiteness, equivalence and universality for LBAs remain undecidable</b>. One question is bought back; the rest are not.`),
        p(`The general lesson: decidability follows from a finite configuration space, and a resource bound is how you get one. That single idea explains why finite automata answer everything, why the LBA answers exactly one thing, and why the unrestricted machine answers nothing.`))
    ]
  },

  'diagonalization': {
    slug: 'diagonalization',
    abbr: 'Diagonalization',
    title: 'Diagonalization',
    tagline: 'The argument that produces the first undecidable language out of nothing',
    accent: 'var(--red)',
    klass: 'Proof technique',
    sections: [
      sec('What the technique is for',
        p(`Every undecidability proof in this section eventually rests on one argument. Reductions, which the next page covers, move hardness from a problem you already know is hard to a new one — but something has to be hard first, and nothing can be reduced to it. Diagonalization is what supplies that first problem.`),
        p(`The technique constructs an object that differs from every object on a given list, by disagreeing with the n-th list entry in the n-th place. Since it differs from everything on the list, it is not on the list — and if the list was supposed to be complete, that is a contradiction.`)),

      sec('The counting version',
        p(`The simplest form of the argument shows that non-recognizable languages exist without naming one.`),
        p(`Suppose the recognizable languages over Σ could be listed as L₁, L₂, L₃, … — which they can, since each is named by a machine and the machines are countable. List the words of Σ* as w₁, w₂, w₃, … too, which is possible for the same reason. Now imagine the infinite table whose (i, j) entry records whether w<sub>j</sub> ∈ L<sub>i</sub>, and define a new language D by flipping the diagonal:`),
        math(`w_j \\in D \\iff w_j \\notin L_j`),
        p(`D differs from L₁ on w₁, from L₂ on w₂, and in general from L<sub>n</sub> on w<sub>n</sub>. So D is not any L<sub>n</sub>, and the list was not complete after all. Since the list contained every recognizable language, D is not recognizable.`),
        p(`This proves such languages exist. It does not exhibit an interesting one, because D was defined in terms of the enumeration rather than in terms of anything you would naturally want to compute. The next section fixes that.`)),

      sec('A_TM is undecidable',
        p(`Now the same flip, applied to machines rather than to an abstract list. Recall:`),
        math(`A_{TM} = \\{\\, \\langle M, w \\rangle \\ :\\ M \\text{ is a Turing machine that accepts } w \\,\\}`),
        p(`Suppose, for contradiction, that some machine <b>H</b> decides A<sub>TM</sub>. So H always halts, and:`),
        math(`H(\\langle M, w \\rangle) = \\begin{cases} \\text{accept} & \\text{if } M \\text{ accepts } w \\\\ \\text{reject} & \\text{otherwise} \\end{cases}`),
        p(`Build a new machine <b>D</b> which takes a machine description ⟨M⟩ as its input, and does the following: run H on ⟨M, ⟨M⟩⟩ — that is, ask whether M accepts <em>its own description</em> — then do the opposite of H's answer. Accept if H rejects; reject if H accepts.`),
        p(`D is a perfectly ordinary machine: H is assumed to exist, and D just calls it and negates. So D has a description ⟨D⟩, and we may run D on it. Consider what happens:`),
        ul(
          `If <b>D accepts ⟨D⟩</b>, then by D's construction H must have rejected ⟨D, ⟨D⟩⟩, which means D does not accept ⟨D⟩. Contradiction.`,
          `If <b>D does not accept ⟨D⟩</b>, then H accepted ⟨D, ⟨D⟩⟩, which means D does accept ⟨D⟩. Contradiction.`),
        p(`Both branches are impossible, so the assumption was wrong: no such H exists, and A<sub>TM</sub> is undecidable.`)),

      sec('Which assumption the contradiction actually used',
        p(`It is worth being precise about what broke, because it is the one hypothesis that separates deciders from recognizers.`),
        p(`The argument used only that <b>H always halts</b>. That is what let D interrogate H and then act on the answer — a D built on a mere recognizer could hang inside the call and never reach its negation step, and no contradiction would follow.`),
        p(`So the diagonal argument refutes the existence of a <em>decider</em> for A<sub>TM</sub> and says nothing against a <em>recognizer</em>. And indeed the universal machine recognizes A<sub>TM</sub> without difficulty: simulate M on w, accept when the simulation accepts, and loop otherwise. A<sub>TM</sub> is therefore recognizable but not decidable, which is the first concrete point in the gap between the two classes.`)),

      sec('The first non-recognizable language',
        p(`One more consequence follows immediately, using the theorem from the first page: L is decidable exactly when L and L̄ are both recognizable.`),
        p(`A<sub>TM</sub> is recognizable. If its complement Ā<sub>TM</sub> were also recognizable, then A<sub>TM</sub> would be decidable — and it is not. Therefore:`),
        math(`\\overline{A_{TM}} \\text{ is not recognizable}`),
        p(`This is the concrete non-recognizable language the counting argument promised but could not name. It is also the standard starting point for proving that <em>other</em> problems are not recognizable: reduce Ā<sub>TM</sub> to them, which is the subject of the next page.`))
    ]
  },

  'reductions': {
    slug: 'reductions',
    abbr: 'Reductions',
    title: 'Reductions',
    tagline: 'How one hard problem makes another one hard',
    accent: 'var(--purple)',
    klass: 'Proof technique',
    sections: [
      sec('The idea',
        p(`Diagonalization is delicate and gives one hard problem. Reductions are the industrial method: having established that A is hard, show that a solution to B could be turned into a solution to A, and conclude that B is hard too. Almost every undecidability result after A<sub>TM</sub> is obtained this way.`),
        p(`The intuition is that of a subroutine. If B were decidable, you could use its decider inside a decider for A — so a decider for B cannot exist, or A would be decidable, which it is not.`)),

      sec('Mapping reductions, precisely',
        p(`The form of reduction used throughout this section is the <b>mapping reduction</b> (also called a many-one reduction). Write A ≤<sub>m</sub> B when there is a function f with:`),
        mathLines(
          `f : \\Sigma^* \\to \\Sigma^* \\text{ total and computable}`,
          `w \\in A \\iff f(w) \\in B \\quad \\text{for every } w`),
        p(`Three parts of that definition all matter and are all easy to drop by accident:`),
        ul(
          `<b>Computable</b> — some machine computes f and <em>halts on every input</em>. The reduction is itself an algorithm, and one that always terminates.`,
          `<b>Total</b> — f is defined on every string, including strings that are not well-formed instances of A. Those are usually mapped to some fixed non-member of B.`,
          `<b>Both directions</b> — the condition is "if and only if". A reduction that only sends yes-instances to yes-instances is not enough, because it would say nothing about the no-instances, and it is exactly that symmetry which makes the technique work for co-RE as well as RE.`)),

      sec('Which way each property flows',
        p(`Suppose A ≤<sub>m</sub> B. Then, in each case by composing the reduction with a machine for B:`),
        ul(
          `If <b>B is decidable</b>, so is A. On input w, compute f(w) and run B's decider on it.`,
          `If <b>B is recognizable</b>, so is A. Same construction with a recognizer.`,
          `Contrapositively: if <b>A is undecidable</b>, so is B. If <b>A is not recognizable</b>, neither is B.`),
        note(`<b>Easiness flows backward along the arrow; hardness flows forward.</b> A ≤<sub>m</sub> B says B is <em>at least as hard as</em> A. The most common error is to reduce in the wrong direction — showing B ≤<sub>m</sub> A proves nothing about B.`),
        p(`One further identity is worth having, because it is what makes non-recognizability provable at all:`),
        math(`A \\le_m B \\iff \\overline{A} \\le_m \\overline{B}`),
        p(`A single reduction therefore settles both a language and its complement. To show B is not recognizable, exhibit a reduction Ā<sub>TM</sub> ≤<sub>m</sub> B — or equivalently A<sub>TM</sub> ≤<sub>m</sub> B̄.`)),

      sec('Worked example: the halting problem',
        p(`Claim: A<sub>TM</sub> ≤<sub>m</sub> HALT<sub>TM</sub>, and therefore HALT<sub>TM</sub> is undecidable.`),
        p(`The reduction takes ⟨M, w⟩ and produces ⟨M′, w⟩, where M′ is the machine that on input x:`),
        ul(
          `runs M on x;`,
          `if M accepts, M′ halts and accepts;`,
          `if M rejects, M′ deliberately enters an infinite loop.`),
        p(`Then M′ halts on w exactly when M accepts w — the rejection case has been converted into a non-halt, so halting and accepting have been made to coincide. The map ⟨M, w⟩ ↦ ⟨M′, w⟩ is computable: it edits a machine description, replacing the reject transition with a loop, and it always terminates.`),
        note(`M′ is <em>built</em>, never <em>run</em>. If the reduction had to run M to decide what M′ should be, it would not be computable — and this is the single most common mistake when writing one.`)),

      sec('Worked example: emptiness',
        p(`Claim: A<sub>TM</sub> ≤<sub>m</sub> E̅<sub>TM</sub>, and therefore E<sub>TM</sub> is undecidable.`),
        p(`Given ⟨M, w⟩, build the machine M<sub>w</sub> which on input x:`),
        ul(
          `if x ≠ w, reject immediately;`,
          `if x = w, run M on w and accept if M does.`),
        p(`M<sub>w</sub> ignores its own input except to check it against the fixed word w, so its language is completely determined by what M does with w:`),
        math(`L(M_w) = \\begin{cases} \\{w\\} & \\text{if } M \\text{ accepts } w \\\\ \\emptyset & \\text{otherwise} \\end{cases}`),
        p(`So ⟨M, w⟩ ∈ A<sub>TM</sub> exactly when L(M<sub>w</sub>) ≠ ∅, which is exactly ⟨M<sub>w</sub>⟩ ∈ E̅<sub>TM</sub>. The map is computable — it writes down a new machine description with w hard-coded into it. Hardness flows forward, so E̅<sub>TM</sub> is undecidable, and since decidability is closed under complement, so is E<sub>TM</sub>.`),
        p(`Note what this construction achieves in general: it converts a question about <em>one</em> input into a question about a machine's <em>whole language</em>. That move is the engine of the next page.`)),

      sec('Using reductions to place a problem exactly',
        p(`Reductions do more than prove undecidability; combined with the recognizable/co-recognizable framing they locate a problem precisely.`),
        ul(
          `To show B is <b>undecidable</b>: reduce A<sub>TM</sub> (or any known-undecidable problem) to B.`,
          `To show B is <b>not recognizable</b>: reduce Ā<sub>TM</sub> to B.`,
          `To show B is <b>not co-recognizable</b>: reduce A<sub>TM</sub> to B.`,
          `To show B is <b>neither</b>: do both of the last two — which is how EQ<sub>TM</sub> is placed in the neither box.`),
        p(`And in the other direction, a reduction is equally a way to establish that something <em>is</em> tractable: exhibiting A ≤<sub>m</sub> B for a decidable B is a proof that A is decidable, which is exactly the argument used when equivalence of finite automata was settled by reducing it to emptiness of a product machine.`))
    ]
  },

  'rice': {
    slug: 'rice',
    abbr: "Rice's Theorem",
    title: "Rice's Theorem",
    tagline: 'Every non-trivial question about what a program computes is undecidable',
    accent: 'var(--red)',
    klass: 'General theorem',
    sections: [
      sec('The statement',
        p(`The previous page proved a handful of problems undecidable one reduction at a time. Rice's theorem collapses the whole family into a single statement: for <em>any</em> property of the language a machine recognizes, provided the property is not trivial, deciding it is impossible.`),
        p(`Formally, let P be a set of recognizable languages — think of P as "the languages having the property". The associated decision problem is:`),
        math(`L_P = \\{\\, \\langle M \\rangle \\ :\\ L(M) \\in P \\,\\}`),
        p(`<b>Rice's theorem.</b> If P is non-trivial — that is, if some recognizable language is in P and some recognizable language is not — then L<sub>P</sub> is undecidable.`)),

      sec('The two conditions, and why each is needed',
        p(`Both hypotheses do real work, and most misapplications of the theorem come from ignoring one of them.`),
        p(`<b>Semantic.</b> P is a set of <em>languages</em>, so the property depends only on L(M) and never on how M is written. Two machines recognizing the same language must always get the same answer. This is what rules out questions about the description — number of states, number of transitions, whether the machine ever writes a blank — which are decidable precisely because you can read them off the encoding without running anything.`),
        p(`<b>Non-trivial.</b> Some recognizable language has the property and some does not. If every language has it, L<sub>P</sub> is all machine encodings and the constant "yes" decides it; if none does, the constant "no" decides it. Both trivial cases are decidable, and the theorem correctly excludes them.`)),

      sec('Proof',
        p(`The argument is one reduction, and it generalises the emptiness construction from the previous page.`),
        p(`Assume without loss of generality that ∅ ∉ P — if it is, run the whole argument on the complement property, which is also non-trivial, and note that L<sub>P</sub> is decidable exactly when its complement is.`),
        p(`Since P is non-trivial, pick some language L ∈ P and a machine M<sub>L</sub> recognizing it. Now reduce A<sub>TM</sub> to L<sub>P</sub>. Given ⟨M, w⟩, build the machine M′ which on input x:`),
        ul(
          `first runs M on w, ignoring x entirely;`,
          `if that run accepts, then runs M<sub>L</sub> on x and answers as it does.`),
        p(`Everything hinges on whether M accepts w. If it does, M′ reaches the second phase for every x and so recognizes exactly L. If it does not, M′ never gets past the first phase for any x, and recognizes ∅:`),
        math(`L(M') = \\begin{cases} L \\in P & \\text{if } M \\text{ accepts } w \\\\ \\emptyset \\notin P & \\text{otherwise} \\end{cases}`),
        p(`So ⟨M, w⟩ ∈ A<sub>TM</sub> exactly when ⟨M′⟩ ∈ L<sub>P</sub>. The map is computable — it assembles a machine description — so A<sub>TM</sub> ≤<sub>m</sub> L<sub>P</sub>, and L<sub>P</sub> is undecidable.`)),

      sec('What it covers and what it does not',
        p(`Applying the theorem is a matter of checking the two conditions, which is usually immediate.`),
        table(
          ['Question about a machine M', 'Semantic?', 'Non-trivial?', 'Verdict'],
          ['Is L(M) empty?', yes('Yes'), yes('Yes'), no('Undecidable')],
          ['Is L(M) finite?', yes('Yes'), yes('Yes'), no('Undecidable')],
          ['Is L(M) regular?', yes('Yes'), yes('Yes'), no('Undecidable')],
          ['Is L(M) = Σ*?', yes('Yes'), yes('Yes'), no('Undecidable')],
          ['Does L(M) contain 01?', yes('Yes'), yes('Yes'), no('Undecidable')],
          ['Does M have seven states?', no('No — syntactic'), '—', yes('Decidable')],
          ['Does M ever move its head left?', no('No — syntactic'), '—', yes('Decidable')],
          ['Does M halt on ε within 100 steps?', no('No — bounded run'), '—', yes('Decidable')],
          ['Is L(M) recognizable?', yes('Yes'), no('No — always true'), yes('Decidable')]),
        p(`The last row is the trivial case doing its job: every L(M) is recognizable by construction, so the property holds of all of them and the answer is a constant "yes".`)),

      sec('Rice–Shapiro: which side of the boundary',
        p(`Rice's theorem says a property is undecidable but not <em>how</em> undecidable. Its refinement settles whether the problem is at least recognizable, and the test is a pair of structural conditions on P.`),
        p(`For L<sub>P</sub> to be recognizable, P must satisfy both:`),
        ul(
          `<b>Finite witness.</b> If a language L has the property, then some <em>finite</em> subset of L already has it. A recognizer can only ever have seen finitely much, so anything it accepts on must have been settled by a finite amount of evidence.`,
          `<b>Monotone.</b> If a finite language L₁ has the property, then every superset L₂ ⊇ L₁ has it too. Evidence once seen cannot be withdrawn by later acceptances.`),
        p(`Running the test on the standard properties:`),
        table(
          ['Property of L(M)', 'Finite witness', 'Monotone', 'Status'],
          ['Contains the word w', yes('Yes'), yes('Yes'), semi('Recognizable')],
          ['Is non-empty', yes('Yes'), yes('Yes'), semi('Recognizable')],
          ['Is empty', no('No'), no('No'), semi('Co-recognizable')],
          ['Is finite', no('No'), no('No'), no('Neither')],
          ['Equals Σ*', no('No'), yes('Yes'), no('Neither')],
          ['Is regular', no('No'), no('No'), no('Neither')]),
        p(`"Is finite" is the instructive failure. It is not monotone — a finite language has the property and its infinite supersets do not — so no recognizer can confirm it, and it is not co-recognizable either, since no finite amount of evidence establishes infinitude. It lands outside both classes.`)),

      sec('What this means in practice',
        p(`Rice's theorem is the formal reason that no tool can decide, in general, what a program computes. Every question of the form "does this code ever return null", "is this branch reachable", "do these two functions agree on all inputs" is a non-trivial semantic property of the program's behaviour, and is therefore undecidable.`),
        p(`Real analysers live with this by giving up exactly one of three things. They can be <b>unsound</b> and miss real cases; <b>incomplete</b> and report cases that cannot happen; or <b>restricted</b> to a fragment small enough to be decidable — which is what a type system, a regular-expression engine, or a terminating template language is. There is no fourth option, and Rice's theorem is the proof.`))
    ]
  },

  'decidability-map': {
    slug: 'decidability-map',
    abbr: 'Decidability Map',
    title: 'The Decidability Map',
    tagline: 'Every class against every standard question, in one place',
    accent: 'var(--gold)',
    klass: 'Summary',
    sections: [
      sec('How to read the tables',
        p(`The first table takes the language classes this app can build machines for and asks the five standard questions of each. <b>Decidable</b> means an algorithm always halts with the right answer; <b>semi-decidable</b> means "yes" is always eventually reported but "no" may never be; <b>undecidable</b> means no algorithm exists at all.`),
        p(`Read the table down a column rather than across a row and the boundary appears as a single line, at the same place in every column but the first.`)),

      sec('Classes against questions',
        table(
          ['Class', 'Membership', 'Emptiness', 'Finiteness', 'Equivalence', 'Universality'],
          ['Regular (DFA, NFA, regex)', yes('Decidable'), yes('Decidable'), yes('Decidable'), yes('Decidable'), yes('Decidable')],
          ['ω-Regular (Büchi, parity)', yes('Decidable'), yes('Decidable'), na(), yes('PSPACE'), yes('PSPACE')],
          ['Deterministic CF (DPDA)', yes('Decidable'), yes('Decidable'), yes('Decidable'), yes('Decidable'), yes('Decidable')],
          ['Context-free (CFG, NPDA)', yes('Decidable'), yes('Decidable'), yes('Decidable'), no('Undecidable'), no('Undecidable')],
          ['Context-sensitive (LBA)', yes('Decidable'), no('Undecidable'), no('Undecidable'), no('Undecidable'), no('Undecidable')],
          ['Recursively enumerable (TM)', semi('Semi-decidable'), no('Undecidable'), no('Undecidable'), no('Undecidable'), no('Undecidable')]),
        p(`Three entries carry a footnote. <b>ω-regular finiteness</b> is marked "—" because an ω-language is a set of infinite words and the question does not apply. <b>ω-regular equivalence and universality</b> are decidable but PSPACE-complete, since both require complementing a Büchi automaton. <b>DPDA inclusion</b>, which is not a column here, is undecidable even though equivalence in the same row is decidable — the deterministic context-free languages are closed under complement but not under intersection.`)),

      sec('Problems about Turing machines',
        p(`The same landscape for the problems whose instances are machine descriptions. These are the ones Rice's theorem governs.`),
        table(
          ['Problem', 'Decidable', 'Recognizable', 'Co-recognizable'],
          ['M halts on w within k steps', yes('Yes'), yes('Yes'), yes('Yes')],
          ['M has k states', yes('Yes'), yes('Yes'), yes('Yes')],
          ['A<sub>TM</sub> — M accepts w', no('No'), yes('Yes'), no('No')],
          ['HALT<sub>TM</sub> — M halts on w', no('No'), yes('Yes'), no('No')],
          ['L(M) ≠ ∅', no('No'), yes('Yes'), no('No')],
          ['E<sub>TM</sub> — L(M) = ∅', no('No'), no('No'), yes('Yes')],
          ['L(M) is finite', no('No'), no('No'), no('No')],
          ['L(M) = Σ*', no('No'), no('No'), no('No')],
          ['EQ<sub>TM</sub> — L(M₁) = L(M₂)', no('No'), no('No'), no('No')],
          ['L(M) is regular', no('No'), no('No'), no('No')]),
        p(`Every row is consistent with the theorem from the first page: a problem marked "yes" in both of the last two columns is marked "yes" in the first, and no row breaks that.`)),

      sec('Three tests for a problem you have not seen',
        p(`Given a new question, these settle it in most cases, in this order:`),
        ul(
          `<b>Is it syntactic or bounded?</b> If it depends only on the machine's description, or on running it for a fixed number of steps, it is decidable. Stop here.`,
          `<b>Is it a non-trivial property of L(M)?</b> If so, Rice's theorem makes it undecidable immediately, with no reduction to construct. Then use Rice–Shapiro's finite-witness and monotonicity tests to decide whether it is recognizable, co-recognizable or neither.`,
          `<b>Otherwise, reduce.</b> Map A<sub>TM</sub> into it for undecidability, or Ā<sub>TM</sub> for non-recognizability — and check the direction, since hardness only flows forward along the reduction.`)),

      sec('The single idea underneath all of it',
        p(`Every "decidable" entry in these tables traces back to a finite configuration space, and every "undecidable" one to the absence of a bound.`),
        p(`A finite automaton has finitely many states and no store, so every question is a question about a finite graph. A linear bounded automaton is bounded per input, which is enough to decide membership and nothing more, because bounding each run does not bound the set of runs. A Turing machine has no bound at all, and Rice's theorem then says that nothing about its behaviour can be determined without running it — which may never end.`),
        p(`One secondary theme runs alongside: <b>closure under complement is what makes equivalence tractable.</b> Regular languages have it, and equivalence is decidable. Deterministic context-free languages have it, and equivalence is decidable. General context-free languages do not, and equivalence is not. The pattern is not a coincidence — the standard equivalence algorithm is to build L₁ ∩ L̄₂ and test it for emptiness, and that construction needs both complement and intersection to stay inside the class.`))
    ]
  }
};

// ──────────────────────────────────────────────────────────────────
//  REGISTRY
// ──────────────────────────────────────────────────────────────────
// Order here is nav order. js/reference.js appends these groups after the
// machine categories.
export const ConceptCategories = [
  {
    id: 'decidability',
    label: 'Decidability',
    pages: [
      'decidable-recognizable',
      'decide-finite',
      'decide-cfl',
      'decide-tm',
      'diagonalization',
      'reductions',
      'rice',
      'decidability-map'
    ]
  }
];

export const ConceptGuides = { ...DECIDABILITY };
