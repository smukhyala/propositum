/**
 * The first run: one ask, then consent cards, on a page that always tells
 * the truth.
 *
 * ── Markup and one call ──────────────────────────────────────────────────
 *
 * Every decision about what is done and what comes first lives in
 * `src/server/first-run.ts`, for the reason `src/app/page.tsx` gives about
 * its own derivations: *"a decision that fails silently does not live in a
 * `.tsx` file."* This page renders in two places — `/first-run` in a
 * browser, and the window the tray opens on first launch — and both show
 * the same truth because there is no other source of it.
 *
 * ── Not a wizard, still ──────────────────────────────────────────────────
 *
 * Nothing is stored about where somebody "is". The one thing that is
 * genuinely not a fact about the machine — the opening ask's answer — lives
 * in the URL (`?for=act|watch|connect`), routes the order of the cards, and
 * touches nothing durable: refresh with it and your ordering keeps, arrive
 * without it and the ask is asked again.
 *
 * ── Where the honesty is load-bearing ────────────────────────────────────
 *
 *   - **Skipping everything is a working install and the page says so.**
 *     The design's own sentence: value is deferred, not missing.
 *   - **The watching card is not authentication and says so** — the person
 *     clicking is the authorisation, exactly as Chrome's own Allow is.
 *   - **The key card is a fallback.** A build carrying ADR-0028's bundled
 *     key makes the key fact simply true, and this page then never says the
 *     words "API key" — the trail hides the row too. Presence is not
 *     validity: a revoked bundled key still reads as set here, and that
 *     failure surfaces where it always has, one menu from the tray.
 *   - **The calendar's OAuth callback lands on the front door**, not back
 *     here — predates this page, acceptable because the card re-reads truth
 *     on the next render.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Sheet, Button, Disclosure } from '@/ui/primitives'
import { Watching, Handover, Done } from '@/ui/sprites'
import { firstRunState, consentOrder } from '@/server/first-run'
import type { FirstRunState, FirstRunStep, ConsentSource } from '@/server/first-run'
import { calendarRow } from '@/server/calendar'
import type { CalendarRow } from '@/server/calendar'
import { pairingInFlight } from '@/server/thread'
import {
  beginThreadPairing,
  completeThreadPairing,
  forgetThread,
  pairExtensionAction,
} from '@/server/actions'

/** Read fresh every time. A setup screen that cached would be a setup screen
 *  telling somebody to do a thing they have already done. */
export const dynamic = 'force-dynamic'

const MARK_SIZE = 44
const MARK_PEN = 1

