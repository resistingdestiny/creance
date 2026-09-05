import {
  addMonths,
  bindableGroups,
  aggregateSeriesId,
  evaluateDataset,
  extractRows,
  frozenParameters,
  loadCalibration,
  periodIndex,
  seriesIdFor,
  sourceHash,
  type Dataset,
  type Observation,
  type Period,
} from '@creance/index-model';

import { seriesForGroup, type OracleConfig } from './config.js';
import { assertUnderCap, buildMessage, signMessage, type ObservationMessage } from './message.js';
import { mirrorMessageUrl, topicMessageUrl, type Publisher } from './publisher.js';
import { formatReport, runQaGates, type QaReport } from './qa.js';
import type { OracleMode, StateFile } from './state.js';
import type { ObservationRecord, ObservationWriter } from './store.js';
import { toMonthIndex, transactionUrl, type SubmitResult, type Submitter } from './submitter.js';

/**
 * The run pipeline of docs/INDEX-SPEC.md section 5, in the order the states
 * name: compute, qa, publish, submit. Fetch is the caller's, because the three
 * modes differ only in where the rows come from; replay and scenario bypass
 * fetch and still pass qa, and still write a run.
 *
 * Two invariants hold across every mode.
 *
 * Publish before submit, always. The on chain call carries the HCS sequence
 * number, so the message has to exist before the number does. A run that dies
 * between the two leaves a message on the topic with no submission, which is
 * the recoverable direction: the retry reads `observationOf` and resubmits.
 *
 * Nothing is retried by rollback. An HCS message cannot be retracted and the
 * contract reverts on a duplicate, so idempotence is a read before each write:
 * the store for the topic, `observationOf` and `lastObservedMonth` for the
 * chain.
 */

/**
 * The calendar months a period's computation touches: t, t-1 and t-2 for the
 * smoothed excess, and t-12, t-13 and t-14 for the base it is differenced
 * against. These are the rows the source hash commits to.
 */
export function periodsUsed(period: Period): Period[] {
  return [0, -1, -2, -12, -13, -14].map((offset) => addMonths(period, offset));
}

/** The run-up the jump gate needs behind the first target period. */
export const QA_RUNUP_MONTHS = 25;

export interface PeriodOutcome {
  period: Period;
  qa: QaReport;
  published: PublishedObservation[];
}

export interface PublishedObservation {
  groupKey: string;
  period: Period;
  status: string;
  open: boolean;
  openReason: string;
  seriesLabel: string | null;
  hcsSequence: number | null;
  hcsTransactionId: string | null;
  hcsUrl: string | null;
  mirrorUrl: string | null;
  submit: SubmitResult | null;
  submitUrl: string | null;
  /** Why the chain call did not happen, when it did not. */
  submitSkipped: string | null;
  bytes: number;
  message: ObservationMessage;
}

export interface RunSummary {
  mode: OracleMode;
  from: Period;
  to: Period;
  groups: string[];
  periods: PeriodOutcome[];
  publishedCount: number;
  submittedCount: number;
  skippedCount: number;
}

/** A QA failure. The run stops here and nothing further reaches the topic. */
export class QaFailed extends Error {
  constructor(readonly report: QaReport) {
    super(
      `QA failed for ${report.period}: ${report.failures.map((gate) => `${gate.gate}, ${gate.detail}`).join('; ')}`,
    );
    this.name = 'QaFailed';
  }
}

