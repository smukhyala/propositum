/**
 * "While you were away" — the re-entry note.
 *
 * ── The render order is not the schema order, and this file owns that ────
 *
 * `ShiftReport` lists its sections in schema order: completed work, the
 * changes, refusals, gaps, decisions, where it stopped. Rendered that way the
 * decision — the reason the person came back — sits five sections down, and the
 * changes are unreadable until you know the open question, because some of them
 * presuppose its answer.
 *
 * So the order here is fixed, deliberate, and stated once:
 *
 *   narrative → what I need from you → what I made → the changes → what I did →
 *   what I didn't do, and why → what I missed → resume
 *
 * Re-entry finding 1. Do not reorder without reading it.
 *
 * ── Where "What I made" sits, and why it is above the changes ────────────
 *
 * It is the one-minute list. A Shift now produces a `ShiftOutcome` — five kinds
 * of thing, of which document changes are one — and the person coming back
 * needs to know what was made before they can judge any single piece of it. The
 * changes stay below because they are the review surface for exactly one of
 * those kinds, and a person whose Shift answered a question should not have to
 * scroll past a document review that has nothing in it.
 *
 * It sits BELOW "what I need from you" for the reason that section is first at
 * all: an open question can invalidate everything under it, so it goes above
 * everything it could invalidate.
 *
 * ── Two screens, because a drifted shift is a different note ─────────────
 *
 * The document is never locked (ADR-0003), so a person who edits it during a
 * shift makes the whole changeset refuse on drift. That is routine, not
 * exceptional, and what it needs is not a review surface with everything
 * greyed out — it is an explanation and a way forward. `DriftedShift` is that
 * screen: no diff, no accept, no reject.
 *
 * ── The narrative fails open ─────────────────────────────────────────────
 *
 * One model-authored sentence, and it is allowed to be absent. When it is, the
 * top of the note says so plainly instead of collapsing to a bare time window.
 * Everything else on both screens is a rendering of durable rows.
 */

'use client'

import { useMemo, useState, useTransition } from 'react'
import { motion, useReducedMotion } from 'motion/react'

import {
  BackLink,
  Button,
  Empty,
  LogEntry,
  Masthead,
  Narrative,
  Section,
  Sheet,
} from './primitives'
import { ChangeCard } from './diff'
import type { ChangeVerdict, ChangeView } from './diff'
import { WhatIMade } from './outcome'
import type { OutcomeVerdict, OutcomeView } from './outcome'
import { Away, Done, Refused, Unknown, Wrote } from './sprites'
import {
  answerDecision,
  finishShift,
  recordOutcomeVerdict,
  recordVerdict,
} from '../server/actions'

/* ── the one stylesheet ─────────────────────────────────────────────────── */

