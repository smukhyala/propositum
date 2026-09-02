/**
 * The control channel: how an instruction reaches a browser it cannot call.
 *
 * ── Why request/response, and not a stream ───────────────────────────────
 *
 * The worker is a long-lived Node process. The extension is an MV3 service
 * worker that Chrome kills roughly every thirty seconds and that can only make
 * OUTBOUND `fetch`. Nothing in the app can call it. So the direction of every
 * connection is fixed by the platform, and the only question is what shape the
 * app's half takes.
 *
 * `EventSource` is not exposed in `ServiceWorkerGlobalScope`, so SSE would mean
 * hand-rolling a stream over `fetch` anyway — which is enough to make it a
 * losing trade on its own. The decisive objection is different, and it is about
 * what each shape can KNOW.
 *
 * When a service worker dies mid-stream, the server has already written bytes
 * it believes were delivered, and it gets no error for a long time: the socket
 * is held by an operating system that has not noticed either. So the server's
 * belief and the truth diverge silently, and the divergence is invisible for as
 * long as the TCP stack takes to care. **A stream makes delivery
 * unobservable.** Request/response makes delivery an ACKNOWLEDGED FACT: the
 * instruction is handed out inside one guarded UPDATE, and the report comes
 * back as its own request that either arrives or does not.
 *
 * For a channel that presses buttons in someone's authenticated session, "I
 * think it got there" is not an acceptable state. Every failure below has to
 * resolve to either *it certainly never ran* or *it may have run and we cannot
 * say* — and the second one has to be said out loud rather than rounded down to
 * the first.
 *
 * ── The failure table, which is the actual design ────────────────────────
 *
 * | Failure                                                  | Consequence |
 * |---|---|
 * | SW dies before the command is handed out                 | ≤30s extra latency; the row is still `queued`, and the next poll takes it |
 * | SW dies after `queued→delivered`, before the CDP call     | The worker's held response times out; outcome `failed / unverified`. **Never redelivered.** |
 * | SW dies after the CDP call, before `report`               | Same answer, and the action *happened*. We cannot say what it did — the honest `unverified` case |
 * | App restarts                                              | The worker retries `dispatch` for the same `intentId`, which is idempotent on the unique key |
 *
 * Rows two and three are the reason `not-delivered` and `not-reported` are
 * different codes. They are not two flavours of "it did not work": the first
 * says nothing happened in the person's browser, and the second says something
 * may have. Collapsing them would make the ledger claim knowledge it does not
 * have, on exactly the actions where that claim costs the most.
 *
 * **Durability comes from the row, not from the transport.** `ActionDispatch`
 * is the durable fact; the held-open response is a convenience that lets the
 * worker block. Handing a command out is a guarded UPDATE `queued → delivered`
 * that reports whether it won, so two pollers cannot both receive the same
 * command — and a dispatch is never redelivered once handed out, because for a
 * browser action "deliver twice" means "click twice".
 */

import { z } from 'zod'

import type { ActionKind } from '../domain/handoff/policy'
import { CURRENCY_CODES } from '../domain/handoff/policy'
import { fromOurExtension } from '../capture/transport'

/** Mirrors `x-propositum-capture`, and is deliberately a DIFFERENT string. The
 *  two paths are admitted by different functions against different envelopes;
 *  sharing the header would let a request that satisfies one be replayed at the
 *  other and fail somewhere less obvious than the door. */
export const CONTROL_HEADER = 'x-propositum-act'
export const REQUIRED_CONTENT_TYPE = 'application/json'

/**
 * How long the app holds a poll open before answering "nothing".
 *
 * Chosen BELOW Chrome's ~30 second MV3 idle window on purpose. The poll must
 * end because the SERVER timed it out, never because Chrome killed the worker
 * that was holding it: a poll that dies with the service worker is a delivery
 * whose fate nobody knows, and this whole file exists to not have any of those.
 *
 * Five seconds of headroom is not generous, and it is not meant to be. It
 * covers scheduling jitter on a busy machine, not a long GC pause — if Chrome
 * wins the race anyway, the row is still `queued` and the next poll takes it.
 * The cost of being early is one wasted round trip; the cost of being late is
 * an unattributable delivery.
 */
