import { describe, expect, it } from 'vitest';

import {
  asTimestamp,
  buildCouponsView,
  buildSeriesView,
  consensusToTimestamp,
  entitlementKey,
  wholeUnits,
} from '../src/investor/view.js';
import { CONFIG, ENTITLEMENT, NOTE_STATE, SERIES, VAULT_STATE } from './fixtures.js';

const holders = SERIES.holders.map((config) => ({
  config,
  state: { balance: 50_000_000n, frozen: 0n, subscription: 50_000_000_000n },
}));

function seriesView(overrides: Partial<typeof VAULT_STATE> = {}) {
  return buildSeriesView({
    series: SERIES,
    network: CONFIG.network,
    vault: { ...VAULT_STATE, ...overrides },
    note: NOTE_STATE,
    holders,
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
          state: { balance: 5_000_000n, frozen: 45_000_000n, subscription: 50_000_000_000n },
        },
      ],
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
    const { note: _note, ...withoutNote } = SERIES;
    const view = buildSeriesView({
      series: withoutNote,
      network: CONFIG.network,
      vault: VAULT_STATE,
      note: null,
      holders,
    });
    expect(view.note).toBeNull();
    expect(view.holders[0]?.note_position).toBe('50000000');
  });

  it('counts the coupons and the ones that settled', () => {
    expect(seriesView().coupons).toEqual({ count: 1, settled: 1, latest_coupon_id: '1' });
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
