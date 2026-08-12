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

import { appContext } from './db'
import { readableCause } from './problem'
import { ambientStore, captureStore } from './capture-store'
import { AnthropicModelClient } from '../model/anthropic'
import type { FailureKind, ModelClient } from '../model/client'
import { datamark } from '../model/untrusted'
import {
  handlesFor,
  sessionReadingBoundary,
} from '../model/boundaries/session-reading'
import type { PromptEvent } from '../model/boundaries/session-reading'
import { handoffBoundary, sourceHandlesFor } from '../model/boundaries/handoff'
import { matchProject, projectTerms } from '../domain/detection/match-project'
import type { ProjectCandidate } from '../domain/detection/match-project'
import { checkDrift, hashContent, materialise } from '../domain/document/changeset'
import type { Decision } from '../domain/document/changeset'
import { normalise } from '../domain/document/normalise'
import { ACTION_KINDS } from '../domain/handoff/policy'
import type { ActionKind, AutonomyControls } from '../domain/handoff/policy'
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
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: ActionProblem }

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

function modelClient(): ModelClient | null {
  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) return null
  return new AnthropicModelClient({ apiKey })
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
        message: "What came back didn't hold together, so Propositum recorded nothing rather than guess.",
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

const CLOCK = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })

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
    return no<ProjectCreated>('invalid-input', 'That name is too long — keep it under 120 characters.')
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
      return no<ProjectCreated>('invalid-input', 'That name is too long — keep it under 120 characters.')
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