const CSS = `
.ps-window { font-family: var(--mono); font-size: 0.8125rem; color: var(--muted); font-variant-numeric: tabular-nums; margin: 0; }
.ps-window-why { margin: 0.4rem 0 0; font-size: 0.8125rem; color: var(--faint); font-family: var(--sans); max-width: 34rem; }

.ps-no-narrative { font-size: 0.9375rem; color: var(--muted); margin: 2rem 0 0; padding-left: 1.25rem; border-left: 2px solid var(--rule); max-width: 38rem; }
.ps-narrative-wrap { margin-top: 2rem; }

.ps-question { font-family: var(--serif); font-size: 1.1875rem; line-height: 1.45; margin: 0 0 0.75rem; text-wrap: pretty; }
.ps-stakes { margin: 0 0 0.75rem; color: var(--muted); font-size: 0.9375rem; max-width: 42rem; }
.ps-needs { margin: 0 0 1rem; font-size: 0.9375rem; max-width: 42rem; }
.ps-needs strong { font-weight: 600; }
.ps-settle { display: flex; gap: 0.75rem; align-items: baseline; flex-wrap: wrap; }
.ps-settle-note { margin: 0; font-size: 0.8125rem; color: var(--muted); max-width: 34rem; }
/* The answer field is a textarea and not an input, because the questions this
   asks are not one-line questions. ADR-0022. */
.ps-answer-field { flex-basis: 100%; font: inherit; font-size: 0.9375rem; padding: 0.5rem 0.6rem; border: 1px solid var(--ink); background: var(--paper); color: var(--ink); resize: vertical; }
.ps-answered { margin: 0; flex-basis: 100%; font-size: 0.9375rem; max-width: 42rem; }
.ps-answered strong { font-weight: 600; }
.ps-decision + .ps-decision { margin-top: 2rem; padding-top: 1.75rem; border-top: 1px solid var(--attention); }

.ps-resume { margin-top: 3.25rem; padding-top: 1.5rem; border-top: 2px solid var(--ink); }
.ps-resume-row { display: flex; flex-wrap: wrap; gap: 0.9rem; align-items: center; justify-content: space-between; }
.ps-resume p { margin: 0; color: var(--muted); font-size: 0.9375rem; max-width: 30rem; }
.ps-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.ps-blocked { margin: 0.9rem 0 0; font-size: 0.875rem; color: var(--attention); max-width: 42rem; }
.ps-count { margin: 0.9rem 0 0; font-size: 0.8125rem; color: var(--faint); }
.ps-problem { margin: 0.9rem 0 0; font-size: 0.875rem; color: var(--attention); max-width: 42rem; }

.ps-stopped { margin: 0; font-size: 0.9375rem; }
.ps-stopped-why { margin: 0.35rem 0 0; font-size: 0.875rem; color: var(--muted); max-width: 42rem; }

.ps-drift { font-family: var(--serif); font-size: 1.1875rem; line-height: 1.45; margin: 0 0 0.75rem; text-wrap: pretty; }
.ps-drift-detail { margin: 0 0 1rem; color: var(--muted); font-size: 0.9375rem; max-width: 42rem; }

/* An anchor that carries a button's weight. It navigates, so it stays an <a>:
   a button that goes somewhere breaks the back button and the keyboard. */
.ps-go { display: inline-block; font: inherit; font-size: 0.8125rem; line-height: 1.4; padding: 0.35rem 0.9rem; border: 1px solid var(--accent); border-radius: 3px; background: var(--accent); color: var(--ground); text-decoration: none; }
.ps-go:hover { filter: brightness(1.07); }
.ps-go:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
`

function Styles() {
  return (
    <style href="propositum-shift-report" precedence="default">
      {CSS}
    </style>
  )
}

/* ── what a screen is handed ────────────────────────────────────────────── */

/** Every mark is a sprite with its own accessible name — no emoji, and never
 *  colour alone. `unknown` is the routine one under the sleep constraint, so it
 *  is drawn as calmly as `done`. */
export type LogMark = 'done' | 'wrote' | 'unknown' | 'failed' | 'refused' | 'stopped' | 'gap'

export interface LogRow {
  readonly id: string
  /** Formatted by the caller: "4:14 pm", "3:41–3:52 pm", or nothing at all. */
  readonly time: string | null
  /** Plain prose. "Read Northwind's partner programme page". */
  readonly sentence: string
  /**
   * The second clause. An outcome nobody can adjudicate reads as a failure
   * without one, so an `unknown` row always carries "Nothing was changed."
   */
  readonly detail?: string | undefined
  readonly mark: LogMark
}

export interface DecisionView {
  readonly id: string
  readonly question: string
  /** Why it stopped rather than guessing. */
  readonly whyStopped: string
  /** What it would need in order to carry on. */
  readonly needs: string
  /**
   * The person's own words, or null while the question is still open.
   *
   * Added 2026-08-26 ([ADR-0022](../../docs/adr/0022-the-fourth-verdict.md)).
   * Before it, this screen showed a question and offered a toggle whose own copy
   * admitted the answer went nowhere.
   */
  readonly answer: string | null
}

/**
 * The way back up, on both screens.
 *
 * This note is where a person arrives cold, often from a link they followed
 * hours after they left. Without it the only exit is the browser's back button
 * into a page they may never have had open.
 */
export interface UpOneLevel {
  readonly href: string
  /** The project's own name, so the way back names a place rather than a level. */
  readonly label: string
}

export interface ShiftWindow {
  readonly startedLabel: string
  readonly endedLabel: string
  /**
   * True when the run ended by lease sweep. The end time is then the sweep's
   * clock, not the lid's, and may be hours late — so the label reads
   * "sometime before 7:41 pm" and the reason is inline text, never a tooltip.
   */
  readonly approximate: boolean
  readonly approximateWhy: string | null
}

