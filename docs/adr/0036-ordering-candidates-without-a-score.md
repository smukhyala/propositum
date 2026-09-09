# ADR-0036 — Ordering candidates across kinds, without inventing a score

**Status:** accepted · 2026-09-07
**Pays:** [ADR-0018](0018-the-everyday-shapes.md)'s named debt — *"Ranking the strands this
admits… **This ADR makes that number bigger and does not fix it**"* — and fires its own
*Revisit when* trigger, *"`strandsSuppressed` climbs"*
**Corrects:** the same ADR's wording, in one clause: *"`MAX_THREADS_SHOWN` still cuts them **without
ordering**"* was not accurate when it was written. See *The ordering that already exists* below
**Depends on:** [ADR-0035](0035-what-a-person-said-they-are-waiting-on.md) — which supplies the
second kind of candidate, without which there is nothing to order across
**Amends:** [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) layer 4, *Progress Reasoner*

## The cost, first

**A new kind of candidate reaches the front door and the loudness metric cannot see it.**
`offersShown` is incremented in two places and both are keyed to a strand signature; a wait has none.
So after this ADR Propositum shows a class of thing that the one number measuring how often it speaks
does not count — which is the failure [ADR-0021](0021-a-thread-on-the-persons-phone.md) §6 named
about the phone channel and answered by putting it in the denominator: *"if it did not count, the one
metric that would notice this channel getting louder would be measuring the quieter surface and
reporting it as the whole."* `strandsSuppressed` has the matching hole — a wait cut by the bound is
neither shown-and-counted nor suppressed-and-counted, so it is found and discarded in silence, which
is the exact thing ADR-0008 says the multi-strand change existed to end.

~~**The build owes both counters**~~ **Paid, 2026-09-07, in the change that wired the screen.** A
wait shown increments `offersShown`, keyed on the intention id — the same shape as a signature: an
opaque handle marked in the buffer that dies with the process, with nothing about the subject
crossing into `offer_tally`, which is four integers and a date. **`strandsSuppressed` deliberately
does NOT count a cut wait**: that number means *strands found, good enough, and cut for room*, and a
number meaning two things is worse than a missing one. What a cut wait costs is recorded here
instead: it is not counted anywhere, and the honest reason is that nobody has argued what the right
counter would be.

## The ordering that already exists, which one prior ADR mis-stated

`src/domain/detection/topics.ts` ends its clustering with a comparator and a comment:

```ts
// A thread the person searched for outranks one they merely passed through,
// then breadth, then time.
threads.sort(
  (a, b) =>
    b.searches - a.searches || b.pages.length - a.pages.length || b.engagedMs - a.engagedMs,
)
```

`src/server/front-door.ts` walks that order, drops origin-snoozed, thread-snoozed and
reticence-held-back strands, and **then** cuts at `MAX_THREADS_SHOWN`. So the cut is applied to an
ordered, filtered list, and the badge naming *the strongest strand* means *first under this
comparator*.

[ADR-0018](0018-the-everyday-shapes.md) said *"`MAX_THREADS_SHOWN` still cuts them without
ordering."* That clause was wrong on the day it was written. It is corrected here rather than in
that file, because the sentence around it — that a strand found and discarded in silence is a real
cost — is right, and this ADR is the one that pays it. **The debt was never the absence of an
ordering. It was the absence of an ordering that could see more than one kind of thing.**

## Context

[ADR-0035](0035-what-a-person-said-they-are-waiting-on.md) produces a candidate that is not a
strand: an Intention whose stated wait an `ExternalEvent` has discharged. A comparator whose three
keys are `searches`, `pages` and `engagedMs` has nothing to say about it — a discharged wait has no
pages and no dwell, and would sort last on a tie of zeroes.

**Narrowed by the build, 2026-09-07, and recorded rather than diverged from quietly.** This sentence
said *"and one whose stated wait is still open"*. An **open** wait is not a candidate and does not
reach the front door. Two reasons, and the second changed the design rather than tidying it:
[Principle 13](../PRODUCT_PRINCIPLES.md) forbids *"a notification with no decision attached to it"*,
and *you are still waiting* is not a decision; and an open wait has no way to leave the list — a
strand leaves three ways, a wait has none — so it would hold one of `MAX_THREADS_SHOWN`'s slots
indefinitely, which is the hole [ADR-0035](0035-what-a-person-said-they-are-waiting-on.md)'s cost
section calls its sharpest. Keeping open waits off the list closes that by construction rather than
by a fourth suppression mechanism nobody has argued for. An open wait is a word on the project
screen, where the person who wrote it can change it or take it back — which is where it can be acted
on. `tests/candidate-order.test.ts` holds the union to two members.

