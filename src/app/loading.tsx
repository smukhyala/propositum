/**
 * What a person sees while a screen is still being built.
 *
 * ── Why this exists at all ───────────────────────────────────────────────
 *
 * Every page here is `force-dynamic` and awaits the database before it can
 * render a single word, so the first paint on a cold start is a blank white
 * rectangle for as long as SQLite takes to open and the append-only guards take
 * to verify. A blank screen is indistinguishable from a broken one, and the
 * screen a person lands on is the screen that has to say something is happening.
 *
 * Next wraps `page.tsx` and every nested layout in a `<Suspense>` boundary for
 * this file automatically. `src/app/layout.tsx` reads no runtime data, which is
 * the condition the framework attaches to that promise — a layout that awaited
 * something would block navigation and this fallback would never show.
 *
 * ── What it will not do ──────────────────────────────────────────────────
 *
 * **It does not spin, and it does not estimate.** A spinner claims motion is
 * progress, and a progress bar over an unknown wait is an invented number —
 * Principle 11 rules out both. It says the one true thing and stops.
 *
 * **It imports nothing from `src/ui`.** The primitives are a client bundle with
 * a motion dependency, and a fallback whose job is to appear immediately must
 * not wait on a download to do it. The cost of that decision is the one this
 * file states rather than hides: the wordmark rule here is a second copy of the
 * one in `src/app/error.tsx`, and the two have to be changed together.
 */

const CSS = `
.ld-col { max-width: 34rem; margin: 0 auto; padding: 4.5rem 1.5rem; }
.ld-wordmark { font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.3em; text-transform: uppercase; color: var(--ink); margin: 0 0 3rem; }
.ld-say { font-family: var(--serif); font-weight: 400; font-size: clamp(1.5rem, 5vw, 2rem); line-height: 1.24; letter-spacing: -0.015em; margin: 0; color: var(--muted); text-wrap: pretty; }
`

export default function LoadingScreen() {
  return (
    <main className="ld-col">
      <style href="propositum-loading" precedence="default">
        {CSS}
      </style>

      <p className="ld-wordmark">Propositum</p>
      <h1 className="ld-say">Reading its own records&hellip;</h1>
    </main>
  )
}
