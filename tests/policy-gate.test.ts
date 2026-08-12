/**
 * Gate behaviour.
 *
 * `authorize()` is pure and total, so its decision space is finite and can be
 * walked rather than sampled — every `ActionKind`, crossed with every dial
 * combination, crossed with a situation constructed to trip each rule. A gate
 * with an untested combination is a gate with an unknown hole, and this is the
 * file where that claim is either true or decorative.
 *
 * There is no HTTP path to exercise here; the gate has no runtime surface of
 * its own. **These tables ARE the end-to-end evidence for this unit.**
 */

import { describe, it, expect } from 'vitest'
import {
  ACTION_KINDS,
  MAX_ACTIONS_PER_RUN,
  MAX_MUTATING_ACTIONS_PER_RUN,
  MAX_PLAN_STEPS,
  MUTATING_ACTION_KINDS,
  compilePolicy,
} from '../src/domain/handoff/policy'
import type { ActionKind, AutonomyControls, ContractScope } from '../src/domain/handoff/policy'
import { authorize } from '../src/policy/gate'
import type { ActionParams, RefusalRule, RunContext, ToolProposal } from '../src/policy/gate'
import type { ElementEvidence } from '../src/domain/execution/reversibility'

const scope: ContractScope = {
  approvedSourceIds: ['src-approved'],
  allowedActionKinds: [...ACTION_KINDS],
  baseVersionId: 'ver-1',
}

const controls: AutonomyControls = {
  initiative: 'follow-closely',
  progress: 'current-step-only',
  output: 'draft-changes',
  interruption: 'stop-when-uncertain',
  timeLimitMinutes: 30,
}

/** A plainly harmless control: named, not a submit, not in a form, and bound to
 *  the element the proposals below actually name. Anything more interesting
 *  escalates, which is the classifier's whole job. */
const harmless: ElementEvidence = {
  accessibleNameTokens: ['Show', 'more'],
  role: 'button',
  isSubmitControl: false,
  isInsideForm: false,
  formHasSensitiveField: false,
  ref: 'e12',
  snapshotId: 'snap-1',
}

const run: RunContext = {
  currentStepOrdinal: 2,
  planLength: 5,
  deadlineEpochMs: 10_000,
  nowEpochMs: 0,
  currentSnapshotId: 'snap-1',
  actionsTaken: 0,
  mutatingActionsTaken: 0,
  /**
   * One confirmation the person has already given, so a proposal that
   * legitimately needs one can still be a WELL-FORMED PERMITTED proposal in the
   * table below.
   *
   * `press-key` needs this and the other kinds do not. Its target is whatever
   * holds focus, so no snapshot describes it, so `evidenceFor` can never bind
   * evidence to it and the classifier always escalates. That is deliberate —
   * see the note in `gate.ts` — and it means "a press-key the gate permits" is
   * necessarily "a press-key that was confirmed".
   */
  confirmedRequestIds: new Set<string>(['confirmed-1']),
  targetEvidence: harmless,
}

const read: ToolProposal = {
  kind: 'read-approved-source',
  params: { approvedSourceId: 'src-approved' },
  reason: 'need the partner terms',
  stepOrdinal: 2,
}

const gate = (
  p: Partial<ToolProposal> = {},
  c: Partial<AutonomyControls> = {},
  r: Partial<RunContext> = {},
  s: Partial<ContractScope> = {},
) =>
  authorize(
    compilePolicy({ ...scope, ...s }, { ...controls, ...c }),
    { ...read, ...p },
    { ...run, ...r },
    'intent-1',
  )

/**
 * The params that make each kind a well-formed, permitted proposal.
 *
 * Written out per kind rather than derived, because a derivation would encode
 * the gate's own rules in the test and then agree with any bug in them.
 */
const VALID_PARAMS: Readonly<Record<ActionKind, ActionParams>> = {
  'read-approved-source': { approvedSourceId: 'src-approved' },
  'read-document': { documentId: 'doc-1' },
  'draft-section': { documentId: 'doc-1', sectionPath: 'Pricing', text: 'words' },
  'observe-page': {},
  navigate: { approvedSourceId: 'src-approved', path: '/partners' },
  'click-element': { snapshotId: 'snap-1', ref: 'e12' },
  'type-text': { snapshotId: 'snap-1', ref: 'e12', inputText: 'Acme Ltd' },
  // Carries a confirmation, because a press-key without one is never permitted:
  // it has no ref, so nothing binds evidence to it, so it always escalates.
  'press-key': { snapshotId: 'snap-1', key: 'Enter', confirmationId: 'confirmed-1' },
  'capture-screen': {},
}

const valid = (kind: ActionKind): Partial<ToolProposal> => ({
  kind,
  params: VALID_PARAMS[kind],
  stepOrdinal: 2,
})

/** All sixteen dial combinations. Interruption is included even though the gate
 *  never reads it, so the table cannot quietly stop being exhaustive if it
 *  starts to. */
