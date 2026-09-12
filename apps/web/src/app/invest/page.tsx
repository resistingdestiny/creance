import type { Metadata } from 'next';

import {
  fetchOrderBook,
  fetchPositions,
  fetchSeriesList,
  type SeriesListView,
} from '../../lib/investor-api';
import { readInvestor, type InvestorData } from '../../lib/investor-data';
import {
  marketDirection,
  marketOutcome,
  marketSort,
  type MarketDirection,
  type MarketSort,
} from '../../lib/investor-model';
import { findOccupation } from '../../lib/occupations';
import { demoInvestorAccount, type WalletAccount } from '../../lib/wallet';
import { readBoard } from './board-data';
import { readRateHistory } from './rate-data';
import { InvestorOverview, type Market } from './investor-overview';
import { MarketBoard } from './market-board';
import { InvestorUnavailable } from './unavailable';

/**
 * The investor route, which is two screens.
 *
 * With no `?series=` it is the market board: every series GET /v1/series lists,
 * one row each, so the fifteen occupations can be compared against each other.
 * That is the decision an investor is actually making, and until the board it
 * could only be made one series at a time.
 *
 * With `?series=` it is that series on its own: the coupon receipts, the terms,
 * the principal at risk, the secondary market for its notes, and the way in to
 * subscribing. The board is the index to it and every row links here.
 *
 * `?sort=` and `?dir=` put the board in order, and `?market=` carries what a
 * trade just did. All three are in the address rather than in a component's
 * state because the screens are server rendered: the sort costs no client
 * JavaScript, the trading forms work before hydration, and a sorted board can
 * be sent to somebody. Rubbish in any of them falls back rather than erroring,
 * because they come off a query string.
 *
 * The series list is the one read awaited here. It answers in under two
 * milliseconds and it decides which of the two screens this is, so nothing can
 * be drawn without it. Everything behind the figures is handed on as a promise:
 * the heading and the chrome are on the first byte and each figure lands in its
 * own place as it arrives (T51).
 */

export const metadata: Metadata = {
  title: 'Invest',
  description:
    'Every occupation side by side: what its cover is priced at, how near its index is to a payout, what its note has paid, and what a note last changed hands for. Displacement Bond Notes fund the payouts and noteholders earn the premiums as coupons.',
  alternates: { canonical: '/invest' },
};

// The principal, the reserve, the coupons and the order book are live chain
// state. There is nothing here to prerender.
export const dynamic = 'force-dynamic';

export default async function InvestPage({
  searchParams,
}: {
  searchParams: Promise<{ series?: string; sort?: string; dir?: string; market?: string }>;
}) {
  const { series: requested, sort: sortParam, dir, market } = await searchParams;
  const retryHref =
    requested === undefined ? '/invest' : `/invest?series=${encodeURIComponent(requested)}`;

  let listing: SeriesListView;
  try {
    listing = await fetchSeriesList();
  } catch {
    return <InvestorUnavailable retryHref={retryHref} />;
  }

  const investor = demoInvestorAccount();
  const outcome = marketOutcome(market);

  if (requested === undefined) {
    const sort: MarketSort = marketSort(sortParam);
    const direction: MarketDirection = marketDirection(sort, dir);
    return (
      <MarketBoard
        board={readBoard(listing, investor)}
        direction={direction}
        investor={investor}
        outcome={outcome}
        sort={sort}
      />
    );
  }

  // A series the list does not carry is not asked for: the API would answer
  // 404 twice, and the id came off a query string, so a read per unknown id
  // would be a hold per string a crawler sends. The screen is handed nothing
  // for both figures and says it cannot load that series rather than silently
  // showing a different one.
  const listed = listing.series.find((entry) => entry.series_id === requested) ?? null;
  const data = listed === null ? UNLISTED : readInvestor(requested);
  // Whether the series covers an occupation is known from the list, before any
  // read, so the rate history section is on the page or off it from the first
  // byte and never appears or vanishes underneath a reader. The maturity
  // demonstration covers none, so it has no index and no history.
  const occupation = listed === null ? null : findOccupation(listed.group);
  return (
    <InvestorOverview
      choices={listing.series}
      coupons={data.coupons}
      investor={investor}
      market={listed === null ? null : readMarket(investor)}
      outcome={outcome}
      rates={occupation === null ? undefined : readRateHistory(occupation.key)}
      series={data.series}
      seriesId={requested}
    />
  );
}

/**
 * The order book and this account's positions, in flight and not awaited.
 *
 * Both are free and both answer in well under a second, and neither is held:
 * an order book served from a cache would offer a price that has already been
 * taken. Either failing costs the page its market section and nothing else,
 * which is what the market routes not being deployed yet looks like.
 */
function readMarket(investor: WalletAccount): Promise<Market | null> {
  return Promise.all([
    fetchOrderBook({ buyer: investor.evmAddress }).catch(() => null),
    fetchPositions(investor.evmAddress).catch(() => null),
  ]).then(([book, positions]) => (book === null ? null : { book, positions }));
}

/** Both figures absent, which the screen renders as its two cannot-load blocks. */
const UNLISTED: InvestorData = { series: null, coupons: null };
