import { renderCFLPumpVis } from './algorithms-cfg.js';
import { $ } from './state.js';

// ======================================================================
// THEORY VIEW
// ======================================================================

export const THEORY_CARD_IDS = [
  'th-fa',
  'th-regular',
  'th-rg',
  'th-regex',
  'th-decision',
  'th-cfl',
  'th-cfg-analysis',
  'th-cfg-normal',
  'th-pda-cfg',
  'th-tm',
  'th-utm-ndtm',
  'th-undecidable',
  'th-complexity',
  'th-algorithms',
  'th-closure-card',
  'th-nerode',
  'th-moore',
  'th-mealy',
  'th-mtm',
  'th-summary'
];

export function triggerMath(el) {
  if (typeof renderMathInElement === 'function') {
    renderMathInElement(el || document.body, {
      delimiters: [
        {left: '$$', right: '$$', display: true},
        {left: '$', right: '$', display: false},
        {left: '\\(', right: '\\)', display: false},
        {left: '\\[', right: '\\]', display: true}
      ],
      throwOnError: false
    });
  } else {
    // If KaTeX isn't loaded yet, try again in 100ms
    setTimeout(() => triggerMath(el), 100);
  }
}

export function theoryNavClick(link) {
  document.querySelectorAll('.theory-nav-link').forEach(l => l.classList.remove('active'));
  link.classList.add('active');

  const targetId = link.getAttribute('href').slice(1);
  const allSections = ['th-hierarchy', 'th-cards-section', 'th-pump', 'th-closure-tbl', 'th-pump-cfl', 'th-decidability'];
  allSections.forEach(id => {
    const el = $(id);
    if (el) el.style.display = 'none';
  });

  if (THEORY_CARD_IDS.includes(targetId)) {
    const sec = $('th-cards-section');
    if (sec) sec.style.display = '';
    document.querySelectorAll('#theory-grid .theory-card').forEach(card => {
      card.style.display = card.id === targetId ? '' : 'none';
    });
    triggerMath($('theory-grid'));
  } else {
    const sec = $(targetId);
    if (sec) {
      sec.style.display = '';
      triggerMath(sec);
    }
  }

  const content = $('v-theory')?.querySelector('.algo-content');
  if (content) content.scrollTo({ top: 0, behavior: 'smooth' });
}

