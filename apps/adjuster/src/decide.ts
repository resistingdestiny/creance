import { computeConfidence, type ConfidenceComponents } from './confidence.js';
import { isFailure, type Extraction } from './extraction.js';
import { byPriority, reasonLines, resubmitFor, type ReasonCode, type ReasonLine, type Resubmit } from './reasons.js';
import {
  adjusterEngine,
  decisionHash,
  type DecisionAmount,
  type DecisionRecord,
} from './record.js';
import { evaluateRules, type RuleInput, type RuleResult } from './rules.js';

/// Rules plus confidence plus the auto-approval predicate, in one pure call.
///
/// The order is mechanical and it is the whole of the adjudication:
///
///     any rule fail_hard                       -> decline
///     any rule fail_soft                       -> refer
///     any required rule not_evaluated          -> refer
///     confidence below the series threshold    -> refer
///     amount above the series limit            -> refer
///     otherwise                                -> approve
///
/// A human reviewer is not bound by the confidence threshold, which is the
/// point of the queue: a person reading the document is a better signal than
/// any number computed about it. A human is bound by the hard rules, and that
/// is enforced in the API's decision handler as well as on the screen, because
/// a screen is not an enforcement point.

export interface DecideOptions {
  /** The settlement asset the amount is denominated in. */
  asset: { id: string; decimals: number };
  /** The claim's own actor label, `adjuster` here. */
  actor?: string;
  model?: string | null;
  effort?: string | null;
  /** The record this decision replaces, when the claim was resubmitted. */
  supersedes?: string;
}

export interface Decision {
  decision: 'approve' | 'refer' | 'decline';
  reasons: ReasonCode[];
  reasonLines: ReasonLine[];
  resubmit: Resubmit;
  confidence: string | null;
  confidenceComponents: ConfidenceComponents | null;
  ruleResults: RuleResult[];
  perDocument: Record<string, RuleResult[]>;
  amount: DecisionAmount | null;
  record: DecisionRecord;
  decisionHash: string;
}

/**
 * What a claim on this policy would pay.
 *
 * `payClaim` compares the amount for equality, not for "at most", so a claim
 * that would pay less than the contract computes is a bug in the Adjuster and
 * not a discount to accept quietly. The demo series is full payout, so the
 * expected amount is the cover limit exactly and nothing is rounded. The
 * indexed mode needs the qualifying month's ODI and the shock form, which this
 * build does not compute; R31 refers rather than inventing a number.
 */
export function expectedPayout(input: RuleInput): string | null {
  return input.series.payoutMode === 'full' ? input.policy.coverLimit : null;
}

