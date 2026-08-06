import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
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
