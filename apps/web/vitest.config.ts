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
    // Files that need a DOM ask for one with a `@vitest-environment jsdom`
    // docblock. Everything else runs in node, which is most of it.
  },
});
