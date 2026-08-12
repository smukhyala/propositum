/**
 * Is the code that enforces our guarantees actually reachable?
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * An adversarial review found three pieces of correct, tested code that
 * NOTHING CALLED:
 *
 *   - `repos.reports.create` — so no ShiftReport or DecisionNeeded row was ever
 *     written, so the Accept-all guard the re-entry prototype exists to enforce
 *     could never fire. It would have demoed as fixed having never once run.
 *   - `runWorker` — so pressing Take over stranded the session in `away`
 *     forever, while the UI offered "Take back control".
 *   - `sessions.markObserving` — so the `away → observing` transition CONTEXT
 *     requires never happened.
 *
 * Every one passed typecheck and unit tests. Coverage of a function says
 * nothing about whether the product can reach it, and that gap is invisible in
 * a green suite.
 *
 * These are crude greps on purpose. A sophisticated check would need the thing
 * it is checking to already work.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dirs: string[], pattern = /\.tsx?$/): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (pattern.test(entry)) out.push(full)
    }
  }
  for (const d of dirs) walk(join(repo, d))
  return out
}

const PRODUCTION = sourceFiles(['src', 'scripts'])

/**
 * The extension, which this file could not see.
 *
 * `sourceFiles` walked only `src` and `scripts`, and only `.tsx?`. So the whole
 * extension was invisible to every check here — which is part of why
 * `content.js` was never registered by anything, and no test noticed while the
 * suite stayed green. A reachability guard with a blind spot the size of the
 * privacy-holding component is not a guard.
 */
const EXTENSION = sourceFiles(['extension'], /\.(js|html)$/)

/**
 * Strip comments before searching.
 *
 * Found the hard way: the first version of this file counted a COMMENT
 * mentioning `repos.reports.create` as a caller. Verifying the test by deleting
 * the real call showed it still passing — the file's own header comment about
 * the bug was keeping the test green. A reachability check that comments can
 * satisfy is worse than none, because it reads as proof.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * Strip imports too, for the same reason.
 *
 * Found the same way the comment bug was: removing the real `cleanUrl` calls
 * from the ledger writer left its `import { cleanUrl }` line behind, and the
 * grep counted that as a caller while three behavioural tests went red. An
 * unused import satisfying a reachability check is exactly the failure the
 * comment strip exists to prevent — a file that mentions a function is not a
 * file that runs it.
 */
