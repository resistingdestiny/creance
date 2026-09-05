import {
  AGGREGATE_KEY,
  addMonths,
  canonicalize,
  loadCalibration,
  loadSeriesMap,
  populationStdDev,
  sha256Hex,
  type Dataset,
  type FrozenCalibration,
  type JsonValue,
  type Observation,
  type Period,
  type SeriesMap,
} from '@creance/index-model';

/**
 * The QA gates of docs/INDEX-SPEC.md section 8, run after compute and before
 * publish. Any failure fails the run closed: nothing is published, nothing is
 * submitted, and a human looks before anything reaches the topic.
 *
 * The gates are pure. They take the computed observations and the dataset they
 * came from and return a report; deciding what a failure means is the
 * pipeline's job, which is what makes "corrupt a fixture and assert nothing
 * would be published" a unit test rather than an integration test.
 */

/** Every mapped series must have a row for the target period, all sixteen. */
export const REQUIRED_SERIES = 16;

/** Published rates outside this range are a source anomaly, not a signal. */
export const RATE_MIN = 0;
export const RATE_MAX = 30;

/** An ODI past ten points is larger than anything in the archive since 2000. */
export const ODI_BOUND = 10;

/** The jump gate's tolerance, in standard deviations of the trailing window. */
export const JUMP_SIGMAS = 5;
export const JUMP_WINDOW_MONTHS = 24;

/**
 * How many smoothed values the trailing window must actually carry.
 *
 * The specification says "the trailing 24 months" and the October 2025 lapse in
 * appropriations means no group has 24 smoothed values in the window for any
 * target month from 2025-10 to 2026-09. Demanding all 24 would switch the gate
 * off for fifteen consecutive months, including the two the demo settles on, so
 * the window stays 24 calendar months and the gate runs on whatever those
 * months collected, provided there are at least this many. Below that a
 * standard deviation is not a tighter test, it is a noisier one, and the gate
 * abstains and says so.
 */
export const JUMP_MIN_OBSERVATIONS = 12;

/**
 * The frozen mapping's hash: sha256 of the JCS form of series-map.json.
 *
 * The canonical form rather than the file bytes, so that reformatting the file
 * is not a settlement event while changing a series id is. Changing this
 * constant means the trigger universe moved, which docs/INDEX-SPEC.md section 3
 * forbids once anything has settled, so a change needs a decision entry.
 */
export const FROZEN_SERIES_MAP_SHA256 =
  '03d1d38830ddecca58b3ca3c1c17e59c859bb3699efb4336e153f59a17c06543';

export type GateName =
  | 'completeness'
  | 'bounds'
  | 'jump'
  | 'consistency'
  | 'mapping'
  | 'provenance';

export interface GateResult {
  gate: GateName;
  passed: boolean;
  /** One line a human can act on. Names the series and the number. */
  detail: string;
}

export interface QaReport {
  period: Period;
  passed: boolean;
  gates: GateResult[];
  /** The failures alone, for an alert body. */
  failures: GateResult[];
}

export interface QaInput {
  dataset: Dataset;
  /** Group key to its observations, ascending, covering the jump window. */
  observations: ReadonlyMap<string, readonly Observation[]>;
  period: Period;
  calibration?: FrozenCalibration;
  map?: SeriesMap;
}

/** The canonical hash of a mapping, the value the mapping gate compares. */
export function seriesMapHash(map: SeriesMap = loadSeriesMap()): string {
  return sha256Hex(canonicalize(map as unknown as JsonValue));
}

function at(
  observations: ReadonlyMap<string, readonly Observation[]>,
  groupKey: string,
  period: Period,
): Observation | undefined {
  return observations.get(groupKey)?.find((row) => row.period === period);
}

function completeness(input: QaInput, map: SeriesMap): GateResult {
  const missing: string[] = [];
  for (const entry of map.series) {
    const rows = input.dataset.allSeries.get(entry.bls_series_id);
    if (rows === undefined || !rows.some((row) => row.period === input.period)) {
      missing.push(`${entry.group_key} (${entry.bls_series_id})`);
    }
  }
  for (const entry of map.series) {
    if (entry.group_key === AGGREGATE_KEY) continue;
    if (at(input.observations, entry.group_key, input.period) === undefined) {
      missing.push(`${entry.group_key} was not computed`);
    }
  }
  return {
    gate: 'completeness',
    passed: missing.length === 0,
    detail:
      missing.length === 0
        ? `all ${REQUIRED_SERIES} series present for ${input.period}`
        : `missing for ${input.period}: ${missing.join(', ')}`,
  };
}

function bounds(input: QaInput, map: SeriesMap): GateResult {
  const bad: string[] = [];
  for (const entry of map.series) {
    const row = input.dataset.allSeries
      .get(entry.bls_series_id)
      ?.find((candidate) => candidate.period === input.period);
    const value = row?.value;
    // A month the source never collected has no value at all. That is the
    // October 2025 lapse in appropriations, and it is a gap, not a bound
    // failure; the status on the message says so.
    if (value === undefined || value === null) continue;
    if (value < RATE_MIN || value > RATE_MAX) {
      bad.push(`${entry.group_key} u=${value}`);
    }
  }
  for (const [groupKey, rows] of input.observations) {
    const row = rows.find((candidate) => candidate.period === input.period);
    if (row?.odi != null && Math.abs(row.odi) > ODI_BOUND) {
      bad.push(`${groupKey} odi=${row.odi}`);
    }
  }
  return {
    gate: 'bounds',
    passed: bad.length === 0,
    detail:
      bad.length === 0
        ? `every rate in [${RATE_MIN}, ${RATE_MAX}] and every ODI within ${ODI_BOUND}`
        : `out of bounds: ${bad.join(', ')}`,
  };
}

