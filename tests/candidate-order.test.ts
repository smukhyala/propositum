/**
 * The ordering across kinds. ADR-0036.
 *
 * The interesting tests here are the property ones. A comparator that is not a
 * total order produces a screen that reshuffles when nothing changed, and that
 * is invisible in an example-based test that happens to pass.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ARRIVAL_IS_NEWS_MS,
  compareCandidates,
  orderCandidates,
  reasonFor,
  stillWorthSaying,
  type Candidate,
} from '../src/domain/detection/order-candidates'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const NOW = Date.UTC(2026, 8, 7, 12, 0, 0)

const strand = (over: Partial<Extract<Candidate, { kind: 'strand' }>> = {}): Candidate => ({
  kind: 'strand',
  signature: 'a',
  searches: 0,
  pages: 3,
  engagedMs: 60_000,
  ...over,
})

const discharged = (
  over: Partial<Extract<Candidate, { kind: 'discharged-wait' }>> = {},
): Candidate => ({
  kind: 'discharged-wait',
  intentionId: 'i1',
  statedWait: 'a reply from the venue',
  arrivedAtEpochMs: NOW - 60_000,
  ...over,
})

/** Every shape, so the property tests below range over the whole union. */
const CORPUS: readonly Candidate[] = [
  strand({ signature: 'a', searches: 2, pages: 9, engagedMs: 900_000 }),
  strand({ signature: 'b', searches: 2, pages: 9, engagedMs: 100_000 }),
  strand({ signature: 'c', searches: 2, pages: 4, engagedMs: 900_000 }),
  strand({ signature: 'd', searches: 0, pages: 9, engagedMs: 900_000 }),
  strand({ signature: 'e', searches: 0, pages: 9, engagedMs: 900_000 }),
  discharged({ intentionId: 'i1', arrivedAtEpochMs: NOW - 60_000 }),
  discharged({ intentionId: 'i2', arrivedAtEpochMs: NOW - 3_600_000 }),
  discharged({ intentionId: 'i3', arrivedAtEpochMs: NOW - 60_000 }),
]

describe('it is a total order, which is what stops a screen reshuffling', () => {
  it('is antisymmetric', () => {
    for (const a of CORPUS) {
      for (const b of CORPUS) {
        // Summed rather than negated: `Math.sign(0)` is `+0` and `-Math.sign(0)`
        // is `-0`, which `Object.is` separates and this property does not.
        expect(Math.sign(compareCandidates(a, b)) + Math.sign(compareCandidates(b, a))).toBe(0)
      }
    }
  })

  it('is transitive', () => {
    for (const a of CORPUS) {
      for (const b of CORPUS) {
        for (const c of CORPUS) {
          if (compareCandidates(a, b) <= 0 && compareCandidates(b, c) <= 0) {
            expect(compareCandidates(a, c)).toBeLessThanOrEqual(0)
          }
        }
      }
    }
  })

  /**
   * Equal on every named key must still order the same way twice, or two
   * renders of one afternoon disagree. The tie-break is an identity rather than
   * a coin toss for exactly this.
   */
  it('gives the same answer for the same data, whatever order it arrives in', () => {
    const forwards = orderCandidates(CORPUS).map(id)
    const backwards = orderCandidates([...CORPUS].reverse()).map(id)
    expect(backwards).toEqual(forwards)
  })

  it('does not mutate what it was given', () => {
    const input = [...CORPUS]
    orderCandidates(input)
    expect(input.map(id)).toEqual(CORPUS.map(id))
  })
})

describe('precedence, which is the whole of the behaviour', () => {
  /**
   * The one cross-kind rule. A person said they were waiting on this and
   * something states it arrived; a strand is Propositum noticing.
   */
  it('puts a discharged wait above every strand, however strong the strand', () => {
    const ordered = orderCandidates([
      strand({ signature: 'huge', searches: 9, pages: 40, engagedMs: 9_000_000 }),
      discharged(),
    ])
    expect(ordered[0]?.kind).toBe('discharged-wait')
  })

  it('orders strands by searches, then breadth, then time — topics.ts, unchanged', () => {
    const ordered = orderCandidates([
      strand({ signature: 'low', searches: 0, pages: 9, engagedMs: 900_000 }),
      strand({ signature: 'thin', searches: 2, pages: 4, engagedMs: 900_000 }),
      strand({ signature: 'brief', searches: 2, pages: 9, engagedMs: 100_000 }),
      strand({ signature: 'best', searches: 2, pages: 9, engagedMs: 900_000 }),
    ])
    expect(ordered.map(id)).toEqual(['best', 'brief', 'thin', 'low'])
  })

  it('puts the most recent arrival first among discharged waits', () => {
    const ordered = orderCandidates([
      discharged({ intentionId: 'old', arrivedAtEpochMs: NOW - 3_600_000 }),
      discharged({ intentionId: 'new', arrivedAtEpochMs: NOW - 60_000 }),
    ])
    expect(ordered.map(id)).toEqual(['new', 'old'])
  })
})

