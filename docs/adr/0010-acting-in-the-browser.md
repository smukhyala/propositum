# ADR-0010 — Acting in the person's own browser

**Status:** accepted · 2026-08-11
**Reverses:** [ADR-0002](0002-observation-capture.md) — the refusal of the `debugger` permission, and
the separate Playwright process
**Amends:** [ADR-0004](0004-policy-gate.md) (what `ActionKind` enumerates, and what the plan bounds)
· [ADR-0007](0007-stop-conditions.md) (a stop that is recoverable) ·
[ADR-0001](0001-worker-runtime.md) (what owns a run's lifetime)

## The sentence that stops being true

`ActionKind` stops enumerating **effects** and starts enumerating **mechanisms**, and that is this
ADR's real price, stated before anything that makes it sound affordable. ADR-0004's strongest claim —
*"A prohibition implemented as a missing capability cannot be misconfigured and cannot be re-enabled
by a policy bug"* — **becomes false in substance while staying true in the enum.** There is still no
`sendMessage`. `tests/architecture.test.ts` still asserts that no function by that name exists, that
assertion still passes, and it now means very much less than it did, because `clickElement` can
press *Send*. Read literally the test is as true as ever; read as the guarantee it was written to
carry, it has quietly stopped covering the thing it was about. The replacement is a **confirmation
pause** before an action the browser attests is irreversible — and **a pause is strictly weaker than
an absence**. An absence cannot be misconfigured, cannot be clicked through, and does not get tired
at nine in the evening. This is the first ADR in the series whose net effect on safety is negative.
Everything below argues the loss is bounded, deliberate and visible. None of it argues the loss is
not real.

## What ADR-0002 said, in its own words

Quoted rather than paraphrased, because the paraphrase always comes out weaker than the original and
the original was right:

> | **Explicitly NOT** | `tabs`, `webNavigation`, `history`, `debugger` |

> **A Chrome MV3 extension for human observation. The worker's browser stays a separate Playwright
> process. They are not consolidated.**

> **Consolidation is not worth the coupling.** Sharing infrastructure would save perhaps 200–400
> lines, against a worker one `page.click()` away from acting inside the person's authenticated
> session.

That claim was correct then and is correct now. The worker is one `Input.dispatchMouseEvent` from
acting inside the person's authenticated session, and this ADR's entire content is what stands in
that one step.

## Context

The separate Playwright process bought its safety by being useless. It has no credentials, so it
cannot see anything the person is signed in to; it has a hard URL allowlist, so it cannot follow
work anywhere real. Every job people actually want done — reply in this thread, fill this form,
pull my orders out of this account, put these numbers in that sheet — lives behind a session
Propositum's browser does not have and must not be given.

There are two ways out. Give the worker's own browser the person's credentials, or let it act in the
browser that already has them. The first is worse in every dimension: a credential copied out of
Chrome is a credential outside Chrome's protections, invisible to the person, revocable only by
changing a password, and it converts a bounded local mistake into a durable one. The second is
frightening in exactly one dimension — the blast radius is the person's real session — and that one
is at least *visible*, revocable in one click, and bounded by mechanisms below.

## Decision

**A computer-use agent acts in the person's real Chrome, driven by the extension over
`chrome.debugger`, in a tab Propositum opened and nowhere else.**

| | |
|---|---|
| **Permission added** | `debugger`. Chrome shows its own infobar for the whole attachment and the person can end it from there |
| **Permission still not requested** | `tabs`, `webNavigation`, `history` |
| **Where it may act** | one tab, created by `chrome.tabs.create`, whose id the extension already holds |
| **How it perceives** | the accessibility tree with element refs, per turn; a screenshot on request when the tree is insufficient |
| **How it acts** | synthesised input at coordinates. **No `Runtime` domain, ever** |
| **How it proceeds** | observe → act → observe, continuously. Not a fixed plan executed in order |
| **What decides irreversibility** | the browser, at the network. Never a model |
| **What an irreversible action costs** | a refusal, a question, and a new `AgentRun` |

### 1. It cannot learn that any other tab exists

The agent works only in a tab Propositum opened itself. `chrome.debugger.getTargets` is **never
called**, and the `tabs` permission is **never requested**, so there is no call the extension can
make that returns a tab it did not create. This is the one place in this design where ADR-0002's
original argument survives intact: the constraint is enforced by Chrome refusing, not by our code
remembering.

**The product cost is real and is not a bug to fix later.** The agent cannot continue in a tab you
were already reading. If you have a half-filled form open, Propositum opens its own tab and starts
from the URL. Sometimes that means signing-in flows, and sometimes it means the work simply cannot
be picked up where you left it. The alternative is an extension that can enumerate your tabs, and
that is not a trade this project makes twice.

### 2. No `Runtime` domain at all

No `Runtime.evaluate`. No `Runtime.callFunctionOn`. No `DOM.resolveNode`. There is no path by which
a string Propositum composed becomes JavaScript executing in a page the person is signed into.

Clicks are therefore synthesised: `DOM.getBoxModel` for the element's quad, then
`Input.dispatchMouseEvent` at its centre. Never `element.click()`.

**This costs robustness, and the direction of the cost is the point.** An element behind a cookie
banner, under a sticky header, or scrolled out of view gets a click delivered to whatever is
actually on top — which fails, visibly, and the next accessibility tree shows the agent it did not
work. `element.click()` would have fired the handler through the overlay and **succeeded silently**,
which is the same outcome a person could never have produced with a mouse.

That is the correct failure direction because of what the two failures cost downstream. A visible
failure costs a wasted turn and appears in the ledger as an attempt that did not land. A silent
success on an occluded element means Propositum did something no person could have done, in a real
account, and reported it as ordinary. The occlusion is very often the *site telling a human to stop
and look* — a consent gate, a modal, an "are you sure". Every one of those is exactly the class of
thing this ADR exists to not walk through.

The related property is worth naming separately: **Propositum never runs a line of its own
JavaScript inside a page the person is signed into.** Not for reading, not for clicking, not for
convenience. The accessibility tree comes from the browser; the input comes from the browser; the
page's own scripts run and ours do not.

### 3. Irreversibility is decided by the browser, never by a model

**Primary mechanism — browser-attested, at the network.** The agent's tab runs with
`Fetch.requestPaused`. An action is irreversible when the browser is about to send:

- a request whose method is not `GET`; or
- a request to an origin outside the contract's approved sources.

Both facts come from Chrome describing a request it is holding, not from a page describing itself.
A page can put the word *Cancel* on a button that posts an order; it cannot make Chrome report a
`POST` as a `GET`. **The method is attested, so it cannot be forged by page text** — which is the
same distinction `ObservationEvent.attested` already draws, applied one layer down.

**Secondary mechanism — a code-owned lexicon, escalation-only.** A small English word list, owned by
this repository and never by a page, is matched against the element's accessible name: *send,
submit, buy, order, pay, delete, remove, publish, confirm, book, cancel subscription*. The
accessible name is page-authored, so it is treated the way `CONTEXT.md` treats every other
page-authored value: it may **escalate** `ordinary` to `requires-confirmation` and it may **never**
do the reverse. Absent, empty or malformed evidence returns `requires-confirmation`.

**The precedence objection, pre-empted.** `CONTEXT.md` refuses a denylist beside an allowlist because
two mechanisms create a precedence question with no principled answer. There is no precedence
question here, because **neither mechanism can permit anything.** Both are one-way ratchets in the
same direction: each can only turn an action into one that needs a human, and nothing in either can
turn an action that needs a human into one that does not. Two mechanisms with the same monotone
direction compose by `or`, and `or` has no precedence to argue about.

### The honest limits

- **A `GET` can be irreversible.** `/unsubscribe?token=…` is a `GET`. So is a one-click confirmation
  link, and so is half of the email-actionable web. The primary mechanism does not see these at all.
- **The lexicon is English-only.** *Senden*, *送信*, *Enviar* are not in it and will not be. A person
  working in another language gets the network mechanism and nothing else.
- **`GET`-shaped destruction is uncovered.** Both statements above are the same hole from two sides,
  and it is the largest one in this ADR. It is not closable by a bigger word list; it is closable by
  never following a link the person did not name, which is a different and much more restrictive
  product.

### 4. `authorize()` stays pure, total and two-armed

The gate returns allowed or refused. It gains no third arm.

Confirmation arrives as a **fact on `RunContext`** — the same way time arrives — recording that a
human confirmed this specific `ConfirmationRequest`. Its absence is an **ordinary refusal** with rule
`confirmation_required`. Nothing about the gate's shape changes: still pure, still total, still no
clock and no I/O and no model.

**Why not a third arm.** `ActionIntent.authorization` is a column on an append-only table that
`CONTEXT.md` declares closed at `allowed | refused`. A `pending` value would put a **non-terminal**
state into a row that can never be updated — so the row would be permanently wrong the moment the
person answered, and the only repair would be a second row meaning "the first one, but resolved",
which is an `UPDATE` with extra steps and exactly what append-only forbids. Every reader of the
ledger would then need to know that some refusals are real and some are waiting, and the ones that
are waiting look identical to the ones that were denied.

### 5. The refusal is a refusal, and the continuation is a new run

When the gate refuses for want of confirmation:

1. the refused `ActionIntent` is written, exactly like any other refusal, with its rule;
2. a `ConfirmationRequest` is written, naming what was about to happen, in **code-generated** prose
   built from attested facts — the method, the host, and the element's accessible name rendered as
   an attributed quotation, the way an inferred `constraint` claim is. The question is never
   model-composed: a model that could write the words on the button asking for its own permission is
   a model that can argue for itself;
3. the run halts;
4. when the person confirms, a **new `AgentRun`** starts, carrying the confirmation on its
   `RunContext`, proposes the action again, and is allowed.

**Nothing is rewritten. Nothing is replayed. No row changes.** That is not a workaround for
append-only, it is what append-only is for: the ledger's job is to say what was true at each moment,
and at that moment the truth was *it asked, and it was not yet allowed*. A design that reached back
and turned the refusal into an approval would be deleting the only evidence that a human was ever
consulted — on the exact action where that evidence matters most.

**Expiry never approves.** A `ConfirmationRequest` that times out produces **no**
`ConfirmationVerdict` row at all, so the gate sees the same absence it saw before anyone was asked,
and refuses. There is no code path from elapsed time to permission. This is stated as its own
paragraph because a confirmation that times out into *yes* is the failure mode the entire feature
exists to prevent, and it is the kind of thing that arrives later as a two-line "improvement" to
unblock a stuck run.

### 6. The plan stops authorizing and becomes reporting

An agent that observes and then decides cannot be bound by a list written before it looked. The
`ExecutionPlan` survives as **what the run says it intends**, rendered in the report and cited by
nothing. `PlanStep` no longer authorizes an action.

That breaks two things ADR-0004 leaned on. Both need real replacements, not reassurance.

**Blast radius.** ADR-0004 bounded it with `MAX_PLAN_STEPS = 12`, on the reasoning that one step is
one action and each drafting step targets a distinct section. With no authorizing plan, that bound
evaporates. Replaced by two module constants counted straight off the ledger:

> `MAX_ACTIONS_PER_RUN = 40` · `MAX_MUTATING_ACTIONS_PER_RUN = 8`

Two numbers rather than one, because reading forty accessibility trees is a slow run and making
forty changes out in the world is a different category of event. The second is the one that matters;
the first exists so a loop ends.

**The Progress dial.** `current-step-only` meant "finish the step in flight", which had a precise
meaning only while a step was a row. Redefined:

> **A step is the interval between two mutating actions.**

So `current-step-only` compiles to *make at most one change out there, then come back to me*, and
`remaining-plan` to *up to `MAX_MUTATING_ACTIONS_PER_RUN`*. Both are set-membership tests over a
counter the ledger already supports, which is what `CONTEXT.md` requires of a dial: name the
deterministic check or it is theatre.

**A model may not declare step boundaries.** The tempting shape — let the agent say "this is still
the same step" — is a **grant**: it would let a model widen what it is permitted to do by describing
its own work differently. ADR-0007's asymmetry is exact here. A model may always decline to proceed,
because declining withholds. It may never say *this still counts as one step*, because that permits.

The gate's plan-derived rules follow the plan out. `off_plan` has nothing left to be off of;
`step_out_of_scope` is re-derived from the mutating-action count; `plan_limit_exceeded` becomes the
two counters above. Final membership of the refusal-rule set stays owned by the gate ticket.

### 7. Three ways to stop it, and stopping never needs the app

| Kill switch | Who owns it | What it does |
|---|---|---|
| Chrome's own infobar **Cancel** | Chrome | ends the attachment. Cannot be suppressed, cannot be styled, and is not ours to break |
| An in-tab overlay chip | the extension | detaches on click, in the tab the person is looking at |
| Stop, in the app | Propositum | requests the same detach |

**Detach happens before any POST.** The extension detaches first and reports afterwards, so stopping
works with the app closed, the dev server restarting, or the machine offline. A stop that has to
reach a server before it takes effect is not a stop.

**This looks like a violation of ADR-0007 and is not, so here is why.** ADR-0007 requires that halts
land at the next action boundary, on the grounds that abandoning an action in flight leaves an
`ActionIntent` with no `ActionOutcome` — indistinguishable from a crash, and reported as `unknown`
when we know exactly what happened.

**Detaching is not a halt.** A halt is a decision the run makes and then acts on; detaching is the
*removal of the capability the run was using*, and it is meant to work precisely when the run cannot
be trusted to make decisions. Those are different mechanisms with different customers.

The property ADR-0007 protects is preserved by moving the writer. The abandoning worker does not
write the outcome — **the app does**, on the next return or on the startup sweep, marked
`observedBy: recovery` in the ADR-0003 sense: it may only record what it can prove and may never
infer. And the pause point helps here rather than hurting: an action stopped while its request was
held by `Fetch.requestPaused` is knowably un-sent, because the pause is before the browser sends.
An action stopped after dispatch is `unknown`, exactly as today.

**ADR-0007's own revisit condition has fired.** It said to revisit *"when a stop needs to be
recoverable rather than terminal"*. A confirmation pause is exactly that, and this is the ADR that
answers it: the stop stays terminal for the run, and the recovery is a new run rather than a
resumption. `Shift` is unchanged — one Shift, one contract — and what has changed is that a Shift
can now span a person's coffee break.

### 8. ADR-0001's claim is no longer true

ADR-0001 chose the worker process because it was *"the only option whose lifetime is decoupled from
both the browser and the Next.js server"*. That is now false: the agent acts through a browser
Propositum does not own, and if Chrome quits, the tab closes, or the person hits Cancel, the run
loses its hands mid-sentence.

The mitigation is not to pretend otherwise. **`control-lost` is a first-class terminal reason** with
a real report — *"You stopped me"* or *"I lost the browser"* — and it renders like `interrupted`
rather than like a failure: what it had done, what it had not, and the fact that its last action's
outcome may be `unknown`. ADR-0001's reasoning was right about the *ledger*, which is still ours and
still local; it was overstated about the *hands*, which never were.

## Retention: two ledgers, still disjoint

`CONTEXT.md` and `docs/SECURITY_AND_PRIVACY.md` publish a promise — *at most the first 2,000
characters of readable article text* — enforced by `EXCERPT_BUDGET_CHARS`. An accessibility tree is
ten to a hundred times that and arrives every turn. **Without the distinction below that published
sentence becomes false the day this ships, silently, in the document whose entire job is being
true.**

The distinction, written down so it cannot be lost:

> `EXCERPT_BUDGET_CHARS` governs what Propositum retains about a person's **own browsing**.
> `ActionEvidence` is what the agent saw **while acting under a ratified contract**.

They are two ledgers and they stay disjoint, which is a standing rule and not a new claim. Nothing in
`ActionEvidence` is ever read by inference, joined to an `ObservationEvent`, or rendered on a session
timeline. It is bounded by its own published constant, `SNAPSHOT_BUDGET_CHARS`, declared in
`docs/SECURITY_AND_PRIVACY.md` with the same framing as the first — a product constant, not a
tuning knob — and it is **swept**: the startup sweep that reaps expired leases deletes every
`ActionEvidence` row belonging to a settled `ShiftOutcome`, and every row past the retention window
regardless. `ActionEvidence` is therefore the one durable table that is deliberately **unguarded**
by ADR-0003's triggers, because a no-`DELETE` trigger and a sweep cannot both be true.

## Risks, recorded rather than buried

- **Re-clicking after approval may double-fire.** The paused request is **aborted**, not held across
  an evening, so the continuation run clicks again. If the page's own script already recorded
  something before the request went out, or the site retries by another path, the effect happens
  twice. Holding a request open for hours is not available, and idempotency keys are the site's
  business, not ours.
- **`GET`-shaped destruction is uncovered.** Stated above and repeated here because it is the hole
  most likely to be discovered by someone else first.
- **The injection surface grows by roughly two orders of magnitude.** A page excerpt was 2,000
  characters read once; an accessibility tree is the whole interactive surface, read every turn, and
  every accessible name in it is attacker-controlled on a hostile page. ADR-0006 already says
  datamarking is **depth, not a boundary**, and depth scaled a hundredfold is still depth.
- **A hostile page can force a confirmation storm, and habituation is a real attack.** Make every
  control post, and every action needs a human; the twentieth dialog gets clicked without reading.
  There is no third option: failing open on repetition would mean an attacker can *turn confirmation
  off by asking for it enough times*, which is worse than a tired person. So the storm is tolerated
  and the run's mutating-action cap is what actually bounds it.
- **Background-tab input fidelity is unverified.** Whether synthesised input behaves identically in
  a background tab is not established for this exact path. If a foregrounded tab turns out to be
  required, the agent steals focus while the person is working — the interruption sin this codebase
  already names, arriving through the back door.
- **MV3 service-worker lifetime under an awaited long-poll is undocumented for this case.** The
  30-second death is designed for; a socket held open across an agent turn is not the shape the
  documentation covers, and the failure will look like an agent that stops mid-run for no reason.
- **`SessionPhase` has no honest value for a confirmation pause.** The person is at their desk being
  asked a question, under a screen headed *"While you were away"*. `CONTEXT.md` refused a `paused`
  phase with a good argument, made before a run could ask and wait. Keeping `away` is the smaller
  lie. **It is still a lie**, and it is recorded here rather than smoothed over.
- **CAPTCHAs and bot detection now risk the person's own account**, not a throwaway Playwright
  context. A site that decides the traffic is automated can rate-limit, challenge, or suspend
  something the person actually depends on. Propositum does not solve CAPTCHAs and must not learn to.

## A divergence between ADR-0002 and the shipped extension

ADR-0002's decision table specifies *"WebSocket from the service worker to `127.0.0.1`"*. The
shipped extension uses **HTTP `fetch` plus a `chrome.alarms` heartbeat at 30 seconds**
(`HEARTBEAT_MINUTES = 0.5`), and the four transport controls ADR-0002 requires — JSON content type,
custom header, `Origin` pinned to the extension id, bearer token — are enforced on that HTTP path.

**The code is authoritative.** HTTP plus an alarm is the better fit for a service worker that dies
every 30 seconds, and the security argument was never about the transport being a socket — it was
about the four controls, which hold. ADR-0002's table is corrected in place;
`docs/SECURITY_AND_PRIVACY.md` said "WebSocket" too and is corrected with it.

## Revisit when

- **A confirmation is clicked through and something lands that should not have.** That is the
  predicted failure and it should be treated as evidence about the pause, not about the person.
- **`GET`-shaped destruction bites.** The fix is not a longer word list; it is a narrower product.
- **Background-tab fidelity is measured.** If focus theft is required, the interruption argument
  reopens and may outweigh the feature.
- **Anyone proposes `Runtime.evaluate` "just for reading".** That is not an optimisation, it is this
  ADR's central property being spent, and it needs its own ADR to spend it.
- **A second browser matters.** Nothing here is Chrome-specific by preference; it is Chrome-specific
  because that is where both the permission model and the debugger protocol we rely on exist.
