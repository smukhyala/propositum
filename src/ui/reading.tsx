/**
 * "What I think you're working on" — and the two-stage flow it opens.
 *
 * ── Why the flow lives in this file ──────────────────────────────────────
 *
 * Taking over is one act in two stages: read what Propositum understood, then
 * settle the agreement drafted FROM that understanding. The second stage cannot
 * exist without the first — `draftContract` takes a reading id — and the draft
 * is held in memory between them, because `draftContract` is not idempotent and
 * there is no repository lookup that would let a reload find the draft again.
 * A shared client boundary is therefore the honest shape; splitting the stages
 * across two routes would mean either a second model call on every back-button
 * press or a contract id smuggled through the URL.
 *
 * So: `page.tsx` loads, `TakeOver` sequences, and the agreement itself is
 * `src/ui/agreement.tsx`.
 *
 * ── Three things here are load-bearing rather than presentational ────────
 *
 * 1. **The band is phrasing, never a number, and the word never appears.**
 *    CONTEXT fixes the three sentences; this file uses them verbatim. A low
 *    band opens the correction box rather than announcing a low score.
 *
 * 2. **Every claim shows its evidence without a hover.** Re-entry finding 9:
 *    a `title` tooltip is not reliably reachable by keyboard or screen reader,
 *    so the support is a real `<details>` disclosure with the times and the
 *    verified quotes inside it.
 *
 * 3. **Editing is per claim.** `editClaim` moves `origin` to `edited` on that
 *    one row. Revision-level authorship would launder every untouched inferred
 *    claim into a human assertion the moment one word changed — the exact
 *    category error the observation layer forbids, arriving one layer up, and
 *    it would make the correction rate uncomputable.
 *
 * ADR-0006 is why all three matter: the session-reading boundary is inside the
 * blast radius, and this screen is the only thing that catches an injection
 * that rewrote the objective. It should be hard to ratify without reading.
 */

'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { Button, Empty, Masthead, Narrative, Section } from './primitives'
import { Away, Done, Handover, Watching } from './sprites'
import { Agreement } from './agreement'
import {
  defaultAutonomyControls,
  draftContract,
  editClaim,
  generateReading,
} from '../server/actions'
import type { ContractDrafted } from '../server/actions'
import type { ActionKind, AutonomyControls } from '../domain/handoff/policy'

/* ── the view model page.tsx builds ─────────────────────────────────────── */

export interface EvidenceView {
  /** Already formatted by the server — "4:31 pm". */
  readonly at: string
  /** A plain sentence about what happened. Never page-authored text. */
  readonly what: string
  /**
   * A quotation the server verified against the cited event's stored text.
   * Page-authored, so it is only ever rendered WITH `sourceLabel` beside it.
   */
  readonly quote: string | null
  readonly sourceLabel: string | null
}

export interface ClaimView {
  readonly id: string
  readonly kind: string
  readonly text: string
  /** `high | medium | low`, and only ever on the objective claim. */
  readonly confidence: string | null
  /** `inferred | human | edited`. */
  readonly origin: string
  readonly evidence: readonly EvidenceView[]
}

export interface SourceView {
  readonly id: string
  readonly label: string
  readonly originPattern: string
}

export interface TakeOverProps {
  readonly sessionId: string
  readonly projectName: string
  /** `observing | away | ended`. */
  readonly phase: string
  /** "3:41 pm — still going", or a closed range. Formatted by the server. */
  readonly when: string
  readonly reading: { readonly id: string; readonly claims: readonly ClaimView[] } | null
  /** Granted sources on the project, for labelling the agreement's scope. */
  readonly sources: readonly SourceView[]
  readonly documentTitle: string | null
  /**
   * The accepted contract for this session, read from the server.
   *
   * Not the same thing as the `handed` state below, which only exists in the
   * page life that pressed Take Over. A reload while Propositum is away drops
   * that, and without this the screen becomes a dead end for exactly the
   * person who came back to read the note.
   */
  readonly shiftContractId: string | null
}

/* ── the one stylesheet for this screen ─────────────────────────────────── */

