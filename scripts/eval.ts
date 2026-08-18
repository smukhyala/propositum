/**
 * The evaluation harness CLI.
 *
 *   npm run eval -- --seal            seal any unsealed references
 *   npm run eval -- --check           verify every seal, run nothing
 *   npm run eval -- --dry             run against a fake model (no cost)
 *   npm run eval                      run against the real model
 *   npm run eval -- --baseline        also run the raw-log baseline
 *   npm run eval -- --worksheet       create blank score slots in eval-scores.json
 *   npm run eval -- --report          apply the H1 gates to what you have scored,
 *                                     compute H2 from the database, and print the
 *                                     offer rate beside it
 *
 * Produces a scoring worksheet per scenario. It does not produce H1 scores —
 * those are entered by a person, because a model judge shares the generator's
 * blind spots and at n=1 there is no second signal to catch that.
 *
 * ── H1 and H2 are measured from different places, on purpose ─────────────
 *
 * H1 is scored against sealed references on fixtures, so it never touches the
 * application database. H2 cannot be: acceptance is what a real person did to
 * real work, and the only record of that is `ChangeVerdict` and
 * `OutcomeVerdict` rows in SQLite. So `--report` opens the database and every
 * other path here still does not. That is a genuine asymmetry rather than an
 * inconsistency — a fixture cannot accept anything.
 *
 * ── And a third thing, which is measured and never scored ────────────────
 *
 * *(Added 2026-08-18.)* `--report` also prints the offer rate: how often
 * Propositum spoke, how much watching produced it, how often somebody said "Not
 * now", and how many strands it found and did not show.
 * `docs/PRODUCT_PRINCIPLES.md` §13 said *"there is no metric anywhere that would
 * catch an offer rate creeping upward"*, and this is that metric. It is read off
 * `offer_tally`, which holds four integers per day and nothing about what any
 * offer was concerned with.
 *
 * It carries no pass mark and cannot change the exit code — `src/eval/offer-rate.ts`
 * argues why, and the short version is that the only published calibration is
 * per session while this is per hour.
 */

import { createModelClient, modelId } from '../src/model/provider'
import { FakeModelClient } from '../src/model/fake'
import type { ModelClient } from '../src/model/client'
import { SCENARIOS } from '../src/eval/index'
import { checkSeal, readSeals, sealNew, writeSeals } from '../src/eval/seal'
import { renderWorksheet, runScenario } from '../src/eval/run'
import { blankEntry, isComplete, readScores, resultFor, writeScores } from '../src/eval/record'
import { H1_COMPONENTS } from '../src/eval/scenario'
import { H2_PASS_RATE, reportH2, tallyH2 } from '../src/eval/score'
import { OFFER_RATE_CAUTION, reportOfferRate } from '../src/eval/offer-rate'
import { createDatabase } from '../src/persistence/client'
import { createRepositories } from '../src/persistence/repositories/index'
import type { Repositories } from '../src/persistence/repositories/index'

try {
  process.loadEnvFile('.env')
} catch {
  /* --dry and --seal need no key */
}

const args = new Set(process.argv.slice(2))
const wantsBaseline = args.has('--baseline')

/* ── --check ────────────────────────────────────────────────────────────── */

if (args.has('--check')) {
  const seals = readSeals()
  let bad = 0

  for (const scenario of SCENARIOS) {
    const status = checkSeal(scenario, seals)
    const label =
      status.state === 'sealed'
        ? `sealed ${status.sealedAt}`
        : status.state === 'unsealed'
          ? 'UNSEALED'
          : `BROKEN (sealed ${status.sealedAt})`
    if (status.state === 'broken') bad += 1
    console.log(`  ${status.state === 'sealed' ? '✓' : '✗'} ${scenario.id.padEnd(24)} ${label}`)
  }

  if (bad > 0) {
    console.error(`\n${bad} broken seal(s). H1 scores from these scenarios are not admissible.`)
    process.exit(1)
  }
  process.exit(0)
}

/* ── --worksheet ────────────────────────────────────────────────────────── */

