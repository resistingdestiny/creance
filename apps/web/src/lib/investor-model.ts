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
  formatDay,
  formatDayWithYear,
  formatMoney,
  formatPercent,
  formatWholeMoney,
} from './format';
import type { ExplorerState, RankedOccupation } from './explorer-model';
import type { CouponsView, HolderView, SeriesKind, SeriesListEntry, SeriesView } from './investor-api';
import { findOccupation } from './occupations';

import { guideRate, marketRate } from '@creance/index-model/src/pricing';

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

/**
 * What a series covers, for a screen that offers a choice between sixteen of
 * them.
 *
 * An identifier is not a name. The occupation labels are the fifteen rows of
 * docs/DESIGN-TOKENS-ADDENDUM.md and they live in src/lib/occupations.ts, which
 * is the one home for the mapping from the API's snake case group keys to the
 * words on screen.
 *
 * The maturity demonstration covers no occupation, so it is named for what it
 * is. A series whose group this bundle does not know is not named at all,
 * because a wrong occupation is worse than an identifier.
 */
export function seriesName(series: {
  readonly kind: SeriesListEntry['kind'];
  readonly group: string;
}): string | null {
  if (series.kind === 'maturity_demonstration') return 'Maturity demonstration';
  return findOccupation(series.group)?.label ?? null;
}

/**
 * An accrual window, as one phrase: "4 October to 4 November 2026".
 *
 * The year is written once where both ends share it, which is every period of
 * a twelve month note but the last.
 */