function stripImports(source: string): string {
  return source
    .replace(/^\s*import\s[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, ' ')
    .replace(/^\s*import\s+['"][^'"]+['"]\s*;?\s*$/gm, ' ')
}

/** Files that CALL `needle` — in code, not in prose or an import — excluding
 *  its definition. */
function callersOf(needle: string, definedIn: string): string[] {
  return PRODUCTION.filter((f) => {
    if (relative(repo, f) === definedIn) return false
    return stripImports(stripComments(readFileSync(f, 'utf8'))).includes(needle)
  }).map((f) => relative(repo, f))
}

describe('the safety machinery is reachable from the product', () => {
  it('something writes a ShiftReport, or the Accept-all guard can never fire', () => {
    // The guard reads `decisions`, which comes from `reports.forContract`,
    // which returns nothing if nothing ever called `reports.create`.
    const callers = callersOf('reports.create', 'src/persistence/repositories/index.ts')

    expect(callers, 'no code path writes a ShiftReport — see tests/reachability.test.ts').not.toEqual([])
  })

  it('something calls runWorker, or Take over strands the session', () => {
    const callers = callersOf('runWorker', 'src/runtime/worker-loop.ts')

    expect(callers, 'runWorker has no caller — a handed-over session never completes').not.toEqual([])
  })

  it('something returns the session to the person', () => {
    // Without this the phase stays `away` forever and every control offering to
    // hand the work back is a promise the product cannot keep.
    const callers = callersOf('markObserving', 'src/persistence/repositories/index.ts')

    expect(callers, 'nothing calls markObserving — sessions never come back').not.toEqual([])
  })

  it('there is a way to actually start the worker', () => {
    const scripts = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).scripts as Record<
      string,
      string
    >

    expect(Object.keys(scripts)).toContain('worker')
  })

  it('the gate is reachable from the run path', () => {
    expect(callersOf('authorize(', 'src/policy/gate.ts')).not.toEqual([])
  })

  it('an accepted offer is written down, or nothing records why Propositum asked', () => {
    // A WorkOffer reaches SQLite at exactly one moment — acceptance — and the
    // `grounds` frozen onto it are the only durable answer to "why did it offer
    // me this". The ambient buffer that produced them is in memory and gone
    // inside thirty minutes, so if this write stopped happening the question
    // would become unanswerable rather than merely inconvenient.
    //
    // Promoted out of the deferred block when the accept path landed.
    expect(
      callersOf('offers.create', 'src/persistence/repositories/index.ts'),
      'nothing persists a WorkOffer — an accepted offer leaves no durable trace',
    ).toContain('src/server/actions.ts')
  })

  it('the offer path consults the grounds, or the higher bar binds nothing', () => {
    // `groundsFor` is the arithmetic that separates offering to DO work from
    // offering to name it — ADR-0009 §2. If `composeOffer` stopped consulting
    // it, every offer would be gated by `detectWork` alone — the LOW bar — and
    // the two-group rule would exist only in its own tests, which is exactly
    // the shape of the three defects at the top of this file.
    //
    // Promoted out of the deferred block when the offer boundary landed. It
    // must consult it BEFORE recording the attempt, so a thread that has not
    // qualified yet can still qualify later; that ordering is pinned in
    // tests/compose-offer.test.ts rather than here.
    expect(
      callersOf('groundsFor(', 'src/domain/detection/grounds.ts'),
      'nothing asks whether the grounds are sufficient — the higher bar binds nothing',
    ).toContain('src/server/compose-offer.ts')
  })

  it('the gate consults the reversibility classifier, or nothing is ever confirmed', () => {
    // The classifier is what turns "click this" into "ask them first". If the
    // gate stopped calling it, every proposal would sail through as ordinary
    // and the confirmation pause would exist only in its own tests — which is
    // precisely the shape of the three defects at the top of this file.
    expect(
      callersOf('classifyReversibility(', 'src/domain/execution/reversibility.ts'),
      'nothing classifies reversibility — no proposal can ever require confirmation',
    ).toContain('src/policy/gate.ts')
  })

  it('append-only guards are installed by something that runs', () => {
    // These existed and were tested for a week before anything called them.
    expect(callersOf('ensureAppendOnlyGuards', 'src/persistence/append-only.ts')).not.toEqual([])
  })

  it('events reach the ledger writer rather than a repository', () => {
    expect(callersOf('createLedgerWriter', 'src/persistence/ledger-writer.ts')).not.toEqual([])
  })

  it('a person can create a document, or the whole handoff path is unreachable', () => {
    // This one shipped broken. `documents.create` was correct, tested, and
    // called by nothing, so `draftContract` always returned "There is no
    // document in this project yet. Paste one in first" — pointing at an
    // affordance that did not exist. Everything downstream of the handoff was
    // dead code behind a refusal that read like a hint.
    const callers = callersOf('documents.create', 'src/persistence/repositories/index.ts')

    expect(callers, 'nothing creates a Document — draftContract can only ever refuse').not.toEqual(
      [],
    )
  })

  it('something writes a new version, or a document can never change', () => {
    const callers = callersOf('documents.addVersion', 'src/persistence/repositories/index.ts')

    expect(callers, 'nothing calls addVersion — the version chain never grows').not.toEqual([])
  })

  it('URLs are cleaned by something on the write path, not just in a test', () => {
    // `cleanUrl` was written, tested, and called by NOTHING for the whole build,
    // while `content.js` sent raw `location.href` and SECURITY_AND_PRIVACY.md
    // promised a cleaned URL. A tested function is not a kept promise.
    // The paren matters. Without it this matches the ledger writer's own
    // `cleanUrls` helper, so gutting the helper's body leaves the guard green —
    // caught while verifying this very test.
    const callers = callersOf('cleanUrl(', 'src/capture/url.ts')

    expect(callers, 'nothing calls cleanUrl — raw URLs reach the ledger').not.toEqual([])
    expect(
      callers,
      'cleanUrl must be called at the ledger door, so no caller can bypass it',
    ).toContain('src/persistence/ledger-writer.ts')
  })

  it('a finished review reaches the document, or the loop produces nothing', () => {
    // `materialise` had exactly one call site — the shift page's scale-label
    // recovery — and no code path ever wrote a version from a review. The
    // interface admitted it: "yours to fold into the document."
    //
    // Called `finishReview` until the fold stopped being the only way a Shift
    // could end. The assertion is the same one: the act that folds accepted
    // changes into a version must be reachable from a screen.
    expect(
      callersOf('finishShift(', 'src/server/actions.ts'),
      'nothing calls finishShift — decisions are recorded and discarded',
    ).not.toEqual([])
    expect(
      callersOf("origin: 'accepted-changeset'", 'src/persistence/repositories/index.ts'),
      'no code path writes an accepted-changeset version',
    ).not.toEqual([])
  })

  it('a run records what it produced, or a Shift can still only make a document', () => {
    // Moved up out of *deferred, and asserted as deferred* when the outcome
    // spine landed. The table's whole point is that the document path is one
    // kind among five; with no writer it was still the only kind, and a run that
    // read three pages and answered a question had nowhere to say so.
    const callers = callersOf('outcomes.create', 'src/persistence/repositories/index.ts')

    expect(callers, 'nothing writes a ShiftOutcome — a run can only produce a document').not.toEqual(
      [],
    )
    expect(
      callers,
      'the outcome writers must be the only caller, so kind and reversibility have one author',
    ).toEqual(['src/server/outcomes/index.ts'])
  })

  it('a person can decide on what a Shift made, or the outcome table is decoration', () => {
    // Moved up out of "deferred" when the re-entry screen learned to render
    // ShiftOutcomes. Without a caller, `OutcomeVerdict` is a table nobody can
    // write, and every held outcome that is not a document sits on the screen
    // with no way to accept or reject it — which would also strand
    // `finishShift`, since it refuses while anything held is undecided.
    expect(
      callersOf('outcomes.recordVerdict', 'src/persistence/repositories/index.ts'),
      'nothing records an OutcomeVerdict — a production cannot be accepted or rejected',
    ).not.toEqual([])
  })

  it('the reviewer actually runs, or assumption 4 stays unanswerable', () => {
    // `reviewBoundary` was built and tested with zero callers, and `runs.enqueue`
    // was only ever called with role 'worker'. docs/MVP.md assumption 4 asks
    // whether the reviewer earns its place; a reviewer that never runs makes
    // that unanswerable rather than answered.
    expect(callersOf('reviewBoundary(', 'src/model/boundaries/review.ts')).not.toEqual([])
    expect(
      callersOf("role: 'reviewer'", 'src/persistence/repositories/index.ts'),
      'no reviewer run is ever enqueued',
    ).not.toEqual([])
    expect(
      callersOf('findings.create(', 'src/persistence/repositories/index.ts'),
      'nothing persists a ReviewFinding',
    ).not.toEqual([])
  })

  /**
   * Every threshold the detector exports is read by something.
   *
   * `callersOf` cannot express this on its own, and the gap let two constants
   * sit in `detect.ts` for the whole build with no reader: `PAGES_FOR_WORK`,
   * naming a per-origin page bar that died when threads replaced origins, and
   * `PAGES_AFTER_QUERY`, naming a rule `detectWork` never applied. Both were
   * described in the surrounding comments as active. A threshold nothing
   * consults is worse than a missing one, because the comment beside it reads
   * as proof the bar exists — which is how a reviewer concludes the detector is
   * stricter than it is.
   *
   * A threshold is legitimately read inside its own file, so unlike everything
   * above this counts a use in the DEFINING file too. What it will not accept
   * is a constant that appears exactly once, at its own declaration.
   */
  it('every exported threshold in the detector is actually read', () => {
    const detection = PRODUCTION.filter((f) =>
      relative(repo, f).startsWith(join('src', 'domain', 'detection')),
    )

    const unread: string[] = []

    for (const file of detection) {
      const source = stripImports(stripComments(readFileSync(file, 'utf8')))

      for (const [, name] of source.matchAll(/export const (\w+)\s*[:=]/g)) {
        if (name === undefined) continue

        // Everything but the declaration itself. `\b` keeps `FAST_DETECT` from
        // being satisfied by `PROPOSITUM_FAST_DETECT`, and `PAGES_FOR_THREAD`
        // from standing in for `PAGES_FOR_WORK`.
        const elsewhere = source.replace(new RegExp(`export const ${name}\\s*[:=]`), ' ')
        const readAtHome = new RegExp(`\\b${name}\\b`).test(elsewhere)

        if (!readAtHome && callersOf(name, relative(repo, file)).length === 0) {
          unread.push(`${relative(repo, file)}: ${name}`)
        }
      }
    }

    expect(unread, 'a threshold nothing reads is a bar that does not exist').toEqual([])
  })

  it('the classifiers run in production, not only in their own tests', () => {
    // 205 lines of tested classification that no production file imported. The
    // extension re-implemented a thinner, wrong version inline instead.
    expect(callersOf('createNavigationClassifier(', 'src/capture/semantics.ts')).not.toEqual([])
    expect(callersOf('classifyEngagement(', 'src/capture/semantics.ts')).not.toEqual([])
    expect(callersOf('classifySelection(', 'src/capture/semantics.ts')).not.toEqual([])
  })

  it('an accepted offer leaves a durable trace, or nobody can ask why it was made', () => {
    // Moved up out of the deferred block below when `acceptWorkOffer` began
    // writing one — which is that block working as intended.
    //
    // `grounds` is the load-bearing column. It is the frozen record of WHAT THE
    // DETECTOR SAW, and it has to be frozen rather than recomputed because the
    // ambient buffer it came from is bounded by a thirty-minute window and a
    // 500-row cap. Without this row, "why did it offer me this" has no answer
    // an hour later, which is exactly when somebody asks it.
    expect(
      callersOf('offers.create', 'src/persistence/repositories/index.ts'),
      'nothing persists a WorkOffer — an accepted offer cannot be explained afterwards',
    ).not.toEqual([])
  })

  it('the grounds are computed by the product, not only by their own test', () => {
    // The second, higher bar (ADR-0009 §2). If nothing calls it, every offer is
    // composed on `detectWork` alone — the low bar meant for deciding whether
    // Propositum may SAY something — and the two-group rule exists only on
    // paper.
    expect(
      callersOf('groundsFor(', 'src/domain/detection/grounds.ts'),
      'nothing computes OfferGrounds — the bar for offering to act is not applied',
    ).not.toEqual([])
  })

  it('something composes an offer, or the model half of ADR-0009 is unreachable', () => {
    expect(
      callersOf('composeOffer(', 'src/server/compose-offer.ts'),
      'composeOffer has no caller — every offer degrades to the deterministic form forever',
    ).not.toEqual([])
  })

  it('the run path supplies the action counts, so the two caps actually bind', () => {
    /**
     * Promoted out of the deferred block when the continuing loop landed.
     *
     * `RunContext.actionsTaken` and `mutatingActionsTaken` default to `0` when
     * absent, which is the one place in that structure where an absent field
     * GRANTS rather than withholds: an unwired caller got exactly the
     * enforcement it had before the caps existed — none. So the caps were
     * compiled, refused correctly in their own unit tests, and bounded nothing
     * in the product. That is the shape of every defect at the top of this file.
     *
     * The counts come from `historyForContract`, which reads them off durable
     * `ActionIntent` rows rather than a counter held in a process — so they
     * survive the crash that this project's standing constraint makes routine,
     * and a continuation cannot get a fresh blast radius by being a fresh run.
     */
    expect(
      callersOf('mutatingActionsTaken', 'src/policy/gate.ts'),
      'nothing supplies the action counts — MAX_MUTATING_ACTIONS_PER_RUN bounds nothing',
    ).toContain('src/runtime/worker-loop.ts')
  })

  it('a pause is distinguished from a loop, or three questions look like circles', () => {
    /**
     * Promoted out of the deferred block with the loop.
     *
     * Without this filter on the refusal counter, a run that correctly asked
     * permission three times halts with *"I kept needing things the agreement
     * does not allow"* — at the exact moment the person was about to answer, and
     * about the one behaviour the confirmation pause exists to encourage.
     */
    expect(
      callersOf('PAUSING_RULES', 'src/domain/execution/stop-conditions.ts'),
      'nothing filters pausing refusals out of the loop counter',
    ).toContain('src/runtime/worker-loop.ts')
  })

  it('a dangling intent gets an outcome, or the ledger keeps a permanent unknown', () => {
    /**
     * `ActionOutcome.observedBy` has been specified in CONTEXT.md §4 since the
     * vocabulary was written, has been in the schema since wave 1, and had NO
     * WRITER — so a run that died between the effect and the outcome write left
     * a trailing `unknown` forever. Under the standing "a local worker stops
     * when the Mac sleeps" constraint that is routine rather than exotic.
     *
     * A column with no writer is the same defect as a function with no caller,
     * and it is worse in one way: the comment beside it describes a behaviour
     * that has never happened.
     */
    expect(
      callersOf('recoverOrphanedIntents(', 'src/runtime/history.ts'),
      'nothing writes a recovery outcome — an interrupted action stays unknown forever',
    ).not.toEqual([])
    // ...and it must reach the COLUMN, not just the interface. A recovery
    // outcome that stops at `RunLedger` and is dropped by the Prisma writer
    // would be a fix with no row behind it.
    expect(
      callersOf('observedBy', 'src/runtime/history.ts'),
      'observedBy never reaches action_outcome — the column still has no writer',
    ).toContain('src/server/execute-run.ts')
  })

  it('the loop rebuilds its history from rows, or resume forgets everything', () => {
    // One code path for resume, crash recovery and the startup sweep. A per-run
    // memory would forget the moment a confirmation pause ended one run and
    // started another — the agent would come back with no idea it had already
    // filled in half the form.
    expect(
      callersOf('historyForContract(', 'src/runtime/history.ts'),
      'nothing rebuilds a contract history — a continuation starts from nothing',
    ).toContain('src/runtime/worker-loop.ts')
    expect(
      callersOf('intentsForContract', 'src/runtime/history.ts'),
      'nothing supplies the rows, so every rebuilt history is empty',
    ).toContain('src/server/execute-run.ts')
  })

  it('the browser tools are reachable from the run path, or the six kinds cannot act', () => {
    /**
     * `ACTION_KINDS` gained six members in wave 2 and the loop threw on all of
     * them — a capability that existed in the vocabulary, passed the gate, and
     * could not be carried out. This is that gap closed, and it is asserted here
     * so it cannot silently reopen behind a refactor.
     *
     * Note what this does NOT assert: that any contract grants one. It does not.
     * `draftContract` grants `DOCUMENT_ACTION_KINDS`, so the gate refuses every
     * browser kind with `action_kind_not_allowed` before a tool is reached. The
     * tools are reachable from the loop; the loop is not yet reachable with a
     * browser kind in scope, and the panel in `src/ui/agreement.tsx` still tells
     * the truth because of it.
     */
    for (const tool of ['observePage(', 'clickElement(', 'typeText(', 'pressKey(', 'navigateTo(', 'captureScreen(']) {
      expect(
        callersOf(tool, 'src/policy/tools.ts'),
        `${tool} has no caller — the capability exists and nothing can carry it out`,
      ).toContain('src/runtime/worker-loop.ts')
    }
  })
})

