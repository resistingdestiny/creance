import type { NextConfig } from 'next';

import { activeFontOption } from './src/lib/font-option';

/**
 * Which typeface option of docs/DESIGN-TOKENS.md section 2 is built.
 *
 * The switch has to happen at module resolution, not in a branch inside the
 * layout. A font module that is anywhere in the bundle graph gets its @font-face
 * and its preload link emitted, so a conditional import still ships both
 * families to the browser. Aliasing the specifier means only the chosen module
 * is ever resolved and the other family leaves the build entirely.
 */
const fontModule =
  activeFontOption === 'B' ? './src/lib/fonts.option-b.ts' : './src/lib/fonts.option-a.ts';

const config: NextConfig = {
  reactStrictMode: true,
  // `next dev` writes an AGENTS.md and a CLAUDE.md into the workspace on first
  // run. Documentation is not this ticket's to add and the repository holds
  // product code, tests and the files a ticket asks for.
  agentRules: false,
  turbopack: {
    resolveAlias: {
      'creance-active-font': fontModule,
    },
  },
};

export default config;
