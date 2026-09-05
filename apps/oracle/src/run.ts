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
 * number, so the message has to exist before the number does.
 *
 * The store row is written between the two, not after both. That ordering is
 * the whole recovery story: an HCS message cannot be retracted, so the row is
 * the only record that stops a later run publishing the period a second time,
 * and it therefore has to be durable before anything that can throw runs. A run
 * that dies in the contract call leaves a row with `hcs_seq` set and
 * `submit_tx` null, and the next run over the same window republishes nothing
 * and does the contract call alone: see `resumeSubmit`.
 *
 * One window is left and it cannot be closed from here: a process killed
 * between the topic receipt and the row write leaves a message with no row. The
 * fix for that is to read the topic back through the mirror node before
 * republishing a period, which is a T26 job because it needs the runs table to
 * know which periods a previous run was in the middle of.
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

/**
 * A QA failure. Raised before anything is published, so a run that hits one has
 * put nothing on the topic and made no contract call.
 *
 * `lastPassing` is the newest period before the failure whose gates all pass, or
 * null when the very first period fails. It is what the operator needs to hear:
 * a window that spans a legitimate anomaly has a longest usable prefix, and the
 * command that runs it is `--to <lastPassing>`.
 */
export class QaFailed extends Error {
  constructor(
    readonly report: QaReport,
    readonly lastPassing: Period | null = null,
  ) {
    super(
      `QA failed for ${report.period}: ${report.failures.map((gate) => `${gate.gate}, ${gate.detail}`).join('; ')}`,
    );
    this.name = 'QaFailed';
  }
}

/**
 * Gate every period in the window before any of them is published.
 *
 * The gates are pure, so running all of them costs a fraction of one HCS
 * submit, and the alternative is worse than slow: gating period by period as
 * the walk proceeds means a window that fails in the middle has already put its
 * first half on the settlement topic, and an HCS message cannot be retracted.
 * A replay from 2019-01 is exactly that case, because April 2020 moves every
 * white collar group past five standard deviations and trips the jump gate.
 *
 * docs/INDEX-SPEC.md section 8 says a failed gate fails the run closed and a
 * human looks before anything reaches the topic. Checking first is what makes
 * that true for a multi period run rather than only for a single one.
 */