export const POLL_TIMEOUT_MS = 25_000

/**
 * How long the worker's held-open dispatch waits, per kind.
 *
 * These bound the CHANNEL, not the browser: they are how long we are willing to
 * hold a Node process's request open waiting for an answer, after which we
 * report what the row can prove. They are per-kind because the honest wait for
 * "read me this page's tree" and "load this URL and settle" differ by a factor
 * that matters — a single number would either strand fast actions or give up on
 * a navigation that was going to succeed.
 *
 * `navigate` is the long one because it includes the network. `type-text` and
 * `press-key` are the short ones because they are one synthesised input event
 * against a page that is already loaded; if that takes ten seconds, something is
 * wrong that waiting will not fix.
 */
export type DispatchableKind = Extract<
  ActionKind,
  | 'observe-page'
  | 'navigate'
  | 'click-element'
  | 'type-text'
  | 'press-key'
  | 'capture-screen'
  | 'complete-purchase'
>

export const DISPATCH_TIMEOUT_MS: Readonly<Record<DispatchableKind, number>> = {
  'observe-page': 15_000,
  navigate: 30_000,
  'click-element': 20_000,
  'type-text': 10_000,
  // Not in the table this was specified from, and it is the same mechanism as
  // typing — one synthesised input event against a loaded page — so it takes the
  // same number rather than a new opinion.
  'press-key': 10_000,
  'capture-screen': 15_000,
  // The same synthesised press as click-element, plus a network round trip the
  // page then makes — which click-element's checkouts also make, so the same
  // number rather than a new opinion (ADR-0024).
  'complete-purchase': 20_000,
}

/**
 * The floor and ceiling on a worker-supplied hold.
 *
 * The worker names its own `timeoutMs`, which is right — it knows what it
 * asked for — but a number arriving over HTTP decides how long THIS process
 * keeps a request open, and an unbounded one is a way to pin a server thread
 * with a typo. The ceiling is above every entry in the table above, so clamping
 * never shortens an honest wait.
 */
export const MIN_HOLD_MS = 1_000
export const MAX_HOLD_MS = 60_000

/**
 * Why an action produced no report. **Closed, and code-assigned — never prose.**
 *
 * These are counted and rendered, so they are identifiers. Prose here would mean
 * the report screen either pattern-matches on English or shows the person a
 * sentence a page could have influenced.
 */
export type ControlFailure =
  /** The service worker never took it. Nothing happened in the browser. */
  | 'not-delivered'
  /** It took it and we never heard back — the honest unknown. The action may
   *  have run. Nothing may say otherwise. */
  | 'not-reported'
  /** The tab closed, or the person detached. The hands are gone. */
  | 'control-lost'
  | 'stale-snapshot'
  /** Navigation or a redirect left the contract's approved sources. */
  | 'off-origin'
  /** A non-idempotent request was aborted. ~~pending confirmation~~ Corrected
   *  2026-09-01: there is no confirmation on this path and never was — the
   *  request is refused at the network, unconditionally without a landing
   *  permit and on any permit mismatch with one (ADR-0024). */
  | 'blocked-request'
  /** ADR-0024: the permit was armed, the request's parsed amount exceeded the
   *  ratified ceiling, and the request was refused at the network. The detail
   *  carries the attested facts; the loop turns them into a question. */
  | 'amount-over-ceiling'
  /** ADR-0024's predicted common case: the permit was armed and the request
   *  body yielded no single deterministic amount — two candidates, an unknown
   *  currency, a mismatched one, or an opaque body. Refused, never guessed:
   *  a model deciding what a charge costs is a model deciding whether it
   *  needs permission. */
  | 'amount-unparseable'
  /** The browser was still working when the wait ran out. Reported BY the
   *  extension about a CDP operation, not by the app about the channel — the
   *  channel's own two endings are `not-delivered` and `not-reported`, which
   *  say which side of the handover the silence fell on. */
  | 'timed-out'

/**
 * What the agent perceived. `tree` and `title` are PAGE-AUTHORED and every
 * accessible name in them is attacker-controlled on a hostile page; `url` is
 * browser-attested, which is a different kind of fact and the reason the two are
 * separate fields rather than one blob.
 */