const CSS = `
.fr-col { max-width: 34rem; margin: 0 auto; }
.fr-wordmark { font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.3em; text-transform: uppercase; color: var(--ink); margin: 0 0 3rem; }
.fr-mark { display: block; color: var(--ink); margin: 0 0 1.5rem; }
.fr-say { font-family: var(--serif); font-weight: 400; font-size: clamp(1.5rem, 5.2vw, 2rem); line-height: 1.24; letter-spacing: -0.015em; margin: 0; text-wrap: pretty; }
.fr-then { font-family: var(--serif); font-size: 1.0625rem; line-height: 1.55; color: var(--muted); margin: 1.15rem 0 0; text-wrap: balance; }
.fr-note { font-family: var(--mono); font-size: 0.75rem; line-height: 1.65; color: var(--muted); margin: 1.15rem 0 0; }
.fr-problem { font-family: var(--serif); font-size: 1.0625rem; line-height: 1.5; color: var(--ink); border-left: 2px solid var(--ink); padding-left: 1.05rem; margin: 0 0 2.5rem; }

.fr-ask { list-style: none; padding: 0; margin: 2rem 0 0; }
.fr-ask li { border-top: 1px solid var(--rule); }
.fr-ask li:last-child { border-bottom: 1px solid var(--rule); }
.fr-ask a { display: block; padding: 1.1rem 0.2rem; text-decoration: none; color: var(--ink); font-family: var(--serif); font-size: 1.125rem; }
.fr-ask a:hover { background: var(--raised); }
.fr-ask .fr-ask-then { display: block; font-family: var(--mono); font-size: 0.7rem; color: var(--muted); margin-top: 0.35rem; }

.fr-card { border: 1px solid var(--rule); border-radius: 2px; padding: 1.5rem 1.6rem; margin-top: 1.5rem; }
.fr-card-say { font-family: var(--serif); font-weight: 400; font-size: 1.25rem; line-height: 1.3; margin: 0; color: var(--ink); }
.fr-card-state { font-family: var(--mono); font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 0 0 0.6rem; }

.fr-acts { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin-top: 1.35rem; }
.fr-field { font-family: var(--mono); font-size: 0.8125rem; padding: 0.5rem 0.65rem; border: 1px solid var(--rule); background: var(--ground); color: var(--ink); border-radius: 2px; width: 100%; max-width: 30rem; }
.fr-code { font-family: var(--mono); font-size: 0.75rem; background: var(--raised); border: 1px solid var(--rule); border-radius: 2px; padding: 0.75rem 0.9rem; margin: 1.15rem 0 0; overflow-x: auto; white-space: pre; color: var(--ink); }

.fr-knock { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: baseline; margin-top: 1.35rem; padding-top: 1.35rem; border-top: 1px solid var(--rule); }
.fr-knock:first-of-type { border-top: none; }
.fr-id { font-family: var(--mono); font-size: 0.8125rem; color: var(--ink); word-break: break-all; }

.fr-steps { list-style: none; padding: 0; margin: 3.5rem 0 0; border-top: 1px solid var(--rule); }
.fr-step { display: grid; grid-template-columns: 1.5rem 1fr; gap: 0.75rem; align-items: baseline; padding: 0.7rem 0; border-bottom: 1px solid var(--rule); font-family: var(--mono); font-size: 0.75rem; color: var(--muted); }
.fr-step-done { color: var(--ink); }
.fr-tick { color: var(--ink); }

.fr-crit { list-style: none; padding: 0; margin: 1.15rem 0 0; }
.fr-crit li { font-family: var(--mono); font-size: 0.75rem; line-height: 1.9; color: var(--muted); }

.fr-calm { margin-top: 2.5rem; padding-top: 1.5rem; border-top: 1px solid var(--rule); }
`

/** What each step is called once it is behind you. Mono, quiet, checkable. */
const STEP_LABEL: Record<FirstRunStep, string> = {
  key: 'a key to think with',
  extension: 'the extension paired',
  sources: 'sites you have allowed',
  watching: 'something worth offering',
  phone: 'your phone',
}

const ASKS = ['act', 'watch', 'connect'] as const
type Ask = (typeof ASKS)[number]

/** The trail hides the key row whenever the key fact is simply true — a
 *  bundled-key build never mentions keys, which is ADR-0028 working. */
function Trail({ state }: { readonly state: FirstRunState }) {
  const steps = (Object.keys(STEP_LABEL) as FirstRunStep[]).filter(
    (step) => step !== 'key' || !state.done.key,
  )
  return (
    <ul className="fr-steps">
      {steps.map((step) => (
        <li key={step} className={state.done[step] ? 'fr-step fr-step-done' : 'fr-step'}>
          <span className="fr-tick" aria-hidden="true">
            {state.done[step] ? '✓' : '○'}
          </span>
          <span>
            {STEP_LABEL[step]}
            {state.done[step] ? '' : ' — not yet'}
          </span>
        </li>
      ))}
    </ul>
  )
}

