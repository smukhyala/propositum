/**
 * The session timeline.
 *
 * ── Sentences, not a table of kinds ──────────────────────────────────────
 *
 * An ObservationEvent has a `kind`, a `seq` and an `attested` payload. None of
 * those words appear here. A row reads "Opened Northwind's partnership page."
 * because that is what happened, and a person scanning their own afternoon
 * should not have to translate a column of enum values back into it.
 *
 * The noun is never shown. There is no kind badge, no seq, no source id.
 *
 * ── Two voices, deliberately ─────────────────────────────────────────────
 *
 * Rows about the person's work take no subject — "Searched for northwind
 * revenue share tiers." Rows where Propositum speaks about itself are first
 * person — "I stopped seeing your work from 2:10 to 2:41." That contrast is the
 * point: the log is the person's, the blind spots are Propositum's, and saying
 * "Propositum stopped seeing your work" in the middle of someone's own timeline
 * puts a third party in a room with two people in it.
 *
 * ── A gap breaks the rail ────────────────────────────────────────────────
 *
 * A CaptureGap is not an error and is not styled as one. It is also not a rail
 * row: a hole in the record rendered as one more line reads as one more thing
 * that happened, and PRODUCT_PRINCIPLES §11 forbids exactly that softening. So
 * it steps out of the time gutter and takes the full column, with its interval
 * stated in the person's own clock and the reason in plain language.
 *
 * ── Page-authored text is shown, never obeyed ────────────────────────────
 *
 * Selections and page titles are things a page could have authored. They are
 * displayed — the alternative is a timeline that cannot tell you what you
 * selected — and they are displayed as quotations, escaped by React, reaching
 * no decision anywhere. Where sanitisation found hidden or disguised text, the
 * row says so calmly rather than hiding it or alarming about it.
 */

'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

import { Button, Empty, LogEntry } from '@/ui/primitives'
import { Away, Done, Unknown, Watching, Wrote } from '@/ui/sprites'

/* ── what a row is made of ──────────────────────────────────────────────── */

/**
 * One stored event, flattened for the client.
 *
 * `untrustedText` and `adversarial` are lifted out of the event's `untrusted`
 * payload by the caller so this component never has to reach into it, and so
 * the two page-authored values it may render are visible in the type.
 */
export interface TimelineEvent {
  readonly id: string
  readonly kind: string
  /** ISO. Formatted here, in the reader's own clock. */
  readonly observedAtIso: string
  readonly attested: Record<string, unknown>
  /** Page-authored. Display-only, always quoted. */
  readonly untrustedText: string | null
  /** Sanitisation found something that does not occur in benign article text. */
  readonly adversarial: boolean
  /** The human-written name of the approved source, when there is one. */
  readonly sourceLabel: string | null
}

export interface TimelineProps {
  readonly events: readonly TimelineEvent[]
  /** True only when Propositum is actually watching right now — not merely when
   *  a session row exists. The empty state and the polling both depend on it. */
  readonly live: boolean
  /** Shapes the empty state: nothing to watch is a different problem from
   *  nothing watched yet, and they need different instructions. */
  readonly approvedSourceCount: number
}

/* ── local styling ──────────────────────────────────────────────────────── */

/**
 * A second stylesheet beside the primitives', under its own `href` so React
 * hoists and de-duplicates it separately. Only the gap block and the footer
 * need it; everything else is a primitive.
 */
const CSS = `
.tl-gap { margin: 1rem 0; padding: 1rem 1.25rem; background: var(--raised); border-left: 2px solid var(--attention); }
.tl-gap-when { display: flex; align-items: center; gap: 0.5rem; color: var(--attention); font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.1em; text-transform: uppercase; margin: 0 0 0.5rem; }
.tl-gap-what { font-family: var(--serif); font-size: 1.0625rem; line-height: 1.45; margin: 0; text-wrap: pretty; }
.tl-gap-why { margin: 0.45rem 0 0; font-size: 0.875rem; color: var(--muted); }
.tl-quote { font-family: var(--serif); }
.tl-flag { color: var(--attention); }
.tl-foot { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid var(--rule); font-size: 0.8125rem; color: var(--faint); }
.tl-foot p { margin: 0; }
`

function Styles() {
  return (
    <style href="propositum-timeline" precedence="default">
      {CSS}
    </style>
  )
}

/* ── small readers over the stored payload ──────────────────────────────── */