export interface PageObservation {
  readonly snapshotId: string
  /** Browser-attested, cleaned. Chrome said this is where the tab is. */
  readonly url: string
  /** PAGE-AUTHORED. */
  readonly title: string
  /** PAGE-AUTHORED. Lines like: e12 button "Send message" */
  readonly tree: string
  /** Whether the capture was cut short of what the page actually held. A
   *  truncated tree that reads as complete is how an agent concludes a button
   *  does not exist. */
  readonly truncated: boolean
}

export interface ScreenCapture {
  readonly mediaType: 'image/png'
  readonly base64: string
}

/** What came back from the browser, in the worker's hands. */
export type BrowserReport =
  | {
      readonly ok: true
      readonly observation: PageObservation
      /** ADR-0024. Present iff the landing permit was consumed — see
       *  `chargeSchema`. Optional-absent, never null. */
      readonly charge?: AttestedCharge | undefined
    }
  | { readonly ok: true; readonly capture: ScreenCapture }
  | { readonly ok: false; readonly failure: ControlFailure; readonly detail: string }

/* ── the wire ──────────────────────────────────────────────────────────── */

/**
 * A transport ceiling on a page tree, and deliberately NOT the product promise.
 *
 * `SNAPSHOT_BUDGET_CHARS` is what Propositum promises to RETAIN, published in
 * `docs/SECURITY_AND_PRIVACY.md`, and it is enforced by whoever writes
 * `ActionEvidence`. This number is a different thing with a different job:
 * refusing a fifty-megabyte body at the door so one hostile page cannot decide
 * how much memory this process allocates. Naming them apart matters, because a
 * transport limit quietly standing in for a published promise is how the
 * promise stops being checked.
 */
export const MAX_TREE_CHARS = 200_000

/** A screenshot arrives base64'd inside JSON, so it costs ~4 bytes per 3. Ten
 *  megabytes of base64 is a generous full-page PNG and a cheap refusal. */
export const MAX_CAPTURE_BASE64_CHARS = 10_000_000

/**
 * The ceiling a route can apply BEFORE it reads the body.
 *
 * The per-field bounds above are checked by the schema, which runs after
 * `request.json()` has already allocated whatever arrived — so on their own they
 * bound what is STORED and not what is read into memory. A route that means the
 * paragraph above has to refuse on the declared length first, which is what this
 * constant is for. Comfortably above a maximal capture plus its envelope, so it
 * only ever catches something absurd.
 */
export const MAX_BODY_BYTES = 16 * 1024 * 1024

/**
 * A page title is page-authored and can be any length the page likes.
 *
 * Bounded here rather than only at the evidence door, because this value travels
 * to the worker whether or not it is ever stored, and "the field the schema
 * forgot" is how one hostile page decides how much of a model's context window
 * it gets to fill.
 */
export const MAX_TITLE_CHARS = 2_000
/** A URL Chrome attests to. Long enough for a real one with a real query, short
 *  enough that it cannot be a payload. */
export const MAX_URL_CHARS = 4_000

const dispatchableKind = z.enum([
  'observe-page',
  'navigate',
  'click-element',
  'type-text',
  'press-key',
  'capture-screen',
] as const)

/** `params` is carried opaquely on purpose. Deterministic code built it and the
 *  gate already authorised it; the channel's job is to move it unchanged, and a
 *  second per-kind validation here would be a second author for a shape that
 *  has one. */
const paramsSchema = z.record(z.string(), z.unknown())

export const dispatchRequestSchema = z.object({
  runId: z.string().min(1),
  intentId: z.string().min(1),
  kind: dispatchableKind,
  params: paramsSchema,
  timeoutMs: z.number().int().positive(),
})
export type DispatchRequest = z.infer<typeof dispatchRequestSchema>

export const pageObservationSchema = z.object({
  snapshotId: z.string().min(1).max(200),
  url: z.string().min(1).max(MAX_URL_CHARS),
  title: z.string().max(MAX_TITLE_CHARS),
  tree: z.string().max(MAX_TREE_CHARS),
  truncated: z.boolean(),
})

