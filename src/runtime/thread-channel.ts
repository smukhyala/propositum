/**
 * The one file that knows Telegram exists.
 *
 * ADR-0021. `src/domain/conversation/` decides what may be said and what a reply
 * may become; this turns those into HTTP and back. The seam is the point: the
 * stated destination is a person texting a number, so a second transport must be
 * a new file here and a change to nothing above it.
 *
 * ── Why this is not a tool ────────────────────────────────────────────────
 *
 * It is not an `ActionKind`, it takes no `AuthorizedAction`, and it is not
 * exported from `src/policy/tools.ts`. A model cannot cause a message to be sent
 * because there is no proposal shape that means *send* and the gate has no rule
 * for one. What reaches this file is a `RenderedMessage` built by a template
 * over durable rows, from a caller in the app or worker process — never from the
 * worker LOOP, which is the thing a model steers.
 *
 * The distinction is thin and worth being blunt about: the difference between
 * *the app tells you something* and *the worker sends a message* is not a
 * difference in bytes on a wire, it is a difference in who initiates.
 *
 * ── Failures are values ───────────────────────────────────────────────────
 *
 * Every seam in this codebase reports failure as a value — `ActionResult`,
 * `BoundaryResult`, `Admission`, `ConnectionResult`, `AppendResult`. An
 * exception thrown through the worker loop turns a recoverable network blip into
 * a dead run, and this is called from inside that loop.
 *
 * ── The fetcher is injected ───────────────────────────────────────────────
 *
 * Copying `src/server/calendar.ts`, and for its reason: it is what lets a test
 * hold a distinctive bot token and prove it appears in nothing. There is no
 * other way to assert that a secret does not leak.
 *
 * ── What this file may never do ───────────────────────────────────────────
 *
 * Log. There is no `console` call here, deliberately, exactly as there is none
 * in `calendar.ts` — the bot token is in every URL this file builds, so one
 * `console.error(url)` on a failure path puts a credential in a terminal and,
 * eventually, in an issue. Failures are returned; the caller decides what to say
 * about them, from the parts that are not the URL.
 */

import type { RenderedMessage } from '@/domain/conversation/messages'

/** Success or a reason. Never an exception. */
export type ChannelResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: ChannelProblem }

export interface ChannelProblem {
  readonly kind: 'unreachable' | 'refused' | 'unusable'
  /**
   * Safe to render. Built from the response, never from the request.
   *
   * `unreachable` is the network. `refused` is the provider saying no — a
   * revoked token, a blocked bot, a chat that no longer exists. `unusable` is a
   * reply we could not read, which is a bug here rather than a fact about the
   * person's account, and the three are separated because only the middle one is
   * something they can fix.
   */
  readonly detail: string
}

const ok = <T>(value: T): ChannelResult<T> => ({ ok: true, value })
const no = <T>(kind: ChannelProblem['kind'], detail: string): ChannelResult<T> => ({
  ok: false,
  problem: { kind, detail },
})

/**
 * What one poll found: the messages worth acting on, and how far it read.
 *
 * ── Why the cursor is reported separately ────────────────────────────────
 *
 * Because `messages` is now narrower than what the provider offered — a bot's
 * inbox holds whatever anyone sent it, and only the paired chat's half is a
 * reply to Propositum. Advancing the caller's cursor from `messages` alone would
 * leave everything dropped permanently unacknowledged, so the provider would
 * re-offer it on every tick for ever, and a stranger with a hundred messages
 * would push the person's own reply out of the window. That is a way to stop
 * somebody's thread working from outside the machine, which is the thing
 * `DEFAULT_TIMEOUT_MS` above is also about.
 *
 * So: act on the paired chat, acknowledge everything.
 */
export interface PolledMessages {
  /** From the paired chat only, oldest first. */
  readonly messages: readonly InboundMessage[]
  /**
   * The highest update id the provider offered, including what was dropped, or
   * null if it offered nothing. Never decreases below what was passed in.
   */
  readonly cursor: number | null
}

/** One message a person sent back. Transport-shaped, domain-agnostic. */
export interface InboundMessage {
  /** The transport's cursor value for this message. */
  readonly updateId: number
  /** What they typed, verbatim and untrimmed. */
  readonly text: string
  /** The provider's id for the message they replied to, if they replied. */
  readonly repliedToProviderMessageId: string | null
}