describe('every ordering renders as a sentence a person can check', () => {
  /**
   * This is the half that makes a lexicographic order worth having over a
   * float. A person can disagree with a fact; they cannot disagree with 0.83.
   */
  it('names the fact that decided it, and quotes the person back to themselves', () => {
    expect(reasonFor(discharged(), NOW)).toBe(
      'You said you were waiting on a reply from the venue, and it arrived a minute ago.',
    )
    // Caught by rendering it in the real app rather than by a test: "1 minutes
    // ago" on the front door, which is the one sentence on that screen a person
    // is meant to trust.
    expect(reasonFor(discharged({ arrivedAtEpochMs: NOW - 300_000 }), NOW)).toBe(
      'You said you were waiting on a reply from the venue, and it arrived 5 minutes ago.',
    )
    expect(reasonFor(discharged({ arrivedAtEpochMs: NOW - 5_000 }), NOW)).toBe(
      'You said you were waiting on a reply from the venue, and it arrived just now.',
    )
    expect(reasonFor(strand({ searches: 2, pages: 7 }), NOW)).toBe(
      'You searched for this, and read 7 pages about it.',
    )
    expect(reasonFor(strand({ searches: 0, pages: 7 }), NOW)).toBe(
      'You read 7 pages about this.',
    )
  })

  it('says something for every member of the union', () => {
    for (const candidate of CORPUS) {
      expect(reasonFor(candidate, NOW).length).toBeGreaterThan(0)
    }
  })
})

describe('an arrival stops being news, or it holds a slot for ever', () => {
  /**
   * The defect this was written for. `statedWait` is cleared only by a person
   * and the discharging event can never be deleted, so without a decay three
   * discharged waits would show zero strands for the life of the database — the
   * hole ADR-0035 named for open waits, arriving one step later.
   */
  it('drops a discharged wait once it is older than a week', () => {
    const fresh = discharged({ arrivedAtEpochMs: NOW - ARRIVAL_IS_NEWS_MS + 1000 })
    const stale = discharged({ arrivedAtEpochMs: NOW - ARRIVAL_IS_NEWS_MS - 1000 })

    expect(stillWorthSaying(fresh, NOW)).toBe(true)
    expect(stillWorthSaying(stale, NOW)).toBe(false)
  })

  /** A strand is bounded by the detector's own window. Re-bounding it here
   *  would be two places holding one limit. */
  it('never drops a strand, whatever the clock says', () => {
    expect(stillWorthSaying(strand(), NOW)).toBe(true)
    expect(stillWorthSaying(strand(), NOW + ARRIVAL_IS_NEWS_MS * 10)).toBe(true)
  })

  /** A decay, not a dismissal: nothing is deleted and the words stay on the
   *  project screen. Only the claim on the front door expires. */
  it('expires the claim and not the wait', () => {
    const stale = discharged({ arrivedAtEpochMs: NOW - ARRIVAL_IS_NEWS_MS - 1 })
    expect(stillWorthSaying(stale, NOW)).toBe(false)
    // The candidate is still a well-formed value; nothing about it was removed.
    expect(reasonFor(stale, NOW)).toContain('a reply from the venue')
  })
})

describe('what this module may not do', () => {
  it('reads no clock, so a replayed week and a lived one are the same input', () => {
    const source = readFileSync(join(repo, 'src/domain/detection/order-candidates.ts'), 'utf8')
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/Date\.now\(\)/)
    expect(code).not.toMatch(/new Date\(/)
  })

  /**
   * ADR-0036 refuses a weighted score, and `CONTEXT.md` retires the vocabulary
   * one would need. A grep is a weak guard and it is the one available: the
   * real enforcement is that every key renders a sentence.
   */
  it('holds no score, threshold or weight', () => {
    const source = readFileSync(join(repo, 'src/domain/detection/order-candidates.ts'), 'utf8')
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/\bscore\b|\bweight\b|\bthreshold\b|\bconfidence\b/i)
  })

  /**
   * An open wait is not a candidate, and the build declined it deliberately
   * against two ADRs that described one. Principle 13 forbids a notification
   * with no decision attached, and a wait nothing can quiet would hold a slot
   * for ever. Both ADRs are amended; this is the guard.
   */
  it('has no member for a wait that is still open', () => {
    const source = readFileSync(join(repo, 'src/domain/detection/order-candidates.ts'), 'utf8')
    expect(source).not.toMatch(/kind:\s*'open-wait'|'wait-open'/)
  })
})

function id(candidate: Candidate): string {
  return candidate.kind === 'strand' ? candidate.signature : candidate.intentionId
}
