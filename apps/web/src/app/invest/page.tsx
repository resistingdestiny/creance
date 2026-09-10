import type { Metadata } from 'next';

import { fetchCoupons, fetchSeries, fetchSeriesList } from '../../lib/investor-api';
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

  try {
    const listing = await fetchSeriesList();
    // The list decides the default, not a constant in this bundle. A series
    // the API does not serve is asked for anyway, so the endpoint answers the
    // 404 and the screen says it cannot be reached rather than silently
    // showing a different series.
    const id = requested ?? listing.series[0]?.series_id ?? '';
    const [series, coupons] = await Promise.all([fetchSeries(id), fetchCoupons(id)]);
    return (
      <InvestorOverview
        choices={listing.series}
        coupons={coupons}
        investor={demoInvestorAccount()}
        series={series}
      />
    );
  } catch {
    return <InvestorUnavailable retryHref={retryHref} />;
  }
}
