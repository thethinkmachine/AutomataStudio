# AutomataStudio Library

A browsable, verified library of automata, Turing machines and transducers for
[AutomataStudio](https://thethinkmachine.github.io/AutomataStudio/). Busy
beavers, textbook DFAs, ω-automata, pushdown machines, transducers — every one
opens in the app with a click.

**Browse:** <https://thethinkmachine.github.io/automata-library/> · or in the app,
**More ▸ Library** (shortcut <kbd>5</kbd>).

## What the badges mean

Nothing on a listing is taken on trust except the words its author wrote. On
every merge the CI loads each machine with the AutomataStudio engine and asks it:

| Badge | How it is earned |
| --- | --- |
| ✓ Tests pass | every accept/reject/output example on the machine's card was run and holds |
| ◆ Deterministic | the editor's own determinism rule finds no conflict |
| ✂ Minimal | a DFA with as few states as its language allows |
| ■ Halts | a Turing machine run from a blank tape to its halt; the step count is exact |
| ∞ Never halts | proven by a cycler, a translated cycler, or backward reasoning |

Two entries for the same regular language are found by fingerprinting their
minimal DFAs, and the later one says so.

## Adding a machine

From the app: **More ▸ Library ▸ Submit a machine**. It runs these same checks,
shows which badges you will get, and opens the submission form here with every
field filled in. Or [fill in the form yourself](../../issues/new?template=submit-machine.yml).

The Submission workflow turns the issue into a pull request credited to your
GitHub account, and the Check workflow reports on it. A maintainer
merges it, and it is live in the app and on the website a minute later.

You can also open a pull request directly: add a `.automaton` file under
`machines/<family>/<type>/`, with `meta.title`, `meta.blurb`, some
`meta.inputs` examples, and `meta.library` — `author.login` (your GitHub
username, which must match the pull request), `license` (`CC-BY-4.0` or
`CC0-1.0`), and optionally `tags`, `difficulty`, `chapter`, `forkOf`. Notes
on the machine go in an essay: a `.md` file of the same name beside it.
Only an entry's author or a maintainer can change it; to build on
someone else's machine, add a new file with `forkOf` set to its id.

## Layout

```
machines/<family>/<type>/<name>.automaton   entries — the id is the path without machines/ and .automaton
collections/<id>.json                       { title, blurb, curator, entries: [id, …] }
library.config.json                         repo, site, maintainers, featured collections
```

## Running the build locally

The CI runs the engine from a checkout of AutomataStudio:

```sh
git clone https://github.com/thethinkmachine/AutomataStudio .engine
(cd .engine && npm ci --omit=dev --ignore-scripts)
node --conditions=browser --conditions=development .engine/scripts/library/build.mjs --library . --out _site
npx serve _site   # then, in the app: More ▸ Library ▸ How it works ▸ Source → http://localhost:3000/
```

## Setting up a copy

1. Settings ▸ Pages ▸ Source: **GitHub Actions**.
2. Create the **submission** label.
3. Optional: a `LIBRARY_BOT_TOKEN` secret (fine-grained token with contents and
   pull-requests write) so submissions' pull requests trigger the Check workflow.

## Featured collections

`featured` in `library.config.json` lists the collections the Library's
Discover page and the website's home page show first, in order.

## Licence

Each machine carries its own licence — CC-BY-4.0 or CC0-1.0 — in
`meta.library.license`, chosen by its author. See [LICENSE.md](LICENSE.md).
