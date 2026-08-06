/**
 * Layer 4 only — the live contract tests that actually call the API.
 *
 * A separate config rather than a flag, because Vitest's CLI `--exclude`
 * appends to the base config's exclude list instead of replacing it, so the
 * live files stay filtered out no matter how they are named on the command
 * line. A config that cannot run its own tests is worse than no config.
 *
 *   npm run test:live
 *
 * Never part of `npm test`. These cost money, take seconds each, and fail when
 * the network does — none of which should block a unit-test run.
 */

import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.live.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 120_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
