import {
  auditFacts,
  decodeMessage,
  hashscanUrl,
  money,
  parseTopicMessage,
  type MirrorClient,
  type MirrorTopicMessage,
  type Money,
  type TopicAuditMessage,
} from '@creance/client';

import type { ApiConfig } from '../config.js';
import type { ClaimAuditRow, PaymentRow, PolicyRow } from '../db/types.js';
import { rfc3339 } from '../views.js';

/// The audit trail for one policy, assembled from the topics and not from us.
///
/// DESIGN.md 3.7 asks for an audit trail that is verifiable independently of
/// our database. That decides the direction of every read here. The database
/// holds the index into the topics, the sequence numbers written when each
/// message was published; the message bodies come back from the mirror node.
/// So the response says what is on chain, and a row that claims something the
/// topic does not carry cannot make this endpoint say it.
///
/// Four markers say where an entry came from, and they are the honest part of
/// the design:
///
///   topic              read back from the mirror node, message body and all
///   awaiting_mirror    published, sequence number known, mirror not there yet
///   not_yet_on_topic   the row exists and no message does, which is exactly
///                      the settled payment whose publish failed
///                      (docs/DECISIONS.md, T08)
///   mirror_unavailable the mirror node could not be read at all
///
/// Nothing personal leaves here. No nullifier, no EVM address, no evidence file
/// name, no employer, no separation date. The account ids that remain are the
/// ones already visible in the transfers on chain.

export type AuditSource = 'topic' | 'awaiting_mirror' | 'not_yet_on_topic' | 'mirror_unavailable';

export interface AuditLink {
  id: string;
  hashscan: string;
}

export interface AuditHcsView {
  topic_id: string;
  sequence_number: number | null;
  consensus_at: string | null;
  hashscan: string;
}

export interface AuditEntryView {
  kind: string;
  source: AuditSource;
  at: string | null;
  amount: Money | null;
  hcs: AuditHcsView | null;
  tx: AuditLink | null;
  /** The fields this kind carries, whitelisted per kind. */
  detail: Record<string, unknown>;
}

export interface AuditView {
  policy_id: string;
  series_id: string;
  group: string;
  status: string;
  summary: {
    payments_topic: AuditLink | null;
    claims_topic: AuditLink | null;
    policy_nft: { token_id: string | null; serial: number | null; hashscan: string | null };
    bind_transaction: AuditLink | null;
    cover_pool: AuditLink;
    entries: number;
    entries_on_topic: number;
  };
  entries: AuditEntryView[];
}

export interface AuditInput {
  policy: PolicyRow;
  payments: PaymentRow[];
  claims: ClaimAuditRow[];
  config: ApiConfig;
  mirror: MirrorClient;
}

/** How far past the binding receipt to read for the message that resolves it. */
const RECEIPT_WINDOW = 10;

export async function buildAuditTrail(input: AuditInput): Promise<AuditView> {
  const entries: AuditEntryView[] = [];
  for (const entry of await policyEntries(input)) entries.push(entry);
  for (const payment of input.payments) entries.push(await paymentEntry(input, payment));
  for (const entry of await claimEntries(input)) entries.push(entry);

  entries.sort((a, b) => order(a) - order(b));

  const { policy, config } = input;
  return {
    policy_id: policy.policyId,
    series_id: policy.seriesId,
    group: policy.groupKey,
    status: policy.status,
    summary: {
      payments_topic: topicLink(config.paymentsTopicId),
      claims_topic: topicLink(config.claimsTopicId),
      policy_nft: {
        token_id: policy.nftTokenId,
        serial: policy.nftSerial,
        hashscan:
          policy.nftTokenId === null || policy.nftSerial === null
            ? null
            : `${hashscanUrl('token', policy.nftTokenId)}/${policy.nftSerial}`,
      },
      bind_transaction:
        policy.bindTxId === null
          ? null
          : { id: policy.bindTxId, hashscan: hashscanUrl('transaction', policy.bindTxId) },
      cover_pool: {
        id: config.coverPoolAddress,
        hashscan: hashscanUrl('contract', config.coverPoolAddress),
      },
      entries: entries.length,
      entries_on_topic: entries.filter((entry) => entry.source === 'topic').length,
    },
    entries,
  };
}

