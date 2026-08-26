/**
 * Which message channels exist, as names rather than as shapes.
 *
 * ADR-0021. A provider name belongs in the domain because it is what
 * `ThreadConnection.provider` holds and what `CONTEXT.md` describes; a
 * provider's API does not, and lives in `src/runtime/thread-channel.ts`. The
 * line is the same one `src/model/provider.ts` draws — a name here, a client
 * there — and it is what keeps a second transport from being a change to
 * anything above it.
 *
 * **Telegram is the test transport, not the destination.** The stated target is
 * a person texting a number. Nothing in the domain may assume Telegram's
 * affordances — inline keyboards, reply-to threading, `getUpdates` — and the
 * things that do assume them are the transport's own.
 */

/** The providers a thread may be on. Closed; a second is a schema change. */
export const THREAD_PROVIDERS = ['telegram'] as const

export type ThreadProvider = (typeof THREAD_PROVIDERS)[number]

/** The only one built. Named rather than spelled out at every call site. */
export const TELEGRAM: ThreadProvider = 'telegram'
