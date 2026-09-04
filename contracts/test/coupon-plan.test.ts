import { describe, expect, it } from 'vitest';

import {
  COUPON_MEMO_PREFIX,
  couponMemo,
  couponRef,
  couponSettlementMessage,
  encodeCouponSettlement,
  fromBytes32,
  parseCouponMemo,
  settlementAmount,
  settlementRemainder,
  toBytes32,
} from '../coupons/plan.js';

/// The entitlement the note returned for coupon 1, verbatim from the chain.
const NUMERATOR = 1_036_800_000_000_000_000n;
const DENOMINATOR = 3_153_600_000_000_000n;

describe('settlementAmount', () => {
  it('scales the whole currency unit fraction into six decimal minor units', () => {
    // 50,000 of principal at 8 percent a year over the 30 days from 4 September
    // to 4 October is 328.767123... US dollars, so 328767123 TUSD minor units.
    expect(settlementAmount(NUMERATOR, DENOMINATOR, 6)).toBe(328_767_123n);
  });

  it('truncates rather than rounding, so a holder list never overpays', () => {
    expect(settlementAmount(1n, 3n, 6)).toBe(333_333n);
    expect(settlementRemainder(1n, 3n, 6)).toBe(1n);
  });

  it('leaves no remainder when the fraction divides exactly', () => {
    expect(settlementAmount(1n, 2n, 6)).toBe(500_000n);
    expect(settlementRemainder(1n, 2n, 6)).toBe(0n);
  });

  it('is a factor of a million away from reading the fraction as token units', () => {
    // The trap the harness notes record: the fraction is in whole currency
    // units, so dropping the scale underpays by 10^decimals.
    expect(settlementAmount(NUMERATOR, DENOMINATOR, 0)).toBe(328n);
  });

  it('refuses an entitlement with no denominator', () => {
    expect(() => settlementAmount(1n, 0n, 6)).toThrow(/positive denominator/);
  });

  it('refuses a decimals value the settlement token cannot have', () => {
    expect(() => settlementAmount(1n, 2n, 19)).toThrow(/decimals/);
  });
});

describe('couponRef', () => {
  it('names the series and the ATS coupon id', () => {
    expect(couponRef('ODI-COMP-2026-01', 1n)).toBe('ODI-COMP-2026-01#1');
  });

  it('fits in a bytes32 and reads back', () => {
    const ref = couponRef('ODI-COMP-2026-01', '1');
    expect(fromBytes32(toBytes32(ref))).toBe(ref);
  });

  it('refuses a coupon id that is not an integer', () => {
    expect(() => couponRef('ODI-COMP-2026-01', '1.5')).toThrow(/coupon id/);
  });
});

describe('couponMemo', () => {
  it('carries the series, the coupon and the holder', () => {
    expect(couponMemo('ODI-COMP-2026-01', 1n, 'investor-1')).toBe(
      `${COUPON_MEMO_PREFIX} ODI-COMP-2026-01 1 investor-1`,
    );
  });

  it('round trips through the parser', () => {
    const memo = couponMemo('ODI-COMP-2026-01', 1n, 'investor-2');
    expect(parseCouponMemo(memo)).toEqual({
      seriesLabel: 'ODI-COMP-2026-01',
      couponId: '1',
      holderRole: 'investor-2',
    });
  });

  it('stays under the hundred byte memo cap', () => {
    expect(Buffer.byteLength(couponMemo('ODI-COMP-2026-01', 12n, 'investor-1'))).toBeLessThan(100);
  });

  it('is not a premium memo', () => {
    expect(parseCouponMemo('creance premium POL-1 202610')).toBeNull();
  });

  it('refuses a holder role with a space in it', () => {
    expect(() => couponMemo('ODI-COMP-2026-01', 1n, 'investor 1')).toThrow(/holder role/);
  });
});

describe('couponSettlementMessage', () => {
  const message = couponSettlementMessage({
    seriesLabel: 'ODI-COMP-2026-01',
    seriesId: toBytes32('ODI-COMP-2026-01'),
    couponId: 1n,
    holderAccountId: '0.0.10366460',
    holderAddress: '0xb6c2ff466e3c73f1a49a3f1b936f8e3837112931',
    numerator: NUMERATOR,
    denominator: DENOMINATOR,
    amount: 328_767_123n,
    tokenId: '0.0.10366463',
    scheduleId: '0.0.10400000',
    transactionId: '0.0.10366450-1788553600-123456789',
    result: 'SUCCESS',
    paidAt: '1788553601.000000000',
  });

  it('carries every amount as an integer string', () => {
    expect(message.amount).toBe('328767123');
    expect(message.numerator).toBe('1036800000000000000');
    expect(message.denominator).toBe('3153600000000000');
  });

  it('carries the fraction the amount came from, so a reader can redo it', () => {
    expect(settlementAmount(BigInt(message.numerator), BigInt(message.denominator), 6)).toBe(
      BigInt(message.amount),
    );
  });

  it('fits well inside the topic message cap', () => {
    expect(Buffer.byteLength(encodeCouponSettlement(message))).toBeLessThan(1024);
  });
});
