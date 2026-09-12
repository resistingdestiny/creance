import { ChevronRight } from '../../components/icons';
import { CoverCardShell } from '../../components/cover-card';
import { RateChart } from '../../components/rate-chart';
import { StatusPill } from '../../components/status-pill';
import type { ExplorerProvenance } from '../../lib/explorer-data';
import type { ExplorerState } from '../../lib/explorer-model';
import { formatPeriod, formatPeriodShort } from '../../lib/format';
import {
  rateFigure,
  rateRange,
  rateRangeCaption,
  sortMarketRows,
  RATE_BOUNDS,
  type MarketRow,
} from '../../lib/investor-model';

/**
 * The top of the market board: what this market is doing right now.
 *
 * The board opened on a heading and a table. Every figure on it was true and
 * nothing on it was loud, so the page read as a spreadsheet of sixteen rows and
 * the most interesting fact the product holds, that one occupation is sitting
 * on its line, was a pill in a cell. The fix is not more figures. It is to take
 * the figures the board already reads and give the first of them the room it is
 * worth: the occupation nearest a payout, its price at display size on the
 * card that is this product's signature object, and five years of its rate as a
 * chart big enough to read rather than a 72 by 20 squiggle.
 *
 * The band is `night`, which the addendum reserved for the landing and the
 * header. It is here because the landing's dark ground and its metal card are
 * the material this product is recognised by and the investor screen shared
 * none of it: the page an investor lands on looked like a different product
 * from the page that sold it to them. The ground stops at the band. Everything
 * below, the cards, the table, the holdings and the provenance, is the light
 * product exactly as docs/DESIGN-TOKENS.md specifies.
 *
 * Nothing here is a second read. Every figure is a field of the `MarketRow` the
 * board already composed, and a row that cannot supply one renders nothing in
 * its place. There is no volume, no order book and no traded price in the band,
 * for the reason src/app/invest/market-board.tsx gives: fourteen of the sixteen
 * series have never traded, and the rate history is a guide rate that the
 * product prices from, not a price anybody has paid. The band says so under the
 * chart, where the chart is now large enough that somebody might otherwise take
 * it for one.
 */

/** The state colour a pill draws, as the public explorer maps it. */
const PILL: Record<ExplorerState, 'covered' | 'watch' | 'triggered'> = {
  covered: 'covered',
  watch: 'watch',
  open: 'triggered',
};

/**
 * The rows the band can feature, nearest its line first.
 *
 * `sortMarketRows` is the board's own ranking and not a second one, so the
 * occupation the band leads with is the occupation the table opens with. A row
 * with no reading behind it has no risk, no price and no history and cannot be
 * featured; it is still a row of the table below.
 */
export function featuredRows(rows: readonly MarketRow[]): readonly MarketRow[] {
  return sortMarketRows(rows, 'risk', 'asc').filter(
    (row) => row.state !== null && row.gap !== null && row.premiumPercent !== null && row.rates.length > 0,
  );
}

/**
 * The first and last month a row actually has a rate for, which is what the
 * two ends of a chart are. A series with one published month has no span to
 * label and the same month printed at both ends of a line would say it ran
 * from July to July, so it is absent instead.
 */
function span(row: MarketRow): { readonly from: string; readonly to: string } | null {
  const observed = row.rates.filter((point) => point.value !== null);
  const first = observed[0];
  const last = observed.at(-1);
  if (first === undefined || last === undefined || first.period === last.period) return null;
  return { from: formatPeriodShort(first.period), to: formatPeriodShort(last.period) };
}

export function BoardHero({
  featured,
  provenance,
}: {
  featured: MarketRow;
  provenance: ExplorerProvenance | null;
}) {
  const months = span(featured);
  const reached = rateRangeCaption(rateRange([featured.rates]));
  return (
    <div className="mt-8 flex flex-col gap-8 lg:mt-12 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-stretch lg:gap-12">
      {/* The card first at 390 and second at 1440. It is the anchor of the
          composition and the thing a phone should meet before it meets a
          chart, and on a wide screen it seats on the right where the landing
          hero puts it. */}
      <div className="order-1 lg:order-2">
        <FeaturedCard row={featured} />
      </div>

      <div className="order-2 flex flex-col gap-3 lg:order-1">
        <p className="text-secondary text-white/66">
          {provenance?.asOf === undefined || provenance.asOf === null
            ? 'Nearest a payout'
            : `Nearest a payout, on the reading for ${formatPeriod(provenance.asOf)}`}
        </p>
        {/* 56px at 390 and 224px from the landing breakpoint. The chart is the
            subject of the band, not a mark beside a figure, so it takes the
            height a figure would have taken and the figures stand on the card
            beside it. */}
        {/* `rate-glow` is the soft light behind the line, in globals.css with
            its reasoning. It cannot be a utility here: the utility form
            compiles the framework's whole elevation variable chain into the
            stylesheet, which built-css.test.ts refuses. */}
        <span className="rate-glow block h-36 w-full lg:h-56">
          <RateChart
            height={200}
            high={RATE_BOUNDS.high}
            label={
              reached === null
                ? `Risk charge over five years for ${featured.name ?? featured.seriesId}`
                : `Risk charge for ${featured.name ?? featured.seriesId}, ${reached}`
            }
            low={RATE_BOUNDS.low}
            points={featured.rates}
            stroke="#ffffff"
            strokeWidth={2}
            width={720}
          />
        </span>
        {months === null ? null : (
          <p className="flex items-center justify-between gap-4 text-caption tabular-nums text-white/66">
            <span>{months.from}</span>
            <span>{months.to}</span>
          </p>
        )}
        <p className="text-secondary text-white/66">
          The risk this occupation has carried, month by month
          {reached === null ? '' : `, ${reached}`}. It is the risk half of the price and not a price
          anything has changed hands at.
        </p>
      </div>
    </div>
  );
}

