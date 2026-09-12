/**
 * What the market board reads before it can draw a row.
 *
 * Five sources, and no sixth.
 *
 * `GET /v1/series` says which series exist. It is already awaited by the route
 * above this, because it decides whether the page is the board or one series.
 *
 * `GET /v1/series/:id` for each of them is the chain state: the principal, what
 * claims have taken, the committed exposure, the declared coupon and who holds
 * the note. These go through src/lib/investor-data.ts rather than through a
 * hold of their own, so the board and the single series view share one cache
 * per series: opening the board warms every detail page behind it and opening a
 * detail page warms its row. Sixteen of them in parallel answer in about a
 * second and a quarter against the live API, so they are made together and not
 * in a pool.
 *
 * The index readings are the round the public explorer buys, through
 * src/lib/explorer-data.ts. They are metered calls and that module holds them
 * for ten minutes across every page that wants them, so a board opened after
 * the landing page or the explorer pays nothing for its risk column. Buying a
 * second round here would have doubled the cost of the product for one screen.
 *
 * `GET /v1/market/offers` and `GET /v1/market/positions/:holder` are the
 * secondary market. Both are free and both answer in well under a second, so
 * they are read fresh on every view and never held: an order book served from a
 * cache would offer a price that has already been taken, and a position served
 * from a cache would still show units that have left the account. They are the
 * one thing on this page that must be current to the request.
 *
 * `GET /v1/cover/bands` is what capital has committed to each experience band.
 * It is one free call for all fifteen occupations, and it is here because a
 * price is quoted against a band's own utilisation and not against the series'.
 * On a series capital has split into bands, the series-level rate is a number
 * no policy sells at; see `premiumRange` in src/lib/investor-model.ts. It fails
 * to null and the board falls back to the series-level rate, which is what the
 * fourteen unsplit series quote anyway.
 *
 * Nothing is composed that a read did not answer. A series the chain could not
 * answer for keeps its name and loses its figures; an occupation the feed had
 * no reading for keeps its figures and loses its risk; the index round failing
 * costs the board its risk and price columns; the market failing costs it the
 * traded column and falls the holdings back on what each series' own holder
 * list says; and the bands failing costs a split series its range and leaves it
 * the series rate. None of the five costs the board.
 */

import { readExplorer, type ExplorerProvenance } from '../../lib/explorer-data';
import { rankByDistance, type RankedOccupation } from '../../lib/explorer-model';
import {
  fetchOrderBook,
  fetchPositions,
  type CouponsView,
  type Money,
  type OfferView,
  type OrderBookView,
  type PositionsView,
  type SeriesListView,
  type SeriesView,
} from '../../lib/investor-api';
import { readInvestor } from '../../lib/investor-data';
import {
  earnedToDate,
  marketQuotes,
  marketRow,
  seriesName,
  type EarnedToDate,
  type MarketRow,
} from '../../lib/investor-model';
import type { WalletAccount } from '../../lib/wallet';
import { fetchAllBands, type SeriesBandsView } from '../../lib/worker-api';

/**
 * One note this account holds, with everything the screen says about it.
 *
 * It is composed here rather than in the screen because it comes from three
 * reads that fail separately: the units and the note's verdict on the holder
 * from the market's position route, what was subscribed from the series view,
 * and what has been paid from the coupon history. A field none of them answered
 * is null and is a line that does not render.
 */
export interface BoardHolding {
  readonly seriesId: string;
  readonly name: string | null;
  /** Whole note units held. */
  readonly units: string;
  /** What was subscribed for them, where a series view could be read. */
  readonly subscription: { readonly amount: bigint; readonly decimals: number } | null;
  readonly earned: EarnedToDate | null;
  /** Whether the note's own register has approved this account. Null where unread. */
  readonly kycGranted: boolean | null;
  /** This account's own open offers on the series. */
  readonly offers: readonly OfferView[];
}

/** A contract every row shares, as the board names and links it. */
export interface BoardContract {
  readonly contractId: string;
  readonly hashscan: string;
}

/**
 * One lot of notes somebody is offering to sell, as the board lists it.
 *
 * The board had a secondary market and no way to find it: the only sign of one
 * was a caption in the last column of a row, which folds away below the landing
 * breakpoint, so on a phone the venue did not exist and on a desktop it was a
 * line of small type in the corner of one row out of sixteen. These are the
 * open offers, named and priced, above the table.
 */
export interface BoardOffer {
  readonly offerId: string;
  readonly seriesId: string;
  readonly name: string | null;
  /** Whole note units in the lot. */
  readonly units: string;
  readonly pricePerUnit: Money;
  readonly total: Money;
}

