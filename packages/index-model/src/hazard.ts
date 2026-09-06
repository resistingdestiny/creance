import { calibrateDataset, evaluateDataset, rateSeriesFor, type Dataset } from './dataset.js';
import { defaultWindows } from './calibration.js';
import { addMonths, periodRange, type Period } from './period.js';
import { DEFAULT_TRIGGER_OPTIONS, type TriggerOptions } from './core.js';
import { aggregateSeriesId } from './series.js';

/**
 * The empirical hazard behind the guide price: how often claims opened within a
 * year, given how far an occupation sat from its line at the time.
 *
 * It lives apart from ./pricing.js because it reads the whole archive and
 * pricing does not. Everything here needs the dataset, the calibration and the
 * period arithmetic; the three functions that turn a distance into a price need
 * nothing at all. Keeping them in separate modules is what lets the web app
 * import the price without pulling the archive, and node:fs with it, into a
 * browser bundle. See apps/web/src/lib/explorer-model.ts.
 */

/** Bucket edges in whole cents of distance to the level line. */
const BUCKET_EDGES_CENTS = [0, 25, 50, 100, 200, 400] as const;

export const HAZARD_BUCKET_LABELS = [
  'at or past the line',
  '0 to 0.25 points',
  '0.25 to 0.5 points',
  '0.5 to 1 point',
  '1 to 2 points',
  '2 to 4 points',
  'more than 4 points',
] as const;

export interface HazardBucket {
  label: string;
  /** Inclusive lower edge in points, null for the at-or-past bucket. */
  from: number | null;
  /** Exclusive upper edge in points, null for the open-ended bucket. */
  to: number | null;
  sample: number;
  opened: number;
  /** Share of the sample that saw claims open within the following 12 months. */
  rate: number;
}

export interface HazardTable {
  buckets: HazardBucket[];
  sample: number;
  from: Period;
  to: Period;
  seriesCount: number;
}

export interface HazardOptions {
  /** Last observation month, so the twelve-month lookahead stays inside the data. */
  to?: Period;
  from?: Period;
  excludeFrom?: Period;
  excludeTo?: Period;
  triggerOptions?: TriggerOptions;
}

/**
 * The empirical hazard: pool every occupation series in the archive at its own
 * calibrated parameters, take each month from 2010 excluding the 2020 to 2021
 * dislocation, and measure how often claims opened in the following twelve
 * months given the distance to the line at that moment.
 *
 * The pool is every occupation series rather than the fifteen bindable ones, so
 * that the thinly populated buckets near the line carry enough months to mean
 * anything. Distance is measured in whole cents to keep bucket membership off
 * the floating point boundary.
 */
export function hazardTable(dataset: Dataset, options: HazardOptions = {}): HazardTable {
  const from = options.from ?? '2010-01';
  // The lookahead needs twelve months beyond the last sampled month, and a
  // thirteenth so the last sample is a full window rather than a truncated one.
  const to = options.to ?? addMonths(dataset.latest, -13);
  const excludeFrom = options.excludeFrom ?? '2020-01';
  const excludeTo = options.excludeTo ?? '2021-12';
  const triggerOptions = options.triggerOptions ?? DEFAULT_TRIGGER_OPTIONS;
  const windows = defaultWindows(dataset.latest);

  const aggregateId = aggregateSeriesId(dataset.map);
  const occupationIds = [...dataset.allSeries.keys()]
    .filter((id) => id !== aggregateId)
    .sort();

  const buckets: HazardBucket[] = HAZARD_BUCKET_LABELS.map((label, index) => ({
    label,
    from: index === 0 ? null : (BUCKET_EDGES_CENTS[index - 1] as number) / 100,
    to: index === 0 ? 0 : index === 6 ? null : (BUCKET_EDGES_CENTS[index] as number) / 100,
    sample: 0,
    opened: 0,
    rate: 0,
  }));

  for (const seriesId of occupationIds) {
    const series = rateSeriesFor(dataset, seriesId, seriesId);
    const single = { ...dataset, rateSeries: [series] };
    const calibration = calibrateDataset(single, windows)[0];
    if (!calibration) continue;
    const rows = evaluateDataset(
      single,
      new Map([
        [
          seriesId,
          {
            attachmentShock: calibration.attachmentShock,
            levelLine: calibration.levelLine,
            levelLineByMonth: calibration.levelLineByMonth,
          },
        ],
      ]),
      '2000-03',
      dataset.latest,
      triggerOptions,
    ).get(seriesId);
    if (!rows) continue;
    const byPeriod = new Map(rows.map((row) => [row.period, row]));

    for (const period of periodRange(from, to)) {
      if (period >= excludeFrom && period <= excludeTo) continue;
      const row = byPeriod.get(period);
      if (!row || row.ebar === null) continue;
      const index = bucketIndex(distanceCents(row.levelLine, row.ebar));
      const bucket = buckets[index] as HazardBucket;
      bucket.sample += 1;
      for (let ahead = 1; ahead <= 12; ahead += 1) {
        if (byPeriod.get(addMonths(period, ahead))?.open) {
          bucket.opened += 1;
          break;
        }
      }
    }
  }

  for (const bucket of buckets) {
    bucket.rate = bucket.sample === 0 ? 0 : bucket.opened / bucket.sample;
  }
  return {
    buckets,
    sample: buckets.reduce((total, bucket) => total + bucket.sample, 0),
    from,
    to,
    seriesCount: occupationIds.length,
  };
}

function distanceCents(levelLine: number, ebar: number): number {
  return Math.round(levelLine * 100) - Math.round(ebar * 100);
}

function bucketIndex(cents: number): number {
  if (cents <= 0) return 0;
  for (let i = 0; i < BUCKET_EDGES_CENTS.length - 1; i += 1) {
    if (cents >= (BUCKET_EDGES_CENTS[i] as number) && cents < (BUCKET_EDGES_CENTS[i + 1] as number)) {
      return i + 1;
    }
  }
  return BUCKET_EDGES_CENTS.length;
}
