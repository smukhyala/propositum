# 01 — The menu-bar app that owns the runtime

**Status:** ~~not started — no code exists.~~ **Corrected 2026-08-27: stage 1
built** — scaffold, supervision with backoff, the light, the key field, the
kill switch, launch preflights and the log file all exist in `src-tauri/`.
~~What remains is stage 2: signing, notarisation, bundling the runtime, release
CI (item 10), and the *Done when* below, which is written for a stranger's
`.dmg` and stays open until one exists.~~ **Corrected 2026-08-28: stage 2
built** ([ADR-0027](../adr/0027-a-sealed-bundle-and-where-the-state-moves.md),
[#125](https://github.com/smukhyala/propositum/issues/125)) — the runtime is
staged and bundled (`scripts/stage-runtime.ts`), the crate is dual-mode with an
installed copy's state in Application Support, the hardened-runtime
entitlements entered over `tests/tray-permissions.test.ts`'s objection and
re-pinned it, `scripts/release-tray.ts` signs, notarises, staples and audits,
and a `v*` tag runs `release.yml`. **What stays open:** ~~the two credential
steps only a person can do (the *What you have to do yourself* table — minutes,
now that enrolment is approved),~~ **done 2026-08-30 — the certificate and
notary key exist, the first signed, notarised, stapled `.app` and `.dmg` both
passed `spctl` and `stapler validate` locally, and the six CI secrets are
set** — the first tagged release, and the *Done when*
below, which stays open until a stranger has installed one. The update feed
half of item 10 is **deferred, not built** — ADR-0027 §4 is the argument. ~~**Narrowed twice on 2026-08-26:**
three of ADR-0023's four jobs now have answers that are not a native binary —
see *What already landed* below. What is left is the part only a native binary
can do, and it is smaller than this file was written to describe.~~
**Widened again, hours later the same day** — see *What ADR-0025 did to this
file* below. It is still true that three of ADR-0023's four jobs are answered
without a binary; it is no longer true that what is left is small.
**Decided by:** [ADR-0023](../adr/0023-the-tray-app-owns-the-runtime.md), accepted
2026-08-26, **as amended by**
[ADR-0025](../adr/0025-computer-use-beyond-the-browser.md) the same day
**Blocked by:** [`00`](./00-score-the-hypotheses.md), by judgment rather than by
code. Nothing here is technically waiting on a score; building distribution for
an unproven bet is just the expensive order to do it in.
**Blocks:** [`05`](./05-chrome-web-store.md), ~~and any honest attempt at H2.~~
**and — added 2026-08-26 —** [`07`](./07-off-the-browser.md) and, through it,
[`08`](./08-one-time-codes.md), **and any honest attempt at H2.**

~~This is the largest file here — two to three weeks~~ **— struck 2026-08-26:
[`07`](./07-off-the-browser.md) is larger, and it depends on this one** — and it
is the one that turns *n=1* into *n=many*. ADR-0023 names the cost of not doing
it: *"the reason n=1 is partly that the second person cannot get the thing
running."*

### What ADR-0025 did to this file

**ADR-0023's prohibition 1 — that the tray app requests no TCC permission — is
amended, not deleted.** The binary this file describes is now the thing that
holds **Accessibility, Screen Recording and Full Disk Access**. That is a very
different install from a status light, and ADR-0023 said so about itself: a tray
app requesting none was *"the prohibition the other four exist to protect."*

What that changes here, concretely:

- **Notarisation stops being a nicety.** Three TCC prompts on an unsigned binary
  is not something you can ask a second person to accept, so the $99 and the
  signing identity move from *needed eventually* to *needed before anyone else
  runs this*.
- **The permission grants are a new *What you have to do yourself* row**, and
  there are three of them, each granted by hand in System Settings, each with its
  own dialog. No script can do it.
- **The kill switch belongs to this binary**, per ADR-0025 §2 — a global hotkey
  handled in the Tauri process rather than in Node, so it works when the app is
  wedged. That is scope this file did not have this morning.

The capability itself is [`07`](./07-off-the-browser.md), not this file. What
belongs here is the binary, the signature and the permissions it holds.

---

## Is this already done?

```bash
find . -name Cargo.toml -not -path './node_modules/*'
find . -name 'tauri.conf.json' -not -path './node_modules/*'
grep -c 'tauri' package.json
# stage 2 — each returns a hit when that half exists (added 2026-08-28):
grep -n 'entitlements' src-tauri/tauri.conf.json
ls scripts/stage-runtime.ts scripts/sign-runtime.ts scripts/release-tray.ts .github/workflows/release.yml
gh release list   # the one that stays empty until the first tag ships
```

~~**As of 2026-08-26 all three return nothing.**~~ **Corrected 2026-08-27: the
scaffold exists — all three commands find `src-tauri/`.** Still no packaging, no
signing, no notarisation, no auto-update, and ~~`.github/workflows/ci.yml` runs typecheck, format and tests
with no build, no release job and no artefact upload~~ **corrected 2026-08-27:
CI runs typecheck, tests *and* `npm run build`, and does not run `format:check`.
~~What holds is the absence — no release job, no artefact upload, no macOS
runner.~~** **Corrected 2026-08-28, in two steps this file never recorded the
first of: `tray.yml` (a macOS check job) landed with stage 1 on 2026-08-27, so
"no macOS runner" was already false the day it was written here; and
`release.yml` now builds, signs, notarises and uploads the `.dmg` on a `v*`
tag. What holds today: the release list is empty until the first tag.**

### What already landed, 2026-08-26

While this folder was being written, `/welcome` arrived — a state machine over
facts rather than a wizard, in `src/server/welcome.ts` and
`src/app/welcome/page.tsx` *(both renamed to `first-run` 2026-08-30, when the
todo 09 build folded the route)*. It already did two of ADR-0023's four jobs:

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

~~One gap that came with it: **nothing links to `/welcome`.** A new person landing
on `/` still sees *"Go and read about something for a while."* and has no way to
find the screen built for them. That fix is in [`04`](./04-quick-fixes.md).~~
**Struck 2026-08-27 — the front door links it now.** `/` computes whether setup
is unfinished and renders *Finish setting it up*; [`04`](./04-quick-fixes.md)'s
own strike recorded this the same day it was written, and this file did not.

~~Also worth knowing: **ADR-0023 is untracked.** `git log -- docs/adr/0023-*`
returns nothing. Commit it before you build against it.~~ **Struck 2026-08-27 —
committed 2026-08-26**, in the same change that wrote this folder; the command
now returns three commits.

---

## What you have to do yourself

This section is the reason this file is three weeks and not two.

| | What | Cost | Lead time |
|---|---|---|---|
| **Account** | **Apple Developer Program membership.** Required for a *Developer ID Application* certificate. Without one, macOS Gatekeeper refuses the app on any machine but yours, and there is no way around it. | **$99/year** | **hours to days** — Apple verifies identity, and an individual enrolment sometimes asks for ID |
| **Certificate** | A *Developer ID Application* certificate, created in the Apple Developer portal and downloaded into your login keychain. ~~and a *Developer ID Installer* certificate~~ **Corrected 2026-08-28: Installer signs `.pkg` installers only — a `.dmg` needs nothing but the Application certificate, which signs the dmg too.** | included | minutes, once enrolled |
| **Credential** | An **App Store Connect API key** (`.p8`, issuer id, key id) for `notarytool`. An app-specific password works too and is worse — it expires and it is tied to your Apple ID. | free | minutes |
| **Toolchain** | ~~**Rust is not installed on this machine.** `which cargo` returns nothing.~~ **Struck 2026-08-28 — falsified by the commit this row was written beside: stage 1 was built with `~/.cargo/bin/cargo` (installed 2026-08-27, the same day), which a non-login shell's `which` misses.** The `x86_64-apple-darwin` target for a universal binary is still uninstalled, and universal is deferred (ADR-0027). | free | done |
| **Toolchain** | Xcode Command Line Tools — **already present** (`/Library/Developer/CommandLineTools`). | free | done |
| **Decision** | A name for the signed bundle and a bundle identifier (`com.<something>.propositum`). Once shipped, changing it orphans everybody's install. | — | think about it once |

**Do the Apple enrolment first, on day one.** Everything else can be built while
it processes; nothing can be shipped until it lands.

---

## The work

ADR-0023's own table is the specification. Four things, and it is worth
resisting a fifth.

1. ~~**Commit ADR-0023**, and while you are there fix the one thing it gets wrong:
   it attributes *"pressing Take over enqueues a run nobody drains"* to
   `README.md`. That sentence is a code comment at `scripts/worker.ts:10`. The
   README never warns about the worker at all.~~ **Done by 2026-08-27, in two
   places at two times:** the ADR was committed 2026-08-26 and struck its own
   misattribution the same day; the last copy of the error was
   `scripts/dev.ts:8`, corrected 2026-08-27 in the change that struck this item.

2. ~~**Scaffold the Tauri app.** A `src-tauri/` beside the Next app, a tray icon,
   no dock icon, one small window.~~ **Done 2026-08-27**, bar the window: the
   one small window is the key field, and it arrives with item 4's slice.

3. ~~**Supervise, for production.** Spawn `next start -p 3117` and
   `tsx scripts/worker.ts` as children. Restart on crash with a backoff. Kill
   both on quit — an orphaned worker holding a lease is worse than no worker.~~
   **Done 2026-08-27** (`src-tauri/src/supervisor.rs`) — with `-H 127.0.0.1`,
   which this item's own command forgot and which is the difference between a
   loopback bind and the control routes reachable off the machine.
   - `scripts/dev.ts` is the shape to absorb, not the code to reuse: it is
     development-only~~, and it deliberately does **not** restart anything~~
     **— corrected 2026-08-27: it restarts a dead child, inside a three-second
     startup window and a give-up after three quick failures; what it lacks is
     a backoff, and any production coverage at all.** Its
     one hard rule is worth carrying over — *"one child dying does not take the
     other with it"* — because killing the web server when a worker crashes
     would be quietly reversing ADR-0001.
   - ~~What is still missing is the restart.~~ **Corrected 2026-08-27: in
     development the restart exists; missing are the backoff, and anything at
     all in production.** `src/runtime/worker-process.ts`
     sweeps expired *leases* from inside the worker; nothing watches the worker
     itself. Its own comment: *"A failed sweep costs one interval. A dead worker
     costs every run after it."*

4. ~~**Configure.** One field for `ANTHROPIC_API_KEY`, written to `.env`. Today
   this is a hidden dotfile edited by hand, and there is no settings UI anywhere
   in the product.~~ **Done 2026-08-27** — `src-tauri/src/env_file.rs` is the
   file's first and only writer: atomic, mode 0600, every line it does not own
   preserved byte for byte, refusals returned as sentences. Saving restarts
   both halves by relaunching the binary, because each child reads `.env` once
   at startup.

5. ~~**Pair the extension in one click.** Read the id, write
   `PROPOSITUM_EXTENSION_ID`, restart the Next child. Today this is a 32-character
   string copied out of `chrome://extensions`, and getting it wrong produces a
   `bad-origin` visible only inside an HTTP 403 JSON body
   (`src/app/api/session/current/route.ts:181`).~~ **Struck 2026-08-27 — this
   item was overtaken on 2026-08-26 and doing it as written would be a
   regression.** `/welcome` *(now `/first-run`)* already pairs in one click by writing a `pairing`
   row, restart-free, and `resolveExtensionOrigin` reads the env var *ahead
   of* that row — so a tray-written `PROPOSITUM_EXTENSION_ID` would silently
   outrank every later click the person makes on the screen. The tray
   deliberately writes nothing here; its Pairs job shrank to the *Finish
   setting up* link, and ADR-0023's table row carries the same dated
   correction. (The `bad-origin` hint has also moved to `:198` and now points
   at `/welcome` itself — `/first-run` since 2026-08-30.)

6. ~~**One status light**, off `intentionState()`. Five members —
   `working`, `delegated`, `needs-you`, `sleeping`, `done`. Not a dashboard.
   Principle 13: *"The system should be comfortable doing nothing."*~~
   **Done 2026-08-27** — `GET /api/intention-state` folds `frontDoorRow` per
   project and serves the consumer label; the tray renders the word verbatim
   and never writes its own (`src-tauri/src/light.rs`).

7. ~~**Run `prisma db push` on first launch and after an upgrade**, then restart so
   the append-only triggers are reinstalled and verified. `db push` silently
   drops the triggers on any table it rebuilds, and a ledger without its triggers
   looks identical and is not append-only.~~ **Done 2026-08-27, by ordering
   rather than by a special step**: the push runs on *every* launch and always
   completes before either child starts, so each child's own `createDatabase()`
   reinstalls and verifies the triggers after every push — first launch,
   upgrade, and every day in between are the same launch
   (`src-tauri/src/preflight.rs`).

8. ~~**A log file** at `~/Library/Logs/Propositum/`, a version string somewhere a
   person can read, and a **Copy diagnostics** button. Today there is no log file
   at all — everything is `console.log` to whichever terminal is in front of you,
   gone when the window closes. This does not violate the no-telemetry rule:
   nothing is sent, the person copies and chooses.~~ **Done 2026-08-27**, with
   one narrowing: *Copy diagnostics* copies the log's path, not its content —
   worker lines can carry page titles, and putting those in a clipboard
   silently is the person's choice to make with the file open (`logs.rs`).

9. ~~**Handle the Playwright Chromium.** `src/policy/playwright-fetcher.ts` imports
   `playwright` and launches Chromium. It is a devDependency whose postinstall
   pulls hundreds of megabytes, it is documented nowhere, and if it failed the
   worker throws on the first fetch with no user-facing message.~~ **Done
   2026-08-27, with the limit stated**: the tray checks Playwright's cache at
   launch and, when Chromium is missing, offers a one-click logged install —
   the click is the consent for the ~150 MB. The check is a glob over the
   cache layout, not a launch test, so a corrupt install still fails at first
   fetch exactly as before.

10. ~~**Release CI.** Build, sign, notarise, staple, produce a `.dmg`, and publish
    an update feed. Tauri's updater needs its own signing keypair — that is
    separate from the Apple certificate and is generated locally.~~ **Split
    2026-08-28, because the two halves earned different fates.** The first half
    is **done**: `scripts/release-tray.ts` builds, signs, notarises, staples and
    audits — the `.dmg` itself, not just the `.app` inside it — and
    `release.yml` runs it on a `v*` tag, publishing the `.dmg` as a GitHub
    Release asset. The update feed is **deferred, not built**
    ([ADR-0027](../adr/0027-a-sealed-bundle-and-where-the-state-moves.md) §4):
    a feed is a URL the shipped binary polls for new code, which is the first
    phone-home this product would ever make, and that deserves its own ADR
    rather than a row in a build script. Until then, updating is downloading
    the next `.dmg`.

    **Corrected 2026-08-30 — sealing the runtime in broke the check job for two
    days, and nothing here said so.** Giving `tauri.conf.json` a `resources`
    map and an `externalBin` pointed both at `dist-runtime/`, which is
    gitignored and produced only by `npm run tray:stage`. tauri-build resolves
    those two paths in its *build script*, not at bundle time, so every
    `cargo check` on a fresh checkout failed — `tray.yml` went red on every
    run from 2026-08-28 until the fix while `ci.yml` stayed green on the same commits, which
    is why it took two days to notice. The fix is not to stage: `tray.yml` now
    fabricates the two paths empty in about a second, and
    `tests/stage-runtime.test.ts` reads that workflow and fails if the paths
    ever drift from `TREE_RELATIVE` and `SIDECAR_RELATIVE`. **What the check
    therefore does not verify is unchanged and now stated in the workflow: that
    the runtime stages, that the sidecar runs, that the bundle is whole.
    `npm run tray:build` on a `v*` tag remains the only place any of that is
    true.**

---

## Done when

- A person who has never seen the repository can install a `.dmg`, paste an API
  key, click one button, and reach an offer — **without opening a terminal.**
- Quitting the app leaves no orphaned Node process.
- Killing either child brings it back.
- `spctl -a -vvv` and `xcrun stapler validate` both pass on the shipped `.dmg`.
  *(2026-08-28: `scripts/release-tray.ts` runs both on every signed build and
  fails it when either fails — so this bullet closes with the first tagged
  release, and stays closed by machine rather than by memory.)*
- **Then hand it to a stranger and time them to first offer.** That number is the
  product metric that does not exist today. *(Still open, 2026-08-28 — the code
  half of this file is done and this bullet is deliberately not struck: nothing
  above it counts until somebody who is not the owner has done it.)*

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
  binary both were watching for. ~~Neither refusal is reversed, and both are now
  cheaper to reverse. Re-read them before the first thing that wants a native
  capability arrives.~~

  **Corrected 2026-08-26, hours later — one of them is reversed, and the last
  sentence is why this correction exists.**
  [ADR-0025](../adr/0025-computer-use-beyond-the-browser.md) reverses ADR-0012's
  refusal of screen capture, for acting, and takes Screen Recording,
  Accessibility and Full Disk Access. ADR-0012's actual subject — an *ambient*
  rolling screenshot buffer — is untouched and still binding, so this is struck
  as two claims rather than one. ADR-0014's account argument is unreversed.

  *"Re-read them before the first thing that wants a native capability arrives"*
  needed no correction: it was written the morning the thing arrived, and *"both
  are now cheaper to reverse"* turned out to mean **the same day**. That is worth
  leaving on the page beside the reversal.

---

## What the build disturbed that nothing predicted

*Added 2026-08-27, the day of the first hands-on test.* Three findings, each
now fixed or recorded, none of which any item above named:

- **The kill switch minted orphans on its first real press.** The worker is
  spawned through tsx's CLI, which runs the real worker as its own child —
  and SIGKILL, unlike Quit's SIGTERM, cannot be forwarded by a wrapper that
  is already dead. Three orphaned workers in one test session. Fixed in the
  same day's change: every child leads its own process group and signals go
  to the negative pgid, which also covers whatever the worker spawns later
  (Playwright's Chromium is the known one).
- **The switch worked in silence.** The person pressed it three times
  believing nothing had happened, because no pixel moved. The tray now
  writes *Stopped* beside its ring.
- **Opened straight off the dmg, the app ran somewhere read-only and died in
  a log.** The first quarantine launch test (2026-08-30, the day of the first
  signed build) double-clicked the app without Finder ever moving it, and
  macOS App Translocation ran it from a randomised read-only mount —
  `prisma db push` died on EROFS with nothing on screen. Fixed the same day:
  a translocated launch parks before the preflight with *move Propositum into
  Applications, then open it again* beside the ring. The drag-to-Applications
  flow the dmg window suggests was never affected.
- **A signal-terminated tray orphaned both children** — tao installs no
  signal handler, so `kill -TERM` never reached the run-event handler. A
  `sigwait` thread now turns a signal into the same drain the Quit item runs.
  A SIGKILL on the tray itself still orphans, which is what the worker's
  lease sweep exists to absorb.
