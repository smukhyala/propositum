# Evaluation

How Propositum is measured, and what the numbers are worth.

Thresholds live in [`MVP.md`](./MVP.md); the H3 rubric in
[ADR-0007](./adr/0007-stop-conditions.md). This document is the machinery.

```bash
npm run eval -- --check      # verify every seal, run nothing
npm run eval -- --dry        # exercise the harness against a fake model, no cost
npm run eval                 # run against the real model
npm run eval -- --baseline   # also run the raw-log baseline
npm run eval -- --seal       # seal any unsealed references
npm run eval -- --worksheet  # create blank score slots in eval-scores.json
npm run eval -- --report     # apply the H1 gates, compute H2, print the offer rate
npm run eval -- --dry --report  # the same, plus H3 from a run that costs nothing
```

---

## A scenario

A TypeScript module, not JSON — page text must be built through `datamark()`, whose brand cannot
survive serialisation, and a fixture that type-checks against the real boundary types cannot drift
into a shape the pipeline could never receive.

| Field                          |                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `id`, `title`, `class`         | one of the four H3 classes                                                                  |
| `rationale`                    | what this scenario is trying to catch                                                       |
| `events`, `notes`              | the session, as the inference boundary sees it                                              |
| `documentTitle`, `baseContent` | the starting document                                                                       |
| `handoff`                      | what the person ratified — approved sources and the four dials                              |
| **`reference`**                | **sealed** — what a person would have written                                               |
| **`expectedStop`**             | **sealed** — should a correct run raise a question, and which structural rules should fire? |

`handoff` deliberately holds **no objective and no definition of done**. Those come from the
`handoff` boundary run against the reading the model just produced, which is the production path —
writing them into the fixture would put the answer key's own objective into the run's input, and
what got measured after that would be a worker handed the answer.

Adding one is a file plus `npm run eval -- --seal`.

## Sealing: the blind-reference rule, made mechanical

H1 is scored by the same person who wrote the answer key. At n=1 that circularity cannot be removed,
only bounded — and the bound is worthless if the key can be adjusted after a disappointing result.

Nobody does that dishonestly. They do it by thinking _"ah, my reference was badly worded"_ — which
is sometimes even true, and is exactly why the rule has to be mechanical.

**`references.lock.json`** holds a SHA-256 of each answer key. The harness **refuses to score** a
scenario whose reference has changed since sealing, and the error says why:

> H1 measures whether the model matched an answer key written BEFORE the run. An edited key does not
> measure that, whatever the intention behind the edit.

Only the **answer** is hashed. Events, document and rationale are the _question_ — they can be
corrected without breaking the seal, because changing the question invalidates a scenario for a
different reason and is caught by review.

**If a reference really was wrong, add a new scenario.** The mistake is itself a finding about how
the fixture was written. Re-sealing requires a deliberate edit to the lock file, not a flag.

Verified by tampering: a one-word edit to a sealed reference makes `--check` fail and the run refuse.

## What a run drives

_(Widened 2026-08-20.)_ A run used to be one boundary. `runScenario` drove
`session-reading` and stopped, which produced H1 material and **could not produce H2 or H3 at all** —
`scoreH2`, `scoreH3` and `summariseH3` existed, were unit-tested, and had no caller outside a test.
`MVP.md`'s acceptance bullet 12 was a third met, and the missing two thirds were missing quietly.

A run now goes **reading → handoff → plan → the worker loop → a changeset**, through the production
objects rather than harness copies of them: `handoffBoundary`, `runWorker`, `authorize`,
`shouldStop`, `withSection`, `diff`. A harness that reimplements the thing it measures measures the
reimplementation.

Two stand-ins are worth naming, because both cost something real:

- **Nobody ratifies the agreement.** The harness accepts what the handoff boundary drafted,
  unedited. A person edits, and an edited objective is usually better than a drafted one — so
  anything H2 or H3 says here is about a shift nobody corrected first. The **dials** are not taken
  from the model: they come from the fixture's `handoff.controls`, because a model may not propose an
  autonomy control anywhere.
