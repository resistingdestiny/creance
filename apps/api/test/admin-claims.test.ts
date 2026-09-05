import { createHash, randomUUID } from 'node:crypto';

import { canonicalize, type JsonValue } from '@creance/index-model';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openEvidence, sealEvidence, sealField } from '../src/claims/evidence.js';
import type { ClaimEvidenceRow, ClaimRow } from '../src/db/types.js';
import {
  ADMIN_TOKENS,
  buildTestServer,
  POLICYHOLDER_1,
  TEST_EVIDENCE_KEYS,
} from './policy-fixtures.js';

/// The review queue, end to end against the memory repository.

const CLAIM_ID = 'clm_01K4YBA1Q7F0M3X8T5W2D6C9E4';
const POLICY_ID = 'pol_01K4YB9X3M8Q0RZ7T2VD6C5H9E';
const NULLIFIER = '308127544618763950125321744193216571892261741436541721317481123';
const LETTER = Buffer.from('a synthetic redundancy letter, for the test store');

type Harness = Awaited<ReturnType<typeof buildTestServer>>;

function claimRow(patch: Partial<ClaimRow> = {}): ClaimRow {
  return {
    claimId: CLAIM_ID,
    policyId: POLICY_ID,
    seriesId: 'ODI-COMP-2026-01',
    nullifier: NULLIFIER,
    groupKey: 'computer_math',
    status: 'submitted',
    employerNameEnc: sealField(TEST_EVIDENCE_KEYS, 'Northgate Systems Ltd'),
    claimantNameEnc: sealField(TEST_EVIDENCE_KEYS, 'Alex Mercer'),
    jobTitle: 'Software Engineer',
    separationDate: '2026-03-13',
    separationType: 'redundancy',
    attestationMethod: 'eip191',
    attestationVerified: true,
    statementAccepted: true,
    verifiedAt: '2026-09-05T11:56:00Z',
    packetHash: 'sha256:abc',
    packetManifest: null,
    decision: null,
    reasons: [],
    confidence: null,
    reviewer: null,
    decidedBy: null,
    decisionHash: null,
    decisionRecord: null,
    amount: null,
    qualifyingMonth: 202604,
    claimDeadline: '2026-10-05T00:00:00Z',
    hcsSubmittedSeq: 11,
    hcsDecisionSeq: null,
    submittedAt: '2026-09-05T11:58:00Z',
    decidedAt: null,
    ...patch,
  };
}

