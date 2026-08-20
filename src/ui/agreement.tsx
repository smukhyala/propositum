/**
 * The working agreement — the last thing a person reads before leaving.
 *
 * ── This panel has to bind, or it is a lie ───────────────────────────────
 *
 * PRODUCT_PRINCIPLES §6: every dial compiles to a deterministic check. The
 * hard case is Output. `suggestions-only` genuinely removes `draft-section`
 * from `ContractScope.allowedActionKinds`, so a worker that proposes document
 * text is refused by the same deny-by-default path as any unauthorized kind.
 *
 * As of 2026-08-12 it removes every kind that can OPERATE a page as well —
 * `click-element`, `type-text`, `press-key` — leaving only the ones that read:
 * `observe-page`, `navigate`, `capture-screen`. That matters to this panel
 * specifically, because "Research only — don't write" is the label a cautious
 * person reaches for, and under the narrower rule that label sat above a
 * worker that could still press buttons in their signed-in browser. The panel
 * renders from `compilePolicy`, so it already tells the truth about this
 * without a second edit — but the label now means what it appears to mean.
 *
 * So "What I can change" is not a relabelling of the same list. It is rendered
 * from `compilePolicy` — the very function the gate evaluates — and flipping
 * Output visibly moves "Draft a section" out of what Propositum may do and into
 * what you have switched off. A person who picks the safest-looking option and
 * receives a drafted document has been lied to by a panel they read as a
 * permission panel; calling the real compiler is how that stays impossible
 * rather than merely unlikely.
 *
 * The panel keeps two refusals visually distinct, and must never blur them:
 *
 *   - **switched off** — inside `ActionKind`, and your dials removed it.
 *   - **does not exist** — absent from the enum entirely. Send a message,
 *     publish, buy, delete. Absence of capability is the strongest prohibition
 *     available, and it is not something a setting could turn back on.
 *
 * ── Where the two pre-filled sentences came from, said out loud ──────────
 *
 * ADR-0011 names its own weak link and this screen is where it lands:
 *
 *   > A handoff screen that pre-fills a `StatedIntent` from an Intention and
 *   > does not say where the words came from would reproduce the exact failure
 *   > the ruling described.
 *
 * The ruling it means is `CONTEXT.md`'s, and its objection is INVISIBILITY
 * rather than duration — *a stale objective inherited quietly by the next
 * sitting is worse than a cold read, because nothing on screen would say it had
 * been.* Two thirds of the answer are structural: no model writes an Intention,
 * and no model-facing schema has a field that could carry one. The third is a
 * sentence someone has to keep true in a `.tsx` file, and it is this one.
 *
 * ~~**Today both sentences come from this sitting's reading and from nothing
 * else.**~~ **Amended 2026-08-20 ([ADR-0017](../../docs/adr/0017-continuing-an-intention.md)):
 * they come from one of two places and the screen says which.** On a first
 * sitting they are still the handoff boundary's output, drafted over claims
 * produced from this session's own events. When the work is being picked back
 * up — more than one sitting under the same Intention — `draftContract`
 * pre-fills them from the Intention itself, which is a sentence a person wrote
 * or ratified and which no model may write. `WhereTheWordsCameFrom` renders the
 * arm it was handed, so a person can tell *this is what I worked out from this
 * afternoon* from *this is what you said in March*.
 *
 * ~~**What is still owed, named rather than implied:** the other branch.~~
 * **Owed, then paid, in the wave that made the branch reachable.** The second
 * arm carries `writtenAtEpochMs` and this screen prints the day — which is
 * what the struck sentence asked for and is the whole of the answer to
 * *quietly*. What it does NOT do is make the sentence true: ADR-0011's honest
 * limit stands unchanged, a person who wrote something in March gets it in
 * August with no prompt to revisit it, and the date is the only thing here that
 * gives them a reason to look.
 *
 * ── How weak the tripwire is, measured rather than asserted ──────────────
 *
 * This docblock used to say `tests/reachability.test.ts` *"pins the claim to
 * the code that makes it true, so the day it stops being true the suite says
 * so"*. It did not: it grepped the `draftContract`..`acceptContract` slice of
 * `src/server/actions.ts` for `objective: drafted.value.objective`, which
 * catches the sentence being rewired and does not catch an Intention-sourced
 * value arriving as an ADDITIONAL field that this component then prefers.
 *
 * **The hole is closed and it was closed the way that test asked for.**
 * `ContractDrafted.words` is the provenance discriminant it named, both arms are
 * reachable, and the guard now asserts that this component branches on it and
 * that each branch renders a different account. What is still not a test is the
 * TRUTH of the second arm's date — that it is `Intention.updatedAt` and not
 * some other timestamp — and the only thing holding that is one assignment in
 * `draftContract` with the reachability grep on it.
 *
 * ── The quotations are beside the agreement, never inside it ─────────────
 *
 * ADR-0006 §4 and CONTEXT both settle this: an inferred `constraint` is
 * display-only and structurally barred from `StatedIntent`. The handoff
 * boundary has no field that could carry one, and this screen adds no path
 * either — there is deliberately **no button that writes a quotation into
 * guidance**.
 *
 * What there is: a control that pins the quotation beside the guidance box so
 * the person can read it while they type their own sentence. That is the
 * "deliberate act". A one-tap insert would be a pre-filled constraint with an
 * extra click, and the person's keystroke would become a laundering step for
 * page text rather than a decision they made. The friction is the feature; it
 * is the single point where page prose could otherwise become instruction.
 *
 * ── Budget is time. Only time. ───────────────────────────────────────────
 *
 * The agreement promises a time ceiling, not a spending one. No token figure,
 * no cost figure, no rate — not hidden behind a disclosure, not anywhere.
 */

