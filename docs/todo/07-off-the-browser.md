# 07 — Off the browser, onto the machine

**Status:** not started — **decided, not built.**
**Decided by:** [ADR-0025](../adr/0025-computer-use-beyond-the-browser.md), accepted 2026-08-26
**Blocked by:** [`01`](./01-menu-bar-app.md), hard — this needs a signed binary that holds three TCC
permissions, and there is no binary. Also [`06`](./06-buying-things.md), because a non-`GET` being
sendable at all is what makes signing in possible.
**Blocks:** [`08`](./08-one-time-codes.md), which uses a permission this takes.

**This is the largest single piece of work in the project**, larger than
[`01`](./01-menu-bar-app.md), which it also depends on. `docs/todo/README.md` says so and it is not
being modest.

It is also the change that makes the product less safe by the widest margin. ADR-0025 opens by saying
so — *"the blast radius stops being a browser tab and becomes the machine"* — and this file is not
going to be cheerier about it than the decision was.

---

## Is this already done?

```bash
# 1. the allowlist that replaces the tab bound
grep -rn 'approvedApplications' src/

# 2. the guard the ADR calls the most important one in the repository
ls tests/desktop-scope.test.ts

# 3. any native code at all
find . -name Cargo.toml -not -path './node_modules/*'

# 4. the vocabulary, which has to come first — and which is DONE
grep -n 'approvedApplications' CONTEXT.md
```

