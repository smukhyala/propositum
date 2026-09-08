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
import { candidatesFrom, parseStream, type ReplayedProject } from '../src/eval/replay'

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