That is layer 4's *what would have to exist first*, arriving:
[`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) marks *Progress Reasoner* **partial — offer grounds, no
ranking**, and names the prerequisite as *"more than one candidate."*

## Decision

**One pure, total, clockless comparator over a closed union of candidate kinds, ordering by named
deterministic facts in a fixed precedence — the shape `topics.ts` already uses, widened to see more
than one kind.**

- **Lexicographic over named facts, never a weighted score.** The direction document proposes
  `expected usefulness × confidence × urgency × goal alignment × contextual relevance × user
  preference fit − interruption cost − execution cost − risk`. Nine of those terms do not exist as
  data in this repository, and the arithmetic would have to invent them. `CONTEXT.md`'s
  `OfferGrounds` entry already retired the vocabulary a float would need — *Displaces:* **score ·
  threshold · readiness · DetectionConfidence** — with the reason attached: *"these are counts of
  deterministic facts, not a score."* A weight is a number nobody could defend, tuned by whoever
  last looked at the output.
- **Every ordering renders as a sentence.** The precedence is the explanation. *"First, because you
  said you were waiting on this and it arrived"* is a fact a person can check and contradict;
  *"first, because it scored 0.83"* is not. This is [Principle 11](../PRODUCT_PRINCIPLES.md) applied
  to sort order, and it is why the comparator is data rather than arithmetic.
- **Pure, total and clockless.** `now` arrives as a parameter. `src/domain/**` may never read the
  clock and `tests/architecture.test.ts` enforces it by grepping source text, comments included —
  which is also what lets a replayed week and a lived one produce the same order.
- **It orders; it does not qualify.** Nothing here lowers `INTENT_REQUIRED` or
  `INVESTMENT_REQUIRED`, and a candidate that did not clear its own bar is not in the list to be
  sorted. Ordering is about which of the things that already qualified goes first.
- **`MAX_THREADS_SHOWN` still cuts, and what it cuts is still counted.** The bound stays where
  [ADR-0008](0008-ambient-detection.md) put it. What changes is that the thing cut is now the least
  useful of a wider field rather than the last of a narrower one.

## What is deliberately not built

- **No learned weights, and nothing reads acceptance history.**
  [Principle 15](../PRODUCT_PRINCIPLES.md) permits history to narrow and never to widen, and
  [ADR-0020](0020-remembering-a-decline.md) already spends the narrowing half. A ranker that learned
  from accepts would be the forbidden direction with a sort order in front of it.
- **No cost, risk or effort term.** The direction document asks for all three. None exists as data
  before a contract is ratified, and a model estimating them would be a model contributing to a
  decision.
- **No cross-kind similarity.** Two candidates about the same subject are two candidates.
  Deduplicating them needs a notion of sameness that is a model reading both, which
  [ADR-0020](0020-remembering-a-decline.md) §5 already declined to half-take.

## Rejected alternatives

**The weighted score the direction document specifies.** Stated at full strength: it is the standard
shape, it degrades gracefully as terms are added, and it is what a learned ranker would eventually
replace term by term. Refused on the vocabulary above and on one thing that is worse than
vocabulary — a float is unfalsifiable on a single case. A person who disagrees with a lexicographic
order can point at the key that decided it. A person who disagrees with 0.83 can only disagree.

**Leaving the strand comparator alone and appending waits at the end.** The smallest possible change
and genuinely tempting, because a discharged wait is rare and would usually be right at the top
anyway. Refused because *usually* is doing the work: a fixed position is an ordering with its
argument hidden, and the first time a stale wait outranks live work nobody would be able to say
which rule produced it.

**A per-kind quota — one wait, two strands.** Refused for the same reason `MAX_THREADS_SHOWN` cuts
after filtering rather than before: a quota reserves a slot for a thing that may not deserve one, and
the failure is invisible because what it displaced was never shown.

## What this costs

- **A precedence is a claim, and this one is a guess.** The keys are ordered on an argument, not on
  evidence — nothing has measured whether a discharged wait is more useful to a person than an
  afternoon of comparison. It is the same class of guess as `INTENT_REQUIRED = 1`, which
  [ADR-0008](0008-ambient-detection.md) admits was *"set before any real browsing existed"*, and it
  gets the same treatment: written down as a guess rather than presented as a finding.
- **More candidates reach the cut.** `strandsSuppressed` counts what `MAX_THREADS_SHOWN` discards,
  and adding a kind can only make that number bigger — the same cost ADR-0018 recorded, now on a
  wider field. What is different is that the thing discarded is now the last of an ordered list
  rather than an arbitrary member of one.
- **The comparator becomes a place people will want to add terms.** Every future signal will have a
  natural home here, and each addition is cheap on its own. The guard is that a term must be a fact
  a sentence can name.

## What holds the line now

| | |
|---|---|
| `tests/candidate-order.test.ts` | Property: the order is a total order — antisymmetric, transitive, and stable on ties. A comparator that is not is a screen that changes when nothing did |
| `tests/candidate-order.test.ts` | Every precedence key renders a sentence, and the sentence names the key that decided it |
| `tests/architecture.test.ts` | The comparator reads no clock and touches no database |
| `tests/grounds.test.ts` | Unchanged, and that is the assertion: an ordinary afternoon of reading still does not qualify. Ordering must not become a way to admit something |
| `tests/front-door.test.ts` | The cut still happens after the filters, and `strandsSuppressed` still counts what it removed |

## Revisit when

- **Anybody proposes a numeric score.** It needs this ADR reopened and `CONTEXT.md`'s *Displaces:*
  line for `OfferGrounds` argued against, not worked around.
- **A precedence key is added.** Cheap individually, which is the risk; it is a diff to the property
  test and to the sentence table.
- **The order is visibly wrong to the person it is for.** That is evidence the guessed precedence is
  wrong, and it is better evidence than anything available today.
- **Anything wants to order by acceptance history.** Principle 15, in the direction it forbids.
