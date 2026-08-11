# Security and privacy

What Propositum collects, what it refuses to collect, what it guarantees, and — at equal length —
what it does not.

Written from the decisions in [`docs/adr/`](./adr/) rather than ahead of them. Where a protection is
depth rather than a boundary, this document says so.

---

## Data collected

There are **two modes**, and they collect very different things. *(Amended 2026-08-11 —
[ADR-0008](./adr/0008-ambient-detection.md). This section previously said "only during an
explicitly started WorkSession, and only from sources the person approved", which is no longer
true and is the reason this amendment leads rather than follows.)*

### 1. Ambient — always, every `https` site, metadata only

Propositum watches continuously so it can notice work you have not told it about. What it keeps
while doing so is deliberately thin:

| Collected | Detail |
|---|---|
| Cleaned URL | credentials and tracking parameters stripped |
| Page title | as the page reports it |
| Interaction shape | dwell time and scroll depth |

**No page text. No selections. No excerpt.** There is no field in the ambient schema that could
carry any, and a test asserts it.

Where it goes matters as much as what it is:

- **In memory only.** It never reaches the database. It dies when the app process does.
- **Bounded twice** — a rolling 30-minute window *and* a 500-row cap.
- **Discarded by default.** Declining an offer drops it. Accepting one folds it into the session
  you just started, where it becomes an ordinary `ObservationEvent` marked `ambient: true`.

The extension holds `host_permissions: ["https://*/*"]`, so Chrome shows **"Read and change all your
data on all websites"** at install. That warning is accurate. What limits the exposure is no longer
the permission — it is the behaviour above, enforced in three places and tested. ADR-0008 states
plainly that this is a weaker kind of guarantee than the one it replaced.

### 2. Session — only when you started one, only on approved sources

Everything below is collected **only** during an explicitly started `WorkSession`, and only from
sources the person approved. This is where page text begins.

| Collected | Detail |
|---|---|
| Page title | of an `ApprovedSource` only |
| Cleaned URL | query parameters stripped except a recognised search term |
| Deliberate selections | text the person selected or copied, verbatim |
| Readable article text | **at most 2,000 characters** per approved source |
| Interaction shape | dwell time, scroll depth, focus changes, returns to a source |
| Document edits | from the in-app editor, not the browser |
| Typed notes | written by the person |
| Capture gaps | when Propositum knows it was not watching, and why |

**The 2,000-character excerpt budget is a published product constant, not a tuning knob.** It is
expensive to change: `ObservationEvent`s are append-only, so raising or lowering it invalidates every
fixture already captured.

## Data explicitly not collected

Not "not yet" — these are design commitments, and several are structurally impossible rather than
merely unimplemented.

- **Full page text.** Only the bounded excerpt above.
- **Anything from a source you have not approved.** The extension is not granted `tabs`,
  `webNavigation`, or `history`, so Chrome will not hand it the URL, title, or tab of any other
  page. It cannot learn what else you were doing. This is enforced by the browser, not by our code.
- **Keystrokes.** No key logging anywhere.
- **Screen contents.** No screenshots, no screen recording, no video.
- **Other applications.** Chrome only, approved sources only.
- **Passwords, form contents, or clipboard contents** not deliberately selected in an approved
  source.
- **Telemetry, analytics, or crash reports.** There is no server to send them to.

### Why an extension rather than a controlled browser

Under a Chrome MV3 extension scoped by `optional_host_permissions`, "approved sources only" is a
manifest declaration you consent to in Chrome's own UI and can revoke there. Under a
Playwright-controlled browser it would be an `if` statement in our TypeScript, and a regression
would widen capture to everything, silently, with no visible signal.

Rewind's exclusion controls were sincere, documented, and leaked anyway — through Mission Control,
picture-in-picture, and password managers rendered as extensions. Those leaks were emergent
properties of building exclusions on a see-everything vehicle. That failure mode is not available to
a vehicle that is never handed the data. ([ADR-0002](./adr/0002-observation-capture.md))

## Local versus remote

**Everything is local.** SQLite on your machine. No account, no cloud, no sync, no server.

The single exception: **prompts sent to the Anthropic API**, which contain the observation events
and document text a boundary needs. Nothing else leaves the machine.

This is a privacy property today and a limitation tomorrow — it is also why a run stops when your
Mac sleeps.

## Retention and deletion

Observation events and the action ledger are **append-only** and cannot be edited. Deleting a
`Project` deletes its sessions, events, documents, and ledger.

There is no automatic expiry in slice 0. Everything persists until you delete it.

Export is not implemented. The database is a single SQLite file you own and can copy.

## Secrets

One credential: `ANTHROPIC_API_KEY`, in `.env`, gitignored. Never logged, never rendered, never sent
anywhere but Anthropic.

## The permission model

1. You create a `Project` and approve sources. Approval is a Chrome host-permission grant, visible
   and revocable in Chrome.
2. You start a session explicitly. Capture is off otherwise.
3. You ratify a `HandoffContract` before anything runs autonomously. **No `AgentRun` may start from
   an unratified contract, and nothing in the autonomy dials can switch that off.**
