import {
  addMonths,
  evaluateDataset,
  extractRows,
  frozenParameters,
  loadCalibration,
  loadDataset,
  seriesIdFor,
  sourceHash,
  type Dataset,
  type Observation,
  type Period,
} from '@creance/index-model';

import type { ObservationRow } from './db/types.js';

/// Where GET /v1/index/:group gets its numbers.
///
/// The index oracle is T12 and does not exist yet, so nothing has been
/// published to the index topic and the observations table starts empty. The
/// numbers themselves do exist: they are a pure function of the archive
/// committed under data/bls and the frozen calibration, both of which
/// packages/index-model already reads. So the API computes the whole history
/// once at boot, writes it into `observations`, and serves from the table. When
/// T12 arrives it becomes the writer and this path becomes the fallback for a
/// clone that has never run the oracle.
///
/// Two consequences are deliberate and are recorded in docs/DECISIONS.md:
/// the rows this writes carry no HCS sequence number and no on-chain submission
/// id, because nothing was published; and they are `final`, because the archive
/// is the first publication of those months.

/** The archive ends in July 2026. Anything later is live-only, see T02. */
export interface IndexData {
  dataset: Dataset;
  modelVersion: string;
  /** Every bindable group, newest observation last. */
  byGroup: Map<string, Observation[]>;
}

const FROM: Period = '2000-03';

export interface Thresholds {
  attachmentShock: number;
  levelLine: number;
}

/**
 * The frozen trigger parameters, by group.
 *
 * They are not columns on `observations`: the schema keeps the value and the
 * openness, and A and L are frozen at issuance in the published calibration and
 * on chain in `SeriesTerms`. Reading them from the calibration keeps one source
 * for every group, including the fourteen with no series behind them yet.
 */
export function frozenThresholds(): Map<string, Thresholds> {
  const map = new Map<string, Thresholds>();
  for (const [groupKey, parameters] of frozenParameters()) {
    map.set(groupKey, {
      attachmentShock: parameters.attachmentShock,
      levelLine: parameters.levelLine,
    });
  }
  return map;
}

/** Load the archive and evaluate every bindable group at its frozen parameters. */
export function loadIndexData(): IndexData {
  const dataset = loadDataset();
  const calibration = loadCalibration();
  const byGroup = evaluateDataset(dataset, frozenParameters(calibration), FROM, dataset.latest);
  return { dataset, modelVersion: calibration.model_version, byGroup };
}

/** `2026-04` becomes `202604`, the uint32 the contracts and the schema take. */
export function periodToInteger(period: Period): number {
  return Number(period.slice(0, 4)) * 100 + Number(period.slice(5, 7));
}

/** The inverse. */
export function periodFromInteger(period: number): Period {
  const month = period % 100;
  return `${(period - month) / 100}-${String(month).padStart(2, '0')}` as Period;
}

/**
 * The six source months an observation is computed from: t, t-1 and t-2 for the
 * smoothed excess and the same three a year earlier for the base it is
 * differenced against. Hashing exactly those, for the group's series and the
 * all-occupation series, is what lets a reader recompute the number from the
 * cited rows rather than from the whole archive.
 */
export function sourcePeriods(period: Period): Period[] {
  return [0, -1, -2, -12, -13, -14].map((offset) => addMonths(period, offset));
}

export function observationSourceHash(
  data: IndexData,
  groupKey: string,
  period: Period,
): string {
  const blsSeries = seriesIdFor(groupKey, data.dataset.map);
  const aggregate = seriesIdFor('aggregate', data.dataset.map);
  const rows = extractRows(data.dataset, [blsSeries, aggregate], sourcePeriods(period));
  return `sha256:${sourceHash(rows)}`;
}

/** The rows the archive implies for one group, in the schema's shape. */
export function observationRows(
  data: IndexData,
  groupKey: string,
  computedAt: string = new Date().toISOString(),
): ObservationRow[] {
  const observations = data.byGroup.get(groupKey);
  if (observations === undefined) return [];
  const blsSeries = seriesIdFor(groupKey, data.dataset.map);
  return observations
    // A month with no source value, or one without the three months the
    // smoothing needs, is not an observation. Writing it would put a row in the
    // published index that says nothing.
    .filter((observation) => observation.status === 'final')
    .map((observation) => ({
      groupKey,
      seriesId: null,
      period: periodToInteger(observation.period),
      uG: observation.uG,
      uAll: observation.uAll,
      e: observation.e,
      ebar: observation.ebar,
      odi: observation.odi,
      open: observation.open,
      openReason: observation.openReason === 'none' ? null : observation.openReason,
      status: 'final' as const,
      modelVersion: data.modelVersion,
      source: `bls:${blsSeries}`,
      sourceHash: observationSourceHash(data, groupKey, observation.period),
      computedAt,
      hcsTopic: null,
      hcsSeq: null,
      submitTx: null,
      replay: false,
    }));
}

/** Every bindable group's rows, for the one-shot load at boot. */
export function allObservationRows(
  data: IndexData,
  computedAt: string = new Date().toISOString(),
): ObservationRow[] {
  return [...data.byGroup.keys()].flatMap((groupKey) =>
    observationRows(data, groupKey, computedAt),
  );
}
