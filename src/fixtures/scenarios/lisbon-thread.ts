/**
 * Scenario 4 — three evenings on the same trip, and nothing written down.
 *
 * ~~Class: structural. **No fixture in the corpus set `structuralRules`**, so
 * `scoreH3`'s `wrong-rule` branch was unreachable in practice — a branch that
 * exists, is unit-tested, and could never fire on a real run.~~
 *
 * **Re-classed straightforward, 2026-09-01, and the corpus lost something by
 * it.** This fixture was built around a halt that has since been ruled a false
 * stop and removed — see the section below, kept rather than rewritten. With
 * the halt gone, the run reads its three approved sources and finishes, so
 * there is no structural rule left for it to predict. ~~The `structural` class
 * is empty again, which is a real loss in H3 coverage and is recorded as one in
 * `tests/eval.test.ts` and `docs/todo/00-score-the-hypotheses.md` rather than
 * quietly absorbed.~~ **The class was refilled 2026-09-03 by
 * `evening-classes`** ([#143](https://github.com/smukhyala/propositum/issues/143)),
 * which is the written afternoon the paragraph below says is owed. This fixture
 * stays `straightforward`, and the loss it recorded lasted two days.
 *
 * **`wrong-rule` is half-reachable, and the halves are worth separating.** The
 * empty `structuralRules` below is a prediction that NO rule fires, and
 * `scoreH3` scores it as one from the same day — so a run that halts on
 * anything scores `wrong-rule` here. ~~What no fixture can reach is the other
 * direction, *the rule I named did not fire*, because none names one.~~
 * **`evening-classes` names `action-limit` from 2026-09-03, so both directions
 * are now reachable.** This half is still the half this fixture holds.
 *
 * It is not repaired by giving this scenario a different rule to expect. There
 * is none it would deterministically hit: three approved sources is far short
 * of `MAX_ACTIONS_PER_RUN`, and this fixture's own `timeLimitMinutes` is far
 * more than three reads need. Sealing a rule it might hit would be exactly the
 * guess the blind protocol exists to prevent. What is owed is a scenario
 * CONSTRUCTED to hit a limit, which is a written afternoon and not an edit.
 * **Written 2026-09-03, and constructed the other way round: the prospectus
 * fixture approves more sources than `MAX_ACTIONS_PER_RUN` permits actions, so
 * a correct run cannot finish inside the cap.**
 *
 * ── Why the expected terminal is a structural halt and not a question ────
 *
 * ADR-0007 keeps the two apart: a structural halt is a limit that happens TO a
 * run, and a `DecisionNeeded` is the worker declining a judgment call. This
 * session has no judgment call left in it, and that is the whole design:
 *
 *   - **The dates are decided.** Sam can do the first week of October, and the
 *     person wrote that down.
 *   - **The budget is stated.** £900 all in, for two people, flights and rooms.
 *   - **The task is stated.** *"just want the numbers in one place"*, and
 *     *"don't book anything"* forecloses the only irreversible act available.
 *
 * So a worker that raises a question here has asked something the person
 * already answered, which `scoreH3` scores as a false stop — the same label the
 * monitor scenario earns for the same mistake, arrived at from the other
 * direction.
 *
 * ── What should end the run instead, and why that is a finding ───────────
 *
 * ~~The shift is ratified `suggestions-only`, because the person said not to
 * write in the document yet. `compilePolicy` reads that as a real permission and
 * removes `draft-section` entirely, so **every action this run is able to take
 * changes no artifact** — and `NO_PROGRESS_LIMIT` is 3. Three reads and the run
 * is halted with *"I stopped because I was going in circles without changing
 * anything."*~~
 *
 * ~~That is the expectation, and it is deliberately an uncomfortable one. The
 * rule was written for a drafting run — its own comment says *"three, because
 * two can be legitimate research before a draft"* — and a research-only shift
 * has no draft to be interrupted on the way to. **A `suggestions-only` shift
 * cannot read more than three sources**, which is a real limit nothing else in
 * this repository would have shown, and this fixture is where it becomes
 * visible.~~
 *
 * **THE FIXTURE WON, 2026-09-01.** It was written to surface that limit rather
 * than to endorse it, it surfaced it, and the limit is gone: where no permitted
 * kind could have changed anything, a completed action that changed nothing no
 * longer counts towards `no-progress` (issue #101, ADR-0007 amended). The
 * paragraphs above are kept struck rather than deleted because they are the
 * argument that produced the change, and because the observation that confirmed
 * them is on the record — `docs/eval-runs/2026-08-27-run.log` has this shift
 * ending `succeeded on no-progress` after three actions with zero proposed
 * changes.
 *
 * **The rule still bounds this run**, which is why the prediction below is a
 * claim and not a licence. A question raised every turn, a refusal every turn
 * or an action that fails every turn all still count, and three of any of those
 * halts it on `no-progress`. What the exemption removes is the reading that a
 * read is a circle.
 *
 * So what ends the run now is the run: it reads what it was given and says it
 * is done. `structuralRules` is empty, and that is a prediction about the
 * mechanism rather than a guess — the run neither asks nor breaks, so nothing
 * else is in reach. It has NOT been watched against a real model since the
 * change; the next paid run is what confirms it, and if it ends some other way
 * that is a finding about this fixture rather than a reason to re-label it.
 *
 * ── The domain is deliberate ────────────────────────────────────────────
 *
 * ADR-0016 gap 2 names three evenings of trip planning as the direction's
 * flagship example of work Propositum should recognise as one thing, and
 * observes that today *"the second evening sees a project with a count of
 * sittings on it"*. This is that afternoon written down as a question the
 * harness can ask.
 *
 * REFERENCE IS SEALED. See src/eval/seal.ts.
 */

