// The three families of docs/DESIGN-TOKENS.md section 2, all in one build, for
// the gallery alone.
//
// The root layout resolves one font module through the `creance-active-font`
// alias so the inactive families leave the product build entirely. Comparing
// the three home directions at a glance needs the opposite, so this module
// imports all three concretely. It is imported by the gallery page and by
// nothing else, which keeps the two inactive families in that one route's
// bundle graph and out of every other route.
//
// General Sans is not self hosted, so its class only takes effect where the
// Fontshare stylesheet is linked. The gallery page links it beside this.
import type { FontOption } from '../../lib/font-option';
import { fontClassName as optionA } from '../../lib/fonts.option-a';
import { fontClassName as optionB } from '../../lib/fonts.option-b';
import { fontClassName as optionC, fontStylesheetHref } from '../../lib/fonts.option-c';

export const specimenFonts: Record<FontOption, string> = {
  A: optionA,
  B: optionB,
  C: optionC,
};

export const specimenStylesheetHref = fontStylesheetHref;
