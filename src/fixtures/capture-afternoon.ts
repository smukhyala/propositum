/**
 * Save the ambient buffer to a file, on purpose, by hand.
 *
 *     npm run capture:afternoon -- <name> --note "what this is" --i-mean-it
 *
 * ── Read this before running it ──────────────────────────────────────────
 *
 * The decision this command belongs to is
 * `docs/adr/0015-measuring-loudness-and-saving-an-afternoon.md` (2026-08-18),
 * which fires ADR-0008's *"anyone proposes writing ambient observations to
 * disk"* trigger. The three guards below are quoted there with the same limits.
 *
 * **The file this writes is a profile of you.** Every page you have looked at
 * in the last thirty minutes: the cleaned URL, the title, how long each one
 * held you, how far down you scrolled, how you left, how you got there, and the
 * subject Propositum decided it was all about. `docs/adr/0008-ambient-detection.md`
 * refuses to let the PRODUCT keep any of that, and this command does not change
 * that refusal — the buffer is still in memory, still bounded twice, still
 * forgotten on decline. What changes is that you can take a copy.
 *
 * Two things follow, and neither of them is fixable by a flag:
 *
 *   - **The buffer forgets in thirty minutes. A file does not.** There is no
 *     window, no row cap and no `clear()` on disk.
 *   - **Committing one publishes it** to everybody who can read the repository,
 *     for as long as the history exists. A fixture is a useful thing; an
 *     afternoon of somebody's real browsing in a git history is a different
 *     thing wearing the same clothes.
 *
 * Both sentences are printed at the point of use, not only here, because a
 * warning in a docblock is a warning to whoever reads the docblock.
 *
 * ── Why it cannot happen by accident, and where that stops ───────────────
 *
 * Three guards, in the order they bind. Each is named with what it does not
 * stop, because a guard whose limit is unstated reads as a stronger promise
 * than it is.
 *
 *  1. **No terminal, no capture.** `process.stdin.isTTY` is false for cron, for
 *     a CI step, for a `setInterval` in a worker and for anything spawned by
 *     the app — none of them have a person attached. This is the guard that is
 *     actually about timers, and it is the only one of the three that is.
 *     *It does not stop* a determined person running this under a pty, and it
 *     is not meant to: the thing being prevented is a capture happening that
 *     nobody chose, not a capture somebody worked to arrange.
 *  2. **The name typed back.** A confirmation you can answer with `y` is a
 *     confirmation you answer without reading. Typing the fixture's own name
 *     costs a second and cannot be muscle memory the first time.
 *     *It does not stop* anything if a script feeds it on stdin — which is what
 *     guard 1 is for, and why they are two guards rather than one.
 *  3. **`--i-mean-it`, and no overwriting.** The flag is what makes an
 *     accidental invocation exit having done nothing. Refusing to overwrite is
 *     what stops a second capture silently replacing an afternoon somebody had
 *     already decided to keep.
 *
 * What none of them stop: nothing here can tell whose browsing is in the
 * buffer. If you are on somebody else's machine, the file is theirs.
 *
 * ── Why it is not a route, a button, or anything on the app's side ───────
 *
 * Because then the PRODUCT would be able to write it. The whole argument above
 * rests on the file being made by a person at a terminal, and a POST that wrote
 * one would put "save this person's afternoon to disk" inside the reach of the
 * poll, the worker, and any page that got past a transport control. This is a
 * command in a repository, and the app has no code path that mentions it.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { join } from 'node:path'

import { AFTERNOONS_DIR, parseAfternoon } from './afternoon'

/** The dev server's port, as `package.json` sets it. */
const DEFAULT_ENDPOINT = 'http://127.0.0.1:3117/api/capture/ambient/debug'

/**
 * The two headers the endpoint requires, quoted from its own docblock.
 *
 * `sec-fetch-site` is a forbidden header name, so a page cannot send it and a
 * non-browser caller can. That is the distinction the endpoint rests on, and
 * repeating it here rather than importing `CUSTOM_HEADER` is deliberate: this
 * file is a hand tool that stands in for a `curl`, and the `curl` in the
 * endpoint's docblock has the strings written out too.
 */
const HEADERS = { 'x-propositum-capture': '1', 'sec-fetch-site': 'none' }

const WHAT_IT_IS = [
  'This writes a profile of you: every page in the last thirty minutes, how long each held',
  'you, how far down you got, how you left, how you got there, and what Propositum made of it.',
].join('\n')

