import type { Metadata } from 'next';

import { DEFAULT_SERIES_ID, fetchCoupons, fetchSeries } from '../../lib/investor-api';
import { demoInvestorAccount } from '../../lib/wallet';
import { InvestorOverview } from './investor-overview';
import { InvestorUnavailable } from './unavailable';

/**
 * The investor overview.
 *
 * `?series=` names a series other than the demo one. The endpoint also serves
 * the short dated maturity demonstration, and being able to open it is how the
 * redemption is checked through the same screen; the demo series is what the
 * route shows by default and the label on the screen is always the series' own.
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
  const id = requested ?? DEFAULT_SERIES_ID;
  const retryHref = requested === undefined ? '/invest' : `/invest?series=${encodeURIComponent(id)}`;

  try {
    const [series, coupons] = await Promise.all([fetchSeries(id), fetchCoupons(id)]);
    return (
      <InvestorOverview coupons={coupons} investor={demoInvestorAccount()} series={series} />
    );
  } catch {
    return <InvestorUnavailable retryHref={retryHref} />;
  }
}
