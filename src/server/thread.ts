/**
 * What to say on a paired thread, and when. ADR-0021.
 *
 * ── Two feeds, and the reason there have to be two ────────────────────────
 *
 * *(~~Two~~ **Three, 2026-09-03** — `sayCaptureGap` below is called from the
 * gap watch's tick, in the app process again, because the silence it reports
 * is in `captureStore()` and the worker cannot see that either. The argument
 * is unchanged: a feed sits where its fact lives.)*
 *
 * A composed `WorkOffer` lives in an in-memory map in the **Next app process**
 * (`src/server/ambient-store.ts`, hung off `globalThis`), and ADR-0008 refuses
 * to give it a durable row: *"a durable row saying 'Propositum thought you were
 * job-hunting' about an offer NOBODY ACCEPTED is exactly the profile this buffer
 * refuses to become."* The worker process never imports it and cannot see one.
 *
 * Everything else worth saying — a run stopped to ask, a shift ended, a question
 * was raised — is a durable row the worker writes and can read back.
 *
 * So: `sayOffer` runs in the app process, on the extension's existing 30-second
 * poll. `sayWhatIsOutstanding` runs in the worker, on its existing tick. Neither
 * introduces a timer, and the split is a property of where the facts live rather
 * than a choice about architecture.
 *
 * ── Dedupe is a claim, not a check ────────────────────────────────────────
 *
 * `thread.claimSend` inserts against a UNIQUE index and reports whether it won.
 * Two feeds in two processes is exactly where a read-then-write leaves a gap,
 * and a message said twice on a lock screen is worse than one not said at all.
 *
 * ── What this file will not do ────────────────────────────────────────────
 *
 * It composes nothing. Every message comes from
 * `src/domain/conversation/messages.ts`, which is templates over durable rows,
 * and this file's whole job is deciding WHICH rows are worth a sentence. No
 * model is reached, no boundary is added, and `tests/boundaries.test.ts` stays
 * at eight.
 *
 * It also never answers a confirmation. `src/app/api/act/confirmation/route.ts`
 * is a read *"and that is the whole design"* — an inbound `yes` on a confirmation
 * message is `unrecognised` here, and the union in `reply.ts` has no shape it
 * could become.
 */

import type { AppContext } from './db'
import { TELEGRAM } from '@/domain/conversation/channel'
import {
  captureGapMessage,
  confirmationMessage,
  decisionMessage,
  offerMessage,
  runEndedMessage,
} from '@/domain/conversation/messages'
import type { RenderedMessage } from '@/domain/conversation/messages'
import { NOT_FOLLOWED, parseReply } from '@/domain/conversation/reply'
import { createTelegramTransport } from '@/runtime/thread-channel'
import type { ThreadTransport } from '@/runtime/thread-channel'
import { oldestPendingConfirmation } from './confirmations'

/**
 * Where a person is sent when a message needs a screen.
 *
 * Read the same way `execute-run.ts` reads it, and for the reason it gives:
 * *"two spellings of 'where Propositum is' is how one of them comes to be wrong
 * on the machine that changed its port."*
 */
export function baseUrl(): string {
  return process.env['PROPOSITUM_BASE_URL'] ?? 'http://127.0.0.1:3117'
}

/** How many recent notes the durable feed looks at. See `reports.recent`. */
export const RECENT_NOTES = 5

/**
 * The transport for the paired thread, or null when nothing is paired.
 *
 * Built per call rather than cached. It holds a credential, and a cached client
 * would keep one alive across an unpair — which is the one moment the product
 * has promised the token is gone.
 */
