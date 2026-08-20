# Vision

Where Propositum is going, and — kept strictly separate — what it actually does today.

Everything under **Now** is built or being built in slice 0. Everything under **Later** is
direction, not commitment. Nothing in this document should be read as a claim about shipped
capability; [`MVP.md`](./MVP.md) is the authority on that.

**The destination, stated once so every section below can be read against it.** Propositum is the
*intention layer for everyday AI*: it holds a live model of what a person is trying to accomplish,
understands how their work and the world change that model, works out when useful progress is
possible, and puts the right worker — human or model — on it inside explicit permissions.

**None of that sentence is shipped.** What this change leaves behind is one sensor, one worker, one
reviewer — all three of which existed before it — plus one flat `Intention` table and a lifecycle
word computed from rows that already existed. ~~**The table is the one thing this stage is still
adding**: [ADR-0011](./adr/0011-intention-above-worksession.md) decided it,
[`MVP.md`](./MVP.md) records it as *not yet built at the time of writing*, and
[`ARCHITECTURE.md`](./ARCHITECTURE.md) says how to check whether it is a table yet or still a
decision.~~ **Struck 2026-08-20. The table landed on 2026-08-16 and this paragraph did not follow
it**, so for four days the document's own orientation sentence described a state it had left — in
the file whose stated purpose is keeping *Now* and *Later* apart. It is struck rather than deleted
because the drift is the point: this is the third time a `not yet` outlived the thing it qualified,
~~and the other two are struck in place below for the same reason.~~ **Struck 2026-08-20, later the
same day, by an audit that read this paragraph against the file it claimed to have finished
correcting.** One `not yet` was struck below, not two, and four were left standing — twice under
*Persistent work sessions*, once in the list of what persists, and once in the narrowed note under
*Human and AI shift changes*, which also still called the re-entry gap *the full width* one section
below the paragraph describing what `WorkSoFar` had narrowed it to. All four are struck below now.
**A correction that miscounts the thing it is correcting is the same failure one layer up**, and it
is kept rather than tidied away for the same reason the claim beneath it is kept: a document that
deletes its wrong sentences can only be trusted, never checked.
[`ARCHITECTURE.md`](./ARCHITECTURE.md) §1 still carries the one-command check, which is now the only
version of this claim that can go stale visibly. The gap between those two paragraphs is the subject
of every **Later** below, and it is the width of the product. Keeping a reader able to tell the two
apart is the most valuable property this document has.

**Slice 1 is in flight as of 2026-08-20** — [ADR-0016](./adr/0016-everyday-computing-direction.md)
records the direction it comes from and, at greater length, the four things that direction asks for
which are **not** being built: leaving Chrome, taking two free Chrome permissions before H1 has a
number, learning an intervention threshold, and letting inference write an `Intention`.

---

## The problem

Knowledge work does not end at a stopping point. It ends at an interruption.

You leave mid-thought, with a half-drafted section, six tabs whose relevance only you understand,
and a decision you were circling but had not made. When you come back — an hour later, a day later —
the expensive part is not resuming the typing. It is **rebuilding the intention**: what you were
going for, what you had already ruled out, why that tab was open.

AI tools do not help with this, because they start from a prompt. To get useful work from one, you
first reconstruct the context yourself and then explain it. That reconstruction is the part that
was hard. Being asked to do it *and then type it out* is worse than being left alone.

Propositum starts somewhere else: from a `WorkSession` it already watched.

**And watching a sitting is not enough**, because the sitting is not the thing that was lost. What
the interruption destroyed was the *intention* — and until 2026-08-16 nothing in this system held
one for longer than an afternoon.

---

## Persistent work sessions

~~**Now.** The `WorkSession` is the durable object.~~ **Amended 2026-08-16
([ADR-0011](./adr/0011-intention-above-worksession.md)): the `Intention` is the durable object and
the `WorkSession` is one sitting beneath it — specified by ADR-0011 and ~~not yet in the schema~~.**
**Re-marked 2026-08-20: `model Intention` has been in `prisma/schema.prisma` since 2026-08-16, and
this sentence is the first of the four the top-of-file correction said were already struck.**
Nothing about the session's own durability changed — it still survives handoffs, idle, lid close,
sleep, a dead service worker, and revoked permissions, and only a human act ends it. What changed is
what sits above it.