function ExtensionCard({
  state,
  pair,
}: {
  readonly state: FirstRunState
  readonly pair: (form: FormData) => Promise<void>
}) {
  const paired = state.pairedExtension !== null
  return (
    <section className="fr-card">
      <p className="fr-card-state">{paired ? 'Watching — allowed' : 'Watching — not yet'}</p>
      <h2 className="fr-card-say">What may Propositum watch?</h2>

      {!paired && state.knocking.length === 0 ? (
        <>
          <p className="fr-then">
            It watches through a Chrome extension, and only on sites you allow one by one. Open{' '}
            <code>chrome://extensions</code>, turn on Developer mode, choose{' '}
            <strong>Load unpacked</strong>, and pick this folder:
          </p>
          <p className="fr-code">{state.extensionFolder}</p>
          <p className="fr-note">
            It announces itself here within half a minute. This page does not refresh itself —
            reload it once you have.
          </p>
        </>
      ) : null}

      {!paired && state.knocking.length > 0 ? (
        <>
          <p className="fr-then">
            Something knocked. Check the id against the one under your extension in{' '}
            <code>chrome://extensions</code>, and say if it is yours.
          </p>
          {state.knocking.map((knock) => (
            <form key={knock.extensionId} action={pair} className="fr-knock">
              <span className="fr-id">{knock.extensionId}</span>
              <input type="hidden" name="extensionId" value={knock.extensionId} />
              <Button variant="primary" type="submit">
                Yes, that&rsquo;s mine
              </Button>
            </form>
          ))}
          <p className="fr-note">
            Anything running on this machine could knock, so this is you saying which one you meant
            &mdash; not Propositum checking. It is the same kind of decision as pressing Allow in
            the side panel.
          </p>
        </>
      ) : null}

      {paired && state.approvedSources === 0 ? (
        <p className="fr-then">
          The extension is paired. Now open its side panel and press <strong>Allow</strong> beside
          each site you are happy for it to read — Chrome only grants that when you click it
          yourself, so nothing here can do it for you. Nothing is captured on a site you have not
          allowed.
        </p>
      ) : null}

      {paired && state.approvedSources > 0 ? (
        state.sessionLive ? (
          <p className="fr-then">
            You are in a session, so Propositum is watching that instead. It offers between
            sessions, not during one.
          </p>
        ) : state.seeingPages ? (
          <>
            <p className="fr-then">
              Propositum is watching. Go and read about something for a while — it will say so here,
              and on your phone once that is paired, when the same subject turns up across a few
              sites.
            </p>
            <p className="fr-note">What it is waiting for:</p>
            <ul className="fr-crit">
              <li>
                ○ {state.bar.intent === 1 ? 'one sign' : `${state.bar.intent} signs`} that you are
                pursuing something &mdash; a search you read, a search you refined, a page you came
                back to
              </li>
              <li>
                ○ {state.bar.investment === 1 ? 'one sign' : `${state.bar.investment} signs`} that
                you are invested &mdash; a real read, time on the subject, more than one site,
                options compared
              </li>
            </ul>
          </>
        ) : (
          <p className="fr-then">
            The extension is paired and a site is allowed, but nothing has arrived yet. Open a page
            on one of the sites you allowed, then reload this. If it stays empty, the extension may
            need reloading in <code>chrome://extensions</code>.
          </p>
        )
      ) : null}

      {!paired ? (
        <Disclosure summary="Or set it in .env, as before">
          <p className="fr-note" style={{ marginTop: 0 }}>
            <code>PROPOSITUM_EXTENSION_ID</code> still wins over anything chosen here, and a clone
            that already sets it behaves exactly as it did.
          </p>
        </Disclosure>
      ) : null}
    </section>
  )
}

function CalendarCard({ calendar }: { readonly calendar: CalendarRow | null }) {
  /* Connect-only, deliberately: Disconnect stays on the front door, where the
     one calendar failure a person can fix already lives — and where
     `tests/calendar-scope.test.ts` pins `forgetCalendar`'s single caller. */
  if (calendar === null) return null
  return (
    <section className="fr-card">
      <p className="fr-card-state">
        {calendar.state === 'connected' ? 'Calendar — connected' : 'Calendar — not yet'}
      </p>
      <h2 className="fr-card-say">May it see when you are busy?</h2>
      <p className="fr-then">
        {calendar.state === 'connected'
          ? 'Propositum can see when your calendar says you are busy. Times only — never what anything is called. Disconnecting lives on the front door.'
          : calendar.state === 'reauthorise'
            ? 'Google stopped accepting Propositum’s calendar permission, so it is no longer reading it.'
            : 'Times only — never what anything is called, who is in it, or where. It uses them to suggest how long to work for.'}
      </p>
      {calendar.state !== 'connected' && calendar.canReconnect ? (
        <div className="fr-acts">
          <Link href="/api/calendar/connect" prefetch={false}>
            {calendar.state === 'reauthorise' ? 'Connect it again' : 'Connect a calendar'}
          </Link>
        </div>
      ) : null}
    </section>
  )
}

