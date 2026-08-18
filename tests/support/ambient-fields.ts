/**
 * The fields `AmbientObservation` actually declares, read out of the source.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Two tests claimed to hold the shape of the always-on record and neither one
 * did. `tests/detection.test.ts`'s *"the detector cannot see page text"* and
 * `tests/ambient-store.test.ts`'s *"has no field for the referrer"* each built
 * an object literal in the test and then asserted `Object.keys` of the literal
 * they had just built. `Object.keys` of a literal returns the keys of that
 * literal, so both could only fail if somebody edited the test.
 *
 * Measured on 2026-08-18: adding
 *
 *     readonly referrer?: string | undefined
 *
 * to `AmbientObservation` left the whole suite green — 51 files, 1,496 tests —
 * and `tsc --noEmit` clean. The promise those tests were written to hold is the
 * one this product's privacy document makes in the loudest voice it has, and
 * the only thing standing behind it was prose.
 *
 * An OPTIONAL field is the case that matters, and it is exactly the case a
 * literal cannot see: a required field would at least fail to compile.
 *
 * ── Why source parsing and not a type ────────────────────────────────────
 *
 * Both. A type-level guard sits beside each call site here — `[Extract<keyof
 * AmbientObservation, 'referrer'>] extends [never]` — and that is the sharper
 * instrument, because it knows what a type is rather than what a file looks
 * like. But vitest does not typecheck: `npm test` would stay green and only
 * `npm run typecheck` would go red. A guard that fires in one command and not
 * the other is half a guard, so the runtime half reads the declaration.
 *
 * ── What it cannot see, said rather than papered over ────────────────────
 *
 * It is text to a marker, not a parse. It reads the span from the interface's
 * own line to the first line-initial `}`, and it counts `readonly name:` — so a
 * field declared without `readonly`, or an intersection type bolted on from
 * elsewhere (`AmbientObservation & { referrer: string }`), is invisible to it.
 * The type-level assertions at the call sites cover the second of those and not
 * the first. `tests/reachability.test.ts` uses the same slice-and-grep
 * technique on the extension with the same limit named, and a parser would be
 * better than either.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripComments } from './strip-comments'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export function ambientObservationFields(): string[] {
  const source = stripComments(
    readFileSync(join(repo, 'src', 'domain', 'detection', 'detect.ts'), 'utf8'),
  )

  const from = source.indexOf('export interface AmbientObservation {')
  if (from === -1) {
    throw new Error(
      'AmbientObservation is not declared the way tests/support/ambient-fields.ts reads it — the guards that depend on this are now about nothing',
    )
  }

  const end = source.indexOf('\n}', from)
  if (end === -1) {
    throw new Error('AmbientObservation has no line-initial closing brace — the slice cannot end')
  }

  const declared = [...source.slice(from, end).matchAll(/readonly\s+(\w+)\??\s*:/g)].map(
    (match) => match[1]!,
  )

  // Non-vacuous at the source: an empty list would satisfy every "does not
  // contain" assertion downstream, which is the failure this module exists
  // about, one level up.
  if (declared.length === 0) {
    throw new Error('AmbientObservation parsed to zero fields — the slice is wrong, not the code')
  }

  return declared.sort()
}
