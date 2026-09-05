import { createHash } from 'node:crypto';

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { canonicalize, type JsonValue } from '@creance/index-model';

import { separationAtOf } from '../chain/authorisation.js';
import { findSeries } from '../config.js';
import type { VerifiedClaimCredential } from '../credentials.js';
import type { ClaimEvidenceRow, ClaimRow, PolicyRow, SeriesRow } from '../db/types.js';
import { AppError } from '../errors.js';
import { hasPrefix, newId } from '../ids.js';
import type { Services } from '../services.js';
import { seriesRowFrom } from '../series.js';
import { rfc3339 } from '../views.js';
import { continuityHolds } from '../world/config.js';
import {
  attestationMessage,
  attestationMessageHash,
  SEPARATION_TYPES,
  verifyAttestation,
  type AttestationMethod,
  type SeparationType,
} from './attestation.js';
import { sealEvidence, sealField } from './evidence.js';
import { claimsOpenness, refuseClosed } from './openness.js';
import { readEvidence, MAX_EVIDENCE_FILES, CLAIM_BODY_LIMIT } from './upload.js';
import { fieldHash, periodString } from './view.js';

/// POST /v1/claims
///
/// The four-part packet of DESIGN.md 3.9, submitted in one request: the claim
/// credential a fresh Selfie Check earned, the attestation signed by the policy
/// wallet, the evidence files, and the statement. The endpoint stores them,
/// puts the claim in the queue and returns; it decides nothing.
///
/// Where the line between this endpoint and the Adjuster falls is written in
/// docs/CLAIMS.md and it is followed exactly. Rules R01 to R06 are the identity
/// and eligibility leg and are enforced here, before the Adjuster sees the
/// claim: a live person check was completed, the claim and the cover name the
/// same person, the check was made for the claim action, the claim is waiting,
/// the cover is open for claims, and no earlier claim exists. Everything from
/// R07 down is adjudication, and adjudication produces a decision with reasons
/// a person can act on rather than a validation error they cannot. So a
/// resignation is accepted here and declined by the Adjuster in under a second,
/// with the line "Resigning isn't covered" and a record on a public topic.
///
/// What is deliberately not here: the claim window and the loss window are read
/// from the chain and stored, never enforced here. `claimDeadline` answering
/// zero means no month qualifies yet, which is a hold and not a refusal
/// (docs/CLAIMS.md, "R14 has three outcomes and it is the one to get right").
///
/// It is not in recipes/bazantic/openapi.yaml. That document describes what an
/// agent may buy over x402, and this is a person's flow behind a camera check.
/// See docs/DECISIONS.md.

