# ADR-0023 — A menu-bar app that owns the runtime, and the warning it makes come true

**Status:** accepted · 2026-08-26 · **amended 2026-08-26**
**Amended by:** [ADR-0025](0025-computer-use-beyond-the-browser.md) — prohibitions 1 and 4, reversed
**the same day this ADR was accepted** · [ADR-0026](0026-reading-a-one-time-code.md) — Full Disk Access. What it
supervises, configures, pairs and shows is unchanged; what it may never do is now three things rather
than five
**Depends on:** [ADR-0001](0001-worker-runtime.md) — the worker as a separate OS process, which is
what makes two terminals necessary and therefore what this supervises
**Beside:** [ADR-0012](0012-screen-capture-refused.md) and [ADR-0014](0014-reading-free-busy.md) —
both refused a proposal partly on the grounds that *"the proposal is not X; it is become a desktop
product"*, and both warned about what happens once a native binary exists. **This ADR builds the
native binary.** Neither refusal is reversed and both are re-priced
**Requested by:** the owner, 2026-08-25 — a desktop app *"kinda like the docker interface in the top
right of the mac"*

---

## What this costs

**Once a native binary exists, everything that needs one gets quietly cheaper, and the arguments
that were really about cost get re-read as arguments about principle.**

That sentence is [ADR-0014](0014-reading-free-busy.md)'s, written against itself, repeating a
failure mode [ADR-0012](0012-screen-capture-refused.md) named first. **This ADR is the event both of
them were watching for**, and pretending otherwise by calling the thing a launcher would be exactly
the wording this repository exists not to use.

So the cost is stated as the thing it actually is: **two refusals in this corpus are now cheaper to
overturn than they were yesterday, and neither of them got weaker on the merits.**

ADR-0012 refused a rolling screenshot cache. Its cost argument had two halves — the returns on a
third behavioural signal are flat, *and* frames would need a signed helper, a native-messaging host
manifest, the `nativeMessaging` permission and a launchd agent. **The second half is now most of the
way paid.** The first half is untouched and is the half that was load-bearing, which is lucky rather
than planned.

ADR-0014 refused EventKit calendar reads and said *"only the Allow Full Access string stands between
EventKit and the right answer"* once a helper exists. That string is now the whole objection.

**What is bought.** Setting Propositum up today means two terminals, hand-editing `.env` with an
extension id copied out of `chrome://extensions`, and diagnosing a `bad-origin` hint buried in a
JSON response body. There is no onboarding route, no first-run screen, and no welcome flow — grep
for `onboard|first-run|welcome` across `src/` returns nothing product-facing. A new person's entire
introduction is `/` rendering *"Go and read about something for a while."*

`README.md`'s own status paragraph says what is missing is evidence, and that `eval-scores.json` is a
blank worksheet. **The reason it is blank is that n=1**, and the reason n=1 is partly that the
second person cannot get the thing running. A product nobody can install produces no evidence, and
no amount of correctness in the layers below fixes that.

## Decision

**A macOS menu-bar application, written in Tauri, that supervises the two Node processes, holds the
configuration, performs the setup, and renders one status light. It holds no tools, reads no
filesystem outside its own configuration, and adds no sensor.**

### What it does

| | |
|---|---|
| **Supervises** | spawns `next` and `scripts/worker.ts` as child processes, restarts them on crash, kills them on quit. `npm run dev` and `npm run worker` stay as they are, for anyone who wants them |
| **Configures** | one field for `ANTHROPIC_API_KEY`, written to `.env` |
| **Pairs the extension** | the `bad-origin` refusal, which today is a dead end in a JSON body, becomes a prompt naming the id that knocked. One click writes `PROPOSITUM_EXTENSION_ID` |
| **Shows one light** | rendered from `intentionState()`, which already folds `working \| delegated \| needs-you \| sleeping \| done` and already carries the consumer labels. **Not a second implementation** — two stores for one truth is the failure `CONTEXT.md` names about this exact function |
| **Opens deep links** | every control opens a page at `127.0.0.1:3117`. Nothing is decided in the menu bar |

### What it may never do

~~Five prohibitions, and the first is the one the rest exist to protect.~~

**Three, as of 2026-08-26.** Prohibitions 1 and 4 are reversed by
[ADR-0025](0025-computer-use-beyond-the-browser.md), **the same day this ADR was accepted** — its
Status line says 2026-08-26 and so does the reversal. The
struck text is left in place because it contains the argument, and the argument is the thing worth
having when somebody proposes going further. Prohibitions 2, 3 and 5 stand unchanged and are now
carrying more weight than they were written to carry.

