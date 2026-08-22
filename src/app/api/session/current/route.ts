/**
 * How the extension learns which session it is capturing, and gets its token.
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 *
 * `POST /api/session` mints a per-session bearer token, but only the caller
 * sees it. When a person starts a session from the UI, the extension never
 * learns the token and every event it posts is rejected with 403 — capture
 * silently does nothing while the interface says a session is running.
 *
 * That is the worst failure mode in the product: the person believes they are
 * being watched and they are not.
 *
 * ── Why handing the token over here is safe ──────────────────────────────
 *
 * This endpoint is credential-bearing, so it is guarded the same way event
 * submission is, minus the token it exists to supply:
 *
 *   - Proof the request was not page-initiated: our `Origin` when Chrome sends
 *     one, and `Sec-Fetch-Site: none` when it does not. Granting the loopback
 *     host permission the extension cannot work without makes Chrome drop the
 *     Origin header entirely — see `fromOurExtension`.
 *   - A custom header, which forces a preflight a hostile page cannot satisfy.
 *     Remember `text/plain` is CORS-safelisted — CORS alone stops nothing here.
 *
 * The remaining exposure is another extension the person installed
 * deliberately, which is outside this threat model: something with
 * `chrome-extension://` origin and knowledge of our header is already running
 * code the person approved.
 */

import { NextResponse } from 'next/server'
import { CUSTOM_HEADER, fromOurExtension } from '@/capture/transport'
import { appContext, existingAppContext } from '@/server/db'
import { ambientStore, captureStore, expectedOrigin } from '@/server/capture-store'
import { describeOffer, describePause, describeWork, signatureOf } from '@/server/ambient-store'
import type { NamedThread, WorkOffer } from '@/server/ambient-store'
import { nameThread } from '@/server/name-thread'
import { countQuietly } from '@/server/offer-tally'
import { composeOffer } from '@/server/compose-offer'
import { hashSignature } from '@/domain/detection/reticence'
import { createModelClient } from '@/model/provider'
import type { ModelCallSink } from '@/model/provider'
import {
  EVERY_STRAND,
  MAX_THREADS_SHOWN,
  detectPause,
  detectThreads,
} from '@/domain/detection/detect'
import type { WorkDetected } from '@/domain/detection/detect'

/**
 * Where the two ambient model calls are written down.
 *
 * ── Why the context is resolved inside the sink ──────────────────────────
 *
 * `subject` and `offer` are the only two boundaries that run with NO session
 * and NO contract, which makes them the two whose cost and failures were most
 * completely invisible — nothing else in the system records that they happened.
 * They are also the two on the cheapest path in the product: a 30-second poll
 * that returns before touching the database at all when nothing is detected.
 *
 * So the context is not hoisted. Awaiting `appContext()` above the ambient
 * branch would make the extension's heartbeat depend on a database handle it
 * does not otherwise need, and `build()` VERIFIES the append-only guards and
 * throws if one is missing — turning a poll that answers "nothing yet" into a
 * 500. Resolving it here instead keeps the poll's shape: the request never
 * awaits this, and a context that cannot be built loses the telemetry row
 * rather than the suggestion. `src/model/provider.ts` holds that rejection.
 *
 * No `runId`, and there never will be one here. Nothing on this path has
 * started a run — ADR-0008: *what detection produces is a suggestion, never a
 * session, never an action.*
 */
const recordAmbientCall: ModelCallSink = async (row) => {
  const { repos } = await appContext()
  return repos.modelCalls.create(row)
}

/**
 * How often this person has already said "not now" to this exact strand.
 *
 * ── Why `existingAppContext` and not `appContext` ────────────────────────
 *
 * Because `src/server/db.ts` has already settled this, in writing, for the
 * counter that reached the same way: *"the ambient endpoint keeps its shape of
 * touching no database on the request path"*, and the rule it drew is about
 * capability rather than wiring — **a caller on this path may read a database
 * somebody else opened, and may never open one.** `appContext()` here does open
 * one: it builds from `DATABASE_URL`, so a poll in a process that never wanted a
 * database gets one, and a poll in a `vitest` worker gets the developer's real
 * file. That is the loaded gun that docblock exists to have disarmed once.
 *
 * ── What that costs, named rather than rounded ───────────────────────────
 *
 * On a process that has not yet built a context this answers zero, so a strand
 * the person turned down last week can still be composed for and can still
 * reach the notification channel — once, in the window before anything serves a
 * page or a live-session poll. The front door has its own reticence gate and is
 * unaffected either way, because rendering Home builds a context by definition.
 *
 * It is the safe direction and that is why it is acceptable: a missing lookup
 * can only fail to NARROW. Nothing here can lower the bar below the published
 * floor — `groundsFor` clamps — so no reading of this function widens anything,
 * which is the asymmetry PRODUCT_PRINCIPLES §15 asks to be held.
 */
