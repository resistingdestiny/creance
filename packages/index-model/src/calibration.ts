import { computeSeries, ratesOf, smooth, type SeriesInput } from './core.js';
import { addMonths, monthOf, periodRange, type Period } from './period.js';
import {
  mean as meanOf,
  nearestHalf,
  orderStatistic,
  populationStdDev,
  pub,
  sampleStdDev,
} from './rounding.js';

/**
 * Calibration turns the archive into the two numbers a series is issued with:
 * A, the shock attachment, and L, the level line. Both are set at issuance,
 * published in the series terms and in every message, and frozen. The baseline
 * never rolls: a rolling baseline would quietly normalise displacement, so a
 * decade that keeps getting worse would keep looking normal.
 */

/** The fixed baseline decade the level line is drawn from. */
export const BASELINE_FROM: Period = '2010-01';
export const BASELINE_TO: Period = '2019-12';
/** The dislocation excluded from the shock calibration, inclusive at both ends. */
export const SIGMA_EXCLUDE_FROM: Period = '2020-01';
export const SIGMA_EXCLUDE_TO: Period = '2021-12';
export const SIGMA_FROM: Period = '2010-01';
/** The published backtest window starts here. */
export const BACKTEST_FROM: Period = '2010-01';
/** The floor under every shock attachment. */
export const ATTACHMENT_FLOOR = 1.5;
/** The margin added to the baseline p95 to draw the level line. */
export const LEVEL_MARGIN = 0.75;

export interface BaselineStats {
  n: number;
  min: number;
  max: number;
  mean: number;
  popSd: number;
  /** The upper of the two middle values. Descriptive only. */
  p50: number;
  /** The ordinary median, printed so the two are visibly different. */
  median: number;
  p95: number;
  levelLine: number;
}

export interface ShockStats {
  n: number;
  mean: number;
  popSd: number;
  sampleSd: number;
  threeSigma: number;
  attachmentShock: number;
}

export interface SeriesCalibration {
  groupKey: string;
  seriesId: string;
  attachmentShock: number;
  levelLine: number;
  /** Twelve level lines, January first, from each calendar month's own decade. */
  levelLineByMonth: number[];
  baseline: BaselineStats;
  shock: ShockStats;
}