export interface BoardView {
  readonly rows: readonly MarketRow[];
  /** Where the index readings came from, or null when the round could not be had. */
  readonly provenance: ExplorerProvenance | null;
  /** Group keys the feed had no reading for, so the board can say how many. */
  readonly missing: readonly string[];
  readonly holdings: readonly BoardHolding[];
  /** Every lot on offer now, cheapest a unit first. Empty where nothing is. */
  readonly forSale: readonly BoardOffer[];
  /** What this account can settle a purchase with, from the market read. */
  readonly settlementBalance: Money | null;
  /**
   * The one collateral vault the principal of every series sits in, and the one
   * cover pool that holds their exposure, where every series that answered
   * named the same contract. Null where they did not, because the sentence the
   * board writes beside these says there is one of each and it must not say so
   * on a deployment where there is more than one.
   */
  readonly vault: BoardContract | null;
  readonly coverPool: BoardContract | null;
  /** The venue itself, so the board can point at the contract the offers live in. */
  readonly market: OrderBookView['market'];
  /** How many offers have ever been made, filled and withdrawn. */
  readonly counts: OrderBookView['counts'] | null;
}

export async function readBoard(
  listing: SeriesListView,
  investor: WalletAccount,
): Promise<BoardView> {
  const [explorer, series, book, positions, bands] = await Promise.all([
    readExplorerRound(),
    Promise.all(listing.series.map((entry) => readInvestor(entry.series_id).series)),
    readBook(investor.evmAddress),
    readHoldings(investor.evmAddress),
    readBands(),
  ]);

  const ranked = new Map<string, RankedOccupation>(
    (explorer === null ? [] : rankByDistance(explorer.occupations)).map((row) => [
      row.occupation.key,
      row,
    ]),
  );
  const quotes = marketQuotes(book);

  const rows = listing.series.map((entry, at) =>
    marketRow({
      entry,
      series: series[at] ?? null,
      ranked: ranked.get(entry.group) ?? null,
      coupons: null,
      quote: quotes.get(entry.series_id) ?? null,
      bands: bands.get(entry.series_id) ?? null,
      address: investor.evmAddress,
    }),
  );

  return {
    rows,
    provenance: explorer?.provenance ?? null,
    missing: explorer?.missing ?? [],
    holdings: await holdingsOf(listing, series, rows, positions, book, investor.evmAddress),
    forSale: offersForSale(listing, book),
    vault: sharedContract(series, (view) =>
      view.vault.contract_id === null
        ? null
        : { contractId: view.vault.contract_id, hashscan: view.vault.hashscan },
    ),
    coverPool: sharedContract(series, (view) =>
      view.cover_pool === null ||
      !view.cover_pool.registered ||
      view.cover_pool.contract_id === null
        ? null
        : { contractId: view.cover_pool.contract_id, hashscan: view.cover_pool.hashscan },
    ),
    settlementBalance: positions?.settlement_balance ?? null,
    market: book?.market ?? null,
    counts: book?.counts ?? null,
  };
}

/**
 * The explorer's round, or null.
 *
 * `readExplorer` already answers with a `missing` list rather than throwing
 * when one occupation's reading cannot be had. It throws only when the round
 * itself cannot be bought, and a board with no risk column is still a board, so
 * that is caught here rather than taken up to the route.
 */
async function readExplorerRound(): Promise<Awaited<ReturnType<typeof readExplorer>> | null> {
  try {
    return await readExplorer();
  } catch {
    return null;
  }
}

/** The whole book, every status, with this account's eligibility on each offer. */
async function readBook(address: string): Promise<OrderBookView | null> {
  try {
    return await fetchOrderBook({ buyer: address });
  } catch {
    return null;
  }
}

/**
 * Every lot standing open on the venue, cheapest a unit first.
 *
 * From the book the board already reads, so it costs no further call. An offer
 * the book cannot attribute to a listed series is left out rather than shown
 * under its identifier: a row a reader cannot open is a row that only raises a
 * question.
 */
function offersForSale(listing: SeriesListView, book: OrderBookView | null): readonly BoardOffer[] {
  if (book === null) return [];
  return book.offers
    .filter((offer) => offer.status === 'open' && offer.series_id !== null)
    .flatMap((offer) => {
      const entry = listing.series.find((one) => one.series_id === offer.series_id);
      if (entry === undefined) return [];
      return [
        {
          offerId: offer.offer_id,
          seriesId: entry.series_id,
          name: seriesName(entry),
          units: offer.units_whole,
          pricePerUnit: offer.price_per_unit,
          total: offer.price,
        },
      ];
    })
    .sort((left, right) =>
      BigInt(left.pricePerUnit.amount) < BigInt(right.pricePerUnit.amount) ? -1 : 1,
    );
}