~~**Now, and the one thing this stage is still adding.**~~ **Now, and added — re-marked 2026-08-20.
This was the most load-bearing *Now* claim in the file and it described a schema the repository had
left four days earlier.** An `Intention` is a row a person ratified — specified by ADR-0011 and
~~not yet in the schema~~ **`model Intention` in `prisma/schema.prisma` since 2026-08-16, written by
`repos.intentions.create` in `startFromSuggestion` and only when `acceptWorkOffer` hands it words a
person just accepted**: a desired outcome, a definition of success, and a
lifecycle word computed from rows that already existed. It is **human-ratified only** — created and
edited by a person, and by nothing else. No detector writes one. No model boundary writes one. What
Propositum *infers* about a sitting stays exactly where it was:
`SessionClaim{kind:'objective'}` is still per-sitting, still model-inferred, still evidence-bearing,
and still cold every time you sit down.

That split is the whole answer to the objection [`CONTEXT.md`](../CONTEXT.md) raised against this
move and was right to raise. The risk was never persistence — it was **quiet** persistence: a stale
objective inherited by the next sitting with nothing on screen to say it had been. Here nothing is
inherited by inference, because inference cannot reach the row.

**Honest limit.** At most one `Intention` per `Project`, and no graph — no subgoals, no
dependencies, no links between intentions, and no scheduling across them. `IntentionState` is a
computed view with five members — `working`, `delegated`, `needs-you`, `sleeping`, `done` — and is
never stored, because two stores for one truth is how a UI comes to show something the gate cannot
enforce. There is no `waiting` member: nothing in this system can produce the external event you
would be waiting on, so a sixth state would be an enum member nothing could reach.

**And a naming collision, accepted rather than fixed.** The runtime is saturated with `intent` —
`ActionIntent`, `intentId`, `recordIntent`, `PlanStep.intent` — and none of them mean this.
Every one of them stays. `intentId` is the browser channel's idempotency key and the append-only
ledger's hottest path; renaming it for a vocabulary win is a large risky diff, and ADR-0011 records
the refusal rather than leaving the next reader to re-derive it.

Agents are not durable. A worker `AgentRun` is ephemeral and has no identity, no name, and no
personality. It exists for one `Shift` and is gone. ~~What persists is the session, the
`HandoffContract`, the `Document`, and the ledger.~~ **Amended 2026-08-16
([ADR-0011](./adr/0011-intention-above-worksession.md)): the `Intention` joins that list, above the
session rather than beside it. ~~Specified, not yet a table~~** — the other four persist today.
**Re-marked 2026-08-20: all five persist today.** The `Intention` became a table on 2026-08-16 and
this line kept describing it as a specification, which is the drift the top of this file is about.

This is the inversion the product rests on. Most AI products make the assistant the persistent
thing and the conversation disposable. Propositum makes the *work* persistent and the assistant
disposable.

**That paragraph is the control-plane thesis, and it was written here before anything asked for
it.** *Propositum sits above models and agents; better foundation models should improve Propositum
rather than replace it* is the same claim in other words. The `Intention` does not introduce the
argument. It gives the argument a row.

---

## Intention-preserving continuation

**Now.** Propositum builds a `SessionReading` — inferred objective, what is done, what is open,
what remains uncertain, what is likely next — with `Evidence` linking every claim back to the
`ObservationEvent`s that support it. You correct it. It becomes a `HandoffContract` you ratify.

The provenance is not a nicety. An inference you cannot audit is an inference you cannot correct,
and correction is the entire mechanism by which the contract becomes trustworthy enough to act on.

**Later.** ~~Reading intention across sessions and across projects.~~ **Amended 2026-08-16
([ADR-0011](./adr/0011-intention-above-worksession.md)): an intention is specified to *persist*
across sessions; *reading* one across sessions still does not happen.** The `Intention` carries
forward because a person ratified it and can see it — ~~once the table exists, which it does not
yet~~ **and the table exists as of 2026-08-16**.
Propositum still infers each sitting from scratch, ~~still does not recognise that today's work
continues last week's without being told,~~ and still does not learn that you always want the
objection section drafted before the pricing section. **Persistence was the small half of this
section, and it is the half this change takes on. Nothing about the other half moved.**

