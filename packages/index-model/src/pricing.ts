import { calibrateDataset, evaluateDataset, type Dataset } from './dataset.js';
import { defaultWindows } from './calibration.js';
import { addMonths, periodRange, type Period } from './period.js';
import type { Observation, TriggerOptions } from './core.js';
import { DEFAULT_TRIGGER_OPTIONS } from './core.js';
import { rateSeriesFor } from './dataset.js';
import { aggregateSeriesId } from './series.js';

/**
 * Pricing. The formula in DESIGN section 3.4 prices from the backtest frequency
 * of open months, which puts thirteen of the fifteen offered occupations exactly
 * on the floor: the shock attachment is calibrated per series at three sigma of
 * that series' own index, so by construction a shock is about as rare for every
 * occupation, and the index cannot differentiate through the shock form at all.
 * It can only differentiate through how close an occupation sits to its level
 * line today, so the guide price is conditioned on that distance.
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
  const occupationIds = [...dataset.archive.series.keys()]
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

/** The fitted hazard, so the price has no cliff at a bucket edge. */
export const HAZARD_FIT = { floor: 0.047, amplitude: 0.613, scale: 0.22 } as const;

export function fittedHazard(distance: number): number {
  return HAZARD_FIT.floor + HAZARD_FIT.amplitude * Math.exp(-distance / HAZARD_FIT.scale);
}

/**
 * The published pricing assumptions, all of them arguable and all of them
 * stated. P(separation given claims open) is the JOLTS layoffs and discharges
 * base with the three times open-month uplift over a six month loss window; the
 * expected share of limit is partial at attachment and full at twice it; the
 * load is 30 percent; the floor is a judgment, not a measurement.
 */
export const PRICING = {
  separationGivenOpen: 0.167,
  expectedShareOfLimit: 0.6,
  load: 1.3,
  floorRate: 0.005,
  /** The slope of the market term, and the multiple it is capped at. */
  utilisationLambda: 1.0,
  marketCapMultiple: 3,
} as const;

/** The annual guide rate for a group sitting `distance` points from its line. */
export function guideRate(distance: number): number {
  const expectedLoss =
    fittedHazard(distance) * PRICING.separationGivenOpen * PRICING.expectedShareOfLimit;
  return Math.max(PRICING.floorRate, expectedLoss * PRICING.load);
}

/**
 * The price charged. The guide price is what the risk is worth; capital that has
 * chosen this occupation says what it will take it for.
 */
export function marketRate(guide: number, utilisation: number): number {
  if (utilisation < 0) throw new Error('utilisation cannot be negative');
  return Math.min(
    guide * (1 + PRICING.utilisationLambda * utilisation),
    guide * PRICING.marketCapMultiple,
  );
}

/** Monthly premium for a limit, at an annual rate. */
export function monthlyPremium(rate: number, limit: number): number {
  return (rate * limit) / 12;
}

export type HeadlineForm = 'level' | 'shock';

export interface Headline {
  form: HeadlineForm;
  /** Points still to travel before the form opens. Negative when already past. */
  distance: number;
  /** Under 0.05 points reads as sitting on the line rather than 0.0 away. */
  onTheLine: boolean;
  open: boolean;
}

/**
 * Which form is nearer its line, chosen here so that two screens cannot choose
 * differently. The index has two forms and two thresholds and one number cannot
 * say which is nearer to opening.
 */
export function headline(observation: Observation): Headline | null {
  const candidates: { form: HeadlineForm; distance: number }[] = [];
  if (observation.ebar !== null) {
    candidates.push({ form: 'level', distance: observation.levelLine - observation.ebar });
  }
  if (observation.odi !== null) {
    candidates.push({ form: 'shock', distance: observation.attachmentShock - observation.odi });
  }
  if (candidates.length === 0) return null;
  // Ties go to the level form, which is the one the demo series trades on and
  // the one a reader can check against a published smoothed value.
  const nearest = candidates.reduce((best, candidate) =>
    candidate.distance < best.distance ? candidate : best,
  );
  return {
    form: nearest.form,
    distance: nearest.distance,
    onTheLine: Math.abs(nearest.distance) < 0.05,
    open: observation.open,
  };
}
