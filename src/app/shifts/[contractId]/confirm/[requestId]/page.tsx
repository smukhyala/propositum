/**
 * The confirmation screen's data half.
 *
 * The rendering lives in `src/ui/confirm.tsx`, and the split is the usual one
 * in this codebase: the page reads durable rows and the component draws them.
 * It also makes the property that matters here provable without a browser — a
 * test can render `ConfirmationScreen` over a seeded request and count the
 * controls, which is the assertion standing in for ADR-0004's missing
 * capability.
 *
 * ── Why the picture is inlined rather than served ────────────────────────
 *
 * A screenshot of somebody's authenticated session is the most sensitive
 * byte-string this product holds. An endpoint that serves one by id is a second
 * door onto it, guarded separately, forever. Inlined as a `data:` URI it
 * renders under the same page load that already established the person is here,
 * and `ActionEvidence` is swept — it belongs to the acting ledger, not to the
 * person's own browsing — so nothing here is long-lived.
 */

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { BackLink, Sheet } from '@/ui/primitives'
import { ConfirmationScreen, SettledConfirmation } from '@/ui/confirm'
import { appContext } from '@/server/db'
import { confirmationView, unansweredReason } from '@/server/confirmations'
import { confirmOnePendingRequest, rejectOnePendingRequest } from '@/server/actions'

/** Read fresh every time. A cached copy of a question about something
 *  irreversible is the one page that must never be stale. */
export const dynamic = 'force-dynamic'

export default async function ConfirmPage({
  params,
}: {
  params: Promise<{ contractId: string; requestId: string }>
}) {
  const { contractId, requestId } = await params
  const ctx = await appContext()

  const view = await confirmationView(ctx, requestId, Date.now())
  if (!view) notFound()

  // The request belongs to another shift. A 404 rather than a quiet redirect: a
  // link naming the wrong contract is a link somebody constructed, and
  // correcting it silently would make the id in the URL decorative.
  if (view.contractId !== contractId) notFound()

  const back = `/shifts/${contractId}`

  /**
   * Three ways this is already over, and only one of them is a verdict.
   *
   * `abandoned` joined on 2026-09-01. Before it, a question raised by a run
   * that ended some other way was neither answered nor expired, so it fell past
   * this branch into the live screen with both buttons — under a sentence
   * promising that Propositum picks the work up again afterwards, which by then
   * was false. The answer path turned the yes down; this screen had offered it.
   *
   * Which sentence to show when a question is both is `unansweredReason`'s to
   * decide, not this file's. `confirmRequest` breaks the same tie off the same
   * two facts, and a tie broken in two places is how one row acquires two
   * explanations.
   */
  if (view.verdict !== null || view.expired || view.abandoned) {
    return (
      <Sheet>
        <BackLink href={back}>&larr; While you were away</BackLink>
        <SettledConfirmation
          summary={view.summary}
          verdict={view.verdict}
          unanswered={unansweredReason(view)}
        >
          Nothing on this page can be changed now. What happened next is in &ldquo;While you were
          away&rdquo;.{' '}
          <Link href={back}>Go and look.</Link>
        </SettledConfirmation>
      </Sheet>
    )
  }

  /**
   * Both answers are ordinary server actions on a form.
   *
   * They are also the only two writers of a `ConfirmationVerdict` in the
   * product, and both are reached from here — a screen a human is looking at,
   * showing what they are authorising. No model, worker run or reviewer run has
   * a path to either.
   */
  async function goAhead() {
    'use server'
    const result = await confirmOnePendingRequest(requestId)
    if (!result.ok) redirect(`${back}?problem=${encodeURIComponent(result.problem.message)}`)
    redirect(back)
  }

  async function dont() {
    'use server'
    const result = await rejectOnePendingRequest(requestId)
    if (!result.ok) redirect(`${back}?problem=${encodeURIComponent(result.problem.message)}`)
    redirect(back)
  }

  const imageSrc = await (async () => {
    if (!view.evidenceId || !view.hasImage) return null
    const row = await ctx.repos.evidence.byId(view.evidenceId)
    if (!row?.image) return null
    return `data:image/png;base64,${Buffer.from(row.image).toString('base64')}`
  })()

  return (
    <Sheet>
      <BackLink href={back}>&larr; While you were away</BackLink>
      <ConfirmationScreen
        detail={{
          summary: view.summary,
          pastDeadline: view.pastDeadline,
          attested: view.attested,
          typedText: view.typedText,
          pageAuthored: view.pageAuthored,
          imageSrc,
        }}
        goAhead={goAhead}
        dont={dont}
      />
    </Sheet>
  )
}
