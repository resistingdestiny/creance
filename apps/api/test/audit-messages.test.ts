import type { FastifyBaseLogger } from 'fastify';
import { auditFacts, parseTopicMessage } from '@creance/client';
import { describe, expect, it } from 'vitest';

import {
  claimDecisionMessage,
  claimPacketMessage,
  payoutMessage,
  premiumMessage,
} from '../src/audit/messages.js';
import {
  publishClaimDecision,
  publishClaimPacket,
  publishPayout,
  publishPremium,
} from '../src/audit/publish.js';
import { policyBindingMessage, policyBoundMessage, encodeTopicMessage } from '../src/receipts.js';
import { settlementMessage } from '../src/x402/receipts.js';
import { TopicOutbox } from '../src/x402/settlement.js';
import { FakeHedera } from './policy-fixtures.js';

/// Every writer's output, read back by the parser in @creance/client.
///
/// This is the round trip that keeps the two halves of the audit trail from
/// drifting: the writers here and in contracts, the reader in the shared
/// client that apps/api and apps/web both use. A field renamed on one side
/// fails here rather than on a topic that cannot be rewritten.

const AT = new Date('2026-09-05T12:00:00.000Z');

function silentLog(): FastifyBaseLogger {
  const noop = () => undefined;
  return {
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    silent: noop,
    level: 'silent',
    child: () => silentLog(),
  } as unknown as FastifyBaseLogger;
}

function roundTrip(message: unknown) {
  return parseTopicMessage(encodeTopicMessage(message));
}

describe('the messages the payments topic carries', () => {
  it('round-trips the binding receipt and the outcome the bind writes', () => {
    const binding = roundTrip(
      policyBindingMessage({
        seriesLabel: 'ODI-COMP-2026-01',
        seriesKey: `0x${'11'.repeat(32)}`,
        policyId: 'pol_01M1RG5GHA82D523FDHJPXFXA8',
        groupKey: 'computer_math',
        holderAccountId: '0.0.10366457',
        holderAddress: '0xf4801d2881df3f4deccf6f4b22302232cbfa5c13',
        limit: 1_000_000_000n,
        premium: 841_667n,
        tokenId: '0.0.10366463',
        startAt: AT,
        quotedAt: AT,
      }),
    );
    expect(binding.kind).toBe('policy');
    expect(auditFacts(binding).policy).toBe('pol_01M1RG5GHA82D523FDHJPXFXA8');

    const bound = roundTrip(
      policyBoundMessage({
        seriesLabel: 'ODI-COMP-2026-01',
        policyId: 'pol_01M1RG5GHA82D523FDHJPXFXA8',
        receiptSeq: 18,
        status: 'bound',
        bindTx: `0x${'34'.repeat(32)}`,
        nftTokenId: '0.0.10366468',
        serial: 6,
        at: AT,
      }),
    );
    expect(bound.kind).toBe('policy');
    expect(auditFacts(bound).transactionId).toBe(`0x${'34'.repeat(32)}`);
  });

  it('round-trips an x402 settlement', () => {
    const message = roundTrip(
      settlementMessage({
        endpoint: 'POST /v1/bind',
        scheme: 'exact',
        network: 'hedera:testnet',
        payer: '0.0.10366451',
        payTo: '0.0.10366450',
        amount: '841667',
        asset: '0.0.10366463',
        decimals: 6,
        transactionId: '0.0.7162784@1788602397.120605122',
        facilitator: 'https://api.testnet.blocky402.com',
        ref: 'pol_01M1RG5GHA82D523FDHJPXFXA8',
        at: AT,
      }),
    );
    expect(message.kind).toBe('settlement');
    expect(auditFacts(message).amount).toEqual({
      amount: '841667',
      asset: '0.0.10366463',
      decimals: 6,
    });
  });

  it('round-trips a premium and keeps the period an integer month', () => {
    const message = roundTrip(
      premiumMessage({
        policyId: 'pol_01M1RG5GHA82D523FDHJPXFXA8',
        period: 202610,
        scheduleId: '0.0.10368878',
        transactionId: '0.0.10366453-1788602397-120605122',
        amount: 841_667n,
        asset: '0.0.10366463',
        decimals: 6,
        payer: '0.0.10366453',
        at: AT,
      }),
    );
    expect(message).toMatchObject({ v: 1, kind: 'premium', period: 202610, amount: '841667' });
    expect(auditFacts(message).at).toBe('2026-09-05T12:00:00.000Z');
  });

  it('round-trips a payout carrying both hashes', () => {
    const message = roundTrip(
      payoutMessage({
        policyId: 'pol_01M1RG5GHA82D523FDHJPXFXA8',
        claimId: 'clm_01M1RG5GHA82D523FDHJPXFXA8',
        packetHash: `sha256:${'ab'.repeat(32)}`,
        decisionHash: `sha256:${'cd'.repeat(32)}`,
        amount: 1_000_000_000n,
        asset: '0.0.10366463',
        decimals: 6,
        transactionId: `0x${'ef'.repeat(32)}`,
        at: AT,
      }),
    );
    expect(message.kind).toBe('payout');
    expect(auditFacts(message).amount?.amount).toBe('1000000000');
  });
});