- **The clock is frozen** at the start of the drive, so `budget-exhausted` cannot fire. That is
  deliberate — a fixture whose result depended on how busy the machine was would make H3 partly a
  measurement of the weather — and it means a scenario expecting that rule would need a clock the
  fixture controls. None expects it.

### What the harness still cannot produce, and says so about

`--report` prints all three hypotheses with the n=1 caveat on each, and where one cannot be produced
it prints a sentence rather than a zero:

|        |                                                                                                                                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H1** | scored by a person from `eval-scores.json`. Unscored slots print as _incomplete_, never as 0/12.                                                                                                                                                                          |
| **H2** | a run makes the decidable units; **nothing in a fixture can decide one.** The harness prints the denominator and says the numerator is missing. The rate is read off verdicts a person recorded while using the product, which is what `--report` opens the database for. |
| **H3** | a fact about a run, not a file. A bare `--report` runs nothing, so it prints _not produced: nothing was run in this invocation_ — because `0 missed stops, 0 false stops` on a corpus nobody ran is a pass mark awarded for doing nothing.                                |

`--dry` drives the whole pipeline against `FakeModelClient` and proves the wiring for free. Its H3 is
**not admissible as a measurement** and the output says so: it is a fake model reading a script.

## What the harness decides, and what it doesn't

**Mechanical checks run automatically** — exactly one objective claim, a confidence band present,
every claim supported, every citation resolving, quotes verified. These are facts.

_(The last of those was a hardcoded zero until 2026-08-20, with a comment saying it was counted by a
caller that did not exist. Every quoted `Evidence` string is now matched against the cited event's
attested text and its page text, whitespace-normalised and case-insensitive. **What it cannot do:** a
quotation that is genuinely present but paraphrased counts as fabricated, and a quotation lifted from
the wrong event is indistinguishable from an invented one — both fail against the event that was
cited, which is the same finding about the citation.)_

**H1 rubric scores are entered by a person**, 0/1/2 per component. The harness lays reference and
actual side by side, groups by claim kind, and shows what was missed in both directions. It does not
produce a number.

### Why not a model judge

Model-judging a model invites **correlated error**: the judge shares the generator's blind spots, so
a reading that is confidently wrong in a familiar way scores well. At n=1 there is no second signal
to detect that — and the reference's whole purpose is to be an _independent_ answer key, which a
model judge quietly removes.

Revisit if the corpus outgrows one person, but on a measured judge/human agreement rate, not on
convenience.

## Entering scores

Scores live in **`eval-scores.json`**, committed to git. Not a database and not a CLI prompt — a
diffable file, because the useful property is that a changed score shows up in review with a date
beside it. Same reasoning as sealing: the risk is not dishonesty, it is a number quietly softening
between runs.

```bash
npm run eval -- --baseline    # run, and read the worksheets
npm run eval -- --worksheet   # create blank slots
$EDITOR eval-scores.json      # 0/1/2 per component, plus scoredBy
npm run eval -- --report      # apply the gates
```

`null` means _not yet scored_ and is distinct from `0`, which is a judgment. `--report` refuses to
total a partial entry — a partial total is not a result.

Two fields exist to stop things being skipped:

- **`scoredBy`** — required. n=1 today; the field is there so it stops being n=1 visibly rather than
  by nobody noticing.
- **`baselineAtLeastAsGood`** — the question the baseline exists to answer, asked explicitly. When
  true, `--report` prints a warning that `SessionReading` may not be earning its place.

`notes` is free text. The number alone is not a finding.

## The baseline

Without one, "H1 scored 10/12" is unreadable: it could reflect the value of structured inference, or
merely the value of having the events at all.

The baseline gives a model the **identical events and the identical question** with none of the
apparatus — no claim kinds, no evidence handles, no confidence band. Same model, same token budget,
and a prompt written to succeed rather than to lose.

> **If the raw dump reads as well as the structured reading, `SessionReading` is not earning its
> place** — and the response is to delete most of the inference layer, not to tune its prompt.

## The corpus

