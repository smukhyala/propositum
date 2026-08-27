/**
 * The three screens that stand between a person and a blank rectangle.
 *
 * ── The failure these exist for ──────────────────────────────────────────
 *
 * Every page in this app is `force-dynamic` and awaits the database before it
 * can render a word. Until 2026-08-26 that meant three different ways to end up
 * looking at nothing:
 *
 *   - a cold start painted white until SQLite opened and the append-only guards
 *     verified;
 *   - a render throw hit Next's default error page, which says "a client-side
 *     exception has occurred" and nothing a person could act on;
 *   - a stale link hit Next's default 404 — black Helvetica, no way back, no
 *     theme — on the two occasions somebody is most likely to be lost.
 *
 * `error.tsx` landed first. `loading.tsx` and `not-found.tsx` landed with this
 * file.
 *
 * ── Why the assertions are on WORDS ──────────────────────────────────────
 *
 * The same reason `tests/agreement-honesty.test.ts` and
 * `tests/handover-honesty.test.ts` give. A boundary screen's entire job is what
 * it says, there is no structural check that separates "Propositum could not
 * read its own records" from an empty `<main>`, and a file that exists is not
 * the property — a file that SAYS something is. Existence alone would pass on a
 * component that returned `null`.
 *
 * ── The one thing here that is not a render ──────────────────────────────
 *
 * `notFound()` having callers. A root `not-found.tsx` catches unmatched URLs
 * whether or not anything calls `notFound()`, so on its own it is a screen for
 * typing mistakes. What makes it part of the product is that three real screens
 * throw into it when an id stops resolving. If those calls were removed this
 * file would still render the screen happily, which is exactly the shape
 * `tests/reachability.test.ts` exists to refuse — so the callers are asserted
 * here rather than assumed.
 *
 * ── Cost, stated ─────────────────────────────────────────────────────────
 *
 * One `renderToStaticMarkup` per screen and no interaction, inherited from the
 * harness `tests/calendar-agreement.test.ts` argues for. `useEffect` does not
 * run and nothing can be pressed. Neither matters: all three of these screens
 * are decided entirely at render time, which is the whole point of them.
 *
 * What this does NOT check: that Next actually mounts them. The file names are
 * a framework convention and nothing in this repository can prove the framework
 * honours it — `npm run build` is what would notice a typo in a filename, and
 * the by-hand step in `docs/todo/04-quick-fixes.md` is what notices the rest.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import LoadingScreen from '../src/app/loading'
import NotFoundScreen from '../src/app/not-found'
import ErrorScreen from '../src/app/error'

const repo = fileURLToPath(new URL('..', import.meta.url))

/** The words, as a person reads them. Curly quotes and entities normalised for
 *  the reason `tests/agreement-honesty.test.ts` normalises them: a typographic
 *  choice is not a difference in what was said. */