function text(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function num(source: Record<string, unknown>, key: string): number | null {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clip(raw: string, max: number): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1).trimEnd()}…`
}

/** `https://northwind.example.com/partners` → `northwind.example.com/partners`.
 *  The scheme is machinery; the person recognises the host and the path. */
function prettyUrl(raw: string): string {
  return raw
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
}

/**
 * Where this happened, said the way the person would say it.
 *
 * The page title is preferred because it is what they saw, and it is a value a
 * page could have authored — which is fine here and nowhere else: it is
 * escaped, it is display-only, and it reaches no decision.
 */
function placeOf(event: TimelineEvent): string {
  const title = text(event.attested, 'title')
  if (title) return clip(title, 72)

  const url = text(event.attested, 'url')
  if (url) return clip(prettyUrl(url), 72)

  return event.sourceLabel ?? 'an approved source'
}

/** Rounded to something a person would say out loud. */
function minutesOf(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes <= 1) return 'a minute'
  if (minutes < 60) return `${minutes} minutes`

  const hours = Math.round(ms / 3_600_000)
  return hours === 1 ? 'an hour' : `${hours} hours`
}

const CLOCK = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

/**
 * "2:41 pm".
 *
 * The Next server and the browser are the same machine — the extension posts to
 * loopback and the database is a local file — so there is no timezone for the
 * two renders to disagree about.
 */
function clock(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return CLOCK.format(at).replace(/AM$/, 'am').replace(/PM$/, 'pm')
}

/* ── the sentence ───────────────────────────────────────────────────────── */

/**
 * One event as a plain sentence.
 *
 * Exhaustive over the closed kind set. The fallback exists because TypeScript
 * cannot see that the set is closed at the database boundary, not because a new
 * member is expected — adding one is a schema change plus a migration.
 */
function sentenceFor(event: TimelineEvent): string {
  const where = placeOf(event)

  switch (event.kind) {
    case 'visited':
      return `Opened ${where}.`

    case 'returnedTo':
      return `Came back to ${where}.`

    case 'queried': {
      const term = text(event.attested, 'term')
      return term ? `Searched for ${clip(term, 90)}.` : `Searched on ${where}.`
    }

    case 'engaged': {
      const dwell = num(event.attested, 'dwellMs')
      return dwell === null
        ? `Read ${where}.`
        : `Read ${where} for about ${minutesOf(dwell)}.`
    }

    case 'excerpted':
      return `Selected text on ${where}.`

    case 'switchedAway': {
      const cause = text(event.attested, 'cause')
      if (cause === 'idle') return 'Left the desk.'
      if (cause === 'lock') return 'Locked the screen.'
      if (cause === 'blur') return 'Switched to something else.'
      return 'Stepped away from the screen.'
    }

    case 'documentEdited': {
      const title = text(event.attested, 'title')
      return title ? `Wrote in ${clip(title, 72)}.` : 'Wrote in the document.'
    }

    case 'note': {
      const written = text(event.attested, 'text')
      return written ? `Wrote a note: “${clip(written, 160)}”` : 'Wrote a note.'
    }

    case 'sourceApproved': {
      const label = text(event.attested, 'label') ?? event.sourceLabel
      return label
        ? `Approved ${label} — Propositum can see it from here on.`
        : `Approved ${where} — Propositum can see it from here on.`
    }

    default:
      return 'Something was recorded here that I have no words for yet.'
  }
}

/** A mark in the margin. Meaningful, never the only carrier of the meaning. */
function markFor(kind: string): ReactNode {
  switch (kind) {
    case 'switchedAway':
      return <Away size={15} title="Away" />
    case 'documentEdited':
    case 'note':
      return <Wrote size={15} title="Written" />
    case 'sourceApproved':
      return <Done size={15} title="Approved" />
    default:
      return <Watching size={15} title="Seen" />
  }
}

/**
 * The second clause, when there is one.
 *
 * Two things can land here: what the person actually selected, and the fact
 * that the page had text in it designed not to be read by a human. Neither is
 * an error, and neither is hidden.
 */
function detailFor(event: TimelineEvent): ReactNode | null {
  const parts: ReactNode[] = []

  if (event.kind === 'excerpted' && event.untrustedText) {
    parts.push(
      <span key="quote" className="tl-quote">
        “{clip(event.untrustedText, 220)}”
        {event.sourceLabel ? ` — ${event.sourceLabel}` : ''}
      </span>,
    )
  }

  if (event.adversarial) {
    parts.push(
      <span key="flag" className="tl-flag">
        {parts.length > 0 ? ' ' : ''}This page had hidden or disguised text in it. I stripped it out
        before reading, and nothing a page writes can tell me what to do.
      </span>,
    )
  }

  if (parts.length === 0) return null
  return <>{parts}</>
}

