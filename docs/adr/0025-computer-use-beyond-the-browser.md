# ADR-0025 — Acting on the whole machine, and signing in without holding a password

**Status:** accepted · 2026-08-26
**Reverses:** [ADR-0012](./0012-screen-capture-refused.md) — the refusal of screen capture ·
[ADR-0010](./0010-acting-in-the-browser.md) §1, the bound to one tab Propositum opened
**Amends:** [ADR-0023](./0023-the-tray-app-owns-the-runtime.md) — prohibition 1, that the tray app
requests no TCC permission · [ADR-0002](./0002-observation-capture.md) — what may be observed
**Depends on:** [ADR-0024](./0024-purchases-within-a-ratified-authorisation.md) (a non-`GET` can now
be sent, which is what makes signing in possible at all)

## The sentence that stops being true

**The blast radius stops being a browser tab and becomes the machine.**

[ADR-0010](./0010-acting-in-the-browser.md) bought its safety with two bounds. The agent acted only
in a tab `chrome.tabs.create` returned, and it never ran a line of its own code inside a page — *"the
accessibility tree comes from the browser; the input comes from the browser; the page's own scripts
run and ours do not."* Both are gone. There is no tab bound because there is no tab; the agent sees
the screen and moves the pointer.

Say the cost without softening it. After this, a wrong decision can act in any application that is
open — your mail, your messages, your banking tab, a terminal. The Chrome infobar that ADR-0010
called a kill switch *"not ours to break"* covers a debugger attachment that is no longer how this
works. `docs/SECURITY_AND_PRIVACY.md`'s guarantees are mostly of the form *"there is no capability
for that"*, and most of them stop being true on the day this ships.

What replaces them: an application allowlist checked before every mutating action, a kill switch we
own rather than borrow, the ledger, and the gate. All four are mechanisms. Mechanisms erode, and
these ones erode into a much larger space than the last set did.

This ADR also removes a line from the do-not-build list, which no ADR has done before.
`docs/superpowers/specs/2026-08-16-direction-update-source.md` §8 named *"unrestricted computer
use"*, binding via `docs/ARCHITECTURE.md`. It is struck there, dated, pointing here. The word doing
the work in that line is **unrestricted**, and §3 below is the whole of the restriction.

## Context

Three things the tab agent could not do, in increasing order of how much they matter:

**1. Sign in.** ADR-0010 refused to hold credentials, correctly — *"a credential copied out of Chrome
is a credential outside Chrome's protections, invisible to the person, revocable only by changing a
password."* It then had no answer for a dead session, and *"it stops and asks you"* is not an answer
for a product whose job is to work while you are away.

**2. Finish a login.** SMS and email one-time codes arrive somewhere that is not the tab. See
[ADR-0026](./0026-reading-a-one-time-code.md), which this makes possible and which is scoped
separately because it is a different kind of access.

**3. Do anything outside Chrome.** Errands live in Mail, Messages, Finder, native apps. A browser
agent is a browser agent.

### The unlock, which is small and specific

**Chrome's saved-password dropdown is not in the DOM.** It is browser chrome — rendered by Chrome,
outside the page, unreachable by CDP by design, because a page that could click it could steal every
password you have. That is why the tab agent could never use the password already sitting in the
browser, and why the only options on the table were *hold a credential yourself* or *give up*.

A desktop agent drives the screen, so it can click it. The password goes from Chrome's encrypted
store into Chrome's own form, and **Propositum never sees it, never stores it, never puts it in a
prompt or a ledger row, and has nothing to leak.** ADR-0010's objection to credential handling is
answered by not handling one.

That is the whole argument for this ADR. Everything else it enables is downstream of *the screen is
where the affordances already are*.

## Decision

**Propositum drives macOS: it sees the screen and the accessibility tree, and it synthesises input,
inside an allowlist of applications the person ratified.**

