import { deflateSync } from 'node:zlib';

/// A one-page text-only PDF, written by hand.
///
/// The fixtures need documents that are clearly synthetic, small enough to
/// commit, and reproducible from a script so that nothing in this repository
/// resembles a real letterhead. A PDF writer that only has to lay out lines of
/// Helvetica is about eighty lines, and it avoids adding a rendering dependency
/// to a workspace whose job is adjudication.
///
/// PDF 1.4, one page, WinAnsi Helvetica and Helvetica-Bold, a flate compressed
/// content stream. The model reads a PDF by converting each page to an image
/// and extracting the text alongside it, so a text-only page gives it both
/// layers.

/** A4 in PostScript points, which is the unit a PDF page box is measured in. */
export const A4 = { width: 595, height: 842 } as const;

export interface PdfLine {
  text: string;
  bold?: boolean;
  size?: number;
  /** Extra space before this line, in points. */
  spaceBefore?: number;
}

export interface PdfOptions {
  title: string;
  lines: PdfLine[];
  margin?: number;
  leading?: number;
}

/** The bytes of the finished document. */
export function renderPdf(options: PdfOptions): Buffer {
  const margin = options.margin ?? 64;
  const leading = options.leading ?? 16;
  let y = A4.height - margin;

  const parts: string[] = ['BT'];
  let currentFont = '';
  for (const line of options.lines) {
    y -= (line.spaceBefore ?? 0) + leading;
    const font = `${line.bold === true ? '/F2' : '/F1'} ${line.size ?? 11}`;
    if (font !== currentFont) {
      parts.push(`${font} Tf`);
      currentFont = font;
    }
    parts.push(`1 0 0 1 ${margin} ${y} Tm`, `(${escapeText(line.text)}) Tj`);
  }
  parts.push('ET');

  const content = deflateSync(Buffer.from(parts.join('\n'), 'latin1'));
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] ` +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    { stream: content },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title (${escapeText(options.title)}) /Producer (creance-adjuster-fixtures) ` +
      '/CreationDate (D:20260901000000Z) >>',
  ];

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets: number[] = [];
  let offset = chunks[0]?.byteLength ?? 0;

  objects.forEach((object, index) => {
    offsets.push(offset);
    const header = Buffer.from(`${index + 1} 0 obj\n`, 'latin1');
    const body =
      typeof object === 'string'
        ? Buffer.from(`${object}\n`, 'latin1')
        : Buffer.concat([
            Buffer.from(`<< /Length ${object.stream.byteLength} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
            object.stream,
            Buffer.from('\nendstream\n', 'latin1'),
          ]);
    const footer = Buffer.from('endobj\n', 'latin1');
    const chunk = Buffer.concat([header, body, footer]);
    chunks.push(chunk);
    offset += chunk.byteLength;
  });

  const xrefAt = offset;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\n`,
    `startxref\n${xrefAt}\n%%EOF\n`,
  ].join('');
  chunks.push(Buffer.from(xref, 'latin1'));

  return Buffer.concat(chunks);
}

/** The three characters a PDF literal string cannot carry unescaped. */
function escapeText(value: string): string {
  return value.replace(/([\\()])/g, '\\$1');
}
