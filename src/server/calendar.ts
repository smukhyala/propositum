/**
 * Reading one number out of Google Calendar, and paying for it honestly.
 *
 * ── What this is, in one paragraph ───────────────────────────────────────
 *
 * `detectPause` can tell that somebody left; it cannot tell how long they will
 * be gone. Budget is the one autonomy dial denominated in time. Google's
 * free/busy answers exactly that question and nothing else, so this file
 * connects a calendar, asks `freebusy.query` for a bounded window forward from
 * now, and turns the answer into a number of minutes that a person may then
 * ratify on the handoff screen. It authorises nothing, it decides nothing, and
 * with no calendar connected the product behaves exactly as it did before it
 * existed.
 *
 * ── The reversal, before anything that makes it sound affordable ─────────
 *
 * `docs/SECURITY_AND_PRIVACY.md`: *"**Everything is local.** SQLite on your
 * machine. No account, no cloud, no sync, no server."*
 * `docs/VISION.md`: *"Everything is local. There is no cloud, no telemetry, and
 * no account."*
 *
 * An OAuth refresh token is an account, and it is a second long-lived
 * credential. Until this file existed the only secret was `ANTHROPIC_API_KEY`
 * and the only egress was prompts to Anthropic. This doubles both: a second
 * host, a second credential, a second failure mode that has to be surfaced
 * somewhere, and a second party who now knows that this machine asked about
 * this person's calendar at 4:14 on a Tuesday. Nothing below reduces that; the
 * scope reduces what is *learned*, not what is *spent*. ADR-0014 is where the
 * cost is argued at full size, and it opens on the cost.
 *
 * ── The scope, and the two that were refused ─────────────────────────────
 *
 * `https://www.googleapis.com/auth/calendar.freebusy` — this exact string, and
 * no other. Google describes it as *"View your availability in your
 * calendars."* [`freebusy.query`](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
 * returns only `calendars.(key).busy[]`, each entry a bare `start`/`end` —
 * *"List of time ranges during which this calendar should be regarded as
 * busy."* No titles, no attendees, no descriptions, no organiser, no
 * conference links.
 *
 * `calendar.readonly` (*"See and download any calendar you can access"*) and
 * `calendar.events.readonly` (*"View events on all your calendars"*) are
 * **forbidden here**, and they were considered rather than overlooked. The full
 * Event resource carries `eventType`, whose values include `focusTime` and
 * `outOfOffice` — a person declaring their own intent in a structured field,
 * which is better evidence than anything this product infers from browsing.
 * It is not worth every event title on every calendar, and the refusal is
 * asserted rather than intended: `tests/calendar-scope.test.ts` fails if either
 * string appears anywhere under `src/`.
 *
 * Calendar is not on Google's restricted-scope list — verified by absence
 * against [the canonical list](https://support.google.com/cloud/answer/13464325),
 * which covers Gmail, Drive, Fit, Chat, Data Portability, Photos Ambient and
 * Health and does not mention Calendar — so no annual CASA security assessment.
 * That is the one thing this feature is cheap in, and it is cheap in nothing
 * else.
 *
 * ── No model, anywhere on this path ──────────────────────────────────────
 *
 * Nothing here builds a prompt, imports a boundary, or calls a client. The
 * arithmetic is in `src/domain/handoff/calendar-window.ts` and it is
 * arithmetic. A model asked to interpret a calendar would be a model deciding
 * how long the person is away, which is a model deciding a budget.
 *
 * ── How it degrades, which is the property everything else rests on ──────
 *
 * Six failures, one behaviour: **the suggestion is absent and the screen says
 * nothing.** No client id configured, no connection, a rejected token, a
 * network error, a malformed body, an empty `busy[]` — every one returns null
 * from `suggestedTimeLimit`, and the agreement screen renders exactly what it
 * rendered before ADR-0014. A person who never connects a calendar must not be
 * able to tell this shipped, and `tests/calendar-freebusy.test.ts` pins each of
 * the six.
 *
 * The one exception is deliberate and is not on that screen: a REJECTED refresh
 * token is the single failure a person can fix, so it is reported — on the
 * front door, which is a screen somebody chose to open, and never at the
 * handoff, which is a screen somebody is trying to leave from. Putting it where
 * the suggestion would have been would interrupt the one moment this feature
 * exists to smooth, to say something about a feature they may have forgotten
 * they turned on. `calendarRow()` is that, and it is the only thing here that
 * ever produces a sentence.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { TIME_LIMIT_CHOICES } from '../domain/handoff/policy'
import { freeWindowUntilBusy, suggestTimeLimit } from '../domain/handoff/calendar-window'
import type { BusyInterval, FreeWindow } from '../domain/handoff/calendar-window'
import { appContext } from './db'
import type { CalendarConnectionRepository } from '../persistence/repositories/index'

/* ══════════════════════════════════════════════════════════ the constants ══ */