function words(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&mdash;|&#x2014;/g, '—')
    .replace(/&hellip;|&#x2026;/g, '…')
    .replace(/&larr;|&#x2190;/g, '←')
    .replace(/&rsquo;|&#x2019;/g, '’')
    .replace(/&ldquo;|&#x201C;/g, '“')
    .replace(/&rdquo;|&#x201D;/g, '”')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/* ── loading ─────────────────────────────────────────────────────────────── */

describe('the first paint says something is happening', () => {
  const html = renderToStaticMarkup(createElement(LoadingScreen))

  it('renders the wordmark, so the screen is recognisably Propositum', () => {
    expect(words(html)).toContain('Propositum')
  })

  it('says what is being waited on rather than that something is loading', () => {
    // "Loading…" is what the browser already implies. The one thing a person
    // does not know is WHAT is slow, and on a cold start it is always the
    // database — which is also the thing `error.tsx` explains when it fails.
    expect(words(html)).toContain('Reading its own records')
  })

  it('estimates nothing and claims no progress', () => {
    // Principle 11, in the direction that matters here: a progress bar over an
    // unknown wait is an invented number, and a spinner claims motion is
    // progress. Both are a false statement about our own state.
    expect(words(html)).not.toMatch(/\d+\s*%|almost|nearly|a few seconds|shortly/i)
  })

  it('pulls in no client bundle, or it cannot appear immediately', () => {
    // A fallback whose entire job is to be on screen before anything else must
    // not wait on a download to do it. `src/ui/primitives.tsx` is 'use client'
    // and imports `motion`.
    const source = readFileSync(join(repo, 'src/app/loading.tsx'), 'utf8')

    expect(source).not.toContain("'use client'")
    expect(source).not.toMatch(/from '@\/ui\//)
    expect(source).not.toMatch(/from 'motion/)
  })
})

/* ── not found ───────────────────────────────────────────────────────────── */

describe('a link that no longer resolves lands somewhere that says so', () => {
  const html = renderToStaticMarkup(createElement(NotFoundScreen))

  it('says the address is empty, not that something went wrong', () => {
    // A 404 is an ordinary outcome. Wording it as a failure would send somebody
    // looking for damage that is not there.
    expect(words(html)).toContain('There is nothing at this address.')
    expect(words(html)).toContain('not there any more')
  })

  it('says nothing has been lost, because that is the first worry', () => {
    expect(words(html)).toContain('Nothing has been lost')
  })

  it('offers the way back, so the screen is not a dead end', () => {
    expect(html).toContain('href="/"')
    expect(words(html)).toContain('All projects')
  })

  it('guesses nothing from the path it was reached by', () => {
    // It has a URL and no id it could resolve. "Did you mean" from a path
    // segment is a suggestion invented out of a string.
    expect(words(html)).not.toMatch(/did you mean|perhaps you|try searching/i)
  })

  it('is thrown into by real screens, or it is a screen for typing mistakes', () => {
    // The property that makes this part of the product rather than a courtesy
    // for mistyped URLs. Each of these is a real id that has stopped resolving.
    const callers = [
      'src/app/projects/[projectId]/page.tsx',
      'src/app/sessions/[sessionId]/page.tsx',
      'src/app/shifts/[contractId]/confirm/[requestId]/page.tsx',
    ]

    for (const caller of callers) {
      expect(
        readFileSync(join(repo, caller), 'utf8'),
        `${caller} no longer calls notFound() — a missing row renders something else now`,
      ).toMatch(/\bnotFound\(\)/)
    }
  })
})

/* ── error ───────────────────────────────────────────────────────────────── */

describe('a screen that could not be built says which kind of broken it is', () => {
  const behind = (message: string) =>
    renderToStaticMarkup(
      createElement(ErrorScreen, { error: new Error(message), reset: () => undefined }),
    )

  it('recognises the one failure it can actually name', () => {
    const html = behind('append-only guards cannot be installed: table missing')

    expect(words(html)).toContain('Your database is older than this copy of Propositum.')
    expect(words(html)).toContain('npx prisma db push')
    // The setup half: nothing is damaged, and the worker is down for the same
    // reason. Both are things a person would otherwise go looking for.
    expect(words(html)).toContain('this is a setup step, not damage')
    expect(words(html)).toContain('worker is refusing to start for the same reason')
  })

  it('admits to not knowing rather than inventing a likely cause', () => {
    const html = behind('ECONNRESET')

    expect(words(html)).toContain('does not know enough about what went wrong')
    expect(words(html)).toContain('will not guess')
    // And it points at the place that does know, which in a dev build is the
    // only place the real message survives.
    expect(words(html)).toContain('npm run dev')
  })

  it('does not offer the database advice for an error it did not recognise', () => {
    // Failing closed. An unrecognised error getting a confident "run this
    // command" is worse than the generic branch, because the command is wrong.
    expect(words(behind('ECONNRESET'))).not.toContain('npx prisma db push')
  })
})

/* ── all three, as a set ─────────────────────────────────────────────────── */

describe('the boundaries exist where Next looks for them', () => {
  it('all three are at the app root, so every route is covered', () => {
    // Nested boundaries would be better per-screen and are not what is claimed
    // here. At the root, one file covers every route including ones added
    // later, which is the property worth having while there are eight of them.
    const present = readdirSync(join(repo, 'src/app'))

    for (const file of ['loading.tsx', 'error.tsx', 'not-found.tsx']) {
      expect(present, `src/app/${file} is missing — that route boundary is gone`).toContain(file)
    }
  })
})
