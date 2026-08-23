/**
 * The shape of the re-entry surface, pinned before it is simplified.
 *
 * ── The gap this exists for ──────────────────────────────────────────────
 *
 * `ShiftReport`, `ChangeCard` and `OutcomeCard` are the most control-dense
 * screens in the product and NOTHING RENDERED THEM. `tests/agreement-honesty`
 * pins the agreement's prose, `tests/confirmation-pause` §8 pins the
 * confirmation's two buttons, and between them sits the whole re-entry note
 * with no render test at all. A regression there would be silent — which is
 * the same failure `tests/reachability.test.ts` was written for, one layer up.
 *
 * A UI simplification is about to cut this surface's prose hard. That is a
 * deliberate diff, and a deliberate diff needs a before.
 *
 * ── Why the assertions are on STRUCTURE, and where they are on WORDS ─────
 *
 * The wording here is CHANGING ON PURPOSE, so pinning sentences would pin the
 * thing being fixed and this file would read as an obstacle rather than a
 * guard. So the assertions are on what must survive any rewrite:
 *
 *   - one verdict control per decidable unit, and NONE beside a landed one
 *   - the section order re-entry finding 1 fixed
 *   - "Accept all" inert while a question is open
 *
 * The exceptions are the section headings, and they are not incidental copy:
 * CONTEXT.md fixes "While you were away", "What I need from you", "What I did"
 * and "What I missed" as the consumer wording for `ShiftReport`,
 * `DecisionNeeded`, and the log sections. Pinning a glossary term is pinning
 * the glossary, not the prose around it — and the order is the finding.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ShiftReport } from '../src/ui/shift-report'
import type { ShiftReportProps } from '../src/ui/shift-report'
import { ChangeCard } from '../src/ui/diff'
import type { ChangeView } from '../src/ui/diff'
import { WhatIMade } from '../src/ui/outcome'
import type { OutcomeView } from '../src/ui/outcome'

/* ── builders ───────────────────────────────────────────────────────────── */

function change(over: Partial<ChangeView> = {}): ChangeView {
  return {
    id: 'change-1',
    where: 'Rates',
    scaleLabel: 'changed 4 words',
    scaleKind: 'edited',
    before: 'The rate held at four percent.',
    after: 'The rate held at four and a half percent.',
    reason: 'The partner page gives a different figure.',
    verdict: null,
    ...over,
  }
}

function outcome(over: Partial<OutcomeView> = {}): OutcomeView {
  return {
    id: 'outcome-1',
    kind: 'answer',
    landed: false,
    headline: 'The south shore forecast, day by day',
    reason: 'You asked for the official zone forecast.',
    items: [],
    body: 'Tuesday: fair. Wednesday: showers.',
    addressedTo: null,
    where: null,
    whatYouCanDo: null,
    verdict: null,
    changeCount: null,
    ...over,
  }
}

function report(over: Partial<ShiftReportProps> = {}): ShiftReportProps {
  return {
    kicker: 'The forecast note',
    narrative: 'I read the zone forecast and wrote the days out.',
    window: {
      startedLabel: '3:41 pm',
      endedLabel: '4:14 pm',
      approximate: false,
      approximateWhy: null,
    },
    tally: '6 of 9 steps · 1 decision for you',
    decisions: [],
    made: [],
    changes: [],
    noChangesNext: 'Nothing was proposed, which is what research only means.',
    did: [{ id: 'did-1', time: '3:44 pm', sentence: 'Read the zone forecast page', mark: 'done' }],
    didnt: [],
    missed: [],
    stopped: { sentence: 'I ran out of time.', detail: null },
    resume: 'Pick up at the Wednesday line.',
    up: { href: '/projects/p1', label: 'Kauai' },
    contractId: 'contract-1',
    alreadyPutIn: null,
    ...over,
  }
}

const DECISION = {
  id: 'decision-1',
  question: 'Which shore did you mean?',
  whyStopped: 'The page covers four of them.',
  needs: 'Say which one and I can finish.',
}

/** `renderToStaticMarkup` gives the first paint: no interaction, and every
 *  `useState` at its initial value. That is exactly the arrival state a person
 *  meets, which is what this file is about. */
