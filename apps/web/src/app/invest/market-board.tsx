import { Suspense, use, type ReactNode } from 'react';

import { ChevronRight } from '../../components/icons';
import { DesktopFrame } from '../../components/desktop-frame';
import { RateChart } from '../../components/rate-chart';
import { Skeleton } from '../../components/skeleton';
import { StatusPill } from '../../components/status-pill';
import { SurfaceGroup } from '../../components/surface-group';
import { ListRow } from '../../components/list-row';
import { TextLink } from '../../components/text-link';
import { settledLead, stateWord, type ExplorerState } from '../../lib/explorer-model';
import {
  formatDayWithYear,
  formatPercent,
  formatPeriod,
  formatPeriodShort,
  formatWholeMoney,
} from '../../lib/format';
import type { Streamed } from '../../lib/investor-data';
import {
  isoDay,
  nextDirection,
  rateRange,
  rateRangeCaption,
  sortMarketRows,
  RATE_BOUNDS,
  type MarketDirection,
  type MarketOutcome,
  type MarketRow,
  type MarketSort,
} from '../../lib/investor-model';
import { DEMO_WALLET_LABEL, type WalletAccount } from '../../lib/wallet';
import type { BoardHolding, BoardOffer, BoardView } from './board-data';
import { BoardHero, MarketCards, featuredRows } from './board-hero';
import { SellNotes, MarketOutcomeBanner, WithdrawButton } from './trading';

/**
 * The market board: every series the API lists, as one row each.
 *
 * This is the investor landing view. What an investor is choosing between is
 * fifteen occupations, and until now the route could show one of them at a
 * time, so the comparison that is the whole decision happened in somebody's
 * head across several page loads.
 *
 * A table and not a wall of cards. There are sixteen rows and six figures on
 * each, and the question a person brings here is a column question: which
 * occupation is nearest its line, which pays most for the risk it carries,
 * which has capacity left. A column of right aligned tabular figures answers
 * that with the eye alone; sixteen cards answer it by making a person hold one
 * number in their head while they scroll to the next. Cards win when a row has
 * a picture or a story and lose when it has six numbers.
 *
 * The order is the interaction. Every column heading is a link that sorts by
 * that column, so the board is put in order by the server with no client
 * JavaScript, the order survives a share of the address, and it works before
 * hydration. The default order is the one the risk column is in: nearest its
 * line first, which is the order `rankByDistance` already puts the occupations
 * in for the public explorer.
 *
 * Where each figure comes from is in src/lib/investor-model.ts. Nothing on this
 * screen is a constant and nothing is a placeholder: a cell whose figure could
 * not be read is empty.
 *
 * There is no order book on this page, no bid, no ask and no volume, because
 * there is no such record to read yet. The seam for one is the positions block
 * under the table, which is this account's own holdings read off the note, and
 * a row's own detail page below it.
 *
 * The table is not the whole page any more. Above it stand a hero band and
 * three cards, in src/app/invest/board-hero.tsx, which take the first four rows
 * of the same ranking and give them the room the board never had: the price at
 * display size and the rate history as a chart rather than a mark. The
 * reasoning for that is on that file. The table stays exactly as it was and for
 * exactly the reason above: a card cannot answer a column question, and the
 * reader who wants to compare all sixteen scrolls past the cards to the board
 * they already know.
 *
 * This account's holdings moved under the table with it. They were the first
 * thing on the screen, so a person with two notes met their own two notes
 * before they met the market of sixteen, which is the wrong way round for the
 * page the product points an investor at. They stay above the provenance block,
 * which speaks for them.
 */

/**
 * One line under the heading, and it does a job: it says what the two columns
 * a person has not seen before mean. Everything else the board has to say it
 * says in a column heading.
 */
const BOARD_LINE = 'What each occupation pays, and how near its index is to a payout.';

export interface MarketBoardProps {
  board: Streamed<BoardView>;
  investor: WalletAccount;
  sort: MarketSort;
  direction: MarketDirection;
  /** What a trade the person just made did, where they just made one. */
  outcome?: MarketOutcome | null;
}

