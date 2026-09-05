import {
  addMonths,
  aggregateSeriesId,
  comparePeriods,
  extractRows,
  seriesIdFor,
  sourceHash,
  type Dataset,
  type Observation,
  type Period,
} from '@creance/index-model';

import { seriesForGroup, type OracleConfig } from './config.js';
import { raise, type Notifier } from './alerts.js';
import { assertUnderCap, buildMessage, signMessage, type ObservationMessage } from './message.js';
import { mirrorMessageUrl, topicMessageUrl, type Publisher } from './publisher.js';
import { periodsUsed } from './run.js';
import type { OracleMode } from './state.js';
import type { ObservationRecord, ObservationWriter } from './store.js';

/**
 * The first final rule of docs/INDEX-SPEC.md section 6, as the thing that
 * happens when the source moves under a month that has already settled.
 *
 * The first value published for a period is the settlement value, forever. When
 * a later fetch shows the source changed for a period that was already
 * published, the pipeline publishes a revision record to the index topic
 * referencing the original sequence number, stores it beside the settled row,
 * alerts, and makes no contract call. Settlement never moves. That is what
 * makes the note investable: a noteholder prices the index as published, not as
 * it might be restated.
 *
 * This is not hypothetical at this source. Every series carries a January
 * footnote for the annual population control update, and thirteen of the
 * archived series carry a correction footnote on months in the first half of
 * 2020. Corrections to already published months are routine.
 *
 * What counts as a change is the source hash: the sha256 of the canonical form
 * of the six source rows the computation used. It is what the published message
 * already commits to, so comparing it against the same six rows in a fresh
 * fetch asks exactly the right question, and it needs no second copy of the
 * source to compare against.
 */

/**
 * How far back a fetch is compared against what was published.
 *
 * A period's computation touches t through t-2 and t-12 through t-14, so a
 * change to any of those fifteen calendar months can move a published value.
 * Older months than that cannot, whatever the source does to them.
 */
export const REVISION_WINDOW_MONTHS = 15;

/** A published period whose source rows are no longer the ones it was computed from. */
export interface RevisionCandidate {
  groupKey: string;
  period: Period;
  /** The hash the published message carries. */
  publishedHash: string;
  /** The hash of the same six months in the fetch that just happened. */
  freshHash: string;
  /** The sequence number of the message being revised, when it is known. */
  revisesSeq: number | null;
  /** The row that settled, which is never touched. */
  settled: ObservationRecord;
}

/** The statuses a stored row has when it is a settlement rather than a revision. */
function isSettlement(record: ObservationRecord): boolean {
  return record.status !== 'revision' && record.status !== 'revised';
}

/**
 * Which published periods the source has moved under, newest first.
 *
 * Pure: it reads the store and the dataset and decides nothing about what to do
 * with the answer. A period that was never published produces no candidate,
 * because a source change before the first publication is not a revision, it is
 * a first value that has not happened yet.
 */
export function detectRevisions(options: {
  dataset: Dataset;
  records: readonly ObservationRecord[];
  /** The newest period the fetch carries. The window ends here. */
  latest: Period;
  mode: OracleMode;
}): RevisionCandidate[] {
  const map = options.dataset.map;
  const aggregate = aggregateSeriesId(map);
  const oldest = addMonths(options.latest, -(REVISION_WINDOW_MONTHS - 1));
  const candidates: RevisionCandidate[] = [];

  const settled = options.records.filter(
    (record) =>
      isSettlement(record) &&
      record.mode !== 'scenario' &&
      comparePeriods(record.period, oldest) >= 0 &&
      comparePeriods(record.period, options.latest) <= 0,
  );

  for (const record of settled) {
    // A revision the store already carries for the same fetch is not a second
    // event. Two runs over the same changed source must produce one record.
    const fresh = freshHash(options.dataset, record.group_key, record.period, aggregate);
    if (fresh === null || fresh === record.message.source_hash) continue;
    const already = options.records.find(
      (row) =>
        !isSettlement(row) &&
        row.group_key === record.group_key &&
        row.period === record.period &&
        row.message.source_hash === fresh,
    );
    if (already !== undefined) continue;
    candidates.push({
      groupKey: record.group_key,
      period: record.period,
      publishedHash: record.message.source_hash,
      freshHash: fresh,
      revisesSeq: record.hcs_seq,
      settled: record,
    });
  }
  return candidates;
}

function freshHash(
  dataset: Dataset,
  groupKey: string,
  period: Period,
  aggregate: string,
): string | null {
  let blsSeriesId: string;
  try {
    blsSeriesId = seriesIdFor(groupKey, dataset.map);
  } catch {
    // A group that is no longer in the mapping. The mapping gate owns that
    // failure; a revision check must not turn it into a crash.
    return null;
  }
  return sourceHash(extractRows(dataset, [blsSeriesId, aggregate], periodsUsed(period)));
}