const CSS = `
.tk-ask { font-family: var(--sans); font-size: 0.9375rem; color: var(--attention); margin: 0 0 0.85rem; max-width: 38rem; }

.tk-claims { list-style: none; margin: 0; padding: 0; }
.tk-claim { padding: 0.9rem 0; border-bottom: 1px solid var(--rule); }
.tk-claim:last-child { border-bottom: none; }
.tk-claim-text { margin: 0; text-wrap: pretty; }
.tk-tag { font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); margin-left: 0.55rem; white-space: nowrap; }

.tk-tools { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin-top: 0.6rem; }

.tk-why { margin-top: 0.5rem; }
.tk-why > summary { font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); cursor: pointer; padding: 0.15rem 0; list-style: none; }
.tk-why > summary::-webkit-details-marker { display: none; }
.tk-why > summary::before { content: "▸ "; color: var(--faint); }
.tk-why[open] > summary::before { content: "▾ "; }
.tk-why > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tk-why-body { margin: 0.5rem 0 0; padding: 0 0 0 1rem; border-left: 1px solid var(--rule); list-style: none; }
.tk-why-row { display: grid; grid-template-columns: 5.5rem 1fr; gap: 0.85rem; padding: 0.3rem 0; align-items: baseline; }
@media (max-width: 30rem) { .tk-why-row { grid-template-columns: 4.25rem 1fr; gap: 0.6rem; } }
.tk-at { font-family: var(--mono); font-size: 0.75rem; color: var(--faint); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tk-why-what { margin: 0; font-size: 0.875rem; color: var(--muted); }

.tk-quote { margin: 0.4rem 0 0; padding: 0.5rem 0.75rem; background: var(--raised); border-left: 2px solid var(--accent); font-family: var(--serif); font-size: 0.9375rem; }
.tk-quote-said { display: block; font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); font-style: normal; margin-bottom: 0.25rem; }

.tk-editor { margin-top: 0.6rem; }
.tk-field { font: inherit; font-family: var(--serif); font-size: 1rem; width: 100%; min-height: 4.5rem; padding: 0.6rem 0.7rem; background: var(--ground); color: var(--ink); border: 1px solid var(--rule); border-radius: 3px; resize: vertical; }
.tk-field:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }

.tk-note { margin: 0.9rem 0 0; font-size: 0.875rem; color: var(--muted); max-width: 40rem; }
.tk-problem { margin: 0.7rem 0 0; padding: 0.6rem 0.8rem; border-left: 2px solid var(--attention); color: var(--attention); font-size: 0.875rem; }

.tk-foot { margin-top: 3.25rem; padding-top: 1.5rem; border-top: 2px solid var(--ink); display: flex; flex-wrap: wrap; gap: 0.9rem; align-items: center; justify-content: space-between; }
.tk-foot p { margin: 0; color: var(--muted); font-size: 0.9375rem; max-width: 30rem; }
.tk-foot-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }

/* Navigates, so it stays an <a>. A button that goes somewhere breaks the back
   button and the keyboard. */
.tk-go { display: inline-block; font: inherit; font-size: 0.8125rem; line-height: 1.4; padding: 0.35rem 0.9rem; border: 1px solid var(--accent); border-radius: 3px; background: var(--accent); color: var(--ground); text-decoration: none; }
.tk-go:hover { filter: brightness(1.07); }
.tk-go:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
`

function Styles() {
  return (
    <style href="propositum-takeover" precedence="default">
      {CSS}
    </style>
  )
}

/* ── claim kinds → plain headings ───────────────────────────────────────── */

/**
 * CONTEXT names five kinds; the session-reading boundary ships six, and spells
 * two of them differently (`completed`, `nextAction`, plus `uncertainty`).
 * Both spellings are accepted here rather than picking a winner, because the
 * stored value is whatever the boundary wrote and a claim that matches no group
 * would vanish from the screen — which is a claim the person cannot correct.
 * Anything unrecognised falls into the last group instead of disappearing.
 */
const GROUPS: ReadonlyArray<{ readonly title: string; readonly kinds: readonly string[] }> = [
  { title: "What's done", kinds: ['completed', 'completedWork'] },
  { title: "What's open", kinds: ['openThread'] },
  { title: "What's uncertain", kinds: ['uncertainty'] },
  { title: "What's next", kinds: ['nextAction', 'nextStep'] },
]

const CLAIMED_KINDS = new Set<string>([
  'objective',
  'constraint',
  ...GROUPS.flatMap((g) => g.kinds),
])

/* ── origin, said in the person's terms ─────────────────────────────────── */