export const screenCaptureSchema = z.object({
  mediaType: z.literal('image/png'),
  base64: z.string().min(1).max(MAX_CAPTURE_BASE64_CHARS),
})

export const controlFailureSchema = z.enum([
  'not-delivered',
  'not-reported',
  'control-lost',
  'stale-snapshot',
  'off-origin',
  'blocked-request',
  'amount-over-ceiling',
  'amount-unparseable',
  'timed-out',
] as const)

/**
 * What the extension sends back.
 *
 * A union rather than one object with three optional halves, so "reported
 * success and said nothing" cannot be expressed. The three arms are the three
 * things that can have happened, and a body that is none of them is malformed
 * at the door rather than half-handled in the route.
 */
/**
 * The attested charge, present on an ok report iff the landing permit was
 * consumed — a covered non-`GET` actually left the machine (ADR-0024). Every
 * field is read off the request Chrome was holding, never off page text and
 * never off a model. Its ABSENCE on a `complete-purchase` report is load-
 * bearing: the tool throws on a chargeless ok, so `succeeded` in the ledger
 * means "the charge left" and nothing weaker.
 */
export const chargeSchema = z.object({
  amountMinor: z.number().int().positive(),
  // Pinned to the domain's closed set at the wire too — the extension already
  // narrows, and a version skew that invented a currency should refuse at the
  // door rather than reach the ledger.
  currency: z.enum(CURRENCY_CODES),
  origin: z.string().min(1),
})
export type AttestedCharge = z.infer<typeof chargeSchema>

export const reportRequestSchema = z.union([
  z.object({
    intentId: z.string().min(1),
    ok: z.literal(true),
    observation: pageObservationSchema,
    charge: chargeSchema.optional(),
  }),
  z.object({ intentId: z.string().min(1), ok: z.literal(true), capture: screenCaptureSchema }),
  z.object({
    intentId: z.string().min(1),
    ok: z.literal(false),
    failure: controlFailureSchema,
    detail: z.string().max(500),
  }),
])
export type ReportRequest = z.infer<typeof reportRequestSchema>

/**
 * The dispatch answer, parsed by the worker rather than trusted.
 *
 * The app is ours, so this is not a trust boundary in the ADR-0006 sense. It is
 * a VERSION boundary: a worker and an app that disagree about the shape of a
 * report is an ordinary consequence of restarting one and not the other during
 * development, and the failure that produces — `observation` arriving undefined
 * and being read three functions later — is far harder to place than a refusal
 * at the door.
 */
export const browserReportSchema = z.union([
  z.object({
    ok: z.literal(true),
    observation: pageObservationSchema,
    charge: chargeSchema.optional(),
  }),
  z.object({ ok: z.literal(true), capture: screenCaptureSchema }),
  z.object({ ok: z.literal(false), failure: controlFailureSchema, detail: z.string() }),
])

export const dispatchResponseSchema = z.union([
  z.object({ ok: z.literal(true), report: browserReportSchema }),
  z.object({ ok: z.literal(false), failure: controlFailureSchema, detail: z.string() }),
])

export const haltRequestSchema = z.object({
  runId: z.string().min(1),
  /** Extension-authored, and it never reaches a prompt or a person's report as
   *  prose — it is folded into a `control-lost` detail string for a log. */
  reason: z.string().max(200),
})
export type HaltRequest = z.infer<typeof haltRequestSchema>

/**
 * One instruction, as the extension receives it.
 *
 * ── Why the run id travels OUTBOUND, having been refused inbound ─────────
 *
 * `/api/act/next` argues at length that there is no run id in the REQUEST, on
 * purpose: the extension drives one tab, does not know which run is talking to
 * it, and giving a component that shares a process with every page in the
 * browser one more thing worth stealing buys nothing. That argument is about
 * what the extension has to KNOW to be answered, and it still holds.
 *
 * It does not settle what the extension needs to STOP. `POST /api/act/halt`
 * takes a run id, and stopping is the thing that must work when everything else
 * does not, so it cannot be looked up at the moment it is needed — the app is
 * exactly what may be unreachable then. `service-worker.js` was written for
 * this and reads `command.runId` when it opens the controlled tab, storing it
 * beside `controlledTabId` for the life of the attachment.
 *
 * **This field did not exist, and the consequence was a Stop that stopped
 * nothing.** `runId` resolved to `null`, `haltRequestSchema` requires a non-empty
 * string, so the halt was refused 403 before `runs.requestCancel` — and the
 * extension never noticed, because `postHalt` ends in a `.catch(() => {})`. The
 * person pressed Stop, the chip reported success, the tab detached, and the run
 * carried on and opened a fresh controlled tab on its next `navigate`. It cost
 * nothing while no run drove a browser, which is exactly why it went unseen.
 *
 * It is an identifier and not a credential: the control token is what the
 * dispatch door checks, and this only names which run a halt is about.
 */
