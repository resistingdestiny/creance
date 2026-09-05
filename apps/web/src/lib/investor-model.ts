/**
 * Everything the investor screens derive from the endpoints, as pure
 * functions over the response shapes and nothing else.
 *
 * The arithmetic is in bigint throughout. The principal is 100,000 at six
 * decimals, which is 100,000,000,000 minor units, and every intermediate
 * figure on these screens is a difference of two such numbers. A float would
 * be exact for these particular values and would stop being exact the first
 * time somebody widened the scale, which is not a property to rely on for the
 * number that says how much of an investor's money is still theirs.
 */

import {
  formatDayWithYear,
  formatMoney,
  formatPercent,
  formatWholeMoney,
} from './format';
import type { CouponsView, HolderView, SeriesView } from './investor-api';

/** RFC 3339 in UTC to the date-only string the formatters take. */
export function isoDay(timestamp: string): string {
  return timestamp.slice(0, 10);
}

export interface PrincipalSegments {
  /** Paid out to policyholders on approved claims. Gone. */
  readonly paid: bigint;
  /** Earmarked in the CoverPool while claims are open. Not gone yet. */
  readonly reserved: bigint;
  /** Neither paid nor earmarked. */
  readonly intact: bigint;
  readonly funded: bigint;
  readonly paidPercent: number;
  readonly reservedPercent: number;
  readonly intactPercent: number;
}

/**
 * The three segments of the principal bar, in the addendum's order: paid,
 * reserved, intact.
 *
 * `intact` is what is left after both, and it is floored at zero rather than
 * allowed to go negative. A vault cannot reserve more than it holds, so a
 * negative here would mean the two reads disagreed, and a bar that draws a
 * negative segment hides that instead of showing it.
 */
export function principalSegments(series: SeriesView): PrincipalSegments {
  const funded = BigInt(series.vault.principal_funded.amount);
  const paid = BigInt(series.vault.principal_paid.amount);
  const reserved = BigInt(series.vault.principal_reserved.amount);
  const rest = funded - paid - reserved;
  const intact = rest > 0n ? rest : 0n;

  const share = (value: bigint): number =>
    funded <= 0n ? 0 : Number((value * 10_000n) / funded) / 100;
  const paidPercent = share(paid);
  const reservedPercent = share(reserved);

  return {
    paid,
    reserved,
    intact,
    funded,
    paidPercent,
    reservedPercent,
    // The remainder rather than its own division, so the three always add up
    // to a hundred and the bar has no rounding gap at its right edge.
    intactPercent: funded <= 0n ? 0 : Math.max(0, 100 - paidPercent - reservedPercent),
  };
}

/**
 * The caption under the bar, from docs/DESIGN-TOKENS-ADDENDUM.md:
 * "100,000 principal. 15,000 reserved while claims are open. 5,000 paid so far."
 *
 * A clause whose figure is zero is dropped rather than rendered as a zero. The
 * sentence about a reserve held "while claims are open" is false for a series
 * whose claims are not open, and the two rows above the bar already say that
 * both figures are nought.
 */
export function principalCaption(series: SeriesView): string {
  const { paid, reserved, funded } = principalSegments(series);
  const decimals = series.vault.principal_funded.decimals;
  const clauses = [`${formatWholeMoney(funded, decimals)} principal.`];
  if (reserved > 0n) {
    clauses.push(`${formatWholeMoney(reserved, decimals)} reserved while claims are open.`);
  }
  if (paid > 0n) clauses.push(`${formatWholeMoney(paid, decimals)} paid so far.`);
  if (reserved === 0n && paid === 0n) clauses.push('None reserved, none paid.');
  return clauses.join(' ');
}

export interface PrincipalAtRisk {
  /** "Currently 100,000, 100 percent intact" */
  readonly current: string;
  /** "92,500 if triggered", or null while nothing is at stake. */
  readonly ifTriggered: string | null;
}

