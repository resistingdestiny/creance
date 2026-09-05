import type { AdminClaim } from './api.js';
import type { ExtractionResult } from './extraction.js';
import type { RuleInput, SeparationType } from './rules.js';

/// The admin payload as the rule engine takes it.
///
/// One mapping, in one place, used by the live pass and by the fixtures, so a
/// fixture proves something about the code that runs against the API rather
/// than about a shape invented for a test.

export function toRuleInput(
  claim: AdminClaim,
  extractions: Record<string, ExtractionResult>,
  now: string,
): RuleInput {
  return {
    claim: {
      claimId: claim.claim_id,
      status: claim.status,
      submittedAt: claim.submitted_at,
      packetHash: claim.packet_hash,
      nullifier: claim.nullifier,
      world: { presence: claim.world.presence, action: claim.world.action },
    },
    attestation: {
      fullName: claim.attestation.full_name,
      employerName: claim.attestation.employer_name,
      jobTitle: claim.attestation.job_title,
      group: claim.attestation.group,
      lastDayOfWork: claim.attestation.last_day_of_work,
      separationType: claim.attestation.separation_type as SeparationType,
      statementAccepted: claim.attestation.statement_accepted,
      // A claim taken before either wallet signing method worked is recorded as
      // a click-through, which is weaker evidence and not a broken flow.
      method: claim.attestation.method ?? 'unsigned_accepted',
      signatureVerified: claim.attestation.signature_verified,
    },
    policy: {
      policyId: claim.policy.policy_id,
      seriesId: claim.policy.series_id,
      groupKey: claim.policy.group,
      nullifier: claim.policy.nullifier,
      coverLimit: claim.policy.limit,
      startsAt: claim.policy.starts_at,
      endsAt: claim.policy.ends_at,
      claimsPayableFrom: claim.policy.claims_payable_from,
      status: claim.policy.status,
    },
    series: {
      seriesId: claim.series.series_id,
      payoutMode: claim.series.payout_mode,
      lookbackMonths: claim.series.lookback_months,
      autoApprovalConfidence: claim.series.auto_approval_confidence,
      autoApprovalLimit: claim.series.auto_approval_limit,
    },
    window: {
      openMonths: claim.window.open_months,
      lastObservedMonth: claim.window.last_observed_month,
      qualifyingMonth: claim.window.qualifying_month,
      claimDeadline: claim.window.claim_deadline,
    },
    evidence: claim.evidence.map((file) => ({
      evidenceId: file.evidence_id,
      kind: file.kind,
      sha256: file.sha256,
      seenInOtherClaims: file.sha256_seen_in_other_claims,
    })),
    extractions,
    priorClaims: claim.prior_claims,
    now,
  };
}
