# AutomataStudio

A web-based visualizer and simulator for finite state machines, pushdown automata, and Turing machines. It includes interactive tools for regular grammars, context-free grammars, and visual algorithm stepping.

---

## Quick Start
Run the app locally. Requires Node.js.

```bash
git clone https://github.com/thethinkmachine/AutomataStudio.git
cd AutomataStudio
npm install
npm run dev
```

Open `http://localhost:5173/` (or whichever port Vite uses) in your browser.

## Features

* **Multiple Machine Types:** DFA, NFA, ε-NFA, 2DFA, 2NFA, DPDA, NPDA, Queue Automaton, Counter Machine, 2-Stack PDA, TM, NDTM, MTM, LBA, 2-Way Infinite TM, Moore, Mealy, and FST.
* **Interactive Canvas:** Draw states and transitions directly. Drag states to reposition.
* **Step-by-Step Simulation:** Watch tape execution and state transitions in real time.
* **Smart PNG Export:** Workspaces are saved as `.png` files that also store canvas state. Drop the image back onto the canvas to resume editing.
* **Grammar Tools:** Parse CFGs, generate derivation trees, run CYK, and convert between grammars and machines.
* **Algorithm Visualizations:** Step through NFA → DFA subset construction, DFA minimization, and regex compilation.

## Algorithms & Theory

The codebase implements algorithms commonly found in standard theory textbooks (like Hopcroft-Ullman, Sipser, etc.), featuring interactive variants of:
- Chomsky Hierarchy exploration
- Pumping Lemma validators (RL & CFL)
- Closure properties and decidability matrices

## Desktop app
The Windows and Linux AppImage builds update themselves: they check on startup and
on demand from **⋯ → Check for Updates**. If a check fails it shows a code —
[what the update error codes mean](docs/update-error-codes.md).

## Known Issues / Roadmap
- Mobile support is currently unfinished. Dragging canvas nodes on touchscreens causes unexpected panning and zoom issues.
- Auto-layout mathematics can sometimes freeze on incredibly dense, cyclic NFA graphs. PRs welcome to improve the layout heuristic.
- Multi-Tape Turing Machine rendering needs visual polish for tapes > 3.

## Contributing
Pull requests are welcome. Commits must be signed off (`git commit -s`) — see
[CONTRIBUTING.md](CONTRIBUTING.md), which explains the one legal formality and why
the project's licensing commitments depend on it.

## License
**[PolyForm Noncommercial License 1.0.0](LICENSE)**, with a supplemental grant that
converts each release to **AGPL-3.0-or-later** four years after it is published. The
Change Date for the current release is **2030-08-15**.

In plain terms:

* **Free to use** for students, teachers, schools, universities, researchers,
  charities, public research bodies and government institutions — that is written
  into the license by name, not left to interpretation.
* **Free for personal use**: study, hobby projects, experiment, private use.
* **Not free for commercial advantage** before the Change Date. Commercial licenses
  are available — email shreyan.chaubey@gmail.com.
* **Guaranteed to become free software.** The conversion grant is irrevocable and
  made in advance, so it does not depend on the author remaining active, reachable,
  or alive. If this project is ever abandoned, it still becomes AGPL on schedule and
  anyone can fork it.

Note that PolyForm Noncommercial is *not* an OSI-approved open source license, so
this repository is "source available" rather than open source until each release's
Change Date.

"AutomataStudio" and its logo are trademarks of Shreyan Chaubey and are not licensed
for use as the branding of derivative works. See [LICENSE](LICENSE), Part 2, §3.

Releases published before the license change remain available under CC BY-NC-SA 4.0
([LICENSE-PRIOR-VERSIONS.txt](LICENSE-PRIOR-VERSIONS.txt)); that grant is irrevocable
and is not withdrawn by the change.
