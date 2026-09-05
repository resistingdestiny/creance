import { createHash } from 'node:crypto';

import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';

import { canonicalize, type JsonValue } from '@creance/index-model';

import { AppError } from '../errors.js';
import type { ClaimRow, ClaimStatus } from '../db/types.js';
import type { Services } from '../services.js';
import { openEvidence } from './evidence.js';
import { payApprovedClaim, type PayoutOutcome } from './payout.js';
import { hashRecord, reviewerRecord } from './record.js';
import { requireAdmin, type AdminActor } from './token.js';
import { adminClaimSummary, adminClaimView } from './view.js';

/// The review queue.
///
/// `GET /v1/admin/claims?status=under_review` and
/// `POST /v1/admin/claims/:id/decide` are the two the acceptance names. The two
/// beside them, the detail and the evidence stream, are what makes the queue
/// usable: the Adjuster and a human reviewer both need the whole packet in one
/// request and the document itself in another, and building the machine path on
/// a different route from the human path would leave the human path untested at
/// the moment it is needed.
///
/// None of these are Bazantic operations, so none of them is in
/// recipes/bazantic/openapi.yaml. That document describes what an agent may buy
/// over x402; the review queue is internal, gated by a bearer token and is not
/// something a stranger should discover from a published spec.

const QUEUE_STATUSES: ClaimStatus[] = [
  'submitted',
  'under_review',
  'approved',
  'declined',
  'paid',
];

interface DecideBody {
  decision?: unknown;
  reason?: unknown;
  reasons?: unknown;
  reason_lines?: unknown;
  resubmit?: unknown;
  confidence?: unknown;
  record?: unknown;
  decision_hash?: unknown;
  hcs_decision_seq?: unknown;
}