| | |
|---|---|
| **Permissions taken** | Accessibility (`CGEvent` synthetic input) · Screen Recording (to see) · Full Disk Access ([ADR-0026](./0026-reading-a-one-time-code.md), and only for that) |
| **Who holds them** | the signed Tauri app from [ADR-0023](./0023-the-tray-app-owns-the-runtime.md). macOS prompts once, and the person can revoke in System Settings without our cooperation |
| **Where it may act** | applications on the contract's allowlist, checked against the frontmost app before every mutating action |
| **How it perceives** | a screenshot plus the `AXUIElement` tree, per turn |
| **How it acts** | synthesised input at coordinates. Never AppleScript, never `osascript`, never a shell |
| **What decides irreversibility** | unchanged: the browser at the network for web actions ([ADR-0024](./0024-purchases-within-a-ratified-authorisation.md)); the escalation-only lexicon for everything else |

### 1. The application allowlist replaces the tab bound

`ContractScope` gains `approvedApplications`, derived the same way `approvedSourceIds` is: from what
the person ratified, never from a model naming one. Before **every mutating action** the gate checks
the frontmost application's bundle identifier against it and refuses otherwise.

Three properties this has to have, because it is now the only thing between a mistake and your whole
machine:

- **Checked at the moment of action, not at the start of the turn.** An application can come to the
  front between perceiving and acting — a notification, a modal, a crash dialog. Checking early is
  checking the wrong thing.
- **Bundle identifier, never window title.** A title is attacker-authored, exactly like an accessible
  name. A bundle id is the OS's.
- **Absent or unreadable ⇒ refuse.** The cheapest attack on a check is to remove the thing it checks,
  which is the same fail direction `src/domain/execution/reversibility.ts` already takes.

`tests/desktop-scope.test.ts` asserts no mutating desktop action can dispatch without it. That test
replaces `tests/extension-permissions.test.ts`'s tab assertions, and it is the most important guard
this repository has.

### 2. The kill switch has to be ours now

ADR-0010 leaned on Chrome's infobar precisely because it was *"not ours to break"*. There is no
equivalent for synthesised input. So:

- a **global hotkey** and a menu-bar item, both of which stop input synthesis immediately;
- handled in the Tauri process, **not** in Node, so it works when the app is wedged, the dev server
  is restarting, or the worker is in a loop;
- **stopping never needs the network**, per ADR-0010: *"a stop that has to reach a server before it
  takes effect is not a stop."*

Verified by `kill -STOP` on the Node processes and then pressing it. A kill switch that only works
when the system is healthy is not one.

### 3. What is still absent, and stays absent

*"Unrestricted"* is what came off the do-not-build list. These are the restrictions:

- **No shell, no `osascript`, no AppleScript, no `open(1)`.** Synthesised input and nothing else. This
  is the desktop version of ADR-0010's *"no `Runtime` domain, ever"*, and it costs the same thing —
  robustness — for the same reason: an action a person could not have performed with a mouse is an
  action nobody reviewed.
- **No filesystem access outside `chat.db`** ([ADR-0026](./0026-reading-a-one-time-code.md)). Full
  Disk Access grants far more than that; one reader uses it, and `tests/reachability.test.ts` holds it
  to one caller.
- **No keychain reads.** Amending ADR-0023's prohibition on TCC does not amend this one. Propositum
  holds no credential of the person's; §4 is how it signs in without one.
- **No enumeration of what is running.** The agent is told which applications are approved; it does
  not ask what else is open. This is the property ADR-0010 §1 had and lost to a correction — it is
  held here by there being no such action kind, which is stronger than it was there.
- **No screenshot leaves the machine**, and no screenshot is retained beyond
  `ACTION_EVIDENCE_RETENTION_DAYS`, except the one a `ConfirmationRequest` points at — the permanent
  retention ADR-0010 already recorded, now more likely to contain more.

### 4. Signing in, without a credential

A sequence of ordinary actions, not a subsystem:

1. Navigate. **If already signed in, nothing happens** — this is the common case and it costs
   nothing.
2. Click the username field; Chrome offers its saved password; click the offer; click submit.
3. If Google's *Continue as…* is present, click it. It is an ordinary page element.
4. If a one-time code is needed, [ADR-0026](./0026-reading-a-one-time-code.md).
5. If Touch ID is required, stop and ask. §5.

