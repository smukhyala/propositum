/**
 * The channel, held to what ADR-0021 spent a promise to get.
 *
 * ── What is actually being defended ──────────────────────────────────────
 *
 * Not "the transport parses JSON". Four things, and every one of them is a
 * sentence in an ADR that would otherwise be enforced by nobody:
 *
 * 1. **The bot token appears in nothing.** It is in every URL this transport
 *    builds, so one `console.error(url)` or one error message passed through
 *    puts a credential in a terminal and eventually in an issue. The fetcher is
 *    injected precisely so a test can hold a distinctive token and prove it —
 *    `src/server/calendar.ts` does the same for the refresh token and says why.
 * 2. **A message is said once.** Two feeds in two processes write here, and the
 *    dedupe is a UNIQUE claim rather than a read-then-write because that is
 *    exactly where the gap lives.
 * 3. **A confirmation cannot be answered by reply.** ADR-0021's sharpest rule,
 *    and the one most likely to rot: the union in `reply.ts` has no member one
 *    could become, and this asserts a real `yes` on a real confirmation message
 *    writes nothing.
 * 4. **Failures are values.** This runs inside the worker's tick. An exception
 *    thrown here turns a network blip into a dead loop.
 *
 * Run against a real SQLite file with the append-only triggers installed,
 * because the claim and the verdict are both enforced by the database rather
 * than by the code above it.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

import { createDatabase } from '../src/persistence/client'
import type { Database } from '../src/persistence/client'
import { createRepositories } from '../src/persistence/repositories/index'
import type { Repositories } from '../src/persistence/repositories/index'
import { createTelegramTransport } from '../src/runtime/thread-channel'
import { TELEGRAM } from '../src/domain/conversation/channel'
import { decisionMessage, confirmationMessage } from '../src/domain/conversation/messages'
import { readReplies, sayOnce, transportFor, whatIsOutstanding } from '../src/server/thread'

/** Distinctive enough that finding it anywhere is unambiguous. */
const TOKEN = '999666:UNIQUE-BOT-TOKEN-DO-NOT-LEAK'
const CHAT = '4242'
const BASE = 'http://127.0.0.1:3117'

let dir: string
let db: Database
let repos: Repositories
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

/** A fetcher that records every URL and answers from a script. */
function recordingFetcher(answers: Record<string, unknown>) {
  const seen: string[] = []
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input)
    seen.push(url)
    const method = url.split('/').pop()?.split('?')[0] ?? ''
    const body = answers[method] ?? { ok: true, result: {} }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof globalThis.fetch
  return { fetcher, seen }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-thread-'))
  const url = `file:${join(dir, 'test.db')}`
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  db = await createDatabase({ url })
  repos = createRepositories(db.prisma)
}, 120_000)

afterAll(async () => {
  await db?.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  await db.prisma.threadMessageSent.deleteMany({})
  await db.prisma.threadConnection.deleteMany({})
  await repos.thread.save({ provider: TELEGRAM, botToken: TOKEN, chatId: CHAT })
})

/**
 * Enough of an `AppContext` for the paths under test.
 *
 * `db.prisma` is here because `oldestPendingConfirmation` takes a
 * `ConfirmationContext` and reads the client directly rather than through a
 * repository — narrowed to what is actually reached rather than
 * built whole, so a path that starts needing more of the context fails loudly
 * here instead of silently reading a half-built one.
 */
const ctx = () => ({ repos, db: { prisma: db.prisma } }) as unknown as Parameters<typeof sayOnce>[0]