const DIALS: ReadonlyArray<Partial<AutonomyControls>> = (() => {
  const out: Array<Partial<AutonomyControls>> = []
  for (const initiative of ['follow-closely', 'use-judgment'] as const) {
    for (const progress of ['current-step-only', 'remaining-plan'] as const) {
      for (const output of ['suggestions-only', 'draft-changes'] as const) {
        for (const interruption of ['stop-when-uncertain', 'stop-only-when-blocked'] as const) {
          out.push({ initiative, progress, output, interruption })
        }
      }
    }
  }
  return out
})()

describe('the happy path', () => {
  it('authorizes an in-scope, in-plan, in-budget read', () => {
    const result = gate()

    expect(result.authorized).toBe(true)
    if (result.authorized) {
      expect(result.action.kind).toBe('read-approved-source')
      expect(result.action.intentId).toBe('intent-1')
    }
  })
})

describe('deny by default', () => {
  it('refuses a source that is not approved', () => {
    const r = gate({ params: { approvedSourceId: 'src-elsewhere' } })
    expect(r).toEqual({ authorized: false, rule: 'source_not_approved' })
  })

  it('refuses an action kind the contract did not grant', () => {
    const r = gate({ kind: 'draft-section', params: { documentId: 'doc-1' } }, {}, {}, {
      allowedActionKinds: ['read-approved-source'],
    })
    expect(r).toEqual({ authorized: false, rule: 'action_kind_not_allowed' })
  })

  it('refuses a kind outside the enum, because the grammar does not enforce enums', () => {
    // Verified in #3: `enum` does not survive schema transformation, so the
    // model genuinely can return this. Deny-by-default is the whole defence.
    const r = gate({ kind: 'send-email', params: {} })
    expect(r).toEqual({ authorized: false, rule: 'unknown_action_kind' })
  })

  it('refuses when required params are absent rather than guessing', () => {
    expect(gate({ params: {} })).toEqual({ authorized: false, rule: 'source_missing' })
    expect(gate({ kind: 'draft-section', params: {} })).toEqual({
      authorized: false,
      rule: 'document_missing',
    })
  })
})

describe('Output is a real permission, not a display mode', () => {
  it('suggestions-only removes draft-section from the allowlist entirely', () => {
    const policy = compilePolicy(scope, { ...controls, output: 'suggestions-only' })

    expect(policy.actionKindAllowlist.has('draft-section')).toBe(false)
    expect(policy.actionKindAllowlist.has('read-approved-source')).toBe(true)
  })

  it('so a drafting attempt under suggestions-only is refused by the gate', () => {
    const r = gate(
      { kind: 'draft-section', params: { documentId: 'doc-1' } },
      { output: 'suggestions-only' },
    )
    expect(r).toEqual({ authorized: false, rule: 'action_kind_not_allowed' })
  })

  it('draft-changes permits it', () => {
    const r = gate({ kind: 'draft-section', params: { documentId: 'doc-1' } }, { output: 'draft-changes' })
    expect(r.authorized).toBe(true)
  })
})

describe('Initiative and Progress are orthogonal', () => {
  it('follow-closely refuses an off-plan action', () => {
    const r = gate({ stepOrdinal: undefined }, { initiative: 'follow-closely' })
    expect(r).toEqual({ authorized: false, rule: 'off_plan' })
  })

  it('use-judgment permits one', () => {
    const r = gate({ stepOrdinal: undefined }, { initiative: 'use-judgment' })
    expect(r.authorized).toBe(true)
  })

  it('current-step-only refuses a later step', () => {
    const r = gate({ stepOrdinal: 4 }, { progress: 'current-step-only' }, { currentStepOrdinal: 2 })
    expect(r).toEqual({ authorized: false, rule: 'step_out_of_scope' })
  })

  it('remaining-plan permits one', () => {
    const r = gate({ stepOrdinal: 4 }, { progress: 'remaining-plan' }, { currentStepOrdinal: 2 })
    expect(r.authorized).toBe(true)
  })

  it('breadth and depth do not substitute for one another', () => {
    // use-judgment (breadth) must not silently grant depth.
    const r = gate(
      { stepOrdinal: 4 },
      { initiative: 'use-judgment', progress: 'current-step-only' },
      { currentStepOrdinal: 2 },
    )
    expect(r).toEqual({ authorized: false, rule: 'step_out_of_scope' })
  })
})

describe('budget', () => {
  it('refuses everything once the deadline has passed, including reads', () => {
    // A time limit is a limit on WORKING, not just on writing — otherwise the
    // dial would not mean what the label says.
    for (const kind of ACTION_KINDS) {
      const params =
        kind === 'read-approved-source'
          ? { approvedSourceId: 'src-approved' }
          : { documentId: 'doc-1' }
      const r = gate({ kind, params }, {}, { nowEpochMs: 10_001 })
      expect(r).toEqual({ authorized: false, rule: 'budget_exhausted' })
    }
  })

  it('is checked before anything else, so an exhausted run reports the real reason', () => {
    const r = gate({ kind: 'nonsense', params: {} }, {}, { nowEpochMs: 10_001 })
    expect(r).toEqual({ authorized: false, rule: 'budget_exhausted' })
  })
})