if (args.has('--worksheet')) {
  const scores = readScores()
  const ranAt = new Date().toISOString().slice(0, 10)
  // The same read the client makes, rather than a second copy of the same two
  // strings. A worksheet is a protocol record: every reported number carries the
  // model it was produced by, and a worksheet that names a model the harness was
  // never configured to call is worse than one with the field left blank.
  const model = modelId()
  let added = 0

  for (const scenario of SCENARIOS) {
    if (scores[scenario.id] && !isComplete(scores[scenario.id]!)) continue
    if (scores[scenario.id]) continue
    scores[scenario.id] = blankEntry(ranAt, model)
    added += 1
  }

  writeScores(scores)
  console.log(
    added
      ? `Added ${added} blank slot(s) to eval-scores.json. Fill in 0/1/2 per component and your name in scoredBy.`
      : 'eval-scores.json already has a slot for every scenario.',
  )
  console.log('\nRubric (docs/MVP.md):')
  console.log('  0 = wrong, absent, or invented   1 = partial   2 = matches the reference')
  console.log('  Pass needs total >= 10/12 AND objective = 2.')
  process.exit(0)
}

/* ── H2 and the offer rate, read off the durable database ────────────────── */

/**
 * The acceptance rate, computed from rows rather than from a worksheet.
 *
 * ── Why this is allowed to say "nothing yet" and mean it ─────────────────
 *
 * A metric that reads `0.0%` when the truth is *nobody has decided anything* is
 * worse than no metric, because the two are indistinguishable on the line where
 * someone reads them and only one of them is evidence about the product. So the
 * empty case is a sentence, not a number, and the counts beside every real
 * number say what was left out of it.
 *
 * This file used to say that and then not do it: it printed the sentence and
 * returned `failed` anyway, off a `scoreH2` call on a tally that had already
 * had the undecided units excluded. The judgment now lives in `reportH2` in
 * `src/eval/score.ts`, where it can be tested, and everything here prints.
 *
 * ── And why a missing database is not a failure ──────────────────────────
 *
 * `--report` is also how a person checks H1 scores they typed on a machine that
 * may have no database at all. An H1 report that exits non-zero because SQLite
 * was absent would teach everyone to ignore the exit code.
 */
async function printH2(repos: Repositories): Promise<'passed' | 'failed' | 'nothing-to-score'> {
  console.log('\nH2 — acceptance over the durable trajectory')

  {
    const units = await repos.outcomes.trajectory()
    // Read off the accepted contract rather than off the production, because a
    // Shift that made nothing leaves no production to be read. `trajectory()`
    // alone cannot see the case MVP.md names as the H2 failure.
    const barrenShifts = await repos.contracts.barrenShifts()
    const trajectory = tallyH2(units)
    const report = reportH2(trajectory, barrenShifts)

    if (trajectory.outputMode === null && report.barren === 0 && report.unfinished === 0) {
      console.log('  · no decidable units yet — no Shift in this database has produced one.')
      console.log('    Reported as an absence rather than as 0%, which would be a different claim.')
      return 'nothing-to-score'
    }

    if (report.result === null && trajectory.units === 0) {
      // Reached only when a Shift finished or died without producing anything,
      // so there is a corpus to talk about and no units in it.
      console.log('  ·  no decidable units — no Shift in this database has produced one.')
    } else if (report.result === null) {
      // Not a rate. Every unit is waiting on the person, and calling that 0%
      // would read as "everything was rejected" — the reading MVP.md's
      // undecided exclusion exists to prevent.
      console.log(
        `  ·  nothing decided yet — ${trajectory.units} unit(s), none of them decided. Not scored.`,
      )
    } else {
      const rate = `${(report.result.rate * 100).toFixed(1)}%`
      console.log(
        `  ${report.result.passed ? '✓' : '✗'}  ${rate} kept — ${report.kept} of ${report.decided} decided unit(s), pass needs ${(H2_PASS_RATE * 100).toFixed(0)}%`,
      )
      console.log(
        `       accepted ${trajectory.tally.accepted} · edited and kept ${trajectory.tally.editedAndKept} · rejected ${trajectory.tally.rejected}`,
      )
    }

    // Everything the rate is NOT measured over, always printed, including when
    // it is zero — a number whose exclusions are shown only when they are
    // interesting is a number whose reader has to guess which kind they are
    // looking at.
    console.log(
      `       ${report.waiting} waiting on you · ${trajectory.neverDecidable} landed and excluded from the denominator`,
    )
    if (report.barren > 0) {
      console.log(
        `       ✗ ${report.barren} draft-changes Shift(s) finished and produced nothing decidable — docs/MVP.md scores that zero`,
      )
    }
    if (report.unfinished > 0) {
      console.log(
        `       ⚠ ${report.unfinished} Shift(s) ended without finishing — counted here, never scored as a zero`,
      )
    }
    if (trajectory.unrecognised > 0) {
      console.log(
        `       ⚠ ${trajectory.unrecognised} verdict(s) in a spelling this harness does not read — see tallyH2`,
      )
    }

    const shifts = new Set(units.map((u) => u.contractId))
    const withIntention = new Set(
      units.filter((u) => u.intentionId !== null).map((u) => u.contractId),
    )
    const produced = units.map((u) => u.producedAt.toISOString().slice(0, 10))
    console.log(
      `       across ${shifts.size} shift(s), ${withIntention.size} of them advancing a stated Intention`,
    )
    if (produced.length) console.log(`       produced ${produced[0]} → ${produced[produced.length - 1]}`)
    if (trajectory.outputMode !== null) {
      console.log(
        `       scored as ${trajectory.outputMode} — the corpus is forgiven a zero only if no contract in it could draft changes`,
      )
    }

    return report.verdict
  }
}

