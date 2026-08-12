# ADR-0009 — Composed offers, and the outcome that is not a document

**Status:** accepted · 2026-08-11
**Amends:** [ADR-0003](0003-artifact-versioning-ledger.md) (the guarded tables, the table count, the
provenance walk) · [ADR-0006](0006-trust-boundary.md) (what the trust boundary now has to hold) ·
[ADR-0008](0008-ambient-detection.md) (what an offer contains, and what accepting one does)
**Overrides:** the founding brief's exclusion of *automatic project recognition* — a second time,
and further than ADR-0008 went

## Context

ADR-0008 shipped an offer with two things in it:

```ts
export const OFFERABLE = ['draft-document', 'deep-research'] as const
```

A closed list of two use cases, written into `src/model/boundaries/subject.ts` before anyone had
watched the product be used, in a system whose stated ambition is to have no predetermined use
cases at all.

The list was right for what it was for. Naming the thread needed one model call, and letting that
same call compose an open-ended proposal would have been two decisions in one commit. But the seam
shows on the second real thread. Someone comparing three shipping carriers is not well served by
*draft-document* or *deep-research*; the honest offer — *"shall I collect their published rates into
one table and say which is cheapest under 5kg?"* — is not expressible in the enum, and never will
be. Each new kind of real work costs a member, and a list that grows on contact with use was not
closed, only unfinished.

ADR-0008's other half held up, and this ADR does not touch it. Restated verbatim, because everything
below is easier to misread than to read:

> **What detection produces | A suggestion. Never a session, never an action.**

What widens here is what an offer may **say**. Not what it may **do**.

## Decision

**A model composes the offer. Deterministic code decides whether there is enough evidence to make
one at all, which sources it will run against, and what the run produced.**

| | |
|---|---|
| **What replaces `OFFERABLE`** | A `WorkOffer` — title, rationale, an ordered `OfferOutline`, what it produces, what it will not do, and the `ShiftOutcomeKind`s it expects |
| **What the offer may name** | the subject, in the words a person would use |
| **What the offer may not name** | a site, a host, an origin, a URL, a source id, or an `ActionKind`. Not "must not" — **there is no field for any of them** |
| **When it may be composed** | only once `OfferGrounds` are sufficient. Arithmetic over the ambient buffer, no model |
| **What accepting does** | approves the sources, starts the session, folds the buffer in, **and drafts a contract from the offer** — one click, all four the person's |
| **What a run produces** | a `ShiftOutcome`. Five kinds, closed. A `Changeset` is one of them |

### 1. Why an open offer is still safe under ADR-0006

ADR-0006's guarantee is *an injection can change what the worker attempts, it can never change what
the worker may touch*. A model-composed objective is squarely inside the first clause and must stay
outside the second. Five structural properties keep it there. None of them is a rule someone
remembers to follow.

**1. The offer names no site.** `ContractScope.approvedSourceIds` is derived by deterministic code
from the origins the thread actually ran through, read off the ambient buffer. The offer schema has
**no field that could carry a URL, a host, an origin or a source id**, and
`tests/architecture.test.ts` greps it for `url`, `href`, `origin`, `host`, `domain`, `link` and
`source` — the same shape of test ADR-0008 already relies on for the ambient endpoint. A model that
wanted to add a site to the scope has nowhere to write it down.

**2. The offer names no `ActionKind`.** `CONTEXT.md` §3 says *a model may **not** propose
`allowedActionKinds` at all*, on the grounds that no session-level grant exists for a subset check
to compare against, and a vacuous check is worse than none. That sentence survives this ADR
untouched. `WorkOffer.expects` holds `ShiftOutcomeKind`s — a statement about the *shape of the
result*, which grants nothing, and which deterministic code uses only to pick the contract template.
The kinds themselves come from the template, from the Output control, and from the person.

**3. `compilePolicy` still cannot receive it.** `WorkOffer` is prose, so it is typed like prose:
`compilePolicy(scope, controls)` cannot take it, and passing it is a compile error rather than a
review note ([ADR-0004](0004-policy-gate.md)). This is the same wall `StatedIntent` stands behind,
and the offer stands behind it for the same reason.

**4. Ratification is unchanged.** No `AgentRun` starts from an unratified `HandoffContract`, nothing
in the dials switches that off, and there is still no auto-accept. An offer is a screen with a
button on it, and the button is the boundary.

**5. The accept path takes no origins from its caller.** The handler reads the buffer server-side,
keyed by the thread signature it was given, and computes the sources from what is there. It does not
accept an origin list as an argument. So a forged accept can at worst re-accept a thread the person
really had; it cannot smuggle a site in through the request body, because the request body has no
place to put one.

### The exposure this does not close

Stated plainly, because it is genuinely worse than it was yesterday.

**The objective a person ratifies is now composed by a model that ran before any session existed,
from page titles alone.** That is one step further from the person than a `SessionReading`, which at
least reads events from a session they started deliberately, and it is two steps further than a
`StatedIntent` they typed.

