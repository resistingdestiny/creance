import { Inter, Inter_Tight } from 'next/font/google';

// Option A of docs/DESIGN-TOKENS.md section 2, the option the mocks shipped:
// Inter Tight for display and numbers, Inter for text. Only the weights the
// scale uses are loaded. Nothing in the sheet is 700.
const text = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-text-family',
});

const display = Inter_Tight({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-display-family',
});

export const fontOption = 'A';
export const fontClassName = `${text.variable} ${display.variable}`;