*(Amended again 2026-08-20 — [ADR-0017](./adr/0017-continuing-an-intention.md). **One clause above
is struck and it is the narrower one.** `WorkSoFar` is a deterministic fold over every sitting under
one Intention — sources already approved, what previous Shifts produced, how each decidable unit was
decided, which questions are still open, where the last run stopped — rendered on the accept screen
**before** the click that starts the next sitting. So today's work is filed with last week's and a
person can see what is being carried, which is what the struck clause denied.

**What is emphatically not struck is the sentence before it.** Propositum still infers each sitting
from scratch: `SessionReading` is per-sitting, model-inferred and cold every time, and `WorkSoFar`
contains no inference at all — that is the property, not a shortcoming to be fixed later, because
the moment a model writes durable state about a person, ADR-0011's whole argument has to be made
again. The distinction this paragraph now rests on is between **filing** work under a continuing
Intention, which happens, and **reading** an intention across sittings, which does not. Anyone
reading "continuation works" out of this section has taken the first for the second.)*

---

## Human and AI shift changes

**Now.** Control transfers in one direction, once: you hand off, Propositum works, you come back.
One `Shift` per session. Re-entry ends at accept or reject.

One exception, added 2026-08-11: if the browser attests that the next action is irreversible,
Propositum stops and asks. That is still one `Shift` and one agreement — it asks for *more* consent,
not less — but it means a shift can now span your coffee break rather than ending while you are out.

**Later.** Genuine shift changes — *keep going*, *redirect*, several handoffs across one long piece
of work. Deliberately deferred, because continuation requires replanning against a `Document` that
moved between shifts, and shipping that unsolved produces a second shift that confidently
re-proposes work the first already did.

The metaphor is a colleague taking over your shift. Today the product delivers the first half of
that metaphor honestly and stops. That gap is real: **a second session currently starts cold**, and
someone will reasonably read that as a bug.

*(Narrowed 2026-08-16 — [ADR-0011](./adr/0011-intention-above-worksession.md). A second session's
**reading** still starts cold. What the person themselves wrote down — the desired outcome and the
definition of success on the `Intention` — is **to be** carried forward and shown on screen where
they can change it; ~~the row is specified and not yet in the schema, so today the gap is still the
full width. Once the table lands the gap is smaller.~~ **Re-marked 2026-08-20
([ADR-0017](./adr/0017-continuing-an-intention.md)): the table landed on 2026-08-16 and the gap is
already the smaller one.** On a second sitting `draftContract` pre-fills both sentences from the
`Intention` and the agreement screen prints the month they were written above them — *"In your own
words, from March 2026"* — in editable fields, so the carry-forward, the screen and the change are
all real rather than pending. It is not closed either way, and the part still
missing is deliberate: what
Propositum *thinks* you are doing is rebuilt from nothing every sitting.)*

---

## Adaptive autonomy

**Now.** Four dials, set per handoff, each compiling to something the gate deterministically
evaluates: Initiative, Progress, Output, Budget. A control that only changes prompt wording is not
shipped, on principle.

*(Amended 2026-08-18 — [ADR-0014](./adr/0014-reading-free-busy.md). **Budget may now come with an
offer beside it**, from a Google calendar you connected, when your calendar happens to say when you
are next busy. It compiles to exactly what it compiled to before — a deadline derived from
`acceptedAt + timeLimitMinutes` — and the calendar contributes no term to that derivation and reaches
neither `compilePolicy` nor the gate.

**Nothing arrives pre-filled, and that is the stronger claim.** The dial holds the number it would
have held if you had no calendar at all; beside it is one sentence — *"Your calendar has you busy
from 3:00 pm"* — and a button offering the largest limit that stops before then. Pressing it is the
same act as pressing one of the five radios, and until you press something the calendar has changed
nothing. That matters because **a pre-filled default is not neutral**: a suggested 90 becomes 90 for
most people most of the time, which is a UI affordance doing the work of a decision. An offer that
must be pressed cannot do that. The sentence stays on screen after you press it, so the number never
sheds where it came from. This is principle 15's shape, in the one place it can be checked cheaply:
**a calendar may recommend; it may never grant.**)*

