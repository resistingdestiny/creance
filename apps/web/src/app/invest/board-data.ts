/**
 * What the market board reads before it can draw a row.
 *
 * Three sources, and no fourth.
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
 * Nothing is composed that a read did not answer. A series the chain could not
 * answer for keeps its name and loses its figures; an occupation the feed had
 * no reading for keeps its figures and loses its risk; and the whole round
 * failing costs the board its risk and price columns and not the board.
 */

import { readExplorer, type ExplorerProvenance } from '../../lib/explorer-data';
import { rankByDistance, type RankedOccupation } from '../../lib/explorer-model';
import type { CouponsView, SeriesListView, SeriesView } from '../../lib/investor-api';
import { readInvestor } from '../../lib/investor-data';
import { marketRow, type MarketRow } from '../../lib/investor-model';
import type { WalletAccount } from '../../lib/wallet';

export interface BoardView {
  readonly rows: readonly MarketRow[];
  /** Where the index readings came from, or null when the round could not be had. */
  readonly provenance: ExplorerProvenance | null;
  /** Group keys the feed had no reading for, so the board can say how many. */
  readonly missing: readonly string[];
}

/**
 * Every row of the board, with its figures.
 *
 * The coupon history is read only for a series that has settled a coupon and
 * that this account holds, which today is one of the sixteen. Reading all of
 * them to find that out would be sixteen calls for fifteen empty answers, and
 * the series view already carries the count that says which is which.
 */
export async function readBoard(
  listing: SeriesListView,
  investor: WalletAccount,
): Promise<BoardView> {
  const [explorer, series] = await Promise.all([
    readExplorerRound(),
    Promise.all(listing.series.map((entry) => readInvestor(entry.series_id).series)),
  ]);

  const ranked = new Map<string, RankedOccupation>(
    (explorer === null ? [] : rankByDistance(explorer.occupations)).map((row) => [
      row.occupation.key,
      row,
    ]),
  );

  const coupons = await readSettledCoupons(listing, series, investor.evmAddress);

  return {
    rows: listing.series.map((entry, at) =>
      marketRow({
        entry,
        series: series[at] ?? null,
        ranked: ranked.get(entry.group) ?? null,
        coupons: coupons.get(entry.series_id) ?? null,
        address: investor.evmAddress,
      }),
    ),
    provenance: explorer?.provenance ?? null,
    missing: explorer?.missing ?? [],
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

async function readSettledCoupons(
  listing: SeriesListView,
  series: readonly (SeriesView | null)[],
  address: string,
): Promise<Map<string, CouponsView>> {
  const wanted = address.toLowerCase();
  const holdsAndHasPaid = listing.series.filter((entry, at) => {
    const view = series[at] ?? null;
    if (view === null || view.coupons.settled === 0) return false;
    return view.holders.some(
      (holder) => holder.address.toLowerCase() === wanted && BigInt(holder.note_balance) > 0n,
    );
  });

  const read = await Promise.all(
    holdsAndHasPaid.map(async (entry) => {
      const view = await readInvestor(entry.series_id).coupons;
      return [entry.series_id, view] as const;
    }),
  );

  return new Map(
    read.filter((pair): pair is readonly [string, CouponsView] => pair[1] !== null),
  );
}
