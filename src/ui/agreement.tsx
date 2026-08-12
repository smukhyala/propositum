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
import type { ContractDrafted } from '../server/actions'
import { ACTION_KINDS, compilePolicy } from '../domain/handoff/policy'
import type { ActionKind, AutonomyControls } from '../domain/handoff/policy'

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
  }) => void
}

/* ── the one stylesheet for this screen ─────────────────────────────────── */

const CSS = `
.ag-field { font: inherit; font-family: var(--serif); font-size: 1.0625rem; width: 100%; padding: 0.6rem 0.7rem; background: var(--ground); color: var(--ink); border: 1px solid var(--rule); border-radius: 3px; resize: vertical; }
.ag-field:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
.ag-label { display: block; font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin: 0 0 0.4rem; }
.ag-hint { margin: 0.45rem 0 0; font-size: 0.875rem; color: var(--muted); max-width: 40rem; }
.ag-hint-tight { margin: 0 0 0.9rem; font-size: 0.875rem; color: var(--muted); max-width: 40rem; }

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

const ACTION_LABEL: Readonly<Record<ActionKind, string>> = {
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
 * Capabilities that are not in `ActionKind` at all.
 *
 * These are not switched off and no setting turns them on. Rendering them in
 * the same group as a dialled-down permission would tell the person the two are
 * the same kind of promise, and they are not: one is a choice, the other is an
 * absence.
 *
 * ── This list becomes FALSE the moment a contract grants `click-element` ──
 *
 * Read this before granting a browser capability from any handoff path.
 *
 * `ActionKind` now also holds the browser-driving verbs, and `click-element`
 * can press the page's own *Send*, *Buy* or *Delete* button. So *"Propositum
 * has no way to do them, and no setting on this page turns one on"* stops being
 * true for any contract that grants it. The claim survives today only because
 * `draftContract` grants `DOCUMENT_ACTION_KINDS`, which excludes every browser
 * verb — so no contract this code can currently produce makes the panel lie.
 *
 * When a browser handoff ships, this panel must change with it: the honest
 * version says what stands between a click and an order, which is the
 * confirmation pause, not an absence. Two other sentences in this component go
 * false at the same moment and are named here so they are found together —
 * *"Nothing lands in the document itself"* (a click lands immediately, with no
 * review step) and *"If a page it reads links somewhere else, it cannot follow
 * the link"* (`navigate` follows links within an approved source).
 */
const ABSENT: readonly string[] = [
  'Send an email or a message',
  'Publish anything',
  'Buy anything',
  'Delete a file',
]

const TIME_CHOICES: readonly number[] = [15, 30, 60, 120, 240]

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
      })
    })
  }

  const ready = objective.trim().length > 0 && definitionOfDone.trim().length > 0
  const inView = pinned === null ? undefined : draft.quotedConstraints[pinned]

  return (
    <>
      <Styles />

      <Section title="What I'll work on" index={1}>
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
          Propositum drafted this from what it read. Correct it — this sentence is what it works
          towards, and it is easier to fix now than to unpick afterwards.
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
          These are the sources you approved and Propositum actually used this session. If a page it
          reads links somewhere else, it cannot follow the link — it will tell you it didn&rsquo;t.
        </p>
      </Section>

      <Section title="What I can change" index={3}>
        {/* A Shift that pins no document has to say so rather than name a place
            that does not exist. The second sentence survives either way: nothing
            lands anywhere until the person decides on it. */}
        <p className="ag-hint-tight">
          {draft.documentTitle === null ? (
            <>Nothing yet — this shift has no document under it. </>
          ) : (
            <>
              In <strong>{draft.documentTitle}</strong>, and nowhere else.{' '}
            </>
          )}
          Nothing lands anywhere on its own — Propositum proposes and you decide on each one when
          you get back.
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
                      {kind === 'draft-section'
                        ? 'You chose research only, so Propositum will come back with findings, questions and next steps — and no text for your document.'
                        : 'Not part of this agreement. Propositum is refused if it tries.'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="ag-absent">
          <h3 className="ag-group-head">What Propositum cannot do at all</h3>
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
          <p className="ag-hint" style={{ marginTop: 0 }}>
            These aren&rsquo;t switched off. Propositum has no way to do them, and no setting on this
            page turns one on.
          </p>
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

        <TimeLimit minutes={timeLimitMinutes} onChange={setTimeLimitMinutes} />
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

        <GuidanceEntry
          field={guidanceField}
          onAdd={(line) => setGuidance([...guidance, line])}
        />

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
}: {
  readonly minutes: number
  readonly onChange: (next: number) => void
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