export const claimRoutes: FastifyPluginAsync<{ services: Services }> = async (app, options) => {
  const { services } = options;

  app.post<{ Body: Record<string, unknown> }>(
    '/v1/claims',
    // The one route with a body limit of its own. The server's default of 64 KB
    // is right for a JSON API and wrong for a page of A4 in base64.
    { bodyLimit: CLAIM_BODY_LIMIT },
    async (request, reply) => {
      const body = request.body ?? {};
      const credential = await claimCredential(services, body, request);
      const policy = await services.repository.policy(credential.policy_id);
      if (policy === null) {
        throw new AppError(404, 'policy_not_found', 'Policy not found', 'No cover with that id.');
      }
      if (
        typeof body['policy_id'] === 'string' &&
        body['policy_id'] !== credential.policy_id
      ) {
        throw new AppError(
          403,
          'credential_wrong_policy',
          'Check not for this cover',
          'That check was made for a different cover.',
        );
      }

      guardIdentity(services, credential, policy);
      const series = await openSeries(services, policy);
      const attestation = readAttestation(body, policy);

      const message = attestationMessage({
        policyId: policy.policyId,
        seriesId: policy.seriesId,
        fullName: attestation.fullName,
        employerName: attestation.employerName,
        jobTitle: attestation.jobTitle,
        groupKey: policy.groupKey,
        lastDayOfWork: attestation.lastDayOfWork,
        separationType: attestation.separationType,
      });
      const verified = verifyAttestation(
        message,
        { method: attestation.method, signature: attestation.signature },
        policy.walletEvm,
      );

      const keys = services.evidenceKeys;
      if (keys === null) {
        throw new AppError(
          503,
          'evidence_key_missing',
          'Evidence key missing',
          'This deployment holds no evidence key, so it cannot store a document.',
        );
      }

      const now = new Date();
      const claimId = newId('claim', now.getTime());
      const files = readFiles(body, now.getTime());

      // Sealed and written to the store before the row exists, so a row is
      // never created pointing at a file that is not there. The reverse leaves
      // ciphertext nobody references, which is a cleanup and not a broken
      // claim.
      const evidence: ClaimEvidenceRow[] = [];
      for (const file of files) {
        const sealed = sealEvidence(keys, claimId, file.evidenceId, file.bytes);
        await services.evidenceStore.put(sealed.objectKey, sealed.ciphertext);
        evidence.push({
          evidenceId: file.evidenceId,
          claimId,
          kind: file.kind,
          filename: file.filename,
          contentType: file.contentType,
          sizeBytes: sealed.sizeBytes,
          sha256: sealed.sha256,
          objectKey: sealed.objectKey,
          encIv: sealed.encIv,
          encTag: sealed.encTag,
          encDek: sealed.encDek,
          encKekId: sealed.encKekId,
          uploadedAt: now.toISOString(),
        });
      }

      const window = await readWindow(services, series, attestation.lastDayOfWork);

      const manifest = packetManifest({
        claimId,
        policy,
        credential,
        attestation,
        attestationVerified: verified,
        attestationMessageHash: attestationMessageHash(message),
        evidence,
        submittedAt: now.toISOString(),
        continuity: continuityHolds(services.config.world),
      });
      const packetHash = hashManifest(manifest);

      const claim: ClaimRow = {
        claimId,
        policyId: policy.policyId,
        seriesId: policy.seriesId,
        nullifier: policy.nullifier,
        claimNullifier: continuityHolds(services.config.world) ? null : credential.nullifier,
        groupKey: policy.groupKey,
        status: 'submitted',
        employerNameEnc: sealField(keys, attestation.employerName),
        claimantNameEnc: sealField(keys, attestation.fullName),
        jobTitle: attestation.jobTitle,
        separationDate: attestation.lastDayOfWork,
        separationType: attestation.separationType,
        attestationMethod: attestation.method,
        attestationVerified: verified,
        statementAccepted: attestation.statementAccepted,
        verifiedAt: new Date(credential.world.verified_at * 1000).toISOString(),
        worldAction: credential.world.action,
        worldPresence: credential.world.presence,
        packetHash,
        packetManifest: manifest,
        decision: null,
        reasons: [],
        reasonLines: [],
        resubmit: null,
        confidence: null,
        reviewer: null,
        decidedBy: null,
        decisionHash: null,
        decisionRecord: null,
        amount: null,
        qualifyingMonth: window.qualifyingMonth,
        claimDeadline: window.claimDeadline,
        authorisation: null,
        authorisationDeadline: null,
        hcsSubmittedSeq: null,
        hcsDecisionSeq: null,
        paidTx: null,
        submittedAt: now.toISOString(),
        decidedAt: null,
        paidAt: null,
      };

      const stored = await services.repository.insertClaim({
        claim,
        evidence,
        credentialJti: credential.jti,
        employerHash: fieldHash(attestation.employerName),
        nameHash: fieldHash(attestation.fullName),
        attestationMessageHash: attestationMessageHash(message),
        attestationSignature: attestation.signature,
      });

      request.log.info(
        {
          claim_id: stored.claimId,
          policy_id: stored.policyId,
          evidence: evidence.length,
          packet_hash: stored.packetHash,
        },
        'a proof of loss packet was submitted',
      );

      return reply.status(201).send({
        claim_id: stored.claimId,
        policy_id: stored.policyId,
        series_id: stored.seriesId,
        status: stored.status,
        packet_hash: stored.packetHash,
        submitted_at: rfc3339(stored.submittedAt ?? now),
        attestation: {
          method: stored.attestationMethod,
          signature_verified: stored.attestationVerified,
          statement_accepted: stored.statementAccepted,
        },
        evidence: evidence.map((file) => ({
          evidence_id: file.evidenceId,
          kind: file.kind,
          filename: file.filename,
          sha256: file.sha256,
          size: file.sizeBytes,
        })),
        window: {
          qualifying_month:
            stored.qualifyingMonth === null || stored.qualifyingMonth === 0
              ? null
              : periodString(stored.qualifyingMonth),
          claim_deadline: stored.claimDeadline === null ? null : rfc3339(stored.claimDeadline),
        },
        cover: {
          amount: policy.coverLimit,
          asset: policy.asset,
          decimals: policy.assetDecimals,
        },
        // Screen C6, verbatim.
        title: 'Claim received.',
        detail: "Most claims are decided in minutes. You'll see the answer here.",
      });
    },
  );
};

