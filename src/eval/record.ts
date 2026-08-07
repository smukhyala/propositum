/**
 * Recording scores.
 *
 * Scores live in `eval-scores.json`, committed to git. Not a database, not a
 * CLI prompt — a diffable file, because the useful property is that a changed
 * score shows up in review with a date and an author beside it.
 *
 * Same reasoning as sealing. The risk is not dishonesty; it is a number
 * quietly softening between runs, and a file in version control makes that
 * visible without anyone having to police it.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { H1_COMPONENTS } from './scenario'
import type { H1Component } from './scenario'
import type { ComponentScore, H1Scores } from './score'
import { scoreH1 } from './score'

const SCORES_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'eval-scores.json')

/** `null` means "not yet scored" — distinct from 0, which is a judgment. */
export type PartialScores = Readonly<Record<H1Component, ComponentScore | null>>

export interface ScoreEntry {
  /** ISO date of the run these scores are for. */
  readonly ranAt: string
  readonly model: string
  /** Who entered them. n=1 today; the field exists so it stops being n=1 quietly. */
  readonly scoredBy: string
  readonly h1: PartialScores
  /** Free text — what the reading got wrong, in your words. The number alone
   *  is not a finding. */
  readonly notes?: string
  /** Did the baseline read as well or better? The question the baseline exists
   *  to answer, asked explicitly so it cannot be skipped. */
  readonly baselineAtLeastAsGood?: boolean | null
}

export type ScoreFile = Record<string, ScoreEntry>

export function readScores(path: string = SCORES_PATH): ScoreFile {
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8')) as ScoreFile
}

export function writeScores(scores: ScoreFile, path: string = SCORES_PATH): void {
  const ordered = Object.fromEntries(Object.entries(scores).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(path, JSON.stringify(ordered, null, 2) + '\n')
}

export function blankEntry(ranAt: string, model: string): ScoreEntry {
  return {
    ranAt,
    model,
    scoredBy: '',
    h1: Object.fromEntries(H1_COMPONENTS.map((c) => [c, null])) as PartialScores,
    notes: '',
    baselineAtLeastAsGood: null,
  }
}

export function isComplete(entry: ScoreEntry): boolean {
  return H1_COMPONENTS.every((c) => entry.h1[c] !== null) && entry.scoredBy.trim().length > 0
}

/** Apply the H1 gates to a completed entry. Returns null while anything is
 *  still unscored — a partial total is not a result. */
export function resultFor(scenarioId: string, entry: ScoreEntry) {
  if (!isComplete(entry)) return null
  return scoreH1(scenarioId, entry.h1 as H1Scores)
}