describe('blast radius', () => {
  it('refuses when the plan exceeds the cap, so a run cannot rewrite the document', () => {
    // An all-red diff is a policy failure, not a rendering one. The plan bounds
    // sections touched, so capping plan length caps the radius.
    const r = gate({}, {}, { planLength: MAX_PLAN_STEPS + 1 })
    expect(r).toEqual({ authorized: false, rule: 'plan_limit_exceeded' })
  })

  it('permits a plan at exactly the cap', () => {
    expect(gate({}, {}, { planLength: MAX_PLAN_STEPS }).authorized).toBe(true)
  })
})

describe('the browser capabilities', () => {
  it('authorizes each one when everything about it is in order', () => {
    for (const kind of ACTION_KINDS) {
      expect(gate(valid(kind)), `${kind} was refused`).toEqual({
        authorized: true,
        action: expect.objectContaining({ kind, intentId: 'intent-1' }),
      })
    }
  })

  it('refuses an element ref from a snapshot the run has replaced', () => {
    // The difference between clicking `Cancel order` and clicking whatever
    // re-rendered into its place.
    for (const kind of ['click-element', 'type-text', 'press-key'] as const) {
      expect(gate({ ...valid(kind), params: { ...VALID_PARAMS[kind], snapshotId: 'snap-0' } })).toEqual(
        { authorized: false, rule: 'stale_snapshot' },
      )
    }
  })

  it('refuses a ref when the run has never observed anything, with no special case for the first', () => {
    expect(gate(valid('click-element'), {}, { currentSnapshotId: null })).toEqual({
      authorized: false,
      rule: 'stale_snapshot',
    })
    expect(gate(valid('click-element'), {}, { currentSnapshotId: undefined })).toEqual({
      authorized: false,
      rule: 'stale_snapshot',
    })
  })

  it('lets the kinds that need no snapshot through without one', () => {
    for (const kind of ['observe-page', 'navigate', 'capture-screen'] as const) {
      expect(gate(valid(kind), {}, { currentSnapshotId: null }).authorized).toBe(true)
    }
  })

  it('refuses a click or a keystroke with no target', () => {
    expect(gate({ ...valid('click-element'), params: { snapshotId: 'snap-1' } })).toEqual({
      authorized: false,
      rule: 'element_ref_missing',
    })
    expect(gate({ ...valid('type-text'), params: { snapshotId: 'snap-1', inputText: 'x' } })).toEqual(
      { authorized: false, rule: 'element_ref_missing' },
    )
  })

  it('refuses a key outside the closed set, because the grammar does not enforce unions', () => {
    for (const key of ['Meta+Shift+Delete', 'a', '', 'enter']) {
      expect(
        gate({
          ...valid('press-key'),
          params: { snapshotId: 'snap-1', key: key as 'Enter' },
        }),
      ).toEqual({ authorized: false, rule: 'key_not_allowed' })
    }
    expect(gate({ ...valid('press-key'), params: { snapshotId: 'snap-1' } })).toEqual({
      authorized: false,
      rule: 'key_not_allowed',
    })
  })

  /**
   * The key set is checked, and it is checked BEFORE the confirmation.
   *
   * Both halves matter. Each of the three keys must reach the confirmation
   * check rather than being refused as `key_not_allowed` — otherwise the
   * allowed set is narrower than it claims. And each must still be refused
   * without a confirmation, because a press-key carries no ref, so nothing
   * binds evidence to it and the classifier always escalates.
   *
   * Written as the pair rather than as "permits each key", which is what this
   * assertion said while the gate was handing press-key another element's
   * evidence: it passed because the borrowed evidence happened to be harmless.
   */
  it('allows each of its three keys, and still asks before any of them', () => {
    for (const key of ['Enter', 'Tab', 'Escape'] as const) {
      expect(gate({ ...valid('press-key'), params: { snapshotId: 'snap-1', key } }), key).toEqual({
        authorized: false,
        rule: 'confirmation_required',
      })

      expect(
        gate({
          ...valid('press-key'),
          params: { snapshotId: 'snap-1', key, confirmationId: 'confirmed-1' },
        }).authorized,
        key,
      ).toBe(true)
    }
  })

  it('never types into a form holding a password or a card number — refused, not confirmed', () => {
    // A confirmation screen here would be a prompt asking someone to approve an
    // agent entering their credentials. The right answer to that question is
    // not "let them decide"; it is a capability we do not offer. So the rule is
    // `password_field` and not `confirmation_required`, and no confirmation id
    // turns it into a yes.
    const sensitive = { ...harmless, isInsideForm: true, formHasSensitiveField: true }

    expect(gate(valid('type-text'), {}, { targetEvidence: sensitive })).toEqual({
      authorized: false,
      rule: 'password_field',
    })

    expect(
      gate(
        { ...valid('type-text'), params: { ...VALID_PARAMS['type-text'], confirmationId: 'ok' } },
        {},
        { targetEvidence: sensitive, confirmedRequestIds: new Set(['ok']) },
      ),
    ).toEqual({ authorized: false, rule: 'password_field' })
  })
})