/**
 * GET /v1/claims/:id
 *
 * What the claimant's own screen polls while the Adjuster is deciding, and
 * what it reads afterwards. Free, like `GET /v1/policy/:id`, and bound by the
 * same rule: a claim id is public, because the claims topic carries it in every
 * `claim_packet` and `claim_decision` message, so this response has to be safe
 * to hand to a stranger who read one off the topic.
 *
 * So it carries the status, the decision, the reason codes, whether a corrected
 * packet would be worth submitting, the amount and the two hashes, and none of
 * the employer, the name, the separation date, the file names or the nullifier.
 *
 * The sentences are the one thing a claim screen needs that is not here.
 * `reason_lines` carry dates and sometimes an employer's name, so they are
 * served from the admin payload and from nowhere free. See docs/DECISIONS.md.
 */
export const claimReadRoutes: FastifyPluginAsync<{ services: Services }> = async (
  app,
  options,
) => {
  const { services } = options;

  app.get<{ Params: { id: string } }>('/v1/claims/:id', async (request, reply) => {
    if (!hasPrefix(request.params.id, 'claim')) {
      throw new AppError(400, 'bad_id_prefix', 'Not a claim id', 'A claim id starts with clm_.');
    }
    const claim = await services.repository.claim(request.params.id);
    if (claim === null) {
      throw new AppError(404, 'claim_not_found', 'Claim not found', 'No claim with that id.');
    }
    return reply.send({
      claim_id: claim.claimId,
      policy_id: claim.policyId,
      series_id: claim.seriesId,
      status: claim.status,
      decision: claim.decision,
      reasons: claim.reasons,
      resubmit: claim.resubmit === null ? null : { allowed: claim.resubmit.allowed },
      amount:
        claim.amount === null
          ? null
          : {
              amount: claim.amount,
              asset: services.config.settlementToken.tokenId,
              decimals: services.config.settlementToken.decimals,
            },
      packet_hash: claim.packetHash,
      decision_hash: claim.decisionHash,
      claim_deadline: claim.claimDeadline === null ? null : rfc3339(claim.claimDeadline),
      submitted_at: claim.submittedAt === null ? null : rfc3339(claim.submittedAt),
      decided_at: claim.decidedAt === null ? null : rfc3339(claim.decidedAt),
      paid_at: claim.paidAt === null ? null : rfc3339(claim.paidAt),
      hcs: {
        topic_id: services.config.claimsTopicId === '' ? null : services.config.claimsTopicId,
        packet_sequence_number: claim.hcsSubmittedSeq,
        decision_sequence_number: claim.hcsDecisionSeq,
      },
      payout:
        claim.paidTx === null
          ? null
          : {
              transaction: claim.paidTx,
              hashscan: `https://hashscan.io/testnet/transaction/${claim.paidTx}`,
            },
    });
  });
};

/** The credential, from the header or the body. The header wins, as at bind. */
async function claimCredential(
  services: Services,
  body: Record<string, unknown>,
  request: Pick<FastifyRequest, 'headers'>,
): Promise<VerifiedClaimCredential> {
  const header = request.headers.authorization;
  const fromHeader =
    typeof header === 'string' && /^Bearer\s+/i.test(header)
      ? header.replace(/^Bearer\s+/i, '').trim()
      : null;
  const fromBody =
    typeof body['claim_credential'] === 'string' ? (body['claim_credential'] as string).trim() : null;
  if (fromHeader !== null && fromBody !== null && fromHeader !== fromBody) {
    throw new AppError(
      400,
      'credential_ambiguous',
      'Two different checks',
      'The header and the body carry different claim credentials.',
    );
  }
  const token = fromHeader ?? fromBody;
  if (token === null || token === '') {
    throw new AppError(
      401,
      'credential_missing',
      'Check required',
      'A claim needs the credential the live person check earned, as a bearer token or in the body.',
    );
  }
  return await services.issuer.verifyClaim(token);
}

/**
 * Rules R01, R02 and R03, before anything is stored.
 *
 * The Adjuster re-asserts all three and fails hard on a mismatch, which is not
 * duplication: a claim that reached the queue with a broken identity leg means
 * something upstream is wrong, and the right response there is to stop rather
 * than to adjudicate.
 */
