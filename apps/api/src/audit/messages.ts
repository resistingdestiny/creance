import type {
  ClaimDecisionMessage,
  ClaimPacketMessage,
  PayoutMessage,
  PremiumMessage,
} from '@creance/client';

import { encodeTopicMessage } from '../receipts.js';

/// The two payments topic kinds and the two claims topic kinds that have no
/// writer yet, fixed here as version 1.
///
/// Acceptance for T18 names four kinds of entry on the payments topic. Two of
/// them already have writers: `settlement` (apps/api/src/x402) and `coupon`
/// (contracts/coupons), and `policy` sits beside them from T07. The other two,
/// the recurring monthly premium and the claim payout, belong to flows that do
/// not exist yet: T09 owns the premium watcher and T13 owns `payClaim`. The
/// claims topic is the same story, T13 writing the packet hash and T25 the
/// decision.
///
/// So the shapes are settled now rather than invented three times later. Each
/// one is built and published here, tested here, and recorded in
/// docs/DECISIONS.md, and the ticket that grows the flow calls the helper
/// instead of writing its own JSON. The alternative is three writers that
/// disagree about a field name on an append-only topic, which cannot be fixed
/// afterwards.
///
/// The conventions are the ones the topic already carries: a `v`, a `kind`,
/// every amount an integer string in the asset's minor units with the scale
/// beside it, RFC 3339 UTC for the instant, and nothing derived from a person.
///
/// DESIGN.md 3.9 is stricter for the claims topic: "Only the SHA-256 of each
/// file goes to the claims topic". So the claim messages carry hashes, an id
/// and a decision word, and never a file name, an employer, a date of
/// separation or a nullifier.

export const PREMIUM_MESSAGE_VERSION = 1;
export const PAYOUT_MESSAGE_VERSION = 1;
export const CLAIM_MESSAGE_VERSION = 1;

export interface PremiumMessageInput {
  policyId: string;
  /** The month the premium covers, YYYYMM, the form the contracts take. */
  period: number;
  /** The schedule that executed it. A premium is a Scheduled Transaction. */
  scheduleId: string;
  /** The executed transfer, as the mirror node and HashScan want it. */
  transactionId: string;
  amount: string | bigint;
  asset: string;
  decimals: number;
  /** The account the premium left. Already visible on chain in the transfer. */
  payer: string;
  at?: Date;
}

/**
 * A monthly premium that executed.
 *
 * The watcher in packages/client, `scheduleNext`, hands back the schedule id,
 * the policy, the period and the executed transaction id (docs/HEDERA.md,
 * "Scheduled transactions"); this is that tuple on the topic. It is written
 * after execution, never at creation: a schedule that exists is not a payment.
 */
export function premiumMessage(input: PremiumMessageInput): PremiumMessage {
  return {
    v: PREMIUM_MESSAGE_VERSION,
    kind: 'premium',
    policy: input.policyId,
    period: input.period,
    scheduleId: input.scheduleId,
    tx: input.transactionId,
    amount: input.amount.toString(),
    asset: input.asset,
    decimals: input.decimals,
    payer: input.payer,
    at: (input.at ?? new Date()).toISOString(),
  };
}

export interface PayoutMessageInput {
  policyId: string;
  claimId: string;
  /** The packet hash CoverPool.payClaim was called with. */
  packetHash: string;
  /** The decision hash the CLAIMS role signed over. */
  decisionHash: string;
  amount: string | bigint;
  asset: string;
  decimals: number;
  transactionId: string;
  at?: Date;
}

/**
 * A claim paid out of the reserve.
 *
 * Both hashes are on the message because `payClaim` takes both, so a reader
 * can check the payout against the claims topic without asking us: the packet
 * hash appears there when the packet is submitted and the decision hash when
 * the Adjuster decides. Nothing about the person, the employer or the
 * documents is here; the amount and the two hashes are the whole of it.
 */
export function payoutMessage(input: PayoutMessageInput): PayoutMessage {
  return {
    v: PAYOUT_MESSAGE_VERSION,
    kind: 'payout',
    policy: input.policyId,
    claimId: input.claimId,
    packetHash: input.packetHash,
    decisionHash: input.decisionHash,
    amount: input.amount.toString(),
    asset: input.asset,
    decimals: input.decimals,
    tx: input.transactionId,
    at: (input.at ?? new Date()).toISOString(),
  };
}

export interface ClaimPacketMessageInput {
  policyId: string;
  claimId: string;
  packetHash: string;
  /** One SHA-256 per evidence file, in the order the packet lists them. */
  evidence: string[];
  at?: Date;
}

/**
 * A proof of loss packet was submitted. DESIGN.md 3.9.
 *
 * The evidence list is hashes and nothing else. A file name is personal data:
 * "redundancy-letter-acme-2026.pdf" names an employer on a public topic.
 * Hashes are normalised to `sha256:<hex>` so a reader never has to guess which
 * algorithm produced a bare hex string.
 */
export function claimPacketMessage(input: ClaimPacketMessageInput): ClaimPacketMessage {
  return {
    v: CLAIM_MESSAGE_VERSION,
    kind: 'claim_packet',
    policy: input.policyId,
    claimId: input.claimId,
    packetHash: prefixed(input.packetHash),
    evidence: input.evidence.map(prefixed),
    at: (input.at ?? new Date()).toISOString(),
  };
}

export interface ClaimDecisionMessageInput {
  policyId: string;
  claimId: string;
  decisionHash: string;
  decision: 'approve' | 'refer' | 'decline';
  at?: Date;
}

/**
 * The Adjuster decided. The reasons, the confidence and the rule results are
 * in the decision record, which stays in the API's store; its hash is what is
 * published, because a declined claim's reasons are about a person.
 */
export function claimDecisionMessage(input: ClaimDecisionMessageInput): ClaimDecisionMessage {
  return {
    v: CLAIM_MESSAGE_VERSION,
    kind: 'claim_decision',
    policy: input.policyId,
    claimId: input.claimId,
    decisionHash: prefixed(input.decisionHash),
    decision: input.decision,
    at: (input.at ?? new Date()).toISOString(),
  };
}

/** `sha256:` in front, once. A bare 64 character hex string gets the prefix. */
function prefixed(hash: string): string {
  const value = hash.trim();
  return value.startsWith('sha256:') ? value : `sha256:${value}`;
}

/** The size cap, enforced with the same helper the other writers use. */
export { encodeTopicMessage };