describe('a path cannot escape the origin it is joined to', () => {
  const navigateTo = (path: string | undefined) =>
    gate({ ...valid('navigate'), params: { approvedSourceId: 'src-approved', path } })

  it('permits an ordinary same-origin path', () => {
    for (const path of ['/partners', '/pricing/tiers', '/x?q=1', '/']) {
      expect(navigateTo(path).authorized, `${path} was refused`).toBe(true)
    }
  })

  it('refuses anything that is not a path, because new URL() resolves rather than validates', () => {
    // `new URL('//evil.example/x', 'https://northwind.example.com')` returns
    // `https://evil.example/x`. The origin containment this design rests on
    // holds only if the path is genuinely a path, checked here.
    for (const path of [
      '//evil.example/x',
      'https://evil.example',
      'partners',
      '\\\\evil.example',
      '/ok\\..\\evil',
      '',
      undefined,
    ]) {
      expect(navigateTo(path), `${String(path)} was permitted`).toEqual({
        authorized: false,
        rule: 'navigation_target_missing',
      })
    }
  })

  it('refuses a path carrying the characters the URL parser silently strips', () => {
    /**
     * The bypass a review found in the first version of this check.
     *
     * The WHATWG URL parser removes ASCII tab, LF and CR from its input BEFORE
     * parsing. So `"/\t/evil.example"` starts with a single slash, contains no
     * backslash, and is non-empty — passing every shape check — and then
     * resolves to `https://evil.example/`. One character, and a model-proposed
     * string is driving the person's real browser to an arbitrary host while
     * the gate reports success against an approved source id.
     */
    for (const path of [
      '/\t/evil.example',
      '/\n/evil.example',
      '/\r/evil.example',
      '/\t\t//evil.example',
      '/ok ',
    ]) {
      expect(navigateTo(path), `${JSON.stringify(path)} was permitted`).toEqual({
        authorized: false,
        rule: 'navigation_target_missing',
      })
    }
  })

  it('proves the bypass by resolving it, so this test cannot pass vacuously', () => {
    // If the parser ever stopped stripping these, the case above would be
    // guarding against nothing and would still be green. This asserts the
    // hazard is real rather than remembered.
    expect(new URL('/\t/evil.example', 'https://good.example').origin).toBe(
      'https://evil.example',
    )
  })

  it('takes the origin from an approved source by id, never from the proposal', () => {
    expect(gate({ ...valid('navigate'), params: { path: '/partners' } })).toEqual({
      authorized: false,
      rule: 'source_missing',
    })
    expect(
      gate({
        ...valid('navigate'),
        params: { approvedSourceId: 'src-elsewhere', path: '/partners' },
      }),
    ).toEqual({ authorized: false, rule: 'source_not_approved' })
  })
})

describe('the document capability exists iff a base is pinned', () => {
  it('refuses both document kinds when nothing is pinned', () => {
    for (const baseVersionId of [undefined, '']) {
      for (const kind of ['read-document', 'draft-section'] as const) {
        expect(gate(valid(kind), {}, {}, { baseVersionId })).toEqual({
          authorized: false,
          rule: 'no_document_pinned',
        })
      }
    }
  })

  it('reports the missing capability rather than the missing payload', () => {
    // Capability before payload: with no base there is no document capability
    // at all, so that is the honest reason even when the proposal also forgot
    // to name a document.
    expect(gate({ kind: 'read-document', params: {} }, {}, {}, { baseVersionId: undefined })).toEqual(
      { authorized: false, rule: 'no_document_pinned' },
    )
  })

  it('leaves every other kind untouched by the pin', () => {
    for (const kind of ACTION_KINDS) {
      if (kind === 'read-document' || kind === 'draft-section') continue
      expect(gate(valid(kind), {}, {}, { baseVersionId: undefined }).authorized).toBe(true)
    }
  })
})

describe('the two caps', () => {
  it('refuses everything once the total cap is reached', () => {
    for (const kind of ACTION_KINDS) {
      expect(gate(valid(kind), {}, { actionsTaken: MAX_ACTIONS_PER_RUN })).toEqual({
        authorized: false,
        rule: 'action_limit_exceeded',
      })
    }
  })

  it('permits the action that lands exactly on the cap minus one', () => {
    expect(gate(valid('observe-page'), {}, { actionsTaken: MAX_ACTIONS_PER_RUN - 1 }).authorized).toBe(
      true,
    )
  })

  it('refuses only the mutating kinds once the mutating cap is reached', () => {
    for (const kind of ACTION_KINDS) {
      const r = gate(
        valid(kind),
        { progress: 'remaining-plan' },
        { mutatingActionsTaken: MAX_MUTATING_ACTIONS_PER_RUN },
      )
      if (MUTATING_ACTION_KINDS.has(kind)) {
        expect(r, `${kind} was permitted past the mutating cap`).toEqual({
          authorized: false,
          rule: 'step_out_of_scope',
        })
      } else {
        expect(r.authorized, `${kind} was refused by a cap that should not apply`).toBe(true)
      }
    }
  })

  it('treats navigating and reading as non-mutating, because reaching the world is not changing it', () => {
    for (const kind of ['navigate', 'read-approved-source', 'observe-page', 'capture-screen'] as const) {
      expect(MUTATING_ACTION_KINDS.has(kind)).toBe(false)
    }
  })

  it('does not bind when the run supplies no counts, which is the wiring gap and not a surprise', () => {
    // An unwired caller gets exactly the enforcement it had before the caps
    // existed. Fail-closed here would refuse the first action of every existing
    // drafting run — a worse failure than the one it prevents.
    const unwired: RunContext = {
      currentStepOrdinal: 2,
      planLength: 5,
      deadlineEpochMs: 10_000,
      nowEpochMs: 0,
    }

    expect(
      authorize(compilePolicy(scope, controls), { ...read }, unwired, 'intent-1').authorized,
    ).toBe(true)
  })
})