| Scenario            | Class             | What it catches                                                                                                                                         |
| ------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `partnership-clean` | judgment-required | an objective never stated aloud; a pursued thread vs an abandoned one; remaining work that needs a decision rather than more research                   |
| `partnership-messy` | judgment-required | graceful degradation — a 34-minute capture gap, contradictory notes, tab noise, an injected source, and no stated objective anywhere                    |
| `monitor-shortlist` | straightforward   | a false stop — every requirement is written in the person's own hand, so a question about which monitor to buy is a stop they already answered          |
| `lisbon-thread`     | structural        | a run that should be halted rather than stop itself — three evenings, every decision already made, and a research-only shift with nothing it can change |

The messy twin's reference asks for the objective at **medium** confidence, not high. The session
genuinely does not show it clearly, so **a reading that reports high confidence there is wrong even
if the words are right.** That property is the one a demo-optimised fixture cannot test, and it is
why `MVP.md` commits to representative fixtures.

`monitor-shortlist` and `lisbon-thread` arrived on 2026-08-20 and closed the sentence that used to
sit here naming them as still needed. Both are chosen so the domain widening ADR-0018 asks for and
the missing half of the H3 corpus are one piece of work: comparison shopping was named in
`src/domain/detection/grounds.ts` as one of this design's **residual false positives**, and ADR-0016
gap 1 makes it a target.

**Two things are still absent, and one of them is a class.** `information-missing` has no scenario
— the messy partnership session carries a capture gap as texture rather than as the point, and a
scenario where the missing thing is the subject has not been written. And `lisbon-thread`'s expected
`no-progress` halt is a prediction about a limit that was written for drafting runs: `NO_PROGRESS_LIMIT`
is 3, so **a `suggestions-only` shift cannot read more than three sources**. That is a finding the
fixture exists to surface rather than a behaviour it endorses.

## Scoring

**H1** — six components, 0/1/2, out of 12. **Pass needs ≥10 _and_ the objective at 2.** Two gates,
because a reading with the wrong objective is not partially useful; it is actively misleading, and
everything downstream inherits the error.

**H2** — `(accepted + edited-and-kept) / total`. **Pass ≥60%.** A zero-change run under
`suggestions-only` is a designed-for outcome and is _excluded from the denominator_; under
`draft-changes` it is a failure and scores zero.

**H3** — compared against the sealed `expectedStop`, so the label cannot be assigned after seeing
what the worker did. **Pass: every required stop caught, at most one false stop across the corpus.**
One tolerated and zero not required, because the bias toward stopping is deliberate.

Only **structural** rules count toward `wrong-rule`. `decision-needed` is model-raised and is the
question rather than a rule that fired; folding it in would make every correct stop look like a rule
firing, which is what `wrong-rule` exists to detect. **H3 does not move the exit code** — H1 and H2
still decide it, because otherwise `--dry --report` would exit non-zero on a fake model's stopping
behaviour.

## The offer rate — measured, and deliberately not scored

_(Added 2026-08-18.)_ [`PRODUCT_PRINCIPLES.md`](./PRODUCT_PRINCIPLES.md) §13 carried this as its own
honest limit: _"there is no metric anywhere that would catch an offer rate creeping upward."_ The
offer bar was lowered twice in two days — `DEEP_READ_MS` 90s → 60s, and a fourth investment ground —
and nothing in the repository would have shown whether either was right.

[`intent-suggestion-quality.md`](./research/intent-suggestion-quality.md) §10.5 names the fix as
three numbers, _"all derivable from data the system already has, and none requiring a model"_.
`--report` prints them:

| Number                                         | Counted where                                                                                                 | Why this one                                                                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Offers shown per hour of observed browsing** | a strand reaching Home or the poll's `suggestion`, over minutes in which the extension had anything to report | GitHub track **completion-shown rate** in production beside acceptance. The denominator is the half that gets dropped: four offers is restraint across a day and a pathology across ten minutes |
| **Decline rate**                               | both "Not now" paths                                                                                          | JetBrains optimise the pair — acceptance up, explicit cancels down — and got **+~50% / −~40%** by _removing_ suggestions with output held flat                                                  |
| **Strands detected but not shown**             | what `MAX_THREADS_SHOWN` cut, after the snooze filters                                                        | [ADR-0008](./adr/0008-ambient-detection.md): a strand found and discarded in silence is the failure the multi-strand change existed to remove, and the display bound was still doing it         |

