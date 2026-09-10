import { money, type Money } from '@creance/client';

import type { CouponSettlementConfig, HolderConfig, SeriesConfig } from './config.js';
import type {
  CouponEntitlement,
  CoverPoolSeriesState,
  HolderState,
  NoteState,
  VaultSeriesState,
} from './chain.js';

/// The JSON the investor endpoints return, built from chain reads and the
/// deployment record.
///
/// Field names are snake_case and every amount is the money envelope: an
/// integer string in the settlement asset's minor units, with the asset and its
/// decimals beside it. `display` is for a human reading the response and is
/// never parsed.
///
/// The builders are pure. Everything that touches the network happens in the
/// route, so the shapes are covered by unit tests with no chain.

export interface HolderView {
  role: string;
  account_id: string;
  address: string;
  /// What the note reports as spendable.
  note_balance: string;
  /// Frozen units, which the note subtracts from the balance.
  note_frozen: string;
  /// balance plus frozen, which is the holding. Any screen that shows one
  /// without the other understates a frozen holder.
  note_position: string;
  note_units: string;
  subscription: Money;
  /// The note's own internal KYC register, which is what refuses a transfer.
  /// `status` is null where there is no note to ask; `granted` is false then,
  /// because a holder nothing has approved is not an approved holder.
  kyc: { status: number | null; granted: boolean };
  hashscan: string;
}

/// What the CoverPool adds to the series view. Null when the API has no pool
/// address; `registered` false when the pool has never heard of this series,
/// which is the maturity demonstration's case.
export interface CoverPoolView {
  address: string;
  contract_id: string | null;
  registered: boolean;
  active_exposure: Money;
  exposure_covered: Money;
  /// The capacity rule of DESIGN.md 3.2: active cover limits over principal,
  /// as a whole number of percent, which is how the investor screen says it.
  capacity_used_percent: number;
  term_seconds: number | null;
  term_months: number | null;
  hashscan: string;
}

export interface SeriesView {
  series_id: string;
  series_key: string;
  group: string;
  network: string;
  settlement_asset: { token_id: string; address: string; decimals: number; symbol: string };
  vault: {
    address: string;
    contract_id: string | null;
    matures_at: string;
    principal_funded: Money;
    principal_paid: Money;
    principal_reserved: Money;
    principal_redeemed: Money;
    principal_remaining: Money;
    principal_free: Money;
    premium_balance: Money;
    hashscan: string;
  };
  note: {
    contract_id: string | null;
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    total_supply: string;
    units: string;
    matures_at: string;
    paused: boolean;
    hashscan: string;
  } | null;
  holders: HolderView[];
  cover_pool: CoverPoolView | null;
  coupons: {
    count: number;
    settled: number;
    latest_coupon_id: string | null;
    /// The rate the most recent coupon was declared at, so a screen can say
    /// "8 percent a year" without reading the coupons endpoint as well.
    rate_percent: string | null;
  };
  links: { coupons: string; payments_topic: string | null };
}

const SECONDS = 1000;

/// The note's internal KYC register. docs/ATS.md sections 5 and 8: 1 is
/// GRANTED, 0 is NOT_GRANTED, and it is the value that decides whether a
/// transfer settles.
export const KYC_GRANTED = 1;