describe('the Progress dial, redefined as one change per step', () => {
  it('current-step-only permits exactly one mutating action', () => {
    expect(gate(valid('click-element'), { progress: 'current-step-only' }).authorized).toBe(true)
    expect(
      gate(valid('click-element'), { progress: 'current-step-only' }, { mutatingActionsTaken: 1 }),
    ).toEqual({ authorized: false, rule: 'step_out_of_scope' })
  })

  it('remaining-plan permits up to the run cap', () => {
    expect(
      gate(valid('click-element'), { progress: 'remaining-plan' }, { mutatingActionsTaken: 1 })
        .authorized,
    ).toBe(true)
    expect(
      gate(
        valid('click-element'),
        { progress: 'remaining-plan' },
        { mutatingActionsTaken: MAX_MUTATING_ACTIONS_PER_RUN },
      ).authorized,
    ).toBe(false)
  })

  it('compiles to a number rather than to prompt wording', () => {
    expect(compilePolicy(scope, { ...controls, progress: 'current-step-only' }).maxMutatingActions)
      .toBe(1)
    expect(compilePolicy(scope, { ...controls, progress: 'remaining-plan' }).maxMutatingActions).toBe(
      MAX_MUTATING_ACTIONS_PER_RUN,
    )
  })

  it('still lets a run READ freely under current-step-only', () => {
    // A step bounds changes, not looking. A dial that stopped the worker from
    // checking what it had just done would make the safest setting the one that
    // acts most blindly.
    for (const kind of ACTION_KINDS) {
      if (MUTATING_ACTION_KINDS.has(kind)) continue
      expect(
        gate(valid(kind), { progress: 'current-step-only' }, { mutatingActionsTaken: 5 }).authorized,
        `${kind} was refused`,
      ).toBe(true)
    }
  })
})

