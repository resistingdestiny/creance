import { GeistSans } from 'geist/font/sans';

// Option B of docs/DESIGN-TOKENS.md section 2: Geist for everything. The family
// slots are pointed at Geist's own variable by the .font-option-b class in the
// global stylesheet.
export const fontOption = 'B';
export const fontClassName = `${GeistSans.variable} font-option-b`;

// Self hosted by the geist package's own next/font call, so nothing to link.
export const fontStylesheetHref: string | undefined = undefined;
