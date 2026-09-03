/**
 * Everything the interface can ask the server to do.
 *
 * ── Failures are values ──────────────────────────────────────────────────
 *
 * Nothing here throws for anything a person can cause. A boundary that declines,
 * a session with nothing in it, a change already decided — each of those is a
 * result the screen has to render, and an exception thrown across the server-
 * action boundary arrives at the client as an opaque digest with the reason
 * stripped out. So every export returns `ActionResult<T>`, and every failure
 * carries a sentence written for the person rather than for a log.
 *
 * The messages obey CONTEXT.md's consumer vocabulary. The gate REFUSES, the
 * human REJECTS, the model DECLINES, and none of the three is called an error.
 *
 * ── Authorization stays where it already is ──────────────────────────────
 *
 * Nothing in this file decides what a run may touch. `compilePolicy` does that,
 * from a scope and a set of dials, and it cannot be handed prose. What this file
 * does is persist the human's ratification and enqueue the run — the two acts
 * that must be a human's and are therefore in the app process, not the worker's.
 *
 * ── Where the model is called, and where it is not ───────────────────────
 *
 * Two of these actions call a model: `generateReading` and `draftContract`.
 * Both go through `ModelClient`, both fail closed, and both persist nothing
 * unless the output validated. No other action here touches a model.
 */

'use server'

import { revalidatePath } from 'next/cache'

import { appContext, existingAppContext } from './db'
import { pairExtension } from './extension-pairing'
import { beginPairing, completePairing, unpair } from './thread'
import { readableCause } from './problem'
import { confirmRequest, haltRun, rejectRequest } from './confirmations'
import { ambientStore, captureStore } from './capture-store'
import { startGapWatch, stopGapWatch } from './gap-watch'
import { countQuietly, dayBucket } from './offer-tally'
import { whereYouLeftOffIn, whereYouLeftOffOn } from './work-so-far'
import { describeWork, signatureOf } from './ambient-store'
// ADR-0014. Three imports, none of which can decide anything: a nullable
// suggestion, the one function that joins it to a drafted contract, and a
// deletion. `compilePolicy` cannot receive any of them.
import { disconnectCalendar, suggestedTimeLimit, withCalendarSuggestion } from './calendar'
import type { CalendarTimeSuggestion } from './calendar'
import { createModelClient } from '../model/provider'
import type { ModelCallSink } from '../model/provider'
import type { FailureKind, ModelClient } from '../model/client'
import { datamark, IMPORT_BUDGET_CHARS } from '../model/untrusted'
import { bringInApprovedPage } from './document-import'
import type { BroughtInPage } from '../policy/page-import'
import { handlesFor, sessionReadingBoundary } from '../model/boundaries/session-reading'
import type { PromptEvent } from '../model/boundaries/session-reading'
import { handoffBoundary, sourceHandlesFor } from '../model/boundaries/handoff'
import { EVERY_STRAND, detectThreads, threadPagesOf } from '../domain/detection/detect'
import { groundsFor } from '../domain/detection/grounds'
import { matchProject, projectTerms } from '../domain/detection/match-project'
import type { ProjectCandidate } from '../domain/detection/match-project'
import { hashSignature } from '../domain/detection/reticence'
import { checkDrift, hashContent, materialise } from '../domain/document/changeset'
import type { Decision } from '../domain/document/changeset'
import { normalise } from '../domain/document/normalise'
import { isDecidable } from '../domain/outcome/shift-outcome'
import type { WorkSoFar } from '../domain/intention/work-so-far'
import {
  MAX_PURCHASE_AMOUNT_MINOR,
  MAX_PURCHASE_COUNT,
  MUTATING_ACTION_KINDS,
  currencyOf,
  grantableActionKinds,
} from '../domain/handoff/policy'
import type { ActionKind, AutonomyControls, CurrencyCode } from '../domain/handoff/policy'
import type { ClaimInput } from '../persistence/repositories/index'

/* ══════════════════════════════════════════════════ results and problems ══ */

/**
 * Why something did not happen. `message` is consumer copy — it is rendered
 * verbatim, so it says the true thing plainly and never names a table, a
 * boundary or a status code.
 */
export interface ActionProblem {
  readonly code:
    | 'invalid-input'
    | 'not-found'
    | 'nothing-to-read'
    | 'already-done'
    | 'model-unavailable'
    | 'model-declined'
    | 'model-unusable'
    | 'blocked'
    | 'write-failed'
  readonly message: string
}

export type ActionResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: ActionProblem }

function ok<T>(value: T): ActionResult<T> {
  return { ok: true, value }
}

function no<T>(code: ActionProblem['code'], message: string): ActionResult<T> {
  return { ok: false, problem: { code, message } }
}

/**
 * A single blunt revalidation.
 *
 * The screens above this file are owned by other people and their route
 * segments are not settled. Guessing paths would produce a mutation that
 * silently does not refresh the page it changed, which is the worst of the
 * available outcomes. One local user, a SQLite file and a handful of pages make
 * the cost of revalidating the whole tree indistinguishable from zero.
 */
function refresh(): void {
  revalidatePath('/', 'layout')
}

/**
 * Nothing here throws. This is the net under that promise.
 *
 * The unexpected reason is shown rather than hidden — one local user, their own
 * machine, and "say the true thing, including when it is unimpressive". It is
 * scrubbed of the one credential the process holds first, because
 * docs/SECURITY_AND_PRIVACY.md promises the key is never rendered, and a promise
 * that depends on no library ever putting it in an error message is not one.
 */
async function attempt<T>(work: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await work()
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    const key = process.env['ANTHROPIC_API_KEY']
    const scrubbed = key ? raw.split(key).join('«key»') : raw

    return no<T>(
      'write-failed',
      `Propositum could not finish that, and nothing was changed. (${readableCause(scrubbed)})`,
    )
  }
}

/* ═════════════════════════════════════════════════════════════ the model ══ */

/**
 * Where this file's model calls are written down.
 *
 * Async on purpose, even though every caller of `modelClient()` already has a
 * context in hand: `appContext()` is memoised but returns a promise, and
 * resolving it INSIDE the sink keeps `modelClient()` synchronous, so neither
 * call site changes shape. The sink is only ever invoked fire-and-forget, so a
 * context that cannot be built loses the telemetry row rather than the action —
 * `src/model/provider.ts` holds that rejection and says why.
 *
 * No `runId`. Both callers run BEFORE any AgentRun exists — one reads a
 * finished sitting, the other drafts a working agreement — so the column is
 * null, which is ordinary rather than missing.
 */
const recordModelCall: ModelCallSink = async (row) => {
  const { repos } = await appContext()
  return repos.modelCalls.create(row)
}

function modelClient(): ModelClient | null {
  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) return null
  return createModelClient({ apiKey, record: recordModelCall })
}

/** One sentence per failure class, in the person's terms. */
function sayWhyTheModelFailed(failure: FailureKind): ActionProblem {
  switch (failure) {
    case 'refusal':
      // CONTEXT.md: the model DECLINES. Never "refused" — that word is the gate's.
      return {
        code: 'model-declined',
        message: 'Propositum declined to do that, so nothing was recorded.',
      }
    case 'truncation':
      return {
        code: 'model-unusable',
        message: 'There was more here than Propositum could take in at once. Nothing was recorded.',
      }
    case 'schema-mismatch':
      return {
        code: 'model-unusable',
        message:
          "What came back didn't hold together, so Propositum recorded nothing rather than guess.",
      }
    case 'transport':
      return {
        code: 'model-unavailable',
        message: "Propositum couldn't get through just now. Nothing was recorded — try again.",
      }
  }
}

const NO_KEY: ActionProblem = {
  code: 'model-unavailable',
  message:
    'Propositum has no way to reach its model. Add ANTHROPIC_API_KEY to .env and restart, then try again.',
}

/* ═══════════════════════════════════════════════════════ small utilities ══ */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function textOf(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

const CLOCK = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/**
 * Why a gap happened, said the way a person would say it.
 *
 * PRODUCT_PRINCIPLES §11 forbids dressing a gap up as anything other than "I
 * stopped seeing your work", so these stay flat and factual.
 */
const GAP_REASONS: Record<string, string> = {
  service_worker_terminated: 'the browser shut the extension down',
  machine_slept: 'your Mac slept',
  transport_disconnected: 'the connection dropped',
  permission_revoked: 'access to that source was withdrawn',
}

/**
 * One observation event as a plain sentence.
 *
 * This is the `attested` half only — values Chrome or Propositum itself
 * asserted. Page-authored text never comes through here; it travels separately
 * under `untrusted`, and it is datamarked before it can reach a prompt.
 */
function describeEvent(kind: string, attested: Record<string, unknown>): string {
  const title = textOf(attested, 'title')
  const url = textOf(attested, 'url')
  const where = title ?? url ?? 'an approved source'

  switch (kind) {
    case 'visited':
      return `opened ${where}`
    case 'returnedTo':
      return `came back to ${where}`
    case 'queried': {
      const term = textOf(attested, 'term')
      return term ? `searched for "${term}"` : `searched on ${where}`
    }
    case 'engaged': {
      const dwell = attested['dwellMs']
      const minutes = typeof dwell === 'number' ? Math.max(1, Math.round(dwell / 60_000)) : null
      return minutes ? `read ${where} for about ${minutes} min` : `read ${where}`
    }
    case 'excerpted':
      return `selected text on ${where}`
    case 'switchedAway': {
      const cause = textOf(attested, 'cause')
      return cause ? `stepped away from the screen (${cause})` : 'stepped away from the screen'
    }
    case 'documentEdited':
      return 'edited the document'
    case 'note':
      return textOf(attested, 'text') ?? 'wrote a note'
    case 'sourceApproved':
      return `approved ${textOf(attested, 'label') ?? where} as a source`
    case 'captureGap': {
      const from = attested['startedAtElapsedMs']
      const to = attested['endedAtElapsedMs']
      const minutes =
        typeof from === 'number' && typeof to === 'number'
          ? Math.max(1, Math.round((to - from) / 60_000))
          : null
      const reason = GAP_REASONS[String(attested['reason'] ?? '')] ?? 'Propositum was not watching'
      return minutes
        ? `Propositum stopped seeing your work for about ${minutes} min — ${reason}`
        : `Propositum stopped seeing your work — ${reason}`
    }
    default:
      return kind
  }
}

/**
 * Whitespace collapsed, case folded. CONTEXT.md's canonical normalised form.
 *
 * A quote is kept only if it survives this comparison against the cited event's
 * stored text. Raw substring matching would throw away nearly every quote,
 * because the injection defence guarantees the model never saw the raw string.
 */
function canonical(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/* ══════════════════════════════════════════════════════════════ projects ══ */

export interface ProjectCreated {
  readonly id: string
  readonly name: string
}

/**
 * A project comes into existence, and NOBODY ASKED FOR ONE.
 *
 * ── Why this is not exported any more ────────────────────────────────────
 *
 * "I don't want the user to define the projects themselves. The tools should
 * identify them for them, and then the user can edit after. Initially, they
 * shouldn't have to create it."
 *
 * There used to be a form on the front page whose whole content was this
 * function. It asked a person to name and file a piece of work before they had
 * decided they wanted help with it, which is the setup Propositum exists to
 * remove — and it asked for the one thing the product is supposed to work out
 * on its own.
 *
 * So this is internal. The only thing that calls it is the acceptance path, on
 * a subject the detector found and a model named, and nothing a person clicks
 * reaches it directly. Keeping it as a function rather than inlining the one
 * line it wraps is not ceremony: the length rule and the message a person reads
 * when a name is unusable belong in one place, and the split path below needs
 * exactly the same two.
 */
async function createProject(name: string): Promise<ActionResult<ProjectCreated>> {
  const clean = name.trim()
  if (!clean) {
    return no<ProjectCreated>(
      'invalid-input',
      'Propositum could not work out what to call this. Give it a name and it will file the work under that.',
    )
  }
  if (clean.length > 120) {
    return no<ProjectCreated>(
      'invalid-input',
      'That name is too long — keep it under 120 characters.',
    )
  }

  const { repos } = await appContext()
  return ok(await repos.projects.create(clean))
}

/**
 * The person fixes the name Propositum gave it.
 *
 * This is the other half of the sentence at the top of this section — the tools
 * identify the work, and the person edits afterwards. Auto-naming is only
 * acceptable if it is correctable, so this is not a nicety and it is not
 * deferrable: without it, a subject the model got slightly wrong is a label
 * nobody can ever change.
 */
export async function renameProject(
  projectId: string,
  name: string,
): Promise<ActionResult<ProjectCreated>> {
  return attempt(async () => {
    const clean = name.trim()
    if (!clean) return no<ProjectCreated>('invalid-input', 'Give it a name to go by.')
    if (clean.length > 120) {
      return no<ProjectCreated>(
        'invalid-input',
        'That name is too long — keep it under 120 characters.',
      )
    }

    const { repos } = await appContext()
    const project = await repos.projects.byId(projectId)
    if (!project) return no<ProjectCreated>('not-found', "That project doesn't exist any more.")
    if (project.name === clean) {
      return no<ProjectCreated>('already-done', 'That is what it is already called.')
    }

    await repos.projects.rename(projectId, clean)
    refresh()
    return ok({ id: projectId, name: clean })
  })
}

/* ── which project this work belongs to ─────────────────────────────────── */

/**
 * What Propositum knows about a project it thinks this work belongs to.
 *
 * Enough to render the offer's carry-on box without a second round trip, and
 * deliberately no more: the count of sittings, sources and documents is what
 * makes "back on World models" checkable at a glance, and anything richer would
 * be asking the person to review a filing decision instead of noticing one.
 */
export interface CarriedProject {
  readonly projectId: string
  readonly name: string
  readonly sittings: number
  readonly sources: number
  readonly documents: number
  /** Words this subject and that project's name have in common. The reason,
   *  shown, so a wrong guess is arguable rather than mysterious. */
  readonly overlap: number
  /**
   * What has already happened under this project's Intention — `WorkSoFar`,
   * folded, rendered as *Where you left off* beside the four counts above.
   *
   * ── Why it sits beside the counts rather than replacing them ─────────
   *
   * The counts answer *is this the right project* and are the reason the
   * filing decision is arguable at a glance. This answers *what did I decide
   * last time*, which is a different question and the one
   * [ADR-0017](../../docs/adr/0017-continuing-an-intention.md) exists for:
   * *"what carries forward is counted rather than said."* Deleting the counts
   * would take the filing decision's own evidence off the screen it is made
   * on.
   *
   * Null when the project has no Intention, which is every project created
   * before ADR-0011 and every degraded acceptance since. The box is absent
   * rather than empty.
   */
  readonly workSoFar: WorkSoFar | null
}

/** Every project as something `matchProject` can compare against. */
async function projectCandidates(): Promise<ProjectCandidate[]> {
  const { repos } = await appContext()
  const projects = await repos.projects.list()
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    terms: projectTerms(project.name),
  }))
}

/**
 * The counts behind the carry-on box, and what happened under it, for one
 * project.
 *
 * The fold is loaded HERE rather than by the screen, so that the accept screen
 * and the project screen read one derivation. Two screens each assembling
 * *Where you left off* is the shape `front-door.ts` opens by refusing, and the
 * failure would be worse than a wrong status word: the accept screen would show
 * one account of the work while the pre-fill on the agreement was chosen against
 * another.
 */
async function describeProject(
  project: { id: string; name: string },
  overlap: number,
): Promise<CarriedProject> {
  const { repos } = await appContext()
  const [sittings, sources, documents, leftOff] = await Promise.all([
    repos.sessions.forProject(project.id),
    repos.projects.approvedSources(project.id),
    repos.documents.forProject(project.id),
    whereYouLeftOffIn(project.id, Date.now()),
  ])

  return {
    projectId: project.id,
    name: project.name,
    sittings: sittings.length,
    sources: sources.filter((source) => source.grantState === 'granted').length,
    documents: documents.length,
    overlap,
    workSoFar: leftOff?.view ?? null,
  }
}

/**
 * "Looks like you're back on…" — the state, for whichever screen is asking.
 *
 * Exported rather than folded into the acceptance path because the offer screen
 * belongs to someone else and needs to render the box BEFORE anything durable
 * exists. `null` is the ordinary answer; most work is new work.
 *
 * ── Why it takes the subject and not the thread's terms ──────────────────
 *
 * It takes exactly what `startFromSuggestion` takes first, so the two cannot
 * disagree. If this asked for terms while acceptance matched on the subject,
 * a screen could promise "carrying on with World models" and then quietly open
 * a second project called the same thing — the failure would look like a
 * filing bug and would actually be two functions answering slightly different
 * questions. One input, one answer.
 */
export async function carryOnCandidate(
  subject: string,
): Promise<ActionResult<CarriedProject | null>> {
  return attempt(async () => {
    const candidates = await projectCandidates()
    const match = matchProject(projectTerms(subject), candidates)
    if (!match) return ok<CarriedProject | null>(null)

    const project = candidates.find((c) => c.id === match.projectId)
    if (!project) return ok<CarriedProject | null>(null)

    return ok<CarriedProject | null>(await describeProject(project, match.overlap))
  })
}

/**
 * Where this sitting goes: an existing project, or a new one.
 *
 * ── The first thing in this repo that survives a session ─────────────────
 *
 * `CONTEXT.md` lists "there is no cross-session continuity" among the risks the
 * vocabulary does not remove — a second session starts cold, which the
 * product's own shift-change metaphor implies otherwise. This is the first
 * crack in that, and it is a narrow one on purpose: what carries forward is the
 * PROJECT, and with it the sources already approved and the document already
 * being written. No objective, no reading, no claim. Those are what the next
 * sitting is for working out fresh, and inheriting them quietly is the failure
 * the cold start exists to avoid.
 *
 * ── Why the default is to join, and the override is one click ────────────
 *
 * Asking "is this the same work as before?" up front is the setup this feature
 * removed, in a smaller box. So Propositum files it where the arithmetic says
 * it belongs, says on the screen that it did, and moving it is one click. The
 * threshold is set to split when unsure precisely so that the click is rarely
 * needed and never urgent.
 */
async function projectForWork(
  name: string,
  treatAsNewWork: boolean,
): Promise<
  ActionResult<{ readonly project: { id: string; name: string }; readonly joined: boolean }>