describe('confirmation is a refusal, and it is the last one', () => {
  const buyButton: ElementEvidence = { ...harmless, accessibleNameTokens: ['Buy', 'now'] }

  it('refuses an irreversible-looking click that nobody approved', () => {
    expect(gate(valid('click-element'), {}, { targetEvidence: buyButton })).toEqual({
      authorized: false,
      rule: 'confirmation_required',
    })
  })

  it('permits it once the person has actually said yes', () => {
    expect(
      gate(
        {
          ...valid('click-element'),
          params: { ...VALID_PARAMS['click-element'], confirmationId: 'conf-1' },
        },
        {},
        { targetEvidence: buyButton, confirmedRequestIds: new Set(['conf-1']) },
      ).authorized,
    ).toBe(true)
  })

  it('does not accept a confirmation id the run has no record of', () => {
    // Presence of an id is a model-supplied claim. Only the run's durable set
    // is evidence, and an id absent from it may have been declined, never
    // asked, or expired — three states the gate must not distinguish.
    expect(
      gate(
        {
          ...valid('click-element'),
          params: { ...VALID_PARAMS['click-element'], confirmationId: 'made-up' },
        },
        {},
        { targetEvidence: buyButton, confirmedRequestIds: new Set(['conf-1']) },
      ),
    ).toEqual({ authorized: false, rule: 'confirmation_required' })
  })

  it('treats an expired confirmation exactly like one that was never asked', () => {
    // Expiry never approves. An expired confirmation is simply absent from the
    // set, which is the same refusal — there is no state anywhere that decays
    // into consent.
    expect(
      gate(
        {
          ...valid('click-element'),
          params: { ...VALID_PARAMS['click-element'], confirmationId: 'conf-1' },
        },
        {},
        { targetEvidence: buyButton, confirmedRequestIds: new Set<string>() },
      ),
    ).toEqual({ authorized: false, rule: 'confirmation_required' })
  })

  it('never asks about something it would have refused anyway', () => {
    // The whole reason confirmation is checked last. A person trained to
    // approve refusals is worse off than one who was never asked, because we
    // took a real safeguard and spent it on noise.
    const earlier: Array<[string, ReturnType<typeof gate>]> = [
      ['budget', gate(valid('click-element'), {}, { targetEvidence: buyButton, nowEpochMs: 10_001 })],
      [
        'allowlist',
        gate(valid('click-element'), {}, { targetEvidence: buyButton }, {
          allowedActionKinds: ['read-document'],
        }),
      ],
      [
        'action limit',
        gate(
          valid('click-element'),
          {},
          { targetEvidence: buyButton, actionsTaken: MAX_ACTIONS_PER_RUN },
        ),
      ],
      [
        'mutating cap',
        gate(
          valid('click-element'),
          { progress: 'current-step-only' },
          { targetEvidence: buyButton, mutatingActionsTaken: 1 },
        ),
      ],
      [
        'off plan',
        gate(
          { ...valid('click-element'), stepOrdinal: undefined },
          { initiative: 'follow-closely' },
          { targetEvidence: buyButton },
        ),
      ],
      [
        'stale snapshot',
        gate(valid('click-element'), {}, { targetEvidence: buyButton, currentSnapshotId: 'snap-0' }),
      ],
      [
        'missing ref',
        gate({ ...valid('click-element'), params: { snapshotId: 'snap-1' } }, {}, {
          targetEvidence: buyButton,
        }),
      ],
    ]

    for (const [name, result] of earlier) {
      expect(result.authorized).toBe(false)
      if (!result.authorized) {
        expect(result.rule, `${name} was reported as confirmation_required`).not.toBe(
          'confirmation_required',
        )
      }
    }
  })

  it('will not classify one element using evidence gathered about another', () => {
    /**
     * The hole a review found: nothing tied `run.targetEvidence` to
     * `params.ref`. A loop that gathered evidence once per turn, or carried it
     * across a re-proposal, would classify a *Place order* click using what it
     * learned about *Show more* — and the gate would have said yes.
     *
     * Unbound evidence is treated as no evidence, which escalates. So the
     * failure direction is a confirmation nobody needed, never a click nobody
     * saw.
     */
    const forAnotherElement: ElementEvidence = { ...harmless, ref: 'e99' }
    expect(gate(valid('click-element'), {}, { targetEvidence: forAnotherElement })).toEqual({
      authorized: false,
      rule: 'confirmation_required',
    })

    const fromAnotherSnapshot: ElementEvidence = { ...harmless, snapshotId: 'snap-0' }
    expect(gate(valid('click-element'), {}, { targetEvidence: fromAnotherSnapshot })).toEqual({
      authorized: false,
      rule: 'confirmation_required',
    })
  })

  it('escalates until the executor starts saying which element the evidence is about', () => {
    // Unwired state: evidence with no `ref` against a proposal that names one.
    // Cautious now, quieter later — wiring it up removes confirmations rather
    // than adding them.
    const unbound: ElementEvidence = {
      accessibleNameTokens: ['Show', 'more'],
      role: 'button',
      isSubmitControl: false,
      isInsideForm: false,
      formHasSensitiveField: false,
    }

    expect(gate(valid('click-element'), {}, { targetEvidence: unbound })).toEqual({
      authorized: false,
      rule: 'confirmation_required',
    })

    // ...but `press-key` names no element, so there is nothing to bind and the
    // same evidence is used as it stands.
    expect(gate(valid('press-key'), {}, { targetEvidence: unbound }).authorized).toBe(true)
  })

  it('never confirms a read, whatever the page claims about it', () => {
    const hostile: ElementEvidence = {
      accessibleNameTokens: ['Buy', 'now'],
      role: 'button',
      isSubmitControl: true,
      isInsideForm: true,
      formHasSensitiveField: true,
    }

    for (const kind of ['read-approved-source', 'read-document', 'observe-page', 'capture-screen', 'navigate'] as const) {
      expect(gate(valid(kind), {}, { targetEvidence: hostile }).authorized, kind).toBe(true)
    }
  })
})

describe('check order, pair by pair', () => {
  /**
   * Each row breaks TWO rules at once and names which must win. Precedence is
   * not incidental: it decides what a person is told about a refused proposal,
   * and a run that reports the narrower reason sends someone to fix the wrong
   * thing.
   */
  const cases: ReadonlyArray<{
    readonly name: string
    readonly result: ReturnType<typeof gate>
    readonly wins: RefusalRule
  }> = [
    {
      name: 'budget beats an unknown kind',
      result: gate({ kind: 'send-email', params: {} }, {}, { nowEpochMs: 10_001 }),
      wins: 'budget_exhausted',
    },
    {
      name: 'budget beats the action cap',
      result: gate(valid('observe-page'), {}, { nowEpochMs: 10_001, actionsTaken: 999 }),
      wins: 'budget_exhausted',
    },
    {
      name: 'an unknown kind beats the allowlist',
      result: gate({ kind: 'purchase', params: {} }, {}, {}, { allowedActionKinds: [] }),
      wins: 'unknown_action_kind',
    },
    {
      name: 'the allowlist beats the action cap',
      result: gate(valid('click-element'), {}, { actionsTaken: 999 }, {
        allowedActionKinds: ['read-document'],
      }),
      wins: 'action_kind_not_allowed',
    },
    {
      name: 'the action cap beats the mutating cap',
      result: gate(valid('click-element'), { progress: 'current-step-only' }, {
        actionsTaken: 999,
        mutatingActionsTaken: 999,
      }),
      wins: 'action_limit_exceeded',
    },
    {
      name: 'the mutating cap beats an off-plan proposal',
      result: gate(
        { ...valid('click-element'), stepOrdinal: undefined },
        { progress: 'current-step-only', initiative: 'follow-closely' },
        { mutatingActionsTaken: 1 },
      ),
      wins: 'step_out_of_scope',
    },
    {
      name: 'off-plan beats a stale snapshot',
      result: gate(
        { ...valid('click-element'), stepOrdinal: undefined, params: { snapshotId: 'snap-0', ref: 'e1' } },
        { initiative: 'follow-closely' },
      ),
      wins: 'off_plan',
    },
    {
      name: 'a stale snapshot beats a missing ref',
      result: gate({ ...valid('click-element'), params: { snapshotId: 'snap-0' } }),
      wins: 'stale_snapshot',
    },
    {
      name: 'a missing path beats an unapproved source',
      result: gate({ ...valid('navigate'), params: { approvedSourceId: 'src-elsewhere' } }),
      wins: 'navigation_target_missing',
    },
    {
      name: 'an unapproved source beats a required confirmation',
      result: gate(
        { ...valid('navigate'), params: { approvedSourceId: 'src-elsewhere', path: '/x' } },
        {},
        { targetEvidence: { ...harmless, isSubmitControl: true } },
      ),
      wins: 'source_not_approved',
    },
    {
      name: 'a sensitive form beats a required confirmation',
      result: gate(valid('type-text'), {}, {
        targetEvidence: { ...harmless, isSubmitControl: true, formHasSensitiveField: true },
      }),
      wins: 'password_field',
    },
  ]

  it.each(cases)('$name', ({ result, wins }) => {
    expect(result).toEqual({ authorized: false, rule: wins })
  })

  it('reports the first rule when a proposal breaks all of them at once', () => {
    const r = gate(
      { kind: 'nonsense', params: {}, stepOrdinal: undefined },
      { initiative: 'follow-closely', progress: 'current-step-only', output: 'suggestions-only' },
      {
        nowEpochMs: 10_001,
        actionsTaken: 999,
        mutatingActionsTaken: 999,
        currentSnapshotId: null,
        planLength: 999,
      },
      { allowedActionKinds: [], approvedSourceIds: [], baseVersionId: undefined },
    )

    expect(r).toEqual({ authorized: false, rule: 'budget_exhausted' })
  })
})

