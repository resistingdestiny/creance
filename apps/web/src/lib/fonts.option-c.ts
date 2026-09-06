// Option C of docs/DESIGN-TOKENS.md section 2, which names General Sans beside
// Geist as the alternative to Inter Tight and Inter: General Sans for
// everything. It is the typeface of direction 1c in the design file.
//
// The other two options are self hosted by next/font. This one is a stylesheet
// link because the ITF Free Font License permits self hosting but forbids
// redistributing the font files, and this repository is public, so the files
// cannot be committed. See docs/DECISIONS.md and docs/STARTERS.md.
//
// The scale uses 400, 500 and 600 and no other weight.
export const fontOption = 'C';
export const fontClassName = 'font-option-c';
export const fontStylesheetHref =
  'https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600&display=swap';
