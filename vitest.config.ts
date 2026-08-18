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
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
