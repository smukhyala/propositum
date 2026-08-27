/**
 * Setting Propositum up, on one screen that always tells the truth.
 *
 * ── Markup and one call ──────────────────────────────────────────────────
 *
 * Every decision about WHICH step somebody is on lives in
 * `src/server/welcome.ts`, for the reason `src/app/page.tsx` gives about its own
 * derivations: *"a decision that fails silently does not live in a `.tsx` file."*
 * A step that reports itself done when it is not sends a person hunting; one
 * that reports itself pending when it is done tells them their own machine is
 * broken. Neither is something anybody would spot by looking at a screenshot.
 *
 * ── Not a wizard ─────────────────────────────────────────────────────────
 *
 * Nothing is stored about where somebody "is". Every step is a question with an
 * answer in the world, so refreshing, arriving by a link, coming back tomorrow
 * and restarting both processes all land in the same place. There is no progress
 * row that could get out of step with the truth.
 *
 * ── Where the honesty is load-bearing ────────────────────────────────────
 *
 * Two places, and both are copy rather than code:
 *
 *   - **The extension step is not authentication and says so.** Anything on this
 *     machine can knock. The person clicking is the authorisation, exactly as
 *     the extension's own **Allow** gesture is, and implying a check that is not
 *     there would be worse than the `.env` line it replaces.
 *   - **The watching step reports capture health, not progress.** Principle 1
 *     forbids *"any progress indicator derived from event volume, action count,
 *     or elapsed time"*, and a bar filling as somebody reads is exactly that.
 *     What is on the page is whether anything is arriving at all — the only
 *     question at that moment with an action attached.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Sheet, Button, Disclosure } from '@/ui/primitives'
import { Watching, Handover, Done } from '@/ui/sprites'
import { welcomeState } from '@/server/welcome'
import type { WelcomeState, WelcomeStep } from '@/server/welcome'
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
.we-col { max-width: 34rem; margin: 0 auto; }
.we-wordmark { font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.3em; text-transform: uppercase; color: var(--ink); margin: 0 0 3rem; }
.we-mark { display: block; color: var(--ink); margin: 0 0 1.5rem; }
.we-say { font-family: var(--serif); font-weight: 400; font-size: clamp(1.5rem, 5.2vw, 2rem); line-height: 1.24; letter-spacing: -0.015em; margin: 0; text-wrap: pretty; }
.we-then { font-family: var(--serif); font-size: 1.0625rem; line-height: 1.55; color: var(--muted); margin: 1.15rem 0 0; text-wrap: balance; }
.we-note { font-family: var(--mono); font-size: 0.75rem; line-height: 1.65; color: var(--muted); margin: 1.15rem 0 0; }
.we-problem { font-family: var(--serif); font-size: 1.0625rem; line-height: 1.5; color: var(--ink); border-left: 2px solid var(--ink); padding-left: 1.05rem; margin: 0 0 2.5rem; }

.we-acts { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin-top: 1.75rem; }
.we-field { font-family: var(--mono); font-size: 0.8125rem; padding: 0.5rem 0.65rem; border: 1px solid var(--rule); background: var(--ground); color: var(--ink); border-radius: 2px; width: 100%; max-width: 30rem; }
.we-code { font-family: var(--mono); font-size: 0.75rem; background: var(--raised); border: 1px solid var(--rule); border-radius: 2px; padding: 0.75rem 0.9rem; margin: 1.15rem 0 0; overflow-x: auto; white-space: pre; color: var(--ink); }

.we-knock { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: baseline; margin-top: 1.35rem; padding-top: 1.35rem; border-top: 1px solid var(--rule); }
.we-knock:first-of-type { border-top: none; }
.we-id { font-family: var(--mono); font-size: 0.8125rem; color: var(--ink); word-break: break-all; }

.we-steps { list-style: none; padding: 0; margin: 3.5rem 0 0; border-top: 1px solid var(--rule); }
.we-step { display: grid; grid-template-columns: 1.5rem 1fr; gap: 0.75rem; align-items: baseline; padding: 0.7rem 0; border-bottom: 1px solid var(--rule); font-family: var(--mono); font-size: 0.75rem; color: var(--muted); }
.we-step-done { color: var(--ink); }
.we-tick { color: var(--ink); }

.we-crit { list-style: none; padding: 0; margin: 1.15rem 0 0; }
.we-crit li { font-family: var(--mono); font-size: 0.75rem; line-height: 1.9; color: var(--muted); }

.we-foot { margin-top: 3.5rem; padding-top: 1.5rem; border-top: 1px solid var(--rule); }
`

/** What each step is called once it is behind you. Mono, quiet, checkable. */
const STEP_LABEL: Record<WelcomeStep, string> = {
  key: 'a key to think with',
  extension: 'the extension paired',
  sources: 'sites you have allowed',
  watching: 'something worth offering',
  phone: 'your phone',
}