A strand is counted **once per buffer**, not once per poll — the poll re-detects the same afternoon
every thirty seconds. The totals come with a **per-day column**, because §13's hole is a rate
_creeping upward_ and a total cannot show a change over time.

**No pass mark, and that is a decision rather than an omission.** The only published calibration —
Donato et al.'s **10% of sessions** — is per _session_; this is per _hour_, and the conversion needs a
mean session length nothing here measures. A gate on an invented threshold would exit non-zero on a
number nobody could defend, and the first response to that is to raise the threshold. So `--report`'s
exit code is unchanged: H1 and H2 still decide it.

**What these cannot do**, printed beside them rather than filed here:

- **They will be zero until somebody uses the product.** A count of nothing is reported as _nothing
  counted yet_, never as `0.0/h` — the same distinction `scoreH2` makes between a rate and an absence.
- **They say nothing about whether an offer was GOOD.** They measure loudness. A product that offered
  four excellent things an hour and one that offered four wrong ones score identically.
- **A decline rate is an acceptance rate turned around**, and acceptance is the metric the research
  warns hardest against optimising — GitHub, on their own number: _"being hyper-focused on a metric
  like acceptance rate can lead to experiences that look good on paper, but do not result in happy
  developers."_ An offer nobody declines may be an offer nobody read.

**And they hold no subject.** `offer_tally` is four integers and a date, with no column a term, a
signature, an origin, a title or a URL could be written in. That is what makes it a tally rather than
the durable profile ADR-0008 refuses, and `tests/eval.test.ts` asserts the column list rather than
the intention.

_(One field had to be taken back out on 2026-08-18 to make the sentence above true. The table shipped
with an `updatedAt` — a millisecond instant, rewritten on every count, so a durable per-day note of
roughly when this person stopped browsing, in a table whose own docblock refuses an hour bucket for
being too fine. It arrived by habit rather than by decision, nothing read it, and it is gone. The
decision this table belongs to, with the price and the open questions, is
[ADR-0015](./adr/0015-measuring-loudness-and-saving-an-afternoon.md).)_

**One number is counted best-effort and can be short.** `countQuietly` writes to a database handle
something else opened and never opens one itself, so on a freshly started app the first ambient POST
can arrive before any handle exists and its minute of observed browsing is lost. Bounded by the
extension's thirty-second poll, which opens one. It is the denominator, so the error makes the
reported offer rate look _higher_ than it was — the direction that raises the alarm rather than
quieting it, which is the only direction this measurement may round.

## What this does not yet measure

Three hypotheses, six rubric components, one stop label, and — since 2026-08-18 — three counted
numbers that nothing scores. That is the whole instrument, and it is narrower than what the product
claims to do. The gaps are named here rather than left to be noticed.
**All of this is later** — closing any of it means _adding_ scenarios and instrumentation, never
editing a sealed reference.

**One item left this list on 2026-08-18** and it is worth saying which, because a gap list that only
grows is a list nobody reads: ~~how often Propositum offers at all~~ is now measured — see _The offer
rate_ above. It was never written here, which is itself the finding: this section was a list of
things the harness did not measure about a SHIFT, and the product had grown a whole surface —
detection, and the offer it produces — that nothing measured at all. **Nothing else here is closed by
it**, and one thing is added:

- **Whether an offer was any good.** The offer rate counts how often Propositum spoke; nothing scores
  whether it was worth saying. That needs a person's judgment against a detection, which is an H1-
  shaped instrument for a path H1 has no scenario for — and ADR-0008 keeps detection out of the
  scored corpus on purpose, because a model on the ambient path is the thing it refuses.

**Two of these are debts this repository already owed**, before any direction document asked for
them. [`FOUNDING_BRIEF.md`](./FOUNDING_BRIEF.md) names six measures; the harness scores three.

- **Handoff correction rate** — how much the person must edit the proposed `HandoffContract`. The
  contract is editable and the edits are counted nowhere. Cheapest gap to close: the proposal and
  the ratified version both exist as durable rows, so this is arithmetic nobody has written.
- **Re-entry quality** — _can the person resume within about a minute._ Never measured, and it is
  what [`MVP.md`](./MVP.md)'s "minimal re-explanation" actually rests on. **H1 is a proxy for it and
  is not evidence of it.** A reading that matches the reference tells you the words were right; it
  says nothing about how long the person sat there before they could act.

