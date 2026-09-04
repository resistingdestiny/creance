import { money, type Money } from '@creance/client';

import type { CouponSettlementConfig, HolderConfig, SeriesConfig } from './config.js';
import type { CouponEntitlement, HolderState, NoteState, VaultSeriesState } from './chain.js';

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
  coupons: { count: number; settled: number; latest_coupon_id: string | null };
  links: { coupons: string; payments_topic: string | null };
}

const SECONDS = 1000;

/** RFC 3339 in UTC, second precision, which is what every timestamp here is. */
export function asTimestamp(seconds: number): string {
  return new Date(seconds * SECONDS).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function hashscanUrl(kind: string, id: string, network = 'testnet'): string {
  return `https://hashscan.io/${network}/${kind}/${id}`;
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
}

export function buildSeriesView(input: SeriesViewInput): SeriesView {
  const { series, vault, note, holders, network } = input;
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
      hashscan: hashscanUrl('account', config.accountId, network),
    })),
    coupons: {
      count: series.coupons.length,
      settled,
      latest_coupon_id: series.coupons.at(-1)?.couponId ?? null,
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
