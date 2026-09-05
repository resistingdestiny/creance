import type { CouponsView, SeriesView } from '../src/lib/investor-api.js';

/**
 * The fixtures are the responses `GET /v1/series/ODI-COMP-2026-01` and its
 * coupons returned from Hedera testnet on 5 September 2026, trimmed to the
 * fields these screens read. Testing against recorded reality rather than
 * invented numbers is what makes the arithmetic assertions below mean
 * anything: 100,000 funded, nothing paid, nothing reserved, one coupon settled
 * at 328.767123 to each of two noteholders.
 */

export function money(amount: string) {
  return { amount, asset: '0.0.10366463', decimals: 6, display: amount };
}

export const INVESTOR_1 = '0xb6c2ff466e3c73f1a49a3f1b936f8e3837112931';
export const INVESTOR_2 = '0xcaa1184cd59b9296f757efc7303a10ecec6ce51e';

export const SERIES: SeriesView = {
  series_id: 'ODI-COMP-2026-01',
  series_key: '0x4f44492d434f4d502d323032362d303100000000000000000000000000000000',
  group: 'computer_math',
  network: 'testnet',
  settlement_asset: {
    token_id: '0.0.10366463',
    address: '0x00000000000000000000000000000000009e2dff',
    decimals: 6,
    symbol: 'TUSD',
  },
  vault: {
    address: '0xD0473d355ECB299F2ECc0d92124bc8CF63554e60',
    contract_id: '0.0.10367194',
    matures_at: '2027-09-04T18:22:42Z',
    principal_funded: money('100000000000'),
    principal_paid: money('0'),
    principal_reserved: money('0'),
    principal_redeemed: money('0'),
    principal_remaining: money('100000000000'),
    principal_free: money('100000000000'),
    premium_balance: money('0'),
    hashscan: 'https://hashscan.io/testnet/contract/0.0.10367194',
  },
  note: {
    contract_id: '0.0.10368240',
    address: '0xBB14C072d2861B944C18e5f873C5aEa71c2F1f36',
    name: 'Creance Displacement Bond Note ODI-COMP-2026-01',
    symbol: 'CDBN01',
    decimals: 6,
    total_supply: '100000000',
    units: '100',
    matures_at: '2027-09-04T18:22:42Z',
    paused: false,
    hashscan: 'https://hashscan.io/testnet/contract/0.0.10368240',
  },
  holders: [
    {
      role: 'investor-1',
      account_id: '0.0.10366460',
      address: INVESTOR_1,
      note_balance: '50000000',
      note_frozen: '0',
      note_position: '50000000',
      note_units: '50',
      subscription: money('50000000000'),
      kyc: { status: 1, granted: true },
      hashscan: 'https://hashscan.io/testnet/account/0.0.10366460',
    },
    {
      role: 'investor-2',
      account_id: '0.0.10366462',
      address: INVESTOR_2,
      note_balance: '50000000',
      note_frozen: '0',
      note_position: '50000000',
      note_units: '50',
      subscription: money('50000000000'),
      kyc: { status: 1, granted: true },
      hashscan: 'https://hashscan.io/testnet/account/0.0.10366462',
    },
  ],
  cover_pool: {
    address: '0x6358ddd5AA2e1797ddA949D7d82eA86C9F89ff09',
    contract_id: '0.0.10367199',
    registered: true,
    active_exposure: money('0'),
    exposure_covered: money('0'),
    capacity_used_percent: 0,
    term_seconds: 31_536_000,
    term_months: 12,
    hashscan: 'https://hashscan.io/testnet/contract/0.0.10367199',
  },
  coupons: { count: 1, settled: 1, latest_coupon_id: '1', rate_percent: '8' },
  links: {
    coupons: '/v1/series/ODI-COMP-2026-01/coupons',
    payments_topic: 'https://hashscan.io/testnet/topic/0.0.10366471',
  },
};

export const COUPONS: CouponsView = {
  series_id: 'ODI-COMP-2026-01',
  series_key: SERIES.series_key,
  payments_topic: 'https://hashscan.io/testnet/topic/0.0.10366471',
  coupons: [
    {
      coupon_id: '1',
      coupon_ref: 'ODI-COMP-2026-01#1',
      rate_percent: '8',
      accrual_start: '2026-09-04T20:16:23Z',
      accrual_end: '2026-10-04T20:16:23Z',
      record_date: '2026-09-04T20:21:23Z',
      execution_date: '2026-09-04T20:26:23Z',
      total: money('657534246'),
      holders: [
        {
          role: 'investor-1',
          account_id: '0.0.10366460',
          address: INVESTOR_1,
          amount: money('328767123'),
          settlement: {
            schedule_id: '0.0.10368878',
            transaction_id: '0.0.10366450-1788556746-724064738',
            result: 'SUCCESS',
            settled: true,
            paid_at: '2026-09-04T21:21:11Z',
            topic_sequence_number: '1',
            hashscan: {
              schedule: 'https://hashscan.io/testnet/schedule/0.0.10368878',
              transaction:
                'https://hashscan.io/testnet/transaction/0.0.10366450-1788556746-724064738',
            },
          },
        },
        {
          role: 'investor-2',
          account_id: '0.0.10366462',
          address: INVESTOR_2,
          amount: money('328767123'),
          settlement: {
            schedule_id: '0.0.10368880',
            transaction_id: '0.0.10366450-1788556748-511830975',
            result: 'SUCCESS',
            settled: true,
            paid_at: '2026-09-04T21:21:11Z',
            topic_sequence_number: '2',
            hashscan: {
              schedule: 'https://hashscan.io/testnet/schedule/0.0.10368880',
              transaction:
                'https://hashscan.io/testnet/transaction/0.0.10366450-1788556748-511830975',
            },
          },
        },
      ],
    },
  ],
};

/** The same series part way through a claim window: 15,000 reserved, 5,000 paid. */
export function claimsOpenSeries(): SeriesView {
  return {
    ...SERIES,
    vault: {
      ...SERIES.vault,
      principal_paid: money('5000000000'),
      principal_reserved: money('15000000000'),
      principal_remaining: money('95000000000'),
      principal_free: money('80000000000'),
    },
  };
}

/** The same series with the demo noteholder holding no subscription at all. */
export function unsubscribedSeries(): SeriesView {
  return {
    ...SERIES,
    holders: SERIES.holders.map((holder) => ({
      ...holder,
      note_balance: '0',
      note_position: '0',
      note_units: '0',
      subscription: money('0'),
    })),
  };
}
