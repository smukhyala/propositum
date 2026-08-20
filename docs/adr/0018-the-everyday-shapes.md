# ADR-0018 — The everyday shapes, and three signals that were collected and read by nothing

**Status:** accepted · 2026-08-20
**Fires:** the three deferrals in `tests/reachability.test.ts` — _"scroll lands on the ambient path
and no ground consults it"_, and its two siblings for exit type and arrival. Each names what would
consume it and asks the change that does to _"say in the commit which afternoons started
qualifying"_. This is that ADR
**Amends:** [ADR-0008](0008-ambient-detection.md) — the offer bar, which moves here for the first
time since it was set · [ADR-0013](0013-authored-labels-and-exit-type.md) — _"nothing reads exit type
at all"_, which stops being true
**Depends on:** [ADR-0016](0016-everyday-computing-direction.md), gap 1 — comparison shapes become
targets · [`docs/research/intent-suggestion-quality.md`](../research/intent-suggestion-quality.md)
§10.1, §10.2 (where each signal would go), §9.3, §10.3 (the revisit finding)

---

## The inversion this decision is

`src/domain/detection/grounds.ts` names the shapes this ADR is about, and it names them on the wrong
side of the ledger. From the block arguing `INVESTMENT_REQUIRED`, on what a narrowed `came-back`
would cost:

> It would refuse **the shopping and rent-portal shapes** `INVESTMENT_REQUIRED`'s block already
> **names as this design's residual false positives**.

Comparison shopping is currently a thing this detector tries not to fire on. The direction document
makes it one of five first environments and gives it the flagship example — ten monitors, twenty
minutes, _"Compare these monitors?"_. **The same afternoon is the failure case in one document and
the demo in the other.** That is the decision here, and it is worth stating that starkly because the
comfortable version — _"add support for shopping"_ — hides the fact that something previously refused
is now admitted.

## Decision, in three parts

### 1. Consume the three signals that already arrive

`scrollFraction`, exit type and arrival land on the ambient path and **no ground reads any of them**.
All three are pinned in `tests/reachability.test.ts`, each with a docblock naming its consumer. They
are consumed here:

- **`scrollFraction` into `readAround` and `read-deeply`.** `READ_AROUND_MS`'s own comment says why:
  _"Twenty seconds is a floor on a glance, not a bar on skimming. Twelve newsletter links at
  forty-five seconds each clear it comfortably."_ Scroll is what separates a page read from a page
  held open, and Claypool et al. (IUI 2001) measured time, scroll and their combination as the three
  things correlating with stated interest.
- **Exit type into the same two.** `left-unloaded` and `left-cached` say different things about a
  page than `hidden` does. The signal research rates exit type co-equal with dwell and worth more
  than scroll.
- **Arrival into `came-back`**, which is the one that matters most, below.

### 2. Narrow `came-back`, using the finding the repository already wrote down and declined to act on

`grounds.ts:660` carries the Adar, Teevan & Dumais analysis of five weeks of browsing from 612,000
users, and reads it against `INTENT_GROUNDS`' own claim in the place that claim is strongest. In the
sub-hour revisit band — the only band a thirty-minute `WINDOW_MS` can see — **77.0% of revisits came
from the same domain and only 2.9% were reached via a search**, and the self-reported intent behind
that band is _"buy something, monitor live content"_. The block ends:

> **Nothing here changes, deliberately.** The product owner's decision on 2026-08-17 was to record
> the research as an honest limit and retune nothing… **What acting on it would look like, so it is
> a decision rather than a rediscovery.** The narrowing the research points at is one predicate —
> count a return only when the person went to a DIFFERENT origin in between.

**That predicate lands here, and arrival is what makes it cheap.** It was expensive on 2026-08-17
because the buffer could not tell a hub-and-spoke return from a real one; `arrival` distinguishes
`same-origin` from `cross-origin`, `no-referrer` and `back-or-forward`, so the predicate is a field
read rather than an inference.

The block also names the cost honestly and it is not waved away: narrowing `came-back` **also refuses
somebody reading three abstracts on arXiv and clicking back to the first**, and `came-back` is one of
only three intent grounds, one of which is required before Propositum may offer to do anything. This
is a bar change wearing a predicate's clothes. It is taken because the same change that narrows the
intent ground adds the investment ground below, and the two move the bar in opposite directions on
purpose.

### 3. Add one investment ground, `compared-options`, and say what that costs

