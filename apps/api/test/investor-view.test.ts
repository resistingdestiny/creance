import { describe, expect, it } from 'vitest';

import {
  asTimestamp,
  buildCouponsView,
  buildSeriesView,
  capacityUsedPercent,
  consensusToTimestamp,
  termMonths,
  entitlementKey,
  wholeUnits,
} from '../src/investor/view.js';
import {
  CONFIG,
  COVER_POOL_STATE,
  ENTITLEMENT,
  NOTE_STATE,
  SERIES,
  VAULT_STATE,
  seriesWithoutNote,
} from './fixtures.js';

const holders = SERIES.holders.map((config) => ({
  config,
  state: { balance: 50_000_000n, frozen: 0n, subscription: 50_000_000_000n, kycStatus: 1 },
}));

function seriesView(overrides: Partial<typeof VAULT_STATE> = {}) {
  return buildSeriesView({
    series: SERIES,
    network: CONFIG.network,
    vault: { ...VAULT_STATE, ...overrides },
    note: NOTE_STATE,
    holders,
    coverPool: COVER_POOL_STATE,
  });
}

describe('the series view', () => {
  it('carries every amount as an integer string with its asset and scale', () => {
    const view = seriesView();
    expect(view.vault.principal_funded).toEqual({
      amount: '100000000000',
      asset: '0.0.10366463',
      decimals: 6,
      display: '100000.00',
    });
  });

  it('reports principal remaining as funded less paid', () => {
    const view = seriesView({ principalPaid: 5_000_000_000n });
    expect(view.vault.principal_remaining.amount).toBe('95000000000');
  });

  it('takes the reserve and the redemptions out of free principal but not out of remaining', () => {
    const view = seriesView({
      principalPaid: 5_000_000_000n,
      principalRedeemed: 10_000_000_000n,
      reserved: 15_000_000_000n,
    });
    expect(view.vault.principal_remaining.amount).toBe('95000000000');
    expect(view.vault.principal_free.amount).toBe('70000000000');
    expect(view.vault.principal_reserved.amount).toBe('15000000000');
  });

  it('adds the frozen units back into a holder position', () => {
    const view = buildSeriesView({
      series: SERIES,
      network: CONFIG.network,
      vault: VAULT_STATE,
      note: NOTE_STATE,
      holders: [
        {
          config: SERIES.holders[0]!,
          state: {
            balance: 5_000_000n,
            frozen: 45_000_000n,
            subscription: 50_000_000_000n,
            kycStatus: 1,
          },
        },
      ],
      coverPool: COVER_POOL_STATE,
    });
    const holder = view.holders[0]!;
    expect(holder.note_balance).toBe('5000000');
    expect(holder.note_frozen).toBe('45000000');
    expect(holder.note_position).toBe('50000000');
    expect(holder.note_units).toBe('50');
  });

  it('links the note as a contract, because the note is not a token', () => {
    expect(seriesView().note?.hashscan).toBe('https://hashscan.io/testnet/contract/0.0.10368240');
  });

  it('serves a series with no note at all', () => {
    const withoutNote = seriesWithoutNote();
    const view = buildSeriesView({
      series: withoutNote,
      network: CONFIG.network,
      vault: VAULT_STATE,
      note: null,
      holders,
      coverPool: COVER_POOL_STATE,
    });
    expect(view.note).toBeNull();
    expect(view.holders[0]?.note_position).toBe('50000000');
  });

  it('counts the coupons and the ones that settled, and names the latest rate', () => {
    expect(seriesView().coupons).toEqual({
      count: 1,
      settled: 1,
      latest_coupon_id: '1',
      rate_percent: '8',
    });
  });
});

describe('the KYC status a holder is shown by', () => {
  it('reports a granted holder as granted, from the note register', () => {
    const holder = seriesView().holders[0]!;
    expect(holder.kyc).toEqual({ status: 1, granted: true });
  });

  it('does not treat NOT_GRANTED as granted', () => {
    const view = buildSeriesView({
      series: SERIES,
      network: CONFIG.network,
      vault: VAULT_STATE,
      note: NOTE_STATE,
      holders: [
        {
          config: SERIES.holders[0]!,
          state: { balance: 0n, frozen: 0n, subscription: 0n, kycStatus: 0 },
        },
      ],
      coverPool: COVER_POOL_STATE,
    });
    expect(view.holders[0]!.kyc).toEqual({ status: 0, granted: false });
  });

  it('does not claim a holder is approved when there is no note to ask', () => {
    const view = buildSeriesView({
      series: seriesWithoutNote(),
      network: CONFIG.network,
      vault: VAULT_STATE,
      note: null,
      holders: [
        {
          config: SERIES.holders[0]!,
          state: { balance: 0n, frozen: 0n, subscription: 0n, kycStatus: null },
        },
      ],
      coverPool: COVER_POOL_STATE,
    });
    expect(view.holders[0]!.kyc).toEqual({ status: null, granted: false });
  });
});