/* ── the offer rate, read off the same database ──────────────────────────── */

/**
 * How often Propositum spoke, and how much watching produced it.
 *
 * ── Printed, never scored ────────────────────────────────────────────────
 *
 * This returns nothing and cannot change the exit code, which is deliberate and
 * argued in `src/eval/offer-rate.ts`: the only published calibration is per
 * SESSION and these are per HOUR, and inventing the conversion factor to make a
 * gate work would produce a threshold nobody could defend and a habit of raising
 * it. H1 and H2 have pass marks because `docs/MVP.md` set them before anybody
 * ran anything. This has none because nothing has.
 *
 * ── Why the per-day column is the point ──────────────────────────────────
 *
 * §13's hole is an offer rate *creeping upward*. A single total cannot show a
 * change over time, so the totals are the summary and the days are the finding.
 * Somebody reading down that column is the whole enforcement mechanism, which is
 * weaker than a test and is what there is.
 */
async function printOfferRate(repos: Repositories): Promise<void> {
  console.log('\nOffer rate — how often Propositum spoke, and after how much watching')

  /**
   * A missing TABLE is tolerated the same way a missing DATABASE is.
   *
   * `offer_tally` arrived on 2026-08-18, and a database created before that has
   * every H1 and H2 row this command exists to print and no tally at all.
   * Crashing there would take the whole report down over the one section that
   * has no pass mark, which is the same trade `printFromTheDatabase` already
   * refuses one level up.
   */
  let days
  try {
    days = await repos.offerTally.all()
  } catch (error) {
    // The LAST line of a Prisma error, not the whole thing: it prints the
    // failing query with line numbers and file paths, and the reason a person
    // needs is the sentence at the bottom of it.
    const said = (error instanceof Error ? error.message : String(error))
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
    console.log(`  · no counts to read — ${said[said.length - 1] ?? 'unknown error'}`)
    console.log('    A database older than 2026-08-18 has no offer_tally. `npx prisma db push`,')
    console.log('    then restart the app and the worker so the append-only guards are reinstalled.')
    return
  }

  const report = reportOfferRate(days)

  if (report.days === 0) {
    // The ordinary state until somebody uses the product, and an absence rather
    // than a zero for `scoreH2`'s reason: "0 offers per hour" and "nothing has
    // ever been counted" are different claims about the product.
    console.log('  ·  nothing counted yet — no browsing has been observed by this database.')
    console.log('     Not 0 offers per hour, which would be a different claim.')
  } else {
    const rate =
      report.perObservedHour === null
        ? 'no observed browsing to divide by'
        : `${report.perObservedHour.toFixed(2)} offers per hour of observed browsing`
    const declined =
      report.declineRate === null
        ? 'nothing shown, so no decline rate'
        : `${(report.declineRate * 100).toFixed(0)}% declined`

    console.log(`  ·  ${rate}`)
    console.log(
      `       ${report.offersShown} shown · ${report.offersDeclined} declined (${declined}) · ${report.strandsSuppressed} detected and not shown`,
    )
    console.log(
      `       over ${report.observedMinutes} observed minute(s) across ${report.days} day(s), ${report.firstDay} → ${report.lastDay}`,
    )
    // A strand cut by MAX_THREADS_SHOWN is the one ADR-0008 calls worse than not
    // finding it. Said out loud when it happens, because a number in a row of
    // four is easy to read past.
    if (report.strandsSuppressed > 0) {
      console.log(
        `       ⚠ ${report.strandsSuppressed} strand(s) cleared the bar and were cut by MAX_THREADS_SHOWN`,
      )
    }

    console.log(`\n     the last ${report.recent.length} day(s) — read this column, not the total:`)
    for (const day of report.recent) {
      const perHour = day.perObservedHour === null ? '   —  ' : day.perObservedHour.toFixed(2)
      console.log(
        `       ${day.day}  ${perHour} /h   ${day.offersShown} shown · ${day.offersDeclined} declined · ${day.strandsSuppressed} cut · ${day.observedMinutes} min observed`,
      )
    }
  }

  console.log('')
  for (const line of OFFER_RATE_CAUTION) console.log(`     ${line}`)
}

