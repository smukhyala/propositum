/**
 * The scope, the secret, and the model — three things a grep can hold.
 *
 * ── Why this file exists, and what it is modelled on ─────────────────────
 *
 * `tests/extension-permissions.test.ts` is the model. It exists because a
 * permission is bought once and spent forever: the manifest says what Chrome
 * was asked for, and a guard says what the source actually does with it. An
 * OAuth scope is the same object one layer out. `calendar.freebusy` is the
 * narrowest thing that answers *how long will they be gone* —
 * [`freebusy.query`](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
 * returns only `calendars.(key).busy[]`, each entry a bare `start`/`end` — and
 * the two wider scopes that were considered and refused are one string away.
 *
 * The refusal is worth stating as a decision rather than as an omission,
 * because the wider scope is genuinely more useful. The full Event resource
 * carries `eventType`, whose values include `focusTime` and `outOfOffice`: a
 * person declaring their own intent in a structured field, which is better
 * evidence than anything this product infers from browsing. It was refused
 * anyway, because it arrives attached to every event title on every calendar.
 * ADR-0014 argues it; this asserts it.
 *
 * ── What a grep can see here, and what it cannot ─────────────────────────
 *
 * The honest limits are `tests/extension-permissions.test.ts`'s, and they
 * transfer without softening:
 *
 *  - **Computed strings walk past it.** `'calendar' + '.readonly'`, or a scope
 *    assembled from a variable, satisfies every assertion below. This is a
 *    defence against somebody who does not know they should not, and not
 *    against somebody who wants to get round it.
 *  - **It says nothing about what Google granted.** A person can arrive at the
 *    callback holding a wider grant — a hand-edited URL, an older build's link
 *    in an open tab. That is not a source property and no grep can see it, so
 *    it is checked at RUNTIME instead, twice: `completeCalendarConnection`
 *    refuses to store a grant that is not exactly the constant, and `readBusy`
 *    refuses to use a stored one that is not. `tests/calendar-freebusy.test.ts`
 *    exercises both.
 *  - **Intent.** A scope absent from the source is a scope nobody has written
 *    yet, not a scope Google would refuse. The two are not the same strength
 *    and this file does not present them as though they were.
 *
 * ── The canary, which is the part that generalises ───────────────────────
 *
 * Every not-found assertion below is vacuous the day the files it searches stop
 * existing or stop containing what it is written about. So the first block
 * asserts the positives: the constant is where it is expected, the source list
 * is non-empty, and the string this whole feature is bought on is genuinely
 * present somewhere. A guard that searches a directory that no longer holds the
 * feature passes forever.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { stripComments } from './support/strip-comments'
import { CALENDAR_FREEBUSY_SCOPE } from '../src/server/calendar'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry)) out.push(full)
    }
  }
  walk(join(repo, dir))
  return out
}

/**
 * Comments stripped, for the reason `tests/reachability.test.ts` found the hard
 * way: a comment MENTIONING a forbidden string would fail a check it should
 * pass, and the only way to keep the suite green would be to stop explaining
 * why the rule exists. This file's own subject — two scopes that were
 * considered and refused — cannot be written down at all unless the searches
 * ignore prose.
 */
const SOURCES = sourceFiles('src').map((file) => ({
  name: relative(repo, file),
  raw: readFileSync(file, 'utf8'),
  code: stripComments(readFileSync(file, 'utf8')),
}))

const ALL_CODE = SOURCES.map(({ code }) => code).join('\n')

/** Where the calendar actually lives, so the narrower checks below cannot be
 *  satisfied by searching a file that has nothing to do with it. */
const CALENDAR_FILES = [
  'src/server/calendar.ts',
  'src/domain/handoff/calendar-window.ts',
  'src/app/api/calendar/connect/route.ts',
  'src/app/api/calendar/callback/route.ts',
]