/** RFC 3339 in UTC, second precision, which is what every timestamp here is. */
export function asTimestamp(seconds: number): string {
  return new Date(seconds * SECONDS).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function hashscanUrl(kind: string, id: string, network = 'testnet'): string {
  return `https://hashscan.io/${network}/${kind}/${id}`;
}

/// The average Gregorian month in seconds. The term is stored in seconds and
/// said in months, and 365 days is not a whole number of any month, so the
/// conversion rounds. 31,536,000 seconds reads as 12 months.
const AVERAGE_MONTH_SECONDS = 2_629_746;

export function termMonths(seconds: number): number {
  return Math.round(seconds / AVERAGE_MONTH_SECONDS);
}

/// Active cover limits over principal, rounded to whole percent. A series with
/// no principal funded has no capacity to use, so it reads zero rather than
/// dividing by zero.
export function capacityUsedPercent(activeExposure: bigint, principalFunded: bigint): number {
  if (principalFunded <= 0n) return 0;
  return Number((activeExposure * 100n + principalFunded / 2n) / principalFunded);
}

/** Whole units of a note or a token, as a string. Never a float. */
export function wholeUnits(amount: bigint, decimals: number): string {
  return (amount / 10n ** BigInt(decimals)).toString();
}

export interface SeriesViewInput {
  series: SeriesConfig;
  network: string;
  vault: VaultSeriesState;
  note: NoteState | null;
  holders: { config: HolderConfig; state: HolderState }[];
  coverPool: CoverPoolSeriesState | null;
}

export function buildSeriesView(input: SeriesViewInput): SeriesView {
  const { series, vault, note, holders, network, coverPool } = input;
  const asset = series.settlementToken.tokenId;
  const decimals = series.settlementToken.decimals;
  const amount = (value: bigint): Money => money(value, asset, decimals);

  // Derived rather than read: the vault exposes principalRemaining and
  // principalFree as views, and computing them from the one struct read keeps
  // the endpoint to a single round trip and cannot disagree with it.
  const remaining = vault.principalFunded - vault.principalPaid;
  const free = remaining - vault.principalRedeemed - vault.reserved;
  const settled = series.coupons.filter((coupon) =>
    coupon.holders.some((holder) => holder.settled === true),
  ).length;

  return {
    series_id: series.label,
    series_key: series.seriesId,
    group: series.group,
    network,
    settlement_asset: {
      token_id: series.settlementToken.tokenId,
      address: series.settlementToken.address,
      decimals,
      symbol: series.settlementToken.symbol,
    },
    vault: {
      address: series.vault.address,
      contract_id: series.vault.contractId ?? null,
      matures_at: asTimestamp(vault.maturityAt),
      principal_funded: amount(vault.principalFunded),
      principal_paid: amount(vault.principalPaid),
      principal_reserved: amount(vault.reserved),
      principal_redeemed: amount(vault.principalRedeemed),
      principal_remaining: amount(remaining),
      principal_free: amount(free),
      premium_balance: amount(vault.premiumBalance),
      hashscan: hashscanUrl('contract', series.vault.contractId ?? series.vault.address, network),
    },
    note:
      note === null || series.note === undefined
        ? null
        : {
            contract_id: series.note.contractId ?? null,
            address: series.note.address,
            name: note.name,
            symbol: note.symbol,
            decimals: note.decimals,
            total_supply: note.totalSupply.toString(),
            units: wholeUnits(note.totalSupply, note.decimals),
            matures_at: asTimestamp(note.maturityDate),
            paused: note.paused,
            hashscan: hashscanUrl(
              'contract',
              series.note.contractId ?? series.note.address,
              network,
            ),
          },
    holders: holders.map(({ config, state }) => ({
      role: config.role,
      account_id: config.accountId,
      address: config.address,
      note_balance: state.balance.toString(),
      note_frozen: state.frozen.toString(),
      note_position: (state.balance + state.frozen).toString(),
      note_units: wholeUnits(state.balance + state.frozen, note?.decimals ?? decimals),
      subscription: amount(state.subscription),
      kyc: { status: state.kycStatus, granted: state.kycStatus === KYC_GRANTED },
      hashscan: hashscanUrl('account', config.accountId, network),
    })),
    cover_pool:
      coverPool === null || series.coverPool === undefined
        ? null
        : {
            address: series.coverPool.address,
            contract_id: series.coverPool.contractId ?? null,
            registered: coverPool.registered,
            active_exposure: amount(coverPool.activeExposure),
            exposure_covered: amount(coverPool.exposureCovered),
            capacity_used_percent: capacityUsedPercent(
              coverPool.activeExposure,
              vault.principalFunded,
            ),
            term_seconds: coverPool.registered ? coverPool.term : null,
            term_months: coverPool.registered ? termMonths(coverPool.term) : null,
            hashscan: hashscanUrl(
              'contract',
              series.coverPool.contractId ?? series.coverPool.address,
              network,
            ),
          },
    coupons: {
      count: series.coupons.length,
      settled,
      latest_coupon_id: series.coupons.at(-1)?.couponId ?? null,
      rate_percent: series.coupons.at(-1)?.ratePercent.toString() ?? null,
    },
    links: {
      coupons: `/v1/series/${series.label}/coupons`,
      payments_topic:
        series.paymentsTopicId === undefined
          ? null
          : hashscanUrl('topic', series.paymentsTopicId, network),
    },
  };
}

/** One row in the series list: what a screen needs to offer a choice. */
export interface SeriesListEntry {
  series_id: string;
  series_key: string;
  group: string;
  matures_at: string;
  /// Whether a Displacement Bond Note has been issued for the series. Cover is
  /// buyable without one: the note is the investor facing instrument and the
  /// collateral is in the vault either way.
  has_note: boolean;
  links: { self: string; coupons: string };
}

export interface SeriesListView {
  network: string;
  count: number;
  series: SeriesListEntry[];
}

/**
 * Every series this deployment serves, in the order they were issued.
 *
 * Nothing here reads the chain. The list is what the deployment record says
 * exists, so a screen can offer a choice in one cheap call and then ask for
 * the one series it is going to show.
 */
export function buildSeriesListView(
  network: string,
  series: readonly SeriesConfig[],
): SeriesListView {
  return {
    network,
    count: series.length,
    series: series.map((entry) => ({
      series_id: entry.label,
      series_key: entry.seriesId,
      group: entry.group,
      matures_at: new Date(entry.maturityAt * SECONDS).toISOString(),
      has_note: entry.note !== undefined,
      links: {
        self: `/v1/series/${entry.label}`,
        coupons: `/v1/series/${entry.label}/coupons`,
      },
    })),
  };
}

export interface CouponHolderView {
  role: string;
  account_id: string;
  address: string;
  /// The ATS entitlement, verbatim, as an exact fraction in whole currency
  /// units. The settlement amount is floor(numerator * 10^decimals /
  /// denominator); the fraction travels with it so a reader can redo it.
  entitlement: { numerator: string; denominator: string; record_date_reached: boolean };
  amount: Money;
  /// What the truncation left in the premium account, as a fraction of a minor
  /// unit of the denominator above.
  remainder: string;
  settlement: {
    schedule_id: string | null;
    schedule_memo: string | null;
    transaction_id: string | null;
    result: string | null;
    settled: boolean;
    paid_at: string | null;
    topic_sequence_number: string | null;
    hashscan: { schedule: string | null; transaction: string | null };
  };
}

export interface CouponView {
  coupon_id: string;
  coupon_ref: string;
  rate_percent: string;
  rate_bps: number;
  accrual_start: string;
  accrual_end: string;
  record_date: string;
  execution_date: string;
  declared_by: 'ats_corporate_action';
  paid_by: 'hedera_scheduled_transaction';
  total: Money;
  holders: CouponHolderView[];
}

export interface CouponsView {
  series_id: string;
  series_key: string;
  settlement_asset: { token_id: string; address: string; decimals: number; symbol: string };
  payments_topic: string | null;
  coupons: CouponView[];
}

export interface CouponsViewInput {
  series: SeriesConfig;
  network: string;
  /// One entitlement per coupon and holder, read live from the note, or null
  /// where the note is not reachable.
  entitlements: Map<string, CouponEntitlement | null>;
}

/** The key an entitlement is looked up by, so the route and the view agree. */
export function entitlementKey(couponId: string, address: string): string {
  return `${couponId}:${address.toLowerCase()}`;
}

export function buildCouponsView(input: CouponsViewInput): CouponsView {
  const { series, network, entitlements } = input;
  const decimals = series.settlementToken.decimals;

  return {
    series_id: series.label,
    series_key: series.seriesId,
    settlement_asset: {
      token_id: series.settlementToken.tokenId,
      address: series.settlementToken.address,
      decimals,
      symbol: series.settlementToken.symbol,
    },
    payments_topic:
      series.paymentsTopicId === undefined
        ? null
        : hashscanUrl('topic', series.paymentsTopicId, network),
    coupons: series.coupons.map((coupon) => buildCouponView(coupon, series, network, entitlements)),
  };
}

function buildCouponView(
  coupon: CouponSettlementConfig,
  series: SeriesConfig,
  network: string,
  entitlements: Map<string, CouponEntitlement | null>,
): CouponView {
  const asset = series.settlementToken.tokenId;
  const decimals = series.settlementToken.decimals;
  const total = coupon.holders.reduce((sum, holder) => sum + BigInt(holder.amount), 0n);

  return {
    coupon_id: coupon.couponId,
    coupon_ref: coupon.couponRef,
    rate_percent: coupon.ratePercent.toString(),
    rate_bps: Math.round(coupon.ratePercent * 100),
    accrual_start: asTimestamp(coupon.startDate),
    accrual_end: asTimestamp(coupon.endDate),
    record_date: asTimestamp(coupon.recordDate),
    execution_date: asTimestamp(coupon.executionDate),
    // The two halves, named. The Asset Tokenization Studio coupon action
    // declares the rate, the window and the entitlement and never moves money;
    // the payment is a Hedera Scheduled Transaction. See docs/DECISIONS.md.
    declared_by: 'ats_corporate_action',
    paid_by: 'hedera_scheduled_transaction',
    total: money(total, asset, decimals),
    holders: coupon.holders.map((holder) => {
      const live = entitlements.get(entitlementKey(coupon.couponId, holder.address));
      return {
        role: holder.role,
        account_id: holder.accountId,
        address: holder.address,
        entitlement: {
          numerator: (live?.numerator ?? BigInt(holder.numerator)).toString(),
          denominator: (live?.denominator ?? BigInt(holder.denominator)).toString(),
          record_date_reached: live?.recordDateReached ?? true,
        },
        amount: money(holder.amount, asset, decimals),
        remainder: holder.remainder,
        settlement: {
          schedule_id: holder.scheduleId ?? null,
          schedule_memo: holder.scheduleMemo ?? null,
          transaction_id: holder.executedTransactionId ?? null,
          result: holder.result ?? null,
          // Settled means the money moved. A schedule executes whether or not
          // the transaction inside it succeeded, so an execution alone is not a
          // payment and is never reported as one.
          settled: holder.settled === true,
          paid_at: holder.executedAt === undefined ? null : consensusToTimestamp(holder.executedAt),
          topic_sequence_number: holder.topicSequenceNumber ?? null,
          hashscan: {
            schedule:
              holder.scheduleId === undefined
                ? null
                : hashscanUrl('schedule', holder.scheduleId, network),
            transaction:
              holder.executedTransactionId === undefined
                ? null
                : hashscanUrl('transaction', holder.executedTransactionId, network),
          },
        },
      };
    }),
  };
}

/** A consensus timestamp is `seconds.nanos`; the wire carries RFC 3339. */
export function consensusToTimestamp(consensus: string): string {
  const seconds = Number(consensus.split('.')[0]);
  return Number.isFinite(seconds) ? asTimestamp(seconds) : consensus;
}