export function precheckWindow(
  dataset: Dataset,
  observations: ReadonlyMap<string, readonly Observation[]>,
  periods: readonly Period[],
  calibration = loadCalibration(),
): { reports: Map<Period, QaReport>; failure: QaFailed | null } {
  const reports = new Map<Period, QaReport>();
  let failure: QaFailed | null = null;
  let lastPassing: Period | null = null;
  for (const period of periods) {
    const report = runQaGates({
      dataset,
      observations,
      period,
      calibration,
      map: dataset.map,
    });
    reports.set(period, report);
    if (report.passed) {
      if (failure === null) lastPassing = period;
    } else if (failure === null) {
      failure = new QaFailed(report, lastPassing);
    }
  }
  return { reports, failure };
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

  // Gate the whole window first. Nothing below this line runs unless every
  // period in the run passes, so a window that cannot finish publishes nothing.
  const { reports, failure } = precheckWindow(options.dataset, observations, periods, calibration);
  if (failure !== null) throw failure;
  log(`qa         ${periods.length} periods gated, all pass`);
  log('');

  const outcomes: PeriodOutcome[] = [];
  let publishedCount = 0;
  let submittedCount = 0;
  let skippedCount = 0;

  for (const period of periods) {
    const startedAt = Date.now();

    const qa = reports.get(period) as QaReport;
    log(`${period}  qa pass`);
    log(formatReport(qa));

    const published: PublishedObservation[] = [];
    for (const groupKey of groups) {
      const observation = observations.get(groupKey)?.find((row) => row.period === period);
      if (observation === undefined) {
        throw new Error(`${groupKey} has no observation for ${period} after a passing QA run`);
      }

      // A stored row means the message is already on the topic and must never
      // be published again. It does not mean the period is finished: a run that
      // died between the publish and the contract call leaves the row with
      // submit_tx null, and this is where that period gets its chain call.
      //
      // The lookup crosses modes: live and replay write the same topic, so a
      // month the demo clock published is published, and this run reports which
      // mode put it there rather than assuming its own.
      const existing = await options.writer.get(groupKey, period, options.mode);
      if (existing !== undefined) {
        skippedCount += 1;
        const resumed = await resumeSubmit(options, existing, now(), log);
        if (resumed !== null) {
          submittedCount += 1;
        } else {
          log(`${period}  ${groupKey.padEnd(32)} already published in ${existing.mode} mode`);
        }
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
    // Null until the contract call returns. The row is written now, with the
    // receipt in hand, because the message on the topic cannot be retracted:
    // a row is the only thing that stops a later run publishing the period
    // again, so it has to exist before anything that can throw runs.
    submit_tx: null,
    revises_seq: null,
    mode: options.mode,
    replay: options.mode !== 'live',
    scenario_label: options.scenarioLabel ?? null,
    source_files: options.dataset.source.files,
    message,
    written_at: `${args.now.toISOString().slice(0, 19)}Z`,
  };
  await options.writer.write(record);

  const submission = await maybeSubmit(
    options,
    {
      groupKey: observation.groupKey,
      period: observation.period,
      status: message.status,
      odi: observation.odi,
      ebar: observation.ebar,
      sourceHash: digest,
      hcsSequence: receipt.sequenceNumber,
    },
    series?.seriesId,
    args.now,
  );
  if (submission.result !== null) {
    await options.writer.write({ ...record, submit_tx: submission.result.hash });
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
/**
 * Exactly what a chain call would carry, taken from the message that was
 * published rather than recomputed.
 *
 * The retry path depends on the distinction. A resubmission has to send the
 * values the topic already carries, because the on chain observation and the
 * HCS message it names are one statement; if the source were revised between
 * the two attempts, recomputing would put a number on chain that no message
 * supports.
 */
interface SubmitCandidate {
  groupKey: string;
  period: Period;
  status: string;
  odi: number | null;
  ebar: number | null;
  sourceHash: string;
  hcsSequence: number;
}

async function maybeSubmit(
  options: PipelineOptions,
  candidate: SubmitCandidate,
  seriesId: string | undefined,
  now: Date,
): Promise<{ result: SubmitResult | null; skipped: string | null }> {
  const submitter = options.submitter;
  if (submitter === null) return { result: null, skipped: 'chain submission is off for this run' };
  if (seriesId === undefined) {
    return { result: null, skipped: `${candidate.groupKey} has no cover series registered` };
  }
  if (candidate.status !== 'final' || candidate.ebar === null) {
    return { result: null, skipped: `status is ${candidate.status}, only final months settle` };
  }

  const monthIndex = toMonthIndex(candidate.period);
  const nowMonth = periodIndex(
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
  );
  if (monthIndex > nowMonth) {
    return { result: null, skipped: `${candidate.period} has not started yet` };
  }

  const state = await submitter.seriesState(seriesId);
  if (!state.acceptsObservations) {
    return { result: null, skipped: `the series is ${state.statusName}` };
  }
  if (await submitter.hasObservation(seriesId, candidate.period)) {
    return { result: null, skipped: `${candidate.period} is already on chain` };
  }
  if (state.lastObservedMonth !== 0 && monthIndex <= state.lastObservedMonth) {
    return {
      result: null,
      skipped: `the series has already observed a month at or after ${candidate.period}`,
    };
  }

  const result = await submitter.submit({
    seriesId,
    period: candidate.period,
    odi: candidate.odi,
    ebar: candidate.ebar,
    hcsSequence: candidate.hcsSequence,
    sourceHash: candidate.sourceHash,
  });
  return { result, skipped: null };
}

/**
 * Finish a period whose message reached the topic on an earlier run but whose
 * chain call did not.
 *
 * This is the state docs/INDEX-SPEC.md section 5 calls resuming at `submit`:
 * the message is published and unretractable, the row exists with `hcs_seq`
 * set and `submit_tx` null, and the retry does the contract call alone. Without
 * it a run that died between the two halves would leave the period published
 * and never settled, and every later run would skip it as already published.
 *
 * Everything sent comes from the stored record, so the resubmission carries the
 * sequence number and the source hash of the message actually on the topic.
 */
async function resumeSubmit(
  options: PipelineOptions,
  existing: ObservationRecord,
  now: Date,
  log: (line: string) => void,
): Promise<SubmitResult | null> {
  if (existing.submit_tx !== null || existing.hcs_seq === null) return null;
  if (options.submitter === null) return null;
  const series = seriesForGroup(options.config, existing.group_key);
  if (series === undefined) return null;

  const submission = await maybeSubmit(
    options,
    {
      groupKey: existing.group_key,
      period: existing.period,
      status: existing.status,
      odi: existing.message.odi,
      ebar: existing.message.ebar,
      sourceHash: existing.message.source_hash,
      hcsSequence: existing.hcs_seq,
    },
    series.seriesId,
    now,
  );
  if (submission.result === null) return null;

  await options.writer.write({ ...existing, submit_tx: submission.result.hash });
  log(
    `${existing.period}  ${existing.group_key.padEnd(32)} resubmitted ${submission.result.hash} ` +
      `gas ${submission.result.gasUsed} for the message already at sequence ${existing.hcs_seq}`,
  );
  return submission.result;
}