export interface PipelineOptions {
  mode: OracleMode;
  dataset: Dataset;
  /** The target periods, ascending. */
  periods: readonly Period[];
  /** The groups to publish, or null for every bindable group. */
  groups: readonly string[] | null;
  config: OracleConfig;
  publisher: Publisher;
  /** Null switches the chain call off entirely, which is what a backfill wants. */
  submitter: Submitter | null;
  writer: ObservationWriter;
  keyHex: string;
  state?: StateFile;
  /** Milliseconds between the start of one tick and the start of the next. */
  intervalMs?: number;
  scenarioLabel?: string | null;
  /** Recorded on the row and used for the message link. Null in a dry run. */
  topicId?: string | null;
  log?: (line: string) => void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function runPipeline(options: PipelineOptions): Promise<RunSummary> {
  const log = options.log ?? (() => {});
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  const intervalMs = options.intervalMs ?? 0;
  const periods = [...options.periods].sort();
  if (periods.length === 0) throw new Error('a run needs at least one period');

  const first = periods[0] as Period;
  const last = periods[periods.length - 1] as Period;
  const map = options.dataset.map;
  const groups = options.groups ?? bindableGroups(map).map((entry) => entry.group_key);
  const aggregate = aggregateSeriesId(map);
  const calibration = loadCalibration();

  // Compute once over the whole window plus the run-up the jump gate needs.
  const observations = evaluateDataset(
    options.dataset,
    frozenParameters(calibration),
    addMonths(first, -QA_RUNUP_MONTHS),
    last,
  );

  const outcomes: PeriodOutcome[] = [];
  let publishedCount = 0;
  let submittedCount = 0;
  let skippedCount = 0;

  for (const period of periods) {
    const startedAt = Date.now();

    const qa = runQaGates({ dataset: options.dataset, observations, period, calibration, map });
    log(`${period}  qa ${qa.passed ? 'pass' : 'FAIL'}`);
    log(formatReport(qa));
    if (!qa.passed) {
      options.state?.advance(period, false);
      throw new QaFailed(qa);
    }

    const published: PublishedObservation[] = [];
    for (const groupKey of groups) {
      const observation = observations.get(groupKey)?.find((row) => row.period === period);
      if (observation === undefined) {
        throw new Error(`${groupKey} has no observation for ${period} after a passing QA run`);
      }

      if (await options.writer.has(groupKey, period, options.mode)) {
        skippedCount += 1;
        log(`${period}  ${groupKey.padEnd(32)} already published in ${options.mode} mode`);
        continue;
      }

      const outcome = await publishOne({
        observation,
        aggregate,
        calibration: calibration.model_version,
        options,
        now: now(),
        log,
      });
      published.push(outcome);
      publishedCount += 1;
      if (outcome.submit !== null) submittedCount += 1;
    }

    outcomes.push({ period, qa, published });
    options.state?.advance(period, published.length > 0);

    // Dwell rather than tick on a timer: the next period must not appear on
    // screen before the previous one is on the topic.
    if (intervalMs > 0 && period !== last) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < intervalMs) await sleep(intervalMs - elapsed);
    }
  }

  return {
    mode: options.mode,
    from: first,
    to: last,
    groups: [...groups],
    periods: outcomes,
    publishedCount,
    submittedCount,
    skippedCount,
  };
}

interface PublishArgs {
  observation: Observation;
  aggregate: string;
  calibration: string;
  options: PipelineOptions;
  now: Date;
  log: (line: string) => void;
}