'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode, RefObject } from 'react'

import { Button, Section, VisuallyHidden } from './primitives'
import { Done, Refused } from './sprites'
import { Quotation } from './reading'
import { acceptContract } from '../server/actions'
import type { ContractDrafted, PrefilledWords } from '../server/actions'
import {
  ACTION_KINDS,
  CONFIRMABLE_ACTION_KINDS,
  compilePolicy,
  TIME_LIMIT_CHOICES,
} from '../domain/handoff/policy'
import type { ActionKind, AutonomyControls } from '../domain/handoff/policy'
import type { CalendarTimeSuggestion } from '../server/calendar'

export interface AgreementProps {
  readonly draft: ContractDrafted
  /** Static product constants from the server. Never model-proposed — a model
   *  that could pre-set the dials would be the autonomy dial itself hijacked. */
  readonly defaults: AutonomyControls
  readonly sourceLabels: Readonly<Record<string, string>>
  readonly onBack: () => void
  readonly onHandedOver: (info: {
    /** The contract that was RATIFIED — not always the one drafted, because
     *  changing a dial writes a fresh draft and ratifies that instead. The
     *  shift report hangs off this id, so passing the drafted one would link
     *  to a shift that never starts. */
    contractId: string
    deadlineAt: string
    allowedActionKinds: readonly ActionKind[]
    /**
     * Whether the DRAFT offered `draft-section` before the dials were read.
     *
     * The ratified allowlist above cannot answer this, and that is the whole
     * reason it is passed. *"Drafting is absent"* and *"you removed drafting"*
     * are different facts, and `allowedActionKinds` collapses them — which is
     * how the next screen came to tell every browser shift that its person had
     * chosen research only. See `whyDraftingIsOff` below for the same
     * discriminant on this screen.
     */
    draftingWasOnOffer: boolean
    /** Null on a shift with nothing to draft into. Also not derivable from the
     *  allowlist, and it separates *"there is no document"* from *"drafting is
     *  simply not part of this agreement"*. */
    documentTitle: string | null
  }) => void
}

/* ── the one stylesheet for this screen ─────────────────────────────────── */

const CSS = `
.ag-field { font: inherit; font-family: var(--serif); font-size: 1.0625rem; width: 100%; padding: 0.6rem 0.7rem; background: var(--ground); color: var(--ink); border: 1px solid var(--rule); border-radius: 3px; resize: vertical; }
.ag-field:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
.ag-label { display: block; font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin: 0 0 0.4rem; }
.ag-hint { margin: 0.45rem 0 0; font-size: 0.875rem; color: var(--muted); max-width: 40rem; }
.ag-hint-tight { margin: 0 0 0.9rem; font-size: 0.875rem; color: var(--muted); max-width: 40rem; }

/* The calendar line, ADR-0014. Set as a hint rather than as a control, because
   it is one: the sentence is the reading and the button is an offer beside it.
   An inline text button, never a chip — a chip would sit in the same visual row
   as the five radios above and read as a sixth choice that the group's own
   checked-state logic could never select. */
.ag-cal { margin-top: 0.35rem; }
.ag-cal-use { font: inherit; font-size: inherit; color: var(--ink); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
.ag-cal-use:hover { text-decoration-thickness: 2px; }
.ag-cal-use:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }

.ag-dial { border: 0; margin: 0 0 1.9rem; padding: 0; }
.ag-dial:last-of-type { margin-bottom: 0; }
.ag-legend { font-family: var(--serif); font-size: 1.125rem; padding: 0; margin: 0 0 0.55rem; }
.ag-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.2rem 0 0; }
.ag-chip { position: relative; display: inline-flex; }
.ag-chip input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.ag-chip span { display: inline-block; font-size: 0.8125rem; line-height: 1.4; padding: 0.35rem 0.9rem; border: 1px solid var(--rule); border-radius: 3px; background: var(--ground); color: var(--muted); }
.ag-chip input:checked + span { background: var(--accent); border-color: var(--accent); color: var(--ground); }
.ag-chip input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }
.ag-chip input:hover:not(:checked) + span { border-color: var(--accent); color: var(--ink); }

.ag-perms { list-style: none; margin: 0 0 1.5rem; padding: 0; }
.ag-perms:last-child { margin-bottom: 0; }
.ag-perm { display: grid; grid-template-columns: 1.5rem 1fr; gap: 0.7rem; align-items: baseline; padding: 0.45rem 0; }
.ag-perm-mark { position: relative; top: 0.22rem; }
.ag-perm-why { display: block; font-size: 0.875rem; color: var(--muted); }
.ag-group-head { font-family: var(--mono); font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin: 1.4rem 0 0.5rem; }
.ag-allowed .ag-perm-mark { color: var(--accent); }
.ag-off .ag-perm, .ag-absent .ag-perm { color: var(--muted); }
.ag-off .ag-perm-mark, .ag-absent .ag-perm-mark { color: var(--faint); }

.ag-guidance { list-style: none; margin: 0 0 0.8rem; padding: 0; }
.ag-guidance li { display: flex; gap: 0.6rem; align-items: baseline; padding: 0.4rem 0; border-bottom: 1px solid var(--rule); }
.ag-guidance p { margin: 0; flex: 1; font-family: var(--serif); }

.ag-aside { margin: 1.75rem 0 0; padding: 1.1rem 1.25rem; border: 1px dashed var(--rule); background: var(--raised); }
.ag-aside-head { font-family: var(--mono); font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin: 0 0 0.6rem; }

/* Attribution, in the shape this product already uses for it: a mono cite line
   over the thing it accounts for, the same as tk-quote-said. */
.ag-from { margin: 0 0 1.15rem; padding: 0.55rem 0 0.55rem 0.85rem; border-left: 2px solid var(--rule); color: var(--muted); font-size: 0.875rem; max-width: 40rem; }
.ag-from-head { display: block; font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin-bottom: 0.3rem; }

.ag-pinned { margin: 0 0 0.7rem; padding: 0.7rem 0.85rem; border: 1px solid var(--attention); }
.ag-pinned-head { font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--attention); margin: 0 0 0.4rem; }

.ag-tools { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin-top: 0.6rem; }
.ag-problem { margin: 0.8rem 0 0; padding: 0.6rem 0.8rem; border-left: 2px solid var(--attention); color: var(--attention); font-size: 0.875rem; }

.ag-foot { margin-top: 3.25rem; padding-top: 1.5rem; border-top: 2px solid var(--ink); }
.ag-foot-line { font-family: var(--serif); font-size: 1.1875rem; line-height: 1.45; margin: 0 0 1.1rem; text-wrap: pretty; }
.ag-foot-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
.ag-foot-note { margin: 0.9rem 0 0; font-size: 0.875rem; color: var(--muted); max-width: 40rem; }
`

