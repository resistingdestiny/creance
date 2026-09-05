import type { FastifyBaseLogger } from 'fastify';

import type { HederaGateway, TopicReceipt } from '../chain/hedera.js';
import type { PaymentRow, Repository } from '../db/types.js';
import { newId } from '../ids.js';
import { encodeTopicMessage } from '../receipts.js';
import { settlementMessage } from './receipts.js';

/// What happens after the facilitator says the transfer settled.
///
/// Two writes, in this order and for this reason. The `payments` row first,
/// because it is the durable record and it carries the facilitator transaction
/// id, which is the idempotency key this build has: Blocky402 advertises no
/// extensions, so there is no payment-identifier extension to lean on. Then the
/// payments topic message, because DESIGN.md 3.7 wants the audit trail on chain
/// and verifiable without our database.
///
/// A topic publish that fails must not lose the settlement. The money has
/// already moved and the row already says so; the message is retried in the
/// background and every failure is logged with the transaction id, so a
/// reconciliation is a query for settled rows with no sequence number rather
/// than a hunt through logs.

export interface SettlementSink {
  repository: Repository;
  hedera: HederaGateway | null;
  paymentsTopicId: string;
  facilitatorUrl: string;
  log: FastifyBaseLogger;
}

export interface SettlementRecord {
  endpoint: string;
  scheme: string;
  network: string;
  payer: string;
  payTo: string;
  amount: string;
  asset: string;
  assetDecimals: number;
  transactionId: string;
  ref: string | null;
  requestId: string;
}

/**
 * Write the settlement down and publish it.
 *
 * `POST /v1/bind` already wrote its `payments` row at `uncollected` when the
 * policy was reserved (docs/DECISIONS.md, "The first premium is written as
 * uncollected"), so that row is settled rather than a second one being
 * written. Everything else is a new row.
 */
export async function recordSettlement(
  sink: SettlementSink,
  record: SettlementRecord,
  outbox: TopicOutbox,
): Promise<PaymentRow> {
  const settledAt = new Date();

  const already = await sink.repository.paymentByFacilitatorTx(record.transactionId);
  if (already !== null) {
    sink.log.warn(
      { facilitator_tx: record.transactionId, payment_id: already.paymentId },
      'a settlement arrived twice for one facilitator transaction',
    );
    return already;
  }

  const existing =
    record.ref === null
      ? null
      : await sink.repository.paymentByRef(record.endpoint, record.ref);

  let row: PaymentRow;
  if (existing !== null && existing.status === 'uncollected') {
    row = {
      ...existing,
      payer: record.payer,
      facilitator: sink.facilitatorUrl,
      facilitatorTx: record.transactionId,
      status: 'settled',
      settledAt: settledAt.toISOString(),
    };
    await sink.repository.updatePayment(existing.paymentId, {
      payer: row.payer,
      facilitator: row.facilitator,
      facilitatorTx: row.facilitatorTx,
      status: row.status,
      settledAt: row.settledAt,
    });
  } else {
    row = {
      paymentId: newId('payment', settledAt.getTime()),
      endpoint: record.endpoint,
      payer: record.payer,
      payTo: record.payTo,
      amount: record.amount,
      asset: record.asset,
      assetDecimals: record.assetDecimals,
      facilitator: sink.facilitatorUrl,
      facilitatorTx: record.transactionId,
      chainTxId: null,
      status: 'settled',
      ref: record.ref,
      settledAt: settledAt.toISOString(),
      hcsTopic: null,
      hcsSeq: null,
      requestId: record.requestId,
    };
    await sink.repository.insertPayment(row);
  }

  outbox.publish(sink, row.paymentId, record, settledAt);
  return row;
}

/** The premium that did not settle after the policy was already bound. */
export async function recordSettlementFailure(
  sink: SettlementSink,
  input: { endpoint: string; ref: string | null; reason: string; message: string | undefined },
): Promise<void> {
  sink.log.error(
    {
      endpoint: input.endpoint,
      ref: input.ref,
      reason: input.reason,
      facilitator_message: input.message,
    },
    'the facilitator refused to settle a payment for work that was already done',
  );
  if (input.ref === null) return;
  const existing = await sink.repository.paymentByRef(input.endpoint, input.ref);
  if (existing === null || existing.status !== 'uncollected') return;
  await sink.repository.updatePayment(existing.paymentId, { status: 'failed' });
}

/** Anything that can put bytes on a topic. `HederaGateway` is one. */
export interface TopicWriter {
  publish(topicId: string, message: string): Promise<TopicReceipt>;
}

export interface TopicJob {
  /** The client holding the topic's submit key, or null when there is none. */
  writer: TopicWriter | null;
  topicId: string;
  message: string;
  /** What is being published, as a log line says it: "a premium message". */
  describe: string;
  log: FastifyBaseLogger;
  /** Ids for the log, so a failure is a query and not a hunt. */
  context?: Record<string, unknown>;
}