export const adminClaimRoutes: FastifyPluginAsync<{ services: Services }> = async (
  app,
  options,
) => {
  const { services } = options;

  app.get<{ Querystring: { status?: string; limit?: string } }>(
    '/v1/admin/claims',
    async (request, reply) => {
      requireAdmin(request, services.adminTokens);
      const status = (request.query.status ?? 'under_review') as ClaimStatus;
      if (!QUEUE_STATUSES.includes(status)) {
        throw new AppError(
          400,
          'bad_status',
          'Unknown status',
          `status must be one of ${QUEUE_STATUSES.join(', ')}.`,
        );
      }
      const limit = Math.min(Math.max(Number(request.query.limit ?? '20') || 20, 1), 100);
      const claims = await services.repository.claimsByStatus(status, limit);
      const now = new Date();
      return reply.send({
        status,
        count: claims.length,
        claims: claims.map((claim) => adminClaimSummary(claim, now)),
      });
    },
  );

  app.get<{ Params: { claimId: string } }>('/v1/admin/claims/:claimId', async (request, reply) => {
    requireAdmin(request, services.adminTokens);
    const { claim, view } = await loadClaim(services, request.params.claimId);
    void claim;
    return reply.send(view);
  });

  app.get<{ Params: { claimId: string; evidenceId: string } }>(
    '/v1/admin/claims/:claimId/evidence/:evidenceId',
    async (request, reply) => {
      requireAdmin(request, services.adminTokens);
      if (services.evidenceKeys === null) {
        throw new AppError(
          503,
          'evidence_key_missing',
          'Evidence key missing',
          'This deployment holds no evidence key, so it cannot open a stored file.',
        );
      }
      const rows = await services.repository.claimEvidence(request.params.claimId);
      const row = rows.find((file) => file.evidenceId === request.params.evidenceId);
      if (row === undefined) {
        throw new AppError(
          404,
          'evidence_not_found',
          'Evidence not found',
          'No file with that id belongs to that claim.',
        );
      }
      const ciphertext = await services.evidenceStore.get(row.objectKey);
      const plaintext = openEvidence(services.evidenceKeys, row, ciphertext);
      // The hash is checked on the way out as well as on the way in: a file
      // whose bytes no longer match what the claims topic carries is a broken
      // store, and a silent mismatch would be adjudicated as if it were fine.
      const digest = `sha256:${createHash('sha256').update(plaintext).digest('hex')}`;
      if (digest !== row.sha256) {
        request.log.error(
          { claim_id: row.claimId, evidence_id: row.evidenceId },
          'a stored evidence file does not match the hash recorded for it',
        );
        throw new AppError(
          500,
          'evidence_corrupt',
          'Evidence corrupt',
          'The stored file no longer matches the fingerprint recorded for it.',
        );
      }
      return reply
        .header('content-type', row.contentType)
        .header('content-disposition', `attachment; filename="${row.filename}"`)
        .header('x-evidence-sha256', row.sha256)
        .send(plaintext);
    },
  );

  app.get<{ Querystring: { limit?: string } }>(
    '/v1/admin/claims/unpublished',
    async (request, reply) => {
      requireAdmin(request, services.adminTokens);
      const limit = Math.min(Math.max(Number(request.query.limit ?? '20') || 20, 1), 100);
      const [claims, waiting] = await Promise.all([
        unpublishedDecisions(services, limit),
        services.repository.claimsAwaitingPacket(limit),
      ]);
      const evidence = await Promise.all(
        waiting.map((claim) => services.repository.claimEvidence(claim.claimId)),
      );
      return reply.send({
        count: claims.length,
        claims: claims.map((claim) => ({
          claim_id: claim.claimId,
          policy_id: claim.policyId,
          decision: claim.decision,
          decision_hash: claim.decisionHash,
        })),
        // The packets whose hash has not reached the topic, in the same list
        // and for the same reason: the API writes the hash into the row and
        // cannot publish it, because the claims topic's submit key is the
        // adjuster account's. The Adjuster sweeps this at the start of a pass,
        // so the packet hash is public before the decision hash that answers
        // it. See docs/DECISIONS.md.
        packets: waiting.map((claim, index) => ({
          claim_id: claim.claimId,
          policy_id: claim.policyId,
          packet_hash: claim.packetHash,
          evidence: (evidence[index] ?? []).map((file) => file.sha256),
        })),
      });
    },
  );

  app.post<{
    Params: { claimId: string };
    Body: { hcs_decision_seq?: unknown; hcs_submitted_seq?: unknown };
  }>('/v1/admin/claims/:claimId/published', async (request, reply) => {
    requireAdmin(request, services.adminTokens);
    const body = request.body ?? {};
    const decisionSeq = sequenceOr(body.hcs_decision_seq, 'hcs_decision_seq');
    const packetSeq = sequenceOr(body.hcs_submitted_seq, 'hcs_submitted_seq');
    if (decisionSeq === null && packetSeq === null) {
      throw new AppError(
        400,
        'bad_sequence',
        'Bad sequence number',
        'Send hcs_decision_seq or hcs_submitted_seq, whichever the topic receipt was for.',
      );
    }

    let stored: ClaimRow | null = null;
    if (packetSeq !== null) {
      stored = await services.repository.recordPacketSequence(request.params.claimId, packetSeq);
      if (stored === null) {
        throw new AppError(
          409,
          'packet_not_publishable',
          'Nothing to record',
          'That claim has no packet hash waiting for a sequence number.',
        );
      }
    }
    if (decisionSeq !== null) {
      stored = await services.repository.recordDecisionSequence(
        request.params.claimId,
        decisionSeq,
      );
      if (stored === null) {
        throw new AppError(
          409,
          'decision_not_publishable',
          'Nothing to record',
          'That claim has no decision hash waiting for a sequence number.',
        );
      }
    }
    return reply.send({
      claim_id: stored?.claimId ?? request.params.claimId,
      packet_hash: stored?.packetHash ?? null,
      decision_hash: stored?.decisionHash ?? null,
      hcs_submitted_seq: stored?.hcsSubmittedSeq ?? null,
      hcs_decision_seq: stored?.hcsDecisionSeq ?? null,
    });
  });

  app.post<{ Params: { claimId: string }; Body: DecideBody }>(
    '/v1/admin/claims/:claimId/decide',
    async (request, reply) => {
      const actor = requireAdmin(request, services.adminTokens);
      const body = request.body ?? {};
      const decision = body.decision;
      if (decision !== 'approve' && decision !== 'refer' && decision !== 'decline') {
        throw new AppError(
          400,
          'bad_decision',
          'Unknown decision',
          'decision must be approve, refer or decline.',
        );
      }

      const { claim } = await loadClaim(services, request.params.claimId);

      // Idempotent by claim id and packet hash. Two Adjuster passes over one
      // claim, or one operator running the pass twice during a demo, produce
      // one decision rather than two topic messages and two records.
      if (claim.decision !== null && claim.status !== 'submitted' && claim.status !== 'under_review') {
        // An approved claim that has not been paid is the retry path. The
        // authorisation is stored and reusable until its deadline, and
        // `payClaim` is permissionless, so a payout that failed for an
        // environmental reason is one more call and not a new decision.
        const retried =
          claim.status === 'approved' && claim.paidTx === null
            ? await pay(services, claim, request.log)
            : claim.paidTx === null
              ? undefined
              : { paid: true, idempotent: true, transactionHash: claim.paidTx };
        return reply.send({
          claim_id: claim.claimId,
          status: claim.status,
          decision: claim.decision,
          decision_hash: claim.decisionHash,
          hcs_decision_seq: claim.hcsDecisionSeq,
          idempotent: true,
          ...(retried === undefined ? {} : { payout: retried }),
        });
      }

      const record = asRecord(body.record);
      const reasons = asStrings(body.reasons);
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

      // A human decision must carry the sentence the person will read. A
      // machine decision carries reason codes and composes its own line, so a
      // decline with neither is a decision nobody can act on.
      if (record === null && decision !== 'approve' && reason === '') {
        throw new AppError(
          400,
          'reason_required',
          'Reason required',
          'A refer or a decline needs one plain sentence to show the person.',
        );
      }

      guardHardRules(claim, record, decision, actor);

      // A reviewer posts a decision and a sentence. The record is composed here
      // rather than left null, because the CLAIMS role signs over the decision
      // hash and a decision with no preimage behind its hash is a decision
      // nothing can pay.
      const asset = {
        id: services.config.settlementToken.tokenId,
        decimals: services.config.settlementToken.decimals,
      };
      const decidedAt = new Date().toISOString();
      const composed =
        record ??
        reviewerRecord({
          claim,
          decision,
          reasons: reasons.length > 0 ? reasons : ['reviewer_decision'],
          note: reason,
          actor: actor.name,
          amount: decision === 'approve' ? await payableAmount(services, claim) : null,
          asset,
          decidedAt,
        });
      const decisionHash =
        record === null ? hashRecord(composed) : verifyHash(record, body.decision_hash);

      const status: ClaimStatus =
        decision === 'approve' ? 'approved' : decision === 'decline' ? 'declined' : 'under_review';

      const stored = await services.repository.recordDecision({
        claimId: claim.claimId,
        status,
        decision,
        reasons: reasons.length > 0 ? reasons : reason === '' ? [] : ['reviewer_decision'],
        // The sentences beside the codes. A reviewer posts one plain sentence
        // and no codes, so it is stored as the line for the decision they made.
        reasonLines:
          asLines(body.reason_lines) ??
          (reason === '' ? [] : [{ code: 'reviewer_decision', line: reason }]),
        resubmit: asResubmit(body.resubmit),
        confidence: typeof body.confidence === 'string' ? body.confidence : null,
        decisionHash,
        decisionRecord: composed,
        hcsDecisionSeq:
          typeof body.hcs_decision_seq === 'number' ? body.hcs_decision_seq : null,
        amount: amountOf(composed),
        decidedBy:
          typeof composed['actor'] === 'string' ? (composed['actor'] as string) : actor.name,
        reviewer: actor.canOverride && record === null ? actor.name : null,
        decidedAt,
      });

      request.log.info(
        {
          claim_id: stored.claimId,
          decision: stored.decision,
          decided_by: stored.decidedBy,
          hcs_decision_seq: stored.hcsDecisionSeq,
        },
        'a claim was decided',
      );

      // The second key turns here. An approval is a decision with a hash the
      // CLAIMS role can sign over, which is the whole of what `payClaim`
      // checks, so the payout runs in the same request the decision arrives in
      // and a clean claim is decided and paid in one session, as DESIGN.md 3.9
      // says it should be.
      const payout = decision === 'approve' ? await pay(services, stored, request.log) : undefined;
      const paid = payout?.paid === true ? await services.repository.claim(stored.claimId) : null;

      return reply.status(201).send({
        claim_id: stored.claimId,
        status: paid?.status ?? stored.status,
        decision: stored.decision,
        decision_hash: stored.decisionHash,
        hcs_decision_seq: stored.hcsDecisionSeq,
        idempotent: false,
        ...(payout === undefined ? {} : { payout }),
      });
    },
  );
};

