/**
 * Recomputes the calibration from the committed archive and writes
 * src/calibration.json. Run once at issuance; the test suite then asserts the
 * frozen file still equals what the archive gives.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultWindows } from '../src/calibration.js';
import { calibrateDataset, loadDataset, type FrozenCalibration } from '../src/dataset.js';

const dataset = loadDataset();
const windows = defaultWindows(dataset.latest);
const calibration = calibrateDataset(dataset, windows);

const frozen: FrozenCalibration = {
  model_version: 'odi-1.0.0',
  frozen_on: '2026-09-04',
  windows: {
    baseline: `${windows.baselineFrom}..${windows.baselineTo}`,
    sigma: `${windows.sigmaFrom}..${windows.sigmaTo}`,
    sigma_excludes: `${windows.sigmaExcludeFrom}..${windows.sigmaExcludeTo}`,
  },
  level_line_mode: 'single',
  base_effect_guard: false,
  catalogue_sha256: dataset.archive.catalogueSha256,
  series: calibration.map((series) => ({
    group_key: series.groupKey,
    bls_series_id: series.seriesId,
    attachment_shock: series.attachmentShock,
    level_line: series.levelLine,
    level_line_by_month: series.levelLineByMonth,
    baseline_p50: series.baseline.p50,
    baseline_p95: series.baseline.p95,
    three_sigma: Number(series.shock.threeSigma.toFixed(4)),
  })),
};

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'calibration.json');
writeFileSync(target, `${JSON.stringify(frozen, null, 2)}\n`);
console.log(`series                            A      L      p95     p50    3 sigma  n(base) n(sigma)`);
for (const series of calibration) {
  console.log(
    `${series.groupKey.padEnd(32)} ${String(series.attachmentShock).padStart(4)} ` +
      `${series.levelLine.toFixed(2).padStart(7)} ${series.baseline.p95.toFixed(2).padStart(7)} ` +
      `${series.baseline.p50.toFixed(2).padStart(7)} ${series.shock.threeSigma.toFixed(4).padStart(8)} ` +
      `${String(series.baseline.n).padStart(6)} ${String(series.shock.n).padStart(8)}`,
  );
}