/**
 * The scope. This exact string, and no other.
 *
 * Declared once, used at the one place an authorisation URL is built and at the
 * one place a stored grant is checked. A second literal anywhere is how a
 * widened scope arrives without a diff that looks like a widened scope.
 */
export const CALENDAR_FREEBUSY_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy'

/** Google's own endpoints, from the installed-app OAuth documentation. */
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const FREEBUSY_ENDPOINT = 'https://www.googleapis.com/calendar/v3/freeBusy'

/** One member today. A second is a schema change, not a row somebody inserts. */
export const GOOGLE = 'google'

/**
 * How far forward the query looks, and therefore the ceiling on any suggestion.
 *
 * Eight hours. Two reasons, and the second is the one that sets the number:
 *
 *  - The longest limit the dial offers is four hours, so anything past eight is
 *    arithmetic nobody can act on.
 *  - **It is a retention decision as much as a query parameter.** Every hour of
 *    horizon is another hour of somebody's diary crossing the wire. The window
 *    is the smallest one that can answer the question, on the same instinct
 *    that put a 30-minute window and a 500-row cap on the ambient buffer.
 */
export const FREEBUSY_HORIZON_MS = 8 * 60 * 60_000

/**
 * How long a half-finished authorisation stays valid.
 *
 * Google's consent screen, a sign-in, and possibly a two-factor prompt. Ten
 * minutes is generous for that and short enough that an abandoned attempt does
 * not sit in memory all afternoon.
 */
const PENDING_TTL_MS = 10 * 60_000

/* ══════════════════════════════════════════ the app's own credentials ══ */

/**
 * The client id and secret, from the environment, beside `ANTHROPIC_API_KEY`.
 *
 * ── Why these are configuration and the refresh token is data ────────────
 *
 * These identify **the application**. They are the same for every copy of
 * Propositum built from this source, they are set once by whoever installed it,
 * and they say nothing about any person. `.env` is exactly where the app's own
 * credentials live and `ANTHROPIC_API_KEY` is already there.
 *
 * A refresh token identifies **the person**. It exists because they clicked
 * something, it is revocable by them, and it must vanish when they disconnect.
 * That is data, and data lives in their database. Putting it in `.env` would
 * mean a per-person secret in a file people hand-edit and occasionally paste
 * into an issue, with no path for the product to delete it when asked.
 *
 * ── Absent means ABSENT, not broken ─────────────────────────────────────
 *
 * With no `GOOGLE_OAUTH_CLIENT_ID`, every function here returns the
 * `not-configured` shape without touching the database or the network, and no
 * screen renders anything at all. That is the default state of this repository
 * and it is the state the whole test suite runs in.
 */
export interface GoogleOAuthConfig {
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
}

export function googleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = process.env['GOOGLE_OAUTH_CLIENT_ID']
  if (!clientId) return null

  // Google's desktop-app flow permits a loopback redirect and the secret is
  // documented as optional for installed clients. It is sent when present and
  // omitted when not, rather than being required into existence here.
  const clientSecret = process.env['GOOGLE_OAUTH_CLIENT_SECRET'] ?? ''

  // `http://127.0.0.1:port`, which is the literal form Google's own loopback
  // documentation gives. Not `localhost` by default: the two are not
  // interchangeable in Google's redirect matching, and the one in the docs is
  // the one that is registered without argument.
  const base = process.env['PROPOSITUM_BASE_URL'] ?? 'http://127.0.0.1:3117'

  return { clientId, clientSecret, redirectUri: `${base}/api/calendar/callback` }
}

