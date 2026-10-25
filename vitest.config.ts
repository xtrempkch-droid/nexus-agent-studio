import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `variants/desktop` is included for its **pure** logic (the preview renderer).
    // Components are still verified in the browser, not here: there is no DOM
    // environment configured, and adding one would be a much larger change.
    include: ['common/**/*.test.ts', 'plugins/**/*.test.ts', 'variants/desktop/src/lib/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['common/**/*.ts'],
      exclude: ['common/**/*.test.ts', 'common/index.ts'],
    },
  },
});
