import { describe, expect, it } from 'vitest';

import {
  COUPON_MEMO_PREFIX,
  EXECUTION_AFTER_RECORD_SECONDS,
  EXECUTION_LEAD_SECONDS,
  RECORD_LEAD_SECONDS,
  couponMemo,
  couponRef,
  couponSettlementMessage,
  encodeCouponSettlement,
  fromBytes32,
  monthAfter,
  nextCouponPeriod,
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

/// The first coupon's own window, verbatim from the deployment record: 4
/// September to 4 October 2026, thirty days.
const FIRST_START = 1_788_552_983;
const FIRST_END = 1_791_144_983;
/// The note's own maturity, 4 September 2027, verbatim from the record.
const MATURITY = 1_820_089_362;

describe('monthAfter', () => {
  it('is a calendar month and not thirty days', () => {
    // 4 September to 4 October is 30 days; 4 October to 4 November is 31.
    expect(monthAfter(FIRST_START)).toBe(FIRST_END);
    expect(monthAfter(FIRST_END) - FIRST_END).toBe(31 * 24 * 60 * 60);
  });
});

describe('nextCouponPeriod', () => {
  const now = 1_789_078_956;

  it('starts where the last period ended, so the series accrues with no gap', () => {
    const plan = nextCouponPeriod({
      previousEnd: FIRST_END,
      now,
      maturityDate: MATURITY,
      recordDate: 'brought forward',
    });
    expect(plan.startDate).toBe(FIRST_END);
    expect(plan.endDate).toBe(monthAfter(FIRST_END));
  });

  it('brings the record date forward by the leads the first coupon settled on', () => {
    const plan = nextCouponPeriod({
      previousEnd: FIRST_END,
      now,
      maturityDate: MATURITY,
      recordDate: 'brought forward',
    });
    expect(plan.recordDate).toBe(now + RECORD_LEAD_SECONDS);
    expect(plan.executionDate).toBe(now + EXECUTION_LEAD_SECONDS);
    expect(plan.fixingDate).toBe(plan.recordDate);
    expect(plan.broughtForward).toBe(true);
  });

  it('puts the record date at the end of the window when the period is not being rushed', () => {
    const plan = nextCouponPeriod({
      previousEnd: FIRST_END,
      now,
      maturityDate: MATURITY,
      recordDate: 'at the window end',
    });
    expect(plan.recordDate).toBe(plan.endDate);
    expect(plan.executionDate).toBe(plan.endDate + EXECUTION_AFTER_RECORD_SECONDS);
    expect(plan.broughtForward).toBe(false);
  });

  it('keeps the three date pairs ATS validates in order', () => {
    for (const recordDate of ['brought forward', 'at the window end'] as const) {
      const plan = nextCouponPeriod({
        previousEnd: FIRST_END,
        now,
        maturityDate: MATURITY,
        recordDate,
      });
      expect(plan.endDate).toBeGreaterThanOrEqual(plan.startDate);
      expect(plan.executionDate).toBeGreaterThanOrEqual(plan.recordDate);
      expect(plan.executionDate).toBeGreaterThanOrEqual(plan.fixingDate);
    }
  });

  it('refuses a window that ends after the note has matured', () => {
    // Twelve monthly periods run from 4 September 2026 to the maturity date
    // itself. The twelfth is allowed; a thirteenth is what ATS refuses with
    // onlyValidCouponEndDate, and this says so before a transaction is sent.
    let end = FIRST_START;
    for (let period = 0; period < 12; period += 1) end = monthAfter(end);
    expect(end).toBeLessThanOrEqual(MATURITY);
    expect(monthAfter(end)).toBeGreaterThan(MATURITY);
    expect(() =>
      nextCouponPeriod({ previousEnd: end, now, maturityDate: MATURITY, recordDate: 'brought forward' }),
    ).toThrow(/past the note's maturity/);
  });

  it('refuses a previous end or a now that is not a timestamp', () => {
    expect(() =>
      nextCouponPeriod({ previousEnd: 0, now, maturityDate: MATURITY, recordDate: 'brought forward' }),
    ).toThrow(/unix timestamp/);
    expect(() =>
      nextCouponPeriod({
        previousEnd: FIRST_END,
        now: -1,
        maturityDate: MATURITY,
        recordDate: 'brought forward',
      }),
    ).toThrow(/unix timestamp/);
  });
});
