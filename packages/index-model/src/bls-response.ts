import { periodFromBls, type Period } from './period.js';

/**
 * Strict parsing of a BLS Public Data API response. A silently empty or partly
 * parsed adapter is indistinguishable from a stable world: the index would
 * flatten to a baseline and nothing downstream would notice. Everything here
 * throws rather than skipping.
 */

export interface SourceObservation {
  seriesId: string;
  period: Period;
  /** The published rate, or null when the source says the month has no value. */
  value: number | null;
  /** The raw string as published, kept for the source hash. */
  raw: string;
  year: string;
  blsPeriod: string;
  footnoteCodes: string[];
}

export interface ParsedSeries {
  seriesId: string;
  /** Ascending by period, M13 dropped. */
  observations: SourceObservation[];
}

const VALUE_RE = /^-?\d+(\.\d+)?$/;
/** The source writes an absent month as a bare hyphen, never as zero. */
const ABSENT = '-';

interface RawFootnote {
  code?: unknown;
  text?: unknown;
}

interface RawObservation {
  year?: unknown;
  period?: unknown;
  value?: unknown;
  footnotes?: unknown;
}

interface RawSeries {
  seriesID?: unknown;
  data?: unknown;
}

interface RawResponse {
  status?: unknown;
  message?: unknown;
  Results?: { series?: unknown } | unknown;
}

export function parseBlsResponse(body: unknown, origin: string): ParsedSeries[] {
  const response = body as RawResponse;
  if (typeof response?.status !== 'string') {
    throw new Error(`${origin}: response has no status`);
  }
  if (response.status !== 'REQUEST_SUCCEEDED') {
    const messages = Array.isArray(response.message) ? response.message.join('; ') : '';
    throw new Error(`${origin}: status ${response.status}${messages ? `: ${messages}` : ''}`);
  }
  const results = (response.Results ?? {}) as { series?: unknown };
  if (!Array.isArray(results.series)) {
    throw new Error(`${origin}: response has no Results.series array`);
  }
  return results.series.map((series) => parseSeries(series as RawSeries, origin));
}

function parseSeries(series: RawSeries, origin: string): ParsedSeries {
  const seriesId = series.seriesID;
  if (typeof seriesId !== 'string' || seriesId.length === 0) {
    throw new Error(`${origin}: series without a seriesID`);
  }
  if (!Array.isArray(series.data)) {
    throw new Error(`${origin}: series ${seriesId} has no data array`);
  }
  const observations: SourceObservation[] = [];
  const seen = new Set<Period>();
  for (const row of series.data as RawObservation[]) {
    const parsed = parseObservation(seriesId, row, origin);
    if (parsed === null) continue;
    if (seen.has(parsed.period)) {
      throw new Error(`${origin}: series ${seriesId} repeats period ${parsed.period}`);
    }
    seen.add(parsed.period);
    observations.push(parsed);
  }
  // The API returns rows newest first. Every consumer wants them ascending, and
  // nothing should depend on file order.
  observations.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  return { seriesId, observations };
}

function parseObservation(
  seriesId: string,
  row: RawObservation,
  origin: string,
): SourceObservation | null {
  const { year, period, value } = row;
  if (typeof year !== 'string' || typeof period !== 'string') {
    throw new Error(`${origin}: series ${seriesId} has a row without year and period`);
  }
  const parsedPeriod = periodFromBls(year, period);
  // M13 is the annual average, not a month.
  if (parsedPeriod === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`${origin}: ${seriesId} ${parsedPeriod} has a non-string value`);
  }
  let numeric: number | null;
  if (value === ABSENT) {
    numeric = null;
  } else if (VALUE_RE.test(value)) {
    numeric = Number(value);
  } else {
    throw new Error(`${origin}: ${seriesId} ${parsedPeriod} has an unparseable value ${value}`);
  }
  return {
    seriesId,
    period: parsedPeriod,
    value: numeric,
    raw: value,
    year,
    blsPeriod: period,
    footnoteCodes: parseFootnoteCodes(row.footnotes),
  };
}

function parseFootnoteCodes(footnotes: unknown): string[] {
  if (footnotes === undefined || footnotes === null) return [];
  if (!Array.isArray(footnotes)) throw new Error('footnotes is not an array');
  const codes: string[] = [];
  for (const footnote of footnotes as RawFootnote[]) {
    // The API emits a bare {} on rows with no footnote.
    if (footnote && typeof footnote.code === 'string' && footnote.code.length > 0) {
      codes.push(footnote.code);
    }
  }
  return codes;
}

/** Merge the same series arriving in several files, one file per year range. */
export function mergeSeries(parts: readonly ParsedSeries[]): Map<string, SourceObservation[]> {
  const merged = new Map<string, Map<Period, SourceObservation>>();
  for (const part of parts) {
    let byPeriod = merged.get(part.seriesId);
    if (!byPeriod) {
      byPeriod = new Map();
      merged.set(part.seriesId, byPeriod);
    }
    for (const observation of part.observations) {
      const existing = byPeriod.get(observation.period);
      if (existing && existing.raw !== observation.raw) {
        throw new Error(
          `${part.seriesId} ${observation.period}: two source files disagree, ` +
            `${existing.raw} and ${observation.raw}`,
        );
      }
      byPeriod.set(observation.period, observation);
    }
  }
  const out = new Map<string, SourceObservation[]>();
  for (const [seriesId, byPeriod] of merged) {
    const rows = [...byPeriod.values()].sort((a, b) =>
      a.period < b.period ? -1 : a.period > b.period ? 1 : 0,
    );
    out.set(seriesId, rows);
  }
  return out;
}
