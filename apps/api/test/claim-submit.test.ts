import { Wallet } from 'ethers';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { attestationMessage } from '../src/claims/attestation.js';
import { hashManifest } from '../src/claims/submit.js';
import { openEvidence } from '../src/claims/evidence.js';
import type { PolicyRow, SeriesRow } from '../src/db/types.js';
import {
  buildTestServer,
  CLAIM_NULLIFIER,
  CLAIM_POLICY_ID,
  observation,
  TEST_EVIDENCE_KEYS,
} from './policy-fixtures.js';

/// POST /v1/claims, the packet of DESIGN.md 3.9, against the memory repository.
///
/// The wallet is a real key and the attestation is a real EIP-191 signature, so
/// the recovery is the one the route runs and not a stub of it. Everything the
/// route reaches for beyond that is behind an interface: the chain, the store
/// and the database.

// A one page PDF is a header and nothing else as far as the sniffing goes.
const LETTER = Buffer.concat([
  Buffer.from('%PDF-1.4\n'),
  Buffer.from('a synthetic redundancy letter, for the test store'),
]);

const HOLDER = new Wallet(`0x${'42'.repeat(32)}`);

type Harness = Awaited<ReturnType<typeof buildTestServer>>;

function seriesRow(patch: Partial<SeriesRow> = {}): SeriesRow {
  return {
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
    ...patch,
  };
}

function policyRow(patch: Partial<PolicyRow> = {}): PolicyRow {
  return {
    policyId: CLAIM_POLICY_ID,
    seriesId: 'ODI-COMP-2026-01',
    groupKey: 'computer_math',
    nullifier: CLAIM_NULLIFIER,
    wallet: '0.0.10366453',
    walletEvm: HOLDER.address,
    coverLimit: '1000000000',
    premium: '28000000',
    asset: '0.0.10366463',
    assetDecimals: 6,
    status: 'active',
    quoteId: null,
    credentialJti: null,
    startsAt: '2025-12-01T00:00:00Z',
    endsAt: '2026-12-01T00:00:00Z',
    claimsPayableFrom: '2026-01-30',
    paidThrough: 202609,
    nextDue: null,
    nftTokenId: null,
    nftSerial: null,
    hcsTopic: null,
    hcsReceiptSeq: null,
    bindTxId: null,
    ...patch,
  };
}

async function seed(harness: Harness, patch: Partial<PolicyRow> = {}): Promise<void> {
  await harness.repository.upsertSeries(seriesRow());
  await harness.repository.upsertUser({
    nullifier: CLAIM_NULLIFIER,
    groupKey: 'computer_math',
    wallet: '0.0.10366453',
    walletEvm: HOLDER.address,
  });
  harness.repository.putPolicy(policyRow(patch));
  harness.chain.set({ status: 'claims_open' });
}

async function claimCredential(app: FastifyInstance, policyId = CLAIM_POLICY_ID): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/demo/claim-presence',
    payload: { policy_id: policyId },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().claim_credential as string;
}

async function packet(
  overrides: {
    lastDayOfWork?: string;
    separationType?: string;
    signer?: Wallet;
    method?: string;
    evidence?: unknown[];
    statementAccepted?: boolean;
  } = {},
): Promise<Record<string, unknown>> {
  const lastDayOfWork = overrides.lastDayOfWork ?? '2026-03-13';
  const separationType = overrides.separationType ?? 'redundancy';
  const message = attestationMessage({
    policyId: CLAIM_POLICY_ID,
    seriesId: 'ODI-COMP-2026-01',
    fullName: 'Alex Mercer',
    employerName: 'Northgate Systems Ltd',
    jobTitle: 'Software Engineer',
    groupKey: 'computer_math',
    lastDayOfWork,
    separationType: separationType as 'redundancy',
  });
  const signature = await (overrides.signer ?? HOLDER).signMessage(message);
  return {
    attestation: {
      full_name: 'Alex Mercer',
      employer_name: 'Northgate Systems Ltd',
      job_title: 'Software Engineer',
      group: 'computer_math',
      last_day_of_work: lastDayOfWork,
      separation_type: separationType,
      statement_accepted: overrides.statementAccepted ?? true,
      method: overrides.method ?? 'eip191',
      signature,
    },
    evidence: overrides.evidence ?? [
      {
        kind: 'termination_letter',
        filename: 'letter.pdf',
        content_base64: LETTER.toString('base64'),
      },
    ],
  };
}

