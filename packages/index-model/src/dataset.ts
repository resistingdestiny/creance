import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { latestPeriod, loadArchive, type Archive } from './archive.js';
import {
  calibrateSeries,
  defaultWindows,
  type CalibrationWindows,
  type RateSeries,
  type SeriesCalibration,
} from './calibration.js';
import {
  computeSeries,
  ratesOf,
  DEFAULT_TRIGGER_OPTIONS,
  type Observation,
  type TriggerOptions,
} from './core.js';
import { archiveRoot } from './paths.js';
import type { Period } from './period.js';
import {
  aggregateSeriesId,
  bindableGroups,
  loadSeriesMap,
  type SeriesMap,
} from './series.js';

/**
 * One object that ties the verified archive, the frozen mapping and the frozen
 * calibration together. Everything above this layer, the backtest, the backfill
 * and the pricing, reads a Dataset and nothing else.
 */

export interface FrozenCalibrationEntry {
  group_key: string;
  bls_series_id: string;
  attachment_shock: number;
  level_line: number;
  level_line_by_month: number[];
  baseline_p50: number;
  baseline_p95: number;
  three_sigma: number;
}

export interface FrozenCalibration {
  model_version: string;
  frozen_on: string;
  windows: {
    baseline: string;
    sigma: string;
    sigma_excludes: string;
  };
  level_line_mode: 'single' | 'month_matched';
  base_effect_guard: boolean;
  catalogue_sha256: string;
  series: FrozenCalibrationEntry[];
}

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadCalibration(): FrozenCalibration {
  return JSON.parse(readFileSync(join(HERE, 'calibration.json'), 'utf8')) as FrozenCalibration;
}

export interface Dataset {
  archive: Archive;
  map: SeriesMap;
  latest: Period;
  rateSeries: RateSeries[];
  aggregateRates: ReadonlyMap<Period, number>;
}

/** Load the archive and build the rate lookups for every bindable group. */
export function loadDataset(root: string = archiveRoot()): Dataset {
  const archive = loadArchive(root);
  const map = loadSeriesMap();
  const aggregateId = aggregateSeriesId(map);
  const aggregateRows = archive.series.get(aggregateId);
  if (!aggregateRows) throw new Error(`the archive has no ${aggregateId}`);
  const aggregateRates = ratesOf(aggregateRows);

  const rateSeries = bindableGroups(map).map((entry) => {
    const rows = archive.series.get(entry.bls_series_id);
    if (!rows) throw new Error(`the archive has no ${entry.bls_series_id}`);
    return {
      groupKey: entry.group_key,
      seriesId: entry.bls_series_id,
      groupRates: ratesOf(rows),
      aggregateRates,
    };
  });

  return { archive, map, latest: latestPeriod(archive.series), rateSeries, aggregateRates };
}

/** Build a rate lookup for any series in the archive, bindable or not. */
export function rateSeriesFor(
  dataset: Dataset,
  seriesId: string,
  groupKey = seriesId,
): RateSeries {
  const rows = dataset.archive.series.get(seriesId);
  if (!rows) throw new Error(`the archive has no ${seriesId}`);
  return {
    groupKey,
    seriesId,
    groupRates: ratesOf(rows),
    aggregateRates: dataset.aggregateRates,
  };
}

export function calibrateDataset(
  dataset: Dataset,
  windows: CalibrationWindows = defaultWindows(dataset.latest),
): SeriesCalibration[] {
  return dataset.rateSeries.map((series) => calibrateSeries(series, windows));
}

export interface EvaluationOptions extends TriggerOptions {
  /** Override the frozen attachment for every series, for the generic table. */
  attachmentOverride?: number;
  /** Drop the level form, which is what a shock-only table means. */
  shockOnly?: boolean;
}

/**
 * Evaluate every bindable group over a window under one set of parameters.
 * Returns observations keyed by group in mapping order.
 */
export function evaluateDataset(
  dataset: Dataset,
  parameters: ReadonlyMap<string, { attachmentShock: number; levelLine: number; levelLineByMonth?: readonly number[] }>,
  from: Period,
  to: Period,
  options: EvaluationOptions = DEFAULT_TRIGGER_OPTIONS,
): Map<string, Observation[]> {
  const out = new Map<string, Observation[]>();
  for (const series of dataset.rateSeries) {
    const frozen = parameters.get(series.groupKey);
    if (!frozen) throw new Error(`no parameters for ${series.groupKey}`);
    const resolved = {
      attachmentShock: options.attachmentOverride ?? frozen.attachmentShock,
      // A level line above every possible ebar switches the level form off
      // without adding a second code path to the core.
      levelLine: options.shockOnly ? Number.POSITIVE_INFINITY : frozen.levelLine,
      ...(frozen.levelLineByMonth && !options.shockOnly
        ? { levelLineByMonth: frozen.levelLineByMonth }
        : {}),
    };
    out.set(
      series.groupKey,
      computeSeries({ ...series, parameters: resolved }, from, to, {
        levelLineMode: options.shockOnly ? 'single' : options.levelLineMode,
        baseEffectGuard: options.baseEffectGuard,
      }),
    );
  }
  return out;
}

/** The frozen parameters as the map evaluateDataset wants. */
export function frozenParameters(
  calibration: FrozenCalibration = loadCalibration(),
): Map<string, { attachmentShock: number; levelLine: number; levelLineByMonth: number[] }> {
  const map = new Map<
    string,
    { attachmentShock: number; levelLine: number; levelLineByMonth: number[] }
  >();
  for (const entry of calibration.series) {
    map.set(entry.group_key, {
      attachmentShock: entry.attachment_shock,
      levelLine: entry.level_line,
      levelLineByMonth: entry.level_line_by_month,
    });
  }
  return map;
}
