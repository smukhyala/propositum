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
 * Known limit, found the hard way a second time on 2026-08-26.
 *
 * The stripper above cannot tell a comment from the two characters `/` and `*`
 * sitting next to each other in JSX text. `src/app/projects/[projectId]/page.tsx`
 * rendered an accurate example of a stored origin pattern — a host followed by
 * a slash and a star — and that opened a block comment which ran to the next
 * real close marker twenty-five lines later. A whole component render vanished,
 * and `callersOf` reported it had no callers while the screen rendered it
 * happily.
 *
 * This is the same class as the bug `tests/support/strip-comments.ts` was
 * extracted for: it *"treated the code-level string opening a block comment as
 * one, and deleted the thirty-three executable lines that followed it."*
 * That module's scanner tracks string state and is right about `.js` and
 * `.html`. It is **not** a fix here — JSX text is not a string, so it opens a
 * comment there too, and measured on the same file it lost more lines than this
 * one did, because an apostrophe in prose desynchronises its string tracking.
 *
 * So the limit stands, and `nothing a stripper eats is a component render`
 * below is what makes it loud instead of silent. The fix at a call site is an
 * entity — `&#42;` — with a comment saying why.
 *
 * ~~Twice~~ **Three times, 2026-09-03, and the third was not JSX.**
 * `src/policy/fetcher.ts` split an origin pattern on the literal two characters
 * `/` and `*` — ordinary code, in a string — which opened a comment that ran to
 * the end of the next docblock and swallowed `export function isAllowed`, a
 * function this very file pins the callers of. Nothing went red: a blind guard
 * passes. The render canary could not see it, because what was lost was a
 * declaration rather than a `<Name`, so a second canary sits beside it now —
 * `nothing a stripper eats is an exported declaration`. In a string the fix is
 * an escape, `'/\u002a'`, since an HTML entity means nothing there.
 *
 * Found while wiring a Playwright route interceptor, whose natural glob
 * `'**\/*'` would have been a fourth. That call site uses a regular expression
 * instead, for this reason and no other.
 */
