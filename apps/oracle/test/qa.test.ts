import {
  addMonths,
  datasetFrom,
  evaluateDataset,
  frozenParameters,
  loadDataset,
  loadSeriesMap,
  seriesIdFor,
  type Dataset,
  type Observation,
  type Period,
  type SourceObservation,
} from '@creance/index-model';
import { describe, expect, it } from 'vitest';

import { FROZEN_SERIES_MAP_SHA256, runQaGates, seriesMapHash } from '../src/qa.js';

/// The committed archive is the fixture. Each test corrupts one thing in a copy
/// of it and asserts the gate that owns that fact fails, which is what "fail
/// closed" has to mean in practice: a run over corrupted data never reaches
/// publish.

const CLEAN = loadDataset();
const MAP = loadSeriesMap();

/** Rebuild a dataset with one series' rows replaced. */
function withRows(base: Dataset, seriesId: string, rows: SourceObservation[]): Dataset {
  const series = new Map(base.allSeries);
  series.set(seriesId, rows);
  return datasetFrom(series, base.source, base.archive, base.map);
}

function rowsOf(base: Dataset, seriesId: string): SourceObservation[] {
  return [...(base.allSeries.get(seriesId) ?? [])];
}

/** Every observation over the window the jump gate needs, plus the target. */
function observe(dataset: Dataset, period: Period): Map<string, Observation[]> {
  return evaluateDataset(dataset, frozenParameters(), addMonths(period, -25), period);
}

const TARGET: Period = '2026-07';
const COMPUTER = seriesIdFor('computer_math', MAP);
const AGGREGATE = seriesIdFor('aggregate', MAP);

describe('the QA gates', () => {
  it('passes every gate on the committed archive', () => {
    const report = runQaGates({
      dataset: CLEAN,
      observations: observe(CLEAN, TARGET),
      period: TARGET,
    });
    expect(report.failures.map((gate) => gate.gate)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.gates).toHaveLength(6);
  });

  it('fails bounds on a rate of 55', () => {
    const rows = rowsOf(CLEAN, COMPUTER).map((row) =>
      row.period === TARGET ? { ...row, value: 55, raw: '55.0' } : row,
    );
    const report = runQaGates({
      dataset: withRows(CLEAN, COMPUTER, rows),
      observations: observe(withRows(CLEAN, COMPUTER, rows), TARGET),
      period: TARGET,
    });
    expect(report.passed).toBe(false);
    expect(report.failures.map((gate) => gate.gate)).toContain('bounds');
    expect(report.failures[0]?.detail).toMatch(/u=55/);
  });

  it('fails completeness when a group has no row for the period', () => {
    const rows = rowsOf(CLEAN, COMPUTER).filter((row) => row.period !== TARGET);
    const dataset = withRows(CLEAN, COMPUTER, rows);
    const report = runQaGates({ dataset, observations: observe(dataset, TARGET), period: TARGET });
    expect(report.passed).toBe(false);
    expect(report.failures.map((gate) => gate.gate)).toContain('completeness');
    expect(report.failures[0]?.detail).toMatch(/computer_math/);
  });

  it('fails consistency when u_all sits outside every group rate', () => {
    const rows = rowsOf(CLEAN, AGGREGATE).map((row) =>
      row.period === TARGET ? { ...row, value: 0.1, raw: '0.1' } : row,
    );
    const dataset = withRows(CLEAN, AGGREGATE, rows);
    const report = runQaGates({ dataset, observations: observe(dataset, TARGET), period: TARGET });
    expect(report.passed).toBe(false);
    expect(report.failures.map((gate) => gate.gate)).toContain('consistency');
  });

  it('fails mapping when a series id moves under a group', () => {
    const map = {
      ...MAP,
      series: MAP.series.map((entry) =>
        entry.group_key === 'legal' ? { ...entry, bls_series_id: 'LNU00000000' } : entry,
      ),
    };
    const report = runQaGates({
      dataset: CLEAN,
      observations: observe(CLEAN, TARGET),
      period: TARGET,
      map,
    });
    expect(report.passed).toBe(false);
    const mapping = report.failures.find((gate) => gate.gate === 'mapping');
    expect(mapping?.detail).toMatch(/legal is mapped to LNU00000000/);
  });

  it('fails provenance when a source file has no hash', () => {
    const dataset: Dataset = {
      ...CLEAN,
      source: { ...CLEAN.source, files: [{ label: 'made up', url: '', sha256: '', bytes: 0 }] },
    };
    const report = runQaGates({ dataset, observations: observe(CLEAN, TARGET), period: TARGET });
    expect(report.passed).toBe(false);
    expect(report.failures.map((gate) => gate.gate)).toContain('provenance');
  });

  it('fails jump on a smoothed move past five standard deviations', () => {
    const observations = observe(CLEAN, TARGET);
    const rows = [...(observations.get('computer_math') ?? [])];
    const index = rows.findIndex((row) => row.period === TARGET);
    rows[index] = { ...(rows[index] as Observation), ebar: 9 };
    observations.set('computer_math', rows);
    const report = runQaGates({ dataset: CLEAN, observations, period: TARGET });
    expect(report.passed).toBe(false);
    expect(report.failures.map((gate) => gate.gate)).toEqual(['jump']);
  });

  it('lets the October 2025 gap through as a gap, not as a failure', () => {
    const gap: Period = '2025-10';
    const report = runQaGates({
      dataset: CLEAN,
      observations: observe(CLEAN, gap),
      period: gap,
    });
    expect(report.passed).toBe(true);
    const consistency = report.gates.find((gate) => gate.gate === 'consistency');
    expect(consistency?.detail).toMatch(/no collected rates/);
    const computed = observe(CLEAN, gap).get('computer_math')?.find((row) => row.period === gap);
    expect(computed?.status).toBe('no_source');
  });

  it('pins the frozen mapping hash', () => {
    expect(seriesMapHash(MAP)).toBe(FROZEN_SERIES_MAP_SHA256);
  });
});
