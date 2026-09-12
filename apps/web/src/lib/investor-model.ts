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
  formatExactMoney,
  formatMoney,
  formatPercent,
  formatWholeMoney,
} from './format';
import type { ExplorerMonth, ExplorerState, RankedOccupation } from './explorer-model';
import type {
  CouponsView,
  HolderView,
  Money,
  OfferView,
  OrderBookView,
  SeriesKind,
  SeriesListEntry,
  SeriesView,
} from './investor-api';
import { findOccupation } from './occupations';
import type { SeriesBandsView } from './worker-api';

import {
  expectedLossRate,
  guideRate,
  marketRate,
  returnSplit,
  riskCharge,
  PRICING,
} from '@creance/index-model/src/pricing';

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
 * How much of a series' capacity is committed, as a percentage.
 *
 * The sum of the active cover limits over the principal that actually stands
 * behind them, which is what is funded less what claims have already taken.
 * That denominator is the chain's and not a choice: `CoverPool.bind` refuses
 * any policy that would take `activeExposure` past `vault.principalRemaining`,
 * and `CoverPool.quoteCapacity` answers with `principalRemaining` less the
 * exposure already written. Capacity measured against anything else is
 * capacity against a limit nothing enforces.
 *
 * It is worked out here rather than read from the API's own
 * `capacity_used_percent`, which divides by the principal as funded. On every
 * series that has paid nothing the two agree. On the one that has paid a claim
 * they did not, and the row said so out loud: 86,000 of exposure read as 86
 * percent of 100,000 in one column while the premium rate beside it was priced
 * off 86,000 of 97,000, so a reader could derive two different utilisations
 * from one row. The chain has one.
 *
 * Null where there is no CoverPool to ask, because an unknown capacity is not
 * the same as an unused one.
 */
export function capacityPercent(series: SeriesView): number | null {
  const pool = series.cover_pool;
  if (pool === null || !pool.registered) return null;
  const remaining = BigInt(series.vault.principal_remaining.amount);
  if (remaining <= 0n) return null;
  const exposure = BigInt(pool.active_exposure.amount);
  return (Number(exposure) / Number(remaining)) * 100;
}

/** "88.66 percent", or null where there is no pool to ask. */
export function capacityLine(series: SeriesView): string | null {
  const percent = capacityPercent(series);
  return percent === null ? null : formatPercent(percent);
}

/**
 * The two figures the capacity percentage is the ratio of, so it can be checked
 * rather than believed: "86,000 covered of 97,000".
 *
 * Null on a series nobody has bought cover from, where the percentage beside it
 * already says nought and "0 covered of 25,000" is the same fact written twice.
 */
export function capacityCaption(series: SeriesView): string | null {
  const pool = series.cover_pool;
  if (pool === null || !pool.registered) return null;
  const remaining = BigInt(series.vault.principal_remaining.amount);
  const exposure = BigInt(pool.active_exposure.amount);
  if (remaining <= 0n || exposure <= 0n) return null;
  return `${formatWholeMoney(exposure, pool.active_exposure.decimals)} covered of ${formatWholeMoney(remaining, series.vault.principal_remaining.decimals)}`;
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
      // At the asset's own precision, not rounded to cents. See
      // `formatExactMoney`: this column is added up by the people it is for,
      // and it has to reach the total printed over it.
      amount: formatExactMoney(BigInt(holder.amount.amount), holder.amount.decimals),
      transaction: holder.settlement.hashscan.transaction,
    })),
  );
  return rows.reverse();
}

