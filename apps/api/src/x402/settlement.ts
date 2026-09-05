import type { FastifyBaseLogger } from 'fastify';

import type { HederaGateway } from '../chain/hedera.js';
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

  /** Wait for the publishes already started. Used by the integration run. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }

  private async run(
    sink: SettlementSink,
    paymentId: string,
    record: SettlementRecord,
    at: Date,
  ): Promise<void> {
    if (sink.hedera === null || sink.paymentsTopicId === '') {
      sink.log.error(
        { payment_id: paymentId, facilitator_tx: record.transactionId },
        'a payment settled but this API has no key for the payments topic',
      );
      return;
    }
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

    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        const receipt = await sink.hedera.publish(sink.paymentsTopicId, message);
        await sink.repository.updatePayment(paymentId, {
          hcsTopic: receipt.topicId,
          hcsSeq: receipt.sequenceNumber,
        });
        return;
      } catch (error) {
        const last = attempt === this.attempts;
        sink.log.error(
          {
            err: error,
            payment_id: paymentId,
            facilitator_tx: record.transactionId,
            attempt,
            giving_up: last,
          },
          last
            ? 'a settled payment is missing from the payments topic and needs reconciling'
            : 'the payments topic refused a settlement message, retrying',
        );
        if (last) return;
        await this.delay(this.backoffMs * 2 ** (attempt - 1));
      }
    }
  }
}