// -- The policy's own messages -----------------------------------------------

/**
 * The binding receipt and the message that resolves it.
 *
 * Only the first sequence number is stored, because the bind quotes it before
 * the contract call (docs/DECISIONS.md, T07, "A bind writes two topic messages,
 * not one"). The second is found by reading the window after it and keeping
 * the policy messages that name this policy, which is also the check that the
 * stored sequence number points where the row says it does.
 */
async function policyEntries(input: AuditInput): Promise<AuditEntryView[]> {
  const { policy, config } = input;
  const topicId = policy.hcsTopic ?? config.paymentsTopicId;
  if (policy.hcsReceiptSeq === null) {
    return [
      {
        kind: 'policy',
        source: 'not_yet_on_topic',
        at: rfc3339(policy.startsAt),
        amount: money(policy.premium, policy.asset, policy.assetDecimals),
        hcs: topicId === '' ? null : blankHcs(topicId),
        tx: null,
        detail: { status: policy.status, series: policy.seriesId, group: policy.groupKey },
      },
    ];
  }

  let window: MirrorTopicMessage[] | null;
  try {
    window = await input.mirror.topicMessagesFrom(topicId, policy.hcsReceiptSeq, RECEIPT_WINDOW);
  } catch {
    window = null;
  }
  if (window === null) {
    return [unreadable('policy', topicId, policy.hcsReceiptSeq)];
  }

  const mine = window
    .map((message) => ({ message, body: parseTopicMessage(decodeMessage(message)) }))
    .filter(({ body }) => body.kind === 'policy' && auditFacts(body).policy === policy.policyId);

  if (mine.length === 0) {
    return [
      {
        ...unreadable('policy', topicId, policy.hcsReceiptSeq),
        source: 'awaiting_mirror',
        at: rfc3339(policy.startsAt),
      },
    ];
  }
  return mine.map(({ message, body }) => entryFrom(input, body, message));
}

// -- The payments ------------------------------------------------------------

const PAYMENT_KINDS = new Set(['settlement', 'premium', 'payout', 'coupon']);

/**
 * One payment, read back from the topic where there is a message for it.
 *
 * The sequence number on a payments row does not always point at a payment
 * message. `POST /v1/bind` writes the first premium as `uncollected` and points
 * it at the binding receipt, because that is the only message on the topic at
 * that moment; the settlement hook overwrites the pointer when the transfer
 * settles (docs/DECISIONS.md, T18). So the kind that comes back decides: a
 * message that is not a payment leaves the entry on the row, and the policy
 * receipt is not reported twice.
 */
async function paymentEntry(input: AuditInput, row: PaymentRow): Promise<AuditEntryView> {
  const topicId = row.hcsTopic ?? input.config.paymentsTopicId;
  if (row.hcsSeq === null) {
    // A settled payment with no sequence number is the row the T08 decision
    // describes: the money moved and the publish did not. It is shown, marked.
    return { ...fromPaymentRow(row), source: 'not_yet_on_topic', hcs: blankHcs(topicId) };
  }

  let message: MirrorTopicMessage | null;
  try {
    message = await input.mirror.topicMessage(topicId, row.hcsSeq);
  } catch {
    return { ...fromPaymentRow(row), source: 'mirror_unavailable', hcs: seqHcs(topicId, row.hcsSeq) };
  }
  if (message === null) {
    return { ...fromPaymentRow(row), source: 'awaiting_mirror', hcs: seqHcs(topicId, row.hcsSeq) };
  }
  const body = parseTopicMessage(decodeMessage(message));
  if (!PAYMENT_KINDS.has(body.kind)) {
    return { ...fromPaymentRow(row), source: 'not_yet_on_topic', hcs: blankHcs(topicId) };
  }
  return entryFrom(input, body, message);
}