describe('POST /v1/claims', () => {
  let harness: Harness;
  let app: FastifyInstance;

  beforeEach(async () => {
    harness = await buildTestServer();
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  it('stores the packet, seals the evidence and puts the claim in the queue', async () => {
    await seed(harness);
    const credential = await claimCredential(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/claims',
      headers: { authorization: `Bearer ${credential}` },
      payload: await packet(),
    });

    expect(response.statusCode, response.body).toBe(201);
    const body = response.json();
    expect(body.status).toBe('submitted');
    expect(body.claim_id).toMatch(/^clm_/);
    expect(body.packet_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(body.attestation.signature_verified).toBe(true);
    expect(body.evidence).toHaveLength(1);
    expect(body.evidence[0].sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    // The window comes off the chain and is stored, never recomputed.
    expect(body.window.qualifying_month).toBe('2026-04');
    expect(body.window.claim_deadline).toBe('2026-10-05T00:00:00Z');
    expect(body.title).toBe('Claim received.');

    const stored = await harness.repository.claim(body.claim_id);
    expect(stored?.status).toBe('submitted');
    expect(stored?.worldPresence).toBe(true);
    expect(stored?.packetHash).toBe(body.packet_hash);
    // The cover moves with the claim, so nothing downstream sees a submitted
    // claim beside a policy that says nothing happened.
    expect((await harness.repository.policy(CLAIM_POLICY_ID))?.status).toBe('claimed');
  });

  it('encrypts the document at rest and stores the hash of the plaintext', async () => {
    await seed(harness);
    const credential = await claimCredential(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/claims',
      headers: { authorization: `Bearer ${credential}` },
      payload: await packet(),
    });
    const claimId = response.json().claim_id as string;

    const [row] = await harness.repository.claimEvidence(claimId);
    expect(row).toBeDefined();
    const ciphertext = await harness.evidenceStore.get(row!.objectKey);
    expect(ciphertext.equals(LETTER)).toBe(false);
    expect(openEvidence(TEST_EVIDENCE_KEYS, row!, ciphertext).equals(LETTER)).toBe(true);
  });

  it('hashes the manifest it stored, and the manifest names no employer', async () => {
    await seed(harness);
    const credential = await claimCredential(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/claims',
      headers: { authorization: `Bearer ${credential}` },
      payload: await packet(),
    });
    const stored = await harness.repository.claim(response.json().claim_id as string);
    expect(stored?.packetManifest).not.toBeNull();
    expect(hashManifest(stored!.packetManifest!)).toBe(stored!.packetHash);
    const serialised = JSON.stringify(stored!.packetManifest);
    expect(serialised).not.toContain('Northgate');
    expect(serialised).not.toContain('Alex Mercer');
  });

  it("refuses with the 'Claims aren't open' state and the current reading", async () => {
    harness = await buildTestServer({ observations: [observation({ ebar: -1.2 })] });
    app = harness.app;
    await seed(harness);
    harness.chain.set({ status: 'active' });
    const credential = await claimCredential(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/claims',
      headers: { authorization: `Bearer ${credential}` },
      payload: await packet(),
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.code).toBe('claims_not_open');
    expect(body.title).toBe("Claims aren't open.");
    expect(body.detail).toBe(
      'Your occupation is 1.20 better than average. Claims open within 0.68 of average.' +
        " We'll tell you here if that changes.",
    );
  });

  it('refuses an attestation signed by a wallet other than the one holding the cover', async () => {
    await seed(harness);
    const credential = await claimCredential(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/claims',
      headers: { authorization: `Bearer ${credential}` },
      payload: await packet({ signer: new Wallet(`0x${'99'.repeat(32)}`) }),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('attestation_wrong_wallet');
  });

  it('accepts a resignation, because a decline is the Adjuster\'s answer and carries a reason', async () => {
    await seed(harness);
    const credential = await claimCredential(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/claims',
      headers: { authorization: `Bearer ${credential}` },
      payload: await packet({ separationType: 'resignation' }),
    });
    expect(response.statusCode, response.body).toBe(201);
    const stored = await harness.repository.claim(response.json().claim_id as string);
    expect(stored?.separationType).toBe('resignation');
    expect(stored?.status).toBe('submitted');
  });

  it('takes one claim per person per series and refuses the second', async () => {
    await seed(harness);
    const first = await app.inject({
      method: 'POST',
      url: '/v1/claims',
      headers: { authorization: `Bearer ${await claimCredential(app)}` },
      payload: await packet(),
    });
    expect(first.statusCode, first.body).toBe(201);

    // The cover moved to claimed, so a second attempt is refused before the
    // index even gets a chance to.
    const second = await app.inject({
      method: 'POST',
      url: '/v1/claims',
      headers: { authorization: `Bearer ${await claimCredential(app)}` },
      payload: await packet(),
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('policy_not_claimable');
  });

  it('needs a document', async () => {
    await seed(harness);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/claims',
      headers: { authorization: `Bearer ${await claimCredential(app)}` },
      payload: await packet({ evidence: [] }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('evidence_missing');
  });

  it('refuses a file whose bytes are not a document it can read', async () => {
    await seed(harness);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/claims',
      headers: { authorization: `Bearer ${await claimCredential(app)}` },
      payload: await packet({
        evidence: [
          {
            kind: 'termination_letter',
            filename: 'letter.pdf',
            content_base64: Buffer.from('this is not a pdf at all').toString('base64'),
          },
        ],
      }),
    });
    expect(response.statusCode).toBe(415);
    expect(response.json().code).toBe('evidence_type_unsupported');
  });

  it('refuses a check with no credential at all', async () => {
    await seed(harness);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/claims',
      payload: await packet(),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('credential_missing');
  });

  it('refuses an eligibility credential presented in place of a claim credential', async () => {
    await seed(harness);
    const eligibility = await app.inject({
      method: 'POST',
      url: '/v1/demo/eligibility',
      payload: {
        group: 'computer_math',
        wallet: '0.0.10366453',
        wallet_evm: HOLDER.address,
        nullifier: CLAIM_NULLIFIER,
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/claims',
      headers: { authorization: `Bearer ${eligibility.json().eligibility}` },
      payload: await packet(),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('credential_invalid');
  });
});