> {
  type Chosen = { readonly project: { id: string; name: string }; readonly joined: boolean }

  if (!treatAsNewWork) {
    const match = matchProject(projectTerms(name), await projectCandidates())
    if (match) {
      const { repos } = await appContext()
      const existing = await repos.projects.byId(match.projectId)
      if (existing) return ok<Chosen>({ project: existing, joined: true })
    }
  }

  const created = await createProject(name)
  if (!created.ok) return { ok: false, problem: created.problem }
  return ok<Chosen>({ project: created.value, joined: false })
}

/**
 * Turn whatever the person typed into a Chrome host-permission pattern.
 *
 * `northwind.com`, `https://northwind.com`, `https://northwind.com/partners`
 * and `https://northwind.com/*` all mean the same grant, and asking a person to
 * type the third form exactly is friction Propositum would be inventing on top
 * of a grant Chrome already understands.
 *
 * Ports and credentials are rejected rather than stripped: MV3 match patterns
 * cannot express a port, so accepting one would store a pattern Chrome will
 * never grant and leave the person with a source that silently sees nothing.
 */
/**
 * The one exact origin a stored source pattern names, or null.
 *
 * A `PurchaseAuthorization.originPattern` is matched EXACTLY by the transport
 * — never by prefix, never via `patternCovers` — so it cannot be a wildcard.
 * The stored `ApprovedSource.originPattern` is `scheme//host/*`, possibly with
 * a `*.` host wildcard: the trailing `/*` strips to an origin, and a host
 * wildcard refuses, because "somewhere under this domain" is not a place a
 * ceiling can be ratified against. Named beside `normaliseOriginPattern`
 * because the two are the same column read in opposite directions, and the
 * drift risk of the shared field name is why this docblock exists.
 */
