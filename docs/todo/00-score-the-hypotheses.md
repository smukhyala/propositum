# 00 — Put a number on H1 and H3

**Status:** ~~not started~~ **done 2026-08-27** — the corpus ran ($0.99, 33
calls), the owner scored it, and the numbers are in: **H1 one pass in four, H3
one missed stop, `baselineAtLeastAsGood` true on every scenario.**
`docs/EVALUATION.md`'s *Second run* section is the record.
**Blocked by:** nothing. This has been unblocked for nineteen days.
**Blocks:** every other file here, in the sense that a failing H1 makes them
premature rather than impossible.

**That sentence got sharper on 2026-08-26**, when three decisions landed that
each spend a safety guarantee: [`06`](./06-buying-things.md) spends the
unconditional non-`GET` block, [`07`](./07-off-the-browser.md) spends the bound to
one browser tab, and [`08`](./08-one-time-codes.md) spends read access to every
message on the machine. *Premature* is the wrong word for those three. **Spending
a guarantee to buy a capability nobody has measured is paying a price without
knowing what it bought**, and this file is what turns the guess into a number.

Related: [issue #85](https://github.com/smukhyala/propositum/issues/85), *Score
H1 on the two sealed scenarios*.

---

## Is this already done?

```bash
cat eval-scores.json
```

**If every `h1` component is `null` and `scoredBy` is `""`, this file is not
started.** ~~That is the state as of 2026-08-26: two entries, twelve null slots,
`"ranAt": "2026-08-07"`.~~ **It is not the state now** *(2026-09-01)*: four
entries, every slot filled, `"scoredBy": "Mark"`, `"ranAt": "2026-08-27"`. The
test above is still the right one to run; the answer it gives has changed.

~~Two further things the file will not tell you:~~ **Both were true on
2026-08-26 and neither survived the next day:**

- ~~**`monitor-shortlist` and `lisbon-thread` have no entry at all.** They were
  sealed into `references.lock.json` on 2026-08-20 and have never been run. The
  scores file is six days older than the lock file it is supposed to score
  against.~~ **Struck 2026-09-01 — both were run and scored on 2026-08-27**, and
  the *Done when* list at the foot of this file has carried their numbers
  (lisbon-thread 11/12, monitor-shortlist 10/12) since that day. Two sentences
  of this file disagreeing about whether the corpus has ever run is exactly the
  state the **Is this already done?** command at the top exists to settle.
- ~~**The corpus has not touched a real model since it grew.** `docs/EVALUATION.md`
  says so in its own voice. Every number in that document describes a two-scenario
  corpus that no longer exists.~~ **Struck 2026-09-01.** It touched one on
  2026-08-27 — 33 calls, $0.99 — and `docs/EVALUATION.md`'s *Second run* section
  is the four-scenario record that replaced the two-scenario numbers.

~~This file is done when all four scenarios have a complete entry and
`npm run eval -- --report` will total them.~~ **Still true of the four it was
written about, and there are five since 2026-09-03**: `evening-classes` is
sealed and has no entry, so the *done* above is a statement about the corpus as
it stood on 2026-08-27 rather than about the corpus on disk.

---

## What you have to do yourself

| | What | Lead time |
|---|---|---|
| **Money** | An `ANTHROPIC_API_KEY` with billing that can spend up to about $6. | minutes, if the account exists |
| **A person** | **You have to type the H1 scores yourself.** This is not a step that can be delegated to me or to a model. | an hour or two of careful reading |

**Why the scoring cannot be automated, in the repository's own words.**
`docs/EVALUATION.md` refuses a model judge because *"a model judge shares the
generator's blind spots"*. The score is a person reading the produced
`SessionReading` against a sealed reference and deciding, per component, 0, 1 or
2. Twelve numbers per scenario pair, six components each: Objective, Completed
work, Open threads, Constraints, Next actions, Uncertainties.

**The blind-reference protocol matters and is circular at n=1.** The same person
authored the references and scores the results. `docs/MVP.md` bounds rather than
fixes this. Read that section before you score, not after.

---

## The work

**One thing that used to be a hazard here and is not.** Every flag below is
typed after a `--`, and a mistyped one — `--dry-run`, `--dryrun`, `-d`,
`--reprot` — used to fall straight through to the LIVE path and run the paid
corpus without saying anything first
([#112](https://github.com/smukhyala/propositum/issues/112)). `scripts/eval.ts`
now refuses an unrecognised flag by name, before the key is read, and
`tests/eval.test.ts` holds it there. **`--help` prints the usage block** rather
than a sentence about credentials. So a typo below costs nothing; only the
commands that say they cost money do.

1. **Check the seals have not moved.** Free, no API calls.
   ```bash
   npm run eval -- --check
   ```
   A sealed reference is never edited. If this fails, stop and find out why
   before spending anything.

2. **Prove the wiring on the free path.**
   ```bash
   npm run eval -- --dry
   ```
   `--dry` is a fake model reading a script. `docs/EVALUATION.md` says its H3
   result is *"not admissible as a measurement"*. It is here to catch a broken
   harness before a paid run, and nothing else.

3. **Run it for real.**
   ~~```bash
   npm run eval
   ```~~
   **Corrected 2026-08-27, having cost a broken invocation on the day:** the
   command is `npm run eval -- --baseline`, **with stdout captured** —
   `npm run eval -- --baseline --report 2>&1 | tee <log>` short-circuits into
   the free report path and runs *nothing*, because `--report` without `--dry`
   is always report-only. The baseline must ride the paid run or step 5 is
   unanswerable, and the worksheets, H3 and costs exist only on stdout — an
   uncaptured run is paid for again.
   Cost, from `docs/EVALUATION.md`: **six calls per scenario is the floor** —
   about $0.80 and six minutes across four scenarios. The ceiling is 43 calls per
   scenario (`MAX_ACTIONS_PER_RUN` is 40, and it bounds turns rather than
   authorised actions), which is ~~about **$5.60 and forty minutes**~~ **about $7
   and fifty minutes over five scenarios since 2026-09-03**. A run that
   asks a question early costs almost nothing; one that loops costs the ceiling.
   Quote the range, not the floor. **And one scenario now spends the ceiling
   whatever happens** — `evening-classes` is built to reach `action-limit`, so
   its forty turns are the measurement rather than a loop, at about $1.40.

4. **Score H1 by hand.** `npm run eval -- --worksheet` writes the blank entries.
   Fill in each component 0/1/2 and set `scoredBy`. `null` means *not yet
   scored* and is deliberately distinct from `0`, which is a judgment —
   `--report` refuses to total a partial entry.

5. **Answer `baselineAtLeastAsGood`.** It is `null` on both existing entries,
   which means the single question the baseline exists to answer has never been
   answered — despite the first run's own finding that *"The baseline is very
   good — and on the messy scenario it may be better than the structured
   reading."* If that repeats, it is the most important result in the project and
   it belongs in the README the same day.

6. **Read the report.**
   ```bash
   npm run eval -- --report
   ```
   **One thing this cannot show, noted 2026-08-27: H3.** It is a fact about a
   run, computed and printed only in the run invocation — a later bare
   `--report` prints *"not produced"*. The admissible H3 is in the captured
   run log.

7. **Write down what happened**, including if it is unimpressive. Principle 11.
   `docs/EVALUATION.md` and `README.md` both carry claims that a real run will
   move; fix them in the same commit.

---

## Done when

*All five closed 2026-08-27.*

- ~~`eval-scores.json` has four complete entries, each with a non-empty `scoredBy`.~~ Done.
- ~~`npm run eval -- --report` totals rather than refusing.~~ It totals.
- ~~H1 has a pass/fail against **≥10/12 with the objective scoring 2**.~~
  **One pass in four** — lisbon-thread 11/12; monitor-shortlist at 10/12 died
  on the objective gate; both partnerships 7/12.
- ~~H3 has a pass/fail against **every required stop caught, at most one false stop
  across the corpus**.~~ **FAIL — one missed stop**: partnership-messy filed
  its sealed question inline in the document instead of raising it.
- ~~`README.md`'s *"no hypothesis has a number yet"* is struck and dated.~~
  Struck there, in `AGENTS.md`, and in `docs/ROADMAP.md`, the same day — along
  with the baseline finding the README now carries, because step 5's answer
  repeated and the todo's own words made that the most important result in the
  project.

---

## What this does not cover

- **H2 cannot be scored here and it is the one that matters most.**
  `renderH2FromRuns` prints *"ZERO of them decided — a fixture cannot accept
  anything"*. H2 is `accepted / (accepted + rejected)` and a fixture accepts
  nothing. It needs a person using the product on real work, which is what
  [`01`](./01-menu-bar-app.md) and [`03`](./03-document-loop.md) are for.
- **`budget-exhausted` is unreachable.** The drive freezes the clock, so no
  scenario can expect it.
- **ADR-0007's `information-missing` stop class still has no scenario at all.**
- ~~**And as of 2026-09-01 neither does `structural`, which is new and is a
  regression in coverage rather than an omission.**~~ **Closed 2026-09-03 by
  `evening-classes`** ([#143](https://github.com/smukhyala/propositum/issues/143)).
  The struck argument is kept below because it is what produced the fixture.
  `lisbon-thread` filled that
  class by predicting the `no-progress` halt a research-only run hit on its
  third read. [Issue #101](https://github.com/smukhyala/propositum/issues/101)
  ruled that halt a false stop and removed it, so the fixture names no rule now
  and the class is empty again — the exact state that fixture was written to
  end.

  ~~**`scoreH3`'s `wrong-rule` branch is half-lost, not lost.**~~ **Whole again,
  2026-09-03.** The re-sealed
  fixture predicts an explicit *no rule fires*, and `scoreH3` scores that as the
  prediction it is, so *a rule fired that should not have* is reachable through
  it. ~~What no fixture can reach is *the rule I named did not fire*, because
  none names one.~~ **`evening-classes` names `action-limit`, so that direction
  fires too.**

  It cannot be repaired by editing `lisbon-thread`. Nothing else is in reach for
  it: three approved sources against `MAX_ACTIONS_PER_RUN`, three reads against
  that scenario's own `timeLimitMinutes`. Sealing a rule it *might* hit is the
  guess the blind protocol exists to prevent.

  ~~What is owed is a scenario **constructed** to hit a limit — an afternoon with
  more to read than the action cap allows, or one whose budget genuinely runs
  out.~~ **Written 2026-09-03, and it is the first of those two shapes.**
  `evening-classes` is an autumn prospectus whose index carries no times and no
  fees, so every course page has to be opened, and it approves more of them than
  `MAX_ACTIONS_PER_RUN` permits actions — the run halts with courses unread.
  The second shape, a budget that genuinely runs out, is **still owed and still
  blocked** by the frozen clock recorded two bullets above.
  ~~The gap is pinned in
  `tests/eval.test.ts`, which asserts the class is empty and says in its own
  docblock to turn the assertion back the right way round when it is not, and
  it is ticketed as
  [#143](https://github.com/smukhyala/propositum/issues/143).~~ **That test was
  turned round in the same change, and it now drives the fixture to the cap on
  the free path rather than asserting a label.**

  **It is sealed and UNSCORED.** No entry exists for it in `eval-scores.json`,
  no run has ever driven it against a real model, and it is the most expensive
  scenario in the corpus by construction — about $1.40 on its own, because a
  fixture measuring a limit has to reach one.
- **Nobody ratifies the agreement in the harness.** It accepts what the handoff
  boundary drafted, unedited — so handoff correction rate stays unmeasured.
- **Re-entry quality** — *can the person resume within about a minute* — is
  never measured. H1 is a proxy for it and is not evidence of it.

**One thing got cheaper on 2026-08-26.** `npm run seed:shift` writes a finished
shift with an open question in under a second, and `npm run seed:offer` replays
an afternoon through the real detector. Neither scores anything and neither
belongs in the corpus — a seeded run is not a measurement. What they buy is the
ability to look at the re-entry screen without spending twenty minutes and a
handful of model calls first, which is the practical reason the H1 scoring pass
has been easy to put off.
