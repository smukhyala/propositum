/**
 * *Where you left off* may inform a person. It may not inform a decision.
 *
 * ── Why this file exists, and what it is modelled on ─────────────────────
 *
 * `tests/calendar-scope.test.ts` is the model, and the posture is deliberately
 * the same one: a `BusyInterval` under [ADR-0014](../docs/adr/0014-reading-free-busy.md)
 * *"may not reach `compilePolicy`, `EnforcedPolicy` or the gate, may not raise or
 * widen anything, and is never persisted"*. `CONTEXT.md`'s `WorkSoFar` entry and
 * [ADR-0017](../docs/adr/0017-continuing-an-intention.md) both restate that rule
 * for this object, in those words, for a reason worth writing down: **this is
 * the second thing in the vocabulary that is durable, cross-sitting and not
 * enforced by anything**, and the first one arrived with a guard.
 *
 * ── The one that would actually hurt ─────────────────────────────────────
 *
 * A prompt. ADR-0017's *Revisit when* names it: *"The moment `WorkSoFar` is
 * interpolated into a boundary, it stops being a display and becomes context a
 * model acts on, and every claim in* Why this does not reverse ADR-0011 *has to
 * be re-argued against prompt injection reaching it through the rows it
 * folds."* That is not hypothetical — the fold reads `ShiftOutcome.headline`'s
 * neighbours and `ProposedChange` verdicts, which sit one join away from page
 * text, and it is exactly the laundering path `datamark` exists to close.
 *
 * ── What a grep can see here, and what it cannot ─────────────────────────
 *
 * The honest limits are `tests/calendar-scope.test.ts`'s and they transfer
 * without softening. A computed name walks past this. A value copied out of a
 * `WorkSoFar` into a local called something else, three files away, walks past
 * it too — this catches the object arriving somewhere it should not, not a
 * number laundered out of it by hand. It is a defence against somebody who does
 * not know they should not.
 *
 * ── The canary ───────────────────────────────────────────────────────────
 *
 * Every not-found assertion below is vacuous the day the thing it searches for
 * stops existing. So the first block asserts the positives: the fold is where it
 * is expected, the files it may live in genuinely mention it, and the sets being
 * searched are non-empty.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

import { stripComments } from './support/strip-comments'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

function filesUnder(dir: string): Array<{ name: string; code: string }> {
  const out: Array<{ name: string; code: string }> = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        out.push({ name: relative(repo, full), code: stripComments(readFileSync(full, 'utf8')) })
      }
    }
  }
  walk(join(repo, dir))
  return out
}

const SOURCES = filesUnder('src')

/** Every name this object travels under. A rename that kept the object would
 *  otherwise empty this guard silently. */
const NAMES = /WorkSoFar|workSoFar|whereYouLeftOff|WhereYouLeftOff|WHERE_YOU_LEFT_OFF/

const FOLD = 'src/domain/intention/work-so-far.ts'

describe('the thing being guarded is actually there', () => {
  it('the fold exists and is a pure function of facts plus now', () => {
    const fold = SOURCES.find(({ name }) => name === FOLD)
    expect(fold, 'the fold has moved — every assertion below searches for nothing').toBeDefined()
    expect(fold!.code).toContain('export function workSoFar(')
    expect(fold!.code).toContain('nowEpochMs: number')
  })

  it('something outside the domain actually holds one', () => {
    const holders = SOURCES.filter(({ name, code }) => name !== FOLD && NAMES.test(code)).map(
      ({ name }) => name,
    )

    // Not an exact list: the point of the canary is that the object is in the
    // product at all, and where is `tests/reachability.test.ts`'s question.
    expect(
      holders.length,
      'nothing outside the domain mentions it — this guard is vacuous',
    ).toBeGreaterThan(2)
  })
})

describe('it never reaches anything that decides', () => {
  it('is absent from the policy layer entirely', () => {
    const policy = filesUnder('src/policy')

    expect(policy.length).toBeGreaterThan(2)
    for (const { name, code } of policy) {
      expect(code, `${name} names what a person has already done`).not.toMatch(NAMES)
    }
  })

  it('never appears in the same file as compilePolicy or the gate’s brand', () => {
    for (const { name, code } of SOURCES) {
      if (!NAMES.test(code)) continue
      expect(code, `${name} compiles a policy and holds a WorkSoFar`).not.toMatch(/compilePolicy/)
      expect(code, `${name} mints or takes authority and holds a WorkSoFar`).not.toMatch(
        /AuthorizedAction/,
      )
    }
  })

  it('never becomes part of a ContractScope', () => {
    // The scope is derived by deterministic code from the pages a sitting ran
    // through. A fold over what happened LAST time widening what this shift may
    // touch would be continuity granting a permission.
    for (const { name, code } of SOURCES) {
      if (!NAMES.test(code)) continue
      expect(code, `${name} assigns a scope field from where you left off`).not.toMatch(
        /(approvedSourceIds|allowedActionKinds|timeLimitMinutes):\s*\w*(workSoFar|leftOff|view)/i,
      )
    }
  })
})

describe('it never reaches a prompt', () => {
  it('no model boundary mentions it under any of its names', () => {
    const boundaries = filesUnder('src/model')

    // Canary: the directory has to still hold the boundaries.
    expect(boundaries.length).toBeGreaterThan(5)
    for (const { name, code } of boundaries) {
      expect(code, `${name} puts prior work into a prompt`).not.toMatch(NAMES)
    }
  })

  it('the drafting path reads it after the handoff call, not before', () => {
    /**
     * Order as a structural property, the same move `tests/calendar-scope.
     * test.ts` makes for the calendar: there is no statement between the read
     * and the return that could carry it into a boundary, because the boundary
     * has already run.
     *
     * This is the assertion that would catch the plausible mistake — passing the
     * fold to `handoffBoundary` so the model can "write a better objective". It
     * would look like an improvement, and it is the one thing ADR-0017 says
     * reopens its entire argument.
     */
    const actions = stripComments(readFileSync(join(repo, 'src/server/actions.ts'), 'utf8'))

    const called = actions.indexOf('handoffBoundary(')
    const read = actions.indexOf('whereYouLeftOffOn(')

    expect(called, 'the handoff boundary is no longer called here').toBeGreaterThan(0)
    expect(read, 'the drafting path no longer reads where you left off').toBeGreaterThan(0)
    expect(
      read,
      'the fold is read BEFORE the handoff call — one statement from a prompt',
    ).toBeGreaterThan(called)
  })
})

describe('it is never stored', () => {
  it('has no column and no table', () => {
    // Computed, never stored, and ADR-0017 is explicit that this is not a
    // preference about where state lives: a stored version is the thing ADR-0011
    // forbids, so `computed` is the property that makes the design legal.
    const schema = readFileSync(join(repo, 'prisma/schema.prisma'), 'utf8')

    expect(schema).not.toMatch(/workSoFar|WorkSoFar|whereYouLeftOff/i)
  })

  it('is written by no repository method', () => {
    const repositories = stripComments(
      readFileSync(join(repo, 'src/persistence/repositories/index.ts'), 'utf8'),
    )

    // `workSoFarFacts` reads. Anything that created or updated under this name
    // would be the second store for one truth.
    expect(repositories).toContain('workSoFarFacts')
    expect(repositories).not.toMatch(/workSoFar\w*\.(create|update|upsert|delete)/i)
  })
})