/**
 * The payout, which can refuse but must never fail the decision.
 *
 * A decision is a record and a hash on a public topic; a payout is a
 * transaction that can revert for reasons that have nothing to do with the
 * claim being valid, the realistic one on Hedera being a wallet that has not
 * associated the settlement token. So the decision stands, the authorisation is
 * stored, and the payout is reported as what it was. Anyone can retry it.
 */
async function pay(
  services: Services,
  claim: ClaimRow,
  log: FastifyBaseLogger,
): Promise<PayoutOutcome> {
  try {
    return await payApprovedClaim(services, claim, log);
  } catch (error) {
    log.error(
      { err: error, claim_id: claim.claimId },
      'the payout failed after the claim was approved',
    );
    return { paid: false, reason: 'payout_failed' };
  }
}

/**
 * The claims whose decision hash has not reached the topic yet.
 *
 * A human decision is stored with its record and its hash, but the API cannot
 * publish it: the claims topic's submit key is the adjuster account's. So the
 * Adjuster sweeps this list at the end of a pass and publishes what it finds,
 * which is what keeps "every decision is on a public topic" true for the human
 * half of the queue as well as the machine half.
 */
export async function unpublishedDecisions(
  services: Services,
  limit: number,
): Promise<ClaimRow[]> {
  // `paid` is in the list because an approval is paid in the same request it
  // arrives in, so an approved claim is usually already past `approved` by the
  // time the sweep runs. Leaving it out made a reviewer's approval the one
  // decision whose hash never reached the topic, which was found on the first
  // testnet run and is recorded in docs/harness-notes.md.
  const statuses: ClaimStatus[] = ['under_review', 'approved', 'declined', 'paid'];
  const found: ClaimRow[] = [];
  for (const status of statuses) {
    for (const claim of await services.repository.claimsByStatus(status, limit)) {
      if (claim.decisionHash !== null && claim.hcsDecisionSeq === null) found.push(claim);
    }
  }
  return found.slice(0, limit);
}

