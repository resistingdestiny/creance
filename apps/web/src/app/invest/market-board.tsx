import { Suspense, use, type ReactNode } from 'react';

import { ChevronRight } from '../../components/icons';
import { DesktopFrame } from '../../components/desktop-frame';
import { Skeleton } from '../../components/skeleton';
import { StatusPill } from '../../components/status-pill';
import { SurfaceGroup } from '../../components/surface-group';
import { ListRow } from '../../components/list-row';
import { TextLink } from '../../components/text-link';
import { stateWord, type ExplorerState } from '../../lib/explorer-model';
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
  sortMarketRows,
  type MarketDirection,
  type MarketOutcome,
  type MarketRow,
  type MarketSort,
} from '../../lib/investor-model';
import { DEMO_WALLET_LABEL, type WalletAccount } from '../../lib/wallet';
import type { BoardHolding, BoardView } from './board-data';
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
 * above the table, which is this account's own holdings read off the note, and
 * a row's own detail page below it.
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
      <header className="flex flex-col gap-1 border-b border-hairline pb-6">
        <h1 className="text-title font-display font-semibold tracking-title text-ink lg:text-landing-head lg:tracking-display">
          Occupations
        </h1>
        <p className="text-body text-ink-2">{BOARD_LINE}</p>
      </header>

      {outcome === null ? null : <MarketOutcomeBanner outcome={outcome} />}

      <Suspense fallback={<BoardResting />}>
        <Board board={board} direction={direction} investor={investor} sort={sort} />
      </Suspense>
    </DesktopFrame>
  );
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
      {view.holdings.length === 0 ? null : <Positions investor={investor} view={view} />}
      <section className="mt-10">
        <h2 className="mb-4 text-body-lg font-medium text-ink">All occupations</h2>
        <MarketTable direction={direction} rows={rows} sort={sort} />
      </section>
      <Provenance view={view} />
    </>
  );
}

/**
 * What this account holds, and what it can do with it.
 *
 * It stands above the board because a person who already has a position reads
 * it first, and because this is where a secondary market belongs: an offer is
 * made against a holding, and the holdings are here.
 *
 * These are blocks and not a table, which is the opposite of the decision the
 * board itself makes twenty lines down, and for the opposite reason. The board
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
            className="inline-flex w-fit items-center gap-1 text-body font-medium text-ink underline-offset-[3px] hover:underline"
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

/** The board itself. Four columns fold away below the landing breakpoint. */
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
    /* Seven columns are a desktop table. At 390 the four that say how a series
       is funded fold away and the three that make the comparison stay: which
       occupation, how near its line, what its cover costs. The rest is on the
       series' own page. What is left still does not quite fit a 390 column, so
       the table keeps its shape and the region scrolls, as the coupon history
       does, and it is focusable so a keyboard reaches the scroll as well as
       the links inside it. */
    <div aria-label="Occupations" className="overflow-x-auto" role="region" tabIndex={0}>
      <table className="w-full min-w-[27rem] border-collapse text-body lg:min-w-[60rem]">
        <caption className="sr-only">
          Every series on Hedera testnet, with what it pays and how near its index is to a payout
        </caption>
        <thead>
          <tr className="border-b border-hairline">
            <SortableTh column="name" direction={direction} sort={sort}>
              Occupation
            </SortableTh>
            <SortableTh column="risk" direction={direction} sort={sort}>
              Index
            </SortableTh>
            <SortableTh column="premium" direction={direction} numeric sort={sort}>
              Premium rate
            </SortableTh>
            <SortableTh column="capacity" direction={direction} numeric sort={sort} wide>
              Capacity
            </SortableTh>
            <SortableTh column="principal" direction={direction} numeric sort={sort} wide>
              Principal
            </SortableTh>
            <SortableTh column="coupon" direction={direction} numeric sort={sort} wide>
              Coupon
            </SortableTh>
            <SortableTh column="traded" direction={direction} numeric sort={sort}>
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
              <Td>
                <Risk row={row} />
              </Td>
              <Td numeric>
                {row.premiumPercent === null ? null : formatPercent(row.premiumPercent)}
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
              <Td numeric>
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
 * The principal behind the series, and what claims have already taken out of it.
 *
 * The two were columns of their own until the market gave the board something
 * to say. Claims have taken nothing from fifteen of the sixteen, so a column of
 * noughts was buying a seventh of the width to say almost nothing; as a caption
 * it renders only where there is something to report.
 */
function Principal({ row }: { row: MarketRow }) {
  if (row.funded === null) return null;
  return (
    <span className="flex flex-col gap-0.5">
      <span>{formatWholeMoney(row.funded, row.decimals)}</span>
      {row.paid === null || row.paid === 0n ? null : (
        <span className="text-caption text-ink-2">
          {formatWholeMoney(row.paid, row.decimals)} paid out
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
 * The occupation, and the identifier under it.
 *
 * The name opens the series' own page, which is the detail view this board is
 * the index to. The identifier opens the vault on HashScan, so every figure on
 * the row can be read off the chain without trusting this page: that is what
 * the public explorer's provenance block does for the index, and a board of
 * money deserves the same.
 */
function SeriesName({ row }: { row: MarketRow }) {
  return (
    <span className="flex flex-col gap-0.5">
      {/* The chevron is the sheet's own mark for a row that opens something,
          which is what a list row carries. Without it nothing on a board of
          plain text says that a name is a door, and sixteen underlined names
          would be the only other way to say it. */}
      <a
        className="inline-flex w-fit items-center gap-1 text-body text-ink underline-offset-[3px] hover:underline"
        href={`/invest?series=${encodeURIComponent(row.seriesId)}`}
      >
        {row.name ?? row.seriesId}
        <ChevronRight className="shrink-0 text-ink-3" />
      </a>
      {row.hashscan === null ? (
        <span className="text-caption tabular-nums whitespace-nowrap text-ink-2">
          {row.seriesId}
        </span>
      ) : (
        <a
          className="w-fit text-caption tabular-nums whitespace-nowrap text-ink-2 underline-offset-[3px] hover:underline"
          href={row.hashscan}
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
          'inline-flex items-center gap-1 underline-offset-[3px] hover:underline',
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
 * The month, the source and the topic are what the feed itself said, and the
 * per row link to each vault on HashScan is in the rows above.
 */
function Provenance({ view }: { view: BoardView }) {
  const { provenance } = view;
  const priced = view.rows.some((row) => row.premiumPercent !== null);
  return (
    <div className="mt-10 flex flex-col gap-2 border-t border-hairline pt-6 text-caption text-ink-2">
      <p>
        The principal, the exposure, the coupons and every holding above are read from Hedera
        testnet, contract by contract. Each row&apos;s identifier opens its vault on HashScan.
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
              Every month is settled on Hedera topic{' '}
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
      {priced ? (
        <p>
          The premium rate is the published pricing applied to each occupation&apos;s newest reading
          and its own committed exposure, the same formula that prices a policy.{' '}
          <TextLink href="/index">How the index works</TextLink>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The board at the height it stands at once its figures are in it: the heading
 * row and sixteen rows of 56px, with the provenance block under them. A figure
 * landing changes what is in a space and never how much space there is.
 */
function BoardResting() {
  return (
    <div className="mt-10" data-testid="board-resting">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="mt-2 h-[896px] w-full" />
      <Skeleton className="mt-10 h-20 w-full max-w-[720px]" />
    </div>
  );
}
