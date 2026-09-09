# ADR-0037 — Measuring whether longitudinal context helps, and refusing to score whether an offer was good

**Status:** accepted · 2026-09-07
**Depends on:** [ADR-0034](0034-somewhere-to-put-an-event-outside-a-sitting.md) — the ledger a
replayed stream writes into · [ADR-0036](0036-ordering-candidates-without-a-score.md) — the ordering
a fixture asserts
**Extends:** [ADR-0015](0015-measuring-loudness-and-saving-an-afternoon.md) — its *measured and
deliberately not scored* posture, reused unchanged for a second metric ·
[`docs/EVALUATION.md`](../EVALUATION.md)'s blind-reference protocol and the seal
**Amends:** nothing. No threshold moves, no hypothesis is redefined, and H1, H2 and H3 keep their
numbers

## The cost, first

**This adds a second thing a person has to hand-score, on a protocol that already says its scoring is
circular.** `docs/EVALUATION.md` is explicit that H1 is scored by the person who wrote the answer
key, that this cannot be fixed at n=1 and can only be bounded by the seal. A second judgment per
scenario is a second place that circularity applies, and it doubles the work of the one step in this
harness nobody can automate.

It is taken because the alternative is worse: the most important number this repository has produced
is currently unexplained.

## Context

On 2026-08-27 the corpus was run for real, and the result that matters is not H1's one-pass-in-four:

> `baselineAtLeastAsGood` is **`true` on every scenario.**

`docs/EVALUATION.md` reads it plainly — the structured reading's value in that corpus was
*"legibility, not information… the apparatus of claim kinds, citations and confidence bands is
currently buying presentation speed, and presentation is a cheaper thing to buy than inference."*
The first run on 2026-08-07 had already said it about one scenario and marked itself *"It held —
2026-08-27."*

**That is the central claim of the product, failing to beat a raw log.** The direction document
arriving on 2026-09-07 proposes an explanation without naming it: its whole thesis is that the moat
is *longitudinal* context, and every reading scored so far has been built from **one sitting**.
`SessionReading` is cold every time by design — `VISION.md` calls that a property rather than a
shortcoming — so the corpus has never tested the thing the thesis rests on.

The question this ADR makes answerable is therefore not *is Propositum good*. It is:

> Does a reading that can see what happened **between** sittings beat one that cannot?

## Decision

**Three things, and the third is the one that is deliberately not a hypothesis.**

### 1. A second comparison boolean, on the existing protocol

`eval-scores.json` gains `longitudinalAtLeastAsGood` beside `baselineAtLeastAsGood`, scored the same
way, by the same person, under the same seal. The arms are *reading alone* — what is scored today —
and *reading plus `WorkSoFar` plus this Intention's `ExternalEvent`s*. The raw-log baseline stays
exactly where it is, unchanged, as the control that already exists.

**Not a third arm and not a new hypothesis.** H1, H2 and H3 keep their questions and their
thresholds. Adding a fourth hypothesis would put a number nobody has calibrated beside three that
were fixed before any result existed, and `MVP.md`'s *Why the bar is set to be failed* is about
exactly that hazard.

**The direction of the finding matters more than its size.** If the longitudinal arm is *not* at
least as good, the thesis this whole slice serves is wrong in the cheapest possible way to discover.

### 2. Replay, so a week does not take a week

`npm run replay -- <fixture>.jsonl` feeds an external-event stream and an ambient afternoon through
the real endpoints, the way `scripts/seed-offer.ts` already replays an afternoon through
`POST /api/capture/ambient` rather than around it. Two properties make it honest:

- **The real path, not a harness path.** A replay that constructed rows directly would prove nothing
  about the detector, the grounds, the ordering or the writer.
- **Source-supplied time.** `ExternalEvent.elapsedMs` and `FAST_DETECT` between them mean a
  fixture spanning days replays in seconds with no behaviour change. This is why
  [ADR-0034](0034-somewhere-to-put-an-event-outside-a-sitting.md) carried the field.

### 3. Opportunity precision — measured, printed, and never scored

Each replay fixture seals two lists: the candidates a correct run should surface, and **the ones it
must not**. The harness prints how many of each it got.

**There is no pass mark, and that is a decision rather than an omission.** It is
[ADR-0015](0015-measuring-loudness-and-saving-an-afternoon.md)'s posture, reused for the same reason
it was taken there: the only calibration anybody has published is per session and this is per
fixture, and *"a threshold invented to bridge that would be a number nobody could defend."* A gate
that goes red on an indefensible number gets raised rather than investigated.

**The silence list is the half that matters.** `src/eval/offer-rate.ts` already says in its own voice
what is missing today — *"There is no measure here of whether an offer was any good"* — and a fixture
that only asserts what should appear cannot catch the expensive failure.
[Principle 13](../PRODUCT_PRINCIPLES.md)'s standing guard is an ordinary afternoon of reading that
must **not** qualify, and this generalises it: every fixture carries its own must-not.

