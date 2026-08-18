/**
 * The one invariant this whole feature rests on, executed rather than grepped.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * *"Free/busy may SUGGEST a time limit that a person then ratifies. It may
 * never set one."* Until 2026-08-18 the only thing standing between a busy
 * interval and `AutonomyControls.timeLimitMinutes` was three regular
 * expressions in `tests/calendar-scope.test.ts`, each written against one
 * SPELLING of the mistake:
 *
 *     expect(agreement.code).not.toMatch(/useState\([^)]*calendarSuggestion/)
 *
 * `[^)]*` cannot cross a `)`. So the initialiser that is actually there —
 * `useState(TIME_CHOICES.includes(x) ? x : nearestChoice(x))` — hides any
 * reference to the calendar behind the first close-paren, and this passes:
 *
 *     : nearestChoice(draft.calendarSuggestion?.minutes ?? draft.suggested…)
 *
 * That mutation makes the dial arrive from Google with no human press, and it
 * was verified to leave the full suite green and `tsc --noEmit` clean. The
 * guard tested for a shape; the property is *what number is checked when the
 * screen first renders*, and only rendering the screen can answer that.
 *
 * ── What this is, and what it is not ─────────────────────────────────────
 *
 * This is the repo's first component test and it is deliberately the smallest
 * possible one: `renderToStaticMarkup` from `react-dom/server`, which needs no
 * DOM, no jsdom, and no new dependency — the same React that ships the app.
 *
 * The cost, stated rather than discovered later: **static markup is one render
 * and no interaction.** Nothing here can press the button, so the "and pressing
 * it DOES change the limit" half is not proved here — it is proved by the
 * button calling the identical `onChange` a radio calls, which is a reading and
 * is asserted as one in `tests/calendar-scope.test.ts`. What this file proves
 * is the half that matters more, because it is the half that would be a broken
 * promise rather than a broken feature: **before any press, the dial holds the
 * model's number.**
 *
 * `useEffect` also does not run under `renderToStaticMarkup`, which is why the
 * "you'd have it back by about…" line is absent from the markup below. An
 * effect that pushed the suggestion into the state would therefore NOT be
 * caught here — that shape is caught by the grep, and the two guards are
 * complementary rather than redundant.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Agreement } from '../src/ui/agreement'
import type { ContractDrafted } from '../src/server/actions'
import type { AutonomyControls } from '../src/domain/handoff/policy'
import type { CalendarTimeSuggestion } from '../src/server/calendar'

/** A Tuesday, and a busy interval three hours after it. */
const NOW = 1_786_471_000_000
const BUSY_FROM = NOW + 3 * 60 * 60_000

const DEFAULTS: AutonomyControls = {
  initiative: 'follow-closely',
  progress: 'current-step-only',
  output: 'draft-changes',
  interruption: 'stop-when-uncertain',
  timeLimitMinutes: 30,
}

function draftWith(
  proposal: number,
  suggestion: CalendarTimeSuggestion | null,
): ContractDrafted {
  const base = {
    contractId: 'contract-1',
    objective: 'Work out which of the three quotes to accept',
    definitionOfDone: 'A note saying which, and why',
    suggestedTimeLimitMinutes: proposal,
    approvedSourceIds: ['source-1'],
    allowedActionKinds: [],
    documentTitle: null,
    quotedConstraints: [],
  } as const

  // Absent, not null — the same distinction `withCalendarSuggestion` keeps.
  return suggestion === null ? base : { ...base, calendarSuggestion: suggestion }
}

function screen(proposal: number, suggestion: CalendarTimeSuggestion | null): string {
  return renderToStaticMarkup(
    createElement(Agreement, {
      draft: draftWith(proposal, suggestion),
      defaults: DEFAULTS,
      sourceLabels: { 'source-1': 'A supplier’s pricing page' },
      onBack: () => undefined,
      onHandedOver: () => undefined,
    }),
  )
}