/** Said twice — before the capture and after it — because the half that matters
 *  after the file exists is the half about the file existing. */
const WHAT_IT_COSTS =
  'The buffer forgets in thirty minutes. A file does not, and committing one publishes it.'

function fail(message: string): never {
  process.stderr.write(`\ncapture-afternoon: ${message}\n\n`)
  process.exit(1)
}

function flagValue(argv: readonly string[], flag: string): string | null {
  const at = argv.indexOf(flag)
  if (at === -1) return null
  return argv[at + 1] ?? null
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const name = argv[0]

  if (name === undefined || name.startsWith('-')) {
    fail('give the afternoon a name: npm run capture:afternoon -- <name> --note "..." --i-mean-it')
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    fail(`"${name}" is not a usable file name — lower case, digits and hyphens`)
  }

  const note = flagValue(argv, '--note')
  if (note === null || note.trim() === '') {
    // Required, for the reason `CapturedAfternoon.note` gives: a fixture nobody
    // can explain is the fixture that gets believed about the wrong session.
    fail('--note "what this is" is required — say whose afternoon this is and what it was')
  }

  if (!argv.includes('--i-mean-it')) {
    fail('--i-mean-it is required. Read the docblock at the top of this file first')
  }

  if (!process.stdin.isTTY) {
    fail(
      'there is no terminal attached, so nobody is here to mean it. This refuses to run from cron, ' +
        'from CI, or from anything on a timer — see guard 1 in the docblock',
    )
  }

  const file = join(AFTERNOONS_DIR, `${name}.json`)
  if (existsSync(file)) {
    fail(`${file} already exists. Pick another name, or delete that one deliberately`)
  }

  const endpoint = flagValue(argv, '--from') ?? DEFAULT_ENDPOINT

  process.stdout.write(`\n${WHAT_IT_IS}\n${WHAT_IT_COSTS}\n\n`)
  process.stdout.write(`It will be written to ${file}\n`)

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  let typed: string
  try {
    typed = await rl.question(`Type the name "${name}" to save it, or anything else to stop: `)
  } catch {
    // Stdin ended, or was never a person to begin with — a pty with a here-doc
    // behind it satisfies `isTTY` and then closes. Treated as a refusal rather
    // than as a crash, because the only safe reading of "the answer went away"
    // is that nobody gave one.
    fail('the terminal went away before an answer arrived. Nothing was written')
  } finally {
    rl.close()
  }

  if (typed.trim() !== name) fail('not confirmed. Nothing was written')

  // The `catch` covers the fetch and the parse and nothing else. A refusal by
  // the endpoint is handled OUTSIDE it, deliberately: a 403 reported as "could
  // not read" would send somebody looking for a network fault when the real
  // answer is that the two headers did not arrive.
  let response: Response
  try {
    response = await fetch(endpoint, { headers: HEADERS })
  } catch (error) {
    fail(`could not reach ${endpoint}: ${String(error)}. Is \`npm run dev\` running?`)
  }

  if (!response.ok) {
    fail(
      `${endpoint} answered ${response.status}. The two headers above are required, and the ` +
        'buffer only fills while no session is running',
    )
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    fail(`${endpoint} did not answer with JSON: ${String(error)}`)
  }

  if (typeof body !== 'object' || body === null) fail(`${endpoint} did not answer with an object`)

  /**
   * The response, verbatim, with one key added.
   *
   * `note` first so it is the first line of the file — the thing a person opens
   * it to find out. The spread after it means a field the endpoint grows
   * tomorrow lands here without this file being touched, which is the same
   * argument the endpoint makes for emitting its rows whole: a hand-built
   * projection is how three signals went missing for a week.
   */
  const captured = { note: note.trim(), ...(body as Record<string, unknown>) }
  const text = `${JSON.stringify(captured, null, 2)}\n`

  // Parsed before it is written, so a capture that cannot be loaded back is a
  // message rather than a file somebody finds broken three weeks later.
  parseAfternoon(text, endpoint)

  mkdirSync(AFTERNOONS_DIR, { recursive: true })
  writeFileSync(file, text)

  process.stdout.write(`\nWrote ${file}\n`)
  process.stdout.write(`${WHAT_IT_COSTS}\n`)
  process.stdout.write('Read it before you commit it.\n\n')
}

await main()