/* ══════════════════════════════════════════════════════ the moving parts ══ */

/**
 * Everything this file touches that is not itself.
 *
 * Passed rather than reached for, so the whole path can be exercised against a
 * stub `fetch` and a real database without a network, and so a test can hold a
 * distinctive refresh token and prove it appears in nothing. The wrappers at
 * the bottom of this file are the only things that resolve the real ones.
 */
export interface CalendarDeps {
  readonly connections: CalendarConnectionRepository
  readonly fetcher: typeof globalThis.fetch
  readonly config: GoogleOAuthConfig
}

async function realDeps(): Promise<CalendarDeps | null> {
  const config = googleOAuthConfig()
  if (config === null) return null

  const { repos } = await appContext()
  return { connections: repos.calendar, fetcher: globalThis.fetch, config }
}

/* ══════════════════════════════════════════════════════════════ connect ══ */

/**
 * A half-finished authorisation, held in memory for ten minutes.
 *
 * ── Why not a cookie ────────────────────────────────────────────────────
 *
 * The PKCE `code_verifier` is a secret for the length of the round trip, and a
 * cookie is a copy of it handed to a browser on the promise that the browser
 * hands it back. Keeping it in the process means it never leaves the process —
 * which is the same instinct that keeps the ambient buffer out of SQLite, one
 * layer down. It also means an abandoned attempt disappears when the app
 * restarts, with nothing to clean up and nothing to expire on disk.
 *
 * The cost, stated: one authorisation at a time, and a dev-server hot reload
 * loses a flow in progress. Both are correct for a local, single-person tool
 * and neither would be correct for anything else.
 */
interface PendingAuthorisation {
  readonly state: string
  readonly verifier: string
  readonly expiresAtMs: number
}

let pending: PendingAuthorisation | null = null