/** What this claim would pay, from the cover limit and the payout mode. */
async function payableAmount(services: Services, claim: ClaimRow): Promise<string | null> {
  if (claim.amount !== null) return claim.amount;
  const [policy, series] = await Promise.all([
    services.repository.policy(claim.policyId),
    services.repository.series(claim.seriesId),
  ]);
  if (policy === null || series === null || series.payoutMode !== 'full') return null;
  return policy.coverLimit;
}

async function loadClaim(
  services: Services,
  claimId: string,
): Promise<{ claim: ClaimRow; view: ReturnType<typeof adminClaimView> }> {
  const claim = await services.repository.claim(claimId);
  if (claim === null) {
    throw new AppError(404, 'claim_not_found', 'Claim not found', 'No claim with that id.');
  }
  const [policy, series, evidence] = await Promise.all([
    services.repository.policy(claim.policyId),
    services.repository.series(claim.seriesId),
    services.repository.claimEvidence(claim.claimId),
  ]);
  if (policy === null || series === null) {
    throw new AppError(
      500,
      'claim_incomplete',
      'Claim incomplete',
      'That claim points at cover or a series this API cannot find.',
    );
  }
  const [seenElsewhere, priorClaims, window] = await Promise.all([
    services.repository.evidenceSeenElsewhere(
      claim.claimId,
      evidence.map((file) => file.sha256),
    ),
    services.repository.priorClaimCount(claim.nullifier, claim.seriesId, claim.claimId),
    services.chain.lossWindow(series.seriesKey),
  ]);

  return {
    claim,
    view: adminClaimView({
      claim,
      policy,
      series,
      evidence,
      seenElsewhere,
      window,
      priorClaims,
      keys: services.evidenceKeys,
    }),
  };
}

