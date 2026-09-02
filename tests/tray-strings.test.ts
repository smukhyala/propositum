/**
 * The banned words cannot reach the tray, where the vocabulary guard is blind.
 *
 * `tests/consumer-vocabulary.test.ts` extracts prose from the app and the side
 * panel — and says so: *"It checks the app and the side panel, and nothing
 * else."* The tray app's strings live in Rust and in `src-tauri/ui`, which
 * that extractor never reads. Its menu is a consumer surface like any screen,
 * so the same four executable bans apply: `task`, `take over`, `shift`,
 * `claim`.
 *
 * ── What is read ─────────────────────────────────────────────────────────
 *
 * Every string literal in `src-tauri/src/**.rs`, comments stripped first
 * through the repository's one comment stripper (Rust's comment syntax is
 * TypeScript's, which is why reuse is honest) — so a docblock may still name
 * `claimNext` or a Shift while a literal may not. Plus the full text of
 * `src-tauri/ui/*.html`, comments included, because everything in those files
 * is ours and aimed at a person.
 *
 * ── The guard on the guard ───────────────────────────────────────────────
 *
 * An extractor that returned nothing would pass every ban while checking
 * nothing, so the literal extractor runs against a planted fixture first —
 * the vocabulary test's own idiom.
 *
 * ── What this does NOT cover, stated because it reads stronger than it is ─
 *
 * A sentence assembled at runtime (`format!` interpolation can splice a
 * banned word in from data), raw strings (`r"…"`/`r#"…"#` — none exist here,
 * and one appearing would be invisible to this regex), and the words the
 * tray renders from the endpoint — those come from `INTENTION_STATES` and are
 * the app-side guard's to hold. It reads ALL literals rather than only prose,
 * which is stricter than the vocabulary test: an internal Rust string that
 * legitimately needs a banned word costs an argued exemption here, and none
 * is expected.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { stripComments } from './support/strip-comments'

const repo = fileURLToPath(new URL('..', import.meta.url))

const BANNED = [/\btasks?\b/i, /\btake over\b/i, /\bshifts?\b/i, /\bclaims?\b/i]

/**
 * The argued exemptions, exact-match so no sentence can ride one. The single
 * entry is the kill switch's accelerator: `Shift` there is the key on the
 * keyboard, an accelerator token the OS parses and no person reads as prose —
 * the ban is about the product word for a working session, which `CONTEXT.md`
 * renders as "While you were away".
 */
const EXEMPT = new Set(['CmdOrCtrl+Shift+Escape'])

/** Rust string literals, escapes respected, comments stripped first. */
const literalsOf = (rustSource: string): string[] =>
  [...stripComments(rustSource).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1] ?? '')

/** Recursive since 2026-08-28 — the walk was flat, which meant a module moved
 * into a subdirectory would leave this guard silently reading less. The crate
 * is still flat today; the recursion is for the day it is not. */
const rustFiles = (): string[] => {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.rs')) found.push(path)
    }
  }
  walk(join(repo, 'src-tauri', 'src'))
  return found
}

const htmlFiles = (): string[] =>
  readdirSync(join(repo, 'src-tauri', 'ui'))
    .filter((name) => name.endsWith('.html'))
    .map((name) => join(repo, 'src-tauri', 'ui', name))

describe('the extractor is not blind', () => {
  it('finds literals, skips comments, and respects escapes', () => {
    const fixture = [
      'fn planted() {',
      '  // a comment saying take over, which must NOT be picked up',
      '  let a = "a planted literal";',
      '  let b = "an escaped \\" quote inside";',
      '}',
    ].join('\n')

    const found = literalsOf(fixture)
    expect(found).toContain('a planted literal')
    expect(found).toContain('an escaped \\" quote inside')
    expect(found.join(' ')).not.toContain('take over')
  })
})

describe('no banned word reaches the tray', () => {
  it('keeps every Rust string literal clean', () => {
    for (const file of rustFiles()) {
      const literals = literalsOf(readFileSync(file, 'utf8')).filter(
        (literal) => !EXEMPT.has(literal),
      )
      for (const ban of BANNED) {
        for (const literal of literals) {
          expect(
            literal,
            `${file} holds a literal with a banned word — the tray is a consumer surface and CONTEXT.md's table applies to it`,
          ).not.toMatch(ban)
        }
      }
    }
  })

  it('keeps the tray ui pages clean, comments included', () => {
    for (const file of htmlFiles()) {
      const text = readFileSync(file, 'utf8')
      for (const ban of BANNED) {
        expect(
          text,
          `${file} says a banned word — everything in this folder is aimed at a person`,
        ).not.toMatch(ban)
      }
    }
  })
})