export interface PublishedRevision {
  groupKey: string;
  period: Period;
  revisesSeq: number | null;
  hcsSequence: number;
  hcsUrl: string | null;
  mirrorUrl: string | null;
  bytes: number;
  message: ObservationMessage;
}

export interface RevisionOptions {
  candidates: readonly RevisionCandidate[];
  dataset: Dataset;
  /** The observations of the fresh fetch, group key to rows ascending. */
  observations: ReadonlyMap<string, readonly Observation[]>;
  config: OracleConfig;
  publisher: Publisher;
  writer: ObservationWriter;
  notifier: Notifier;
  keyHex: string;
  modelVersion: string;
  mode: OracleMode;
  runId: number | null;
  topicId?: string | null;
  now: Date;
  log?: (line: string) => void;
}

/**
 * Publish a revision record for each candidate, store it, and alert.
 *
 * No submitter is taken, and that is the point rather than an omission: a
 * revision is published and never settled. The contract would ignore a second
 * observation for the same period anyway, and asking it to is a worse way of
 * saying "settlement never moves" than not asking.
 *
 * The settled row is not touched. The revision is a second row keyed by its
 * status, which is what the unique key of docs/INDEX-SPEC.md section 10 allows
 * for: `(group_key, period, status)`.
 */
export async function publishRevisions(options: RevisionOptions): Promise<PublishedRevision[]> {
  const log = options.log ?? ((): void => {});
  const published: PublishedRevision[] = [];

  for (const candidate of options.candidates) {
    const observation = options.observations
      .get(candidate.groupKey)
      ?.find((row) => row.period === candidate.period);
    if (observation === undefined) {
      // The fetch carries the month, or there would be no hash to compare, so
      // this is a computation that could not be made from it. Say so and leave
      // the settled row alone rather than publishing a record with no numbers.
      log(
        `revision   ${candidate.period}  ${candidate.groupKey} changed at source but could not be recomputed`,
      );
      continue;
    }

    const series = seriesForGroup(options.config, candidate.groupKey) ?? null;
    const message = signMessage(
      buildMessage(observation, {
        seriesLabel: series?.label ?? null,
        blsSeriesId: seriesIdFor(candidate.groupKey, options.dataset.map),
        sourceHash: candidate.freshHash,
        modelVersion: options.modelVersion,
        computedAt: options.now,
        status: 'revision',
        revisesSeq: candidate.revisesSeq,
      }),
      options.keyHex,
    );
    const bytes = assertUnderCap(message);
    const receipt = await options.publisher.publish(bytes);
    const topicId = options.topicId ?? receipt.topicId;

    // The row the specification names `revised`, beside the row that settled
    // and never over it. The message says `revision`, which is the word the v2
    // schema uses; the row says `revised`, which is the word the observations
    // table's status check uses. See docs/DECISIONS.md.
    const record: ObservationRecord = {
      ...candidate.settled,
      u_g: observation.uG,
      u_all: observation.uAll,
      e: observation.e,
      ebar: observation.ebar,
      odi: observation.odi,
      open: observation.open,
      open_reason: observation.openReason,
      status: 'revised',
      model_version: message.model_version,
      hcs_topic: topicId,
      hcs_seq: receipt.sequenceNumber,
      hcs_tx: receipt.transactionId,
      // Null forever. A revision is published and never settled.
      submit_tx: null,
      revises_seq: candidate.revisesSeq,
      source_files: options.dataset.source.files,
      message,
      written_at: `${options.now.toISOString().slice(0, 19)}Z`,
    };
    await options.writer.write(record);

    const live = options.topicId !== null && options.topicId !== undefined;
    published.push({
      groupKey: candidate.groupKey,
      period: candidate.period,
      revisesSeq: candidate.revisesSeq,
      hcsSequence: receipt.sequenceNumber,
      hcsUrl: live ? topicMessageUrl(topicId, receipt.sequenceNumber) : null,
      mirrorUrl: live
        ? mirrorMessageUrl(options.config.mirrorUrl, topicId, receipt.sequenceNumber)
        : null,
      bytes: bytes.byteLength,
      message,
    });

    log(
      `revision   ${candidate.period}  ${candidate.groupKey.padEnd(32)} ` +
        `seq ${receipt.sequenceNumber} revises ${candidate.revisesSeq ?? 'unknown'}, ` +
        'settlement unchanged',
    );
    await raise(
      options.notifier,
      {
        event: 'revision_detected',
        group: candidate.groupKey,
        period: candidate.period,
        message:
          `the source changed for a published period: source hash ${candidate.publishedHash.slice(0, 12)} ` +
          `became ${candidate.freshHash.slice(0, 12)}. A revision record was published; the settled value stands.`,
        run_id: options.runId,
      },
      log,
    );
  }
  return published;
}
