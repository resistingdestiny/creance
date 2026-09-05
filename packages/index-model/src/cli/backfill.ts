import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_TRIGGER_OPTIONS } from '../core.js';
import { evaluateDataset, frozenParameters, loadCalibration } from '../dataset.js';
import { sha256Hex } from '../hash.js';
import { docsRoot } from '../paths.js';
import { isPeriod, type Period } from '../period.js';
import { renderIndexReport } from '../report.js';
import { resolveDataset } from '../sources.js';

/**
 * pnpm oracle:backfill --from 2000-01. Builds the full history from the
 * committed archive, then the cache, then the API, computes every period with
 * the right status, submits and publishes nothing, and regenerates docs/INDEX.md.
 *
 * History before a series existed is context, not settlement, which is why this
 * command writes a file and a set of hashes rather than a thousand messages on
 * the index topic.
 */

interface Options {
  from: Period;
  prefer: 'archive' | 'cache' | 'api';
  write: boolean;
  out: string;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    from: '2000-01',
    prefer: 'archive',
    write: true,
    out: join(docsRoot(), 'INDEX.md'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--from') {
      const value = argv[++i];
      if (value === undefined || !isPeriod(value)) {
        throw new Error(`--from needs a period like 2000-01, not ${String(value)}`);
      }
      options.from = value;
    } else if (arg === '--source') {
      const value = argv[++i];
      if (value !== 'archive' && value !== 'cache' && value !== 'api') {
        throw new Error(`--source must be archive, cache or api, not ${String(value)}`);
      }
      options.prefer = value;
    } else if (arg === '--check') {
      // Regenerate and compare without writing, for CI.
      options.write = false;
    } else if (arg === '--out') {
      options.out = argv[++i] ?? options.out;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'usage: oracle:backfill [--from YYYY-MM] [--source archive|cache|api] [--check] [--out PATH]',
      );
      process.exit(0);
    } else if (arg !== undefined) {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return options;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const dataset = await resolveDataset({ prefer: options.prefer, from: options.from });
  const calibration = loadCalibration();
  const parameters = frozenParameters(calibration);

  console.log(`source     ${dataset.source.description}`);
  for (const file of dataset.source.files) {
    console.log(`  ${file.sha256}  ${String(file.bytes).padStart(9)}  ${file.label}`);
  }
  console.log(`window     ${options.from} to ${dataset.latest}`);

  const observations = evaluateDataset(
    dataset,
    parameters,
    options.from,
    dataset.latest,
    DEFAULT_TRIGGER_OPTIONS,
  );

  let excess = 0;
  let smoothed = 0;
  let index = 0;
  let final = 0;
  let insufficient = 0;
  let noSource = 0;
  let open = 0;
  for (const rows of observations.values()) {
    for (const row of rows) {
      if (row.e !== null) excess += 1;
      if (row.ebar !== null) smoothed += 1;
      if (row.odi !== null) index += 1;
      if (row.status === 'final') final += 1;
      if (row.status === 'insufficient_history') insufficient += 1;
      if (row.status === 'no_source') noSource += 1;
      if (row.open) open += 1;
    }
  }
  const series = observations.size;
  console.log('');
  console.log(`series     ${series}`);
  console.log(`e rows     ${excess}  (${excess / series} per series)`);
  console.log(`ebar rows  ${smoothed}  (${smoothed / series} per series)`);
  console.log(`odi rows   ${index}  (${index / series} per series)`);
  console.log(
    `statuses   final ${final}, insufficient_history ${insufficient}, no_source ${noSource}`,
  );
  console.log(`open       ${open} group months`);
  console.log('submitted  nothing: backfill computes history and settles nothing');

  const report = renderIndexReport({ dataset, calibration });
  const digest = sha256Hex(report);
  const existing = existsSync(options.out) ? readFileSync(options.out, 'utf8') : null;
  if (options.write) {
    mkdirSync(docsRoot(), { recursive: true });
    writeFileSync(options.out, report);
    console.log('');
    console.log(`wrote      ${options.out}  sha256 ${digest}`);
    if (existing !== null) {
      console.log(`rerun      ${existing === report ? 'byte identical' : 'CHANGED'}`);
    }
  } else {
    console.log('');
    console.log(`checked    ${options.out}  sha256 ${digest}`);
    if (existing !== report) {
      console.error('docs/INDEX.md is out of date. Run pnpm oracle:backfill.');
      process.exitCode = 1;
    } else {
      console.log('rerun      byte identical');
    }
  }
}

await main();
