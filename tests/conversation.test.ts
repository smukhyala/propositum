/**
 * The message set, held to the three rules that make it safe to have one.
 *
 * ADR-0021. These are not ordinary unit tests. What they refuse is the class of
 * change that makes a message channel become a notification channel — a member
 * with nothing attached to it, a sentence that names a page's own words, a
 * confirmation that grew a shortcut. Every one of those would pass a review that
 * was looking at whether the string reads well.
 *
 * The one thing they cannot check is stated at the top of `messages.ts` and is
 * worth repeating where somebody debugging a failure will read it: the grep for
 * page-authored text catches a FIELD NAMED after page text and does not catch a
 * field that merely holds some. The union being small enough to read in one
 * sitting is the other half of the mechanism.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  THREAD_MESSAGES,
  THREAD_MESSAGE_KINDS,
  offerMessage,
  confirmationMessage,
  decisionMessage,
  runEndedMessage,
  captureGapMessage,
} from '../src/domain/conversation/messages'
import { parseReply, NOT_FOLLOWED } from '../src/domain/conversation/reply'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'http://127.0.0.1:3117'

const anOffer = {
  threadSignature: 'sig-lisbon',
  title: 'Working out the Lisbon trip',
  rationale: 'Three sites about the same trip, over forty minutes.',
  outline: ['Compare the two flight options', 'Check what the visa needs'],
  willNotDo: ['Book anything', 'Send anything'],
  baseUrl: BASE,
}

describe('the message set is closed and every member carries a decision', () => {
  it('lists exactly the kinds the union declares', () => {
    expect([...THREAD_MESSAGE_KINDS].sort()).toEqual(Object.keys(THREAD_MESSAGES).sort())
  })

  /**
   * Principle 13 forbids "a notification with no decision attached to it", and
   * names notifications as the first place that rule erodes. `ThreadDecision`
   * has no `none` member, so this asserts the field is populated rather than
   * that the value is meaningful — the type does the rest.
   */
  it('attaches a decision to every kind', () => {
    for (const kind of THREAD_MESSAGE_KINDS) {
      expect(THREAD_MESSAGES[kind].decision, kind).toBeTruthy()
    }
  })

  it('gives every message somewhere to go', () => {
    for (const kind of THREAD_MESSAGE_KINDS) {
      expect(THREAD_MESSAGES[kind].deepLinks, kind).toBe(true)
    }
  })

  /**
   * A message that can only be acted on elsewhere and does not say where is a
   * dead end. This is the rendered half of the assertion above.
   */
  it('puts a loopback link in every rendered message', () => {
    const rendered = [
      offerMessage(anOffer),
      confirmationMessage({ requestId: 'r1', contractId: 'c1', question: 'Press something on example.com', baseUrl: BASE }),
      decisionMessage({ decisionId: 'd1', contractId: 'c1', question: 'Annual or monthly?', whyStopped: 'Both are defensible.', baseUrl: BASE }),
      runEndedMessage({ contractId: 'c1', stopLabel: null, headline: null, changeCount: 0, baseUrl: BASE }),
      captureGapMessage({ contractId: 'c1', baseUrl: BASE }),
    ]
    for (const message of rendered) {
      expect(message.text, message.kind).toContain('127.0.0.1:3117')
    }
  })

  /** A restart must not re-announce what somebody already read. */
  it('gives every message a key that names the row it is about', () => {
    expect(offerMessage(anOffer).key).toBe('offer:sig-lisbon')
    expect(confirmationMessage({ requestId: 'r1', contractId: 'c1', question: 'q', baseUrl: BASE }).key).toBe('confirmation:r1')
    expect(decisionMessage({ decisionId: 'd1', contractId: 'c1', question: 'q', whyStopped: 'w', baseUrl: BASE }).key).toBe('decision:d1')
  })
})

describe('a confirmation carries no verb', () => {
  const message = confirmationMessage({
    requestId: 'r1',
    contractId: 'c1',
    question: 'Press something on example.com',
    baseUrl: BASE,
  })

  /**
   * `src/app/api/act/confirmation/route.ts`: "a channel that could carry the
   * approval would make that button one line of code away forever." The
   * extension learned the sharper version and ships ONE button, "Show me", and
   * deliberately not even a "Don't".
   */
  it('never invites a reply', () => {
    expect(message.decision).toBe('open-only')
    expect(message.text.toLowerCase()).not.toMatch(/reply (yes|no|y\b)/)
    expect(message.text.toLowerCase()).not.toContain('reply yes')
  })

  it('says why it cannot take the answer here', () => {
    expect(message.text).toContain('you have to see what you are agreeing to first')
  })
})

describe('an offer prints what ADR-0019 forbids folding', () => {
  const message = offerMessage(anOffer)

  /**
   * ADR-0019 item 2 puts the outline and the "will not do" list on the closed
   * list of things that may never be behind a disclosure. A thread has no
   * `<details>`, so the only two options are printing them and not sending the
   * message — and a message that named an offer while hiding what it excluded
   * would be the offer screen with the guard removed, arriving somewhere it is
   * read faster.
   */
  it('carries the whole outline', () => {
    for (const line of anOffer.outline) expect(message.text).toContain(line)
  })

  it('carries the whole will-not-do list', () => {
    for (const line of anOffer.willNotDo) expect(message.text).toContain(line)
    expect(message.text).toContain('What I will not do:')
  })
})

