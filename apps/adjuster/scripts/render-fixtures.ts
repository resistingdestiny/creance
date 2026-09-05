import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { LETTERS } from '../fixtures/letters.js';
import { renderPdf } from '../src/pdf.js';

/// `pnpm --filter @creance/adjuster fixtures`
///
/// Renders the two synthetic documents from the text in fixtures/letters.ts.
/// The PDFs are committed, so this exists to prove they can be regenerated and
/// to make a change to the letter text a one-command change to the file.

for (const letter of LETTERS) {
  const path = fileURLToPath(new URL(`../fixtures/${letter.file}`, import.meta.url));
  const bytes = renderPdf({ title: letter.title, lines: letter.lines });
  writeFileSync(path, bytes);
  console.log(`${letter.file}  ${bytes.byteLength} bytes`);
}