function PhoneCard({
  state,
  handle,
  startPairing,
  finishPairing,
  unpairPhone,
}: {
  readonly state: FirstRunState
  readonly handle: string | null
  readonly startPairing: (form: FormData) => Promise<void>
  readonly finishPairing: () => Promise<void>
  readonly unpairPhone: () => Promise<void>
}) {
  return (
    <section className="fr-card">
      <p className="fr-card-state">{state.threadPaired ? 'Phone — paired' : 'Phone — not yet'}</p>
      <h2 className="fr-card-say">Should your phone hear from it?</h2>

      {state.threadPaired ? (
        <form action={unpairPhone}>
          <p className="fr-then">
            Your phone is paired. Nothing is sent until there is something to offer — the first
            message is the offer itself, never a greeting.
          </p>
          <div className="fr-acts">
            <Button type="submit">Unpair it</Button>
          </div>
        </form>
      ) : (
        <>
          <p className="fr-then">
            The whole point is that you are not at the desk: it sends what it noticed, what it
            stopped on, and what it needs decided. Pairing sends nothing by itself.
          </p>

          {handle === null ? (
            <>
              <p className="fr-note">
                Open Telegram, message <strong>@BotFather</strong>, send <code>/newbot</code>, give
                it any name, and paste the token it gives you back.
              </p>
              <form action={startPairing} className="fr-acts">
                <input
                  className="fr-field"
                  name="botToken"
                  placeholder="123456:ABC-DEF…"
                  aria-label="The token BotFather gave you"
                />
                <Button variant="primary" type="submit">
                  Check it
                </Button>
              </form>
            </>
          ) : (
            <>
              <p className="fr-note">
                That token belongs to <strong>@{handle}</strong>. Open{' '}
                <a href={`https://t.me/${handle}`}>t.me/{handle}</a> on your phone, press{' '}
                <strong>Start</strong>, then come back.
              </p>
              <form action={finishPairing} className="fr-acts">
                <Button variant="primary" type="submit">
                  I have pressed Start
                </Button>
              </form>
            </>
          )}

          <Disclosure summary="What goes through Telegram">
            <p className="fr-note" style={{ marginTop: 0 }}>
              Sentences Propositum writes about your own work &mdash; what it thinks you are on, why
              it stopped, what it needs decided. They sit on Telegram&rsquo;s servers and are not
              encrypted end to end. The bot is yours: you made it, nobody else holds it, and
              unpairing deletes the token from this machine. Leave this card and nothing is sent
              anywhere.
            </p>
          </Disclosure>
        </>
      )}
    </section>
  )
}

