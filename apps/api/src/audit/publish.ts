import type { FastifyBaseLogger } from 'fastify';

import type { TopicReceipt } from '../chain/hedera.js';
import { encodeTopicMessage } from '../receipts.js';
import type { TopicOutbox, TopicWriter } from '../x402/settlement.js';
import {
  claimDecisionMessage,
  claimPacketMessage,
  payoutMessage,
  premiumMessage,
  type ClaimDecisionMessageInput,
  type ClaimPacketMessageInput,
  type PayoutMessageInput,
  type PremiumMessageInput,
} from './messages.js';

/// Publishing the four kinds that have no flow yet.
///
/// Each helper builds its message, enforces the roughly 1 KB HCS cap and hands
/// it to the outbox, which is the retry path the settlement hook already uses.
/// The caller gets the receipt, because the sequence number belongs in the row
/// the caller is about to write: `payments.hcs_seq` for a premium,
/// `claims.hcs_submitted_seq` and `claims.hcs_decision_seq` for the two claim
/// messages, `claims.paid_tx` beside the payout.
///
/// The sink carries the writer rather than reading a global one, and that is
/// the whole point of the shape. The payments topic's submit key is the api
/// account's, so the API publishes premiums and payouts with the client it
/// already has. The claims topic's submit key is the adjuster's
/// (docs/HEDERA.md, Topics), so the API cannot write it at all: apps/adjuster
/// builds a client with its own key and hands it in. A null writer is a logged
/// refusal, so a deployment with no key serves every read and loses no work it
/// was going to do.

export interface AuditSink {
  /** The client holding this topic's submit key, or null when none is held. */
  writer: TopicWriter | null;
  topicId: string;
  log: FastifyBaseLogger;
  outbox: TopicOutbox;
}

/** A monthly premium that executed. T09's watcher is the caller. */
export async function publishPremium(
  sink: AuditSink,
  input: PremiumMessageInput,
): Promise<TopicReceipt | null> {
  return await send(sink, 'a premium message', encodeTopicMessage(premiumMessage(input)), {
    policy_id: input.policyId,
    period: input.period,
    schedule_id: input.scheduleId,
  });
}

/** A claim paid out of the reserve. T13's payClaim is the caller. */
export async function publishPayout(
  sink: AuditSink,
  input: PayoutMessageInput,
): Promise<TopicReceipt | null> {
  return await send(sink, 'a payout message', encodeTopicMessage(payoutMessage(input)), {
    policy_id: input.policyId,
    claim_id: input.claimId,
  });
}

/** A proof of loss packet was submitted. T13 is the caller, with its own key. */
export async function publishClaimPacket(
  sink: AuditSink,
  input: ClaimPacketMessageInput,
): Promise<TopicReceipt | null> {
  return await send(sink, 'a claim packet hash', encodeTopicMessage(claimPacketMessage(input)), {
    policy_id: input.policyId,
    claim_id: input.claimId,
  });
}

/** The Adjuster decided. T25 is the caller, with the adjuster key. */
export async function publishClaimDecision(
  sink: AuditSink,
  input: ClaimDecisionMessageInput,
): Promise<TopicReceipt | null> {
  return await send(
    sink,
    'a claim decision hash',
    encodeTopicMessage(claimDecisionMessage(input)),
    { policy_id: input.policyId, claim_id: input.claimId, decision: input.decision },
  );
}

function send(
  sink: AuditSink,
  describe: string,
  message: string,
  context: Record<string, unknown>,
): Promise<TopicReceipt | null> {
  return sink.outbox.send({
    writer: sink.writer,
    topicId: sink.topicId,
    message,
    describe,
    log: sink.log,
    context,
  });
}
