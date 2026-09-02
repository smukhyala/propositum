/**
 * Both halves of Propositum, in one terminal.
 *
 *   npm run dev
 *
 * ── The failure this exists for ──────────────────────────────────────────
 *
 * `README.md` says it plainly: without the worker, *"pressing Take over enqueues
 * a run nobody drains and the session stays `away` for ever."* Two terminals is
 * the first thing a new person gets wrong, and it fails silently — the interface
 * says a shift is running and nothing is running.
 *
 * **Corrected 2026-08-27.** The README has never warned about the worker — the
 * sentence lives at `scripts/worker.ts:10`, in the worker's own docblock, and
 * ADR-0023 struck the same misattribution in its own text on 2026-08-26. This
 * was the last copy still pointing at the wrong file. The failure it describes
 * is unchanged.
 *
 * ── Siblings, not parent and child, and that is the whole design ─────────
 *
 * [ADR-0001](../docs/adr/0001-worker-runtime.md) makes the worker a separate
 * process because everything else *"ties the run to something that can go away
 * for reasons unrelated to the work: a tab, a dev-server reload, a deploy."*
 *
 * A worker spawned BY Next would be exactly that. A worker spawned BESIDE Next
 * by this script is not: the dev server can reload, crash or be rebuilt and the
 * worker never notices, because its parent is this and not Next. ADR-0001's
 * diagram is unchanged — two boxes, two lifetimes. Only *"started as its own npm
 * script"* moved, and `npm run worker` still does exactly what it always did.
 *
 * So this script may never do the tempting thing: **one child dying does not
 * take the other with it.** Killing the web server because a worker crashed
 * would be this file quietly reversing a decision an ADR was written for.
 *
 * ── What it deliberately does not do ─────────────────────────────────────
 *
 * Production. `npm start` is untouched. The thing that supervises a real install
 * is the menu-bar app ([ADR-0023](../docs/adr/0023-the-tray-app-owns-the-runtime.md)),
 * and this is the development-time stand-in it will one day absorb.
 *
 * It reads no `.env` either. Each child loads its own, which is what they
 * already do — `scripts/worker.ts` calls `process.loadEnvFile`, and Next loads
 * one itself. A supervisor that read the environment and passed it down would be
 * a third place the configuration is interpreted.
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import type { ChildProcess } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EX_CONFIG } from '../src/runtime/exit-codes'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const bin = (name: string) => join(repo, 'node_modules', '.bin', name)

/**
 * The port, read off this script's own arguments.
 *
 * ── Why it is an argument and not a constant here ────────────────────────
 *
 * `tests/capture.test.ts` pulls the port out of `package.json`'s `dev` script
 * with a regex and asserts it matches `APP_ORIGIN` in the extension, which is
 * hardcoded because the extension is buildless on purpose. Its docblock records
 * what happens without that check: *"It drifted: APP_ORIGIN said 3117 while
 * `next dev` served 3000, so capture was off out of the box and the badge blamed
 * the wrong thing."*
 *
 * A `dev` script reading `tsx scripts/dev.ts` with the port buried in here would
 * make that regex find nothing — and the guard would go QUIET rather than red,
 * which is the worst of the three outcomes. So the port stays written where the
 * test already looks, and this reads it.
 */
function portFromArgv(argv: readonly string[]): string {
  const flag = argv.indexOf('-p')
  const value = flag < 0 ? undefined : argv[flag + 1]
  if (value === undefined || !/^\d+$/.test(value)) {
    console.error(
      'dev: no -p <port> in the arguments. It belongs in package.json\'s dev script, where ' +
        'tests/capture.test.ts can read it and check it against the extension.',
    )
    process.exit(1)
  }
  return value
}

/**
 * Which interface the app listens on, read from argv for the same reason the
 * port is.
 *
 * It is not a preference. Without it Next binds every interface, and the
 * `/api/act/*` control routes prove a CLASS of caller rather than an identity —
 * `src/act/channel.ts` accepts that as a bound on a local process, not on the
 * network. So this refuses rather than defaulting: a supervisor that quietly
 * picked a host would be the one place the decision could go missing.
 */
function hostFromArgv(argv: readonly string[]): string {
  const flag = argv.indexOf('-H')
  const value = flag < 0 ? undefined : argv[flag + 1]
  if (value === undefined || value.startsWith('-')) {
    console.error(
      "dev: no -H <host> in the arguments. It belongs in package.json's dev script, where " +
        'tests/capture.test.ts can read it and check it against the extension. Without it Next ' +
        'binds every interface and the control routes are reachable off this machine.',
    )
    process.exit(1)
  }
  return value
}