/**
 * A contract named identically by every series that answered, or null.
 *
 * It is derived and not assumed. This deployment puts all sixteen series in one
 * CollateralVault and one CoverPool, which is the whole reason the board can
 * name them once instead of sixteen times, but a deployment that did not would
 * make that sentence false. So the agreement is checked, and where the reads
 * disagree the board says nothing rather than naming the first one it saw.
 *
 * A series with nothing to say is not a disagreement. The maturity
 * demonstration has never registered with the CoverPool, so it names no pool at
 * all, and counting that as a second answer would have cost the other fifteen
 * their link.
 */
function sharedContract(
  series: readonly (SeriesView | null)[],
  pick: (view: SeriesView) => BoardContract | null,
): BoardContract | null {
  const found = series.flatMap((view) => {
    const one = view === null ? null : pick(view);
    return one === null ? [] : [one];
  });
  const first = found[0] ?? null;
  if (first === null) return null;
  return found.every((one) => one.contractId === first.contractId) ? first : null;
}

/**
 * What capital has committed to each band, by series id.
 *
 * An empty map where the read failed, which every caller treats as no band
 * split rather than as no capital: the row then quotes the series-level rate it
 * quoted before, which is the right answer for every series capital has not
 * split and the closest honest one for the series it has.
 */
async function readBands(): Promise<ReadonlyMap<string, SeriesBandsView>> {
  try {
    const { occupations } = await fetchAllBands();
    return new Map(occupations.map((occupation) => [occupation.series_id, occupation]));
  } catch {
    return new Map();
  }
}

async function readHoldings(address: string): Promise<PositionsView | null> {
  try {
    return await fetchPositions(address);
  } catch {
    return null;
  }
}

/**
 * What this account holds.
 *
 * The market's position route is the source where it answered: it reads each
 * note's balance and its register directly, so it sees a unit that arrived by
 * transfer, which a series' own configured holder list does not. Where it could
 * not be read the holdings fall back on that holder list, which is the same
 * chain state seen from the other end and is what the board showed before there
 * was a market at all.
 *
 * The coupon history is read only for a note that has settled a coupon, which
 * the series view already says. Reading all sixteen to find that out would be
 * sixteen calls for fifteen empty answers.
 */
async function holdingsOf(
  listing: SeriesListView,
  series: readonly (SeriesView | null)[],
  rows: readonly MarketRow[],
  positions: PositionsView | null,
  book: OrderBookView | null,
  address: string,
): Promise<readonly BoardHolding[]> {
  interface Held {
    readonly seriesId: string;
    readonly units: string;
    readonly kycGranted: boolean | null;
  }

  const held: readonly Held[] =
    positions === null
      ? rows.flatMap((row) =>
          row.position === null
            ? []
            : [{ seriesId: row.seriesId, units: row.position.units, kycGranted: null }],
        )
      : positions.positions.map((position) => ({
          seriesId: position.series_id,
          units: position.units_whole,
          kycGranted: position.kyc.granted,
        }));

  const viewOf = (id: string): SeriesView | null => {
    const at = listing.series.findIndex((entry) => entry.series_id === id);
    return at === -1 ? null : (series[at] ?? null);
  };

  const coupons = new Map<string, CouponsView>(
    (
      await Promise.all(
        held
          .filter((holding) => (viewOf(holding.seriesId)?.coupons.settled ?? 0) > 0)
          .map(async (holding) => {
            const view = await readInvestor(holding.seriesId).coupons;
            return [holding.seriesId, view] as const;
          }),
      )
    ).filter((pair): pair is readonly [string, CouponsView] => pair[1] !== null),
  );

  const wanted = address.toLowerCase();
  return held.map((holding): BoardHolding => {
    const view = viewOf(holding.seriesId);
    const entry = listing.series.find((row) => row.series_id === holding.seriesId) ?? null;
    const history = coupons.get(holding.seriesId) ?? null;
    const subscription =
      view === null
        ? null
        : (view.holders.find((row) => row.address.toLowerCase() === wanted)?.subscription ?? null);

    return {
      seriesId: holding.seriesId,
      name: entry === null ? null : seriesName(entry),
      units: holding.units,
      subscription:
        subscription === null
          ? null
          : { amount: BigInt(subscription.amount), decimals: subscription.decimals },
      earned: history === null ? null : earnedToDate(history, address),
      kycGranted: holding.kycGranted,
      offers:
        book === null
          ? []
          : book.offers.filter(
              (offer) =>
                offer.status === 'open' &&
                offer.series_id === holding.seriesId &&
                offer.seller.address.toLowerCase() === wanted,
            ),
    };
  });
}