Several comparable pages, on **different origins**, each held long enough and scrolled far enough to
have been read, with at least one return that arrival says was not same-origin.

**This lowers the bar and the file says so about its own kind of change.** From the block arguing
`INVESTMENT_REQUIRED = 2`:

> [a new investment ground is] the closest thing available to lowering `INVESTMENT_REQUIRED`. It went
> unnoticed [once].

So it is stated here rather than discovered later: `INVESTMENT_REQUIRED` stays at 2 and
`INTENT_REQUIRED` stays at 1, **and there is now one more way to reach the first number.**
`compared-options` sits on **its own axis**, not on `BREADTH_AXIS`, because a comparison is not the
same evidence as reading around one site and letting them collapse would let one afternoon pay twice.

## What must be true before this lands, and it is a fixture rather than a promise

[Principle 13](../PRODUCT_PRINCIPLES.md) — _the system should be comfortable doing nothing_ — is
half-enforced, and the enforced half is `tests/grounds.test.ts`'s standing fixture of **an ordinary
afternoon of reading, which must not qualify**. That principle also records how the fixture failed
once, in the only way that matters: it had been written at three pages while its own docstring
recorded the session it stood for as twelve links across three sites, and a new investment ground
then admitted the real afternoon and not the fixture. **The suite stayed green through exactly the
regression it exists to catch.**

Two fixtures are therefore part of this decision and not follow-up work:

- The existing ordinary-reading afternoon, **still not qualifying** after all three parts land.
- A new comparison afternoon that **does** qualify, whose docstring records the session it stands for
  and whose size matches it. A fixture smaller than the session it records is not a smaller test, it
  is a different one.

## The measurement this ADR owes ~~, and does not yet have~~

~~`PRODUCT_PRINCIPLES.md` §13 and the reachability pins both require the change that consumes these
signals to say **which afternoons started qualifying and which stopped**. That is a result, not a
prediction, and it does not exist as this ADR is written.~~

~~It is owed **in this section**, appended by the wave that lands the code, measured against the
fixture corpus and against `src/fixtures/afternoons/`. Writing a guess here would be worse than
leaving it empty: a number in an ADR reads as measured whether or not anybody measured it, and this
document's whole subject is a bar moving.~~

**Measured 2026-08-20**, by running one corpus of afternoons through `detectWork` → `groundsFor`
twice: once against the detector at `decide/everyday-direction` and once against the branch that
lands this ADR. Twenty-seven afternoons — every ambient buffer and every `ThreadPage` fixture in the
repository that reaches the offer bar, plus `src/fixtures/afternoons/`, plus three re-encodings
explained below. **Twenty went unchanged. Two started qualifying. Five stopped.**

### The two that started qualifying

| Afternoon                                                                                                                                                                                                                                                                                                                                                      | Before  | After         | On                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------- | ------------------ |
| **Ten monitors across three retailers, ~15 minutes** — the new fixture, and the shape the direction document asks for. One search, ten product pages, four on one shop and three on each of the others, each held 30–50s and scrolled past halfway, one page returned to from a different shop. Nothing held a minute; thread spans 12.5, under `SUSTAINED_MS` | refused | **QUALIFIES** | `compared-options` |
| **The standing newsletter afternoon, read past halfway with a link home from another site** — twelve links across three sites at 45s each, nine minutes, no search, no page held a minute                                                                                                                                                                      | refused | **QUALIFIES** | `compared-options` |

The second row is the honest cost and it is not a contrived buffer: it is the fixture
`PRODUCT_PRINCIPLES.md` §13 is about, with two fields changed to say the pages were read rather than
skimmed and that the return came from another site. **Three news sites covering one story produce
exactly it.** `grounds.ts` cannot tell that from three retailers, for the same reason `read-around`
cannot tell six arXiv abstracts from six product pages, and it is pinned in `tests/grounds.test.ts`
rather than left to be met in use.

**The flagship example is not in this table, and that is worth knowing.** At the _twenty_ minutes the
direction document names, ten monitors across three shops already spanned `SUSTAINED_MS` and was
already offered work on span-plus-breadth. What this ADR admits is the same trip conducted in under a
quarter of an hour, which is most of them.

### The five that stopped qualifying

