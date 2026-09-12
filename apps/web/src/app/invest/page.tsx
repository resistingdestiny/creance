import type { Metadata } from 'next';

import { fetchSeriesList, type SeriesListView } from '../../lib/investor-api';
import { readInvestor, type InvestorData } from '../../lib/investor-data';
import {
  marketDirection,
  marketSort,
  type MarketDirection,
  type MarketSort,
} from '../../lib/investor-model';
import { demoInvestorAccount } from '../../lib/wallet';
import { readBoard } from './board-data';
import { InvestorOverview } from './investor-overview';
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
 * the principal at risk and the way in to subscribing. The board is the index
 * to it and every row links here.
 *
 * `?sort=` and `?dir=` put the board in order. They are in the address rather
 * than in a component's state because the screens are server rendered, so the
 * sort costs no client JavaScript, works before hydration and can be sent to
 * somebody. Rubbish in either falls back to the default order rather than
 * erroring: they come off a query string.
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
    'Every occupation side by side: what its cover is priced at, how near its index is to a payout, and what its note has paid. Displacement Bond Notes fund the payouts and noteholders earn the premiums as coupons.',
  alternates: { canonical: '/invest' },
};

// The principal, the reserve and the coupons are live chain state. There is
// nothing here to prerender.
export const dynamic = 'force-dynamic';

export default async function InvestPage({
  searchParams,
}: {
  searchParams: Promise<{ series?: string; sort?: string; dir?: string }>;
}) {
  const { series: requested, sort: sortParam, dir } = await searchParams;
  const retryHref =
    requested === undefined ? '/invest' : `/invest?series=${encodeURIComponent(requested)}`;

  let listing: SeriesListView;
  try {
    listing = await fetchSeriesList();
  } catch {
    return <InvestorUnavailable retryHref={retryHref} />;
  }

  const investor = demoInvestorAccount();

  if (requested === undefined) {
    const sort: MarketSort = marketSort(sortParam);
    const direction: MarketDirection = marketDirection(sort, dir);
    return (
      <MarketBoard
        board={readBoard(listing, investor)}
        direction={direction}
        investor={investor}
        sort={sort}
      />
    );
  }

  // A series the list does not carry is not asked for: the API would answer
  // 404 twice, and the id came off a query string, so a read per unknown id
  // would be a hold per string a crawler sends. The screen is handed nothing
  // for both figures and says it cannot load that series rather than silently
  // showing a different one.
  const listed = listing.series.some((entry) => entry.series_id === requested);
  const data = listed ? readInvestor(requested) : UNLISTED;
  return (
    <InvestorOverview
      choices={listing.series}
      coupons={data.coupons}
      investor={investor}
      series={data.series}
      seriesId={requested}
    />
  );
}

/** Both figures absent, which the screen renders as its two cannot-load blocks. */
const UNLISTED: InvestorData = { series: null, coupons: null };
