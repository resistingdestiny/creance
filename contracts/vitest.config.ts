import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // test/hardhat holds the Solidity suites, which run under mocha through
    // `hardhat test` and would fail if vitest picked them up.
    include: ['test/**/*.test.ts'],
    exclude: ['test/hardhat/**'],
  },
});
