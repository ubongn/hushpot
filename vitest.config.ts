import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // docs-cache/ holds reference copies of upstream templates, not our tests.
    exclude: ['node_modules/**', 'docs-cache/**', 'dist/**'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
