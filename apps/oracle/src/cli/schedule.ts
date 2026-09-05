import { resolveDataset } from '@creance/index-model';

import { notifierFrom } from '../alerts.js';
import { findSeries, loadOracleConfig } from '../config.js';
import { oracleKeyHex } from '../keys.js';
import { publishedOnTopic, type TopicObservation } from '../published.js';
import { QaFailed } from '../run.js';
import { JsonRunsWriter, MemoryRunsWriter } from '../runs.js';
import { runScheduledCheck } from '../schedule.js';
import { StateFile } from '../state.js';
import { readSource, readString, type SourcePreference } from './args.js';
import { groupsFor, printHeader, printSummary, wire } from './common.js';
import { reportQaFailure } from './failure.js';

/**
 * `pnpm oracle:schedule`. One daily check, then exit.
 *
 * docs/INDEX-SPEC.md section 5 asks for a check at 14:10 UTC every day that
 * runs the pipeline when the source has a period newer than the newest stored
 * one. One invocation does one check, because the cadence belongs to whatever
 * invokes it: the deploy compose runs the oracle as a service whose command
 * loops `pnpm run oracle:schedule` and then sleeps a day, so the loop is the
 * schedule and this command is one turn of it. See docs/DECISIONS.md, "One
 * invocation of the scheduler is one check".
 *
 * `--wait` is for the other deployment, a resident process with no loop around
 * it: it sleeps until the next `--at` and then does its one check. Either way
 * what runs is the same check, so a manual run and a scheduled run cannot
 * drift apart.
 *
 * The check is safe to run at any hour and safe to run twice. Nothing is
 * published for a period the store or the index topic already carries, the
 * gates run before anything is sent, and a run that finds nothing new still
 * writes its row.
 */

const DEFAULT_AT = '14:10';

interface Options {
  source: SourcePreference;
  series: string | null;
  submit: boolean;
  dryRun: boolean;
  /** The daily check time, UTC, as HH:MM. Only used with `--wait`. */
  at: string;
  wait: boolean;
  statePath: string | null;
}

const USAGE = `usage: pnpm oracle:schedule [options]

  --source archive|cache|api
                          where the rows come from; defaults to api, the live path
  --series LABEL          check only the group this cover series settles
  --at HH:MM              the daily check time in UTC; defaults to ${DEFAULT_AT}
  --wait                  sleep until the next --at before checking, for a resident process
  --no-submit             publish to the topic and make no contract call
  --dry-run               compute, gate, sign and encode everything, send nothing
  --state PATH            where to write the run state; defaults to ORACLE_STATE_PATH
  -h, --help              this text`;

/** A UTC time of day as HH:MM, which is all `--at` accepts. */
export function readTimeOfDay(value: string | undefined, flag: string): string {
  if (value === undefined || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error(`${flag} needs a UTC time like 14:10, not ${String(value)}`);
  }
  return value;
}

/** Milliseconds from now until the next occurrence of HH:MM UTC. */
export function millisecondsUntil(at: string, now: Date): number {
  const [hours, minutes] = at.split(':').map(Number) as [number, number];
  const next = new Date(now);
  next.setUTCHours(hours, minutes, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    source: 'api',
    series: null,
    submit: true,
    dryRun: false,
    at: DEFAULT_AT,
    wait: false,
    statePath: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') options.source = readSource(argv[++i]);
    else if (arg === '--series') options.series = readString(argv[++i], '--series');
    else if (arg === '--at') options.at = readTimeOfDay(argv[++i], '--at');
    else if (arg === '--wait') options.wait = true;
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

  if (options.wait) {
    const delay = millisecondsUntil(options.at, new Date());
    log(`schedule   waiting ${String(Math.round(delay / 60000))} minutes for the ${options.at} UTC check`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const dataset = await resolveDataset({ prefer: options.source, from: '2000-01' });
  printHeader(
    {
      mode: 'live',
      config,
      dataset,
      keyHex,
      from: dataset.latest,
      to: dataset.latest,
      groups: groupsFor(config, series ?? null),
      series: series ?? null,
      dryRun: options.dryRun,
      submit: options.submit,
    },
    log,
  );

  const wiring = wire({ config, keyHex, dryRun: options.dryRun, submit: options.submit });
  const runs = options.dryRun ? new MemoryRunsWriter() : new JsonRunsWriter(config.runsPath);
  const notifier = notifierFrom(process.env, log);
  const state = options.dryRun
    ? undefined
    : new StateFile(options.statePath ?? config.statePath, {
        mode: 'live',
        series: series?.label ?? null,
        from: dataset.latest,
        to: dataset.latest,
      });
  state?.start();

  // The topic is the record of what settled. A clone has no store, and without
  // this a scheduled check on a fresh machine would publish a second message
  // for a month the shared topic already carries.
  const alreadyPublished =
    wiring.topicId === null
      ? new Map<string, TopicObservation>()
      : await publishedOnTopic({
          mirrorUrl: config.mirrorUrl,
          topicId: wiring.topicId,
          mode: 'live',
        });

  try {
    const result = await runScheduledCheck({
      dataset,
      config,
      publisher: wiring.publisher,
      submitter: wiring.submitter,
      writer: wiring.writer,
      runs,
      notifier,
      keyHex,
      groups: groupsFor(config, series ?? null),
      publishedOnTopic: alreadyPublished,
      topicId: wiring.topicId,
      ...(state === undefined ? {} : { state }),
      log,
    });
    if (result.summary !== null) printSummary(result.summary, log);
    log('');
    log(
      `run        ${String(result.run.id)}, state ${result.run.state}, runs table ` +
        (options.dryRun ? 'not written on a dry run' : config.runsPath),
    );
    log(
      `source     newest ${result.source.newest_period ?? 'none'}, ` +
        `${String(result.source.stale_days ?? 0)} days old`,
    );
    log(
      `alerts     ${result.alerts.length === 0 ? 'none' : result.alerts.map((alert) => alert.event).join(', ')}`,
    );
  } finally {
    state?.finish();
    await wiring.publisher.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    if (error instanceof QaFailed) {
      reportQaFailure(error, 'pnpm oracle:schedule');
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  });
}