**Later.** Autonomy that earns itself. Propositum notices which decisions you always approve and
proposes widening its own scope — with the widening itself requiring ratification. Preferences
accruing on the `Project`, never on the agent.

The hard part is not the mechanism. It is that autonomy which drifts upward without a person
noticing is exactly the failure mode the trust model exists to prevent. Any version of this needs
the widening to be a visible, revocable, human act.

**That last sentence is now a principle rather than an aspiration** — number 15 in
[`PRODUCT_PRINCIPLES.md`](./PRODUCT_PRINCIPLES.md), *learned trust may recommend; it may never
grant*, carrying [ADR-0007](./adr/0007-stop-conditions.md)'s asymmetry applied to history instead of
to models. It was promoted from here, not invented: this paragraph already stated it in stronger
form than anything asked for, and stating it before anything learns is the only time such a rule is
cheap. **Nothing learns yet.** No component reads acceptance history at all.

**Later, and named without being built.** `WorkingAgreement` is the reserved name for a durable
delegation policy that outlives a single handoff — *research freely, edit drafts, never send
externally, never spend money*. **The name is reserved; the object does not exist and is not being
built.** Standing agreements sit squarely inside what this change refuses to build, and reserving
the word costs nothing while spending it twice would cost a rename. No interface copy changes:
`HandoffContract` keeps *"Working agreement"* as its consumer label, which is where the phrase is
already spent, in seven places.

This section is [`ROADMAP.md`](./ROADMAP.md)'s **Stage 3 — Adaptive Delegation**, in this document's
own words and with its own scepticism already attached. It is not restated anywhere else here.

---

## Observation

**Now.** A Chrome MV3 extension. It watches every `https` site as **metadata only** — cleaned URL,
title, dwell, scroll — held in memory and discarded, so it can notice work you have not told it
about. Page text begins only inside a session you started, on a source you approved: titles, cleaned
URLs, text you deliberately selected, and at most 2,000 characters of readable article text per
source.

*(Corrected 2026-08-11. This section said the extension was scoped by `optional_host_permissions` and
**structurally incapable** of seeing anything else. [ADR-0008](./adr/0008-ambient-detection.md) traded
that guarantee from structural to behavioural and said plainly that behavioural is weaker; this
document had not caught up, which is exactly the drift the Now/Later split exists to prevent.)*

~~What Chrome still refuses to hand over is the existence of any **other tab** — no `tabs` permission,
and the acting agent never enumerates targets.~~ **Struck 2026-08-17
([`docs/research/intent-signals.md`](./research/intent-signals.md) §2.1). Chrome refuses no such
thing.** `chrome.tabs.query()` needs no permission, and under the `https://*/*` host grant ADR-0008
took it returns the URL and title of every open `https` tab. No line in the extension calls it, and
what keeps that true is [`tests/extension-permissions.test.ts`](../tests/extension-permissions.test.ts)
— our code declining, not the browser refusing. The same sentence is amended in
[`docs/SECURITY_AND_PRIVACY.md`](./SECURITY_AND_PRIVACY.md), which states the trade at length.
Rewind's exclusion controls were sincere, documented,
and leaked anyway, because exclusions built on a see-everything vehicle leak. That warning now
applies to us in the part that is behavioural — which, after this amendment, is more of it than this
document used to say — and it is quoted here against ourselves rather than against them.

*(Amended 2026-08-17 — [ADR-0013](./adr/0013-authored-labels-and-exit-type.md). The **Now** above
gains two items, and the second one changes what this section costs. **Exit type** — how a page was
left — joins the metadata list; it needs no permission, and Fox et al. rank it co-equal with dwell
as the best-evidenced signal this product did not have. **A tab group label** — the name you typed
on a group of tabs — is read for pages Propositum is already watching, and it costs a Chrome
permission with an install string of its own: *"View and manage your tab groups."* It grants the
label and not the group's contents; the ADR quotes Chrome's own sentence saying that answering
*which tabs are in this group* requires the `tabs` permission, which is still absent. The struck
paragraph above is unaffected — no tab is enumerated, and the guarantee that no tab is enumerated
is still behavioural rather than structural — and so is the **Later** split. ~~And `scroll` in the
metadata list above is a **specification rather than a description** — ADR-0008's capture row,
amended twice on 2026-08-17, records that the extension does not send one; that row is the
authority and this sentence is a pointer to it, not a second claim.~~

**Struck the same day, because it pointed at an authority this change had already overtaken.**
`scroll` is a description now: ADR-0013 landed the producer line in `flushAmbient`, which copies a
scroll fraction onto the wire whenever the value is already inside `[0, 1]`, so a real browser sends
one. ADR-0008's capture row said the opposite and has been amended to match — the sentence above
was written from the row rather than from the diff it was part of.)*