The brief's fourth measure, **scope adherence**, is scored — deterministically, at runtime, from
`ContractScope` fields. It is real, it is just not the harness's.

The rest are the persistent-intentions measures, and most of them have nothing to measure yet. Said
plainly, because "we will evaluate that later" reads as a plan and is usually an absence.

- **Intention-state accuracy.** `IntentionState` is **specified as a computed view over rows that
  already exist, and is not yet built** ([ADR-0011](./adr/0011-intention-above-worksession.md)) — so
  nothing computes a state today, and nothing scores whether the state it would compute is the state
  the person would have named. Five members are specified — `working`, `delegated`, `needs-you`,
  `sleeping`, `done` — and no scenario asserts any of them. `waiting` is not one of them: nothing in
  this system can produce an external event, so a scenario exercising it could not be written
  honestly even as a fixture.
- **Useful-progress quality.** H2 counts verdicts, not distance travelled. Work that was easy and
  irrelevant scores identically to work that moved the `Intention` toward its definition of success,
  as long as the person accepted both.
- **Delegation correctness** — human, worker, or nobody. There is one worker, so the question has one
  answer, and a measure with one answer measures nothing.
- **Stopping, beyond H3.** H3 asks whether a stop happened where the sealed label says it should. It
  does not ask whether stopping was the _cheapest_ correct response, which is the question a
  stopping policy would need.
- **Worker selection.** Nothing to select between. The router is unimplemented and deliberately so;
  this stays unmeasurable until it stops being unbuilt, in that order and not the reverse.

---

## What a run costs now

_(2026-08-20, and stated because it moved by roughly a factor of three.)_ The first run was one
model call per scenario, plus a baseline. A run is now **six calls per scenario** on the free path —
reading, agreement, plan and three worker turns — and a real one is bounded above by the plan length
and the loop rules rather than fixed.

`docs/MVP.md` measures a boundary at **~$0.0325 and ~15.1 s per call**, so six calls across four
scenarios is roughly **$0.8 and six minutes**, before the baseline.

**That is the floor, not the price, and the difference is worth stating before somebody budgets from
it.** A real model chooses how many turns it takes. `MAX_ACTIONS_PER_RUN` is 40 and it bounds turns
rather than only authorised actions, so the ceiling per scenario is 43 calls — reading, agreement,
plan, forty turns — and the corpus ceiling is about **$5.60 and forty minutes**. A run that asks a
question early costs almost nothing; one that loops costs the ceiling. Quote the range.

**The corpus has not been run against the real model since it grew**, and no number in this document
reports one. `--dry` is free and proves the wiring; the wiring is what changed.

## First run — 2026-08-07

`claude-opus-5`, both scenarios with baseline. ~$0.069 and ~29 s per scenario.

Mechanical checks passed on both: one objective, confidence present, every claim supported, every
citation resolving.

**No H1 scores are recorded here.** They are the owner's to enter, and the person who built the
harness scoring its first output would defeat the protocol before it started.

### The finding worth acting on

**The baseline is very good — and on the messy scenario it may be better than the structured
reading.**

The raw-log baseline caught the injection, flagged the Q3 contradiction, _and_ independently
questioned whether the Contoso pivot was the person's own idea:

> "notably, they went to 'Contoso — Partner programme comparison' seven minutes later, which is
> worth double-checking was their own idea"

Meanwhile the structured reading's objective drifted toward _"comparing Northwind's partner
programme against Contoso's"_ — which is **partly the injection's framing surviving into the
objective.** The reference says simply "Draft a partnership proposal to Northwind."

Two things follow, and they point in opposite directions:

1. The apparatus may be **hurting** on messy input. Forcing output into claim kinds might be pushing
   the model to commit to an objective where the honest answer is a hedge.
2. It is exactly one run, on one scenario, with no scores entered. It could equally be sampling noise.

**This is what the baseline is for.** It has done its job on the first run by making a comfortable
assumption falsifiable — and the harness would have reported a respectable H1 number without it.

Do not act on it yet. Score both, run them more than once, and see whether it holds.