function exactOriginFor(sourcePattern: string): string | null {
  const trimmed = sourcePattern.trim().replace(/\/\*$/, '')
  const match = /^(https?):\/\/([a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)$/i.exec(
    trimmed,
  )
  if (!match) return null
  return `${(match[1] ?? 'https').toLowerCase()}://${(match[2] ?? '').toLowerCase()}`
}

function normaliseOriginPattern(raw: string): string | null {
  let text = raw.trim()
  if (!text) return null

  let scheme = 'https:'
  const withScheme = /^(https?):\/\//i.exec(text)
  if (withScheme) {
    scheme = `${(withScheme[1] ?? 'https').toLowerCase()}:`
    text = text.slice(withScheme[0].length)
  }

  const host = (text.split('/')[0] ?? '').toLowerCase()
  const label = '[a-z0-9]([a-z0-9-]*[a-z0-9])?'
  if (!new RegExp(`^(\\*\\.)?${label}(\\.${label})*$`).test(host)) return null

  return `${scheme}//${host}/*`
}

/**
 * The sites Propositum actually SAW, as the patterns an approval would store.
 *
 * ── What went wrong without this ─────────────────────────────────────────
 *
 * `startFromSuggestion` took its list of sites from its caller and approved
 * every one of them. The caller is a page, and the page reads them off a query
 * string, so the list was in practice whatever was in the link. A crafted link
 * — `…/start?subject=Invoices&origins=https://attacker.example` — put an origin
 * nobody had ever visited into `ApprovedSource` and started a session watching
 * it, behind one click, under a heading the same link chose the words for.
 *
 * Local-only and needing a click, so the severity was low. The shape was not:
 * the one-click path had no idea what had been observed, and "the suggestion
 * came from what Propositum saw" was true of the honest path by coincidence
 * rather than by construction.
 *
 * ── Why an origin cannot be laundered through this ───────────────────────
 *
 * The set is derived from the ambient buffer and nothing else. That buffer is
 * filled by one route, from the extension, on origins Chrome has already
 * granted — nothing a link can reach writes to it. So an origin the person has
 * not been browsing is absent from the returned set no matter what the caller
 * asks for, and approval becomes a function of observation instead of a
 * function of the request.
 *
 * ── Why the comparison is on patterns, not on raw origins ────────────────
 *
 * `https://northwind.com`, `northwind.com` and `https://northwind.com/` all name
 * one site and would all fail a string comparison against the buffer's
 * `new URL(url).origin`. Normalising both sides first compares exactly the thing
 * that would be written to `ApprovedSource.originPattern` — so what is checked
 * and what is stored can never diverge.
 *
 * The one case it does not rescue is a scheme mismatch: a bare hostname means
 * `https`, so an `http` site the person really was reading is not matched by a
 * link that spells it without a scheme, and is discarded. Approving `https`
 * because `http` was seen would be widening a grant on a guess, which is the
 * opposite of what this function is for.
 *
 * ── The thread, and nothing wider ────────────────────────────────────────
 *
 * The observed set is the sites of ONE thread — the same narrowing the
 * carry-over below does, and it must be, because the two decide the same
 * question about the same sitting.
 *
 * An earlier version of this fell back to every origin in the window when no
 * signature arrived, on the reasoning that a restarted process would have lost
 * the thread. That reasoning was wrong twice over. `pagesOfThread` and the
 * observations are the same in-memory store with the same lifetime, so a
 * restart empties both and the fallback rescues nothing — while every honest
 * caller does supply a signature, because `/api/session/current` remembers the
 * thread before it will emit an offer at all, and both the panel and the
 * service worker put it in the link. So the fallback was reachable only by a
 * request that left the signature out, which is precisely the crafted link, and
 * it handed that request every site browsed in the last half hour.
 *
 * No signature, or one nothing was recorded against, is therefore no sites. The
 * carry-over already refuses to fall back for exactly this reason, and these
 * two refusals are the same refusal.
 */
function observedOriginPatterns(
  threadSignature: string | undefined,
  nowMs: number,
): ReadonlySet<string> {
  const patterns = new Set<string>()
  if (threadSignature === undefined || threadSignature === '') return patterns

  const ambient = ambientStore()
  const threadPages = ambient.pagesOfThread(threadSignature)
  if (threadPages.length === 0) return patterns

  for (const observation of ambient.forUrls(threadPages, nowMs)) {
    const pattern = normaliseOriginPattern(observation.origin)
    if (pattern !== null) patterns.add(pattern)
  }
  return patterns
}

export interface SourceApproved {
  readonly id: string
  readonly originPattern: string
  readonly label: string
  /** True when a session was live and the approval went into its record. */
  readonly recordedInSession: boolean
}

export async function approveSource(
  projectId: string,
  originPattern: string,
  label: string,
): Promise<ActionResult<SourceApproved>> {
  return attempt(async () => {
    const pattern = normaliseOriginPattern(originPattern)
    if (!pattern) {
      return no<SourceApproved>(
        'invalid-input',
        "That doesn't look like a site address. Try something like northwind.com.",
      )
    }

    const { repos, ledger } = await appContext()
    const project = await repos.projects.byId(projectId)
    if (!project) return no<SourceApproved>('not-found', "That project doesn't exist any more.")

    const host = pattern.replace(/^https?:\/\//, '').replace(/\/\*$/, '')
    const name = label.trim() || host

    const source = await repos.projects.approveSource({
      projectId,
      originPattern: pattern,
      label: name,
    })

    // If the person is at their desk with a session running, approving a source
    // is part of that sitting and belongs in its record. If they are not, the
    // approval still stands — it is project-scoped, not session-scoped.
    let recordedInSession = false
    const live = captureStore().current()
    if (live) {
      const session = await repos.sessions.byId(live.sessionId)
      if (session && session.projectId === projectId) {
        const now = Date.now()
        const appended = await ledger.append(live.sessionId, {
          kind: 'sourceApproved',
          observedAt: new Date(now),
          elapsedMs: Math.max(0, now - live.startedAtMs),
          approvedSourceId: source.id,
          attested: { originPattern: pattern, label: name },
        })
        recordedInSession = appended.ok
      }
    }

    refresh()
    return ok({ id: source.id, originPattern: pattern, label: name, recordedInSession })
  })
}

/* ═════════════════════════════════════════════════════════════ documents ══ */

/**
 * Paste-in, and the version chain that follows from it.
 *
 * ── Why the stored bytes are normalised ──────────────────────────────────
 *
 * `ProposedChange.startOffset` addresses the NORMALISED base — `diff()` and
 * `checkDrift()` both run `normalise()` before they hash or index. Store raw
 * bytes while hashing the normalised form and `contentHash` stops being
 * `hashContent(content)`, so the next person to re-derive it gets a drift
 * failure against a document that never moved.
 *
 * This is a deliberate deviation from CONTEXT.md's "bytes are stored exactly as
 * written", and it agrees with the schema's own docstring. No words are changed;
 * the text is laid out one sentence per line.
 *
 * ── One document per project in slice 0 ──────────────────────────────────
 *
 * `draftContract` and the session screen both take `documents[0]`. Until
 * something chooses between them, a second document would make which one the
 * shift works on a matter of insertion order. Refusing is the honest version of
 * a constraint that already exists.
 */

export interface DocumentCreated {
  readonly documentId: string
  readonly versionId: string
  readonly title: string
}

export async function createDocument(
  projectId: string,
  title: string,
  content: string,
): Promise<ActionResult<DocumentCreated>> {
  return attempt(async () => {
    const name = title.trim()
    if (!name) return no<DocumentCreated>('invalid-input', 'Give the document a name.')

    const body = content.trim()
    if (!body) {
      return no<DocumentCreated>(
        'invalid-input',
        'Paste in the text you are working on. Propositum works on your words — it never starts from a blank page.',
      )
    }

    const { repos } = await appContext()
    const project = await repos.projects.byId(projectId)
    if (!project) return no<DocumentCreated>('not-found', "That project doesn't exist any more.")

    const existing = await repos.documents.forProject(projectId)
    if (existing.length > 0) {
      return no<DocumentCreated>(
        'already-done',
        `This project already has a document — ${existing[0]?.title}. Propositum works on one document at a time.`,
      )
    }

    const stored = normalise(body)
    const created = await repos.documents.create({
      projectId,
      title: name,
      content: stored,
      contentHash: hashContent(stored),
    })

    refresh()
    return ok({ documentId: created.id, versionId: created.versionId, title: name })
  })
}

export interface DocumentSaved {
  readonly versionId: string
  readonly ordinal: number
  /** True when a session was live and the edit went into its record. */
  readonly recordedInSession: boolean
}

/**
 * The person edits their own document.
 *
 * Insert-only: this never mutates the previous version, because a changeset
 * already pins one by hash and an edited base would silently invalidate it.
 * The shift is not blocked while this happens — ADR-0003 §4, the document is
 * never locked. If a run is mid-flight its changeset will fail `checkDrift`
 * later, and the person's edit wins. That is the designed path, not an error.
 */
export async function saveDocument(
  documentId: string,
  content: string,
): Promise<ActionResult<DocumentSaved>> {
  return attempt(async () => {
    const body = content.trim()
    if (!body) {
      return no<DocumentSaved>(
        'invalid-input',
        'The document would be empty. If you meant to clear it, keep a heading so there is something to work on.',
      )
    }

    const { repos, ledger } = await appContext()
    const document = await repos.documents.byId(documentId)
    if (!document) return no<DocumentSaved>('not-found', "That document isn't there any more.")

    const stored = normalise(body)
    const latest = await repos.documents.latestVersion(documentId)
    if (latest && latest.contentHash === hashContent(stored)) {
      return no<DocumentSaved>('already-done', 'Nothing changed, so nothing was saved.')
    }

    const version = await repos.documents.addVersion({
      documentId,
      content: stored,
      contentHash: hashContent(stored),
      origin: 'human',
    })

    // A live sitting should show that the person worked on their document. This
    // is the only way `documentEdited` occurs in production; without it the kind
    // exists solely in fixtures and the reading has nothing to cite about the
    // document itself.
    let recordedInSession = false
    const live = captureStore().current()
    if (live) {
      const session = await repos.sessions.byId(live.sessionId)
      if (session && session.projectId === document.projectId) {
        const now = Date.now()
        const appended = await ledger.append(live.sessionId, {
          kind: 'documentEdited',
          observedAt: new Date(now),
          elapsedMs: Math.max(0, now - live.startedAtMs),
          documentId,
          attested: { title: document.title, ordinal: version.ordinal },
        })
        recordedInSession = appended.ok
      }
    }

    refresh()
    return ok({ versionId: version.id, ordinal: version.ordinal, recordedInSession })
  })
}

/**
 * Bring a page in from a source this project already approved — ADR-0032.
 *
 * ── What this returns, and what it does not do ───────────────────────────
 *
 * Text, to the screen. It stores nothing, mints no version, writes no
 * ObservationEvent and no ActionIntent, and calls `refresh()` for the same
 * reason it stores nothing: there is no server state to revalidate. The person
 * reads what came back, in the box, and saves it with the button that was
 * already there — `saveDocument` above, normalising as it always did.
 *
 * The deciding is not here. `importApprovedPage` matches the address against
 * the project's approved origins and is also the only place the allowlist
 * wrapper is built; this function turns its refusal into a sentence and nothing
 * else. A refusal is a REFUSAL in the CONTEXT.md sense — the same word the gate
 * uses when it declines a source — so none of these messages calls it an error.
 */
export async function bringInPage(
  projectId: string,
  address: string,
): Promise<ActionResult<BroughtInPage>> {
  return attempt(async () => {
    const { repos } = await appContext()
    const result = await bringInApprovedPage({ repos }, projectId, address)

    if (result.ok) return ok(result.page)

    switch (result.refusal) {
      case 'not_a_web_address':
        return no<BroughtInPage>(
          'invalid-input',
          'That is not a web address. Paste the whole thing, starting with https://.',
        )
      case 'source_not_approved':
        return no<BroughtInPage>(
          'blocked',
          "That isn't one of your approved sources, so Propositum never opened it. Approve the site above first — approving grants access, not trust.",
        )
      case 'too_large_to_bring_in':
        return no<BroughtInPage>(
          'invalid-input',
          `That page is longer than ${IMPORT_BUDGET_CHARS / 1000} thousand characters, so nothing was read. Copy in the part you are working on instead.`,
        )
      case 'nothing_readable':
        return no<BroughtInPage>(
          'nothing-to-read',
          'There were no words on that page Propositum could read. It runs none of the page’s code, so a page that builds itself in the browser comes back empty — open it yourself and paste.',
        )
      case 'could_not_read_it':
        return no<BroughtInPage>(
          'blocked',
          `Propositum could not read that page, and nothing was changed. (${result.detail ?? 'no reason given'})`,
        )
    }
  })
}

/* ══════════════════════════════════════════════════════════════ sessions ══ */

export interface SessionStarted {
  readonly sessionId: string
  readonly approvedSources: ReadonlyArray<{ id: string; label: string; originPattern: string }>
}

/**
 * One click, from a suggestion to a session with everything it needs.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * "I don't want to have to go into the UI, create a project, and do all of it.
 * My whole vision is that whatever I'm doing, it pops up and says: hey, I see
 * you're doing this, can I help?"
 *
 * Creating a project by hand is asking someone to name and file work before
 * they know they want help with it. So the thread names the project, its sites
 * become the approved sources, and a document is created to work in — all from
 * one answer to one question.
 *
 * ── The one thing this does not take from its caller ─────────────────────
 *
 * Which sites to approve. Everything else here is the caller's to choose; that
 * is not, because approving a source is the decision that widens what
 * Propositum may watch. The list arrives as a suggestion and is intersected
 * with what the ambient buffer actually holds — see `observedOriginPatterns`.
 *
 * ── What is still a human act, and stays one ─────────────────────────────
 *
 * This starts a SESSION. It does not start a run. The person lands on the
 * agreement screen with the objective filled in from what they were doing, and
 * nothing happens until they ratify it — `MVP.md` acceptance bullet 4, and the
 * invariant the whole product rests on.
 *
 * Removing setup friction is not the same as removing consent, and this is the
 * line between them.
 *
 * ── Why what was already seen is carried over ────────────────────────────
 *
 * The offer says "you have been looking into world models across 3 sites". A
 * session that then began at zero would produce a reading with no evidence for
 * the work that triggered it, and the person would have to redo the browsing
 * Propositum had just told them it watched.
 *
 * So those pages are folded in — and once folded they are ORDINARY
 * ObservationEvents, written through the one ledger door with every normal rule
 * applying. They carry `attested.ambient = true`, because "Propositum saw this
 * before you started the session" is a fact about provenance the timeline
 * should not hide. Nothing is invented on the way in: ambient observations hold
 * no page text, so neither do the events, and the reading will be thinner than
 * one from a watched session. That is honest rather than a bug to paper over.
 */
export interface WorkStarted {
  readonly projectId: string
  readonly projectName: string
  readonly sessionId: string
  /**
   * The project's document, if it already had one. NULL for a project this
   * sitting just opened.
   *
   * It was non-null and always present, because starting work created a skeleton
   * document whether or not the work was drafting. Nothing has ever read this
   * field, which is itself the evidence that the eager creation was serving the
   * schema rather than anybody's screen — see the note where it used to happen.
   */
  readonly documentId: string | null
  readonly carriedOver: number
  /**
   * True when this sitting joined a project that already existed, rather than
   * opening a new one.
   *
   * Every caller must render this where the person lands. A merge nobody is
   * told about is the failure `match-project.ts` calls the expensive one: the
   * work is filed under an old subject, the old document is what Propositum
   * offers to work on, and nothing on screen says a decision was taken. The
   * flag exists so that "then the user can edit after" has something to edit
   * FROM.
   */
  readonly joinedExisting: boolean
  /**
   * Sites the caller asked for that Propositum had not seen, and did not
   * approve.
   *
   * Counted rather than quietly skipped, for the same reason
   * `ReadingProduced.discardedQuotes` is: a discard here means something asked
   * Propositum to watch a site on evidence it does not have, and a number that
   * is never zero on the honest path is the only way that would ever be
   * noticed.
   */
  readonly discardedOrigins: number
  /** Sites this sitting was about that the joined project had WITHDRAWN, and
   *  which stay withdrawn. Propositum cannot see them here, and the person is
   *  the only one who may put that back. */
  readonly leftWithdrawn: number
  /**
   * The Intention this sitting advances, or NULL — which is the ordinary case
   * and the honest one.
   *
   * Null whenever nobody ratified a sentence about what the work is for. It is
   * on the result rather than only in the database because a sentence that is
   * used and not shown is the exact failure ADR-0011 names as the weak link in
   * its own argument: *on screen wherever it is used* is a requirement on the
   * interface, and an id no caller can see is a screen that cannot meet it.
   */
  readonly intentionId: string | null
}

/**
 * The sentence a person ratified about what the work is for.
 *
 * ── Why this is a parameter and not something this file works out ────────
 *
 * `startFromSuggestion` knows the subject, the sites and the thread. NONE of
 * those is a statement of purpose — they are what the detector saw, and an
 * Intention derived from what a detector saw is precisely the thing ADR-0011
 * forbids, however plausible the sentence came out. So the words have to arrive
 * from a caller that watched a person accept them, and the only such caller is
 * `acceptWorkOffer`.
 *
 * Optional, so every other path — the carry-on suggestion, the tests, anything
 * later — starts a sitting with `intentionId` null and no Intention is written.
 * An absent Intention is the normal state of the world.
 */
export interface RatifiedStatement {
  readonly objective: string
  readonly definitionOfDone: string
}

export async function startFromSuggestion(
  subject: string,
  origins: readonly string[],
  intent: 'draft-document' | 'deep-research',
  /** The thread's signature. What makes the carry-over precise — without it
   *  this falls back to everything from the same sites, which is how a search
   *  for "nissan altima" became evidence for a hiking trip. */
  threadSignature?: string,
  /**
   * The person said "no — this is new work" before accepting.
   *
   * Optional and last, so a caller that does not ask the question gets the
   * ordinary behaviour and no screen has to change to keep working. Answering
   * it after the fact is `splitIntoNewProject`, which costs one click and one
   * moved row — the two paths exist because the offer screen can ask before
   * anything durable exists and the project screen can only ask after.
   */
  treatAsNewWork?: boolean,
  /**
   * The words a person just accepted, when a person just accepted some.
   *
   * Last and optional for the reason `treatAsNewWork` is: a caller that has
   * nothing to say here says nothing, and gets a sitting with no Intention —
   * which is what every caller but the accept path has, and what every session
   * recorded before ADR-0011 has.
   */
  ratified?: RatifiedStatement,
): Promise<ActionResult<WorkStarted>> {
  return attempt(async () => {
    const name = subject.trim()
    if (!name) return no<WorkStarted>('invalid-input', 'Propositum could not name that work.')

    const { repos, ledger } = await appContext()

    /**
     * A running session is answered before anything else, and deliberately
     * before the sites are looked at.
     *
     * Starting a session empties the ambient buffer, so by the time one is live
     * there is nothing left in it — and checking the sites first would answer a
     * second click on the same link with "Propositum has not been watching any
     * of those sites", which is true of the buffer and useless to the person.
     * The session they already started is the thing they need told about.
     *
     * Nothing is written before either check, so the order is a question of
     * which sentence is more use, not of what gets left behind.
     */
    const live = captureStore().current()
    if (live) {
      const running = await repos.sessions.byId(live.sessionId)
      if (running && running.phase !== 'ended') {
        return no<WorkStarted>('already-done', 'A session is already running. End that one first.')
      }
    }

    /**
     * Which of the requested sites Propositum has actually been watching.
     *
     * Settled before a single row is written, so a request naming nothing
     * observed cannot leave a project, a document or an approval behind on its
     * way to being refused. See `observedOriginPatterns` for why the caller's
     * list is untrustworthy and what the buffer proves instead.
     *
     * A site that survives is stored under its normalised pattern, so the
     * comparison that admitted it and the row that records it are the same
     * string. Duplicates collapse — the same site named twice is one approval,
     * not one approval and one discard.
     */
    const observed = observedOriginPatterns(threadSignature, Date.now())

    const wanted = new Map<string, string>()
    let discardedOrigins = 0
    for (const origin of origins) {
      const pattern = normaliseOriginPattern(origin)
      if (pattern === null || !observed.has(pattern)) {
        discardedOrigins += 1
        continue
      }
      if (!wanted.has(pattern)) {
        wanted.set(pattern, pattern.replace(/^https?:\/\//, '').replace(/\/\*$/, ''))
      }
    }

    if (wanted.size === 0) {
      // Says the true thing, including when it is unimpressive: Propositum has
      // no record of this work, so it will not start watching sites on the
      // strength of being asked to.
      return no<WorkStarted>(
        'invalid-input',
        'Propositum has no record of the work this describes, so there is nothing for it to go on. Browse for a while and it will offer again.',
      )
    }

    // The thread names the project — or finds the one this work already
    // belongs to. Nobody is asked to file anything either way.
    const chosen = await projectForWork(name, treatAsNewWork === true)
    if (!chosen.ok) return { ok: false, problem: chosen.problem } as const
    const { project, joined } = chosen.value

    /**
     * Approve each surviving site on whichever project this landed in — except
     * one the person has already withdrawn there.
     *
     * Joining an existing project means writing approvals into a workspace with
     * its own history, and `approveSource` upserts `granted`. Without this
     * check, a site somebody deliberately withdrew in Chrome comes back as
     * approved because they happened to read it again — a human act undone by a
     * convenience, on a screen that promises "it will not ask again unless you
     * add it back". A revocation outranks a match.
     *
     * Keyed by pattern rather than by the caller's spelling of the site. The
     * carry-over below looks a source up from an OBSERVATION's origin, which is
     * always `https://host` — so matching on what the link happened to say meant
     * a link reading `northwind.com` approved the site and then carried none of
     * its pages, silently.
     */
    const withdrawn = new Set(
      (await repos.projects.approvedSources(project.id))
        .filter((source) => source.grantState !== 'granted')
        .map((source) => source.originPattern),
    )

    const sourceByPattern = new Map<string, string>()
    let leftWithdrawn = 0
    for (const [pattern, host] of wanted) {
      if (withdrawn.has(pattern)) {
        leftWithdrawn += 1
        continue
      }
      const source = await repos.projects.approveSource({
        projectId: project.id,
        originPattern: pattern,
        label: host,
      })
      sourceByPattern.set(pattern, source.id)
    }

    /**
     * No document is created here any more, and that is the point of the change.
     *
     * ── What this used to do, and what it cost ───────────────────────────
     *
     * It created a skeleton `Document` eagerly — two empty headings chosen from
     * whether the offer said *draft-document* or *deep-research* — before anyone
     * had agreed to draft anything. Every session was therefore pre-committed to
     * the drafting workflow at the moment it started, in a product whose stated
     * ambition is to have no predetermined use cases. A sitting that turned out
     * to be a comparison, an answer or a browser errand still had a half-written
     * proposal filed under it, with two headings nobody wrote and nobody would.
     *
     * ── Where it moved, and why there ────────────────────────────────────
     *
     * To `draftContract`, which is the first moment anything knows what the
     * shift is FOR. The document is created there iff the contract expects
     * `document-changes`, and its first version becomes `baseVersionId`.
     * Otherwise the pin stays null and the gate refuses the document
     * capabilities, which is the honest encoding of "there is no document" —
     * rather than a document existing so the schema would let the person hand
     * work over.
     *
     * The existing project's document, when there is one, is still carried
     * forward. That is most of what joining a project is for, and it happens at
     * the same later seam: `draftContract` takes `documents[0]`, and finds
     * yesterday's half-written draft exactly where it left it.
     */
    /**
     * The Intention, written here because a person said the words and for no
     * other reason.
     *
     * ── At most one per Project, and what happens on the second sitting ──
     *
     * A joined project already has its Intention, and this REUSES it rather
     * than minting a second. That is the cardinality ADR-0011 defers behind,
     * and reuse is the honest reading of it: the person ratified a sentence
     * about this work once, and a sitting that continues the work continues the
     * sentence. The alternative — a fresh row per acceptance — would answer
     * *which Intention does this sitting belong to?* by making the question
     * exist, which is exactly what the deferral is buying time on.
     *
     * Nothing UPDATES the existing row here. A sentence a person wrote in March
     * is not quietly rewritten in August by an offer a model composed; if it is
     * wrong, rewriting it is the person's act and their correction channel.
     * That is the whole of "human-ratified", and it is why this branch creates
     * or reuses and never edits.
     *
     * ── The lookup is unconditional; only the WRITE needs `ratified` ─────
     *
     * The two questions are separate and were once collapsed into one, which
     * was a bug rather than a simplification: *does this Project have an
     * Intention?* is a read of a row a person already ratified, and *may
     * Propositum write one?* is the human-ratified-only rule. Asking the first
     * only when the second was true meant a sitting on a project WITH an
     * Intention — reached from the degraded path, where no offer was composed —
     * got a null, and null is documented as meaning *nobody stated an Intention
     * for this sitting*. On that project it would have been false.
     *
     * So the invariant this file now holds everywhere a sitting begins or moves
     * is one sentence: **a WorkSession points at its Project's Intention, or at
     * nothing.** Reading it writes nothing and creates nothing, so the shape
     * ADR-0011 enforces is untouched.
     */
    const existing = await repos.intentions.forProject(project.id)
    let intentionId: string | null = existing?.id ?? null

    if (existing === null && ratified !== undefined) {
      const objective = ratified.objective.trim()
      const definitionOfDone = ratified.definitionOfDone.trim()

      if (objective !== '' && definitionOfDone !== '') {
        // An empty half writes nothing. A row saying the work is for "" is
        // worse than no row: null means nobody said, and "" means somebody
        // said nothing, and only the first of those is true here.
        const created = await repos.intentions.create({
          projectId: project.id,
          objective,
          definitionOfDone,
        })
        intentionId = created.id
      }
    }

    const session = await repos.sessions.start(project.id, intentionId)
    const startedAtMs = Date.now()
    captureStore().start(session.id, startedAtMs)
    startGapWatch()

    /**
     * Accepting forgets every decline of this strand.
     *
     * The only thing permitted to lower a bar is a person acting, and this is
     * that act. It also keeps reticence from being a ratchet: a subject you
     * turned down four times and then took up is not one Propositum should stay
     * quiet about.
     *
     * `threadSignature` is optional here — the carry-on suggestion path starts
     * work with no thread at all — so this only fires when one was actually
     * supplied, trimmed the same way `acceptWorkOffer` trims it.
     */
    const declinedThread = threadSignature?.trim()
    if (declinedThread) {
      await repos.reticence.clear(hashSignature(declinedThread, await repos.reticence.salt()))
    }

    /**
     * What was already seen becomes the session's own record — but only the
     * pages that were part of the THREAD.
     *
     * This used to carry everything from each approved origin, which meant a
     * hiking trip arrived with "nissan altima - Google Search" and a "Warmup
     * Page" as evidence, because those were also on google.com. The detector
     * knew exactly which five pages mattered and the answer threw that away.
     *
     * Falling back to the origin when no signature is supplied would quietly
     * restore the bug, so the fallback is to carry NOTHING: a session with a
     * thin record is recoverable, and a reading built on the wrong pages is
     * worse than one built on none.
     */
    const ambient = ambientStore()
    const threadPages = threadSignature ? ambient.pagesOfThread(threadSignature) : []

    /**
     * One row per PAGE, not one per observation.
     *
     * ── What carrying every observation actually produced ────────────────
     *
     * The content script reports engagement for whichever page has focus every
     * fifteen seconds, and every report is a separate row in the ambient
     * buffer. So a page read for five minutes is about twenty observations of
     * one URL — which is exactly right for the buffer, because `engagedByUrl`
     * takes the largest report and needs them all.
     *
     * It is exactly wrong for the ledger. This loop turned each one into an
     * `ObservationEvent` saying "opened this page", so accepting an offer wrote
     * twenty "opened" rows for one page, in a row, seconds apart. An end-to-end
     * run of four pages produced forty events. The timeline reads as somebody
     * frantically reopening the same tab, the `SessionReading` is built from
     * that, and neither is what happened.
     *
     * So the pages are collapsed first, and the collapse keeps the two facts
     * worth keeping: the EARLIEST time, because that is when they arrived, and
     * whether the page was ever a query, because that is what decides the kind.
     * The title is taken from whichever report had one — the first report often
     * lands before the document has a title at all.
     *
     * Dwell is deliberately NOT carried across. An `engaged` row means the
     * dwell-and-scroll bar was cleared inside a session somebody started, and
     * manufacturing one here from ambient metadata would put a claim about
     * attention into a ledger that is supposed to hold only what was observed
     * under the ordinary rules.
     */
    interface CarriedPage {
      readonly url: string
      title: string
      at: number
      searched: boolean
      readonly sourceId: string
    }

    const byUrl = new Map<string, CarriedPage>()
    for (const observation of ambient.forUrls(threadPages, startedAtMs)) {
      const pattern = normaliseOriginPattern(observation.origin)
      const sourceId = pattern === null ? undefined : sourceByPattern.get(pattern)
      if (!sourceId) continue

      const existing = byUrl.get(observation.url)
      if (!existing) {
        byUrl.set(observation.url, {
          url: observation.url,
          title: observation.title,
          at: observation.at,
          searched: observation.kind === 'query',
          sourceId,
        })
        continue
      }

      existing.at = Math.min(existing.at, observation.at)
      existing.searched = existing.searched || observation.kind === 'query'
      if (existing.title === '') existing.title = observation.title
    }

    let carriedOver = 0
    for (const page of [...byUrl.values()].sort((a, b) => a.at - b.at)) {
      const appended = await ledger.append(session.id, {
        kind: page.searched ? 'queried' : 'visited',
        observedAt: new Date(page.at),
        elapsedMs: 0,
        approvedSourceId: page.sourceId,
        attested: { url: page.url, title: page.title, ambient: true },
      })
      if (appended.ok) carriedOver += 1
    }
    ambient.clear()

    refresh()
    return ok({
      projectId: project.id,
      projectName: project.name,
      sessionId: session.id,
      documentId: (await repos.documents.forProject(project.id))[0]?.id ?? null,
      carriedOver,
      joinedExisting: joined,
      discardedOrigins,
      leftWithdrawn,
      intentionId,
    })
  })
}

/* ══════════════════════════════════════════ the offer, and accepting it ══ */

/**
 * The thread signature is the ONLY thing a link carries, and this is why.
 *
 * ── What wave one had to fix defensively ─────────────────────────────────
 *
 * `/start?subject=Invoices&origins=https://attacker.example` approved a site
 * nobody had ever visited. The fix was to intersect the requested list against
 * the ambient buffer — correct, and still in place above as
 * `observedOriginPatterns`. But it is a filter on a request that should never
 * have been able to ask, and a filter is a thing somebody can later widen "just
 * for this one caller".
 *
 * So the parameter is gone. A link says `?thread=<signature>` and nothing else;
 * the subject, the offer, the grounds and the sites are all read back off the
 * server-side buffer against that key. There is no field for an origin, so
 * there is nothing to intersect and nothing to widen.
 *
 * ── Why the intersection stays anyway ────────────────────────────────────
 *
 * Because the two guards answer different questions, and losing either one is a
 * different bug. Removing the parameter answers *can a link ask for a site?* —
 * no, structurally. The intersection answers *can anything that reaches the
 * accept path approve a site the buffer does not hold?* — no, arithmetically,
 * whatever the caller is. The ticked-sites control below is a real caller-
 * supplied list, and it is exactly the shape of input the intersection exists
 * for: it can only ever NARROW the observed set, because the result is
 * `observed ∩ ticked` and an entry that is not in `observed` contributes
 * nothing. Belt, and braces, and they are not the same garment.
 */
export interface OfferedSite {
  /** What would be stored, so what is checked and what is written are one
   *  string. */
  readonly pattern: string
  /** The hostname, as a person would say it. */
  readonly host: string
  /**
   * This project has this site WITHDRAWN, and accepting will leave it that way.
   *
   * Said before the click rather than counted after it. Wave one added the
   * count (`WorkStarted.leftWithdrawn`) and it arrived on the next screen — so
   * the offer still listed every site as though it were about to be approved,
   * including one the person had deliberately switched off. A revocation
   * outranks a match, and the list has to say so while it is still a list of
   * what will happen.
   */
  readonly leftWithdrawn: boolean
}

/** Everything the offer screen renders, read off the buffer by signature. */
export interface OfferOnScreen {
  readonly thread: string
  readonly subject: string
  readonly origins: readonly OfferedSite[]
  /** The detector's own sentences. Rendered verbatim, above the model's. */
  readonly grounds: readonly string[]
  /** Null when the grounds bar was not met, when composing has not finished,
   *  or when there is no API key. The screen degrades; it does not dead-end. */
  readonly offer: {
    readonly title: string
    readonly rationale: string
    readonly outline: readonly string[]
    readonly produces: string
    readonly excludes: readonly string[]
  } | null
  /** The deterministic sentence, which is what the degraded form shows. */
  readonly sentence: string
  readonly because: string
  /** The project this would join, if Propositum thinks it recognises the work.
   *  Stated before the click, because a merge nobody was told about is the
   *  expensive failure `match-project.ts` names. */
  readonly backOn: CarriedProject | null
}

/** The words behind a signature, when nothing has named it yet. Ugly and true
 *  beats absent — `world+models+labs` is at least recognisable. */
function subjectFromSignature(signature: string): string {
  return signature
    .split('+')
    .filter((word) => word !== '')
    .join(' ')
}

/**
 * What to show for `/start?thread=…`.
 *
 * Everything is derived server-side. Nothing about this answer depends on
 * anything the request said beyond which thread it is asking about, which is
 * the property the whole shape exists for.
 */
export async function offerForThread(
  threadSignature: string,
): Promise<ActionResult<OfferOnScreen | null>> {
  return attempt(async () => {
    const thread = threadSignature.trim()
    if (thread === '') return ok<OfferOnScreen | null>(null)

    const ambient = ambientStore()
    const now = Date.now()
    const patterns = [...observedOriginPatterns(thread, now)]
    if (patterns.length === 0) return ok<OfferOnScreen | null>(null)

    const named = ambient.nameFor(thread)
    const composed = ambient.offerFor(thread)
    const subject = (named?.subject ?? '').trim() || subjectFromSignature(thread)

    /**
     * The grounds and the sentence, recomputed from the buffer.
     *
     * A composed offer froze the grounds that permitted it, and those are what
     * the durable row will hold, so they win when there is one. Without an
     * offer the screen still owes the person the reasons, and re-deriving them
     * is cheap arithmetic over the same observations the detector just read.
     */
    const observations = ambient.since(now)
    /**
     * THIS strand, not the strongest one.
     *
     * It used to be `detectWork` plus an equality check, which is the same thing
     * only while an afternoon has one strand in it. With three, opening the
     * offer screen for the second — which the front door and the extension link
     * both do, by signature — found the first, failed the equality check, and
     * fell through to no grounds and a generic sentence. The strand was
     * perfectly detectable; it was simply not the one being looked at.
     *
     * `EVERY_STRAND` for the same reason `strandBySignature` uses it, added
     * 2026-08-17: the display bound is applied after the snooze filters now, so
     * the third strand on the screen can be the detector's fourth, and a lookup
     * bounded at three would answer a link that is on screen with nothing.
     */
    const detected =
      detectThreads(observations, now, EVERY_STRAND).find(
        (candidate) => signatureOf(candidate.terms) === thread,
      ) ?? null
    const grounds =
      composed?.grounds.sentences ??
      (detected ? groundsFor(detected, threadPagesOf(observations, detected, now)).sentences : [])

    const describedFor = detected ? describeWork(detected, thread, named) : null
    const sentence = describedFor?.sentence ?? `You have been looking into ${subject}.`
    const because = describedFor?.because ?? `Across ${patterns.length} sites.`

    const candidate = await carryOnCandidate(subject)
    const backOn = candidate.ok ? candidate.value : null

    /**
     * Which of these the destination has already withdrawn.
     *
     * Only a project being JOINED can have withdrawn anything — a project about
     * to be created has no history to have refused with.
     */
    const withdrawn = new Set<string>()
    if (backOn) {
      const { repos } = await appContext()
      for (const source of await repos.projects.approvedSources(backOn.projectId)) {
        if (source.grantState !== 'granted') withdrawn.add(source.originPattern)
      }
    }

    return ok<OfferOnScreen | null>({
      thread,
      subject,
      origins: patterns.map((pattern) => ({
        pattern,
        host: pattern.replace(/^https?:\/\//, '').replace(/\/\*$/, ''),
        leftWithdrawn: withdrawn.has(pattern),
      })),
      grounds,
      offer: composed
        ? {
            title: composed.title,
            rationale: composed.rationale,
            outline: composed.outline,
            produces: composed.produces,
            excludes: composed.excludes,
          }
        : null,
      sentence,
      because,
      backOn,
    })
  })
}

export interface OfferAccepted extends WorkStarted {
  /** True when a composed offer was on screen and is now a durable row. False
   *  is the degraded path, which starts the session and writes no offer —
   *  there was nothing composed to write down. */
  readonly offerRecorded: boolean
}

/**
 * Saying yes.
 *
 * ── What this takes, and what it refuses to take ─────────────────────────
 *
 * A thread signature, the sites the person left ticked, and whether they said
 * this is new work. That is all. The subject, the offer, the grounds and the
 * set of sites Propositum may approve are read off the buffer here, server-
 * side, keyed by the signature — see `OfferedSite` above for why that is a
 * structural property rather than a validation step.
 *
 * `ticked` can only narrow. The approved set is `observed ∩ ticked`, so a site
 * nobody browsed contributes nothing however it arrives, and a site somebody
 * unticked is left out. Neither direction can widen what Propositum may watch.
 *
 * ── And what accepting still does not do ─────────────────────────────────
 *
 * It does not start a run. It sets the work up and stops at the agreement,
 * where the objective is filled in from what they were doing and nothing
 * happens until they ratify it. Removing setup friction is not the same as
 * removing consent, and this is the line between them.
 */
export async function acceptWorkOffer(
  threadSignature: string,
  ticked: readonly string[],
  treatAsNewWork?: boolean,
): Promise<ActionResult<OfferAccepted>> {
  return attempt(async () => {
    const thread = threadSignature.trim()
    if (thread === '') {
      return no<OfferAccepted>(
        'invalid-input',
        'Propositum could not tell what this was meant to be about. Browse for a while and it will offer again.',
      )
    }

    const ambient = ambientStore()
    const composed = ambient.offerFor(thread)
    const named = ambient.nameFor(thread)
    const subject = (named?.subject ?? '').trim() || subjectFromSignature(thread)

    const observed = [...observedOriginPatterns(thread, Date.now())]

    // Narrowing only. Anything in `ticked` that is not in `observed` falls out
    // of the intersection, so an added site is not filtered — it is absent.
    const wanted = new Set<string>()
    for (const raw of ticked) {
      const pattern = normaliseOriginPattern(raw)
      if (pattern !== null) wanted.add(pattern)
    }
    const chosen = observed.filter((pattern) => wanted.has(pattern))

    if (observed.length > 0 && chosen.length === 0) {
      return no<OfferAccepted>(
        'invalid-input',
        'Nothing is ticked, so there would be nothing for Propositum to watch. Leave at least one site ticked.',
      )
    }

    /**
     * Which skeleton the document gets.
     *
     * Deterministic, from the outcome kinds the offer says it expects. The
     * model does not pick a template and never has — `expects` is a statement
     * about the shape of the result, and this is code reading it. Without an
     * offer, research is the honest default: nobody has said anything is being
     * written yet.
     */
    const intent =
      composed && composed.expects.includes('document-changes') ? 'draft-document' : 'deep-research'

    /**
     * The Intention, from the two strings on the offer the person just accepted.
     *
     * ── Why these two strings and no others ──────────────────────────────
     *
     * `title` is *"What you would do, in one line, as a person would say it out
     * loud"*, and `produces` is *"What they would have at the end, said
     * concretely"*. They are the only two strings anywhere in the system that
     * already say what the work is FOR, and they map field for field onto
     * `objective` and `definitionOfDone`. Nothing is composed here, nothing is
     * summarised, and no second model call happens: the row holds the sentences
     * that were on the screen when the person clicked.
     *
     * ── What makes this consistent with human-ratified-only ──────────────
     *
     * The words were composed by a model; the ROW is written because a person
     * clicked accept, on a screen showing those exact words. ADR-0011 is precise
     * about which of the two it claims — *"authorship of the record, not
     * authorship of the words in it, and only the first of the two is enforced
     * by shape"* — and this is that shape. `intentions.create` is reachable
     * from this action and from nothing else: no detector, no model boundary,
     * no recovery sweep and no worker has a path to it, and no model-facing
     * schema has a field that could carry one.
     *
     * The gap is real and is not talked down here: clicking accept on a
     * plausible sentence is a weaker act than typing one, and this design lets
     * that sentence outlive the sitting that produced it. What answers the
     * original objection is that nothing is inherited QUIETLY — the sentence is
     * the person's to see, edit and delete. Nothing makes it TRUE.
     *
     * The degraded path — no composed offer, so no sentence was on screen —
     * passes nothing and writes no Intention. Propositum does not state a
     * purpose nobody was shown.
     */
    const ratified: RatifiedStatement | undefined = composed
      ? { objective: composed.title, definitionOfDone: composed.produces }
      : undefined

    const started = await startFromSuggestion(
      subject,
      chosen,
      intent,
      thread,
      treatAsNewWork,
      ratified,
    )
    if (!started.ok) return { ok: false, problem: started.problem } as const

    /**
     * Accepting forgets every decline of this strand.
     *
     * The only thing permitted to lower a bar is a person acting, and this is
     * that act. It also keeps reticence from being a ratchet: a subject you
     * turned down four times and then took up is not one Propositum should stay
     * quiet about.
     */
    const { repos } = await appContext()
    await repos.reticence.clear(hashSignature(thread, await repos.reticence.salt()))

    /**
     * The offer becomes durable at the moment it is accepted, and not before.
     *
     * An offer nobody answered leaves no row, by the same rule the ambient
     * buffer lives under: a record of every guess Propositum made about what
     * somebody was doing IS a profile. The grounds are frozen here rather than
     * recomputed later because the buffer they came from is bounded by a
     * thirty-minute window, and "why did it offer me this" is the first
     * question anybody asks when an offer was wrong.
     */
    if (composed) {
      const { repos } = await appContext()
      await repos.offers.create({
        sessionId: started.value.sessionId,
        threadSignature: thread,
        promptVersion: composed.promptVersion,
        title: composed.title,
        rationale: composed.rationale,
        outline: composed.outline,
        produces: composed.produces,
        excludes: composed.excludes,
        originPatterns: chosen,
        expectedKinds: composed.expects,
        grounds: {
          kinds: [...composed.grounds.kinds],
          sentences: [...composed.grounds.sentences],
          sufficient: composed.grounds.sufficient,
        },
      })
    }

    refresh()
    return ok<OfferAccepted>({ ...started.value, offerRecorded: composed !== null })
  })
}

/**
 * Re-filing, and the two shapes it takes.
 *
 * ── Why this is not optional ─────────────────────────────────────────────
 *
 * Propositum decides where a sitting goes, and it will sometimes be wrong.
 * Automatic filing is only defensible if it is correctable — otherwise the
 * arithmetic above is not a helpful guess, it is a decision imposed on someone
 * about their own work with no way back. So both directions exist: put this
 * sitting under a project that already exists, or take it out into one of its
 * own.
 *
 * ── What moves, and what deliberately does not ───────────────────────────
 *
 * The sitting moves. Its ObservationEvents do not: the ledger is append-only,
 * and rewriting recorded history to tidy a filing decision is precisely what
 * append-only exists to refuse. Those rows keep pointing at the sources they
 * were recorded under, which stays true — that IS where Propositum was looking
 * when it saw them.
 *
 * What is carried instead is the permission going forward: the origins this
 * sitting is entitled to, approved on the destination, so what Propositum may
 * see there matches what it could see here.
 *
 * ── Which origins those are, and why it is not just the observed ones ────
 *
 * The obvious rule — the sources this sitting's events already cite — is right
 * for a sitting that has ENDED and silently wrong for one that is still
 * running. Capture resolves an incoming page against the sources of the
 * session's CURRENT project (`api/capture/events`), so moving a live sitting
 * into a project holding none of them makes every subsequent signal
 * unattributable, and it is dropped. The person pressed a button labelled "this
 * is new work" and Propositum stopped watching, with nothing said.
 *
 * So an open sitting carries every granted source of the project it is leaving:
 * those are exactly what capture was resolving against a moment ago, and
 * narrowing that set at the moment of a move is a change to what Propositum can
 * see that nobody asked for. An ended sitting carries the tighter set, because
 * nothing is arriving and least privilege costs nothing.
 *
 * ── A withdrawal is never undone by a move ───────────────────────────────
 *
 * `approveSource` upserts `granted`, so carrying a source into a project that
 * had REVOKED it would flip it back — a permission the person deliberately
 * withdrew in Chrome, restored because a sitting moved house. Those are skipped
 * and counted. Propositum then cannot see that site there, which is true, and
 * the person is the only one who may change it back.
 */
async function carrySourcesAcross(
  sessionId: string,
  fromProjectId: string,
  toProjectId: string,
): Promise<{ carried: number; leftWithdrawn: number }> {
  const { repos } = await appContext()

  const session = await repos.sessions.byId(sessionId)
  const stillOpen = session !== null && session.phase !== 'ended'

  const events = await repos.events.bySession(sessionId)
  const observed = new Set<string>()
  for (const event of events) {
    if (event.approvedSourceId !== null) observed.add(event.approvedSourceId)
  }

  const withdrawn = new Set(
    (await repos.projects.approvedSources(toProjectId))
      .filter((source) => source.grantState !== 'granted')
      .map((source) => source.originPattern),
  )

  const sources = await repos.projects.approvedSources(fromProjectId)
  let carried = 0
  let leftWithdrawn = 0

  for (const source of sources) {
    const entitled = observed.has(source.id) || (stillOpen && source.grantState === 'granted')
    if (!entitled) continue

    if (withdrawn.has(source.originPattern)) {
      leftWithdrawn += 1
      continue
    }

    await repos.projects.approveSource({
      projectId: toProjectId,
      originPattern: source.originPattern,
      label: source.label,
    })
    carried += 1
  }

  return { carried, leftWithdrawn }
}

export interface SessionRefiled {
  readonly sessionId: string
  readonly projectId: string
  readonly projectName: string
  /** Origins approved on the destination so it can see what this sitting was
   *  recorded against, and — while it is still running — go on seeing it. */
  readonly sourcesCarried: number
  /** Origins the destination had withdrawn, left withdrawn. */
  readonly leftWithdrawn: number
}

/**
 * "Carry on with it" — put this sitting under a project that already exists.
 *
 * The same act the acceptance path performs on its own when the arithmetic is
 * confident, available to a person who saw it split something that should not
 * have been. It takes a session and a project and nothing else, so the offer
 * screen and the project screen can both call it unchanged.
 */
export async function refileSession(
  sessionId: string,
  projectId: string,
): Promise<ActionResult<SessionRefiled>> {
  return attempt(async () => {
    const { repos } = await appContext()

    const session = await repos.sessions.byId(sessionId)
    if (!session) return no<SessionRefiled>('not-found', "That sitting isn't there any more.")

    const destination = await repos.projects.byId(projectId)
    if (!destination) return no<SessionRefiled>('not-found', "That project doesn't exist any more.")

    if (session.projectId === projectId) {
      return no<SessionRefiled>('already-done', `This is already filed under ${destination.name}.`)
    }

    const carried = await carrySourcesAcross(sessionId, session.projectId, projectId)

    // The sitting arrives under the destination's Intention, whatever the
    // origin's was. Carrying the old one across would file a sentence about one
    // project's work onto a sitting in another, which `draftContract` would
    // then stamp onto a contract. Null when the destination has none, which is
    // the ordinary case and the honest value.
    const destinationIntention = await repos.intentions.forProject(projectId)
    await repos.sessions.refile(sessionId, projectId, destinationIntention?.id ?? null)

    refresh()
    return ok({
      sessionId,
      projectId,
      projectName: destination.name,
      sourcesCarried: carried.carried,
      leftWithdrawn: carried.leftWithdrawn,
    })
  })
}

/**
 * "No — this is new work."
 *
 * The one control the whole automatic-filing story rests on. Propositum joined
 * this sitting to something it had already seen; the person says it is not that
 * at all, and it leaves with a project of its own.
 *
 * ── Why this is answerable afterwards and not only before ────────────────
 *
 * The offer screen can ask before anything durable exists, and it should — it
 * has the person's attention and a spare click. But a person accepting an offer
 * is not reading carefully, which is the point of a one-click offer, so the
 * question has to survive being missed. Everything here is one row moved and
 * two rows written; nothing is lost, and the sitting's own record is untouched.
 *
 * The name is passed in rather than re-derived: by the time someone presses
 * this, the subject Propositum guessed is the thing they are disagreeing with.
 */
export async function splitIntoNewProject(
  sessionId: string,
  name: string,
): Promise<ActionResult<SessionRefiled>> {
  return attempt(async () => {
    const { repos } = await appContext()

    const session = await repos.sessions.byId(sessionId)
    if (!session) return no<SessionRefiled>('not-found', "That sitting isn't there any more.")

    const siblings = await repos.sessions.forProject(session.projectId)
    if (siblings.length <= 1) {
      return no<SessionRefiled>(
        'already-done',
        'This is the only sitting here, so it already has a project to itself. Rename it if the name is wrong.',
      )
    }

    // Deliberately NOT `projectForWork`: the person has just said this is not
    // the work Propositum matched it to, and running the match again would be
    // the software arguing with them.
    const created = await createProject(name)
    if (!created.ok) return { ok: false, problem: created.problem } as const

    const carried = await carrySourcesAcross(sessionId, session.projectId, created.value.id)

    /**
     * And it arrives with NO Intention, which is the whole point of the button.
     *
     * The project was created one line ago, so nobody has stated an Intention
     * for it — null is the same honest value every pre-ADR-0011 row carries.
     * Carrying the old project's Intention across would be the failure
     * CONTEXT.md's ruling names by name: the person has just said *this is not
     * that work*, and the sentence they rejected would ride along onto the
     * split-off sitting and, through `draftContract`, onto its contract, with
     * nothing on screen saying it had.
     */
    await repos.sessions.refile(sessionId, created.value.id, null)

    /**
     * And something to work in, because otherwise this is a dead end.
     *
     * The document stays with the project it was written in — it may hold the
     * earlier sittings' work, and this sitting has just been declared to be
     * about something else. But `draftContract` refuses outright when a project
     * has no document, so leaving the new one empty would mean the correction
     * button dropped the person somewhere they cannot hand anything over from.
     * The same skeleton the acceptance path writes, for the same reason.
     */
    const skeleton = normalise(`# ${created.value.name}\n\n## What I found\n\n## Open questions\n`)
    await repos.documents.create({
      projectId: created.value.id,
      title: created.value.name,
      content: skeleton,
      contentHash: hashContent(skeleton),
    })

    refresh()
    return ok({
      sessionId,
      projectId: created.value.id,
      projectName: created.value.name,
      sourcesCarried: carried.carried,
      leftWithdrawn: carried.leftWithdrawn,
    })
  })
}

/**
 * ~~The person says no. Forget it, and stay quiet about that site for a
 * while.~~ **`declineOffer(origin)` is deleted, 2026-08-17.**
 *
 * It had exactly one caller, the front door's "Not now" button, and that button
 * now names a THREAD. Declining by origin is still what the extension's
 * `/api/capture/ambient/decline` route does, and that route calls
 * `AmbientStore.decline` directly rather than through here — so this was an
 * exported action nothing reached, which is worse than a gap because it reads as
 * a supported way to do something.
 *
 * `declineThread` carries the argument for why the unit changed.
 */

/**
 * The person says no to ONE strand of an afternoon.
 *
 * ── Why the pages are recomputed and not taken from the caller ────────────
 *
 * The same reason the accept path recomputes: a hidden field would carry a page
 * list that was true when the screen rendered, and dropping pages a strand no
 * longer has — or missing ones it has picked up since — would leave the
 * declined subject able to re-form out of the remainder. The signature is the
 * only thing that crosses, exactly as it is on accept, and everything else is
 * read off the buffer here.
 *
 * `pagesOfThread` is the fallback rather than the primary, and the order
 * matters: the fresh detection is what the strand IS now, and the remembered
 * list is what it was when something last pinned it. When the strand has
 * already stopped being detected, the remembered list is all there is, and
 * dropping those pages is still better than dropping nothing — otherwise "not
 * now" on a strand that just aged below the bar would leave every one of its
 * pages in the buffer to seed it again.
 *
 * The signature is snoozed either way, including when neither list has
 * anything. A snooze against a subject nobody can find is harmless and costs a
 * map entry; failing to record one because the strand blinked is an hour of
 * "not now" that does not hold.
 *
 * ── Unbounded, added 2026-08-17 ──────────────────────────────────────────
 *
 * `EVERY_STRAND`, because the display bound is now applied after the snooze
 * filters and the third strand on the screen can be the detector's fourth. A
 * lookup bounded at three would miss it, fall through to `pagesOfThread`, and
 * quietly do the weaker thing — snoozing the signature while leaving the pages
 * that will re-form it in an hour's time. That failure is invisible: the strand
 * disappears from the screen for the snooze and comes back afterwards, which is
 * what a snooze looks like anyway.
 *
 * ── What "not now" here does not buy ─────────────────────────────────────
 *
 * Quiet from the notification channel. This snoozes one signature; the poll
 * promotes whichever strand is next and the extension may notify about that one
 * within a poll or two, because `quietUntil` in `service-worker.js` is set only
 * by the notification's own "Not now" and nothing here reaches it. That is
 * deliberate as far as this screen is concerned — it tells the person that
 * turning one down leaves the others where they are — and it is written down in
 * ADR-0008 rather than only here, because it is the notification channel's
 * behaviour and not this action's.
 */
export async function declineThreadOffer(
  threadSignature: string,
): Promise<ActionResult<{ thread: string; pagesDropped: number }>> {
  return attempt(async () => {
    const thread = threadSignature.trim()
    if (thread === '') {
      return no<{ thread: string; pagesDropped: number }>(
        'invalid-input',
        'Propositum could not tell which of those you meant. Reload and try again.',
      )
    }

    const ambient = ambientStore()
    const now = Date.now()
    const fresh = detectThreads(ambient.since(now), now, EVERY_STRAND).find(
      (candidate) => signatureOf(candidate.terms) === thread,
    )
    const urls = fresh ? fresh.urls : ambient.pagesOfThread(thread)

    ambient.declineThread(thread, urls, now)

    /**
     * And the durable half, which the snooze above is not — best-effort, and
     * structurally incapable of being the reason a database opens.
     *
     * `declineThread` snoozes this signature for an hour and forgets it with
     * the buffer, so a person who declines the same strand every evening is
     * asked again every evening and the product learns nothing. This is that,
     * remembered — as a salted hash, a count and a day, and never the terms.
     * ADR-0020 carries the argument, including what the hash does not buy.
     *
     * ── Why `existingAppContext()`, and not `appContext()` ────────────────
     *
     * `declineThreadOffer` touched no database at all before this write
     * existed. Reaching for `appContext()` here would have made it the SECOND
     * function to make the mistake `tests/support/no-real-database.ts`
     * documents in full: `countQuietly` in `src/server/offer-tally.ts` used to
     * call `appContext()`, which builds a handle from `.env`'s `DATABASE_URL`
     * if none exists yet — and in a `vitest` worker that is the developer's
     * real `propositum.db`. `tests/multiple-threads.test.ts` declines a strand
     * with no database of its own, on the strength of `declineThreadOffer`
     * never having needed one, and wrote real rows into it. `countQuietly` was
     * fixed by switching to `existingAppContext()`, which returns a handle
     * only when something else already opened one and `undefined` otherwise —
     * so the counter can be reached from a process that has no database and do
     * nothing, rather than open one to find out. This write repeats that fix
     * rather than reinventing it, for the same reason.
     *
     * A person's "not now" must never fail because this row could not be
     * written: the click already worked — `ambient.declineThread` above holds
     * the hour-long snooze regardless — so a missing context or a failed write
     * here is a lost count, not a lost decline. Both are swallowed, the same
     * shape `countQuietly` swallows its own.
     */
    const context = existingAppContext()
    if (context !== undefined) {
      try {
        const { repos } = await context
        await repos.reticence.record(
          hashSignature(thread, await repos.reticence.salt()),
          dayBucket(now),
        )
      } catch {
        /* A lost count. See above: never a lost observation, offer or render. */
      }
    }

    /**
     * One "Not now", counted as a bare integer.
     *
     * ── The decline rate, and what it must not become ────────────────────
     *
     * `docs/research/intent-suggestion-quality.md` §10.5 asks for this beside
     * the offer rate. What is recorded is the number 1: no signature, no
     * subject, no origin, no time of day beyond the calendar date. *"One offer
     * was declined on the 18th"* is a fact about how loud Propositum was.
     * *"Offer for 'perturbation robotics' declined at 14:32"* is the row
     * ADR-0008 refuses, and there is no column in `offer_tally` it could go in.
     *
     * Not deduplicated, unlike the showing above it — a decline is an act a
     * person performed, and two of them are two. `newlyShown` deduplicates
     * because a poll re-computes the same detection every thirty seconds;
     * nobody presses this button on a timer.
     */
    countQuietly({ offersDeclined: 1 }, now)
    refresh()
    return ok({ thread, pagesDropped: urls.length })
  })
}

/**
 * Start a sitting on a project that already exists.
 *
 * `src/app/api/session/route.ts` does the same two things over HTTP for the
 * extension, and issues it a bearer token besides. The overlap is deliberate
 * and duplicated rather than shared: the route owns a credential this action
 * has no business minting, and pulling the common half into a helper would mean
 * editing a file this change does not own. See the report.
 *
 * This does NOT create anything. It is reached from one button on a project
 * Propositum already identified — the person choosing to sit down at work that
 * is already there, which is a different act from declaring that the work
 * exists.
 */
export async function startSession(projectId: string): Promise<ActionResult<SessionStarted>> {
  return attempt(async () => {
    const { repos } = await appContext()
    const project = await repos.projects.byId(projectId)
    if (!project) return no<SessionStarted>('not-found', "That project doesn't exist any more.")

    // One sitting at a time. The capture store holds exactly one live session,
    // so starting a second would silently stop watching the first while its
    // phase still said `observing` — the interface would then be telling the
    // person something untrue about their own session.
    const live = captureStore().current()
    if (live) {
      const running = await repos.sessions.byId(live.sessionId)
      if (running && running.phase !== 'ended') {
        return no<SessionStarted>(
          'already-done',
          'A session is already running. End that one before starting another.',
        )
      }
    }

    /**
     * The Project's Intention comes with it, and this is the line without which
     * `IntentionState` could never leave `sleeping`.
     *
     * `working` derives from a live WorkSession on the Intention and `delegated`
     * from an accepted HandoffContract on it; a contract gets its id off the
     * sitting at draft time. So if the ONLY sitting ever attached to an
     * Intention were the one that ratified it, both facts would become
     * unreachable the moment that sitting ended, and every second visit to the
     * same work would read as asleep while the person sat in front of it.
     *
     * This is a READ of a row a person already ratified. It writes no Intention,
     * creates none, and edits none — `repos.intentions.create` is still
     * reachable from `startFromSuggestion` and from nothing else — so the
     * human-ratified-only shape is untouched. What it fixes is the honesty of
     * the null: the schema says a null `intentionId` means nobody stated an
     * Intention for this sitting, and on a project that has one, that was false.
     */
    const intention = await repos.intentions.forProject(projectId)

    const session = await repos.sessions.start(projectId, intention?.id ?? null)
    captureStore().start(session.id, Date.now())
    startGapWatch()

    const sources = await repos.projects.approvedSources(projectId)
    refresh()

    return ok({
      sessionId: session.id,
      approvedSources: sources
        .filter((s) => s.grantState === 'granted')
        .map((s) => ({ id: s.id, label: s.label, originPattern: s.originPattern })),
    })
  })
}

export interface SessionEnded {
  readonly sessionId: string
  readonly endedAt: string
}

export async function endSession(sessionId: string): Promise<ActionResult<SessionEnded>> {
  return attempt(async () => {
    const { repos } = await appContext()
    const session = await repos.sessions.byId(sessionId)
    if (!session) return no<SessionEnded>('not-found', "That session isn't there any more.")
    if (session.phase === 'ended') {
      return no<SessionEnded>('already-done', 'That session has already ended.')
    }

    const endedAt = new Date()
    await repos.sessions.end(sessionId, endedAt)

    // Only end capture if this is the session being captured. Ending someone
    // else's live capture because a stale tab posted an old id would lose events
    // with no trace.
    const live = captureStore().current()
    if (live && live.sessionId === sessionId) {
      captureStore().end()
      stopGapWatch()
    }

    refresh()
    return ok({ sessionId, endedAt: endedAt.toISOString() })
  })
}

/* ═════════════════════════════════════════════════════════════ the reading ══ */

export interface ReadingProduced {
  readonly readingId: string
  readonly claimCount: number
  /**
   * Quotes the model offered that did not match the cited event's stored text.
   * Counted, not merely dropped: fabricated support is an H1 datum.
   */
  readonly discardedQuotes: number
  /** False when a reading already existed. Slice 0 produces exactly one. */
  readonly created: boolean
}

/**
 * Read the session.
 *
 * Runs once, when the person asks to hand over — never on a timer. Periodic
 * reading would feed page text to a model with nobody watching, during the one
 * phase whose entire purpose is passive observation.
 *
 * Calling this a second time returns the reading that already exists rather
 * than producing a second one. There is no re-read in slice 0: editing is the
 * correction channel, and a re-runnable reading turns H1 from "did Propositum
 * read a cold session correctly" into "did we converge after three tries".
 */
export async function generateReading(sessionId: string): Promise<ActionResult<ReadingProduced>> {
  return attempt(async () => {
    const { repos } = await appContext()

    const session = await repos.sessions.byId(sessionId)
    if (!session) return no<ReadingProduced>('not-found', "That session isn't there any more.")

    const existing = await repos.readings.latestForSession(sessionId)
    if (existing) {
      const already = await repos.readings.byId(existing.id)
      return ok({
        readingId: existing.id,
        claimCount: already?.claims.length ?? 0,
        discardedQuotes: 0,
        created: false,
      })
    }

    const events = await repos.events.bySession(sessionId)
    if (events.length === 0) {
      return no<ReadingProduced>(
        'nothing-to-read',
        "Propositum didn't see anything in this session, so there is nothing to go on yet.",
      )
    }

    const client = modelClient()
    if (!client) return { ok: false, problem: NO_KEY } as const

    /* ── the numbered event list the model is shown ─────────────────────── */

    const handleToEventId = new Map<string, string>()
    const textByHandle = new Map<string, string>()
    const promptEvents: PromptEvent[] = []
    const notes: string[] = []

    events.forEach((event, i) => {
      const handle = `E${i + 1}`
      const attested = asRecord(event.attested)
      const sentence = describeEvent(event.kind, attested)

      // Page-authored text. Re-datamarked on the way out — `datamark()` is the
      // only construction site for the brand, so this is the only way stored
      // text can legally reach a prompt, and it is idempotent on text the
      // ledger writer already sanitised.
      const stored = textOf(asRecord(event.untrusted), 'text')
      const marked = stored === null ? undefined : datamark(stored)

      handleToEventId.set(handle, event.id)
      textByHandle.set(handle, `${sentence} ${stored ?? ''}`)
      promptEvents.push({
        handle,
        kind: event.kind,
        at: CLOCK.format(event.observedAt),
        attested: sentence,
        ...(marked === undefined ? {} : { untrusted: marked }),
      })

      // A note is human-asserted, and the prompt has a section that says so.
      // It also stays in the numbered list, because a claim that rests on a note
      // must be able to cite it — provenance has no exceptions.
      if (event.kind === 'note') {
        const written = textOf(attested, 'text')
        if (written) notes.push(written)
      }
    })

    const handles = handlesFor(promptEvents)
    const result = await client.run(sessionReadingBoundary(handles), {
      events: promptEvents,
      notes,
    })

    if (!result.ok) return { ok: false, problem: sayWhyTheModelFailed(result.failure) } as const

    /* ── validate, then persist ─────────────────────────────────────────── */

    let discardedQuotes = 0
    const claims: ClaimInput[] = []

    for (const claim of result.value.claims) {
      const evidence: Array<{ eventId: string; quote?: string | undefined }> = []

      for (const cited of claim.evidence) {
        const eventId = handleToEventId.get(cited.ref)
        if (!eventId) continue

        let quote: string | undefined
        if (cited.quote) {
          const source = canonical(textByHandle.get(cited.ref) ?? '')
          if (source.includes(canonical(cited.quote))) quote = cited.quote
          else discardedQuotes += 1
        }

        evidence.push({ eventId, ...(quote === undefined ? {} : { quote }) })
      }

      // A claim whose every citation fails to resolve has no provenance, and an
      // inference with no provenance is not a claim Propositum is allowed to
      // make. Drop it rather than store it unsupported.
      if (evidence.length === 0) continue

      claims.push({
        kind: claim.kind,
        text: claim.text,
        ordinal: claims.length,
        evidence,
        ...(claim.kind === 'objective' && claim.confidence !== undefined
          ? { confidence: claim.confidence }
          : {}),
      })
    }

    const objectives = claims.filter((c) => c.kind === 'objective')
    if (objectives.length !== 1) {
      return no<ReadingProduced>(
        'model-unusable',
        "Propositum couldn't settle on one thing you were working on, so it recorded nothing. Start the agreement yourself and say what you're aiming for.",
      )
    }

    const lastEvent = events[events.length - 1]
    const reading = await repos.readings.create({
      sessionId,
      throughSeq: lastEvent?.seq ?? 0,
      claims,
    })

    refresh()
    return ok({
      readingId: reading.id,
      claimCount: claims.length,
      discardedQuotes,
      created: true,
    })
  })
}

export interface ClaimEdited {
  readonly claimId: string
}

/**
 * The person corrects one claim.
 *
 * `origin` moves to `edited` on that claim alone. Marking the whole reading
 * edited would launder every untouched inferred claim into a human assertion
 * the moment one word changed, and make the handoff correction rate — the
 * measure that tells us whether principle 2 is being met — uncomputable.
 */
export async function editClaim(claimId: string, text: string): Promise<ActionResult<ClaimEdited>> {
  return attempt(async () => {
    const clean = text.trim()
    if (!clean) {
      return no<ClaimEdited>(
        'invalid-input',
        "Say what it should be instead — an empty line can't stand in for it.",
      )
    }

    const { repos } = await appContext()
    await repos.readings.editClaim(claimId, clean)
    refresh()
    return ok({ claimId })
  })
}

/* ══════════════════════════════════════════════════════════════ the handoff ══ */

export interface QuotedConstraint {
  /** Never pre-filled into the working agreement — the person retypes anything
   *  they want honoured. */
  readonly text: string
  readonly sourceLabel: string | null
  /**
   * True only when `text` is a quote that VERIFIED against the cited event's
   * stored page text.
   *
   * When false, `text` is the model's own paraphrase, and it must not be
   * rendered as a quotation attributed to the source. A false attribution is
   * worse than none: CONTEXT calls the attribution "a hard requirement, not a
   * nicety" precisely because the person's retyping is only informed if the
   * source really said it. Attributing the model's words to a real site turns
   * that friction into laundering.
   *
   * It will be false often — the injection defence means the model rarely
   * reproduces a byte-exact string.
   */
  readonly verbatim: boolean
}

/**
 * Where the two pre-filled sentences came from, and when they were written.
 *
 * ── Why this is a discriminant and not a flag ────────────────────────────
 *
 * `tests/reachability.test.ts` asked for exactly this, by name, and said why:
 * a grep proving the objective comes from the drafting call *"does NOT catch an
 * Intention-sourced value arriving as an ADDITIONAL field that `Agreement` then
 * prefers — the literals would still be present, this stays green, and the
 * screen's paragraph becomes false. Closing that needs a provenance
 * discriminant on `ContractDrafted`, which is a union with one arm and an
 * unreachable branch until a second source exists."* A second source exists now,
 * so the union has two arms and neither branch is unreachable.
 *
 * ── Why the second arm carries a date and the first does not ─────────────
 *
 * ADR-0011's answer to `CONTEXT.md`'s ruling on cross-session continuity is that
 * nothing is inherited **quietly**, and it names *on screen wherever it is used*
 * as the softest third of that answer — *"a sentence someone has to keep true in
 * `.tsx` files"*. A sentence written in March, pre-filled in August with nothing
 * saying when, is the exact failure the ruling described. So the arm that can
 * carry old words carries the day they were written, and the agreement screen
 * prints it.
 *
 * The `this-session` arm has no date because printing one there would be the
 * same fact twice: the masthead above the fields already carries this sitting's
 * window, and two timestamps that can disagree after a reload is worse than one.
 */
export type PrefilledWords =
  | { readonly from: 'this-session' }
  | {
      /** The Intention this Project's work sits under — a sentence a person
       *  wrote or ratified, which no model may write. */
      readonly from: 'your-intention'
      /** `Intention.updatedAt`: when a person last wrote or corrected them. */
      readonly writtenAtEpochMs: number
    }

export interface ContractDrafted {
  readonly contractId: string
  readonly objective: string
  readonly definitionOfDone: string
  /** Where `objective` and `definitionOfDone` above came from. The agreement
   *  screen renders an account of this above the fields it accounts for. */
  readonly words: PrefilledWords
  readonly suggestedTimeLimitMinutes: number
  readonly approvedSourceIds: readonly string[]
  readonly allowedActionKinds: readonly ActionKind[]
  /**
   * The document this Shift may change, or NULL when it pins none.
   *
   * Null is a real state now rather than an error on the way to one: a Shift
   * that answers a question or acts in a browser has no document, and the
   * agreement screen must say what it can change without inventing a place.
   */
  readonly documentTitle: string | null
  /**
   * Constraints the reading found in page text. Display-only, structurally
   * barred from the agreement — without the attribution beside them, a quoted
   * constraint is a pre-filled one with an extra click.
   */
  readonly quotedConstraints: readonly QuotedConstraint[]
  /**
   * What the person's calendar says about the next few hours — ADR-0014.
   *
   * **Optional, and ABSENT rather than null when there is nothing to say.** The
   * distinction is the whole requirement: a `calendarSuggestion: null` on every
   * drafted contract would be a person with no calendar being able to tell this
   * shipped, and it would put a key in the serialised result that was not there
   * before. `withCalendarSuggestion` is the only thing that sets it, and it
   * returns its input unchanged when there is no suggestion.
   *
   * It grants nothing and sets nothing. It is a number of minutes drawn from
   * `TIME_LIMIT_CHOICES` and a clock time, offered beside the dial for a person
   * to click. `compilePolicy` cannot receive it, the gate never sees it, and the
   * contract row was written before it was read.
   */
  readonly calendarSuggestion?: CalendarTimeSuggestion
  /**
   * The spend the model proposed and deterministic code resolved — ADR-0024.
   *
   * Optional and ABSENT when the instruction named nothing to buy, on
   * `calendarSuggestion`'s convention and for its reason. Display values for
   * the one line the agreement screen renders with the amount prominent;
   * ratifying the draft is what turns the persisted columns into a granted
   * `complete-purchase`, and `acceptContract` reads them off the ROW, never
   * off anything a client sends back.
   */
  readonly purchaseAuthorization?: {
    readonly originPattern: string
    readonly merchantLabel: string
    readonly whatFor: string
    readonly maxAmountMinor: number
    readonly currency: CurrencyCode
    readonly maxCount: number
  }
}

/** Time limit, initiative, progress, interruption, output — plus the two prose
 *  fields and the guidance the person may have corrected on the same screen. */
export interface HandoffChoices extends AutonomyControls {
  /** Human-typed only. An inferred constraint claim never reaches this. */
  readonly guidance?: readonly string[] | undefined
  readonly objective?: string | undefined
  readonly definitionOfDone?: string | undefined
}

/**
 * Draft a working agreement from a reading.
 *
 * The model proposes the objective, what done means, a time budget and a
 * NARROWING of the sources already seen. It is never asked what Propositum may
 * do — there is no session-level action grant for a subset check to compare
 * against, and a check that cannot fail looks like a safeguard while being none.
 */
export async function draftContract(readingId: string): Promise<ActionResult<ContractDrafted>> {
  return attempt(async () => {
    const { repos } = await appContext()

    const reading = await repos.readings.byId(readingId)
    if (!reading) {
      return no<ContractDrafted>(
        'not-found',
        'Propositum has lost what it understood about that session. Start again from the session.',
      )
    }

    const session = await repos.sessions.byId(reading.sessionId)
    if (!session) return no<ContractDrafted>('not-found', "That session isn't there any more.")

    /**
     * The document, created here or not at all.
     *
     * ── Why this is the seam, and not the moment work started ────────────
     *
     * `startFromSuggestion` used to open a skeleton document the instant a
     * sitting began, which pre-committed every session to the drafting workflow
     * before anybody had chosen one. This is the first point at which anything
     * knows what the shift is FOR, so it is the first point at which creating a
     * document is a decision rather than a default.
     *
     * ── How it knows, and what it does when it does not ──────────────────
     *
     * From `WorkOffer.expectedKinds` for this session — the `ShiftOutcomeKind`s
     * the offer said the work would produce. ~~Nothing writes a `WorkOffer` yet
     * (`tests/reachability.test.ts` asserts exactly that), so today there is
     * never one and the fallback runs every time.~~ The fallback is
     * `document-changes`, which reproduces the old behaviour precisely: a
     * document is created, its first version is pinned, and every existing
     * drafting path works as it did.
     *
     * That is deliberate. The seam moves in this change; WHAT DECIDES at the
     * seam arrives with the accept path that composes offers. Making the
     * fallback anything else would have changed behaviour on the strength of a
     * column no code fills. (Left unstruck: it is the reason, and the reason
     * outlives the fact it was attached to.)
     *
     * **Re-marked 2026-08-20: the accept path arrived, and the struck sentence
     * inverted with it.** `acceptWorkOffer` writes the row through
     * `repos.offers.create`, on the same `sessionId` this lookup keys on, with
     * `expectedKinds` taken from the composed offer. `tests/reachability.test.ts`
     * now asserts the OPPOSITE of what this comment cited it for — twice, in
     * *an accepted offer is written down* and *an accepted offer leaves a
     * durable trace* — and no surviving pin says nothing writes one. So the
     * column is filled, the fallback is the degraded path rather than the only
     * path, and `expectsDocument` can be false in production.
     *
     * Worth the re-mark rather than a quiet edit, because `expectsDocument`
     * gates the document LOOKUP as well as the creation, and the capability
     * block further down this same function already says the unpinned branch is
     * reachable and grants the browser kinds because of it. Anyone auditing
     * that branch got two answers from one function, and the stale one was the
     * one presenting the fallback as safe by pointing at a green test that says
     * the reverse.
     */
    const offer = await repos.offers.forSession(reading.sessionId)
    const expectsDocument =
      offer === null || offer.expectedKinds.length === 0
        ? true
        : offer.expectedKinds.includes('document-changes')

    const project = await repos.projects.byId(session.projectId)

    /**
     * The project's existing document, and only if this shift is for one.
     *
     * `expectsDocument` gates the LOOKUP, not just the creation, and that is the
     * whole correctness of it. Gating creation alone would mean an offer that
     * said *answer* still pinned yesterday's draft whenever the project happened
     * to have one — which is the normal case for a joined project, and precisely
     * what the carry-forward above exists to produce. The offer's stated shape
     * would be silently overridden by the presence of an old file.
     */
    const existing = expectsDocument
      ? (await repos.documents.forProject(session.projectId))[0]
      : undefined
    const base = existing === undefined ? null : await repos.documents.latestVersion(existing.id)

    if (existing !== undefined && base === null) {
      return no<ContractDrafted>('blocked', 'That document has no saved text yet.')
    }

    // The title the handoff boundary writes an objective about. The project's
    // own name when there is no document — the thread already chose it, and it
    // beats inventing a document to have something to name.
    const subject = existing?.title ?? project?.name ?? 'this work'

    /* ── the sources this sitting actually touched ──────────────────────── */

    const events = await repos.events.bySession(reading.sessionId)
    const granted = await repos.projects.approvedSources(session.projectId)
    const labelById = new Map(granted.map((s) => [s.id, s.label]))
    const patternById = new Map(granted.map((s) => [s.id, s.originPattern]))
    const sourceByEventId = new Map(events.map((e) => [e.id, e.approvedSourceId]))

    const observed: Array<{ id: string; label: string }> = []
    const seen = new Set<string>()
    for (const event of events) {
      const id = event.approvedSourceId
      if (!id || seen.has(id)) continue
      seen.add(id)
      observed.push({ id, label: labelById.get(id) ?? id })
    }

    if (observed.length === 0) {
      return no<ContractDrafted>(
        'blocked',
        'Propositum saw no approved sources in this session, so there is nothing it could look at while you are away.',
      )
    }

    const handled = observed.map((s, i) => ({ handle: `S${i + 1}`, id: s.id, label: s.label }))
    const idByHandle = new Map(handled.map((s) => [s.handle, s.id]))

    /* ── the call ───────────────────────────────────────────────────────── */

    const client = modelClient()
    if (!client) return { ok: false, problem: NO_KEY } as const

    // ── Constraint claims never reach this call ──────────────────────────
    //
    // ADR-0006 bars an inferred constraint from reaching StatedIntent, and
    // StatedIntent is objective + definitionOfDone + guidance. The handoff
    // schema has no `guidance` field, so that third is structural — but the
    // model WRITES the other two, and it was being shown the constraint text to
    // write them from.
    //
    // A page saying "proposals must offer a 40% revenue share" could therefore
    // be absorbed into the drafted objective, arrive in the agreement as
    // ordinary prose with no attribution, and be ratified by someone with no
    // way to see where it came from — bypassing the attributed aside two
    // sections below, whose whole purpose is that friction.
    //
    // The system prompt already says "never invent a constraint". ADR-0006's
    // own table classifies a prompt instruction as DEPTH, not a boundary. This
    // filter is the boundary.
    const claimsForHandoff = reading.claims.filter((c) => c.kind !== 'constraint')

    const drafted = await client.run(handoffBoundary(sourceHandlesFor(handled)), {
      claims: claimsForHandoff.map((c) => ({
        kind: c.kind,
        text: c.text,
        ...(c.confidence === null ? {} : { confidence: c.confidence }),
      })),
      sources: handled.map((s) => ({ handle: s.handle, label: s.label })),
      documentTitle: subject,
    })

    if (!drafted.ok) return { ok: false, problem: sayWhyTheModelFailed(drafted.failure) } as const

    /* ── narrowing, verified deterministically ──────────────────────────── */

    const proposed = drafted.value.narrowedSourceHandles
      .map((h) => idByHandle.get(h))
      .filter((id): id is string => id !== undefined)

    // `proposed ⊆ observed` is guaranteed by the handle set, and checked anyway
    // — a narrowing is the only thing a model may propose about scope, so the
    // containment is worth asserting where it is used rather than trusting a
    // refinement three files away. An empty narrowing falls back to everything
    // observed: least privilege, not no privilege.
    const narrowed = proposed.filter((id) => seen.has(id))
    const approvedSourceIds = narrowed.length > 0 ? narrowed : observed.map((s) => s.id)

    const minutes = Math.min(480, Math.max(5, Math.round(drafted.value.suggestedTimeLimitMinutes)))

    /* ── the purchase proposal, resolved deterministically or dropped ───── */

    /**
     * Every failure below drops the WHOLE proposal — absence is the deny, and
     * the empty-narrowing fallback above is deliberately not copied here: an
     * empty narrowing falls back to everything observed because reading widely
     * is cheap to correct, while a defaulted authorisation would be money. The
     * clamps are safe for the sources-clamp reason: the person ratifies the
     * clamped numbers on the screen that shows them.
     */
    const purchase = (() => {
      const p = drafted.value.purchase
      if (p === undefined) return null
      const merchantId = idByHandle.get(p.merchantHandle)
      if (merchantId === undefined || !seen.has(merchantId)) return null
      const origin = exactOriginFor(patternById.get(merchantId) ?? '')
      if (origin === null) return null
      const currency = currencyOf(p.currency)
      if (currency === null) return null
      return {
        originPattern: origin,
        merchantLabel: labelById.get(merchantId) ?? origin,
        whatFor: p.whatFor,
        maxAmountMinor: Math.min(
          MAX_PURCHASE_AMOUNT_MINOR,
          Math.max(1, Math.round(p.maxAmountMinor)),
        ),
        currency,
        maxCount: Math.min(MAX_PURCHASE_COUNT, Math.max(1, Math.round(p.maxCount))),
      }
    })()

    /* ── the two sentences a person is asked to ratify ──────────────────── */

    /**
     * Whose words go in the fields, decided by what has already happened.
     *
     * ── This is the one thing `WorkSoFar` decides, and it decides no more ─
     *
     * ADR-0017 bounds where the fold may go in one line: *"It renders to a
     * person and feeds the pre-filled `StatedIntent` on the agreement screen. It
     * does not reach `compilePolicy`, it does not reach the gate, and it is not
     * in a prompt."* This is that feeding, and the bound is visible from here:
     * the fold is read AFTER the handoff call, so there is no statement above it
     * that could carry it into a boundary; the scope, the dials, the action
     * kinds and the time limit are all decided without it; and it chooses
     * between two sets of human-ratified-or-ratifiable words rather than
     * producing any.
     *
     * ── Why more than one sitting is the test ────────────────────────────
     *
     * Because that is what makes this a CONTINUATION rather than a start. On the
     * first sitting the Intention was written minutes ago from the same offer
     * this reading came out of, so the two sources say the same thing and the
     * model's version is the one drafted against what actually happened this
     * afternoon. On the second evening they are different sentences with
     * different authors, and ADR-0011 §3 is explicit about which wins: *"where
     * the drafting path previously started from a reading of the sitting, it may
     * now start from a sentence written before the sitting existed."*
     *
     * ── The cost, which ADR-0011 predicted and this does not reduce ──────
     *
     * A stale Intention now pre-fills a contract. The person who wrote *"win the
     * Northwind renewal"* in March gets that sentence in August and nothing here
     * knows the renewal closed in May. The human ratification below is the only
     * thing between it and a run, and it is carrying more weight than it was
     * designed for. What this change adds is the one mitigation available
     * without inference: the screen says WHEN those words were written, so a
     * reader can notice the date is old. It does not make the sentence true, and
     * ADR-0011's *Revisit when* names exactly this as the failure to watch for.
     */
    const leftOff = await whereYouLeftOffOn(session.intentionId, Date.now())
    const pickingBackUp = leftOff !== null && leftOff.view.sittings > 1

    const words: {
      objective: string
      definitionOfDone: string
      provenance: PrefilledWords
    } = pickingBackUp
      ? {
          objective: leftOff.objective,
          definitionOfDone: leftOff.definitionOfDone,
          provenance: { from: 'your-intention', writtenAtEpochMs: leftOff.wordsWrittenAtEpochMs },
        }
      : {
          objective: drafted.value.objective,
          definitionOfDone: drafted.value.definitionOfDone,
          provenance: { from: 'this-session' },
        }

    /* ── constraints, quoted and attributed ─────────────────────────────── */

    const quotedConstraints: QuotedConstraint[] = reading.claims
      .filter((c) => c.kind === 'constraint')
      .map((c) => {
        const citedEventId = c.evidence[0]?.eventId
        const sourceId =
          citedEventId === undefined ? null : (sourceByEventId.get(citedEventId) ?? null)
        const quote = c.evidence[0]?.quote
        return {
          text: quote ?? c.text,
          sourceLabel: sourceId === null ? null : (labelById.get(sourceId) ?? null),
          verbatim: quote !== undefined,
        }
      })

    /* ── the document, created last of all ──────────────────────────────── */

    /**
     * Written here, after every branch that can still refuse.
     *
     * Everything above this line can return `blocked` — no approved sources, no
     * API key, a failed handoff call — and a document created before them would
     * survive the refusal. Combined with the reading screen no longer disabling
     * the button when a project has no document, that meant someone could click
     * through, be told "Propositum saw no approved sources in this session", and
     * have the project quietly acquire a two-heading skeleton nobody asked for.
     *
     * So creation is the last thing before the write it exists for. The skeleton
     * is two empty headings named after the project the thread already named:
     * Propositum works on the person's words and never starts from a blank page,
     * so this is a place to put them rather than a draft of anything.
     */
    let pinned = base
    let documentTitle = existing?.title ?? null

    if (expectsDocument && pinned === null) {
      const title = project?.name ?? 'Untitled'
      const skeleton = normalise(`# ${title}\n\n## What this is\n\n## What to do about it\n`)
      const created = await repos.documents.create({
        projectId: session.projectId,
        title,
        content: skeleton,
        contentHash: hashContent(skeleton),
      })
      pinned = {
        id: created.versionId,
        content: skeleton,
        contentHash: hashContent(skeleton),
        ordinal: 1,
      }
      documentTitle = title
    }

    /* ── persist the draft ──────────────────────────────────────────────── */

    /**
     * The capability, decided by whether this shift has a document under it.
     *
     * `DOCUMENT_ACTION_KINDS` used to be granted unconditionally, which was
     * harmless while every contract pinned a base and is not now. The gate
     * refuses `read-document` and `draft-section` with `no_document_pinned`
     * regardless — but the agreement panel builds its list from the granted
     * kinds, so an unpinned shift would have shown *"Read the document"* and
     * *"Draft a section"* under **What Propositum may do**, one section below
     * its own sentence saying there is no document. A permission screen that
     * lists a capability the gate will refuse is the screen teaching people not
     * to read it.
     *
     * ── The `[]` this replaces, and why it was worse than an over-grant ──
     *
     * The unpinned branch granted NOTHING. That is reachable — an accepted
     * `WorkOffer` whose `expectedKinds` omit `document-changes` sets
     * `expectsDocument` false, which skips the lookup and the skeleton alike —
     * and it produced a ratified agreement under which every proposal is
     * refused `action_kind_not_allowed` until `refusal-loop` ends the shift.
     * The person read a permission screen listing no permissions and pressed
     * the button anyway, because the screen did not look like a refusal.
     *
     * A shift with no document is a shift whose work is out on the web, so it
     * grants the browser six — ADR-0010's handoff, and the thing that made the
     * control channel reachable. `grantableActionKinds` owns which; this file
     * owns only the question it is asked.
     *
     * Full capability at draft time; the Output dial removes everything that
     * can change something at ratification. Defaults are static product
     * constants, never model-proposed.
     */
    const allowedActionKinds = [...grantableActionKinds(pinned !== null)]

    const controls = DEFAULT_CONTROLS
    const contract = await repos.contracts.createDraft({
      sessionId: reading.sessionId,
      readingId,
      /**
       * Which Intention this contract advances, carried off the sitting.
       *
       * Written HERE and nowhere else, because it cannot be written anywhere
       * else: `handoff_contract_frozen_once_accepted` permits an UPDATE only
       * while the row is a draft, so a column filled in after acceptance is a
       * column that can never be filled in.
       *
       * It grants nothing. The gate does not read it, `compilePolicy` cannot
       * receive it, and the StatedIntent below is unchanged — the objective and
       * the definition of done are still what the handoff boundary drafted from
       * this sitting's claims, still ratified per contract, still re-ratified
       * for the next one.
       */
      intentionId: session.intentionId,
      objective: words.objective,
      definitionOfDone: words.definitionOfDone,
      guidance: [],
      approvedSourceIds,
      allowedActionKinds,
      baseVersionId: pinned === null ? null : pinned.id,
      initiative: controls.initiative,
      progress: controls.progress,
      output: controls.output,
      interruption: controls.interruption,
      timeLimitMinutes: minutes,
      // The five purchase columns, written at draft time or never — the frozen
      // trigger closes this door at acceptance, like intentionId above. Spread
      // rather than null-filled so a contract with no authorisation writes the
      // same row it always wrote.
      ...(purchase === null
        ? {}
        : {
            purchaseOriginPattern: purchase.originPattern,
            purchaseWhatFor: purchase.whatFor,
            purchaseMaxAmountMinor: purchase.maxAmountMinor,
            purchaseCurrency: purchase.currency,
            purchaseMaxCount: purchase.maxCount,
          }),
    })

    /**
     * The calendar, read AFTER the row is written — which is the point.
     *
     * ADR-0014's hard constraint is that free/busy may never set, widen or
     * lower a time limit. Two things hold it and this is the first: every
     * statement that persists anything about this contract has already run.
     * `createDraft` is above, `timeLimitMinutes: minutes` came from the model's
     * proposal clamped to `[5, 480]` exactly as it did before ADR-0014, and
     * there is no write below this line. So "the calendar cannot reach the
     * database" is a fact about the order of statements rather than a promise
     * somebody has to keep.
     *
     * The second is `withCalendarSuggestion`, which either adds one key or
     * returns the same object. With no calendar connected — no client id, no
     * connection, a rejected token, a dead network, a malformed body, an empty
     * `busy[]` — `suggestedTimeLimit` returns null and this whole block is an
     * identity function. `tests/calendar-freebusy.test.ts` compares the
     * serialised results and they are byte-identical.
     *
     * It cannot throw: `suggestedTimeLimit` swallows its own failures and the
     * `.catch` here is the second net, because a handoff that fell over because
     * Google was down would be the exact opposite of degrading.
     */
    const calendarSuggestion = await suggestedTimeLimit(Date.now()).catch(() => null)

    refresh()
    return ok(
      withCalendarSuggestion(
        {
          contractId: contract.id,
          objective: words.objective,
          definitionOfDone: words.definitionOfDone,
          words: words.provenance,
          suggestedTimeLimitMinutes: minutes,
          approvedSourceIds,
          allowedActionKinds,
          documentTitle,
          quotedConstraints,
          // Absent rather than null when nothing was drafted — the
          // calendarSuggestion convention, for the same reason: an absent key
          // is how a screen with no authorisation stays byte-identical to the
          // screen before this shipped.
          ...(purchase === null ? {} : { purchaseAuthorization: purchase }),
        },
        calendarSuggestion,
      ),
    )
  })
}

/**
 * Forget the calendar credential.
 *
 * The only mutation this product performs on a secret, and it is a deletion.
 * Best-effort revocation at Google, then a real DELETE locally — see
 * `disconnectCalendar` in `src/server/calendar.ts` for why the second happens
 * even when the first fails.
 *
 * Returns nothing, and the one failure worth naming is not Google's. The row is
 * deleted whether or not the revocation reaches Google — and whether or not the
 * `GOOGLE_OAUTH_*` variables are still set, which is the 2026-08-18 fix: they
 * are what the REVOCATION is made with, and blanking them used to return before
 * the delete and strand the credential. Google not hearing about it is settled
 * from their own account page and needs no sentence here.
 *
 * What is left, stated rather than implied: if the DATABASE itself cannot
 * perform the delete, this throws, and unlike the passive reads on this path
 * that is deliberate. A person pressed Disconnect; the row is still there on the
 * screen they come back to, and silently telling them otherwise would be the
 * one lie a deletion control must not tell.
 */
export async function forgetCalendar(): Promise<void> {
  await disconnectCalendar()
  refresh()
}

/* ── setting Propositum up ─────────────────────────────────────────────── */

export interface ExtensionPaired {
  readonly extensionId: string
}

/**
 * Say that the extension which just knocked is yours. ADR-0021's onboarding half.
 *
 * ── What this is not, and the screen says the same ───────────────────────
 *
 * Not authentication. Anything on this machine can knock, and a forged `Origin`
 * was always possible from a non-browser client — `src/capture/transport.ts`
 * says exactly that about the check this feeds. What changes is only where the
 * person expresses the decision: on a screen, having been shown the id, rather
 * than by pasting it into `.env`. The person clicking is the authorisation, on
 * the same terms as the extension's own **Allow** gesture.
 *
 * The id must be one that is actually knocking, which is an honesty check rather
 * than a security one: pairing with a typo produces an afternoon of wondering
 * why nothing is captured, which is the exact failure this whole path exists to
 * end.
 */
export async function pairExtensionAction(
  extensionId: string,
): Promise<ActionResult<ExtensionPaired>> {
  return attempt(async () => {
    const result = await pairExtension(extensionId)
    if (!result.ok) {
      return no<ExtensionPaired>(
        result.reason === 'malformed' ? 'invalid-input' : 'not-found',
        result.reason === 'malformed'
          ? "That is not a Chrome extension id."
          : 'Nothing with that id has called here in the last few minutes. Reload the extension and try again.',
      )
    }
    refresh()
    return ok({ extensionId: result.extensionId })
  })
}

export interface PairingStarted {
  /** What the bot is called, so a person can see they pasted the right token. */
  readonly handle: string
}

/** Half one of pairing a phone: check the token and read back the bot's name. */
export async function beginThreadPairing(
  botToken: string,
): Promise<ActionResult<PairingStarted>> {
  return attempt(async () => {
    const started = await beginPairing(botToken)
    if (!started.ok) {
      return no<PairingStarted>(
        started.problem === 'no-token' ? 'invalid-input' : 'blocked',
        started.detail,
      )
    }
    refresh()
    return ok({ handle: started.handle })
  })
}

/** Half two: whoever pressed Start is the person this thread belongs to. */
export async function completeThreadPairing(): Promise<ActionResult<PairingStarted>> {
  return attempt(async () => {
    const ctx = await appContext()
    const done = await completePairing(ctx)
    if (!done.ok) return no<PairingStarted>('blocked', done.detail)
    refresh()
    return ok({ handle: done.handle })
  })
}

/**
 * Unpair. A real DELETE, like `forgetCalendar`.
 *
 * Returns `void` for the same reason that one does — there is nothing to report
 * and nothing that can usefully fail. What it must do is actually remove the
 * credential, and `thread.forget` deletes the sent rows first so the foreign key
 * cannot outlive its target.
 */
export async function forgetThread(): Promise<void> {
  const ctx = await appContext()
  await unpair(ctx)
  refresh()
}

/**
 * The dials as they arrive on screen, before the person touches them.
 *
 * Static product constants, never model-proposed — a model able to pre-set
 * *use judgment / stop only when blocked* would be the autonomy dial itself
 * hijacked.
 *
 * Four of the five sit at the cautious end. **Output does not**, and that is
 * worth saying plainly rather than describing all five as "safe defaults":
 * `draft-changes` is the permissive value, chosen because the product's whole
 * claim is that work continues while you are away, and a default of
 * `suggestions-only` would mean the ordinary path begins by widening a
 * permission. The dial still bites — flipping it removes `draft-section` from
 * the scope, not from the wording.
 *
 * Exported as an async function because a `'use server'` module may export
 * nothing else. It lives here rather than in three screens that would drift.
 */
const DEFAULT_CONTROLS: AutonomyControls = {
  initiative: 'follow-closely',
  progress: 'current-step-only',
  output: 'draft-changes',
  interruption: 'stop-when-uncertain',
  timeLimitMinutes: 30,
}

export async function defaultAutonomyControls(): Promise<AutonomyControls> {
  return DEFAULT_CONTROLS
}

export interface ContractAccepted {
  /** The contract that was ratified. Not always the one passed in — see below. */
  readonly contractId: string
  readonly runId: string
  readonly acceptedAt: string
  /** `acceptedAt + timeLimitMinutes`. Derived from an immutable pair, never
   *  stored, so a crash-restart cannot silently reset the budget. */
  readonly deadlineAt: string
  readonly allowedActionKinds: readonly ActionKind[]
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return sameList([...a].sort(), [...b].sort())
}

/**
 * Ratify, then queue the shift.
 *
 * Nothing in the controls can switch this step off. There is no auto-accept and
 * no auto-handoff; a human act is the only thing that moves a contract out of
 * `draft`, and no run may start from one that has not.
 *
 * ── Why this may write a second draft row ────────────────────────────────
 *
 * The Output dial is a real permission: `suggestions-only` removes
 * `draft-section` from the scope, so a worker that proposes document text is
 * refused by the same deny-by-default path as any unauthorized kind. That means
 * the dials the person set must reach the stored contract, and the repository's
 * `editDraft` can only patch the objective, the definition of done and the time
 * limit.
 *
 * So when the chosen dials differ from the draft's, this writes a fresh draft
 * carrying them and ratifies that one, returning its id. The superseded draft is
 * inert — no run may start from an unaccepted contract. The alternative was to
 * accept a contract whose stored permissions did not match the panel the person
 * read, and a permission panel that does not bind is the exact failure
 * PRODUCT_PRINCIPLES §6 exists to prevent. See the report for the repository
 * method that would remove this.
 */
export async function acceptContract(
  contractId: string,
  controls: HandoffChoices,
): Promise<ActionResult<ContractAccepted>> {
  return attempt(async () => {
    const { repos } = await appContext()

    const draft = await repos.contracts.byId(contractId)
    if (!draft) return no<ContractAccepted>('not-found', "That agreement isn't there any more.")
    if (draft.status !== 'draft') {
      return no<ContractAccepted>('already-done', "You've already handed this over.")
    }

    const session = await repos.sessions.byId(draft.sessionId)
    if (!session) return no<ContractAccepted>('not-found', "That session isn't there any more.")
    if (session.phase === 'ended') {
      return no<ContractAccepted>(
        'blocked',
        'That session has ended, so there is nothing to hand over. Start a new one.',
      )
    }

    const minutes = Math.round(controls.timeLimitMinutes)
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) {
      return no<ContractAccepted>(
        'invalid-input',
        'Give Propositum somewhere between 5 minutes and 8 hours.',
      )
    }

    const objective = (controls.objective ?? draft.objective).trim()
    const definitionOfDone = (controls.definitionOfDone ?? draft.definitionOfDone).trim()
    if (!objective) {
      return no<ContractAccepted>(
        'invalid-input',
        "Say what Propositum should work on while you're away.",
      )
    }
    if (!definitionOfDone) {
      return no<ContractAccepted>('invalid-input', 'Say how Propositum will know it is finished.')
    }

    // Human-typed only. Nothing derived from page text arrives here — the
    // handoff boundary has no field that could carry it.
    const guidance = (controls.guidance ?? []).map((g) => g.trim()).filter((g) => g.length > 0)

    /**
     * The Output dial, applied to the stored scope. `compilePolicy` applies it
     * again at run time; both agreeing is the point, not redundancy.
     *
     * **Subtracting `MUTATING_ACTION_KINDS` rather than `draft-section` by
     * name.** The name filter was correct while the only grantable mutating
     * kind was `draft-section` — on a document shift the two are the same
     * subtraction and this is not a behaviour change. On a browser shift they
     * are not: `click-element`, `type-text` and `press-key` are the mutating
     * kinds, and a name filter would have left all three under a dial whose
     * label reads *"Research only — don't write"*. That is the one thing
     * `compilePolicy`'s own argument says must never happen — the
     * safest-looking option being the one that is not safest — and it would
     * have happened in the stored scope while the compiled policy told the
     * truth, so the panel and the gate would have disagreed about what the
     * person had granted.
     */
    const allowedActionKinds: ActionKind[] = grantableActionKinds(
      draft.baseVersionId !== null,
    ).filter((kind) => controls.output !== 'suggestions-only' || !MUTATING_ACTION_KINDS.has(kind))

    /**
     * The one writer that may grant `complete-purchase`, and its facts come
     * off the PERSISTED ROW only — `HandoffChoices` has no purchase field, so
     * a client payload cannot smuggle an authorisation in, and pressing Hand
     * over on the screen that showed the amount is what ratification means.
     * `grantableActionKinds` subtracts the kind by construction; this is the
     * add-back, gated on the columns the draft was written with, and it obeys
     * the same suggestions-only filter as every mutating kind.
     */
    if (
      draft.purchaseOriginPattern != null &&
      draft.purchaseMaxAmountMinor != null &&
      draft.purchaseCurrency != null &&
      draft.purchaseMaxCount != null &&
      controls.output !== 'suggestions-only'
    ) {
      allowedActionKinds.push('complete-purchase')
    }

    const unchanged =
      draft.objective === objective &&
      draft.definitionOfDone === definitionOfDone &&
      draft.timeLimitMinutes === minutes &&
      draft.initiative === controls.initiative &&
      draft.progress === controls.progress &&
      draft.output === controls.output &&
      draft.interruption === controls.interruption &&
      sameList(draft.guidance, guidance) &&
      sameSet(draft.allowedActionKinds, allowedActionKinds)

    const targetId = unchanged
      ? contractId
      : (
          await repos.contracts.createDraft({
            sessionId: draft.sessionId,
            readingId: draft.readingId,
            // Carried onto the superseding draft. Editing the agreement mints a
            // new row rather than updating a frozen one, and a field left off
            // here would be silently dropped by the act of changing a dial.
            intentionId: draft.intentionId ?? null,
            objective,
            definitionOfDone,
            guidance,
            approvedSourceIds: draft.approvedSourceIds,
            allowedActionKinds,
            baseVersionId: draft.baseVersionId,
            // The five purchase columns ride the superseding draft for
            // intentionId's reason: left off here, changing a dial would
            // silently revoke a shown authorisation — or worse, keep the grant
            // in allowedActionKinds while dropping the ceiling it is bounded
            // by.
            purchaseOriginPattern: draft.purchaseOriginPattern ?? null,
            purchaseWhatFor: draft.purchaseWhatFor ?? null,
            purchaseMaxAmountMinor: draft.purchaseMaxAmountMinor ?? null,
            purchaseCurrency: draft.purchaseCurrency ?? null,
            purchaseMaxCount: draft.purchaseMaxCount ?? null,
            initiative: controls.initiative,
            progress: controls.progress,
            output: controls.output,
            interruption: controls.interruption,
            timeLimitMinutes: minutes,
          })
        ).id

    const acceptedAt = new Date()
    await repos.contracts.accept(targetId, acceptedAt)

    // observing → away. Capture is off for the whole shift, which is what makes
    // "While you were away" describe a stable interval.
    await repos.sessions.markAway(draft.sessionId)

    const run = await repos.runs.enqueue({ contractId: targetId, role: 'worker' })

    refresh()
    return ok({
      contractId: targetId,
      runId: run.id,
      acceptedAt: acceptedAt.toISOString(),
      deadlineAt: new Date(acceptedAt.getTime() + minutes * 60_000).toISOString(),
      allowedActionKinds,
    })
  })
}

/* ═════════════════════════════════════════════════════════════════ review ══ */

export interface VerdictRecorded {
  readonly changeId: string
  readonly verdict: 'accept' | 'reject' | 'edit'
}

/**
 * The person decides on one change.
 *
 * Only a human writes one of these. No model, worker run or reviewer run may,
 * and there is no column that could record otherwise — a verdict is
 * human-authored by definition.
 *
 * `edit` is not decoration. Generated work is scored accepted / edited /
 * rejected, so folding an edit into an accept would make the hypothesis
 * unmeasurable.
 */
export async function recordVerdict(
  changeId: string,
  verdict: 'accept' | 'reject' | 'edit',
  editedText?: string,
): Promise<ActionResult<VerdictRecorded>> {
  return attempt(async () => {
    if (verdict !== 'accept' && verdict !== 'reject' && verdict !== 'edit') {
      return no<VerdictRecorded>('invalid-input', 'Choose accept, reject, or edit.')
    }

    const clean = editedText?.trim()
    if (verdict === 'edit' && !clean) {
      return no<VerdictRecorded>('invalid-input', 'Write what it should say instead.')
    }
    if (verdict !== 'edit' && clean) {
      return no<VerdictRecorded>(
        'invalid-input',
        'Replacement text only goes with an edit. Choose Edit to keep it.',
      )
    }

    const { repos } = await appContext()

    // Deciding after the fold has already happened would record a verdict the
    // document does not reflect, and the version chain cannot be revised —
    // `DocumentVersion` is insert-only. The unique index below catches a second
    // verdict on one change; this catches a first verdict on a settled review.
    const settled = await repos.changesets.settledFor(changeId)
    if (settled) {
      return no<VerdictRecorded>(
        'already-done',
        "These are already in your document. Edit it directly — what's there now is yours.",
      )
    }

    try {
      await repos.changesets.recordVerdict({
        changeId,
        verdict,
        ...(verdict === 'edit' && clean ? { editedText: clean } : {}),
      })
    } catch (error) {
      // One verdict per change, enforced by a unique index. Changing your mind
      // is a thing the interface has to say out loud rather than something a
      // second silent write papers over.
      const message = error instanceof Error ? error.message : String(error)
      if (/unique|P2002/i.test(message)) {
        return no<VerdictRecorded>('already-done', "You've already decided on this change.")
      }
      throw error
    }

    refresh()
    return ok({ changeId, verdict })
  })
}

export interface OutcomeVerdictRecorded {
  readonly outcomeId: string
  readonly verdict: 'accept' | 'reject' | 'edit'
}

/**
 * The person decides on one whole thing a Shift produced.
 *
 * ── This refuses on a landed outcome, and the refusal is the point ───────
 *
 * `reversibility` is checked BEFORE anything else — before the kind, before the
 * shape of the input, before the unique index gets a chance to have an opinion.
 * A `landed` outcome is already outside Propositum: a form was submitted, a
 * message was sent. There is no verdict to record, and recording one would put
 * a row in the database saying a person rejected something that had already
 * happened.
 *
 * The interface renders no control at all for these (`src/ui/outcome.tsx`), so
 * on the honest path this branch is unreachable. It exists because interfaces
 * drift and servers do not: some future refactor that reintroduces a Reject
 * button beside a sent message must produce a refusal a person can read, not a
 * silent write. ADR-0009 calls this out as two mechanisms for one truth and
 * argues for it on exactly these grounds — the one screen the trust model rests
 * on must not be able to tell somebody their sent message was rejected.
 *
 * ── And on a document outcome, for a different reason ────────────────────
 *
 * A `document-changes` outcome's decidable units are its ProposedChanges, each
 * addressed by offsets into an immutable base and each carrying its own
 * ChangeVerdict. A whole-outcome verdict beside them would be a second decision
 * surface over one thing, and the fold has no way to read it. The two verdict
 * tables are deliberately separate; this is the line between them, enforced.
 *
 * Only a human writes one of these. No model, worker run or reviewer run may,
 * and there is no column that could record otherwise.
 */
export async function recordOutcomeVerdict(
  outcomeId: string,
  verdict: 'accept' | 'reject' | 'edit',
  editedText?: string,
): Promise<ActionResult<OutcomeVerdictRecorded>> {
  return attempt(async () => {
    const { repos } = await appContext()

    const shiftOutcome = await repos.outcomes.byId(outcomeId)
    if (!shiftOutcome) {
      return no<OutcomeVerdictRecorded>('not-found', "That isn't there any more.")
    }

    // First, and deliberately before the input is even looked at.
    if (!isDecidable(shiftOutcome.reversibility)) {
      return no<OutcomeVerdictRecorded>(
        'blocked',
        'This already happened, outside Propositum. There is nothing here to accept or reject — Propositum cannot undo it, and it will not pretend it can.',
      )
    }

    if (shiftOutcome.kind === 'document-changes') {
      return no<OutcomeVerdictRecorded>(
        'blocked',
        'These are changes to your document. Decide on each one where it appears, below.',
      )
    }

    if (verdict !== 'accept' && verdict !== 'reject' && verdict !== 'edit') {
      return no<OutcomeVerdictRecorded>('invalid-input', 'Choose accept, reject, or edit.')
    }

    const clean = editedText?.trim()
    if (verdict === 'edit' && !clean) {
      return no<OutcomeVerdictRecorded>('invalid-input', 'Write what it should say instead.')
    }
    if (verdict !== 'edit' && clean) {
      return no<OutcomeVerdictRecorded>(
        'invalid-input',
        'Replacement text only goes with an edit. Choose Edit to keep it.',
      )
    }

    try {
      await repos.outcomes.recordVerdict({
        outcomeId,
        verdict,
        ...(verdict === 'edit' && clean ? { editedText: clean } : {}),
      })
    } catch (error) {
      // One verdict per outcome, enforced by a unique index — the same shape
      // ChangeVerdict uses, for the same reason. Changing your mind is a thing
      // the interface has to say out loud rather than something a second silent
      // write papers over.
      const message = error instanceof Error ? error.message : String(error)
      if (/unique|P2002/i.test(message)) {
        // Refreshed even though nothing was written, and BECAUSE nothing was
        // written. Reaching here means the durable record holds a verdict the
        // screen does not know about — a second tab, or a decision made and
        // then the page left open — so the screen is the stale half. Without
        // this it goes on offering Accept and Reject over something already
        // decided, and every further click produces the same sentence.
        refresh()
        return no<OutcomeVerdictRecorded>('already-done', "You've already decided on this.")
      }
      throw error
    }

    refresh()
    return ok({ outcomeId, verdict })
  })
}

export interface DecisionAnswered {
  readonly decisionId: string
}

/**
 * Answer one raised decision. ADR-0022 — the fifth verb.
 *
 * ── Why this one is a text field and not two buttons ──────────────────────
 *
 * A `DecisionNeeded` exists precisely because the worker met something it could
 * not reduce to a choice. Reducing it to a choice HERE would be the model's
 * failure to enumerate, papered over by ours — and a Yes and a No on this screen
 * would be a `ConfirmationVerdict` with the safety filed off, sitting one heading
 * away from the real one.
 *
 * ── Why it is safe from a phone, when a confirmation is not ───────────────
 *
 * It grants nothing. No `AuthorizedAction` is minted, no `ContractScope` widens,
 * no `ActionKind` becomes allowed, no budget moves. The run that raised the
 * question has already ended, so nothing is holding a control token or driving a
 * browser. An answer enters the product on the footing `guidance` already has —
 * human prose that informs work and authorises none of it.
 *
 * That is the whole of ADR-0021's argument for why this is the one verdict a
 * message channel may carry, and `tests/thread-scope.test.ts` is what holds it:
 * the answer reaches a row and never a prompt, never `compilePolicy`, never a
 * `ContractScope`.
 *
 * ── What it does NOT do, said here because it looks finished ──────────────
 *
 * Nothing reads it. No worker, no boundary, no next agreement. Carrying an
 * answer into the next Shift's `StatedIntent` would be a path from a worker's
 * own question to the next agreement's text with no human ratification in
 * between, which is what ADR-0006 §5 exists to refuse. The carry-forward is a
 * separate decision that starts a new Shift with an agreement a person reads.
 */
export async function answerDecision(
  decisionId: string,
  answer: string,
): Promise<ActionResult<DecisionAnswered>> {
  return attempt(async () => {
    const { repos } = await appContext()

    const clean = answer.trim()
    if (!clean) {
      return no<DecisionAnswered>('invalid-input', 'Write what you want it to do.')
    }

    const result = await repos.reports.answer({
      decisionNeededId: decisionId,
      answer: clean,
      source: 'screen',
      at: new Date(),
    })

    if (!result.ok) {
      if (result.reason === 'not-found') {
        return no<DecisionAnswered>('not-found', "That isn't there any more.")
      }
      /**
       * Refreshed even though nothing was written, and BECAUSE nothing was
       * written — the same move `recordOutcomeVerdict` makes. Reaching here
       * means the durable record holds an answer this screen does not know
       * about, most likely because it was given on a phone. The screen is the
       * stale half.
       */
      refresh()
      return no<DecisionAnswered>('already-done', "You've already answered this one.")
    }

    refresh()
    return ok({ decisionId })
  })
}

export interface ShiftFinished {
  /**
   * The version the kept changes became, when this Shift produced document
   * changes. `null` when it did not — a Shift that answered a question or
   * collected a list writes nothing here, and saying so with an absence is
   * truer than inventing a version number for it.
   */
  readonly document: {
    readonly versionId: string
    readonly ordinal: number
    readonly kept: number
    readonly discarded: number
  } | null
  /** Held outcomes that carried a decision when this finished. Counted so the
   *  screen can say what the act covered without re-reading anything. */
  readonly decided: number
}

/**
 * The person is done deciding, and what they kept becomes a new version.
 *
 * ── Why this is one act at the end, not one per verdict ──────────────────
 *
 * Review produces decisions, never documents, and the base is immutable **for
 * the whole review** — so offsets stay valid while the person works through the
 * changes in any order. Folding as each verdict lands would move the text under
 * the changes not yet decided, and every offset after the first would need
 * re-anchoring. That is the problem this design exists to avoid, not a
 * refinement of it.
 *
 * Until this existed the review loop terminated without producing anything at
 * all, and the interface said so in its own copy: "Whatever you decide here is
 * yours to fold into the document."
 *
 * ── What generalising this did NOT change ────────────────────────────────
 *
 * This used to be `finishReview` and used to assume that finishing a Shift and
 * folding a changeset were the same act. They are not, now that a run can
 * answer a question or collect a list without touching a document. So this
 * refuses while anything HELD is still undecided — a change or a whole outcome,
 * the two verdict tables counted together because the person cannot tell them
 * apart and should not have to — and then folds the document changes if there
 * are any.
 *
 * The fold below is byte-for-byte the code that was here before: the same drift
 * check against the same immutable base, the same `materialise`, the same
 * `committedFromChangesetId` that IS the already-reviewed flag by virtue of
 * being unique. Nothing about the document path was made conditional on the
 * outcome rows, and a Shift that produced a changeset and no `ShiftOutcome` —
 * which is every Shift that has ever run — takes exactly the path it took
 * before. That was the hard requirement of this change and it is worth stating
 * where the code is rather than in a commit message.
 *
 * A `landed` outcome records nothing here. It has no verdict to fold and
 * nothing waiting on it; it was reported, and reporting is finished the moment
 * the person has read it.
 *
 * ── Drift is checked twice, and both are real ────────────────────────────
 *
 * The shift screen checks it to decide which screen to render. This checks it to
 * decide whether to write. The window between the two is a person editing their
 * document while looking at the report, which is neither rare nor a misuse —
 * ADR-0003 §4 says the document is never locked, so their edit wins and this
 * refuses.
 */
export async function finishShift(contractId: string): Promise<ActionResult<ShiftFinished>> {
  return attempt(async () => {
    const { repos } = await appContext()

    const changeset = await repos.changesets.forContract(contractId)
    const outcomes = await repos.outcomes.forContract(contractId)

    // Held, and decidable as a whole. The document outcome is excluded because
    // its decidable units are the changes, which are counted separately below —
    // counting it twice would make a fully-decided review refuse itself.
    const held = outcomes.filter(
      (shiftOutcome) =>
        isDecidable(shiftOutcome.reversibility) && shiftOutcome.kind !== 'document-changes',
    )
    const undecidedOutcomes = held.filter((shiftOutcome) => shiftOutcome.verdict === null)

    if (!changeset && outcomes.length === 0) {
      // The old copy — "there are no changes to put into your document" — was
      // true when a document was the only thing a Shift could produce. It reads
      // as a document problem, and this case is not one.
      return no<ShiftFinished>('not-found', 'There is nothing waiting on you.')
    }
    if (changeset && changeset.settledAsVersionId !== null) {
      return no<ShiftFinished>(
        'already-done',
        "You've already put these into your document. What's there now is yours to edit.",
      )
    }

    const undecidedChanges = (changeset?.changes ?? []).filter((change) => change.verdict === null)
    const waiting = undecidedChanges.length + undecidedOutcomes.length
    if (waiting > 0) {
      // Said in changes when only changes are waiting, because that is what the
      // person is looking at. Said in things when the two are mixed, because
      // "3 changes" would be a miscount of a set that is not all changes.
      if (undecidedOutcomes.length === 0) {
        const count = waiting === 1 ? 'one change' : `${waiting} changes`
        return no<ShiftFinished>(
          'blocked',
          `Decide on ${count} still waiting, and Propositum will put the rest in.`,
        )
      }
      const count = waiting === 1 ? 'one thing' : `${waiting} things`
      return no<ShiftFinished>(
        'blocked',
        `Decide on ${count} still waiting, and Propositum will finish up.`,
      )
    }

    if (!changeset) {
      // Everything held has a decision, and none of it was document-shaped.
      // Nothing is written: the verdicts already are the durable record, and a
      // version chain has nothing to grow from.
      refresh()
      return ok<ShiftFinished>({ document: null, decided: held.length })
    }

    const base = await repos.documents.version(changeset.baseVersionId)
    if (!base) {
      return no<ShiftFinished>('not-found', 'The version this shift worked from is gone.')
    }

    const latest = await repos.documents.latestVersion(base.documentId)
    if (!latest) {
      return no<ShiftFinished>('not-found', 'That document has no saved text.')
    }

    // The human's own edit always wins. Nothing is written, and nothing they
    // decided is lost — the verdicts stay on the record.
    const drift = checkDrift(latest.content, changeset.baseHash)
    if (!drift.ok) {
      return no<ShiftFinished>(
        'blocked',
        'You changed this document while Propositum was working, so these changes no longer line up with it. Yours is the one that counts — nothing was overwritten.',
      )
    }

    const decisions = changeset.changes.map((change, changeIndex) => ({
      changeIndex,
      verdict: change.verdict?.verdict as Decision['verdict'],
      ...(change.verdict?.editedText ? { editedText: change.verdict.editedText } : {}),
    }))

    const folded = materialise(base.content, changeset.changes, decisions)
    const kept = decisions.filter((d) => d.verdict !== 'reject').length

    const version = await repos.documents.addVersion({
      documentId: base.documentId,
      content: folded,
      contentHash: hashContent(folded),
      origin: 'accepted-changeset',
      committedFromChangesetId: changeset.id,
    })

    refresh()
    return ok<ShiftFinished>({
      document: {
        versionId: version.id,
        ordinal: version.ordinal,
        kept,
        discarded: decisions.length - kept,
      },
      decided: held.length,
    })
  })
}

/* ══════════════════════════════════════════ saying yes to one thing ══ */

/**
 * The three human answers to a paused run: yes, no, and stop.
 *
 * ── Why these are here and the logic is not ──────────────────────────────
 *
 * This file is `'use server'`, so every export becomes a callable endpoint. The
 * worker process needs the same decisions and is a different Node process that
 * never imports `src/server/db`, so the durable work lives in
 * `./confirmations` and these are the human-facing skin over it.
 *
 * ── The verbs, which must not drift ──────────────────────────────────────
 *
 * The gate REFUSES · the human REJECTS · the model DECLINES · the human
 * CONFIRMS. `ConfirmationVerdict` holds `confirmed | rejected` and never
 * `approved`, which belongs to `ApprovedSource` and means something else
 * entirely. A screen that used one word for rejecting a paragraph and for
 * authorising something irreversible would be asking somebody to do the second
 * with the control they learned on the first.
 *
 * ── There is no notification-side yes ────────────────────────────────────
 *
 * The notification has ONE button and it says *Show me*. Approving from a
 * notification is approving without seeing what you are approving, and the
 * entire trust story here rests on the human review being real. So these are
 * reachable only from a screen showing the attested facts, the verbatim text
 * and the picture.
 */

/** What the person gets back after answering. */
export interface ConfirmationAnswered {
  readonly requestId: string
  /** The run that will pick the work up, or null when they said no. */
  readonly continuationRunId: string | null
}

/**
 * They said yes to this one thing.
 *
 * **One of exactly two writers of a `ConfirmationVerdict`, and this one is
 * reached only from a human's click on a screen showing what they are
 * authorising.** No model, no worker run and no reviewer run may reach it. That
 * cannot be enforced by a column — the database cannot see who is holding the
 * keyboard — so it is enforced by the writer being here and by this sentence,
 * which the next person to want a confirmation resolved from inside a run has
 * to delete before they can break the rule.
 */
export async function confirmOnePendingRequest(
  requestId: string,
): Promise<ActionResult<ConfirmationAnswered>> {
  return attempt(async () => {
    const ctx = await appContext()
    const answered = await confirmRequest(ctx, requestId, new Date())

    if (!answered.ok) {
      if (answered.reason === 'not-found') {
        return no<ConfirmationAnswered>('not-found', 'That question is no longer here.')
      }
      if (answered.reason === 'already-answered') {
        return no<ConfirmationAnswered>('already-done', 'You have already answered this one.')
      }
      // The work ended before the answer arrived, so there is nothing for a yes
      // to let carry on. Said as its own sentence rather than folded into the
      // expiry one below: somebody who answered within a minute must not be
      // told they were too slow.
      if (answered.reason === 'abandoned') {
        return no<ConfirmationAnswered>(
          'blocked',
          'Propositum stopped before your answer arrived, so there is nothing left for a yes to carry on. Nothing was done. Hand the work over again if you still want it.',
        )
      }
      // Expiry never approves. A yes that arrives a day late is not converted
      // into a yes; it is turned down, and the person is told plainly why.
      return no<ConfirmationAnswered>(
        'blocked',
        'This question sat unanswered for a day, so Propositum stopped waiting. Nothing was done. Hand the work over again if you still want it.',
      )
    }

    refresh()
    return ok<ConfirmationAnswered>({ requestId, continuationRunId: answered.continuationRunId })
  })
}

/**
 * They said no.
 *
 * Recorded rather than dropped, because the absence of a row and a `rejected`
 * row are identical to the gate and different in the report: one says *"you
 * said no"*, the other says *"I asked and you never saw it"*. Nothing is
 * enqueued — the run that asked has ended, and the thing it wanted stays
 * refused.
 */
export async function rejectOnePendingRequest(
  requestId: string,
): Promise<ActionResult<ConfirmationAnswered>> {
  return attempt(async () => {
    const ctx = await appContext()
    const answered = await rejectRequest(ctx, requestId, new Date())

    if (!answered.ok) {
      if (answered.reason === 'not-found') {
        return no<ConfirmationAnswered>('not-found', 'That question is no longer here.')
      }
      return no<ConfirmationAnswered>('already-done', 'You have already answered this one.')
    }

    refresh()
    return ok<ConfirmationAnswered>({ requestId, continuationRunId: null })
  })
}

/** What "Take back control" reports. */
export interface ControlTaken {
  readonly runId: string
  /** False when there was nothing still running to stop. */
  readonly stopped: boolean
  /**
   * Actions abandoned by a run that had ALREADY ended, now recorded as
   * unverified.
   *
   * ── Almost always zero, and that is correct ──────────────────────────────
   *
   * `settleAbandonedIntents` returns 0 for any run in `pending | claimed |
   * running`, by a deliberate guard. So pressing this on a live run — the
   * ordinary case — settles nothing, and `unfinished` is 0.
   *
   * **Do not "fix" that to make this number more interesting.** An intent with
   * no outcome on a LIVE run is in flight, not abandoned: the worker is about
   * to write the real outcome, `ActionOutcome.intentId` is unique, and a
   * recovery row written first makes the worker's write throw, propagate out of
   * the loop, and complete a healthy shift as `failed / error`. Pressing "Take
   * back control" would be the thing that broke the run.
   *
   * It is non-zero in the case it was written for: a run that already ended —
   * because Chrome's infobar Cancel or the tab overlay chip removed the
   * capability mid-action, which detaches before any POST and does not come
   * through here — and left an intent nobody came back to. Otherwise the
   * startup sweep settles it once the lease expires.
   */
  readonly unfinished: number
}

/**
 * Take back control — the third kill switch, and the only one that needs the
 * app.
 *
 * ── Three switches, and this is the weakest on purpose ───────────────────
 *
 * Chrome's own infobar Cancel ends the debugger attachment and cannot be
 * suppressed or styled by us. The tab overlay chip and the side panel Stop
 * detach first and tell the app afterwards, so they work with the app closed,
 * the dev server restarting, or the machine offline. This one requires the app
 * to be up, which is exactly why it is not the only one: a stop that has to
 * reach a server before it takes effect is not a stop.
 *
 * What it adds is reach. It is the switch available to somebody on the "While
 * you were away" screen who is not looking at the tab, and it is the one that
 * writes the durable flag the run reads at its next action boundary.
 *
 * ── A flag, not a kill ───────────────────────────────────────────────────
 *
 * Nothing here interrupts anything. `cancelRequested` is a column; the run
 * re-reads it at every action boundary and halts itself. That is the only way
 * to stop cleanly when the thing being stopped may be mid-navigation in
 * somebody's real browser — and it is why the two switches that remove the
 * capability outright exist alongside it.
 *
 * **One exception, from 2026-09-02 ([ADR-0030](../../docs/adr/0030-a-halt-closes-the-question.md)).**
 * A run PARKED on a question is not mid-navigation and holds no credential, so
 * this door ends it outright rather than flagging it. That is what `byAPerson`
 * says, and this is the only caller that passes it: the extension's door must
 * not, because its idle timer cannot be told apart from a person's Stop and a
 * parked run is idle by construction.
 */
export async function takeBackControl(runId: string): Promise<ActionResult<ControlTaken>> {
  return attempt(async () => {
    const ctx = await appContext()

    /**
     * The same implementation `POST /api/act/halt` uses.
     *
     * One behaviour behind two doors: this one, and the one the tab overlay
     * chip and the side panel Stop reach after they have already detached. Two
     * implementations of "stop" would be two things to keep in agreement about
     * a run that is driving somebody's browser, and they would disagree first
     * on the part nobody looks at — flag, revoke, settle, in that order.
     */
    const { stopped, unfinished } = await haltRun(ctx, runId, { byAPerson: true })

    refresh()
    return ok<ControlTaken>({ runId, stopped, unfinished })
  })
}
