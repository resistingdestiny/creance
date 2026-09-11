import type { Metadata } from 'next';

import { fetchSeriesList, type SeriesListView } from '../../lib/investor-api';
import { readInvestor } from '../../lib/investor-data';
import { demoInvestorAccount } from '../../lib/wallet';
import { InvestorOverview } from './investor-overview';
import { InvestorUnavailable } from './unavailable';

/**
 * The investor overview.
 *
 * `?series=` names one of the series GET /v1/series lists. With none named the
 * route shows the first, which is the demo series. The list also carries the
 * short dated maturity demonstration, and being able to open it is how the
 * redemption is checked through the same screen; the label on the screen is
 * always the series' own.
 *
 * The list is the one read awaited here. It answers in under two
 * milliseconds and it decides which series the page is about, so nothing can
 * be drawn without it. The two chain reads behind the figures are not
 * awaited: src/lib/investor-data.ts starts both behind a hold and hands them
 * to the screen as promises, so the heading, the chooser and the copy are on
 * the first byte and each figure lands in its own place as it arrives (T51).
 */

export const metadata: Metadata = { title: 'Invest' };

// The principal, the reserve and the coupons are live chain state. There is
// nothing here to prerender.
export const dynamic = 'force-dynamic';

export default async function InvestPage({
  searchParams,
}: {
  searchParams: Promise<{ series?: string }>;
}) {
  const { series: requested } = await searchParams;
  const retryHref =
    requested === undefined ? '/invest' : `/invest?series=${encodeURIComponent(requested)}`;

  let listing: SeriesListView;
  try {
    listing = await fetchSeriesList();
  } catch {
    return <InvestorUnavailable retryHref={retryHref} />;
  }

  // The list decides the default, not a constant in this bundle. A series
  // the API does not serve is asked for anyway, so the endpoint answers the
  // 404 and the screen says it cannot load that series rather than silently
  // showing a different one.
  const id = requested ?? listing.series[0]?.series_id ?? '';
  const data = readInvestor(id);
  return (
    <InvestorOverview
      choices={listing.series}
      coupons={data.coupons}
      investor={demoInvestorAccount()}
      series={data.series}
      seriesId={id}
    />
  );
}