~~**As of 2026-08-26 all four return nothing.** There is no `approvedApplications`, no
`tests/desktop-scope.test.ts`, no Rust, and — worth its own sentence — **no glossary entry either**.
`CONTEXT.md` gained `PurchaseAuthorization` on the day ADR-0024 was accepted and gained nothing for
this one, so [item 1](#the-work) below is not a formality.~~

**Corrected 2026-08-27, the next morning, by running command 4 instead of assuming it.** (1), (2) and
(3) return nothing — no `approvedApplications` in `src/`, no `tests/desktop-scope.test.ts`, no Rust.
**(4) returns three hits, and the glossary entry is already written.** `CONTEXT.md`'s `ContractScope`
entry carries `approvedApplications[]` with the argument in full — bundle identifiers never window
titles, checked against the frontmost application before every mutating action rather than once per
turn, absent-or-unreadable escalating to a refusal — and the honest sentence that it *"replaces the
bound ADR-0010 had… and it is weaker, because that one was Chrome refusing and this one is our code
remembering."*

It carries the **specification rather than a description** fence, and the fence quotes its own check:
*"`grep -rn 'approvedApplications|purchaseAuthorization' src/ prisma/` returns nothing."*

Two things follow, and they are why this correction is worth the space rather than a quiet edit.
[Item 1](#the-work) is **smaller than it was written** — the entry exists, so what is left is taking
the fence off. And the mistake here was the one this heading exists to catch, made by the person
adding the heading: the claim *"no glossary entry either"* was written from memory of a diff rather
than from a command, in a file whose first instruction is to run the command. It is struck rather
than overwritten for that reason.

~~`docs/ARCHITECTURE.md` and `docs/SECURITY_AND_PRIVACY.md` have both been rewritten to describe what
was decided.~~ **Corrected 2026-08-26, the same day this file was written.** `docs/SECURITY_AND_PRIVACY.md`
was **patched, not rewritten** — item 9 below says so, and ADR-0025 asks for a rewrite precisely
because patching leaves true-sounding sentences that are no longer true.

**`docs/ARCHITECTURE.md` was not touched at all.** `grep -c '0024\|0025\|0026' docs/ARCHITECTURE.md`
returns **0**: its layer table still describes a product where the agent lives in one Chrome tab and
cannot send a `POST`. That is a gap rather than an oversight worth shrugging at, because that file's
own *honest limits* admit *"nothing checks the status column"* — no test will ever go red over it, so
it is corrected by somebody remembering or not at all. **Add it to item 9.**

**Read the documents as the specification and the code as the truth**; where they disagree today,
they are describing this file.

---

## Blocked by

- **[`01`](./01-menu-bar-app.md), and there is no way around it.** Accessibility, Screen Recording
  and Full Disk Access are TCC permissions, macOS grants them to a signed application bundle, and
  `npm run dev` is not one. ADR-0023's prohibition 1 — *the tray app requests no TCC permission* — is
  amended by ADR-0025 rather than deleted, so read the amendment before building against either.
- **[`06`](./06-buying-things.md)**, for the sign-in path specifically. §4's sequence ends in a form
  submission, and a form submission is a non-`GET`.
- **[`00`](./00-score-the-hypotheses.md)**, by judgment. Three TCC permissions is a very different
  install, and asking somebody for it on behalf of an unmeasured product is not a good trade.

---

## What you have to do yourself

| | What | Lead time |
|---|---|---|
| **$99/yr** | Apple Developer Program, via [`01`](./01-menu-bar-app.md). Without notarisation, three TCC prompts on an unsigned binary is not something you can ask anybody to accept. | days, once paid |
| **Three permission grants** | Accessibility, Screen Recording and Full Disk Access, each granted by hand in System Settings, each with its own dialog. **No script can do this** and no amount of onboarding removes it. | minutes, per machine |
| **A test machine you do not mind losing** | The first runs of a thing that synthesises input at coordinates will click the wrong thing. Do not develop this against your own signed-in accounts. | — |
| **A decision about focus** | Synthesised input goes where focus actually is, so the agent and a person cannot use the machine at once. That is a product limit, not a bug, and somebody has to decide it is acceptable before it is built rather than after. | — |

---

## The work

Numbered, but read it as four groups: the words, the fence, the perception loop, and sign-in.
**The fence comes before anything that can act.**

1. **The vocabulary, before any schema — and ~~it needs writing~~ most of it is written.**
   `approvedApplications` already has its entry under `ContractScope` in `CONTEXT.md`, with the
   consumer wording and the **specification rather than a description** fence. **What is left here is
   taking the fence off in the commit that builds it**, and updating the line inside it that quotes
   its own `grep` as returning nothing.

   What is genuinely missing is the word for **what a desktop action is**. `ActionKind` enumerates
   mechanisms in a browser — `click-element`, `type-text` — and the desktop equivalent has no entry
   and no name. Per [`AGENTS.md`](../../AGENTS.md): *a new domain word goes into `CONTEXT.md` before
   it goes into a schema.* Nothing enforces that, and it is the step most likely to be skipped.

   Give the new entry the same fence, and take it off when the code lands.

2. **`approvedApplications` on `ContractScope`, derived from what the person ratified.** Never from a
   model naming an application — the same asymmetry as `approvedSourceIds`, and for the same reason.

3. **`tests/desktop-scope.test.ts` — write it before the thing it guards.** ADR-0025 calls it *"the
   most important guard this repository has"*, and it replaces
   `tests/extension-permissions.test.ts`'s tab assertions rather than sitting beside them. Three
   properties, each of which fails differently:

   - **checked at the moment of action**, not at the start of the turn, because an app can come to
     the front between perceiving and acting — a notification, a modal, a crash dialog;
   - **bundle identifier, never window title** — a title is attacker-authored, exactly like an
     accessible name;
   - **absent or unreadable ⇒ refuse**, the same fail direction
     `src/domain/execution/reversibility.ts` already takes.

4. **The kill switch, in the Tauri process.** A global hotkey and a menu-bar item, both stopping
   input synthesis immediately, **handled outside Node** so it works when the app is wedged, the dev
   server is restarting, or the worker is looping. Stopping never touches the network.

   **Verify it with `kill -STOP` on the Node processes and then press it.** A kill switch that only
   works when the system is healthy is not one, and this is the item most likely to be marked done on
   the strength of it working in the happy case.

5. **Perceive: a screenshot plus the `AXUIElement` tree, per turn.** Both are untrusted input from
   somebody who is not us, so `Datamarked` and `SNAPSHOT_BUDGET_CHARS` apply unchanged — an
   app-authored tree and a page-authored tree have identical trust properties. The one door in
   `src/model/boundaries/` does not gain a second.

6. **Act: synthesised input at coordinates, and nothing else.** No shell, no `osascript`, no
   AppleScript, no `open(1)`. This is the desktop `Runtime.evaluate`, and
   `tests/architecture.test.ts` should refuse it by absence the way it refuses the browser one.

7. **Irreversibility, and the correction that already landed for it.**
   `src/domain/execution/reversibility.ts` was amended on 2026-08-26, ahead of this work, to say that
   it **stops being the secondary mechanism** the moment an action happens outside a browser: there
   is no paused request and nothing attested, so an English-only lexicon over an app-authored name is
   then the whole of what decides. Read that docblock before you rely on the classifier here. It is
   the sharpest thing anybody has written about this risk and it was written before the risk existed.

8. **Sign in, without holding a credential.** Navigate; if already signed in, nothing happens. Click
   the username field, click Chrome's saved-password offer, click submit. *Continue as…* is an
   ordinary element. A one-time code is [`08`](./08-one-time-codes.md). Touch ID stops and asks.

   **There is no `fill-credential` action kind and there must be no schema field for a secret.** Four
   guards in `tests/architecture.test.ts` already hold that line — a secret-shaped Prisma column, an
   action kind that carries one, a downgrade of the `password_field` refusal to a clickable
   confirmation, and a remembered yes. Each was seen red before being trusted. **Do not weaken any of
   them to make this step easier**; if one is in the way, the design is wrong.

9. **Rewrite `docs/SECURITY_AND_PRIVACY.md` rather than patching it**, which ADR-0025 says explicitly
   and which is already half done. Patching leaves true-sounding sentences that are no longer true.

---

## Done when

- The four commands under *Is this already done?* return what a finished repo returns — note that
  the fourth already returns hits today and always will. What changes for it is the fence: the
  `ContractScope` entry stops saying `grep` finds nothing, because it will not.
- `tests/desktop-scope.test.ts` exists, and has been **seen red** — a mutating action dispatching
  against a frontmost app that is not on the allowlist must fail the suite.
- The kill switch has been verified with the Node processes stopped.
- A sign-in has completed end to end on a real site, with **no credential anywhere in `src/`, in
  Prisma, in a prompt or in a ledger row** — the only thing that touched the password was Chrome.
- `CONTEXT.md` has entries for every new word, without the specification fence.
- `docs/ARCHITECTURE.md`'s layer table and `docs/SECURITY_AND_PRIVACY.md` describe what runs rather
  than what was decided.

---

## What this does not cover

- **Windows or Linux.** Every mechanism here is macOS-specific. ADR-0025: a second platform is *"a
  new decision, not a port."*
- **Reading any file that is not `chat.db`.** Full Disk Access grants far more; one caller uses it,
  and that is [`08`](./08-one-time-codes.md).
- **A credential vault, local or hosted.** Argued at its strongest in ADR-0025 §5 and refused. If
  Chrome's dropdown has stopped being clickable, find out why rather than building one.
- **Silent Touch ID.** There is no such thing. A passkey usable without the person is a password, and
  a proposal to work around it should be read as a proposal to defeat a security control.
- **App-based 2FA.** Authenticator apps and push approvals live on a phone this product cannot see.
- **Ambient screen capture.** [ADR-0012](../adr/0012-screen-capture-refused.md) is reversed for
  *acting* only. Its argument against a rolling screenshot buffer is untouched and still binding, and
  observation still gets no screenshots.
- **Solving CAPTCHAs.** Propositum does not, and must not learn to.