describe('the CoverPool block, which carries capacity and the term', () => {
  it('says the term in months and links the pool as a contract', () => {
    const pool = seriesView().cover_pool!;
    expect(pool.term_seconds).toBe(31_536_000);
    expect(pool.term_months).toBe(12);
    expect(pool.hashscan).toBe('https://hashscan.io/testnet/contract/0.0.10367199');
  });

  it('reads no capacity used while no policy is bound', () => {
    const pool = seriesView().cover_pool!;
    expect(pool.active_exposure.amount).toBe('0');
    expect(pool.capacity_used_percent).toBe(0);
  });

  it('measures capacity as active cover limits over principal', () => {
    const view = buildSeriesView({
      series: SERIES,
      network: CONFIG.network,
      vault: VAULT_STATE,
      note: NOTE_STATE,
      holders,
      coverPool: { ...COVER_POOL_STATE, activeExposure: 45_000_000_000n },
    });
    expect(view.cover_pool!.capacity_used_percent).toBe(45);
  });

  it('reports an unregistered series as unregistered rather than as empty terms', () => {
    const view = buildSeriesView({
      series: SERIES,
      network: CONFIG.network,
      vault: VAULT_STATE,
      note: NOTE_STATE,
      holders,
      coverPool: { registered: false, activeExposure: 0n, exposureCovered: 0n, term: 0, status: 0 },
    });
    expect(view.cover_pool!.registered).toBe(false);
    expect(view.cover_pool!.term_months).toBeNull();
  });

  it('is null when the API has no pool to read', () => {
    const view = buildSeriesView({
      series: SERIES,
      network: CONFIG.network,
      vault: VAULT_STATE,
      note: NOTE_STATE,
      holders,
      coverPool: null,
    });
    expect(view.cover_pool).toBeNull();
  });
});

describe('capacity arithmetic', () => {
  it('rounds to whole percent rather than truncating', () => {
    expect(capacityUsedPercent(455n, 1000n)).toBe(46);
    expect(capacityUsedPercent(454n, 1000n)).toBe(45);
  });

  it('reads zero for a series with no principal funded', () => {
    expect(capacityUsedPercent(0n, 0n)).toBe(0);
  });
});

describe('the term, said in months', () => {
  it('reads 365 days as 12 months', () => {
    expect(termMonths(31_536_000)).toBe(12);
  });
});

describe('the coupons view', () => {
  const entitlements = new Map(
    SERIES.coupons[0]!.holders.map((holder) => [
      entitlementKey('1', holder.address),
      ENTITLEMENT,
    ]),
  );
  const view = buildCouponsView({ series: SERIES, network: CONFIG.network, entitlements });
  const coupon = view.coupons[0]!;

  it('names which half declared the coupon and which half paid it', () => {
    expect(coupon.declared_by).toBe('ats_corporate_action');
    expect(coupon.paid_by).toBe('hedera_scheduled_transaction');
  });

  it('reports the rate both ways and the real accrual window', () => {
    expect(coupon.rate_percent).toBe('8');
    expect(coupon.rate_bps).toBe(800);
    expect(coupon.accrual_start).toBe('2026-09-04T20:16:23Z');
    expect(coupon.accrual_end).toBe('2026-10-04T20:16:23Z');
  });

  it('carries the fraction the amount came from as well as the amount', () => {
    const holder = coupon.holders[0]!;
    expect(holder.entitlement.numerator).toBe('1036800000000000000');
    expect(holder.entitlement.denominator).toBe('3153600000000000');
    expect(holder.amount.amount).toBe('328767123');
    expect(holder.amount.display).toBe('328.767123');
  });

  it('totals what the coupon cost the premium account', () => {
    expect(coupon.total.amount).toBe('657534246');
  });

  it('links the schedule and the executed transaction', () => {
    const holder = coupon.holders[0]!;
    expect(holder.settlement.settled).toBe(true);
    expect(holder.settlement.hashscan.schedule).toBe(
      'https://hashscan.io/testnet/schedule/0.0.10368878',
    );
    expect(holder.settlement.hashscan.transaction).toBe(
      'https://hashscan.io/testnet/transaction/0.0.10366450-1788556746-724064738',
    );
  });

  it('does not call an execution a payment unless the transfer succeeded', () => {
    const failed = structuredClone(SERIES);
    failed.coupons[0]!.holders[0]!.result = 'INSUFFICIENT_TOKEN_BALANCE';
    failed.coupons[0]!.holders[0]!.settled = false;
    const view = buildCouponsView({
      series: failed,
      network: CONFIG.network,
      entitlements: new Map(),
    });
    expect(view.coupons[0]?.holders[0]?.settlement.settled).toBe(false);
    expect(view.coupons[0]?.holders[0]?.settlement.result).toBe('INSUFFICIENT_TOKEN_BALANCE');
  });

  it('falls back to the recorded entitlement when the note cannot be reached', () => {
    const view = buildCouponsView({
      series: SERIES,
      network: CONFIG.network,
      entitlements: new Map(),
    });
    expect(view.coupons[0]?.holders[0]?.entitlement.numerator).toBe('1036800000000000000');
  });
});

describe('formatting', () => {
  it('writes timestamps as RFC 3339 in UTC at second precision', () => {
    expect(asTimestamp(1820082162)).toBe('2027-09-04T18:22:42Z');
  });

  it('turns a consensus timestamp into the same form', () => {
    expect(consensusToTimestamp('1788556871.150984988')).toBe('2026-09-04T21:21:11Z');
  });

  it('counts whole units without a float', () => {
    expect(wholeUnits(100_000_000n, 6)).toBe('100');
  });
});
