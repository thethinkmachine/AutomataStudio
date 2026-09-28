---
name: library
description: AutomataStudio: the machine library — the index format, what earns each badge, the Library view, My Library and offline copies, deep links and automata-studio:// links, the submission path (issue form → PR, updates and remixes), and the library repo's CI scripts. Read before touching js/library/**, js/library-ui.js, css/library.css, scripts/library/** or library-template/.
---

### What it is

A public GitHub repository of `.automaton` files (`thethinkmachine/automata-library`), an index its CI builds **with this app's engine**, a website generated beside the index on GitHub Pages, and the Library view (More ▸ Library, key <kbd>5</kbd>) that browses it. The repository's scaffolding lives here in [library-template/](library-template/); `npm run library:init -- <dir>` copies it and seeds the first entries (every bundled example, the busy beaver champions, three non-halters, a few collections).

**It is a library, not a store.** Its job is to let someone find a machine, run it without opening it, learn from it, open or remix it, and send their own back. What was cut on 2026-09-28 because it made it a store, and should stay cut unless there is a reason that is about *this* app: challenges and leaderboards (the app has exercises), stars, downloads and popularity sorting, giscus discussions, author pages and avatars, a rotating spotlight, cards whose pictures take turns, link-preview PNGs, a Code tab, a Hall of Fame gallery, and two badges — *Code export* and *Round-trips* — that described the app's exporters rather than the machine.

**The one promise is that every badge is an answer the machine gave.** Nothing on a listing is taken from the author except their words. That is why [js/library/analyze.js](js/library/analyze.js) is one module shared by the app and CI: the submit dialog shows the badges CI *will* award by running the very code that awards them.

```
js/library/
  config.js       import-free. Every URL: the site (index, pictures, pages),
                  jsDelivr pinned to the index's commit (the files), deep links.
  hash.js         import-free. A synchronous 64-bit content hash, CRLF-normalised.
  index-model.js  import-free. normalizeIndex, the query language, facets. Also
                  shipped to the website, so its search and the app's are one.
  card-html.js    imports index-model only. The website's card as HTML, and
                  rules the app shares: badge order, a TM's size from its code.
  sketch.js       imports graph-thumb only. Every figure the app draws — a
                  diagram, a language strip, a TM's run — as SVG inked by
                  classes, from what the index carries.
  analyze.js      the checks and the badges; the card's pictures.
  client.js       the index and entry files fetched, verified and kept offline.
  submit.js       the submission document, the pre-check, the issue URL.
  requests.js     import-free. automata-studio:// links queued until boot ends.
js/library-ui.js  the view: discover, browse, entry pages, collections,
                  My Library, submit, about.
scripts/library/  build.mjs (index + site), site.mjs, seed.mjs,
                  issue-to-entry.mjs, guard.mjs, dev-server.mjs, env.mjs.
```

### Badges, and what earns each

`BADGES` in [js/library/index-model.js](js/library/index-model.js) is the list; `analyzeDocument` is the only thing that awards them.

- **tested** — every `meta.inputs` row with an `expect` or an `out` was decided by `decideRaw` and held. A row that claims nothing is skipped, not counted. A failing row is an **error**, not a missing badge: a card that lies about its machine is not published.
- **deterministic** — the machine's own `determinism.conflict` rule (the editor's) over every transition. An NFA earns it only when δ provably does not branch.
- **minimal** — `minimalDfaOf` (subset construction → Moore refinement → BFS renumbering) against the drawn state count. **A complete drawing is held to the minimal complete DFA, a partial one to its live states** (`isMinimalDfa`). Accepting either count for either drawing awarded the badge to a partial DFA with two equivalent states whenever the language happened to need a sink.
- **halts / never-halts** — [js/machines/tm-behaviour.js](js/machines/tm-behaviour.js), from a blank tape, one-tape deterministic TMs only. "Halts in 0 steps" is not a badge: that is a machine that expects input.

A badge that describes what *the app* can do with a machine — export it, generate code for it — is not a badge; it would be on every entry of that type.

`minimalDfaOf` returns a **canonical** table, so its hash (`languageFingerprint`) names the language, not the drawing: that is duplicate detection and the "Match my canvas" search. Where the index has the table (≤ 64 states), a fingerprint match is confirmed against it before anything is said. The table is also what lets `accepts:`/`rejects:` search run without downloading a machine.