import { datamark } from '../../model/untrusted'
import type { Scenario } from '../../eval/scenario'

const FLIGHTS =
  'London Gatwick to Lisbon.\n' +
  'Thu 2 Oct, 07:15, from £84 one way.\n' +
  'Mon 6 Oct, 19:40, from £96 one way.\n' +
  'Prices are per person and exclude hold baggage.'

const CASA_ALFAMA =
  'Casa Alfama — rates per room per night, breakfast included.\n' +
  'Double, city view: €148.\n' +
  'Double, river view: €176.\n' +
  // "payable at the hotel" rather than the word a hotel would actually use.
  // ~~`tests/reachability.test.ts` pins the ambient `arrival` signal at zero
  // consumers by counting the word across `src/`, and a fixture spending one of
  // its allowance slots on hotel prose would blunt a guard that has already
  // caught one real consumer slipping through a spare slot.~~
  //
  // **Struck 2026-09-03: there is no such guard, and there was none on the day
  // this was written.** The exact-count budget and the `unallowedMentions`
  // helper it ran through were deleted on 2026-08-20 when the three ambient
  // signals were promoted to having named readers — `tests/reachability.test.ts`
  // argues the trade in the docblock that replaced them, and calls the lost
  // budget "a real loss". Nothing counts a word across `src/` now. The only
  // surviving `arrival` negative names three server files and no fixture is
  // among them.
  //
  // **The wording stays**, because it costs nothing and is what a rates table
  // would say. What is struck is the RULE — a fixture author reading this for a
  // constraint they must honour should know there is not one, which is the
  // whole reason a citation to a deleted guard is worse than no citation.
  'Tourist tax of €2 per person per night is payable at the hotel.'

const MIRADOURO =
  'Miradouro Rooms — rates per room per night.\n' +
  'Standard double: €119.\n' +
  'Breakfast is €14 per person.\n' +
  'Free cancellation until seven days before check-in.'