/**
 * Open the database once, print everything that is read from rows, close it.
 *
 * ── And why a missing database is still not a failure ────────────────────
 *
 * `--report` is also how a person checks H1 scores they typed on a machine that
 * may have no database at all. An H1 report that exits non-zero because SQLite
 * was absent would teach everyone to ignore the exit code. The verdict returned
 * is H2's alone: the offer rate has no pass mark to contribute.
 */
async function printFromTheDatabase(): Promise<'passed' | 'failed' | 'nothing-to-score'> {
  let db
  try {
    // `createDatabase` rather than a bare PrismaClient: it is the only handle
    // that installs the append-only guards, and it refuses rather than hands
    // back an unguarded one. A read-only caller has no excuse to be the first
    // exception to that.
    db = await createDatabase({})
  } catch (error) {
    console.log('\nH2 — acceptance over the durable trajectory')
    console.log(`  · no database to read — ${error instanceof Error ? error.message : String(error)}`)
    console.log('    H1 above is unaffected: it is scored against sealed fixtures.')
    return 'nothing-to-score'
  }

  try {
    const repos = createRepositories(db.prisma)
    const verdict = await printH2(repos)
    await printOfferRate(repos)
    return verdict
  } finally {
    await db.close()
  }
}

/* ── --report ───────────────────────────────────────────────────────────── */

if (args.has('--report')) {
  const scores = readScores()
  let anyIncomplete = false
  let anyFailed = false

  for (const scenario of SCENARIOS) {
    const entry = scores[scenario.id]
    if (!entry) {
      console.log(`  ·  ${scenario.id.padEnd(24)} not scored — run --worksheet`)
      anyIncomplete = true
      continue
    }

    const result = resultFor(scenario.id, entry)
    if (!result) {
      const missing = H1_COMPONENTS.filter((c) => entry.h1[c] === null)
      const why = missing.length ? `unscored: ${missing.join(', ')}` : 'scoredBy is empty'
      console.log(`  ·  ${scenario.id.padEnd(24)} incomplete — ${why}`)
      anyIncomplete = true
      continue
    }

    const mark = result.passed ? 'PASS' : 'FAIL'
    if (!result.passed) anyFailed = true
    console.log(`  ${result.passed ? '✓' : '✗'}  ${scenario.id.padEnd(24)} ${mark}  ${result.total}/12`)
    for (const reason of result.failureReasons) console.log(`       ${reason}`)
    if (entry.baselineAtLeastAsGood === true) {
      console.log('       ⚠ baseline judged at least as good — SessionReading may not be earning its place')
    }
    if (entry.notes) console.log(`       note: ${entry.notes}`)
  }

  const h2 = await printFromTheDatabase()

  console.log(
    '\nEvery H1 number above is n=1, scored by the person who wrote the answer key,' +
      '\nagainst references sealed before the run. H2 is not scored by anyone: it is' +
      '\nread off verdicts a person recorded while using the product, over whatever' +
      '\nwindow that database happens to cover. Report both with that attached.',
  )
  process.exit(anyIncomplete || anyFailed || h2 === 'failed' ? 1 : 0)
}