export default async function FirstRun({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const rawProblem = params['problem']
  const problem = typeof rawProblem === 'string' ? rawProblem : null

  const rawFor = params['for']
  const ask: Ask | null =
    typeof rawFor === 'string' && (ASKS as readonly string[]).includes(rawFor)
      ? (rawFor as Ask)
      : null

  const state = await firstRunState()
  const calendar = await calendarRow()
  const handle = pairingInFlight()

  /* The ask rides back into every redirect and nowhere else — it must never
     reach an action's arguments, because it is presentation, not a fact. Only
     the string is captured: an inline server action's closure must hold
     serialisable values, never a helper function. */
  const back = ask === null ? '/first-run' : `/first-run?for=${ask}`

  async function pair(form: FormData) {
    'use server'
    const id = String(form.get('extensionId') ?? '')
    const result = await pairExtensionAction(id)
    if (!result.ok)
      redirect(
        `${back}${back.includes('?') ? '&' : '?'}problem=${encodeURIComponent(result.problem.message)}`,
      )
    redirect(back)
  }

  async function startPairing(form: FormData) {
    'use server'
    const token = String(form.get('botToken') ?? '')
    const result = await beginThreadPairing(token)
    if (!result.ok)
      redirect(
        `${back}${back.includes('?') ? '&' : '?'}problem=${encodeURIComponent(result.problem.message)}`,
      )
    redirect(back)
  }

  async function finishPairing() {
    'use server'
    const result = await completeThreadPairing()
    if (!result.ok)
      redirect(
        `${back}${back.includes('?') ? '&' : '?'}problem=${encodeURIComponent(result.problem.message)}`,
      )
    redirect(back)
  }

  async function unpairPhone() {
    'use server'
    await forgetThread()
    redirect(back)
  }

  const order = consentOrder(ask)

  return (
    <Sheet>
      <style href="propositum-first-run" precedence="default">
        {CSS}
      </style>

      <div className="fr-col">
        <p className="fr-wordmark">Propositum</p>

        {problem === null ? null : (
          <p className="fr-problem" role="status">
            {problem}
          </p>
        )}

        {/* ── everything is set up ───────────────────────────────────── */}
        {state.at === null ? (
          <>
            <span className="fr-mark">
              <Done size={MARK_SIZE} pen={MARK_PEN} title="Set up" />
            </span>
            <h1 className="fr-say">That is everything.</h1>
            <p className="fr-then">
              Propositum is watching, and it will tell you here and on your phone when it has
              something to offer.
            </p>
            <p className="fr-note">
              <Link href="/">Go to the front door</Link>
            </p>
          </>
        ) : order === null ? (
          /* ── the opening ask ──────────────────────────────────────── */
          <>
            <span className="fr-mark">
              <Watching size={MARK_SIZE} pen={MARK_PEN} title="Listening" />
            </span>
            <h1 className="fr-say">What should Propositum be for you?</h1>
            <ul className="fr-ask">
              <li>
                <Link href="/first-run?for=act">
                  Act on things now
                  <span className="fr-ask-then">
                    it watches, offers, and continues while you are away
                  </span>
                </Link>
              </li>
              <li>
                <Link href="/first-run?for=watch">
                  Quietly watch approved work
                  <span className="fr-ask-then">it learns what you were going for, and waits</span>
                </Link>
              </li>
              <li>
                <Link href="/first-run?for=connect">
                  Just connect things for later
                  <span className="fr-ask-then">calendar, phone — nothing watched yet</span>
                </Link>
              </li>
            </ul>
            <p className="fr-note">
              There is no wrong answer and nothing is saved — this only decides what to show first.
            </p>
          </>
        ) : (
          /* ── the consent cards, in the ask's order ────────────────── */
          <>
            <span className="fr-mark">
              <Handover size={MARK_SIZE} pen={MARK_PEN} title="Setting up" />
            </span>
            <h1 className="fr-say">Each of these is yours to allow, or not.</h1>

            {/* The key card is a fallback: a bundled-key build never shows it. */}
            {!state.done.key ? (
              <section className="fr-card">
                <p className="fr-card-state">A key — not yet</p>
                <h2 className="fr-card-say">Propositum needs a key to think with.</h2>
                <p className="fr-then">
                  This build does not carry one, so this is the one step that is for whoever runs
                  the software. Put a key in <code>.env</code> and restart — or use{' '}
                  <strong>Set the API key…</strong> on the menu-bar icon.
                </p>
                <p className="fr-code">ANTHROPIC_API_KEY=sk-ant-…</p>
              </section>
            ) : null}

            {order.map((source: ConsentSource) =>
              source === 'extension' ? (
                <ExtensionCard key={source} state={state} pair={pair} />
              ) : source === 'calendar' ? (
                <CalendarCard key={source} calendar={calendar} />
              ) : (
                <PhoneCard
                  key={source}
                  state={state}
                  handle={handle}
                  startPairing={startPairing}
                  finishPairing={finishPairing}
                  unpairPhone={unpairPhone}
                />
              ),
            )}

            <p className="fr-note fr-calm">
              Skip anything. Propositum sits idle until you allow something, and that is a working
              install — it earns its first offer from whatever you let it watch.
            </p>
          </>
        )}

        <Trail state={state} />
      </div>
    </Sheet>
  )
}