export function MarketBoard({
  board,
  investor,
  sort,
  direction,
  outcome = null,
}: MarketBoardProps) {
  return (
    <DesktopFrame current="invest">
      {/* The heading and the lead are outside the boundary and on the first
          byte, which is the rule the whole route follows (T51). What waits on
          a read is the featured occupation inside the band, and it rests at
          the height it will stand at, so nothing under it moves when the
          figures land.

          `data-tone` is what the stylesheet's focus rule reads: the outline
          turns white on this ground, where the sheet's black one would be
          invisible on the card and the pill. */}
      <section
        className="overflow-hidden rounded-card bg-night px-6 py-8 lg:rounded-hero lg:px-12 lg:py-12"
        data-tone="night"
      >
        {/* The heading is the words the reader pressed to get here. The
            header's control says "Earn yield" and this page said
            "Occupations", so the one thing a visitor had just been promised
            was not on the page they landed on. The line under it still says
            what the page is made of. */}
        <h1 className="text-title font-display font-semibold tracking-title text-white lg:text-landing-head lg:tracking-display">
          Earn yield
        </h1>
        <p className="mt-1 text-body text-white/66 lg:text-landing-lead">{BOARD_LINE}</p>
        <Suspense fallback={<HeroResting />}>
          <Featured board={board} />
        </Suspense>
      </section>

      {outcome === null ? null : <MarketOutcomeBanner outcome={outcome} />}

      <Suspense fallback={<BoardResting />}>
        <Board board={board} direction={direction} investor={investor} sort={sort} />
      </Suspense>
    </DesktopFrame>
  );
}

/**
 * The occupation nearest a payout, once the board has been read.
 *
 * Its own boundary, and the second one on this screen to `use` the same
 * promise. Both resolve together, because it is one read; what the two
 * boundaries buy is the band's heading on the first byte with the figures
 * inside it landing in a space that was already the right size.
 *
 * A board where no row carries a reading has nothing to feature and the band
 * is its heading alone, which is what the index round failing looks like.
 */
function Featured({ board }: { board: Streamed<BoardView> }) {
  const view = figureOf(board);
  const featured = featuredRows(view.rows)[0];
  if (featured === undefined) return null;
  return <BoardHero featured={featured} provenance={view.provenance} />;
}

/**
 * The figure, or the figure once it arrives. The route hands this screen a
 * promise so the heading is on the first byte; a test hands it the value and
 * the same components render it with no boundary in between. It is the helper
 * src/app/invest/investor-overview.tsx already uses, for its reason.
 */
function figureOf<T>(value: Streamed<T>): T {
  return value !== null && typeof (value as Promise<T>).then === 'function'
    ? use(value as Promise<T>)
    : (value as T);
}

function Board({
  board,
  direction,
  investor,
  sort,
}: {
  board: Streamed<BoardView>;
  direction: MarketDirection;
  investor: WalletAccount;
  sort: MarketSort;
}) {
  const view = figureOf(board);
  const rows = sortMarketRows(view.rows, sort, direction);

  return (
    <>
      {/* The first is the band's, so the cards carry the three behind it. */}
      <MarketCards rows={featuredRows(view.rows).slice(1, 4)} />
      <ForSale offers={view.forSale} />
      <section className="mt-10">
        <h2 className="mb-4 text-body-lg font-medium text-ink">All occupations</h2>
        <MarketTable direction={direction} rows={rows} sort={sort} />
      </section>
      {view.holdings.length === 0 ? null : <Positions investor={investor} view={view} />}
      <Provenance view={view} />
    </>
  );
}

/**
 * What a note is, for a reader who has never held one.
 *
 * One sentence. The heading says these are for sale, each row says how many and
 * at what price, and the screen that takes one says the rest; what was left
 * over was four sentences nobody was going to read on a phone.
 */
const NOTE_LINE =
  "One unit of an occupation's cover. It pays that series' coupon while you hold it, and its principal comes back at maturity.";