Everything is asked of a *target* through `withMachine`, never by loading onto the canvas. [tests/library.test.js](tests/library.test.js) asserts the reader's machine is untouched after an analysis.

### Fetching, and trusting what arrives

- **The index and pictures come from Pages; the files from jsDelivr pinned to `index.commit`.** Pinned, a CDN cache cannot serve a file older than the index describing it — Pages' own CDN can, for minutes after a publish. The site's copy is the fallback, and the only source under the `as.library.base` override.
- **A file whose hash is not the index's is refused**, and the next URL tried — the badges on screen are claims about those exact bytes. `contentHash` normalises CRLF, or every Windows checkout would read as an update.
- **The index in memory belongs to one source.** `cachedLibrary()` answers only for the source the app is reading now, and `loadLibrary` drops a copy from another. Before, switching to the emulator (or back) showed the previous source's machines under the new source's name — and when the new one was down, kept showing them as "offline". The view switches through `switchSource()`, which also forgets the parsed files.
- **`loadLibrary` always yields before it does anything.** With a fresh copy in memory it would otherwise finish synchronously, run its `finally` before `inflight` was assigned, and leave a settled promise as "in flight" — which every later call, a forced Refresh included, got back.
- **An offline copy is not cached under the listed version's hash** (`entryDoc`): it is an older file, and the next look, online, should get the real one.
- **Storage is its own database** (`automata-studio-library`), not a store in the workspace DB: adding a store there is a version bump through `openWorkspaceDb`'s upgrade path, which guards the reader's tabs. Everything in it can be fetched again. With no IndexedDB it runs on Maps.
- **An opened entry is stamped** `meta.library.source = { id, hash, structure, version, title }` (`stampSource`). The card carries `meta.library` through edits and saves (`normalizeCardMeta` keeps it, ≤ 8 KB), which is what makes "Update available" on the card and "Remix of"/"Updates" in the submit form work with nothing typed. The card's line is drawn by a painter the Library installs in [js/card-source.js](js/card-source.js) — a leaf, because it is written at module scope across an import cycle.
- **An entry opens by `applyDocument` → `placeOpenedDocument`**, never `loadExampleFile` (which clears the canvas). It gets a tab of its own when the canvas is occupied, named for the entry (`opts.tabName`).

### Links

`#lib=<id>` opens, `#library=<id>` shows a listing, `#collection=<id>`, `#library`. The desktop app registers `automata-studio://` (package.json `build.protocols`, `setAsDefaultProtocolClient` in [electron/main.cjs](electron/main.cjs)), delivered like a file: `open-url`, argv, `second-instance`, and `library:take-pending` for a link that launched the app. Both are read **after the boot restore** (`startLibraryLinks` in `finishBoot`) for the reason THE BOOT GATE exists: opening places a tab, and the restore would paint over it. `isLibraryId` refuses `..`, `//` and anything outside `[A-Za-z0-9._/-]` — an id ends up in a fetch URL. A `#lib=` link that arrives with no network still opens a copy saved in My Library.

### Submitting: new entries, updates and remixes

There is no server and the app holds no token. `submissionLink` pre-fills the repo's issue form (`library-template/.github/ISSUE_TEMPLATE/submit-machine.yml`) with a share link re-rooted on the published app. Past `ISSUE_URL_MAX` the machine is left out and put on the clipboard. **The form's fields are `FORM_FIELDS` in [issue-to-entry.mjs](scripts/library/issue-to-entry.mjs)**: their `id`s are the query parameters `issueUrlFor` sets, their labels are what `parseIssueForm` reads back, the emulator draws its form from them, and a test holds them to the YAML.