/**
 * The featured occupation on the metal.
 *
 * The addendum's "The metal" section allows the card identity and value and a
 * headline figure, which is exactly what this is: the occupation, how near it
 * is to paying out, and what its cover costs a year. It carries no row, no
 * control and no link, so the page's one moving light stays off ordinary
 * content, and it is the only shimmering element on the board, which is the
 * budget the addendum sets.
 *
 * The figure and the word are separated because the figure is set at
 * display-xl: "7.9 percent" at 64px is wider than the card, and the word reads
 * better in the caption under it than wrapped on to a line of its own.
 */
function FeaturedCard({ row }: { row: MarketRow }) {
  return (
    <CoverCardShell className="h-full w-full" metal="shimmer" treatment="certificate">
      <div className="cover-card__content flex h-full flex-col justify-between gap-10">
        <div className="flex flex-col items-start gap-3">
          <p className="text-body-lg font-medium text-ink">{row.name ?? row.seriesId}</p>
          {row.state === null || row.gap === null ? null : (
            <StatusPill state={PILL[row.state]}>{row.gap}</StatusPill>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-display text-display-l font-semibold tracking-display tabular-nums text-ink lg:text-display-xl">
            {row.premiumPercent === null ? null : rateFigure(row.premiumPercent)}
          </p>
          <p className="text-secondary text-ink">percent a year for cover on this occupation</p>
          {/* Where that rate goes, which is the question a coupon on its own
              cannot answer. Three parts and not one netted figure, because the
              first of the three is the one this deployment does not earn and a
              single number would state it as income. */}
          {row.yieldLine === null ? null : (
            <p className="text-caption text-ink-2">{row.yieldLine}</p>
          )}
        </div>
      </div>
    </CoverCardShell>
  );
}

/**
 * The occupations behind the featured one, as cards with a chart each.
 *
 * The table below answers a column question and these answer the other one:
 * what is each of the few occupations at the front of the queue actually
 * doing. A card has room for the rate at a size a person reads without
 * stopping and for five years of the shape behind it, which a 72px cell does
 * not, and three of them side by side is still a comparison.
 *
 * Three, because the band above features the first: four cards would repeat
 * the headline and sixteen would be the wall of cards the table exists
 * instead of. Everything past them is a row below.
 */
export function MarketCards({ rows }: { rows: readonly MarketRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-body-lg font-medium text-ink">Next nearest the line</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <MarketCard key={row.seriesId} row={row} />
        ))}
      </div>
    </section>
  );
}

function MarketCard({ row }: { row: MarketRow }) {
  const months = span(row);
  const reached = rateRangeCaption(rateRange([row.rates]));
  return (
    <a
      className="flex flex-col gap-4 rounded-2xl border border-hairline p-5 no-underline transition-colors hover:border-ink-3"
      href={`/invest?series=${encodeURIComponent(row.seriesId)}`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="text-body font-medium text-ink">{row.name ?? row.seriesId}</span>
        <ChevronRight className="mt-1 shrink-0 text-ink-3" />
      </span>
      {row.state === null || row.gap === null ? null : (
        <span className="w-fit">
          <StatusPill state={PILL[row.state]}>{row.gap}</StatusPill>
        </span>
      )}
      <span className="flex items-baseline gap-2">
        <span className="font-display text-headline font-semibold tracking-title tabular-nums text-ink">
          {row.premiumPercent === null ? null : rateFigure(row.premiumPercent)}
        </span>
        <span className="text-secondary text-ink-2">percent a year</span>
      </span>
      {/* Every card is drawn against the same ruler the table's column uses,
          so a flat line here is a rate that stayed where it was rather than
          one scaled to fill the card. */}
      <span className="block h-16 w-full">
        <RateChart
          height={64}
          high={RATE_BOUNDS.high}
          label={
            reached === null
              ? `Guide rate over five years for ${row.name ?? row.seriesId}`
              : `Guide rate for ${row.name ?? row.seriesId}, ${reached}`
          }
          low={RATE_BOUNDS.low}
          points={row.rates}
          strokeWidth={1.5}
          width={320}
        />
      </span>
      {months === null ? null : (
        <span className="flex items-center justify-between gap-4 text-caption tabular-nums text-ink-2">
          <span>{months.from}</span>
          <span>{months.to}</span>
        </span>
      )}
    </a>
  );
}