function fromPaymentRow(row: PaymentRow): AuditEntryView {
  return {
    kind: 'settlement',
    source: 'not_yet_on_topic',
    at: row.settledAt === null ? null : rfc3339(row.settledAt),
    amount: money(row.amount, row.asset, row.assetDecimals),
    hcs: null,
    tx:
      row.facilitatorTx === null
        ? null
        : { id: row.facilitatorTx, hashscan: hashscanUrl('transaction', mirrorForm(row.facilitatorTx)) },
    detail: {
      endpoint: row.endpoint,
      payer: row.payer,
      pay_to: row.payTo,
      facilitator: row.facilitator,
      ref: row.ref,
      payment_status: row.status,
    },
  };
}

// -- The claims --------------------------------------------------------------

/**
 * The packet hash and the decision hash, from the claims topic.
 *
 * The claims topic is read here and never written: its submit key is the
 * adjuster's. A payout is not read from a claim row either, because a payout is
 * a payment and T13 writes it as one (docs/DECISIONS.md, T18), so it arrives
 * through the payments above with a sequence number of its own.
 */
async function claimEntries(input: AuditInput): Promise<AuditEntryView[]> {
  const topicId = input.config.claimsTopicId;
  const entries: AuditEntryView[] = [];
  for (const claim of input.claims) {
    if (claim.packetHash !== null) {
      entries.push(
        await claimEntry(input, topicId, claim.hcsSubmittedSeq, {
          kind: 'claim_packet',
          at: claim.submittedAt,
          detail: { claim_id: claim.claimId, packet_hash: claim.packetHash },
        }),
      );
    }
    if (claim.decisionHash !== null) {
      entries.push(
        await claimEntry(input, topicId, claim.hcsDecisionSeq, {
          kind: 'claim_decision',
          at: claim.decidedAt,
          detail: {
            claim_id: claim.claimId,
            decision: claim.decision,
            decision_hash: claim.decisionHash,
          },
        }),
      );
    }
  }
  return entries;
}

async function claimEntry(
  input: AuditInput,
  topicId: string,
  sequenceNumber: number | null,
  fallback: { kind: string; at: string | null; detail: Record<string, unknown> },
): Promise<AuditEntryView> {
  const row: AuditEntryView = {
    kind: fallback.kind,
    source: 'not_yet_on_topic',
    at: fallback.at === null ? null : rfc3339(fallback.at),
    amount: null,
    hcs: topicId === '' ? null : blankHcs(topicId),
    tx: null,
    detail: fallback.detail,
  };
  if (sequenceNumber === null || topicId === '') return row;
  let message: MirrorTopicMessage | null;
  try {
    message = await input.mirror.topicMessage(topicId, sequenceNumber);
  } catch {
    return { ...row, source: 'mirror_unavailable', hcs: seqHcs(topicId, sequenceNumber) };
  }
  if (message === null) {
    return { ...row, source: 'awaiting_mirror', hcs: seqHcs(topicId, sequenceNumber) };
  }
  return entryFrom(input, parseTopicMessage(decodeMessage(message)), message);
}

// -- One message, as an entry ------------------------------------------------

function entryFrom(
  input: AuditInput,
  body: TopicAuditMessage,
  message: MirrorTopicMessage,
): AuditEntryView {
  const facts = auditFacts(body);
  const consensus = instantOf(message.consensus_timestamp);
  return {
    kind: facts.kind,
    source: 'topic',
    at: facts.at === null ? consensus : instantOf(facts.at),
    amount: amountOf(input.config, facts.amount),
    hcs: {
      topic_id: message.topic_id,
      sequence_number: message.sequence_number,
      consensus_at: consensus,
      hashscan: hashscanUrl('topic', message.topic_id),
    },
    tx:
      facts.transactionId === null
        ? null
        : {
            id: facts.transactionId,
            hashscan: hashscanUrl('transaction', mirrorForm(facts.transactionId)),
          },
    detail: detailOf(body),
  };
}

/**
 * The fields each kind contributes, named one by one.
 *
 * A whitelist rather than a copy of the message, for the same reason the policy
 * view is a whitelist: this endpoint is free, and a field nobody listed here
 * cannot leak out of it. The holder's EVM address is on two of the messages and
 * is dropped by exactly this.
 */
