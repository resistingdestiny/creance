import { Suspense, use } from 'react';

import { ListRow } from '../../components/list-row';
import { RateChart } from '../../components/rate-chart';
import { Skeleton } from '../../components/skeleton';
import { SurfaceGroup } from '../../components/surface-group';
import { formatPercent, formatPeriod, formatPeriodShort } from '../../lib/format';
import type { CouponsView, OrderBookView, PositionsView } from '../../lib/investor-api';
import type { Streamed } from '../../lib/investor-data';
import {
  latestRate,
  priceBuildUp,
  rateDomain,
  rateRange,
  rateRangeCaption,
  seriesRealised,
  type RatePoint,
} from '../../lib/investor-model';
import type { SeriesView } from '../../lib/investor-api';
import type { SeriesBandsView } from '../../lib/worker-api';

/**
 * How this occupation got to the rate it is at.
 *
 * The series page printed what a note pays today and stopped, which is the one
 * thing an investor comparing two occupations cannot decide on. This is the
 * five years behind it.
 *
 * What is on the line and what is deliberately not is set out over
 * `rateHistory` in src/lib/investor-model.ts. In short: the line is the guide
 * rate the published index implied, month by month, which is reproducible from
 * the feed by anybody; the market rate month by month is not drawn, because
 * nothing records what capacity was committed in a past month and today's
 * capacity applied to a past reading would draw prices nobody was quoted.
 *
 * So the section does not say "price history". It says what it is. A traded
 * price exists for one series out of sixteen and a coupon has settled on one
 * out of sixteen, and both of those are beside the chart, as figures, where
 * they exist.
 *
 * The heading and the sentence are on the first byte. Only the chart and the
 * two realised figures wait on a read, and they wait separately: the index
 * round and the coupon history are different calls and a slow one must not
 * hold the other.
 */

/** What the line is, and what it is not. Two sentences, and both are needed. */
const RATE_LINE =
  'What the index said this risk was worth, month by month. It is the risk half of the price, not a traded price.';

export interface RateHistorySectionProps {
  /** The guide rate by month, or null when the index round could not be read. */
  readonly rates: Streamed<readonly RatePoint[] | null>;
  readonly coupons: Streamed<CouponsView | null>;
  readonly market: Streamed<Market | null>;
  /** The chain state, for the capacity step of the price. */
  readonly series?: Streamed<SeriesView | null>;
  /** What capital has put behind each experience band, where it was read. */
  readonly bands?: Streamed<SeriesBandsView | null>;
  readonly seriesId: string;
}

/** The market reads the route makes for the page, as this section needs them. */
interface Market {
  readonly book: OrderBookView | null;
  readonly positions: PositionsView | null;
}

export function RateHistorySection({
  rates,
  bands = null,
  coupons,
  market,
  series = null,
  seriesId,
}: RateHistorySectionProps) {
  return (
    <section className="mt-10">
      <h2 className="text-body-lg font-medium text-ink">Rate history</h2>
      <p className="mt-1 max-w-[720px] text-secondary text-ink-2">{RATE_LINE}</p>
      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-x-14">
        <Suspense fallback={<ChartResting />}>
          <Chart rates={rates} />
        </Suspense>
        {/* The chart's headline and the board's headline are two different
            numbers about one occupation, and the four steps between them used
            to be nowhere on the product. They are here, in the column beside
            the figure a reader arrives confused by. */}
        <div className="flex flex-col gap-8">
          <Suspense fallback={<BuildUpResting />}>
            <BuildUp bands={bands} rates={rates} series={series} />
          </Suspense>
          <Suspense fallback={<RealisedResting />}>
            <Realised coupons={coupons} market={market} seriesId={seriesId} />
          </Suspense>
        </div>
      </div>
    </section>
  );
}

/**
 * How the price is built, from the measured risk to what a policy sells at.
 *
 * Four rows and no prose. The steps and their captions are composed in
 * src/lib/investor-model.ts so that nothing here is a phrase this file invented
 * and no figure here is a second rounding of one the chart already drew: the
 * risk charge the first row shows is the same number the headline above the
 * chart shows, passed across rather than worked out again.
 *
 * It draws nothing rather than part of itself. A series with no pool registered
 * has no capacity step and so no price to build, and an index round that did
 * not answer has no risk charge to start from.
 */
function BuildUp({
  bands,
  rates,
  series,
}: {
  bands: Streamed<SeriesBandsView | null>;
  rates: Streamed<readonly RatePoint[] | null>;
  series: Streamed<SeriesView | null>;
}) {
  const points = figureOf(rates);
  const latest = points === null ? null : latestRate(points);
  const steps = priceBuildUp(figureOf(series), figureOf(bands), latest?.value ?? null);
  if (steps.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-secondary text-ink-2">How the price is built</h3>
      <SurfaceGroup>
        {steps.map((step) => (
          <ListRow
            caption={step.caption ?? undefined}
            key={step.label}
            label={step.label}
            value={<span className="tabular-nums whitespace-nowrap">{step.value}</span>}
          />
        ))}
      </SurfaceGroup>
    </div>
  );
}