/**
 * The notes on offer now.
 *
 * The venue was real and unfindable. Every open offer lived in a caption in the
 * last column of one row of the table, which folds away below the landing
 * breakpoint, so a reader on a phone had no way to learn a secondary market
 * existed and a reader on a desktop had to know which row to look at. It is
 * above the table instead, named, priced, and one tap from the screen that
 * takes it.
 *
 * A lot links to its own series rather than carrying a take button of its own.
 * The form that takes an offer needs the note's verdict on the buyer, which is
 * a read per series, and the series page already makes it: a second copy here
 * would be sixteen reads for a section that is usually two lines long.
 *
 * Nothing at all where the book is empty or could not be read. An empty
 * "For sale" heading reads as a market with no sellers, and on a board whose
 * whole argument is that its figures are records, a heading over nothing is the
 * one thing that looks like a mock up.
 */
function ForSale({ offers }: { offers: readonly BoardOffer[] }) {
  if (offers.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="mb-1 text-body-lg font-medium text-ink">Notes for sale</h2>
      <p className="mb-4 max-w-[720px] text-secondary text-ink-2">{NOTE_LINE}</p>
      <SurfaceGroup>
        {offers.map((offer) => (
          <a
            /* The whole row is the door, at the sheet's tap minimum, because
               the thing a reader wants from this list is the screen that takes
               the offer and there is nothing else on the row to press. */
            className="flex min-h-[72px] w-full items-center justify-between gap-4 py-3 underline-offset-[3px] hover:underline"
            href={`/invest?series=${encodeURIComponent(offer.seriesId)}`}
            key={offer.offerId}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-body text-ink">{offer.name ?? offer.seriesId}</span>
              <span className="text-caption tabular-nums text-ink-2">
                {offer.units} note{offer.units === '1' ? '' : 's'},{' '}
                {formatWholeMoney(BigInt(offer.total.amount), offer.total.decimals)} for the lot
              </span>
            </span>
            <span className="flex items-center gap-1 text-body text-ink">
              <span className="tabular-nums whitespace-nowrap">
                {formatWholeMoney(BigInt(offer.pricePerUnit.amount), offer.pricePerUnit.decimals)} a
                note
              </span>
              <ChevronRight className="shrink-0 text-ink-3" />
            </span>
          </a>
        ))}
      </SurfaceGroup>
    </section>
  );
}

/**
 * What this account holds, and what it can do with it.
 *
 * It stands under the board, not over it. A person who already holds a note
 * does read it first, but two notes are a smaller thing than sixteen
 * occupations and this is the page the product points an investor at, so the
 * market comes first and a holding is found by scrolling past it. The
 * secondary market still belongs here, because an offer is made against a
 * holding and the holdings are here.
 *
 * These are blocks and not a table, which is the opposite of the decision the
 * board itself makes, and for the opposite reason. The board
 * is sixteen rows of six figures and the question there is a column question.
 * This is two notes with four figures and two controls each, and a control does
 * not belong in a cell: a form needs room for its fields and a person needs to
 * see which holding they are selling out of.
 */
function Positions({ investor, view }: { investor: WalletAccount; view: BoardView }) {
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-body-lg font-medium text-ink">Your notes</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {view.holdings.map((holding) => (
          <Holding holding={holding} key={holding.seriesId} />
        ))}
      </div>
      <p className="mt-4 text-secondary text-ink-2">
        <span className="tabular-nums">{investor.accountId}</span>
        {view.settlementBalance === null ? null : (
          <>
            {', '}
            <span className="tabular-nums">
              {formatWholeMoney(
                BigInt(view.settlementBalance.amount),
                view.settlementBalance.decimals,
              )}
            </span>
            {' to settle with'}
          </>
        )}
        {'. '}
        {DEMO_WALLET_LABEL}
      </p>
    </section>
  );
}

/**
 * One note held: the figures, then what can be done with it.
 *
 * Every figure is a read. The units and the note's verdict on this account come
 * from the market's position route, which reads the note itself, so a unit that
 * arrived by transfer is counted; what was subscribed comes from the series
 * view; what has been earned comes from the coupon history and is absent rather
 * than nought where nothing has settled.
 */
