/**
 * The take-over route.
 *
 * A server component whose only job is to turn rows into sentences. Everything
 * a person reads on this screen is assembled here, so the client never receives
 * an id it would have to resolve, a timestamp it would have to format, or a
 * kind it would have to interpret.
 *
 * ── Two rules this file follows that are not style preferences ───────────
 *
 * 1. **A page-authored title is never rendered as if Propositum knew it.**
 *    ADR-0006 §3: titles and URL text are influenced by the page, not attested
 *    by Chrome. `src/capture/semantics.ts` writes them into `attested` anyway,
 *    so this file does not trust that field for prose. Where an event has an
 *    `ApprovedSource`, the sentence uses the label the PERSON gave that source
 *    at approval time; where it has none, it says "an approved source" rather
 *    than repeating something a page chose. Verified quotations are the one
 *    exception and they always carry their attribution.
 *
 * 2. **Nothing here is a model call.** Reading the session and drafting the
 *    agreement are both deliberate acts a person takes, on a screen they are
 *    looking at. Interpretation on page load would mean a model reading page
 *    text with nobody watching, which is precisely what CONTEXT rules out.
 */

import { notFound } from 'next/navigation'

import { appContext } from '@/server/db'
import { BackLink, Empty, Masthead, Sheet } from '@/ui/primitives'
import { TakeOver } from '@/ui/reading'
import type { ClaimView, EvidenceView, SourceView } from '@/ui/reading'

export const dynamic = 'force-dynamic'

/* ── times, in the register the prototype set ───────────────────────────── */

const CLOCK = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

function clock(when: Date): string {
  return CLOCK.format(when).replace(/\s*(AM|PM)$/i, (_m, half: string) => ` ${half.toLowerCase()}`)
}

/* ── one event, as a sentence ───────────────────────────────────────────── */

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function text(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * Deliberately the second-person voice: this is shown under "why I think that",
 * where every line is something the PERSON did. The worker's own actions are a
 * different screen with a different voice.
 */
function sentenceFor(kind: string, attested: Record<string, unknown>, where: string): string {
  switch (kind) {
    case 'visited':
      return `you opened ${where}`
    case 'returnedTo':
      return `you came back to ${where}`
    case 'queried': {
      const term = text(attested, 'term')
      return term ? `you searched for “${term}”` : `you searched on ${where}`
    }
    case 'engaged': {
      const dwell = attested['dwellMs']
      const minutes = typeof dwell === 'number' ? Math.max(1, Math.round(dwell / 60_000)) : null
      return minutes ? `you read ${where} for about ${minutes} min` : `you read ${where}`
    }
    case 'excerpted':
      return `you selected text on ${where}`
    case 'switchedAway':
      return 'you stepped away from the screen'
    case 'documentEdited':
      return 'you edited the document'
    case 'note':
      return text(attested, 'text') ?? 'you wrote a note'
    case 'sourceApproved':
      return `you approved ${where}`
    case 'captureGap':
      return 'Propositum stopped seeing your work'
    default:
      // Something this screen has not been taught to describe is still shown,
      // plainly. A row that silently disappears is provenance the person cannot
      // check, and an internal name shown in its place is no better.
      return 'something Propositum recorded but cannot put into words'
  }
}

/* ═══════════════════════════════════════════════════════════════════ page ══ */

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params

  let loaded: Awaited<ReturnType<typeof load>>
  try {
    loaded = await load(sessionId)
  } catch {
    return (
      <Sheet>
        <BackLink href="/">&larr; All projects</BackLink>
        <Masthead
          kicker="Propositum"
          title="Propositum can’t read its own records just now."
          subtitle="Nothing has been changed."
        />
        <Empty
          title="The store didn’t answer."
          next="Check that the database is up, then reload this page. Nothing about your session has been lost — this screen only reads."
        />
      </Sheet>
    )
  }

  if (loaded === null) notFound()

  return (
    <Sheet>
      <BackLink href={`/projects/${loaded.projectId}`}>&larr; {loaded.projectName}</BackLink>
      <TakeOver
        sessionId={sessionId}
        projectName={loaded.projectName}
        phase={loaded.phase}
        when={loaded.when}
        reading={loaded.reading}
        sources={loaded.sources}
        documentTitle={loaded.documentTitle}
        shiftContractId={loaded.shiftContractId}
      />
    </Sheet>
  )
}

/* ── everything the screen needs, in one pass ───────────────────────────── */

async function load(sessionId: string) {
  const { repos } = await appContext()

  const session = await repos.sessions.byId(sessionId)
  if (!session) return null

  const project = await repos.projects.byId(session.projectId)
  const [events, granted, documents, head, shift] = await Promise.all([
    repos.events.bySession(sessionId),
    repos.projects.approvedSources(session.projectId),
    repos.documents.forProject(session.projectId),
    repos.readings.latestForSession(sessionId),
    // Read from the server, not held in client state: a reload while
    // Propositum is away would otherwise strand the person on this screen with
    // no way through to the note they came back for.
    repos.contracts.acceptedForSession(sessionId),
  ])

  const labelById = new Map(granted.map((source) => [source.id, source.label]))

  /* Each event, pre-rendered. The claims below cite these by id. */
  const byEventId = new Map<string, { at: string; what: string; sourceLabel: string | null }>()
  for (const event of events) {
    const label = event.approvedSourceId === null ? null : labelById.get(event.approvedSourceId) ?? null
    byEventId.set(event.id, {
      at: clock(event.observedAt),
      what: sentenceFor(event.kind, record(event.attested), label ?? 'an approved source'),
      sourceLabel: label,
    })
  }

  const first = events[0]
  const last = events[events.length - 1]
  const when =
    first === undefined
      ? 'nothing recorded yet'
      : session.endedAt !== null
        ? `${clock(first.observedAt)} – ${clock(session.endedAt)}`
        : session.phase === 'away'
          ? `${clock(first.observedAt)} – handed over`
          : `${clock(first.observedAt)} – still going, ${events.length} ${events.length === 1 ? 'thing' : 'things'} seen`

  let reading: { id: string; claims: ClaimView[] } | null = null
  if (head) {
    const full = await repos.readings.byId(head.id)
    if (full) {
      reading = {
        id: full.id,
        claims: full.claims.map((claim) => ({
          id: claim.id,
          kind: claim.kind,
          text: claim.text,
          confidence: claim.confidence,
          origin: claim.origin,
          evidence: claim.evidence.map((item): EvidenceView => {
            const seen = byEventId.get(item.eventId)
            return {
              at: seen?.at ?? '',
              // An event the reading cites but the session no longer lists is
              // not silently dropped: a claim standing on nothing should look
              // like a claim standing on nothing.
              what: seen?.what ?? 'something Propositum can no longer show you',
              quote: item.quote,
              sourceLabel: seen?.sourceLabel ?? null,
            }
          }),
        })),
      }
    }
  }

  const sources: SourceView[] = granted
    .filter((source) => source.grantState === 'granted')
    .map((source) => ({ id: source.id, label: source.label, originPattern: source.originPattern }))

  // `unused` is the honest word here — one document per project in slice 0, and
  // the agreement names it so "what I can change" is a place, not a category.
  const document = documents[0]

  return {
    projectId: session.projectId,
    projectName: project?.name ?? 'Propositum',
    phase: session.phase,
    when,
    reading,
    sources,
    documentTitle: document?.title ?? null,
    shiftContractId: shift?.id ?? null,
  }
}
