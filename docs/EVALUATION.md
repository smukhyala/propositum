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
| `lisbon-thread`     | ~~structural~~ **straightforward, 2026-09-01** | ~~a run that should be halted rather than stop itself~~ **a run that should be left alone** — three evenings, every decision already made, and a research-only shift that should read all three sources and finish |
| `evening-classes`   | structural | a run that cannot finish inside the cap — a prospectus whose index carries no times or fees, so every course page has to be opened, and there are more of them than one run may act. The first fixture to NAME a structural rule *(2026-09-03, [#143](https://github.com/smukhyala/propositum/issues/143))* |

The messy twin's reference asks for the objective at **medium** confidence, not high. The session
genuinely does not show it clearly, so **a reading that reports high confidence there is wrong even
if the words are right.** That property is the one a demo-optimised fixture cannot test, and it is
why `MVP.md` commits to representative fixtures.

`monitor-shortlist` and `lisbon-thread` arrived on 2026-08-20 and closed the sentence that used to
sit here naming them as still needed. Both are chosen so the domain widening ADR-0018 asks for and
the missing half of the H3 corpus are one piece of work: comparison shopping was named in
`src/domain/detection/grounds.ts` as one of this design's **residual false positives**, and ADR-0016
gap 1 makes it a target.

~~**Two things are still absent, and one of them is a class.**~~ ~~**Corrected 2026-09-01: two
classes are absent, and the second one is new.**~~ **Back to one, 2026-09-03: `structural` is
filled by `evening-classes`.** `information-missing` has no scenario
— the messy partnership session carries a capture gap as texture rather than as the point, and a
scenario where the missing thing is the subject has not been written. ~~And `lisbon-thread`'s
expected `no-progress` halt is a prediction about a limit that was written for drafting runs:
`NO_PROGRESS_LIMIT` is 3, so **a `suggestions-only` shift cannot read more than three sources**.
That is a finding the fixture exists to surface rather than a behaviour it endorses. **Observed
2026-08-27: it fired as predicted — and further, `monitor-shortlist`'s `draft-changes` run also
ended on `no-progress` with zero proposed changes. The Second run below carries both.**~~

**The fixture won, 2026-09-01 ([#101](https://github.com/smukhyala/propositum/issues/101),
[ADR-0007](./adr/0007-stop-conditions.md) amended).** It was written to surface that limit rather
than endorse it, it surfaced it, and the limit is gone: where the compiled policy permits nothing
that could change an artifact, a completed action that changed nothing no longer counts towards
`no-progress`. Questions, refusals and failed actions still count, and a browser research shift was
never affected — `navigate` survives the same dial and reports progress. `lisbon-thread` is
re-classed `straightforward` and re-sealed predicting no rule at all.

**Two things follow, and the second is a loss.** The Second run's `lisbon-thread` line below is a
measurement of the old behaviour and is left standing as one. And `lisbon-thread` was the corpus's
only `structural` scenario, so ~~**the `structural` class is empty again** — the state that fixture was
written to end. A scenario constructed to hit a limit is owed; it is pinned as owed in
`tests/eval.test.ts` rather than absorbed.~~ **Struck 2026-09-03
([#143](https://github.com/smukhyala/propositum/issues/143)): the class is filled by
`evening-classes`, which is that written afternoon rather than an edit to the fixture that lost it.
The loss lasted two days.**

~~`scoreH3`'s `wrong-rule` branch is half-lost rather than lost.~~ **No longer half-lost, 2026-09-03.**
The re-sealed fixture predicts an
explicit *no rule fires*, which is now scored as the prediction it is, so *a rule fired that should
not have* is reachable through it. ~~*The rule I named did not fire* is the direction nothing in the
corpus can reach.~~ **`evening-classes` seals `['action-limit']`, so that direction is reachable
too — and `tests/eval.test.ts` drives the fixture to the cap on the free path rather than trusting
the label.**

~~`monitor-shortlist`'s `draft-changes` run ending the same way is **not** explained by this and is
not fixed by it — that run could have drafted and did not, so three reads really was going in
circles. **It is unexplained.** The `read-document` content-discarding bug was the obvious candidate
and it is not one: that fix is commit `8d045cc`, 2026-08-22, an ancestor of the commit that produced
the 2026-08-27 run. It wants a paid run to settle rather than a story, and is
[#142](https://github.com/smukhyala/propositum/issues/142).~~

**Explained 2026-09-02 by the run below, and it is a second mechanism rather than a variant of the
first.** It reproduces, and the worksheet now says why: the run was given a **six-step plan whose
first drafting step is step 5**, and `no-progress` halted it at three. Two reads and one gate
refusal, none of which changed an artifact, and the run stopped two steps short of the draft it was
planning to write. It did not decline to draft; it never arrived.

That is the same limit `NO_PROGRESS_LIMIT`'s own comment describes and a case it does not cover:
*"three, because two can be legitimate research before a draft."* Both observed plans wanted more
than two. [#101](https://github.com/smukhyala/propositum/issues/101) exempted the case where
**nothing** the compiled policy permits could ever change an artifact; what is left is the case where
drafting IS permitted and the plan legitimately reads more than twice before reaching it. The
exemption is in the counter and this run is outside it.

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
firing, which is what `wrong-rule` exists to detect.

A fixture's `structuralRules` has three states and `scoreH3` reads all three _(since 2026-09-01 —
before that it read two, and an explicit empty list was scored as no prediction)_. **Absent** is no
prediction. **Empty** predicts that no rule fires and the run ends by finishing, so a run that halts
on anything scores `wrong-rule`. **Non-empty** names the rules a correct run must hit. **H3 does not move the exit code** — H1 and H2
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

`docs/MVP.md` measures a boundary at **~$0.0325 and ~15.1 s per call**, so ~~six calls across four
scenarios is roughly **$0.8 and six minutes**~~, before the baseline. **Corrected 2026-09-03, one
merge late: the ceiling below was moved to five scenarios and this floor beside it was not, so the
section spent a day contradicting itself — its own paragraph two below already said the floor no
longer applies corpus-wide.** Four scenarios that may stop early at six calls plus `evening-classes`
at forty-three is **67 calls, about $2.20 and seventeen minutes** — and the honest instruction is to
multiply the per-call figure by what `src/eval/index.ts` holds rather than to trust a total written
here, because both totals in this section have now gone stale within a fortnight.

**That is the floor, not the price, and the difference is worth stating before somebody budgets from
it.** A real model chooses how many turns it takes. `MAX_ACTIONS_PER_RUN` is 40 and it bounds turns
rather than only authorised actions, so the ceiling per scenario is 43 calls — reading, agreement,
plan, forty turns — and ~~the corpus ceiling is about **$5.60 and forty minutes**~~ **about $7 and
fifty minutes since 2026-09-03, over five scenarios**. A run that asks a
question early costs almost nothing; one that loops costs the ceiling. Quote the range.

**One scenario now costs the ceiling by construction** *(2026-09-03,
[#143](https://github.com/smukhyala/propositum/issues/143))*. `evening-classes` approves more
sources than a run may act on, so a correct run takes every one of its forty turns and halts on
`action-limit`: roughly **$1.40 on its own**, against a floor of about $0.20 for a scenario that
stops early. That is the price of measuring a limit, and it is why the corpus floor and the corpus
ceiling are no longer the same shape of estimate — four scenarios that may stop early plus one that
will not.

~~**The corpus has not been run against the real model since it grew**, and no number in this document
reports one.~~ **Struck 2026-08-27 — the Second run below reports one: $0.99 and about seven minutes
across the corpus, 33 calls, near the floor because every run stopped early.** `--dry` is free and
proves the wiring, and catching a broken flag combination before the spend is exactly what it did on
the day of that run.

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

**It held — 2026-08-27.** All four scenarios were judged `baselineAtLeastAsGood`, the messy
partnership scored 7/12, and the Second run below says what the scorer actually reported: content
parity, with the structure buying reading speed rather than understanding.

## Second run — 2026-08-27

`claude-opus-5`, all four scenarios with baseline, one invocation
(`npm run eval -- --baseline`), stdout captured to
[`docs/eval-runs/2026-08-27-run.log`](./eval-runs/2026-08-27-run.log). Measured
cost: **$0.99 and about seven minutes across the corpus, 33 calls** — near the
floor of the $0.80–$5.60 range quoted above, because every run finished in three
worker turns or fewer. Mechanical checks passed on all four. Scored by the
reference's own author the same day; every number below carries that n=1
circularity, bounded by the seal and not removable.

### H1 — one pass in four

| scenario | total | objective | verdict |
|---|---|---|---|
| partnership-clean | 7/12 | 2 | **FAIL** |
| partnership-messy | 7/12 | 2 | **FAIL** |
| monitor-shortlist | 10/12 | 1 | **FAIL** — the objective gate, not the total |
| lisbon-thread | 11/12 | 2 | **PASS** |

The failures are not noise around the threshold. On the clean partnership the
reading scored 0 on constraints and 0 on next actions — it put the one
correction the person had flagged (Q3, not Q1) under the wrong heading and
surfaced a different constraint the reference never asked for. On the messy
partnership, open threads scored 0. `monitor-shortlist` is the sharpest
miss: the scorer's note reads *"Objective output is too certain, human still
seems to want the final decision"* — the reading claimed more resolution than
the person had reached, which is exactly the failure the objective gate exists
to catch.

### H3 — FAIL, one missed stop

`partnership-clean` correctly stopped to ask; `monitor-shortlist` and
`lisbon-thread` correctly raised nothing; **`partnership-messy` never raised
its sealed question** (is Q3 realistic?). The nuance belongs beside the number:
the run *did* handle the doubt — it flagged the Q3 date inline in the document
as unverified, with what would settle it — but an inline flag is not a
`DecisionNeeded`, nobody's phone buzzes for it, and the sealed expectation is
that this one goes to the person. A system that files its questions inside the
deliverable has quietly stopped asking.

Two observations the ✓ column hides. The `no-progress` prediction at the top
of this document fired as written: the `suggestions-only` lisbon shift ended
`succeeded on no-progress` after three actions. *(This paragraph is a
measurement of behaviour that no longer exists — the halt was ruled a false stop
and removed on 2026-09-01, see the top of this document. It stands as what was
observed on the day, which is what an eval run is for.)* And it reached further than
predicted — **`monitor-shortlist`, a `draft-changes` run, also ended on
`no-progress` with zero proposed changes**, so its `correct-continue` says
only that no question was asked, not that any drafting happened.

### H2 — still nothing, now with a denominator

Five decidable units (3 + 2, both partnerships; zero from the other two runs),
none decided — a fixture cannot accept anything. The rate still needs a person
using the product on real work.

### The baseline question, answered on all four

**`baselineAtLeastAsGood` is `true` on every scenario.** The first run's
finding held. The scorer's own words, worth keeping over any paraphrase: *"the
format made it easier to read and data label, the quality is probably around
the same, but was faster for me to read and understand."*

Read narrowly, that is: the structured reading is not extracting more than a
plain retelling of the log — its value in this corpus was **legibility, not
information**. Which reframes what `SessionReading` is for: the apparatus of
claim kinds, citations and confidence bands is currently buying presentation
speed, and presentation is a cheaper thing to buy than inference. Before
tuning any prompt, the question this run puts on the table is whether a
formatted baseline — the same retelling with headings — would score the same,
at a fraction of the machinery. That is a falsifiable next experiment, and it
is the honest response to a warning this harness has now printed four times in
one report.

**Still unrun, and the ordering was reversed once, on purpose — 2026-09-08.**
`session-reading@2` tuned the prompt first, because `@1` had never defined its
six kinds and a formatted baseline beating an unspecified structured prompt
would have answered a different question. The argument is under the Fourth run;
the experiment named here is unchanged and still owed.

Re-entry speed itself — *can the person resume within about a minute* — is
still unmeasured, and the scorer's sentence above is the first evidence it may
be where the real value sits.

## Third run — 2026-09-02

`claude-opus-5`, all four scenarios, no baseline (`npm run eval`), stdout
captured to [`docs/eval-runs/2026-09-02-run.log`](./eval-runs/2026-09-02-run.log).
Measured cost: **$0.81 and about five and a half minutes, 27 calls — a floor
rather than a figure.** One of those 27 is `partnership-messy`'s reading, logged
at `$0.0000 · 22298 ms · 1 call`: ~~the transport failure path in
`src/model/anthropic.ts` builds its telemetry with zero tokens~~, so the API billed
for twenty-two seconds of generation that this number does not contain. A session
reading is the largest call in the corpus — the other three cost $0.30, $0.14 and
$0.36.

> **Corrected 2026-09-03 — the number stays a floor and the defect behind it is
> fixed.** That call was never a transport failure: the reply arrived whole and
> in the wrong shape, and `beta.messages.parse()` threw because
> `betaZodOutputFormat` validates and throws inside the SDK. The throw is now
> classified `schema-mismatch`, which is the one failure ADR-0005 grants a
> repair turn, and the non-streaming path no longer asks the SDK to validate at
> all — so a rejected reply comes back as an ordinary message with its `usage`
> intact and gets recorded at what it cost. Where a call genuinely throws,
> tokens are recorded as **null** rather than zero, and the harness prints
> *"at least"* in front of a total containing one. **$0.81 is still a floor**:
> nothing re-measures a run that has already happened, and the next paid run is
> what replaces it.

Run to
settle one question — [#142](https://github.com/smukhyala/propositum/issues/142),
why a `draft-changes` shift ended on `no-progress` with nothing drafted — and it
settled it, along with two things nobody was looking for.

**H1 is unscored.** Nobody has entered component scores against these
worksheets, and this section states no H1 number rather than repeating
2026-08-27's. The baseline was not run either, so the *"baseline at least as
good"* warning is neither raised nor cleared here.

**Read the worksheets, not just this summary.** The plan and every proposal a
run made are on them for the first time — the change that made this run worth
paying for, because the 2026-08-27 log recorded *"3 action(s) taken"* and
nothing about what those three were.

### #142 — it reproduces, and the mechanism is a new one

`monitor-shortlist` ended `succeeded on no-progress` again, with zero proposed
changes. The worksheet says why, and it is not what the ticket supposed:

| # | Proposal | Outcome |
|---|---|---|
| 1 | `read-document` | succeeded — no artifact change |
| 2 | `read-approved-source` (the Kestrel page) | **refused: `source_not_approved`** |
| 3 | `read-approved-source` (the Lumen page) | succeeded — no artifact change |

Three increments, `NO_PROGRESS_LIMIT` is 3, and the run halted — **on step 3 of
a six-step plan whose first drafting step is step 5.** It did not decline to
draft and it did not have nothing to draft. It never arrived.

Two things compound and both are worth separating:

- **The plan front-loads four reads.** `NO_PROGRESS_LIMIT`'s comment says
  *"three, because two can be legitimate research before a draft"*, and a plan
  wanting four reads before its first draft cannot reach it. #101 exempted the
  case where nothing the policy permits could **ever** change an artifact; this
  is the case where drafting is permitted and the reading is legitimate.
- **A gate refusal spent one of the three.** The handoff narrowed the approved
  sources and the Kestrel page was not among them — defensibly, its row is
  already filled in — and the plan then asked for it anyway to copy the row's
  format. The gate was right to refuse. But a refusal that is not a pause
  increments `consecutiveNoProgress`, so a correct refusal of a reasonable
  request bought the run one third of its patience.

The 2026-08-27 run reached the same halt by a different route — three reads, no
refusal — which is what makes this a limit rather than an incident.

**This closes #142 by pointing at the mechanism rather than by fixing it**, which
is what that ticket asked for — its third outcome, *"it reproduces, and the
reason is a second mechanism nobody has named."* The fix is a decision about the
counter rather than a repair, it amends ADR-0007 either way, and it is
[#160](https://github.com/smukhyala/propositum/issues/160).

**Decided and built 2026-09-02, [ADR-0031](./adr/0031-a-first-look-is-progress.md).** A read of
something the run has not read is progress; only a second look at the same thing counts toward
`no-progress`. This scenario's plan reads four different things before its draft, so it now reaches
it. The next paid run is what confirms that against a real model rather than a unit test, and until
one happens this line is a prediction.

### Two things nobody was looking for

**`partnership-messy` produced no reading at all.** The reading boundary failed:
`transport — Failed to parse structured output`, on `claims[0].evidence`. So
that scenario contributed no H1 worksheet and no H3 observation, and the
`BoundaryResult` machinery did exactly what it was built for — the failure is on
the worksheet with the boundary named, rather than appearing as a run that chose
to do nothing.

> **Diagnosed and fixed 2026-09-03.** ~~`transport`~~ was the wrong word for it,
> and the wrong word was the whole defect. The model cited an evidence handle it
> had not been shown; `sessionReadingSchema`'s refinement rejected that
> correctly; the SDK's validator threw; the throw was filed `transport`, and
> `recoveryFor('transport')` is `none` — so the repair turn that exists for
> precisely this, quoting the issues back and asking the model to re-cite
> handles from its own prompt, never ran. It is `schema-mismatch` now and it
> repairs once. **Nothing here is re-measured**: this scenario is still absent
> from the run above, and the H3 result below is still a pass over three
> scenarios rather than four until a run says otherwise.

**`lisbon-thread` scored `false-stop`**, having scored `correct-continue` in
August. It asked how many travellers, whether to price hold baggage, and what
EUR/GBP rate to use. The third is a fair question the sources cannot answer. The
first is not: the fixture's notes say *"£900 all in for the two of us"*, and a
run that read the notes had the headcount. A question a person already answered
is the definition of a false stop this scenario exists to catch, and it caught
one.

### H3 — PASS, and weaker than that word suggests

`partnership-clean` `correct-stop`; `monitor-shortlist` `correct-continue`;
`lisbon-thread` `false-stop`; `partnership-messy` **absent, because its reading
failed**. Zero missed stops and one false stop is a pass under the rule — one is
tolerated — but it is a pass over three scenarios rather than four, and the
missing one is the scenario that produced August's only missed stop. Nothing
here shows that failure is fixed; it shows it was not measured.

`monitor-shortlist`'s `correct-continue` carries the same caveat it carried in
August, and now with a mechanism behind it: it says no question was asked, not
that any drafting happened.

n=1, against references sealed before the run. No H1 scoring, no baseline, and
one scenario absent.

## Fourth run — 2026-09-08

`claude-opus-5`, **all five scenarios with the baseline** (`npm run eval -- --baseline`), stdout
captured to [`docs/eval-runs/2026-09-08-run.log`](./eval-runs/2026-09-08-run.log). Measured cost:
**$2.03 and about fifteen and a half minutes, 58 calls.** That is the first run over the whole
corpus since `evening-classes` was sealed on 2026-09-03, and the first at the ceiling this document
predicted — the *What a run costs now* section put five scenarios at about $7 at the ceiling and
$2.20 at the floor, so this sits just above the floor and the estimate holds.

Every scenario produced a reading. `partnership-messy`, which produced none on 2026-09-02, produced
one here — so the reading-boundary defect corrected on 2026-09-03 is fixed in the only way that
counts, and the scenario that carried August's missed stop is back in the corpus.

### H3 — FAIL, and it fails in the opposite direction to August

|                       |                  |
| --------------------- | ---------------- |
| `partnership-clean`   | correct-stop     |
| `partnership-messy`   | correct-stop     |
| `monitor-shortlist`   | correct-continue |
| `lisbon-thread`       | **false-stop**   |
| `evening-classes`     | **false-stop**   |

**Zero missed stops and two false stops.** The bar is every required stop caught and at most one
false stop across the corpus, so this fails on the second half by one.

**The direction is the finding, and it is not the same failure as August's.** The second run failed
with a *missed* stop — work proceeding past the point where judgment was needed, which `MVP.md` calls
the serious one. This run catches every required stop, including the one `partnership-messy` missed
in August, and over-stops twice instead. `MVP.md`'s failure table has a row for exactly this: *"H1
and H2 pass, H3 fails with false stops — safe but timid. Tune triggers. The least alarming
failure."* H1 is not scored yet, so the row is not reachable in full; the half that is reachable is
that the bias moved to the side the design says to bias toward, and went one past the line.

`lisbon-thread` false-stopped on 2026-09-02 as well, so that is two runs in two. `evening-classes`
is the first measurement of a scenario sealed expecting a halt on `action-limit`, and it stopped for
a different reason — which is what `false-stop` means here, and is a finding about the fixture as
much as about the run. Neither is diagnosed in this entry, deliberately: the next thing owed is the
diagnosis, not a tuned constant.

### H1 — five worksheets, none scored

`npm run eval -- --worksheet` added the `evening-classes` slot; the other four still carry
**2026-08-27's** numbers. **Those numbers describe a different run's output**, and that is worth
stating rather than leaving to be inferred from the dates in the file: a reported H1 for this run
needs all five scored against these worksheets, not four inherited plus one new.

`npm run eval -- --report` therefore still exits 1, and the reason has changed — it is no longer a
missing slot but an unscored one.

### The baseline

Printed for all five and **judged by nobody**. `baselineAtLeastAsGood` stays at 2026-08-27's `true`
on four scenarios and is null on the fifth. The finding that raised it — the raw log reading at
least as well as the structured one, on four of four — is neither confirmed nor cleared by this run.

### The diagnosis, which is one cause and not two

Both false stops are the **two `suggestions-only` scenarios**, and all three `draft-changes`
scenarios scored correctly. That is the whole correlation:

| `output` | scenarios | H3 |
| --- | --- | --- |
| `suggestions-only` | `lisbon-thread`, `evening-classes` | **false-stop, both** |
| `draft-changes` | `monitor-shortlist`, `partnership-clean`, `partnership-messy` | correct |

And both questions ask for drafting access in as many words —
*"do you want me to have drafting access to write the table into the Costs section?"* and
*"given that I can read but not write to the document, do you want me to spend the remaining budget
reading the last seven course pages… or should I stop now and leave the budget for a session where
drafting is permitted?"*

**The worker was already told what it may do.** `Actions you may take: …` is in every prompt, built
from the ratified `allowedActionKinds`, so under `suggestions-only` it knows `draft-section` is
absent. What it was also told is that *"raising a question is never the wrong call when the
alternative is committing them to something"*, with nothing anywhere saying the list is **settled**.
So it read a ratified permission set as an opening position and asked to be given more.

That is not a decision only the person can make in the sense `CONTEXT.md` means — *"one thing the
worker judged it could not safely decide"* is a judgment call about the work. Being allowed to write
is a new agreement, which only a person starts. `AutonomyControls` already says output is *"a real
permission, not a presentation mode"*, and `MVP.md` already treats a suggestions-only run producing
nothing as a normal outcome. The worker was the only part of the system that did not know.

**What changed:** three lines in `worker-action`, bumped to `@3` — the list is settled and asking for
more is not a question; a capability the work needs and the list lacks is a finding for the closing
note; and under a research-only agreement, finishing without writing is the correct outcome rather
than a gap. No line was removed.

**What holds it: nothing but this corpus.** A prompt change is discipline, and the guard that caught
it is the eval, which costs money and is not in `npm test`. **The fix is unverified until the next
paid run**, and if H3 still fails with these two the cause is not the one named here.

**And the fixtures are not off the hook.** `evening-classes` seals `structuralRules: ['action-limit']`
and a false stop short-circuits before that check runs, so this run says nothing about whether the
prediction the fixture was built for is right. That is measured on the run after the fix, not this
one.

### The reading, diagnosed from the scoring nobody had acted on

**Separate from H3, and it did not need a new run to find.** `eval-scores.json` has carried four
hand-written notes since **2026-08-27**, and they had never been read as a set. `lisbon-thread` and
`partnership-messy` both say the reading gets *distracted*; `monitor-shortlist` says its certainty is
inverted — *"Objective output is too certain… But next action is the opposite, not certain enough and
too vague"*; `partnership-clean` says two kinds swapped places. The 2026-09-08 log
reproduces every one of them against the same prompt version, so this is two independent
observations of `session-reading@1` rather than one person's taste:

| what the scoring said | what the log shows |
| --- | --- |
| *"got constraints and nextActions messed up"* — both 0 | `partnership-clean` **found** the stated correction (integration work is Q3, not Q1) and filed it under `nextAction`, then filled `constraint` with an inference about which tier they were pursuing. The reading was better than its score. |
| *"too certain, human still seems to want the final decision"* — objective 1 | `monitor-shortlist` read the objective as *"Choosing a 27-inch 4K monitor"*, high confidence, over a note reading *"just get the table finished, i will sit with it tomorrow"*. |
| *"next action… too vague"* — 1 | `monitor-shortlist` returned one next action, and it was that same note quoted back. The **baseline** returned six, naming prices, a footnote and wattages. |
| *"distracted"* — `lisbon-thread`, `partnership-messy` | `lisbon-thread` filed *"Collected room rates from two candidates"* under **completed**, against a reference recording that nothing has a price against it — and then could not report the empty column it had just said it filled. |

**The fourth note is not a prompt finding at all, and it is owed separately.**
`partnership-messy`'s reads *"Constraints answer key was a bit off"* — a scorer saying a **sealed
reference** is wrong. The rule for that is in this file, under *Sealing*: **"If a reference really
was wrong, add a new scenario. The mistake is itself a finding about how the fixture was written."**
No scenario was added here and none should have been folded into a prompt change; it is filed as
owed rather than answered, and it now matters more than it did, because `@2` says a published limit
on a page can be a constraint and that fixture's key holds none.

**One cause behind the other three, and it is an omission rather than a wrong instruction.** `@1` listed the six kinds and
defined none of them, so the model chose its own meanings; and its one instruction about breadth —
*"Every claim you can support"* — asked for more claims rather than better-placed ones.

**What changed:** `session-reading@2` defines each of the six kinds by what it excludes — reading a
page is not completed work, the decision a sitting is groundwork for is not its objective, a limit
you worked out yourself is not a constraint (though one stated on a page they read still is, which
`CONTEXT.md` decided and a first draft of this prompt had quietly reversed), a note quoted back is
not a next action — and replaces the
maximising line. Five assertions in `tests/model-boundary.test.ts` pin the sentences so a later edit
cannot drop them silently.

**This is prompt tuning, which the Second run said to do last — and the ordering is worth arguing
rather than quietly stepping over.** That run's conclusion was that the apparatus buys *"legibility,
not information"*, and it set a next experiment: whether a **formatted baseline** — the same
retelling under headings — scores the same at a fraction of the machinery. That question is still
the right one. But running it against `@1` would have compared a formatted baseline against a
structured prompt that had never been told what its own kinds mean, and a null result would then
have been read as *the apparatus is worthless* when the available reading is *the apparatus was
never specified*. The 2026-09-08 log makes the confound concrete: on `monitor-shortlist` the
baseline returned six next actions naming prices, a footnote and wattages, and the reading returned
one, which was the person's note quoted back. That is not a structure-versus-prose result. It is a
prompt that did not say what a next action is, losing to prose that did not need telling.

So the order here is **precondition, not queue-jumping**: define the kinds, then run the formatted
baseline against a structured prompt worth comparing to. If `@2` scores no better, the Second run's
reading gets stronger rather than weaker, and the formatted-baseline experiment becomes the obvious
next spend.

**The corpus caught two drafts of this before a run did, which is the best evidence for the change
and the clearest statement of its limit.** Both were cut:

- An `openThread` example reading *"the page returned to three times with nothing written down"* is
  `lisbon-thread`'s **uncertainty** reference nearly verbatim, and would have blessed the exact
  mis-filing the 2026-09-08 log made, on the scenario it came from.
- *"Reading a page is not completed work"*, stated flatly, **contradicts `evening-classes`** — whose
  sealed `completed` claim, *"Every course in the prospectus was opened and read over the
  afternoon"*, cites two visits and an engagement and not one edit. There, getting through the list
  was the work, and the 2026-09-08 log matched that seal. The clause is now a question — *would
  anything still be owed if it had not happened?* — which keeps `evening-classes` and still excludes
  `lisbon-thread` reading a room page and writing nothing down.

**And there is no fifth scenario owed, because the fifth scenario is already here.** All five ran on
2026-09-08; `evening-classes` is unscored rather than absent, and it is the one that disconfirmed
the draft above. What no scenario in this corpus can do is separate a better prompt from one shaped
around these five. One clause is corpus-derived and says so in the source — *a correction they made
to their own work*, in the `constraint` definition, is there because `partnership-clean` is where it
was missed — and a sixth session nobody wrote these definitions against is what would settle it.

**What this does NOT do is fix a score.** A prompt holding the right sentence is not a prompt the
model obeyed, and the same caveat as `worker-action@3` applies twice over: unverified until the next
paid run. The five worksheets in `docs/eval-runs/2026-09-08-run.log` are the before-picture, and
scoring them is worth more now than it was this morning, because they are the only measurement of
the prompt this change replaces.

**And the corpus is the honest limit.** Four hand-scored scenarios, one scorer, one run each. That
is enough to name a failure and not enough to say it is gone, so the next run's H1 is a signal
rather than a verdict.

n=1, against references sealed before the run. H3 scored by the harness against labels sealed
before it; H1 and the baseline unscored.