**There is no `fill-credential` action kind and there is no schema field for a secret.** The existing
`password_field` refusal in `src/policy/gate.ts` is unchanged: Propositum still refuses to type into a
form holding a password, because it still never types a password. Chrome does.

This is the rare case where the safer design is also the one with less code, and it is worth naming
why the earlier draft got it wrong: the question was framed as *where should Propositum keep the
password* when the answer was *Chrome already keeps it*.

### 5. What was refused, and why

**A credential vault, local or hosted.** At its strongest: a signed app can reach the macOS Keychain,
`docs/SECURITY_AND_PRIVACY.md` says that is *"where it ought to live"*, and a vault would work on
sites where Chrome has nothing saved. Refused because it is strictly worse than clicking the dropdown
on every axis — it creates a secret that did not exist, on a machine whose database is not encrypted,
to solve a problem Chrome has already solved. A hosted vault is worse again: it replaces N secrets
with one service credential that unlocks all of them, on the same disk, plus a fourth egress and a
vendor, against the standing rule that there is no cloud and no server of ours.

**Making Touch ID silent.** There is no such thing. WebAuthn requires user verification and macOS
renders that prompt itself; a passkey that could be used without the person is a password. Sites that
allow a password alternative get the unattended path; passkey-only sites cost one fingerprint. This is
a property of the standard and not a limitation to engineer around, and any future proposal to work
around it should be read as a proposal to defeat a security control.

**A separate automation browser with copied credentials.** ADR-0010 refused this and its reasoning
survives intact — *"a credential copied out of Chrome is a credential outside Chrome's protections."*

**Screen capture as a rolling buffer.** [ADR-0012](./0012-screen-capture-refused.md) is reversed only
for *acting*, and only under a ratified contract. Its argument against an ambient screenshot cache is
untouched and still binding: observation gets no screenshots, and the two ledgers stay disjoint.

## What this costs

- **Every absence-based guarantee in `docs/SECURITY_AND_PRIVACY.md`.** That document is rewritten
  rather than patched, because patching it would leave true-sounding sentences that are no longer
  true.
- **The injection surface grows again.** ADR-0010 measured its own growth at two orders of magnitude
  when the agent started reading accessibility trees; this adds every approved application's tree to
  that. Every accessible name in every one of them is authored by somebody who is not us.
  `Datamarked` and `SNAPSHOT_BUDGET_CHARS` apply unchanged, because an app-authored tree and a
  page-authored tree have identical trust properties — and datamarking is still depth, not a boundary.
- **Screenshots now contain whatever was on screen**, which is a different privacy claim from
  *whatever was in the tab*. Notifications, other windows, a message preview.
- **CAPTCHAs and bot detection now risk the person's real accounts** more broadly than ADR-0010
  anticipated. Propositum does not solve CAPTCHAs and must not learn to.
- **Three TCC permissions is a very different install.** ADR-0023 argued that a tray app requesting
  none was *"the prohibition the other four exist to protect"*. That argument was right for the
  product it described and this is a different product; the reversal is recorded in ADR-0023 in place
  rather than only here.
- **Focus is contested.** Synthesised input goes where the pointer and focus actually are, so the
  agent and a person cannot use the machine at once. This is a real product limit and it is why the
  status light matters.

## Revisit when

- **Anything proposes a shell, `osascript`, or an action that is not synthesised input.** That is this
  ADR's `Runtime.evaluate`, and it deserves the same treatment: its own decision, argued in full.
- **Anything proposes reading a file that is not `chat.db`.** Full Disk Access is already granted, so
  the only thing standing there is the absence of a caller.
- **Anything proposes removing the frontmost-application check** for latency, for reliability, or
  because it fires too often. It firing often means the allowlist is wrong.
- **Anyone proposes a credential store again.** The answer is in §5, and if Chrome's dropdown has
  stopped being clickable the correct response is to find out why rather than to build a vault.
- **A second platform.** Every mechanism here is macOS-specific. Windows or Linux is a new decision,
  not a port.
