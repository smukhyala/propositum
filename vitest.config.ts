import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    // Points `DATABASE_URL` at a temp path that does not exist, so no test can
    // reach the developer's real `propositum.db` by omission. Added 2026-08-18
    // after a counter did exactly that. See the file for what it does not do.
    setupFiles: ['tests/support/no-real-database.ts'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Live API tests are tagged and excluded from the default run. See
    // docs/research/structured-model-output.md — layer 4 is nightly, never CI.
    exclude: ['**/node_modules/**', '**/*.live.test.ts'],
    // Six times vitest's 5000ms default. Added 2026-09-01, after three tests
    // timed out on CI and passed on a re-run of the same commit — a docs-only
    // PR, so nothing had changed but the runner.
    //
    // This is a property of the SUITE, not of those three tests. A large share
    // of the files here build a database of their own — `tests/counts.test.ts`
    // counts them, so the number is not repeated in this comment — and each one
    // spawns `npx prisma db push` as a subprocess before
    // `src/persistence/append-only.ts` reinstalls and verifies its triggers,
    // all of it ahead of the first assertion. On a 2-core `ubuntu-latest`
    // runner that is the slow path, and the three that failed were the ones
    // that lost the race, not the ones that are wrong. Per-test timeouts would
    // have fixed those three and left the next database-backed test somebody
    // writes to rediscover this.
    //
    // WHAT IT COSTS, because a timeout is a promise in the other direction: a
    // test that genuinely hangs now takes thirty seconds to say so instead of
    // five. That is the price of a red tick meaning "a guard fired" rather than
    // "the runner was slow" — the two were indistinguishable without opening
    // the log, which is the failure this repository's guards exist to prevent.
    // Nothing on the happy path gets slower, because nothing on it waits.
    //
    // `vitest.live.config.ts` keeps its own 120_000 and is untouched.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