**Later.** Structured integrations with the tools people actually work in. Editors, note apps,
~~calendars~~ — each with the same posture: least privilege, enforced by the platform where possible.

*(Amended 2026-08-18 — [ADR-0014](./adr/0014-reading-free-busy.md). One calendar arrived early, and
it arrived as the narrowest possible version of itself, so the word is struck from **Later** rather
than left to imply the whole of it is still ahead. Propositum can tell that somebody left; it could
not tell **how long they would be gone**, which is the one thing Budget is denominated in. Google's
free/busy answers exactly that and nothing else: two timestamps per busy interval, no titles, no
attendees, no descriptions. The wider scope — the one carrying `focusTime` and `outOfOffice`, a
person declaring their own intent in a structured field, which the signal research rates the
strongest thing it found — was refused, because it comes bundled with the title of every appointment
on every calendar. **The posture in the sentence above held and the price was an account**, which the
honest limits below record as struck rather than softened. This is a **sensor in no sense that
matters**: nothing it returns becomes an observation, nothing is persisted, nothing reaches a model,
and it suggests a number a person then sets.)*

**Observation is one sensor, and today it is the only one.** *(Still true on 2026-08-18, and the
calendar read above does not change it: free/busy produces no event, is not persisted, and cannot
move an intention. It answers a question at a moment somebody is looking at a screen.)* An intention
ought to move when the world moves — a reply arrives, a build goes red, a deadline passes. None of that can reach this
system, and the reason is structural rather than unfinished: an `ObservationEvent` requires a
`sessionId` and there is a single ledger writer, so **nothing that happens outside a sitting can be
recorded at all.** That absence is why `IntentionState` ships with five members instead of six, and
it is the whole content of the repository's **Stage 2 — Event-Driven Understanding**
([`ROADMAP.md`](./ROADMAP.md)).

**Not planned, at any horizon.** Full-screen recording. Keystroke logging. Automatic access to
every application. These are not sequencing decisions.

*(Argued rather than amended, 2026-08-17
([ADR-0012](./adr/0012-screen-capture-refused.md)). A rolling screenshot cache of the person's own
screen, roughly an hour deep, was proposed and refused. **The bullet above is unchanged, word for
word** — what is new is the argument it had been carrying without: screen capture
is row 15 of 16 on the ranked signal list *(corrected 2026-08-17; this said "row 13 of 14", and so
did the ADR)* and costs the strictest permission gate macOS has; the
returns on additional behavioural signal flatten after two, and the two cost almost nothing; the
comparison that would settle it has never been published in either direction. The ADR also states
what would have to be true to revisit, and names its own strongest counter-argument — that
Propositum cannot see work which does not happen in Chrome, and for the people it is aimed at that
is a real fraction of the work.
**What was taken instead is [ADR-0013](./adr/0013-authored-labels-and-exit-type.md)**, accepted the
same day and amended into the **Now** above: exit type, and a label the person typed. The two ADRs
are one decision — 0012 says what was refused, 0013 says what was bought with the budget — and
0013's own honest limit is that neither signal closes the gap 0012 names. They make Chrome-shaped
detection sharper. They do not make it wider.)*

---

## Computer use

~~**Now.** None.~~ **Moved from Later to Now, 2026-08-11
([ADR-0010](./adr/0010-acting-in-the-browser.md)).** This is the line in this document that moved
furthest and fastest, and it moved by a reversal rather than by a plan.

