import { verifyTypedData } from 'ethers';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  claimAuthorisationDomain,
  CLAIM_AUTHORISATION_TYPES,
  digestToBytes32,
} from '../src/chain/authorisation.js';
import { closeWindows } from '../src/claims/close-windows.js';
import { hashRecord } from '../src/claims/record.js';
import type { ClaimRow, PolicyRow } from '../src/db/types.js';
import { nullifierToBytes32, toBytes32 } from '../src/ids.js';
import {
  ADMIN_TOKENS,
  buildTestServer,
  CLAIM_ID,
  CLAIM_NULLIFIER,
  CLAIM_POLICY_ID,
  claimRow,
  CONFIG,
  POLICYHOLDER_1,
} from './policy-fixtures.js';

/// The approval, the authorisation and the payout, and the window job.
///
/// The chain is recorded, so nothing here reaches testnet, but the signature is
/// a real EIP-712 signature over the real domain and is recovered with ethers
/// rather than compared against a fixture: that is the one thing the contract
/// checks and the one thing a stub would hide.

type Harness = Awaited<ReturnType<typeof buildTestServer>>;

const PACKET_HASH = `sha256:${'11'.repeat(32)}`;

function policyRow(patch: Partial<PolicyRow> = {}): PolicyRow {
  return {
    policyId: CLAIM_POLICY_ID,
    seriesId: 'ODI-COMP-2026-01',
    groupKey: 'computer_math',
    nullifier: CLAIM_NULLIFIER,
    wallet: POLICYHOLDER_1.accountId,
    walletEvm: POLICYHOLDER_1.address,
    coverLimit: '1000000000',
    premium: '28000000',
    asset: '0.0.10366463',
    assetDecimals: 6,
    status: 'claimed',
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

async function seed(harness: Harness, patch: Partial<ClaimRow> = {}): Promise<void> {
  await harness.repository.upsertSeries({
    seriesId: 'ODI-COMP-2026-01',
    seriesKey: CONFIG.series[0]!.seriesId,
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
  harness.repository.putPolicy(policyRow());
  harness.repository.putClaim(
    claimRow({ packetHash: PACKET_HASH, hcsSubmittedSeq: 21, ...patch }),
  );
  harness.chain.set({ status: 'claims_open' });
}

/** The reviewer's decision, which is what the demo's admin screen posts. */
function approve() {
  return { decision: 'approve', reason: 'The letter says redundancy and the dates agree.' };
}

describe('an approved claim is paid', () => {
  let harness: Harness;
  let app: FastifyInstance;

  beforeEach(async () => {
    harness = await buildTestServer();
    app = harness.app;
    await seed(harness);
  });

  afterEach(async () => {
    await app.close();
  });

  it('signs an authorisation the cover pool can recover, and calls payClaim', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/claims/${CLAIM_ID}/decide`,
      headers: { authorization: `Bearer ${ADMIN_TOKENS.admin}` },
      payload: approve(),
    });

    expect(response.statusCode, response.body).toBe(201);
    const body = response.json();
    expect(body.payout.paid).toBe(true);
    expect(body.status).toBe('paid');

    expect(harness.chain.claims).toHaveLength(1);
    const { call, authorisation } = harness.chain.claims[0]!;
    expect(call.policyId).toBe(toBytes32(CLAIM_POLICY_ID));
    expect(call.claimId).toBe(toBytes32(CLAIM_ID));
    expect(call.payee).toBe(POLICYHOLDER_1.address);
    expect(call.amount).toBe(harness.chain.payout);
    expect(call.packetHash).toBe(digestToBytes32(PACKET_HASH));
    // UTC midnight at the start of the last day of work, once, everywhere.
    expect(call.separationAt).toBe(Math.floor(Date.parse('2026-03-13T00:00:00Z') / 1000));

    const signed = harness.chain.authorised[0]!;
    // The nullifier in the digest is the policy's, which is what payClaim reads
    // off the policy. Never the claim's own, when the two differ.
    expect(signed.nullifierHash).toBe(nullifierToBytes32(CLAIM_NULLIFIER));
    const recovered = verifyTypedData(
      claimAuthorisationDomain(CONFIG.chainId, CONFIG.coverPoolAddress),
      CLAIM_AUTHORISATION_TYPES as unknown as Record<string, { name: string; type: string }[]>,
      signed,
      authorisation,
    );
    expect(recovered).toBe(harness.chain.claimsSigner.address);
    // Thirty minutes, matching the credential's life in DESIGN.md 3.6.
    expect(signed.deadline - Math.floor(Date.now() / 1000)).toBeGreaterThan(1700);
    expect(signed.deadline - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(1800);
  });

  it('moves the claim and the cover to paid and records the transaction', async () => {
    await app.inject({
      method: 'POST',
      url: `/v1/admin/claims/${CLAIM_ID}/decide`,
      headers: { authorization: `Bearer ${ADMIN_TOKENS.admin}` },
      payload: approve(),
    });

    const claim = await harness.repository.claim(CLAIM_ID);
    expect(claim?.status).toBe('paid');
    expect(claim?.paidTx).toBe(`0x${'ef'.repeat(32)}`);
    expect(claim?.amount).toBe('1000000000');
    expect(claim?.authorisation).not.toBeNull();
    expect((await harness.repository.policy(CLAIM_POLICY_ID))?.status).toBe('paid');
  });

  it('writes the payout as a payments row and publishes it to the payments topic', async () => {
    await app.inject({
      method: 'POST',
      url: `/v1/admin/claims/${CLAIM_ID}/decide`,
      headers: { authorization: `Bearer ${ADMIN_TOKENS.admin}` },
      payload: approve(),
    });
    await harness.services.outbox.drain();

    const payments = harness.repository.paymentsFor(CLAIM_POLICY_ID);
    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe('settled');
    expect(payments[0]?.chainTxId).toBe(`0x${'ef'.repeat(32)}`);

    const published = harness.hedera.published.map((entry) => JSON.parse(entry.message));
    const payout = published.find((message) => message.kind === 'payout');
    expect(payout).toMatchObject({
      v: 1,
      kind: 'payout',
      policy: CLAIM_POLICY_ID,
      claimId: CLAIM_ID,
      packetHash: PACKET_HASH,
      amount: '1000000000',
    });
    expect(payments[0]?.hcsSeq).toBeGreaterThan(0);
  });

  it('pays once: a second approval finds the transaction already there', async () => {
    await app.inject({
      method: 'POST',
      url: `/v1/admin/claims/${CLAIM_ID}/decide`,
      headers: { authorization: `Bearer ${ADMIN_TOKENS.admin}` },
      payload: approve(),
    });
    const again = await app.inject({
      method: 'POST',
      url: `/v1/admin/claims/${CLAIM_ID}/decide`,
      headers: { authorization: `Bearer ${ADMIN_TOKENS.admin}` },
      payload: approve(),
    });

    expect(again.statusCode).toBe(200);
    expect(again.json().idempotent).toBe(true);
    expect(again.json().payout.idempotent).toBe(true);
    expect(harness.chain.claims).toHaveLength(1);
  });

  it('keeps the decision when the payout reverts, and stores the authorisation to retry', async () => {
    harness.chain.payClaimError = Object.assign(new Error('reverted'), {
      revert: { name: 'PolicyNotActive' },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/claims/${CLAIM_ID}/decide`,
      headers: { authorization: `Bearer ${ADMIN_TOKENS.admin}` },
      payload: approve(),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().payout).toEqual({ paid: false, reason: 'policy_not_claimable' });
    const claim = await harness.repository.claim(CLAIM_ID);
    expect(claim?.status).toBe('approved');
    expect(claim?.paidTx).toBeNull();
    expect(claim?.authorisation).not.toBeNull();

    // The retry: the same endpoint, the same claim, no second decision.
    harness.chain.payClaimError = null;
    const retry = await app.inject({
      method: 'POST',
      url: `/v1/admin/claims/${CLAIM_ID}/decide`,
      headers: { authorization: `Bearer ${ADMIN_TOKENS.admin}` },
      payload: approve(),
    });
    expect(retry.json().payout.paid).toBe(true);
    expect((await harness.repository.claim(CLAIM_ID))?.status).toBe('paid');
  });

  it('refuses to pay an amount the cover pool does not compute', async () => {
    harness.repository.putClaim(
      claimRow({
        packetHash: PACKET_HASH,
        decision: 'approve',
        status: 'approved',
        decisionHash: hashRecord({ v: 1, decision: 'approve' }),
        amount: '999',
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/claims/${CLAIM_ID}/decide`,
      headers: { authorization: `Bearer ${ADMIN_TOKENS.admin}` },
      payload: approve(),
    });

    expect(response.json().payout).toEqual({ paid: false, reason: 'amount_mismatch' });
    expect(harness.chain.claims).toHaveLength(0);
  });

  it('does not pay a decline', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/claims/${CLAIM_ID}/decide`,
      headers: { authorization: `Bearer ${ADMIN_TOKENS.admin}` },
      payload: { decision: 'decline', reason: "Resigning isn't covered." },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().payout).toBeUndefined();
    expect(harness.chain.claims).toHaveLength(0);
  });
});

describe('the claim window job', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await buildTestServer();
  });

  afterEach(async () => {
    await harness.app.close();
  });

  it('refuses before the window ends, and says when it will work', async () => {
    harness.chain.set({ status: 'claims_open' });
    const [result] = await closeWindows(harness.services, {
      now: new Date('2026-09-05T00:00:00Z'),
    });
    expect(result?.closed).toBe(false);
    expect(result?.reason).toBe('window_not_over');
    // The demo series' window ends after the event, which is why the path is
    // proved here and not on it.
    expect(result?.windowEndsAt).toBe(Math.floor(Date.parse('2026-10-05T09:04:51Z') / 1000));
    expect(harness.chain.closed).toHaveLength(0);
  });

  it('closes the window once block time is past it, and follows the chain into the row', async () => {
    harness.chain.set({ status: 'claims_open' });
    const [result] = await closeWindows(harness.services, {
      now: new Date('2026-10-06T00:00:00Z'),
    });
    expect(result?.closed).toBe(true);
    expect(result?.transactionHash).toBe(`0x${'ba'.repeat(32)}`);
    expect(harness.chain.closed).toEqual([CONFIG.series[0]!.seriesId]);
    expect((await harness.repository.series('ODI-COMP-2026-01'))?.status).toBe('active');
  });

  it('does nothing to a series that is not in a claim window', async () => {
    harness.chain.set({ status: 'active' });
    const [result] = await closeWindows(harness.services, {
      now: new Date('2026-10-06T00:00:00Z'),
    });
    expect(result?.closed).toBe(false);
    expect(result?.reason).toBe('series_not_in_claim_window');
    expect(harness.chain.closed).toHaveLength(0);
  });
});