export function renderTheoryView() {
  const cards = [
    {
      id: 'th-fa',
      color: 'var(--accent)',
      title: 'Finite Automata',
      sub: 'DFA · NFA · EPSILON-NFA · COMPUTATION MODELS',
      body: `<b>Core Models</b>
A deterministic finite automaton (DFA) is a 5-tuple $M = (Q, \\Sigma, \\delta, q_0, F)$, where $Q$ is a finite state set, $\\Sigma$ is the input alphabet, $\\delta: Q \\times \\Sigma \\to Q$ is a total transition function, $q_0$ is the start state, and $F \\subseteq Q$ is the accept set. Totality matters: on every symbol, from every state, the machine must know what to do. When a transition seems "missing," the standard repair is to add a trap state and route all undefined moves there.

<b>Nondeterminism</b>
An NFA replaces single-valued transitions with set-valued transitions: $\\delta: Q \\times \\Sigma \\to 2^Q$. An $\\epsilon$-NFA extends this further by allowing moves that consume no input. A string is accepted if at least one computation path reaches an accept state after all input is consumed. Nondeterminism changes how we describe a machine, but not what class of languages it can recognize.

<b>Epsilon-Closure</b>
For a state $q$, the $\\epsilon$-closure is the set of states reachable from $q$ by zero or more $\\epsilon$ moves. This is the key bridge between $\\epsilon$-NFAs and ordinary NFAs or DFAs. Conceptually, $\\epsilon$-closure tells us which states are "already active" before reading the next real symbol.

<b>Equivalence of DFA, NFA, and Epsilon-NFA</b>
All three models recognize exactly the regular languages. The easy direction is containment: every DFA is an NFA, and every NFA is an $\\epsilon$-NFA. The nontrivial direction is simulation: subset construction turns any NFA into an equivalent DFA by treating each reachable set of NFA states as a single DFA state.

<b>Two-Way Automata with Endmarkers</b>
A 2DFA or 2NFA reads a tape of the form ⊢w⊣. The head starts on the left marker ⊢, may move left, right, or stay, and may never cross past either boundary marker. In the app, the markers are reserved symbols: they are not part of the editable input alphabet $\Sigma$, but they are valid read symbols for the transition relation.

<b>Subset Construction and State Explosion</b>
If an NFA has $n$ states, the equivalent DFA can have as many as $2^n$ states. This upper bound is tight. The exponential blow-up is not an artifact of a poor algorithm; some regular languages truly require exponentially larger DFAs than their NFA descriptions.

<b>Minimal DFA</b>
Every regular language has a unique minimal DFA up to isomorphism. The states of the minimal DFA correspond to genuinely different "future behaviors" of prefixes. This is the intuition behind distinguishability, minimization, and the Myhill-Nerode theorem.` },
    {
      id: 'th-regular',
      color: 'var(--gold)',
      title: 'Regular Languages',
      sub: 'KLEENE THEOREM · CLOSURE · PUMPING LEMMA',
      body: `<b>Equivalent Characterizations</b>
A language is regular if and only if it is accepted by a DFA, if and only if it is accepted by an NFA, if and only if it can be described by a regular expression, and if and only if it can be generated by a regular grammar.

<b>Regular Operations and Closure</b>
Regular languages are closed under union, intersection, complement, difference, concatenation, star, reversal, homomorphism, and inverse homomorphism. Closure is powerful: it lets us construct new regular languages from old ones and derive contradictions for non-regularity.

<b>Pumping Lemma</b>
If $L$ is regular, then there exists a pumping length $p$ such that every string $w \\in L$ with $|w| \\ge p$ can be written as $w = xyz$ with $|xy| \\le p$, $|y| \\ge 1$, and $xy^i z \\in L$ for all $i \\ge 0$.

<b>Finding Minimum Pumping Length</b>
The <em>minimum</em> pumping length $p$ is the smallest integer where the rule holds.
<b>Strategy:</b> Find the shortest string in the language that <b>cannot</b> be pumped (often because pumping <em>down</em>, $i=0$, leaves the language). If a string of length $k$ is not pumpable, then $p$ must be at least $k + 1$.
<em>Example:</em> For $L = 0^*1^+0^+1^* \\cup 10^*1$, the string "10" (length 2) cannot be pumped because removing either character leaves "0" or "1", neither of which is in $L$. Thus, the minimum pumping length must be 3.

<b>Decision Problems</b>
Membership, emptiness, finiteness, equivalence, containment, and universality are all decidable for regular languages. This tractability is why they are central in verification and text processing.` },
    {
      id: 'th-rg',
      color: 'var(--gold)',
      title: 'Regular Grammars',
      sub: 'RIGHT-LINEAR · LEFT-LINEAR · RG <-> NFA',
      body: `<b>Shape of a Regular Grammar</b>
A right-linear grammar has productions of the form $A \\to aB$, $A \\to a$, or optionally $A \\to \\epsilon$. A left-linear grammar has the mirrored shape $A \\to Ba$ or $A \\to a$. Mixing left-linear and right-linear forms arbitrarily can produce languages that are not regular.

<b>Why Right-Linear Grammars Match NFAs</b>
Each nonterminal behaves like a state. A production $A \\to aB$ becomes a transition from state $A$ to state $B$ on symbol $a$. A production $A \\to a$ becomes a transition into a distinguished accepting state.

<b>NFA to Regular Grammar</b>
Going the other way, each state becomes a variable. A transition $p \\xrightarrow{a} q$ becomes a production $P \\to aQ$. If $q$ is accepting, we also need $P \\to a$.

<b>What the Conversion Teaches</b>
These conversions show that "grammar generation" and "machine recognition" are two views of the same low-level memoryless process. That equivalence is the regular-language case of a broader theme that repeats with CFGs and PDAs.` },
    {
      id: 'th-regex',
      color: 'var(--accent)',
      title: 'Regular Expressions and Automata',
      sub: 'THOMPSON · GNFA · EPSILON ELIMINATION',
      body: `<b>Regular Expressions as Algebraic Descriptions</b>
A regular expression denotes a language, not a matching procedure. The primitives are $\\emptyset$, $\\epsilon$, and symbols; the constructors are union, concatenation, and star.

<b>Thompson Construction</b>
Thompson's method compiles a regex into an equivalent $\\epsilon$-NFA by composing small gadgets. A symbol uses one edge. Union forks with $\\epsilon$ transitions. Concatenation joins submachines end-to-start. Star creates a new entry/exit pattern.

<b>State Elimination and GNFAs</b>
To convert an automaton back into a regex, we typically pass through a generalized NFA (GNFA), where edge labels are whole regular expressions. Eliminating a state means preserving every path that used to pass through that state by updating direct edges with concatenation, union, and star expressions.

<b>Practical Consequence</b>
Regex to NFA and NFA to regex are dual procedures. Together they complete the proof of Kleene's theorem: every regex has an automaton, and every finite automaton has a regex.` },
    {
      id: 'th-decision',
      color: 'var(--green)',
      title: 'DFA Decision Procedures',
      sub: 'EMPTINESS · FINITENESS · UNIVERSALITY · EQUIVALENCE',
      body: `<b>Emptiness</b>
A DFA language is empty exactly when no accepting state is reachable from the start state. This is a graph reachability problem, decidable in linear time.

<b>Finiteness</b>
A regular language is infinite if and only if there exists a cycle reachable from the start state that can also reach an accept state. Intuitively, such a cycle can be pumped arbitrarily many times.

<b>Universality</b>
A complete DFA is universal exactly when every state reachable from the start is accepting, or equivalently when the complement DFA has empty language.

<b>Equivalence</b>
Two DFAs are equivalent if they accept exactly the same language. A standard test constructs the symmetric-difference machine and checks emptiness.

<b>Complement and Product</b>
Complement is easy for total DFAs: flip accepting and rejecting states. Product construction combines machines so one component tracks each input in parallel. Choosing the accept condition appropriately yields union, intersection, and difference.` },
    {
      id: 'th-cfl',
      color: 'var(--green)',
      title: 'Context-Free Languages',
      sub: 'CFG · PDA · NPDA · PARSING · PUMPING',
      body: `<b>Context-Free Grammars</b>
A context-free grammar is a 4-tuple $G = (V, \\Sigma, R, S)$ where each production has a single variable on the left. This allows nested structure and recursive syntax.

<b>Pushdown Automata</b>
PDAs extend finite automata with a stack. This extra unbounded but disciplined memory is exactly what is needed for balanced parentheses, nested scopes, and matched recursive constructs. In this app, <em>DPDA</em> denotes the deterministic model, while <em>NPDA</em> denotes the general nondeterministic model.

<b>Why CFLs are not closed under Intersection</b>
A PDA has only one stack. To check the intersection of two CFLs, a machine would effectively need two independent stacks, which turns it into a Turing Machine.
<em>Example:</em> $L_1 = \\{a^nb^nc^m\\}$ and $L_2 = \\{a^mb^nc^n\\}$ are both CFLs. Their intersection $L_1 \\cap L_2 = \\{a^nb^nc^n\\}$ requires matching all three letters simultaneously, which a single stack cannot do.

<b>Closure Profile</b>
CFLs are closed under union, concatenation, star, reversal, and homomorphism. They are <b>NOT</b> closed under intersection or complement.
<em>Crucial Exception:</em> The intersection of a CFL and a Regular Language is ALWAYS a Context-Free Language.

<b>Pumping Lemma for CFLs</b>
If $L$ is CFL, there is a $p$ such that any $w \\in L$ with $|w| \\ge p$ can be split into $uvxyz$ where $|vxy| \\le p$, $|vy| \\ge 1$, and $uv^ixy^iz \\in L$ for all $i \\ge 0$.` },
    {
      id: 'th-cfg-analysis',
      color: 'var(--green)',
      title: 'CFG Analysis and Parsing',
      sub: 'FIRST/FOLLOW · LL(1) · AMBIGUITY · DERIVATIONS',
      body: `<b>FIRST Sets</b>
FIRST(X) records which terminals can appear at the beginning of some string derived from $X$. For a variable, it is computed from productions, propagating $\\epsilon$ where necessary.

<b>FOLLOW Sets</b>
FOLLOW(A) records which terminals may appear immediately to the right of variable $A$ in some sentential form. FOLLOW matters because $\\epsilon$-producing variables need a fallback lookahead set.

<b>LL(1) Condition</b>
A grammar is LL(1) when one symbol of lookahead is enough to choose the correct production for each variable in a predictive parser. Formally, productions for the same nonterminal must have disjoint FIRST sets.

<b>Left Recursion</b>
Immediate left recursion, such as $A \\to A \\alpha \\mid \\beta$, breaks naive top-down parsing because expansion can loop before consuming input. Eliminating left recursion rewrites the grammar into an equivalent form.

<b>Ambiguity</b>
Ambiguity means some string has more than one parse tree. The classic arithmetic-expression grammar without precedence rules is ambiguous because expressions like $id + id * id$ admit multiple structural readings.` },
    {
      id: 'th-cfg-normal',
      color: 'var(--green)',
      title: 'Normal Forms and CYK',
      sub: 'CNF · GNF · CYK · GRAMMAR SIMPLIFICATION',
      body: `<b>The Goal of Chomsky Normal Form</b>
CNF forces every parse tree to be binary and predictable. Productions can only be:
1. <b>The Split:</b> $A \\to BC$ (Exactly two variables)
2. <b>The End:</b> $A \\to a$ (Exactly one terminal)

<b>The Conversion "Car Wash" (Steps in Order):</b>
<b>1. Protect Start Symbol:</b> Add $S_0 \\to S$ so the start symbol never appears on a right-hand side.
<b>2. Remove $\\epsilon$-productions:</b> If $A \\to \\epsilon$, add all combinations of $A$ vanishing in other rules, then delete $A \\to \\epsilon$.
<b>3. Remove Unit Productions:</b> If $A \\to B$, give all of $B$'s productions directly to $A$, then delete $A \\to B$.
<b>4. Isolate & Shorten:</b> Create dummy variables for mixed terminals ($T_a \\to a$) and chain long rules ($A \\to BCD$ becomes $A \\to BX, X \\to CD$).

<b>CYK Algorithm</b>
CYK decides whether a string belongs to a CFG in CNF using dynamic programming. It fills a triangular table representing all possible substring derivations. Membership holds if the start variable reaches the top cell.` },
    {
      id: 'th-pda-cfg',
      color: 'var(--green)',
      title: 'DPDA, NPDA, and CFG Equivalence',
      sub: 'CFG -> NPDA · DPDA/NPDA -> CFG · TOP-DOWN · BOTTOM-UP',
      body: `<b>The Fundamental Equivalence</b>
Context-free languages are exactly the languages accepted by nondeterministic PDAs.

<b>Top-Down CFG to NPDA</b>
The standard top-down construction starts with the grammar's start variable on the stack. If the top of the stack is a variable $A$, the NPDA nondeterministically expands $A \\to \\alpha$. If the top is a terminal matching input, the machine consumes and pops it.

<b>PDA to CFG</b>
This construction introduces variables of the form $[p A q]$, intended to generate strings that take the machine from state $p$ with stack symbol $A$ to state $q$ after $A$ is popped.

<b>DPDA / NPDA to CFG</b>
The reverse construction is more technical. A common method introduces variables of the form <em>[p A q]</em>, intended to generate exactly the strings that take the machine from state <em>p</em> with stack symbol <em>A</em> on top to state <em>q</em> after that symbol has been removed. Productions encode the ways the automaton can consume input while matching pushes with corresponding later pops.

<b>Why Acceptance Mode Matters</b>
PDAs may accept by final state or by empty stack. These two conventions are equivalent in expressive power, but the conversion details differ. The app's explicit and empty-stack paradigms reflect that theoretical distinction.

<b>What This Section Should Teach</b>
The key lesson is not just that CFGs and NPDAs are equivalent. It is that syntax trees and stack behavior are two descriptions of the same nested dependency structure: one generative, one operational. The <b>DPDA</b> model then sits inside that picture as the parsing-friendly but strictly smaller subclass.` },
    {
      id: 'th-tm',
      color: 'var(--orange)',
      title: 'Turing Machines',
      sub: 'DECIDABILITY · RECOGNIZABILITY · UNIVERSAL MODEL',
      body: `<b>Formal Model</b>
A standard single-tape TM is a 7-tuple $M = (Q, \\Sigma, \\Gamma, \\delta, q_0, q_{acc}, q_{rej})$. The tape alphabet $\\Gamma$ contains the input alphabet and the blank symbol.

<b>Recognition vs Decision</b>
A TM recognizes a language if it accepts every string in the language. A TM decides a language if it halts on every input, accepting strings in the language and rejecting strings outside it. This halt-on-all-inputs condition is what separates decidable languages from merely recognizable ones.

<b>Why TMs Matter</b>
Finite automata have no unbounded memory; PDAs have one stack; TMs have unrestricted read-write tape. That jump is what makes TMs the standard model for general-purpose computation.

<b>Linearly Bounded Automata</b>
An LBA is a Turing machine whose tape is constrained to the marked input region ⊢w⊣. The boundary cells are fixed markers, the head starts on ⊢, and no move may cross past the left or right marker. This is the operational reason LBA languages sit exactly at the context-sensitive level.

<b>Church-Turing Thesis</b>
The Church-Turing thesis is the claim that every effectively calculable procedure can be carried out by a Turing machine.` },
    {
      id: 'th-utm-ndtm',
      color: 'var(--orange)',
      title: 'UTM and Nondeterministic TMs',
      sub: 'SIMULATION · ENCODINGS · BRANCHING COMPUTATION',
      body: `<b>Universal Turing Machine</b>
A universal Turing machine (UTM) takes an encoding $\\langle M, w \\rangle$ and simulates machine $M$ on input $w$. This is the formal ancestor of the stored-program computer.

<b>Why Encodings Matter</b>
Universality depends on being able to encode states, symbols, transitions, and input strings. Once that is done, questions about machines become questions about strings.

<b>Nondeterministic TMs</b>
An NDTM can branch into multiple possible next moves. It accepts if any branch accepts. Nondeterminism does not change language-recognition power for TMs, but it does change complexity-theoretic viewpoints ($NP$).

<b>Simulation by BFS</b>
To simulate an NDTM deterministically, we cannot just follow one branch deeply (it might loop). Standard simulations enumerate configurations breadth-first.` },
    {
      id: 'th-undecidable',
      color: 'var(--red)',
      title: 'Undecidability',
      sub: 'HALTING · ATM · REDUCTIONS · RICE',
      body: `<b>Rice's Theorem (Decidability)</b>
Checking <b>any</b> non-trivial semantic property of a Turing Machine's language is undecidable.
- <b>Semantic:</b> About the language $L(M)$ (e.g., "is it empty?"), not the code.
- <b>Non-trivial:</b> True for some TMs and false for others.

<b>Rice-Shapiro Theorem (Recognizability)</b>
Also known as the "Wait and See" test. A property is Turing-Recognizable (RE) if it can be confirmed by observing the TM for finite time.
<b>The Formal Rules:</b>
1. <b>Finite Subset Rule:</b> If $L$ has the property, there must be a finite subset of $L$ that also has it.
2. <b>Monotonicity:</b> If a finite $L_1$ has it, any $L_2 \\supseteq L_1$ must also have it.

<b>Ultimate Cheat Sheet:</b>
- <b>Recognizable (RE):</b> e.g., "Contains $w$", "is not empty".
- <b>Co-Recognizable (co-RE):</b> e.g., "is empty".
- <b>Neither:</b> e.g., "$L(M) = \\Sigma^*$", "is finite".

<b>Diagonalization and $A_{TM}$</b>
$A_{TM} = \\{\\langle M, w \\rangle \\mid M \\text{ accepts } w\\}$ is the baseline undecidable problem, proved via Cantor's diagonal argument.` },
    {
      id: 'th-complexity',
      color: 'var(--purple)',
      title: 'Complexity Theory',
      sub: 'P · NP · PSPACE · REDUCTIONS',
      body: `<b>Resource Bounds</b>
Complexity theory classifies problems by the time or space needed. $P$ is solvable in polynomial time, $NP$ is verifiable in polynomial time.

<b>The Master Flow of Reductions ($A \\le_m B$)</b>
- <b>Easiness flows backward:</b> If $B$ is Decidable/RE, then $A$ is also Decidable/RE.
- <b>Hardness flows forward:</b> If $A$ is Undecidable/Not RE, then $B$ is also Undecidable/Not RE.

<b>NP-Completeness and Gadgets</b>
NP-complete problems (like 3-SAT) are the hardest in NP. Reductions often use "gadgets":
- <b>Variable Gadget:</b> An edge between $x$ and $\\neg x$.
- <b>Clause Gadget:</b> A triangle representing $(x \\lor y \\lor z)$.

<b>Specific "Trick" Concepts:</b>
- <b>Unary vs Binary:</b> Subset-Sum is NP-complete in Binary, but in $P$ in Unary because the input size $n$ is artificially inflated.
- <b>coNP Collapse:</b> If an NP-complete problem belongs to $coNP$, then $NP = coNP$.
- <b>PSPACE-complete:</b> Includes board games and $TQBF$.` },
    {
      id: 'th-algorithms',
      color: 'var(--accent)',
      title: 'Key Algorithms',
      sub: 'CONSTRUCTIONS · NORMAL FORMS · DECISION TESTS',
      body: `<b>Finite-Automata Algorithms</b>
The app implements $\\epsilon$-closure computation, subset construction, table-filling minimization, dead-state analysis, complement, product construction, emptiness, finiteness, universality, and equivalence.

<b>Regex and Grammar Algorithms</b>
Regex to $\\epsilon$-NFA is handled by Thompson construction. DFA or NFA to regex uses generalized-NFA elimination.

<b>CFG Algorithms</b>
FIRST/FOLLOW computation, LL(1) table generation, left-recursion removal, CNF and GNF conversion, CYK parsing, and parse-tree construction.

<b>PDA and TM Algorithms</b>
CFG to NPDA and DPDA/NPDA to CFG illustrate language-class equivalence on the context-free level, while the separate DPDA mode highlights what changes when determinism is enforced. UTM, NDTM, and TM-to-grammar features represent the more advanced computability side of the project.

<b>Pedagogical Point</b>
This app is not just a simulator. It is a constructive theory environment. Almost every algorithm in the interface is there because it either proves an equivalence theorem, decides a property, or exposes the shape of a classical proof.` },
    {
      id: 'th-closure-card',
      color: 'var(--green)',
      title: 'Closure Properties',
      sub: 'REGULAR · CFL · CSL · RE · RECURSIVE',
      body: `<b>What Closure Means</b>
A class is closed under an operation when applying the operation to members of the class never takes you outside the class.

<b>Regular Languages</b>
Regular languages enjoy very strong closure behavior because finite control can be combined in systematic ways (Product Construction).

<b>Context-Free Languages</b>
CFLs are closed under union, concatenation, star, reversal, but <b>NOT</b> under general intersection or complement. This is a sign that one stack is limited.

<b>Recursive and RE Languages</b>
Recursive languages are closed under Boolean operations. RE languages are closed under union and intersection but not complement.

<b>How to Use Closure in Proofs</b>
Closure arguments build a target language from known languages, or derive a contradiction (e.g., if $L$ was regular, then $L \\cap L'$ would be regular, but it's not).` },
    {
      id: 'th-nerode',
      color: 'var(--orange)',
      title: 'Myhill-Nerode Theorem',
      sub: 'DISTINGUISHABILITY · MINIMALITY · NON-REGULARITY',
      body: `<b>The Intuition</b>
To understand equivalence classes, stop looking at languages as sets and start looking at them from the perspective of a machine trying to process strings.
Suppose a DFA reads string $x$ and ends up in <b>State Q</b>. If it also ends up in <b>State Q</b> after reading $y$, the machine has "forgotten" which it read. Any future suffix $z$ will lead to the same result. They are <b>indistinguishable</b>.

<b>Formal Definition</b>
Two strings $x$ and $y$ are indistinguishable with respect to $L$ ($x \\equiv_L y$) if, for every possible suffix $z$:
$$xz \\in L \\iff yz \\in L$$

<b>Myhill-Nerode Theorem</b>
The number of equivalence classes of $L$ is exactly equal to the number of states in the <b>minimal DFA</b>.
- <b>Finite classes:</b> Language is Regular.
- <b>Infinite classes:</b> Language is NOT Regular.

<b>Minimal DFA</b>
This is why minimal DFAs are unique: the states correspond to the inherent equivalence classes of the language itself.` },
    {
      id: 'th-moore',
      color: 'var(--purple)',
      title: 'Moore Machines',
      sub: 'OUTPUT ON STATES · SYNCHRONOUS TRANSDUCTION',
      body: `<b>Definition</b>
A Moore machine is a finite-state transducer whose output depends only on the current state: $\\lambda: Q \\to \\Delta$. Because output is state-based, the machine emits an initial output before any input is read.

<b>Behavioral Consequence</b>
Outputs change only when the state changes. This gives Moore machines a synchronous, stable feel useful in hardware and control systems.

<b>Relationship to Mealy Machines</b>
Moore and Mealy machines realize the same finite-state transductions. However, a Moore machine may need more states because output information is encoded into state identity itself.` },
    {
      id: 'th-mealy',
      color: 'var(--accent)',
      title: 'Mealy Machines',
      sub: 'OUTPUT ON TRANSITIONS · COMPACT TRANSDUCERS',
      body: `<b>Definition</b>
A Mealy machine is a finite-state transducer with output function $\\lambda: Q \\times \\Sigma \\to \\Delta$. The output is determined by the current state together with the current input symbol.

<b>Operational Effect</b>
For an input of length $n$, a Mealy machine emits exactly $n$ output symbols. There is no separate initial output. This often yields a more compact encoding than a Moore machine.

<b>Conversion</b>
Converting Moore to Mealy is straightforward: each transition inherits the output of its destination state. Converting Mealy to Moore usually requires splitting states.` },
    {
      id: 'th-mtm',
      color: 'var(--orange)',
      title: 'Multi-Tape Turing Machines',
      sub: 'EFFICIENCY · SIMULATION · MACHINE VARIANTS',
      body: `<b>Definition</b>
A $k$-tape TM reads and writes on $k$ tapes simultaneously. The transition function consumes a $k$-tuple of tape symbols and returns a new state, a $k$-tuple to write, and movements for each head.

<b>Power vs Efficiency</b>
Multi-tape TMs do not recognize more languages than single-tape TMs, but they can be dramatically faster. The simulation incurs at most quadratic overhead.

<b>Robustness</b>
Because multi-tape and single-tape models are polynomially equivalent, complexity classes like $P$ do not depend on which one we choose.` },
    {
      id: 'th-summary',
      color: 'var(--accent)',
      title: 'Revision Summary',
      sub: 'COMPREHENSIVE THEORY SUMMARY · WEEKS 7-12',
      body: `<b>1. Time Complexity & Reductions</b>
- <b>$P$ vs $NP$:</b> $P$ = Solvable, $NP$ = Verifiable in poly-time.
- <b>Reductions ($A \\le_P B$):</b> Easiness backward, Hardness forward.
- <b>Graph Equivalences:</b> Clique of size $k$ in $G'$ $\\iff$ Independent Set size $k$ in $G$ $\\iff$ Vertex Cover size $n-k$ in $G$.

<b>2. Decidability & Rice's Theorem</b>
- <b>Rice's Theorem:</b> Any non-trivial semantic property of $L(M)$ is UNDECIDABLE.
- <b>Checks:</b> Must be about the language (semantic) and true for some machines, false for others (non-trivial).

<b>3. Recognizability (RE)</b>
- <b>Turing-Recognizable (RE):</b> Finitely prove a "Yes" (e.g., $HALT_{TM}$).
- <b>co-Turing-Recognizable (co-RE):</b> Finitely prove a "No" (e.g., $E_{TM}$).
- <b>Decidable:</b> Only if BOTH RE and $co-RE$.

<b>4. Mapping Reductions ($A \\le_m B$)</b>
- <b>Easiness ($B$ to $A$):</b> If $B$ is easy (Decidable/RE), $A$ must be easy.
- <b>Hardness ($A$ to $B$):</b> If $A$ is hard (Undecidable/Not RE), $B$ must be hard.

<b>5. Space Complexity</b>
- <b>Master Hierarchy:</b> $L \\subseteq NL = coNL \\subseteq P \\subseteq NP \\subseteq PSPACE = NPSPACE$.
- <b>Savitch's Theorem:</b> $NSPACE(f(n)) \\subseteq DSPACE(f(n)^2)$.

<b>6. The "Trick" Concepts</b>
- <b>Unary SUBSET-SUM:</b> In $P$ (size is inflated). Binary version is $NP$-complete.
- <b>coNP Collapse:</b> If an $NPC$ problem is in $coNP$, then $NP = coNP$.
- <b>Gadgets:</b> $3-SAT$ to Vertex Cover uses variable (edges) and clause (triangles) gadgets.
- <b>PSPACE-complete:</b> board games and $TQBF$.` }
  ];

  const grid = $('theory-grid');
  if (grid) {
    grid.innerHTML = cards.map(card => `
<div class="theory-card" id="${card.id}" style="--accent-c:${card.color};scroll-margin-top:20px">
  <div class="tc-title">${card.title}</div>
  <div class="tc-sub">${card.sub}</div>
  <div class="tc-body" style="white-space:pre-line">${card.body}</div>
</div>`).join('');
    triggerMath(grid);
  }

  renderClosureTable();
  renderPumpVis();
  setTimeout(() => renderCFLPumpVis(), 50);

  const initLink = $('tnl-hierarchy');
  if (initLink) theoryNavClick(initLink);
}

