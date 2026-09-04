import { defineConfig } from 'vitest/config';

// One run covers every workspace. Each workspace keeps its own config so it can
// also be run on its own with pnpm --filter <name> test.
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*', 'contracts'],
  },
});