async function seed(harness: Harness, patch: Partial<ClaimRow> = {}): Promise<ClaimEvidenceRow> {
  await harness.repository.upsertSeries({
    seriesId: 'ODI-COMP-2026-01',
    seriesKey: '0x4f44492d434f4d502d323032362d303100000000000000000000000000000000',
    groupKey: 'computer_math',
    status: 'claims_open',
    principal: '100000000000',
    couponRateBps: 800,
    attachmentShock: 2,
    levelLine: -0.68,
    exhaustionShock: 4,
    payoutMode: 'full',
    termMonths: 12,
    waitingPeriodDays: 60,
    gracePeriodDays: 15,
    claimWindowObsDays: 30,
    claimWindowSepDays: 60,
    lookbackMonths: 2,
    autoApprovalLimit: '5000000000',
    autoApprovalConfidence: 0.9,
    coverPool: null,
    collateralVault: null,
    maturesAt: null,
  });
  harness.repository.putPolicy({
    policyId: POLICY_ID,
    seriesId: 'ODI-COMP-2026-01',
    groupKey: 'computer_math',
    nullifier: NULLIFIER,
    wallet: POLICYHOLDER_1.accountId,
    walletEvm: POLICYHOLDER_1.address,
    coverLimit: '5000000000',
    premium: '28000000',
    asset: '0.0.10366463',
    assetDecimals: 6,
    status: 'claims_open',
    quoteId: null,
    credentialJti: null,
    startsAt: '2025-11-01T00:00:00Z',
    endsAt: '2026-11-01T00:00:00Z',
    claimsPayableFrom: '2025-12-31',
    paidThrough: 202609,
    nextDue: null,
    nftTokenId: null,
    nftSerial: null,
    hcsTopic: null,
    hcsReceiptSeq: null,
    bindTxId: null,
  });

  const evidenceId = `evd_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const sealed = sealEvidence(TEST_EVIDENCE_KEYS, CLAIM_ID, evidenceId, LETTER);
  await harness.evidenceStore.put(sealed.objectKey, sealed.ciphertext);
  const row: ClaimEvidenceRow = {
    evidenceId,
    claimId: CLAIM_ID,
    kind: 'termination_letter',
    filename: 'letter.pdf',
    contentType: 'application/pdf',
    sizeBytes: sealed.sizeBytes,
    sha256: sealed.sha256,
    objectKey: sealed.objectKey,
    encIv: sealed.encIv,
    encTag: sealed.encTag,
    encDek: sealed.encDek,
    encKekId: sealed.encKekId,
    uploadedAt: '2026-09-05T11:57:00Z',
  };
  harness.repository.putClaim(claimRow(patch), [row]);
  return row;
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe('the review queue', () => {
  let harness: Harness;
  let app: FastifyInstance;

  beforeEach(async () => {
    harness = await buildTestServer();
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  it('refuses a request with no token', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/admin/claims' });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('admin_token_required');
  });

  it('refuses a request with the wrong token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/claims',
      headers: bearer('not-the-token'),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('admin_token_invalid');
  });

  it('lists the claims waiting for a human', async () => {
    await seed(harness, { status: 'under_review', reasons: ['separation_reason_not_stated'] });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/claims?status=under_review',
      headers: bearer(ADMIN_TOKENS.admin as string),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.count).toBe(1);
    expect(body.claims[0]).toMatchObject({
      claim_id: CLAIM_ID,
      status: 'under_review',
      reasons: ['separation_reason_not_stated'],
    });
  });

  it('keeps the person out of the queue row', async () => {
    await seed(harness, { status: 'under_review' });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/claims?status=under_review',
      headers: bearer(ADMIN_TOKENS.admin as string),
    });
    expect(response.body).not.toContain('Northgate');
    expect(response.body).not.toContain('Alex Mercer');
    expect(response.body).not.toContain(NULLIFIER);
  });

  it('refuses a status the queue does not serve', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/claims?status=draft',
      headers: bearer(ADMIN_TOKENS.admin as string),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('bad_status');
  });

  it('hands the Adjuster the whole packet in one request', async () => {
    const evidence = await seed(harness);
    const response = await app.inject({
      method: 'GET',
      url: `/v1/admin/claims/${CLAIM_ID}`,
      headers: bearer(ADMIN_TOKENS.adjuster as string),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.attestation).toMatchObject({
      full_name: 'Alex Mercer',
      employer_name: 'Northgate Systems Ltd',
      last_day_of_work: '2026-03-13',
      separation_type: 'redundancy',
      statement_accepted: true,
      method: 'eip191',
    });
    // The window comes off the chain, never from a table beside it.
    expect(body.window.open_months).toEqual(['2026-04', '2026-05']);
    expect(body.window.last_observed_month).toBe('2026-07');
    expect(body.window.claim_deadline).toBe('2026-10-05T00:00:00Z');
    expect(body.series.auto_approval_confidence).toBe(0.9);
    expect(body.evidence[0]).toMatchObject({
      evidence_id: evidence.evidenceId,
      kind: 'termination_letter',
      sha256_seen_in_other_claims: false,
    });
    expect(body.prior_claims).toBe(0);
  });

  it('streams the decrypted document back, with its fingerprint', async () => {
    const evidence = await seed(harness);
    const response = await app.inject({
      method: 'GET',
      url: `/v1/admin/claims/${CLAIM_ID}/evidence/${evidence.evidenceId}`,
      headers: bearer(ADMIN_TOKENS.adjuster as string),
    });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.equals(LETTER)).toBe(true);
    expect(response.headers['x-evidence-sha256']).toBe(evidence.sha256);
  });

  it('refuses to hand back a file whose bytes no longer match its fingerprint', async () => {
    const evidence = await seed(harness);
    await harness.evidenceStore.put(evidence.objectKey, Buffer.from('tampered'));
    const response = await app.inject({
      method: 'GET',
      url: `/v1/admin/claims/${CLAIM_ID}/evidence/${evidence.evidenceId}`,
      headers: bearer(ADMIN_TOKENS.adjuster as string),
    });
    // A tampered ciphertext fails the GCM tag before it can fail the hash, and
    // either way nothing is handed back.
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('deciding a claim', () => {
  let harness: Harness;
  let app: FastifyInstance;

  beforeEach(async () => {
    harness = await buildTestServer();
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      v: 1,
      type: 'adjuster_decision',
      claim_id: CLAIM_ID,
      policy_id: POLICY_ID,
      actor: 'adjuster',
      decision: 'approve',
      reasons: [],
      amount: { amount: '5000000000', asset: '0.0.10366463', decimals: 6 },
      rule_results: [{ rule: 'R07', status: 'pass', required: true }],
      ...overrides,
    };
  }

  function hashOf(value: Record<string, unknown>): string {
    return `sha256:${createHash('sha256').update(canonicalize(value as JsonValue), 'utf8').digest('hex')}`;
  }

  it('stores the record, the hash and the sequence number', async () => {
    await seed(harness);
    const body = record();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/claims/${CLAIM_ID}/decide`,
      headers: bearer(ADMIN_TOKENS.adjuster as string),
      payload: {
        decision: 'approve',
        reasons: [],
        confidence: '0.940',
        record: body,
        decision_hash: hashOf(body),
        hcs_decision_seq: 7,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ status: 'approved', hcs_decision_seq: 7 });

    const stored = await harness.repository.claim(CLAIM_ID);
    expect(stored?.decision).toBe('approve');
    expect(stored?.decisionHash).toBe(hashOf(body));
    expect(stored?.decisionRecord).toEqual(body);
    expect(stored?.amount).toBe('5000000000');
    expect(stored?.decidedBy).toBe('adjuster');
    // The cover moves with the claim: an approved claim beside a policy that
    // still says claims_open is a state nobody downstream can act on.
    expect((await harness.repository.policy(POLICY_ID))?.status).toBe('approved');
  });

  it('refuses a hash that is not the hash of the record beside it', async () => {
    await seed(harness);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/claims/${CLAIM_ID}/decide`,
      headers: bearer(ADMIN_TOKENS.adjuster as string),
      payload: { decision: 'approve', record: record(), decision_hash: 'sha256:deadbeef' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('decision_hash_mismatch');
  });

  it('will not approve past a rule that failed hard, whoever asks', async () => {
    await seed(harness);
    const failing = record({
      decision: 'approve',
      rule_results: [{ rule: 'R07', status: 'fail_hard', required: true }],
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/claims/${CLAIM_ID}/decide`,
      headers: bearer(ADMIN_TOKENS.admin as string),
      payload: { decision: 'approve', record: failing, decision_hash: hashOf(failing) },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('hard_rule_failed');
  });

  it('will not approve past a hard rule already stored on the claim', async () => {
    await seed(harness, {
      status: 'under_review',
      decision: 'decline',
      decisionRecord: { rule_results: [{ rule: 'R20', status: 'fail_hard', required: true }] },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/claims/${CLAIM_ID}/decide`,
      headers: bearer(ADMIN_TOKENS.admin as string),
      payload: { decision: 'approve', reason: 'I read the letter and I disagree.' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('hard_rule_failed');
  });

  it('takes a human decline with one sentence and records who made it', async () => {
    await seed(harness, { status: 'under_review' });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/claims/${CLAIM_ID}/decide`,
      headers: bearer(ADMIN_TOKENS.admin as string),
      payload: { decision: 'decline', reason: 'The letter is about a different job.' },
    });
    expect(response.statusCode).toBe(201);
    const stored = await harness.repository.claim(CLAIM_ID);
    expect(stored?.status).toBe('declined');
    expect(stored?.decidedBy).toBe('reviewer:root');
    expect(stored?.reviewer).toBe('reviewer:root');
  });

  it('refuses a decline with no sentence for the person', async () => {
    await seed(harness, { status: 'under_review' });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/claims/${CLAIM_ID}/decide`,
      headers: bearer(ADMIN_TOKENS.admin as string),
      payload: { decision: 'decline' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('reason_required');
  });

  it('decides once, however many times the pass runs', async () => {
    await seed(harness);
    const body = record();
    const payload = { decision: 'approve', record: body, decision_hash: hashOf(body) };
    const first = await app.inject({
      method: 'POST',
      url: `/v1/admin/claims/${CLAIM_ID}/decide`,
      headers: bearer(ADMIN_TOKENS.adjuster as string),
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: `/v1/admin/claims/${CLAIM_ID}/decide`,
      headers: bearer(ADMIN_TOKENS.adjuster as string),
      payload,
    });
    expect(first.json().idempotent).toBe(false);
    expect(second.statusCode).toBe(200);
    expect(second.json().idempotent).toBe(true);
    expect(second.json().decision).toBe('approve');
  });

  it('refers, which leaves the claim in the queue rather than deciding it', async () => {
    await seed(harness);
    const body = record({ decision: 'refer', reasons: ['separation_reason_not_stated'] });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/claims/${CLAIM_ID}/decide`,
      headers: bearer(ADMIN_TOKENS.adjuster as string),
      payload: {
        decision: 'refer',
        reasons: ['separation_reason_not_stated'],
        record: body,
        decision_hash: hashOf(body),
      },
    });
    expect(response.statusCode).toBe(201);
    const stored = await harness.repository.claim(CLAIM_ID);
    expect(stored?.status).toBe('under_review');
    expect((await harness.repository.policy(POLICY_ID))?.status).toBe('under_review');
  });
});