/**
 * What any channel must be able to do.
 *
 * Three verbs and no more. `identify` exists only for pairing — it is how the
 * first-run page turns a pasted token into a name a person can recognise, so
 * they can tell whether they pasted the right one.
 */
export interface ThreadTransport {
  /** Returns the provider's id for the sent message, when it has one. */
  send(message: RenderedMessage): Promise<ChannelResult<string | null>>
  /** Everything after `since` that the paired chat sent, plus how far it read. */
  poll(since: number | null): Promise<ChannelResult<PolledMessages>>
  /** Who this token belongs to. Pairing only. */
  identify(): Promise<ChannelResult<{ readonly handle: string }>>
  /**
   * The first chat that has said anything, and the cursor to start after.
   *
   * Pairing only, and separate from `poll` on purpose: `InboundMessage` carries
   * no chat id, because a chat id on every inbound message is a field the send
   * path could start trusting — a reply from anywhere becoming a place to send
   * to. Pairing is the one moment it is needed, so it is the one method that
   * returns one.
   */
  firstChat(): Promise<ChannelResult<{ readonly chatId: string; readonly updateId: number } | null>>
}

export interface TelegramConfig {
  readonly botToken: string
  readonly chatId: string
  readonly fetcher: typeof globalThis.fetch
  /** Milliseconds before a call is abandoned. */
  readonly timeoutMs?: number
}

/**
 * Ten seconds.
 *
 * This runs inside the worker's idle tick and inside a 30-second poll route. A
 * request that hangs longer than either is not slow, it is gone — and a channel
 * that can stall the loop it is called from has become a way for a third party
 * to stop the product working.
 */
export const DEFAULT_TIMEOUT_MS = 10_000

const API = 'https://api.telegram.org'

interface TelegramEnvelope {
  ok?: unknown
  result?: unknown
  description?: unknown
}

