An essay is the long form of a machine's page: what it does, why it is interesting, where it comes from, and what to look at while it runs. It is Markdown, it sits beside the machine it is about, and the library fills in what it can answer better than you can — the numbers, the figures, the links. This page is everything an essay can hold, each example shown with what it becomes.

## Where an essay lives

An essay is a Markdown file beside its machine — `machines/turing/busy-beaver/bb5.md` beside `bb5.automaton` — or beside a collection, as `collections/busy-beavers.md` beside `busy-beavers.json`. It is its own file, so editing the prose never changes the machine, its hash or its badges.

On the machine's page it reads after the showcase — the figure, the definition, *Try it* — with a contents list in the margin once it has three or more sections. It replaces the short *Write-up*, which is shown only when there is no essay.

There are two ways to send one.

- **From the app.** *More ▸ Library ▸ Submit a machine* has an essay editor. Type, or press **Open .md file…** — or drop a file on the editor — to use one you have already written, in Obsidian or anywhere else. **Save as .md** writes it back out. The editor keeps a draft for each machine as you type, and **Undo** brings back a draft that opening a file replaced. Sending an update of your own entry starts from the essay it already has.
- **By pull request.** Add the `.md` file beside your machine in the library repository. Only a machine's author, or a maintainer, can add or change its essay.

In the editor, **Write**, **Split** and **Preview** choose the layout; Split puts the Markdown beside the page it makes, scrolled together. <kbd>Ctrl</kbd> <kbd>E</kbd> (<kbd>⌘</kbd> <kbd>E</kbd> on a Mac) switches between writing and reading. The preview is the real page, drawn with your machine's own numbers and figures, and anything the library could not answer is listed under it — the same list the pull request's check will post.

## Text

Paragraphs are separated by a blank line; a single line break inside a paragraph is just a space. End a line with two spaces or a backslash to break it.

```example
Emphasis is *italic* or _italic_, **bold**, and ***both***.
~~Struck through~~, ==highlighted==, H~2~O and x^2^.
Inline `code` keeps its characters exactly: `a*b*c`.
"Quotes" -- dashes... and (c) are set properly.
```

## Headings

Start a line with `#` through `######`. The page's own title is the machine's name, so your shallowest heading becomes the page's second level: an essay written with `#` sections and one written with `##` read the same. Every heading gets a link target, and the level-two headings make the contents list.

```example
## Why it halts

### The last stage
```

## Lists

```example
- A bullet
- Another, with a nested list
  - inside it
  1. or numbered

3. A numbered list can start anywhere
4. and counts on

- [x] A task that is done
- [ ] and one that is not
```

## Quotes and rules

```example
> A quotation, set apart from the text.

---

Three dashes on a line of their own draw a rule.
```

## Links and images

A link can go to a web page, an e-mail address, a heading in the essay, or another entry or collection in the library. Library links are checked when the essay is built: a link to something that is not in the library is reported, and shown as plain text.

```example
[bbchallenge.org](https://bbchallenge.org), or just https://bbchallenge.org.
The champion of [two states](lib:turing/busy-beaver/bb2),
or Obsidian's way: [[turing/busy-beaver/bb2]] or [[turing/busy-beaver/bb2|with your own words]].
A link to [a section](#links-and-images) of this essay.
```

An image is `![what it shows](https://…)`. Its address must be `https://` — an essay cannot load an image over a plain connection or from a file on your computer — and the text in brackets is what is shown if it cannot be loaded, and what a screen reader says. A link may go to `http(s)://`, `mailto:`, a `#heading` or `lib:<id>`; any other kind of link is shown as its text.

## Tables

A row of dashes under the first row makes a table. A colon on the right of the dashes aligns that column right — the way to set numbers — and colons on both sides centre it.

```example
| Stage | Ones | mod 3 |
|:--|--:|:-:|
| 1 | 6 | 0 |
| 14 | 12,284 | 2 |
```

## Code

Fence code with three backticks, and name its language if you like. Four spaces of indentation also make a block.

````example
```js
const halts = steps < budget;
```
````

## Footnotes

A footnote is cited with `[^name]` and written anywhere with `[^name]: …`. Notes are numbered in the order they are cited and collected at the end of the essay, each with a way back to where it was cited. A note cited but never written is reported.

```example
Radó posed the game in 1962.[^rado]

[^rado]: T. Radó, “On non-computable functions”, *Bell System Technical Journal* 41 (1962).
```

## Definition lists

```example
Busy beaver
: The halting machine with the most steps for its size.

Σ(n)
: The most 1s any halting n-state machine leaves.
```

## Callouts

A quotation that starts with `[!kind]` is a callout, the way Obsidian writes them. The rest of that first line is its title; without one, the kind is the title. A `-` after the kind folds it closed, a `+` folds it open.

```example
> [!tip] Try this
> Run it for 90 steps and watch the head.

> [!warning]- The proof is long
> It took years, and a proof assistant, to finish.
```

The kinds are `note`, `info`, `todo`, `abstract` (also `summary`, `tldr`), `tip` (also `hint`, `important`), `success` (also `check`, `done`), `question` (also `help`, `faq`), `warning` (also `caution`, `attention`), `failure` (also `fail`, `missing`), `danger` (also `error`), `bug`, `example` and `quote` (also `cite`). Each has its colour; any other kind is drawn as a plain one.

## Mathematics

