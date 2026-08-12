/**
 * The one question the extension is allowed to ask about a paused run.
 *
 * ── It is a READ, and that is the whole design ───────────────────────────
 *
 * There is no POST here and there must never be one. This endpoint tells the
 * extension that somebody is being waited on and where the screen is; it cannot
 * answer a confirmation, and neither can anything the extension does. The only
 * writers of a `ConfirmationVerdict` are two server actions reached from a page
 * a human is looking at.
 *
 * That constraint is what makes the notification safe to show at all. A
 * notification with an Approve button would be approving without seeing what
 * you are approving — and a channel that could carry the approval would make
 * that button one line of code away forever.
 *
 * ── The four transport controls still apply ──────────────────────────────
 *
 * ADR-0002 requires them on every extension-facing path, and this one carries
 * no bearer token because it belongs to no session — a paused run outlives the
 * session that started it, and inventing a token for it would mean minting a
 * credential for a poll. What remains is the pair that proves the caller is not
 * a page: the custom header, which forces a preflight a hostile page cannot
 * satisfy, and `fromOurExtension`, which accepts our `Origin` when Chrome sends
 * one and `Sec-Fetch-Site: none` when it does not.
 *
 * What that leaves exposed is worth stating: a page in the browser cannot read
 * this, and another extension the person installed deliberately could. The
 * second is outside this threat model — it is already running code they
 * approved — and what it would learn is one code-generated sentence and one id.
 * It could not act on either.
 */

import { NextResponse } from 'next/server'

import { CUSTOM_HEADER, fromOurExtension } from '@/capture/transport'
import { appContext } from '@/server/db'
import { expectedOrigin } from '@/server/capture-store'
import { oldestPendingConfirmation } from '@/server/confirmations'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  if (request.headers.get(CUSTOM_HEADER) !== '1') {
    return NextResponse.json({ ok: false, reason: 'missing-custom-header' }, { status: 403 })
  }

  if (!fromOurExtension((name) => request.headers.get(name) ?? undefined, expectedOrigin())) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'bad-origin',
        hint: `Expected ${expectedOrigin()}. Set PROPOSITUM_EXTENSION_ID in .env to your unpacked extension's id.`,
      },
      { status: 403 },
    )
  }

  const ctx = await appContext()
  const pending = await oldestPendingConfirmation(ctx, Date.now())

  if (!pending) return NextResponse.json({ ok: true, confirmation: null })

  return NextResponse.json({
    ok: true,
    confirmation: {
      id: pending.requestId,
      /**
       * CODE-GENERATED from attested facts, which is why it is safe to put in
       * a notification at all. It is not model prose and it is not the page's
       * words: a model that could write the sentence asking for its own
       * permission is a model that can argue for itself, and a page that could
       * would be writing its own consent dialog.
       */
      summary: pending.summary,
      askedAtMs: pending.askedAtMs,
      /** Where *Show me* goes. The screen, never an answer. */
      href: `/shifts/${pending.contractId}/confirm/${pending.requestId}`,
    },
  })
}
