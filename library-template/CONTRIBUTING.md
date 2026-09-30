# Contributing

- **A new machine:** submit it from AutomataStudio (More ▸ Library ▸ Submit a
  machine), or use the issue form. Give it a clear title, a sentence of
  description, and example words on its card with their expected verdicts —
  those are what the "Tests pass" badge checks.
- **An update to your machine:** open it from the Library, change it, and
  submit. The app fills in "Updates" with your entry's id, and the submission
  replaces it — even under a new title — and bumps its version. Only an entry's
  author can update it.
- **A remix:** open someone else's machine from the library, change it, and
  submit. The app fills in "Remix of" for you, and your version appears in the
  original's remix tree.
- **An exercise:** build it in an exercise tab and submit with "An exercise"
  chosen; it keeps its checker.
- **A collection:** open a pull request; maintainers review those by hand.
- **An essay about your machine:** write it in the app — Submit a machine has
  an essay editor with a live preview, and can open a `.md` you already wrote
  (from Obsidian or anywhere) — or open a pull request adding a Markdown file
  beside it: `machines/…/bb5.md` beside `bb5.automaton`. It is shown on the
  machine's page in the app and on the website. Write `{{steps}}`, `{{ones}}`,
  `{{states}}` or `{{steps <other entry's id>}}` rather than typing a number:
  the library fills in what it computed. `::: spacetime`, `::: growth`,
  `::: diagram` and `::: machines <id> …` draw figures from the machine, and
  `[text](lib:<id>)` or `[[id]]` links to another entry or collection. All of
  Markdown works — tables, footnotes, task lists, `$…$` math, `> [!note]`
  callouts; raw HTML is limited to a few bare tags such as `<kbd>`. The pull request's
  report lists anything the library could not answer. Only a machine's author
  (or a maintainer) can add or change its essay.

Keep machines to what they need to be — the library takes files up to 1.5 MB
and 2,000 states.
