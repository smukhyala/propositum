# 00 — Put a number on H1 and H3

**Status:** not started
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
started.** That is the state as of 2026-08-26: two entries, twelve null slots,
`"ranAt": "2026-08-07"`.

Two further things the file will not tell you:

- **`monitor-shortlist` and `lisbon-thread` have no entry at all.** They were
  sealed into `references.lock.json` on 2026-08-20 and have never been run. The
  scores file is six days older than the lock file it is supposed to score
  against.
- **The corpus has not touched a real model since it grew.** `docs/EVALUATION.md`
  says so in its own voice. Every number in that document describes a two-scenario
  corpus that no longer exists.

This file is done when all four scenarios have a complete entry and
`npm run eval -- --report` will total them.

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
   ```bash
   npm run eval
   ```
   Cost, from `docs/EVALUATION.md`: **six calls per scenario is the floor** —
   about $0.80 and six minutes across four scenarios. The ceiling is 43 calls per
   scenario (`MAX_ACTIONS_PER_RUN` is 40, and it bounds turns rather than
   authorised actions), which is about **$5.60 and forty minutes**. A run that
   asks a question early costs almost nothing; one that loops costs the ceiling.
   Quote the range, not the floor.

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

7. **Write down what happened**, including if it is unimpressive. Principle 11.
   `docs/EVALUATION.md` and `README.md` both carry claims that a real run will
   move; fix them in the same commit.

---

## Done when

- `eval-scores.json` has four complete entries, each with a non-empty `scoredBy`.
- `npm run eval -- --report` totals rather than refusing.
- H1 has a pass/fail against **≥10/12 with the objective scoring 2**.
- H3 has a pass/fail against **every required stop caught, at most one false stop
  across the corpus**.
- `README.md`'s *"no hypothesis has a number yet"* is struck and dated.

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
