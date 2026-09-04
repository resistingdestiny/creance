import { createHash } from 'node:crypto';

import { canonicalize, type JsonValue } from './jcs.js';

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** One extracted source row, in the shape the source hash commits to. */
export interface SourceRow {
  seriesID: string;
  year: string;
  period: string;
  value: string;
  footnote_codes: string[];
}

/**
 * sha256 over the JCS form of the extracted rows for the months a computation
 * used. Deliberately not the hash of the response body: the body carries
 * responseTime and a latest flag that change between two identical fetches, so a
 * body hash cannot show that two runs saw the same data. The archive path keeps
 * the file hashes as well, because there the bytes are fixed.
 */
export function sourceHash(rows: readonly SourceRow[]): string {
  const sorted = [...rows].sort(
    (a, b) =>
      a.seriesID.localeCompare(b.seriesID) ||
      a.year.localeCompare(b.year) ||
      a.period.localeCompare(b.period),
  );
  const canonical = canonicalize(sorted as unknown as JsonValue);
  return sha256Hex(canonical);
}
