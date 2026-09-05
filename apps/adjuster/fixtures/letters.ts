import type { PdfLine } from '../src/pdf.js';

/// The text of the two synthetic documents, and the only place it lives.
///
/// Both employers are invented. `pnpm --filter @creance/adjuster fixtures`
/// renders these into the PDFs beside them, so the committed files are
/// reproducible and nothing here resembles a real letterhead.

export interface FixtureLetter {
  file: string;
  title: string;
  lines: PdfLine[];
}

/** Packet A. A redundancy letter that agrees with its statement on every field. */
export const LETTER_A: FixtureLetter = {
  file: 'packet-a/letter.pdf',
  title: 'Northgate Systems Ltd, termination of employment',
  lines: [
    { text: 'NORTHGATE SYSTEMS LTD', bold: true, size: 14 },
    { text: '14 Kingsway House, Leeds LS1 2AB', size: 9 },
    { text: '27 February 2026', spaceBefore: 18 },
    { text: 'Alex Mercer', spaceBefore: 18 },
    { text: '4 Sowerby Terrace, Leeds LS6 1HQ' },
    { text: 'Dear Alex', spaceBefore: 18 },
    { text: 'Termination of employment by reason of redundancy', bold: true, spaceBefore: 12 },
    {
      text: 'Following the consultation meetings held on 10 and 24 February 2026, I am',
      spaceBefore: 12,
    },
    { text: 'writing to confirm that your role of Software Engineer is being made' },
    { text: 'redundant. Your last working day of employment with Northgate Systems Ltd' },
    { text: 'will be 13 March 2026.' },
    {
      text: 'You will receive your statutory redundancy payment, payment in lieu of',
      spaceBefore: 12,
    },
    { text: 'untaken holiday, and your final salary payment in the March payroll run.' },
    { text: 'Your P45 will follow.' },
    {
      text: 'This decision is not a reflection of your performance. We are sorry to lose',
      spaceBefore: 12,
    },
    { text: 'you and we will provide a reference on request.' },
    { text: 'Yours sincerely', spaceBefore: 18 },
    { text: 'R. Okafor', spaceBefore: 24 },
    { text: 'Head of People, Northgate Systems Ltd', size: 9 },
  ],
};

/** Packet B. A resignation acknowledgement, which no rule ever has to read. */
export const LETTER_B: FixtureLetter = {
  file: 'packet-b/letter.pdf',
  title: 'Calder and Finch LLP, resignation acknowledgement',
  lines: [
    { text: 'CALDER & FINCH LLP', bold: true, size: 14 },
    { text: '2 Marlow Wharf, Bristol BS1 4RN', size: 9 },
    { text: 'Resignation acknowledgement', bold: true, spaceBefore: 18 },
    { text: '6 February 2026', spaceBefore: 12 },
    { text: 'Dear Robin', spaceBefore: 18 },
    {
      text: "We acknowledge receipt of your letter of 4 February 2026 giving one month's",
      spaceBefore: 12,
    },
    { text: 'notice of your resignation from the position of Data Analyst. Your last' },
    { text: 'working day will therefore be 6 March 2026.' },
    { text: 'We wish you well in your new role.', spaceBefore: 12 },
    { text: 'M. Duarte', spaceBefore: 24 },
    { text: 'Operations', size: 9 },
  ],
};

export const LETTERS: FixtureLetter[] = [LETTER_A, LETTER_B];