const port = portFromArgv(process.argv.slice(2))
const host = hostFromArgv(process.argv.slice(2))

/**
 * Is anything already listening?
 *
 * ── Why this is checked BEFORE anything starts ───────────────────────────
 *
 * Because of what it replaced. `next dev` on a taken port prints an
 * `EADDRINUSE` stack and exits 1; the restart logic below read that as a crash
 * worth retrying, so it printed the same stack three times and then gave up
 * saying *"the message above it is the one to read"* — which was a Node stack
 * trace, not an instruction. Meanwhile the worker started fine beside it and
 * kept running against an app that was never there.
 *
 * The port is knowable in advance and the answer never changes on retry, so it
 * is a precondition rather than a failure to recover from.
 *
 * ── Why `::` and not `127.0.0.1` ─────────────────────────────────────────
 *
 * ~~That is what Next binds and what the error names. Probing the loopback
 * address alone would miss a server bound to every interface, which is the
 * common case and the one that actually happens.~~
 *
 * **Corrected 2026-08-26.** Every word of that was true and it was describing a
 * security defect as though it were weather. Next bound every interface because
 * nothing told it not to, while `next.config.ts`, the extension's `APP_ORIGIN`
 * and every sentence a person reads all said `127.0.0.1` — and the one place
 * that discrepancy was written down was this docblock, about probing for a
 * taken port, which is not where anybody looks for a bind address.
 *
 * The scripts now pass `-H 127.0.0.1`, so the app listens on this machine only.
 * `tests/capture.test.ts` asserts that and asserts this file forwards it.
 *
 * The probe below still binds every interface ON PURPOSE, and that is now a
 * deliberate asymmetry rather than a matching default: it must detect anything
 * holding the port, including a server somebody started with a different host,
 * so a narrow probe would report free and hand the crash-loop back. Detecting
 * broadly and serving narrowly is the correct pair.
 */
function inUse(onPort: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code === 'EADDRINUSE')
    })
    probe.once('listening', () => probe.close(() => resolve(false)))
    probe.listen(Number(onPort))
  })
}

if (await inUse(port)) {
  console.error(
    `[dev] Something is already using port ${port}, so the app cannot start.\n\n` +
      '  Almost always a dev server left running. To see what it is:\n\n' +
      `    lsof -i :${port}\n\n` +
      '  And to stop it:\n\n' +
      `    lsof -ti:${port} | xargs kill\n\n` +
      '  The port is not a preference — the extension has it hardcoded, so moving\n' +
      '  the app to another one would turn capture off. Free this one instead.',
  )
  // Nothing is started. A worker beside an app that is not there is worse than
  // no worker: the interface would be unreachable while runs quietly drained.
  process.exit(EX_CONFIG)
}

/**
 * A child that dies within this many milliseconds of starting did not crash, it
 * failed to start.
 *
 * The difference decides whether restarting is help or noise. A worker that ran
 * for ten minutes and fell over should come back — that is what this script is
 * for. One that exits immediately is telling you about a misconfiguration, and
 * restarting it just buries the message under copies of itself.
 */
const STARTUP_MS = 3_000

/** How many immediate failures before this stops trying and says so. */
const GIVE_UP_AFTER = 3

interface Supervised {
  readonly name: string
  child: ChildProcess
  startedAtMs: number
  failures: number
  gaveUp: boolean
  /** Set when the child's own output says the port went while it was starting. */
  portTaken: boolean
}

let stopping = false
const running: Supervised[] = []

