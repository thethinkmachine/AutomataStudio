# Update error codes

The desktop app checks for updates on startup, and again whenever you pick
**⋯ → Check for Updates**. If a check fails it shows a short explanation and a code
like `UPD-02`. This page says what each code means.

Codes only appear in the desktop app (Windows and the Linux AppImage). The website
is always up to date, and the macOS and `.deb` builds are updated by hand.

## Codes

| Code | What happened | What to do |
| --- | --- | --- |
| `UPD-01` | The app could not reach the update server at all. Usually no internet, or a firewall, VPN or proxy blocking the connection. | Check your connection and try again. |
| `UPD-02` | The server answered, but there is no update information published yet. Normal right after a release is tagged, while the files are still uploading. | Wait a few minutes and try again. |
| `UPD-03` | The update server refused the request — commonly rate limiting after many checks in a short time. | Wait a few minutes and try again. |
| `UPD-04` | The update server reported a problem on its side. | Nothing to fix locally; try again later. |
| `UPD-05` | An update downloaded, but its contents did not match what the server said they should be, so it was discarded rather than installed. | Try again. If it keeps happening, report it — see below. |
| `UPD-06` | This copy of the app has no update channel, so it cannot update itself. Expected for the macOS and `.deb` builds, and when running from source. | [Download the latest version](https://github.com/thethinkmachine/AutomataPlayground/releases/latest) manually. |
| `UPD-99` | Something failed that does not match any case above. | Report it — see below. |

`UPD-05` is a safety feature, not a bug in itself: the app refuses to install
anything it cannot verify. The usual cause is a download interrupted partway.

## Reporting a failure

Open an issue at
[github.com/thethinkmachine/AutomataPlayground/issues](https://github.com/thethinkmachine/AutomataPlayground/issues)
with the code, your operating system, and the app version from **⋯ → About**.

The full technical error is written to the console, not to the dialog — it contains
response headers that are noise to a reader and can include session cookies. To
capture it, start the app from a terminal and reproduce the failure; lines from the
updater are prefixed `[updater]`.

## For maintainers

The codes are defined in the `UpdateErrors` table in
[`electron/main.cjs`](../electron/main.cjs), and `classifyUpdateError()` beside it
decides which one an error maps to. Adding a code means adding a row there **and** a
row here — a code with no entry on this page is worse than no code at all.
