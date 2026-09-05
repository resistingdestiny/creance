import { resolveDataset, type Period } from '@creance/index-model';

import { findSeries, loadOracleConfig } from '../config.js';
import { oracleKeyHex } from '../keys.js';
import { QaFailed, runPipeline } from '../run.js';
import { StateFile } from '../state.js';
import { readPeriod, readSource, readString, type SourcePreference } from './args.js';
import { groupsFor, printHeader, printSummary, wire } from './common.js';
import { reportQaFailure } from './failure.js';

/**
 * `pnpm oracle:once`. One live run for one period.
 *
 * Pulls the sixteen series from the BLS API, computes both trigger forms for
 * every bindable group, runs the QA gates, publishes one signed v2 observation
 * per group to the index topic, and submits the ones whose group has a cover
 * series registered in CoverPool.
 *
 * The keyless BLS allowance is 25 requests a day and is pooled across
 * everything sharing the address, so `--source archive` runs the same pipeline
 * against the committed snapshot when the allowance is spent. It is the same
 * code path; only the rows differ, and the message says which source they came
 * from through the source hash.
 */

interface Options {
  period: Period | null;
  source: SourcePreference;
  series: string | null;
  publish: boolean;
  submit: boolean;
  dryRun: boolean;
  statePath: string | null;
}

const USAGE = `usage: pnpm oracle:once [options]

  --period YYYY-MM        the month to publish; defaults to the newest the source carries
  --source archive|cache|api
                          where the rows come from; defaults to api, the live path
  --series LABEL          publish only the group this cover series settles
  --no-submit             publish to the topic and make no contract call
  --dry-run               compute, gate, sign and encode everything, send nothing
  --state PATH            where to write the run state; defaults to ORACLE_STATE_PATH
  -h, --help              this text`;

export function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    period: null,
    source: 'api',
    series: null,
    publish: true,
    submit: true,
    dryRun: false,
    statePath: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--period') options.period = readPeriod(argv[++i], '--period');
    else if (arg === '--source') options.source = readSource(argv[++i]);
    else if (arg === '--series') options.series = readString(argv[++i], '--series');
    else if (arg === '--no-submit') options.submit = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--state') options.statePath = readString(argv[++i], '--state');
    else if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg !== undefined) throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const config = loadOracleConfig();
  const keyHex = oracleKeyHex();
  const log = (line: string): void => console.log(line);

  const series = options.series === null ? null : findSeries(config, options.series);
  if (options.series !== null && series === undefined) {
    throw new Error(`no cover series called ${options.series} in the deployment record`);
  }

  const dataset = await resolveDataset({ prefer: options.source, from: '2000-01' });
  const period = options.period ?? dataset.latest;

  printHeader(
    {
      mode: 'live',
      config,
      dataset,
      keyHex,
      from: period,
      to: period,
      groups: groupsFor(config, series ?? null),
      series: series ?? null,
      dryRun: options.dryRun,
      submit: options.submit,
    },
    log,
  );

  const wiring = wire({ config, keyHex, dryRun: options.dryRun, submit: options.submit });
  const state = options.dryRun
    ? undefined
    : new StateFile(options.statePath ?? config.statePath, {
        mode: 'live',
        series: series?.label ?? null,
        from: period,
        to: period,
      });
  state?.start();

  try {
    const summary = await runPipeline({
      mode: 'live',
      dataset,
      periods: [period],
      groups: groupsFor(config, series ?? null),
      config,
      publisher: wiring.publisher,
      submitter: wiring.submitter,
      writer: wiring.writer,
      topicId: wiring.topicId,
      keyHex,
      ...(state === undefined ? {} : { state }),
      log,
    });
    printSummary(summary, log);
  } finally {
    state?.finish();
    await wiring.publisher.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    if (error instanceof QaFailed) {
      reportQaFailure(error, 'pnpm oracle:once');
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  });
}