function detailOf(body: TopicAuditMessage): Record<string, unknown> {
  switch (body.kind) {
    case 'coupon':
      return {
        series: body.series,
        coupon_id: body.couponId,
        holder: body.holder,
        schedule_id: body.scheduleId,
        result: body.result,
      };
    case 'policy':
      return body.status === 'binding'
        ? {
            status: body.status,
            series: body.series,
            group: body.group,
            cover_limit: body.limit,
            cover_starts: body.startAt,
          }
        : {
            status: body.status,
            series: body.series,
            receipt_sequence_number: body.receiptSeq,
            nft: { token_id: body.nft ?? null, serial: body.serial ?? null },
            ...(body.reason === undefined ? {} : { reason: body.reason }),
          };
    case 'settlement':
      return {
        endpoint: body.endpoint,
        scheme: body.scheme,
        network: body.network,
        payer: body.payer,
        pay_to: body.payTo,
        facilitator: body.facilitator,
        ref: body.ref ?? null,
      };
    case 'premium':
      return { period: periodLabel(body.period), schedule_id: body.scheduleId, payer: body.payer };
    case 'payout':
      return {
        claim_id: body.claimId,
        packet_hash: body.packetHash,
        decision_hash: body.decisionHash,
      };
    case 'claim_packet':
      return {
        claim_id: body.claimId,
        packet_hash: body.packetHash,
        evidence: body.evidence,
      };
    case 'claim_decision':
      return {
        claim_id: body.claimId,
        decision: body.decision,
        decision_hash: body.decisionHash,
      };
    default:
      // A kind written by something newer than this reader. It is shown as a
      // sequence number and a link, and its body is not guessed at.
      return { declared_kind: body.declaredKind };
  }
}

// -- Small conversions -------------------------------------------------------

function amountOf(
  config: ApiConfig,
  amount: { amount: string; asset: string | null; decimals: number | null } | null,
): Money | null {
  if (amount === null) return null;
  const asset = amount.asset ?? config.settlementToken.tokenId;
  const decimals =
    amount.decimals ??
    (asset === config.settlementToken.tokenId ? config.settlementToken.decimals : null);
  if (decimals === null) return null;
  return money(amount.amount, asset, decimals);
}

/**
 * RFC 3339 in UTC, from either form a message carries.
 *
 * The settlement, policy, premium and payout messages stamp an ISO instant.
 * The coupon writer stamps the consensus timestamp of the transfer,
 * `seconds.nanos`, which is what the mirror node hands it. Both are turned into
 * the one form every other endpoint returns.
 */
export function instantOf(value: string): string {
  const consensus = /^(\d+)\.(\d+)$/.exec(value.trim());
  if (consensus) return rfc3339(new Date(Number(consensus[1]) * 1000));
  return rfc3339(value);
}

/** HashScan and the mirror node want `0.0.x-seconds-nanos`, never the `@` form. */
function mirrorForm(transactionId: string): string {
  return transactionId.includes('@')
    ? transactionId.replace('@', '-').replace(/\.(\d+)$/, '-$1')
    : transactionId;
}

function topicLink(topicId: string): AuditLink | null {
  return topicId === '' ? null : { id: topicId, hashscan: hashscanUrl('topic', topicId) };
}

function seqHcs(topicId: string, sequenceNumber: number): AuditHcsView {
  return { ...blankHcs(topicId), sequence_number: sequenceNumber };
}

function blankHcs(topicId: string): AuditHcsView {
  return {
    topic_id: topicId,
    sequence_number: null,
    consensus_at: null,
    hashscan: hashscanUrl('topic', topicId),
  };
}

function unreadable(kind: string, topicId: string, sequenceNumber: number): AuditEntryView {
  return {
    kind,
    source: 'mirror_unavailable',
    at: null,
    amount: null,
    hcs: { ...blankHcs(topicId), sequence_number: sequenceNumber },
    tx: null,
    detail: {},
  };
}

/** `202609` reads as `2026-09`, the form every other period takes on the wire. */
function periodLabel(period: number): string {
  const month = period % 100;
  return `${(period - month) / 100}-${String(month).padStart(2, '0')}`;
}

/** Oldest first: consensus order where there is one, then the row's own time. */
function order(entry: AuditEntryView): number {
  const at = entry.hcs?.consensus_at ?? entry.at;
  return at === null ? Number.MAX_SAFE_INTEGER : Date.parse(at);
}