function jump(input: QaInput): GateResult {
  const bad: string[] = [];
  const abstained: string[] = [];
  let checked = 0;
  for (const [groupKey, rows] of input.observations) {
    const now = rows.find((row) => row.period === input.period)?.ebar;
    const previousPeriod = addMonths(input.period, -1);
    const before = rows.find((row) => row.period === previousPeriod)?.ebar;
    if (now == null || before == null) continue;

    const trailing: number[] = [];
    for (let back = 1; back <= JUMP_WINDOW_MONTHS; back += 1) {
      const value = rows.find((row) => row.period === addMonths(input.period, -back))?.ebar;
      if (value != null) trailing.push(value);
    }
    if (trailing.length < JUMP_MIN_OBSERVATIONS) {
      abstained.push(`${groupKey} has ${trailing.length} smoothed months`);
      continue;
    }
    const sigma = populationStdDev(trailing);
    if (sigma === 0) continue;
    checked += 1;
    const move = Math.abs(now - before);
    if (move > JUMP_SIGMAS * sigma) {
      bad.push(`${groupKey} moved ${move.toFixed(2)} against ${(JUMP_SIGMAS * sigma).toFixed(2)}`);
    }
  }
  return {
    gate: 'jump',
    passed: bad.length === 0,
    detail:
      bad.length === 0
        ? `${checked} groups within ${JUMP_SIGMAS} sd of the trailing ${JUMP_WINDOW_MONTHS} months` +
          (abstained.length === 0 ? '' : `; abstained on ${abstained.join(', ')}`)
        : bad.join(', '),
  };
}

function consistency(input: QaInput, map: SeriesMap): GateResult {
  const rates: number[] = [];
  let aggregate: number | null = null;
  for (const entry of map.series) {
    const value =
      input.dataset.allSeries
        .get(entry.bls_series_id)
        ?.find((row) => row.period === input.period)?.value ?? null;
    if (value === null) continue;
    if (entry.group_key === AGGREGATE_KEY) aggregate = value;
    else rates.push(value);
  }
  if (aggregate === null || rates.length === 0) {
    return {
      gate: 'consistency',
      passed: true,
      detail: `${input.period} has no collected rates to compare`,
    };
  }
  const low = Math.min(...rates);
  const high = Math.max(...rates);
  const passed = aggregate >= low && aggregate <= high;
  return {
    gate: 'consistency',
    passed,
    detail: passed
      ? `u_all ${aggregate} lies in [${low}, ${high}]`
      : `u_all ${aggregate} is outside the group range [${low}, ${high}]`,
  };
}

function mapping(input: QaInput, map: SeriesMap, calibration: FrozenCalibration): GateResult {
  const problems: string[] = [];
  const hash = seriesMapHash(map);
  if (hash !== FROZEN_SERIES_MAP_SHA256) {
    problems.push(`series-map.json hashes to ${hash}, frozen at ${FROZEN_SERIES_MAP_SHA256}`);
  }
  if (map.catalogue.sha256 !== calibration.catalogue_sha256) {
    problems.push('the mapping and the calibration name different catalogue files');
  }
  for (const entry of calibration.series) {
    const mapped = map.series.find((row) => row.group_key === entry.group_key);
    if (mapped === undefined) {
      problems.push(`${entry.group_key} is calibrated and not mapped`);
    } else if (mapped.bls_series_id !== entry.bls_series_id) {
      problems.push(
        `${entry.group_key} is mapped to ${mapped.bls_series_id} and calibrated on ${entry.bls_series_id}`,
      );
    }
  }
  return {
    gate: 'mapping',
    passed: problems.length === 0,
    detail: problems.length === 0 ? `mapping matches the frozen hash` : problems.join('; '),
  };
}

function provenance(input: QaInput): GateResult {
  const files = input.dataset.source.files;
  const problems: string[] = [];
  if (files.length === 0) problems.push('the dataset records no source file');
  for (const file of files) {
    if (!/^[0-9a-f]{64}$/.test(file.sha256)) problems.push(`${file.label} has no sha256`);
    if (!Number.isInteger(file.bytes) || file.bytes <= 0) {
      problems.push(`${file.label} has no byte count`);
    }
  }
  return {
    gate: 'provenance',
    passed: problems.length === 0,
    detail:
      problems.length === 0
        ? `${files.length} source files, each with a sha256 and a byte count`
        : problems.join('; '),
  };
}

export function runQaGates(input: QaInput): QaReport {
  const map = input.map ?? input.dataset.map;
  const calibration = input.calibration ?? loadCalibration();
  const gates: GateResult[] = [
    completeness(input, map),
    bounds(input, map),
    jump(input),
    consistency(input, map),
    mapping(input, map, calibration),
    provenance(input),
  ];
  const failures = gates.filter((gate) => !gate.passed);
  return { period: input.period, passed: failures.length === 0, gates, failures };
}

/** The one line a run log prints per gate. */
export function formatReport(report: QaReport): string {
  return report.gates
    .map((gate) => `  ${gate.passed ? 'pass' : 'FAIL'}  ${gate.gate.padEnd(12)} ${gate.detail}`)
    .join('\n');
}