describe('exhaustive control matrix', () => {
  it('walks every ActionKind against every dial combination', () => {
    // 9 kinds x 16 dial combinations = 144 decisions, each with an expected
    // answer that depends only on the compiled allowlist — not on a
    // re-implementation of the gate's rules, which would agree with any bug in
    // them.
    let checked = 0

    for (const dials of DIALS) {
      const policy = compilePolicy(scope, { ...controls, ...dials })

      for (const kind of ACTION_KINDS) {
        const r = gate(valid(kind), dials)
        checked += 1

        if (!policy.actionKindAllowlist.has(kind)) {
          expect(r, `${kind} under ${JSON.stringify(dials)}`).toEqual({
            authorized: false,
            rule: 'action_kind_not_allowed',
          })
        } else {
          expect(r.authorized, `${kind} under ${JSON.stringify(dials)}`).toBe(true)
        }
      }
    }

    expect(checked).toBe(ACTION_KINDS.length * DIALS.length)
    expect(checked).toBe(144)
  })

  it('never authorizes an unapproved source under any combination', () => {
    for (const dials of DIALS) {
      expect(
        gate({ kind: 'read-approved-source', params: { approvedSourceId: 'src-elsewhere' } }, dials),
      ).toEqual({ authorized: false, rule: 'source_not_approved' })

      expect(
        gate(
          { kind: 'navigate', params: { approvedSourceId: 'src-elsewhere', path: '/x' } },
          dials,
        ),
      ).toEqual({ authorized: false, rule: 'source_not_approved' })
    }
  })

  it('never authorizes draft-section under suggestions-only, whatever the other dials say', () => {
    for (const dials of DIALS) {
      if (dials.output !== 'suggestions-only') continue
      expect(gate(valid('draft-section'), dials)).toEqual({
        authorized: false,
        rule: 'action_kind_not_allowed',
      })
    }
  })

  it('refuses every kind once the budget is gone, under every combination', () => {
    for (const dials of DIALS) {
      for (const kind of ACTION_KINDS) {
        expect(gate(valid(kind), dials, { nowEpochMs: 10_001 })).toEqual({
          authorized: false,
          rule: 'budget_exhausted',
        })
      }
    }
  })

  it('refuses every kind absent from the allowlist, under every combination', () => {
    for (const dials of DIALS) {
      for (const kind of ACTION_KINDS) {
        expect(gate(valid(kind), dials, {}, { allowedActionKinds: [] })).toEqual({
          authorized: false,
          rule: 'action_kind_not_allowed',
        })
      }
    }
  })

  it('is deterministic — the same inputs always give the same answer', () => {
    for (const kind of ACTION_KINDS) {
      for (const dials of DIALS) {
        expect(gate(valid(kind), dials)).toEqual(gate(valid(kind), dials))
      }
    }
  })
})

