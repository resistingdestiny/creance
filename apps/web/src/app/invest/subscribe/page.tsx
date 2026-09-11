import type { Metadata } from 'next';

import { fetchCoupons, fetchSeries, fetchSeriesList } from '../../../lib/investor-api';
import { demoInvestorAccount } from '../../../lib/wallet';
import { InvestorUnavailable } from '../unavailable';
import { SubscribeScreen } from './subscribe-screen';

/** The subscribe screen. `?series=` names one of the series GET /v1/series lists. */

export const metadata: Metadata = {
  title: 'Subscribe',
  description: 'Subscribe to a series of Displacement Bond Notes on Hedera testnet.',
  alternates: { canonical: '/invest/subscribe' },
};

export const dynamic = 'force-dynamic';

export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ series?: string }>;
}) {
  const { series: requested } = await searchParams;
  const retryHref =
    requested === undefined
      ? '/invest/subscribe'
      : `/invest/subscribe?series=${encodeURIComponent(requested)}`;

  try {
    const listing = await fetchSeriesList();
    const id = requested ?? listing.series[0]?.series_id ?? '';
    const [series, coupons] = await Promise.all([fetchSeries(id), fetchCoupons(id)]);
    return (
      <SubscribeScreen
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
