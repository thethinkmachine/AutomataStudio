# Contributing to AutomataStudio

Contributions are welcome. Please read this page before opening a pull request —
it covers one legal formality that is easier to get right the first time than to
untangle later.

## Why there is a formality at all

AutomataStudio is released under the PolyForm Noncommercial License with a
supplemental grant that turns each release into AGPL-3.0-or-later four years
after publication (see [LICENSE](LICENSE)). Two things depend on the project
being able to set its own outbound terms:

- **The conversion promise.** Every release must be relicensable to the AGPL on
  its Change Date. A contribution that cannot be relicensed would freeze on the
  noncommercial terms forever and quietly break that guarantee.
- **Commercial licensing.** Commercial licenses fund the project, and PolyForm
  explicitly forbids sublicensing. Without a separate grant, a merged
  contribution cannot be included in one.

A plain "inbound = outbound" contribution would block both. So contributors are
asked to certify origin *and* to grant the maintainer the licensing rights those
two commitments require. You keep the copyright in your contribution — this is a
licence, not an assignment.

## What you need to do

Sign off every commit:

```bash
git commit -s -m "your message"
```

That appends a line to the commit message:

```
Signed-off-by: Your Name <your.email@example.com>
```

Use your real name and a real email address. By signing off you certify the
Developer Certificate of Origin 1.1, reproduced below, **and** you agree to the
additional grant that follows it.

## Developer Certificate of Origin 1.1

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

## Additional grant

By signing off on a contribution to this project, you additionally agree that:

1. You retain copyright in your contribution. Nothing here transfers ownership.

2. You grant Shreyan Chaubey a perpetual, worldwide, non-exclusive,
   royalty-free, irrevocable licence to reproduce, prepare derivative works of,
   publicly display, publicly perform, sublicense, and distribute your
   contribution and derivative works of it, **under any licence terms**,
   including the PolyForm Noncommercial License, the AGPL, and paid commercial
   licences.

3. You grant every recipient of the project a perpetual, worldwide,
   non-exclusive, royalty-free, irrevocable patent licence to make, use, sell,
   offer for sale, import, and otherwise transfer your contribution, limited to
   the patent claims you can license that are necessarily infringed by your
   contribution alone or by its combination with the project.

4. You confirm you are legally able to make these grants — in particular, that
   if your employer has rights in work you create, you have permission to
   contribute it, or your employer has waived those rights.

5. Your contribution is provided as is, without warranty of any kind.

If you cannot agree to this, please open an issue describing the change instead
of a pull request. A described bug or a design suggestion carries no licensing
question at all, and is genuinely useful.

## Attribution

Contributors are credited in the commit history, which is permanent. If a
contribution is substantial and you would like to be named in the About dialog,
say so in the pull request.

## Practical notes

- `npm test` must pass. The suite is `node:test` over `tests/*.test.js`.
- Match the surrounding code — the codebase has strong local conventions, and
  [CLAUDE.md](CLAUDE.md) documents the load-bearing ones (the `bridge.js` seam,
  evaluation order, the `store.js` change protocol, the layout pass).
- Keep computation separate from rendering in algorithm code; that separation is
  what makes the algorithms testable.