/** The upper of the two middle values, which is not the ordinary median. */
export function medianHigh(values: readonly number[]): number {
  if (values.length === 0) throw new Error('no values');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

export function ordinaryMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** L from a set of published smoothed values: the lower p95 plus 0.75. */
export function levelLineFrom(ebarPub: readonly number[]): number {
  return pub(orderStatistic(ebarPub, 0.95) + LEVEL_MARGIN);
}

/** A from a set of published ODI values: three population sigma, floored at 1.5. */
export function attachmentFrom(odiPub: readonly number[]): number {
  return Math.max(ATTACHMENT_FLOOR, nearestHalf(3 * populationStdDev(odiPub)));
}

export interface CalibrationWindows {
  baselineFrom: Period;
  baselineTo: Period;
  sigmaFrom: Period;
  sigmaTo: Period;
  sigmaExcludeFrom: Period;
  sigmaExcludeTo: Period;
}

export function defaultWindows(sigmaTo: Period): CalibrationWindows {
  return {
    baselineFrom: BASELINE_FROM,
    baselineTo: BASELINE_TO,
    sigmaFrom: SIGMA_FROM,
    sigmaTo,
    sigmaExcludeFrom: SIGMA_EXCLUDE_FROM,
    sigmaExcludeTo: SIGMA_EXCLUDE_TO,
  };
}

export interface RateSeries {
  groupKey: string;
  seriesId: string;
  groupRates: ReadonlyMap<Period, number>;
  aggregateRates: ReadonlyMap<Period, number>;
}

/**
 * The published smoothed values and published ODI values a calibration needs.
 * These are computed with no parameters at all, so calibration does not depend
 * on the numbers it is about to produce.
 */
export function publishedSeries(series: RateSeries, from: Period, to: Period): {
  ebar: Map<Period, number>;
  odi: Map<Period, number>;
  odiFromRaw: Map<Period, number>;
} {
  // Walk from fourteen months before the window so the first period in it can
  // still carry an ebar and an ODI.
  const rawExcess = new Map<Period, number>();
  for (const period of periodRange(addMonths(from, -14), to)) {
    const uG = series.groupRates.get(period);
    const uAll = series.aggregateRates.get(period);
    if (uG !== undefined && uAll !== undefined) rawExcess.set(period, uG - uAll);
  }
  const ebarRaw = new Map<Period, number>();
  const ebar = new Map<Period, number>();
  for (const period of rawExcess.keys()) {
    const value = smooth(rawExcess, period);
    if (value !== null) {
      ebarRaw.set(period, value);
      ebar.set(period, pub(value));
    }
  }
  // Two paths, kept side by side. The published ODI is the difference of the two
  // published smoothed values; the raw path differences the unrounded ones and
  // disagrees by a cent on about a fifth of the history. The raw path is
  // computed only so a test can hold the two apart.
  const odi = new Map<Period, number>();
  const odiFromRaw = new Map<Period, number>();
  for (const [period, value] of ebar) {
    const basePeriod = addMonths(period, -12);
    const base = ebar.get(basePeriod);
    if (base !== undefined) odi.set(period, pub(value - base));
    const rawAt = ebarRaw.get(period);
    const rawBase = ebarRaw.get(basePeriod);
    if (rawAt !== undefined && rawBase !== undefined) {
      odiFromRaw.set(period, pub(rawAt - rawBase));
    }
  }
  return { ebar, odi, odiFromRaw };
}

export function calibrateSeries(
  series: RateSeries,
  windows: CalibrationWindows,
): SeriesCalibration {
  const { ebar, odi } = publishedSeries(series, windows.baselineFrom, windows.sigmaTo);

  const baselinePeriods = periodRange(windows.baselineFrom, windows.baselineTo);
  const baselineValues: number[] = [];
  for (const period of baselinePeriods) {
    const value = ebar.get(period);
    if (value !== undefined) baselineValues.push(value);
  }
  if (baselineValues.length === 0) {
    throw new Error(`${series.groupKey}: no baseline values`);
  }

  const sigmaValues: number[] = [];
  for (const period of periodRange(windows.sigmaFrom, windows.sigmaTo)) {
    if (period >= windows.sigmaExcludeFrom && period <= windows.sigmaExcludeTo) continue;
    const value = odi.get(period);
    if (value !== undefined) sigmaValues.push(value);
  }
  if (sigmaValues.length === 0) {
    throw new Error(`${series.groupKey}: no ODI values in the sigma window`);
  }

  const popSd = populationStdDev(sigmaValues);
  const p95 = orderStatistic(baselineValues, 0.95);

  const levelLineByMonth: number[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const forMonth = baselinePeriods
      .filter((period) => monthOf(period) === month)
      .map((period) => ebar.get(period))
      .filter((value): value is number => value !== undefined);
    levelLineByMonth.push(levelLineFrom(forMonth));
  }

  return {
    groupKey: series.groupKey,
    seriesId: series.seriesId,
    attachmentShock: Math.max(ATTACHMENT_FLOOR, nearestHalf(3 * popSd)),
    levelLine: pub(p95 + LEVEL_MARGIN),
    levelLineByMonth,
    baseline: {
      n: baselineValues.length,
      min: Math.min(...baselineValues),
      max: Math.max(...baselineValues),
      mean: meanOf(baselineValues),
      popSd: populationStdDev(baselineValues),
      p50: medianHigh(baselineValues),
      median: ordinaryMedian(baselineValues),
      p95,
      levelLine: pub(p95 + LEVEL_MARGIN),
    },
    shock: {
      n: sigmaValues.length,
      mean: meanOf(sigmaValues),
      popSd,
      sampleSd: sampleStdDev(sigmaValues),
      threeSigma: 3 * popSd,
      attachmentShock: Math.max(ATTACHMENT_FLOOR, nearestHalf(3 * popSd)),
    },
  };
}

/** Convenience for callers that already hold a SeriesInput. */
export function rateSeriesOf(input: SeriesInput): RateSeries {
  return {
    groupKey: input.groupKey,
    seriesId: input.seriesId,
    groupRates: input.groupRates,
    aggregateRates: input.aggregateRates,
  };
}

export { computeSeries, ratesOf };
