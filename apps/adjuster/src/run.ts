import { claimDecisionMessage, encodeTopicMessage } from '@creance/api/src/audit/messages.js';

import { toRuleInput } from './adapt.js';
import { AdjusterApi, ApiError, type AdminClaim } from './api.js';
import type { DecisionPublisher } from './chain.js';
import { decide, needsExtraction, type Decision } from './decide.js';
import type { Extractor } from './extract.js';
import type { ExtractionResult } from './extraction.js';

/// One pass over the pending claims.
///
///     1  list the claims waiting
///     2  for each, in submission order, fetch the whole packet
///     3  run the cheap rules; if one of them declines, skip extraction
///     4  otherwise read each document, one model call per file
///     5  run the full rule set, score the confidence, build the record
///     6  publish the record's hash to the claims topic with the adjuster key
///     7  post the decision, the record and the sequence number to the API
///
/// Four properties this shape buys, and each is a rule rather than a taste.
///
/// It is idempotent: the decision is keyed by the claim id and the packet hash,
/// so two instances, or one instance run twice by a nervous operator during a
/// demo, produce one decision.
///
/// It takes no lease and no lock. The API's decision handler already refuses a
/// claim that is not waiting, and that refusal is the lock; a `claimed_by`
/// column would be a second source of truth for the same fact.
///
/// It terminates. A pass ends and does not loop back over what it decided, so
/// nothing economic runs twice.
///
/// It is never silently unavailable. A model that cannot be reached refers the
/// claim; it does not leave it submitted and it does not decline it. A queue
/// that quietly stops deciding is indistinguishable from a queue with nothing
/// in it.

export interface PassOptions {
  api: AdjusterApi;
  extractor: Extractor;
  publisher: DecisionPublisher;
  asset: { id: string; decimals: number };
  model?: string | null;
  effort?: string | null;
  limit?: number;
  /** The clock, passed in, so a replay decides against the replay's time. */
  now?: () => Date;
  log?: (line: string) => void;
}

export interface PassResult {
  claimId: string;
  decision: Decision['decision'] | 'skipped';
  reasons: string[];
  confidence: string | null;
  decisionHash: string | null;
  hcsSequenceNumber: number | null;
  /** How many documents were sent to the model. Zero when a cheap rule decided. */
  documentsRead: number;
  note?: string;
}

export async function runPass(options: PassOptions): Promise<PassResult[]> {
  const log = options.log ?? (() => undefined);
  const now = options.now ?? (() => new Date());
  const results: PassResult[] = [];

  const waiting = await options.api.queue('submitted', options.limit ?? 20);
  log(`${waiting.length} claim${waiting.length === 1 ? '' : 's'} waiting`);

  for (const summary of waiting) {
    const claim = await options.api.claim(summary.claim_id);
    if (claim.status !== 'submitted') {
      // Somebody took it between the list and the read. That is allowed.
      results.push(skipped(claim.claim_id, 'the claim was taken by somebody else'));
      continue;
    }
    results.push(await decideOne(claim, options, now(), log));
  }

  return results;
}

/**
 * Decide one claim.
 *
 * Exported because the live extraction script and the testnet publish both
 * drive exactly this, rather than a second copy of it with the interesting
 * parts left out.
 */
export async function decideOne(
  claim: AdminClaim,
  options: PassOptions,
  at: Date,
  log: (line: string) => void = () => undefined,
): Promise<PassResult> {
  const bare = toRuleInput(claim, {}, at.toISOString());

  const extractions: Record<string, ExtractionResult> = {};
  if (needsExtraction(bare)) {
    for (const file of claim.evidence) {
      try {
        const bytes = await options.api.evidence(claim.claim_id, file.evidence_id);
        extractions[file.evidence_id] = await options.extractor.extract({
          evidenceId: file.evidence_id,
          kind: file.kind,
          contentType: file.content_type,
          bytes,
        });
      } catch (error) {
        // No transport failure ever declines a claim.
        extractions[file.evidence_id] = {
          failed: true,
          reason: 'adjuster_unavailable',
          detail: error instanceof Error ? error.message.slice(0, 200) : 'the file could not be read',
        };
      }
    }
    log(`  read ${Object.keys(extractions).length} document(s) for ${claim.claim_id}`);
  } else {
    log(`  ${claim.claim_id} decided without reading a document`);
  }

  const outcome = decide(toRuleInput(claim, extractions, at.toISOString()), {
    asset: options.asset,
    model: options.model ?? null,
    effort: options.effort ?? null,
  });

  // The hash reaches the topic before the decision reaches the row, so a claim
  // that is decided is always a claim whose decision is already public. The
  // reverse order would let a payout reference a sequence number that does not
  // exist.
  const receipt = await options.publisher.publish(
    encodeTopicMessage(
      claimDecisionMessage({
        policyId: claim.policy_id,
        claimId: claim.claim_id,
        decisionHash: outcome.decisionHash,
        decision: outcome.decision,
        at,
      }),
    ),
  );
  if (receipt !== null) {
    log(`  published ${outcome.decision} as sequence ${receipt.sequenceNumber}`);
  }

  try {
    const accepted = await options.api.decide(claim.claim_id, claim.packet_hash, {
      decision: outcome.decision,
      reasons: outcome.reasons,
      reason_lines: outcome.reasonLines,
      resubmit: outcome.resubmit,
      confidence: outcome.confidence,
      record: outcome.record,
      decision_hash: outcome.decisionHash,
      hcs_decision_seq: receipt?.sequenceNumber ?? null,
    });
    return {
      claimId: claim.claim_id,
      decision: outcome.decision,
      reasons: outcome.reasons,
      confidence: outcome.confidence,
      decisionHash: outcome.decisionHash,
      hcsSequenceNumber: receipt?.sequenceNumber ?? null,
      documentsRead: Object.keys(extractions).length,
      ...(accepted.idempotent ? { note: 'a decision for this claim already existed' } : {}),
    };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'claim_not_decidable') {
      // A human decided it first, which is allowed and expected.
      return skipped(claim.claim_id, 'a human decided it first');
    }
    throw error;
  }
}

function skipped(claimId: string, note: string): PassResult {
  return {
    claimId,
    decision: 'skipped',
    reasons: [],
    confidence: null,
    decisionHash: null,
    hcsSequenceNumber: null,
    documentsRead: 0,
    note,
  };
}
