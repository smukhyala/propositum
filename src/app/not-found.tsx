/**
 * What a person sees when the thing at that address is not there.
 *
 * ── Why this is not left to the framework ────────────────────────────────
 *
 * Next ships a default 404 — black Helvetica on white, no way back, and no
 * theme. It is the one screen in the product that would have said nothing in
 * Propositum's voice, and it is reached on the two occasions a person is most
 * likely to be lost: a stale link, and a row that pointed at work they have
 * since deleted.
 *
 * ── This is genuinely reached, which is the part worth checking ──────────
 *
 * A root `not-found.tsx` catches unmatched URLs, and if that were all it did it
 * would be a screen for typing mistakes. It is not: `notFound()` already has
 * three callers on the paths a person actually walks —
 * `src/app/projects/[projectId]/page.tsx`, `src/app/sessions/[sessionId]/page.tsx`
 * and `src/app/shifts/[contractId]/confirm/[requestId]/page.tsx`. Every one of
 * them is a real id that has stopped resolving.
 * `tests/route-boundaries.test.ts` asserts those callers still exist, because a
 * boundary reached only by mistyped URLs is decoration and should be able to be
 * told apart from this.
 *
 * ── Why it uses the primitives when `error.tsx` deliberately does not ────
 *
 * `src/app/error.tsx` builds its own markup because the machinery might be the
 * thing that is broken. Nothing is broken here — a missing row is an ordinary
 * outcome — so this reads as an ordinary screen, and matches `Missing()` in
 * `src/app/shifts/[contractId]/page.tsx`, which is the bespoke version of this
 * screen that already existed for one route. Two 404s that look like two
 * products is the failure this avoids.
 *
 * ── What it will not do ──────────────────────────────────────────────────
 *
 * **It does not guess what you were looking for.** It has the URL and nothing
 * else — no id it could resolve, no history it could search — and offering
 * "did you mean" from a path segment would be inventing a suggestion out of a
 * string. The way back is the front door, which is where every project is.
 */

import Link from 'next/link'

import { Sheet, Masthead, Empty, BackLink } from '@/ui/primitives'
import { Unknown } from '@/ui/sprites'

export default function NotFoundScreen() {
  return (
    <Sheet>
      <BackLink href="/">&larr; All projects</BackLink>
      <Masthead
        kicker="Propositum"
        title="There is nothing at this address."
        mark={<Unknown size={20} />}
        subtitle="Either the link is wrong, or what it pointed at is not there any more."
      />
      <Empty
        title="Nothing to show."
        next="Nothing has been lost — this address simply does not resolve to anything. Start from the front door, which lists every project Propositum knows about."
        action={
          <Link className="pp-back" href="/">
            All projects
          </Link>
        }
      />
    </Sheet>
  )
}
