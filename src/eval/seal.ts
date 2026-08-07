/**
 * Sealing: turning "the reference was written first" from an intention into a
 * checkable fact.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * H1 is scored by the same person who wrote the answer key. At n=1 that
 * circularity cannot be removed, only bounded — and the bound is worthless if
 * the key can be quietly adjusted after seeing a disappointing result.
 *
 * Nobody does that dishonestly. They do it by thinking "ah, my reference was
 * badly worded" — which is sometimes even true, and is exactly why the rule has
 * to be mechanical rather than a matter of discipline.
 *
 * So: sealing hashes the answer key into `references.lock.json`, which is
 * committed. The harness refuses to score a scenario whose reference no longer
 * matches its seal. Re-sealing is deliberate, loud, and shows up in a diff.
 *
 * If a reference really was wrong, the rule is to add a NEW scenario rather
 * than edit the old one — the mistake is itself a finding about how the
 * fixture was written.
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { sealedPayload } from './scenario'
import type { Scenario } from './scenario'

const LOCK_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'references.lock.json',
)

export interface SealEntry {
  readonly hash: string
  /** Passed in rather than read from the clock, so the lock is reproducible in
   *  tests and a fixture replay does not rewrite history. */
  readonly sealedAt: string
}

export type SealFile = Record<string, SealEntry>

export function hashReference(scenario: Scenario): string {
  return createHash('sha256').update(sealedPayload(scenario)).digest('hex')
}

export function readSeals(path: string = LOCK_PATH): SealFile {
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8')) as SealFile
}

export function writeSeals(seals: SealFile, path: string = LOCK_PATH): void {
  const ordered = Object.fromEntries(Object.entries(seals).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(path, JSON.stringify(ordered, null, 2) + '\n')
}

export type SealStatus =
  | { readonly state: 'sealed'; readonly sealedAt: string }
  | { readonly state: 'unsealed' }
  | { readonly state: 'broken'; readonly sealedAt: string; readonly expected: string; readonly actual: string }

export function checkSeal(scenario: Scenario, seals: SealFile): SealStatus {
  const entry = seals[scenario.id]
  if (!entry) return { state: 'unsealed' }

  const actual = hashReference(scenario)
  if (actual === entry.hash) return { state: 'sealed', sealedAt: entry.sealedAt }

  return { state: 'broken', sealedAt: entry.sealedAt, expected: entry.hash, actual }
}

export class BrokenSealError extends Error {
  constructor(scenarioId: string, sealedAt: string) {
    super(
      `Scenario "${scenarioId}" has a broken seal.\n\n` +
        `Its reference was sealed at ${sealedAt} and has changed since.\n\n` +
        `H1 measures whether the model matched an answer key written BEFORE the run. ` +
        `An edited key does not measure that, whatever the intention behind the edit.\n\n` +
        `If the reference was genuinely wrong, add a NEW scenario — the mistake is a ` +
        `finding about how the fixture was written. Re-seal only when you mean to ` +
        `discard the previous measurements.`,
    )
    this.name = 'BrokenSealError'
  }
}

/** Throws unless every scenario's reference matches its seal. Unsealed
 *  scenarios are allowed — they simply have not been measured yet. */
export function requireIntactSeals(
  scenarios: readonly Scenario[],
  seals: SealFile = readSeals(),
): void {
  for (const scenario of scenarios) {
    const status = checkSeal(scenario, seals)
    if (status.state === 'broken') throw new BrokenSealError(scenario.id, status.sealedAt)
  }
}

/** Seal any scenario that is not yet sealed. Refuses to re-seal a broken one
 *  silently — that has to be an explicit, visible act. */
export function sealNew(
  scenarios: readonly Scenario[],
  now: string,
  seals: SealFile = readSeals(),
): { readonly seals: SealFile; readonly newlySealed: string[]; readonly broken: string[] } {
  const next: SealFile = { ...seals }
  const newlySealed: string[] = []
  const broken: string[] = []

  for (const scenario of scenarios) {
    const status = checkSeal(scenario, seals)
    if (status.state === 'unsealed') {
      next[scenario.id] = { hash: hashReference(scenario), sealedAt: now }
      newlySealed.push(scenario.id)
    } else if (status.state === 'broken') {
      broken.push(scenario.id)
    }
  }

  return { seals: next, newlySealed, broken }
}
