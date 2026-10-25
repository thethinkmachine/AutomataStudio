# What the website measures

The website, [automatastudio.pages.dev](https://automatastudio.pages.dev/), counts
which features are used and how well the app runs, so that the next release can
improve the parts people actually use. It does this with Google Analytics, and it
never sends anything from inside your work.

**The desktop app sends nothing.** Neither does a copy you run yourself, a preview of
an unreleased version, or the command line.

## Turning it off

Any one of these stops it completely, and Google's tag is never loaded:

- **Settings → General → Privacy → Share Anonymous Usage Statistics**, switched off.
  The choice is kept in your browser and applies straight away.
- Your browser's **Global Privacy Control** or **Do Not Track** setting.
- A content or tracker blocker.

## What is never sent

- Your machines: state names, transitions, alphabets, notes, layout.
- The words you run, and what a run printed.
- Your files and their names, share links and machine codes.
- What you ask StateMate, or what it answers.
- Library or grammar search text.
- The text of an error message, which can quote a state name.

The address sent with each visit is the page itself, without the part after `#`, which
is where a share link keeps its machine. Of the part after `?`, only campaign tags
(`utm_source` and the like) are kept. Where you came from is sent as a site, such as
`https://example.edu/`, never the page.

Google signals and ad personalisation are switched off in the tag itself.

## What is sent

Each event names a feature and the kind of machine on the canvas. Every event also
carries:

| Detail | Example |
| --- | --- |
| App version | `3.6.2` |
| Layout | `desktop` or `phone` |
| Machine type and family | `NPDA`, `pushdown` |
| Machine size, as a range | `6-20` states |

| Event | Sent when | Details |
| --- | --- | --- |
| `machine_type_chosen` | you pick a machine type | which type |
| `machine_opened` | a machine is opened | how (example, file, paste, link, machine code, library) and the format; the example's or library entry's public name |
| `open_failed` | a machine could not be opened | how, and whether it was unreadable or invalid |
| `wizard_finished` | the wizard builds a machine | create or edit |
| `view_opened` | you open the Library, Algorithms, Grammar or Reference | which view |
| `section_opened` | you open a panel section | which section |
| `algorithm_opened`, `grammar_tool_opened` | you open an algorithm or a grammar tool | which one |
| `run` | a run finishes | accepted, rejected or unknown, and whether a step limit stopped it |
| `run_refused` | a run could not start | no start state, unreadable input, or a rule of the machine |
| `batch_test_run` | a batch test runs | how many words |
| `share` | you copy a share link, machine code or machine link | which |
| `export` | you export | the format, and download or copy |
| `file_saved` | you save | none |
| `statemate_used`, `statemate_refused` | you send StateMate a request | build or edit, and the provider; or why it could not be sent |
| `exercise_checked` | an exercise answer is checked | the verdict |
| `onboarding_entry`, `onboarding_hint` | a choice on the empty canvas, a one-time hint | which choice or hint |
| `tutorial_begin`, `guide_step`, `tutorial_complete`, `guide_ended` | the guide, and the tour of the app | which lesson, chapter and step, and whether you did it, used Show me or skipped it |
| `activation` | you run a machine you built yourself, the first time | whether the guide helped |
| `undo_burst` | five or more undos within ten seconds | how many |
| `app_error` | something in the app failed | where in the app's code, never the message |
| `web_vital`, `app_ready` | the page loads and responds | load and response times |

The list above is the whole of it. The app refuses to send an event or a value that is
not in its fixed catalogue, and a test checks that no machine content reaches an event.

## Who sees it

The counts go to the project's Google Analytics property, under Google's
[privacy policy](https://policies.google.com/privacy). Google Analytics does not store
IP addresses. A cookie in your browser lets visits from the same browser be counted as
one visitor; clearing your cookies resets it.