/**
 * What is knowingly not wired.
 *
 * A guard that quietly omits what it cannot yet satisfy reads as proof of
 * coverage it does not have. These assert the CURRENT state — unreachable — so
 * that wiring one of them turns this file red and forces the claim to be moved
 * up into the section above rather than left ambiguous.
 *
 * Each is a real gap with a real consequence, named in the map's fog.
 */
describe('deferred, and asserted as deferred', () => {
  it('boundary 6 is still unwired, so the narrative is a stop-rule label', () => {
    // `execute-run` stores `narrative: stopLabel` — a consumer label rendered
    // where model prose belongs. Not wrong, but not what the field means.
    expect(
      callersOf('shiftReportBoundary(', 'src/model/boundaries/shift-report.ts'),
      'shiftReportBoundary is wired now — move this into the section above',
    ).toEqual([])
  })

  it('nothing polls for heartbeat silence, so that gap reason cannot occur', () => {
    // `sweepForGap` turns silence into a `captureGap` with reason
    // `service_worker_terminated`. With no caller, that reason is unreachable,
    // and so is `machine_slept` — two of the four are unwritable in slice 0.
    expect(
      callersOf('sweepForGap(', 'src/server/gap-sweeper.ts'),
      'the gap sweeper has a caller now — move this into the section above',
    ).toEqual([])
  })

  it('nothing credits pause time back, so a slow answer still eats the shift', () => {
    // Someone asked at 09:05 who answers at noon returns to a run whose budget
    // expired at 09:30. `deadlineFor` fixes that and nothing calls it yet.
    expect(
      callersOf('deadlineFor(', 'src/domain/execution/stop-conditions.ts'),
      'deadlineFor has a caller now — move this into the section above',
    ).toEqual([])
  })

  it('nothing reports a lost tab or an action limit, so two stop rules cannot fire', () => {
    // `control-lost` and `action-limit` are structural and deterministic, and
    // `evaluateStructuralStops` cannot raise either until a caller supplies
    // `controlLost` / `actionsTaken` on RunProgress.
    expect(
      callersOf('controlLost', 'src/domain/execution/stop-conditions.ts'),
      'something reports control loss now — move this into the section above',
    ).toEqual([])
  })

  it('no model call is recorded, so the ledger does not reconstruct them', () => {
    // Acceptance bullet 11 says the full ledger reconstructs what happened.
    // `model_call_record` has a table and append-only guards and no writer.
    // The hook exists — `AnthropicModelClient` takes `onCall`.
    expect(
      callersOf('modelCallRecord.create', 'src/persistence/repositories/index.ts'),
      'model calls are recorded now — move this into the section above',
    ).toEqual([])
  })

  /**
   * The computer-use tables, landed ahead of everything that uses them.
   *
   * Schema and repositories are one unit and the paths that write them are
   * several others, so for one commit these are tables with guards,
   * repositories with tests, and no callers — the exact shape of every bug the
   * section above exists to remember. Asserting the absence is what stops that
   * shape from being indistinguishable from the accident: each of these turns
   * this file RED the moment something calls it, which forces the claim up into
   * the reachable section rather than leaving it ambiguous.
   *
   * If you are here because one went red: that is the system working. Move it.
   */
  const repos = 'src/persistence/repositories/index.ts'

  it('an outcome-scoped ReviewFinding is written and not yet rendered', () => {
    /**
     * The reviewer can now annotate a whole production, not only one change.
     *
     * `review@2` shows it outcome handles `O1…On` with change handles nested
     * under the `document-changes` case, and the system prompt tells it to cite
     * the most specific handle it can. A finding that cites `O1` is stored with
     * `outcomeId` set and `changeId` null — and the only reader on the re-entry
     * screen is `findings.forChangeset`, which joins through `changeId` and
     * therefore cannot see it.
     *
     * So those rows exist and nobody is shown them. That is a real gap with a
     * real consequence: the second pass says something true about the set of
     * changes as a whole, and the person never reads it. It is asserted here
     * rather than left implicit, because a finding written and never rendered is
     * indistinguishable in a green suite from a finding never written — which is
     * the exact shape of every defect the section above exists to remember.
     *
     * The fix is on the render side and the query it needs already exists:
     * `findings.forRun` returns `outcomeId` beside `changeId`. Wiring it turns
     * this red.
     */
    expect(
      callersOf('findings.forRun', repos),
      'outcome-scoped findings are rendered now — move this into the section above',
    ).toEqual([])
  })

  it('nothing lands, so an external-effect outcome cannot occur', () => {
    /**
     * `LANDING_ACTION_KINDS` is EMPTY, and that is a claim rather than an
     * oversight.
     *
     * `ShiftOutcomeKind` has five members and `external-effect` is the only one
     * that is not `held` — the only one a person is offered no verdict on,
     * because it already happened out in the world. Nothing today can produce
     * one: every ActionKind that exists is a read or a draft, and even
     * `click-element`, which can press a page's own Send button, is not a
     * landing kind. Landing is about whose act put the effect into the world.
     *
     * So `src/server/outcomes/external-effect.ts` drops everything it is handed,
     * by design, and the drop is the enforcement rather than a fallback. The day
     * someone adds a landing kind this goes RED — which is the point. A mutating
     * capability whose effects leave Propositum is not a line in a set; it is a
     * person being shown work they cannot undo, and the claim has to move up
     * into the reachable section deliberately rather than slip in with the enum.
     */
    const policy = readFileSync(join(repo, 'src/domain/handoff/policy.ts'), 'utf8')
    const declaration = /LANDING_ACTION_KINDS[^=]*=\s*new Set<ActionKind>\(([\s\S]*?)\)\s*$/m.exec(
      policy,
    )

    expect(declaration, 'LANDING_ACTION_KINDS is not declared the way this test reads it').not.toBeNull()
    expect(
      declaration?.[1]?.trim(),
      'a kind lands now — external-effect is reachable, so move this into the section above',
    ).toBe('')
  })

  it('the gate never stops for a person, so ConfirmationRequest cannot occur', () => {
    // This is the one worth watching. A ConfirmationRequest is deterministic
    // and no dial can switch it off — but a rule nothing raises is a rule that
    // never fires, and it would be invisible in a green suite exactly the way
    // `registerContentScripts` was.
    expect(
      callersOf('confirmations.create', repos),
      'the gate raises confirmations now — move this into the section above',
    ).toEqual([])
  })

  it('and no human can answer one, so a raised request would strand its run', () => {
    expect(
      callersOf('confirmations.recordVerdict', repos),
      'confirmations are answerable now — move this into the section above',
    ).toEqual([])
  })

  it('nothing records what an agent saw while acting', () => {
    // Without this the second ledger is empty, so a ConfirmationRequest has
    // nothing to show the person before they authorise an effect.
    expect(
      callersOf('evidence.create', repos),
      'action evidence is captured now — move this into the section above',
    ).toEqual([])
  })

  it('no instruction reaches a browser, so nothing is ever dispatched or claimed', () => {
    expect(
      callersOf('dispatches.enqueue', repos),
      'dispatches are enqueued now — move this into the section above',
    ).toEqual([])
    expect(
      callersOf('dispatches.claim', repos),
      'dispatches are claimed now — move this into the section above',
    ).toEqual([])
  })

  it('nothing flags a run for cancellation, so the fence stays a paragraph', () => {
    // `cancelRequested` and `claimedBy` are described in CONTEXT.md §4 and have
    // never existed in the schema. They exist now; nothing writes or reads them
    // yet, so "a Runner that no longer holds the claim aborts without writing"
    // is still a sentence rather than a behaviour.
    expect(
      callersOf('runs.requestCancel', repos),
      'runs can be cancelled now — move this into the section above',
    ).toEqual([])
  })
})