function start(name: string, command: string, args: readonly string[]): Supervised {
  const supervised: Supervised = {
    name,
    /**
     * `stdout` inherited so Next keeps its colours and the worker keeps the
     * `[worker]` prefix it already writes — piping to add a second prefix would
     * print `[worker] [worker] …` on every line.
     *
     * `stderr` is piped and then written straight back out, unchanged. The only
     * reason is that a child cannot tell us WHY it failed through an exit code
     * it does not control: `next` exits 1 for a taken port exactly as it does
     * for a syntax error, and the difference is only in the text.
     */
    child: spawn(command, [...args], { cwd: repo, stdio: ['inherit', 'inherit', 'pipe'] }),
    startedAtMs: Date.now(),
    failures: 0,
    gaveUp: false,
    portTaken: false,
  }

  supervised.child.on('exit', (code, signal) => {
    /**
     * Deliberate is decided by US, not by the exit code.
     *
     * ~~A clean exit meant somebody meant it, so it was left alone.~~ **Wrong,
     * and found by killing the worker to see what happened.** The worker
     * installs signal handlers so it can drain a run in flight, which means a
     * `SIGTERM` from anywhere — a stray `pkill`, an editor, an OOM reaper —
     * produces exit code **0**. Reading that as *"it stopped on its own"* left
     * the app running with nothing draining runs, which is precisely the failure
     * this script exists to prevent, restored by the script meant to fix it.
     *
     * `stopping` is the only thing that means deliberate, and it is set by the
     * signal handler below when this process is going down. Everything else is
     * restarted regardless of code.
     */
    if (stopping) return

    /**
     * A child can say *"do not try again"*, and this listens.
     *
     * `EX_CONFIG` means the process found something a restart cannot fix — a
     * schema older than the code, and the child has already printed the one
     * command that fixes it. Retrying prints that instruction three times and
     * buries it in its own copies, which is what happened before this existed.
     */
    if (code === EX_CONFIG) {
      supervised.gaveUp = true
      console.error(`[dev] ${name} cannot start until that is fixed. Not trying again.`)
      return
    }

    /**
     * The port was free at the preflight above and is not now.
     *
     * A race, and a real one: two `npm run dev`s started a second apart both
     * pass the check and one of them loses. Restarting cannot win it — the
     * other process is still there — so this stops rather than printing the
     * same stack three times, which is exactly what it did before the preflight
     * existed.
     */
    if (supervised.portTaken) {
      supervised.gaveUp = true
      console.error(
        `[dev] ${name} could not take port ${port} — something else got there first.\n` +
          `      lsof -ti:${port} | xargs kill    then start again.`,
      )
      return
    }

    const quick = Date.now() - supervised.startedAtMs < STARTUP_MS

    supervised.failures = quick ? supervised.failures + 1 : 0

    if (supervised.failures >= GIVE_UP_AFTER) {
      supervised.gaveUp = true
      console.error(
        `[dev] ${name} has failed to start ${supervised.failures} times. Not trying again — ` +
          `the message above it is the one to read.`,
      )
      return
    }

    console.error(
      `[dev] ${name} exited (${signal ?? code}). Restarting it. ` +
        `The other half is untouched.`,
    )
    const next = start(name, command, args)
    next.failures = supervised.failures
    const index = running.indexOf(supervised)
    if (index >= 0) running.splice(index, 1, next)
  })

  supervised.child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    if (text.includes('EADDRINUSE')) supervised.portTaken = true
    // Passed through untouched. This reads the stream; it does not own it.
    process.stderr.write(chunk)
  })

  supervised.child.on('error', (error) => {
    console.error(`[dev] could not start ${name}: ${error.message}`)
  })

  return supervised
}

running.push(start('the app', bin('next'), ['dev', '-H', host, '-p', port]))
running.push(start('the worker', bin('tsx'), ['scripts/worker.ts']))

console.log(`[dev] the app on http://127.0.0.1:${port}, and the worker beside it.`)
console.log('[dev] set up at http://127.0.0.1:%s/first-run — Ctrl-C stops both.', port)

/**
 * Stop both, and wait.
 *
 * Ctrl-C already reaches both children directly: they are in this terminal's
 * foreground process group, and the shell signals the group rather than the
 * leader. This exists for the other ways this process ends — a `SIGTERM` from a
 * supervisor above it, or an editor stopping the task — and because waiting is
 * the point either way.
 *
 * `SIGTERM` rather than `SIGKILL`, because `installSignalHandlers` in
 * `src/runtime/worker-process.ts` drains the worker gracefully: a run in flight
 * finishes its current action and writes its rows, instead of being cut mid-way
 * and reported as `unknown` on the next startup sweep.
 */
function stop(): void {
  if (stopping) return
  stopping = true
  for (const supervised of running) {
    if (supervised.child.exitCode === null && !supervised.gaveUp) {
      supervised.child.kill('SIGTERM')
    }
  }
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)

/**
 * Exit with the worse of the two codes.
 *
 * A run that ends because the worker died is not a successful run, and a script
 * that exits 0 over a dead child is the same silence this whole file is about.
 */
process.on('beforeExit', () => {
  const worst = running.reduce((code, supervised) => Math.max(code, supervised.child.exitCode ?? 0), 0)
  if (worst !== 0) process.exitCode = worst
})
