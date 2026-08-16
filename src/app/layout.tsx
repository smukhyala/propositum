import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

/**
 * The one sentence that travels: the tab, a link preview, a search result.
 *
 * It used to read *"Understands where you were going, and keeps going while you
 * are away."* That is **session altitude** — one sitting, interrupted and
 * resumed — and it was accurate about what shipped while being smaller than
 * what the product is for. What a person is working toward outlives the
 * sitting, so ADR-0011 puts the `Intention` above the `WorkSession` and this
 * sentence follows it up a level. *"What you're working toward"* is the
 * consumer wording `CONTEXT.md` ratifies for an `Intention`, so it is the
 * wording used here.
 *
 * ── The first attempt at that overshot, and was pulled back ──────────────
 *
 * It briefly read *"Everything you are working toward keeps moving, even while
 * you are away."* **ADR-0011 raises the altitude of the documents; it does not
 * put a second intention or a scheduler in the product**, and this is the one
 * string that reaches people who have opened neither. *Everything* is
 * `ROADMAP.md`'s Stage 4 — several persistent intentions — which
 * [`VISION.md`](../../docs/VISION.md) marks **Later** in the same paragraph as
 * *"Today it has nothing to schedule."* *Keeps moving* asserts the scheduling
 * half of that stage: at most one `Intention` hangs off a `Project`, one live
 * session at a time is enforced in the app layer, and nothing advances either
 * on a timer. So the replacement was less true than the sentence it replaced,
 * which is the wrong way round for a correction and is what PRODUCT_PRINCIPLES
 * §11 rules against in exactly this direction.
 *
 * What ships is singular and is about resumption: Propositum recognises work it
 * has seen before, and carries a handoff on while nobody is watching. The
 * sentence claims that and stops.
 *
 * *"While you are away"* is kept through both revisions, on purpose. It is the
 * wedge every other document says to keep, and it is the half of the sentence
 * that says what Propositum is actually for rather than what it is about.
 */
export const metadata: Metadata = {
  title: 'Propositum',
  description: 'Picks up what you were working toward, and keeps going while you are away.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
