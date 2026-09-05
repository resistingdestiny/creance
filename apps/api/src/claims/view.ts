import { createHash } from 'node:crypto';

import type { LossWindow } from '../chain/cover-pool.js';
import type { ClaimEvidenceRow, ClaimRow, PolicyRow, SeriesRow } from '../db/types.js';
import { openField, type EvidenceKeys } from './evidence.js';

/// The admin payload, and the one place a sealed attestation field is opened.
///
/// This is the only response in the API that carries an employer name, a
/// claimant's name or a separation date. It is behind the admin token, it is
/// never rendered by the worker flow, and the free audit trail reads a separate
/// projection so that it cannot reach any of this by accident.

export interface AdminClaimView {
  claim_id: string;
  policy_id: string;
  series_id: string;
  status: string;
  submitted_at: string;
  packet_hash: string | null;
  nullifier: string;
  attestation: {
    full_name: string | null;
    employer_name: string;
    job_title: string;
    group: string;
    last_day_of_work: string;
    separation_type: string;
    statement_accepted: boolean;
    method: string | null;
    signature_verified: boolean;
  };
  world: { presence: boolean; verified_at: string | null; action: string };
  evidence: {
    evidence_id: string;
    kind: string;
    filename: string;
    content_type: string;
    size: number;
    sha256: string;
    sha256_seen_in_other_claims: boolean;
    href: string;
  }[];
  policy: Record<string, unknown>;
  series: Record<string, unknown>;
  window: {
    open_months: string[];
    last_observed_month: string | null;
    qualifying_month: string | null;
    claim_deadline: string | null;
  };
  prior_claims: number;
  decision: string | null;
  reasons: string[];
  /** The sentences the person will read. Here and in no free response. */
  reason_lines: { code: string; line: string }[];
  resubmit: { allowed: boolean; why: string } | null;
  decision_record: Record<string, unknown> | null;
}

/** The action a claim's live person check is scoped to. DESIGN.md 3.6. */
export const CLAIM_ACTION = 'occupation-cover-claim';

export interface AdminClaimInput {
  claim: ClaimRow;
  policy: PolicyRow;
  series: SeriesRow;
  evidence: ClaimEvidenceRow[];
  seenElsewhere: Set<string>;
  window: LossWindow;
  priorClaims: number;
  keys: EvidenceKeys | null;
  claimAction?: string;
}

export function adminClaimView(input: AdminClaimInput): AdminClaimView {
  const { claim, policy, series } = input;
  return {
    claim_id: claim.claimId,
    policy_id: claim.policyId,
    series_id: claim.seriesId,
    status: claim.status,
    submitted_at: claim.submittedAt ?? claim.separationDate,
    packet_hash: claim.packetHash,
    nullifier: claim.nullifier,
    attestation: {
      full_name: unseal(input.keys, claim.claimantNameEnc),
      employer_name: unseal(input.keys, claim.employerNameEnc) ?? '',
      job_title: claim.jobTitle ?? '',
      group: claim.groupKey,
      last_day_of_work: claim.separationDate,
      separation_type: claim.separationType,
      statement_accepted: claim.statementAccepted,
      method: claim.attestationMethod,
      signature_verified: claim.attestationVerified,
    },
    // What the proof carried, not what was asked for. Rules R01 and R03 read
    // these, and requesting a liveness check and receiving one are two
    // different facts. A claim written before 003 has neither, so the constant
    // and the verified-at fallback stay behind them.
    world: {
      presence: claim.worldPresence || claim.verifiedAt !== null,
      verified_at: claim.verifiedAt,
      action: claim.worldAction ?? input.claimAction ?? CLAIM_ACTION,
    },
    evidence: input.evidence.map((file) => ({
      evidence_id: file.evidenceId,
      kind: file.kind,
      filename: file.filename,
      content_type: file.contentType,
      size: file.sizeBytes,
      sha256: file.sha256,
      sha256_seen_in_other_claims: input.seenElsewhere.has(file.sha256),
      href: `/v1/admin/claims/${claim.claimId}/evidence/${file.evidenceId}`,
    })),
    policy: {
      policy_id: policy.policyId,
      series_id: policy.seriesId,
      group: policy.groupKey,
      limit: policy.coverLimit,
      asset: policy.asset,
      asset_decimals: policy.assetDecimals,
      starts_at: policy.startsAt,
      ends_at: policy.endsAt,
      claims_payable_from: policy.claimsPayableFrom,
      status: policy.status,
      nullifier: policy.nullifier,
    },
    series: {
      series_id: series.seriesId,
      payout_mode: series.payoutMode,
      lookback_months: series.lookbackMonths,
      waiting_period_days: series.waitingPeriodDays,
      claim_window_obs_days: series.claimWindowObsDays,
      claim_window_sep_days: series.claimWindowSepDays,
      auto_approval_limit: series.autoApprovalLimit,
      auto_approval_confidence: series.autoApprovalConfidence,
    },
    window: {
      open_months: input.window.openMonths.map(periodString),
      last_observed_month:
        input.window.lastObservedMonth === 0 ? null : periodString(input.window.lastObservedMonth),
      qualifying_month:
        claim.qualifyingMonth === null || claim.qualifyingMonth === 0
          ? null
          : periodString(claim.qualifyingMonth),
      claim_deadline: claim.claimDeadline,
    },
    prior_claims: input.priorClaims,
    decision: claim.decision,
    reasons: claim.reasons,
    reason_lines: claim.reasonLines,
    resubmit: claim.resubmit,
    decision_record: claim.decisionRecord,
  };
}

/** The queue row. Everything about a person stays on the detail endpoint. */
export interface AdminClaimSummaryView {
  claim_id: string;
  policy_id: string;
  series_id: string;
  status: string;
  submitted_at: string | null;
  decision: string | null;
  confidence: string | null;
  reasons: string[];
  overdue: boolean;
}

/** A claim waiting for a human for more than a working day is flagged, never decided. */
export const OVERDUE_MS = 24 * 60 * 60 * 1000;

export function adminClaimSummary(claim: ClaimRow, now: Date): AdminClaimSummaryView {
  const waiting = claim.submittedAt === null ? 0 : now.getTime() - Date.parse(claim.submittedAt);
  return {
    claim_id: claim.claimId,
    policy_id: claim.policyId,
    series_id: claim.seriesId,
    status: claim.status,
    submitted_at: claim.submittedAt,
    decision: claim.decision,
    confidence: claim.confidence,
    reasons: claim.reasons,
    overdue: claim.status === 'under_review' && waiting > OVERDUE_MS,
  };
}

/** YYYYMM to YYYY-MM, which is what every window rule and every screen reads. */
export function periodString(period: number): string {
  const text = String(period).padStart(6, '0');
  return `${text.slice(0, 4)}-${text.slice(4)}`;
}

/** `sha256(lower(trim(value)))`, the packet manifest's one definition. */
export function fieldHash(value: string): string {
  return `sha256:${createHash('sha256').update(value.trim().toLowerCase(), 'utf8').digest('hex')}`;
}

function unseal(keys: EvidenceKeys | null, blob: Buffer | null): string | null {
  if (keys === null || blob === null || blob.byteLength === 0) return null;
  return openField(keys, blob);
}