describe('the extension can actually capture', () => {
  const extensionSource = (name: string) =>
    stripComments(
      readFileSync(
        EXTENSION.find((f) => f.endsWith(name)) ?? join(repo, 'extension/src', name),
        'utf8',
      ),
    )

  it('something registers the content script, or nothing is ever injected', () => {
    // The defect this whole ticket existed for. `content.js` was written,
    // reviewed and shipped, and no line of code ever caused it to run: no
    // `content_scripts` manifest block, no `registerContentScripts` call. In
    // production the extension could emit only `switchedAway` from chrome.idle.
    const worker = extensionSource('service-worker.js')

    // The leading dot matters: `unregisterContentScripts` contains
    // `registerContentScripts`, so the bare name stays satisfied by the cleanup
    // path alone. Caught while verifying this test — deleting the registration
    // left it green.
    expect(worker, 'nothing registers content.js — the extension captures nothing').toContain(
      '.registerContentScripts(',
    )
    expect(worker, 'the registration must actually name the content script').toContain(
      'src/content.js',
    )
  })

  it('the content script is never registered statically for all sites', () => {
    // A `content_scripts` block would need https://*/* to cover origins chosen
    // at runtime, which costs the "read all your data on all websites" warning
    // and puts the injected set back under our control instead of Chrome's.
    const manifest = JSON.parse(readFileSync(join(repo, 'extension/manifest.json'), 'utf8'))

    expect(manifest.content_scripts).toBeUndefined()
  })

  it('something asks Chrome for the host permission', () => {
    // Without a request, `optional_host_permissions` is a list nobody ever
    // grants — and extension/README.md claimed Chrome would prompt on its own.
    const panel = extensionSource('panel.html')

    expect(panel, 'no user gesture requests a host grant, so none is ever given').toContain(
      'permissions.request',
    )
  })

  it('a withdrawn grant is reported, so grantState can ever be revoked', () => {
    const worker = extensionSource('service-worker.js')

    expect(worker).toContain('permissions.onRemoved')
    expect(callersOf('revokeSource', 'src/persistence/repositories/index.ts')).not.toEqual([])
  })
})

