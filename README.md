# AutomataPlayground

A web-based visualizer and simulator for finite state machines, pushdown automata, and Turing machines. It includes interactive tools for regular grammars, context-free grammars, and visual algorithm stepping.

---

## Quick Start
Run the app locally. Requires Node.js.

```bash
git clone https://github.com/yourusername/AutomataPlayground.git
cd AutomataPlayground
npm install
npm run dev
```

Open `http://localhost:5173/` (or whichever port Vite uses) in your browser.

## Features

* **Multiple Machine Types:** DFA, NFA, ε-NFA, PDA, TM, NDTM, MTM, Moore, and Mealy.
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

## Known Issues / Roadmap
- Mobile support is currently unfinished. Dragging canvas nodes on touchscreens causes unexpected panning and zoom issues.
- Auto-layout mathematics can sometimes freeze on incredibly dense, cyclic NFA graphs. PRs welcome to improve the layout heuristic.
- Multi-Tape Turing Machine rendering needs visual polish for tapes > 3.

## License
CC BY-NC-SA 4.0