/** Base64url with no padding, which is what PKCE and `state` both want. */
function base64url(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * The URL to send somebody to, or null when the feature is not configured.
 *
 * Follows Google's installed-app flow rather than improvising it: `response_type
 * =code`, PKCE with `S256`, a `state` for CSRF, and `access_type=offline` with
 * `prompt=consent` so a refresh token actually comes back rather than only on
 * the first ever grant.
 *
 * `code_verifier` is 32 random bytes base64url-encoded — 43 characters, which
 * is exactly Google's stated minimum, from the unreserved character set their
 * documentation names.
 */
export function beginCalendarConnection(nowMs: number): string | null {
  const config = googleOAuthConfig()
  if (config === null) return null

  const verifier = base64url(randomBytes(32))
  const state = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())

  pending = { state, verifier, expiresAtMs: nowMs + PENDING_TTL_MS }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: CALENDAR_FREEBUSY_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  })

  return `${AUTH_ENDPOINT}?${params.toString()}`
}

/** Why a connection attempt ended the way it did. Consumer copy lives at the
 *  call site; these are for the code to branch on. */
export type ConnectionResult =
  | { readonly kind: 'connected' }
  | { readonly kind: 'not-configured' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'wrong-scope'; readonly granted: string }
  | { readonly kind: 'unavailable' }

/**
 * Finish the flow: check the state, swap the code, store the refresh token.
 *
 * ── The scope check is not decoration ───────────────────────────────────
 *
 * Google returns the scopes actually granted, and a person can arrive here
 * having granted something other than what was asked — a hand-edited URL, an
 * older build's link left open in a tab, a future Google behaviour nobody has
 * seen. A grant that is not exactly `calendar.freebusy` is REFUSED and nothing
 * is stored, rather than stored and narrowed by convention. The grep guard
 * proves this source never *asks* for more; only this proves nothing wider is
 * ever *held*.
 */
export async function completeCalendarConnection(
  input: { code: string; state: string },
  nowMs: number,
): Promise<ConnectionResult> {
  const deps = await realDeps()
  if (deps === null) return { kind: 'not-configured' }

  const attempt = pending
  pending = null

  if (attempt === null || attempt.expiresAtMs <= nowMs) return { kind: 'expired' }
  if (!constantTimeEquals(attempt.state, input.state)) return { kind: 'refused' }

  const body = new URLSearchParams({
    client_id: deps.config.clientId,
    code: input.code,
    code_verifier: attempt.verifier,
    grant_type: 'authorization_code',
    redirect_uri: deps.config.redirectUri,
  })
  if (deps.config.clientSecret) body.set('client_secret', deps.config.clientSecret)

  const exchanged = await postForm(deps, TOKEN_ENDPOINT, body)
  if (exchanged.kind !== 'ok') return { kind: 'unavailable' }

  const payload = exchanged.body as {
    refresh_token?: unknown
    scope?: unknown
  }

  const refreshToken = typeof payload.refresh_token === 'string' ? payload.refresh_token : ''
  const granted = typeof payload.scope === 'string' ? payload.scope.trim() : ''

  if (refreshToken === '') return { kind: 'unavailable' }
  if (granted !== CALENDAR_FREEBUSY_SCOPE) return { kind: 'wrong-scope', granted }

  await deps.connections.save({ provider: GOOGLE, scope: granted, refreshToken })
  return { kind: 'connected' }
}

/**
 * Disconnect: tell Google, then delete the row.
 *
 * The revocation is best-effort and the deletion is not. If Google is
 * unreachable the credential still goes from this machine, because a person who
 * pressed Disconnect and was told "could not reach Google" while their token sat
 * in SQLite has been refused the one thing they asked for. The token is
 * revocable from Google's own account page either way; it is not deletable from
 * here by anybody but us.
 *
 * ── The deletion does not depend on the configuration. Fixed 2026-08-18 ──
 *
 * ~~Until 2026-08-18 this began `const deps = await realDeps(); if (deps ===
 * null) return`~~ — so blanking `GOOGLE_OAUTH_CLIENT_ID`, which `.env.example`
 * presents as the way to switch the feature OFF, returned before the delete and
 * left the person's refresh token in SQLite forever, with no row on the front
 * door admitting it was there. Off and orphaned are not the same state, and the
 * file that invites the first must not silently produce the second.
 *
 * So the two halves are split by what each actually needs. The DELETE needs a
 * database and nothing else. The REVOKE needs the client credentials, because
 * Google's revoke endpoint is called as the client — so with no config there is
 * simply no revocation to attempt, and the row goes anyway. That is the same
 * ordering the docblock above already argued for a dead network, one cause
 * further out.
 */
export async function disconnectCalendar(): Promise<void> {
  const { repos } = await appContext()
  await forgetConnection(repos.calendar, googleOAuthConfig(), globalThis.fetch)
}

/**
 * The half that can be tested: forget the connection, revoking first if we can.
 *
 * Takes its repository, its configuration and its fetcher rather than resolving
 * them, for the reason every other seam in this file does — the interesting
 * case is *no configuration and a stored token*, which cannot be reached
 * through `disconnectCalendar` in a test without an environment.
 *
 * `config === null` is not an error here and must never become one. It means
 * *nothing to revoke with*, and the row still goes.
 */
export async function forgetConnection(
  connections: CalendarConnectionRepository,
  config: GoogleOAuthConfig | null,
  fetcher: typeof globalThis.fetch,
): Promise<void> {
  if (config !== null) {
    // Best-effort on both counts: a repository that cannot produce the token
    // must not stop the delete either.
    const token = await connections.refreshTokenFor(GOOGLE).catch(() => null)
    if (token !== null) {
      await postForm(
        { connections, fetcher, config },
        REVOKE_ENDPOINT,
        new URLSearchParams({ token }),
      ).catch(() => undefined)
    }
  }

  await connections.forget(GOOGLE)
}

/* ═════════════════════════════════════════════════════════════════ read ══ */

/** What a free/busy read produced. Five of the six mean *say nothing*. */
export type CalendarRead =
  | { readonly kind: 'not-configured' }
  | { readonly kind: 'not-connected' }
  /** Google refused the refresh token itself. The one thing a person can fix. */
  | { readonly kind: 'reauthorise' }
  /** A timeout, a 5xx, a body that did not parse, a stored grant that is not
   *  the free/busy scope. Everything that is not the person's fault and not
   *  something they can act on. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'busy'; readonly intervals: readonly BusyInterval[] }

/**
 * Ask for the next `FREEBUSY_HORIZON_MS` of the person's own primary calendar.
 *
 * ── Nothing is cached and nothing is stored. Argued, not assumed ─────────
 *
 * The obvious move is a cache: the ambient buffer keeps thirty minutes of
 * observations in memory, so why not keep ten minutes of busy intervals? The
 * answer is that the buffer's bounds exist because it must ACCUMULATE — a
 * thread is made of pages seen at different times, so there is no way to answer
 * the question without holding a stretch of the past, and the window and the
 * row cap are the price of that. Free/busy accumulates nothing. One request
 * answers the whole question, at the one moment the question is asked, which is
 * when a handoff is being drafted — at most once per handoff.
 *
 * So the stronger position is available and is taken: **this is the same
 * person's data from a second source, and it is held for less time than the
 * first.** The intervals exist as a value in one request and are gone when it
 * returns. There is no table, no in-memory buffer, no TTL to reason about, and
 * no answer to *"how long does Propositum keep your calendar"* other than *it
 * does not*.
 *
 * The access token is not cached either, for the same reason one layer down: it
 * is minted from the refresh token, used once, and dropped. One extra HTTP
 * round trip per handoff draft, against a model call that already takes fifteen
 * seconds, buys a credential that never outlives the request that needed it.
 */
export async function readBusy(deps: CalendarDeps, nowMs: number): Promise<CalendarRead> {
  const status = await deps.connections.status(GOOGLE)
  if (status === null) return { kind: 'not-connected' }

  // A grant that is not exactly the free/busy scope is not used, even though it
  // would work. See `completeCalendarConnection` — this is the second half of
  // the same refusal, and it is the half that covers a row written by a build
  // that is not this one.
  if (status.scope !== CALENDAR_FREEBUSY_SCOPE) return { kind: 'unavailable' }

  const refreshToken = await deps.connections.refreshTokenFor(GOOGLE)
  if (refreshToken === null) return { kind: 'not-connected' }

  const refresh = new URLSearchParams({
    client_id: deps.config.clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
  if (deps.config.clientSecret) refresh.set('client_secret', deps.config.clientSecret)

  const minted = await postForm(deps, TOKEN_ENDPOINT, refresh)

  if (minted.kind === 'failed') {
    /**
     * `invalid_grant` is the ONE answer that means the credential is dead.
     *
     * Google returns it when the token has been revoked, expired through six
     * months of disuse, or had its grant withdrawn from the account's own
     * permissions page. Every other failure — a 500, a timeout, a proxy eating
     * the request — leaves `refreshRejectedAt` untouched, deliberately: a flaky
     * network that looked like a revoked grant would send somebody to
     * re-authorise something that was working, and they would learn to ignore
     * the notice.
     */
    if (minted.error === 'invalid_grant') {
      await deps.connections.markRefreshRejected(GOOGLE, new Date(nowMs))
      return { kind: 'reauthorise' }
    }
    return { kind: 'unavailable' }
  }
  if (minted.kind !== 'ok') return { kind: 'unavailable' }

  const accessToken = (minted.body as { access_token?: unknown }).access_token
  if (typeof accessToken !== 'string' || accessToken === '') return { kind: 'unavailable' }

  const queried = await postJson(
    deps,
    FREEBUSY_ENDPOINT,
    {
      timeMin: new Date(nowMs).toISOString(),
      timeMax: new Date(nowMs + FREEBUSY_HORIZON_MS).toISOString(),
      // `primary` is Google's own alias for the signed-in person's main
      // calendar. Nothing here enumerates calendars, and there is no scope
      // held that could — `calendar.calendarlist.readonly` is not asked for.
      items: [{ id: 'primary' }],
    },
    accessToken,
  )
  if (queried.kind !== 'ok') return { kind: 'unavailable' }

  return { kind: 'busy', intervals: intervalsFrom(queried.body) }
}

/**
 * The busy intervals in a `freebusy.query` response, or none.
 *
 * Written defensively on purpose. A malformed body is one of the six failures
 * that must degrade silently, and "degrade" means an empty list rather than a
 * throw — so every access is guarded and anything unparseable is dropped rather
 * than repaired. `Date.parse` returning `NaN` is a dropped interval, not a
 * zero-epoch one.
 *
 * Note what is deliberately NOT read: `kind`, `timeMin`, `timeMax`, `groups`,
 * and `calendars.(key).errors[]`. The errors array is real and would tell us
 * *why* a calendar could not be read; it is not consulted because every reason
 * produces the same behaviour — say nothing — and reading it would be the first
 * step toward a screen explaining somebody's calendar configuration to them.
 */
function intervalsFrom(body: unknown): BusyInterval[] {
  const calendars = (body as { calendars?: unknown } | null)?.calendars
  if (calendars === null || typeof calendars !== 'object') return []

  const out: BusyInterval[] = []

  for (const entry of Object.values(calendars as Record<string, unknown>)) {
    const busy = (entry as { busy?: unknown } | null)?.busy
    if (!Array.isArray(busy)) continue

    for (const span of busy) {
      const start = (span as { start?: unknown } | null)?.start
      const end = (span as { end?: unknown } | null)?.end
      if (typeof start !== 'string' || typeof end !== 'string') continue

      const startMs = Date.parse(start)
      const endMs = Date.parse(end)
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue

      out.push({ startMs, endMs })
    }
  }

  return out
}

/* ═══════════════════════════════════════════════════════ the suggestion ══ */

/**
 * What the screen is offered. Two numbers and no words.
 *
 * `minutes` is a member of `TIME_LIMIT_CHOICES` — see `suggestTimeLimit`, whose
 * range is the whole of why this is safe. `busyFromMs` is when the next busy
 * interval starts, so a screen can say a clock time instead of a duration. It
 * is not a title, because there is no title to have: the scope does not return
 * one and there is no field here that could carry one.
 */
export interface CalendarTimeSuggestion {
  readonly minutes: number
  readonly busyFromMs: number
}

/**
 * The whole feature, as one nullable number.
 *
 * **Null is the answer to every failure and to most successes.** Not
 * configured, not connected, token rejected, network down, body malformed,
 * `busy[]` empty, already in a meeting, next meeting sooner than fifteen
 * minutes — all null, and null means the agreement screen renders exactly what
 * it rendered before this file existed.
 *
 * Note the order of the first two checks: with no client id this returns
 * without touching the database, and with no connection it returns without
 * touching the network. The default state of a fresh checkout does neither.
 */
export async function suggestedTimeLimit(nowMs: number): Promise<CalendarTimeSuggestion | null> {
  const deps = await realDeps()
  if (deps === null) return null

  const read = await readBusy(deps, nowMs).catch(() => ({ kind: 'unavailable' }) as CalendarRead)
  return suggestionFrom(read, nowMs)
}

/**
 * The pure half, so the arithmetic can be tested without a database.
 *
 * Exported because `tests/calendar-freebusy.test.ts` walks every member of
 * `CalendarRead` through it, and because a reader looking for *"can a calendar
 * set a limit"* should find one function with one return type and no writes.
 */
export function suggestionFrom(read: CalendarRead, nowMs: number): CalendarTimeSuggestion | null {
  if (read.kind !== 'busy') return null

  const window: FreeWindow = freeWindowUntilBusy(read.intervals, nowMs, FREEBUSY_HORIZON_MS)
  const minutes = suggestTimeLimit(window, TIME_LIMIT_CHOICES)

  if (minutes === null || window.kind !== 'until') return null
  return { minutes, busyFromMs: window.startsAtMs }
}

/**
 * How the suggestion joins a drafted contract, and the identity that makes it
 * safe to have joined it.
 *
 * `withCalendarSuggestion(drafted, null)` returns an object with **exactly the
 * keys `drafted` had, in the order it had them**, so `JSON.stringify` of the
 * result is byte-identical to `JSON.stringify(drafted)`. That is not a nicety:
 * the hard requirement on this feature is that a person with no calendar
 * connected cannot tell it shipped, and the drafted contract is the artifact
 * that would betray it. `tests/calendar-freebusy.test.ts` compares the two
 * strings.
 *
 * One function owns this so there is one place to check. `draftContract` calls
 * it and does nothing else with the suggestion — in particular it does not read
 * `minutes`, does not compare it to the model's proposal, and does not pass it
 * to `createDraft`. The row is written BEFORE this runs, which is what makes
 * "the calendar cannot reach the database" a fact about the order of statements
 * rather than a promise.
 */
export function withCalendarSuggestion<T extends object>(
  drafted: T,
  suggestion: CalendarTimeSuggestion | null,
): T & { calendarSuggestion?: CalendarTimeSuggestion } {
  if (suggestion === null) return drafted
  return { ...drafted, calendarSuggestion: suggestion }
}

/* ══════════════════════════════════════════════════════════════ the row ══ */

/**
 * What the front door says about the calendar, if anything.
 *
 * ── Why the front door, and why never the handoff screen ─────────────────
 *
 * An expired refresh token is the one failure a person must eventually be told
 * about, because it is the one they can fix. It is also the one that is easiest
 * to report badly. Telling them at the handoff — where the suggestion would
 * have been — would interrupt the exact moment this feature exists to smooth,
 * with a sentence about a credential, to somebody who is trying to leave. The
 * screen would be worse than the screen that says nothing.
 *
 * The front door is a screen a person chose to open. `src/app/page.tsx` already
 * makes this argument for showing every detected strand there while sending
 * only the strongest to the extension's badge: *"this is a screen a person
 * chose to open, and more information on it interrupts nobody."* The same
 * reasoning, one feature over.
 *
 * ── Why `not-connected` renders anything at all ──────────────────────────
 *
 * It renders only when a client id IS configured, and configuring one is an
 * opt-in — somebody put two values in `.env`. An unconfigured checkout with no
 * stored connection produces null here and no markup anywhere, which is what a
 * fresh clone does and what the whole test suite runs as. So the connect line is
 * shown to people who have already said they want this and not yet finished, and
 * to nobody else.
 *
 * ── A STORED connection renders whether or not there is a client id ──────
 *
 * ~~Until 2026-08-18 this returned null whenever `GOOGLE_OAUTH_CLIENT_ID` was
 * blank, before reading the database at all.~~ That made the configuration the
 * gate on the row, and `.env.example` invites exactly the state where the two
 * disagree: blank the client id to switch the feature off, and the row
 * disappeared while the refresh token stayed in SQLite, with the Disconnect
 * button gone and no screen in the product admitting the credential existed.
 *
 * So the query happens first and the configuration only decides whether the
 * INVITATION is worth showing. The cost is one indexed read on the front door in
 * a checkout that will never use it; the thing bought is that a credential on
 * disk is never invisible, which is the promise `docs/SECURITY_AND_PRIVACY.md`
 * makes about this token by name.
 *
 * ── It cannot throw. This is the front door ──────────────────────────────
 *
 * The `try` is not defensive habit. Every other calendar entry point on a screen
 * already swallows its own failures — `suggestedTimeLimit` catches, and
 * `draftContract` catches again — and this one did not, so a `calendar_
 * connection` table that is missing (pulled this commit, has not run `prisma db
 * push`) or momentarily busy took down the ENTIRE entry screen with a 500. That
 * is the exact inversion ADR-0014's fifth prohibition forbids: a failure of the
 * optional feature must leave the product as it was, and no page at all is not
 * that. A calendar that cannot be read renders no row.
 */
export type CalendarRowState = 'not-connected' | 'connected' | 'reauthorise'

export interface CalendarRow {
  readonly state: CalendarRowState
  /**
   * Whether an authorisation can be STARTED from here — false with no client
   * id. It gates the link and nothing else: a row that exists is still a row a
   * person can delete, and a "Connect it again" link that cannot begin a flow
   * is a control that changes nothing.
   */
  readonly canReconnect: boolean
}

export async function calendarRow(): Promise<CalendarRow | null> {
  const canReconnect = googleOAuthConfig() !== null

  try {
    const { repos } = await appContext()
    return rowFor(await repos.calendar.status(GOOGLE), canReconnect)
  } catch {
    return null
  }
}

/**
 * The three states and the one absence, as a pure function over the stored row.
 *
 * Split out so the branching is testable without a database and without an
 * environment. Note the third line: a connection whose stored scope is not
 * exactly the free/busy string reads as *reconnect*, not as *connected*. It is
 * the same refusal `readBusy` makes — the feature has gone quiet, so the row
 * says the thing that would restore it rather than claiming everything is fine.
 *
 * Null means *draw nothing*, and it is now reachable one way only: no stored
 * connection AND no client id. A stored connection always renders, because it
 * is a credential and the person has to be able to see it to delete it.
 */
export function rowFor(
  status: { scope: string; refreshRejectedAt: Date | null } | null,
  canReconnect: boolean,
): CalendarRow | null {
  if (status === null) return canReconnect ? { state: 'not-connected', canReconnect } : null
  if (status.refreshRejectedAt !== null) return { state: 'reauthorise', canReconnect }
  if (status.scope !== CALENDAR_FREEBUSY_SCOPE) return { state: 'reauthorise', canReconnect }
  return { state: 'connected', canReconnect }
}

/* ═══════════════════════════════════════════════════════════════ the wire ══ */

/**
 * The result of one HTTP call to Google, with the failure classes separated.
 *
 * `failed` carries Google's own `error` code because exactly one value of it —
 * `invalid_grant` — has a different consequence from every other failure. It is
 * a short machine token from Google's OAuth error body, never rendered.
 */
type Wire =
  | { readonly kind: 'ok'; readonly body: unknown }
  | { readonly kind: 'failed'; readonly error: string }
  | { readonly kind: 'unreachable' }

/**
 * Four seconds, and nothing here retries.
 *
 * This sits between a person and a screen they are waiting for. A retry would
 * double the wait to improve the odds of a suggestion that is optional by
 * construction, which is the wrong trade — the whole design says the absence of
 * a suggestion costs nothing.
 */
const REQUEST_TIMEOUT_MS = 4_000

async function postForm(deps: CalendarDeps, url: string, body: URLSearchParams): Promise<Wire> {
  return post(deps, url, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

async function postJson(
  deps: CalendarDeps,
  url: string,
  body: unknown,
  accessToken: string,
): Promise<Wire> {
  return post(deps, url, {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  })
}

/**
 * One request, and every way it can go wrong turned into a value.
 *
 * ── Nothing here logs, and that is the point ────────────────────────────
 *
 * There is no `console` call in this file. A refresh token is a form field on
 * two of these requests, and the ordinary instinct on a failing HTTP call —
 * log the request, log the body, log the error — would write it to a terminal
 * and from there into a scrollback, a screenshot, or an issue. So the failure
 * classes are returned rather than reported, and the one that a person needs to
 * know about becomes a row in the database and a sentence on the front door,
 * with no token anywhere near either.
 *
 * A thrown `fetch` is `unreachable` rather than an exception: every caller of
 * this file is on a path whose contract is that it degrades, and an exception
 * escaping into `draftContract` would take the handoff down with it.
 */
async function post(
  deps: CalendarDeps,
  url: string,
  init: { headers: Record<string, string>; body: string },
): Promise<Wire> {
  let response: Response
  try {
    response = await deps.fetcher(url, {
      method: 'POST',
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    return { kind: 'unreachable' }
  }

  let parsed: unknown = null
  try {
    parsed = await response.json()
  } catch {
    parsed = null
  }

  if (!response.ok) {
    const error = (parsed as { error?: unknown } | null)?.error
    return { kind: 'failed', error: typeof error === 'string' ? error : 'unknown' }
  }
  if (parsed === null) return { kind: 'unreachable' }

  return { kind: 'ok', body: parsed }
}

/**
 * Compare the `state` parameter without leaking its length or contents by
 * timing. Overkill for a loopback redirect on one machine, and cheap.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