async function declinesAgainst(signature: string): Promise<number> {
  const context = existingAppContext()
  if (context === undefined) return 0

  const { repos } = await context
  const hash = hashSignature(signature, await repos.reticence.salt())

  // Absent from the map is "never declined". A row that is not there is not a
  // zero somebody wrote; it is a person who has not turned this down.
  return (await repos.reticence.declinesFor([hash])).get(hash) ?? 0
}

/** An origin, or an empty string. Never throws — a malformed stored URL is a
 *  ledger curiosity, not a reason to fail a poll the extension depends on. */
function safeOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/**
 * An `ObservationKind` as the detector's smaller vocabulary.
 *
 * The two that matter are `engaged` and `switchedAway`; everything else is an
 * arrival as far as `detectPause` is concerned. Anything unrecognised falls to
 * `navigation`, which is the conservative end: a new kind would count as
 * activity and delay a hand-off offer rather than produce one.
 */
function ambientKind(kind: string): 'navigation' | 'query' | 'engagement' | 'away' {
  if (kind === 'engaged') return 'engagement'
  if (kind === 'switchedAway') return 'away'
  if (kind === 'queried') return 'query'
  return 'navigation'
}

export async function GET(request: Request) {
  if (request.headers.get(CUSTOM_HEADER) !== '1') {
    return NextResponse.json({ ok: false, reason: 'missing-custom-header' }, { status: 403 })
  }

  // The same check event submission uses, from one definition. Chrome sends NO
  // Origin for a host-permitted loopback fetch, so this accepts either our
  // origin or a browser-attested non-page caller — see `fromOurExtension`.
  if (!fromOurExtension((name) => request.headers.get(name) ?? undefined, expectedOrigin())) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'bad-origin',
        // Said out loud because the most likely cause is a missing
        // PROPOSITUM_EXTENSION_ID, and a silent 403 sends people hunting the
        // wrong thing entirely.
        hint: `Expected ${expectedOrigin()}. Set PROPOSITUM_EXTENSION_ID in .env to your unpacked extension's id.`,
      },
      { status: 403 },
    )
  }

  const live = captureStore().current()

  /**
   * No session. Has Propositum noticed work anyway?
   *
   * The offer rides on the poll the extension already makes, rather than a
   * second endpoint on its own timer — one round trip, and the suggestion can
   * never be staler than the session state it arrives with.
   *
   * It is a SUGGESTION. Nothing here starts a session, approves a source or
   * records anything durable; accepting is a human act on a human's click.
   */
  if (!live) {
    const ambient = ambientStore()
    const now = Date.now()
    const observations = ambient.since(now)

    /**
     * Every strand the front door will show, named — and one of them composed
     * for. Only one suggestion comes back.
     *
     * ── Why this side does the work for a screen it does not render ──────
     *
     * Naming is cached against a signature in the ambient store, and this poll
     * is the only thing that runs on a timer. If it named only the strongest
     * strand, the second and third would arrive on Home with no subject — the
     * degraded sentence, forever, because Home is rendered on demand and there
     * is nothing there to kick a background call off from reliably. So the bound
     * is shared: `MAX_THREADS_SHOWN` decides what the screen shows and therefore
     * what this names.
     *
     * Composing does NOT follow that bound, and the gate below carries the
     * argument. The short version: a name is something the front door renders,
     * and an offer is something the extension interrupts with.
     *
     * ── What the extra strands cost, measured rather than estimated ──────
     *
     * **One naming call of about 2.7 seconds per strand shown**, once each, in
     * the background — `attemptedNaming` is keyed per signature, so a strand is
     * asked about once and never again for as long as the buffer lives.
     *
     * ~~Composing is usually free on top of that: `composeOffer` returns at its
     * own `grounds.sufficient` gate before spending anything, and a secondary
     * strand rarely clears the higher bar. So the honest worst case is three
     * naming calls and one offer, and the ordinary case is one naming call per
     * strand and no offer for the weak ones.~~
     *
     * **Struck 2026-08-17 — measured, and wrong in the reassuring direction.**
     * On the recorded three-strand afternoon this change was built around, TWO
     * of the three clear `grounds.sufficient`. The bar is one intent ground and
     * two investment ones, and a strand that was searched for, read for two
     * minutes and followed across three sites clears it whether or not it is the
     * strongest — being secondary is a ranking, not a weakness.
     * `tests/multiple-threads.test.ts` pins that number now, so the next guess
     * about it has to argue with a fixture.
     *
     * The ceiling that IS true, after the gate below: up to `MAX_THREADS_SHOWN`
     * naming calls, plus up to `COMPOSE_ATTEMPTS` offer calls for the one strand
     * the response is about. Not three naming calls and one offer — the offer
     * side is a retry bound, and that number belongs to `compose-offer.ts`.
     *
     * ── And the badge still names one thing ──────────────────────────────
     *
     * The response shape is unchanged: one `suggestion`, the strongest. The
     * extension badges and notifies from it, and ADR-0008 names interruption as
     * the expensive failure — three strands is more information for a screen
     * somebody opened, never three notifications.
     *
     * ── Filter first, then cut ───────────────────────────────────────────
     *
     * `EVERY_STRAND` and a `slice` at the end, rather than the bound handed to
     * the detector. Cutting first spent a slot on a strand the person had said
     * "not now" to and dropped a qualifying one off the end — off this pass as
     * well as off the screen, so it was never named and never `rememberThread`-
     * pinned either, and accepting it would have been refused for having no
     * pages. `noticedStrands` does the same thing in the same order, which is
     * what keeps the screen and this pass agreeing about which three exist.
     */
    const detected = detectThreads(observations, now, EVERY_STRAND)
      .filter(
        (thread) =>
          !ambient.isThreadSnoozed(signatureOf(thread.terms), now) &&
          !ambient.isSnoozed(thread.origins[0] ?? '', now),
      )
      .slice(0, MAX_THREADS_SHOWN)

    if (detected.length === 0) {
      return NextResponse.json({ ok: true, session: null, suggestion: null })
    }

    const apiKey = process.env['ANTHROPIC_API_KEY']

    /**
     * Each strand with what is known about it, in strength order.
     *
     * Collected as the loop goes rather than looked up again afterwards, so the
     * response describes what this pass saw — a background call landing between
     * two reads cannot make one answer disagree with itself.
     */
    const strands: {
      readonly detected: WorkDetected
      readonly signature: string
      readonly named: NamedThread | null
      readonly composed: WorkOffer | null
    }[] = []

    /**
     * A signature is an identity, so two strands must not share one.
     *
     * `signatureOf` keys the offer cache, the name cache, `rememberThread`, the
     * notification id and the durable `WorkOffer.threadSignature`. Threads are
     * disjoint in pages and a term on two threads' members would have seeded one
     * thread over both, so a collision should not be constructible — but "should
     * not" is not a guard, and the failure if one happened is the expensive one:
     * the second `rememberThread` would overwrite the first, and somebody
     * accepting one subject would get the other's sources approved. So the later
     * strand is dropped rather than allowed to overwrite, and the strongest one
     * keeps the signature.
     */
    const seen = new Set<string>()

    for (const thread of detected) {
      const signature = signatureOf(thread.terms)
      if (seen.has(signature)) continue
      seen.add(signature)

      /** Whether this is the strand the `suggestion` below will be about. The
       *  first one to survive the dedupe, because `detected` is in strength
       *  order and `strands[0]` is what `leading` reads. */
      const leads = strands.length === 0

      // Pin which pages this thread was made of, so accepting later carries the
      // thread and not everything that happened to be on the same sites. Done
      // before anything can be returned, because the signature is now the ONLY
      // thing the accept link carries and a thread nothing was recorded against
      // approves nothing at all.
      ambient.rememberThread(signature, thread.urls)

      const named = ambient.nameFor(signature)

      // Naming happens in the BACKGROUND. This poll exists to be cheap, a model
      // call takes about 2.7 seconds, and a failure must not take the offer with
      // it. The deterministic offer goes out now; the next poll carries the name.
      if (!named && apiKey) {
        void nameThread(ambient, createModelClient({ apiKey, record: recordAmbientCall }), thread)
      }

      const composed = ambient.offerFor(signature)

      /**
       * Composing needs a CONFIDENT name first.
       *
       * The subject boundary runs on titles and produces the two or three words
       * the offer is about; asking the offer boundary to invent that as well
       * would be one call doing two jobs.
       *
       * `confident: false` means the pages did not agree on a subject, and
       * `describeWork` already refuses to put an unsure name in a sentence for
       * exactly that reason. Composing on one would undo that at the next step:
       * `describeOffer` reads the offer's own `confident` flag, but the SUBJECT
       * it is about would already be a guess nobody flagged. A hedge that
       * survives one screen and not the next is not a hedge.
       *
       * The second, higher bar — `OfferGrounds.sufficient` — is checked inside
       * `composeOffer` rather than here, so the one function in the codebase that
       * can turn observation into a proposal to act carries its own gate. A guard
       * that lives only in its caller is a guard the next caller will not have.
       *
       * ── And only for the strand this response is about ────────────────────
       *
       * ~~It is also what keeps the secondary strands cheap: a weaker strand
       * returns there before it spends anything.~~
       *
       * **Struck 2026-08-17. Two of the recorded afternoon's three strands clear
       * that bar, and composing for all of them cost something nobody agreed
       * to.** It bought nothing visible: the front door renders the
       * deterministic sentence and the model's SUBJECT, never a composed offer,
       * and the one screen that renders an offer — `/start?thread=…` — is reached
       * from the badge, which names the leading strand. What it did buy was
       * measured. A strand that had never been advertised arrived at the next
       * poll already holding a `WorkOffer`, so the moment the leading strand was
       * turned down at the front door the poll returned `kind: 'work-offer'`
       * about a different subject and `service-worker.js` interrupted with a
       * `requireInteraction` notification for it. Reproduced: the second poll
       * held offers for strands one and two while strand one was still leading,
       * and the first poll after the decline notified about strand two.
       *
       * So the property this restores, which is the one worth having a name
       * for: **a strand cannot be ready to interrupt somebody before it has been
       * advertised.** A strand that leads later is composed then, one poll
       * behind, exactly as it was before this screen showed more than one.
       *
       * ── What this does NOT fix ───────────────────────────────────────────
       *
       * The front door's "Not now" still buys no quiet from the notification
       * channel. `declineThreadOffer` snoozes one signature; the next strand is
       * promoted, composed a poll later and notified about a poll after that —
       * roughly a minute, on an afternoon whose strands do not share a site.
       * `quietUntil` is written in exactly one place in `service-worker.js`,
       * inside the notification's own "Not now", and nothing on this path
       * reaches it. That is behaviour from before this screen showed several
       * strands rather than something introduced with them, and making one
       * decline silence the OTHERS is a product decision nobody has taken — the
       * screen currently promises the opposite. ADR-0008 carries it as a row of
       * its own rather than leaving it here.
       */
      if (leads && !composed && named?.confident && apiKey) {
        /**
         * The bar this strand has to clear, raised by what it has already been
         * told — ADR-0020.
         *
         * Looked up here rather than inside `composeOffer` because
         * `groundsFor` is pure and takes a number, so the impure half stops at
         * the edge. Asked only inside this branch, which is the one about to
         * spend a fifteen-second model call: a read costs nothing beside that,
         * and every other poll asks nothing of anybody. `declinesAgainst`
         * carries the argument for why it will not open a database to answer.
         */
        const declines = await declinesAgainst(signature)

        void composeOffer(
          ambient,
          createModelClient({ apiKey, record: recordAmbientCall }),
          thread,
          named,
          now,
          declines,
        )
      }

      strands.push({ detected: thread, signature, named, composed })
    }

    const leading = strands[0]
    if (leading === undefined) {
      return NextResponse.json({ ok: true, session: null, suggestion: null })
    }

    /**
     * The full offer when there is one; the degraded form otherwise.
     *
     * "Otherwise" covers three ordinary cases and they all matter: the grounds
     * bar is not met, composing has not finished yet (about fifteen seconds),
     * or there is no `ANTHROPIC_API_KEY` at all and there never will be one.
     * The last of those used to be a dead end — the extension linked to a page
     * that could not render — and it is now simply yesterday's behaviour.
     */
    const suggestion =
      leading.composed && leading.named
        ? describeOffer(
            leading.detected,
            leading.signature,
            leading.named.subject,
            leading.composed,
          )
        : describeWork(leading.detected, leading.signature, leading.named)

    /**
     * One strand advertised, counted once.
     *
     * ── Why the notification channel is the one that must not be missed ──
     *
     * `docs/PRODUCT_PRINCIPLES.md` §13 names notifications as *"the obvious
     * place this erodes first, because a notification is the cheapest thing to
     * add and the hardest to attribute"*, and it eroded there on 2026-08-17
     * exactly as predicted. This response is the only thing that ever reaches
     * that channel: the service worker badges from `suggestion` and turns a
     * `work-offer` into a `requireInteraction` notification. A count that
     * watched only Home would be blind to the half the principle warns about.
     *
     * ── Once per strand, not once per poll ───────────────────────────────
     *
     * This route runs every thirty seconds and returns the same leading strand
     * every time until something changes. Counting each response would report
     * an afternoon's one offer as a hundred and twenty. `newlyShown` is the
     * store's marker and it is shared with Home, so a strand rendered there and
     * badged here is one offer rather than two.
     *
     * What crosses to the counter is a boolean and an integer. Not the
     * signature, not the subject, not the origins — see `src/server/offer-tally.ts`,
     * which argues that against ADR-0008's refused row.
     */
    if (ambient.newlyShown(leading.signature)) countQuietly({ offersShown: 1 }, now)

    return NextResponse.json({ ok: true, session: null, suggestion })
  }

  const { repos } = await appContext()
  const session = await repos.sessions.byId(live.sessionId)
  if (!session) return NextResponse.json({ ok: true, session: null })

  const sources = await repos.projects.approvedSources(session.projectId)

  /**
   * A session IS running. Is this a natural point to hand over?
   *
   * Computed from the session's own ObservationEvents rather than from the
   * ambient buffer, which is not being fed while a session runs — the ledger
   * already holds exactly this, and double-recording the same browsing in two
   * places to save a mapping would be the worse trade.
   */
  const events = await repos.events.bySession(live.sessionId)
  const asAmbient = events.map((event) => {
    const attested = (event.attested ?? {}) as Record<string, unknown>
    const url = typeof attested['url'] === 'string' ? attested['url'] : ''
    const dwell = attested['dwellMs']

    return {
      at: event.observedAt.getTime(),
      origin: url === '' ? '' : safeOrigin(url),
      url,
      title: typeof attested['title'] === 'string' ? attested['title'] : '',
      // The kind has to survive the crossing. This flattened everything to
      // `navigation`, which threw away the one fact `detectPause` needs most:
      // `switchedAway` is `chrome.idle` saying the person left, and without it
      // the detector cannot tell an engagement report from a still-open tab
      // apart from somebody actually being here.
      kind: ambientKind(event.kind),
      ...(typeof dwell === 'number' ? { engagedMs: dwell } : {}),
    }
  })

  const pause = detectPause(asAmbient, Date.now())

  return NextResponse.json({
    ok: true,
    suggestion: pause === null ? null : describePause(pause),
    session: {
      id: live.sessionId,
      token: live.token,
      startedAtMs: live.startedAtMs,
      sources: sources
        .filter((s) => s.grantState === 'granted')
        .map((s) => ({
          id: s.id,
          // The extension matches an event's page against this, so it needs the
          // origin without the `/*` suffix.
          origin: s.originPattern.replace(/\/\*$/, ''),
          label: s.label,
        })),
    },
  })
}