function Trail({ state }: { readonly state: WelcomeState }) {
  return (
    <ul className="we-steps">
      {(Object.keys(STEP_LABEL) as WelcomeStep[]).map((step) => (
        <li key={step} className={state.done[step] ? 'we-step we-step-done' : 'we-step'}>
          <span className="we-tick" aria-hidden="true">
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

export default async function Welcome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const raw = params['problem']
  const problem = typeof raw === 'string' ? raw : null

  const state = await welcomeState()
  const handle = pairingInFlight()

  async function pair(form: FormData) {
    'use server'
    const id = String(form.get('extensionId') ?? '')
    const result = await pairExtensionAction(id)
    if (!result.ok) redirect(`/welcome?problem=${encodeURIComponent(result.problem.message)}`)
    redirect('/welcome')
  }

  async function startPairing(form: FormData) {
    'use server'
    const token = String(form.get('botToken') ?? '')
    const result = await beginThreadPairing(token)
    if (!result.ok) redirect(`/welcome?problem=${encodeURIComponent(result.problem.message)}`)
    redirect('/welcome')
  }

  async function finishPairing() {
    'use server'
    const result = await completeThreadPairing()
    if (!result.ok) redirect(`/welcome?problem=${encodeURIComponent(result.problem.message)}`)
    redirect('/welcome')
  }

  async function unpairPhone() {
    'use server'
    await forgetThread()
    redirect('/welcome')
  }

  return (
    <Sheet>
      <style href="propositum-welcome" precedence="default">
        {CSS}
      </style>

      <div className="we-col">
        <p className="we-wordmark">Propositum</p>

        {problem === null ? null : (
          <p className="we-problem" role="status">
            {problem}
          </p>
        )}

        {/* ── everything is set up ───────────────────────────────────── */}
        {state.at === null ? (
          <>
            <span className="we-mark">
              <Done size={MARK_SIZE} pen={MARK_PEN} title="Set up" />
            </span>
            <h1 className="we-say">That is everything.</h1>
            <p className="we-then">
              Propositum is watching, and it will tell you here and on your phone when it has
              something to offer.
            </p>
            <p className="we-note">
              <Link href="/">Go to the front door</Link>
            </p>
          </>
        ) : null}

        {/* ── 1. the key ─────────────────────────────────────────────── */}
        {state.at === 'key' ? (
          <>
            <span className="we-mark">
              <Watching size={MARK_SIZE} pen={MARK_PEN} title="Waiting" />
            </span>
            <h1 className="we-say">Propositum needs a key to think with.</h1>
            <p className="we-then">
              This is the one step that is for whoever is running the software rather than for
              whoever uses it. Put a key in <code>.env</code> and restart both terminals.
            </p>
            <p className="we-code">ANTHROPIC_API_KEY=sk-ant-…</p>
            <p className="we-note">
              Without it Propositum still watches and still notices when a subject comes back. What
              it cannot do is say what it thinks you are working on, so every offer stays blank.
            </p>
          </>
        ) : null}

        {/* ── 2. the extension ───────────────────────────────────────── */}
        {state.at === 'extension' ? (
          <>
            <span className="we-mark">
              <Watching size={MARK_SIZE} pen={MARK_PEN} title="Listening" />
            </span>
            <h1 className="we-say">
              {state.knocking.length === 0
                ? 'Propositum cannot see your browser yet.'
                : state.knocking.length === 1
                  ? 'Something just knocked.'
                  : 'A few things have knocked.'}
            </h1>

            {state.knocking.length === 0 ? (
              <>
                <p className="we-then">
                  Open <code>chrome://extensions</code>, turn on Developer mode, choose{' '}
                  <strong>Load unpacked</strong>, and pick the <code>extension</code> folder. Then
                  come back here — it announces itself within half a minute.
                </p>
                <p className="we-note">This page does not refresh itself. Reload it once you have.</p>
              </>
            ) : (
              <>
                <p className="we-then">
                  Check the id against the one under your extension in{' '}
                  <code>chrome://extensions</code>, and say if it is yours.
                </p>
                {state.knocking.map((knock) => (
                  <form key={knock.extensionId} action={pair} className="we-knock">
                    <span className="we-id">{knock.extensionId}</span>
                    <input type="hidden" name="extensionId" value={knock.extensionId} />
                    <Button variant="primary" type="submit">
                      Yes, that&rsquo;s mine
                    </Button>
                  </form>
                ))}
                <p className="we-note">
                  Anything running on this machine could knock, so this is you saying which one you
                  meant &mdash; not Propositum checking. It is the same kind of decision as pressing
                  Allow in the side panel.
                </p>
              </>
            )}

            <Disclosure summary="Or set it in .env, as before">
              <p className="we-note" style={{ marginTop: 0 }}>
                <code>PROPOSITUM_EXTENSION_ID</code> still wins over anything chosen here, and a
                clone that already sets it behaves exactly as it did.
              </p>
            </Disclosure>
          </>
        ) : null}

        {/* ── 3. the sites ───────────────────────────────────────────── */}
        {state.at === 'sources' ? (
          <>
            <span className="we-mark">
              <Watching size={MARK_SIZE} pen={MARK_PEN} title="Waiting" />
            </span>
            <h1 className="we-say">Propositum has not been allowed to look anywhere.</h1>
            <p className="we-then">
              Open the extension&rsquo;s side panel and press <strong>Allow</strong> beside each site
              you are happy for it to read. Nothing is captured on a site you have not allowed.
            </p>
            <p className="we-note">
              Chrome only grants this when you click it yourself, so nothing here can do it for you.
            </p>
          </>
        ) : null}

        {/* ── 4. watching ────────────────────────────────────────────── */}
        {state.at === 'watching' ? (
          <>
            <span className="we-mark">
              <Watching size={MARK_SIZE} pen={MARK_PEN} title="Watching" />
            </span>
            <h1 className="we-say">
              {state.sessionLive
                ? 'You are in a session, so Propositum is watching that instead.'
                : state.seeingPages
                  ? 'Propositum is watching.'
                  : 'Propositum is not seeing anything yet.'}
            </h1>

            {state.sessionLive ? (
              <p className="we-then">
                It offers between sessions, not during one. Finish the session and it will pick this
                back up.
              </p>
            ) : state.seeingPages ? (
              <>
                <p className="we-then">
                  Go and read about something for a while. It will say so here, and on your phone
                  once that is set up, when the same subject turns up across a few sites.
                </p>
                <p className="we-note">What it is waiting for:</p>
                <ul className="we-crit">
                  <li>
                    ○ {state.bar.intent === 1 ? 'one sign' : `${state.bar.intent} signs`} that you are
                    pursuing something &mdash; a search you read, a search you refined, a page you
                    came back to
                  </li>
                  <li>
                    ○ {state.bar.investment === 1 ? 'one sign' : `${state.bar.investment} signs`} that
                    you are invested &mdash; a real read, time on the subject, more than one site,
                    options compared
                  </li>
                </ul>
                <p className="we-note">
                  It will not say anything about an ordinary afternoon of reading, and that is on
                  purpose.
                </p>
              </>
            ) : (
              <>
                <p className="we-then">
                  The extension is paired and a site is allowed, but nothing has arrived. Open a page
                  on one of the sites you allowed, then reload this.
                </p>
                <p className="we-note">
                  If it stays empty, the extension may need reloading in{' '}
                  <code>chrome://extensions</code>.
                </p>
              </>
            )}
          </>
        ) : null}

        {/* ── 5. the phone ───────────────────────────────────────────── */}
        {state.at === 'phone' ? (
          <>
            <span className="we-mark">
              <Handover size={MARK_SIZE} pen={MARK_PEN} title="On your phone" />
            </span>
            <h1 className="we-say">Propositum has something to offer you.</h1>
            <p className="we-then">
              You will want that on your phone, because the whole point is that you are not at the
              desk. It sends what it noticed, what it stopped on, and what it needs decided.
            </p>

            {handle === null ? (
              <>
                <p className="we-note">
                  Open Telegram, message <strong>@BotFather</strong>, send <code>/newbot</code>, give
                  it any name, and paste the token it gives you back.
                </p>
                <form action={startPairing} className="we-acts">
                  <input
                    className="we-field"
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
                <p className="we-note">
                  That token belongs to <strong>@{handle}</strong>. Open{' '}
                  <a href={`https://t.me/${handle}`}>t.me/{handle}</a> on your phone, press{' '}
                  <strong>Start</strong>, then come back.
                </p>
                <form action={finishPairing} className="we-acts">
                  <Button variant="primary" type="submit">
                    I have pressed Start
                  </Button>
                </form>
              </>
            )}

            <Disclosure summary="What goes through Telegram">
              <p className="we-note" style={{ marginTop: 0 }}>
                Sentences Propositum writes about your own work &mdash; what it thinks you are on,
                why it stopped, what it needs decided. They sit on Telegram&rsquo;s servers and are
                not encrypted end to end. The bot is yours: you made it, nobody else holds it, and
                unpairing deletes the token from this machine. Leave this step and nothing is sent
                anywhere.
              </p>
            </Disclosure>
          </>
        ) : null}

        {/* ── already paired, shown wherever you are ─────────────────── */}
        {state.threadPaired ? (
          <form action={unpairPhone} className="we-foot">
            <p className="we-note" style={{ marginTop: 0 }}>
              Your phone is paired.
            </p>
            <div className="we-acts">
              <Button type="submit">Unpair it</Button>
            </div>
          </form>
        ) : null}

        <Trail state={state} />
      </div>
    </Sheet>
  )
}