describe('a run ending says the true thing, including the boring one', () => {
  it('uses the stop rule label verbatim when there is one', () => {
    const message = runEndedMessage({
      contractId: 'c1',
      stopLabel: 'I ran out of the time you gave me.',
      headline: 'Drafted the comparison section.',
      changeCount: 6,
      baseUrl: BASE,
    })
    expect(message.text.startsWith('I ran out of the time you gave me.')).toBe(true)
    expect(message.text).toContain('6 changes waiting on you.')
  })

  /** A clean finish has no label, and inventing one would be Principle 11's problem. */
  it('does not invent a stop reason for a run that simply finished', () => {
    const message = runEndedMessage({ contractId: 'c1', stopLabel: null, headline: null, changeCount: 0, baseUrl: BASE })
    expect(message.text.startsWith('I finished.')).toBe(true)
    expect(message.text).toContain('Nothing to review.')
  })

  it('does not pluralise one change', () => {
    const message = runEndedMessage({ contractId: 'c1', stopLabel: null, headline: null, changeCount: 1, baseUrl: BASE })
    expect(message.text).toContain('1 change waiting on you.')
  })
})

describe('a reply is a verdict or a selection, and never a guess', () => {
  const offerOpen = { repliedTo: null, offerOpen: true }
  const nothingOpen = { repliedTo: null, offerOpen: false }

  it('takes yes and not now while an offer is open', () => {
    expect(parseReply('yes', offerOpen)).toEqual({ kind: 'accept-offer' })
    expect(parseReply('Yes!', offerOpen)).toEqual({ kind: 'accept-offer' })
    expect(parseReply('not now', offerOpen)).toEqual({ kind: 'decline-offer' })
  })

  /** A yes with no offer behind it is a yes to nothing. */
  it('recognises nothing when no offer is open', () => {
    expect(parseReply('yes', nothingOpen)).toEqual({ kind: 'unrecognised' })
  })

  it('binds prose to the decision it was sent in answer to', () => {
    expect(parseReply('Go with the annual tier', { repliedTo: 'decision:d1', offerOpen: false })).toEqual({
      kind: 'answer-decision',
      answer: 'Go with the annual tier',
      repliedTo: 'decision:d1',
    })
  })

  /**
   * The ordering case, and it is the one worth having.
   *
   * Somebody answering "annual or monthly?" with the single word "no" has
   * answered THAT question, not declined an offer that happens to still be open.
   */
  it('reads the reply target before it reads the words', () => {
    expect(parseReply('no', { repliedTo: 'decision:d1', offerOpen: true })).toEqual({
      kind: 'answer-decision',
      answer: 'no',
      repliedTo: 'decision:d1',
    })
  })

  it('keeps the answer verbatim, punctuation and all', () => {
    const reply = parseReply('  Annual — but only if they honour the Q3 price.  ', {
      repliedTo: 'decision:d1',
      offerOpen: false,
    })
    expect(reply).toEqual({
      kind: 'answer-decision',
      answer: 'Annual — but only if they honour the Q3 price.',
      repliedTo: 'decision:d1',
    })
  })

  /**
   * The property this union exists to hold: there is no shape a confirmation
   * answer could take, so no amount of typing "yes" reaches one.
   */
  it('has no member a confirmation answer could become', () => {
    const kinds = ['accept-offer', 'decline-offer', 'answer-decision', 'unrecognised']
    const source = readFileSync(join(repo, 'src/domain/conversation/reply.ts'), 'utf8')
    const declared = [...source.matchAll(/readonly kind: '([a-z-]+)'/g)].map((m) => m[1])
    expect([...new Set(declared)].sort()).toEqual([...kinds].sort())
  })

  it('says so rather than swallowing what it cannot parse', () => {
    expect(parseReply('yeah go for it but only the first one', offerOpen)).toEqual({ kind: 'unrecognised' })
    expect(NOT_FOLLOWED).toContain('have not written anything down')
  })
})

describe('nothing that crossed the trust boundary can leave', () => {
  const source = readFileSync(join(repo, 'src/domain/conversation/messages.ts'), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  /**
   * ADR-0021 §3. This catches a field NAMED after page-authored text; it cannot
   * catch a field that merely holds some. Both halves are stated here so a
   * reader does not take the green tick for more than it is.
   */
  it('names no page-authored field in the rendered messages', () => {
    for (const forbidden of ['elementName', 'tabTitle', 'typedText', 'pageAuthored', 'imageSrc', 'image', 'screenshot']) {
      expect(code, `${forbidden} must not reach a message`).not.toContain(forbidden)
    }
  })

  it('builds no URL but a loopback deep link', () => {
    expect(code).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/)
  })

  /** `tests/architecture.test.ts` greps the whole domain; this says why for this file. */
  it('reads no clock and reaches no network', () => {
    expect(code).not.toMatch(/\bDate\.now\(\)|new Date\(/)
    expect(code).not.toMatch(/\bfetch\s*\(/)
  })
})
