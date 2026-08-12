/**
 * The classifier that decides when to stop and ask.
 *
 * Its one guarantee is an ASYMMETRY, not an accuracy claim: page-derived
 * evidence may escalate `ordinary` to `requires-confirmation` and may never do
 * the reverse. That is what makes a function eating untrusted input compatible
 * with ADR-0006, so it is tested as a property over the whole input space
 * rather than sampled at a few interesting points.
 *
 * Nothing here asserts the classifier catches every irreversible control. It
 * does not, it cannot, and a test claiming otherwise would be the dangerous
 * kind of green.
 */

import { describe, it, expect } from 'vitest'
import {
  IRREVERSIBLE_INTENT_TOKENS,
  classifyReversibility,
} from '../src/domain/execution/reversibility'
import type { ElementEvidence } from '../src/domain/execution/reversibility'
import { ACTION_KINDS, CONFIRMABLE_ACTION_KINDS } from '../src/domain/handoff/policy'
import type { ActionKind } from '../src/domain/handoff/policy'

/** A plainly harmless control: named, not a submit, not in a form. */
const harmless: ElementEvidence = {
  accessibleNameTokens: ['Show', 'more'],
  role: 'button',
  isSubmitControl: false,
  isInsideForm: false,
  formHasSensitiveField: false,
}

const e = (over: Partial<ElementEvidence> = {}): ElementEvidence => ({ ...harmless, ...over })

const CONFIRMABLE = ACTION_KINDS.filter((k) => CONFIRMABLE_ACTION_KINDS.has(k))
const NOT_CONFIRMABLE = ACTION_KINDS.filter((k) => !CONFIRMABLE_ACTION_KINDS.has(k))

describe('reading never confirms', () => {
  it('classifies every non-confirmable kind as ordinary, whatever the page says', () => {
    // Evidence is not consulted at all for these. A page must not be able to
    // make a read look like something that needed permission, any more than it
    // can make a purchase look like a read.
    const hostile = e({
      accessibleNameTokens: ['Buy', 'now'],
      isSubmitControl: true,
      isInsideForm: true,
      formHasSensitiveField: true,
    })

    for (const kind of NOT_CONFIRMABLE) {
      expect(classifyReversibility(kind, hostile)).toBe('ordinary')
      expect(classifyReversibility(kind, null)).toBe('ordinary')
    }
  })

  it('covers the kinds that do drive a page', () => {
    // Guards against the filter above silently matching nothing.
    expect([...CONFIRMABLE].sort()).toEqual(['click-element', 'press-key', 'type-text'])
  })
})

describe('absent or malformed evidence escalates', () => {
  it('returns requires-confirmation for null', () => {
    // The cheapest attack on a name-based check is to remove the name, so the
    // fail direction has to be the safe one.
    for (const kind of CONFIRMABLE) {
      expect(classifyReversibility(kind, null)).toBe('requires-confirmation')
    }
  })

  it('returns requires-confirmation for undefined arriving where null was promised', () => {
    // The annotation is a claim; the value crossed a JSON boundary. Reading a
    // property off `undefined` would throw inside the authorization path, and a
    // throw is not a recorded decision.
    for (const kind of CONFIRMABLE) {
      expect(
        classifyReversibility(kind, undefined as unknown as ElementEvidence | null),
      ).toBe('requires-confirmation')
    }
  })

  it('returns requires-confirmation for each way the shape can be wrong', () => {
    const malformed: unknown[] = [
      { ...harmless, accessibleNameTokens: 'Buy now' },
      { ...harmless, accessibleNameTokens: [1, 2] },
      { ...harmless, role: 42 },
      { ...harmless, isSubmitControl: 'false' },
      { ...harmless, isInsideForm: null },
      { ...harmless, formHasSensitiveField: undefined },
      { ...harmless, ref: 12 },
      { ...harmless, snapshotId: {} },
      {},
    ]

    for (const evidence of malformed) {
      expect(classifyReversibility('click-element', evidence as ElementEvidence)).toBe(
        'requires-confirmation',
      )
    }
  })

  it('returns requires-confirmation for an element with no accessible name', () => {
    // The accepted cost: a bare ✕ or a hamburger generates a confirmation
    // nobody needed. Better than a Buy button with its label stripped off.
    expect(classifyReversibility('click-element', e({ accessibleNameTokens: [] }))).toBe(
      'requires-confirmation',
    )
    expect(classifyReversibility('click-element', e({ accessibleNameTokens: ['', '  '] }))).toBe(
      'requires-confirmation',
    )
  })
})

