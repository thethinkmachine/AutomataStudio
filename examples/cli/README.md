# Examples for the `automata` command line

The files the [CLI guide](../../docs/cli.md) uses. Every example there runs as written from this folder:

```sh
cd examples/cli
automata info div5.automaton
```

| File | What it is |
| --- | --- |
| `div5.automaton` | a DFA for the binary numbers divisible by 5: five states, one per remainder |
| `words.txt` | expectations for it, one word a line (`automata test`) |
| `contains-aab.automaton` | a draft DFA for the words containing `aab`, with the classic mistake: on a mismatch it starts over instead of keeping the overlap |
| `contains-aab.mjs`, `contains-aab.py` | what that language is meant to be, as a program — the oracle `automata fuzz` and `automata learn` ask, one word as an argument or (with `--batch`) one per line |
| `add.automaton` | a Turing machine that adds two binary numbers: `0101+11` |
| `machines.txt` | nine Turing machines, one for each way `automata halts` can answer |
| `messy.automaton` | a DFA with things for `automata lint` to find |
| `class/` | an exercise from `(ab\|ba)*` and nine students' answers, for `automata grade` and `automata similar` |

The guide's clips are filmed in a fresh copy of this folder (`npm run media:cli`) and its output blocks are run here (`npm run cli:docs`), so a change to one of these files shows up in both — regenerate them after editing.