describe('the evidence envelope', () => {
  it('opens what it sealed, and nothing else', () => {
    const sealed = sealEvidence(TEST_EVIDENCE_KEYS, 'clm_x', 'evd_x', LETTER);
    expect(openEvidence(TEST_EVIDENCE_KEYS, sealed, sealed.ciphertext).equals(LETTER)).toBe(true);
    const tampered = Buffer.from(sealed.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    expect(() => openEvidence(TEST_EVIDENCE_KEYS, sealed, tampered)).toThrow();
  });

  it('hashes the plaintext, which is what the claimant can recompute', () => {
    const sealed = sealEvidence(TEST_EVIDENCE_KEYS, 'clm_x', 'evd_x', LETTER);
    expect(sealed.sha256).toBe(`sha256:${createHash('sha256').update(LETTER).digest('hex')}`);
    expect(sealed.ciphertext.equals(LETTER)).toBe(false);
  });

  it('gives every file its own data key', () => {
    const one = sealEvidence(TEST_EVIDENCE_KEYS, 'clm_x', 'evd_one', LETTER);
    const two = sealEvidence(TEST_EVIDENCE_KEYS, 'clm_x', 'evd_two', LETTER);
    expect(one.encDek.equals(two.encDek)).toBe(false);
    expect(one.ciphertext.equals(two.ciphertext)).toBe(false);
  });
});