describe('every refusal rule is reachable', () => {
  /**
   * A rule nobody can trigger is a rule that has never been tested, and the
   * union is where they hide. `plan_limit_exceeded` is listed because it is
   * still reachable; it stays in the union regardless, because refused
   * ActionIntent rows are append-only and some already carry it.
   */
  const reached: ReadonlyArray<{ rule: RefusalRule; result: ReturnType<typeof gate> }> = [
    { rule: 'budget_exhausted', result: gate(valid('observe-page'), {}, { nowEpochMs: 10_001 }) },
    { rule: 'unknown_action_kind', result: gate({ kind: 'send-email', params: {} }) },
    {
      rule: 'action_kind_not_allowed',
      result: gate(valid('observe-page'), {}, {}, { allowedActionKinds: [] }),
    },
    {
      rule: 'action_limit_exceeded',
      result: gate(valid('observe-page'), {}, { actionsTaken: MAX_ACTIONS_PER_RUN }),
    },
    {
      rule: 'step_out_of_scope',
      result: gate(valid('click-element'), { progress: 'current-step-only' }, {
        mutatingActionsTaken: 1,
      }),
    },
    { rule: 'plan_limit_exceeded', result: gate(valid('observe-page'), {}, { planLength: MAX_PLAN_STEPS + 1 }) },
    {
      rule: 'off_plan',
      result: gate({ ...valid('observe-page'), stepOrdinal: undefined }, {
        initiative: 'follow-closely',
      }),
    },
    {
      rule: 'stale_snapshot',
      result: gate({ ...valid('click-element'), params: { snapshotId: 'gone', ref: 'e1' } }),
    },
    {
      rule: 'element_ref_missing',
      result: gate({ ...valid('click-element'), params: { snapshotId: 'snap-1' } }),
    },
    {
      rule: 'navigation_target_missing',
      result: gate({ ...valid('navigate'), params: { approvedSourceId: 'src-approved' } }),
    },
    { rule: 'source_missing', result: gate({ kind: 'read-approved-source', params: {} }) },
    {
      rule: 'source_not_approved',
      result: gate({ kind: 'read-approved-source', params: { approvedSourceId: 'nope' } }),
    },
    { rule: 'document_missing', result: gate({ kind: 'read-document', params: {} }) },
    {
      rule: 'no_document_pinned',
      result: gate(valid('read-document'), {}, {}, { baseVersionId: undefined }),
    },
    {
      rule: 'key_not_allowed',
      result: gate({ ...valid('press-key'), params: { snapshotId: 'snap-1' } }),
    },
    {
      rule: 'password_field',
      result: gate(valid('type-text'), {}, {
        targetEvidence: { ...harmless, formHasSensitiveField: true },
      }),
    },
    {
      rule: 'confirmation_required',
      result: gate(valid('click-element'), {}, {
        targetEvidence: { ...harmless, isSubmitControl: true },
      }),
    },
  ]

  it.each(reached)('$rule', ({ rule, result }) => {
    expect(result).toEqual({ authorized: false, rule })
  })

  it('covers every member of the union', () => {
    // Hand-maintained, because the union is a type and types do not exist at
    // runtime. If a rule is added without a case above, this count is what
    // notices.
    expect(new Set(reached.map((r) => r.rule)).size).toBe(17)
  })
})

describe('compilePolicy is pure and total', () => {
  it('produces the same policy for the same inputs', () => {
    const a = compilePolicy(scope, controls)
    const b = compilePolicy(scope, controls)

    expect([...a.actionKindAllowlist]).toEqual([...b.actionKindAllowlist])
    expect([...a.sourceAllowlist]).toEqual([...b.sourceAllowlist])
  })

  it('does not alias its inputs — mutating the scope afterwards cannot widen the policy', () => {
    const mutable: ContractScope = {
      approvedSourceIds: ['src-approved'],
      allowedActionKinds: ['read-approved-source'] as ActionKind[],
      baseVersionId: 'v',
    }
    const policy = compilePolicy(mutable, controls)
    ;(mutable.allowedActionKinds as ActionKind[]).push('draft-section')

    expect(policy.actionKindAllowlist.has('draft-section')).toBe(false)
  })
})

/**
 * A proposal with no element ref must not borrow evidence about another element.
 *
 * `press-key` is the case: its target is whatever holds focus, so nothing in a
 * snapshot describes it. The gate used to hand it `run.targetEvidence` anyway,
 * which meant a keystroke could be classified from what the previous turn
 * learned about an unrelated link — a de-escalation, in a function whose whole
 * contract is that page-derived evidence may only ever escalate.
 */
describe('evidence cannot be borrowed from another element', () => {
  const benign: ElementEvidence = {
    ref: 'e7',
    accessibleNameTokens: ['show', 'more'],
    role: 'button',
    isSubmitControl: false,
    isInsideForm: false,
    formHasSensitiveField: false,
  }

  it('refuses an unconfirmed press-key even when the run holds ordinary evidence', () => {
    const policy = compilePolicy(
      { approvedSourceIds: [], allowedActionKinds: [...ACTION_KINDS], baseVersionId: 'v' },
      {
        initiative: 'use-judgment',
        progress: 'remaining-plan',
        output: 'draft-changes',
        interruption: 'stop-only-when-blocked',
        timeLimitMinutes: 30,
      },
    )

    const verdict = authorize(
      policy,
      { kind: 'press-key', params: { key: 'Enter', snapshotId: 's1' }, reason: 'submit', stepOrdinal: 1 },
      { ...run, currentSnapshotId: 's1', targetEvidence: benign },
      'i',
    )

    expect(verdict).toEqual({ authorized: false, rule: 'confirmation_required' })
  })
})
