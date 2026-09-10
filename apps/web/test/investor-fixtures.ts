import type { CouponHolderView, CouponsView, SeriesView } from '../src/lib/investor-api.js';

/**
 * The fixtures are the responses `GET /v1/series/ODI-COMP-2026-01` and its
 * coupons returned from Hedera testnet on 10 September 2026, trimmed to the
 * fields these screens read. Testing against recorded reality rather than
 * invented numbers is what makes the arithmetic assertions below mean
 * anything: 100,000 funded, nothing paid, nothing reserved, and three coupons
 * settled to each of two noteholders, 328.767123 for a thirty day month and
 * 339.726027 for a thirty one day one, with a fourth declared for 5 January
 * 2027 and not yet paid.
 */

export function money(amount: string) {
  return { amount, asset: '0.0.10366463', decimals: 6, display: amount };
}

export const INVESTOR_1 = '0xb6c2ff466e3c73f1a49a3f1b936f8e3837112931';
export const INVESTOR_2 = '0xcaa1184cd59b9296f757efc7303a10ecec6ce51e';

/**
 * One holder's settled coupon, as the endpoint returns it. Six of these across
 * three periods is a lot of literal to repeat, and what differs between them is
 * only the amount and the receipt.
 */
function settledHolder(input: {
  role: string;
  accountId: string;
  address: string;
  amount: string;
  scheduleId: string;
  transactionId: string;
  paidAt: string;
  sequence: string;
}): CouponHolderView {
  return {
    role: input.role,
    account_id: input.accountId,
    address: input.address,
    amount: money(input.amount),
    settlement: {
      schedule_id: input.scheduleId,
      transaction_id: input.transactionId,
      result: 'SUCCESS',
      settled: true,
      paid_at: input.paidAt,
      topic_sequence_number: input.sequence,
      hashscan: {
        schedule: `https://hashscan.io/testnet/schedule/${input.scheduleId}`,
        transaction: `https://hashscan.io/testnet/transaction/${input.transactionId}`,
      },
    },
  };
}

export const SERIES: SeriesView = {
  series_id: 'ODI-COMP-2026-01',
  series_key: '0x4f44492d434f4d502d323032362d303100000000000000000000000000000000',
  group: 'computer_math',
  kind: 'occupation',
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
  coupons: {
    count: 3,
    settled: 3,
    latest_coupon_id: '3',
    rate_percent: '8',
    next: {
      coupon_id: '4',
      rate_percent: '8',
      record_date: '2027-01-04T20:16:23Z',
      execution_date: '2027-01-05T20:16:23Z',
      accrual_start: '2026-12-04T20:16:23Z',
      accrual_end: '2027-01-04T20:16:23Z',
    },
  },
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
        settledHolder({
          role: 'investor-1',
          accountId: '0.0.10366460',
          address: INVESTOR_1,
          amount: '328767123',
          scheduleId: '0.0.10368878',
          transactionId: '0.0.10366450-1788556746-724064738',
          paidAt: '2026-09-04T21:21:11Z',
          sequence: '1',
        }),
        settledHolder({
          role: 'investor-2',
          accountId: '0.0.10366462',
          address: INVESTOR_2,
          amount: '328767123',
          scheduleId: '0.0.10368880',
          transactionId: '0.0.10366450-1788556748-511830975',
          paidAt: '2026-09-04T21:21:11Z',
          sequence: '2',
        }),
      ],
    },
    {
      coupon_id: '2',
      coupon_ref: 'ODI-COMP-2026-01#2',
      rate_percent: '8',
      accrual_start: '2026-10-04T20:16:23Z',
      accrual_end: '2026-11-04T20:16:23Z',
      record_date: '2026-09-10T22:40:27Z',
      execution_date: '2026-09-10T22:45:27Z',
      total: money('679452054'),
      holders: [
        settledHolder({
          role: 'investor-1',
          accountId: '0.0.10366460',
          address: INVESTOR_1,
          amount: '339726027',
          scheduleId: '0.0.10467181',
          transactionId: '0.0.10366450-1789080360-871260609',
          paidAt: '2026-09-10T22:48:08Z',
          sequence: '5750',
        }),
        settledHolder({
          role: 'investor-2',
          accountId: '0.0.10366462',
          address: INVESTOR_2,
          amount: '339726027',
          scheduleId: '0.0.10467183',
          transactionId: '0.0.10366450-1789080365-776042987',
          paidAt: '2026-09-10T22:48:08Z',
          sequence: '5751',
        }),
      ],
    },
    {
      coupon_id: '3',
      coupon_ref: 'ODI-COMP-2026-01#3',
      rate_percent: '8',
      accrual_start: '2026-11-04T20:16:23Z',
      accrual_end: '2026-12-04T20:16:23Z',
      record_date: '2026-09-10T22:40:41Z',
      execution_date: '2026-09-10T22:45:41Z',
      total: money('657534246'),
      holders: [
        settledHolder({
          role: 'investor-1',
          accountId: '0.0.10366460',
          address: INVESTOR_1,
          amount: '328767123',
          scheduleId: '0.0.10467222',
          transactionId: '0.0.10366450-1789080523-877923930',
          paidAt: '2026-09-10T22:50:47Z',
          sequence: '5769',
        }),
        settledHolder({
          role: 'investor-2',
          accountId: '0.0.10366462',
          address: INVESTOR_2,
          amount: '328767123',
          scheduleId: '0.0.10467224',
          transactionId: '0.0.10366450-1789080523-894229047',
          paidAt: '2026-09-10T22:50:47Z',
          sequence: '5770',
        }),
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