Mathematics is written in LaTeX and typeset by KaTeX: `$…$` or `\(…\)` in a sentence, `$$…$$` or `\[…\]` displayed. Nothing inside it is read as Markdown, so an underscore is a subscript and never emphasis.

```example
The map is $g(3k) = 5k + 6$, and it stops on $3k + 2$:

$$ g(3k+1) = 5k + 9 $$
```

A dollar sign followed by a space, or a closing one followed by a digit, is a dollar sign: "$5 and $10" stays prices. To be sure, write `\$` for a dollar sign.

## Facts the library fills in

Write `{{steps}}` rather than typing a number, and the library puts in the number it counted when it ran your machine — the same analysis that earns the badges, so the essay cannot drift from the machine. A fact is set apart from your words, and hovering it says where it came from. Name another entry to ask about that one instead: `{{steps turing/busy-beaver/bb2}}`.

```example
It halts after {{steps}} steps and leaves {{ones}} ones, having visited {{cells}} cells.
In the standard format, {{standard}} is a {{size}} machine with {{states}} states as drawn.
```

| Fact | What it is | When it is there |
| --- | --- | --- |
| `{{steps}}` | steps from a blank tape to the halt | a one-tape Turing machine that halts |
| `{{ones}}` | non-blank cells at the halt | a Turing machine whose run was settled |
| `{{cells}}` | cells visited before it halts | a Turing machine whose run was settled |
| `{{states}}` | states, as drawn | every machine |
| `{{transitions}}` | transitions, as drawn | every machine |
| `{{size}}` | states × symbols, read off its code | a machine in the standard format |
| `{{standard}}` | its code in the standard format | a machine in the standard format |
| `{{title}}` | its name in the library | every machine |

A fact the library does not know is shown in red as `[[name?]]` and reported. In the editor's preview, a run longer than the preview has time for shows as `…` until the library builds it.

## Figures from the machine

A figure is drawn from the machine itself when the essay is shown. Open it with `:::` and the figure's name, write its caption on the lines that follow — in Markdown, facts and all — and close it with `:::` alone. Figures are numbered in order.

```example
::: spacetime steps=6 h=160
Its whole run: {{steps}} steps from a blank tape, time running down.
:::
```

| Figure | What it draws | Settings |
| --- | --- | --- |
| `::: spacetime` | the tape at each step, time running down; the head's path when every step fits | `steps=` how many (2,000 unless you say; at most 200,000), `h=` height (420; 160 to 900) |
| `::: growth` | non-blank cells against steps, over the whole run | `y=log` for a log scale on the count; `scale=linear` for plain steps (the default is a log scale) |
| `::: diagram` | the machine's state diagram | — |
| `::: machines` | cards for the entries you name, as a row | the ids, separated by spaces |

`spacetime` and `growth` need a Turing machine the library can write in the standard format; `growth` runs it to its halt, up to 100 million steps. Add `id=` to any of the first three to draw another entry instead: `::: spacetime id=turing/busy-beaver/bb2`. A figure that cannot be drawn is left out and reported.

## HTML

A few bare tags are allowed where Markdown has no way to say something: `<kbd>`, `<details>` and `<summary>`, `<sub>`, `<sup>`, `<mark>`, `<ins>`, `<del>`, `<s>`, `<u>`, `<b>`, `<i>`, `<em>`, `<strong>`, `<small>`, `<cite>`, `<q>`, `<dfn>`, `<var>`, `<samp>`, `<code>`, `<abbr>`, `<br>`, `<hr>`, `<p>`, `<div>`, `<span>` and `<center>` — with no attributes. Anything else is shown as the text it is, and reported. An essay is published from someone's submission and read inside the app, so it cannot carry scripts, styles or anything that reaches outside the page; a tag left open is closed at the end of the essay, so it can never spill into the page around it.

```example
Press <kbd>Space</kbd> to step.

<details>
<summary>The long derivation</summary>

Folded away until it is opened.

</details>
```

## Front matter and limits

A file that starts with YAML front matter — a block between `---` lines at the very top, as Obsidian and most site tools write it — is read without it; it is the file's bookkeeping, not prose.

An essay can be up to 60,000 characters, and the editor opens files of up to 1 MB. A longer essay is refused when it is submitted.

## What the check reports

When an essay is built — in the editor's preview, and on the pull request — anything the library could not answer is listed rather than hidden:

- a fact it does not know, or cannot know for this machine;
- a figure the machine cannot draw;
- a library link to something that is not in the library;
- a link or image address of a kind an essay cannot use;
- HTML that is not a bare allowed tag;
- a footnote cited but never written.

These are warnings. The essay is still published, with the problem showing; fix them in an update.

## Writing a good one

- **Start with what is interesting.** The first paragraph is what most readers read. Say what the machine does that is worth a page.
- **Let the library say the numbers.** A fact cannot go out of date, and it tells the reader the number was checked.
- **Show, then explain.** A space-time diagram or a growth chart, captioned with what to look at, does more than a paragraph about the same thing.
- **Say where things come from.** Footnotes are for sources: the paper, the person, the year.
- **Put shared history on the collection.** Where several machines share a story — the busy beaver game, a textbook chapter — tell it once, in the collection's essay, and keep each machine's essay about that machine.
- **Check what you claim.** Run the machine. If a sentence says something happens at step 4,029, the space-time diagram should show it.