- **`parseIssueForm` starts a section only at one of the form's own labels, and each only once.** The write-up is Markdown; splitting on every `### ` truncated a write-up at its first heading.
- **An entry opened from the library is either a remix or an update, and the account decides.** `updateOf()` in submit.js: the source entry, when the form's login is its author. An update sends `updates=<id>` and is *not* a remix of itself — it keeps the entry's own `forkOf`. Anyone else's changes are a remix (`forkOf` = the source). Before this, an author resubmitting their own entry filed it as a remix of itself; the build refused that, and the publish step silently dropped the entry.
- **CI decides the same way, by the issue's account** (`updateTarget` in issue-to-entry.mjs): "Updates" names the entry — or, for a form filled in by hand, a "Remix of" naming the author's own entry means the same. An update is written over that entry's path whatever its title now is; naming someone else's entry is refused, never quietly turned into a new one. A new entry's path comes from its title, and **the author is always the issue's author**: someone else's title lands beside it (`-<login>`).
- **What an entry is remixed from has to exist** — checked at submission, because it is the one fact about an entry that depends on another file, and the build drops what fails. The build itself treats a self-remix as a warning and ignores the link: not worth unpublishing an entry over.
- **Exercise or machine is in the issue *title*** ("[Exercise] …"), which the workflow passes as `ISSUE_TITLE`. The body does not carry it; reading it from the body stripped every exercise's checker.
- `guard.mjs` applies the credit rule to direct pull requests, with **the maintainer list read from the base branch** (`maintainersAt`): a PR that added its own author to `maintainers` used to wave itself through. Collections and `library.config.json` are maintainers' changes.
- `build.mjs --check --changed-since` is the PR check. Its report goes to the run's **step summary** as well as a PR comment, because a fork's PR gets a read-only token and the comment fails. `build.mjs` without `--check` publishes only what passed, drops every reference to what did not, and **serves only the listed files** — a failing file is not copied to the site either.

### Running CI's code here

`scripts/library/env.mjs` loads the DOM stub, the simulation module (for its painter hook) and the machine layer — not `main.js`, whose boot a CI job does not want. Scripts run with `--conditions=browser --conditions=development`; the `library:*` npm scripts say so. The library repo's workflows check out this repo at `main` as `.engine` and `npm ci --omit=dev --ignore-scripts`, so a change here changes what CI awards on the next library build.

StateMate reaches the library two ways: `/library [words]`, and the `search_library` agent tool (synchronous, like every tool — the first call starts the download and says to ask again).

### Busy beavers and the standard format

`writeStandardTM` in [js/interop/standard-tm.js](js/interop/standard-tm.js) is the inverse of `readStandardTM`, exact on its output: start state is A, the halt is a state that accepts and has no moves, and anything the notation cannot say (an S move, a wildcard, a non-digit symbol, an accepting working state) answers `null` rather than an approximation. `analyzeDocument` stores it as `facts.standard`, so every one-tape TM listing carries its code — Copy, "View on bbchallenge.org" (`bbchallengeUrl`, `&status=halt` when it halts) — and pasting a code into search finds the machine. **A TM's size (states × symbols) is read off that code** (`standardSize` in card-html.js), never from the drawn state count, which includes the halt state — guessing whether to subtract it was wrong whenever the halting analysis ran out of budget. A collection that is mostly TMs draws an "At a glance" table (size, steps, non-blank, code). `library.config.json`'s `featured` list puts collections first on the home page.

### The local emulator

`npm run library:dev` ([scripts/library/dev-server.mjs](scripts/library/dev-server.mjs)) seeds `.library-dev/` (gitignored) on first run, builds it with `build.mjs`, serves `_site` with CORS on **127.0.0.1 only** (it writes files for whoever posts its form), rebuilds on edits under `machines/` and `collections/` (analyses cached by content hash, ~1 s), and emulates the issue form at `/_emulator/issues/new`. The index it serves carries `emulator: true` and `submit: <that form>`, which the app's Submit follows instead of GitHub; posting runs the real `issue-to-entry.mjs` and merges at once.

**The cache outlives a build**, so an entry never shares an array with the cached analysis (`badges: [...f.badges]`): the build writes to entries, and a write into the cache lands in every later build — which is how the old challenge badge came to appear once more per rebuild.

The app is pointed at it with `#library-source=<url>`, **accepted for loopback addresses only** (`parseLibrarySourceHash`) — anyone can send a link, and one that repointed a reader's Library at a stranger's server would show badges no CI earned. Library ▸ How it works ▸ Source ▸ Reset goes back to the published library.

`build.mjs` reads dates from git only when the library directory is the top of its own repository (`isOwnRepo`): `.library-dev/` sits inside this checkout, and asking git there costs ~60 ms a file for the wrong repository's history.

The dev server binds its port **before** it builds or watches: a second copy started while one runs used to fail on the port with its watcher already running, and the orphan went on rebuilding the library with stale code — silently overwriting the running one's index.

