# 01 — The menu-bar app that owns the runtime

**Status:** not started — no code exists. **Narrowed twice on 2026-08-26:**
three of ADR-0023's four jobs now have answers that are not a native binary —
see *What already landed* below. What is left is the part only a native binary
can do, and it is smaller than this file was written to describe.
**Decided by:** [ADR-0023](../adr/0023-the-tray-app-owns-the-runtime.md), accepted
2026-08-26
**Blocked by:** [`00`](./00-score-the-hypotheses.md), by judgment rather than by
code. Nothing here is technically waiting on a score; building distribution for
an unproven bet is just the expensive order to do it in.
**Blocks:** [`05`](./05-chrome-web-store.md), and any honest attempt at H2.

This is the largest file here — two to three weeks — and it is the one that
turns *n=1* into *n=many*. ADR-0023 names the cost of not doing it: *"the reason
n=1 is partly that the second person cannot get the thing running."*

---

## Is this already done?

```bash
find . -name Cargo.toml -not -path './node_modules/*'
find . -name 'tauri.conf.json' -not -path './node_modules/*'
grep -c 'tauri' package.json
```

**As of 2026-08-26 all three return nothing.** No `.rs`, no `Cargo.toml`, no
`tauri.conf.json`, no `electron`, no packaging, no signing, no notarisation, no
auto-update, and `.github/workflows/ci.yml` runs typecheck, format and tests
with no build, no release job and no artefact upload.

### What already landed, 2026-08-26

While this folder was being written, `/welcome` arrived — a state machine over
facts rather than a wizard, in `src/server/welcome.ts` and
`src/app/welcome/page.tsx`. It already does two of ADR-0023's four jobs:

- **Runs both processes from one command** (`npm run dev` → `scripts/dev.ts`),
  which is ADR-0023's *Supervises* row minus the restart and minus production.
- **Pairs the extension in the app.** `src/server/extension-pairing.ts` shows the
  id that knocked and lets a person accept it on a screen, instead of copying a
  32-character string out of `chrome://extensions`. Its docblock is careful that
  this is **not authentication** — *"What changes is only WHERE the person
  expresses the decision"*.
- **Detects the API key rather than collecting it**, and says why: *"no product a
  person buys asks them for an API key, so this step is scaffolding for whoever
  is running the software, and it says so."*

So steps 4 and 5 below are now about **removing the last `.env` edit and the
restart**, not about building the flow. Steps 3, 7, 8, 9 and 10 — supervision,
migration on upgrade, a log file, the Playwright browser, and a signed release —
are untouched, and none of them can be done from inside a web page.

One gap that came with it: **nothing links to `/welcome`.** A new person landing
on `/` still sees *"Go and read about something for a while."* and has no way to
find the screen built for them. That fix is in [`04`](./04-quick-fixes.md).

Also worth knowing: **ADR-0023 is untracked.** `git log -- docs/adr/0023-*`
returns nothing. Commit it before you build against it.

---

## What you have to do yourself

This section is the reason this file is three weeks and not two.

| | What | Cost | Lead time |
|---|---|---|---|
| **Account** | **Apple Developer Program membership.** Required for a *Developer ID Application* certificate. Without one, macOS Gatekeeper refuses the app on any machine but yours, and there is no way around it. | **$99/year** | **hours to days** — Apple verifies identity, and an individual enrolment sometimes asks for ID |
| **Certificate** | A *Developer ID Application* certificate and a *Developer ID Installer* certificate, created in the Apple Developer portal and downloaded into your login keychain. | included | minutes, once enrolled |
| **Credential** | An **App Store Connect API key** (`.p8`, issuer id, key id) for `notarytool`. An app-specific password works too and is worse — it expires and it is tied to your Apple ID. | free | minutes |
| **Toolchain** | **Rust is not installed on this machine.** `which cargo` returns nothing. `rustup` install, then the `aarch64-apple-darwin` and `x86_64-apple-darwin` targets if you want a universal binary. | free | ~15 min |
| **Toolchain** | Xcode Command Line Tools — **already present** (`/Library/Developer/CommandLineTools`). | free | done |
| **Decision** | A name for the signed bundle and a bundle identifier (`com.<something>.propositum`). Once shipped, changing it orphans everybody's install. | — | think about it once |

**Do the Apple enrolment first, on day one.** Everything else can be built while
it processes; nothing can be shipped until it lands.

---

## The work

ADR-0023's own table is the specification. Four things, and it is worth
resisting a fifth.