export function renderClosureTable() {
  const el = $('closure-table');
  if (!el) return;

  const ops = ['Union', 'Intersection', 'Complement', 'Concatenation', 'Kleene *', 'Homomorphism', 'Inverse Hom.', 'Reversal'];
  const classes = ['Regular', 'CFL', 'CSL', 'Recursive', 'RE'];
  const closed = {
    Regular: [1, 1, 1, 1, 1, 1, 1, 1],
    CFL: [1, 0, 0, 1, 1, 1, 1, 1],
    CSL: [1, 1, 1, 1, 1, 1, 1, 1],
    Recursive: [1, 1, 1, 1, 1, 1, 1, 1],
    RE: [1, 1, 0, 1, 1, 1, 1, 1]
  };

  let html = '<div style="overflow-x:auto"><table class="result-table"><thead><tr><th>Class</th>';
  html += ops.map(op => `<th>${op}</th>`).join('');
  html += '</tr></thead><tbody>';

  classes.forEach(cls => {
    html += `<tr><th style="text-align:left;background:var(--surface2)">${cls}</th>`;
    closed[cls].forEach(v => {
      html += `<td style="color:${v ? 'var(--green)' : 'var(--red)'}">${v ? '&#10003;' : '&#10007;'}</td>`;
    });
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

export function renderPumpVis() {
  const pEl = $('pump-vis');
  const pw = $('pump-w');
  if (!pEl || !pw) return;

  const x = parseInt($('pump-x')?.value, 10) || 0;
  const y = parseInt($('pump-y')?.value, 10) || 3;
  const p = parseInt($('pump-p')?.value, 10) || 3;
  const pi = parseInt($('pump-i')?.value, 10) || 2;

  if (x + y > pw.value.length) {
    $('pump-result').innerHTML = '<div class="pump-result fail">|x| + |y| exceeds string length.</div>';
    return;
  }
  if (y < 1) {
    $('pump-result').innerHTML = '<div class="pump-result fail">|y| must be at least 1.</div>';
    return;
  }
  if (x + y > p) {
    $('pump-result').innerHTML = '<div class="pump-result fail">|xy| must be at most p.</div>';
    return;
  }

  const xPart = pw.value.slice(0, x);
  const yPart = pw.value.slice(x, x + y);
  const zPart = pw.value.slice(x + y);
  const pumped = xPart + yPart.repeat(pi) + zPart;

  pEl.innerHTML =
    [...xPart].map(c => `<div class="pump-char x-part">${c}</div>`).join('') +
    [...yPart].map(c => `<div class="pump-char y-part">${c}</div>`).join('') +
    [...zPart].map(c => `<div class="pump-char z-part">${c}</div>`).join('');

  const info = `x = "${xPart}" (|x| = ${x})  y = "${yPart}" (|y| = ${y})  z = "${zPart}"`;
  $('pump-result').innerHTML = `<div style="font-size:.68rem;color:var(--text2);margin-bottom:6px">${info}</div>
<div class="pump-result ok">Pumped string xy^${pi}z = "${pumped}"<br>Check whether the pumped string still lies in your language.</div>`;
}
