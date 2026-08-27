'use client'

/**
 * What a person sees when a screen could not be built.
 *
 * ── Why this exists at all ───────────────────────────────────────────────
 *
 * One case, and it is the one somebody hits on their first afternoon: a database
 * older than the code. `ensureAppendOnlyGuards` throws `SchemaBehindError`, every
 * route awaits a context, and every page becomes a blank 500. The terminal says
 * what to do; the browser said nothing at all, which is the wrong way round —
 * the browser is where they were looking.
 *
 * ── What it will not do ──────────────────────────────────────────────────
 *
 * **It does not guess.** Next redacts a server error's message in a production
 * build and hands the client a `digest` instead, so this can only recognise the
 * one case where the message survives — a development build, which is the only
 * place this failure occurs, because it is a setup step. Anything it cannot
 * recognise gets the honest version: something broke, the terminal knows more,
 * here is the way back. Inventing a likely cause would be worse than admitting
 * to one, and Principle 11 is about exactly that.
 *
 * It also does not retry automatically. `reset()` is behind a control a person
 * presses, because a boundary that retried on its own would spin against a
 * database that will not be fixed by asking twice.
 */

import Link from 'next/link'

const CSS = `
.er-col { max-width: 34rem; margin: 0 auto; padding: 4.5rem 1.5rem; }
.er-wordmark { font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.3em; text-transform: uppercase; color: var(--ink); margin: 0 0 3rem; }
.er-say { font-family: var(--serif); font-weight: 400; font-size: clamp(1.5rem, 5vw, 2rem); line-height: 1.24; letter-spacing: -0.015em; margin: 0; text-wrap: pretty; }
.er-then { font-family: var(--serif); font-size: 1.0625rem; line-height: 1.55; color: var(--muted); margin: 1.15rem 0 0; text-wrap: balance; }
.er-code { font-family: var(--mono); font-size: 0.8125rem; background: var(--raised); border: 1px solid var(--rule); border-radius: 2px; padding: 0.75rem 0.9rem; margin: 1.15rem 0 0; overflow-x: auto; white-space: pre; color: var(--ink); }
.er-note { font-family: var(--mono); font-size: 0.75rem; line-height: 1.65; color: var(--muted); margin: 1.5rem 0 0; }
.er-acts { display: flex; flex-wrap: wrap; gap: 1.25rem; align-items: baseline; margin-top: 1.75rem; }
.er-go { font-family: var(--mono); font-size: 0.75rem; color: var(--ink); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
`

/**
 * Recognised by the sentence the error carries, not by a class.
 *
 * A client boundary receives a plain `Error` rebuilt across the server boundary,
 * so `instanceof SchemaBehindError` is always false here — the class does not
 * survive serialisation. Matching the text is the honest way to say *"only when
 * we can actually tell"*, and it fails closed: an unrecognised error gets the
 * general branch rather than this advice.
 */
function isSchemaBehind(error: Error): boolean {
  return /append-only guards cannot be installed/i.test(error.message)
}

export default function ErrorScreen({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string }
  readonly reset: () => void
}) {
  const behind = isSchemaBehind(error)

  return (
    <main className="er-col">
      <style href="propositum-error" precedence="default">
        {CSS}
      </style>

      <p className="er-wordmark">Propositum</p>

      {behind ? (
        <>
          <h1 className="er-say">Your database is older than this copy of Propositum.</h1>
          <p className="er-then">
            A table it needs has not been created yet. Nothing is wrong with the work already in
            there &mdash; this is a setup step, not damage.
          </p>
          <p className="er-code">npx prisma db push</p>
          <p className="er-note">
            Then restart <code>npm run dev</code>. The worker is refusing to start for the same
            reason and will come back with it.
          </p>
        </>
      ) : (
        <>
          <h1 className="er-say">This screen could not be built.</h1>
          <p className="er-then">
            Propositum does not know enough about what went wrong to tell you anything useful, and
            it will not guess. The terminal running <code>npm run dev</code> has the actual error.
          </p>
          {error.digest === undefined ? null : (
            <p className="er-note">Reference: {error.digest}</p>
          )}
        </>
      )}

      <div className="er-acts">
        <button className="er-go" type="button" onClick={reset}>
          Try again
        </button>
        <Link className="er-go" href="/">
          Go to the front door
        </Link>
      </div>
    </main>
  )
}
