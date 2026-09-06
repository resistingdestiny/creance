import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '@creance/index-model';

/// The attribution series, read off disk.
///
/// This is the Challenger, Gray and Christmas count of announced United States
/// job cuts where the employer itself named artificial intelligence as the
/// reason. It is telemetry beside the index and it is not settlement data:
/// nothing here opens or closes a claim, and nothing here reaches
/// packages/index-model or apps/oracle. docs/INDEX-SPEC.md section 2 keeps
/// companion series in their own modules for exactly this reason.
///
/// The repository root is resolved the way the BLS archive is resolved, by
/// walking up from the index-model package to pnpm-workspace.yaml, so the
/// files are found whichever directory the process was started from. The API
/// image copies data/attribution by name for the same reason it copies
/// data/bls.
///
/// Months before May 2023 are absent from the file rather than zero, because
/// the category did not exist. This module never fills a gap: it reads the
/// keys the file has, sorts them, and refuses a file whose months are not one
/// unbroken run.

/** A month in the source file. `cuts` is a whole count of announced cuts. */
export interface AttributionMonth {
  period: string;
  cuts: number;
}

export interface AttributionSeries {
  months: AttributionMonth[];
  /** Every tracked month added up. */
  cumulative: number;
  /** The newest tracked month. The file always has at least one. */
  latest: AttributionMonth;
  /** The oldest tracked month, which is where the category begins. */
  first: AttributionMonth;
  /** The largest month, which is what a chart drawn from this scales against. */
  peak: AttributionMonth;
  /** PROVENANCE.txt beside the series, verbatim. */
  provenance: string;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export function attributionRoot(): string {
  return join(repoRoot(), 'data', 'attribution');
}

function nextPeriod(period: string): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * Turn the flat period to count object into an ordered series.
 *
 * Exported so a test can hand it a small object rather than the file. It
 * throws rather than repairing: a count that is not a whole number, a key that
 * is not a period, or a hole in the middle of the run would each mean the
 * panel drew something the source does not say.
 */
export function readAttributionSeries(
  raw: Record<string, unknown>,
  provenance: string,
): AttributionSeries {
  const months: AttributionMonth[] = Object.keys(raw)
    .sort()
    .map((period) => {
      if (!PERIOD.test(period)) throw new Error(`not a period in the attribution series: ${period}`);
      const cuts = raw[period];
      if (typeof cuts !== 'number' || !Number.isInteger(cuts) || cuts < 0) {
        throw new Error(`not a whole count of cuts for ${period}: ${String(cuts)}`);
      }
      return { period, cuts };
    });

  const first = months[0];
  const latest = months.at(-1);
  if (first === undefined || latest === undefined) {
    throw new Error('the attribution series is empty');
  }
  for (let i = 1; i < months.length; i += 1) {
    const expected = nextPeriod(months[i - 1]!.period);
    if (months[i]!.period !== expected) {
      throw new Error(`the attribution series skips ${expected}`);
    }
  }

  const peak = months.reduce((best, month) => (month.cuts > best.cuts ? month : best), first);
  const cumulative = months.reduce((total, month) => total + month.cuts, 0);
  return { months, cumulative, latest, first, peak, provenance };
}

let cached: AttributionSeries | null = null;

/** The committed series. Read once: the file cannot change under a process. */
export function loadAttributionSeries(root: string = attributionRoot()): AttributionSeries {
  if (cached !== null) return cached;
  const raw = JSON.parse(
    readFileSync(join(root, 'challenger-ai-cuts-monthly.json'), 'utf8'),
  ) as Record<string, unknown>;
  const provenance = readFileSync(join(root, 'PROVENANCE.txt'), 'utf8');
  cached = readAttributionSeries(raw, provenance);
  return cached;
}