describe('the bot token reaches the wire and nothing else', () => {
  it('is in the URL, which is why nothing else may carry it', async () => {
    const { fetcher, seen } = recordingFetcher({
      sendMessage: { ok: true, result: { message_id: 7 } },
    })
    const transport = createTelegramTransport({ botToken: TOKEN, chatId: CHAT, fetcher })
    await transport.send(decisionMessage({
      decisionId: 'd1',
      contractId: 'c1',
      question: 'Water or centre?',
      whyStopped: 'Both are defensible.',
      baseUrl: BASE,
    }))

    // It is genuinely there — otherwise the assertions below prove nothing.
    expect(seen.some((url) => url.includes(TOKEN))).toBe(true)
  })

  /**
   * The failure paths, which are where a credential actually escapes.
   *
   * A rejected fetch or an abort can carry the URL on the error, and passing
   * `error.message` through would render the token on a screen. Every branch is
   * exercised rather than the happy one.
   */
  it('never puts the token in a problem a person could see', async () => {
    const cases: Array<[string, typeof globalThis.fetch]> = [
      [
        'a rejected request',
        (async () => {
          throw new Error(`connect ECONNREFUSED for https://api.telegram.org/bot${TOKEN}/sendMessage`)
        }) as unknown as typeof globalThis.fetch,
      ],
      [
        'an unreadable body',
        (async () =>
          new Response('<html>nope</html>', {
            status: 502,
            headers: { 'content-type': 'text/html' },
          })) as unknown as typeof globalThis.fetch,
      ],
      [
        'a refusal',
        (async () =>
          new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })) as unknown as typeof globalThis.fetch,
      ],
    ]

    for (const [what, fetcher] of cases) {
      const transport = createTelegramTransport({ botToken: TOKEN, chatId: CHAT, fetcher })
      const result = await transport.send(
        confirmationMessage({ requestId: 'r', contractId: 'c', question: 'q', baseUrl: BASE }),
      )
      expect(result.ok, what).toBe(false)
      if (!result.ok) {
        expect(result.problem.detail, `${what} leaked the token`).not.toContain(TOKEN)
        expect(result.problem.detail, `${what} leaked the token`).not.toContain('999666')
      }
    }
  })

  /** A refusal the person can act on is quoted; a request is never echoed. */
  it('renders the provider reason, because it is about their account', async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ ok: false, description: 'bot was blocked by the user' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof globalThis.fetch
    const transport = createTelegramTransport({ botToken: TOKEN, chatId: CHAT, fetcher })
    const result = await transport.send(
      confirmationMessage({ requestId: 'r', contractId: 'c', question: 'q', baseUrl: BASE }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problem.detail).toContain('blocked')
  })
})

describe('failures are values, because this runs inside the worker tick', () => {
  it('does not throw when the network does', async () => {
    const fetcher = (async () => {
      throw new Error('down')
    }) as unknown as typeof globalThis.fetch
    const transport = createTelegramTransport({ botToken: TOKEN, chatId: CHAT, fetcher })

    await expect(transport.poll(null)).resolves.toMatchObject({ ok: false })
    await expect(transport.identify()).resolves.toMatchObject({ ok: false })
    await expect(transport.firstChat()).resolves.toMatchObject({ ok: false })
  })
})