function Holding({ holding }: { holding: BoardHolding }) {
  const offer = holding.offers[0] ?? null;
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-hairline p-5">
      <div className="flex items-start justify-between gap-4">
        <span className="flex flex-col gap-0.5">
          <a
            className="inline-flex min-h-11 w-fit items-center gap-1 text-body font-medium text-ink underline-offset-[3px] hover:underline"
            href={`/invest?series=${encodeURIComponent(holding.seriesId)}`}
          >
            {holding.name ?? holding.seriesId}
            <ChevronRight className="shrink-0 text-ink-3" />
          </a>
          <span className="text-caption tabular-nums text-ink-2">{holding.seriesId}</span>
        </span>
        <span className="flex flex-col items-end">
          <span className="font-display text-title font-semibold tracking-title tabular-nums text-ink">
            {holding.units}
          </span>
          <span className="text-caption text-ink-2">
            {Number(holding.units) === 1 ? 'note' : 'notes'}
          </span>
        </span>
      </div>

      <SurfaceGroup>
        {holding.subscription === null ? null : (
          <ListRow
            label="Subscribed"
            value={formatWholeMoney(
              holding.subscription.amount,
              holding.subscription.decimals,
            )}
          />
        )}
        {/* Nothing settled is not nought: fifteen of the sixteen notes have
            paid no coupon at all, and a 0.00 here would read as a note that
            pays nothing rather than as one that has not paid yet. */}
        {holding.earned === null ? null : (
          <ListRow label="Earned" value={holding.earned.amount} />
        )}
        {offer === null ? null : (
          <ListRow
            caption={`Offered ${formatDayWithYear(isoDay(offer.opened_at))}`}
            label="On the market"
            value={`${offer.units_whole} at ${formatWholeMoney(
              BigInt(offer.price_per_unit.amount),
              offer.price_per_unit.decimals,
            )}`}
          />
        )}
      </SurfaceGroup>

      <div className="flex flex-wrap items-center gap-4">
        {offer === null ? null : <WithdrawButton back="board" offer={offer} />}
        <SellNotes
          back="board"
          compact={offer !== null}
          seriesId={holding.seriesId}
          units={holding.units}
        />
      </div>
    </div>
  );
}