export interface TopicOutboxOptions {
  /** How many times to try the publish in total. */
  attempts?: number;
  /** Milliseconds before the second attempt; doubled on each one after. */
  backoffMs?: number;
  /** Injected in tests so no test ever waits on a real timer. */
  delay?: (ms: number) => Promise<void>;
}

/**
 * The payments topic publisher, with retries.
 *
 * It is deliberately in process and deliberately small. A settled payment whose
 * message did not reach the topic is a row with `status = 'settled'` and a null
 * `hcs_seq`, which is a query, so the worst case of losing the retries to a
 * restart is a reconciliation and not a lost payment. The bind route's comment
 * asked for this to arrive with the settlement hook, and this is it.
 */
export class TopicOutbox {
  private readonly attempts: number;
  private readonly backoffMs: number;
  private readonly delay: (ms: number) => Promise<void>;
  /** Every publish in flight, so a caller can wait for a quiet shutdown. */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(options: TopicOutboxOptions = {}) {
    this.attempts = options.attempts ?? 3;
    this.backoffMs = options.backoffMs ?? 250;
    this.delay =
      options.delay ??
      ((ms) =>
        new Promise((resolve) => {
          // Unreferenced: a pending retry must never hold the process open.
          setTimeout(resolve, ms).unref?.();
        }));
  }

  publish(
    sink: SettlementSink,
    paymentId: string,
    record: SettlementRecord,
    at: Date,
  ): void {
    const task = this.run(sink, paymentId, record, at).finally(() => {
      this.inFlight.delete(task);
    });
    this.inFlight.add(task);
  }

  /**
   * One message on one topic, with the same retries and the same backoff, for
   * a caller that wants the receipt rather than a background write.
   *
   * The settlement path cannot wait for its publish: the money has moved and
   * the response is owed. A premium, a payout or a claim message has a caller
   * that stores the sequence number it gets back, so it waits. Both go through
   * the same loop, so there is one retry policy in this API and not two.
   *
   * The writer is passed in rather than read from a sink because the claims
   * topic's submit key is the adjuster's while this process holds the api key:
   * whoever has the key hands in the client that holds it. A null writer, or an
   * unset topic id, is a logged refusal and a null result, never a throw,
   * because whatever the message describes has already happened.
   */
  async send(job: TopicJob): Promise<TopicReceipt | null> {
    const task = this.deliver(job);
    const tracked: Promise<void> = task.then(
      () => undefined,
      () => undefined,
    ).finally(() => {
      this.inFlight.delete(tracked);
    });
    this.inFlight.add(tracked);
    return await task;
  }

  /** Wait for the publishes already started. Used by the integration run. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }

  private async deliver(job: TopicJob): Promise<TopicReceipt | null> {
    if (job.writer === null || job.topicId === '') {
      job.log.error(
        { ...job.context, topic_id: job.topicId },
        `${job.describe} cannot be published: this process has no key for that topic`,
      );
      return null;
    }
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        return await job.writer.publish(job.topicId, job.message);
      } catch (error) {
        const last = attempt === this.attempts;
        job.log.error(
          { ...job.context, err: error, topic_id: job.topicId, attempt, giving_up: last },
          last
            ? `${job.describe} is missing from the topic and needs reconciling`
            : `the topic refused ${job.describe}, retrying`,
        );
        if (last) return null;
        await this.delay(this.backoffMs * 2 ** (attempt - 1));
      }
    }
    return null;
  }

  private async run(
    sink: SettlementSink,
    paymentId: string,
    record: SettlementRecord,
    at: Date,
  ): Promise<void> {
    const message = encodeTopicMessage(
      settlementMessage({
        endpoint: record.endpoint,
        scheme: record.scheme,
        network: record.network,
        payer: record.payer,
        payTo: record.payTo,
        amount: record.amount,
        asset: record.asset,
        decimals: record.assetDecimals,
        transactionId: record.transactionId,
        facilitator: sink.facilitatorUrl,
        ref: record.ref,
        at,
      }),
    );

    const receipt = await this.deliver({
      writer: sink.hedera,
      topicId: sink.paymentsTopicId,
      message,
      describe: 'a settled payment',
      log: sink.log,
      context: { payment_id: paymentId, facilitator_tx: record.transactionId },
    });
    // A null is already logged, and the row still says the payment settled, so
    // reconciling it is a query for settled rows with no sequence number.
    if (receipt === null) return;
    await sink.repository.updatePayment(paymentId, {
      hcsTopic: receipt.topicId,
      hcsSeq: receipt.sequenceNumber,
    });
  }
}
