import { describe, expect, it } from 'vitest';

import { fromBytes32, hasPrefix, newId, nullifierToBytes32, toBytes32 } from '../src/ids.js';
import { limitIsOffered, monthlyPremiumMinor, priceCover, utilisationOf } from '../src/pricing.js';
import {
  encodeTopicMessage,
  policyBindingMessage,
  policyBoundMessage,
  MAX_TOPIC_MESSAGE_BYTES,
} from '../src/receipts.js';
import { nftMetadata, addOneMonth, periodOf } from '../src/routes/bind.js';
import { MAX_NFT_METADATA_BYTES } from '../src/chain/hedera.js';
import { periodFromInteger, periodToInteger, sourcePeriods } from '../src/index-data.js';

/// The rules that are cheap to get wrong and expensive to find later: the ids
/// that have to round trip through bytes32, the money that must never touch a
/// float, and the two messages that have to fit inside an HCS message.

describe('identifiers', () => {
  it('round trips a policy id through bytes32', () => {
    const id = newId('policy');
    expect(id).toMatch(/^pol_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(Buffer.byteLength(id, 'utf8')).toBe(30);
    expect(fromBytes32(toBytes32(id))).toBe(id);
  });

  it('round trips the series label the contracts were registered with', () => {
    expect(toBytes32('ODI-COMP-2026-01')).toBe(
      '0x4f44492d434f4d502d323032362d303100000000000000000000000000000000',
    );
  });

  it('refuses to truncate an id that will not fit', () => {
    expect(() => toBytes32('x'.repeat(32))).toThrow(/longer than 31 bytes/);
  });

  it('reads a prefix rather than guessing at a shape', () => {
    expect(hasPrefix('pol_01K4YB', 'policy')).toBe(true);
    expect(hasPrefix('clm_01K4YB', 'policy')).toBe(false);
  });

  it('takes the nullifier as a decimal integer and pads it to 32 bytes', () => {
    expect(nullifierToBytes32('1')).toBe(`0x${'0'.repeat(63)}1`);
    expect(nullifierToBytes32('255')).toBe(`0x${'0'.repeat(62)}ff`);
    expect(() => nullifierToBytes32('-1')).toThrow();
  });
});

describe('the premium', () => {
  it('is the rate times the limit over twelve, in minor units', () => {
    // 6.72 percent on a 5,000 limit at six decimals is 28.00 a month.
    expect(monthlyPremiumMinor(672, 5_000_000_000n)).toBe(28_000_000n);
  });

  it('rounds half up rather than towards zero', () => {
    // 1 basis point on 1 minor unit is a half, which rounds up to 1.
    expect(monthlyPremiumMinor(60_000, 1n)).toBe(1n);
  });

  it('never produces a float on the path from the limit to the amount', () => {
    const price = priceCover({
      ebar: -0.6,
      levelLine: -0.68,
      limit: 5_000_000_000n,
      exposure: 0n,
      capital: 100_000_000_000n,
    });
    expect(price).not.toBeNull();
    expect(typeof price?.premium).toBe('bigint');
    expect(price?.premium).toBe(monthlyPremiumMinor(price?.annualRateBps ?? 0, 5_000_000_000n));
  });

  it('charges more as the band fills, which is the capacity term', () => {
    const empty = priceCover({
      ebar: -0.6,
      levelLine: -0.68,
      limit: 5_000_000_000n,
      exposure: 0n,
      capital: 100_000_000_000n,
    });
    const half = priceCover({
      ebar: -0.6,
      levelLine: -0.68,
      limit: 5_000_000_000n,
      exposure: 50_000_000_000n,
      capital: 100_000_000_000n,
    });
    expect(half?.annualRateBps ?? 0).toBeGreaterThan(empty?.annualRateBps ?? 0);
    expect(half?.utilisation).toBeCloseTo(0.5);
  });

  it('has no price at all for a band nothing has funded', () => {
    // Not a floor price and not a zero. A band no capital has chosen is not
    // for sale, and both of those would be a price on capacity that is absent.
    expect(utilisationOf(0n, 0n)).toBeNull();
    expect(
      priceCover({
        ebar: -0.6,
        levelLine: -0.68,
        limit: 5_000_000_000n,
        exposure: 0n,
        capital: 0n,
      }),
    ).toBeNull();
  });

  it('offers only the slider the Amount screen shows', () => {
    expect(limitIsOffered(5_000_000_000n, 6)).toBe(true);
    expect(limitIsOffered(1_000_000_000n, 6)).toBe(true);
    expect(limitIsOffered(10_000_000_000n, 6)).toBe(true);
    expect(limitIsOffered(5_300_000_000n, 6)).toBe(false);
    expect(limitIsOffered(500_000_000n, 6)).toBe(false);
    expect(limitIsOffered(11_000_000_000n, 6)).toBe(false);
  });
});

describe('the policy receipt', () => {
  const binding = policyBindingMessage({
    seriesLabel: 'ODI-COMP-2026-01',
    seriesKey: '0x4f44492d434f4d502d323032362d303100000000000000000000000000000000',
    policyId: 'pol_01K4YB9X3M8Q0RZ7T2VD6C5H9E',
    groupKey: 'computer_math',
    holderAccountId: '0.0.10366453',
    holderAddress: '0xcad39730d48683b13e6077a70c6972add449b6f5',
    limit: 5_000_000_000n,
    premium: 28_000_000n,
    tokenId: '0.0.10366463',
    startAt: new Date('2026-09-05T09:00:00Z'),
    quotedAt: new Date('2026-09-05T09:15:00Z'),
  });

  it('fits inside an HCS message', () => {
    expect(Buffer.byteLength(encodeTopicMessage(binding), 'utf8')).toBeLessThan(
      MAX_TOPIC_MESSAGE_BYTES,
    );
  });

  it('carries every amount as an integer string in minor units', () => {
    expect(binding.limit).toBe('5000000000');
    expect(binding.premium).toBe('28000000');
  });

  it('is versioned and labelled so it sits beside the coupon messages', () => {
    expect(binding.v).toBe(1);
    expect(binding.kind).toBe('policy');
  });

  it('resolves the binding message rather than leaving it orphaned', () => {
    const bound = policyBoundMessage({
      seriesLabel: 'ODI-COMP-2026-01',
      policyId: binding.policy,
      receiptSeq: 41,
      status: 'bound',
      bindTx: `0x${'ab'.repeat(32)}`,
      nftTokenId: '0.0.10366468',
      serial: 3,
    });
    expect(bound.status).toBe('bound');
    expect(bound.receiptSeq).toBe(41);
    const failed = policyBoundMessage({
      seriesLabel: 'ODI-COMP-2026-01',
      policyId: binding.policy,
      receiptSeq: 41,
      status: 'failed',
      reason: 'insufficient_capacity',
    });
    expect(failed.status).toBe('failed');
    expect(failed.reason).toBe('insufficient_capacity');
  });

  it('says bound with a reason when the cover is real and only the receipt failed', () => {
    // The status is stated rather than read off the presence of a reason: a
    // policy CoverPool accepted is bound even when its NFT did not mint, and
    // publishing it as failed would say the cover does not exist.
    const message = policyBoundMessage({
      seriesLabel: 'ODI-COMP-2026-01',
      policyId: binding.policy,
      receiptSeq: 41,
      status: 'bound',
      bindTx: `0x${'ab'.repeat(32)}`,
      reason: 'nft_mint_failed',
    });
    expect(message.status).toBe('bound');
    expect(message.reason).toBe('nft_mint_failed');
    expect(message.serial).toBeUndefined();
  });

  it('refuses a message that would have to be chunked', () => {
    expect(() => encodeTopicMessage({ note: 'x'.repeat(1100) })).toThrow(/over the 1024/);
  });
});

describe('the policy NFT metadata', () => {
  it('fits the cap, which is measured in bytes and not characters', () => {
    const metadata = nftMetadata('pol_01K4YB9X3M8Q0RZ7T2VD6C5H9E', 'ODI-COMP-2026-01');
    expect(Buffer.byteLength(metadata, 'utf8')).toBeLessThanOrEqual(MAX_NFT_METADATA_BYTES);
    expect(JSON.parse(metadata)).toEqual({
      p: 'pol_01K4YB9X3M8Q0RZ7T2VD6C5H9E',
      s: 'ODI-COMP-2026-01',
    });
  });
});

describe('periods and due dates', () => {
  it('crosses the schema and the chain as YYYYMM', () => {
    expect(periodToInteger('2026-04')).toBe(202604);
    expect(periodFromInteger(202604)).toBe('2026-04');
    expect(periodOf(new Date('2026-04-17T00:00:00Z'))).toBe(202604);
  });

  it('cites the six source months an observation is computed from', () => {
    expect(sourcePeriods('2026-04')).toEqual([
      '2026-04',
      '2026-03',
      '2026-02',
      '2025-04',
      '2025-03',
      '2025-02',
    ]);
  });

  it('clamps the next premium to the length of a shorter month', () => {
    expect(addOneMonth(new Date('2026-01-31T00:00:00Z')).toISOString().slice(0, 10)).toBe(
      '2026-02-28',
    );
    expect(addOneMonth(new Date('2026-09-05T00:00:00Z')).toISOString().slice(0, 10)).toBe(
      '2026-10-05',
    );
  });
});
