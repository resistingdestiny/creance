import { gunzipSync } from 'node:zlib';

/**
 * The LN catalogue, ln.series, is the file that resolves a series id to a title,
 * a seasonality and a date range. It is a tab separated table whose fields are
 * padded with trailing spaces.
 */
export interface CatalogueEntry {
  seriesId: string;
  lfstCode: string;
  periodicityCode: string;
  title: string;
  occupationCode: string;
  seasonal: string;
  beginYear: string;
  beginPeriod: string;
  endYear: string;
  endPeriod: string;
}

/** The unemployment rate measure inside the LN program. */
export const LFST_UNEMPLOYMENT_RATE = '40';
export const PERIODICITY_MONTHLY = 'M';
export const SEASONAL_NOT_ADJUSTED = 'U';
/** The occupation dimension is unset on the all-occupation series. */
export const OCCUPATION_ALL = '0000';

export function parseCatalogue(gzipped: Buffer): CatalogueEntry[] {
  const text = gunzipSync(gzipped).toString('utf8');
  return parseCatalogueText(text);
}

export function parseCatalogueText(text: string): CatalogueEntry[] {
  const lines = text.split('\n');
  const header = lines[0];
  if (header === undefined) throw new Error('ln.series is empty');
  const columns = header.split('\t').map(trim);
  const index = (name: string): number => {
    const at = columns.indexOf(name);
    if (at < 0) throw new Error(`ln.series has no ${name} column`);
    return at;
  };
  const at = {
    seriesId: index('series_id'),
    lfstCode: index('lfst_code'),
    periodicityCode: index('periodicity_code'),
    title: index('series_title'),
    occupationCode: index('occupation_code'),
    seasonal: index('seasonal'),
    beginYear: index('begin_year'),
    beginPeriod: index('begin_period'),
    endYear: index('end_year'),
    endPeriod: index('end_period'),
  };
  const entries: CatalogueEntry[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined || line.trim().length === 0) continue;
    const fields = line.split('\t');
    const field = (position: number): string => trim(fields[position] ?? '');
    entries.push({
      seriesId: field(at.seriesId),
      lfstCode: field(at.lfstCode),
      periodicityCode: field(at.periodicityCode),
      title: field(at.title),
      occupationCode: field(at.occupationCode),
      seasonal: field(at.seasonal),
      beginYear: field(at.beginYear),
      beginPeriod: field(at.beginPeriod),
      endYear: field(at.endYear),
      endPeriod: field(at.endPeriod),
    });
  }
  return entries;
}

function trim(value: string): string {
  return value.trim();
}

/**
 * The resolution procedure of the index specification, section 3: monthly, not
 * seasonally adjusted, unemployment rate, occupation dimension, matched on the
 * catalogue title. The title is the discriminator because it is unique inside
 * that filter, and the filter is applied first so that a title that reappears in
 * a quarterly or seasonally adjusted series cannot be picked up by accident.
 */
export function resolveByTitle(
  entries: readonly CatalogueEntry[],
  title: string,
  options: { readonly requireOccupation: boolean },
): CatalogueEntry {
  const candidates = entries.filter(
    (entry) =>
      entry.lfstCode === LFST_UNEMPLOYMENT_RATE &&
      entry.periodicityCode === PERIODICITY_MONTHLY &&
      entry.seasonal === SEASONAL_NOT_ADJUSTED &&
      (options.requireOccupation
        ? entry.occupationCode !== OCCUPATION_ALL
        : entry.occupationCode === OCCUPATION_ALL) &&
      entry.title === title,
  );
  if (candidates.length !== 1) {
    throw new Error(`ln.series resolves ${candidates.length} series for ${title}`);
  }
  return candidates[0] as CatalogueEntry;
}