/** The heading and four rows of the group, which is what every priced series has. */
function BuildUpResting() {
  return (
    <div className="flex flex-col gap-3" data-testid="investor-resting">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-[304px] w-full rounded-group" />
    </div>
  );
}

/**
 * The figure, or the figure once it arrives. Five lines rather than a module,
 * for the reason src/app/invest/investor-overview.tsx gives where it does the
 * same: the route hands promises, a test hands values, and `use` on a promise
 * is what suspends the one boundary waiting for it.
 */
function figureOf<T>(value: Streamed<T>): T {
  return value !== null && typeof (value as Promise<T>).then === 'function'
    ? use(value as Promise<T>)
    : (value as T);
}

/**
 * The line, the figure it ends on, and what it spans.
 *
 * The chart is drawn over this occupation's own range, widened where that
 * range is too narrow to be worth the height, so that an occupation whose rate
 * sat on the floor for five years draws a flat line rather than a magnified
 * picture of thousandths of a point. The caption under it carries the two ends
 * the occupation actually reached, because that is the half a shape cannot
 * say, and it is what keeps this chart readable against the board's, which is
 * drawn over the whole range a guide rate can take.
 */
function Chart({ rates }: { rates: Streamed<readonly RatePoint[] | null> }) {
  const points = figureOf(rates);
  if (points === null || points.length === 0) return null;

  const range = rateRange([points]);
  const domain = rateDomain(range);
  const latest = latestRate(points);
  const caption = rateRangeCaption(range);
  const first = points[0];
  const last = points.at(-1);
  if (domain === null || latest === null) return null;

  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className="flex flex-col gap-1">
        <span className="text-secondary text-ink-2">
          Risk charge, {formatPeriod(latest.period)}
        </span>
        <span className="font-display text-title font-semibold tracking-title whitespace-nowrap tabular-nums text-ink">
          {formatPercent(latest.value)} a year
        </span>
      </figcaption>
      <div className="h-45 w-full lg:h-60">
        <RateChart
          height={300}
          high={domain.high}
          label={
            caption === null
              ? 'The guide rate for this occupation, month by month'
              : `The guide rate for this occupation, month by month, ${caption}`
          }
          low={domain.low}
          points={points}
          strokeWidth={1.75}
          width={720}
        />
      </div>
      <div className="flex items-baseline justify-between gap-4 text-caption text-ink-2">
        <span>{first === undefined ? '' : formatPeriodShort(first.period)}</span>
        {caption === null ? null : <span>{caption}</span>}
        <span>{last === undefined ? '' : formatPeriodShort(last.period)}</span>
      </div>
    </figure>
  );
}

/**
 * The chart at the height it stands at once it arrives: the two caption lines,
 * the plot and the three labels under it, measured at both widths. A figure
 * landing changes what is in a space and never how much space there is.
 */
function ChartResting() {
  return (
    <div className="flex flex-col gap-2" data-testid="investor-resting">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-45 w-full lg:h-60" />
      <Skeleton className="h-4 w-full" />
    </div>
  );
}

/**
 * What has actually been paid and actually been traded on this series.
 *
 * Beside the chart and not on it. Every coupon and every fill on this
 * deployment settled after the newest published index month, so there is no
 * month on that line to put a mark in; a mark would be a date this page made
 * up. The receipts for both are further down the page, on HashScan.
 */
function Realised({
  coupons,
  market,
  seriesId,
}: {
  coupons: Streamed<CouponsView | null>;
  market: Streamed<Market | null>;
  seriesId: string;
}) {
  const history = figureOf(coupons);
  const trading = figureOf(market);
  const realised = seriesRealised(history, trading?.book ?? null, seriesId);
  if (realised.paid === null && realised.traded === null && realised.nothingYet === null) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-secondary text-ink-2">Paid and traded</h3>
      {realised.paid === null && realised.traded === null ? null : (
        <SurfaceGroup>
          {realised.paid === null ? null : (
            <ListRow
              caption={`${String(realised.paid.coupons)} coupon${realised.paid.coupons === 1 ? '' : 's'}, last on ${realised.paid.day}`}
              label="Paid to noteholders"
              value={<span className="tabular-nums">{realised.paid.amount}</span>}
            />
          )}
          {realised.traded === null ? null : (
            <ListRow
              caption={realised.traded.day}
              label="A note last changed hands at"
              value={<span className="tabular-nums">{realised.traded.amount}</span>}
            />
          )}
        </SurfaceGroup>
      )}
      {realised.nothingYet === null ? null : (
        <p className="text-body text-ink">{realised.nothingYet}</p>
      )}
    </div>
  );
}

/** The heading and one row of the group, which is what most series have. */
function RealisedResting() {
  return (
    <div className="flex flex-col gap-3" data-testid="investor-resting">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-6 w-64 max-w-full" />
    </div>
  );
}