/** The counts behind the carry-on box, for one project. */
async function describeProject(
  project: { id: string; name: string },
  overlap: number,
): Promise<CarriedProject> {
  const { repos } = await appContext()
  const [sittings, sources, documents] = await Promise.all([
    repos.sessions.forProject(project.id),
    repos.projects.approvedSources(project.id),
    repos.documents.forProject(project.id),
  ])

  return {
    projectId: project.id,
    name: project.name,
    sittings: sittings.length,
    sources: sources.filter((source) => source.grantState === 'granted').length,
    documents: documents.length,
    overlap,
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
  readonly documentId: string
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
): Promise<ActionResult<WorkStarted>> {
  return attempt(async () => {
    const name = subject.trim()
    if (!name) return no<WorkStarted>('invalid-input', 'Propositum could not name that work.')

    const { repos, ledger } = await appContext()

    const live = captureStore().current()
    if (live) {
      const running = await repos.sessions.byId(live.sessionId)
      if (running && running.phase !== 'ended') {
        return no<WorkStarted>(
          'already-done',
          'A session is already running. End that one first.',
        )
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
     * Something to work in — unless the project already has one.
     *
     * Carrying the document forward is most of what joining a project is FOR.
     * A second sitting on the same subject that opened a fresh skeleton beside
     * yesterday's half-written draft would have continuity in the filing and
     * none where it matters, and slice 0 works on one document at a time, so
     * which of the two the handoff picked would come down to insertion order.
     */
    const existing = await repos.documents.forProject(project.id)
    const skeleton = normalise(
      intent === 'draft-document'
        ? `# ${name}\n\n## What this is\n\n## What to do about it\n`
        : `# ${name}\n\n## What I found\n\n## Open questions\n`,
    )
    const document =
      existing[0] ??
      (await repos.documents.create({
        projectId: project.id,
        title: name,
        content: skeleton,
        contentHash: hashContent(skeleton),
      }))

    const session = await repos.sessions.start(project.id)
    const startedAtMs = Date.now()
    captureStore().start(session.id, startedAtMs)

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

    let carriedOver = 0
    for (const observation of ambient.forUrls(threadPages, startedAtMs)) {
      const pattern = normaliseOriginPattern(observation.origin)
      const sourceId = pattern === null ? undefined : sourceByPattern.get(pattern)
      if (!sourceId) continue

      const appended = await ledger.append(session.id, {
        kind: observation.kind === 'query' ? 'queried' : 'visited',
        observedAt: new Date(observation.at),
        elapsedMs: 0,
        approvedSourceId: sourceId,
        attested: { url: observation.url, title: observation.title, ambient: true },
      })
      if (appended.ok) carriedOver += 1
    }
    ambient.clear()

    refresh()
    return ok({
      projectId: project.id,
      projectName: project.name,
      sessionId: session.id,
      documentId: document.id,
      carriedOver,
      joinedExisting: joined,
      discardedOrigins,
      leftWithdrawn,
    })
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
    await repos.sessions.refile(sessionId, projectId)

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
    await repos.sessions.refile(sessionId, created.value.id)

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

/** The person says no. Forget it, and stay quiet about that site for a while. */
export async function declineOffer(origin: string): Promise<ActionResult<{ origin: string }>> {
  return attempt(async () => {
    ambientStore().decline(origin, Date.now())
    refresh()
    return ok({ origin })
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

    const session = await repos.sessions.start(projectId)
    captureStore().start(session.id, Date.now())

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
    if (live && live.sessionId === sessionId) captureStore().end()

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
      return no<ClaimEdited>('invalid-input', "Say what it should be instead — an empty line can't stand in for it.")
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

export interface ContractDrafted {
  readonly contractId: string
  readonly objective: string
  readonly definitionOfDone: string
  readonly suggestedTimeLimitMinutes: number
  readonly approvedSourceIds: readonly string[]
  readonly allowedActionKinds: readonly ActionKind[]
  readonly documentTitle: string
  /**
   * Constraints the reading found in page text. Display-only, structurally
   * barred from the agreement — without the attribution beside them, a quoted
   * constraint is a pre-filled one with an extra click.
   */
  readonly quotedConstraints: readonly QuotedConstraint[]
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
        "Propositum has lost what it understood about that session. Start again from the session.",
      )
    }

    const session = await repos.sessions.byId(reading.sessionId)
    if (!session) return no<ContractDrafted>('not-found', "That session isn't there any more.")

    const documents = await repos.documents.forProject(session.projectId)
    const document = documents[0]
    if (!document) {
      return no<ContractDrafted>(
        'blocked',
        'There is no document in this project yet. Paste one in first, so Propositum has something to work on.',
      )
    }

    const base = await repos.documents.latestVersion(document.id)
    if (!base) {
      return no<ContractDrafted>('blocked', 'That document has no saved text yet.')
    }

    /* ── the sources this sitting actually touched ──────────────────────── */

    const events = await repos.events.bySession(reading.sessionId)
    const granted = await repos.projects.approvedSources(session.projectId)
    const labelById = new Map(granted.map((s) => [s.id, s.label]))
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

    const drafted = await client.run(
      handoffBoundary(sourceHandlesFor(handled)),
      {
        claims: claimsForHandoff.map((c) => ({
          kind: c.kind,
          text: c.text,
          ...(c.confidence === null ? {} : { confidence: c.confidence }),
        })),
        sources: handled.map((s) => ({ handle: s.handle, label: s.label })),
        documentTitle: document.title,
      },
    )

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

    /* ── constraints, quoted and attributed ─────────────────────────────── */

    const quotedConstraints: QuotedConstraint[] = reading.claims
      .filter((c) => c.kind === 'constraint')
      .map((c) => {
        const citedEventId = c.evidence[0]?.eventId
        const sourceId = citedEventId === undefined ? null : sourceByEventId.get(citedEventId) ?? null
        const quote = c.evidence[0]?.quote
        return {
          text: quote ?? c.text,
          sourceLabel: sourceId === null ? null : labelById.get(sourceId) ?? null,
          verbatim: quote !== undefined,
        }
      })

    /* ── persist the draft ──────────────────────────────────────────────── */

    // Full capability at draft time; the Output dial removes `draft-section` at
    // ratification. Defaults are static product constants, never model-proposed.
    const controls = DEFAULT_CONTROLS
    const contract = await repos.contracts.createDraft({
      sessionId: reading.sessionId,
      readingId,
      objective: drafted.value.objective,
      definitionOfDone: drafted.value.definitionOfDone,
      guidance: [],
      approvedSourceIds,
      allowedActionKinds: [...ACTION_KINDS],
      baseVersionId: base.id,
      initiative: controls.initiative,
      progress: controls.progress,
      output: controls.output,
      interruption: controls.interruption,
      timeLimitMinutes: minutes,
    })

    refresh()
    return ok({
      contractId: contract.id,
      objective: drafted.value.objective,
      definitionOfDone: drafted.value.definitionOfDone,
      suggestedTimeLimitMinutes: minutes,
      approvedSourceIds,
      allowedActionKinds: [...ACTION_KINDS],
      documentTitle: document.title,
      quotedConstraints,
    })
  })
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
      return no<ContractAccepted>('invalid-input', "Say what Propositum should work on while you're away.")
    }
    if (!definitionOfDone) {
      return no<ContractAccepted>('invalid-input', 'Say how Propositum will know it is finished.')
    }

    // Human-typed only. Nothing derived from page text arrives here — the
    // handoff boundary has no field that could carry it.
    const guidance = (controls.guidance ?? []).map((g) => g.trim()).filter((g) => g.length > 0)

    // The Output dial, applied to the stored scope. `compilePolicy` applies it
    // again at run time; both agreeing is the point, not redundancy.
    const allowedActionKinds: ActionKind[] =
      controls.output === 'suggestions-only'
        ? ACTION_KINDS.filter((k) => k !== 'draft-section')
        : [...ACTION_KINDS]

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
            objective,
            definitionOfDone,
            guidance,
            approvedSourceIds: draft.approvedSourceIds,
            allowedActionKinds,
            baseVersionId: draft.baseVersionId,
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

export interface ReviewFinished {
  readonly versionId: string
  readonly ordinal: number
  readonly kept: number
  readonly discarded: number
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
 * ── Drift is checked twice, and both are real ────────────────────────────
 *
 * The shift screen checks it to decide which screen to render. This checks it to
 * decide whether to write. The window between the two is a person editing their
 * document while looking at the report, which is neither rare nor a misuse —
 * ADR-0003 §4 says the document is never locked, so their edit wins and this
 * refuses.
 */
export async function finishReview(contractId: string): Promise<ActionResult<ReviewFinished>> {
  return attempt(async () => {
    const { repos } = await appContext()

    const changeset = await repos.changesets.forContract(contractId)
    if (!changeset) {
      return no<ReviewFinished>('not-found', 'There are no changes to put into your document.')
    }
    if (changeset.settledAsVersionId !== null) {
      return no<ReviewFinished>(
        'already-done',
        "You've already put these into your document. What's there now is yours to edit.",
      )
    }

    const undecided = changeset.changes.filter((change) => change.verdict === null)
    if (undecided.length > 0) {
      const count = undecided.length === 1 ? 'one change' : `${undecided.length} changes`
      return no<ReviewFinished>(
        'blocked',
        `Decide on ${count} still waiting, and Propositum will put the rest in.`,
      )
    }

    const base = await repos.documents.version(changeset.baseVersionId)
    if (!base) {
      return no<ReviewFinished>('not-found', 'The version this shift worked from is gone.')
    }

    const latest = await repos.documents.latestVersion(base.documentId)
    if (!latest) {
      return no<ReviewFinished>('not-found', 'That document has no saved text.')
    }

    // The human's own edit always wins. Nothing is written, and nothing they
    // decided is lost — the verdicts stay on the record.
    const drift = checkDrift(latest.content, changeset.baseHash)
    if (!drift.ok) {
      return no<ReviewFinished>(
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
    return ok({
      versionId: version.id,
      ordinal: version.ordinal,
      kept,
      discarded: decisions.length - kept,
    })
  })
}