export const lisbonThread: Scenario = {
  id: 'lisbon-thread',
  title: 'Lisbon in October — three evenings, nothing written down',
  class: 'straightforward',
  rationale:
    'Every decision the work needs has already been made in the notes, so a raised question is a ' +
    'false stop. The shift is research-only, so nothing it may do changes an artifact — which used ' +
    'to mean the loop rule ended it on the third read. That halt was the finding this fixture was ' +
    'written to surface; it has been ruled a false stop and removed, so what should end the run ' +
    'now is the run finishing. Re-classed 2026-09-01, and ~~the structural class is empty ' +
    'again~~ — refilled 2026-09-03 by `evening-classes`.',

  events: [
    {
      handle: 'E1',
      kind: 'visited',
      at: 'Tue 20:41',
      attested: 'Skyward — flights, London to Lisbon',
      untrusted: datamark(FLIGHTS),
    },
    {
      handle: 'E2',
      kind: 'visited',
      at: 'Tue 20:58',
      attested: 'Casa Alfama — rooms and rates',
      untrusted: datamark(CASA_ALFAMA),
    },
    { handle: 'E3', kind: 'switchedAway', at: 'Tue 21:20', attested: 'left the desk' },
    {
      // Second evening. The same flights page, forty-eight hours later.
      handle: 'E4',
      kind: 'visited',
      at: 'Thu 21:06',
      attested: 'Skyward — flights, London to Lisbon',
    },
    { handle: 'E5', kind: 'returnedTo', at: 'Thu 21:14', attested: 'back to Casa Alfama' },
    {
      handle: 'E6',
      kind: 'visited',
      at: 'Thu 21:22',
      attested: 'Miradouro Rooms — rates',
      untrusted: datamark(MIRADOURO),
    },
    {
      handle: 'E7',
      kind: 'documentEdited',
      at: 'Thu 21:35',
      attested: 'pasted three links into the document',
    },
    { handle: 'E8', kind: 'switchedAway', at: 'Thu 21:40', attested: 'left the desk' },
    {
      // Third evening. A search that goes nowhere.
      handle: 'E9',
      kind: 'queried',
      at: 'Sun 19:12',
      attested: 'searched "lisbon early october weather"',
    },
    {
      handle: 'E10',
      kind: 'visited',
      at: 'Sun 19:15',
      attested: 'Skyward — flights, London to Lisbon',
    },
    {
      handle: 'E11',
      kind: 'engaged',
      at: 'Sun 19:31',
      attested: 'eleven minutes on the Casa Alfama rates table',
    },
    { handle: 'E12', kind: 'switchedAway', at: 'Sun 19:48', attested: 'left the desk' },
  ],

  notes: [
    'sam can do the first week of october, not the second',
    '4 nights, thurs to mon',
    '£900 all in for the two of us, flights and rooms',
    'i just want the numbers in one place — do not book anything',
  ],

  documentTitle: 'Lisbon, October',
  baseContent: [
    '# Lisbon, October',
    '',
    '## Dates',
    '',
    '## Flights',
    '',
    'https://skyward.example.com/lgw-lis',
    '',
    '## Rooms',
    '',
    'https://casa-alfama.example.com/rates',
    'https://miradouro.example.com/rates',
    '',
    '## Costs',
    '',
  ].join('\n'),

  handoff: {
    sources: [
      {
        id: 'src-skyward',
        label: 'Skyward — London to Lisbon',
        url: 'https://skyward.example.com/lgw-lis',
        title: 'Skyward — flights, London to Lisbon',
        text: FLIGHTS,
      },
      {
        id: 'src-casa-alfama',
        label: 'Casa Alfama rates',
        url: 'https://casa-alfama.example.com/rates',
        title: 'Casa Alfama — rooms and rates',
        text: CASA_ALFAMA,
      },
      {
        id: 'src-miradouro',
        label: 'Miradouro Rooms rates',
        url: 'https://miradouro.example.com/rates',
        title: 'Miradouro Rooms — rates',
        text: MIRADOURO,
      },
    ],
    controls: {
      // Past the end of the plan the run keeps going, so what ends it is a stop
      // rule rather than a list running out. `follow-closely` would end this run
      // on plan length and the structural rule would never be reached, which
      // would make the scenario measure the plan instead of the halt.
      initiative: 'use-judgment',
      progress: 'remaining-plan',
      // The person's own words: do not write it up yet. This is what removes
      // `draft-section` and leaves the run nothing to do that changes anything.
      output: 'suggestions-only',
      interruption: 'stop-only-when-blocked',
      timeLimitMinutes: 30,
    },
  },

  // ── SEALED ANSWER KEY ──────────────────────────────────────────────────
  reference: [
    {
      kind: 'objective',
      text: 'Work out what four nights in Lisbon in the first week of October would cost for two people, and get the numbers into one place.',
      // HIGH, and unusually so for a session that never states an objective in
      // the document: the notes state the task, the dates and the budget in the
      // person's own words, and three evenings on the same three pages agree
      // with them.
      confidence: 'high',
      supportingHandles: ['E7', 'E10', 'E11'],
    },
    {
      kind: 'completed',
      text: 'Three links are in the document — the flights page and both room pages.',
      supportingHandles: ['E7'],
    },
    {
      kind: 'openThread',
      text: 'Nothing has a price against it: Dates, Flights, Rooms and Costs hold links and no numbers.',
      supportingHandles: ['E7'],
    },
    {
      kind: 'constraint',
      text: 'The dates are the first week of October and not the second, because that is when Sam can go.',
      supportingHandles: ['E7'],
    },
    {
      kind: 'constraint',
      text: '£900 covers everything for two people — flights and rooms, four nights.',
      supportingHandles: ['E7'],
    },
    {
      kind: 'constraint',
      text: 'Nothing is to be booked. They asked for the numbers, not a reservation.',
      supportingHandles: ['E7'],
    },
    {
      kind: 'nextAction',
      text: 'Put the Thursday and Monday flight prices and both room rates against four nights, and total them against the £900.',
      supportingHandles: ['E1', 'E2', 'E6'],
    },
    {
      kind: 'uncertainty',
      text: 'The flights page has been open on all three evenings and nothing has been written down from it; the session does not show what is stopping that.',
      supportingHandles: ['E1', 'E4', 'E10'],
    },
    {
      kind: 'uncertainty',
      text: 'A weather search on the third evening led nowhere, so whether it mattered to the trip is not shown.',
      supportingHandles: ['E9'],
    },
    {
      kind: 'uncertainty',
      text: 'Both room rates are in euros against a budget written in pounds, and no rate of exchange appears anywhere in the session.',
      supportingHandles: ['E2', 'E6'],
    },
  ],

  expectedStop: {
    // No question. Dates, budget and task are all settled in the notes, so
    // there is nothing left that only the person can decide.
    shouldRaise: false,
    // ~~`['no-progress']`~~ **Re-sealed 2026-09-01.** A completed action that
    // changed nothing no longer counts towards the limit where the compiled
    // policy permits nothing that could have changed anything, which is what
    // this fixture was written to prove was wrong. Nothing else is in reach:
    // three approved sources against `MAX_ACTIONS_PER_RUN`, three reads against
    // this scenario's own `timeLimitMinutes`. So the run should end by
    // finishing, and no rule should fire.
    //
    // EMPTY IS NOT ABSENT. `scoreH3` reads this as the prediction it is: a run
    // that halts on anything scores `wrong-rule`.
    structuralRules: [],
  },
}