### How it looks, and why

**A catalogue set like a mathematics book, not a storefront.** Redesigned on 2026-09-28 because the first look — gradient hero, rainbow cards with coloured top bars, emoji badge pills, baked neon "screens" — read as generic, and ignored the app's own identity (the Reference view's textbook tone, the Crimson Pro serif it loads).

- **Three faces, one job each.** Crimson Pro for the names of things and prose (`.lib-display`, plate titles, section heads, the lede, figure captions in italic); JetBrains Mono for data (captions like `DFA · 3 states`, counts, codes, words run, small-caps kickers); DM Sans for controls. The overlay forces mono on its tool views, so the Library resets to sans **inside `:where()`** — at full specificity that reset outranked every per-element face choice and turned the serif titles back to sans.
- **Hairline rules, not boxes.** Section heads are a serif title on a rule (`sectionHead`). Only figures are boxed. Secondary actions are words (`.lib-textbtn`), not buttons.
- **Never put a Library heading in a `<header>` element**: `css/layout.css` styles every `header` as the app's 48 px top bar. The Library's heads are `div`s.
- **Figures are drawn in the app, in the theme's ink** (`js/library/sketch.js`). A figure is a well of `--bg` with the canvas's dot grid, cut into the `--bg2` pane the way the canvas is cut into the frame. The SVG carries classes (`sk-n`, `sk-e`, `sk-ah`, `lg-a`, `rn-1`, …) and `library.css` inks them from the theme, so the same drawing is right in all 35 themes — a test asserts no baked colour. Edges stop at the circles and end in arrowheads; state names and edge labels are serif italic, like a textbook figure.
- **Everything a card draws travels in the index**: `entry.sketch` (packed positions and index pairs, ≤ 60 nodes — `packSketch`), `entry.dfa` (the language strip — `languageRows`), `entry.standard` (a TM's run — `framesFromStandard`). A page of cards costs no image requests and draws offline. The build's `art/` SVGs remain for the website, link previews, and a machine too large for a sketch.
- **A plate** is its figure (a TM's run, else its diagram), a serif title, one mono caption line with the family dot, and what was checked in words ("✓ Tested · Minimal"). **Colour is spent on marks only**: the family hue (`--h`) is the dot, the start arrow, a lit state, a TM head; the accent is for what can be pressed.
- **A listing** reads as one page, no tabs: crumbs, kicker, the title set large, byline, lede, one primary action; then the figure beside an aside holding the **formal definition typeset from the machine itself** (`buildFormalDefLatex` from render.js under `withMachine`, rendered by `triggerMath`), what was verified in sentences, and the facts. Try it sits directly under the figure and paints the run on it. Then Behaviour (a TM's run beside what it proves), Notes (the author's write-up in serif), Related (remixes, the same language).
- **A figure takes its machine's proportions** (`sketchAspect`, width over height clamped to 1.5–2.8), so a row of three states is not a speck in a tall well; the listing sets `--fig-aspect` from the index's sketch before the file arrives, and the file's live drawing uses the same height.
- **Browse** is a catalogue's search: the query on a single underline, a "refine by" column of facets with counts (the chosen one marked by an accent bar), and the plates.
- **Discover** is a masthead (kicker, a two-line serif statement, the search, one mono line of counts), the families as a typographic index listing the types in each, the featured collections, recently updated, and collections as rows with three small figures.

Try it's run: once the file arrives, the index sketch is replaced by `liveDiagram(target)` — the same drawing with names, labels (finite automata and letter-transducers only, where a label says the whole move) and every node a `data-s` group and every edge a `data-e` group. `traceWord(target, word, cap)` runs the machine's own `streamMachine` with the painter suppressed and the player's `simSteps` put back, and pulls at most `cap` steps (400), so BB(5) costs 400 steps, not 47 million. A step names its `tid`; a set run (an NFA) names none, so the edges lit are every drawn edge from a state it was in to a state it is in. Playback takes about six seconds whatever the length; under reduced motion it jumps to the last step.

- **The submit form re-reads its defaults when the machine changes** (`submitFields`, keyed by workspace and source), so switching tabs never files one machine under another's title.
- **A browser's `children` is an HTMLCollection**: use `Array.from`, never `.filter` on it — the DOM stub hands out arrays. A test runs `showPicture` over an array-like.