/** The value of the one checked radio in the time-limit group. */
function checkedTimeLimit(html: string): number | null {
  for (const [, value] of html.matchAll(
    /<input type="radio" name="timeLimit" checked="" value="(\d+)"\/>/g,
  )) {
    return Number(value)
  }
  return null
}

/** Everything the screen says, with the stylesheet taken out — the sheet ships
 *  whether or not anybody has a calendar, and its comments name one. */
function copy(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, '')
}

describe('the calendar suggestion is offered, never applied', () => {
  it('leaves the dial on the model’s number when a suggestion is present', () => {
    // The model proposed 30. The calendar would allow 120. The screen must
    // arrive on 30, because nobody has pressed anything.
    const html = screen(30, { minutes: 120, busyFromMs: BUSY_FROM })

    expect(checkedTimeLimit(html)).toBe(30)
    expect(copy(html)).not.toContain('checked="" value="120"')
  })

  it('leaves it on the model’s number even when that number is off the dial', () => {
    // The branch the shipped mutation hid in: a proposal that is not one of the
    // five choices takes the `nearestChoice` path, and THAT is where a calendar
    // number could be substituted without any regex noticing. 47 rounds to 60
    // by proximity; the calendar's 240 must not appear.
    const html = screen(47, { minutes: 240, busyFromMs: BUSY_FROM })

    expect(checkedTimeLimit(html)).toBe(60)
  })

  it('and exactly one radio is checked, so “which number” is a real question', () => {
    const html = screen(30, { minutes: 120, busyFromMs: BUSY_FROM })
    const checked = [...html.matchAll(/name="timeLimit" checked=""/g)]

    expect(checked).toHaveLength(1)
  })
})

describe('the number carries where it came from', () => {
  it('says so, and offers the calendar’s number as something to press', () => {
    const said = copy(screen(30, { minutes: 120, busyFromMs: BUSY_FROM }))

    expect(said).toContain('Your calendar has you busy from')
    expect(said).toContain('Stop by then')
    // A duration a person can read, drawn from the dial's own set.
    expect(said).toContain('2 hours')
  })

  it('KEEPS saying so once the limit equals the suggestion', () => {
    // This is the state pressing the button produces. The provenance sentence
    // used to be hidden by the same condition that hid the button, so the one
    // press that made a budget calendar-derived also removed the only sentence
    // saying it was — and a person ratified it with nothing on screen to read.
    const said = copy(screen(120, { minutes: 120, busyFromMs: BUSY_FROM }))

    expect(said).toContain('Your calendar has you busy from')
    // ...and the button is gone, because it would now change nothing.
    expect(said).not.toContain('Stop by then')
  })

  it('names a clock time and never an event', () => {
    const said = copy(screen(30, { minutes: 120, busyFromMs: BUSY_FROM }))

    // The scope returns `start` and `end` and nothing else, so there is no
    // title to render and no field that could carry one. This is the render-time
    // half of `tests/calendar-scope.test.ts`'s source-level refusal.
    expect(said).toMatch(/busy from <strong>\d{1,2}:\d{2} (am|pm)<\/strong>/)
    expect(said).not.toMatch(/summary|organiser|organizer|attendee/i)
  })
})

describe('a person with no calendar cannot tell this shipped', () => {
  it('renders no calendar sentence and no calendar button at all', () => {
    const said = copy(screen(30, null))

    expect(said).not.toContain('Your calendar')
    expect(said).not.toContain('Stop by then')
    expect(said).not.toContain('ag-cal')
  })

  it('renders the same time-limit group it always did', () => {
    const without = copy(screen(30, null))
    const with_ = copy(screen(30, { minutes: 120, busyFromMs: BUSY_FROM }))

    expect(checkedTimeLimit(without)).toBe(30)
    // The suggestion adds one paragraph and changes nothing else on the screen:
    // strip that paragraph and the two renders are the same document.
    expect(with_.replace(/<p class="ag-hint ag-cal">[\s\S]*?<\/p>/, '')).toBe(without)
  })
})