export function couponPeriod(startTimestamp: string, endTimestamp: string): string {
  const start = isoDay(startTimestamp);
  const end = isoDay(endTimestamp);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${sameYear ? formatDay(start) : formatDayWithYear(start)} to ${formatDayWithYear(end)}`;
}

export interface CouponHistoryRow {
  readonly key: string;
  readonly couponId: string;
  readonly address: string;
  /** "4 September 2026". The settlement date, or the declared execution date. */
  readonly day: string;
  /** "4 October to 4 November 2026". The window the coupon accrued over. */
  readonly period: string;
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
      period: couponPeriod(coupon.accrual_start, coupon.accrual_end),
      accountId: holder.account_id,
      role: holder.role,
      settled: holder.settlement.settled,
      amount: formatMoney(BigInt(holder.amount.amount), holder.amount.decimals),
      transaction: holder.settlement.hashscan.transaction,
    })),
  );
  return rows.reverse();
}

export interface EarnedToDate {
  /** The settled total, in the settlement asset's minor units. */
  readonly total: bigint;
  /** "986.30", the same two decimals as every other coupon figure. */
  readonly amount: string;
  /** How many coupons that total is made of. */
  readonly coupons: number;
}

/**
 * What one noteholder has actually been paid on this series, and out of how
 * many coupons.
 *
 * Settled rows only. A coupon whose schedule executed with a reverted transfer
 * left the premium account untouched and the holder unpaid, so counting it here
 * would be counting money that never moved.
 *
 * Null where nothing has settled for this holder, which is not the same as
 * nought: fifteen of the sixteen series have no noteholders and no coupons, and
 * a row reading 0.00 on them would suggest a position that does not exist.
 */
export function earnedToDate(coupons: CouponsView, address: string): EarnedToDate | null {
  const wanted = address.toLowerCase();
  const settled = coupons.coupons.flatMap((coupon) =>
    coupon.holders.filter(
      (holder) => holder.settlement.settled && holder.address.toLowerCase() === wanted,
    ),
  );
  if (settled.length === 0) return null;
  const total = settled.reduce((sum, holder) => sum + BigInt(holder.amount.amount), 0n);
  return {
    total,
    amount: formatMoney(total, settled[0]!.amount.decimals),
    coupons: settled.length,
  };
}

export interface NextPayment {
  /** "5 January 2027", the day the coupon becomes payable. */
  readonly day: string;
  /** "4 December to 4 January 2027", the window it accrues over. */
  readonly period: string;
  readonly couponId: string;
}

/**
 * The next coupon the note owes, from the schedule the API read off the note.
 *
 * The date is the execution date, which is the day the coupon becomes payable,
 * and not the record date, which only decides who is paid. Null where the note
 * owes nothing more or where its schedule could not be read; nothing here is
 * worked out from the maturity and the rate, because a guessed date on this
 * screen would be indistinguishable from a declared one.
 */
export function nextPayment(series: SeriesView): NextPayment | null {
  const next = series.coupons.next;
  if (next === null) return null;
  return {
    day: formatDayWithYear(isoDay(next.execution_date)),
    period: couponPeriod(next.accrual_start, next.accrual_end),
    couponId: next.coupon_id,
  };
}

/**
 * Whether any coupon on the series was snapshotted before its accrual window
 * closed.
 *
 * A live series takes the record date at the end of the month it is paying for.
 * These were brought forward so several periods could settle inside the event,
 * which is allowed and has to be said out loud (docs/DECISIONS.md, T06). It is
 * derived from the dates the endpoint carries rather than from a flag, so the
 * screen cannot claim a real cadence it does not have.
 */
export function recordDatesBroughtForward(coupons: CouponsView): boolean {
  return coupons.coupons.some((coupon) => coupon.record_date < coupon.accrual_end);
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

/* ---------------------------------------------------------------------------
 * The market board
 *
 * One series is a position. Fifteen series side by side is the decision, and
 * until now the investor route could only draw one of them at a time: to weigh
 * transportation against legal you changed the chooser and lost the first. The
 * board is every series the API lists as one row each, so the comparison an
 * investor actually makes is on one screen.
 *
 * A row is composed of three reads and nothing else: the series entry from
 * GET /v1/series, the chain state from GET /v1/series/:id, and the occupation's
 * newest published index reading, which is the same round the public index
 * explorer buys. A field that none of the three answers is null here and is a
 * cell that does not render, never a placeholder.
 *
 * How near the line an occupation is, and the words for it, are not worked out
 * again here. `rankByDistance` in src/lib/explorer-model.ts already orders the
 * occupations and words the gap, and one phrasing of a distance across the
 * product is the point of that module.
 * ------------------------------------------------------------------------- */

/** What this account holds of one series, from the series' own holder list. */
export interface MarketPosition {
  /** Whole notes held, as the note reports them. */
  readonly units: string;
  /** What was subscribed for them, in the settlement asset's minor units. */
  readonly subscription: bigint;
  readonly decimals: number;
  readonly accountId: string;
  /** Coupons settled to this account so far, or null where none have. */
  readonly earned: EarnedToDate | null;
}

export interface MarketRow {
  readonly seriesId: string;
  readonly kind: SeriesKind;
  /** The API's group key, which is what an index reading is matched on. */
  readonly group: string;
  /** What the series covers, or null where this bundle cannot name the group. */
  readonly name: string | null;
  /** Covered, close to opening, or claims open. Null with no index reading. */
  readonly state: ExplorerState | null;
  /** "0.7 points away", in the explorer's own words. Null with no reading. */
  readonly gap: string | null;
  /** Points still to travel to a payout, negative past the line. */
  readonly distance: number | null;
  /** The annual rate cover on this occupation is priced at today, in percent. */
  readonly premiumPercent: number | null;
  /** How much of the series' capacity is committed, in percent. */
  readonly capacityPercent: number | null;
  /** The principal behind the series, in minor units. Null where unread. */
  readonly funded: bigint | null;
  /** What claims have already taken out of it. Null where unread. */
  readonly paid: bigint | null;
  readonly decimals: number;
  /** The coupon the note has declared, in percent, where it has declared one. */
  readonly couponPercent: number | null;
  /** The vault on HashScan, so a row's figures can be read off the chain. */
  readonly hashscan: string | null;
  readonly position: MarketPosition | null;
}

/**
 * The annual rate cover on an occupation is priced at, as a percentage.
 *
 * This is the product's own published pricing, `marketRate(guideRate(d), u)`
 * from packages/index-model/src/pricing.ts, applied to two live figures: the
 * distance from the occupation's newest published reading to its line, and the
 * share of this series' remaining principal that is already committed as
 * exposure. Both come off the wire. It is the one number on the board that is
 * computed rather than read, and it is what makes the board a market rather
 * than a list: it is the price the risk in the column beside it is trading at.
 *
 * The distance is floored at zero for the same reason src/lib/explorer-model.ts
 * floors it: the hazard is an exponential fitted to buckets that begin at the
 * line, it says nothing below zero, and extrapolating it there runs the rate
 * away to numbers no capital would quote. The public explorer prices from the
 * headline form's distance and so does this, so the two public screens cannot
 * disagree about what an occupation costs.
 *
 * Null where the series carries no registered pool to take exposure, or where
 * the occupation has no published reading: an unpriced risk is not a free one.
 */
export function premiumRatePercent(
  series: SeriesView | null,
  distance: number | null,
): number | null {
  if (series === null || distance === null) return null;
  const pool = series.cover_pool;
  if (pool === null || !pool.registered) return null;
  const remaining = BigInt(series.vault.principal_remaining.amount);
  const exposure = BigInt(pool.active_exposure.amount);
  const utilisation = remaining <= 0n ? 0 : Number(exposure) / Number(remaining);
  return marketRate(guideRate(Math.max(0, distance)), utilisation) * 100;
}

/**
 * One row of the board, from the three reads behind it.
 *
 * Every argument but the entry is allowed to be null, because each read fails
 * on its own: a series the chain could not answer for keeps its name and its
 * link and loses its figures, and an occupation with no published reading keeps
 * its figures and loses its risk. Neither costs the board a row, because a row
 * that vanished would read as a series that does not exist.
 */
export function marketRow(input: {
  readonly entry: SeriesListEntry;
  readonly series: SeriesView | null;
  readonly ranked: RankedOccupation | null;
  readonly coupons: CouponsView | null;
  readonly address: string;
}): MarketRow {
  const { entry, series, ranked, coupons, address } = input;
  const distance = ranked?.month?.distance ?? null;
  const rate = series?.coupons.rate_percent ?? null;
  const coupon = rate === null ? null : Number(rate);
  const holder = series === null ? null : holderFor(series, address);

  return {
    seriesId: entry.series_id,
    kind: entry.kind,
    group: entry.group,
    name: seriesName(entry),
    state: ranked?.state ?? null,
    gap: ranked?.gap ?? null,
    distance,
    premiumPercent: premiumRatePercent(series, distance),
    capacityPercent:
      series?.cover_pool?.registered === true ? series.cover_pool.capacity_used_percent : null,
    funded: series === null ? null : BigInt(series.vault.principal_funded.amount),
    paid: series === null ? null : BigInt(series.vault.principal_paid.amount),
    decimals: series?.vault.principal_funded.decimals ?? 6,
    couponPercent: coupon !== null && Number.isFinite(coupon) ? coupon : null,
    hashscan: series?.vault.hashscan ?? null,
    position:
      holder === null || BigInt(holder.note_balance) <= 0n
        ? null
        : {
            units: holder.note_units,
            subscription: BigInt(holder.subscription.amount),
            decimals: holder.subscription.decimals,
            accountId: holder.account_id,
            earned: coupons === null ? null : earnedToDate(coupons, address),
          },
  };
}

/** The columns a person can put the board in order by. */
export const MARKET_SORTS = [
  'risk',
  'premium',
  'capacity',
  'principal',
  'paid',
  'coupon',
  'name',
] as const;

export type MarketSort = (typeof MARKET_SORTS)[number];
export type MarketDirection = 'asc' | 'desc';

/**
 * Which way round a column starts.
 *
 * Risk ascends, because the whole board is about which occupation is nearest
 * its line and the nearest is the smallest distance. Name ascends because that
 * is what alphabetical means. Every figure descends, because the question a
 * person clicking "Premium rate" is asking is which one pays most.
 */
const SORT_DEFAULT_DIRECTION: Record<MarketSort, MarketDirection> = {
  risk: 'asc',
  premium: 'desc',
  capacity: 'desc',
  principal: 'desc',
  paid: 'desc',
  coupon: 'desc',
  name: 'asc',
};

/** The sort a query string asked for, or the default. Never throws on rubbish. */
export function marketSort(value: string | undefined): MarketSort {
  return MARKET_SORTS.includes(value as MarketSort) ? (value as MarketSort) : 'risk';
}

export function marketDirection(sort: MarketSort, value: string | undefined): MarketDirection {
  if (value === 'asc' || value === 'desc') return value;
  return SORT_DEFAULT_DIRECTION[sort];
}

/** What pressing a column header should ask for next: its own order, then the reverse. */
export function nextDirection(
  column: MarketSort,
  sort: MarketSort,
  direction: MarketDirection,
): MarketDirection {
  if (column !== sort) return SORT_DEFAULT_DIRECTION[column];
  return direction === 'asc' ? 'desc' : 'asc';
}

function valueOf(row: MarketRow, sort: MarketSort): number | null {
  switch (sort) {
    case 'risk':
      return row.distance;
    case 'premium':
      return row.premiumPercent;
    case 'capacity':
      return row.capacityPercent;
    case 'principal':
      return row.funded === null ? null : Number(row.funded);
    case 'paid':
      return row.paid === null ? null : Number(row.paid);
    case 'coupon':
      return row.couponPercent;
    case 'name':
      return null;
  }
}

/**
 * The board in order.
 *
 * A row with nothing to sort by sinks to the bottom whichever way the column
 * points, which is `rankByDistance`'s rule kept: nothing known about a figure is
 * not the smallest value of it, and putting an unread row above a measured one
 * would be a claim. Ties break on the name so that two views of the same data
 * are in the same order.
 */
export function sortMarketRows(
  rows: readonly MarketRow[],
  sort: MarketSort,
  direction: MarketDirection,
): readonly MarketRow[] {
  const sign = direction === 'asc' ? 1 : -1;
  const label = (row: MarketRow): string => row.name ?? row.seriesId;
  return [...rows].sort((left, right) => {
    if (sort !== 'name') {
      const a = valueOf(left, sort);
      const b = valueOf(right, sort);
      if (a === null && b !== null) return 1;
      if (b === null && a !== null) return -1;
      if (a !== null && b !== null && a !== b) return (a - b) * sign;
    }
    return label(left).localeCompare(label(right), 'en-GB') * (sort === 'name' ? sign : 1);
  });
}
