/**
 * The sentence a person is asked to say yes to.
 *
 * Weighted toward what must NOT be in it. A wrong-but-plausible question is the
 * silent failure here: the person reads it, it sounds like the thing they
 * expected, and they authorise something else. So most of what follows pins
 * absences — no model prose, no page-authored words, no invented method — and
 * only a few pin the wording itself.
 */

import { describe, it, expect } from 'vitest'

import { confirmationQuestion } from '../src/domain/execution/confirmation-question'
import { CONFIRMABLE_ACTION_KINDS, ACTION_KINDS } from '../src/domain/handoff/policy'
import type { ActionKind } from '../src/domain/handoff/policy'

const ORDERS = 'https://orders.example.com/orders/8812?ref=nav'

describe('the question names the mechanism and the host, and nothing else', () => {
  it('says what pressing is, without claiming to know what it does', () => {
    expect(confirmationQuestion({ kind: 'click-element', attestedUrl: ORDERS })).toBe(
      'Press something on orders.example.com',
    )
  })

  it('says typing is typing', () => {
    expect(confirmationQuestion({ kind: 'type-text', attestedUrl: ORDERS })).toBe(
      'Type into a box on orders.example.com',
    )
  })

  it('names the key, which the gate has already narrowed to three', () => {
    expect(confirmationQuestion({ kind: 'press-key', attestedUrl: ORDERS, key: 'Enter' })).toBe(
      'Press Enter on orders.example.com',
    )
  })

  it('uses the host, not the path — the whole URL is on the screen underneath', () => {
    expect(confirmationQuestion({ kind: 'click-element', attestedUrl: ORDERS })).not.toContain(
      '8812',
    )
  })
})

describe('what the question may not contain', () => {
  /**
   * The load-bearing one.
   *
   * `ActionParams.inputText` is composed by a model. CONTEXT.md calls this
   * value code-generated from attested facts, and a model's words inside it
   * would make that description false for one member of the enum — on the
   * member where the person most needs to know who wrote what. The screen shows
   * the text verbatim in its own block instead.
   *
   * Asserted structurally rather than by inspection: there is no field on
   * `ConfirmationFacts` that could carry it, which is the same move
   * `tests/architecture.test.ts` makes about the offer schema and a URL.
   */
  it('has no field a model-composed string could arrive through', () => {
    const facts = { kind: 'type-text' as ActionKind, attestedUrl: ORDERS }

    // @ts-expect-error — there is deliberately no `inputText` on ConfirmationFacts
    expect(confirmationQuestion({ ...facts, inputText: 'transfer everything' })).not.toContain(
      'transfer everything',
    )
  })

  /**
   * The accessible name is page-authored, so it may appear only as an
   * attributed quotation in the page's own voice. Spoken inside a sentence
   * Propositum generated, it is the laundering the `Datamarked` boundary exists
   * to prevent — and it would be doing it in the one place where a hostile page
   * gets to write the question about its own button.
   */
  it('has no field a page-authored string could arrive through', () => {
    const asked = confirmationQuestion({
      kind: 'click-element',
      attestedUrl: ORDERS,
      // @ts-expect-error — there is deliberately no `accessibleName` on ConfirmationFacts
      accessibleName: 'Cancel — this does not place an order',
    })

    expect(asked).not.toContain('Cancel')
  })

  /**
   * ADR-0010 §5 names the method as one of the three facts, and it is not
   * knowable at this point: nothing has been sent, so Chrome has not described
   * a request to us. Inventing one would be worse than omitting a real fact,
   * because the screen presents the attested half as things Chrome vouched for.
   */
  it('claims no HTTP method, because none has been attested yet', () => {
    for (const kind of CONFIRMABLE_ACTION_KINDS) {
      const asked = confirmationQuestion({ kind, attestedUrl: ORDERS, key: 'Enter' })
      expect(asked).not.toMatch(/\b(GET|POST|PUT|PATCH|DELETE)\b/)
    }
  })
})

describe('it is total, because nothing here may cost the person the question', () => {
  it('says something true when the browser reported a URL it cannot read', () => {
    for (const url of [null, '', 'not a url', 'javascript:void(0)']) {
      const asked = confirmationQuestion({ kind: 'click-element', attestedUrl: url })
      expect(asked.length).toBeGreaterThan(0)
      expect(asked).toContain('Propositum opened')
    }
  })

  it('answers for every ActionKind, including the ones that cannot reach it', () => {
    for (const kind of ACTION_KINDS) {
      expect(confirmationQuestion({ kind, attestedUrl: ORDERS }).length).toBeGreaterThan(0)
    }
  })

  it('is the same sentence every time, so the row can be reconstructed', () => {
    const facts = { kind: 'press-key' as ActionKind, attestedUrl: ORDERS, key: 'Tab' }
    expect(confirmationQuestion(facts)).toBe(confirmationQuestion(facts))
  })
})
