import { describe, expect, it } from 'vitest';

import {
  auditFacts,
  parseTopicMessage,
  readTopicMessage,
  type PolicyOutcomeMessage,
  type SettlementMessage,
} from '../src/audit.js';

/// The parser, against messages that are actually on the payments topic.
///
/// Every fixture below was read back from the mirror node at
/// https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10366471/messages/{n}
/// on 5 September 2026, so these are bytes the writers really produced and not
/// a restatement of what they were meant to produce. The writers' own tests
/// round-trip their output through this parser as well; this file is the other
/// half, a reader checked against history it did not write.

/** Payments topic 0.0.10366471, sequence 1: the first coupon settlement. */
const COUPON_1 =
  '{"v":1,"kind":"coupon","series":"ODI-COMP-2026-01","seriesId":"0x4f44492d434f4d502d323032362d303100000000000000000000000000000000","couponId":"1","holder":"0.0.10366460","holderAddress":"0xb6c2ff466e3c73f1a49a3f1b936f8e3837112931","numerator":"1036800000000000000","denominator":"3153600000000000","amount":"328767123","token":"0.0.10366463","scheduleId":"0.0.10368878","transactionId":"0.0.10366450-1788556746-724064738","result":"SUCCESS","paidAt":"1788556871.150984988"}';

/** Sequence 18: the receipt the bind quoted, written before CoverPool.bind. */
const POLICY_BINDING_18 =
  '{"v":1,"kind":"policy","status":"binding","series":"ODI-COMP-2026-01","seriesId":"0x4f44492d434f4d502d323032362d303100000000000000000000000000000000","policy":"pol_01M1RG5GHA82D523FDHJPXFXA8","group":"computer_math","holder":"0.0.10366457","holderAddress":"0xf4801d2881df3f4deccf6f4b22302232cbfa5c13","limit":"1000000000","premium":"841667","token":"0.0.10366463","startAt":"2026-09-05T10:00:01.322Z","quotedAt":"2026-09-05T09:59:58.254Z"}';

/** Sequence 19: what the chain did with it. */
const POLICY_BOUND_19 =
  '{"v":1,"kind":"policy","status":"bound","series":"ODI-COMP-2026-01","policy":"pol_01M1RG5GHA82D523FDHJPXFXA8","receiptSeq":18,"bindTx":"0x34449e5df8100a6c4d9d9d0dd0245e36ceb54cb4fc21c502bb2d5b4555bca7ec","nft":"0.0.10366468","serial":6,"at":"2026-09-05T10:00:16.462Z"}';

/** Sequence 20: the first premium, settled over x402 through the facilitator. */
const SETTLEMENT_20 =
  '{"v":1,"kind":"settlement","endpoint":"POST /v1/bind","x402":2,"scheme":"exact","network":"hedera:testnet","payer":"0.0.10366451","payTo":"0.0.10366450","amount":"841667","asset":"0.0.10366463","decimals":6,"tx":"0.0.7162784@1788602397.120605122","facilitator":"api.testnet.blocky402.com","ref":"pol_01M1RG5GHA82D523FDHJPXFXA8","at":"2026-09-05T10:00:21.414Z"}';

describe('the payments topic parser', () => {
  it('reads a coupon settlement and finds its amount and transaction', () => {
    const message = parseTopicMessage(COUPON_1);
    expect(message.kind).toBe('coupon');
    const facts = auditFacts(message);
    expect(facts.transactionId).toBe('0.0.10366450-1788556746-724064738');
    expect(facts.amount).toEqual({ amount: '328767123', asset: '0.0.10366463', decimals: null });
    // The coupon writer stamps a consensus timestamp, not an RFC 3339 instant,
    // so a reader must not assume one shape. See docs/DECISIONS.md, T18.
    expect(facts.at).toBe('1788556871.150984988');
  });

  it('tells the two policy messages apart by their status', () => {
    const binding = parseTopicMessage(POLICY_BINDING_18);
    const bound = parseTopicMessage(POLICY_BOUND_19);
    expect(binding.kind).toBe('policy');
    expect(bound.kind).toBe('policy');
    expect((bound as PolicyOutcomeMessage).receiptSeq).toBe(18);
    expect(auditFacts(binding).at).toBeNull();
    expect(auditFacts(bound).transactionId).toBe(
      '0x34449e5df8100a6c4d9d9d0dd0245e36ceb54cb4fc21c502bb2d5b4555bca7ec',
    );
    expect(auditFacts(binding).policy).toBe('pol_01M1RG5GHA82D523FDHJPXFXA8');
  });

  it('reads a settlement with the scale of its asset', () => {
    const message = parseTopicMessage(SETTLEMENT_20) as SettlementMessage;
    expect(message.kind).toBe('settlement');
    expect(message.ref).toBe('pol_01M1RG5GHA82D523FDHJPXFXA8');
    expect(auditFacts(message).amount).toEqual({
      amount: '841667',
      asset: '0.0.10366463',
      decimals: 6,
    });
  });
});

describe('the parser when the writer is newer than the reader', () => {
  it('keeps a kind it has never heard of, with its fields', () => {
    const message = readTopicMessage({ v: 1, kind: 'rebate', policy: 'pol_1', amount: '5' });
    expect(message.kind).toBe('unknown');
    expect(message).toMatchObject({ declaredKind: 'rebate' });
    expect(auditFacts(message).policy).toBe('pol_1');
  });

  it('reads a version 2 settlement through its version 1 fields', () => {
    const message = readTopicMessage({
      ...(JSON.parse(SETTLEMENT_20) as Record<string, unknown>),
      v: 2,
      memo: 'something later tickets added',
    });
    expect(message.kind).toBe('settlement');
    expect(auditFacts(message).version).toBe(2);
    expect(auditFacts(message).transactionId).toBe('0.0.7162784@1788602397.120605122');
  });

  it('refuses to guess when a known kind is missing its own fields', () => {
    expect(readTopicMessage({ v: 1, kind: 'payout', policy: 'pol_1' }).kind).toBe('unknown');
    expect(readTopicMessage({ v: 1, kind: 'policy', status: 'sideways' }).kind).toBe('unknown');
  });

  it('carries bytes that are not a JSON object without throwing', () => {
    expect(parseTopicMessage('not json at all').kind).toBe('unknown');
    expect(parseTopicMessage('[1,2,3]').kind).toBe('unknown');
    expect(parseTopicMessage('{"hello":"world"}')).toMatchObject({ declaredKind: null });
  });
});