describe('the escalating signals', () => {
  it('escalates a submit control', () => {
    expect(classifyReversibility('click-element', e({ isSubmitControl: true }))).toBe(
      'requires-confirmation',
    )
  })

  it('escalates anything inside a form holding a password or a card number', () => {
    expect(classifyReversibility('click-element', e({ formHasSensitiveField: true }))).toBe(
      'requires-confirmation',
    )
  })

  it('escalates a keypress inside a form, whichever key it is', () => {
    // Enter submits on most pages, and press-key carries no element to inspect
    // — the target is whatever holds focus, which the page can move between our
    // snapshot and our keystroke.
    expect(classifyReversibility('press-key', e({ isInsideForm: true }))).toBe(
      'requires-confirmation',
    )
    // ...but a keypress outside a form on a named element is ordinary, or the
    // rule would be "never press a key", which is not a rule, it is a removal.
    expect(classifyReversibility('press-key', e({ isInsideForm: false }))).toBe('ordinary')
  })

  it('escalates every token in the lexicon', () => {
    for (const token of IRREVERSIBLE_INTENT_TOKENS) {
      expect(
        classifyReversibility('click-element', e({ accessibleNameTokens: [token] })),
        `"${token}" did not escalate`,
      ).toBe('requires-confirmation')
    }
  })

  it('sees through capitalisation and punctuation', () => {
    // A page cannot dodge the lexicon by writing "Buy!" or "Buy-now", because
    // splitting on non-alphanumerics can only produce MORE matches.
    for (const name of ['Buy', 'BUY', 'buy!', 'Buy-now', '(purchase)', 'Send…']) {
      expect(
        classifyReversibility('click-element', e({ accessibleNameTokens: [name] })),
        `"${name}" did not escalate`,
      ).toBe('requires-confirmation')
    }
  })

  it('leaves a plainly harmless named control alone', () => {
    // Without this the classifier would be "always confirm", which is not a
    // safeguard — it is a way to teach someone to click yes without reading.
    expect(classifyReversibility('click-element', harmless)).toBe('ordinary')
    expect(classifyReversibility('type-text', e({ isInsideForm: true }))).toBe('ordinary')
  })
})

describe('page-derived evidence may ONLY escalate', () => {
  /** Every boolean combination, crossed with a few name shapes. */
  function allEvidence(): ElementEvidence[] {
    const names: readonly (readonly string[])[] = [
      [],
      ['Show', 'more'],
      ['Buy', 'now'],
      ['Continue'],
      ['✕'],
    ]
    const out: ElementEvidence[] = []
    for (const accessibleNameTokens of names) {
      for (const isSubmitControl of [false, true]) {
        for (const isInsideForm of [false, true]) {
          for (const formHasSensitiveField of [false, true]) {
            out.push({
              accessibleNameTokens,
              role: 'button',
              isSubmitControl,
              isInsideForm,
              formHasSensitiveField,
            })
          }
        }
      }
    }
    return out
  }

  const ALL = allEvidence()

  it('has a space worth calling exhaustive', () => {
    expect(ALL).toHaveLength(5 * 2 * 2 * 2)
  })

  it('never de-escalates when a page-authored flag turns on', () => {
    // The property, stated directly: if some evidence already requires
    // confirmation, no amount of ADDITIONAL page assertion can turn it back
    // into ordinary. So the worst a hostile page can do is make us ask.
    const escalations: Array<(x: ElementEvidence) => ElementEvidence> = [
      (x) => ({ ...x, isSubmitControl: true }),
      (x) => ({ ...x, isInsideForm: true }),
      (x) => ({ ...x, formHasSensitiveField: true }),
      (x) => ({ ...x, accessibleNameTokens: [...x.accessibleNameTokens, 'delete'] }),
      (x) => ({ ...x, accessibleNameTokens: [...x.accessibleNameTokens, 'checkout'] }),
    ]

    for (const kind of CONFIRMABLE) {
      for (const evidence of ALL) {
        const before = classifyReversibility(kind, evidence)
        for (const escalate of escalations) {
          const after = classifyReversibility(kind, escalate(evidence))
          if (before === 'requires-confirmation') {
            expect(after, `${kind} de-escalated under ${JSON.stringify(evidence)}`).toBe(
              'requires-confirmation',
            )
          }
        }
      }
    }
  })

  it('never produces ordinary from a starting point that required confirmation', () => {
    // The same property from the other direction, and the one that matters most:
    // null evidence requires confirmation, so no evidence a page could supply
    // may be treated as MORE permissive than supplying none at all... except
    // where it genuinely is harmless, which is the entire point of asking.
    // What must never happen is a page-authored field being the thing that
    // relaxes a rule — so every ordinary answer below comes from the ABSENCE of
    // an escalating signal, never from the presence of a reassuring one.
    for (const kind of CONFIRMABLE) {
      for (const evidence of ALL) {
        if (classifyReversibility(kind, evidence) !== 'ordinary') continue

        // If it is ordinary, then every escalating flag must be off. There is
        // no combination where a set flag is offset by another field.
        expect(evidence.isSubmitControl).toBe(false)
        expect(evidence.formHasSensitiveField).toBe(false)
        expect(evidence.accessibleNameTokens.length).toBeGreaterThan(0)
      }
    }
  })

  it('is deterministic and total over every kind', () => {
    for (const kind of ACTION_KINDS as readonly ActionKind[]) {
      for (const evidence of [...ALL, null]) {
        const once = classifyReversibility(kind, evidence)
        const twice = classifyReversibility(kind, evidence)
        expect(once).toBe(twice)
        expect(['ordinary', 'requires-confirmation']).toContain(once)
      }
    }
  })
})