function guardIdentity(
  services: Services,
  credential: VerifiedClaimCredential,
  policy: PolicyRow,
): void {
  if (!credential.world.presence) {
    throw new AppError(
      403,
      'presence_not_completed',
      'The camera check did not finish',
      'A claim needs a fresh check that you are there. Try again when you are somewhere well lit.',
    );
  }
  if (credential.world.action !== services.config.world.actionClaim) {
    throw new AppError(
      403,
      'wrong_action',
      'Check not for a claim',
      'That check was made for something other than a claim.',
    );
  }
  if (continuityHolds(services.config.world) && credential.nullifier !== policy.nullifier) {
    throw new AppError(
      403,
      'nullifier_mismatch',
      "This isn't the World ID that bought this cover",
      'Sign in to World ID with the account you used when you bought it.',
    );
  }
}

/**
 * Rule R05, read from the chain and not from the row.
 *
 * The series row is refreshed from what the contract says while we are here, so
 * `policies.status` and `series.status` are a cache of the chain rather than a
 * second source of truth for whether claims are open. On chain only the series
 * changes status when a month opens; the policies stay Active until one is
 * paid, which is why this reads the series and not the policy.
 */
async function openSeries(services: Services, policy: PolicyRow): Promise<SeriesRow> {
  const config = findSeries(services.config, policy.seriesId);
  if (config === undefined) {
    throw new AppError(404, 'series_not_found', 'Series not found', 'That series is not deployed.');
  }
  const state = await services.chain.seriesState(config.seriesId);
  const row = seriesRowFrom(config, state, services.config);
  await services.repository.upsertSeries(row);

  const observations = await services.repository.observations(policy.groupKey, 1);
  const openness = claimsOpenness({
    policy,
    series: row,
    state,
    observation: observations[0] ?? null,
  });
  if (!openness.open) throw refuseClosed(openness);
  return row;
}

interface ReadAttestation {
  fullName: string;
  employerName: string;
  jobTitle: string;
  lastDayOfWork: string;
  separationType: SeparationType;
  statementAccepted: boolean;
  method: AttestationMethod;
  signature: string | null;
}

const METHODS: AttestationMethod[] = ['eip191', 'hedera_sign_message', 'unsigned_accepted'];

function readAttestation(body: Record<string, unknown>, policy: PolicyRow): ReadAttestation {
  const raw = body['attestation'];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw invalid('attestation', 'expected the attestation object');
  }
  const fields = raw as Record<string, unknown>;
  const group = typeof fields['group'] === 'string' ? fields['group'] : policy.groupKey;
  if (group !== policy.groupKey) {
    // The occupation is on the cover and cannot be restated by the claim. The
    // Adjuster's R08 compares them as well; here it is refused because a packet
    // that names a different occupation is a packet for a different cover.
    throw new AppError(
      409,
      'group_does_not_match_policy',
      'Different occupation',
      'The occupation on this claim is not the one this cover was bought for.',
    );
  }
  const separationType = fields['separation_type'];
  if (
    typeof separationType !== 'string' ||
    !(SEPARATION_TYPES as readonly string[]).includes(separationType)
  ) {
    throw invalid('attestation.separation_type', 'expected one of the eight separation types');
  }
  const lastDay = fields['last_day_of_work'];
  if (typeof lastDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) {
    throw invalid('attestation.last_day_of_work', 'expected a calendar date, YYYY-MM-DD');
  }
  // `separationAt` is UTC midnight at the start of the last day of work, once,
  // everywhere. Parsing it here means an impossible date is a 400 rather than a
  // rule that cannot be evaluated.
  separationAtOf(lastDay);

  const method = fields['method'];
  if (typeof method !== 'string' || !METHODS.includes(method as AttestationMethod)) {
    throw invalid('attestation.method', 'expected eip191, hedera_sign_message or unsigned_accepted');
  }
  return {
    fullName: requiredField(fields['full_name'], 'attestation.full_name'),
    employerName: requiredField(fields['employer_name'], 'attestation.employer_name'),
    jobTitle: requiredField(fields['job_title'], 'attestation.job_title'),
    lastDayOfWork: lastDay,
    separationType: separationType as SeparationType,
    // Whether the person ticked the box is stored as it arrives. Rule R09
    // declines an unaccepted statement with a sentence the person can read,
    // which is a better answer than a validation error from a form they have
    // already left.
    statementAccepted: fields['statement_accepted'] === true,
    method: method as AttestationMethod,
    signature: typeof fields['signature'] === 'string' ? fields['signature'] : null,
  };
}

