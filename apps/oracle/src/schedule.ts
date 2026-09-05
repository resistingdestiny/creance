import {
  addMonths,
  comparePeriods,
  evaluateDataset,
  frozenParameters,
  loadCalibration,
  periodRange,
  type Dataset,
  type Observation,
  type Period,
} from '@creance/index-model';

import { raise, type Alert, type Notifier } from './alerts.js';
import type { OracleConfig } from './config.js';
import type { Publisher } from './publisher.js';
import type { TopicObservation } from './published.js';
import type { QaReport } from './qa.js';
import { detectRevisions, publishRevisions, type PublishedRevision } from './revision.js';
import { QA_RUNUP_MONTHS, QaFailed, precheckWindow, runPipeline, type RunSummary } from './run.js';
import { RunLog, type RunRecord, type RunsWriter } from './runs.js';
import { staleness, type Staleness } from './staleness.js';
import type { StateFile } from './state.js';
import type { ObservationRecord, ObservationWriter } from './store.js';
import type { Submitter } from './submitter.js';

/**
 * The daily check of docs/INDEX-SPEC.md section 5.
 *
 * The scheduler does not hard-code release dates. It asks one question: does
 * the source carry a period newer than the newest one already published. When
 * it does, the full pipeline runs for the months in between; when it does not,
 * the check is still a run and still writes a row, because the runs table is
 * the heartbeat of section 9 and a check that found nothing is as much a sign
 * of life as one that published.
 *
 * Not hard-coding the calendar is the whole point rather than a simplification.
 * The published release schedule moves: the January 2026 Employment Situation
 * slipped by five days after a lapse in appropriations, the September 2025
 * release moved by seven weeks and the October 2025 release was cancelled
 * outright. The trigger to run is always "the source has a period I do not
 * have".
 *
 * Everything that reaches a network is passed in, so this whole function runs
 * in `pnpm test` against the committed archive with the dry run publisher and
 * submitter, and the QA, revision, staleness and alert paths are the same code
 * the deployed service runs.
 */