1. **Commit ADR-0023**, and while you are there fix the one thing it gets wrong:
   it attributes *"pressing Take over enqueues a run nobody drains"* to
   `README.md`. That sentence is a code comment at `scripts/worker.ts:10`. The
   README never warns about the worker at all.

2. **Scaffold the Tauri app.** A `src-tauri/` beside the Next app, a tray icon,
   no dock icon, one small window.

3. **Supervise, for production.** Spawn `next start -p 3117` and
   `tsx scripts/worker.ts` as children. Restart on crash with a backoff. Kill
   both on quit — an orphaned worker holding a lease is worse than no worker.
   - `scripts/dev.ts` is the shape to absorb, not the code to reuse: it is
     development-only, and it deliberately does **not** restart anything. Its
     one hard rule is worth carrying over — *"one child dying does not take the
     other with it"* — because killing the web server when a worker crashes
     would be quietly reversing ADR-0001.
   - What is still missing is the restart. `src/runtime/worker-process.ts`
     sweeps expired *leases* from inside the worker; nothing watches the worker
     itself. Its own comment: *"A failed sweep costs one interval. A dead worker
     costs every run after it."*

4. **Configure.** One field for `ANTHROPIC_API_KEY`, written to `.env`. Today
   this is a hidden dotfile edited by hand, and there is no settings UI anywhere
   in the product.

5. **Pair the extension in one click.** Read the id, write
   `PROPOSITUM_EXTENSION_ID`, restart the Next child. Today this is a 32-character
   string copied out of `chrome://extensions`, and getting it wrong produces a
   `bad-origin` visible only inside an HTTP 403 JSON body
   (`src/app/api/session/current/route.ts:181`).

6. **One status light**, off `intentionState()`. Five members —
   `working`, `delegated`, `needs-you`, `sleeping`, `done`. Not a dashboard.
   Principle 13: *"The system should be comfortable doing nothing."*

7. **Run `prisma db push` on first launch and after an upgrade**, then restart so
   the append-only triggers are reinstalled and verified. `db push` silently
   drops the triggers on any table it rebuilds, and a ledger without its triggers
   looks identical and is not append-only.

8. **A log file** at `~/Library/Logs/Propositum/`, a version string somewhere a
   person can read, and a **Copy diagnostics** button. Today there is no log file
   at all — everything is `console.log` to whichever terminal is in front of you,
   gone when the window closes. This does not violate the no-telemetry rule:
   nothing is sent, the person copies and chooses.

9. **Handle the Playwright Chromium.** `src/policy/playwright-fetcher.ts` imports
   `playwright` and launches Chromium. It is a devDependency whose postinstall
   pulls hundreds of megabytes, it is documented nowhere, and if it failed the
   worker throws on the first fetch with no user-facing message.

10. **Release CI.** Build, sign, notarise, staple, produce a `.dmg`, and publish
    an update feed. Tauri's updater needs its own signing keypair — that is
    separate from the Apple certificate and is generated locally.

---

## Done when

- A person who has never seen the repository can install a `.dmg`, paste an API
  key, click one button, and reach an offer — **without opening a terminal.**
- Quitting the app leaves no orphaned Node process.
- Killing either child brings it back.
- `spctl -a -vvv` and `xcrun stapler validate` both pass on the shipped `.dmg`.
- **Then hand it to a stranger and time them to first offer.** That number is the
  product metric that does not exist today.

---

## What this does not cover

- **The Chrome extension still has to be sideloaded** until
  [`05`](./05-chrome-web-store.md) is done. The pairing button helps; Developer
  mode is still Developer mode.
- **Windows and Linux.** ADR-0023 is macOS. Everything above about signing is
  Apple-specific and has a different, equally tedious equivalent elsewhere.
- **It does not make the Mac stay awake.** *"Leave your desk, not leave the
  building"* is unchanged: a lid close can be delayed about thirty seconds, not
  blocked, and a local worker stops when the machine sleeps.
- **ADR-0023 states its own price and it is not small.** Two refusals in this
  corpus — [ADR-0012](../adr/0012-screen-capture-refused.md) and
  [ADR-0014](../adr/0014-reading-free-busy.md) — were argued partly on *"the
  proposal is not X; it is become a desktop product"*. This builds the native
  binary both were watching for. Neither refusal is reversed, and both are now
  cheaper to reverse. Re-read them before the first thing that wants a native
  capability arrives.