~~**1. It requests no TCC permission.** No Screen Recording, no Accessibility, no Full Disk Access, no
Contacts, no Automation. Not "none yet" — none. The moment this binary holds a TCC grant it has
stopped being what this ADR describes, and ADR-0012's cost argument has been spent rather than
merely made cheaper.~~

**Reversed 2026-08-26 ([ADR-0025](0025-computer-use-beyond-the-browser.md),
[ADR-0026](0026-reading-a-one-time-code.md)).** It requests three: Accessibility, Screen Recording,
and Full Disk Access. Every word of the struck paragraph was correct and its prediction came true on
schedule — this binary now holds TCC grants, it has stopped being what this ADR describes, and
ADR-0012's cost argument has been spent rather than made cheaper. That is recorded here rather than
only in the ADR that did it, because *"the moment this binary holds a TCC grant"* was written as a
warning and a warning that fires is worth reading beside the thing it warned about.

What is left of the intent: **the permissions are taken for named callers, not for the binary's
general use.** Full Disk Access has exactly one reader ([ADR-0026](0026-reading-a-one-time-code.md)
§1), Accessibility is bounded by an application allowlist checked before every mutating action
([ADR-0025](0025-computer-use-beyond-the-browser.md) §1), and Screen Recording produces evidence that
is swept. Those are mechanisms where this was an absence, and the difference is the whole of what was
lost.

**2. It is not a native-messaging host.** No host manifest, no `nativeMessaging` permission in
`extension/manifest.json`. `tests/extension-permissions.test.ts` pins the permission array and pins
`optional_permissions` to `[]` — *"a runtime grant is still a grant"* — and this ADR does not touch
either.

**3. It holds no credential the app does not already hold.** It writes `.env`. It does not reach the
Keychain, which `SECURITY_AND_PRIVACY.md` notes is *"where it ought to live"* for the Google token
~~and cannot be, precisely because there is no signed helper~~. **There is now a binary and there is
still no Keychain access**, and that gap is deliberate: taking it would be a decision about
credential storage and belongs in an ADR about credential storage.

**Stands, and is now the only copy of this claim worth citing — 2026-08-26.** The struck clause was
already the weaker half of its own sentence and became false when
[ADR-0025](0025-computer-use-beyond-the-browser.md) gave this binary Accessibility, Screen Recording
and Full Disk Access: the helper exists and holds more than a Keychain entitlement would have needed.
So *no Keychain read* is a **refusal**, not a limitation, which is the harder position to hold and
the honest one. ADR-0025 §5 refuses a credential vault at its strongest — a vault would create a
secret that does not exist, on a machine whose database is not encrypted, to solve a problem Chrome
has already solved, and Propositum signs in by clicking Chrome's own prompt rather than by holding
anything.

Four other documents said *"a signed native helper this product does not have and is not building"*
and all four are struck the same day — `docs/SECURITY_AND_PRIVACY.md` twice, the salt and the
calendar token; [ADR-0020](0020-remembering-a-decline.md); [ADR-0014](0014-reading-free-busy.md).
Each now points here rather than restating it, because the sentence has been overtaken by three ADRs
in a row and the fifth restatement would go stale too.

~~**4. It observes nothing.** No window titles, no foreground app, no idle detection, no filesystem
watching. The one sensor is the Chrome extension and this does not become a second one. An
`ObservationEvent` cannot originate here because `sessionId` is required and `ledger-writer.ts` is
the single door — but that is a happy accident of the schema and not the reason. The reason is that
watching the desktop is a different product.~~

**Partly reversed 2026-08-26 ([ADR-0025](0025-computer-use-beyond-the-browser.md)).** It reads the
foreground application and the accessibility tree — but only **while acting under a ratified
contract**, never ambiently. The final sentence was right and is the reason the reversal is partial:
watching the desktop *is* a different product, and this is not that. The two ledgers stay disjoint,
`ActionEvidence` is still never read by inference or joined to an `ObservationEvent`, and
[ADR-0012](0012-screen-capture-refused.md)'s refusal of an ambient screenshot buffer is untouched and
still binding.

The happy accident named above is now the enforcement: an `ObservationEvent` still cannot originate
here, because `sessionId` is required and `ledger-writer.ts` is still the single door.

**5. It decides nothing.** No verdict, no confirmation, no ratification, no dial. Every control is a
link. [ADR-0019](0019-disclosure-and-what-may-never-fold.md)'s closed list of what may never be
folded is a list of things that need a page, and a menu-bar popover is smaller than a phone screen.

### Why Tauri