function Styles() {
  return (
    <style href="propositum-agreement" precedence="default">
      {CSS}
    </style>
  )
}

/* ── what each ActionKind means, said plainly ───────────────────────────── */

export const ACTION_LABEL: Readonly<Record<ActionKind, string>> = {
  'read-approved-source': 'Read the sources you approved',
  'read-document': 'Read your document',
  'draft-section': 'Draft a section of your document',
  'observe-page': 'Look at the page you are on',
  navigate: 'Open another page on a site you approved',
  'click-element': 'Click something on the page',
  'type-text': 'Type into a box on the page',
  'press-key': 'Press Enter, Tab or Escape',
  'capture-screen': 'Take a picture of the page',
}

/**
 * What a missing kind says when there is nothing more specific to say.
 *
 * It names no cause, and that is why it is safe as a default: a kind can be off
 * the list because a dial removed it or because the shift was never granted it,
 * and this sentence is true either way. Any wording that names ONE of those
 * reasons has to be earned per kind — see `whyDraftingIsOff`.
 */
const NOT_IN_THIS_AGREEMENT = 'Not part of this agreement. Propositum is refused if it tries.'

/**
 * Capabilities that are not in `ActionKind` at all.
 *
 * These are not switched off and no setting turns them on. Rendering them in
 * the same group as a dialled-down permission would tell the person the two are
 * the same kind of promise, and they are not: one is a choice, the other is an
 * absence.
 *
 * ── The list stayed; the SENTENCE UNDER IT had to change ─────────────────
 *
 * This block used to end *"when a browser handoff ships, this panel must change
 * with it"*, naming three sentences that would go false together. The browser
 * handoff shipped: a shift with no document now grants the six browser verbs,
 * and all three went false at once. They are corrected below rather than
 * carried, and the corrections are conditional on what was actually granted,
 * because a document shift is still a document shift and its version of each
 * sentence was true and stays true.
 *
 * **There was a fourth, and it took an audit to find it** (2026-08-20). The
 * explanation under a switched-off `draft-section` said *"You chose research
 * only"* whether or not the dial had anything to do with it, and on a browser
 * shift it never does. It is corrected at `whyDraftingIsOff`, on the same
 * discriminant as these three. Three was the number of sentences the old
 * comment happened to name — never the number that went false.
 *
 * What is still true unconditionally, and is the whole reason the list survives:
 * **there is no code here that composes a message, places an order, publishes
 * or deletes.** `tests/architecture.test.ts` asserts those functions do not
 * exist. What stopped being true is the inference a reader drew from it — that
 * the effects were therefore unreachable — because `click-element` presses the
 * page's own Send button and the page decides what that means.
 *
 * So the honest version says what actually stands there, and it is not an
 * absence: a confirmation pause, per action, raised by deterministic code, with
 * no dial that turns it off. It is weaker, and saying so is the point of the
 * rewrite. Anybody tempted to shorten these sentences back should read
 * ADR-0010's first paragraph first.
 */
const ABSENT: readonly string[] = [
  'Send an email or a message',
  'Publish anything',
  'Buy anything',
  'Delete a file',
]

/**
 * The dial's closed set, which no longer lives here.
 *
 * It was a literal in this file until 2026-08-18, and that was right while this
 * component was the only thing that could name a budget. ADR-0014 lets a
 * calendar free/busy read propose one, and the whole of what makes that
 * proposal safe is that it can only ever name a member of this array — so a
 * second copy beside the suggester would be two ranges that must agree, and the
 * drift would show up as a control whose value no radio can display as chosen.
 * `src/domain/handoff/policy.ts` holds it now, beside the field it is the legal
 * range of.
 */
const TIME_CHOICES = TIME_LIMIT_CHOICES

function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return hours === 1 ? '1 hour' : `${hours} hours`
}

function clockOf(when: Date): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
    .format(when)
    .replace(/\s*(AM|PM)$/i, (_m, half: string) => ` ${half.toLowerCase()}`)
}

