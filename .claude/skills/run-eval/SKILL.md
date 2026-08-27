---
name: run-eval
description: Use when scoring H1, H2 or H3 in propositum, adding an evaluation scenario, or changing the harness. Covers the flag set, the sealed-reference rule and why a lock is never fixed, why a scenario is a TypeScript module, and the worksheet conflict.
---

# Running the evaluation

`docs/EVALUATION.md` is the machinery; `docs/MVP.md` holds the thresholds; ADR-0007 holds the H3 rubric.
This skill is the operating procedure and the traps.

**These commands call the real API and cost money.** They are never part of `npm test` and never part of
CI.

```bash
npm run eval -- --check      # verify every seal, run nothing
npm run eval -- --dry        # exercise the harness against a fake model, no cost
npm run eval                 # run against the real model
npm run eval -- --baseline   # also run the raw-log baseline
npm run eval -- --seal       # seal any unsealed references
npm run eval -- --worksheet  # create blank score slots in eval-scores.json
npm run eval -- --report     # apply the H1 gates, compute H2, print the offer rate
```

Start with `--check`, then `--dry`. Reach for the real run only when both are clean.

## The three hypotheses

They are **scored separately and never averaged**, because they have different failure modes and
different evidence.

- **H1 — context transfer.** Does the `SessionReading` match what the person would have written? Six
  components, 0/1/2 each. The threshold and the objective-claim rule are in `docs/MVP.md`.
- **H2 — useful progress.** Of the decidable units a `Shift` produced, how many did the person accept?
  Edited-and-kept counts as accepted; `landed` outcomes are excluded from the denominator entirely,
  because they were never offered a verdict. **This is the hypothesis that can kill the product.**
- **H3 — calibrated stopping.** Measured in both directions: a system that never stops is unsafe, one
  that always stops is useless. Both failures are recorded.

## The seal — the one rule not to work around

`references.lock.json` holds a SHA-256 of each answer key. The harness **refuses to score** a scenario
whose reference changed after sealing.

H1 is scored by the same person who wrote the answer key. At n=1 that circularity cannot be removed, only
bounded — and the bound is worthless if the key can be adjusted after a disappointing result. Nobody does
that dishonestly; they do it by thinking *"ah, my reference was badly worded"*, which is sometimes even
true, and is exactly why the rule has to be mechanical.

**Do not "fix" a lock.** If a reference really was wrong, **add a new scenario** — the mistake is itself a
finding about how the fixture was written. Re-sealing takes a deliberate edit to the lock file, not a
flag.

Only the *answer* is hashed. Events, document and rationale are the *question* and can be corrected
without breaking the seal.

## Adding a scenario

A scenario is a **TypeScript module, not JSON**. Page text has to be built through `datamark()`, whose
brand cannot survive serialisation — so a fixture that type-checks against the real boundary types cannot
drift into a shape the pipeline could never receive. Put it beside the others in `src/fixtures/scenarios/`,
then `npm run eval -- --seal`.

Each scenario carries an id, a title, one of the four H3 classes, a rationale, the events and notes as the
inference boundary sees them, the starting document — and the two sealed fields, `reference` and
`expectedStop`.

## Scoring

**Mechanical checks run automatically** — exactly one objective claim, a confidence band present, every
claim supported, every citation resolving, quotes verified. Those are facts.

**H1 rubric scores are entered by a person.** The harness lays reference and actual side by side and shows
what was missed in both directions; it does not produce a number. There is deliberately no model judge —
correlated error.

`eval-scores.json` is a **single shared worksheet** with a `scoredBy` field. Two people scoring at once
will conflict on it. Say in the issue that you are scoring before you start. `null` is not `0`.

## The offer rate

`--report` also prints three numbers — offers shown per hour of observed browsing, decline rate, and
strands detected but not shown — with a per-day column, because a creep is a change over time and a
single total cannot show one.

**It is measured and deliberately not scored.** It says how *often* Propositum spoke and nothing about
whether it was right to. There is no pass mark, it cannot fail a build, and the exit code is unchanged.
Decline rate is an acceptance rate turned around, which is the metric the research warns hardest against
optimising.

## What the harness cannot do yet

Say this alongside any number you report. ~~The harness produces H1 material and cannot yet produce H2 or
H3; both current scenarios expect a stop, so the false-stop half of H3 has nothing to score against;~~
**Corrected 2026-08-27 — three claims, all false since the 2026-08-20 widening** (`README.md` struck the
same sentence that day and this file was missed): a run produces H3 automatically (`scoreH3`, printed in
the run invocation and only there) and H2's *denominator* (`renderH2FromRuns`); the corpus is four
scenarios, two of which seal `shouldRaise: false`, so the false-stop arm is exercised. What still holds:
H2's *rate* needs verdicts a person recorded on real work; and
nobody has timed how long re-explanation actually takes, so "minimal re-explanation" is an inference from
a score rather than a measurement. Every reported number carries the n=1 caveat — one person authors the
references and scores the results.
