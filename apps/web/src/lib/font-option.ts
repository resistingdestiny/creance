/**
 * Which of the two typeface options in docs/DESIGN-TOKENS.md section 2 is
 * active. Option A is the default and the shipped choice. The value is read
 * from a public environment variable, which the framework inlines at build
 * time, so the branch that selects the font module is resolved by the bundler
 * and the inactive family is never fetched at runtime.
 */
export type FontOption = 'A' | 'B';

export const activeFontOption: FontOption =
  process.env.NEXT_PUBLIC_FONT_OPTION === 'B' ? 'B' : 'A';