**Now.** A computer-use agent acts in your real Chrome, in a tab Propositum opened, driven by the
extension over the debugger protocol. It perceives the page as an **accessibility tree** and asks for
a screenshot only when the tree is not enough. It observes, acts, and observes again, rather than
following a list written before it looked. `ActionKind` now enumerates **mechanisms** rather than
effects, so a click can press *Send* — and every action the browser attests as irreversible stops and
asks you first.

~~**Narrowed 2026-08-16.** The capability is decided and the channel is built; **no run yet constructs
one.** `tests/reachability.test.ts` pins `callersOf('createBrowserControl(')` to `[]` and pins
`LANDING_ACTION_KINDS` empty beside it, so nothing has driven a browser and no `external-effect`
outcome can occur. What is shipped is the decision and the transport, not a run.~~ The **Now** stays
where [ADR-0010](./adr/0010-acting-in-the-browser.md) put it — the capability was decided, and
writing *Later* back in would be a false claim in the modest direction. What moves is how much the
**Now** claims. [`README.md`](../README.md) and [`ARCHITECTURE.md`](./ARCHITECTURE.md) say the same
thing in the same words, and this file was the last of the three to catch up.

**Widened back 2026-08-20, and only the first half of the narrowing is struck.** A run constructs a
`BrowserControl`: a shift whose ratified agreement grants a kind needing a live page acts in the
person's own Chrome, and `confirmations.create` has a caller, so the gate now genuinely stops and
asks before anything the browser attests it cannot take back. Both pins moved out of *deferred, and
asserted as deferred*. **`LANDING_ACTION_KINDS` did not**, and the reason is better than the caution
it looks like: `classifyPausedRequest` in the extension fails every non-`GET` request
unconditionally, with no bypass for a confirmed action anywhere in that file, so a landing kind would
be a capability the transport refuses to carry — a claim, not a feature.

**And the honest cost is the one ADR-0010 named in its own opening, arriving on schedule.** Nothing
here is more reversible than it was; what changed is that the pause is now something a person will
actually meet, and *"a pause is strictly weaker than an absence"* stops being a sentence about a
hypothetical. The absence that made this section comfortable to read for nine days is gone.

**The stated preference order below is honoured, and this is the one line of this document the new
design satisfies rather than contradicts.** Structure first, pixels only as a fallback: the
accessibility tree is the browser's own semantic description of the page, and a screenshot is what
happens when that description fails. Propositum never runs its own JavaScript inside a page you are
signed into.

**Later.** Preference order stays: native APIs, then structured integrations, then browser DOM
tools, and only then visual computer use. Visual computer use is the last resort, not the goal —
it is the least inspectable and least reversible way to act, and both properties are load-bearing
here.

**The honest cost of moving this line.** Absence of capability was the strongest prohibition
available, and it has been spent. A confirmation pause is weaker than an absence: it can be
misconfigured and it can be clicked through. ADR-0010 opens by saying so, and this document is not
going to be the place that says it more comfortably.

---

## Multiple projects, and dynamic orchestration

**Later, both.** Several projects with their own sources, documents, and preferences; Propositum
choosing where the next hour is best spent.

Orchestration deserves particular scepticism. It is the most attractive thing to build early and
among the least useful: a generic agent framework built before one workflow works is the failure
mode the founding brief names most sharply. One worker and one reviewer, until there is evidence
that more helps.

This section is [`ROADMAP.md`](./ROADMAP.md)'s **Stage 4 — Multi-Intention Everyday AI**: several
persistent intentions, background scheduling, choosing where the next hour goes. It is stated here
and not restated there. **Today it has nothing to schedule.** At most one `Intention` hangs off a
`Project`, and one live session at a time is enforced in the app layer — so a home screen listing
several `working` intentions would look correct and be unable to start the second one.

---

## Safety and trust model

The part of the vision that is **most** built today, because it had to be.

### Now

**The contract is the boundary.** Every serious defender in this space converged on the same
architecture independently — Chrome's User Alignment Critic sees only metadata, Brave's checker is
firewalled from raw page content, CaMeL formalises it. The component that *decides* must not see
unfiltered untrusted content.

Propositum's `HandoffContract` is that boundary: a typed structure the worker acts on. It stops
being one the moment summarised page prose becomes something the worker follows — which is why
inferred constraints surface as **attributed quotations** beside the agreement and are structurally
barred from entering it. Anything you want honoured, you type yourself.