function originTag(origin: string): string | null {
  if (origin === 'edited') return 'you changed this'
  if (origin === 'human') return 'yours'
  return null
}

/* ═══════════════════════════════════════════════════════════════ the flow ══ */

type Stage = 'reading' | 'agreement'

interface Handed {
  /** The ratified contract. The shift report hangs off this id. */
  readonly contractId: string
  readonly deadlineAt: string
  readonly allowedActionKinds: readonly ActionKind[]
}

export function TakeOver(props: TakeOverProps) {
  const [stage, setStage] = useState<Stage>('reading')
  const [draft, setDraft] = useState<ContractDrafted | null>(null)
  const [defaults, setDefaults] = useState<AutonomyControls | null>(null)
  const [handed, setHanded] = useState<Handed | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const observing = props.phase === 'observing'
  const away = props.phase === 'away'
  const reading = props.reading

  const sourceLabels: Record<string, string> = {}
  for (const source of props.sources) sourceLabels[source.id] = source.label

  /**
   * Draft the agreement, once.
   *
   * Guarded on `draft` because this spends a model call and writes a contract
   * row every time it runs — going back to the reading and forward again must
   * not do either.
   */
  function openAgreement(readingId: string): void {
    if (draft) {
      setStage('agreement')
      return
    }

    setProblem(null)
    start(async () => {
      // The dials come from the server's product constants rather than from a
      // literal here, so there is one source for what "cautious" means.
      const [drafted, dials] = await Promise.all([
        draftContract(readingId),
        defaultAutonomyControls(),
      ])

      if (!drafted.ok) {
        setProblem(drafted.problem.message)
        return
      }

      setDraft(drafted.value)
      setDefaults(dials)
      setStage('agreement')
    })
  }

  /* ── the masthead changes with the stage, because the screen does ─────── */

  const title = away
    ? 'Propositum has the work'
    : props.phase === 'ended'
      ? 'This session has ended'
      : stage === 'agreement'
        ? 'The working agreement'
        : "What I think you're working on"

  const mark = away ? (
    <Away size={20} delay={0.2} />
  ) : props.phase === 'ended' ? (
    <Done size={20} delay={0.2} />
  ) : stage === 'agreement' ? (
    <Handover size={20} delay={0.2} />
  ) : (
    <Watching size={20} delay={0.2} />
  )

  return (
    <>
      <Styles />
      <Masthead
        kicker={props.projectName}
        title={title}
        mark={mark}
        subtitle={<span style={{ fontFamily: 'var(--mono)' }}>{props.when}</span>}
      />

      {away && handed ? <HandedOver handed={handed} /> : null}
      {away && !handed ? (
        <Section title="Where things stand" index={1}>
          <p className="tk-note" style={{ marginTop: 0 }}>
            You handed this session over, so Propositum holds the work and has stopped watching your
            approved sources. Nothing here can be changed until it hands back.
          </p>
          {props.shiftContractId === null ? null : (
            <div className="tk-tools">
              <Link className="tk-go" href={`/shifts/${props.shiftContractId}`}>
                While you were away
              </Link>
            </div>
          )}
        </Section>
      ) : null}

      {/* A session that was handed over and has since ended still has a note,
          and this screen is a place people arrive at from the project's list of
          earlier sessions. Without this the note is reachable only from the
          project page — one route to the thing they came back for. */}
      {!away && !handed && props.shiftContractId !== null ? (
        <Section title="What Propositum did with this" index={1}>
          <p className="tk-note" style={{ marginTop: 0 }}>
            You handed this session over. What Propositum did while you were away &mdash; and
            anything it needs from you &mdash; is written up in the note.
          </p>
          <div className="tk-tools">
            <Link className="tk-go" href={`/shifts/${props.shiftContractId}`}>
              While you were away
            </Link>
          </div>
        </Section>
      ) : null}

      {reading === null ? (
        <NoReadingYet sessionId={props.sessionId} canRead={observing} />
      ) : stage === 'agreement' && draft !== null && defaults !== null ? (
        <Agreement
          draft={draft}
          defaults={defaults}
          sourceLabels={sourceLabels}
          onBack={() => setStage('reading')}
          onHandedOver={(info) => {
            setHanded(info)
            setStage('reading')
          }}
        />
      ) : (
        <Reading
          claims={reading.claims}
          readOnly={!observing}
          pending={pending}
          problem={problem}
          documentTitle={props.documentTitle}
          onContinue={() => openAgreement(reading.id)}
        />
      )}
    </>
  )
}

