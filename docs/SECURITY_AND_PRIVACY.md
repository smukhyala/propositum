# Security and privacy

What Propositum collects, what it refuses to collect, what it guarantees, and — at equal length —
what it does not.

Written from the decisions in [`docs/adr/`](./adr/) rather than ahead of them. Where a protection is
depth rather than a boundary, this document says so.

*(Added 2026-08-16 — [ADR-0011](./adr/0011-intention-above-worksession.md). Some sections below
constrain capabilities that **do not exist**: standing agreements, event sources beyond the browser,
a worker router. They are here because the constraint on each is one sentence today and a migration
later. Each says in its own first line that the thing is unbuilt, so nothing here can be read as a
capability claim. **The `Intention` belongs on that list**, and it is the one most likely to be
misread, because ADR-0011 authorises it and the next slice builds it. Today there is no `Intention`
table and no `Intention` type. What this document says about what an Intention may hold, and about
its lifecycle states, is a **specification rather than a description** — the same fence
[`CONTEXT.md`](../CONTEXT.md)'s own entry puts around itself.)*

---

## Data collected

There are **three modes**, and they collect very different things. *(Amended 2026-08-11 —
[ADR-0008](./adr/0008-ambient-detection.md). This section previously said "only during an
explicitly started WorkSession, and only from sources the person approved", which is no longer
true and is the reason this amendment leads rather than follows. Amended again the same day —
[ADR-0010](./adr/0010-acting-in-the-browser.md) — because an agent that acts in your browser sees
far more per turn than the watching does in an hour, and a document that did not say so would be
false in the place it can least afford to be.)*

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

### 3. Acting — only under an agreement you ratified, only in a tab Propositum opened

When you hand work over and Propositum acts in your browser, it has to see the page it is acting on.
That is a different kind of collection from the two above and it is kept in a different place.

| Collected | Detail |
|---|---|
| The accessibility tree | the page as the browser describes it to assistive technology — text, controls, labels — **at most 60,000 characters per turn** |
| A screenshot | **only when the tree is insufficient**, and only of the tab Propositum opened |
| What it dispatched | which element, which kind of input, and what the browser attested about the request |

This is `ActionEvidence`, and four things about it are the whole promise:

- **60,000 characters is a published product constant, not a tuning knob** — the same standing as
  the 2,000 above, and it is named `SNAPSHOT_BUDGET_CHARS` in the code. The promise is the artifact
  and the number is downstream of the promise sentence. It exists because an accessibility tree is
  ten to a hundred times an article excerpt and arrives every turn, so an unbounded one would quietly
  become the largest thing Propositum stores.

  **Thirty times larger is a real cost and this document is not going to bury it.** A run is capped
  at 40 actions, so the ceiling is about 2.4 million characters of page text per run — where the same
  person browsing the same sites unaided would leave 2,000 characters per source. The mitigations are
  that it happens only under an agreement you ratified, only in a tab Propositum opened, and that it
  is swept; none of those makes it small.

- **It is a separate ledger from your browsing, and they never join.** `EXCERPT_BUDGET_CHARS`
  governs what Propositum retains about **your own browsing**; `ActionEvidence` is what the agent saw
  **while acting under an agreement you ratified**. Nothing in it is read by inference, joined to an
  observation event, or shown on a session timeline. This is not a loophole around the 2,000 — it is
  a different promise about a different thing, and it works only because it is written down here
  rather than assumed.

- **Almost all of it is kept for at most seven days, and usually far less.** Two rules, and the
  first is the one that normally fires:

  | | |
  |---|---|
  | **When you have decided** | once you have accepted or rejected everything a Shift produced, its evidence is deleted at the next sweep — within the hour. For a Shift that edited a document, "decided" means every proposed change has a verdict |
  | **Seven days, regardless** | the backstop for a run that failed, was interrupted, or is waiting on a question nobody answered. `ACTION_EVIDENCE_RETENTION_DAYS = 7` |

  Seven, rather than one, because a run stopped for your confirmation can be answered days later —
  asked Friday evening, answered Monday morning — and the screen asking you to authorise an effect
  has to be able to show you the page it is about. Seven, rather than thirty, because a week-old
  accessibility tree of a page you were signed into answers a question nobody is asking. The sweep
  runs in the worker process, at startup and hourly.

- **One class of evidence is kept indefinitely, and this document is not going to round that down
  to seven days.** If Propositum stopped and asked you to authorise an irreversible action, the
  snapshot you were looking at while you decided is **never deleted** — not after you answer, not
  after the run ends, not after the window.

  Why it cannot be deleted: the question Propositum asked you is an append-only audit row that
  points at that snapshot. Deleting the snapshot would either break that record or require editing
  it, and the record of *what a person was shown when they authorised an irreversible effect* is the
  single most important row in this ledger. It is also, unavoidably, the row most likely to be a
  **screenshot of a page you were signed into** — which is the worst possible thing to keep forever,
  and is why this is stated here in full rather than left as a footnote to a seven-day promise.

  It is bounded by how rarely it happens: one snapshot per confirmation question, and a confirmation
  question is a deliberate stop, not a routine turn. Every sweep counts these rows rather than
  silently skipping them. Recorded as a revisit condition in
  [ADR-0010](./adr/0010-acting-in-the-browser.md).

- **It is the one durable table that can be deleted at all.** Everything else in the ledger is
  guarded by triggers against `UPDATE` and `DELETE` alike. `ActionEvidence` keeps the guard against
  being **rewritten** — what you were shown must stay what you were shown — and deliberately drops
  the guard against being **removed**, because a no-`DELETE` trigger and a retention sweep cannot
  both be true. What stands in for the missing trigger is three tests: the ORM delete exists in one
  place, that place is reachable only through the sweep, and no raw SQL goes round it. That is
  weaker than a trigger — it is a check on our own code rather than a refusal by the database — and
  it is the strongest thing available once a sweep has to exist.

## Data explicitly not collected

Not "not yet" — these are design commitments, and several are structurally impossible rather than
merely unimplemented.

- **Full page text.** Only the bounded excerpt above, and — while acting — the bounded accessibility
  tree of the tab Propositum opened.
- **A list of your open tabs.** The extension is not granted `tabs`, `webNavigation` or `history`,
  and the acting agent never calls `chrome.debugger.getTargets`. ~~There is no call it can make that
  returns a tab it did not create itself.~~ ~~**This one is still enforced by the browser rather than
  by our code.**~~

  **Amended 2026-08-17 ([`docs/research/intent-signals.md`](./research/intent-signals.md) §2.1):
  both struck sentences were false, and the second one was false in the way that costs the most.**
  `chrome.tabs.query()` needs no permission to call. Chrome's own reference says the `tabs`
  permission *"does not give access to the `chrome.tabs` namespace"* — it only *"grants an extension
  the ability to call `tabs.query()` against four sensitive properties on `tabs.Tab` instances:
  `url`, `pendingUrl`, `title`, and `favIconUrl`"* — and that *"host permissions allow an extension
  to read and query a matching tab's four sensitive `tabs.Tab` properties"*. Since
  [ADR-0008](./adr/0008-ambient-detection.md) the manifest holds
  `host_permissions: ["https://*/*"]`. So one line in the service worker would return the URL and
  the title of **every open `https` tab, in every window**, today. No line in the extension is that
  line. That is discipline, not Chrome.

  **The promise is now held by a test rather than by the browser, and a test is weaker than a
  refusal.** This is the register [ADR-0010](./adr/0010-acting-in-the-browser.md) used about its own
  replacement — *"a pause is strictly weaker than an absence"* — and it applies here unchanged. A
  refusal cannot be forgotten in a hurry, cannot be deleted by somebody who is sure it is redundant,
  and cannot pass because the file it searched got renamed. A test can be all three. The mechanism
  is [`tests/extension-permissions.test.ts`](../tests/extension-permissions.test.ts): it greps the
  extension for `chrome.tabs.query`, `chrome.tabs.get`, `chrome.history.*` and
  `chrome.webNavigation.*`, and it pins the manifest's permission list to an explicit set, so adding
  one has to be a deliberate act rather than an edit nobody reviews.

  **And that mechanism shipped with a hole in it, found and closed the same day.** The grep strips
  comments before searching, and the first version did it with a regular expression that read the
  two characters `/*` **inside a string literal** in `extension/src/panel.html` as the start of a
  comment — deleting thirty-three lines of live side-panel code, in the one file the search was
  extended to cover. A `chrome.tabs.query()` written in that span passed the whole suite. It is
  fixed, and the fix is a scanner plus a per-file check that no code line goes missing. It is
  recorded here rather than quietly repaired because it is the point the paragraph above was
  making: a test can be forgotten, deleted, or **wrong**, and a refusal cannot.

  **The date this stopped being structural is 2026-08-11**, the day ADR-0008 widened
  `optional_host_permissions` into `https://*/*`. It was noticed on 2026-08-17, by research
  commissioned about something else. Six days is the honest measure of how long a written guarantee
  can go on being read as true after the decision underneath it has moved.

  **And the surviving half is thinner than it reads.** `chrome.debugger.getTargets` is genuinely
  never called and [`tests/extension-cdp.test.ts`](../tests/extension-cdp.test.ts) has greped for it
  since ADR-0010 — but ADR-0010 also *granted* `debugger`, so that refusal is our code declining
  too, not Chrome refusing. The research note calls this half "still structurally true"; it is not,
  quite, and this document is not going to round it up. What is left is two greps over a component
  with no build step, which is a real guard and a weaker one than the sentence it replaced.

  *(Amended 2026-08-11: this bullet used to say "anything from a source you have not approved".
  Since [ADR-0008](./adr/0008-ambient-detection.md) the extension holds broad host permission and
  does see every `https` page you visit — as metadata, in memory. ~~What Chrome still refuses to
  hand over is the existence of any other tab, which is a narrower promise than the one this bullet
  used to make, and it is the true one.~~ **Struck 2026-08-17: Chrome refuses no such thing, and had
  already stopped refusing it on the day that amendment was written.**)*
- **Keystrokes.** No key logging anywhere.
- **Your screen.** No screen recording, no video, and no screenshot of anything you are doing. The
  only images Propositum ever takes are of the tab it opened itself, while acting under an agreement
  you ratified, when the accessibility tree was not enough to act on — and those are swept.
  *(Amended 2026-08-11. This bullet said "no screenshots" flatly, and that stopped being true with
  [ADR-0010](./adr/0010-acting-in-the-browser.md).)*
- **Other applications.** Chrome only.
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

## Event ingestion beyond the browser

**One sensor exists, and it is the Chrome extension above.** Email, calendar, Slack, GitHub, Notion,
local files, and agent output from anywhere else are **unbuilt, and this work does not build them** —
they sit on the *do not build yet* list in [`MVP.md`](./MVP.md)'s Out of scope table. This section
exists so the constraint is on record before a later reader takes the absence for an oversight and
closes it with a connector.

Two facts make the absence structural rather than a matter of priority. That distinction is the
whole value of this section: it means the line cannot be crossed by accident.

- **No event outside a sitting can be persisted at all.** `ObservationEvent.sessionId` is required,
  and `ledger-writer.ts` is the single door every event enters by — one writer, because `seq` has to
  be gapless per session and two writers assigning their own sequence corrupt the stream invisibly.
  There is no row an external event could become and no writer that would accept it. A connector is
  therefore not an integration job. It is a schema change plus a second writer, and the second writer
  is the thing that argument exists to forbid.
- **[`CONTEXT.md`](../CONTEXT.md) bans model calls on a timer**, and gives two reasons an external
  source would have to answer rather than inherit: periodic interpretation feeds hostile page text to
  a model while no human is watching, and it makes the event stream non-reproducible, so the eval
  harness cannot re-score a fixture. An email that arrives at 3am is a model call at 3am unless
  something is designed first to prevent it.

**Neither of those is a promise never to build this.** They are the two questions the first external
source has to answer in its own ADR — written down now so that answering them is the work, rather
than discovering them.

One consequence is already fixed in the specification. The `Intention` lifecycle is specified with
**five** states — `working`, `delegated`, `needs-you`, `sleeping`, `done`. The direction document
lists a sixth, *waiting*, meaning progress depends on an external event. Nothing here can produce an
external event, so nothing could put an intention into it. It is documented in
[`ARCHITECTURE.md`](./ARCHITECTURE.md) as the state that arrives with event ingestion, and it will
not be declared in the union: an enum member nothing can reach is a promise the schema makes and the
product cannot keep.

## Local versus remote

**Everything is local.** SQLite on your machine. No account, no cloud, no sync, no server.

The single exception: **prompts sent to the Anthropic API**, which contain the observation events
and document text a boundary needs. Nothing else leaves the machine.

This is a privacy property today and a limitation tomorrow — it is also why a run stops when your
Mac sleeps.

### Send a worker the minimum it needs

Every model call is a `ModelBoundary` with its own prompt builder, schema and token budget
([ADR-0005](./adr/0005-model-boundary.md)), so what travels is a property of the one job being done
rather than of a shared context blob that grows. The reading boundary gets one session's events. A
worker gets the contract's terms, what it has already done **in this run**, and the page in front of
it — not the project's other sessions and not what a previous run did. `WorkerActionInput` is the
list, and it is short enough to read.

**Honest limit: this is a habit of the design, not an enforced maximum.** Nothing rejects a boundary
that builds an over-broad prompt. The token budget bounds size, not relevance, and no test asserts
that a boundary asked for the least it could have.

**There is one provider and there is no router.** `ModelClient` has one real implementation and one
fake. Nothing selects an executor by fit, cost, latency, quality or tool access, and multi-provider
routing beyond clean interfaces is on the *do not build yet* list. This is recorded here because a
router is exactly the component that would put pressure on this section: choosing a different
executor changes who performs the work, and must not change how much of your data travels with it.

## Retention and deletion

Observation events and the action ledger are **append-only** and cannot be edited. Deleting a
`Project` deletes its sessions, events, documents, and ledger.

**One thing expires on its own: `ActionEvidence`.** *(Amended 2026-08-11 —
[ADR-0010](./adr/0010-acting-in-the-browser.md). This section said "there is no automatic expiry.
Everything persists until you delete it", which was true of a product that only watched. It is not
true of one that keeps whole page trees and screenshots of your authenticated session, and a
document that still said it would be false in the place it can least afford to be.)*

| | |
|---|---|
| Everything else | persists until you delete it |
| `ActionEvidence` | deleted once you have decided what the Shift produced, and in any case after **seven days** — see *Acting*, above |
| `ActionEvidence` attached to a confirmation question | **kept indefinitely.** The one exception, argued in full above |

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

## Trust is not authorization

*Approval scopes where Propositum may look; it confers no trust on what is found there* is one
instance of a rule this document now states generally.

[ADR-0007](./adr/0007-stop-conditions.md) already states the asymmetry, for models:

> A model may **never** widen what is permitted — it could grant.
> A model may **always** decline to proceed — it can only withhold.

**Acceptance history is a second source, and it gets the same asymmetry, unchanged.** A record of
which classes of action you have accepted, edited, rejected or required approval for may recommend a
dial's default, and may argue on screen for a wider setting. It may never widen a permission, and it
is never an input the gate reads. It can always make Propositum more cautious.

Naming it as the same asymmetry is worth more than the paragraph itself. There is one rule with two
sources rather than two safety arguments to keep in agreement, and the next source — a heuristic, a
score, a reputation signal from outside — arrives already governed instead of needing its own case
made from scratch.

**None of this is built.** Nothing today counts what you accept or reject in order to recommend
anything. The verdict tables exist, append-only, and nothing reads them for this purpose.

### Standing agreements: the name is reserved, the object is deferred

**There is no standing agreement in this system, and this work does not add one.** Nothing durable
carries permission between handoffs; every `AgentRun` starts from a `HandoffContract` a person
ratified for that run, and the five steps above are the whole of the permission model.
[ADR-0011](./adr/0011-intention-above-worksession.md) reserves `WorkingAgreement` as a type name so
the word is not spent a third time, and builds nothing behind it. *Working agreement* stays
`HandoffContract`'s consumer label, and no screen changes.

One commitment is recorded now, because it is one sentence today and a migration later:

> **A standing agreement is a ceiling intersected into a contract's scope — never a floor unioned
> onto it.**

That choice, not the feature's interface, decides whether it is safe. Intersection can only narrow
what a run may do, so an agreement that is stale, over-broad, or written in a more trusting mood than
the one you are in now still cannot authorise anything the contract in front of you does not already
allow. Union makes the durable object a grant, and a grant signed months ago is precisely the
permission nobody re-reads.

**Nothing enforces this, because there is nothing yet to enforce it on.** It is a sentence in a
document, which is the weakest kind of guarantee this file contains, and it is here rather than held
in someone's memory of a conversation.

### No agreement may pre-approve an irreversible action

Not a new rule. Two existing ones, cited rather than re-argued, because the way this feature gets
built wrong is by reading *reduce repetitive confirmations* as *reduce confirmations*.

- [`PRODUCT_PRINCIPLES.md`](./PRODUCT_PRINCIPLES.md) §6: **no dial may ever pre-approve an
  irreversible action**, and *"a model saying 'this is still the same step' is likewise forbidden,
  because that is a grant wearing a description's clothes."* A standing agreement is a dial with a
  longer life. The principle already reaches it; it does not need extending.
- **`ConfirmationVerdict` has two members, and both are decisions a human made.** There is no value
  meaning *expired*, *assumed* or *agreed in advance*, and `expireConfirmations` writes no verdict at
  all — an unanswered question keeps its absence, and the gate refuses on the same nothing it saw
  before the question was asked. A third member is how elapsed time would become permission. Its
  absence is why that path does not exist, which is a stronger thing than a rule against taking it.

`classifyReversibility` takes an action kind and the browser's own attestation about the element. It
takes no agreement, no history and no preference, and the correct shape for any future agreement is
one that still cannot reach it.

### What an Intention may accrue

An `Intention` will be the first durable object here that outlives a sitting, which makes it the
obvious place for a profile to accumulate quietly. The boundary, written before the table is:

| | |
|---|---|
| **May hold** | what a person wrote or edited — the desired outcome and what done looks like. `objective` and `definitionOfDone` are the whole of it |
| **Is not stored at all** | the lifecycle state. `working`, `delegated`, `needs-you`, `sleeping` and `done` are to be computed from rows that already exist; the view is specified and not yet written, so there is no column for them to drift in |
| **May not hold** | anything inferred about the person rather than stated by them — a working style, a tolerance for risk, a trust score, a learned autonomy level |

**`guidance` stays per-contract on `StatedIntent`, and deliberately does not become durable.** It is
the one field this corpus guards hardest: [`CONTEXT.md`](../CONTEXT.md) calls it *"the one place
where page prose could otherwise become something the worker follows"*, which is why it is
human-typed only and why an inferred `constraint` claim never pre-populates it. Its safety is
carried by its lifetime — retyped, re-read and re-ratified for every contract. A durable `guidance`
would be one afternoon's sentence silently steering every later handoff on one old ratification,
which is the standing-agreement failure mode wearing a field name.

**The table's third row is enforced by construction rather than by a check, and that difference is
the point.** Per [ADR-0011](./adr/0011-intention-above-worksession.md) an `Intention` is
**human-ratified only**: a person creates it, a person edits it, no detector writes one, and no model
boundary writes one. There is no writer that could accrue anything, so there is nothing for a check
to catch.

That is a stronger guarantee than a validation rule and a more brittle one. It holds exactly as long
as the writer set stays human, and it would fail **silently** the first time a model boundary is
given an `Intention` field to fill in — no test would go red, because what is protecting the row is
the absence of a writer rather than the shape of its contents.

What Propositum infers about you stays where it already is: `SessionClaim{kind:'objective'}`, one
sitting, evidence-bearing, cold every time. That arrangement is what keeps the boundary observable
rather than merely intended — the inferred thing has a visible lifetime, and the durable thing has a
human author.

## Action authorization

Models propose; deterministic code authorizes. There is no path from model output to a permission
decision.

- Every capability requires an `AuthorizedAction`, a token branded with a symbol only the gate can
  use. A worker holding an unauthorized proposal can do nothing with it.
- The gate is pure — set membership, comparison, boolean. **No model is consulted.**
- Deny by default, no denylist.
- Every refusal is recorded as an `ActionIntent` with a deterministic rule id.

### Capabilities that do not exist

*(Rewritten 2026-08-11 — [ADR-0010](./adr/0010-acting-in-the-browser.md). The previous version of
this section said Propositum "cannot send a message or email, purchase or book anything, publish a
document, delete a file, or control your computer". That is no longer true, and the honest version
is below. This is the section of this document most likely to be quoted, so it says the weaker thing
plainly rather than the stronger thing carefully.)*

Propositum can now act in your browser: it can click, type, and submit, in a tab it opened, under an
agreement you ratified. So it **can** press a button that sends something.

What still does not exist, and what replaced what did:

| | |
|---|---|
| **Still absent entirely** | any capability outside your browser — your filesystem, your other applications, your computer. There is no tool, and an architecture test asserts none exists |
| **Still absent entirely** | any way for Propositum to run its own JavaScript in a page you are signed into. No `Runtime.evaluate`, no `element.click()`. Clicks are synthesised input at coordinates |
| **Still absent entirely** | any way to learn that another tab exists, or to act in one |
| **Replaced by a confirmation** | sending, submitting, buying, publishing, deleting. These used to be absent from the `ActionKind` enum. They are now reachable by a click, and every action the browser attests as irreversible stops and asks you first |

**A confirmation is weaker than an absence, and this document is not going to pretend otherwise.** An
absence cannot be misconfigured or clicked through; a question can be. What holds it up:

- **Irreversibility is decided by the browser, not by a model and not by the page.** An action needs
  your confirmation when Chrome is about to send a non-`GET` request, or a request to a site outside
  the agreement. Chrome attests the method, so page text cannot forge it.
- **A word list over the button's own label can only make Propositum more cautious**, never less.
- **No dial can pre-approve one.** There is no setting, anywhere, that grants irreversible actions in
  advance. The acknowledgement is per action.
- **Time cannot approve one.** A question that expires produces no answer and no permission. There is
  no path from elapsed time to *yes*.
- **What already happened is never dressed up as reviewable.** If something landed out there,
  Propositum reports it and offers you no verdict, because a Reject button that cannot reject is a
  lie told by the one screen this whole model rests on.

**The honest hole:** a `GET` request can be irreversible — an unsubscribe link, a one-click
confirmation — and the network mechanism does not see those at all. The word list is English-only.
Both are stated in ADR-0010 as the largest uncovered case in this design.

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

- The extension talks to `127.0.0.1` over **HTTP**, with a per-session bearer token, an `Origin`
  check pinned to the extension id, and `application/json` plus a custom header. *(Corrected
  2026-08-11: this said "a WebSocket", as does [ADR-0002](./adr/0002-observation-capture.md)'s
  decision table. The shipped extension uses `fetch` plus a 30-second `chrome.alarms` heartbeat, and
  the code is authoritative — a socket is the wrong shape for a service worker that dies every 30
  seconds, and the security argument was never about the transport being a socket. It was about the
  four controls, and all four hold on the HTTP path.)*
- **CORS protects nothing here.** `POST` with `Content-Type: text/plain` is CORS-safelisted, so a
  forged event from a hostile page would be *delivered and executed* — only the response is
  withheld, and fire-and-forget forgery needs no response. Hence all four controls above.
- Chrome extensions are currently exempt from Local Network Access restrictions. That is documented
  only in an unversioned Google document that says *"currently"*, so the extension performs a
  **startup self-check that fails loudly** rather than assuming it holds.

## Auditability

Every action is an `ActionIntent` (reason, before) and an `ActionOutcome` (result, after), both
append-only. Refusals are recorded too.

Append-only is enforced by **three SQLite triggers per table** — no `UPDATE`, no `DELETE`, and no
`INSERT OR REPLACE`, which walks straight through the first two — reinstalled *and verified* at every
startup, because Prisma's migrations drop triggers on any table rebuild, silently. Startup **fails**
if a guard is missing: a database that accepts an `UPDATE` on the ledger is worse than an application
that will not boot, because the first one is silent.

**`ActionEvidence` has two of the three**, and that is the only exception in the schema. It is
guarded against being rewritten and not against being removed, because it is the one table that is
swept. See *Retention and deletion*.

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
