import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['common/**/*.test.ts', 'plugins/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['common/**/*.ts'],
      exclude: ['common/**/*.test.ts', 'common/index.ts'],
    },
  },
});
