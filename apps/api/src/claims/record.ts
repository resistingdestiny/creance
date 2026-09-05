import { createHash } from 'node:crypto';

import { canonicalize, type JsonValue } from '@creance/index-model';

import type { ClaimRow } from '../db/types.js';

/// The decision record a human decision produces.
///
/// The Adjuster builds its own record and posts it. A reviewer posts a decision
/// and one plain sentence, so the record is composed here, because a decision
/// with no record is a decision nothing can pay: the CLAIMS role signs over
/// `decisionHash` and there has to be a preimage behind it.
///
/// It obeys the same rule every record obeys: no name, no employer, no job
/// title, no file name, no nullifier. The reviewer's sentence is not in it
/// either, only its hash, so the record proves a note existed without
/// publishing one person's words about another.

export interface ReviewerRecordInput {
  claim: ClaimRow;
  decision: 'approve' | 'refer' | 'decline';
  reasons: string[];
  /** The sentence the person will read. Hashed here, never stored in full. */
  note: string;
  actor: string;
  amount: string | null;
  asset: { id: string; decimals: number };
  decidedAt: string;
}

export function reviewerRecord(input: ReviewerRecordInput): Record<string, unknown> {
  const previous = input.claim.decisionRecord ?? {};
  const ruleResults = Array.isArray(previous['rule_results'])
    ? (previous['rule_results'] as { rule?: string; status?: string }[])
    : [];
  // What a reviewer decided against: the rules that referred the claim to them
  // in the first place. A hard failure is never in this list, because nobody
  // approves past one.
  const overrode = ruleResults
    .filter((result) => result.status === 'fail_soft' || result.status === 'not_evaluated')
    .map((result) => result.rule ?? '?');

  const engine = (previous['engine'] ?? {}) as { rules_version?: string };

  return {
    v: 1,
    type: 'adjuster_decision',
    claim_id: input.claim.claimId,
    policy_id: input.claim.policyId,
    series_id: input.claim.seriesId,
    packet_hash: input.claim.packetHash,
    actor: input.actor,
    decided_at: input.decidedAt,
    engine: {
      rules_version: engine.rules_version ?? null,
      extraction_schema: null,
      prompt_version: null,
      // A reviewer ran no model.
      model: null,
      effort: null,
    },
    decision: input.decision,
    reasons: input.reasons,
    amount:
      input.amount === null
        ? null
        : { amount: input.amount, asset: input.asset.id, decimals: input.asset.decimals },
    separation_month: input.claim.separationDate.slice(0, 7),
    qualifying_month:
      input.claim.qualifyingMonth === null || input.claim.qualifyingMonth === 0
        ? null
        : periodString(input.claim.qualifyingMonth),
    open_months_considered: Array.isArray(previous['open_months_considered'])
      ? previous['open_months_considered']
      : [],
    claim_deadline: input.claim.claimDeadline,
    // A reviewer is not bound by the confidence threshold, so a human decision
    // reports no confidence rather than borrowing the machine's number.
    confidence: null,
    confidence_components: null,
    evidence: Array.isArray(previous['evidence']) ? previous['evidence'] : [],
    rule_results: ruleResults,
    human: {
      reviewed_at: input.decidedAt,
      overrode,
      note_hash: `sha256:${createHash('sha256').update(input.note, 'utf8').digest('hex')}`,
    },
    // A corrected decision is a new decision, never an edit. Two records, two
    // hashes, both on the topic, in order.
    ...(input.claim.decisionHash === null ? {} : { supersedes: input.claim.decisionHash }),
  };
}

/** `sha256:` plus the hex digest of the JCS form. The one definition. */
export function hashRecord(record: Record<string, unknown>): string {
  return `sha256:${createHash('sha256')
    .update(canonicalize(record as JsonValue), 'utf8')
    .digest('hex')}`;
}

function periodString(period: number): string {
  const text = String(period).padStart(6, '0');
  return `${text.slice(0, 4)}-${text.slice(4)}`;
}