ADR-0006's claim survives — an injection can change what the worker attempts, never what it may
touch — but **the blast radius starts earlier**. A hostile page title now has a path to the sentence
at the top of the offer screen, and that sentence is the one thing a person is most likely to read
and least likely to interrogate, because it arrived unasked-for and looks like a summary rather than
a proposal.

Three things hold, and they are the same three ADR-0006 already leaned on, which is not a
coincidence and is not reassuring either: titles are datamarked; the subject boundary reports rather
than resolves when the pages disagree (`confident: false`); and the human review is structurally
non-optional. A person who accepts an offer without reading it has removed the boundary, exactly as
a person who ratifies a contract without reading it has. The interface should make that hard, and
the offer screen must show the outline and the *will not do* list, not just the title.

### 2. A stronger bar for offering to act than for naming a subject

`detectWork` decides whether Propositum may *say something*. That bar is deliberately low: the cost
of a wrong subject line is a sentence nobody agrees with. Offering to *do work* is a different ask —
it proposes spending a person's attention on ratifying something, and then their sources, their
Chrome, and their time on running it.

So there is a second, higher bar, and it is arithmetic. **`OfferGrounds` splits into two groups.**

| Group | Ground | Fires when |
|---|---|---|
| **intent** | `searched-then-read` | a query, then at least two pages from what it returned |
| | `refined-the-search` | a second query sharing terms with the first |
| | `came-back` | a return to an origin already in the thread, after leaving it |
| **investment** | `read-deeply` | one page past the existing engagement threshold — dwell and scroll |
| | `stayed-with-it` | the thread's own span past a threshold |
| | `followed-across` | three or more distinct origins in one thread |

> **`sufficient = at least one intent ground AND at least two investment grounds.`**

No model runs on this. The thresholds are the constants already in
`src/domain/detection/detect.ts`, they are guesses set before any real browsing existed, and
ADR-0008 already says so.

**Why two groups rather than three-of-six.** Because the two axes fail differently, and a single
counter cannot say *one of these and two of those*.

*Intent separates pursuing from receiving.* A person who searched and then read chose the subject.
A person who read three pages of a site they arrived at from a newsletter did not choose anything.
Without an intent ground, absorption alone qualifies — a long feature article, a forum argument, a
recipe — and that is precisely the false positive ADR-0008 names as the expensive failure, because
it interrupts someone reading the news and teaches them the feature is noise.

*Investment separates "worth an offer" from "a lucky click".* One strong signal is cheap to produce
by accident. Depth on a page, span across the thread, and breadth across sites are three different
accidents, and needing two of them is not much to ask of real work.

Three-of-six admits both failures directly. It passes `read-deeply + stayed-with-it +
followed-across` with no intent at all — the newsletter afternoon. And it passes all three intent
grounds with no investment — someone who searched, refined, and returned inside ninety seconds
having read nothing, which is what a search that is going badly looks like. Both are ordinary
browsing, and an offer on either is a false one.

### 3. `ShiftOutcome` — the run produced something, and it was not necessarily a document

Slice 0's sentence was *the run produced a `Changeset`*. That was true when the only thing a run
could do was draft prose. It stops being true the moment a run can collect, answer, address, or act,
and the honest generalisation is a row that says what kind of thing this run produced.

**Five kinds, closed, code-owned. There is no `other`.**

| Kind | What it is | Reversibility |
|---|---|---|
| `document-changes` | a `Changeset` of `ProposedChange`s against an immutable `BaseVersion` | always `held` |
| `collection` | things found and kept — rates, sources, candidates, quotations — decidable one at a time | always `held` |
| `answer` | a written response to a question, citing the actions that support it | always `held` |
| `message-draft` | text addressed to somebody, written and **not** sent | always `held` |
| `external-effect` | something that happened out there: a form submitted, a reply sent, a booking made | `landed` |

`answer`, not `finding`: `ReviewFinding` owns that word, and two things called a finding whose
authorship differs is the collision `CONTEXT.md` spends a paragraph on.

**No `other`.** An `other` kind is a free-text field wearing an enum's clothes. Every consumer would
need a fallback branch, and the fallback branch is exactly where a landed effect gets rendered as a
reviewable proposal — which is the one rendering error in this design that lies to somebody.

**`Reversibility` is `held | landed`, and code assigns it.** Never a model, never a person, never
configuration. It is computed from the ledger: an outcome is `landed` when any completed
`ActionIntent` in its run carried a landing `ActionKind`. A model that could declare its own work
reversible would be granting, and grants are the one thing a model may never make.

**A `landed` outcome is offered no verdict at all.** Not a disabled button, not a greyed-out
control, not a confirmation dialog that explains why the button will not work. The interface reports
*"This already happened, outside Propositum"* and shows what happened, and the server refuses a
verdict deterministically — the write path checks `reversibility` before it checks anything else,
and a `landed` outcome has no `OutcomeProposal` rows for a verdict to reference in the first place.

Two mechanisms for one truth is usually a smell; here it is deliberate, because the failure being
prevented is an interface that drifts, over some future refactor, into offering a Reject button that
cannot reject. A person who clicks Reject on a sent message and is told *"rejected"* has been lied
to by the one screen the entire trust model rests on.

