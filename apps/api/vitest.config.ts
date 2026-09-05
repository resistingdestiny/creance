import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The server logs a line per request at info. Useful in the process, noise
    // in a test run.
    env: { LOG_LEVEL: 'silent' },
  },
});