describe('a message is said once, and the claim is what makes that true', () => {
  const message = () =>
    decisionMessage({
      decisionId: 'd-once',
      contractId: 'c1',
      question: 'Water or centre?',
      whyStopped: 'Both are defensible.',
      baseUrl: BASE,
    })

  it('sends the first time and refuses the second', async () => {
    let sends = 0
    const fetcher = (async () => {
      sends += 1
      return new Response(JSON.stringify({ ok: true, result: { message_id: 11 } }), {
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof globalThis.fetch
    const transport = createTelegramTransport({ botToken: TOKEN, chatId: CHAT, fetcher })

    expect(await sayOnce(ctx(), transport, message())).toBe(true)
    expect(await sayOnce(ctx(), transport, message())).toBe(false)
    expect(sends).toBe(1)
  })

  /**
   * A failed send does not un-claim, and that is the decision rather than a bug.
   *
   * Every message here is *something happened, come and look*, and the thing
   * that happened is on a screen either way. Retrying until it lands would
   * eventually announce a shift somebody reviewed an hour ago.
   */
  it('does not retry a message whose send failed', async () => {
    let sends = 0
    const fetcher = (async () => {
      sends += 1
      throw new Error('down')
    }) as unknown as typeof globalThis.fetch
    const transport = createTelegramTransport({ botToken: TOKEN, chatId: CHAT, fetcher })

    expect(await sayOnce(ctx(), transport, message())).toBe(false)
    expect(await sayOnce(ctx(), transport, message())).toBe(false)
    expect(sends).toBe(1)
  })

  /** Re-pairing forgets what was said: a new thread has been told nothing. */
  it('forgets what it said when the thread is re-paired', async () => {
    const { fetcher } = recordingFetcher({ sendMessage: { ok: true, result: { message_id: 3 } } })
    const transport = createTelegramTransport({ botToken: TOKEN, chatId: CHAT, fetcher })

    expect(await sayOnce(ctx(), transport, message())).toBe(true)
    await repos.thread.save({ provider: TELEGRAM, botToken: TOKEN, chatId: 'a-new-chat' })
    expect(await sayOnce(ctx(), transport, message())).toBe(true)
  })
})

describe('a confirmation may never be answered by reply', () => {
  /**
   * ADR-0021, quoting the endpoint that was built to make it impossible:
   * "a channel that could carry the approval would make that button one line of
   * code away forever."
   */
  it('writes nothing when somebody replies yes to a confirmation', async () => {
    const sent = confirmationMessage({
      requestId: 'req-1',
      contractId: 'c1',
      question: 'Press something on example.com',
      baseUrl: BASE,
    })
    await repos.thread.claimSend(TELEGRAM, sent.key)
    await repos.thread.noteProviderMessageId(sent.key, '500')

    const replies: unknown[] = []
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('sendMessage')) {
        replies.push(JSON.parse(String(init?.body ?? '{}')))
        return new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 100,
              message: { text: 'yes', chat: { id: CHAT }, reply_to_message: { message_id: 500 } },
            },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const outcome = await readReplies(ctx(), Date.now(), { offerOpen: null, fetcher })

    // Nothing was answered, nothing was written, and the person was told rather
    // than left believing their `yes` landed.
    expect(outcome.answered).toBe(0)
    expect(await db.prisma.decisionVerdict.count()).toBe(0)
    expect(JSON.stringify(replies)).toContain('have not written anything down')
  })

  /**
   * The same shape on a message that IS answerable, so the test above is
   * proving a rule rather than a broken fixture.
   */
  it('writes a verdict when the same reply answers a decision', async () => {
    const project = await repos.projects.create('Answerable')
    const intention = await repos.intentions.create({
      projectId: project.id,
      objective: 'Get somewhere',
      definitionOfDone: 'Something to show',
    })
    const session = await repos.sessions.start(project.id, intention.id)
    const reading = await db.prisma.sessionReading.create({
      data: { sessionId: session.id, throughSeq: 1 },
      select: { id: true },
    })
    const doc = await repos.documents.create({
      projectId: project.id,
      title: 'Answerable',
      content: '# x\n',
      contentHash: hash('# x\n'),
    })
    const contract = await repos.contracts.createDraft({
      sessionId: session.id,
      readingId: reading.id,
      intentionId: intention.id,
      objective: 'Get somewhere',
      definitionOfDone: 'Something to show',
      guidance: [],
      approvedSourceIds: [],
      allowedActionKinds: ['read-document'],
      baseVersionId: doc.versionId,
      initiative: 'follow-closely',
      progress: 'current-step-only',
      output: 'draft-changes',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })
    await repos.contracts.accept(contract.id, new Date())
    await repos.reports.create({
      contractId: contract.id,
      narrative: null,
      decisions: [
        { question: 'Water or centre?', whyStopped: 'Both work.', needs: 'Your call.', ordinal: 0 },
      ],
    })
    const report = await repos.reports.forContract(contract.id)
    const decisionId = report!.decisions[0]!.id

    await repos.thread.claimSend(TELEGRAM, `decision:${decisionId}`)
    await repos.thread.noteProviderMessageId(`decision:${decisionId}`, '600')

    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('sendMessage')) {
        return new Response(JSON.stringify({ ok: true, result: { message_id: 12 } }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 200,
              message: {
                text: 'Water, and say why in a line.',
                chat: { id: CHAT },
                reply_to_message: { message_id: 600 },
              },
            },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const outcome = await readReplies(ctx(), Date.now(), { fetcher })

    expect(outcome.answered).toBe(1)
    const after = await repos.reports.forContract(contract.id)
    expect(after!.decisions[0]!.answer).toBe('Water, and say why in a line.')
  })

  /** An unreadable reply must not be re-read every tick forever. */
  it('advances the cursor even when nothing was written', async () => {
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('sendMessage')) {
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({
          ok: true,
          result: [{ update_id: 900, message: { text: 'what?', chat: { id: CHAT } } }],
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    await readReplies(ctx(), Date.now(), { fetcher })
    expect((await repos.thread.status(TELEGRAM))?.lastUpdateId).toBe(900)
  })
})

describe('only the paired chat is a reply', () => {
  /**
   * ADR-0021 pairs ONE chat, and `poll` is what makes that mean something.
   *
   * A bot's username is public and anybody may start a chat with one, so
   * `getUpdates` is not a private inbox — it is everything the bot has been sent,
   * by anyone. Two things go wrong without the filter, and the second is the
   * worse one:
   *
   *   - A stranger's `yes` accepts an offer, which is permission to start
   *     watching somebody's work, given by somebody else.
   *   - A stranger replying to their OWN message forges an answer. Telegram
   *     numbers messages per chat, so their message 700 and the person's message
   *     700 are the same number by the time `keyForProviderMessageId` looks one
   *     up — and it scopes on `provider`, which is always `telegram`.
   *
   * ── What these tests do NOT claim ────────────────────────────────────────
   *
   * That a PERSON is authenticated. The paired chat is a conversation, not an
   * identity: anyone holding the unlocked phone is in it, exactly as anyone at
   * the unlocked desk is at the screen. What is asserted is only that a chat
   * nobody paired writes nothing.
   */
  const STRANGER = '9999'

  /** One inbound message from `chat`, and a record of anything sent back. */
  const inboundFrom = (
    chat: string,
    message: Record<string, unknown>,
    updateId = 300,
  ) => {
    const sends: unknown[] = []
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('sendMessage')) {
        sends.push(JSON.parse(String(init?.body ?? '{}')))
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({
          ok: true,
          result: [{ update_id: updateId, message: { chat: { id: chat }, ...message } }],
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch
    return { fetcher, sends }
  }

  /** A real raised decision, so a null result is about the chat and not a gap. */
  async function raiseDecision(): Promise<string> {
    const project = await repos.projects.create('Scoped')
    const intention = await repos.intentions.create({
      projectId: project.id,
      objective: 'Get somewhere',
      definitionOfDone: 'Something to show',
    })
    const session = await repos.sessions.start(project.id, intention.id)
    const reading = await db.prisma.sessionReading.create({
      data: { sessionId: session.id, throughSeq: 1 },
      select: { id: true },
    })
    const doc = await repos.documents.create({
      projectId: project.id,
      title: 'Scoped',
      content: '# x\n',
      contentHash: hash('# x\n'),
    })
    const contract = await repos.contracts.createDraft({
      sessionId: session.id,
      readingId: reading.id,
      intentionId: intention.id,
      objective: 'Get somewhere',
      definitionOfDone: 'Something to show',
      guidance: [],
      approvedSourceIds: [],
      allowedActionKinds: ['read-document'],
      baseVersionId: doc.versionId,
      initiative: 'follow-closely',
      progress: 'current-step-only',
      output: 'draft-changes',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })
    await repos.contracts.accept(contract.id, new Date())
    await repos.reports.create({
      contractId: contract.id,
      narrative: null,
      decisions: [
        { question: 'Water or centre?', whyStopped: 'Both work.', needs: 'Your call.', ordinal: 0 },
      ],
    })
    const report = await repos.reports.forContract(contract.id)
    return report!.decisions[0]!.id
  }

  it('does not accept an offer somebody else said yes to', async () => {
    const { fetcher, sends } = inboundFrom(STRANGER, { text: 'yes' })
    const outcome = await readReplies(ctx(), Date.now(), { offerOpen: 'sig-1', fetcher })

    expect(outcome.acceptedOffer).toBeNull()
    expect(outcome.read).toBe(0)
    /**
     * Not even told that it was not followed.
     *
     * `NOT_FOLLOWED` goes to the paired chat, so answering a stranger would send
     * the PERSON a message about somebody else's typing — and a channel that
     * replies to anyone who pokes it is one anybody can make chirp.
     */
    expect(sends).toEqual([])
  })

  it('accepts the same yes from the paired chat', async () => {
    const { fetcher } = inboundFrom(CHAT, { text: 'yes' })
    const outcome = await readReplies(ctx(), Date.now(), { offerOpen: 'sig-1', fetcher })
    expect(outcome.acceptedOffer).toBe('sig-1')
  })

  it('writes no answer when a stranger replies to the same message number', async () => {
    const decisionId = await raiseDecision()
    await repos.thread.claimSend(TELEGRAM, `decision:${decisionId}`)
    await repos.thread.noteProviderMessageId(`decision:${decisionId}`, '700')

    /**
     * A baseline rather than zero, because `decision_verdict` is append-only.
     *
     * `beforeEach` cannot clear it — the trigger refuses the DELETE, which is
     * the point of the table — so an earlier case in this file has already
     * written one. What is under test is that this attempt adds nothing.
     */
    const before = await db.prisma.decisionVerdict.count()

    const forged = inboundFrom(
      STRANGER,
      { text: 'Centre, and bill it to them.', reply_to_message: { message_id: 700 } },
      300,
    )
    const refused = await readReplies(ctx(), Date.now(), { fetcher: forged.fetcher })

    expect(refused.answered).toBe(0)
    expect(await db.prisma.decisionVerdict.count()).toBe(before)

    // The identical reply from the paired chat lands, so the assertion above is
    // a rule rather than a broken fixture.
    const real = inboundFrom(
      CHAT,
      { text: 'Water, and say why in a line.', reply_to_message: { message_id: 700 } },
      301,
    )
    const accepted = await readReplies(ctx(), Date.now(), { fetcher: real.fetcher })

    expect(accepted.answered).toBe(1)
    expect(await db.prisma.decisionVerdict.count()).toBe(before + 1)
  })

  /**
   * Dropped is not the same as unread.
   *
   * A message the transport refuses to act on must still be acknowledged, or the
   * provider re-offers it on every tick for ever — and a stranger with enough
   * messages would push the person's own reply out of `getUpdates`' window,
   * which is a way to stop somebody's thread working from outside the machine.
   */
  it('advances the cursor past a message it dropped', async () => {
    const { fetcher } = inboundFrom(STRANGER, { text: 'yes' }, 555)
    await readReplies(ctx(), Date.now(), { offerOpen: 'sig-1', fetcher })
    expect((await repos.thread.status(TELEGRAM))?.lastUpdateId).toBe(555)
  })
})

describe('what is outstanding', () => {
  /**
   * Asserted as an absence of one KIND rather than an empty list.
   *
   * `whatIsOutstanding` reads the whole database, and this file seeds notes in
   * other cases — so a test demanding an empty array would be asserting the
   * order this file happens to run in, which is the kind of green that goes red
   * for reasons unrelated to the rule. What is under test is that a channel with
   * nothing waiting on a person says nothing about waiting.
   */
  it('says nothing about a confirmation while none is pending', async () => {
    const said = await whatIsOutstanding(ctx(), Date.now())
    expect(said.map((message) => message.kind)).not.toContain('confirmation-raised')
  })

  it('carries a raised decision, and stops once it is answered', async () => {
    const project = await repos.projects.create('A trip')
    const intention = await repos.intentions.create({
      projectId: project.id,
      objective: 'Get somewhere',
      definitionOfDone: 'Something to show',
    })
    const session = await repos.sessions.start(project.id, intention.id)
    const reading = await db.prisma.sessionReading.create({
      data: { sessionId: session.id, throughSeq: 1 },
      select: { id: true },
    })
    const doc = await repos.documents.create({
      projectId: project.id,
      title: 'A trip',
      content: '# A trip\n',
      contentHash: hash('# A trip\n'),
    })
    const contract = await repos.contracts.createDraft({
      sessionId: session.id,
      readingId: reading.id,
      intentionId: intention.id,
      objective: 'Get somewhere',
      definitionOfDone: 'Something to show',
      guidance: [],
      approvedSourceIds: [],
      allowedActionKinds: ['read-document'],
      baseVersionId: doc.versionId,
      initiative: 'follow-closely',
      progress: 'current-step-only',
      output: 'draft-changes',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })
    await repos.contracts.accept(contract.id, new Date())
    await repos.reports.create({
      contractId: contract.id,
      narrative: 'I finished.',
      decisions: [
        { question: 'Water or centre?', whyStopped: 'Both work.', needs: 'Your call.', ordinal: 0 },
      ],
    })

    const open = await whatIsOutstanding(ctx(), Date.now())
    expect(open.map((m) => m.kind)).toContain('decision-raised')

    const report = await repos.reports.forContract(contract.id)
    await repos.reports.answer({
      decisionNeededId: report!.decisions[0]!.id,
      answer: 'Water.',
      source: 'thread',
      at: new Date(),
    })

    const after = await whatIsOutstanding(ctx(), Date.now())
    expect(after.map((m) => m.kind)).not.toContain('decision-raised')
  })
})

describe('the transport is absent until something is paired', () => {
  it('hands back nothing when there is no connection', async () => {
    await repos.thread.forget(TELEGRAM)
    expect(await transportFor(ctx())).toBeNull()
  })
})