4. The contract names what may be read and what may be changed. The gate enforces it
   deterministically.
5. You accept or reject every proposed change.

**Approval scopes where Propositum may look. It confers no trust on what is found there.**

## Action authorization

Models propose; deterministic code authorizes. There is no path from model output to a permission
decision.

- Every capability requires an `AuthorizedAction`, a token branded with a symbol only the gate can
  use. A worker holding an unauthorized proposal can do nothing with it.
- The gate is pure — set membership, comparison, boolean. **No model is consulted.**
- Deny by default, no denylist.
- Every refusal is recorded as an `ActionIntent` with a deterministic rule id.

### Capabilities that do not exist

Propositum cannot send a message or email, purchase or book anything, publish a document, delete a
file, or control your computer.

These are **absent from the `ActionKind` enum entirely**, not denied by a rule. A prohibition
implemented as a missing capability cannot be misconfigured or re-enabled by a policy bug. An
architecture test asserts the functions do not exist.

## Prompt injection

The honest section.

### The guarantee

> **An injection can change what the worker attempts. It can never change what the worker may touch.**

`compilePolicy` is typed so it **cannot receive prose**. Passing the objective, definition of done,
or guidance into a permission decision is a compile error. So no page text — however crafted —
widens the source allowlist, adds a capability, or extends the budget.

Verified against the hostile corpus on the loosest possible autonomy settings: a source the
injection tried to add is refused with `source_not_approved`; an invented capability is refused with
`unknown_action_kind`.

### The exposure

**The session-reading boundary is inside the blast radius.** It reads page-derived text and produces
the inferred objective, so a successful injection can rewrite what Propositum thinks you are doing —
*before you see the handoff screen*.

**Your review of the agreement is the thing that catches it.** That is why the review cannot be
switched off, why every claim carries evidence back to its source events, and why fabricated quotes
are counted rather than dropped.

A person who ratifies a contract without reading it has removed the boundary.

### Depth, not boundaries

| Mechanism | Status |
|---|---|
| `compilePolicy` cannot receive prose | **boundary** |
| `ContractScope` gates every action | **boundary** |
| Capabilities absent from `ActionKind` | **boundary** |
| Human ratification before any run | **boundary** |
| Datamarking and fencing of page text | depth |
| Sanitisation (zero-width, bidi, control characters) | depth |
| The system-prompt rule | depth |
| The model's own judgment | depth, and the weakest layer |

**Spotlighting and delimiters are not a boundary.** OWASP 2026 reports adaptive attack success above
90% against twelve recent defences. They are deployed. They are not relied on.

### Observed behaviour, and its limits

Against the hostile fixture (`claude-opus-5`, 2026-08-07) the reading kept the correct objective and
**reported the injection as an uncertainty claim**, naming each payload, rather than following any of
them. It also flagged a page title as page-authored and unverified, unprompted.

**One run, one model, non-adaptive payloads.** This is evidence the prompt contract is coherent. It
is not evidence of safety, and it does not transfer to another model.

It is useful in one specific way: a reading that *reports* an attack gives you something to react
to, whereas silent resistance looks identical to not having been attacked.

## Trust boundaries in the browser

- The extension talks to `127.0.0.1` over a WebSocket with a per-session bearer token, an `Origin`
  check pinned to the extension id, and `application/json` plus a custom header.
- **CORS protects nothing here.** `POST` with `Content-Type: text/plain` is CORS-safelisted, so a
  forged event from a hostile page would be *delivered and executed* — only the response is
  withheld, and fire-and-forget forgery needs no response. Hence all four controls above.
- Chrome extensions are currently exempt from Local Network Access restrictions. That is documented
  only in an unversioned Google document that says *"currently"*, so the extension performs a
  **startup self-check that fails loudly** rather than assuming it holds.

## Auditability

Every action is an `ActionIntent` (reason, before) and an `ActionOutcome` (result, after), both
append-only. Refusals are recorded too.

Append-only is enforced by **three SQLite triggers per table**, reinstalled *and verified* at every
startup — Prisma's migrations drop triggers on any table rebuild, silently, so the guard is a runtime
invariant rather than a migration artifact. Startup **fails** if a guard is missing: a database that
accepts an `UPDATE` on the ledger is worse than an application that will not boot, because the first
one is silent.

Any sentence in a reviewed draft traces back through changeset → contract → reading → claim →
evidence → the originating observation event. Every hop is a foreign key, and no step requires a
model to be truthful about its own history.

## What this document does not cover

- **Multi-user.** Changes the threat model entirely; not a small extension of this one.
- **A malicious local user.** Anyone with your filesystem has your SQLite database.
- **Supply chain.** Dependencies are audited (`npm audit`, currently 0) and not otherwise verified.
- **The compile-time guarantees at runtime.** The `AuthorizedAction` and `Datamarked` brands make
  accidental bypass impossible and deliberate bypass loud. They are not a sandbox: code inside this
  repository could reach either brand reflectively. The threat model is our own future carelessness,
  not an attacker who can already run arbitrary code in the worker.