export interface ShiftReportProps {
  /** Mono, uppercase, above the title. The document this note is about. */
  readonly kicker: string
  /** The one model-authored line, or null. The note renders either way. */
  readonly narrative: string | null
  readonly window: ShiftWindow
  /** "6 of 9 steps · 1 decision for you". Counted from rows, never a summary. */
  readonly tally: string
  readonly decisions: readonly DecisionView[]
  /**
   * Everything this Shift produced, oldest first.
   *
   * Read off `ShiftOutcome` rows and empty for every Shift that ran before that
   * table had a writer — which is why the section renders nothing at all when
   * this is empty, rather than reporting an absence it cannot know about.
   */
  readonly made: readonly OutcomeView[]
  readonly changes: readonly ChangeView[]
  /** What to say when Propositum proposed no text at all — a designed-for
   *  outcome under "Research only — don't write", not a failure. */
  readonly noChangesNext: string
  readonly did: readonly LogRow[]
  readonly didnt: readonly LogRow[]
  readonly missed: readonly LogRow[]
  readonly stopped: { readonly sentence: string; readonly detail: string | null }
  /** Where to pick up. Null when there is nothing waiting. */
  readonly resume: string | null
  readonly up: UpOneLevel
  /** Needed by the one act that writes: the fold is addressed by contract,
   *  because a changeset belongs to exactly one. */
  readonly contractId: string
  /** Already folded, on arrival. A review settles once, and reopening the page
   *  after it has must not offer to do it again. */
  readonly alreadyPutIn: { readonly ordinal: number } | null
}

/* ── shared parts ───────────────────────────────────────────────────────── */

function Mark({ mark }: { readonly mark: LogMark }) {
  switch (mark) {
    case 'done':
      return <Done size={16} title="Done" />
    case 'wrote':
      return <Wrote size={16} title="Written" />
    case 'refused':
      return <Refused size={16} title="Not allowed by your settings" />
    case 'stopped':
      return <Away size={16} title="Stopped" />
    case 'failed':
      return <Unknown size={16} title="Couldn't finish" />
    case 'gap':
      return <Unknown size={16} title="Not seen" />
    case 'unknown':
      return <Unknown size={16} title="Started — I don't know how this ended" />
  }
}

function Log({ rows }: { readonly rows: readonly LogRow[] }) {
  return (
    <div>
      {rows.map((row, i) => (
        <LogEntry
          key={row.id}
          index={i}
          mark={<Mark mark={row.mark} />}
          {...(row.time === null ? {} : { time: row.time })}
          {...(row.detail === undefined ? {} : { detail: row.detail })}
        >
          {row.sentence}
        </LogEntry>
      ))}
    </div>
  )
}