export function decide(input: RuleInput, options: DecideOptions): Decision {
  const evaluation = evaluateRules(input);
  const results = evaluation.results;

  const anotherStatesReason = Object.entries(input.extractions).some(([id, result]) => {
    if (id === evaluation.decidingEvidenceId || isFailure(result)) return false;
    return (result as Extraction).separation_initiated_by !== 'not_stated';
  });

  const decidingKind =
    input.evidence.find((file) => file.evidenceId === evaluation.decidingEvidenceId)?.kind ?? null;

  // Nothing was read, so there is nothing to be confident about, and the record
  // says so with a null rather than with a low number that looks like a
  // judgement about the packet.
  const scored =
    evaluation.decidingExtraction === null
      ? null
      : computeConfidence({
          attestation: input.attestation,
          deciding: evaluation.decidingExtraction,
          decidingClaimedKind: decidingKind,
          anotherDocumentStatesReason: anotherStatesReason,
          results,
        });

  const amountValue = expectedPayout(input);
  const amount: DecisionAmount | null =
    amountValue === null
      ? null
      : { amount: amountValue, asset: options.asset.id, decimals: options.asset.decimals };

  const hard = results.some((result) => result.status === 'fail_hard');
  const soft = results.some((result) => result.status === 'fail_soft');
  const missing = results.some((result) => result.status === 'not_evaluated' && result.required);
  const belowThreshold =
    scored === null || Number(scored.confidence) < input.series.autoApprovalConfidence;
  const overLimit =
    amount === null || BigInt(amount.amount) > BigInt(input.series.autoApprovalLimit);

  const decision: Decision['decision'] = hard
    ? 'decline'
    : soft || missing || belowThreshold || overLimit
      ? 'refer'
      : 'approve';

  const reasons = byPriority(
    results
      .filter((result) => result.status !== 'pass' && result.reason !== undefined)
      .map((result) => result.reason as ReasonCode),
  );

  const slots = {
    last_day_of_work: formatDate(input.attestation.lastDayOfWork),
    claims_payable_from: formatDate(input.policy.claimsPayableFrom),
    cover_ends: formatDate(input.policy.endsAt.slice(0, 10)),
    ...(input.window.claimDeadline === null
      ? {}
      : { claim_deadline: formatDate(input.window.claimDeadline.slice(0, 10)) }),
    ...(evaluation.decidingExtraction?.employer_name === undefined ||
    evaluation.decidingExtraction?.employer_name === null
      ? {}
      : { employer_on_document: evaluation.decidingExtraction.employer_name }),
    ...(evaluation.decidingExtraction?.last_day_of_work === undefined ||
    evaluation.decidingExtraction?.last_day_of_work === null
      ? {}
      : { date_on_document: formatDate(evaluation.decidingExtraction.last_day_of_work) }),
  };

  const record: DecisionRecord = {
    v: 1,
    type: 'adjuster_decision',
    claim_id: input.claim.claimId,
    policy_id: input.policy.policyId,
    series_id: input.policy.seriesId,
    packet_hash: input.claim.packetHash,
    actor: options.actor ?? 'adjuster',
    decided_at: input.now,
    engine: adjusterEngine(options.model ?? undefined, options.effort ?? undefined),
    decision,
    reasons,
    amount,
    separation_month: evaluation.separationMonth,
    qualifying_month: evaluation.qualifyingMonth,
    open_months_considered: input.window.openMonths,
    claim_deadline: input.window.claimDeadline,
    confidence: scored?.confidence ?? null,
    confidence_components: scored?.components ?? null,
    evidence: input.evidence.map((file) => {
      const extraction = input.extractions[file.evidenceId];
      return {
        sha256: file.sha256,
        kind_claimed: file.kind,
        kind_extracted:
          extraction === undefined || isFailure(extraction) ? null : extraction.document_type,
        deciding: file.evidenceId === evaluation.decidingEvidenceId,
      };
    }),
    rule_results: results,
    human: null,
    ...(options.supersedes === undefined ? {} : { supersedes: options.supersedes }),
  };

  return {
    decision,
    reasons,
    reasonLines: reasonLines(reasons, slots),
    resubmit: resubmitFor(reasons, slots),
    confidence: scored?.confidence ?? null,
    confidenceComponents: scored?.components ?? null,
    ruleResults: results,
    perDocument: evaluation.perDocument,
    amount,
    record,
    decisionHash: decisionHash(record),
  };
}

/**
 * Whether the packet needs a model call at all.
 *
 * The cheap rules run first, and a decline among them is posted before any
 * document is read: a resignation is refused in under a second and never costs
 * a model call. That is not only an optimisation, it is the demo's second
 * claim.
 */
export function needsExtraction(input: RuleInput): boolean {
  // Everything except R17 answers without a document, so the packet is read
  // only when no cheaper rule has already declined it. R17 is excluded because
  // an empty evidence list is the question being asked, not an answer.
  const cheap = evaluateRules({ ...input, evidence: [], extractions: {} });
  return !cheap.results.some((result) => result.status === 'fail_hard' && result.rule !== 'R17');
}

/**
 * Dates as en-GB in UTC, which is the form every screen in this build prints.
 * September abbreviates to four letters, so the long month name is used and
 * there is nothing to abbreviate.
 */
export function formatDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