/**
 * The "Principal at risk" block of the copy deck.
 *
 * "Currently" is the vault's remaining principal, which is what is funded less
 * what claims have already taken. "If triggered" is that figure less the
 * reserve the CoverPool is holding, and it renders only while a reserve
 * exists: with no claims open there is nothing that could be triggered, and a
 * worst case of nought would read as a promise rather than as a state.
 *
 * The copy deck writes the first line with an em dash. The house rule replaces
 * it with a comma; see docs/DECISIONS.md.
 */
export function principalAtRisk(series: SeriesView): PrincipalAtRisk {
  const decimals = series.vault.principal_remaining.decimals;
  const funded = BigInt(series.vault.principal_funded.amount);
  const remaining = BigInt(series.vault.principal_remaining.amount);
  const reserved = BigInt(series.vault.principal_reserved.amount);
  const intactPercent = funded <= 0n ? 0 : Number((remaining * 100n) / funded);

  return {
    current: `Currently ${formatWholeMoney(remaining, decimals)}, ${formatPercent(intactPercent)} intact`,
    ifTriggered:
      reserved > 0n
        ? `${formatWholeMoney(remaining - reserved, decimals)} if triggered`
        : null,
  };
}

/** "8 percent a year, paid monthly", or null where no coupon has been declared. */
export function couponLine(series: SeriesView): string | null {
  const rate = series.coupons.rate_percent;
  if (rate === null) return null;
  const numeric = Number(rate);
  if (!Number.isFinite(numeric)) return null;
  return `${formatPercent(numeric)} a year, paid monthly`;
}

/** "12 months", or null for a series the CoverPool has never registered. */
export function termLine(series: SeriesView): string | null {
  const months = series.cover_pool?.term_months ?? null;
  return months === null ? null : `${months} months`;
}

/**
 * "Capacity used", the rule from DESIGN.md 3.2: the sum of the active cover
 * limits over the principal. Null where there is no CoverPool to ask, because
 * an unknown capacity is not the same as an unused one.
 */
export function capacityLine(series: SeriesView): string | null {
  const pool = series.cover_pool;
  if (pool === null || !pool.registered) return null;
  return formatPercent(pool.capacity_used_percent);
}

export interface CouponHistoryRow {
  readonly key: string;
  readonly couponId: string;
  readonly address: string;
  /** "4 September 2026". The settlement date, or the declared execution date. */
  readonly day: string;
  readonly accountId: string;
  readonly role: string;
  readonly settled: boolean;
  readonly amount: string;
  /** The executed transaction on HashScan, where one settled. */
  readonly transaction: string | null;
}

/**
 * The coupon history, one row per coupon and holder, newest first.
 *
 * The state is the settlement's own `settled` flag and not the presence of a
 * transaction id. A Scheduled Transaction executes whether or not the
 * transaction inside it succeeded, so an execution alone is not a payment.
 */
export function couponHistory(coupons: CouponsView): CouponHistoryRow[] {
  const rows = coupons.coupons.flatMap((coupon) =>
    coupon.holders.map((holder) => ({
      key: `${coupon.coupon_id}:${holder.address}`,
      couponId: coupon.coupon_id,
      address: holder.address,
      day: formatDayWithYear(isoDay(holder.settlement.paid_at ?? coupon.execution_date)),
      accountId: holder.account_id,
      role: holder.role,
      settled: holder.settlement.settled,
      amount: formatMoney(BigInt(holder.amount.amount), holder.amount.decimals),
      transaction: holder.settlement.hashscan.transaction,
    })),
  );
  return rows.reverse();
}

/** The holder a screen is speaking to, by EVM address, case insensitive. */
export function holderFor(series: SeriesView, address: string): HolderView | null {
  const wanted = address.toLowerCase();
  return series.holders.find((holder) => holder.address.toLowerCase() === wanted) ?? null;
}

/**
 * The first coupon this holder was actually paid, for the "First coupon" row
 * on the subscribe screen. Null until one settles.
 */
export function firstSettledCoupon(
  coupons: CouponsView,
  address: string,
): CouponHistoryRow | null {
  const wanted = address.toLowerCase();
  // couponHistory is newest first, so the oldest settled row is the last match.
  const settled = couponHistory(coupons).filter(
    (row) => row.settled && row.address.toLowerCase() === wanted,
  );
  return settled.at(-1) ?? null;
}
