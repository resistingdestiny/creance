/**
 * Which typeface option of docs/DESIGN-TOKENS.md section 2 is active, and the
 * card treatment that goes with it. Option A is the default and the shipped
 * choice. The value is read from a public environment variable, which the
 * framework inlines at build time, so the branch that selects the font module
 * is resolved by the bundler and the inactive families are never fetched at
 * runtime.
 *
 * The three home directions of the design file change the card treatment and
 * the typeface together, so they are one setting and not two. Section 2 names
 * Geist and General Sans as the same alternative to Inter Tight and Inter, and
 * the directions pair one card with each.
 */
export type FontOption = 'A' | 'B' | 'C';

/** The three card treatments of the design file, in the same order. */
export type CardTreatment = 'wallet' | 'certificate' | 'ingot';

const treatmentOf: Record<FontOption, CardTreatment> = {
  A: 'wallet',
  B: 'certificate',
  C: 'ingot',
};

function readFontOption(): FontOption {
  const value = process.env.NEXT_PUBLIC_FONT_OPTION;
  if (value === 'B') return 'B';
  if (value === 'C') return 'C';
  return 'A';
}

export const activeFontOption: FontOption = readFontOption();

/** 1a with option A, 1b with option B, 1c with option C. */
export const activeCardTreatment: CardTreatment = treatmentOf[activeFontOption];