async function publishOne(args: PublishArgs): Promise<PublishedObservation> {
  const { observation, options, log } = args;
  const map = options.dataset.map;
  const blsSeriesId = seriesIdFor(observation.groupKey, map);
  const series = seriesForGroup(options.config, observation.groupKey) ?? null;

  const rows = extractRows(
    options.dataset,
    [blsSeriesId, args.aggregate],
    periodsUsed(observation.period),
  );
  const digest = sourceHash(rows);

  const message = signMessage(
    buildMessage(observation, {
      seriesLabel: series?.label ?? null,
      blsSeriesId,
      sourceHash: digest,
      modelVersion: args.calibration,
      computedAt: args.now,
    }),
    options.keyHex,
  );
  const bytes = assertUnderCap(message);

  const receipt = await options.publisher.publish(bytes);
  const topicId = options.topicId ?? receipt.topicId;
  log(
    `${observation.period}  ${observation.groupKey.padEnd(32)} ${observation.status.padEnd(20)} ` +
      `${observation.open ? `OPEN ${observation.openReason}` : 'closed'.padEnd(10)} ` +
      `seq ${receipt.sequenceNumber}  ${bytes.byteLength} bytes`,
  );

  const submission = await maybeSubmit(args, receipt.sequenceNumber, digest, series?.seriesId);
  if (submission.result !== null) {
    log(
      `${observation.period}  ${observation.groupKey.padEnd(32)} submitted ${submission.result.hash} ` +
        `gas ${submission.result.gasUsed}` +
        (submission.result.claimsOpened === null
          ? ''
          : `  CLAIMS OPENED reserved ${submission.result.claimsOpened.reserved}`),
    );
  } else if (submission.skipped !== null) {
    log(`${observation.period}  ${observation.groupKey.padEnd(32)} no chain call: ${submission.skipped}`);
  }

  const record: ObservationRecord = {
    group_key: observation.groupKey,
    period: observation.period,
    series: series?.label ?? null,
    u_g: observation.uG,
    u_all: observation.uAll,
    e: observation.e,
    ebar: observation.ebar,
    odi: observation.odi,
    open: observation.open,
    open_reason: observation.openReason,
    status: message.status,
    model_version: message.model_version,
    hcs_topic: topicId,
    hcs_seq: receipt.sequenceNumber,
    hcs_tx: receipt.transactionId,
    submit_tx: submission.result?.hash ?? null,
    revises_seq: null,
    mode: options.mode,
    replay: options.mode !== 'live',
    scenario_label: options.scenarioLabel ?? null,
    source_files: options.dataset.source.files,
    message,
    written_at: `${args.now.toISOString().slice(0, 19)}Z`,
  };
  await options.writer.write(record);

  const live = options.topicId !== null && options.topicId !== undefined;
  return {
    groupKey: observation.groupKey,
    period: observation.period,
    status: message.status,
    open: observation.open,
    openReason: observation.openReason,
    seriesLabel: series?.label ?? null,
    hcsSequence: receipt.sequenceNumber,
    hcsTransactionId: receipt.transactionId,
    hcsUrl: live ? topicMessageUrl(topicId, receipt.sequenceNumber) : null,
    mirrorUrl: live
      ? mirrorMessageUrl(options.config.mirrorUrl, topicId, receipt.sequenceNumber)
      : null,
    submit: submission.result,
    submitUrl: submission.result === null ? null : transactionUrl(submission.result.hash),
    submitSkipped: submission.skipped,
    bytes: bytes.byteLength,
    message,
  };
}

/**
 * Decide whether this observation belongs on chain, and put it there if so.
 *
 * Every reason to decline is a real contract rule, and each one is named in the
 * return so a run log says why a month was published and not submitted rather
 * than leaving a reader to guess.
 */
async function maybeSubmit(
  args: PublishArgs,
  hcsSequence: number,
  digest: string,
  seriesId: string | undefined,
): Promise<{ result: SubmitResult | null; skipped: string | null }> {
  const { observation, options } = args;
  const submitter = options.submitter;
  if (submitter === null) return { result: null, skipped: 'chain submission is off for this run' };
  if (seriesId === undefined) {
    return { result: null, skipped: `${observation.groupKey} has no cover series registered` };
  }
  if (observation.status !== 'final' || observation.ebar === null) {
    return { result: null, skipped: `status is ${observation.status}, only final months settle` };
  }

  const monthIndex = toMonthIndex(observation.period);
  const nowMonth = periodIndex(
    `${args.now.getUTCFullYear()}-${String(args.now.getUTCMonth() + 1).padStart(2, '0')}`,
  );
  if (monthIndex > nowMonth) {
    return { result: null, skipped: `${observation.period} has not started yet` };
  }

  const state = await submitter.seriesState(seriesId);
  if (!state.acceptsObservations) {
    return { result: null, skipped: `the series is ${state.statusName}` };
  }
  if (await submitter.hasObservation(seriesId, observation.period)) {
    return { result: null, skipped: `${observation.period} is already on chain` };
  }
  if (state.lastObservedMonth !== 0 && monthIndex <= state.lastObservedMonth) {
    return {
      result: null,
      skipped: `the series has already observed a month at or after ${observation.period}`,
    };
  }

  const result = await submitter.submit({
    seriesId,
    period: observation.period,
    odi: observation.odi,
    ebar: observation.ebar,
    hcsSequence,
    sourceHash: digest,
  });
  return { result, skipped: null };
}
