import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { settlementMessage } from '../src/x402/receipts.js';
import {
  buildTestServer,
  issueCredential,
  MirrorStub,
  POLICYHOLDER_1,
  type TestHarness,
} from './policy-fixtures.js';

/// GET /v1/audit/:policyId, driven through Fastify's injector.
///
/// The interesting part of the setup is that the messages the endpoint reads
/// back are the ones the bind path really published: the fake Hedera gateway
/// collects them, and they are put on the stub mirror at the sequence numbers
/// the gateway handed out. So this exercises the writers and the reader
/// together, which is the pair that has to agree.

const CONSENSUS = 1_788_602_400;

describe('the audit endpoint', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  async function boundPolicy(mirror = new MirrorStub()) {
    const built = await buildTestServer({ mirror });
    app = built.app;
    const quote = (
      await built.app.inject({
        method: 'POST',
        url: '/v1/quote',
        payload: {
          group: 'computer_math',
          limit: '5000000000',
          wallet: POLICYHOLDER_1.accountId,
        },
      })
    ).json();
    const token = await issueCredential(built);
    const policy = (
      await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${token}` },
        payload: { quote_id: quote.quote_id },
      })
    ).json();

    // What the bind published, put on the topic the endpoint reads.
    built.hedera.published.forEach((entry, index) => {
      mirror.add(entry.topicId, 41 + index, entry.message, `${CONSENSUS + index}.000000000`);
    });
    return { built, quote, policy, mirror };
  }

  /** Settle the first premium the way the x402 hook does, and publish it. */
  async function settlePremium(
    context: Awaited<ReturnType<typeof boundPolicy>>,
    options: { sequenceNumber: number | null } = { sequenceNumber: 43 },
  ) {
    const [row] = context.built.repository.paymentsFor(context.policy.policy_id);
    if (row === undefined) throw new Error('the bind wrote no payment row');
    const transactionId = '0.0.7162784@1788602397.120605122';
    await context.built.repository.updatePayment(row.paymentId, {
      status: 'settled',
      payer: '0.0.10366451',
      facilitator: 'https://api.testnet.blocky402.com',
      facilitatorTx: transactionId,
      settledAt: '2026-09-05T10:00:21.414Z',
      ...(options.sequenceNumber === null
        ? {}
        : { hcsTopic: '0.0.10366471', hcsSeq: options.sequenceNumber }),
    });
    if (options.sequenceNumber !== null) {
      context.mirror.add(
        '0.0.10366471',
        options.sequenceNumber,
        JSON.stringify(
          settlementMessage({
            endpoint: 'POST /v1/bind',
            scheme: 'exact',
            network: 'hedera:testnet',
            payer: '0.0.10366451',
            payTo: '0.0.10366450',
            amount: row.amount,
            asset: row.asset,
            decimals: row.assetDecimals,
            transactionId,
            facilitator: 'https://api.testnet.blocky402.com',
            ref: context.policy.policy_id,
            at: new Date('2026-09-05T10:00:21.414Z'),
          }),
        ),
        `${CONSENSUS + 21}.000000000`,
      );
    }
    return row;
  }

  function get(built: TestHarness & { app: FastifyInstance }, id: string) {
    return built.app.inject({ method: 'GET', url: `/v1/audit/${id}` });
  }

  it('refuses an id that is not a policy id, and 404s one it does not have', async () => {
    const context = await boundPolicy();
    const wrong = await get(context.built, 'qte_01M1RG5DHEEDZ060KPJXTBTE47');
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().code).toBe('bad_id_prefix');

    const missing = await get(context.built, 'pol_01M1RG5GHA82D523FDHJPXFXA8');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('policy_not_found');
  });

  it('reads the two policy messages back off the topic, in consensus order', async () => {
    const context = await boundPolicy();
    const body = (await get(context.built, context.policy.policy_id)).json();

    const policyEntries = body.entries.filter((entry: { kind: string }) => entry.kind === 'policy');
    expect(policyEntries.map((entry: { detail: { status: string } }) => entry.detail.status)).toEqual([
      'binding',
      'bound',
    ]);
    expect(policyEntries.every((entry: { source: string }) => entry.source === 'topic')).toBe(true);
    expect(policyEntries[0].hcs).toMatchObject({
      topic_id: '0.0.10366471',
      sequence_number: 41,
      hashscan: 'https://hashscan.io/testnet/topic/0.0.10366471',
    });
    expect(policyEntries[1].detail.receipt_sequence_number).toBe(41);
    expect(policyEntries[1].tx.hashscan).toBe(
      `https://hashscan.io/testnet/transaction/${policyEntries[1].tx.id}`,
    );
    expect(policyEntries[0].amount).toMatchObject({ asset: '0.0.10366463', decimals: 6 });
  });

  it('carries the settled premium with its facilitator transaction', async () => {
    const context = await boundPolicy();
    await settlePremium(context);
    const body = (await get(context.built, context.policy.policy_id)).json();

    const settlement = body.entries.find((entry: { kind: string }) => entry.kind === 'settlement');
    expect(settlement.source).toBe('topic');
    expect(settlement.detail.endpoint).toBe('POST /v1/bind');
    expect(settlement.detail.ref).toBe(context.policy.policy_id);
    // The `@` form the facilitator returns resolves nowhere on HashScan.
    expect(settlement.tx.id).toBe('0.0.7162784@1788602397.120605122');
    expect(settlement.tx.hashscan).toBe(
      'https://hashscan.io/testnet/transaction/0.0.7162784-1788602397-120605122',
    );
    expect(settlement.amount.display).toBe(settlement.amount.display);
    expect(body.summary.entries_on_topic).toBe(3);
  });

  it('marks a settled payment whose message never reached the topic', async () => {
    const context = await boundPolicy();
    await settlePremium(context, { sequenceNumber: null });
    const body = (await get(context.built, context.policy.policy_id)).json();

    const settlement = body.entries.find((entry: { kind: string }) => entry.kind === 'settlement');
    expect(settlement.source).toBe('not_yet_on_topic');
    expect(settlement.hcs.sequence_number).toBeNull();
    expect(settlement.detail.payment_status).toBe('settled');
    expect(settlement.amount.amount).toBe(context.policy.premium.amount);
  });

  it('answers with the sequence numbers when the mirror node cannot be read', async () => {
    const context = await boundPolicy();
    await settlePremium(context);
    context.mirror.unreachable = true;
    const response = await get(context.built, context.policy.policy_id);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.summary.entries_on_topic).toBe(0);
    expect(
      body.entries.every((entry: { source: string }) => entry.source === 'mirror_unavailable'),
    ).toBe(true);
    // The row still carries the payment, so the amount and the transaction do
    // not disappear when the mirror is down.
    const settlement = body.entries.find((entry: { kind: string }) => entry.kind === 'settlement');
    expect(settlement.tx.id).toBe('0.0.7162784@1788602397.120605122');
  });

  it('shows the claim hashes from the claims topic and marks the one not there', async () => {
    const context = await boundPolicy();
    context.mirror.add(
      '0.0.10366473',
      1,
      {
        v: 1,
        kind: 'claim_packet',
        policy: context.policy.policy_id,
        claimId: 'clm_01M1RG5GHA82D523FDHJPXFXA8',
        packetHash: `sha256:${'ab'.repeat(32)}`,
        evidence: [`sha256:${'cd'.repeat(32)}`],
        at: '2026-09-06T09:00:00.000Z',
      },
      `${CONSENSUS + 3600}.000000000`,
    );
    context.built.repository.addClaim(context.policy.policy_id, {
      claimId: 'clm_01M1RG5GHA82D523FDHJPXFXA8',
      status: 'under_review',
      packetHash: `sha256:${'ab'.repeat(32)}`,
      decisionHash: `sha256:${'ef'.repeat(32)}`,
      decision: 'refer',
      amount: null,
      hcsSubmittedSeq: 1,
      hcsDecisionSeq: null,
      paidTx: null,
      submittedAt: '2026-09-06T09:00:00.000Z',
      decidedAt: '2026-09-06T09:30:00.000Z',
      paidAt: null,
    });

    const body = (await get(context.built, context.policy.policy_id)).json();
    const packet = body.entries.find((entry: { kind: string }) => entry.kind === 'claim_packet');
    const decision = body.entries.find((entry: { kind: string }) => entry.kind === 'claim_decision');

    expect(packet.source).toBe('topic');
    expect(packet.hcs.topic_id).toBe('0.0.10366473');
    expect(packet.detail.evidence).toEqual([`sha256:${'cd'.repeat(32)}`]);
    expect(decision.source).toBe('not_yet_on_topic');
    expect(decision.detail.decision).toBe('refer');
    expect(body.summary.claims_topic.hashscan).toBe(
      'https://hashscan.io/testnet/topic/0.0.10366473',
    );
  });

  it('links the receipt, the bind and the pool, and leaks nothing about a person', async () => {
    const context = await boundPolicy();
    await settlePremium(context);
    const response = await get(context.built, context.policy.policy_id);
    const body = response.json();

    expect(body.summary.policy_nft.hashscan).toBe(
      'https://hashscan.io/testnet/token/0.0.10366468/1',
    );
    expect(body.summary.bind_transaction.hashscan).toBe(
      `https://hashscan.io/testnet/transaction/${body.summary.bind_transaction.id}`,
    );
    expect(body.summary.cover_pool.hashscan).toBe(
      'https://hashscan.io/testnet/contract/0x6358ddd5AA2e1797ddA949D7d82eA86C9F89ff09',
    );
    expect(body.summary.payments_topic.id).toBe('0.0.10366471');

    // The holder's EVM address is on the binding message and must not be on
    // the response; neither may the nullifier, in any form.
    const text = response.body;
    expect(text).not.toContain(POLICYHOLDER_1.address);
    expect(text.toLowerCase()).not.toContain('nullifier');
    expect(text).not.toContain('5972000000000000000000000000000000000000000000000009143');
  });
});
