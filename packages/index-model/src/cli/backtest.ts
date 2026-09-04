import { defaultWindows } from '../calibration.js';
import { DEFAULT_TRIGGER_OPTIONS, type Observation } from '../core.js';
import {
  calibrateDataset,
  evaluateDataset,
  frozenParameters,
  loadCalibration,
  type Dataset,
} from '../dataset.js';
import { hazardTable } from '../pricing.js';
import { resolveDataset } from '../sources.js';
import { fmt2 } from '../rounding.js';

/**
 * pnpm oracle:backtest. Prints the per-group table from January 2010 to the
 * newest month the source carries, at the frozen per-series parameters, then the
 * same window at the generic attachment of 2.0 the backlog asks for.
 */

interface Options {
  from: string;
  prefer: 'archive' | 'cache' | 'api';
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { from: '2010-01', prefer: 'archive' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--from') {
      options.from = argv[++i] ?? options.from;
    } else if (arg === '--source') {
      const value = argv[++i];
      if (value !== 'archive' && value !== 'cache' && value !== 'api') {
        throw new Error(`--source must be archive, cache or api, not ${String(value)}`);
      }
      options.prefer = value;
    } else if (arg === '--help' || arg === '-h') {
      console.log('usage: oracle:backtest [--from YYYY-MM] [--source archive|cache|api]');
      process.exit(0);
    } else if (arg !== undefined) {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return options;
}

function pad(value: string, width: number, left = false): string {
  return left ? value.padStart(width) : value.padEnd(width);
}

function counts(rows: readonly Observation[]) {
  const open = rows.filter((row) => row.open);
  return {
    open: open.length,
    shock: open.filter((row) => row.shockOpen).length,
    level: open.filter((row) => row.levelOpen).length,
    last: open.length === 0 ? 'never' : (open[open.length - 1]?.period as string),
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const dataset: Dataset = await resolveDataset({ prefer: options.prefer });
  const calibration = loadCalibration();
  const parameters = frozenParameters(calibration);
  const to = dataset.latest;

  console.log(`source     ${dataset.source.description}`);
  console.log(`window     ${options.from} to ${to}`);
  console.log(`model      ${calibration.model_version}, frozen ${calibration.frozen_on}`);
  console.log('');

  const frozen = evaluateDataset(dataset, parameters, options.from, to, DEFAULT_TRIGGER_OPTIONS);
  const recomputed = new Map(
    calibrateDataset(dataset, defaultWindows(to)).map((series) => [series.groupKey, series]),
  );

  console.log('Frozen per-series parameters');
  console.log(
    `${pad('occupation', 34)}${pad('A', 6, true)}${pad('L', 8, true)}` +
      `${pad('open', 6, true)}${pad('shock', 7, true)}${pad('level', 7, true)}  last open`,
  );
  let total = 0;
  for (const [groupKey, rows] of frozen) {
    const c = counts(rows);
    total += c.open;
    const entry = calibration.series.find((e) => e.group_key === groupKey);
    console.log(
      pad(groupKey, 34) +
        pad((entry?.attachment_shock ?? 0).toFixed(1), 6, true) +
        pad(fmt2(entry?.level_line ?? 0), 8, true) +
        pad(String(c.open), 6, true) +
        pad(String(c.shock), 7, true) +
        pad(String(c.level), 7, true) +
        '  ' +
        c.last,
    );
  }
  console.log(`${pad('', 34)}${pad('', 14)}${pad(String(total), 6, true)}  open group months`);

  console.log('');
  console.log('Generic attachment 2.0, shock form only');
  console.log(
    `${pad('occupation', 34)}${pad('open', 6, true)}${pad('own A and L', 13, true)}  ` +
      `${pad('first', 9)}last`,
  );
  const generic = evaluateDataset(dataset, parameters, options.from, to, {
    ...DEFAULT_TRIGGER_OPTIONS,
    attachmentOverride: 2.0,
    shockOnly: true,
  });
  let genericTotal = 0;
  for (const [groupKey, rows] of generic) {
    const c = counts(rows);
    genericTotal += c.open;
    const own = counts(frozen.get(groupKey) ?? []);
    const first = rows.find((row) => row.open)?.period ?? 'never';
    console.log(
      pad(groupKey, 34) +
        pad(String(c.open), 6, true) +
        pad(String(own.open), 13, true) +
        `  ${pad(first, 9)}${c.last}`,
    );
  }
  console.log(`${pad('', 34)}${pad(String(genericTotal), 6, true)}  open group months`);

  console.log('');
  console.log('Calibration check against the frozen file');
  let mismatches = 0;
  for (const [groupKey, series] of recomputed) {
    const entry = calibration.series.find((e) => e.group_key === groupKey);
    const ok =
      entry?.attachment_shock === series.attachmentShock && entry?.level_line === series.levelLine;
    if (!ok) {
      mismatches += 1;
      console.log(
        `  ${groupKey}: frozen A ${entry?.attachment_shock} L ${entry?.level_line}, ` +
          `source gives A ${series.attachmentShock} L ${series.levelLine}`,
      );
    }
  }
  console.log(
    mismatches === 0
      ? `  all ${recomputed.size} series reproduce their frozen A and L from this source`
      : `  ${mismatches} series do not reproduce; the parameters stay frozen and this is a source event`,
  );

  console.log('');
  console.log('Hazard on distance to the level line');
  const hazard = hazardTable(dataset);
  for (const bucket of hazard.buckets) {
    console.log(
      `  ${pad(bucket.label, 22)}${pad(`${(bucket.rate * 100).toFixed(1)} percent`, 12, true)}` +
        `${pad(String(bucket.sample), 8, true)}`,
    );
  }
}

await main();