export interface DispatchedCommand {
  readonly runId: string
  readonly intentId: string
  readonly kind: DispatchableKind
  readonly params: Record<string, unknown>
}

/** Turn a stored report body into the shape the worker blocks on. */
export function reportOf(body: ReportRequest): BrowserReport {
  if (body.ok === false) return { ok: false, failure: body.failure, detail: body.detail }
  if ('observation' in body) {
    return {
      ok: true,
      observation: body.observation,
      ...(body.charge === undefined ? {} : { charge: body.charge }),
    }
  }
  return { ok: true, capture: body.capture }
}

/* ── the four controls, again, for a different envelope ────────────────── */

/**
 * Why this is `admitControl()` and not a wider `admit()`.
 *
 * `src/capture/transport.ts` already applies four controls to an inbound
 * request, and the temptation to reuse it is strong because three of the four
 * are letter-for-letter the same argument. It is refused because the ENVELOPES
 * differ: capture carries `{ token, sessionId, events }` and is authenticated by
 * a per-session token the extension holds; this path carries three different
 * bodies and, on the worker's half, is authenticated by a per-RUN token the
 * extension deliberately never sees.
 *
 * One function serving both would have to accept a body it cannot fully check
 * and a credential that is sometimes absent — and "sometimes absent" is exactly
 * how a check gets relaxed for the wrong caller. Two functions, each total over
 * its own envelope, cost forty lines and cannot drift into each other.
 *
 * `fromOurExtension` IS shared, and that is not the same compromise: it is a
 * pure predicate about what Chrome puts on a request, with no envelope in it at
 * all. Two answers to that one question would be the drift, not the reuse.
 *
 * ── Two callers, two different proofs ────────────────────────────────────
 *
 * The worker is a Node process. It has no browser-attested origin — Node's
 * `fetch` sends neither `Origin` nor `Sec-Fetch-Site` — so demanding one would
 * refuse the only legitimate caller. What it has instead is `controlToken`, the
 * run's own secret, minted when the run is claimed and cleared when it ends.
 *
 * The extension is the reverse: it has Chrome's attestation and it must NOT have
 * the run token. The extension shares a process boundary with every page in the
 * browser, and a run credential parked there is a credential one extension bug
 * away from a page that can drive someone's session. So each half proves what it
 * is actually able to prove, and neither is handed the other's secret to make
 * the code shorter.
 *
 * ── What the extension half does NOT prove, said plainly ─────────────────
 *
 * The extension half carries THREE controls, not four. There is no shared
 * secret on it at all, so it authenticates a CLASS of caller — "not a web page"
 * — and never an identity.
 *
 * Against a hostile page the three hold, and hold well: the custom header forces
 * a preflight this app never satisfies, and `Sec-Fetch-Site` is a forbidden
 * header name no script can set or suppress. Against a LOCAL PROCESS they do
 * not. `curl` can send `sec-fetch-site: none`, and a local process that does can
 * take a queued command out of the queue — flipping the row to `delivered`, so
 * the worker is told `not-reported`, which means *it may have run* about
 * something that never ran — or post a fabricated `PageObservation` whose `url`
 * the worker treats as browser-attested.
 *
 * The capture transport closes this with a per-session bearer token and argues
 * the local-process case away on the grounds that such a process could read the
 * SQLite file directly and has no need of the route. **That argument is weaker
 * here**, because this route does not leak data — it MISDIRECTS an agent that is
 * about to act. A local process that can lie to the worker is a local process
 * that can choose what the worker clicks next.
 *
 * It is left as it is because the wire protocol is pinned on both sides of this
 * boundary and a credential is a change to both halves; it is written down here,
 * at length, so that it is a known cost rather than something someone finds. The
 * fix, when it comes, is a per-attachment token issued when the tab is opened —
 * the same lifetime as the debugger attachment itself, which is also the only
 * window in which any of this is reachable.
 */
