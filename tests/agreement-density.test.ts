/**
 * How much there is to read on the permission screen, as a budget.
 *
 * ── Why a number, on a screen whose words are pinned elsewhere ───────────
 *
 * `tests/agreement-honesty.test.ts` pins what this screen PROMISES, and it is
 * the right guard for that: "A permission screen is a promise in prose." It
 * cannot see the failure this file is about, because that failure is not a
 * wrong sentence. It is forty right ones.
 *
 * This screen reached ~700–850 rendered words across fourteen separate blocks
 * of explanatory copy, and every one of them was added for a good reason by
 * somebody who had just found a way to be misread. None of them was wrong.
 * Together they made the screen roughly three times the next-heaviest in the
 * product, on the way to a decision most people make the same way every time —
 * and a permission screen nobody finishes reading is a worse guard than a short
 * one they do.
 *
 * So the guard is a ceiling on what a person meets on arrival, and it is the
 * only thing standing against the way that number grew the first time: one
 * defensible paragraph at a time, each cheaper than the last.
 *
 * ── What the ceiling does NOT license ────────────────────────────────────
 *
 * Getting under it by moving the objective behind the disclosure. The two
 * fields above the fold are the prompt-injection catch (ADR-0006 §5) and their
 * words are part of this count on purpose: an author who needs room should cut
 * explanation, not the thing being reviewed. `tests/reachability.test.ts` and
 * `tests/agreement-words.test.ts` hold that side.
 *
 * The number is deliberately loose. It is a budget, not a target — the failure
 * it catches is a screen that has doubled, not one that gained a clause.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Agreement } from '../src/ui/agreement'
import type { ContractDrafted } from '../src/server/actions'
import type { AutonomyControls } from '../src/domain/handoff/policy'
import { grantableActionKinds } from '../src/domain/handoff/policy'

const DEFAULTS: AutonomyControls = {
  initiative: 'follow-closely',
  progress: 'current-step-only',
  output: 'draft-changes',
  interruption: 'stop-when-uncertain',
  timeLimitMinutes: 30,
}

/** ~~The heaviest honest case: a document shift, so every permission group has
 *  rows in it, and the screen is as long as it legitimately gets.~~
 *
 *  **Corrected 2026-09-01.** Since the panel split *"What you've switched off"*
 *  from *"What this agreement doesn't include"*, this fixture renders no
 *  switched-off group at all: it offers three kinds and the default dials
 *  compile all three, so nothing was removed. The heaviest case is a document
 *  shift under `suggestions-only`, where both off-groups have rows — and a
 *  browser shift with the dials untouched renders more words again.
 *
 *  The fixture is not changed, and the reason is what the ceiling is ON. Every
 *  permission group sits behind the Adjust disclosure, so the four combinations
 *  differ by a word or two on arrival, which is the only number asserted below.
 *  Swapping it would re-baseline what this file has measured since it was
 *  written for a difference the guard cannot see. What that costs, said plainly:
 *  nothing here measures the heaviest TOTAL, and nothing ever did. */
function markup(): string {
  const draft: ContractDrafted = {
    contractId: 'contract-1',
    objective: 'Work out which of the three quotes to accept',
    definitionOfDone: 'A note saying which, and why',
    words: { from: 'this-session' },
    suggestedTimeLimitMinutes: 30,
    approvedSourceIds: ['source-1'],
    allowedActionKinds: [...grantableActionKinds(true)],
    documentTitle: 'The quotes note',
    quotedConstraints: [],
  }

  return renderToStaticMarkup(
    createElement(Agreement, {
      draft,
      defaults: DEFAULTS,
      sourceLabels: { 'source-1': 'A supplier’s pricing page' },
      onBack: () => undefined,
      onHandedOver: () => undefined,
    }),
  )
}

/** Words a person could read. Tags and entities are not words; the inline
 *  stylesheet is not copy. */
function words(html: string): number {
  return (
    html
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .match(/\S+/g) ?? []
  ).length
}

function split(html: string): { readonly onArrival: number; readonly behindAdjust: number } {
  const stripped = html.replace(/<style[\s\S]*?<\/style>/g, '')
  const folded = stripped.match(/<div class="pp-more-body">([\s\S]*)<\/div><\/details>/)

  /* If this stops matching, the disclosure has been restructured and every
   * number below is measuring the wrong thing — so fail loudly rather than
   * quietly counting the whole screen as visible. */
  const body = folded?.[1]
  expect(body).toBeDefined()

  const behindAdjust = words(body ?? '')
  return { onArrival: words(stripped) - behindAdjust, behindAdjust }
}

describe('the permission screen stays readable on arrival', () => {
  it('meets a person with well under three hundred words', () => {
    const { onArrival } = split(markup())

    /* It was ~700–850. It is ~194 at the time of writing. 300 is the line at
     * which somebody should have to argue rather than simply add. */
    expect(onArrival).toBeLessThan(300)
  })

  it('folds the bulk of it away rather than deleting it', () => {
    const { onArrival, behindAdjust } = split(markup())

    /* The point is not that the screen says less. It is that it says the same
     * things in an order a person can stop reading. If this ever inverts —
     * more on arrival than behind Adjust — the disclosure has become
     * decoration and the screen is back to where it started. */
    expect(behindAdjust).toBeGreaterThan(onArrival)
  })

  it('keeps what is being ratified above the fold, not inside the fold', () => {
    const stripped = markup().replace(/<style[\s\S]*?<\/style>/g, '')
    const fold = stripped.indexOf('<details')

    /* Both fields, and the account of where their words came from, are read
     * before anything is opened. Getting under the ceiling by folding these
     * away would be removing the review, not shortening the screen. */
    const objective = stripped.indexOf('Work out which of the three quotes to accept')
    const done = stripped.indexOf('A note saying which, and why')
    const provenance = stripped.indexOf('Worked out from this session')

    expect(objective).toBeGreaterThan(-1)
    expect(objective).toBeLessThan(fold)
    expect(done).toBeLessThan(fold)
    expect(provenance).toBeLessThan(fold)
  })

  it('states what will happen where the person presses, not behind the fold', () => {
    const stripped = markup().replace(/<style[\s\S]*?<\/style>/g, '')

    /* Principle 15 forbids "a recommendation rendered so that accepting it is
     * indistinguishable from not reading it". The generated summary line is the
     * answer to that, so it has to be outside the disclosure — after it, beside
     * the button. */
    const summary = stripped.indexOf('class="ag-foot-line"')
    const closed = stripped.indexOf('</details>')

    expect(summary).toBeGreaterThan(closed)
    expect(stripped).toContain('For up to')
  })
})