function componentRenders(source: string): string[] {
  return [...source.matchAll(/^\s*<([A-Z][A-Za-z0-9]*)/gm)].map((match) => match[1]!)
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

describe('the greps can see the files they read', () => {
  /**
   * The check on the checker.
   *
   * Every `callersOf` assertion in this file is an argument about text that
   * survived `stripComments`, so a stripper that quietly eats a span turns each
   * of them into a claim about nothing — and it fails OPEN: the needle is
   * missing, so `not.toEqual([])` goes red and gets noticed, while a `toEqual`
   * or a deferred-block assertion goes green and does not.
   *
   * A component render is the shape worth checking because it is the shape that
   * was actually lost, and because it cannot legitimately disappear: a `<Name`
   * at the start of a line is JSX, and a stripper has no business removing one.
   */
  it('nothing a stripper eats is a component render', () => {
    for (const file of PRODUCTION) {
      const source = readFileSync(file, 'utf8')
      const before = componentRenders(source)
      if (before.length === 0) continue

      const after = componentRenders(stripComments(source))
      const lost = before.filter((name) => !after.includes(name))

      expect(
        lost,
        `${relative(repo, file)} loses ${lost.join(', ')} to the comment stripper — look for “/” next to “*” in JSX text, and write &#42;`,
      ).toEqual([])
    }
  })

  /**
   * The same limit, caught on the half the render canary above cannot see.
   *
   * A component render was the shape that went missing the first two times, so
   * that is what got a canary. The third instance, 2026-09-03, was not JSX at
   * all: `src/policy/fetcher.ts` split an origin pattern on the literal two
   * characters `/` and `*`, which opened a block comment that ran to the end of
   * the next docblock and took `export function isAllowed` with it. The guard
   * went blind to a function this file pins the callers of, and every test
   * stayed green — which is the whole failure mode, not a symptom of it.
   *
   * So this checks the other shape a stripper has no business removing: an
   * exported declaration at the start of a line. Between them the two canaries
   * cover what a guard actually looks for — the definitions and the renders.
   *
   * What it does NOT cover: a declaration that is not exported, a name eaten
   * inside a call rather than at its definition, and any file outside
   * `PRODUCTION`. It narrows the hole rather than closing it, and the stripper's
   * documented limit above is still the thing to read first.
   */
  it('nothing a stripper eats is an exported declaration', () => {
    const declarations = (source: string): string[] =>
      [...source.matchAll(/^export (?:async )?(?:function|const|class|interface|type) ([A-Za-z_$][\w$]*)/gm)].map(
        (match) => match[1]!,
      )

    for (const file of PRODUCTION) {
      const source = readFileSync(file, 'utf8')
      const before = declarations(source)
      if (before.length === 0) continue

      const after = declarations(stripComments(source))
      const lost = before.filter((name) => !after.includes(name))

      expect(
        lost,
        `${relative(repo, file)} hides ${lost.join(', ')} from the comment stripper — look for “/” next to “*” in a string, and write '/\\u002a'`,
      ).toEqual([])
    }
  })
})

describe('the safety machinery is reachable from the product', () => {
  it('something writes a ShiftReport, or the Accept-all guard can never fire', () => {
    // The guard reads `decisions`, which comes from `reports.forContract`,
    // which returns nothing if nothing ever called `reports.create`.
    const callers = callersOf('reports.create', 'src/persistence/repositories/index.ts')

    expect(
      callers,
      'no code path writes a ShiftReport — see tests/reachability.test.ts',
    ).not.toEqual([])
  })

  it('something calls runWorker, or Take over strands the session', () => {
    const callers = callersOf('runWorker', 'src/runtime/worker-loop.ts')

    expect(callers, 'runWorker has no caller — a handed-over session never completes').not.toEqual(
      [],
    )
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

  /**
   * And a way to start it that somebody will actually type.
   *
   * `npm run worker` existing is not the same as the worker running. `README.md`
   * records the consequence of forgetting the second terminal — *"pressing Take
   * over enqueues a run nobody drains and the session stays `away` for ever"* —
   * and the supervisor added 2026-08-26 is what stops that being the default.
   * A `dev` script that quietly went back to starting only the web half would
   * restore the failure with nothing to notice it.
   */
  it('the everyday command starts the worker too', () => {
    const scripts = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).scripts as Record<
      string,
      string
    >

    expect(
      scripts['dev'],
      'npm run dev no longer starts the worker — a run would be enqueued and never drained',
    ).toContain('scripts/dev.ts')

    const supervisor = stripComments(readFileSync(join(repo, 'scripts/dev.ts'), 'utf8'))
    expect(supervisor, 'the supervisor does not start the worker').toContain('scripts/worker.ts')
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

  it('something polls for heartbeat silence, or a gap reason cannot occur', () => {
    /**
     * `sweepForGap` turns silence into a `captureGap` with reason
     * `service_worker_terminated`. It was correct and tested from the day it
     * was written and called by nothing, so that reason was unreachable and the
     * timeline read as continuous whenever the service worker had died.
     *
     * Promoted out of the deferred block 2026-08-27 when `src/server/gap-watch.ts`
     * armed a clock on the session's lifetime.
     *
     * ── What this does NOT say ───────────────────────────────────────────
     *
     * ~~`machine_slept` is STILL unwritable, and the caller does not change
     * that: elapsed silence cannot tell a slept machine from a dead service
     * worker. One of the two reasons this pin used to cover is closed and the
     * other is exactly as open as it was — which is why the title says *a* gap
     * reason.~~
     *
     * **Corrected 2026-09-03 (ADR-0033).** Still true of elapsed silence, and
     * no longer true of the gap watch, which sampled its own tick's lateness
     * and got a second signal out of a clock it already had. The two pins below
     * are what keep that signal connected; this one is unchanged and its title
     * still says *a* gap reason, because silence is still one reason's evidence
     * and not the other's.
     */
    expect(
      callersOf('sweepForGap(', 'src/server/gap-sweeper.ts'),
      'the gap sweeper lost its caller — silence stopped being recordable',
    ).not.toEqual([])
  })

  it('something samples the tick for lateness, or machine_slept is unwritable again', () => {
    /**
     * The detector is the whole of what separates a slept machine from a dead
     * service worker. Uncalled, it is a correct and tested module while the
     * timeline goes on telling everybody who closed their lid that our software
     * fell over — which is the failure this file exists for, in the form that
     * looks most like working software.
     */
    expect(
      callersOf('createSuspensionDetector', 'src/server/suspension.ts'),
      'nothing samples the sweep tick — a slept machine is recorded as a dead service worker',
    ).toContain('src/server/gap-watch.ts')
  })

  it('and the sweeper is what is told, so the reason is decided before the write', () => {
    // One caller is the correct number. A second would be a second author of
    // the reason on a row nobody can UPDATE afterwards.
    expect(
      callersOf('noteSuspension', 'src/server/capture-session.ts'),
      'nothing hands the suspension to the sweeper — the signal is taken and dropped',
    ).toEqual(['src/server/gap-sweeper.ts'])
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

  it('a person can bring in a page, and exactly one thing decides whether it is fetched', () => {
    /**
     * ADR-0032, wired the day it was accepted.
     *
     * `importApprovedPage` is the door: it matches the address against the
     * project's approved origins AND builds the `allowlisted()` wrapper around
     * the reader. Both of those live in the same function on purpose, so the
     * assertion that matters is not that something calls it — it is that
     * **exactly one thing does**. A second caller would be a second place that
     * decides what may be fetched, and the two would drift.
     */
    expect(
      callersOf('importApprovedPage(', 'src/policy/page-import.ts'),
      'the import door has no caller, or has grown a second one that decides for itself',
    ).toEqual(['src/server/document-import.ts'])
  })

  it('the import reaches a screen, or the control is decoration', () => {
    // The three links in the chain, each of which has been the broken one in
    // some version of this repository: logic nothing calls, an action no screen
    // imports, a screen that renders the form without the prop.
    expect(
      callersOf('bringInApprovedPage(', 'src/server/document-import.ts'),
      'nothing calls the import — the server action is an endpoint to nowhere',
    ).toEqual(['src/server/actions.ts'])

    expect(
      callersOf('bringInPage(', 'src/server/actions.ts'),
      'no screen calls bringInPage — a page can be fetched and nobody can ask for one',
    ).not.toEqual([])

    const screen = stripImports(
      stripComments(readFileSync(join(repo, 'src/app/projects/[projectId]/page.tsx'), 'utf8')),
    )
    expect(
      screen,
      'the document forms render without the import prop — the control is gone from the screen',
    ).toContain('bringIn={bringIn}')
  })

  it('the app process reads pages with the fetcher that runs no code', () => {
    /**
     * ADR-0032 §5 is a refusal — the process holding the person's database and
     * their API key does not execute a host's JavaScript — and a refusal is
     * only worth anything if the thing it chose instead is the thing that runs.
     * `httpFetcher` being written and uncalled would leave the refusal true and
     * the feature dead; `createPlaywrightFetcher` appearing in the app would
     * leave the feature alive and the refusal false.
     */
    expect(
      callersOf('httpFetcher(', 'src/policy/http-fetcher.ts'),
      'nothing constructs the app process reader — the import cannot fetch anything',
    ).toEqual(['src/server/document-import.ts'])

    expect(
      callersOf('readableText(', 'src/domain/document/from-html.ts'),
      'nothing turns markup into words — an HTML page arrives in the box as tags',
    ).toEqual(['src/policy/http-fetcher.ts'])

    expect(
      callersOf('createPlaywrightFetcher(', 'src/policy/playwright-fetcher.ts'),
      'a browser was launched outside the worker process — ADR-0032 §5 refuses one in the app',
    ).toEqual(['scripts/worker.ts'])
  })

  it('both readers judge a redirect with the one shared decision', () => {
    /**
     * Written 2026-09-03. The app process's reader was fixed to refuse an
     * off-origin hop before taking it and the worker's browser was not, so for
     * a day there were two answers to one question and only one of them was
     * right. `judgeHop` being written and called by one of them would leave
     * that exactly where it was — which is the shape this file exists to catch.
     */
    expect(
      callersOf('judgeHop(', 'src/policy/redirect.ts').sort(),
      'a reader follows a hop without the shared decision — the two can drift again',
    ).toEqual(['src/policy/http-fetcher.ts', 'src/policy/playwright-fetcher.ts'])

    expect(
      callersOf('boundTo', 'src/policy/fetcher.ts'),
      'nothing binds a reader to an allowlist, so no hop can be judged against one',
    ).toContain('src/policy/http-fetcher.ts')
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

  it('an outcome-scoped finding is rendered, or the reviewer talks to nobody', () => {
    /**
     * `review@2` shows the reviewer outcome handles `O1…On` and asks it to cite
     * the most specific handle it can, so a finding about a whole production is
     * stored with `outcomeId` set and `changeId` null. The only reader on the
     * re-entry screen was `findings.forChangeset`, which joins through
     * `changeId` and therefore could not see one.
     *
     * So those rows existed and nobody was shown them — which in a green suite
     * is indistinguishable from a finding never written, and is the exact shape
     * of every defect the top of this file exists to remember.
     *
     * Promoted out of the deferred block 2026-08-27 when the shift page started
     * reading `findings.forRun` and the outcome card started rendering it.
     * `tests/re-entry-shape.test.ts` pins the rendering; this pins that the
     * query has a caller at all.
     */
    expect(
      callersOf('findings.forRun', 'src/persistence/repositories/index.ts'),
      'outcome-scoped findings lost their reader — the reviewer is talking to nobody',
    ).not.toEqual([])
  })

  it('boundary 6 is wired, or the narrative is a stop-rule label again', () => {
    /**
     * `execute-run` stored `narrative: stopLabel` — a consumer label rendered
     * where model prose belongs. Not wrong, and not what the field means: a
     * person coming back to *"I ran out of the time you gave me."* was told
     * where the run stopped and nothing about what it did, and a clean run that
     * hit no stop rule stored `null`, leaving the top of the screen a time
     * window.
     *
     * Promoted out of the deferred block 2026-08-27. `src/server/shift-narrative.ts`
     * is the caller; `writeReport` tries it first and falls back to exactly what
     * it wrote before, so the boundary still fails open the way its own header
     * asks it to.
     *
     * ── The needle lost its paren, 2026-08-20, and that was the whole pin ──
     *
     * Kept, because it is the reason this assertion is a BARE NAME and every
     * instinct says it should have a paren. It read `'shiftReportBoundary('`,
     * and no wiring of this boundary can ever produce that text:
     * `shiftReportBoundary` is a plain object, not a factory, so `ModelClient.run`
     * takes it as `run(boundary, input)` and it is written `shiftReportBoundary,`
     * the way `planBoundary`, `offerBoundary`, `subjectBoundary` and
     * `workerActionBoundary` are. Only the three factory boundaries —
     * `sessionReadingBoundary`, `handoffBoundary`, `reviewBoundary` — are ever
     * followed by `(`.
     *
     * So the one form in which boundary 6 can be wired was the one form the
     * needle could not see, and this file sat green through the whole period it
     * was meant to be watching. A bare name is safe here because `callersOf`
     * excludes the defining file and strips imports and comments.
     */
    expect(
      callersOf('shiftReportBoundary', 'src/model/boundaries/shift-report.ts'),
      'boundary 6 lost its caller — the narrative is a stop-rule label again',
    ).not.toEqual([])
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

    expect(
      callers,
      'nothing writes a ShiftOutcome — a run can only produce a document',
    ).not.toEqual([])
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

  it('a model call is written down, or the ledger cannot reconstruct what ran', () => {
    /**
     * Moved up out of *deferred, and asserted as deferred* when the provider
     * factory landed. Acceptance bullet 11 says the full ledger reconstructs
     * what happened; `model_call_record` had a table, all three append-only
     * triggers and no writer, while `AnthropicModelClient` computed every field
     * of it on every attempt and handed them to an `onCall` hook nothing passed.
     *
     * ── The needle changed with the claim, and that is worth reading ──────
     *
     * The pin was written as `modelCallRecord.create`, before the repository
     * existed. `callersOf` EXCLUDES the defining file, and the only text in the
     * repo matching that string is the Prisma delegate inside it — so the pin
     * could only ever have gone red for a repository that happened to be named
     * `modelCallRecord`, and would have stayed green through a correctly wired
     * `modelCalls`. It was a weaker assertion than it read as. The claim is
     * unchanged; the needle now names the accessor the callers actually write,
     * which is the convention every assertion above it already follows
     * (`reports.create`, `outcomes.create`, `findings.create(`).
     */
    expect(
      callersOf('modelCalls.create', 'src/persistence/repositories/index.ts'),
      'nothing writes a ModelCallRecord — every call is computed and discarded',
    ).not.toEqual([])
  })

  it('one factory builds the model client, or the model id has five owners', () => {
    /**
     * Not reachability — the mirror of it, and it lives here because this file
     * is already the place that greps source text for a claim about wiring.
     *
     * `AnthropicModelClientOptions.model` existed for the whole build and NO
     * caller passed it, because five sites each wrote the constructor by hand
     * and none of them owned configuration. The same omission is what left
     * `onCall` unpassed at all five. Collapsing them is only worth something if
     * a sixth cannot appear, and "cannot" is a grep rather than a note in an
     * ADR.
     *
     * Production only. The live tests construct the client directly and should
     * keep doing so — they are testing the client, not the wiring.
     */
    expect(
      callersOf('new AnthropicModelClient', 'src/model/provider.ts'),
      'something builds the model client outside the factory — the model id and the ModelCallRecord hook are set in one place',
    ).toEqual([])
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

  it('an instruction can actually reach a browser, and is handed out exactly once', () => {
    // Moved up out of the deferred block below when the control channel landed,
    // which is that block working as intended.
    //
    // The two halves are asserted separately because they fail differently.
    // Without `enqueue` no instruction is ever written down, so the extension
    // has nothing to poll for and a run with hands has none. Without `claim` the
    // poll would hand out whatever it read — and the guarded UPDATE is the ONLY
    // thing standing between two pollers and two clicks on the same button in
    // someone's real session. A `nextQueued` read with no claim behind it looks
    // identical in a green suite and is a different product.
    expect(
      callersOf('dispatches.enqueue', 'src/persistence/repositories/index.ts'),
      'nothing enqueues an ActionDispatch — the worker has no way to reach a browser',
    ).toContain('src/app/api/act/dispatch/route.ts')
    expect(
      callersOf('dispatches.claim', 'src/persistence/repositories/index.ts'),
      'nothing claims an ActionDispatch — a poll would hand the same command to two callers',
    ).toContain('src/app/api/act/next/route.ts')
  })

  it('the fence is read, not just written — a halt actually stops a run', () => {
    /**
     * Promoted when the confirmation pause landed, and the promotion is the
     * point rather than bookkeeping.
     *
     * CONTEXT.md §4 has said for months that every action boundary re-reads
     * `status` and `claimedBy` and that a Runner which no longer holds the
     * claim "aborts without writing". Nothing implemented it. The flag was
     * written by the halt route and read by nobody, so a run asked to stop
     * found out only because its next dispatch happened to fail — and a stale
     * claim could still act, which is tolerable for a run that drafts prose and
     * is not for one that presses buttons in a signed-in browser.
     *
     * The reader lives at the action boundary itself, in `recordIntent`,
     * because a run physically cannot act without passing through it. A check
     * the loop owns is a check the next rewrite can drop.
     */
    expect(
      callersOf('cancelRequested', 'src/persistence/repositories/index.ts'),
      'nothing reads the cancellation flag — a halt is a message nothing acts on',
    ).not.toEqual([])
  })

  it('a halt flags the run, or stopping is a message nothing reads', () => {
    // ~~Moved up when the halt route landed. `cancelRequested` is written here
    // and the fence is still only half real: CONTEXT.md §4 requires that every
    // action boundary RE-READS `status` and `claimedBy` and aborts without
    // writing, and no run path does that yet. So this asserts the writer
    // exists, and the reader is still owed — deliberately not asserted as
    // done.~~ **Corrected 2026-09-02.** The reader landed with the fence and is
    // asserted by the case above this one.
    //
    // What this case had become is a pin on the WRONG DOOR. It required the
    // route to call `runs.requestCancel` itself, which is exactly what made
    // `haltRun`'s "ONE implementation, two doors" false — the route did step 1
    // and neither of the other two. Naming the route as a direct caller of the
    // repository was the assertion holding that in place.
    //
    // So it asserts the route halts, and asserts it does not reach around the
    // implementation to do it.
    expect(
      callersOf('haltRun', 'src/server/confirmations.ts'),
      'the halt route stops nothing — it settles sockets and leaves the run running',
    ).toContain('src/app/api/act/halt/route.ts')

    expect(
      callersOf('runs.requestCancel', 'src/persistence/repositories/index.ts'),
      'the halt route flags the run itself, so it can skip the other two steps again',
    ).not.toContain('src/app/api/act/halt/route.ts')
  })

  it('a human can answer a confirmation, or a raised request strands its run', () => {
    /**
     * Moved up out of the deferred block below when the confirmation screen
     * landed — which is that block working as intended.
     *
     * This is the one that replaced ADR-0004's missing capability. There is no
     * `sendMessage`, but `click-element` can press *Send*, so the prohibition
     * is now a pause — and a pause nobody can answer is not a pause, it is a
     * run stranded on `awaiting-confirmation` until it expires.
     */
    expect(
      callersOf('confirmations.recordVerdict', 'src/persistence/repositories/index.ts'),
      'nothing answers a confirmation — a raised request strands its run',
    ).not.toEqual([])
  })

  it('a run can be told to stop, or the fence stays a paragraph', () => {
    /**
     * `cancelRequested` and `claimedBy` are described in CONTEXT.md §4 — "every
     * action boundary re-reads `status` and `claimedBy`; a Runner that no
     * longer holds the claim aborts without writing" — and the columns landed
     * in the schema long after the sentence did.
     *
     * A browser-driving run is the first run where a stale claim can press a
     * button on a live page, so the sentence had to stop being a sentence.
     */
    expect(
      callersOf('runs.requestCancel', 'src/persistence/repositories/index.ts'),
      'nothing flags a run for cancellation — "Take back control" cannot work',
    ).not.toEqual([])

    /**
     * The assertion above passed for eleven days while the switch it names did
     * not exist.
     *
     * `POST /api/act/halt` called `runs.requestCancel` directly, so the caller
     * count was never zero — and `takeBackControl`, which three docblocks call
     * *"the third kill switch, and the only one that needs the app"*, had NO
     * CALLER ANYWHERE. The shift screen rendered no such control. This file
     * exists to catch a capability built and wired to nothing, and it was
     * watching one door while the other was missing.
     *
     * So the two doors are asserted by name. `haltRun` is the one
     * implementation both reach, and the route no longer reaches around it.
     */
    expect(
      callersOf('takeBackControl', 'src/server/actions.ts'),
      'nothing calls "Take back control" — the switch on the shift screen does not exist',
    ).not.toEqual([])

    expect(
      callersOf('haltRun', 'src/server/confirmations.ts'),
      'nothing halts a run through the one implementation both doors are meant to share',
    ).not.toEqual([])
  })

  it('pause time is credited back, or asking permission destroys the run', () => {
    /**
     * Someone asked at 09:05 who answers at noon would otherwise return to a
     * run whose thirty minutes expired at 09:30 — so every remaining proposal
     * is refused `budget_exhausted` and the work they just approved never
     * happens. That makes the safest behaviour the most expensive one, which is
     * how safeguards get switched off.
     */
    expect(
      callersOf('deadlineFor(', 'src/domain/execution/stop-conditions.ts'),
      'nothing calls deadlineFor — a slow answer still eats the shift',
    ).not.toEqual([])
  })

  it('something composes an offer, or the model half of ADR-0009 is unreachable', () => {
    expect(
      callersOf('composeOffer(', 'src/server/compose-offer.ts'),
      'composeOffer has no caller — every offer degrades to the deterministic form forever',
    ).not.toEqual([])
  })

  it('page text is sanitised at ONE door, and the acting path uses it', () => {
    // Promoted out of the deferred block when the ActionEvidence writer landed.
    //
    // `evidence.create` is the second ledger's only writer. The assertion that
    // matters is not merely that SOMETHING calls it — it is that the caller is
    // the ledger writer, because that is the module that datamarks. A second
    // caller would be a second path by which raw accessibility-tree text could
    // reach SQLite, and it would pass every other test in this suite.
    expect(
      callersOf('evidence.create', 'src/persistence/repositories/index.ts'),
      'nothing writes ActionEvidence — a confirmation has nothing to show the person',
    ).toEqual(['src/persistence/ledger-writer.ts'])
  })

  it('the evidence sweep has a caller, or the retention promise is decoration', () => {
    // The trap this whole file exists to remember, in its most damaging form.
    // `sweepForGap` below is correct, tested and uncalled, and the cost of that
    // is a gap reason nobody can produce. An uncalled RETENTION sweep costs
    // something else: docs/SECURITY_AND_PRIVACY.md publishes a window, and a
    // published window nothing enforces is a false statement in the document
    // whose entire job is being true.
    //
    // The worker process is the wiring. It is the only long-lived process
    // Propositum owns, and `npm run worker` is asserted to exist above.
    expect(
      callersOf('sweepActionEvidence(', 'src/server/evidence-sweep.ts'),
      'nothing sweeps ActionEvidence — the published retention window is not enforced',
    ).toContain('scripts/worker.ts')
  })

  /**
   * The guard standing where a trigger used to stand.
   *
   * `action_evidence` is the one durable table with no no-DELETE trigger,
   * because a retention sweep needs one (ADR-0010). The database therefore no
   * longer refuses a delete here, and these three assertions are the whole of
   * what replaced it. `docs/SECURITY_AND_PRIVACY.md` cites them, so a weaker
   * check than the sentence describing it is itself a defect.
   *
   * The first version WAS weaker: it asserted the deleting FILE was the
   * repository, which any new `actionEvidence.deleteMany` anywhere in a
   * 1,500-line file would satisfy, and it could not see raw SQL at all.
   */
  describe('nothing but the sweep deletes action evidence', () => {
    const repos = 'src/persistence/repositories/index.ts'

    it('the ORM delete lives only in the repository', () => {
      const deleters = PRODUCTION.filter((f) =>
        /actionEvidence\.delete(Many)?\(/.test(
          stripImports(stripComments(readFileSync(f, 'utf8'))),
        ),
      ).map((f) => relative(repo, f))

      expect(
        deleters,
        'something outside the repository deletes ActionEvidence — the table has no DELETE guard',
      ).toEqual([repos])
    })

    it('and reaching it means calling the sweep, from the sweep module only', () => {
      // The narrowing the file-level check could not express. Both sweep
      // methods are the repository's only route to that delete, so if the only
      // callers are `src/server/evidence-sweep.ts`, the delete is the sweep's.
      for (const method of ['sweepOlderThan(', 'sweepSettledRuns(']) {
        expect(
          callersOf(`evidence.${method}`, repos),
          `${method} is called from somewhere other than the sweep`,
        ).toEqual(['src/server/evidence-sweep.ts'])
      }
    })

    it('and no raw SQL goes round the repository entirely', () => {
      // `$executeRawUnsafe('DELETE FROM action_evidence …')` satisfies neither
      // check above and is exactly what someone reaches for when the ORM path
      // is inconvenient. Case-insensitive, because SQL is.
      const raw = PRODUCTION.filter((f) =>
        /delete\s+from\s+action_evidence/i.test(stripComments(readFileSync(f, 'utf8'))),
      ).map((f) => relative(repo, f))

      expect(raw, 'raw SQL deletes ActionEvidence, bypassing the sweep entirely').toEqual([])
    })
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

  it("the run path reads the person's yes, or a confirmed action is refused twice", () => {
    /**
     * The consumer half of the confirmation pause.
     *
     * `RunContext.confirmedRequestIds` defaults to empty and `authorize()` never
     * queries, so without a caller supplying it the gate refuses a confirmed
     * action with `confirmation_required` a second time. The run fails safe and
     * presents as *Propositum ignored my answer*, which costs more trust than a
     * refusal does.
     *
     * `params.confirmationId` must be attached by DETERMINISTIC CODE, never
     * proposed: a model that could name a confirmation id could confirm its own
     * action, and granting is the one thing a model may never do. So the
     * assertion is on the loop, not on the boundary schema — and the boundary
     * schema is checked below for the absence of any field that could carry one.
     *
     * The producer half stays deferred; see the pairing note in that block.
     */
    expect(
      callersOf('confirmedRequestIds', 'src/policy/gate.ts'),
      'nothing supplies confirmedRequestIds — a confirmed action is refused a second time',
    ).toContain('src/runtime/worker-loop.ts')

    expect(
      callersOf('confirmationsForContract', 'src/runtime/history.ts'),
      'nothing reads answered confirmations off durable rows',
    ).toContain('src/server/execute-run.ts')

    // ...through the shared helpers rather than a second query of its own. Two
    // readers of one truth drift, and they drift in the direction that decides
    // whether somebody's yes counts.
    expect(
      callersOf('confirmedRequestIdsFor(', 'src/server/confirmations.ts'),
      'the run path queries verdicts itself instead of using the shared reader',
    ).toContain('src/server/execute-run.ts')
    expect(
      callersOf('confirmationForIntent(', 'src/server/confirmations.ts'),
      'nothing walks from a refused intent to the confirmation covering it',
    ).toContain('src/server/execute-run.ts')

    // ...and the model has nowhere to name one. A `confirmationId` field on the
    // proposal schema would be a model granting itself permission.
    const boundary = readFileSync(join(repo, 'src/model/boundaries/worker-action.ts'), 'utf8')
    const schema = boundary.slice(
      boundary.indexOf('export const workerActionSchema'),
      boundary.indexOf('export type WorkerActionOutput'),
    )
    expect(schema.length).toBeGreaterThan(200)
    expect(
      schema,
      'the action schema can name a confirmation — a model that names one confirms itself',
    ).not.toMatch(/confirmation/i)
  })

  it('something actually mints a control token, or the channel fence is a comment', () => {
    /**
     * `runs.claim` documents the token as minted at claim and takes it as an
     * OPTIONAL parameter — so the mint site is whoever claims. Until the worker
     * script passed one, nobody did: `AgentRun.controlToken` was null on every
     * run in production while the docstring beside it read as proof a fence
     * existed. That is the exact shape of the three defects at the top of this
     * file, with the added hazard that the missing thing is a credential.
     */
    expect(
      callersOf('controlToken', 'src/persistence/repositories/index.ts'),
      'nothing supplies a controlToken to runs.claim — the column is never written',
    ).toContain('scripts/worker.ts')
  })

  it('the lifecycle state is computed and acted on, or the Intention is invisible', () => {
    /**
     * Moved up out of *deferred, and asserted as deferred* when Home began
     * deriving each row's status word from `intentionState` — which is that
     * block working as intended, and this is the relocation it demands rather
     * than a deletion.
     *
     * What was wrong before is worth keeping, because it is the reason the
     * screen matters: Home read the status word off the most recent sitting's
     * `phase`, so a project whose shift ended with an unanswered question
     * rendered `idle` — the same word as a project nobody had touched in a
     * month. `intentionState` ranks `needs-you` above every activity word for
     * exactly that case.
     *
     * `INTENTION_STATES` is asserted alongside it because it is the half the
     * screen reaches for LAST — the consumer labels are rendered rather than
     * the ids, so a caller that computed a state and then wrote its own words
     * for it would satisfy the first line and not this one.
     *
     * ── Both needles now name `front-door.ts`, and that is not a weakening ──
     *
     * The derivation was in `src/app/page.tsx` and this pair pointed at it. A
     * review then mutated the call there so that every row rendered *Sleeping*
     * and no row could reach `needs-you`, and the whole suite stayed green:
     * a grep for a call is satisfied by a call whose result is discarded, and
     * this file's own docblock claimed otherwise. The three derived fields moved
     * to `src/server/front-door.ts`, where `tests/front-door.test.ts` asserts
     * the CONSUMER LABEL rather than the presence of a call — so that mutation
     * is now caught by a test rather than by a grep it could walk past.
     *
     * The second hop is asserted below, because a helper Home stopped calling
     * would leave both lines above green and the screen blind.
     *
     * ── `statusWordFor` has a caller again, on the project screen ──────────
     *
     * *Added 2026-08-18.* Between the bare-Home rewrite and that date it had
     * none, and this file did not say so — the one shape it exists to catch,
     * missed. Four of the five lifecycle words rendered nowhere, and the fifth
     * only because Home had constant-folded it.
     *
     * `src/app/projects/[projectId]/page.tsx` now derives the word from the
     * same `frontDoorRow` and prints it. The assertion below greps for the call
     * AND for the interpolation that puts its result in the kicker, because a
     * grep for the call alone is satisfied by a result nobody renders — which
     * is precisely how this went unnoticed the first time.
     *
     * ── Why the second needle on HOME is no longer `statusWordFor` ─────────
     *
     * Because that call had stopped meaning anything, in a way this file could
     * not see. Home renders re-entry rows off a list it has ALREADY filtered to
     * `state === 'needs-you'`, so `statusWordFor(work.state)` could only ever
     * return *Needs you* — four of the five lifecycle words were unreachable
     * from the screen — beside a link that said "While you were away" on the
     * same row. A grep is satisfied by a call whose result is discarded, which
     * is the failure the block above records; it is equally satisfied by a call
     * whose result the caller has constant-folded, which is this one. The word
     * is gone from the screen and the assertion has moved to the thing that is
     * actually load-bearing there: which rows appear at all.
     *
     * The state id is grepped rather than the helper because the filter IS the
     * rendering decision — a Home that stopped consulting `needs-you` would put
     * "While you were away" on projects with nothing waiting, which is the
     * expensive direction and the one `frontDoorRow` exists to get right.
     *
     * What this still does NOT check is ADR-0011's softest claim — *on screen
     * wherever it is used*. That is a requirement on `.tsx` files, and nothing
     * in this suite renders one. The closest things to a test for it are
     * `tests/front-door.test.ts`, which holds everything but the markup, and the
     * bottom of this file, where the agreement screen's account of where its
     * words came from is pinned to the code that produces them.
     */
    const state = 'src/domain/intention/state.ts'
    const frontDoor = 'src/server/front-door.ts'

    expect(
      callersOf('intentionState(', state),
      'nothing computes an IntentionState — the front door is guessing from a phase again',
    ).toContain(frontDoor)
    expect(
      callersOf('INTENTION_STATES', state),
      'the lifecycle words are written somewhere other than the one place that holds them',
    ).toContain(frontDoor)
    expect(
      callersOf('frontDoorRow(', frontDoor),
      'Home derives no row state — the computed state reaches no screen',
    ).toContain('src/app/page.tsx')
    expect(
      stripImports(stripComments(readFileSync(join(repo, 'src/app/page.tsx'), 'utf8'))),
      'Home no longer gates re-entry rows on needs-you — a finished shift is hidden, or a quiet project is announced as one',
    ).toContain("'needs-you'")
  })

  it('the machine-wide lifecycle word is served, or the menu-bar light has nothing to poll', () => {
    /**
     * ADR-0023's status light is rendered by the tray app, whose Rust these
     * greps cannot see — `callersOf` reads `src/` and `scripts/`, and the
     * poller lives in neither. So the route is the greppable seam: it is the
     * one caller of `overallIntentionState`, and a fold that lost its route
     * would be a light polling a 404 while every other test stayed green.
     *
     * The fold's own derivation is not pinned here because it is not its own:
     * `frontDoorRow` is the one converter, asserted above, and
     * `tests/intention-state.test.ts` holds the ordering the fold adds.
     */
    expect(
      callersOf('overallIntentionState(', 'src/server/intention-state.ts'),
      'nothing serves the machine-wide lifecycle word — the menu-bar light has nothing to poll',
    ).toContain(join('src', 'app', 'api', 'intention-state', 'route.ts'))
  })

  it('where you left off reaches both screens, or the fold is a paragraph nobody reads', () => {
    /**
     * ADR-0017's whole argument turns on WHERE this renders, not on whether it
     * is computed. *"It renders on the accept screen, before the click that
     * starts the sitting"* is the answer to `CONTEXT.md`'s ruling that forbids
     * an objective inherited **quietly** — *"because nothing on screen would say
     * it had been"*. A fold that computed perfectly and reached no screen would
     * satisfy every other test in this repository and close none of that.
     *
     * Three needles, because there are three ways for this to go quiet and only
     * one of them is a deleted call:
     *
     *   - the fold, called by the one place that converts rows into it;
     *   - the two screens, each holding the component;
     *   - the component itself, which must reach `WHERE_YOU_LEFT_OFF` — the
     *     heading is `CONTEXT.md`'s consumer wording and a screen that wrote its
     *     own would have renamed the term on the only surface it appears on.
     *
     * What this cannot see is the shape `front-door.ts` was written over: a
     * value computed and then discarded. `tests/work-so-far.test.ts` holds the
     * sentences and `tests/agreement-words.test.ts` renders the screen that
     * chooses between them, which is as close as this repository gets.
     */
    const fold = 'src/domain/intention/work-so-far.ts'
    const server = 'src/server/work-so-far.ts'
    const component = 'src/ui/work-so-far.tsx'

    expect(
      callersOf('workSoFar(', fold),
      'nothing folds the rows — Where you left off is computed by nobody',
    ).toContain(server)
    expect(
      callersOf('WHERE_YOU_LEFT_OFF', fold),
      'the heading is written somewhere other than the one place that holds it',
    ).toContain(component)
    expect(
      callersOf('WhereYouLeftOff', component),
      'the accept screen no longer shows what is being carried forward — before the click is the whole of ADR-0017’s answer to “quietly”',
    ).toContain('src/app/start/page.tsx')
    expect(
      callersOf('WhereYouLeftOff', component),
      'the project screen no longer shows what happened under this Intention',
    ).toContain('src/app/projects/[projectId]/page.tsx')

    // And the one derivation, not two. `describeProject` loads it for the accept
    // screen so that screen and the pre-fill are chosen against the same rows.
    expect(
      callersOf('whereYouLeftOffIn(', server),
      'nothing loads the fold for a project — one of the two screens is assembling its own',
    ).toEqual(
      expect.arrayContaining(['src/server/actions.ts', 'src/app/projects/[projectId]/page.tsx']),
    )
  })

  it('the re-entry note is reachable from the front door, or it stays four clicks deep', () => {
    /**
     * `/shifts/<contractId>` is where "While you were away" lives, and Home did
     * not link to it at all — the finished note was reachable only by opening
     * the project, then the sitting, then the link on it. The screen a person
     * lands on is the screen that has to say something is waiting.
     *
     * The label is asserted too, and that is not fussiness. It is the masthead
     * of the destination and the wording of every other link that reaches it;
     * a second phrase for one place is a second thing to learn.
     */
    const home = readFileSync(join(repo, 'src/app/page.tsx'), 'utf8')

    expect(home, 'Home has no route to a shift report').toMatch(/href=\{`\/shifts\//)
    expect(stripComments(home), 'the link to the re-entry note calls it something else').toContain(
      'While you were away',
    )
  })

  it('says when reticence held something back, or the policy is invisible', () => {
    /**
     * §15's answer is an interface requirement, and an interface requirement
     * with no test is the weak link ADR-0011 named. This is that test.
     *
     * `stripComments` because the prose above the line uses both needles, and a
     * grep that a docblock can satisfy is not a guard — which is the failure
     * this whole file exists to notice.
     */
    const home = stripComments(readFileSync(join(repo, 'src/app/page.tsx'), 'utf8'))

    expect(home, 'nothing on Home reads the held-back count — the policy applies unseen').toContain(
      'heldBack',
    )
    expect(home, 'the only control allowed to widen has gone from the screen').toContain(
      'Show them anyway',
    )
  })

  it('the poll names the strands the screen shows, or a promoted strand has no subject', () => {
    /**
     * The other half of the same interface requirement, and it failed in a way
     * only a grep would have caught.
     *
     * `/api/session/current` is the ONLY caller of `nameThread` in the product.
     * It kept its own copy of the front door's filters, and that copy cut to
     * `MAX_THREADS_SHOWN` before reticence rather than after — so on a
     * four-strand afternoon with the first one declined, the poll named A, B, C
     * and Home rendered B, C, D. D reached the screen with no subject and kept
     * the degraded sentence until the buffer forgot it, which is up to thirty
     * days of a held-back strand costing somebody a proposal they never saw
     * named.
     *
     * The guard is that the poll derives from `noticedAfternoon` — the screen's
     * own derivation, reticence included — and holds NO bound of its own. A
     * `MAX_THREADS_SHOWN` back in this file's code (the comments still discuss
     * it, hence `stripComments`) is the second spelling coming back, which is
     * the thing that produced the defect rather than a symptom of it.
     */
    const poll = stripComments(
      readFileSync(join(repo, 'src/app/api/session/current/route.ts'), 'utf8'),
    )

    expect(
      poll,
      'the poll no longer derives its strands from the front door — it can name a different three',
    ).toContain('noticedAfternoon(')
    expect(
      poll,
      'the poll holds its own display bound again, which is how it and the screen came apart',
    ).not.toContain('MAX_THREADS_SHOWN')
  })

  it('a run holds the browser control, or the channel has no customer', () => {
    /**
     * Moved up out of *deferred, and asserted as deferred* when the run path
     * started building one — which is that block working as intended.
     *
     * Both ends of the channel had existed for a wave: the five `/api/act/*`
     * routes are live and `createBrowserControl` is the client. Nothing held the
     * middle, so the app could hand out instructions nobody had written and the
     * routes could have been deleted with every test still green — precisely the
     * shape of the three defects at the top of this file.
     *
     * The construction is CONDITIONAL and must stay so: `WorkerDeps.browser` is
     * optional because a drafting run that cannot propose a browser kind has no
     * use for a debugger attachment, and handing every run one would be a
     * capability granted by tidiness. So this asserts a caller exists, never that
     * every run gets one.
     */
    expect(
      callersOf('createBrowserControl(', 'src/runtime/browser-control.ts'),
      'nothing builds a browser control — the five /api/act/* routes have no customer',
    ).toContain('src/server/execute-run.ts')
  })

  it('a contract can actually grant a browser kind, or the control is never built', () => {
    /**
     * The half a caller-grep cannot see, and the reason this assertion exists
     * beside the one above rather than being folded into it.
     *
     * `callersOf('createBrowserControl(')` goes green the moment any line
     * mentions it, including one guarded by a condition nothing in production
     * can satisfy. Until this change nothing could: `draftContract` granted
     * `DOCUMENT_ACTION_KINDS`, derived by subtracting the browser set, so no
     * contract this codebase could produce named a kind that needs a live page —
     * and a conditional control would have been reachable in the grep and dead
     * in the product. That is the same defect wearing the guard's own clothes.
     *
     * So the grant is asserted at the place that writes the column.
     */
    expect(
      callersOf('grantableActionKinds', 'src/domain/handoff/policy.ts'),
      'no contract writer decides what to grant — an unpinned shift permits nothing',
    ).toContain('src/server/actions.ts')
  })

  it('the gate stops for a person, or ConfirmationRequest can never occur', () => {
    /**
     * The one that was worth watching, and the promotion is the point.
     *
     * A `ConfirmationRequest` is deterministic and no dial can switch it off —
     * but a rule nothing raises is a rule that never fires, and it is invisible
     * in a green suite exactly the way `registerContentScripts` was. Every
     * consumer half had shipped: the screen, the two verdicts, the expiry sweep,
     * the credited deadline, the continuation run. Nothing had ever written the
     * row they all read.
     *
     * The producer is the run path, not the gate and not the loop:
     * `authorize()` refuses `confirmation_required` and stays two-armed, the
     * loop reports which intent it was refused on, and `execute-run` writes the
     * question and parks the run. Asserted on the writer, because that is the
     * end that was missing.
     */
    expect(
      callersOf('confirmations.raiseAndPark', 'src/persistence/repositories/index.ts'),
      'nothing raises a confirmation — the pause is a rule that never fires',
    ).toContain('src/server/execute-run.ts')
  })

  it('the question is code-generated, or a model asks for its own permission', () => {
    /**
     * The pause is only worth anything if the sentence a person reads was not
     * written by the thing asking. ADR-0010 §5: *"a model that could write the
     * words asking for its own permission is a model that can argue for
     * itself."*
     *
     * Two halves, and the second is the one a refactor loses. Without a caller
     * the builder is decoration; without the builder reaching the COLUMN, the
     * summary would fall back to whatever string was nearest — which on this
     * path is `proposal.reason`, model prose, in a field CONTEXT.md declares
     * code-generated.
     */
    expect(
      callersOf('confirmationQuestion(', 'src/domain/execution/confirmation-question.ts'),
      'nothing builds the question — the summary would have to come from somewhere else',
    ).toContain('src/runtime/worker-loop.ts')

    const executeRun = stripImports(
      stripComments(readFileSync(join(repo, 'src/server/execute-run.ts'), 'utf8')),
    )
    // `awaiting` is `result.awaiting`, hoisted at the top of the park because
    // narrowing does not survive into the argument object. Either spelling is
    // the same value, and its only producer is `confirmationQuestion`.
    expect(executeRun, 'the confirmation summary is not the code-generated question').toMatch(
      /summary:\s*(result\.)?awaiting\.question/,
    )
  })

  it('something reports a lost tab, or two structural stop rules cannot fire', () => {
    /**
     * Moved up when the run path started reporting control loss.
     *
     * `control-lost` and `action-limit` are structural and deterministic and
     * both were unraisable, for different reasons that this file's old comment
     * had merged into one: `actionsTaken` had been supplied since the continuing
     * loop landed, and `controlLost` never had a writer at all.
     *
     * What that cost was not silence. A run whose tab was closed kept proposing
     * into a dead channel — authorised, dispatched, failed, recorded
     * `unverified` — until three consecutive failures tripped `no-progress` and
     * the person read *"I stopped because I was going in circles without
     * changing anything"* about a run that stopped because they closed the tab.
     *
     * ── The needle names the WRITE, 2026-08-20 ────────────────────────────
     *
     * It was the bare word `controlLost`, and the loop mentions that word three
     * times: the declaration `let controlLost = false`, the field handed to
     * `progress()`, and the one assignment. Deleting only the assignment — the
     * whole `error.failure === 'control-lost'` arm — left two mentions standing
     * and this pin green, with `progress.controlLost` then permanently `false`
     * and the stop rule unraisable again. That is the ternary-other-arm shape
     * the `modelCallRecord.create` note above records being bitten by, and the
     * fix is the same one: name what a caller actually writes.
     *
     * What this does NOT cover: the hop from the flag to the snapshot. Deleting
     * `controlLost,` from `progress()` typechecks, because the field is
     * optional on `ProgressSnapshot`. `tests/browser-loop.test.ts` holds that
     * half behaviourally — *"stops on the first control-lost rather than
     * circling"* — and it is the test that goes red for both mutations.
     */
    expect(
      callersOf('controlLost = true', 'src/domain/execution/stop-conditions.ts'),
      'nothing reports control loss — a closed tab is reported as going in circles',
    ).toContain('src/runtime/worker-loop.ts')
  })

  it('the extension is told which run it is driving, or Stop reaches nothing', () => {
    /**
     * ADR-0010 §7 is headed *"Three ways to stop it, and stopping never needs
     * the app"*, and two of the three end in `postHalt(state.runId, reason)`.
     *
     * The extension reads that id off the command that opened the tab —
     * `command.runId ?? params.runId ?? null` — and `/api/act/next` did not send
     * one, so it was permanently `null`. `haltRequestSchema` requires a non-empty
     * `runId`, so the route answered 403 before `runs.requestCancel` ran, and
     * `postHalt` ends in a `.catch(() => {})` that never noticed. **The person
     * pressed Stop, the chip said it had stopped, and the run carried on — and
     * opened a fresh controlled tab on its next navigate.**
     *
     * It was unreachable while nothing drove a browser. It is not any more, so
     * the envelope carries the id and this is the guard on it.
     */
    const next = stripImports(
      stripComments(readFileSync(join(repo, 'src/app/api/act/next/route.ts'), 'utf8')),
    )
    expect(
      next,
      'the command envelope carries no runId — the extension cannot halt anything',
    ).toMatch(/command:\s*\{[\s\S]*?\brunId\b/)
  })

  it('the browser tools are reachable from the run path, or the six kinds cannot act', () => {
    /**
     * `ACTION_KINDS` gained six members in wave 2 and the loop threw on all of
     * them — a capability that existed in the vocabulary, passed the gate, and
     * could not be carried out. This is that gap closed, and it is asserted here
     * so it cannot silently reopen behind a refactor.
     *
     * Note what this does NOT assert: that any contract grants one.
     *
     * ~~It does not. `draftContract` grants `DOCUMENT_ACTION_KINDS`, so the gate
     * refuses every browser kind with `action_kind_not_allowed` before a tool is
     * reached. The tools are reachable from the loop; the loop is not yet
     * reachable with a browser kind in scope, and the panel in
     * `src/ui/agreement.tsx` still tells the truth because of it.~~
     *
     * **Struck 2026-09-01 — a contract has granted browser kinds since ADR-0010
     * was built.** `grantableActionKinds(false)` in `src/domain/handoff/policy.ts`
     * returns exactly the browser set, and *"a contract can actually grant a
     * browser kind"* above asserts that `src/server/actions.ts` calls it — that
     * test exists because this claim stopped being true. So the loop IS
     * reachable with a browser kind in scope, and the agreement panel's honesty
     * rests on something else entirely: it branches on what the shift actually
     * granted rather than on what compiled, which is the correction
     * `tests/agreement-honesty.test.ts` holds. The scope note itself survives —
     * a caller-grep still cannot see a grant, which is why that assertion lives
     * in its own `it`.
     */
    for (const tool of [
      'observePage(',
      'clickElement(',
      'typeText(',
      'pressKey(',
      'navigateTo(',
      'captureScreen(',
    ]) {
      expect(
        callersOf(tool, 'src/policy/tools.ts'),
        `${tool} has no caller — the capability exists and nothing can carry it out`,
      ).toContain('src/runtime/worker-loop.ts')
    }
  })

  describe('the landing kind is reachable, end to end and by ratification only', () => {
    /**
     * Promoted from the deferred block on 2026-09-01, the day ADR-0024's build
     * moved the transport branch — the emptiness pin went red and its own text
     * said to move it. What replaces an assertion of absence is the positive
     * chain: the set has exactly its ratified member, the tool has its caller,
     * the grant has its one writer, and the extension knows the kind.
     */
    it('LANDING_ACTION_KINDS holds exactly the ratified member', () => {
      const policy = readFileSync(join(repo, 'src/domain/handoff/policy.ts'), 'utf8')
      const declaration = /LANDING_ACTION_KINDS[^=]*=\s*new Set<ActionKind>\(\[([\s\S]*?)\]\)/m.exec(
        policy,
      )
      expect(
        declaration,
        'LANDING_ACTION_KINDS is not declared the way this test reads it',
      ).not.toBeNull()
      expect(
        declaration?.[1]?.replace(/[\s,]/g, ''),
        'the landing set changed — a second landing kind needs its own ADR and its own pin here',
      ).toBe("'complete-purchase'")
    })

    it('completePurchase has its caller, or the granted kind cannot be carried out', () => {
      expect(
        callersOf('completePurchase(', 'src/policy/tools.ts'),
        'completePurchase has no caller — a ratified purchase would be authorised and then thrown on',
      ).toContain('src/runtime/worker-loop.ts')
    })

    it('only acceptContract writes the grant, off the ratified row', () => {
      // The kind is grantable by neither default branch (pinned in
      // tests/policy-gate.test.ts); this is the other half — the one writer
      // that may add it exists and is the accept path.
      const actions = stripComments(readFileSync(join(repo, 'src/server/actions.ts'), 'utf8'))
      expect(
        actions,
        "nothing grants 'complete-purchase' — a ratified authorisation would authorise nothing",
      ).toMatch(/allowedActionKinds\.push\('complete-purchase'\)/)
    })

    it('the extension carries the kind, or every purchase dies as not-delivered', () => {
      const cdp = stripComments(readFileSync(join(repo, 'extension/src/cdp.js'), 'utf8'))
      expect(cdp, 'performCommand has no complete-purchase arm').toContain(
        "case 'complete-purchase'",
      )
      expect(
        cdp,
        'nothing arms the landing permit — every covered non-GET meets the plain block',
      ).toContain('armLandingPermit(')
    })

    it('a landed intent can become an external-effect outcome', () => {
      // The derivation ledgerFacts performs — kind membership plus a succeeded
      // outcome — is what makes external-effect reachable at all. Pinned as a
      // read of the deriving file rather than trusted to the docblocks that
      // used to assert the opposite.
      const outcomes = stripComments(
        readFileSync(join(repo, 'src/server/outcomes/index.ts'), 'utf8'),
      )
      expect(
        outcomes,
        'nothing derives landed from LANDING_ACTION_KINDS — a landed charge would render as held work',
      ).toContain('LANDING_ACTION_KINDS.has(')

      // The derivation is only half the chain, and for a day it was the only
      // half: the set had its member and `recordOutcomes` could corroborate a
      // landed production, but `perform`'s `complete-purchase` arm produced
      // none, so no external-effect row was ever written. The producer is
      // pinned here beside the derivation because the pin above passed
      // throughout.
      const loop = stripComments(readFileSync(join(repo, 'src/runtime/worker-loop.ts'), 'utf8'))
      expect(
        loop,
        "no arm of perform produces a landed proposal — a completed purchase would write no outcome row",
      ).toContain("kind: 'landed'")
    })
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
describe('the lifecycle word is on a screen', () => {
  const projectScreen = stripImports(
    stripComments(readFileSync(join(repo, 'src/app/projects/[projectId]/page.tsx'), 'utf8')),
  )

  it('the project screen derives the word and renders it', () => {
    const screen = projectScreen

    expect(
      screen,
      'the project screen stopped calling statusWordFor — four of the five lifecycle words render nowhere again',
    ).toMatch(/statusWordFor\(/)

    // The call is not the point; the rendered result is. A call whose value is
    // discarded is what made the previous version of this assertion vacuous.
    expect(
      screen,
      'statusWordFor is called but its result is not interpolated into the kicker — that is the vacuous shape this file exists to refuse',
    ).toMatch(/kicker=\{[^}]*statusWordFor\(/)
  })

  it('it comes from frontDoorRow, so there is one derivation and not two', () => {
    expect(
      projectScreen,
      'the project screen computes a lifecycle state without frontDoorRow — that is the second derivation front-door.ts opens by refusing',
    ).toMatch(/frontDoorRow\(/)
  })
})

/**
 * The three signals that were landed and read by nothing, and now are not.
 * ADR-0018, 2026-08-20.
 *
 * ── What this replaces, and why it is not simply deleted ─────────────────
 *
 * Three `it()` blocks sat in *deferred, and asserted as deferred* below,
 * budgeting every mention of `scrollFraction`, `exitType` and `arrival` in
 * production code to an EXACT count, so that a consumer appearing anywhere went
 * red. Each ended with the same line: *"If you are here because this went red:
 * that is the system working. Move it up, and say in the commit which
 * afternoons started qualifying."* They went red on 2026-08-20 and this is the
 * move. The commit says which afternoons; so does the measurement section of
 * ADR-0018, which was written empty for this wave to fill in.
 *
 * **The count budget could not survive the promotion and its absence is a real
 * loss.** An exact count catches a mention appearing ANYWHERE, including in a
 * file nobody thought to name; what replaces it is the weaker positive claim
 * that a specific reader exists in a specific file. The thing the budget was
 * protecting is now protected behaviourally instead, and by more than one test:
 * `tests/detection.test.ts` holds what each signal changes and — for exit type
 * and for four of the five arrivals — what it still does not, and
 * `tests/grounds.test.ts` holds the bar in both directions. That is the trade,
 * written down rather than discovered when somebody wonders where the budget
 * went.
 *
 * **The helper went with the budget, one merge late.** `unallowedMentions` —
 * the exact-count loop the three blocks shared, and the argument for why the
 * count had to be exact rather than a ceiling — kept its declaration and its
 * docblock after its last caller was deleted, and spent a merge as a documented
 * mechanism that nothing invoked, in the file whose entire subject is code
 * nothing calls. By the time it was removed, prose under `src/` had already
 * been pointing at it as a live tripwire for that whole merge. It is deleted
 * rather than handed a fresh caller: reinstating an exact-count budget reverses
 * the trade above, and that is a decision with an argument behind it, not a
 * repair.
 *
 * ── The third deferral also carried an EXPIRY, and it is discharged here ─
 *
 * `arrival`'s block said: either the offer-rate measurement gets built and all
 * three get judged against it, **or the honest move is to DELETE the three
 * fields rather than keep filling them indefinitely.** All three are consumed
 * now, which closes the branch that was worrying — a product that defends
 * narrow watching cannot also collect indefinitely against a use nobody has
 * argued. `npm run eval -- --report` still prints offers-per-observed-hour and
 * still has nobody's real afternoons behind it; that is ADR-0018's *Revisit
 * when*, and it is a different debt from this one.
 */
describe('the three landed signals are consulted, and each by something named', () => {
  const detectTs = join('src', 'domain', 'detection', 'detect.ts')
  const topicsTs = join('src', 'domain', 'detection', 'topics.ts')
  const groundsTs = join('src', 'domain', 'detection', 'grounds.ts')

  const codeOf = (name: string) =>
    stripImports(stripComments(readFileSync(join(repo, name), 'utf8')))

  /**
   * Not vacuous, exactly as the three deferrals were not: with a field deleted,
   * every claim below would be about something that no longer exists.
   */
  it('still declares all three on the observation, or these assertions are about nothing', () => {
    const declared = stripComments(readFileSync(join(repo, detectTs), 'utf8'))

    expect(declared).toMatch(/readonly scrollFraction\?/)
    expect(declared).toMatch(/readonly exitType\?/)
    expect(declared).toMatch(/readonly arrival\?/)
  })

  it('carries all three off the observation and onto the page a ground can see', () => {
    /**
     * The hop that was missing for the whole build. `AmbientObservation` had the
     * fields, `pagesOf` projected the buffer onto `ThreadPage` by hand, and the
     * three were dropped there — so a rule could not have read them if it wanted
     * to. `arrival` arrives as `returnArrivals`, because the thing a ground asks
     * is not *how was this page reached* but *how was it RETURNED to*.
     */
    const declared = stripComments(readFileSync(join(repo, topicsTs), 'utf8'))

    expect(declared, 'ThreadPage no longer carries the scroll fraction').toMatch(
      /readonly scrollFraction\?/,
    )
    expect(declared, 'ThreadPage no longer carries the exit type').toMatch(/readonly exitType\?/)
    expect(declared, 'ThreadPage no longer carries the return arrivals').toMatch(
      /readonly returnArrivals\?/,
    )

    /**
     * ── The needles matched the folds' own declarations, 2026-08-20 ────────
     *
     * This loop read `'scrollByUrl('`, `'exitByUrl('` and
     * `'returnArrivalsByUrl('` out of `codeOf(detectTs)`. `codeOf` strips
     * comments and imports; it does not strip DEFINITIONS, and all three folds
     * are defined in the same file `pagesOf` lives in. So each needle was
     * satisfied by `function scrollByUrl(` a hundred lines below the call, and
     * the assertion was about the helpers existing rather than about anything
     * calling them. Measured: deleting the three conditional spreads that put
     * the folded values onto `ThreadPage` — the exact state the message below
     * names — left this file at 85 passed.
     *
     * `callersOf` avoids this shape by excluding the defining file. This pin
     * cannot use it, because here the caller and the definition ARE the same
     * file. So it names the two texts a projection needs and a regression takes
     * away: the fold's result bound in `pagesOf`, and that binding reaching the
     * page. Either half alone is a fold nobody reads or a field nobody fills.
     */
    const projection = codeOf(detectTs)
    for (const [call, fill] of [
      ['const scroll = scrollByUrl(observations)', 'scrollFraction: scroll.get(o.url)'],
      ['const exits = exitByUrl(observations)', 'exitType: exits.get(o.url)'],
      ['const returns = returnArrivalsByUrl(observations)', 'returnArrivals: returns.get(o.url)'],
    ] as const) {
      expect(
        projection,
        `pagesOf no longer folds the buffer with \`${call}\` — nothing is left to fill the field`,
      ).toContain(call)
      expect(
        projection,
        `pagesOf folds the buffer and drops the result — \`${fill}\` is gone, so the field is declared and nothing fills it, which is the state all three spent the build in`,
      ).toContain(fill)
    }
  })

  it('consults the scroll fraction and the exit type where READ is claimed', () => {
    // `heldOpenUnread` is the conjunction and it is the only reader of either.
    // Named rather than counted, so that moving the predicate somewhere else is
    // a decision somebody takes here.
    const grounds = codeOf(groundsTs)

    expect(grounds, 'nothing in grounds.ts reads scrollFraction').toContain('scrollFraction')
    expect(grounds, 'nothing in grounds.ts reads exitType').toContain('exitType')
    expect(grounds, 'heldOpenUnread is gone — the two signals have no conjunction left').toContain(
      'heldOpenUnread(',
    )
    /**
     * And it gates BOTH grounds ADR-0018 sends it to, rather than one of them.
     *
     * That sentence sat over `toContain('wasRead(page, READ_AROUND_MS)')`,
     * which could not say it: the text appears twice in `grounds.ts` — once in
     * `readAround`, once in `comparedOptions` — and either occurrence satisfies
     * `toContain`, so it held neither in particular. Deleting the
     * `comparedOptions` one left this pin green and, before the negative in
     * `tests/grounds.test.ts` existed, left the whole suite green with it — and
     * it is not a no-op: `heldOpenUnread` is already unreachable under
     * `COMPARISON_SCROLL_FRACTION`, so that line IS the twenty-second floor.
     * Without it, pages glanced at for a second each start producing
     * `compared-options` — a bar-LOWERING ground firing on the false-positive
     * class ADR-0008 names as the expensive failure.
     *
     * Counted, because the two call sites are two lines of identical text and
     * there is nothing else to tell them apart by. EXACT rather than at least
     * two, for the reason an exact count is worth its tripwire: a third ground
     * consulting the read floor, or the predicate hoisted into a local, is a
     * decision to take in the file that says which grounds it gates.
     *
     * The behavioural half is `tests/grounds.test.ts`, which now holds a floor
     * negative for each of the two grounds. This is the structural half, and
     * neither is a substitute for the other.
     */
    expect(
      grounds.match(/wasRead\(page, READ_AROUND_MS\)/g) ?? [],
      'the read floor gates one ground and not both — see comparedOptions in grounds.ts',
    ).toHaveLength(2)
  })

  it('consults the arrival where a RETURN is claimed, and nowhere else', () => {
    /**
     * The narrowest of the three and the one the deferral argued hardest
     * against, so what it may do is asserted rather than described. `arrival` is
     * read by `cameFromElsewhere`, which `returnedTo` calls, and by
     * `comparedOptions` through `COMPARISON_ARRIVAL`. It is NOT an intent ground
     * of its own — a `'no-referrer'` arrival is produced by every omnibox search
     * and by every newsletter link that strips its referrer, so a ground keyed
     * on the value rather than on the return would fire on the exact afternoon
     * `grounds.ts` exists to refuse.
     */
    const grounds = codeOf(groundsTs)

    expect(grounds, 'nothing reads how a return was arrived at').toContain('returnArrivals')
    expect(grounds).toContain('cameFromElsewhere(')
    expect(grounds).toContain('RETURN_ARRIVALS')

    // The offer bar is not where an arrival may be consulted. `front-door.ts`
    // was the file the old budget could not see, and the measured mutation that
    // proved it — suppressing every strand on a `'no-referrer'` arrival — passed
    // the whole suite. It stays out.
    for (const name of [
      join('src', 'server', 'front-door.ts'),
      join('src', 'server', 'compose-offer.ts'),
      join('src', 'server', 'ambient-store.ts'),
    ]) {
      expect(
        codeOf(name),
        `${name} reads an arrival — the offer bar is not where that decision belongs`,
      ).not.toMatch(/\barrival\b|\breturnArrivals\b/)
    }
  })
})

/**
 * A question can be answered, and the answer has exactly two writers. ADR-0022.
 *
 * ── Why this needed a pin at all ─────────────────────────────────────────
 *
 * `src/persistence/repositories/index.ts` carried a long docblock explaining
 * that `openDecisions` was hardcoded to zero because a `DecisionNeeded` "has no
 * answered, resolved or verdict column; nothing deletes one" — and the note it
 * pointed at offered a toggle whose own copy said *"Propositum doesn't keep
 * your answer."* That was the product telling somebody, in its own interface
 * copy, that it was not listening.
 *
 * This was in *deferred, and asserted as deferred* for exactly one commit, and
 * it went red the way that block is supposed to: something started writing the
 * row, so the claim moved up here rather than slipping in with the schema.
 */
describe('a raised decision can be answered', () => {
  it('is reached from the re-entry note', () => {
    expect(callersOf('answerDecision(', 'src/server/actions.ts')).toContain(
      join('src', 'ui', 'shift-report.tsx'),
    )
  })

  /**
   * The write has ONE door.
   *
   * `reports.answer` is the only thing that creates a `DecisionVerdict`, and
   * this asserts nothing reaches `prisma.decisionVerdict` around it. The same
   * shape `ConfirmationVerdict` holds by having exactly two server actions:
   * a verdict with two writers is a verdict with two sets of rules.
   */
  it('is written through the repository and nowhere else', () => {
    const writers = PRODUCTION.filter((file) => {
      const source = stripImports(stripComments(readFileSync(file, 'utf8')))
      return /decisionVerdict\s*\.\s*create/.test(source)
    }).map((file) => relative(repo, file))

    expect(writers).toEqual([join('src', 'persistence', 'repositories', 'index.ts')])
  })

  /**
   * The property ADR-0021 rests on when it lets this one verdict be given from
   * a phone: an answer grants nothing. `tests/thread-scope.test.ts` holds the
   * containment; this holds the narrower fact that the action itself never
   * reaches the gate.
   */
  it('never reaches the gate', () => {
    for (const file of PRODUCTION) {
      const source = stripImports(stripComments(readFileSync(file, 'utf8')))
      if (!source.includes('compilePolicy(')) continue
      expect(
        source,
        `${relative(repo, file)} evaluates the policy and mentions answering a decision`,
      ).not.toMatch(/\banswerDecision\b|\bDecisionVerdict\b/)
    }
  })
})

/**
 * The channel can speak, and exactly two callers make it. ADR-0021.
 *
 * ── Why this moved up, and what it cost ──────────────────────────────────
 *
 * These were in *deferred, and asserted as deferred* for two commits: the
 * message set was built and pinned as unsendable while the transport did not
 * exist. They went red the way that block is supposed to.
 *
 * The claim that moves with them is the one ADR-0021 spends a promise on —
 * `docs/SECURITY_AND_PRIVACY.md` no longer says *"Nothing about what you read,
 * wrote or handed over is stored anywhere but here"*, because as of the commit
 * that turned these red it is not true. `tests/thread-scope.test.ts` holds what
 * replaced it.
 */
/**
 * Setting Propositum up is reachable, and the derivation is not in the page.
 *
 * ── Why a route needs an assertion at all ────────────────────────────────
 *
 * `tests/reachability.test.ts` already pins `WhereYouLeftOff` by file path to
 * stop screens quietly disappearing, and this is the same hazard pointing the
 * other way: a setup screen nothing links to is a setup screen nobody finds, and
 * the whole reason it exists is that the current first-run experience is a hint
 * buried in a JSON body.
 */
describe('setting Propositum up', () => {
  it('is linked from the front door', () => {
    const home = stripImports(stripComments(readFileSync(join(repo, 'src/app/page.tsx'), 'utf8')))
    // The path, however it is quoted — JSX writes `href="/first-run"` and a
    // needle that assumed one quoting style would go red on a formatter run.
    expect(home, 'nothing links to /first-run — a setup screen nobody finds').toMatch(
      /['"]\/first-run['"]/,
    )
  })

  /**
   * The step ordering is the half that fails silently, so it may not live in a
   * `.tsx`. `src/app/page.tsx`'s own docblock: *"a decision that fails silently
   * does not live in a `.tsx` file."*
   */
  it('decides which step somebody is on outside the page', () => {
    // Three callers since 2026-08-30: the front door, the first-run page, and
    // the route the tray polls — the one HTTP door setup state has.
    expect(callersOf('firstRunState(', 'src/server/first-run.ts').sort()).toEqual(
      [
        join('src', 'app', 'page.tsx'),
        join('src', 'app', 'first-run', 'page.tsx'),
        join('src', 'app', 'api', 'first-run', 'route.ts'),
      ].sort(),
    )
    expect(callersOf('stepFrom(', 'src/server/first-run.ts')).toEqual([])
    // The ask's ordering is the same kind of silent decision, held the same
    // way: computed in the module, rendered by exactly the page.
    expect(callersOf('consentOrder(', 'src/server/first-run.ts')).toEqual([
      join('src', 'app', 'first-run', 'page.tsx'),
    ])
  })

  /** Pairing writes through one door, so there is one thing to read. */
  it('pairs an extension through the server action and nowhere else', () => {
    expect(callersOf('pairExtension(', 'src/server/extension-pairing.ts')).toEqual([
      join('src', 'server', 'actions.ts'),
    ])
  })
})

/**
 * Getting work in and out, added 2026-08-26.
 *
 * `src/ui/document.tsx` is a capability rather than a rendering: it is the only
 * file that can read a file a person chose, and the only one that can hand a
 * document back. Built and rendered by nobody, it would be the exact shape this
 * file exists to refuse — a working import with no way to reach it, and a green
 * suite underneath.
 *
 * The screen is asserted by name rather than by count, for the reason the
 * `WhereYouLeftOff` block above gives: a count passes on a component rendered
 * twice in one place and nowhere in the other.
 */
describe('a document can be brought in and taken out', () => {
  const component = 'src/ui/document.tsx'
  const project = join('src', 'app', 'projects', '[projectId]', 'page.tsx')

  it('the editor is on the project screen, or importing reaches nothing', () => {
    expect(
      callersOf('DocumentWorkbench', component),
      'nothing renders the editor — copy, download and file import are unreachable',
    ).toContain(project)
  })

  it('the first-document form is too, or a new project cannot be given one', () => {
    // The two are separate components on purpose and they fail separately: an
    // empty project reaching only the editor would have no way to name the
    // document, and the reverse would give a person one shot at the text.
    expect(
      callersOf('DocumentDraft', component),
      'nothing renders the empty-project form — a new project can never get a document',
    ).toContain(project)
  })

  /**
   * The same rule as `firstRunState` above, for the same reason.
   *
   * `whereItStopped` moved out of `src/app/shifts/[contractId]/page.tsx` on
   * 2026-09-02 so it could be tested — a `.tsx` server component being the one
   * thing nothing here can render. That move took only half of the precedent it
   * cites: `src/server/welcome.ts`'s successor is pinned above, and a
   * derivation nothing calls is exactly what this file exists to catch.
   *
   * Delete the call and every finished shift loses its heading sentence, with
   * `tests/where-it-stopped.test.ts` still green — that file tests the
   * derivation and says so in its own docblock.
   */
  it('the shift note asks somebody else where the run stopped', () => {
    expect(
      callersOf('whereItStopped(', 'src/domain/intention/where-it-stopped.ts'),
      'nothing renders where the run stopped — the note lost its heading sentence',
    ).toEqual([join('src', 'app', 'shifts', '[contractId]', 'page.tsx')])
  })

  /**
   * The release pipeline, which was in neither block — #156.
   *
   * `stage` and `signRuntime` are the two halves of what a shipped `.dmg` is
   * made of: one stages the runtime tree into the bundle, the other signs every
   * Mach-O in it. `tests/stage-runtime.test.ts` holds the staging invariants
   * and nothing held the WIRING, so both were built, tested, and asserted by
   * this file to be neither reached nor deliberately deferred — the exact hole
   * AGENTS.md says this file exists to close.
   *
   * `scripts/release-tray.ts` is the one caller and `npm run tray:build` is the
   * one way in, so the chain is pinned end to end rather than at its middle.
   *
   * WHAT THIS DOES NOT COVER: that the pipeline works. Nothing here signs
   * anything — that needs a Developer ID certificate and a notary credential,
   * which is `docs/todo/01-menu-bar-app.md`'s *"what you have to do yourself"*
   * table, not a test.
   */
  it('the release script is what runs the staging and the signing', () => {
    expect(
      callersOf('stage(', 'scripts/stage-runtime.ts'),
      'nothing stages the runtime — a bundle would ship without one',
    ).toContain(join('scripts', 'release-tray.ts'))

    expect(
      callersOf('signRuntime(', 'scripts/sign-runtime.ts'),
      'nothing signs the staged runtime — Gatekeeper refuses the app',
    ).toContain(join('scripts', 'release-tray.ts'))

    // And the one door a person or a workflow actually uses.
    const scripts = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(scripts.scripts['tray:build']).toContain('release-tray')
  })

  it('the project screen no longer carries an editor of its own', () => {
    // The half a caller check cannot see. Both components could be rendered
    // and a leftover `<textarea name="content">` in the page would still be
    // the door people actually used — with no file picker, no export, and its
    // own idea of what a document is.
    const page = stripComments(readFileSync(join(repo, project), 'utf8'))

    expect(page, 'the project screen has its own textarea again').not.toMatch(
      /<textarea[^>]*name="content"/,
    )
  })
})

describe('the channel can speak, from two feeds and no others', () => {
  /**
   * Two feeds, because the facts live in two processes.
   *
   * A composed offer is in an in-memory map in the Next app process and ADR-0008
   * refuses to give it a row, so the worker cannot see one. Everything else is
   * durable and the worker can. A third caller is a third place that decides
   * when Propositum speaks, which is the thing Principle 13 says erodes first.
   */
  it('is sent from the orchestrator and from nowhere else', () => {
    for (const message of [
      'offerMessage(',
      'confirmationMessage(',
      'decisionMessage(',
      'runEndedMessage(',
      'captureGapMessage(',
    ]) {
      expect(
        callersOf(message, 'src/domain/conversation/messages.ts'),
        `${message} has a second caller — every message goes through src/server/thread.ts`,
      ).toEqual([join('src', 'server', 'thread.ts')])
    }
  })

  /**
   * The offer feed hangs off the counter, and that is deliberate.
   *
   * ADR-0015 counts offers shown per hour of observed browsing so that somebody
   * can notice this product getting louder. A channel that spoke without landing
   * in that denominator would be the erosion with the smoke alarm disconnected —
   * so the send and the count sit on ONE gate, `newlyShown`, and this asserts
   * they are still in the same function rather than trusting the comment.
   */
  it('says an offer on the same gate that counts one', () => {
    const poll = readFileSync(join(repo, 'src/app/api/session/current/route.ts'), 'utf8')
    const body = stripImports(stripComments(poll))

    expect(body, 'the poll route no longer says offers').toContain('sayOffer(')
    expect(
      body,
      'sayOffer is no longer beside countQuietly — the send and the loudness counter must fire on one gate',
    ).toMatch(/newlyShown\([\s\S]{0,400}sayOffer\(/)
  })

  /**
   * Inbound writes one kind of row, and the union is what makes that true.
   *
   * `parseReply` has no member a confirmation answer could become, which is the
   * form ADR-0021's refusal takes: not a check that could be removed, an absence
   * that would have to be built.
   */
  it('parses a reply in the orchestrator and nowhere else', () => {
    expect(callersOf('parseReply(', 'src/domain/conversation/reply.ts')).toEqual([
      join('src', 'server', 'thread.ts'),
    ])
  })

  /** One file knows the provider's API. A second transport is a new file here. */
  it('keeps the provider behind one transport', () => {
    const speakers = PRODUCTION.filter((file) => {
      const source = stripImports(stripComments(readFileSync(file, 'utf8')))
      return /api\.telegram\.org/.test(source)
    }).map((file) => relative(repo, file))

    expect(speakers).toEqual([join('src', 'runtime', 'thread-channel.ts')])
  })

  /**
   * The transport holds a credential in every URL it builds, so it may not log.
   *
   * `src/server/calendar.ts` has no `console` call for exactly this reason and
   * says so. One `console.error(url)` on a failure path puts a bot token in a
   * terminal and, eventually, in an issue.
   */
  it('never logs, because the token is in the URL', () => {
    const source = stripComments(
      readFileSync(join(repo, 'src/runtime/thread-channel.ts'), 'utf8'),
    )
    expect(source, 'the transport logs — the bot token is in every URL it builds').not.toMatch(
      /\bconsole\s*\./,
    )
  })
})

describe('deferred, and asserted as deferred', () => {
  /**
   * The computer-use tables, landed ahead of everything that uses them.
   *
   * Schema and repositories are one unit and the paths that write them are
   * several others, so for one commit these were tables with guards,
   * repositories with tests, and no callers — the exact shape of every bug the
   * section above exists to remember. Asserting the absence is what stops that
   * shape from being indistinguishable from the accident: it turns this file
   * RED the moment something calls it, which forces the claim up into the
   * reachable section rather than leaving it ambiguous.
   *
   * **This block held four assertions, then one, and now holds NONE.**
   * Boundary 6, the gap sweeper and the outcome-scoped finding were promoted
   * on 2026-08-27. The last and most different — the emptiness of
   * `LANDING_ACTION_KINDS`, held shut by the transport's unconditional
   * non-`GET` refusal rather than by a missing wire — went red on 2026-09-01,
   * on the commit that built ADR-0024, exactly as its own text instructed:
   * *"If you are here because it went red: that is the system working, and
   * ADR-0024 is the argument you are looking for. Move it."* It was moved.
   * Its positive replacement is `describe('the landing kind is reachable…')`
   * in the section above, and the empty block stays so the next deferred
   * capability has somewhere to land.
   */

  // (The emptiness pin lived here from 2026-08-26 to 2026-09-01. See the
  // block header for where it went and why.)

  it('holds nothing, and the promotions it points at exist', () => {
    // An empty describe fails the runner, so the block's one occupant asserts
    // its own claim: every once-deferred capability was moved UP, not deleted.
    const self = readFileSync(join(repo, 'tests/reachability.test.ts'), 'utf8')
    expect(
      self,
      'the landing-kind promotion is gone — a deferred capability was deleted rather than moved',
    ).toContain("describe('the landing kind is reachable")
  })


})

/**
 * The tab group title reaches the NAME, and nothing else. ADR-0013.
 *
 * ── Why containment is asserted rather than described ────────────────────
 *
 * The manifest pays a real install warning for `tabGroups` — *"View and manage
 * your tab groups"* — on the strength of one promise: the label may improve a
 * name and may never make an offer fire. `tests/detection.test.ts` pins the
 * behavioural half (grounds and sufficiency byte-identical either way). This
 * pins the structural half, which is that the value has one reader.
 *
 * Two separate hazards, and they fail differently:
 *
 *   - **A prompt.** A tab group title is untrusted text: it is typed by a
 *     person, but a person can be induced to type anything, and it is exactly
 *     as page-adjacent as a page title. `name-thread.ts` and `compose-offer.ts`
 *     name their model inputs field by field and `datamark` every page-authored
 *     one. Adding this to either without `datamark` would be raw untrusted text
 *     in a prompt, which is the single thing ADR-0006 exists to prevent.
 *   - **A gate.** `compilePolicy` is the function the gate evaluates. Nothing
 *     derived from ambient observation may reach it; scope and controls come
 *     from a ratified contract. A grep is a coarse instrument for that and it
 *     is the right one here, because the failure it catches is somebody
 *     plumbing a convenient string through by hand.
 */
describe('the group title reaches the name and no prompt and no gate', () => {
  const named = (needle: string) =>
    PRODUCTION.filter((f) =>
      stripImports(stripComments(readFileSync(f, 'utf8'))).includes(needle),
    ).map((f) => relative(repo, f))

  it('is read by exactly the files that carry it and the one that renders it', () => {
    // Producer, carrier, and the sentence. Anything else is a new reader and a
    // new decision. `route.ts` is the door; `detect.ts` and `topics.ts` carry
    // it; `ambient-store.ts` is `describeWork`.
    expect(named('groupTitle').sort()).toEqual(
      [
        join('src', 'app', 'api', 'capture', 'ambient', 'route.ts'),
        join('src', 'domain', 'detection', 'detect.ts'),
        join('src', 'domain', 'detection', 'topics.ts'),
      ].sort(),
    )
  })

  it('reaches the sentence and stops there', () => {
    // `authoredLabel` is the name the thread carries. `topics.ts` computes it,
    // `detect.ts` copies it onto `WorkDetected`, `ambient-store.ts` renders it.
    // A fourth file is a fourth thing that can do something with a label
    // somebody typed.
    expect(named('authoredLabel').sort()).toEqual(
      [
        join('src', 'domain', 'detection', 'detect.ts'),
        join('src', 'domain', 'detection', 'topics.ts'),
        join('src', 'server', 'ambient-store.ts'),
      ].sort(),
    )
  })

  it('never reaches a model boundary', () => {
    // The two files that build prompts out of a detection. Both list their
    // inputs by name; neither may list this one without `datamark`, and the
    // honest way to add it is to turn this red first.
    for (const builder of [
      join('src', 'server', 'name-thread.ts'),
      join('src', 'server', 'compose-offer.ts'),
    ]) {
      const source = stripImports(stripComments(readFileSync(join(repo, builder), 'utf8')))

      expect(source, `${builder} builds a prompt and no longer names its inputs`).toContain(
        'datamark(',
      )
      expect(
        source,
        `${builder} now puts a tab group title in a prompt — it is untrusted person-typed text and must cross datamark first, on the same terms as detected.titles`,
      ).not.toMatch(/\b(groupTitle|authoredLabel)\b/)
    }
  })

  it('never reaches the gate', () => {
    // `compilePolicy` reads a ratified scope and the person's controls. A label
    // out of the ambient buffer has no business anywhere near it.
    for (const file of PRODUCTION) {
      const source = stripImports(stripComments(readFileSync(file, 'utf8')))
      if (!source.includes('compilePolicy(')) continue

      expect(
        source,
        `${relative(repo, file)} evaluates the policy and mentions a tab group title in the same file — nothing ambient may reach a gate`,
      ).not.toMatch(/\b(groupTitle|authoredLabel)\b/)
    }
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

  /**
   * The extension actually sends the fields the app has fields for. ADR-0013.
   *
   * ── The defect this is written about, which shipped and lasted ───────────
   *
   * `flushAmbient` hand-builds the ambient wire shape field by field. So a field
   * added to `content.js` AND to the app's schema is still carried by nobody
   * until a line appears in that projection — and `scrollFraction` spent the
   * whole build in exactly that state. It was computed on every engagement
   * report, given a field at the door on 2026-08-17, and reachable by `curl` and
   * by nothing a browser does, while ADR-0008's decision table and two comments
   * in `detect.ts` all said ambient capture carried "dwell and scroll".
   *
   * That is this file's own subject — correct, tested code nothing reaches —
   * with the twist that the unreachable half was in a component no unit test
   * runs. A grep is what is available, and the property that makes it real is
   * the extension's: no build step (ADR-0002), so the text searched is the text
   * Chrome executes. `tests/extension-permissions.test.ts` rests on the same
   * property and argues it at greater length.
   *
   * What this does NOT prove: that the value is correct, that Chrome fires the
   * event, or that a real batch is accepted. It proves the line exists. That is
   * exactly the class of bug that occurred.
   */
  it('flushAmbient carries every field the ambient schema accepts', () => {
    const worker = extensionSource('service-worker.js')
    const schema = stripComments(
      readFileSync(join(repo, 'src/app/api/capture/ambient/route.ts'), 'utf8'),
    )

    /**
     * Sliced to the projection, not searched over the whole worker.
     *
     * WAS a `expect(worker).toContain(field)` over the entire file, and
     * CORRECTED 2026-08-17 because for one of the three fields it asserted
     * nothing. `scrollFraction` and `exitType` occur only inside this
     * projection, so a whole-file `toContain` was a real guard for them —
     * deleting `exitType`'s line does go red. `groupTitle` occurs four times:
     * `groupTitleOf`'s declaration, its call site, the `bufferAmbient` spread,
     * AND the projection. Any one of the first three kept the assertion green,
     * and deleting only the projection line — leaving the permission paid for,
     * the lookup performed and the label buffered, with nothing ever leaving
     * the browser — passed the whole suite, 1357/1357. That is precisely the
     * `scrollFraction` defect this test was written about, reproduced by the
     * test that was written about it.
     *
     * The slice is the technique `tests/extension-permissions.test.ts` already
     * uses on `groupTitleOf`, and with the same honest limit: it is text, to
     * the next top-level declaration, and a parser would be better.
     */
    const from = worker.indexOf('async function flushAmbient')
    expect(from, 'flushAmbient is gone — this guard has no projection to be about').toBeGreaterThan(
      -1,
    )
    const rest = worker.slice(from + 1)
    const next = rest.search(/\n(async function|function|const|let|chrome\.)/)
    const projection = next === -1 ? rest : rest.slice(0, next)

    // Non-vacuous: the slice has to contain the projection's oldest field, or
    // the slicing is wrong and every assertion below is about an empty string.
    expect(
      projection,
      'the flushAmbient slice does not even contain engagedMs — the slice is wrong, not the code',
    ).toContain('engagedMs')

    for (const field of ['scrollFraction', 'exitType', 'groupTitle', 'arrival']) {
      // Both ends, so this cannot go green by the field quietly leaving the
      // schema — which would be the same silence in the other direction.
      expect(schema, `ambientSchema no longer accepts ${field}`).toContain(field)
      expect(
        projection,
        `flushAmbient does not send ${field} — the app has a field for it and nothing a browser does fills it, which is exactly how scrollFraction spent the whole build`,
      ).toContain(field)
    }

    /**
     * And the two fields that must NOT make the trip. Added 2026-08-18.
     *
     * `content.js` puts `referrer` and `navigationType` on every navigation
     * signal, and the session path consumes both — `src/capture/semantics.ts`
     * cleans the referrer and stores it, because a session is consented, scoped
     * to approved sources and auditable row by row. The ambient buffer is what
     * Propositum saw while nobody asked, and a referrer is the URL of a page
     * somebody came FROM, which may be somewhere nothing else here observes.
     *
     * So the ambient path takes the CLASSIFICATION — `arrival`, one of five
     * words computed inside the content script — and never the URL it was
     * computed from. That is a property of this projection and of nothing else:
     * the signal arrives at the service worker whole, the buffer holds it
     * whole, and this hand-built object is the one place that decides what
     * travels. `ambientSchema` would strip a referrer anyway, but a value that
     * leaves the browser and is discarded at the far end has still left the
     * browser.
     *
     * Non-vacuous: `flushAmbient` is the projection, so a line adding either
     * field is a line inside this slice. The assertion is deliberately on the
     * SLICE and not on the whole worker, for the reason the comment above gives
     * about `groupTitle`.
     */
    for (const field of ['referrer', 'navigationType']) {
      expect(
        projection,
        `flushAmbient now sends ${field} — the ambient path is supposed to carry the arrival classification and never the URL it was computed from`,
      ).not.toContain(field)
    }
  })

  it('the content script classifies the arrival itself, so the referrer stays on the page', () => {
    /**
     * The producer half. Without it the app's `z.enum` has nothing to receive,
     * which is precisely the state `scrollFraction` was in for the whole build.
     *
     * The comparison is what makes this a privacy assertion rather than a
     * plumbing one: the classification has to happen HERE, in the document,
     * because that is the only place `document.referrer` exists.
     *
     * ~~so a design that sent the URL to the service worker and classified it
     * there would have moved a URL across a process boundary for no gain.~~
     * **Struck 2026-08-18, the same day, because the shipped design sends the
     * URL to the service worker anyway** — `content.js` cannot know whether a
     * session is running, and the session path needs the referrer, so it rides
     * every navigation message. What classifying in the page actually buys is
     * narrower and still real: the worker's ambient branch can DELETE the
     * referrer, which it now does, and still have something to say about how the
     * page was reached. Classifying in the worker would have made the deletion
     * impossible — you cannot drop the input and keep the derivation. The
     * assertion below is unchanged; only the reason for it was overstated.
     */
    const content = extensionSource('content.js')

    expect(content, 'nothing declares the closed set — a fourth value could be invented').toContain(
      'ARRIVALS',
    )
    expect(
      content,
      'nothing classifies the arrival, so the ambient field is dead on arrival',
    ).toContain('function arrivalOf')
    // The comparison that keeps the URL local: an origin against this page's.
    expect(
      content,
      'the referrer is no longer reduced to an origin comparison — something else is being sent',
    ).toMatch(/new URL\(referrer\)\.origin === location\.origin/)
  })

  it('the ambient branch drops the referrer before anything buffers it', () => {
    /**
     * The gate the arrival change was described as having and did not. Added
     * 2026-08-18, after review.
     *
     * ── What was actually true, and what five sentences claimed ──────────
     *
     * `flushAmbient` never put a referrer on the wire, so the APP never saw
     * one — the assertion above this one holds that end and always did. Five
     * places said something stronger: that the URL never left the page.
     * `content.js` sends `referrer` and `navigationType` on EVERY navigation,
     * because it must not be able to tell whether a session is running and the
     * session path consumes both. The worker's no-session branch destructured
     * only `text` out, and `bufferAmbient` wrote the rest — referrer included —
     * into `chrome.storage.session`, where it stayed until the next flush and,
     * whenever the app was unreachable, was put back by `returnAmbient` for the
     * life of the browser session.
     *
     * The fix is one destructure and it costs nothing on the wire, which is why
     * it was taken rather than the sentences merely reworded: an always-on
     * buffer holding the address of a page nothing else here observes is the
     * thing the whole asymmetry exists to refuse.
     *
     * ── Why this is asserted here and not left to the projection guard ───
     *
     * Two gates. `flushAmbient` decides what leaves the browser; this decides
     * what the browser holds. The projection guard cannot see the second, and a
     * value deleted at the far end has still been kept at this one. Both are
     * pinned because both have to hold.
     *
     * Honest limit, the same one every slice in this file carries: it is text to
     * a marker, not a parse. A destructure that named the fields and then a line
     * that put them back would satisfy this.
     */
    const worker = extensionSource('service-worker.js')

    /**
     * Backwards from the response, not forwards from the first `if (!session)`.
     *
     * Written forwards first, and it was wrong in the way this file keeps
     * finding: `if (!session) {` occurs earlier in the worker, so the slice ran
     * from line 89 to line 1900 and every assertion below would have been
     * satisfied by a destructure anywhere in eighteen hundred lines. It passed,
     * which is the point — a slice that is too WIDE fails silently in the green
     * direction. Hence the length bound as well as the containment check.
     */
    const end = worker.indexOf('ambient: true')
    expect(end, 'the ambient branch no longer answers with `ambient: true`').toBeGreaterThan(-1)
    const from = worker.lastIndexOf('if (!session) {', end)
    expect(
      from,
      'the no-session branch is gone — this guard has no branch to be about',
    ).toBeGreaterThan(-1)
    const branch = worker.slice(from, end)

    // Non-vacuous, both ways. It has to contain the call whose argument is the
    // thing being constrained, and it has to be a BRANCH rather than a third of
    // the file that happens to contain one.
    expect(
      branch,
      'the no-session slice does not contain bufferAmbient — the slice is wrong, not the code',
    ).toContain('bufferAmbient(')
    expect(
      branch.length,
      'the no-session slice ran away — it is now long enough to contain code from elsewhere, so re-anchor it rather than trusting what it matched',
    ).toBeLessThan(1200)

    const destructure = /const \{([^}]*)\}\s*=\s*message\.signal/.exec(branch)
    expect(
      destructure,
      'the ambient branch no longer destructures message.signal — whatever replaced it has to be checked by hand',
    ).not.toBeNull()

    // Named on the left is dropped; `...metadataOnly` carries the rest. So this
    // is the list of things the buffer may not hold.
    for (const field of ['text', 'referrer', 'navigationType']) {
      expect(
        destructure?.[1],
        `the ambient branch no longer strips ${field} — it reaches chrome.storage.session, and for referrer that is the URL of a page nobody here otherwise observes`,
      ).toContain(field)
    }
    expect(
      destructure?.[1],
      'the rest element is gone, so naming a field on the left no longer removes it from what is buffered',
    ).toContain('...metadataOnly')
  })

  it('the content script reports how a page was left, on both ways of leaving', () => {
    // Two senders, because they answer different questions and only one of them
    // existed before. `pagehide` was already reported and gained the flag;
    // `visibilitychange` is a NEW report, and without it the commonest exit of
    // all — switching to another tab and never coming back — is unobservable,
    // which is the gap `visitsByUrl` in `detect.ts` documents about itself.
    const content = extensionSource('content.js')

    expect(content, 'nothing reports an exit type — the field is dead on arrival').toContain(
      'exitType',
    )
    expect(content, 'the pagehide report no longer distinguishes a kept document').toMatch(
      /persisted\s*\?/,
    )
    expect(
      content,
      'nothing reports the hidden exit, so a tab switched away from and never closed records no exit at all',
    ).toContain("reportEngagement('hidden')")
  })

  it('the group title is looked up from a tab that messaged us, and reaches the buffer', () => {
    // The producer half of the containment block above. Without this line the
    // permission is paid for and nothing fills the field.
    const worker = extensionSource('service-worker.js')

    expect(
      worker,
      'nothing looks a tab group up — the tabGroups permission buys nothing',
    ).toContain('chrome.tabGroups.get(')
    expect(
      worker,
      'the group title never reaches the ambient buffer, so the app can only ever be told by a curl',
    ).toMatch(/bufferAmbient\([\s\S]{0,400}groupTitle/)
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

/**
 * ADR-0011's softest claim, given the closest thing to a test it can have.
 *
 * The ADR says of its own argument: *"One third of the answer to CONTEXT.md's
 * ruling is a UI requirement, not a schema property… this ADR ships no test
 * that would notice if it stopped being true."* This is that test, and it is
 * honest about being half of one.
 *
 * ~~What it cannot check is the branch that does not exist — the day something
 * pre-fills either field from an Intention, this goes red, and the fix is to say
 * WHEN those words were written rather than to loosen the grep.~~
 * **Amended 2026-08-20 ([ADR-0017](../docs/adr/0017-continuing-an-intention.md)),
 * in the wave that made the branch reachable — which is what the struck sentence
 * asked for.** `draftContract` now pre-fills from the Intention when work is
 * being picked back up, so the old grep would have gone red; it did not, because
 * the model's assignment is still there on the other arm of the same ternary,
 * which is the exact vacuity this file exists to notice. So the assertions moved
 * rather than loosened: BOTH sources are named, the discriminant that tells them
 * apart is named, and the date the second one must print is named.
 *
 * `tests/agreement-words.test.ts` renders the screen and asserts the two
 * accounts differ and that the second carries a month and a year. That is the
 * half a grep genuinely cannot do, and it is why the assertions here are about
 * the WIRING and not about the words.
 */
describe('the agreement screen says where its two sentences came from', () => {
  const drafting = () => {
    const actions = readFileSync(join(repo, 'src/server/actions.ts'), 'utf8')
    const slice = actions.slice(
      actions.indexOf('export async function draftContract'),
      actions.indexOf('export async function acceptContract'),
    )
    // Guards against the slice silently matching nothing, which would make
    // every assertion below vacuous.
    expect(slice.length).toBeGreaterThan(200)
    return slice
  }

  it('this sitting’s reading is still one of the two sources, and still the default', () => {
    expect(
      drafting(),
      'the drafted objective no longer comes from this sitting’s reading at all — a first sitting has nothing older to fall back on',
    ).toMatch(/objective:\s*drafted\.value\.objective/)
    expect(
      drafting(),
      'the drafted definition of done no longer comes from this sitting’s reading — same gap as above',
    ).toMatch(/definitionOfDone:\s*drafted\.value\.definitionOfDone/)
  })

  it('the other source is a person’s own words, carried with the day they wrote them', () => {
    /**
     * The assertion the old version could not make. A pre-fill from something
     * written before this sitting existed is precisely what `CONTEXT.md`'s
     * ruling forbids doing QUIETLY, and the date is the whole of the difference
     * between doing it and doing it quietly.
     */
    const slice = drafting()

    expect(
      slice,
      'nothing pre-fills from the Intention — the continuation ADR-0017 authorised is not wired',
    ).toMatch(/objective:\s*leftOff\.objective/)
    expect(
      slice,
      'the Intention-sourced pre-fill carries no timestamp — the screen cannot say when those words were written',
    ).toMatch(/writtenAtEpochMs:\s*leftOff\.wordsWrittenAtEpochMs/)
  })

  it('the two are told apart by a discriminant the server sets, not by the screen guessing', () => {
    const slice = drafting()
    const agreement = stripComments(readFileSync(join(repo, 'src/ui/agreement.tsx'), 'utf8'))

    expect(slice, 'the drafted contract carries no provenance').toMatch(
      /words:\s*words\.provenance/,
    )
    expect(
      agreement,
      'the agreement screen no longer reads the provenance it is handed — a threaded prop nothing branches on is the discarded-result shape this file was rewritten over',
    ).toMatch(/words\.from\s*===\s*'your-intention'/)
  })

  it('and the screen makes both claims out loud, rather than leaving either implied', () => {
    // Comments stripped for the reason the top of this file gives: the
    // component's own docblock says these phrases, and a claim satisfied by a
    // comment about the claim is the failure that verified this whole file.
    const agreement = stripComments(readFileSync(join(repo, 'src/ui/agreement.tsx'), 'utf8'))

    expect(
      agreement,
      'the agreement screen no longer says where its pre-filled sentences came from',
    ).toContain('Worked out from this session')
    expect(
      agreement,
      'the agreement screen no longer says the words are the person’s own when they are',
    ).toContain('In your own words')
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
