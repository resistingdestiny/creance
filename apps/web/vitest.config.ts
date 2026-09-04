import { defineConfig } from 'vitest/config';

// The tsconfig keeps jsx on "preserve" for Next, so esbuild is told explicitly
// to compile JSX with the automatic runtime for the test build.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@': new URL('./src/', import.meta.url).pathname },
  },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environmentMatchGlobs: [['test/**/*.dom.test.tsx', 'jsdom']],
  },
});