export async function transportFor(
  ctx: AppContext,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<ThreadTransport | null> {
  const botToken = await ctx.repos.thread.botTokenFor(TELEGRAM)
  if (botToken === null) return null
  const chatId = await ctx.repos.thread.chatIdFor(TELEGRAM)
  if (chatId === null) return null
  return createTelegramTransport({ botToken, chatId, fetcher })
}

/**
 * Send one message, if it has not been said.
 *
 * The claim happens first and is not rolled back on a failed send. That is the
 * deliberate direction and it is worth stating because it looks like a bug:
 * every message on this channel is *something happened, come and look*, and the
 * thing that happened is on a screen either way. Retrying until it lands would
 * eventually announce a shift somebody reviewed an hour ago.
 */
export async function sayOnce(
  ctx: AppContext,
  transport: ThreadTransport,
  message: RenderedMessage,
): Promise<boolean> {
  const won = await ctx.repos.thread.claimSend(TELEGRAM, message.key)
  if (!won) return false

  const sent = await transport.send(message)
  if (!sent.ok) return false

  if (sent.value !== null) {
    // How a reply finds its question. Only decisions are answerable, but the id
    // is recorded for every message: a person replying to the wrong one should
    // get "I didn't follow that", not an answer bound to whatever was newest.
    await ctx.repos.thread.noteProviderMessageId(message.key, sent.value)
  }
  return true
}

/* ── pairing ───────────────────────────────────────────────────────────── */

/**
 * A token pasted on the first-run page, held between the two halves of pairing.
 *
 * ── Why memory and not a row ─────────────────────────────────────────────
 *
 * `src/server/calendar.ts` holds its PKCE verifier and `state` in a
 * module-level variable with a TTL and says why: *"a cookie is a copy of it
 * handed to a browser on the promise that the browser hands it back."* Same
 * shape, same reason, and one more — a half-pairing is not a connection. Writing
 * the token to `ThreadConnection` before there is a chat to send to would put a
 * live credential on disk for a pairing somebody abandoned, and the row would
 * render as connected on every screen that reads it.
 *
 * Ten minutes, because that is how long the calendar gives the same shape of
 * thing and because the second half is *open Telegram and press Start*.
 */
const PAIRING_TTL_MS = 10 * 60_000

interface PendingPairing {
  readonly botToken: string
  readonly handle: string
  readonly startedAtMs: number
}

declare global {
  // eslint-disable-next-line no-var
  var __propositumPairing: PendingPairing | null | undefined
}

function pending(nowMs: number): PendingPairing | null {
  const held = globalThis.__propositumPairing ?? null
  if (held === null) return null
  if (nowMs - held.startedAtMs > PAIRING_TTL_MS) {
    globalThis.__propositumPairing = null
    return null
  }
  return held
}

export type PairingProblem = 'no-token' | 'refused' | 'expired' | 'nobody-said-anything'

export type BeginPairing =
  | { readonly ok: true; readonly handle: string }
  | { readonly ok: false; readonly problem: PairingProblem; readonly detail: string }

/**
 * Half one: check the token is real, and find out what the bot is called.
 *
 * The handle is the point. A person who has just made a bot has a token that
 * looks like every other token, and the only way to know they pasted the right
 * one is to be shown the name back — which is also the link they need for half
 * two. Nothing is stored yet.
 */
export async function beginPairing(
  botToken: string,
  nowMs: number = Date.now(),
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<BeginPairing> {
  const token = botToken.trim()
  if (token === '') return { ok: false, problem: 'no-token', detail: 'Paste the token first.' }

  // A chat id is not known yet, and `identify` does not use one. The empty
  // string is honest about that rather than a placeholder that could be sent to.
  const transport = createTelegramTransport({ botToken: token, chatId: '', fetcher })
  const who = await transport.identify()
  if (!who.ok) return { ok: false, problem: 'refused', detail: who.problem.detail }

  globalThis.__propositumPairing = {
    botToken: token,
    handle: who.value.handle,
    startedAtMs: nowMs,
  }
  return { ok: true, handle: who.value.handle }
}

/** The handle a person is being told to open, or null. */
export function pairingInFlight(nowMs: number = Date.now()): string | null {
  return pending(nowMs)?.handle ?? null
}

export type CompletePairing =
  | { readonly ok: true; readonly handle: string }
  | { readonly ok: false; readonly problem: PairingProblem; readonly detail: string }

/**
 * Half two: whoever pressed Start is the person this thread belongs to.
 *
 * ── What identifies them, said plainly ───────────────────────────────────
 *
 * The first chat to say anything to this bot. That is not a proof of identity
 * and the first-run page must not imply it is: it is a bot the person made
 * seconds ago and told nobody about, so the first person to message it is them.
 * If they hand the token around, the first stranger to press Start gets the
 * thread — which is a property of the token, not of this check, and the screen
 * says so.
 *
 * The stronger version needs an out-of-band code, and that is a different
 * product: the destination for this channel is a person texting a number, where
 * the number IS the identity, and building a code exchange for a transport we
 * intend to replace is work spent on the wrong half.
 */
export async function completePairing(
  ctx: AppContext,
  nowMs: number = Date.now(),
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<CompletePairing> {
  const held = pending(nowMs)
  if (held === null) {
    return { ok: false, problem: 'expired', detail: 'That took too long. Paste the token again.' }
  }

  const transport = createTelegramTransport({
    botToken: held.botToken,
    chatId: '',
    fetcher,
  })
  const found = await transport.firstChat()
  if (!found.ok) return { ok: false, problem: 'refused', detail: found.problem.detail }

  if (found.value === null) {
    return {
      ok: false,
      problem: 'nobody-said-anything',
      detail: 'Nothing has been said to it yet. Open the link and press Start.',
    }
  }

  await ctx.repos.thread.save({
    provider: TELEGRAM,
    botToken: held.botToken,
    chatId: found.value.chatId,
  })
  // The cursor starts past the Start message, so pairing does not immediately
  // answer "I didn't follow that" to the word somebody pressed a button to send.
  await ctx.repos.thread.markRead(TELEGRAM, found.value.updateId)
  globalThis.__propositumPairing = null

  return { ok: true, handle: held.handle }
}

/** Unpair. A real DELETE — the credential goes, not a flag. */
export async function unpair(ctx: AppContext): Promise<void> {
  globalThis.__propositumPairing = null
  await ctx.repos.thread.forget(TELEGRAM)
}

/* ── the app-process feed: offers ──────────────────────────────────────── */

export interface OfferFacts {
  readonly threadSignature: string
  readonly title: string
  readonly rationale: string
  readonly outline: readonly string[]
  readonly willNotDo: readonly string[]
}

/**
 * Say that Propositum has noticed something.
 *
 * Called `void`-ed from the poll route, beside the line that counts the offer
 * into ADR-0015's loudness tally — so the message and the counter fire on the
 * same gate by construction, rather than by somebody remembering. A channel that
 * speaks and is not counted is Principle 13's erosion with the smoke alarm
 * disconnected.
 *
 * Swallows everything. This runs on the extension's heartbeat; a paired thread
 * that cannot be reached must not turn a poll that answers *"nothing yet"* into
 * a 500.
 */
export async function sayOffer(ctx: AppContext, facts: OfferFacts): Promise<void> {
  try {
    const transport = await transportFor(ctx)
    if (transport === null) return

    await sayOnce(
      ctx,
      transport,
      offerMessage({
        threadSignature: facts.threadSignature,
        title: facts.title,
        rationale: facts.rationale,
        outline: facts.outline,
        willNotDo: facts.willNotDo,
        baseUrl: baseUrl(),
      }),
    )
  } catch {
    // See above. There is nothing useful to do here and nowhere useful to say it.
  }
}

/* ── the worker feed: everything durable ───────────────────────────────── */

/**
 * Everything outstanding, in the order a person would want it.
 *
 * A blocked run first: it is the only one where something is waiting rather than
 * finished, and `CONFIRMATION_EXPIRY_HOURS` is counting. Then the notes.
 *
 * Returns the messages rather than sending them, so a test can assert what would
 * be said without a network.
 */
export async function whatIsOutstanding(
  ctx: AppContext,
  nowMs: number,
): Promise<readonly RenderedMessage[]> {
  const out: RenderedMessage[] = []
  const base = baseUrl()

  const pending = await oldestPendingConfirmation(ctx, nowMs)
  if (pending !== null) {
    out.push(
      confirmationMessage({
        requestId: pending.requestId,
        contractId: pending.contractId,
        question: pending.summary,
        baseUrl: base,
      }),
    )
  }

  for (const note of await ctx.repos.reports.recent(RECENT_NOTES)) {
    const changeset = await ctx.repos.changesets.forContract(note.contractId)
    /**
     * Undecided changes, not all of them.
     *
     * "6 changes waiting on you" has to mean six things you have not decided.
     * Counting the settled ones would keep saying six after somebody accepted
     * five, which is the shape of every stale count this repository has had to
     * strike out of a document.
     */
    const waiting =
      changeset === null || changeset.settledAsVersionId !== null
        ? 0
        : changeset.changes.filter((change) => change.verdict === null).length

    out.push(
      runEndedMessage({
        contractId: note.contractId,
        // The narrative already carries a stop rule's consumer label when there
        // was one — `writeReport` puts it there. Quoted, never rebuilt.
        stopLabel: null,
        headline: note.narrative,
        changeCount: waiting,
        baseUrl: base,
      }),
    )

    for (const decision of note.decisions) {
      if (decision.answer !== null) continue
      out.push(
        decisionMessage({
          decisionId: decision.id,
          contractId: note.contractId,
          question: decision.question,
          whyStopped: decision.whyStopped,
          baseUrl: base,
        }),
      )
    }
  }

  return out
}

/**
 * Say whatever is outstanding. Called from the worker's tick.
 *
 * Every send is claimed, so the great majority of these calls send nothing and
 * cost one indexed insert that fails. That is the intended steady state.
 */
export async function sayWhatIsOutstanding(
  ctx: AppContext,
  nowMs: number,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<number> {
  const transport = await transportFor(ctx, fetcher)
  if (transport === null) return 0

  let said = 0
  for (const message of await whatIsOutstanding(ctx, nowMs)) {
    if (await sayOnce(ctx, transport, message)) said += 1
  }
  return said
}

/* ── the app-process feed, again: a gap while away ─────────────────────── */

/**
 * Say that Propositum stopped seeing the person's work, if they are away.
 *
 * Called from the gap watch's tick, in the app process, because the fact —
 * a silence in `captureStore()` — lives there and the worker cannot see it.
 * The tick knows a SESSION; the message needs the contract whose *"While you
 * were away"* screen the link opens. Deciding which rows are worth a sentence
 * is this file's job, so the derivation is here and not in the sweeper: the
 * session's phase is `away` from `markAway` at acceptance until a run ends
 * (`execute-run.ts`, `confirmations.ts`), and `acceptedForSession` is the
 * contract the shift runs under. Both are queries that already existed.
 *
 * ~~Kept separate because the caller that knows a gap happened is not the one
 * that knows a run ended.~~ **Still true, and struck 2026-09-03 because it was
 * the whole docblock on a function nothing called** — exported on 2026-08-26,
 * asserted in `tests/reachability.test.ts` as sent from this file, and reached
 * by nothing for eight days. Asserted as sent while unsendable is the exact
 * inversion that file's deferred block exists to prevent.
 *
 * Once per shift is `sayOnce`'s job: the key is `gap:<contractId>`, so a second
 * silence in the same shift is claimed and dropped. Swallows everything, the
 * way `sayOffer` does and for the same reason — this runs on a timer, and a
 * paired thread that cannot be reached must not turn housekeeping into an
 * unhandled rejection. Returns whether a message went, so a test can tell.
 *
 * ── What this does NOT cover ──────────────────────────────────────────────
 *
 * A gap outside a shift says nothing. While the session is `observing` the
 * person is at the machine and the timeline shows the gap; once a run has
 * ended the session is `observing` again even if the person has not come back,
 * and a gap then is on the re-entry screen rather than on the phone. A session
 * that has `ended` says nothing either. And the message carries no reason —
 * `machine_slept` and `service_worker_terminated` read the same on the phone,
 * because the sentence with the reason in it is the one on the screen it links.
 */
export async function sayCaptureGap(
  ctx: AppContext,
  sessionId: string,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<boolean> {
  try {
    const session = await ctx.repos.sessions.byId(sessionId)
    if (session === null || session.phase !== 'away') return false

    const contract = await ctx.repos.contracts.acceptedForSession(sessionId)
    if (contract === null) return false

    const transport = await transportFor(ctx, fetcher)
    if (transport === null) return false

    return await sayOnce(
      ctx,
      transport,
      captureGapMessage({ contractId: contract.id, baseUrl: baseUrl() }),
    )
  } catch {
    // See `sayOffer`. Nothing useful to do, and nowhere useful to say it.
    return false
  }
}

/* ── inbound ───────────────────────────────────────────────────────────── */

export interface ReplyOutcome {
  readonly read: number
  readonly answered: number
  readonly acceptedOffer: string | null
  readonly declinedOffer: string | null
}

/**
 * Read what a person said back, and write at most one row each.
 *
 * ── What this may write ───────────────────────────────────────────────────
 *
 * A `DecisionVerdict`, and nothing else. Not an `ObservationEvent` —
 * `sessionId` is required and `ledger-writer.ts` stays the single writer, so
 * there is no second writer here and no schema change that would need one. Not
 * a `ConfirmationVerdict`, ever: `reply.ts`'s union has no member one could
 * become, which is a stronger statement than a check.
 *
 * ── And what it does not reach ────────────────────────────────────────────
 *
 * No model. `SECURITY_AND_PRIVACY.md` names the trap — *"An email that arrives
 * at 3am is a model call at 3am unless something is designed first to prevent
 * it."* What prevents it is that a reply produces a row and stops. The next
 * model call is the one the worker was going to make anyway.
 *
 * ── Offers are reported, not acted on ─────────────────────────────────────
 *
 * `acceptedOffer` and `declinedOffer` come back to the caller rather than being
 * handled here, because accepting an offer needs the ambient buffer and the
 * buffer is in the other process. The caller in the app process does the work;
 * the worker's caller gets `null` and sends the person a link, which is the
 * honest answer from a process that cannot see the offer.
 */
export async function readReplies(
  ctx: AppContext,
  nowMs: number,
  options: {
    readonly offerOpen?: string | null
    /** Injected for the same reason `calendar.ts` injects one: it is the only
     *  way to assert that a secret appears in nothing. */
    readonly fetcher?: typeof globalThis.fetch
  } = {},
): Promise<ReplyOutcome> {
  const transport = await transportFor(ctx, options.fetcher ?? globalThis.fetch)
  if (transport === null) {
    return { read: 0, answered: 0, acceptedOffer: null, declinedOffer: null }
  }

  const status = await ctx.repos.thread.status(TELEGRAM)
  const polled = await transport.poll(status?.lastUpdateId ?? null)
  if (!polled.ok) return { read: 0, answered: 0, acceptedOffer: null, declinedOffer: null }

  const offerOpen = options.offerOpen ?? null
  let answered = 0
  let acceptedOffer: string | null = null
  let declinedOffer: string | null = null

  for (const inbound of polled.value.messages) {
    const repliedTo =
      inbound.repliedToProviderMessageId === null
        ? null
        : await ctx.repos.thread.keyForProviderMessageId(
            TELEGRAM,
            inbound.repliedToProviderMessageId,
          )

    const reply = parseReply(inbound.text, { repliedTo, offerOpen: offerOpen !== null })

    switch (reply.kind) {
      case 'answer-decision': {
        const decisionId = reply.repliedTo.slice('decision:'.length)
        const result = await ctx.repos.reports.answer({
          decisionNeededId: decisionId,
          answer: reply.answer,
          source: 'thread',
          at: new Date(nowMs),
        })
        if (result.ok) answered += 1
        break
      }
      case 'accept-offer':
        acceptedOffer = offerOpen
        break
      case 'decline-offer':
        declinedOffer = offerOpen
        break
      case 'unrecognised':
        /**
         * Said out loud rather than swallowed.
         *
         * A channel that silently drops what it cannot parse is a channel that
         * appears to have been told something. `NOT_FOLLOWED` is one sentence
         * and it names what did NOT happen — *"I have not written anything
         * down"* — because that is the fact the person needs.
         *
         * Not claimed, so it is not deduped: this answers one message, and two
         * unreadable messages deserve two answers.
         */
        await transport.send({
          kind: 'run-ended',
          decision: 'open-only',
          key: `unrecognised:${inbound.updateId}`,
          text: NOT_FOLLOWED,
        })
        break
    }
  }

  /**
   * The cursor moves even when nothing was written, and even when nothing was
   * READ.
   *
   * A reply that could not be parsed has been answered and must not be re-read
   * on the next tick — otherwise one unreadable message becomes a loop that
   * answers it every few seconds forever. The transport's own cursor covers a
   * second case the loop above cannot see: a message from a chat that is not the
   * paired one, which is dropped before it ever reaches here. Advancing only
   * past what was acted on would leave those re-offered for ever, and enough of
   * them would push the person's real reply out of the provider's window.
   */
  const cursor = polled.value.cursor
  if (cursor !== null && cursor !== (status?.lastUpdateId ?? null)) {
    await ctx.repos.thread.markRead(TELEGRAM, cursor)
  }

  return { read: polled.value.messages.length, answered, acceptedOffer, declinedOffer }
}
