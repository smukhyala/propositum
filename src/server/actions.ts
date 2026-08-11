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

export async function createProject(name: string): Promise<ActionResult<ProjectCreated>> {
  return attempt(async () => {
    const clean = name.trim()
    if (!clean) return no<ProjectCreated>('invalid-input', 'Give the project a name first.')
    if (clean.length > 120) {
      return no<ProjectCreated>('invalid-input', 'That name is too long — keep it under 120 characters.')
    }

    const { repos } = await appContext()
    const project = await repos.projects.create(clean)
    refresh()
    return ok(project)
  })
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
 * Start a sitting.
 *
 * `src/app/api/session/route.ts` does the same two things over HTTP for the
 * extension, and issues it a bearer token besides. The overlap is deliberate
 * and duplicated rather than shared: the route owns a credential this action
 * has no business minting, and pulling the common half into a helper would mean
 * editing a file this change does not own. See the report.
 */
export interface OfferAccepted {
  readonly sessionId: string
  readonly projectId: string
  readonly sourceId: string
  /** Ambient observations folded into the new session's ledger. */
  readonly carriedOver: number
}

/**
 * The person says yes to a suggestion.
 *
 * ── One click, three acts, all of them theirs ────────────────────────────
 *
 * Approving the source, starting the session, and admitting what was already
 * seen are separate decisions in the data model and one decision in the
 * interface. Splitting them across three prompts would make the feature more
 * annoying than doing it by hand, which is the whole thing it exists to avoid.
 *
 * ── Why the ambient observations are carried over ────────────────────────
 *
 * The offer says "you have been reading northwind.example.com for 12 minutes".
 * A session that then began at zero would produce a reading with no evidence
 * for the work that triggered it, and the person would have to redo the
 * browsing Propositum just told them it watched.
 *
 * So they are folded in — and once folded they are ORDINARY ObservationEvents,
 * written through the one ledger door with every normal rule applying. They
 * carry `attested.ambient = true`, because "Propositum saw this before you
 * started the session" is a fact about provenance the timeline should not hide.
 *
 * Nothing is invented on the way in. Ambient observations hold no page text, so
 * the events that come out of this hold none either — the reading will be
 * thinner than one from a watched session, and that is honest rather than a
 * bug to paper over.
 */
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
 */
export interface WorkStarted {
  readonly projectId: string
  readonly sessionId: string
  readonly documentId: string
  readonly carriedOver: number
}

export async function startFromSuggestion(
  subject: string,
  origins: readonly string[],
  intent: 'draft-document' | 'deep-research',
  /** The thread's signature. What makes the carry-over precise — without it
   *  this falls back to everything from the same sites, which is how a search
   *  for "nissan altima" became evidence for a hiking trip. */
  threadSignature?: string,
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

    // The thread names the project. Nobody is asked to file anything.
    const project = await repos.projects.create(name)

    const sourceIds: string[] = []
    for (const origin of origins) {
      const pattern = normaliseOriginPattern(origin)
      if (!pattern) continue
      const host = pattern.replace(/^https?:\/\//, '').replace(/\/\*$/, '')
      const source = await repos.projects.approveSource({
        projectId: project.id,
        originPattern: pattern,
        label: host,
      })
      sourceIds.push(source.id)
    }

    // Something to work in. A heading rather than an empty file, so the first
    // draft has somewhere to go and the diff has something to anchor against.
    const skeleton = normalise(
      intent === 'draft-document'
        ? `# ${name}\n\n## What this is\n\n## What to do about it\n`
        : `# ${name}\n\n## What I found\n\n## Open questions\n`,
    )
    const document = await repos.documents.create({
      projectId: project.id,
      title: name,
      content: skeleton,
      contentHash: hashContent(skeleton),
    })

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
    const sourceByOrigin = new Map(origins.map((origin, i) => [origin, sourceIds[i]]))

    let carriedOver = 0
    for (const observation of ambient.forUrls(threadPages, startedAtMs)) {
      const sourceId = sourceByOrigin.get(observation.origin)
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
      sessionId: session.id,
      documentId: document.id,
      carriedOver,
    })
  })
}

export async function acceptOffer(
  projectId: string,
  origin: string,
  label: string,
): Promise<ActionResult<OfferAccepted>> {
  return attempt(async () => {
    const { repos, ledger } = await appContext()

    const project = await repos.projects.byId(projectId)
    if (!project) return no<OfferAccepted>('not-found', "That project doesn't exist any more.")

    const live = captureStore().current()
    if (live) {
      const running = await repos.sessions.byId(live.sessionId)
      if (running && running.phase !== 'ended') {
        return no<OfferAccepted>(
          'already-done',
          'A session is already running. End that one before starting another.',
        )
      }
    }

    const pattern = normaliseOriginPattern(origin)
    if (!pattern) {
      return no<OfferAccepted>('invalid-input', "Propositum could not make sense of that site.")
    }

    const host = pattern.replace(/^https?:\/\//, '').replace(/\/\*$/, '')
    const source = await repos.projects.approveSource({
      projectId,
      originPattern: pattern,
      label: label.trim() || host,
    })

    const session = await repos.sessions.start(projectId)
    const startedAtMs = Date.now()
    captureStore().start(session.id, startedAtMs)

    // Take what was seen before folding, then forget the buffer entirely —
    // including anything about other sites, which the person did not accept.
    const ambient = ambientStore()
    const carried = ambient.forOrigin(new URL(pattern.replace(/\/\*$/, '')).origin, startedAtMs)

    let carriedOver = 0
    for (const observation of carried) {
      const appended = await ledger.append(session.id, {
        kind: observation.kind === 'query' ? 'queried' : 'visited',
        observedAt: new Date(observation.at),
        // Before the session began, so it is negative time. Clamp rather than
        // lie: the ledger's elapsed clock starts when the session does.
        elapsedMs: 0,
        approvedSourceId: source.id,
        attested: {
          url: observation.url,
          title: observation.title,
          // Provenance, said out loud. This event was seen before the person
          // started the session, and the timeline should not imply otherwise.
          ambient: true,
        },
      })
      if (appended.ok) carriedOver += 1
    }

    ambient.clear()
    refresh()

    return { ok: true, value: { sessionId: session.id, projectId, sourceId: source.id, carriedOver } }
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