function html(props: ShiftReportProps): string {
  return renderToStaticMarkup(createElement(ShiftReport, props))
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/* ── the sections, and the order the prototype fixed ─────────────────────── */

describe('the re-entry note keeps the order re-entry finding 1 fixed', () => {
  it('puts what I need from you above the changes', () => {
    const markup = html(report({ decisions: [DECISION], changes: [change()] }))

    const needed = markup.indexOf('What I need from you')
    const changes = markup.indexOf('What I did')

    expect(needed).toBeGreaterThan(-1)
    expect(needed).toBeLessThan(changes)
  })

  it('runs what I did, what I didn&rsquo;t do, what I missed in that order', () => {
    const markup = html(
      report({
        did: [{ id: 'a', time: '3:44 pm', sentence: 'Read the page', mark: 'done' }],
        didnt: [
          { id: 'b', time: null, sentence: 'Could not open the second site', mark: 'refused' },
        ],
        missed: [{ id: 'c', time: '4:02 pm', sentence: 'I stopped seeing your work', mark: 'gap' }],
      }),
    )

    const did = markup.indexOf('What I did')
    const didnt = markup.indexOf('What I didn')
    const missed = markup.indexOf('What I missed')

    expect(did).toBeGreaterThan(-1)
    expect(didnt).toBeGreaterThan(did)
    expect(missed).toBeGreaterThan(didnt)
  })

  it('keeps the refusals section, which the prototype found does the most work', () => {
    const markup = html(
      report({ didnt: [{ id: 'b', time: null, sentence: 'Not allowed', mark: 'refused' }] }),
    )

    expect(markup).toContain('What I didn')
  })
})

/* ── the batch control, and the question it must not step over ───────────── */

describe('accept all stays inert while a question is open', () => {
  it('is disabled when a decision is unsettled', () => {
    const markup = html(
      report({ decisions: [DECISION], changes: [change(), change({ id: 'c2' })] }),
    )

    /* The button exists, and it cannot be pressed. Both halves matter: hiding
     * it would be a different answer to re-entry finding 2, and a quieter one
     * than the prototype argued for. */
    expect(markup).toContain('Accept all')
    const button = markup.slice(markup.indexOf('Accept all') - 400, markup.indexOf('Accept all'))
    expect(button).toContain('disabled')
  })

  it('leaves per-change accept live while the batch control is blocked', () => {
    const markup = html(report({ decisions: [DECISION], changes: [change()] }))

    /* "Per-change Accept stays live throughout: deciding one change at a time
     * is exactly the deliberate act the batch button skips." */
    expect(occurrences(markup, '>Accept<')).toBeGreaterThan(0)
  })
})

/* ── the decidable unit, which is what H2 counts ─────────────────────────── */

describe('a verdict control appears once per decidable unit and never beside a landed one', () => {
  it('offers accept and reject on an undecided change', () => {
    const markup = renderToStaticMarkup(
      createElement(ChangeCard, { change: change(), onDecide: () => undefined }),
    )

    expect(markup).toContain('>Accept<')
    expect(markup).toContain('>Reject<')
  })

  it('offers no verdict beside a landed outcome, not even a disabled one', () => {
    const markup = renderToStaticMarkup(
      createElement(WhatIMade, {
        outcomes: [outcome({ id: 'landed-1', kind: 'external-effect', landed: true })],
        busy: false,
        onDecide: () => undefined,
      }),
    )

    /* "a disabled control still says there is a decision here that you have
     * missed, and there is not." So: no control at all. */
    expect(markup).not.toContain('>Accept<')
    expect(markup).not.toContain('>Reject<')
  })

  it('counts one verdict row per decidable outcome when landed ones are mixed in', () => {
    const markup = renderToStaticMarkup(
      createElement(WhatIMade, {
        outcomes: [
          outcome({ id: 'o1' }),
          outcome({ id: 'o2', kind: 'collection', items: ['4.1%', '4.4%'], body: null }),
          outcome({ id: 'landed-1', kind: 'external-effect', landed: true }),
        ],
        busy: false,
        onDecide: () => undefined,
      }),
    )

    /* Two decidable, one landed — so two Accepts, not three. This is the
     * invariant H2's denominator rests on: what is rendered as decidable is
     * what `isDecidable` admits. */
    expect(occurrences(markup, '>Accept<')).toBe(2)
    expect(occurrences(markup, '>Reject<')).toBe(2)
  })

  it('shows the decision already recorded instead of the controls', () => {
    const markup = renderToStaticMarkup(
      createElement(ChangeCard, {
        change: change({ verdict: 'accept' }),
        onDecide: () => undefined,
      }),
    )

    expect(markup).not.toContain('>Accept<')
    expect(markup).toContain('You accepted this.')
  })
})

/* ── the summary leads, the diff is the evidence ─────────────────────────── */

describe('a change reads as a summary with the diff behind it', () => {
  it('puts why it was proposed above the changed text', () => {
    const markup = renderToStaticMarkup(
      createElement(ChangeCard, { change: change(), onDecide: () => undefined }),
    )

    /* markdown-diff-review §0.3: "the ranked list of what changed and why is
     * the interface; the diff is the evidence you expand into." */
    const why = markup.indexOf('The partner page gives a different figure.')
    /* The rendered attribute, not the bare class name — every one of these
     * components ships its own stylesheet inline, so `pd-body` on its own
     * matches the CSS rule near the top of the markup and would compare the
     * reason against the wrong thing entirely. */
    const diff = markup.indexOf('class="pd-body"')

    expect(why).toBeGreaterThan(-1)
    expect(diff).toBeGreaterThan(why)
  })

  it('never puts a reveal inside a reveal', () => {
    const markup = renderToStaticMarkup(
      createElement(ChangeCard, {
        change: change({
          scaleKind: 'rewritten',
          scaleLabel: 'rewrote 2 sentences',
          before: 'Payment is due in thirty days.',
          after: 'Payment falls due within thirty days of invoice.',
        }),
        onDecide: () => undefined,
      }),
    )

    /* A rewrite is the one shape where the old text is the only way to judge
     * the new one, and it sat behind its own `<details>` before the card was
     * inverted. Nesting them charges twice for the same opt-in and puts it two
     * gestures deep. One level, on every shape. */
    expect(markup.split('<details').length - 1).toBe(1)
    expect(markup).toContain('Payment is due in thirty days.')
  })

  it('keeps the changed text in the document rather than behind a fetch', () => {
    const markup = renderToStaticMarkup(
      createElement(ChangeCard, { change: change(), onDecide: () => undefined }),
    )

    /* A `<details>` collapses its children; it does not remove them. That is
     * why this reveal is safe for find-in-page and for a screen reader's browse
     * mode, and it is the property that would be lost by rebuilding the same
     * effect with client state. */
    expect(markup).toContain('<details')
    expect(markup).toContain('and a half')
  })
})

/* ── the diff, and WCAG 1.4.1 ───────────────────────────────────────────── */

describe('the diff does not carry meaning in colour alone', () => {
  it('marks added and removed runs with a name, not a hue', () => {
    /* A change with BOTH directions in it. The default fixture is a pure
     * addition, which would pass the added half and prove nothing about the
     * other one — the failure this assertion exists to catch is a restyle that
     * keeps one and drops the other. */
    const markup = renderToStaticMarkup(
      createElement(ChangeCard, {
        change: change({
          before: 'The rate held at four percent.',
          after: 'The rate rose to four and a half percent.',
        }),
        onDecide: () => undefined,
      }),
    )

    /* Re-entry finding 10: colour-only diffs fail WCAG 1.4.1 at Level A and
     * are not announced by most screen readers even with ins/del. The glyph
     * and the visually-hidden name are the fix, and they are structural — a
     * restyle must not be able to remove them. */
    expect(markup).toMatch(/added:/i)
    expect(markup).toMatch(/removed:/i)
  })
})

/* ── the empty and the absent ────────────────────────────────────────────── */

describe('the note renders the honest empty cases', () => {
  it('renders with no narrative, because the boundary fails open', () => {
    const markup = html(report({ narrative: null }))

    /* "with it gone the top of the screen is just a time window, which is the
     * least useful version" — but it must still render. */
    expect(markup).toContain('While you were away')
  })

  it('says nothing was proposed rather than reporting an absence as a failure', () => {
    const markup = html(report({ changes: [], made: [] }))

    expect(markup).toContain('Propositum proposed no text.')
  })
})