export type ControlCaller =
  | { readonly from: 'worker'; readonly controlToken: string | null }
  | { readonly from: 'extension'; readonly expectedOrigin: string }

export type ControlRejection =
  'bad-content-type' | 'missing-custom-header' | 'bad-origin' | 'bad-token' | 'malformed-envelope'

export type ControlAdmission<T> =
  | { readonly ok: true; readonly body: T }
  | { readonly ok: false; readonly reason: ControlRejection }

export interface ControlRequest {
  readonly headers: Readonly<Record<string, string | undefined>>
  readonly body: unknown
}

/**
 * What kind of body this route expects.
 *
 * `none` exists for the long poll, which is a GET and therefore carries no
 * content type at all — demanding one would refuse every legitimate poll. The
 * control that matters for a bodyless GET is the custom header, and it still
 * applies: a non-safelisted header forces a CORS preflight that this app never
 * satisfies, so a hostile page cannot reach the poll to steal a command out of
 * the queue. It would never see the response, but a page that can make the app
 * mark a command `delivered` has taken the command away from the extension,
 * which is damage without needing to read anything.
 */
export type ControlBody<T> =
  { readonly kind: 'json'; readonly schema: z.ZodType<T> } | { readonly kind: 'none' }

export function admitControl<T>(
  request: ControlRequest,
  caller: ControlCaller,
  body: { readonly kind: 'json'; readonly schema: z.ZodType<T> },
): ControlAdmission<T>
export function admitControl(
  request: ControlRequest,
  caller: ControlCaller,
  body: { readonly kind: 'none' },
): ControlAdmission<null>
export function admitControl<T>(
  request: ControlRequest,
  caller: ControlCaller,
  body: ControlBody<T>,
): ControlAdmission<T | null> {
  const header = (name: string) => request.headers[name] ?? request.headers[name.toLowerCase()]

  if (body.kind === 'json') {
    const contentType = header('content-type') ?? ''
    if (!contentType.startsWith(REQUIRED_CONTENT_TYPE)) {
      // The same line that carries the most weight in the capture transport, for
      // the same reason: `text/plain` is CORS-safelisted, so a forged POST from
      // a page would be delivered and executed rather than preflighted away.
      return { ok: false, reason: 'bad-content-type' }
    }
  }

  if (header(CONTROL_HEADER) !== '1') return { ok: false, reason: 'missing-custom-header' }

  if (caller.from === 'extension') {
    if (!fromOurExtension(header, caller.expectedOrigin)) return { ok: false, reason: 'bad-origin' }
  } else {
    const bearer = bearerOf(header('authorization'))
    // An absent expected token means the run holds no credential — it was never
    // issued one, or it has ended and the credential was cleared. Comparing
    // against it would let an empty bearer match an empty secret, so the absence
    // is refused before any comparison happens.
    if (caller.controlToken === null || caller.controlToken === '') {
      return { ok: false, reason: 'bad-token' }
    }
    if (bearer === null || !timingSafeEqual(bearer, caller.controlToken)) {
      return { ok: false, reason: 'bad-token' }
    }
  }

  if (body.kind === 'none') return { ok: true, body: null }

  const parsed = body.schema.safeParse(request.body)
  if (!parsed.success) return { ok: false, reason: 'malformed-envelope' }

  return { ok: true, body: parsed.data }
}

function bearerOf(value: string | undefined): string | null {
  if (value === undefined) return null
  const match = /^Bearer\s+(.+)$/i.exec(value.trim())
  return match?.[1] ?? null
}

/** Constant-time-ish comparison. A local copy rather than an import, because
 *  the capture transport keeps its own private and neither file should acquire
 *  a dependency on the other's internals to save six lines. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