## Rejected alternatives

**A fourth hypothesis, H4, with a threshold.** The obvious shape, and what the direction document
asks for — *precision, recall, MRR*. Refused on `MVP.md`'s own discipline: a threshold is only worth
anything if it was fixed before the result, and nobody can defend a number for this one. The three
hypotheses were set with an argument each; a fourth set by guess would devalue them by association.

**Opportunity recall — did Propositum anticipate what the person eventually did.** The most
interesting metric in the direction document and the one this ADR most wants. It needs to know what
the person did *next*, which needs either a sensor Propositum does not have or a diary nobody will
keep. Not refused on principle; refused because there is no instrument.

**A model judge scoring the offers.** `docs/EVALUATION.md` already refuses one for H1 — *"the judge
shares the generator's blind spots"* — and an offer judge would share them harder, because the same
boundary composed the thing being judged.

**Reusing `references.lock.json` for the replay fixtures.** Rejected on blast radius rather than on
principle: the reference lock protects H1 and H3 answer keys, and a schema change there to carry a
different shape of key risks the one file the harness refuses to run without. Replay fixtures seal
into their own lock, on the same rule and with the same refusal to ever *"fix"* one.

**Waiting for real usage instead of fixtures.** The honest objection — fixtures measure the fixture.
It is why this changes no threshold and adds no hypothesis. What it buys is a way to ask the question
at all before somebody has used the product for a month, which
[`docs/todo/01-menu-bar-app.md`](../todo/01-menu-bar-app.md) says is still gated on a stranger being
able to install it.

## What this costs

- **A second hand-scored judgment per scenario**, said at the top.
- **A fixture corpus is a thing that rots.** The five eval scenarios have needed three corrections
  between them — a class re-labelled, a false stop removed, a reference found wrong. Replay fixtures
  will be no better, and every one of them is sealed, which means a wrong one becomes a new fixture
  rather than an edit.
- **A number printed with no pass mark gets read as a pass mark anyway.** ADR-0015 has the same
  exposure and answers it with `OFFER_RATE_CAUTION` printed beside the number. The same shape is
  used here, and it is weaker than a gate on purpose.
- **The comparison can come out the wrong way, and that is the point.** If the longitudinal arm ties
  the reading-alone arm the way the raw log already ties both, this slice has produced evidence
  against the direction that motivated it. `MVP.md`'s failure table already says what to do with a
  result like that, and it is not *tune the prompt*.

## What holds the line now

| | |
|---|---|
| ~~`src/eval/seal.ts`~~ **NOT YET, and this is the honest gap** | A stream's `expectSurfaced` and `expectSilence` live in the file and can be edited after a disappointing run — which is exactly what the seal exists to prevent for scenarios. `seal.ts` is `Scenario`-shaped and holds no stream lock. **Owed, and named in `docs/todo/12-between-sittings.md`.** Until it exists, *written before the run* is an intention here rather than a mechanism |
| `tests/replay.test.ts` | The same stream replayed twice produces the same candidates in the same order — the clockless comparator and source-supplied time, asserted end to end |
| `tests/replay.test.ts` | Every fixture's must-not list is non-empty. A fixture that only asserts presence is not a fixture |
| `tests/grounds.test.ts` | The standing afternoon-of-ordinary-reading fixture still does not qualify. Unchanged, and it is the one that must never start passing |
| ~~`scripts/eval.ts`~~ **`scripts/replay.ts`** | ~~Precision prints with its caution paragraph and does not touch the exit code~~ **Corrected 2026-09-08, and both halves were wrong.** The surfaced and silence lists print per fixture from `scripts/replay.ts`; `scripts/eval.ts` holds no precision code at all. And a mismatch on either list **does** exit 1 — `process.exit(failed ? 1 : 0)`. That is an exact match against a sealed list rather than a pass mark on a count, so §3's refusal of a threshold stands; *"does not touch the exit code"* was never true of what was built |

**Where this could still go wrong.** The person scoring `longitudinalAtLeastAsGood` will have just
read the longitudinal arm's extra context, which makes it more legible — and legibility is exactly
what the 2026-08-27 finding says the structured reading was already buying instead of information.
The protocol cannot remove that bias at n=1. It is named here so the number is reported with it
attached, the way every H1 number already is.

## Revisit when

- **`longitudinalAtLeastAsGood` is false, or is true for the same reason the baseline was.** Either
  reading is a finding about the thesis rather than about the harness.
- **Anybody proposes a pass mark for precision.** It needs a calibration that does not exist, and
  ADR-0015's argument is the one to answer.
- **Opportunity recall becomes measurable** — that is, something can tell what the person actually
  did next. It is the metric this ADR wants and cannot have.
- **A replay fixture is edited rather than replaced.** The seal is the protocol; an edited answer key
  is the protocol gone.
