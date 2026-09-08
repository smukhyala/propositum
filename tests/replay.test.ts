/**
 * Recorded streams. ADR-0037.
 *
 * The rule this file exists to hold is the must-not list. A fixture that only
 * asserts what should appear cannot catch the expensive failure, and Principle
 * 13's standing guard — an afternoon of ordinary reading that must NOT qualify —
 * is the shape being generalised.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  candidatesFrom,
  checkStreamSeal,
  hashStream,
  parseStream,
  readStreamSeals,
  sealedStreamPayload,
  type ReplayedProject,
} from '../src/eval/replay'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const STREAMS = join(repo, 'src/fixtures/streams')
const ORIGIN = Date.UTC(2026, 0, 1, 9, 0, 0)

const files = readdirSync(STREAMS).filter((name) => name.endsWith('.jsonl'))

describe('every shipped stream', () => {
  it('there is at least one, or this file is about nothing', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    describe(file, () => {
      const parsed = parseStream(readFileSync(join(STREAMS, file), 'utf8'))

      it('parses', () => {
        expect(parsed.ok, parsed.ok ? '' : parsed.detail).toBe(true)
      })

      /**
       * The rule, and the reason this suite exists. A stream with nothing it
       * must stay quiet about measures enthusiasm, not judgement.
       */
      it('names what it must stay quiet about, with a reason for each', () => {
        if (!parsed.ok) return
        expect(parsed.stream.expectSilence.length).toBeGreaterThan(0)
        for (const quiet of parsed.stream.expectSilence) {
          expect(quiet.because.length).toBeGreaterThan(10)
        }
      })

      it('never expects to surface something it also expects silence about', () => {
        if (!parsed.ok) return
        const quiet = new Set(parsed.stream.expectSilence.map((entry) => entry.project))
        for (const surfaced of parsed.stream.expectSurfaced) {
          expect(quiet.has(surfaced), `${surfaced} is on both lists`).toBe(false)
        }
      })
    })
  }
})

describe('the fold is deterministic, which is what makes a stream a measurement', () => {
  const projects: readonly ReplayedProject[] = [
    { project: 'late', statedWait: 'a reply', arrivedAtElapsedMs: 86_400_000 },
    { project: 'early', statedWait: 'a quote', arrivedAtElapsedMs: 3_600_000 },
    { project: 'open', statedWait: 'a letter', arrivedAtElapsedMs: null },
    { project: 'none', statedWait: null, arrivedAtElapsedMs: 7_200_000 },
  ]

  it('gives the same answer twice, and the same answer reversed', () => {
    const once = candidatesFrom(projects, ORIGIN).map(name)
    const twice = candidatesFrom(projects, ORIGIN).map(name)
    const reversed = candidatesFrom([...projects].reverse(), ORIGIN).map(name)
    expect(twice).toEqual(once)
    expect(reversed).toEqual(once)
  })

  it('surfaces only a discharged wait, most recent first', () => {
    expect(candidatesFrom(projects, ORIGIN).map(name)).toEqual(['late', 'early'])
  })

  /**
   * The two silences that are easy to lose. An open wait carries no decision
   * (Principle 13), and an arrival for a project nobody was waiting on is an
   * event about nothing.
   */
  it('says nothing about an open wait, or an arrival nobody was waiting for', () => {
    const surfaced = candidatesFrom(projects, ORIGIN).map(name)
    expect(surfaced).not.toContain('open')
    expect(surfaced).not.toContain('none')
  })

  it('is silent on an empty world, because silence is a correct output', () => {
    expect(candidatesFrom([], ORIGIN)).toEqual([])
  })
})

describe('a stream that does not read', () => {
  it('comes back as a value, never as a throw', () => {
    expect(parseStream('')).toEqual({ ok: false, detail: 'the stream is empty' })
    const broken = parseStream('not json')
    expect(broken.ok).toBe(false)
  })
})

function name(candidate: { kind: string; signature?: string; intentionId?: string }): string {
  return candidate.kind === 'strand' ? (candidate.signature ?? '') : (candidate.intentionId ?? '')
}

describe('the seal, which makes "written before the run" a fact', () => {
  const seals = readStreamSeals()

  for (const file of files) {
    const parsed = parseStream(readFileSync(join(STREAMS, file), 'utf8'))

    /**
     * The rule ADR-0037's guard table said was owed. Without it a stream's
     * expectations live in a file somebody can edit after a disappointing run,
     * which is exactly what `seal.ts` exists to prevent for a scenario.
     */
    it(`${file} is sealed, and its seal is intact`, () => {
      if (!parsed.ok) return
      const status = checkStreamSeal(parsed.stream, seals)
      expect(
        status.state,
        status.state === 'unsealed'
          ? `seal it: npm run replay -- src/fixtures/streams/${file} --seal`
          : 'the expectations changed after sealing — add a NEW stream rather than editing this one',
      ).toBe('sealed')
    })
  }

  /**
   * What is sealed is the ANSWER KEY and not the question.
   *
   * `scenario.ts` draws the same line: the events can be corrected without
   * breaking the seal, because changing them invalidates the fixture for a
   * different reason and is caught by review rather than by a hash. A payload
   * that covered the lines would make every typo fix look like tampering, and a
   * rule people route around is not a rule.
   */
  it('covers the expectations and not the events', () => {
    const parsed = parseStream(readFileSync(join(STREAMS, files[0]!), 'utf8'))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const payload = sealedStreamPayload(parsed.stream)
    expect(payload).toContain('expectSurfaced')
    expect(payload).toContain('expectSilence')
    expect(payload, 'the events are the question, and a question may be corrected').not.toContain(
      '"lines"',
    )

    // Editing an expectation moves the hash; editing the events does not.
    const edited = { ...parsed.stream, expectSurfaced: [] }
    expect(hashStream(edited)).not.toBe(hashStream(parsed.stream))
    const requestioned = { ...parsed.stream, lines: parsed.stream.lines.slice(0, 1) }
    expect(hashStream(requestioned)).toBe(hashStream(parsed.stream))
  })
})