/* ── after the handover ─────────────────────────────────────────────────── */

function HandedOver({ handed }: { readonly handed: Handed }) {
  const back = new Date(handed.deadlineAt)
  const canDraft = handed.allowedActionKinds.includes('draft-section')

  return (
    <Section title="You handed over" tone="attention" index={1}>
      <p className="tk-note" style={{ marginTop: 0 }}>
        Propositum is working, and has stopped watching your approved sources &mdash; so
        &ldquo;while you were away&rdquo; describes a clean stretch of time. It stops on its own by{' '}
        <strong>{clockOf(back)}</strong> at the latest and writes up where it got to.
      </p>
      <p className="tk-note">
        {canDraft
          ? 'It may propose text for your document. Nothing lands until you accept it.'
          : 'You asked for research only, so it will come back with findings, questions and next steps — and no text for your document.'}
      </p>
      {/* The note is the whole point of leaving, so the way to it exists from
          the moment the handover happens — not only once the run has ended.
          Opened early it says Propositum is still working, which is true and
          more use than a link that is not there. */}
      <div className="tk-tools">
        <Link className="tk-go" href={`/shifts/${handed.contractId}`}>
          While you were away
        </Link>
      </div>
    </Section>
  )
}

function clockOf(when: Date): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
    .format(when)
    .replace(/\s*(AM|PM)$/i, (_m, half: string) => ` ${half.toLowerCase()}`)
}

/* ── no reading yet ─────────────────────────────────────────────────────── */

function NoReadingYet({ sessionId, canRead }: { readonly sessionId: string; readonly canRead: boolean }) {
  const [problem, setProblem] = useState<string | null>(null)
  const [dropped, setDropped] = useState(0)
  const [pending, start] = useTransition()

  function read(): void {
    setProblem(null)
    start(async () => {
      const result = await generateReading(sessionId)
      if (!result.ok) {
        setProblem(result.problem.message)
        return
      }
      setDropped(result.value.discardedQuotes)
    })
  }

  return (
    <Section title="Before you can hand over" index={1}>
      <Empty
        title="Propositum hasn't read this session yet."
        next={
          canRead
            ? 'Ask it to work out what you were doing. It does this once — after that you correct what it got wrong rather than asking it to try again.'
            : 'This session is no longer being watched, and a reading is only made while you are at your desk. Start a new session when you next sit down.'
        }
        {...(canRead
          ? {
              action: (
                <Button variant="primary" onClick={read} disabled={pending}>
                  {pending ? 'Reading the session…' : 'Read this session'}
                </Button>
              ),
            }
          : {})}
      />
      {problem ? <p className="tk-problem">{problem}</p> : null}
      {dropped > 0 ? (
        <p className="tk-note">
          {dropped === 1
            ? 'One quotation Propositum offered did not match anything it actually saw, so it was thrown away.'
            : `${dropped} quotations Propositum offered did not match anything it actually saw, so they were thrown away.`}{' '}
          The claims they were meant to support are still here — read them with that in mind.
        </p>
      ) : null}
    </Section>
  )
}

/* ═══════════════════════════════════════════════════════════ the reading ══ */

interface ReadingProps {
  readonly claims: readonly ClaimView[]
  readonly readOnly: boolean
  readonly pending: boolean
  readonly problem: string | null
  /** Null when the project has no document. Checked here rather than left to
   *  the draft boundary, so the person is told before they spend the click. */
  readonly documentTitle: string | null
  readonly onContinue?: (() => void) | undefined
}