describe('a project nobody created can still be corrected', () => {
  /**
   * Propositum names the project and decides which one a sitting goes under.
   * Both are guesses. If either correction is unreachable, the guess is not a
   * helpful default — it is a decision imposed on someone about their own work
   * with no way back, and the case for automatic filing collapses.
   *
   * These are the same class of defect as `documents.create`: correct, tested,
   * and called by nothing, behind an interface that implied otherwise.
   */
  it('something renames a project, or the name Propositum chose is permanent', () => {
    const callers = callersOf('projects.rename', 'src/persistence/repositories/index.ts')

    expect(callers, 'nothing renames a project — an auto-chosen name cannot be fixed').not.toEqual(
      [],
    )
  })

  it('something re-files a sitting, or a wrong merge cannot be undone', () => {
    const callers = callersOf('sessions.refile', 'src/persistence/repositories/index.ts')

    expect(
      callers,
      'nothing moves a sitting between projects — "no, this is new work" has nowhere to go',
    ).not.toEqual([])
  })

  it('a merge is told to the person, or it is exactly the silent failure', () => {
    // `joinedExisting` was added, documented as "the screen it lands on says
    // so", and read by nothing — both accept paths redirected to the same
    // place whether or not Propositum had just filed the work under an older
    // subject. A flag with no reader is a decision taken in silence.
    const readers = callersOf('joinedExisting', 'src/server/actions.ts')

    expect(
      readers,
      'nothing reads joinedExisting — a sitting can be merged with nothing said',
    ).not.toEqual([])

    // ...and the screen they land on must actually render it.
    const session = readFileSync(join(repo, 'src/app/sessions/[sessionId]/page.tsx'), 'utf8')
    expect(session, 'the landing screen never states a filing decision').toContain('filed')
  })

  it('carrying sources across never re-grants a withdrawn one', () => {
    // `approveSource` upserts `grantState: 'granted'`, so both the join path
    // and the re-file path could resurrect a permission the person had
    // deliberately withdrawn in Chrome — a human act undone by a convenience,
    // on screens that promise Propositum will not ask again.
    const actions = readFileSync(join(repo, 'src/server/actions.ts'), 'utf8')
    const guards = actions.match(/grantState !== 'granted'/g) ?? []

    expect(
      guards.length,
      'both the join path and the re-file path must skip a withdrawn source',
    ).toBeGreaterThanOrEqual(2)
  })

  it('nothing a person clicks creates a project directly', () => {
    // `createProject` stopped being a server action on purpose. A `'use server'`
    // module exports only async functions, so re-exporting it is all it takes to
    // put the form back — and the form is the setup step this whole change
    // removed.
    const actions = readFileSync(join(repo, 'src/server/actions.ts'), 'utf8')

    expect(actions, 'createProject is exported again — a person can file work by hand').not.toMatch(
      /export\s+async\s+function\s+createProject\b/,
    )
  })
})

describe('page-derived prose cannot reach the drafted agreement', () => {
  it('draftContract filters constraint claims before the handoff call', () => {
    // ADR-0006's structural barrier covers `guidance` only, because the schema
    // has no such field. The model WRITES objective and definitionOfDone, and
    // was being shown constraint text to write them from — so an injected
    // constraint could arrive in the agreement as unattributed prose.
    const actions = readFileSync(join(repo, 'src/server/actions.ts'), 'utf8')

    expect(actions).toMatch(/filter\(\s*\(?c\)?\s*=>\s*c\.kind\s*!==\s*'constraint'\s*\)/)
  })

  it('a constraint is only quoted when the quote actually verified', () => {
    // Attributing the model's paraphrase to a real site is worse than no
    // attribution: the person retypes it into guidance believing the source
    // said it, which turns the friction into laundering.
    const actions = readFileSync(join(repo, 'src/server/actions.ts'), 'utf8')

    expect(actions).toMatch(/verbatim:\s*quote\s*!==\s*undefined/)
  })
})
