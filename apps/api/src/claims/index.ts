import { createHash } from 'node:crypto';

import type { FastifyPluginAsync } from 'fastify';

import { canonicalize, type JsonValue } from '@creance/index-model';

import { AppError } from '../errors.js';
import type { ClaimRow, ClaimStatus } from '../db/types.js';
import type { Services } from '../services.js';
import { openEvidence } from './evidence.js';
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
      const claims = await unpublishedDecisions(services, limit);
      return reply.send({
        count: claims.length,
        claims: claims.map((claim) => ({
          claim_id: claim.claimId,
          policy_id: claim.policyId,
          decision: claim.decision,
          decision_hash: claim.decisionHash,
        })),
      });
    },
  );

  app.post<{ Params: { claimId: string }; Body: { hcs_decision_seq?: unknown } }>(
    '/v1/admin/claims/:claimId/published',
    async (request, reply) => {
      requireAdmin(request, services.adminTokens);
      const sequence = request.body?.hcs_decision_seq;
      if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 1) {
        throw new AppError(
          400,
          'bad_sequence',
          'Bad sequence number',
          'hcs_decision_seq is the whole number the topic receipt carried.',
        );
      }
      const stored = await services.repository.recordDecisionSequence(
        request.params.claimId,
        sequence,
      );
      if (stored === null) {
        throw new AppError(
          409,
          'decision_not_publishable',
          'Nothing to record',
          'That claim has no decision hash waiting for a sequence number.',
        );
      }
      return reply.send({
        claim_id: stored.claimId,
        decision_hash: stored.decisionHash,
        hcs_decision_seq: stored.hcsDecisionSeq,
      });
    },
  );

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
        return reply.send({
          claim_id: claim.claimId,
          status: claim.status,
          decision: claim.decision,
          decision_hash: claim.decisionHash,
          hcs_decision_seq: claim.hcsDecisionSeq,
          idempotent: true,
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

      return reply.status(201).send({
        claim_id: stored.claimId,
        status: stored.status,
        decision: stored.decision,
        decision_hash: stored.decisionHash,
        hcs_decision_seq: stored.hcsDecisionSeq,
        idempotent: false,
      });
    },
  );
};

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
  const statuses: ClaimStatus[] = ['under_review', 'approved', 'declined'];
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