**Models never authorize.** `compilePolicy` cannot receive prose — a compile error, not a
convention.

**Everything is recorded, including refusals.** `ActionIntent` before, `ActionOutcome` after, both
append-only, enforced by database triggers reinstalled and verified at every startup.

**Everything is reversible by default.** The base is immutable for the whole review; review produces
decisions, never documents. *(Amended 2026-08-11.)* An **irreversible** capability may now exist, and
only as a landing `ActionKind` the browser attests: no dial pre-approves one, no elapsed time
approves one, the acknowledgement is per action and human, and what already landed is reported
rather than offered a verdict — because a Reject button that cannot reject is worse than the action
it pretends to undo.

### Honest limits, today

- A successful prompt injection can change **what the worker attempts**, never **what it can
  touch**. The `ContractScope` holds regardless.
- But injection reaches the `SessionReading` too — page text influences the inferred objective
  *before* you ever see the handoff screen. **Your review is the thing that catches it.** That makes
  the review load-bearing rather than a courtesy, and it is why nothing in the autonomy dials can
  switch it off.
- Spotlighting and datamarking are **depth, not a boundary.** OWASP 2026 cites adaptive attack
  success above 90% against twelve recent defences. They are deployed; they are not relied on.
- **That depth is now spread roughly a hundred times thinner.** An acting agent reads a whole
  accessibility tree every turn, and every label in it is written by the page. The boundary is
  unchanged; the surface behind it is not.
- ~~Everything is local. There is no cloud, no telemetry, and no account.~~ **Struck 2026-08-18
  ([ADR-0014](./adr/0014-reading-free-busy.md)), and left here rather than deleted so the promise is
  visible beside what replaced it.** There is still no cloud, no telemetry and no server of ours, and
  nothing about what you read or wrote leaves this machine except the prompts a boundary needs. **But
  there is now an account**, optionally: a Google calendar, connected by you, for one question —
  `calendar.freebusy`, *"View your availability in your calendars"*, which returns busy intervals as
  bare start and end times and cannot return a title, an attendee or a description. It is off unless
  you connect it, it is revocable from Google in one click, nothing it returns is stored, and it can
  only offer a time limit you then set yourself. **The withdrawal is still a withdrawal**, and
  ADR-0014 opens by saying so: a narrow scope makes the exposure small and does not make the promise
  less broken.
  That limit is a privacy property today and a limitation tomorrow — it is also why a run stops when
  your Mac sleeps, and it is the sentence the calendar read exists to answer the other half of.
- **An `Intention` is human-*ratified*, which is not the same as human-*written*.** It is born on
  the working-agreement screen, out of the `StatedIntent` fields a person ratifies there — and those
  fields arrive pre-filled, drafted by a model boundary from the sitting's `SessionReading`. The
  person edits words somebody else wrote. Ratification is a real check, but it is not an *extra*
  one: it is the same act the `HandoffContract` already rests on, now carrying a second row. Someone
  clicking accept on a plausible sentence has checked less than someone who typed it, and that
  sentence is designed to outlive the sitting that produced it. The row is durable, editable, and on
  screen, which is what bounds the damage. It is not evidence that a person meant every word in it.

### Later

Signed provenance on captured content. A reviewer that can actually block rather than only
annotate. Formal verification of the gate's coverage. Multi-user, which changes the threat model
entirely and is not a small extension of this one.

---

## What would make this real

Not features. Evidence.

The product turns on one belief, and it is not the one that sounds hardest:

> Given a correct understanding of unfinished work, there exists work that is valuable enough to be
> glad about, safe enough unsupervised, and not so mechanical you would rather have done it.

Understanding is the tractable half. If knowledge work is unfinished *precisely because* the rest
needs judgment, that window is empty and no amount of inference quality fills it.

H2 in [`MVP.md`](./MVP.md) is that question, asked at n=1, against fixtures deliberately built so
the answer can be no.

The intention layer does not change the question. It changes how often it can be asked: a durable
`Intention` means the same desired outcome can be tested across several sittings instead of being
re-elicited each time. **It does not make the answer more likely to be yes**, and a persistent row
holding an objective nobody wanted advanced is a more expensive version of the same no.