/* ── --seal ─────────────────────────────────────────────────────────────── */

if (args.has('--seal')) {
  // Timestamp passed in rather than read inside the module, so the lock stays
  // reproducible in tests.
  const now = new Date().toISOString()
  const { seals, newlySealed, broken } = sealNew(SCENARIOS, now)

  if (broken.length) {
    console.error(
      `Refusing to re-seal: ${broken.join(', ')}\n\n` +
        'A broken seal means an answer key changed after it was written. Re-sealing ' +
        'discards the measurements it invalidates, so it has to be a deliberate edit ' +
        'to references.lock.json, not a flag.',
    )
    process.exit(1)
  }

  if (!newlySealed.length) {
    console.log('Nothing to seal — every reference is already sealed.')
    process.exit(0)
  }

  writeSeals(seals)
  console.log(`Sealed ${newlySealed.length}:`)
  for (const id of newlySealed) console.log(`  ${id}`)
  console.log('\nCommit references.lock.json. The answer keys are now fixed.')
  process.exit(0)
}

/* ── run ────────────────────────────────────────────────────────────────── */

const dry = args.has('--dry')
let client: ModelClient

if (dry) {
  // Enough scripted replies for one reading (plus a baseline) per scenario.
  // Deliberately thin: --dry proves the harness runs, nothing more.
  const replies = SCENARIOS.flatMap((s) => {
    const one = {
      kind: 'ok' as const,
      value: {
        claims: [
          {
            kind: 'objective' as const,
            text: `(fake reading for ${s.id})`,
            confidence: 'low' as const,
            evidence: [{ ref: s.events[0]?.handle ?? 'E1' }],
          },
        ],
      },
    }
    return wantsBaseline
      ? [one, { kind: 'ok' as const, value: { summary: '(fake baseline)', nextSteps: [] } }]
      : [one]
  })
  client = new FakeModelClient(replies)
} else {
  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) {
    console.error('No ANTHROPIC_API_KEY. Use --dry to exercise the harness without one.')
    process.exit(1)
  }
  // No `record`, and this is the one caller for which that is right. THE RUN
  // PATH is standalone — it never opens the application database — so there is
  // no repository to write a `ModelCallRecord` to. The scoring worksheet is
  // this path's traceability, and it is a better record than a row would be.
  //
  // That sentence used to be about the whole harness, and it stopped being true
  // when `--report` learned to compute H2: acceptance is what a person did to
  // real work, and no fixture can stand in for it. The narrowing is written
  // here rather than left for the next reader to notice, because a comment that
  // over-claims by one word is exactly how this file would come to describe a
  // harness it no longer is.
  client = createModelClient({ apiKey })
}

let exitCode = 0

for (const scenario of SCENARIOS) {
  try {
    const run = await runScenario(client, scenario, { withBaseline: wantsBaseline })
    console.log('\n' + renderWorksheet(run))
    if (run.failures.length) exitCode = 1
  } catch (error) {
    console.error(`\n${scenario.id}: ${error instanceof Error ? error.message : String(error)}`)
    exitCode = 1
  }
}

if (!dry) {
  console.log(
    '\nEnter the H1 component scores against the worksheets above.\n' +
      'Every reported number carries its protocol: n=1, references sealed before the run.',
  )
}

process.exit(exitCode)