function readFiles(body: Record<string, unknown>, at: number) {
  const raw = body['evidence'];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError(
      400,
      'evidence_missing',
      'Add proof',
      'A claim needs at least one document: a termination or redundancy letter, an unemployment benefit decision, a final pay statement showing the end date, or a P45 or Record of Employment.',
    );
  }
  if (raw.length > MAX_EVIDENCE_FILES) {
    throw new AppError(
      400,
      'too_many_files',
      'Too many files',
      `A claim carries up to ${MAX_EVIDENCE_FILES} documents.`,
    );
  }
  const files = raw.map((value, index) => readEvidence(value, at, index));
  // Rule R30 is the Adjuster's and is soft; the same file twice inside one
  // packet is refused here because the unique index on (claim_id, sha256) would
  // refuse it anyway and a 500 is a worse answer than a sentence.
  const seen = new Set<string>();
  for (const file of files) {
    const digest = createHash('sha256').update(file.bytes).digest('hex');
    if (seen.has(digest)) {
      throw new AppError(
        400,
        'duplicate_evidence',
        'That file is already here',
        'The same document was added twice.',
      );
    }
    seen.add(digest);
  }
  return files;
}

/** The window, off the chain, stored and never recomputed afterwards. */
async function readWindow(
  services: Services,
  series: SeriesRow,
  lastDayOfWork: string,
): Promise<{ qualifyingMonth: number | null; claimDeadline: string | null }> {
  const separationAt = separationAtOf(lastDayOfWork);
  const period = Number(lastDayOfWork.slice(0, 4)) * 100 + Number(lastDayOfWork.slice(5, 7));
  const [answer, deadline] = await Promise.all([
    services.chain.isInLossWindow(series.seriesKey, period),
    services.chain.claimDeadline(series.seriesKey, separationAt),
  ]);
  return {
    qualifyingMonth: answer.inWindow ? answer.qualifyingPeriod : null,
    // Zero means no month qualifies yet, which is a hold rather than a refusal.
    claimDeadline: deadline === 0 ? null : new Date(deadline * 1000).toISOString(),
  };
}

export interface ManifestInput {
  claimId: string;
  policy: PolicyRow;
  credential: VerifiedClaimCredential;
  attestation: ReadAttestation;
  attestationVerified: boolean;
  attestationMessageHash: string;
  evidence: ClaimEvidenceRow[];
  submittedAt: string;
  continuity: boolean;
}

/**
 * The packet manifest, whose SHA-256 is the packet hash.
 *
 * The hash is what `payClaim` is called with and what the claims topic carries,
 * so it needs a preimage that can be shown to somebody who asks. That is why the
 * employer, the claimant's name and the job title appear as `sha256(lower(trim
 * (value)))` and not as themselves: the same rule the decision record follows,
 * for the same reason. What is left is the shape of the packet, the fingerprints
 * of its files and what the identity check returned.
 *
 * The manifest itself stays in the `claims` row. Only its hash is published.
 *
 * Canonicalised with JCS (RFC 8785), the same convention the decision record
 * and the index observation are hashed under, so there is one canonical form in
 * this build and not three.
 */
export function packetManifest(input: ManifestInput): Record<string, unknown> {
  return {
    v: 1,
    type: 'claim_packet',
    claim_id: input.claimId,
    policy_id: input.policy.policyId,
    series_id: input.policy.seriesId,
    group: input.policy.groupKey,
    submitted_at: input.submittedAt,
    world: {
      action: input.credential.world.action,
      environment: input.credential.world.environment,
      credential: input.credential.world.credential,
      presence: input.credential.world.presence,
      verified_at: new Date(input.credential.world.verified_at * 1000).toISOString(),
      continuity: input.continuity,
    },
    attestation: {
      employer_hash: fieldHash(input.attestation.employerName),
      name_hash: fieldHash(input.attestation.fullName),
      job_title_hash: fieldHash(input.attestation.jobTitle),
      last_day_of_work: input.attestation.lastDayOfWork,
      separation_type: input.attestation.separationType,
      statement_accepted: input.attestation.statementAccepted,
      method: input.attestation.method,
      signature_verified: input.attestationVerified,
      message_hash: input.attestationMessageHash,
    },
    evidence: input.evidence.map((file) => ({
      evidence_id: file.evidenceId,
      kind: file.kind,
      content_type: file.contentType,
      size: file.sizeBytes,
      sha256: file.sha256,
    })),
  };
}

/** `sha256:` plus the hex digest of the JCS form. The one definition. */
export function hashManifest(manifest: Record<string, unknown>): string {
  return `sha256:${createHash('sha256')
    .update(canonicalize(manifest as JsonValue), 'utf8')
    .digest('hex')}`;
}

function requiredField(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(path, 'expected a value');
  return value.trim();
}

function invalid(path: string, message: string): AppError {
  return new AppError(400, 'validation_failed', 'Validation failed', `${path}: ${message}`, [
    { path: `body.${path}`, message },
  ]);
}