| Afternoon                                                                                            | Ground lost                  | Why                                                                                                             |
| ---------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **The arXiv reader** — three abstracts on one host, one held a minute, clicked back to the first     | `came-back`                  | The return is `'same-origin'`. **This is the cost §2 names by name**, and it is a real refusal of real research |
| **A newsletter link, three pages of the site it went to, one read, then a click home on that site**  | `came-back`                  | Same predicate, the shape it was aimed at                                                                       |
| **The same afternoon with the return unclassified** (fixture as written before this change)          | `came-back`                  | No arrival, no claim. Re-encoded as the reopened tab its docstring describes, it qualifies again                |
| **The skimmed afternoon past `SUSTAINED_MS`, return unclassified**                                   | `came-back`                  | As above. Re-encoded, it still qualifies — that cost is unchanged                                               |
| **A qualifying research afternoon with every page parked** — scroll 0 and left `'hidden'` on all six | `read-deeply`, `read-around` | `heldOpenUnread`. This is the only place scroll and exit type change an answer                                  |

Three of those five are one predicate meeting one shape. Two of them are fixtures that had no arrival
on them because arrivals did not exist when they were written: **the afternoon they stand for still
qualifies once it is written down the way a browser reports it**, and the fixtures were updated to
say how somebody came back rather than left asserting that they did. That distinction is the whole
of what changed for those two, and reporting them as _stopped qualifying_ without it would overstate
this change by 40%.

### What did not move

`src/fixtures/afternoons/world-models-synthesised.json` — the committed capture — **qualifies before
and after, on the same six grounds.** Its return to the first arXiv abstract came from openreview.net
and was classified `'back-or-forward'`, which `RETURN_ARRIVALS` keeps. Strip the three signals off
every row and it loses `came-back` and stays sufficient on its two searches;
`tests/afternoon-capture.test.ts` now asserts exactly that, where it used to assert the answer was
unchanged.

Also unmoved: the ordinary-reading afternoon in both its forms (`tests/grounds.test.ts` and the
real-path version in `tests/canonical-terms.test.ts`), the skimmed newsletter afternoon at skim
scroll, run 2, the six-abstract read-around, the bank portal, the shopping session at fifteen and at
thirty seconds a page, `compose-offer`'s strong and weak threads, and four tabs opened from a results
page.

### How to reproduce it

The harness was a throwaway: the three detection files at `decide/everyday-direction` copied beside
the branch's, one corpus, two runs, a diff. It is not committed, because a measurement harness that
lives on becomes a second detector nobody notices drifting. The corpus is not lost — every afternoon
in it is a fixture in `tests/grounds.test.ts`, `tests/detection.test.ts`,
`tests/afternoon-capture.test.ts` or `src/fixtures/afternoons/`, and the two that started qualifying
and the five that stopped each have an assertion of their own in one of those files.

### What this measurement is NOT

It is a fixture corpus, not an offer rate. Nothing here says how often a real person is interrupted,
because §10.5's measurement still does not exist and no real afternoon has been captured. Twenty-seven
invented afternoons cannot tell you the ratio of the two rows above in a life. _Revisit when_ below is
where that debt sits, and it is unchanged by this section.

## What was rejected

- **A `shopping` or `trip` detector.** Two domain-shaped detectors would be the first
  domain-specialised code in a pipeline `MVP.md` keeps deliberately domain-neutral — _"The
  implementation stays domain-neutral. The scenario exists to make the fixtures and the interface
  concrete, not to specialise the code."_ `compared-options` describes a **behaviour**, and monitors,
  hotels, insurance plans and apartments all produce it.
- **Lowering `INVESTMENT_REQUIRED` to 1.** The straightforward way to admit comparison afternoons,
  and it admits every other afternoon too. `grounds.ts` argues against it at length and that argument
  is untouched.
- **Ranking the strands this admits.** More afternoons qualifying means more strands, and
  `MAX_THREADS_SHOWN` still cuts them without ordering — `strandsSuppressed` keeps counting strands
  found and discarded in silence, which ADR-0008 calls the failure the multi-strand change existed to
  remove. **This ADR makes that number bigger and does not fix it**, which is a real cost of slice 1
  and is recorded rather than deferred quietly.

## Revisit when

- **The offer rate moves.** `npm run eval -- --report` prints offers-per-observed-hour with a per-day
  column. This is the first change since that metric existed that should be expected to move it, and
  somebody reading the per-day column is the whole enforcement mechanism.
- **A false positive is reported on a real afternoon.** ADR-0008's asymmetry stands: a missed offer
  costs a suggestion nobody sees, a false one asks somebody to read and ratify a proposal about work
  they were not doing.
- **`strandsSuppressed` climbs.** That is the ranking debt above becoming load-bearing, and it is the
  thing this slice deliberately did not build.