/**
 * A reviewer is not bound by the confidence threshold, which is the point of
 * the queue: a person reading the document is a better signal than any number
 * computed about it. A reviewer is bound by the hard rules. Nobody approves a
 * resignation, and the check is here as well as on the screen, because a screen
 * is not an enforcement point.
 */
function guardHardRules(
  claim: ClaimRow,
  posted: Record<string, unknown> | null,
  decision: string,
  actor: AdminActor,
): void {
  if (decision !== 'approve') return;
  const record = posted ?? claim.decisionRecord;
  const results = record?.['rule_results'];
  if (!Array.isArray(results)) return;
  const failed = results.filter(
    (result) => (result as { status?: string }).status === 'fail_hard',
  ) as { rule?: string }[];
  if (failed.length === 0) return;
  throw new AppError(
    409,
    'hard_rule_failed',
    'That claim cannot be approved',
    `${failed.map((result) => result.rule ?? '?').join(', ')} failed, and ${actor.name} cannot approve past a rule that did.`,
  );
}

/**
 * The hash the caller says the record has, checked against the record.
 *
 * The CLAIMS role signs over this hash and the claims topic carries it, so a
 * record whose hash was computed over something else would put a signature on a
 * decision nobody can reproduce. Recomputing it here costs one canonicalisation
 * and makes the stored preimage and the published hash the same thing by
 * construction.
 */
function verifyHash(record: Record<string, unknown> | null, claimed: unknown): string | null {
  if (record === null) return typeof claimed === 'string' ? claimed : null;
  const digest = `sha256:${createHash('sha256')
    .update(canonicalize(record as JsonValue), 'utf8')
    .digest('hex')}`;
  if (typeof claimed === 'string' && claimed !== digest) {
    throw new AppError(
      400,
      'decision_hash_mismatch',
      'Decision hash mismatch',
      'The hash sent with the decision is not the hash of the record sent with it.',
    );
  }
  return digest;
}

/** A topic sequence number, or null when the caller sent none. */
function sequenceOr(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new AppError(
      400,
      'bad_sequence',
      'Bad sequence number',
      `${name} is the whole number the topic receipt carried.`,
    );
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asLines(value: unknown): { code: string; line: string }[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter(
      (entry): entry is { code: string; line: string } =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { code?: unknown }).code === 'string' &&
        typeof (entry as { line?: unknown }).line === 'string',
    )
    .map((entry) => ({ code: entry.code, line: entry.line }));
}

function asResubmit(value: unknown): { allowed: boolean; why: string } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entry = value as { allowed?: unknown; why?: unknown };
  if (typeof entry.allowed !== 'boolean') return null;
  return { allowed: entry.allowed, why: typeof entry.why === 'string' ? entry.why : '' };
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function amountOf(record: Record<string, unknown> | null): string | null {
  const amount = record?.['amount'];
  if (typeof amount !== 'object' || amount === null) return null;
  const value = (amount as { amount?: unknown }).amount;
  return typeof value === 'string' ? value : null;
}