describe('the searches are not vacuous', () => {
  it('found source files to search', () => {
    expect(SOURCES.length).toBeGreaterThan(40)
  })

  it('still has the files this is written about', () => {
    const names = new Set(SOURCES.map((s) => s.name))
    for (const file of CALENDAR_FILES) expect(names).toContain(file)
  })

  it('finds the scope this feature was actually bought on', () => {
    // If this ever fails, every "does not contain" assertion below has been
    // passing by searching a codebase with no calendar in it.
    expect(ALL_CODE).toContain(CALENDAR_FREEBUSY_SCOPE)
  })

  it('loses no code to the stripper in the calendar sources', () => {
    // The shape that made `tests/extension-permissions.test.ts` blind for a
    // day: a `/*` inside a string literal swallowing the next thirty lines. If
    // a calendar source ever loses executable text to the strip, everything
    // below it is invisible.
    for (const file of CALENDAR_FILES) {
      const source = SOURCES.find((s) => s.name === file)!
      const rawLines = source.raw.split('\n').filter((l) => /[;{}=(]/.test(l)).length
      const codeLines = source.code.split('\n').filter((l) => /[;{}=(]/.test(l)).length

      // Comments contain punctuation too, so this is not an equality — it is a
      // floor. A third of one file going missing, which is what happened last
      // time, would put this well under it.
      expect(codeLines, `${file} lost most of its code to the stripper`).toBeGreaterThan(
        rawLines / 3,
      )
    }
  })
})

describe('the scope is exactly calendar.freebusy', () => {
  it('is that exact string and nothing else', () => {
    expect(CALENDAR_FREEBUSY_SCOPE).toBe('https://www.googleapis.com/auth/calendar.freebusy')
  })

  it('is declared once, so a widened scope cannot arrive without a diff that shows it', () => {
    const declarations = SOURCES.filter(({ code }) =>
      code.includes("'https://www.googleapis.com/auth/calendar.freebusy'"),
    ).map(({ name }) => name)

    expect(declarations).toEqual(['src/server/calendar.ts'])
  })

  it('is the only Google auth scope named anywhere in src', () => {
    // Deliberately broader than the three forbidden strings below: this catches
    // `drive.readonly`, `gmail.metadata`, `contacts` and anything else somebody
    // reaches for later, without needing a list of every scope Google publishes.
    const found = new Set<string>()
    for (const [scope] of ALL_CODE.matchAll(
      /https:\/\/www\.googleapis\.com\/auth\/[A-Za-z0-9._-]+/g,
    )) {
      found.add(scope)
    }

    expect([...found]).toEqual([CALENDAR_FREEBUSY_SCOPE])
  })
})

describe('the wider calendar scopes appear nowhere in src', () => {
  /**
   * Refused, not merely unused. Each was considered:
   *
   *  - `calendar.readonly` — *"See and download any calendar you can access
   *    using your Calendar."*
   *  - `calendar.events.readonly` — *"View events on all your calendars."*
   *  - `calendar.events` — read and write.
   *
   * The first two would carry `eventType: focusTime`, which is the single best
   * intent signal in this whole research note and is still not worth every
   * event title on every calendar. The third is not even arguable: this product
   * never writes to a calendar and has no reason to be able to.
   */
  it.each(['calendar.readonly', 'calendar.events.readonly', 'calendar.events'])(
    '%s is absent',
    (forbidden) => {
      const offenders = SOURCES.filter(({ code }) => code.includes(forbidden)).map(
        ({ name }) => name,
      )

      expect(offenders, `${forbidden} was refused in ADR-0014 and is in the source`).toEqual([])
    },
  )

  it('nothing reads the events endpoint either', () => {
    // A scope is a permission; an endpoint is a call. Neither on its own is
    // proof, and the events endpoint under a freebusy grant would simply 403 —
    // but code that calls it is code somebody wrote intending to widen the
    // scope, and that is worth catching before the scope moves.
    expect(ALL_CODE).not.toMatch(/calendar\/v3\/calendars\//)
    expect(ALL_CODE).not.toMatch(/calendar\/v3\/users\//)
    expect(ALL_CODE).toContain('calendar/v3/freeBusy')
  })
})

describe('the refresh token cannot reach a log, a prompt, or a screen', () => {
  /**
   * Four containments, weakest to strongest.
   *
   * The strongest is not in this file at all: `CalendarConnectionStatus` has no
   * `refreshToken` field, so the type every screen and every action sees cannot
   * carry one. These greps cover the rest — the places a token could be handled
   * deliberately and end up somewhere it should not.
   */

  it('is named in exactly two source files, and neither renders anything', () => {
    const files = SOURCES.filter(({ code }) => code.includes('refreshToken')).map(({ name }) => name)

    expect(new Set(files)).toEqual(
      new Set(['src/server/calendar.ts', 'src/persistence/repositories/index.ts']),
    )
  })

  it('reaches no .tsx file at all', () => {
    const rendered = SOURCES.filter(
      ({ name, code }) => name.endsWith('.tsx') && /refreshToken|refresh_token/.test(code),
    ).map(({ name }) => name)

    expect(rendered).toEqual([])
  })

  it('is never logged, because the calendar path logs nothing', () => {
    // The ordinary instinct on a failing HTTP call is to log the request. Two
    // of these requests carry a refresh token as a form field, and a terminal
    // is a scrollback, a screenshot and an issue comment. So the failure
    // classes are returned as values and nothing here writes to a console.
    for (const file of CALENDAR_FILES) {
      const source = SOURCES.find((s) => s.name === file)!
      expect(source.code, `${file} logs`).not.toMatch(/console\s*\./)
    }
  })

  it('reaches no model boundary, and no model reaches the calendar', () => {
    // "No model in this path" is two claims. First: nothing on the calendar
    // path builds a prompt or calls a client.
    for (const file of CALENDAR_FILES) {
      const source = SOURCES.find((s) => s.name === file)!
      expect(source.code, `${file} names a model client`).not.toMatch(/ModelClient|modelClient/)
      expect(source.code, `${file} names a boundary`).not.toMatch(/boundaries\//)
      expect(source.code, `${file} datamarks something`).not.toMatch(/datamark/)
    }

    // Second: nothing under src/model knows a calendar exists — so there is no
    // prompt for a busy interval, let alone a token, to reach.
    const modelFiles = SOURCES.filter(({ name }) => name.startsWith('src/model/'))
    expect(modelFiles.length).toBeGreaterThan(5)

    for (const { name, code } of modelFiles) {
      expect(code, `${name} mentions the calendar`).not.toMatch(/calendar|freebusy|freeBusy/i)
    }
  })
})

describe('the calendar cannot authorise anything', () => {
  it('never reaches compilePolicy, the gate, or a ContractScope', () => {
    for (const file of CALENDAR_FILES) {
      const source = SOURCES.find((s) => s.name === file)!
      expect(source.code, `${file} compiles a policy`).not.toMatch(/compilePolicy/)
      expect(source.code, `${file} names the gate`).not.toMatch(/authorize|AuthorizedAction/)
      expect(source.code, `${file} names a scope object`).not.toMatch(
        /ContractScope|allowedActionKinds|approvedSourceIds/,
      )
    }
  })

  it('never writes a contract, an intent or a run', () => {
    const source = SOURCES.find((s) => s.name === 'src/server/calendar.ts')!

    // The one repository it may touch is its own. Anything else here would be
    // the calendar reaching into the record of somebody's work.
    expect(source.code).not.toMatch(/repos\.(?!calendar\b)\w+/)
  })

  it('the suggestion never becomes a stored time limit', () => {
    // `draftContract` reads the calendar AFTER `createDraft`, so no persisted
    // field can be derived from it. This is the grep that says the assignment
    // still comes from the model's clamped proposal and from nothing else.
    const actions = stripComments(readFileSync(join(repo, 'src/server/actions.ts'), 'utf8'))

    expect(actions).toContain('timeLimitMinutes: minutes')
    expect(actions).not.toMatch(/timeLimitMinutes:\s*calendar/)
    expect(actions).not.toMatch(/timeLimitMinutes:\s*\w*[Ss]uggestion/)

    // ...and the order: the row is written, then the calendar is read.
    const created = actions.indexOf('contracts.createDraft')
    const read = actions.indexOf('suggestedTimeLimit(')
    expect(created).toBeGreaterThan(0)
    expect(read).toBeGreaterThan(created)
  })

  it('joins a drafted contract through one function and no other path', () => {
    const actions = stripComments(readFileSync(join(repo, 'src/server/actions.ts'), 'utf8'))

    expect(actions).toContain('withCalendarSuggestion(')

    // The field is never assigned by hand anywhere. One writer, so one place to
    // check that "absent when there is nothing to say" is still true.
    const writers = SOURCES.filter(({ code }) => /calendarSuggestion:/.test(code)).map(
      ({ name }) => name,
    )
    expect(writers).toEqual(['src/server/calendar.ts'])
  })
})

describe('the feature is reachable from the product', () => {
  /**
   * `tests/reachability.test.ts`'s finding, applied to a feature whose whole
   * design is that it is invisible when it is not working. Correct, tested code
   * that nothing calls is a real failure mode here more than anywhere: every
   * behavioural test in `tests/calendar-freebusy.test.ts` calls these functions
   * directly, so all of them would stay green with no screen wired to any of it,
   * and the product would degrade silently to today's behaviour — which is the
   * thing this feature is supposed to do when it FAILS.
   */
  const called = (needle: string, definedIn: string) =>
    SOURCES.filter(({ name, code }) => name !== definedIn && code.includes(needle)).map(
      ({ name }) => name,
    )

  it('something starts the authorisation', () => {
    expect(called('beginCalendarConnection', 'src/server/calendar.ts')).toEqual([
      'src/app/api/calendar/connect/route.ts',
    ])
  })

  it('something finishes it, or the redirect lands nowhere', () => {
    expect(called('completeCalendarConnection', 'src/server/calendar.ts')).toEqual([
      'src/app/api/calendar/callback/route.ts',
    ])
  })

  it('something can disconnect, or the credential is unremovable from the product', () => {
    expect(called('disconnectCalendar', 'src/server/calendar.ts')).toEqual(['src/server/actions.ts'])
    expect(called('forgetCalendar', 'src/server/actions.ts')).toEqual(['src/app/page.tsx'])
  })

  it('a screen renders the row, and it is the front door', () => {
    // Not the agreement screen, deliberately. The one calendar failure a person
    // can fix belongs on a screen they chose to open, never where a suggestion
    // would have been.
    expect(called('calendarRow', 'src/server/calendar.ts')).toEqual(['src/app/page.tsx'])
    expect(called('calendarRow', 'src/server/calendar.ts')).not.toContain('src/ui/agreement.tsx')
  })

  /** The body of a named function, by balancing braces from its signature. */
  const bodyOf = (code: string, name: string): string => {
    const at = code.indexOf(`function ${name}(`)
    expect(at, `${name} is not declared`).toBeGreaterThan(-1)

    const open = code.indexOf('{', code.indexOf(')', at))
    let depth = 0
    for (let i = open; i < code.length; i += 1) {
      if (code[i] === '{') depth += 1
      else if (code[i] === '}') {
        depth -= 1
        if (depth === 0) return code.slice(open, i)
      }
    }

    throw new Error(`unbalanced braces in ${name}`)
  }

  it('every entry point a screen can reach is failure-total', () => {
    // The regression, in one line: `calendarRow` was the only unguarded await
    // the calendar added to a screen, so a `calendar_connection` table that was
    // missing or momentarily busy returned a 500 for the whole front door —
    // every project, every offer, every shift, gone because an optional feature
    // could not read an optional table. `tests/calendar-front-door.test.ts`
    // executes the fix; this is the rule, next to the other rules.
    const calendar = SOURCES.find((s) => s.name === 'src/server/calendar.ts')!

    for (const entry of ['calendarRow', 'suggestedTimeLimit']) {
      expect(bodyOf(calendar.code, entry), `${entry} can throw into a screen`).toMatch(/catch/)
    }

    // ...and the one on the handoff path, which is caught twice on purpose.
    //
    // Found by balancing parentheses rather than by a pattern, for the reason
    // this file learned twice in one day: `suggestedTimeLimit(Date.now())` has
    // a `)` inside it, and every `[^)]*` written against it stops at the wrong
    // one.
    const actions = stripComments(readFileSync(join(repo, 'src/server/actions.ts'), 'utf8'))
    const at = actions.indexOf('suggestedTimeLimit(')
    expect(at, 'the handoff path stopped asking for a suggestion').toBeGreaterThan(-1)

    let depth = 0
    let after = -1
    for (let i = actions.indexOf('(', at); i < actions.length; i += 1) {
      if (actions[i] === '(') depth += 1
      else if (actions[i] === ')') {
        depth -= 1
        if (depth === 0) {
          after = i + 1
          break
        }
      }
    }

    expect(actions.slice(after).startsWith('.catch(')).toBe(true)
  })

  it('something actually asks for a suggestion, and the screen renders it', () => {
    expect(called('suggestedTimeLimit(', 'src/server/calendar.ts')).toEqual(['src/server/actions.ts'])
    expect(called('calendarSuggestion', 'src/server/calendar.ts')).toEqual(
      expect.arrayContaining(['src/server/actions.ts', 'src/ui/agreement.tsx']),
    )
  })
})

describe('the time limits a calendar may name are the ones a person can click', () => {
  it('has exactly one declaration of the choices', () => {
    const declarations = SOURCES.filter(({ code }) => /TIME_LIMIT_CHOICES\s*:/.test(code)).map(
      ({ name }) => name,
    )

    expect(declarations).toEqual(['src/domain/handoff/policy.ts'])
  })

  it('leaves no second copy behind in the component it moved out of', () => {
    const agreement = SOURCES.find((s) => s.name === 'src/ui/agreement.tsx')!

    // The literal it used to be. A copy here would be a range that can disagree
    // with the suggester's, and the disagreement would render as a control
    // whose value no radio can show as chosen.
    expect(agreement.code).not.toMatch(/\[\s*15\s*,\s*30\s*,\s*60\s*,\s*120\s*,\s*240\s*\]/)
    expect(agreement.code).toContain('TIME_LIMIT_CHOICES')
  })

  /**
   * ── What these guards used to be, and why they were replaced ───────────
   *
   * Three regexes, until 2026-08-18:
   *
   *     expect(agreement.code).not.toMatch(/useState\([^)]*calendarSuggestion/)
   *     expect(agreement.code).not.toMatch(/useEffect\([^)]*suggestion/)
   *     expect(agreement.code).not.toMatch(/setTimeLimitMinutes\([^)]*[Ss]uggestion/)
   *
   * All three were defeated by one ordinary refactor of the line beside them,
   * and the defeat was verified rather than imagined: with the initialiser
   * changed to `nearestChoice(draft.calendarSuggestion?.minutes ?? …)` the dial
   * arrived pre-set from Google with no human press, and the full suite and
   * `tsc --noEmit` both stayed clean. `[^)]*` cannot cross the `)` in
   * `TIME_CHOICES.includes(…)`, so the whole initialiser was invisible to the
   * first pattern. What made it deceptive is that the NAIVE shape was caught —
   * the guard tested for one spelling and read as though it tested a property.
   *
   * So these read the property instead: the initialiser is extracted by
   * balancing parentheses rather than by matching a shape, and the executable
   * half of the component is sliced out and required to contain no reference to
   * the calendar at all. `tests/calendar-agreement.test.ts` then renders the
   * screen and asserts which radio is checked, which is the same claim as an
   * execution and is the one that cannot be walked past by any refactor.
   */

  /** The argument list of the call whose `(` comes next after `from`, found by
   *  balancing parens rather than by a pattern — which is the whole point. */
  const callArgument = (code: string, from: number): string => {
    const open = code.indexOf('(', from)
    expect(open, 'no call found after the declaration').toBeGreaterThan(-1)

    let depth = 0
    for (let i = open; i < code.length; i += 1) {
      if (code[i] === '(') depth += 1
      else if (code[i] === ')') {
        depth -= 1
        if (depth === 0) return code.slice(open + 1, i)
      }
    }

    throw new Error('unbalanced parentheses in the initialiser')
  }

  it('never reads the calendar into the time limit’s initial value', () => {
    const agreement = SOURCES.find((s) => s.name === 'src/ui/agreement.tsx')!

    const declared = agreement.code.indexOf('const [timeLimitMinutes, setTimeLimitMinutes] =')
    expect(declared, 'the state declaration moved or was renamed').toBeGreaterThan(-1)

    // Everything inside `useState(...)`, however deeply nested. A calendar
    // number reachable from here is a budget set by Google.
    const initialiser = callArgument(agreement.code, declared)
    expect(initialiser).toContain('draft.suggestedTimeLimitMinutes')
    expect(initialiser, 'the calendar reaches the initial value').not.toMatch(/[Ss]uggestion\b/)
    expect(initialiser, 'the calendar reaches the initial value').not.toMatch(/calendar/i)
  })

  it('never reads the calendar anywhere a hook can run', () => {
    const agreement = SOURCES.find((s) => s.name === 'src/ui/agreement.tsx')!

    const opens = agreement.code.indexOf('export function Agreement(')
    const control = agreement.code.indexOf('<TimeLimit')
    expect(opens).toBeGreaterThan(-1)
    expect(control).toBeGreaterThan(opens)

    // Hooks precede the returned JSX, so everything between the signature and
    // the control IS the executable half of this component. `calendarSuggestion`
    // must appear nowhere in it — not in a `useState`, not in a `useEffect`, not
    // in a local, not behind a helper. The only permitted occurrence is the
    // prop handed to the control itself.
    const executable = agreement.code.slice(opens, control)
    expect(executable, 'the calendar is read before the control').not.toMatch(/calendarSuggestion/)

    const occurrences = [...agreement.code.matchAll(/calendarSuggestion/g)]
    expect(occurrences).toHaveLength(2) // `=== undefined ? {} : { suggestion: … }`
  })

  it('hands the setter to the control and to nothing else', () => {
    const agreement = SOURCES.find((s) => s.name === 'src/ui/agreement.tsx')!

    // Two mentions: the declaration, and the prop. A third is a call site, and
    // a call site is the shape that pushes a value in without a press.
    const uses = [...agreement.code.matchAll(/setTimeLimitMinutes/g)]
    expect(uses).toHaveLength(2)
    expect(agreement.code).toContain('onChange={setTimeLimitMinutes}')

    // ...and the one shape that is allowed: an onClick handing the number to
    // the same setter a radio uses.
    expect(agreement.code).toMatch(/onClick=\{\(\)\s*=>\s*onChange\(suggestion\.minutes\)\}/)
  })

  it('keeps the sentence that says where the number came from', () => {
    const agreement = SOURCES.find((s) => s.name === 'src/ui/agreement.tsx')!

    // The button may be hidden when it would change nothing. The provenance may
    // not — a person ratifying a calendar-derived budget has to be able to read
    // that it is one, which is what four documents promise. Rendered in
    // `tests/calendar-agreement.test.ts`; named here so the rule is beside the
    // rest of them.
    expect(agreement.code).toContain('Your calendar has you busy from')
    expect(agreement.code).not.toMatch(/suggestion\.minutes !== minutes \? \(/)
  })
})