describe('the messages the claims topic carries', () => {
  it('publishes hashes and nothing else', () => {
    const packet = claimPacketMessage({
      policyId: 'pol_1',
      claimId: 'clm_1',
      packetHash: 'ab'.repeat(32),
      evidence: ['cd'.repeat(32), `sha256:${'ef'.repeat(32)}`],
      at: AT,
    });
    // A bare hex hash gets the prefix; one that has it is left alone.
    expect(packet.packetHash).toBe(`sha256:${'ab'.repeat(32)}`);
    expect(packet.evidence).toEqual([`sha256:${'cd'.repeat(32)}`, `sha256:${'ef'.repeat(32)}`]);
    // DESIGN.md 3.9: no file name, no employer, no date of separation.
    const json = encodeTopicMessage(packet);
    expect(Object.keys(JSON.parse(json))).toEqual([
      'v',
      'kind',
      'policy',
      'claimId',
      'packetHash',
      'evidence',
      'at',
    ]);
    expect(roundTrip(packet).kind).toBe('claim_packet');
  });

  it('round-trips a decision without its reasons', () => {
    const decision = claimDecisionMessage({
      policyId: 'pol_1',
      claimId: 'clm_1',
      decisionHash: 'cd'.repeat(32),
      decision: 'approve',
      at: AT,
    });
    expect(roundTrip(decision)).toMatchObject({ kind: 'claim_decision', decision: 'approve' });
    expect(encodeTopicMessage(decision)).not.toContain('reason');
  });
});

describe('the audit publishers', () => {
  function sink(overrides: { writer?: FakeHedera | null; topicId?: string } = {}) {
    const writer = overrides.writer === undefined ? new FakeHedera() : overrides.writer;
    return {
      writer,
      topicId: overrides.topicId ?? '0.0.10366471',
      log: silentLog(),
      outbox: new TopicOutbox({ delay: async () => undefined }),
      hedera: writer,
    };
  }

  it('hands back the sequence number the caller has to store', async () => {
    const target = sink();
    const receipt = await publishPremium(target, {
      policyId: 'pol_1',
      period: 202610,
      scheduleId: '0.0.10368878',
      transactionId: '0.0.10366453-1788602397-120605122',
      amount: '841667',
      asset: '0.0.10366463',
      decimals: 6,
      payer: '0.0.10366453',
      at: AT,
    });
    expect(receipt?.sequenceNumber).toBe(41);
    expect(target.hedera?.published[0]?.topicId).toBe('0.0.10366471');
    expect(JSON.parse(target.hedera?.published[0]?.message ?? '{}').kind).toBe('premium');
  });

  it('publishes the claims messages with the writer it is given', async () => {
    const adjuster = new FakeHedera();
    const target = { ...sink({ writer: adjuster }), topicId: '0.0.10366473' };
    await publishClaimPacket(target, {
      policyId: 'pol_1',
      claimId: 'clm_1',
      packetHash: 'ab'.repeat(32),
      evidence: [],
      at: AT,
    });
    await publishClaimDecision(target, {
      policyId: 'pol_1',
      claimId: 'clm_1',
      decisionHash: 'cd'.repeat(32),
      decision: 'refer',
      at: AT,
    });
    expect(adjuster.published.map((entry) => entry.topicId)).toEqual([
      '0.0.10366473',
      '0.0.10366473',
    ]);
  });

  const PAYOUT = {
    policyId: 'pol_1',
    claimId: 'clm_1',
    packetHash: 'ab'.repeat(32),
    decisionHash: 'cd'.repeat(32),
    amount: '1000000000',
    asset: '0.0.10366463',
    decimals: 6,
    transactionId: `0x${'ef'.repeat(32)}`,
    at: AT,
  };

  it('retries a topic that refused the message once', async () => {
    const writer = new FakeHedera();
    let refusals = 0;
    const publish = writer.publish.bind(writer);
    writer.publish = async (topicId: string, message: string) => {
      refusals += 1;
      if (refusals === 1) throw new Error('BUSY');
      return await publish(topicId, message);
    };
    const receipt = await publishPayout({ ...sink({ writer }), writer }, PAYOUT);
    expect(refusals).toBe(2);
    expect(receipt?.sequenceNumber).toBe(41);
  });

  it('gives up with a null rather than a throw when the topic keeps refusing', async () => {
    const writer = new FakeHedera();
    writer.failPublishAt = 1;
    const receipt = await publishPayout({ ...sink({ writer }), writer }, PAYOUT);
    expect(receipt).toBeNull();
    expect(writer.published).toHaveLength(0);
  });

  it('refuses quietly when this process holds no key for the topic', async () => {
    const target = sink({ writer: null });
    const receipt = await publishPremium(target, {
      policyId: 'pol_1',
      period: 202610,
      scheduleId: '0.0.10368878',
      transactionId: '0.0.10366453-1788602397-120605122',
      amount: '841667',
      asset: '0.0.10366463',
      decimals: 6,
      payer: '0.0.10366453',
      at: AT,
    });
    expect(receipt).toBeNull();
  });
});