function Reading({ claims, readOnly, pending, problem, documentTitle, onContinue }: ReadingProps) {
  const objective = claims.find((c) => c.kind === 'objective') ?? null
  const constraints = claims.filter((c) => c.kind === 'constraint')
  const leftover = claims.filter((c) => !CLAIMED_KINDS.has(c.kind))

  let index = 1

  return (
    <>
      <Styles />

      {objective ? (
        <Section title="What you're aiming at" index={index++}>
          <Objective claim={objective} readOnly={readOnly} />
        </Section>
      ) : (
        <Section title="What you're aiming at" index={index++}>
          <Empty
            title="Propositum recorded no objective for this session."
            next="Nothing can be handed over without one. Read the claims below, then start the agreement and say what you're aiming for yourself."
          />
        </Section>
      )}

      {GROUPS.map((group) => {
        const rows = claims.filter((c) => group.kinds.includes(c.kind))
        if (rows.length === 0) return null

        return (
          <Section key={group.title} title={group.title} index={index++}>
            <ul className="tk-claims">
              {rows.map((claim) => (
                <li className="tk-claim" key={claim.id}>
                  <ClaimBody claim={claim} readOnly={readOnly} />
                </li>
              ))}
            </ul>
          </Section>
        )
      })}

      {constraints.length > 0 ? (
        <Section title="What the sources say" index={index++}>
          <p className="tk-note" style={{ marginTop: 0 }}>
            Propositum found these in pages you read. They are quotations, not instructions — nothing
            here reaches the working agreement unless you write it there yourself.
          </p>
          <ul className="tk-claims">
            {constraints.map((claim) => (
              <li className="tk-claim" key={claim.id}>
                <Quotation
                  text={claim.evidence[0]?.quote ?? claim.text}
                  said={claim.evidence[0]?.sourceLabel ?? null}
                  verbatim={claim.evidence[0]?.quote !== undefined}
                />
                <Why evidence={claim.evidence} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {leftover.length > 0 ? (
        <Section title="Also worth saying" index={index++}>
          <ul className="tk-claims">
            {leftover.map((claim) => (
              <li className="tk-claim" key={claim.id}>
                <ClaimBody claim={claim} readOnly={readOnly} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {problem ? <p className="tk-problem">{problem}</p> : null}

      {onContinue && !readOnly ? (
        <div className="tk-foot">
          <p>
            {documentTitle === null
              ? 'There is no document in this project yet. Paste one in first — Propositum needs something to work on before it can be handed anything.'
              : 'Correct anything wrong above first. The agreement is written from what is on this screen, and this reading is the only place Propositum can be caught misunderstanding you.'}
          </p>
          <div className="tk-foot-actions">
            <Button
              variant="primary"
              onClick={onContinue}
              disabled={pending || objective === null || documentTitle === null}
              {...(objective === null
                ? { title: 'Propositum recorded no objective, so there is nothing to hand over.' }
                : documentTitle === null
                  ? { title: 'This project has no document yet.' }
                  : {})}
            >
              {pending ? 'Writing the agreement…' : 'Write the working agreement'}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  )
}

/* ── the objective, led by its band ─────────────────────────────────────── */

/**
 * The band is three sentences, fixed by CONTEXT, and it is the whole of how
 * uncertainty is expressed. No number, no meter, and the word itself never
 * appears — a self-reported 0.83 is uncalibrated, and putting one on screen
 * invites exactly the tunable threshold the product bans.
 *
 * `low` opens the correction box with Propositum's attempt already in it. That
 * is not a hedge on the sentence above it: the person should never have to
 * start from an empty field for work Propositum watched them do.
 */
function Objective({ claim, readOnly }: { readonly claim: ClaimView; readonly readOnly: boolean }) {
  const band = claim.confidence
  const settled = claim.origin === 'edited' || claim.origin === 'human'

  return (
    <>
      <Styles />
      {band === 'medium' && !settled ? (
        <p className="tk-ask">It looks like this is what you were working on — is that right?</p>
      ) : null}
      {band === 'low' && !settled ? (
        <p className="tk-ask">
          I couldn&rsquo;t work out what you&rsquo;re aiming for. Tell me in a sentence.
        </p>
      ) : null}

      <Narrative>{claim.text}</Narrative>
      <Why evidence={claim.evidence} />
      <Editable claim={claim} readOnly={readOnly} openByDefault={band === 'low' && !settled} />
    </>
  )
}

/* ── one claim ──────────────────────────────────────────────────────────── */

function ClaimBody({ claim, readOnly }: { readonly claim: ClaimView; readonly readOnly: boolean }) {
  const tag = originTag(claim.origin)

  return (
    <>
      <p className="tk-claim-text">
        {claim.text}
        {tag ? <span className="tk-tag">{tag}</span> : null}
      </p>
      <Why evidence={claim.evidence} />
      <Editable claim={claim} readOnly={readOnly} openByDefault={false} />
    </>
  )
}

/* ── correcting one claim, and only that one ────────────────────────────── */

function Editable({
  claim,
  readOnly,
  openByDefault,
}: {
  readonly claim: ClaimView
  readonly readOnly: boolean
  readonly openByDefault: boolean
}) {
  const [open, setOpen] = useState(openByDefault)
  const [text, setText] = useState(claim.text)
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const field = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (open) field.current?.focus()
  }, [open])

  if (readOnly) return null

  function save(): void {
    setProblem(null)
    start(async () => {
      const result = await editClaim(claim.id, text)
      if (!result.ok) {
        setProblem(result.problem.message)
        return
      }
      setOpen(false)
    })
  }

  if (!open) {
    return (
      <>
        <Styles />
        <div className="tk-tools">
          <Button onClick={() => setOpen(true)}>Say it differently</Button>
        </div>
      </>
    )
  }

  return (
    <>
      <Styles />
      <div className="tk-editor">
        <label>
          <span className="tk-tag" style={{ marginLeft: 0 }}>
            In your words
          </span>
          <textarea
            ref={field}
            className="tk-field"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={2}
          />
        </label>
        <div className="tk-tools">
          <Button variant="primary" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save this line'}
          </Button>
          <Button
            onClick={() => {
              setText(claim.text)
              setOpen(false)
            }}
            disabled={pending}
          >
            Leave it
          </Button>
        </div>
        {problem ? <p className="tk-problem">{problem}</p> : null}
      </div>
    </>
  )
}

/* ── why I think that ───────────────────────────────────────────────────── */

/**
 * A real disclosure, not a tooltip. Re-entry finding 9: a `title` attribute is
 * not reliably reachable by keyboard or by a screen reader, and the support
 * behind a claim is exactly the thing a person needs when they suspect the
 * claim is wrong.
 */
function Why({ evidence }: { readonly evidence: readonly EvidenceView[] }) {
  if (evidence.length === 0) return null

  return (
    <>
      <Styles />
      <details className="tk-why">
        <summary>
          Why I think that — {evidence.length === 1 ? 'one thing you did' : `${evidence.length} things you did`}
        </summary>
        <ul className="tk-why-body">
          {evidence.map((item, i) => (
            <li className="tk-why-row" key={`${item.at}-${i}`}>
              <span className="tk-at">{item.at}</span>
              <div>
                <p className="tk-why-what">{item.what}</p>
                {item.quote ? <Quotation text={item.quote} said={item.sourceLabel} /> : null}
              </div>
            </li>
          ))}
        </ul>
      </details>
    </>
  )
}

/* ── an attributed quotation ────────────────────────────────────────────── */

/**
 * Page-authored text never appears without its source beside it. Not decoration:
 * without the attribution a quotation reads as something Propositum decided,
 * and the person's reaction to it becomes a rubber stamp rather than a judgment
 * about a source they chose to trust.
 */
/**
 * A quotation, or — when the words are not the source's — an honest paraphrase.
 *
 * `verbatim: false` means the model's quote failed verification against the
 * cited page text, so `text` is the model's own wording. Rendering that inside
 * quotation marks with "Northwind partners says" fabricates an attribution.
 *
 * That is worse than no attribution: the whole point of the attributed aside is
 * that retyping a constraint into the agreement is an INFORMED act. If the site
 * never said it, the friction has become laundering.
 */
export function Quotation({
  text,
  said,
  verbatim = true,
  children,
}: {
  readonly text: string
  readonly said: string | null
  readonly verbatim?: boolean | undefined
  readonly children?: ReactNode | undefined
}) {
  const still = useReducedMotion()

  return (
    <>
      <Styles />
      <motion.blockquote
        className="tk-quote"
        initial={still ? false : { opacity: 0, x: -3 }}
        animate={{ opacity: 1, x: 0 }}
        transition={still ? { duration: 0 } : { duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        {verbatim ? (
          <>
            <cite className="tk-quote-said">{said ? `${said} says` : 'A page you read says'}</cite>
            &ldquo;{text}&rdquo;
          </>
        ) : (
          <>
            <cite className="tk-quote-said">
              {said
                ? `Propositum read something like this on ${said}`
                : 'Propositum read something like this'}
            </cite>
            {text}
          </>
        )}
        {children}
      </motion.blockquote>
    </>
  )
}