function Top({
  kicker,
  narrative,
  window,
  tally,
}: {
  readonly kicker: string
  readonly narrative: string | null
  readonly window: ShiftWindow
  readonly tally: string
}) {
  const still = useReducedMotion()

  return (
    <>
      <Styles />
      <Masthead
        kicker={kicker}
        title="While you were away"
        mark={<Away size={20} delay={0.25} />}
        subtitle={
          <>
            <p className="ps-window">
              {window.startedLabel} &rarr; {window.approximate ? 'sometime before ' : ''}
              {window.endedLabel} &middot; {tally}
            </p>
            {window.approximateWhy === null ? null : (
              <p className="ps-window-why">{window.approximateWhy}</p>
            )}
          </>
        }
      />

      <motion.div
        className="ps-narrative-wrap"
        initial={still ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={
          still ? { duration: 0 } : { duration: 0.45, delay: 0.1, ease: [0.16, 1, 0.3, 1] }
        }
      >
        {narrative === null ? (
          <p className="ps-no-narrative">
            Propositum couldn&rsquo;t write its summary line this time. Everything below is the
            record itself, which is the part that matters.
          </p>
        ) : (
          <Narrative>{narrative}</Narrative>
        )}
      </motion.div>
    </>
  )
}

function WhatIDid({ rows }: { readonly rows: readonly LogRow[] }) {
  return (
    <Section title="What I did">
      {rows.length === 0 ? (
        <Empty
          title="Propositum got nothing done before it stopped."
          next="Where it stopped is at the foot of this note. Nothing in your document changed."
        />
      ) : (
        <Log rows={rows} />
      )}
    </Section>
  )
}

function WhatIDidnt({ rows }: { readonly rows: readonly LogRow[] }) {
  if (rows.length === 0) return null

  // The most reassuring section on the page, and the place an injection
  // surfaces where the person will actually read it. It gets full weight, not
  // a footnote.
  return (
    <Section title="What I didn't do, and why">
      <Log rows={rows} />
    </Section>
  )
}

function WhatIMissed({ rows }: { readonly rows: readonly LogRow[] }) {
  if (rows.length === 0) return null

  return (
    <Section title="What I missed">
      <Log rows={rows} />
    </Section>
  )
}

function WhereIStopped({ stopped }: { readonly stopped: ShiftReportProps['stopped'] }) {
  return (
    <Section title="Where I stopped">
      <p className="ps-stopped">{stopped.sentence}</p>
      {stopped.detail === null ? null : <p className="ps-stopped-why">{stopped.detail}</p>}
    </Section>
  )
}

/* ── what I need from you ───────────────────────────────────────────────── */

/**
 * One question, and the field that answers it. ADR-0022.
 *
 * ── What this replaced, and why the old copy is worth remembering ─────────
 *
 * Until 2026-08-26 the control here was a toggle reading *"I've settled this"*,
 * under a sentence that said out loud: *"Propositum doesn't keep your answer —
 * settling this only unlocks accepting the changes together. Write the answer
 * into the document yourself."* That was honest and it was the product telling
 * somebody, in its own interface copy, that it was not listening. The toggle was
 * client state; nothing was written anywhere.
 *
 * It is a text field and not two buttons, and that is the decision rather than a
 * styling choice. A `DecisionNeeded` exists precisely because the worker met
 * something it could not reduce to a choice — reducing it here would be the
 * model's failure to enumerate, papered over by ours, and a Yes and a No on this
 * screen would be a confirmation control sitting one heading away from the real
 * one.
 *
 * Answering IS settling now. There is no separate toggle, because a second
 * control that unlocks the changes without recording anything is the old
 * affordance with the honest sentence removed.
 */
function OneDecision({
  decision,
  answered,
  onAnswer,
}: {
  readonly decision: DecisionView
  /** The answer as it stands now — the row's, or the one just given. */
  readonly answered: string | null
  readonly onAnswer?: ((id: string, answer: string) => void) | undefined
}) {
  const [draft, setDraft] = useState('')

  return (
    <div className="ps-decision">
      <p className="ps-question">{decision.question}</p>
      <p className="ps-stakes">{decision.whyStopped}</p>
      <p className="ps-needs">
        <strong>What I&rsquo;d need:</strong> {decision.needs}
      </p>

      {answered !== null ? (
        <div className="ps-settle">
          <p className="ps-answered">
            <strong>You said:</strong> {answered}
          </p>
          <p className="ps-settle-note">
            Kept with this note. Nothing acts on it on its own &mdash; the next time you hand this
            work over, you decide what goes in the agreement.
          </p>
        </div>
      ) : onAnswer === undefined ? null : (
        <div className="ps-settle">
          <label className="ps-settle-note" htmlFor={`answer-${decision.id}`}>
            Tell it what you want, in your own words.
          </label>
          <textarea
            id={`answer-${decision.id}`}
            className="ps-answer-field"
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button
            onClick={() => {
              const clean = draft.trim()
              if (clean !== '') onAnswer(decision.id, clean)
            }}
          >
            Tell it
          </Button>
        </div>
      )}
    </div>
  )
}

function Decisions({
  decisions,
  answers,
  onAnswer,
}: {
  readonly decisions: readonly DecisionView[]
  /** Answers given on this screen, over the top of the ones already on the row. */
  readonly answers?: Readonly<Record<string, string>> | undefined
  /**
   * Absent on the drifted screen. The field exists to unblock reviewing the
   * changes, and there are none there — a control whose whole purpose is missing
   * should not be on the page. The question and the answer still render.
   */
  readonly onAnswer?: ((id: string, answer: string) => void) | undefined
}) {
  if (decisions.length === 0) return null

  return (
    <Section title="What I need from you" tone="attention">
      {decisions.map((decision) => (
        <OneDecision
          key={decision.id}
          decision={decision}
          answered={answers?.[decision.id] ?? decision.answer}
          {...(onAnswer === undefined ? {} : { onAnswer })}
        />
      ))}
    </Section>
  )
}

/* ── the full note ──────────────────────────────────────────────────────── */

export function ShiftReport(props: ShiftReportProps) {
  const [recorded, setRecorded] = useState<Readonly<Record<string, ChangeVerdict>>>({})
  const [decidedOutcomes, setDecidedOutcomes] = useState<Readonly<Record<string, OutcomeVerdict>>>(
    {},
  )
  /**
   * Answers given on this screen, keyed by decision.
   *
   * Was `settled: Set<string>` — client state that unlocked a button and wrote
   * nothing. It holds prose now, over the top of what the row already carries,
   * for the same reason `recorded` and `decidedOutcomes` exist beside their
   * props: the server action has written, and the page has not re-rendered yet.
   */
  const [answers, setAnswers] = useState<Readonly<Record<string, string>>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [finished, setFinished] = useState<
    { ordinal: number; kept: number; discarded: number } | 'no-document' | null
  >(props.alreadyPutIn ? { ordinal: props.alreadyPutIn.ordinal, kept: -1, discarded: -1 } : null)
  const [busy, startWriting] = useTransition()

  const changes = useMemo(
    () =>
      props.changes.map((change) => ({
        ...change,
        verdict: recorded[change.id] ?? change.verdict,
      })),
    [props.changes, recorded],
  )

  const made = useMemo(
    () =>
      props.made.map((outcome) => ({
        ...outcome,
        verdict: decidedOutcomes[outcome.id] ?? outcome.verdict,
      })),
    [props.made, decidedOutcomes],
  )

  const undecided = changes.filter((c) => c.verdict === null)
  /**
   * Outcomes still waiting on a decision.
   *
   * A landed outcome is never in this set, and it is filtered by the same test
   * the card and the server use: `landed` means it already happened, so there
   * is nothing to wait for. Counting one here would leave the person unable to
   * finish and unable to see why.
   *
   * The document outcome is excluded too — its decidable units are the changes,
   * which `undecided` already counts.
   */
  const undecidedMade = made.filter(
    (o) => !o.landed && o.kind !== 'document-changes' && o.verdict === null,
  )
  const places = new Set(changes.map((c) => c.where ?? '')).size
  /**
   * Questions with no answer, from either source.
   *
   * These gate accepting the changes together — ADR-0019 keeps per-change
   * verdicts per-change, and *Accept all* stays inert while a question is open,
   * because some of the changes assume an answer to it. The gate is unchanged;
   * what changed is that clearing it now requires saying something.
   */
  const openQuestions = props.decisions.filter(
    (d) => (answers[d.id] ?? d.answer) === null || (answers[d.id] ?? d.answer) === undefined,
  )

  /**
   * Does the document review belong on this screen at all?
   *
   * Shown whenever there are changes, and whenever a run said it produced
   * document changes. Shown for a Shift with no outcome rows too — that is
   * every Shift recorded before the table had a writer, and its empty state is
   * a sentence somebody wrote for a real situation. Hidden only when the run
   * plainly produced something that was not a document, because "Propositum
   * proposed no text" under an answer it did propose reads as a failure.
   */
  const showChanges =
    changes.length > 0 ||
    made.length === 0 ||
    made.some((outcome) => outcome.kind === 'document-changes')

  /**
   * The two verdict tables, counted as one number for the person.
   *
   * They are separate tables for good reasons that are all about offsets and
   * folds and none of which the person has any business knowing. What they see
   * is a note with things on it waiting to be decided, and one honest count of
   * how many are left.
   */
  const stillWaiting = undecided.length + undecidedMade.length
  const somethingToFinish = changes.length > 0 || made.some((outcome) => !outcome.landed)
  /**
   * Said in changes when changes are all that is waiting, and in things when
   * they are not.
   *
   * Keyed off what is UNDECIDED rather than off what exists, and the difference
   * matters as soon as the run path writes a `document-changes` row for every
   * document Shift: keyed off existence, an ordinary document review with three
   * changes left would read "3 things", while the server refusing the same
   * finish would say "3 changes". Two numbers with two nouns for one state is
   * how a person starts wondering which of them is counting something else.
   */
  const waitingNoun = undecidedMade.length === 0 ? 'change' : 'thing'

  /**
   * Re-entry finding 2, the interaction bug the prototype caught: *Accept all*
   * sat a few centimetres below an unanswered question, and two of the three
   * changes assumed an answer to it. Pressing it commits text that presupposes
   * a decision the person has not made.
   *
   * So it is disabled while a question is open — and the reason is on the page
   * as text, not only in a `title`, because a control that is merely grey tells
   * the person it is broken rather than that it is waiting.
   *
   * Per-change Accept stays live throughout: deciding one change at a time is
   * exactly the deliberate act the batch button skips.
   */
  const blocked = openQuestions.length > 0
  const blockedWhy =
    openQuestions.length === 1
      ? "There's still a question waiting on you. Some of these changes assume an answer to it — accepting them together would commit you to a decision you haven't made. Settle it above, or decide on each change yourself."
      : `There are still ${openQuestions.length} questions waiting on you. Some of these changes assume answers to them — accepting them together would commit you to decisions you haven't made. Settle them above, or decide on each change yourself.`

  function decide(id: string, verdict: 'accept' | 'reject') {
    setProblem(null)
    startWriting(async () => {
      const result = await recordVerdict(id, verdict)
      if (result.ok) setRecorded((prev) => ({ ...prev, [id]: verdict }))
      else setProblem(result.problem.message)
    })
  }

  function decideAll(verdict: 'accept' | 'reject') {
    setProblem(null)
    startWriting(async () => {
      const done: Record<string, ChangeVerdict> = {}
      for (const change of undecided) {
        const result = await recordVerdict(change.id, verdict)
        if (result.ok) done[change.id] = verdict
        else {
          setProblem(result.problem.message)
          break
        }
      }
      setRecorded((prev) => ({ ...prev, ...done }))
    })
  }

  /**
   * One whole thing a Shift made, decided.
   *
   * There is no "accept all" over these on purpose. A change is one span of
   * prose among several in one document; an outcome is a whole production, and
   * a batch control over five different things a run made would be asking
   * somebody to agree with an afternoon's work in one click.
   */
  function decideOutcome(id: string, verdict: OutcomeVerdict, editedText?: string) {
    setProblem(null)
    startWriting(async () => {
      const result = await recordOutcomeVerdict(id, verdict, editedText)
      if (result.ok) setDecidedOutcomes((prev) => ({ ...prev, [id]: verdict }))
      else setProblem(result.problem.message)
    })
  }

  /**
   * The one act that changes the document — when there is a document.
   *
   * Deliberately at the end, and deliberately separate from the verdicts. The
   * base stays immutable for the whole review so offsets remain valid while the
   * person works through the changes in any order; folding as each verdict
   * landed would move the text under everything not yet decided.
   *
   * Until this existed, the review loop recorded decisions and produced
   * nothing, and the copy under this row admitted it: "yours to fold into the
   * document."
   *
   * When the Shift produced no document changes this writes nothing, and the
   * copy under the row says so rather than implying a version appeared
   * somewhere. The decisions above are already the durable record; this is the
   * person saying they are done, and the server checking that they are.
   */
  function finish() {
    setProblem(null)
    startWriting(async () => {
      const result = await finishShift(props.contractId)
      if (result.ok) setFinished(result.value.document ?? 'no-document')
      else setProblem(result.problem.message)
    })
  }

  function answer(id: string, text: string) {
    startWriting(async () => {
      const result = await answerDecision(id, text)
      if (!result.ok) {
        setProblem(result.problem.message)
        return
      }
      setProblem(null)
      setAnswers((prev) => ({ ...prev, [id]: text }))
    })
  }

  return (
    <Sheet>
      <Styles />
      <BackLink href={props.up.href}>&larr; {props.up.label}</BackLink>

      {/* Fixed order — see the note at the top of this file. */}
      <Top
        kicker={props.kicker}
        narrative={props.narrative}
        window={props.window}
        tally={props.tally}
      />

      <Decisions decisions={props.decisions} answers={answers} onAnswer={answer} />

      <WhatIMade outcomes={made} busy={busy} onDecide={decideOutcome} />

      {showChanges ? (
        <Section
          title={
            changes.length === 0
              ? 'The changes'
              : `The changes — ${count(changes.length, 'change')} · ${count(places, 'place')}`
          }
        >
          {changes.length === 0 ? (
            <Empty title="Propositum proposed no text." next={props.noChangesNext} />
          ) : (
            changes.map((change, i) => (
              <ChangeCard key={change.id} change={change} index={i} busy={busy} onDecide={decide} />
            ))
          )}
        </Section>
      ) : null}

      <WhatIDid rows={props.did} />
      <WhatIDidnt rows={props.didnt} />
      <WhatIMissed rows={props.missed} />
      <WhereIStopped stopped={props.stopped} />

      <div className="ps-resume">
        <div className="ps-resume-row">
          <p>
            {finished === 'no-document'
              ? 'Everything here has a decision on it. Nothing was written anywhere — what you decided is the record.'
              : finished !== null
                ? 'These are in your document now. What is there is yours to edit.'
                : (props.resume ??
                  'Nothing is waiting on Propositum. Decide on each change, then put the ones you kept into your document.')}
          </p>
          {somethingToFinish && finished === null ? (
            <div className="ps-actions">
              {changes.length === 0 ? null : (
                <>
                  {/* No `title`. Every reason this control could be blocked is
                      already on the page as text: `.ps-blocked` carries the
                      open-question reason verbatim, and the `role="status"`
                      count below says how many are undecided. Saying it a second
                      time in a tooltip added no information and put it somewhere
                      re-entry finding 9 measured as unreachable by keyboard and
                      screen reader — thorough-looking and absent. */}
                  <Button
                    disabled={blocked || busy || undecided.length === 0}
                    onClick={() => decideAll('accept')}
                  >
                    Accept all
                  </Button>
                  {/* Re-entry finding 3: there was no "none of this applies any
                      more" action, and after a drifted or misjudged shift that is
                      the one a person reaches for. Rejecting is recorded, not
                      erased — the reasons survive, which is what H3 needs. */}
                  <Button
                    disabled={busy || undecided.length === 0}
                    onClick={() => decideAll('reject')}
                  >
                    Discard all of this
                  </Button>
                </>
              )}

              {/*
                The only control on this screen that changes the document, and
                the only one that is primary. It waits for everything still held
                to have a decision on it — a partial fold leaves the review
                neither finished nor abandoned, and the base has to stay still
                while the person works through the changes in any order.

                Its label follows what it will actually do. With document
                changes it writes a version; without them it writes nothing and
                says so, because a button reading "put these into your document"
                over a Shift that produced no document text would be naming an
                act that cannot happen.
              */}
              <Button variant="primary" disabled={busy || stillWaiting > 0} onClick={finish}>
                {changes.length > 0 ? 'Put these into your document' : "I'm done here"}
              </Button>
            </div>
          ) : null}
        </div>

        {finished === null || finished === 'no-document' ? null : (
          <p className="ps-count" role="status">
            {finished.kept < 0
              ? `Saved as version ${finished.ordinal}.`
              : finished.kept === 0
                ? `You kept none of them, so version ${finished.ordinal} reads exactly as it did before. The decisions are on the record.`
                : `Saved as version ${finished.ordinal} — ${count(finished.kept, 'change')} kept, ${finished.discarded} discarded.`}
          </p>
        )}

        {blocked && changes.length > 0 ? <p className="ps-blocked">{blockedWhy}</p> : null}

        {!somethingToFinish ? null : (
          <p className="ps-count" role="status">
            {stillWaiting === 0
              ? 'Everything here has a decision on it.'
              : `${count(stillWaiting, waitingNoun)} still undecided.`}
          </p>
        )}

        {problem === null ? null : (
          <p className="ps-problem" role="status">
            {problem}
          </p>
        )}
      </div>
    </Sheet>
  )
}

/* ── the drifted shift ──────────────────────────────────────────────────── */

export interface DriftedShiftProps {
  readonly kicker: string
  readonly narrative: string | null
  readonly window: ShiftWindow
  readonly tally: string
  readonly decisions: readonly DecisionView[]
  /** How many proposals were set aside. Said as a number, not shown as a diff. */
  readonly setAside: number
  /**
   * Everything else this Shift made, which the drift did not touch.
   *
   * The caller drops the document outcome before it gets here — its changes are
   * the thing that was set aside — and what is left is decidable exactly as it
   * would be on the ordinary note. Nothing about an answer or a collection is
   * addressed by offsets into a version, so nothing about them moved.
   */
  readonly made: readonly OutcomeView[]
  readonly did: readonly LogRow[]
  readonly didnt: readonly LogRow[]
  readonly missed: readonly LogRow[]
  readonly stopped: { readonly sentence: string; readonly detail: string | null }
  /** What the person changed, in their own document, while Propositum was away. */
  readonly driftDetail: string
  /** Where handing over again starts: the session this shift came out of. */
  readonly handoverHref: string
  readonly up: UpOneLevel
}

/**
 * The note for a shift whose changes no longer apply.
 *
 * The document is never locked, so this happens whenever the person edits their
 * own proposal while Propositum is working on it — routine, not exceptional.
 * Their edit always wins: the whole changeset is set aside rather than merged,
 * because a partly-valid one would make them reason about which offsets still
 * mean what they did, which is exactly the work the one-minute target exists to
 * avoid.
 *
 * There is therefore no diff and no verdict here. What the person needs is what
 * happened, why none of it can be applied, and a way to hand over again.
 */
export function DriftedShift(props: DriftedShiftProps) {
  const [decidedOutcomes, setDecidedOutcomes] = useState<Readonly<Record<string, OutcomeVerdict>>>(
    {},
  )
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, startWriting] = useTransition()

  const made = props.made.map((outcome) => ({
    ...outcome,
    verdict: decidedOutcomes[outcome.id] ?? outcome.verdict,
  }))

  function decideOutcome(id: string, verdict: OutcomeVerdict, editedText?: string) {
    setProblem(null)
    startWriting(async () => {
      const result = await recordOutcomeVerdict(id, verdict, editedText)
      if (result.ok) setDecidedOutcomes((prev) => ({ ...prev, [id]: verdict }))
      else setProblem(result.problem.message)
    })
  }

  return (
    <Sheet>
      <Styles />
      <BackLink href={props.up.href}>&larr; {props.up.label}</BackLink>

      <Top
        kicker={props.kicker}
        narrative={props.narrative}
        window={props.window}
        tally={props.tally}
      />

      <Section title="Why there is nothing to review" tone="attention">
        <p className="ps-drift">
          You changed the document while I was working on it, so none of what I drafted fits it any
          more.
        </p>
        <p className="ps-drift-detail">{props.driftDetail}</p>
        <p className="ps-drift-detail">
          Your version is the one that stands. I set {count(props.setAside, 'proposal')} aside
          rather than fold {props.setAside === 1 ? 'it' : 'them'} into text that has moved
          underneath {props.setAside === 1 ? 'it' : 'them'} — a half-applied draft is worse than
          none. Nothing in your document was changed.
        </p>

        <div className="ps-settle">
          <a className="ps-go" href={props.handoverHref}>
            Hand over again
          </a>
          <p className="ps-settle-note">
            Starting from the document as it stands now. You set how far Propositum should go and
            hand it over yourself &mdash; nothing starts on its own.
          </p>
        </div>
      </Section>

      {/* The rest of the note still stands: the work happened, and the person is
          owed the same account of it as on any other shift. */}
      <Decisions decisions={props.decisions} />

      <WhatIMade outcomes={made} busy={busy} onDecide={decideOutcome} />
      {problem === null ? null : (
        <p className="ps-problem" role="status">
          {problem}
        </p>
      )}

      <WhatIDid rows={props.did} />
      <WhatIDidnt rows={props.didnt} />
      <WhatIMissed rows={props.missed} />
      <WhereIStopped stopped={props.stopped} />
    </Sheet>
  )
}

/* ── small helpers ──────────────────────────────────────────────────────── */

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}