export interface EarnedToDate {
  /** The settled total, in the settlement asset's minor units. */
  readonly total: bigint;
  /** "997.260273", at the same precision as the rows it is the sum of. */
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
    amount: formatExactMoney(total, settled[0]!.amount.decimals),
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
 * The rate history
 *
 * An investor weighing one occupation against another wants to know how it got
 * to the rate it is at, and the screens had nothing to say about that: they
 * printed today and stopped. Three different things could fill that gap and
 * only two of them exist, so this is what is drawn and what is refused.
 *
 * Drawn: the risk charge, month by month. Every month in the published index
 * carries a distance to the line, `riskCharge` turns a distance into the annual
 * rate that risk was worth, and the feed serves five years of them per
 * occupation. Nothing is fitted, smoothed or interpolated here; it is the
 * product's own pricing function over the product's own published readings, so
 * anybody with the feed can reproduce every point.
 *
 * The risk charge rather than the whole guide rate, because the rest of the
 * guide rate is the cost of the capital held against the cover and it is the
 * same number in every month for every occupation. Adding a constant to all
 * sixteen lines moves none of them relative to each other and flattens the
 * scale they are drawn on. The price a policy is sold at is the board's rate
 * column, which is the whole of it.
 *
 * Refused: the market rate, month by month. The market rate is
 * `marketRate(guide, utilisation)` and utilisation is the share of a series'
 * principal committed as exposure, read off the chain as it stands now.
 * Nothing anywhere records what it was in March 2024. Running today's
 * utilisation back over past distances would draw a curve of prices nobody was
 * ever quoted, and it would look exactly like a record of one, so it is not
 * drawn at all.
 *
 * Also drawn, beside the line rather than on it: what has actually settled and
 * what has actually traded. Those are real money and they are records. They
 * are not points on this chart because they did not happen in the months it
 * covers: the index runs to the newest published month and every coupon and
 * every fill on this deployment is later than that. A mark on the line would
 * put them in a month they did not happen in.
 * ------------------------------------------------------------------------- */

/**
 * One month of the guide rate.
 *
 * The field is `value` and not `rate` so that a rate series is a series the
 * chart primitives in src/components/index-chart.ts already draw: the same
 * gap handling, the same path builder, no second shape to convert between.
 * The number is an annual rate as a percentage, so 0.61 is 0.61 percent.
 */
export interface RatePoint {
  readonly period: string;
  /** The annual guide rate that month, or null for a month with no reading. */
  readonly value: number | null;
}

/** "2026-07" as a count of months, so a calendar can be walked without dates. */
function monthNumber(period: string): number {
  return Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1;
}

function periodOf(count: number): string {
  const year = Math.floor(count / 12);
  const month = (count % 12) + 1;
  return `${String(year)}-${String(month).padStart(2, '0')}`;
}

/**
 * The guide rate for every month between the oldest reading and the newest.
 *
 * The feed answers with the months it has and simply omits the ones it does
 * not, so a run of uncollected months arrives as a shorter array rather than
 * as holes in it. Drawn from that array directly, a quarter nobody published
 * would be one straight segment between the months either side of it, which is
 * a claim about readings that do not exist. So the calendar is walked here and
 * an uncollected month is a null, which is the one thing every chart in this
 * app already knows how to draw: a break in the line.
 *
 * The distance is floored at zero before it reaches the hazard, for the reason
 * src/lib/explorer-model.ts gives: the fit begins at the line and says nothing
 * below it.
 */
export function rateHistory(months: readonly ExplorerMonth[]): readonly RatePoint[] {
  const first = months[0];
  const last = months.at(-1);
  if (first === undefined || last === undefined) return [];

  const distances = new Map(months.map((month) => [month.period, month.distance]));
  const points: RatePoint[] = [];
  for (let at = monthNumber(first.period); at <= monthNumber(last.period); at += 1) {
    const period = periodOf(at);
    const distance = distances.get(period) ?? null;
    points.push({
      period,
      value: distance === null ? null : riskCharge(Math.max(0, distance)) * 100,
    });
  }
  return points;
}

export interface RateRange {
  readonly low: number;
  readonly high: number;
}

/**
 * The whole range the risk charge can take.
 *
 * This column plots the risk charge and not the guide rate, and the difference
 * matters. The guide rate a policy is actually sold at is the risk charge plus
 * the cost of the capital held against the cover, and that capital charge is
 * identical for every occupation because the pool is collateralised one for
 * one. Drawn against the guide rate, sixteen occupations differ by about half
 * again from end to end and every line looks flat. Drawn against the risk
 * charge they differ by about thirteen times, which is what the index actually
 * measured and the only thing this column is for.
 *
 * Both ends come out of the pricing rather than being written down here, so
 * they move if the fit does. The bottom is the charge at any distance far
 * enough from the line for the hazard's exponential to have died, which is the
 * hazard's own floor; the top is the charge at the line, which is the most the
 * index is ever worth because the distance is floored there.
 */
export const RATE_BOUNDS: RateRange = {
  low: riskCharge(Number.POSITIVE_INFINITY) * 100,
  high: riskCharge(0) * 100,
};

/**
 * The narrowest span a chart standing on its own is drawn over: a tenth of the
 * whole range a guide rate can take.
 *
 * Thirteen of the fifteen occupations sit where the fitted hazard is flat, so
 * five years of their rate is thousandths of a point of movement. Scaled to
 * itself that draws a mountain over an occupation whose rate did not move,
 * which is the same mistake `meterFraction` in src/lib/explorer-model.ts
 * floors its own span to avoid.
 */
export const MIN_RATE_SPAN = (RATE_BOUNDS.high - RATE_BOUNDS.low) / 10;

/**
 * What one chart is drawn over: the occupation's own range, widened about its
 * middle where that range is too narrow to be worth a chart's full height.
 *
 * A chart that stands alone uses this rather than `RATE_BOUNDS`, because a
 * page-wide chart drawn against the full range is a flat line under a hand's
 * width of empty paper for most occupations. Nothing is hidden by it: the
 * caption under the chart carries the two ends the occupation actually
 * reached, in percent, so the height says the shape and the words say the
 * size.
 */
export function rateDomain(range: RateRange | null): RateRange | null {
  if (range === null) return null;
  if (range.high - range.low >= MIN_RATE_SPAN) return range;
  const middle = (range.high + range.low) / 2;
  return { low: middle - MIN_RATE_SPAN / 2, high: middle + MIN_RATE_SPAN / 2 };
}

/**
 * The lowest and highest rate one series, or several, actually reached.
 *
 * This is what the caption under a chart says, not what the chart is drawn
 * against: the shape is read off `RATE_BOUNDS` and the magnitude is read off
 * the words, so a flat line is a flat rate and the reader is told the level
 * rather than left to guess it from the height.
 */
export function rateRange(series: readonly (readonly RatePoint[])[]): RateRange | null {
  const rates = series
    .flatMap((points) => points.map((point) => point.value))
    .filter((value): value is number => value !== null);
  if (rates.length === 0) return null;
  return { low: Math.min(...rates), high: Math.max(...rates) };
}

/** The newest month that has a rate behind it. */
export function latestRate(
  points: readonly RatePoint[],
): { readonly period: string; readonly value: number } | null {
  for (let at = points.length - 1; at >= 0; at -= 1) {
    const point = points[at];
    if (point !== undefined && point.value !== null) {
      return { period: point.period, value: point.value };
    }
  }
  return null;
}

/**
 * A rate without the word, at whatever precision `formatPercent` rounds to.
 * Taken from the formatter rather than written again, so the two ends of a
 * range cannot round differently from the figure above the chart.
 *
 * The board's hero band wants the same split for the other reason: a rate set
 * at display size has to break after the figure, because "7.9 percent" at 64px
 * is wider than the card it stands on, and the word belongs with the caption
 * under it rather than wrapped on to a line of its own.
 */
export function rateFigure(value: number): string {
  return formatPercent(value).replace(' percent', '');
}

/**
 * The caption between the two dates under the chart: what the line spans.
 * An occupation whose rate never moved says so, rather than printing the same
 * figure twice with a "to" between them.
 */
export function rateRangeCaption(range: RateRange | null): string | null {
  if (range === null) return null;
  const low = rateFigure(range.low);
  if (low === rateFigure(range.high)) return `${formatPercent(range.low)} a year throughout`;
  return `${low} to ${formatPercent(range.high)} a year`;
}

export interface SeriesRealised {
  /** Everything that has settled on the note, across every holder. */
  readonly paid: {
    readonly amount: string;
    readonly coupons: number;
    /** The day the newest of them settled. */
    readonly day: string;
  } | null;
  /** What a note of this series last actually changed hands for. */
  readonly traded: { readonly amount: string; readonly day: string } | null;
  /** What is missing, worded from the reads that answered. Null where neither is. */
  readonly nothingYet: string | null;
}

/**
 * What this series has actually paid and actually traded.
 *
 * Both are records: a settled coupon moved money out of the premium account
 * and a filled offer moved a note between two accounts, and both resolve on
 * HashScan from the sections further down this page. Neither is modelled.
 *
 * Absence is worded rather than printed as nought. Fifteen of the sixteen
 * notes have paid no coupon and fifteen have never traded, and a 0.00 against
 * either would read as a note that pays nothing rather than as one that has
 * not paid yet. A read that failed says nothing at all, because "no coupon has
 * settled" is a fact about the note and not about the read.
 */
export function seriesRealised(
  coupons: CouponsView | null,
  book: OrderBookView | null,
  seriesId: string,
): SeriesRealised {
  const settled =
    coupons === null
      ? []
      : coupons.coupons.filter((coupon) =>
          coupon.holders.some((holder) => holder.settlement.settled),
        );
  const holders = settled.flatMap((coupon) =>
    coupon.holders.filter((holder) => holder.settlement.settled),
  );
  const newest = holders
    .map((holder) => holder.settlement.paid_at)
    .filter((paidAt): paidAt is string => paidAt !== null)
    .sort()
    .at(-1);

  const paid =
    holders.length === 0 || newest === undefined
      ? null
      : {
          // The same precision the coupon table under it is written at, so the
          // one figure and the column it totals are the same arithmetic.
          amount: formatExactMoney(
            holders.reduce((sum, holder) => sum + BigInt(holder.amount.amount), 0n),
            holders[0]!.amount.decimals,
          ),
          coupons: settled.length,
          day: formatDayWithYear(isoDay(newest)),
        };

  // Newest first, which is the order the book answers in.
  const fill = offersForSeries(book, seriesId).filled[0] ?? null;
  const traded =
    fill === null || fill.closed_at === null
      ? null
      : {
          amount: formatMoney(BigInt(fill.price_per_unit.amount), fill.price_per_unit.decimals),
          day: formatDayWithYear(isoDay(fill.closed_at)),
        };

  const missing: string[] = [];
  if (coupons !== null && paid === null) missing.push('no coupon has settled');
  if (book !== null && traded === null) missing.push('no note has changed hands');
  const joined = missing.join(' and ');

  return {
    paid,
    traded,
    nothingYet:
      joined === '' ? null : `${joined.slice(0, 1).toUpperCase()}${joined.slice(1)} yet.`,
  };
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

/**
 * What the secondary market says about one series.
 *
 * Two facts, and both are records rather than opinions: the cheapest unit
 * anybody is asking for today, and what a unit last actually changed hands for.
 * There is no bid here and no depth, because the venue holds offers to sell and
 * fills of them and nothing else, and a page that drew a book it does not have
 * would be drawing a picture.
 */
export interface MarketQuote {
  /** The lowest price per unit on offer now, or null with no open offer. */
  readonly bestAsk: Money | null;
  /** Whole note units on offer across every open offer on the series. */
  readonly unitsForSale: number;
  /** What a unit last changed hands for, or null where none ever has. */
  readonly lastTraded: Money | null;
  /** When that fill settled, as an RFC 3339 instant. */
  readonly lastTradedAt: string | null;
  /** How many fills the series has ever had. */
  readonly fills: number;
}

/**
 * The board's market column, one entry per series the book has an offer on.
 *
 * The order book arrives newest first and carries every offer ever made, which
 * is what makes a last traded price readable at all: a filled offer is the only
 * record of what a unit was worth to somebody. Offers the book cannot attribute
 * to a series are skipped rather than pooled.
 */
export function marketQuotes(book: OrderBookView | null): ReadonlyMap<string, MarketQuote> {
  const quotes = new Map<string, MarketQuote>();
  if (book === null) return quotes;

  for (const offer of book.offers) {
    const id = offer.series_id;
    if (id === null) continue;
    const current = quotes.get(id) ?? {
      bestAsk: null,
      unitsForSale: 0,
      lastTraded: null,
      lastTradedAt: null,
      fills: 0,
    };

    if (offer.status === 'open') {
      const cheaper =
        current.bestAsk === null ||
        BigInt(offer.price_per_unit.amount) < BigInt(current.bestAsk.amount);
      quotes.set(id, {
        ...current,
        bestAsk: cheaper ? offer.price_per_unit : current.bestAsk,
        unitsForSale: current.unitsForSale + Number(offer.units_whole),
      });
      continue;
    }

    if (offer.status !== 'filled') continue;
    quotes.set(id, {
      ...current,
      fills: current.fills + 1,
      // Newest first, so the first fill seen for a series is the last one made.
      lastTraded: current.lastTraded ?? offer.price_per_unit,
      lastTradedAt: current.lastTradedAt ?? offer.closed_at,
    });
  }
  return quotes;
}

/** The offers on one series, open cheapest first and fills newest first. */
export function offersForSeries(
  book: OrderBookView | null,
  seriesId: string,
): { readonly open: readonly OfferView[]; readonly filled: readonly OfferView[] } {
  const mine = book === null ? [] : book.offers.filter((offer) => offer.series_id === seriesId);
  return {
    open: mine
      .filter((offer) => offer.status === 'open')
      .sort((left, right) =>
        BigInt(left.price_per_unit.amount) < BigInt(right.price_per_unit.amount) ? -1 : 1,
      ),
    // Already newest first, which is the order the book answers in.
    filled: mine.filter((offer) => offer.status === 'filled'),
  };
}

/**
 * Whether this account may take an offer, and why not where it may not.
 *
 * `blocked` is the note's own register speaking, not ours: the API reads the
 * KYC status off the note and refuses before anything is signed, and the note
 * reverts the transfer leg with the same answer if a call ever got past it. The
 * sentence says so, because a person told only "you can't" assumes the app is
 * broken.
 *
 * `own` is not a refusal at all. An account cannot buy from itself, and the
 * thing to offer it is the way to withdraw the offer instead.
 */
export type TakeState = 'take' | 'own' | 'blocked' | 'closed';

export function takeState(offer: OfferView, address: string): TakeState {
  if (offer.status !== 'open') return 'closed';
  if (offer.seller.address.toLowerCase() === address.toLowerCase()) return 'own';
  return offer.buyer_eligibility?.kyc_granted === false ? 'blocked' : 'take';
}

/**
 * What a write to the market did, as a code and never as a sentence.
 *
 * The trading forms are plain forms and the screens have no client JavaScript,
 * so the answer to a write comes back in the address. A message in a query
 * string is a message a stranger can put on somebody else's screen, so what
 * travels is one of these codes and the words are written here. Two are ours,
 * the rest are the API's own problem codes, and `failed` is anything else.
 */
export const MARKET_OUTCOMES = [
  'filled',
  'offered',
  'withdrawn',
  'fill_refused',
  'insufficient_settlement_balance',
  'offer_not_open',
  'seller_cannot_fill',
  'units_not_held',
  'not_the_seller',
  'market_writes_unavailable',
  'invalid',
  'failed',
] as const;

export type MarketOutcome = (typeof MARKET_OUTCOMES)[number];

export function marketOutcome(value: string | undefined): MarketOutcome | null {
  return MARKET_OUTCOMES.includes(value as MarketOutcome) ? (value as MarketOutcome) : null;
}

export interface MarketOutcomeMessage {
  /** Whether the thing the person asked for happened. */
  readonly done: boolean;
  readonly line: string;
}

/**
 * The sentence for an outcome.
 *
 * `fill_refused` is the one that matters and it is not worded as a failure of
 * this app, because it is not one: the note keeps its own register of who may
 * hold it, the API asks the note before it signs anything, and the note would
 * revert the transfer on the same rule if a call ever got past. That control
 * working is the thing the product is demonstrating, so the sentence names the
 * note as the thing that refused.
 */
const OUTCOME_MESSAGES: Record<MarketOutcome, MarketOutcomeMessage> = {
  filled: { done: true, line: 'Taken. The notes are in your account and the payment has settled.' },
  offered: { done: true, line: 'Your notes are on the market.' },
  withdrawn: { done: true, line: 'Offer withdrawn. The notes are yours again.' },
  fill_refused: {
    done: false,
    line: 'The note refused the transfer. It keeps its own register of who may hold it and your account is not on it, so nothing was signed and no money moved.',
  },
  insufficient_settlement_balance: {
    done: false,
    line: 'Not enough in the account to settle that, so nothing was signed.',
  },
  offer_not_open: { done: false, line: 'That offer is no longer open.' },
  seller_cannot_fill: { done: false, line: 'That is your own offer. Withdraw it instead.' },
  units_not_held: { done: false, line: 'You do not hold that many notes.' },
  not_the_seller: { done: false, line: 'Only the account that made an offer can withdraw it.' },
  market_writes_unavailable: {
    done: false,
    line: 'The market cannot take an instruction right now. The book below is still live.',
  },
  invalid: { done: false, line: 'That is not something this market can act on.' },
  failed: { done: false, line: 'That did not go through. Nothing was signed.' },
};

export function marketOutcomeMessage(outcome: MarketOutcome): MarketOutcomeMessage {
  return OUTCOME_MESSAGES[outcome];
}

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
  /** The guide rate month by month, oldest first. Empty with no reading. */
  readonly rates: readonly RatePoint[];
  /** What cover on this occupation starts at today, in percent. */
  readonly premiumPercent: number | null;
  /**
   * The dearest band, in percent, or null where every funded band prices alike
   * and the row has one price rather than a range.
   */
  readonly premiumTopPercent: number | null;
  /** How much of the series' capacity is committed, in percent. */
  readonly capacityPercent: number | null;
  /** The principal behind the series, in minor units. Null where unread. */
  readonly funded: bigint | null;
  /** What claims have already taken out of it. Null where unread. */
  readonly paid: bigint | null;
  /** What is left standing behind the cover, which is `funded` less `paid`. */
  readonly remaining: bigint | null;
  readonly decimals: number;
  /** The coupon the note has declared, in percent, where it has declared one. */
  readonly couponPercent: number | null;
  /** Where the return to capital comes from, in one sentence. See `yieldLine`. */
  readonly yieldLine: string | null;
  /**
   * This series' own note contract on HashScan.
   *
   * The note and not the vault, which is what the row used to link to. One
   * CollateralVault holds the principal of every series, so sixteen rows linked
   * to one contract while saying "contract by contract", and a reader who
   * opened two of them found the same page twice. The note is the contract that
   * is this series and nobody else's; the vault and the pool are named once, in
   * the provenance block, where a thing that is shared belongs.
   */
  readonly noteHashscan: string | null;
  readonly position: MarketPosition | null;
  /** What the secondary market has done on this series, or null where nothing. */
  readonly quote: MarketQuote | null;
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

/** The lowest and the highest annual rate a policy on this series can be sold at. */
export interface PremiumRange {
  /** What cover on this occupation starts at, in percent. */
  readonly low: number;
  /** The dearest band, in percent. Equal to `low` where every band prices alike. */
  readonly high: number;
}

/**
 * Every price cover on this series is actually quoted at, across the experience
 * bands capital has funded.
 *
 * The board used to print `premiumRatePercent` and call it the price, and on a
 * series capital has split into bands that is a rate nothing sells at. Legal is
 * the one such series today: 25,000 of principal, 10,000 of it behind the five
 * to twenty five year band and 15,000 behind twenty five or more, nothing
 * behind the first five years. The series as a whole is a fifth committed, so
 * the series-level figure came out at 7.51 percent, while the two bands a
 * worker can actually buy in quote 9.39 and 6.26. Nobody was ever offered 7.51.
 *
 * The price is band-level because `marketRate` moves with utilisation and
 * utilisation is measured per band, against the capital that chose that band.
 * `guideRate` is band blind by construction and stays series-level: it is the
 * measured half of the price and the index has no occupation-by-age series to
 * split it with. So one guide rate, and as many market rates as there are
 * funded bands.
 *
 * A band with no capital behind it is left out rather than priced at the floor,
 * which is `bandUtilisation`'s own rule: capital declining a risk is not capital
 * offering it cheaply.
 *
 * With no band read the range collapses to the series-level rate, which is what
 * the board showed before and is exactly right for the fourteen series capital
 * has not split: the bands endpoint hands all three of their bands the whole of
 * the series, so all three quote the series figure.
 */
export function premiumRange(
  series: SeriesView | null,
  bands: SeriesBandsView | null,
  distance: number | null,
): PremiumRange | null {
  const seriesRate = premiumRatePercent(series, distance);
  if (seriesRate === null || distance === null) return null;
  const flat = { low: seriesRate, high: seriesRate };
  if (bands === null) return flat;

  const rates = bandRates(bands, guideRate(Math.max(0, distance)));
  if (rates === null) return flat;
  return { low: Math.min(...rates), high: Math.max(...rates) };
}

/** One line of the price, as it is written on the screen. */
export interface PriceStep {
  readonly label: string;
  /** Already formatted, so the screen cannot round a step differently. */
  readonly value: string;
  readonly caption: string | null;
}

/**
 * The price, one step at a time, from the measured risk to what an investor is
 * paid.
 *
 * There are four numbers in a premium and the product used to show a reader the
 * first and the last of them on two screens with nothing in between. The board
 * said computer and mathematical was 12.46 percent a year; clicking the row
 * opened a chart headed "Risk charge, July 2026: 0.96 percent a year". Both are
 * this occupation's own figures, neither is wrong, and a reader with no way to
 * get from one to the other concludes the page is lying. Nothing was missing
 * from the arithmetic. The arithmetic was simply never shown.
 *
 * So it is shown:
 *
 *     risk charge      what the index says this occupation's risk is worth
 *   + capital charge   what capital requires for standing behind the cover
 *   = guide rate       what the series must charge to fund itself
 *   x capacity taken   what capital charges once its room is running out
 *   = premium rate     what a policy sells at, and what the investor is paid on
 *
 * The capital charge is flat across all fifteen occupations, by construction
 * under one for one collateralisation, so the whole of the difference between
 * two occupations is the first line and the whole of the level is the second.
 * That is worth a reader seeing, and it is the answer to why a 0.96 percent
 * risk costs 12.46 percent a year.
 *
 * The last step is a range rather than a figure where capital has split the
 * occupation into experience bands, because then each band has taken a
 * different share of its own capacity and there is no one price. See
 * `premiumRange`.
 *
 * The risk charge is passed in rather than recomputed, so this and the chart
 * above it are the same number and not two roundings of one. Empty where the
 * index round or the chain read is missing: half a build up is worse than none.
 */
export function priceBuildUp(
  series: SeriesView | null,
  bands: SeriesBandsView | null,
  riskChargePercent: number | null,
): readonly PriceStep[] {
  if (series === null || riskChargePercent === null) return [];
  const used = capacityPercent(series);
  if (used === null) return [];

  // `guideRate` is the floor or the sum, and the floor is the capital charge
  // itself, so on any occupation with a risk charge at all the sum is what it
  // returns. Written out here because a build up that hid a `max` would be a
  // build up a reader could not reproduce.
  const capital = PRICING.capitalCharge * 100;
  const guide = capital + riskChargePercent;
  const rates = bands === null ? null : bandRates(bands, guide / 100);
  const low = rates === null ? marketRate(guide / 100, used / 100) * 100 : Math.min(...rates);
  const high = rates === null ? low : Math.max(...rates);
  // "6.61 to 9.91 percent", with the word once. `rateFigure` is the same
  // rounding as `formatPercent` with the word taken off, so the two ends of a
  // range can never round differently from each other.
  const priced =
    formatPercent(low) === formatPercent(high)
      ? formatPercent(low)
      : `${rateFigure(low)} to ${formatPercent(high)}`;

  return [
    {
      label: 'Risk charge',
      value: formatPercent(riskChargePercent),
      caption: 'What the index says this occupation is worth, and the only part of the price that differs by occupation',
    },
    {
      label: 'Capital charge',
      value: formatPercent(capital),
      caption: 'What capital requires for standing behind the cover. The same for every occupation',
    },
    {
      label: 'Guide rate',
      value: formatPercent(guide),
      caption: 'The two added. What the series has to charge to fund itself',
    },
    {
      label: 'Premium rate',
      value: priced,
      caption:
        rates !== null && formatPercent(low) !== formatPercent(high)
          ? 'The guide rate, raised by the share of its own capacity each experience band has taken'
          : `The guide rate, raised by the ${formatPercent(used)} of capacity already taken`,
    },
  ];
}

/** The market rate of every band capital has funded, at one guide rate. */
function bandRates(bands: SeriesBandsView, guide: number): number[] | null {
  const rates = bands.bands
    .filter((band) => band.utilisation !== null)
    .map((band) => marketRate(guide, Number(band.utilisation)) * 100)
    .filter((rate) => Number.isFinite(rate));
  return rates.length === 0 ? null : rates;
}

/**
 * Where this series' return to capital comes from, in one sentence.
 *
 * The question the investor screens could not answer. A coupon on its own says
 * what is promised and nothing about whether the product can pay it, and until
 * the pricing was inverted it could not: premium income on the demo series ran
 * at a fifth of the coupon it owed. The three parts are the whole answer, so
 * they are given separately rather than netted into one number.
 *
 * The first part is not income. The collateral would make it in tokenised
 * treasuries, and this deployment holds its collateral in a vault on Hedera
 * testnet where it makes nothing, so the sentence says "implied" and "would"
 * and names the assumption. Netting it into a single yield figure would state
 * as earned the one part of this that has not been.
 *
 * Null wherever the rate is null, for the reason `premiumRatePercent` gives:
 * an unpriced risk is not a free one and a split nobody can check is worse
 * than no split.
 */
export function yieldLine(series: SeriesView | null, distance: number | null): string | null {
  if (series === null || distance === null) return null;
  const rate = premiumRatePercent(series, distance);
  if (rate === null) return null;
  // The principal still standing behind the series, which is the base the rate
  // above was priced off. Dividing the split by what was funded instead would
  // have printed a share of premium that does not reconcile to the rate it came
  // from on any series that has paid a claim.
  const principal = Number(BigInt(series.vault.principal_remaining.amount));
  const exposure = Number(BigInt(series.cover_pool!.active_exposure.amount));
  const split = returnSplit(
    rate / 100,
    exposure,
    principal,
    expectedLossRate(Math.max(0, distance)),
  );
  if (split === null) return null;
  const pct = (value: number) => formatPercent(value * 100);
  const deployed =
    `The first figure is what the collateral would make if it were deployed; this testnet ` +
    `deployment holds it in the vault and does not deploy it.`;

  // An empty pool is not a bad yield, and printing it as one was misleading in
  // the place it mattered most. The band features the occupation nearest its
  // line, which is the one capital has most reason to look at, and on the
  // fourteen series nobody has bought cover from that produced "0 percent from
  // premiums ... that is 4 percent a year" under the highest rate on the board.
  // Every figure in it was true and the sentence as a whole was not: it read as
  // what this occupation returns rather than as what has been written against
  // it, which is nothing. So an unwritten pool says that, and then says what
  // the cover it is waiting for is priced at.
  if (split.premium === 0) {
    return (
      `No cover has been bought on this occupation yet, so there is no premium to share. The ` +
      `capital would make ${pct(split.base)} implied from tokenised treasuries while it waits, ` +
      `and cover written here is priced at ${formatPercent(rate)} a year of the amount covered. ` +
      deployed
    );
  }

  // "At today's capacity" is load bearing rather than a hedge. The premium
  // share is premium income over principal, so a partly written pool shares
  // less than its rate, and without the clause that reads as a ceiling.
  return (
    `At today's capacity: ${pct(split.base)} implied from tokenised treasuries while the capital ` +
    `waits, ${pct(split.premium)} from premiums, less expected losses of ${pct(split.loss)}. ` +
    `That is ${pct(split.total)} a year. ` +
    deployed
  );
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
  readonly quote?: MarketQuote | null;
  /** What capital has committed to each experience band, where it was read. */
  readonly bands?: SeriesBandsView | null;
  readonly address: string;
}): MarketRow {
  const { entry, series, ranked, coupons, address } = input;
  const distance = ranked?.month?.distance ?? null;
  const rate = series?.coupons.rate_percent ?? null;
  const coupon = rate === null ? null : Number(rate);
  const holder = series === null ? null : holderFor(series, address);
  const premium = premiumRange(series, input.bands ?? null, distance);

  return {
    seriesId: entry.series_id,
    kind: entry.kind,
    group: entry.group,
    name: seriesName(entry),
    state: ranked?.state ?? null,
    gap: ranked?.gap ?? null,
    distance,
    rates: ranked === null ? [] : rateHistory(ranked.occupation.months),
    premiumPercent: premium?.low ?? null,
    // Compared as they are written rather than as they are held: two band
    // rates that round to the same two decimals are one price on screen, and a
    // range whose two ends read alike is a rendering fault.
    premiumTopPercent:
      premium === null || formatPercent(premium.high) === formatPercent(premium.low)
        ? null
        : premium.high,
    yieldLine: yieldLine(series, distance),
    capacityPercent: series === null ? null : capacityPercent(series),
    funded: series === null ? null : BigInt(series.vault.principal_funded.amount),
    paid: series === null ? null : BigInt(series.vault.principal_paid.amount),
    remaining: series === null ? null : BigInt(series.vault.principal_remaining.amount),
    decimals: series?.vault.principal_funded.decimals ?? 6,
    couponPercent: coupon !== null && Number.isFinite(coupon) ? coupon : null,
    noteHashscan: series?.note?.hashscan ?? null,
    quote: input.quote ?? null,
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
  'coupon',
  'traded',
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
  coupon: 'desc',
  traded: 'desc',
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
    case 'coupon':
      return row.couponPercent;
    case 'traded':
      // The best ask where there is one, because that is the price a person
      // could act on today; the last fill otherwise, because that is the only
      // other real price the series has. A series with neither sorts last.
      return quotedPrice(row.quote);
    case 'name':
      return null;
  }
}

function quotedPrice(quote: MarketQuote | null): number | null {
  if (quote === null) return null;
  const price = quote.bestAsk ?? quote.lastTraded;
  return price === null ? null : Number(price.amount);
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