/* ── the gap ────────────────────────────────────────────────────────────── */

/**
 * Why Propositum stopped seeing things, in the person's words.
 *
 * A privacy pause, a dead service worker, a slept machine and a revoked
 * permission are one shape in the schema and four different sentences here,
 * because "downtime" tells a person nothing they can act on.
 */
const GAP_REASONS: Record<string, string> = {
  machine_slept: 'your Mac slept',
  service_worker_terminated: 'Chrome shut the extension down',
  transport_disconnected: 'the connection to Propositum dropped',
  permission_revoked: 'access to one of your approved sources was withdrawn',
}

function Gap({ event }: { readonly event: TimelineEvent }) {
  const startedElapsed = num(event.attested, 'startedAtElapsedMs')
  const endedElapsed = num(event.attested, 'endedAtElapsedMs')
  const endedAt = new Date(event.observedAtIso)

  const spanMs =
    startedElapsed !== null && endedElapsed !== null && endedElapsed >= startedElapsed
      ? endedElapsed - startedElapsed
      : null

  const startedAt = spanMs === null ? null : new Date(endedAt.getTime() - spanMs)
  const reason = GAP_REASONS[String(event.attested['reason'] ?? '')] ?? null

  const from = startedAt === null ? null : clock(startedAt.toISOString())
  const to = clock(event.observedAtIso)

  const when = from === null ? to : `${from} to ${to}`
  const sentence =
    from === null
      ? `I stopped seeing your work up to ${to}${reason ? ` (${reason})` : ''}.`
      : `I stopped seeing your work from ${from} to ${to}${reason ? ` (${reason})` : ''}.`

  return (
    <div className="tl-gap">
      <p className="tl-gap-when">
        <Unknown size={14} title="Not watching" />
        {when}
      </p>
      <p className="tl-gap-what">{sentence}</p>
      <p className="tl-gap-why">
        {spanMs === null ? '' : `That is about ${minutesOf(spanMs)}. `}
        Anything you did in that window is not in what I saw, so it will not be in what I read.
      </p>
    </div>
  )
}

/* ── the timeline ───────────────────────────────────────────────────────── */

/** How often a running session re-reads the server. Slow enough to be invisible
 *  on a local SQLite file, quick enough that a page you just opened appears
 *  while you are still looking at the screen. */
const POLL_MS = 6_000

export function Timeline({ events, live, approvedSourceCount }: TimelineProps) {
  const router = useRouter()

  // Events arrive from the extension over HTTP, so nothing in React knows they
  // landed. While a session is running the page re-reads itself; when the tab
  // is in the background it does not, because nobody is reading it.
  useEffect(() => {
    if (!live) return undefined

    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      router.refresh()
    }, POLL_MS)

    return () => clearInterval(timer)
  }, [live, router])

  if (events.length === 0) {
    return (
      <>
        <Styles />
        {live && approvedSourceCount === 0 ? (
          <Empty
            title="There is nothing I am allowed to watch."
            next="Approve a source above — a site like northwind.example.com. Until you do, I can see nothing, and this stays empty."
          />
        ) : live ? (
          <Empty
            title="Nothing yet."
            next="Open one of your approved sources in Chrome. What you read there shows up here as it happens — usually within a few seconds."
          />
        ) : (
          <Empty
            title="Nothing was recorded in this session."
            next="I only watch the sources you approve, and only between the moment you start a session and the moment you end it."
          />
        )}
      </>
    )
  }

  return (
    <>
      <Styles />

      <div>
        {events.map((event, index) => {
          if (event.kind === 'captureGap') return <Gap key={event.id} event={event} />

          const detail = detailFor(event)

          return (
            <LogEntry
              key={event.id}
              index={index}
              time={clock(event.observedAtIso)}
              mark={markFor(event.kind)}
              {...(detail === null ? {} : { detail })}
            >
              {sentenceFor(event)}
            </LogEntry>
          )
        })}
      </div>

      {live ? (
        <div className="tl-foot">
          <p>I am watching. New activity appears here on its own.</p>
          <Button onClick={() => router.refresh()}>Look again now</Button>
        </div>
      ) : null}
    </>
  )
}