### 4. Projects are kept, and a person never creates one

The founding brief excluded *automatic project recognition*. ADR-0008 overrode that exclusion for
detection and said so in those words. **This ADR reverses it outright**, and the argument is
ADR-0008's own, one step along: a person who must first create a workspace has been asked to know in
advance that what they are about to do is worth recording, and that is the bet that already lost.

So a `Project` is:

- **auto-created** when an offer is accepted and no existing project matches;
- **auto-named** from the thread's terms;
- **matched** against existing projects by deterministic term overlap above a fixed threshold, so a
  subject picked up again on Thursday continues Tuesday's project rather than founding a duplicate;
- **renameable** afterwards, which is the correction channel and the only one.

`Project` still has **no free-text description and no objective**. `CONTEXT.md`'s original reason —
a description that inference reads is a project goal in disguise — matters more now than when it was
written, because the offer boundary already runs before any person has said anything at all.
Auto-naming writes `name`, and nothing else.

**The cost, stated.** Term overlap is arithmetic, not understanding. It will sometimes fold two
subjects into one project and sometimes split one subject across two, and the failure is
asymmetric — a wrong merge shows a person work under a heading they did not expect, a wrong split is
merely untidy. Renaming is the fix; merging two projects is not built and is not in this slice.

## Consequences

- **`OFFERABLE` and `offerableOf()` are deleted**, not deprecated. Nothing in the codebase should be
  able to reach a two-member list of use cases after this lands.
- **ADR-0003's guarded-table list grows** by `shift_outcome`, `outcome_proposal`, `outcome_verdict`.
  `ProposedChange` and `ChangeVerdict` stay exactly as they are: for `document-changes` the
  decidable unit is a `ProposedChange`, which carries a `BaseSpan` an `OutcomeProposal` has no field
  for. Two verdict tables of the same shape against two different addressable units is a real cost,
  it is written down here rather than discovered, and unifying them later is a migration.
- **The provenance walk gains one hop.** `ProposedChange → Changeset → ShiftOutcome → AgentRun →
  HandoffContract`. Every hop is still a foreign key, and no step is model-authored.
- **ADR-0008's decision table gains four words** on one row — *and drafts a contract from the offer*.
  Its detection row is unchanged, which is why this ADR quotes it rather than paraphrasing it.
- **A run that produces nothing still produces no row.** `CONTEXT.md`'s rule that an empty
  `Changeset` is no row generalises: a run with no completed work writes no `ShiftOutcome`, and the
  shift report says so in words.

## Divergences between the documents and the code, found while writing this

These are prose problems, so they belong to this ADR rather than to a ticket. Each says which side
is authoritative, because "they disagree" is not a resolution.

| Divergence | Authoritative | What happens |
|---|---|---|
| `AgentRun.claimedBy` and `AgentRun.cancelRequested` are described in `CONTEXT.md` and **absent from `prisma/schema.prisma`**. The fence `CONTEXT.md` describes — *"every action boundary re-reads `status` and `claimedBy`"* — has therefore never existed | **`CONTEXT.md`** | The columns are owed. Until they exist the fence is prose, and the claim in `CONTEXT.md` should be read as a specification rather than a description |
| `ActionOutcome.observedBy` is specified with two values and has **no writer** | **`CONTEXT.md`** | Owed with the recovery sweep that is its only writer. A column no code writes is not a guarantee |
| `AgentRun.status` reads `queued · running · completed · halted · interrupted · failed` in `CONTEXT.md` and `pending · claimed · running · succeeded · failed · interrupted` in the schema | **`CONTEXT.md`** | The vocabulary is the point of the vocabulary. `halted` in particular is load-bearing for [ADR-0007](0007-stop-conditions.md) and has no schema equivalent at all |
| `ActionOutcome.disposition: completed \| failed` in `CONTEXT.md` is `result: succeeded \| failed` in the schema | **`CONTEXT.md`** | Renaming a column is cheap; two words for one concept is what the banned-words table exists to stop |
| `Evidence` is a *value object on a `SessionClaim`* in `CONTEXT.md` and a table in the schema | **the schema** | It has its own id and its own rows; calling it a value object was wrong. `CONTEXT.md` is corrected, and ADR-0003's "20 tables" was already 21 before this work |

## Revisit when

- **A composed offer is confidently wrong in a way a person acts on.** The `confident` flag exists
  for the vague case and does nothing for the plausible-and-wrong case, which is the one that costs
  something.
- **The two-group bar is observed failing in either direction.** Too many offers means the grounds
  are cheap; none at all on real work means the thresholds inherited from detection are wrong for a
  bar that gates doing rather than saying.
- **A sixth `ShiftOutcomeKind` is proposed.** That should feel heavy. If it is reached for twice,
  the kinds are wrong rather than incomplete.
- **Project matching is observed merging two subjects a person considers separate.** That is when
  overlap-on-terms has run out, and it is a real modelling question rather than a threshold tweak.