/* ══════════════════════════════════════════════════════════ the agreement ══ */

export function Agreement({ draft, defaults, sourceLabels, onBack, onHandedOver }: AgreementProps) {
  const [objective, setObjective] = useState(draft.objective)
  const [definitionOfDone, setDefinitionOfDone] = useState(draft.definitionOfDone)

  const [initiative, setInitiative] = useState(defaults.initiative)
  const [progress, setProgress] = useState(defaults.progress)
  const [output, setOutput] = useState(defaults.output)
  const [interruption, setInterruption] = useState(defaults.interruption)
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(
    TIME_CHOICES.includes(draft.suggestedTimeLimitMinutes)
      ? draft.suggestedTimeLimitMinutes
      : nearestChoice(draft.suggestedTimeLimitMinutes),
  )

  const [guidance, setGuidance] = useState<readonly string[]>([])
  const [pinned, setPinned] = useState<number | null>(null)

  const [problem, setProblem] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const guidanceField = useRef<HTMLTextAreaElement | null>(null)

  /**
   * `compilePolicy` is the function the gate itself evaluates, so this panel
   * cannot drift from what is enforced. It takes a `ContractScope`, and the
   * base version is not part of what a person is being asked to approve here.
   * The empty string keeps this call honest about using the real compiler
   * rather than re-implementing its rules in the interface.
   *
   * The compiler now DOES read it — an empty base compiles to
   * `documentBasePinned: false` — but only the gate consults that field, and
   * this panel renders the allowlist. So the empty string still costs nothing
   * here. If a future panel starts rendering document permissions, it will need
   * the real base id rather than this placeholder.
   */
  const controls: AutonomyControls = {
    initiative,
    progress,
    output,
    interruption,
    timeLimitMinutes,
  }

  const policy = compilePolicy(
    {
      approvedSourceIds: draft.approvedSourceIds,
      allowedActionKinds: draft.allowedActionKinds,
      baseVersionId: '',
    },
    controls,
  )

  const allowed = ACTION_KINDS.filter((kind) => policy.actionKindAllowlist.has(kind))
  const switchedOff = ACTION_KINDS.filter((kind) => !policy.actionKindAllowlist.has(kind))

  /**
   * Two facts about this agreement that three sentences below depend on.
   *
   * Derived from the COMPILED allowlist rather than from the draft's stored
   * kinds, for the reason this whole panel is built on: flipping a dial has to
   * move the words as well as the permission, and the only way that is
   * guaranteed is by asking the function the gate asks. Under
   * *"Research only — don't write"* `compilePolicy` removes every kind that can
   * operate a page, so `mayOperate` goes false and the strong sentence comes
   * back — correctly, because under that setting it is true again.
   */
  const mayOperate = ACTION_KINDS.some(
    (kind) => CONFIRMABLE_ACTION_KINDS.has(kind) && policy.actionKindAllowlist.has(kind),
  )
  const mayFollowLinks = policy.actionKindAllowlist.has('navigate')

  /**
   * Why `draft-section` is not on the list — which is no longer one question.
   *
   * This is the fourth sentence of the family above, and it was left behind
   * when the other three were made conditional. It said *"You chose research
   * only"* whenever `draft-section` was missing, which held while every
   * contract this panel could receive was granted it and the dial was the only
   * thing that could take it away. `grantableActionKinds(false)` grants the
   * browser six and never `draft-section`, so on a shift with no document the
   * kind is absent for a reason that has nothing to do with the dial — and the
   * sentence told a person with *"Draft the changes"* still checked, two
   * sections below, that they had chosen otherwise.
   *
   * The discriminant is the same one the other three use: what was actually
   * GRANTED, against what compiled. A kind that the shift offered and the
   * allowlist no longer has was removed by a dial, and `suggestions-only` is
   * the only rule in `compilePolicy` that removes this one. A kind the shift
   * never offered was never the person's to switch off, and saying so is the
   * whole of the correction — a permission panel may not attribute a decision
   * to someone who did not make it, least of all on the screen where they are
   * about to make one.
   */
  const draftingWasOnOffer = draft.allowedActionKinds.includes('draft-section')
  const whyDraftingIsOff = draftingWasOnOffer
    ? 'You chose research only, so Propositum will come back with findings, questions and next steps — and no text for your document.'
    : draft.documentTitle === null
      ? 'This shift has no document under it, so there is nothing to draft — Propositum will come back with what it found rather than text for a document.'
      : NOT_IN_THIS_AGREEMENT

  function handOver(): void {
    setProblem(null)
    start(async () => {
      const result = await acceptContract(draft.contractId, {
        ...controls,
        guidance,
        objective,
        definitionOfDone,
      })

      if (!result.ok) {
        setProblem(result.problem.message)
        return
      }

      onHandedOver({
        contractId: result.value.contractId,
        deadlineAt: result.value.deadlineAt,
        allowedActionKinds: result.value.allowedActionKinds,
        // Read off the DRAFT, not off what came back. Both are facts about the
        // shift the person just ratified, and neither survives in the ratified
        // allowlist — which is exactly why the screen after this one could not
        // tell a dial from a shift that never had a document.
        draftingWasOnOffer,
        documentTitle: draft.documentTitle,
      })
    })
  }

  const ready = objective.trim().length > 0 && definitionOfDone.trim().length > 0
  const inView = pinned === null ? undefined : draft.quotedConstraints[pinned]

  return (
    <>
      <Styles />

      <Section title="What I'll work on" index={1}>
        <WhereTheWordsCameFrom words={draft.words} />

        <label>
          <span className="ag-label">The objective</span>
          <textarea
            className="ag-field"
            rows={2}
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
          />
        </label>
        <p className="ag-hint">
          Correct it &mdash; this sentence is what Propositum works towards, and it is easier to fix
          now than to unpick afterwards.
        </p>

        <div style={{ marginTop: '1.6rem' }}>
          <label>
            <span className="ag-label">Done means…</span>
            <textarea
              className="ag-field"
              rows={2}
              value={definitionOfDone}
              onChange={(event) => setDefinitionOfDone(event.target.value)}
            />
          </label>
          <p className="ag-hint">
            Say something you could check when you get back. &ldquo;Improve the proposal&rdquo;
            can&rsquo;t be checked; &ldquo;Commercials and Close are drafted&rdquo; can.
          </p>
        </div>
      </Section>

      <Section title="What I can look at" index={2}>
        <ul className="ag-perms ag-allowed">
          {/* From the compiled allowlist, not from the draft — this list and the
              gate's list are the same object, so they cannot disagree. */}
          {[...policy.sourceAllowlist].map((id) => (
            <li className="ag-perm" key={id}>
              <span className="ag-perm-mark">
                <Done size={16} title="Allowed" />
              </span>
              <span>{sourceLabels[id] ?? 'A source you approved'}</span>
            </li>
          ))}
        </ul>
        <p className="ag-hint" style={{ marginTop: 0 }}>
          These are the sources you approved and Propositum actually used this session.{' '}
          {mayFollowLinks ? (
            <>
              It can open other pages on these sites. If a link goes anywhere else, it cannot follow
              it — it will tell you it didn&rsquo;t.
            </>
          ) : (
            <>
              If a page it reads links somewhere else, it cannot follow the link — it will tell you
              it didn&rsquo;t.
            </>
          )}
        </p>
      </Section>

      <Section title="What I can change" index={3}>
        {/* A Shift that pins no document has to say so rather than name a place
            that does not exist.

            The second sentence used to survive either way — "nothing lands
            anywhere on its own" — and it stopped being true for a shift that can
            operate a page. Pressing something on a live page is not a proposal
            waiting for a decision; it happens as it is pressed. So the sentence
            splits, and the version a person reads is decided by the compiled
            allowlist rather than by which one reads better. */}
        <p className="ag-hint-tight">
          {draft.documentTitle === null ? (
            <>Nothing yet — this shift has no document under it. </>
          ) : (
            <>
              In <strong>{draft.documentTitle}</strong>, and nowhere else.{' '}
            </>
          )}
          {mayOperate ? (
            <>
              Anything Propositum writes is a proposal you decide on when you get back. Pressing and
              typing are different: they happen on the page as they happen, so before anything it
              might not be able to take back, Propositum stops and asks you about that one thing.
            </>
          ) : (
            <>
              Nothing lands anywhere on its own — Propositum proposes and you decide on each one
              when you get back.
            </>
          )}
        </p>

        <h3 className="ag-group-head">What Propositum may do</h3>
        <ul className="ag-perms ag-allowed">
          {allowed.map((kind) => (
            <li className="ag-perm" key={kind}>
              <span className="ag-perm-mark">
                <Done size={16} title="Allowed" />
              </span>
              <span>{ACTION_LABEL[kind]}</span>
            </li>
          ))}
        </ul>

        {switchedOff.length > 0 ? (
          <div className="ag-off">
            <h3 className="ag-group-head">What you&rsquo;ve switched off</h3>
            <ul className="ag-perms">
              {switchedOff.map((kind) => (
                <li className="ag-perm" key={kind}>
                  <span className="ag-perm-mark">
                    <Refused size={16} title="Switched off" />
                  </span>
                  <span>
                    {ACTION_LABEL[kind]}
                    <span className="ag-perm-why">
                      {kind === 'draft-section' ? whyDraftingIsOff : NOT_IN_THIS_AGREEMENT}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="ag-absent">
          <h3 className="ag-group-head">
            {mayOperate
              ? 'What Propositum has no way to do itself'
              : 'What Propositum cannot do at all'}
          </h3>
          <ul className="ag-perms">
            {ABSENT.map((thing) => (
              <li className="ag-perm" key={thing}>
                <span className="ag-perm-mark">
                  <Refused size={16} title="Not possible" />
                </span>
                <span>{thing}</span>
              </li>
            ))}
          </ul>
          {mayOperate ? (
            <p className="ag-hint" style={{ marginTop: 0 }}>
              These aren&rsquo;t switched off, and there is nothing in Propositum that does any of
              them. What it can do is press a button on a page — and a page&rsquo;s own button might
              be one of these. So before it presses anything it can&rsquo;t be sure it could take
              back, it stops and asks you about that one thing. That isn&rsquo;t a setting: nothing
              on this page turns it off, and time running out never counts as a yes.
            </p>
          ) : (
            <p className="ag-hint" style={{ marginTop: 0 }}>
              These aren&rsquo;t switched off. Propositum has no way to do them, and no setting on
              this page turns one on.
            </p>
          )}
        </div>
      </Section>

      <Section title="How Propositum should work" index={4}>
        <Dial
          legend="How far should I go?"
          hint="Whether Propositum may act on something it wasn't planning to do."
          name="initiative"
          value={initiative}
          onChange={setInitiative}
          options={[
            { value: 'follow-closely', label: 'Stick to the plan' },
            { value: 'use-judgment', label: 'Use your judgment' },
          ]}
        />

        <Dial
          legend="How much should I get through?"
          hint="Whether Propositum may go past the step it is on, or stop at the end of it."
          name="progress"
          value={progress}
          onChange={setProgress}
          options={[
            { value: 'current-step-only', label: 'Just the step you’re on' },
            { value: 'remaining-plan', label: 'As much of the plan as you can' },
          ]}
        />

        <Dial
          legend="What can I change?"
          hint="This is a permission, not a preference. Research only removes the ability to propose document text at all — look at what it does to the list above."
          name="output"
          value={output}
          onChange={setOutput}
          options={[
            { value: 'suggestions-only', label: 'Research only — don’t write' },
            { value: 'draft-changes', label: 'Draft the changes' },
          ]}
        />

        <Dial
          legend="Stop and ask me when…"
          hint="Propositum always stops when it runs out of time, or when something falls outside this agreement. This adds one more reason."
          name="interruption"
          value={interruption}
          onChange={setInterruption}
          options={[
            { value: 'stop-when-uncertain', label: '…you’re unsure about anything' },
            { value: 'stop-only-when-blocked', label: '…you’re completely stuck' },
          ]}
        />

        {/* The calendar suggestion is passed to the CONTROL, never to the
            state. `timeLimitMinutes` above is initialised from the model's
            proposal and from nothing else, exactly as it was before ADR-0014;
            the only path from a calendar to that number runs through the button
            `TimeLimit` renders, which calls the same `onChange` a radio calls.
            Read `draft.calendarSuggestion` anywhere near a `useState` initial
            value and the guarantee is gone. */}
        <TimeLimit
          minutes={timeLimitMinutes}
          onChange={setTimeLimitMinutes}
          {...(draft.calendarSuggestion === undefined
            ? {}
            : { suggestion: draft.calendarSuggestion })}
        />
      </Section>

      <Section title="Guidance — not a hard limit" index={5}>
        <p className="ag-hint-tight">
          Propositum will try to follow these. It cannot be made to: they are sentences, not
          permissions, and a run that ignores one is bad work rather than a broken rule. Anything
          that must hold belongs in what Propositum can look at and change, above.
        </p>

        <ul className="ag-guidance">
          {guidance.map((line, i) => (
            <li key={`${line}-${i}`}>
              <p>{line}</p>
              <Button onClick={() => setGuidance(guidance.filter((_, j) => j !== i))}>
                Remove
                <VisuallyHidden> the guidance: {line}</VisuallyHidden>
              </Button>
            </li>
          ))}
        </ul>

        {inView === undefined ? null : (
          <PinnedForReference
            text={inView.text}
            said={inView.sourceLabel}
            onClear={() => setPinned(null)}
          />
        )}

        <GuidanceEntry field={guidanceField} onAdd={(line) => setGuidance([...guidance, line])} />

        {draft.quotedConstraints.length > 0 ? (
          <aside className="ag-aside">
            <h3 className="ag-aside-head">What the pages said</h3>
            <p className="ag-hint-tight">
              Propositum found these in what you read. They are quotations from pages, not
              instructions from you, and none of them is part of this agreement. Where Propositum
              could not verify the exact words, it says so rather than quoting. If one matters,
              write it above in your own words — Propositum won&rsquo;t put a page&rsquo;s sentence
              in your mouth.
            </p>
            {draft.quotedConstraints.map((constraint, i) => (
              <Quotation
                key={`${constraint.text}-${i}`}
                text={constraint.text}
                said={constraint.sourceLabel}
                verbatim={constraint.verbatim}
              >
                <span className="ag-tools">
                  <Button
                    onClick={() => {
                      setPinned(i)
                      guidanceField.current?.focus()
                    }}
                    pressed={pinned === i}
                  >
                    Keep this in view while I write
                  </Button>
                </span>
              </Quotation>
            ))}
          </aside>
        ) : null}
      </Section>

      <div className="ag-foot">
        <Summary
          objective={objective}
          minutes={timeLimitMinutes}
          canDraft={policy.actionKindAllowlist.has('draft-section')}
          stopsWhenUnsure={interruption === 'stop-when-uncertain'}
        />

        <div className="ag-foot-actions">
          <Button variant="primary" onClick={handOver} disabled={pending || !ready}>
            {pending ? 'Handing over…' : 'Take over'}
          </Button>
          <Button onClick={onBack} disabled={pending}>
            Back to what I read
          </Button>
        </div>

        <p className="ag-foot-note">
          Nothing runs until you press this, and nothing on this page can switch that off.
        </p>

        {!ready ? (
          <p className="ag-foot-note">
            Fill in what Propositum should work on and what done means first — it will not start
            without both.
          </p>
        ) : null}

        {problem ? <p className="ag-problem">{problem}</p> : null}
      </div>
    </>
  )
}

/* ── where the two sentences came from ──────────────────────────────────── */

/**
 * The account of the two pre-filled sentences, above the fields they account
 * for.
 *
 * ── Two branches, because there are now two sources ──────────────────────
 *
 * ~~Because the answer is currently fixed.~~ *Amended 2026-08-20, ADR-0017.*
 * `draftContract` fills the fields either from the handoff boundary's output —
 * drafted over claims that came from this session's own events — or, when this
 * work is being picked back up, from the Intention a person wrote for it. The
 * branch is not inferred here: it is `ContractDrafted.words`, a discriminant the
 * server sets, because a screen that guessed its own provenance would be the
 * failure wearing the fix's clothes.
 *
 * ── Why only one of the two prints a date ────────────────────────────────
 *
 * The first does not, and that is unchanged. The masthead above already carries
 * this session's window — "3:41 pm — still going", or a closed range — so the
 * time is on screen once, where a person reads it as the time of the sitting
 * rather than as the time of a sentence. A second timestamp there would be the
 * same fact twice, and the two could disagree after a reload.
 *
 * The second must, and that is the whole reason this branch waited for a field
 * on `ContractDrafted`. `CONTEXT.md`'s ruling forbids an objective inherited
 * **quietly**, *because nothing on screen would say it had been* — and words a
 * person wrote in March, pre-filled in August with nothing naming the month, are
 * that failure exactly. The day is printed rather than an elapsed count, because
 * *"3 months ago"* is a computed word about somebody's own sentence and a date
 * is the thing they can check against their own memory.
 *
 * ── What neither branch claims ───────────────────────────────────────────
 *
 * That the sentence is right. ADR-0011 is explicit that human ratification
 * removes silence rather than staleness, and this paragraph removes silence. A
 * person who reads the date and clicks anyway has been told; a person who does
 * not read it has been told anyway, which is the most a display can do.
 */
function WhereTheWordsCameFrom({ words }: { readonly words: PrefilledWords }) {
  if (words.from === 'your-intention') {
    return (
      <>
        <Styles />
        <p className="ag-from">
          <span className="ag-from-head">
            In your own words, from {WROTE_ON.format(new Date(words.writtenAtEpochMs))}
          </span>
          You are picking this back up, so both sentences below are the ones you settled for this
          work rather than anything Propositum worked out this afternoon. Nothing has changed them
          since. If the work has moved on, change them here &mdash; this agreement is settled fresh
          every time, and nothing runs on the old wording by itself.
        </p>
      </>
    )
  }

  return (
    <>
      <Styles />
      <p className="ag-from">
        <span className="ag-from-head">Worked out from this session</span>
        Propositum wrote both sentences below from what it read in the session timed at the top of
        this screen. Neither was carried over from an earlier session, and neither is a sentence you
        settled before it &mdash; so read them as its account of this one, and change anything it
        has wrong.
      </p>
    </>
  )
}

/** The day a person last wrote their own words, spelled out. Never an elapsed
 *  count: "3 months ago" is a computed word about somebody's own sentence, and
 *  a date is what they can check against their own memory of writing it. */
const WROTE_ON = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

function nearestChoice(minutes: number): number {
  let best = TIME_CHOICES[0] ?? 30
  for (const choice of TIME_CHOICES) {
    if (Math.abs(choice - minutes) < Math.abs(best - minutes)) best = choice
  }
  return best
}

/* ── one dial ───────────────────────────────────────────────────────────── */

/**
 * Real radios, not toggle buttons.
 *
 * A radio group gives arrow-key navigation, a single tab stop and a correct
 * announcement for free. `aria-pressed` buttons give none of those and have to
 * be taught each one, which is how the accessible version quietly becomes the
 * one nobody tested.
 */
function Dial<T extends string>({
  legend,
  hint,
  name,
  value,
  onChange,
  options,
}: {
  readonly legend: string
  readonly hint: string
  readonly name: string
  readonly value: T
  readonly onChange: (next: T) => void
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>
}) {
  return (
    <>
      <Styles />
      <fieldset className="ag-dial">
        <legend className="ag-legend">{legend}</legend>
        <p className="ag-hint-tight">{hint}</p>
        <div className="ag-chips">
          {options.map((option) => (
            <label className="ag-chip" key={option.value}>
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  )
}

/* ── the time limit, and only time ──────────────────────────────────────── */

function TimeLimit({
  minutes,
  onChange,
  suggestion,
}: {
  readonly minutes: number
  readonly onChange: (next: number) => void
  /**
   * What the person's calendar says, or nothing — ADR-0014.
   *
   * ── This prop cannot change the limit, and here is why ───────────────
   *
   * It is rendered and it is not applied. There is no `useEffect` that calls
   * `onChange` from it, no default parameter derived from it, and the radios
   * below are `checked={minutes === choice}` against the state its parent owns.
   * The single path from this value to the budget is the button at the bottom
   * of this component, which a person presses, and which calls the same
   * `onChange` the radios call with a number that is already one of the choices
   * they offer. Pressing it is byte-for-byte the same state change as pressing
   * a radio.
   *
   * That is the shape every pre-filled field on this screen has. The objective
   * and the definition of done arrive as text in an editable box that a person
   * reads and corrects; the dials arrive at their product defaults and a person
   * moves them. Nothing on this screen commits until Hand over, and this is not
   * the exception.
   *
   * **What it is not.** It is not evidence, it carries no provenance, and it is
   * not a `guidance` line. It never reaches `StatedIntent`, and there is
   * deliberately no control that writes it into one — the same refusal the
   * quoted constraints live under, for a milder reason: this is a number rather
   * than page prose, but a screen that let one derived value be inserted teaches
   * that derived values are insertable.
   */
  readonly suggestion?: CalendarTimeSuggestion
}) {
  // Rendered only once the client knows the time, so the server and the client
  // never disagree about "now" during hydration.
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => setNow(new Date()), [])

  return (
    <>
      <Styles />
      <fieldset className="ag-dial">
        <legend className="ag-legend">Time limit</legend>
        <p className="ag-hint-tight">
          Propositum stops when this runs out and writes up where it got to, finished or not.
        </p>
        <div className="ag-chips">
          {TIME_CHOICES.map((choice) => (
            <label className="ag-chip" key={choice}>
              <input
                type="radio"
                name="timeLimit"
                value={choice}
                checked={minutes === choice}
                onChange={() => onChange(choice)}
              />
              <span>{minutesLabel(choice)}</span>
            </label>
          ))}
        </div>
        {now ? (
          <p className="ag-hint">
            You&rsquo;d have it back by about{' '}
            <strong>{clockOf(new Date(now.getTime() + minutes * 60_000))}</strong>.
          </p>
        ) : null}

        {/* Said once the suggestion exists, and stated as what it is: a reading
            of the person's own calendar, offered, not applied.

            The sentence names the clock time rather than the gap, because the
            clock time is the fact — Google returned a start instant — and the
            gap is arithmetic over it that the button already carries. It names
            no event, no title and no organiser, because the scope this was
            bought under returns none of those and there is no field here that
            could hold one.

            ── The sentence outlives the button, and that is the point ──────

            Until 2026-08-18 the whole paragraph was hidden when the limit
            already equalled the suggestion — which is precisely the state
            PRESSING THE BUTTON produces. So the one press that made a budget
            calendar-derived also removed the only sentence saying so, and a
            person then ratified a number whose provenance had just been taken
            off the screen. That inverted the requirement four documents state
            as *a number and a sentence saying where it came from*, and it broke
            the rule this repo already holds itself to for pre-filled words:
            *a handoff screen that pre-fills a StatedIntent from an Intention
            without saying where would reproduce the exact failure the ruling
            described*.

            So the sentence renders whenever there is a suggestion at all, and
            only the BUTTON is hidden when it would change nothing — which was
            the real argument the old guard was reaching for. Note that the two
            branches are not the same claim: the second says the limit stops
            before the busy interval, which is true by `suggestTimeLimit`'s
            range and would be a lie if anything ever let the equality arise
            some other way. */}
        {suggestion === undefined ? null : (
          <p className="ag-hint ag-cal">
            Your calendar has you busy from{' '}
            <strong>{clockOf(new Date(suggestion.busyFromMs))}</strong>
            {suggestion.minutes === minutes ? (
              <>, and this time limit stops before then.</>
            ) : (
              <>
                .{' '}
                <button
                  className="ag-cal-use"
                  type="button"
                  onClick={() => onChange(suggestion.minutes)}
                >
                  Stop by then &mdash; {minutesLabel(suggestion.minutes)}
                </button>
              </>
            )}
          </p>
        )}
      </fieldset>
    </>
  )
}

/* ── typing a line of guidance ──────────────────────────────────────────── */

function GuidanceEntry({
  field,
  onAdd,
}: {
  readonly field: RefObject<HTMLTextAreaElement | null>
  readonly onAdd: (line: string) => void
}) {
  const [text, setText] = useState('')
  const clean = text.trim()

  return (
    <>
      <Styles />
      <label>
        <span className="ag-label">Something you want Propositum to bear in mind</span>
        <textarea
          ref={field}
          className="ag-field"
          rows={2}
          value={text}
          placeholder={'Don’t commit to a discount.'}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="ag-tools">
        <Button
          onClick={() => {
            onAdd(clean)
            setText('')
          }}
          disabled={clean.length === 0}
          {...(clean.length === 0 ? { title: 'Write a sentence first.' } : {})}
        >
          Add this
        </Button>
      </div>
    </>
  )
}

/* ── a quotation held beside the box, never inside it ───────────────────── */

/**
 * This pins a quotation next to the guidance field so it can be read while the
 * person writes. It does NOT put the text in the field, and there is no control
 * anywhere on this screen that does.
 *
 * That is the whole barrier: page text becomes an instruction only by passing
 * through a person who read where it came from and decided to say it in their
 * own words. Insert-on-click would make the keystroke ceremonial.
 */
function PinnedForReference({
  text,
  said,
  onClear,
}: {
  readonly text: string
  readonly said: string | null
  readonly onClear: () => void
}) {
  const still = useReducedMotion()

  return (
    <>
      <Styles />
      <motion.div
        className="ag-pinned"
        initial={still ? false : { opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={still ? { duration: 0 } : { duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <p className="ag-pinned-head">You&rsquo;re looking at</p>
        <Quotation text={text} said={said} />
        <p className="ag-hint">
          Write what you want honoured in your own words below. Propositum will not fill this in for
          you — a page&rsquo;s sentence is not a rule until you write it as one.
        </p>
        <div className="ag-tools">
          <Button onClick={onClear}>Put it away</Button>
        </div>
      </motion.div>
    </>
  )
}

/* ── the last sentence before leaving ───────────────────────────────────── */

function Summary({
  objective,
  minutes,
  canDraft,
  stopsWhenUnsure,
}: {
  readonly objective: string
  readonly minutes: number
  readonly canDraft: boolean
  readonly stopsWhenUnsure: boolean
}): ReactNode {
  const trimmed = objective.trim()

  return (
    <>
      <Styles />
      <p className="ag-foot-line">
        For up to {minutesLabel(minutes)}, Propositum will work on{' '}
        <strong>{trimmed.length > 0 ? trimmed : 'nothing yet — say what, above'}</strong>{' '}
        {canDraft
          ? 'and may propose text for your document.'
          : 'and will not propose any text for your document.'}{' '}
        {stopsWhenUnsure
          ? 'It stops and asks you the moment it is unsure.'
          : 'It keeps going unless it is completely stuck.'}
      </p>
    </>
  )
}