export interface ScheduleOptions {
  dataset: Dataset;
  config: OracleConfig;
  publisher: Publisher;
  /** Null switches the chain call off, which is what a dry check wants. */
  submitter: Submitter | null;
  writer: ObservationWriter;
  runs: RunsWriter;
  notifier: Notifier;
  keyHex: string;
  /** The groups to publish, or null for every bindable group. */
  groups?: readonly string[] | null;
  publishedOnTopic?: ReadonlyMap<string, TopicObservation>;
  topicId?: string | null;
  state?: StateFile;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface ScheduleResult {
  run: RunRecord;
  /** The newest period already published, from the store and the topic. */
  newestPublished: Period | null;
  /** The months this check decided to run, empty when the source had nothing new. */
  targets: Period[];
  summary: RunSummary | null;
  revisions: PublishedRevision[];
  source: Staleness;
  /** Every alert this check raised, in order. */
  alerts: Alert[];
}

/**
 * The newest period that has already been published, across the store and the
 * topic read back.
 *
 * Both, because either one alone is wrong on a machine that matters. The store
 * is a file under `var/` that a clean clone does not carry, and the topic read
 * back is the only thing that knows what settled; the topic can be unreachable,
 * and then the store is all there is.
 */
export function newestPublished(
  records: readonly ObservationRecord[],
  onTopic?: ReadonlyMap<string, TopicObservation>,
): Period | null {
  let newest: Period | null = null;
  const consider = (period: Period): void => {
    if (newest === null || comparePeriods(period, newest) > 0) newest = period;
  };
  for (const record of records) {
    if (record.mode === 'scenario') continue;
    if (record.status === 'revised' || record.status === 'revision') continue;
    consider(record.period);
  }
  for (const entry of onTopic?.values() ?? []) {
    if (entry.message.status === 'revision') continue;
    consider(entry.message.period);
  }
  return newest;
}

/**
 * The months a check should run, given what is published and what the source
 * carries.
 *
 * A gap of several months is walked in full rather than jumped, because every
 * month in between is a settlement value somebody may hold cover against. A
 * machine that has published nothing runs the newest month alone: a first run
 * that decided to publish twenty six years of history would put it on the
 * settlement topic, and history before a series existed is context, which is
 * what `pnpm oracle:backfill` is for.
 */
export function targetsFor(newest: Period | null, latest: Period): Period[] {
  if (newest === null) return [latest];
  if (comparePeriods(latest, newest) <= 0) return [];
  return periodRange(addMonths(newest, 1), latest);
}

export async function runScheduledCheck(options: ScheduleOptions): Promise<ScheduleResult> {
  const log = options.log ?? ((): void => {});
  const now = options.now ?? ((): Date => new Date());
  const calibration = loadCalibration();
  const alerts: Alert[] = [];

  const alert = async (entry: Alert): Promise<void> => {
    alerts.push(entry);
    await raise(options.notifier, entry, log);
  };

  const run = await RunLog.start(options.runs, { mode: 'live', now });
  log(`run        ${run.id} started, state fetch`);

  try {
    // Verify: what is published, what the source carries, and whether the
    // distance between the two has become an outage.
    await run.advance('verify');
    const before = await options.writer.all();
    const newest = newestPublished(before, options.publishedOnTopic);
    const source = staleness(options.dataset.latest, now());
    log(
      `verify     source newest ${options.dataset.latest}, published newest ${newest ?? 'nothing'}, ` +
        `${source.stale_days ?? 'no'} days old`,
    );
    if (source.stale) {
      await alert({
        event: 'source_stale',
        group: null,
        period: options.dataset.latest,
        message:
          `the newest period at the source is ${options.dataset.latest}, ` +
          `${String(source.stale_days)} days old, past the ${String(source.stale_after_days)} day line`,
        run_id: run.id,
      });
    }

    const targets = targetsFor(newest, options.dataset.latest);
    await run.target(targets[targets.length - 1] ?? null);
    if (targets.length === 0) {
      await run.note(`no new period at the source, newest is ${options.dataset.latest}`);
      log(`verify     nothing new to publish`);
    }

    // Compute once over the target window and the run-up the jump gate needs,
    // and over the revision window behind it, so one evaluation serves the
    // publish path and the revision check.
    await run.advance('compute');
    const first = targets[0] ?? options.dataset.latest;
    const observations = evaluateDataset(
      options.dataset,
      frozenParameters(calibration),
      addMonths(first, -QA_RUNUP_MONTHS),
      options.dataset.latest,
    );

    // QA before anything is published, and a failure ends the run here. The
    // pipeline gates the window again on its own; running the gates here is
    // what puts the report in the runs row whether or not the run publishes.
    await run.advance('qa');
    const reports = gateReports(options, observations, targets, calibration);
    await run.qa(reports);
    const failed = reports.find((report) => !report.passed);
    if (failed !== undefined) {
      await failClosed(run, alert, failed, log);
      throw new QaFailed(failed, lastPassing(reports, failed));
    }

    let summary: RunSummary | null = null;
    if (targets.length > 0) {
      await run.advance('publish');
      summary = await runPipeline({
        mode: 'live',
        dataset: options.dataset,
        periods: targets,
        groups: options.groups ?? null,
        config: options.config,
        publisher: options.publisher,
        submitter: options.submitter,
        writer: options.writer,
        keyHex: options.keyHex,
        ...(options.publishedOnTopic === undefined
          ? {}
          : { publishedOnTopic: options.publishedOnTopic }),
        ...(options.topicId === undefined ? {} : { topicId: options.topicId }),
        ...(options.state === undefined ? {} : { state: options.state }),
        log,
        now,
      });
      await run.advance('submit');
      await run.note(
        `published ${String(summary.publishedCount)}, submitted ${String(summary.submittedCount)}, ` +
          `skipped ${String(summary.skippedCount)}`,
      );

      for (const entry of firstOpenMonths(before, summary)) {
        await alert({
          event: 'first_open_month',
          group: entry.groupKey,
          period: entry.period,
          message:
            `${entry.groupKey} opened for the first time in ${entry.period} on the ` +
            `${entry.openReason} form. Claims are open for anyone holding cover on it.`,
          run_id: run.id,
        });
      }
    }

    // The first final rule. A period that settled is never republished, so a
    // source that moved under one produces a revision record and nothing else.
    const revisions = await publishRevisions({
      candidates: detectRevisions({
        dataset: options.dataset,
        records: await options.writer.all(),
        latest: options.dataset.latest,
        mode: 'live',
      }),
      dataset: options.dataset,
      observations,
      config: options.config,
      publisher: options.publisher,
      writer: options.writer,
      notifier: options.notifier,
      keyHex: options.keyHex,
      modelVersion: calibration.model_version,
      mode: 'live',
      runId: run.id,
      ...(options.topicId === undefined ? {} : { topicId: options.topicId }),
      now: now(),
      log,
    });
    // `publishRevisions` raises its own alert as it publishes each record, so
    // these are mirrored into the result rather than sent again: one list, and
    // one notification per revision.
    for (const revision of revisions) {
      alerts.push({
        event: 'revision_detected',
        group: revision.groupKey,
        period: revision.period,
        message: `a revision record was published at sequence ${String(revision.hcsSequence)}`,
        run_id: run.id,
      });
    }
    if (revisions.length > 0) {
      await run.note(`${String(revisions.length)} revision records published`);
    }

    const record = await run.finish('done');
    log(`run        ${run.id} done`);
    return {
      run: record,
      newestPublished: newest,
      targets,
      summary,
      revisions,
      source,
      alerts,
    };
  } catch (error) {
    // `failClosed` has already noted, alerted and closed the row for a gate
    // failure. Anything else, including a publish that threw halfway, closes
    // the row here so the table never carries a run that simply stops.
    if (run.current().state !== 'failed') {
      await run.note(error instanceof Error ? error.message : String(error));
      await alert({
        event: 'run_failed',
        group: null,
        period: run.current().target_period,
        message: `run ${String(run.id)} failed: ${error instanceof Error ? error.message : String(error)}`,
        run_id: run.id,
      });
      await run.finish('failed');
    }
    throw error;
  }
}

/** The gate report for every month the check would publish, and for the newest. */
function gateReports(
  options: ScheduleOptions,
  observations: ReadonlyMap<string, readonly Observation[]>,
  targets: readonly Period[],
  calibration: ReturnType<typeof loadCalibration>,
): QaReport[] {
  // A check with nothing to publish still gates the newest period the source
  // carries. A source that has gone bad between releases is worth knowing about
  // before the release that would have published it.
  const periods = targets.length > 0 ? targets : [options.dataset.latest];
  return [
    ...precheckWindow(options.dataset, observations, periods, calibration).reports.values(),
  ];
}

function lastPassing(reports: readonly QaReport[], failure: QaReport): Period | null {
  let passing: Period | null = null;
  for (const report of reports) {
    if (report.period === failure.period) break;
    if (report.passed) passing = report.period;
  }
  return passing;
}

/**
 * A failed gate ends the run before anything is published, and it fires both
 * alerts the specification names: the gate that failed, and the run that failed
 * because of it.
 */
async function failClosed(
  run: RunLog,
  alert: (entry: Alert) => Promise<void>,
  report: QaReport,
  log: (line: string) => void,
): Promise<void> {
  const detail = report.failures.map((gate) => `${gate.gate}, ${gate.detail}`).join('; ');
  log(`qa         ${report.period} FAILED: ${detail}`);
  await run.note(`qa failed for ${report.period}: ${detail}`);
  await alert({
    event: 'qa_failed',
    group: null,
    period: report.period,
    message: `QA failed for ${report.period}: ${detail}. Nothing was published and nothing was submitted.`,
    run_id: run.id,
  });
  await alert({
    event: 'run_failed',
    group: null,
    period: report.period,
    message: `run ${String(run.id)} failed closed at the QA gates`,
    run_id: run.id,
  });
  await run.finish('failed');
}

export interface OpenedMonth {
  groupKey: string;
  period: Period;
  openReason: string;
}

/**
 * The groups this run opened for the first time.
 *
 * A product event, not only an ops one: the first open month for a group is the
 * month cover on it starts paying, and the people who need to hear about it are
 * not the same people who read a runs table. It is first over the whole history
 * the store carries, so a group that opened in April and opens again in May
 * alerts once.
 */
export function firstOpenMonths(
  before: readonly ObservationRecord[],
  summary: RunSummary,
): OpenedMonth[] {
  const opened: OpenedMonth[] = [];
  const seen = new Set<string>();
  for (const period of summary.periods) {
    for (const row of period.published) {
      if (!row.open || seen.has(row.groupKey)) continue;
      const earlier = before.some(
        (record) =>
          record.group_key === row.groupKey &&
          record.mode !== 'scenario' &&
          record.open &&
          comparePeriods(record.period, row.period) < 0,
      );
      if (earlier) continue;
      seen.add(row.groupKey);
      opened.push({ groupKey: row.groupKey, period: row.period, openReason: row.openReason });
    }
  }
  return opened;
}