/** The board itself. Five columns fold away below the landing breakpoint. */
function MarketTable({
  direction,
  rows,
  sort,
}: {
  direction: MarketDirection;
  rows: readonly MarketRow[];
  sort: MarketSort;
}) {
  return (
    /* Seven columns are a desktop table. A 390 column is 350px of readable
       width and the three figures the board exists for do not fit it as three
       columns: the risk pill is 132px and will not wrap, because its words are
       `rankByDistance`'s and not this screen's to shorten, and the premium
       heading is 130px, which leaves under 90px for an occupation name. Four
       columns was 590px in a 350px region, so a phone got the occupation and
       the risk, the premium rate began past the cut with nothing to say it was
       there, and the board read as a worse /index.

       So below the landing breakpoint the board is two columns and the risk
       moves into the first one, under the name, where the sheet already puts a
       caption under a label. The comparison the board is for, which occupation,
       how near its line, what its cover costs, is then on one row with no
       sideways scroll at all. The identifier folds away with it: it is a
       nowrap 151px that set the first column's floor, and the same vault link
       is on the series' own page, one tap from the name. Sorting by the risk
       column goes with the column; the board still opens in risk order, and
       what a phone gains is the premium rate heading, which was sortable
       before but off the screen. */
    <div aria-label="Occupations" className="overflow-x-auto" role="region" tabIndex={0}>
      <table className="w-full border-collapse text-body lg:min-w-[60rem]">
        <caption className="sr-only">
          Every series on Hedera testnet, with what it pays and how near its index is to a payout
        </caption>
        <thead>
          <tr className="border-b border-hairline">
            <SortableTh column="name" direction={direction} sort={sort}>
              Occupation
            </SortableTh>
            <SortableTh column="risk" direction={direction} sort={sort} wide>
              Index
            </SortableTh>
            <SortableTh column="premium" direction={direction} numeric sort={sort}>
              Premium rate
            </SortableTh>
            {/* Not sortable, because there is no one number in it to sort by.
                It is a shape, and the two columns either side of it are the
                figures a person orders a board by. */}
            <Th wide>Rate history</Th>
            <SortableTh column="capacity" direction={direction} numeric sort={sort} wide>
              Capacity
            </SortableTh>
            <SortableTh column="principal" direction={direction} numeric sort={sort} wide>
              Principal
            </SortableTh>
            <SortableTh column="coupon" direction={direction} numeric sort={sort} wide>
              Coupon
            </SortableTh>
            <SortableTh column="traded" direction={direction} numeric sort={sort} wide>
              Last traded
            </SortableTh>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-b border-hairline" key={row.seriesId}>
              <Td>
                <SeriesName row={row} />
              </Td>
              <Td wide>
                <Risk row={row} />
              </Td>
              <Td numeric>
                <Premium row={row} />
              </Td>
              <Td wide>
                <Sparkline row={row} />
              </Td>
              <Td numeric wide>
                {row.capacityPercent === null ? null : formatPercent(row.capacityPercent)}
              </Td>
              <Td numeric wide>
                <Principal row={row} />
              </Td>
              <Td numeric wide>
                {row.couponPercent === null ? null : formatPercent(row.couponPercent)}
              </Td>
              <Td numeric wide>
                <Traded row={row} />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What cover on this occupation costs a year.
 *
 * One figure where every funded band prices the same, which is every series
 * capital has not split. Where it has split one, the cell is the range those
 * bands are quoted at, because the series as a whole is then priced at a rate
 * no policy sells at: the reasoning is on `premiumRange`.
 *
 * The range is a figure and a caption rather than one line reading "6.26 to
 * 9.39 percent". The board's own principal cell already stacks a figure over
 * the fact that qualifies it, this column is on the screen at every width, and
 * a one line range is half as wide again as the heading over it.
 */
function Premium({ row }: { row: MarketRow }) {
  if (row.premiumPercent === null) return null;
  return (
    <span className="flex flex-col gap-0.5">
      <span>{formatPercent(row.premiumPercent)}</span>
      {row.premiumTopPercent === null ? null : (
        <span className="text-caption text-ink-2">to {formatPercent(row.premiumTopPercent)}</span>
      )}
    </span>
  );
}

/**
 * The principal behind the series, and what is left of it standing behind the
 * cover.
 *
 * The two were columns of their own until the market gave the board something
 * to say. Claims have taken nothing from fifteen of the sixteen, so a column of
 * noughts was buying a seventh of the width to say almost nothing; as a caption
 * it renders only where there is something to report.
 *
 * What the caption says changed with the capacity column beside it. Capacity is
 * exposure over the principal still standing, which is what the CoverPool
 * itself measures it against, so on the one series that has paid a claim the
 * percentage is a share of 97,000 while this cell said 100,000 and nothing said
 * where the difference went. Now it does, in the series page's own words.
 */
function Principal({ row }: { row: MarketRow }) {
  if (row.funded === null) return null;
  const paid = row.paid === null || row.paid === 0n ? null : row.paid;
  return (
    <span className="flex flex-col gap-0.5">
      <span>{formatWholeMoney(row.funded, row.decimals)}</span>
      {paid === null ? null : (
        <span className="text-caption text-ink-2">
          {formatWholeMoney(paid, row.decimals)} paid out
          {row.remaining === null
            ? null
            : `, ${formatWholeMoney(row.remaining, row.decimals)} left`}
        </span>
      )}
    </span>
  );
}

/**
 * What a note of this series last changed hands for, and what it can be bought
 * for now.
 *
 * A filled offer is the only record of what a unit was worth to somebody, which
 * is why the book is read with its fills and not only its open side. The
 * caption is the live half: an offer standing today, at a price a person can
 * act on by opening the series. A series nobody has ever traded carries neither
 * and the cell is empty, because there is no price to print.
 */
function Traded({ row }: { row: MarketRow }) {
  const quote = row.quote;
  if (quote === null || (quote.lastTraded === null && quote.bestAsk === null)) return null;
  return (
    <span className="flex flex-col gap-0.5">
      {/* No figure where nothing has traded. A series with an offer standing on
          it and no fill behind it has a price somebody is asking and not a
          price anybody has paid, and the two are not the same number. */}
      {quote.lastTraded === null ? null : (
        <span>{formatWholeMoney(BigInt(quote.lastTraded.amount), quote.lastTraded.decimals)}</span>
      )}
      {quote.bestAsk === null ? null : (
        <span className="text-caption whitespace-nowrap text-ink-2">
          {quote.unitsForSale} for sale at{' '}
          {formatWholeMoney(BigInt(quote.bestAsk.amount), quote.bestAsk.decimals)}
        </span>
      )}
    </span>
  );
}

/**
 * Five years of the occupation's guide rate, in one cell.
 *
 * The row said what the risk costs today and nothing about how it got there,
 * which is the comparison a person came to a board of sixteen to make. The
 * line is the published index put through the product's own pricing, month by
 * month, and it is the guide rate alone: what the market rate beside it was in
 * a past month is not recorded anywhere, so it is not drawn. See `rateHistory`
 * in src/lib/investor-model.ts.
 *
 * Every row is drawn against the whole range a guide rate can take, which is
 * the ruler the series pages use too, so a flat line means an occupation that
 * stayed where it was rather than one scaled to look busy. Its own high and
 * low are in the accessible name, because the shape is the whole of what the
 * cell shows and a shape cannot be read aloud.
 */
function Sparkline({ row }: { row: MarketRow }) {
  if (row.rates.length === 0) return null;
  const caption = rateRangeCaption(rateRange([row.rates]));
  return (
    <span className="block h-5 w-18">
      <RateChart
        height={20}
        high={RATE_BOUNDS.high}
        label={caption === null ? 'Risk charge over five years' : `Risk charge, ${caption}`}
        low={RATE_BOUNDS.low}
        points={row.rates}
        strokeWidth={1.25}
        width={72}
      />
    </span>
  );
}

/**
 * The occupation, and under it the identifier, or below the landing breakpoint
 * the risk.
 *
 * The name opens the series' own page, which is the detail view this board is
 * the index to. The identifier opens this series' own note contract on
 * HashScan, which is the one contract on the chain that is this series and
 * nothing else. It used to open the vault, and the vault is shared: sixteen
 * identifiers were sixteen links to one page, under a sentence promising
 * contract by contract. The vault and the pool are still a click away, named
 * once each in the provenance block under the table, which is where a thing
 * every row shares belongs.
 *
 * On a phone the second line is the risk pill instead. The reasoning is on
 * `MarketTable`: three figures do not fit 350px as three columns, the risk and
 * the premium rate are the pair the board exists to compare, and an occupation
 * is better served by its state than by an identifier no one reads aloud. Only
 * one of the two pills is in the tree at a given width, so nothing is announced
 * twice.
 */
function SeriesName({ row }: { row: MarketRow }) {
  return (
    <span className="flex flex-col gap-0.5">
      {/* The chevron is the sheet's own mark for a row that opens something,
          which is what a list row carries. Without it nothing on a board of
          plain text says that a name is a door, and sixteen underlined names
          would be the only other way to say it. */}
      {/* `min-h-11` is the sheet's tap minimum. A long occupation wraps past it
          on its own; a one word one like Legal is twenty four pixels of link in
          a row a thumb is aiming at. */}
      <a
        className="inline-flex min-h-11 w-fit items-center gap-1 text-body text-ink underline-offset-[3px] hover:underline"
        href={`/invest?series=${encodeURIComponent(row.seriesId)}`}
      >
        {row.name ?? row.seriesId}
        <ChevronRight className="shrink-0 text-ink-3" />
      </a>
      {/* `empty:hidden` rather than a second copy of `Risk`'s own guard: a row
          with no reading behind it draws no pill and must not leave a gap in
          the column where one would have been. */}
      <span className="empty:hidden lg:hidden">
        <Risk row={row} />
      </span>
      {row.noteHashscan === null ? (
        <span className="hidden text-caption tabular-nums whitespace-nowrap text-ink-2 lg:block">
          {row.seriesId}
        </span>
      ) : (
        <a
          className="hidden w-fit text-caption tabular-nums whitespace-nowrap text-ink-2 underline-offset-[3px] hover:underline lg:block"
          href={row.noteHashscan}
          rel="noreferrer"
          target="_blank"
        >
          {row.seriesId}
        </a>
      )}
    </span>
  );
}

/** The state colour a pill draws, as the public explorer maps it. */
const PILL: Record<ExplorerState, 'covered' | 'watch' | 'triggered'> = {
  covered: 'covered',
  watch: 'watch',
  open: 'triggered',
};

/**
 * How near the occupation is to a payout.
 *
 * Not a word of this is written here. The phrase is `rankByDistance`'s own gap,
 * which is the one place in the product that decides what a distance is called,
 * and the dot is the state that ranking put the row in. Sixteen rows is too
 * many for a pill and a sentence each, so the pill carries the figure and the
 * colour carries the state, with the state spelled out for anyone who is not
 * reading the colour.
 *
 * A series that covers no occupation has no reading behind it and so no cell.
 */
function Risk({ row }: { row: MarketRow }) {
  if (row.state === null || row.gap === null) return null;
  const word = stateWord(row.state).toLowerCase();
  return (
    <span className="whitespace-nowrap">
      <StatusPill state={PILL[row.state]}>
        {row.gap}
        {word === row.gap ? null : <span className="sr-only">, {word}</span>}
      </StatusPill>
    </span>
  );
}

function Th({
  children,
  numeric = false,
  wide = false,
  ...rest
}: {
  children: ReactNode;
  numeric?: boolean;
  wide?: boolean;
  'aria-sort'?: 'ascending' | 'descending' | 'none';
}) {
  return (
    <th
      className={[
        'h-10 px-4 text-secondary font-normal text-ink-2 first:pl-0 last:pr-0',
        numeric ? 'text-right tabular-nums whitespace-nowrap' : 'text-left',
        wide ? 'hidden lg:table-cell' : undefined,
      ]
        .filter(Boolean)
        .join(' ')}
      scope="col"
      {...rest}
    >
      {children}
    </th>
  );
}

/**
 * A column heading that puts the board in order by its own column.
 *
 * A link and not a button, because the order is in the address: the server
 * sorts, a sorted board can be sent to somebody, and nothing waits on
 * JavaScript. Pressing the column the board is already in order by turns it
 * round, and `aria-sort` says which column that is.
 */
function SortableTh({
  children,
  column,
  direction,
  numeric = false,
  sort,
  wide = false,
}: {
  children: ReactNode;
  column: MarketSort;
  direction: MarketDirection;
  numeric?: boolean;
  sort: MarketSort;
  wide?: boolean;
}) {
  const active = column === sort;
  const next = nextDirection(column, sort, direction);
  return (
    <Th
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      numeric={numeric}
      wide={wide}
    >
      <a
        className={[
          // The heading is a control, so it takes the tap minimum as well.
          'inline-flex min-h-11 items-center gap-1 underline-offset-[3px] hover:underline',
          active ? 'text-ink' : undefined,
          numeric ? 'flex-row-reverse' : undefined,
        ]
          .filter(Boolean)
          .join(' ')}
        href={`/invest?sort=${column}&dir=${next}`}
      >
        {children}
        {/* The mark is on the column the board is in order by and nowhere else,
            so a reader is never asked to tell seven arrows apart. */}
        {active ? (
          <ChevronRight
            className={`shrink-0 ${direction === 'asc' ? '-rotate-90' : 'rotate-90'}`}
          />
        ) : null}
      </a>
    </Th>
  );
}

function Td({
  children,
  numeric = false,
  wide = false,
}: {
  children: ReactNode;
  numeric?: boolean;
  wide?: boolean;
}) {
  return (
    <td
      className={[
        'h-14 px-4 text-ink first:pl-0 last:pr-0',
        // A figure never wraps. "7.9 percent" broken over two lines reads as
        // two numbers and costs the row its height as well.
        numeric ? 'text-right tabular-nums whitespace-nowrap' : 'text-left',
        wide ? 'hidden lg:table-cell' : undefined,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </td>
  );
}

/**
 * Where the numbers came from, and where the same numbers can be read without
 * this page.
 *
 * It is the index explorer's provenance block for the same reason that page has
 * one: a figure a reader cannot check is a figure they have to take on trust.
 * The month, the source and the topic are what the feed itself said.
 *
 * The first line names the contracts and it is precise about which is which,
 * because it was not. It said the figures were read contract by contract and
 * that each row's identifier opened its vault, and all sixteen identifiers
 * opened the same vault, because there is one. Every word of that was true and
 * a reader who clicked two rows had been told they would see two contracts. So
 * the shared pair are named once here, with their identifiers, and a row's own
 * link is its note, which is the contract that belongs to that series alone.
 */
function Provenance({ view }: { view: BoardView }) {
  const { coverPool, provenance, vault } = view;
  const priced = view.rows.some((row) => row.premiumPercent !== null);
  return (
    <div className="mt-10 flex flex-col gap-2 border-t border-hairline pt-6 text-caption text-ink-2">
      {/* A register rather than a paragraph. Which contract is which is the
          whole of what this line has to say, and it said it in fifty five
          words that named the same two contracts in the middle of a sentence. */}
      <p>
        Every figure above is read from Hedera testnet. One collateral vault
        {vault === null ? null : (
          <>
            {', '}
            <TextLink href={vault.hashscan} rel="noreferrer" target="_blank">
              {vault.contractId}
            </TextLink>
          </>
        )}
        , one cover pool
        {coverPool === null ? null : (
          <>
            {', '}
            <TextLink href={coverPool.hashscan} rel="noreferrer" target="_blank">
              {coverPool.contractId}
            </TextLink>
          </>
        )}
        , and a note of its own for each series, which is what a row opens.
      </p>
      {provenance === null ? (
        <p>The index readings could not be read, so no row carries a risk or a premium rate.</p>
      ) : (
        <>
          <p>
            Newest published month{' '}
            <span className="tabular-nums text-ink">
              {provenance.asOf === null ? 'none' : formatPeriod(provenance.asOf)}
            </span>
            .{' '}
            {provenance.from === null || provenance.to === null
              ? null
              : `Readings run ${formatPeriodShort(provenance.from)} to ${formatPeriodShort(provenance.to)}.`}{' '}
            Source: {provenance.source}.
          </p>
          {provenance.topicId === null || provenance.hashscan === null ? null : (
            <p>
              {settledLead(provenance.published, provenance.groups, provenance.deepest)}{' '}
              <TextLink href={provenance.hashscan} rel="noreferrer" target="_blank">
                {provenance.topicId}
              </TextLink>
              , so the risk column can be checked without trusting this page.
            </p>
          )}
          {view.missing.length === 0 ? null : (
            <p>
              {String(view.missing.length)} of the fifteen occupations had no reading when this page
              was built.
            </p>
          )}
        </>
      )}
      {/* The build up used to be spelled out here in a paragraph and is drawn
          row by row on the series page, so this points at it instead. */}
      {priced ? (
        <p>
          Opening a row shows how its premium rate is built, step by step, and the rate history
          beside it is the risk charge alone, every row on one scale.{' '}
          <TextLink href="/index">How the index works</TextLink>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The board at the height it stands at once its figures are in it: the three
 * cards, then the heading row and sixteen rows of 56px, with the provenance
 * block under them. A figure landing changes what is in a space and never how
 * much space there is.
 */
function BoardResting() {
  return (
    <div className="mt-10" data-testid="board-resting">
      <Skeleton className="h-[248px] w-full" />
      <Skeleton className="mt-10 h-10 w-full" />
      <Skeleton className="mt-2 h-[896px] w-full" />
      <Skeleton className="mt-10 h-20 w-full max-w-[720px]" />
    </div>
  );
}

/**
 * The featured occupation at the height it will stand at.
 *
 * The sheet's own Skeleton is the surface colour, which on this ground would
 * be the brightest thing on the screen, so the band rests in white at twelve
 * percent, which is what the landing's own dark resting bar uses. The heights
 * are the card's and the chart's, so the band does not change height when the
 * read lands.
 */
function HeroResting() {
  return (
    <div
      className="mt-8 flex flex-col gap-8 lg:mt-12 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-stretch lg:gap-12"
      data-testid="hero-resting"
    >
      <div className="order-1 h-[248px] rounded-card bg-white/12 lg:order-2 lg:h-auto" />
      <div className="order-2 flex flex-col gap-3 lg:order-1">
        <div className="h-5 w-48 rounded-field bg-white/12" />
        <div className="h-36 w-full rounded-field bg-white/12 lg:h-56" />
        <div className="h-10 w-full max-w-[520px] rounded-field bg-white/12" />
      </div>
    </div>
  );
}
