export const workspaceName = '@creance/index-model';

export const summary = 'Pure ODI maths and backtests, no chain dependencies';

/** One line describing what this workspace is for. */
export function describeWorkspace(): string {
  return `${workspaceName}: ${summary}`;
}

/**
 * The public surface of the index model.
 *
 * Everything the rest of the system is allowed to depend on is named here, so
 * that a change to a file name or an internal helper does not reach the oracle,
 * the API or the web app. The re-exports are explicit rather than `export *`
 * because calibration re-exports two names from core, and an ambiguous star
 * export would drop them without saying so.
 */

// Calendar arithmetic. Periods are the string YYYY-MM everywhere.
export {
  addMonths,
  comparePeriods,
  isPeriod,
  monthOf,
  periodFromBls,
  periodFromIndex,
  periodIndex,
  periodRange,
  yearOf,
} from './period.js';
export type { Period } from './period.js';

// Publication rounding and the integer form the contracts take.
export { fmt2, mean, nearestHalf, orderStatistic, pub, populationStdDev, sampleStdDev, toScaledInt } from './rounding.js';

// The canonical form a message is signed and hashed over.
export { canonicalize } from './jcs.js';
export type { JsonValue } from './jcs.js';
export { sha256Hex, sourceHash } from './hash.js';
export type { SourceRow } from './hash.js';

// The frozen series mapping and the groups the picker offers.
export {
  AGGREGATE_KEY,
  GROUP_DEFINITIONS,
  aggregateSeriesId,
  bindableGroups,
  loadSeriesMap,
  resolveSeriesMap,
  seriesIdFor,
} from './series.js';
export type { GroupDefinition, SeriesMap, SeriesMapEntry } from './series.js';

// The catalogue the mapping was resolved against.
export {
  LFST_UNEMPLOYMENT_RATE,
  OCCUPATION_ALL,
  PERIODICITY_MONTHLY,
  SEASONAL_NOT_ADJUSTED,
  parseCatalogue,
  parseCatalogueText,
  resolveByTitle,
} from './catalogue.js';
export type { CatalogueEntry } from './catalogue.js';

// The trigger evaluation itself: excess, smoothed excess, ODI and both forms.
export { DEFAULT_TRIGGER_OPTIONS, computeSeries, excess, ratesOf, smooth } from './core.js';
export type {
  Observation,
  ObservationStatus,
  OpenReason,
  SeriesInput,
  TriggerForm,
  TriggerOptions,
  TriggerParameters,
} from './core.js';

// Deriving A and L from a history, and the windows the published table uses.
export {
  ATTACHMENT_FLOOR,
  BACKTEST_FROM,
  BASELINE_FROM,
  BASELINE_TO,
  LEVEL_MARGIN,
  SIGMA_EXCLUDE_FROM,
  SIGMA_EXCLUDE_TO,
  SIGMA_FROM,
  attachmentFrom,
  calibrateSeries,
  defaultWindows,
  levelLineFrom,
  medianHigh,
  ordinaryMedian,
  publishedSeries,
  rateSeriesOf,
} from './calibration.js';
export type {
  BaselineStats,
  CalibrationWindows,
  RateSeries,
  SeriesCalibration,
  ShockStats,
} from './calibration.js';

// A whole dataset: the frozen parameters, and the evaluation of every group.
export {
  calibrateDataset,
  datasetFrom,
  evaluateDataset,
  frozenParameters,
  loadCalibration,
  loadDataset,
  rateSeriesFor,
} from './dataset.js';
export type {
  Dataset,
  DatasetSource,
  EvaluationOptions,
  FrozenCalibration,
  FrozenCalibrationEntry,
  SourceFile,
  SourceKind,
} from './dataset.js';

// The committed archive under data/bls and its provenance.
export { latestPeriod, loadArchive, parseProvenance, verifyArchive } from './archive.js';
export type { Archive, Provenance, ProvenanceFile, VerifiedFile } from './archive.js';

// The live API path, and the shape its responses have to have.
export { API_LIMITS, BlsClient, ENDPOINTS, assertComplete, describeFailure } from './bls-client.js';
export type { ApiLimits, ApiVersion, ClientOptions, FetchResult, FetchedFile } from './bls-client.js';
export { mergeSeries, parseBlsResponse } from './bls-response.js';
export type { ParsedSeries, SourceObservation } from './bls-response.js';

// Choosing between the archive, the disk cache and the API.
export { currentPeriod, extractRows, fetchDataset, loadFromCache, resolveDataset } from './sources.js';
export type { SourceOptions } from './sources.js';

// Where the archive, the cache and the docs live.
export { archiveRoot, cacheRoot, docsRoot, hasArchive, repoRoot } from './paths.js';

// The guide price, the market price and the headline a screen shows.
export {
  HAZARD_FIT,
  PRICING,
  fittedHazard,
  guideRate,
  headline,
  marketRate,
  monthlyPremium,
} from './pricing.js';
export type { Headline, HeadlineForm } from './pricing.js';

// The empirical hazard the fit above was taken from.
export { HAZARD_BUCKET_LABELS, hazardTable } from './hazard.js';
export type { HazardBucket, HazardOptions, HazardTable } from './hazard.js';

// The published table in docs/INDEX.md.
export { GAP_CAPTION, lossWindows, renderIndexReport, reportMonthLabel } from './report.js';
export type { LossWindow, ReportInput } from './report.js';