export function createTelegramTransport(config: TelegramConfig): ThreadTransport {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  /**
   * One request, one place where the token is interpolated.
   *
   * `method` and `body` are the only things a caller varies, so there is exactly
   * one line in this file that builds a URL containing a credential and exactly
   * one thing to check when reading it.
   */
  async function call(method: string, body?: unknown): Promise<ChannelResult<unknown>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response
    try {
      response = await config.fetcher(`${API}/bot${config.botToken}/${method}`, {
        method: body === undefined ? 'GET' : 'POST',
        signal: controller.signal,
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      })
    } catch (error) {
      // Deliberately not the error's own message: an abort or a DNS failure can
      // carry the URL, and the URL is the token.
      return no('unreachable', error instanceof Error && error.name === 'AbortError'
        ? 'It took too long to answer.'
        : 'It could not be reached.')
    } finally {
      clearTimeout(timer)
    }

    let envelope: TelegramEnvelope
    try {
      envelope = (await response.json()) as TelegramEnvelope
    } catch {
      return no('unusable', `It answered with something unreadable (${response.status}).`)
    }

    if (envelope.ok !== true) {
      /**
       * The provider's own description, and it is safe.
       *
       * Telegram describes the FAILURE — "Unauthorized", "chat not found",
       * "bot was blocked by the user" — and never echoes the request. Those are
       * exactly the three things a person can act on, which is why this is the
       * one place a provider string is rendered rather than replaced.
       */
      const detail =
        typeof envelope.description === 'string' && envelope.description !== ''
          ? envelope.description
          : `It refused (${response.status}).`
      return no('refused', detail)
    }

    return ok(envelope.result)
  }

  return {
    async send(message) {
      const result = await call('sendMessage', {
        chat_id: config.chatId,
        text: message.text,
        // Plain text. The messages are written as sentences, not markup, and
        // enabling a parse mode would make an apostrophe in somebody's project
        // name into a formatting error on the one channel they read fastest.
        disable_web_page_preview: true,
      })
      if (!result.ok) return result

      const sent = result.value
      const id =
        typeof sent === 'object' && sent !== null && 'message_id' in sent
          ? String((sent as { message_id: unknown }).message_id)
          : null
      return ok(id)
    },

    async poll(since) {
      /**
       * `offset` is exclusive-of-what-came-before in Telegram's own terms: it
       * acknowledges everything below it. Passing `since + 1` is what stops the
       * same reply being read twice, and it is also what makes a restart safe —
       * the cursor is durable, so the provider stops offering what was handled.
       */
      const result = await call(
        since === null ? 'getUpdates' : `getUpdates?offset=${since + 1}`,
      )
      if (!result.ok) return result

      if (!Array.isArray(result.value)) {
        return no<PolledMessages>(
          'unusable',
          'It answered with something that was not a list of messages.',
        )
      }

      const inbound: InboundMessage[] = []
      // Raised by every well-formed update, acted on or dropped. See
      // `PolledMessages.cursor` for why the two counts differ on purpose.
      let cursor = since
      for (const raw of result.value) {
        if (typeof raw !== 'object' || raw === null) continue
        const update = raw as Record<string, unknown>

        const updateId = update['update_id']
        if (typeof updateId !== 'number') continue
        if (cursor === null || updateId > cursor) cursor = updateId

        const message = update['message']
        if (typeof message !== 'object' || message === null) continue
        const fields = message as Record<string, unknown>

        /**
         * From the paired chat, or it did not happen.
         *
         * A bot's username is public and anybody may start a chat with one, so
         * `getUpdates` is not a private inbox — it is everything the bot has been
         * sent, by anyone. Without this line a stranger's "yes" would accept an
         * offer, and a stranger replying to their OWN message would forge an
         * answer: Telegram numbers messages per chat, so their message 5 and the
         * person's message 5 are indistinguishable by the time
         * `keyForProviderMessageId` looks one up by id.
         *
         * ── Why the filter is here and not on `InboundMessage` ───────────────
         *
         * Because `InboundMessage` still carries no chat id, and must not. That
         * absence is what stops the SEND path ever learning a destination from
         * something that arrived — a reply from anywhere becoming a place to send
         * to. The transport already knows the one chat it is for; it drops what
         * is not from there and hands up the same shape as before.
         *
         * Fails closed: pairing builds a transport with `chatId: ''`, which
         * matches nothing. That transport calls `identify` and `firstChat` and
         * never this, and if it ever did it would read no messages rather than
         * all of them.
         *
         * ── What this does NOT do ───────────────────────────────────────────
         *
         * It does not authenticate a PERSON, only a conversation. Anyone holding
         * the person's unlocked phone is in the paired chat, exactly as anyone
         * at their unlocked desk is at the screen. It also acknowledges what it
         * drops — the cursor still advances past a stranger's message, because
         * re-reading it every tick forever is the other failure.
         */
        const chat = fields['chat']
        const chatId =
          typeof chat === 'object' && chat !== null && 'id' in chat
            ? String((chat as { id: unknown }).id)
            : null
        if (chatId !== config.chatId) continue

        const text = fields['text']
        // A photo, a sticker or a voice note is not a reply this product can
        // read. It is skipped rather than treated as empty text, because empty
        // text would be answered "I didn't follow that" and a sticker is not a
        // failed sentence.
        if (typeof text !== 'string') continue

        const repliedTo = fields['reply_to_message']
        const repliedToId =
          typeof repliedTo === 'object' && repliedTo !== null && 'message_id' in repliedTo
            ? String((repliedTo as { message_id: unknown }).message_id)
            : null

        inbound.push({ updateId, text, repliedToProviderMessageId: repliedToId })
      }

      // Oldest first, so a caller applying them in order applies them in the
      // order the person sent them.
      return ok({
        messages: inbound.sort((a, b) => a.updateId - b.updateId),
        cursor,
      })
    },

    async firstChat() {
      const result = await call('getUpdates')
      if (!result.ok) return result
      if (!Array.isArray(result.value)) {
        return no<{ chatId: string; updateId: number } | null>(
          'unusable',
          'It answered with something that was not a list of messages.',
        )
      }

      for (const raw of result.value) {
        const update = raw as { update_id?: unknown; message?: { chat?: { id?: unknown } } }
        const chat = update.message?.chat?.id
        if (typeof update.update_id !== 'number') continue
        if (typeof chat !== 'number' && typeof chat !== 'string') continue
        return ok({ chatId: String(chat), updateId: update.update_id })
      }
      return ok(null)
    },

    async identify() {
      const result = await call('getMe')
      if (!result.ok) return result

      const me = result.value
      const handle =
        typeof me === 'object' && me !== null && 'username' in me
          ? String((me as { username: unknown }).username)
          : ''
      if (handle === '') return no('unusable', 'It did not say what it is called.')
      return ok({ handle })
    },
  }
}