The choice is between Tauri and Electron and it is not close for this use. Electron ships a
Chromium; this application's entire UI is a status light, one text field and a list of links, and
shipping a browser to draw them would be roughly a hundred megabytes to avoid learning a build
system. Tauri uses the system WebView, produces a binary in the tens of megabytes, and its
capability model is allowlist-shaped — the set of native calls the front end may make is declared,
which means prohibition 1 above is partly enforceable by configuration rather than only by care.

**Where that enforcement stops, said plainly:** Tauri's allowlist constrains what the WebView may
ask the Rust side to do. It does not constrain what the Rust side may do. Prohibitions 1 through 5
are held by review, by this document, and by the fact that adding a TCC prompt to a shipped app is
visible to every user the first time it fires. That is weaker than a test and stronger than nothing,
and it is the honest description.

### Why this is not the desktop product ADR-0012 refused

ADR-0012 priced *"a signed and notarised native helper, a native-messaging host manifest, the
`nativeMessaging` permission … and a launchd agent"* — four things, and the reason they cost so much
is that they are the apparatus for **reaching past the browser into the machine.**

This binary has none of the four. It spawns two Node processes and draws a light. It has strictly
less reach than the Chrome extension it sits beside, which holds `debugger` and can read and change
data on all websites.

**That is the argument, and it is not airtight**, because the cost ADR-0012 was really pricing was
the existence of a build pipeline and a signing identity, and this creates both. The defence is not
that the argument does not apply — it is that the thing it applies to is now a named, dated decision
with five prohibitions attached, rather than a slope somebody notices halfway down.

## Rejected alternatives

**A status light and launcher only, assuming the terminals are already running.** Ships in a day,
touches nothing, and leaves every actual problem in place. The two terminals are not a papercut:
~~`README.md` says outright~~ **Corrected 2026-08-26: `scripts/worker.ts:11` says outright** — the
sentence has never been in the README, and [ADR-0001](./0001-worker-runtime.md) misattributed it the
same way — that without the worker *"pressing Take over enqueues a run nobody drains and the session
stays `away` for ever."* A launcher that does not launch is a decoration on a broken
setup.

**A `propositum` CLI that supervises both processes — one terminal instead of two.** Genuinely
cheaper, genuinely better than today, and no binary. Rejected because it fixes the smallest of the
four setup problems and none of the other three: the key still gets hand-edited, the extension id
still gets copied by hand, and there is still no status anywhere but a browser tab the person has
closed. It is also strictly worse at the one thing the surface exists for — being visible while the
person is doing something else.

**A Progressive Web App, installed from the running Next app.** No binary at all, which would let
this ADR not exist. It cannot supervise processes, which is the whole job.

**Ship the phone thread first and let it earn the desktop app.** The sequencing argument, and it was
close. Rejected on order of operations: the thread's pairing step lives in the setup flow, the setup
flow lives in the tray app, and building the thread first means building a temporary home for the QR
code that gets deleted. More importantly, **the thread is the surface for when you are away, and a
person who cannot get the product running is never away from it.**

## What holds the line now

| | |
|---|---|
| This document's five prohibitions | Held by review. Named here so a diff that breaks one has something to break |
| `tests/extension-permissions.test.ts` | Unchanged, and that is the assertion — the manifest array does not move and `optional_permissions` stays `[]` |
| Tauri's capability allowlist | Declares the native surface the WebView may reach. Constrains the front end, not the Rust side |
| `intentionState()` | One implementation of the status word. A second one in the tray app is the defect, not a convenience |

**Where this could still go wrong.** There is no test that fails when this binary requests a TCC
permission, and there cannot easily be one. The first person to add Screen Recording here will find
it easier than ADR-0012 found it, will be right that it is easier, and will be describing exactly
the erosion ADR-0014 wrote down. **The only thing standing there is that somebody reads this
section**, which is the same enforcement Principle 13 has and admits to having.

## Revisit when

- **Anything proposes a TCC permission in this binary.** Screen Recording, Accessibility, Full Disk
  Access, Automation, Contacts. Read ADR-0012 first; its cost argument is now half spent and its
  evidence argument is not.
- **Anything proposes reading the Keychain from here.** That is a credential-storage decision and it
  deserves its own ADR, including for the Google token that currently sits on disk because there was
  no binary.
- **A second sensor is proposed for this process** — foreground app, idle time, window titles. That
  is `docs/ROADMAP.md` stage 2 and `docs/ARCHITECTURE.md`'s State Ingestion layer, and it is a
  schema change plus a second ledger writer before it is anything else.
- **Windows or Linux is asked for.** Tauri ports; the product does not. `README.md` says macOS and
  the lid-close limitation is a macOS fact.
- **Onboarding still takes more than five minutes from a fresh user account.** Then the act structure
  is wrong and this binary is not paying for itself.
