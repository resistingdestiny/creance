import type { Metadata } from 'next';

import { DEFAULT_SERIES_ID, fetchCoupons, fetchSeries } from '../../../lib/investor-api';
import { demoInvestorAccount } from '../../../lib/wallet';
import { InvestorUnavailable } from '../unavailable';
import { SubscribeScreen } from './subscribe-screen';

/** The subscribe screen. `?series=` names a series other than the demo one. */

export const metadata: Metadata = { title: 'Subscribe' };

export const dynamic = 'force-dynamic';

export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ series?: string }>;
}) {
  const { series: requested } = await searchParams;
  const id = requested ?? DEFAULT_SERIES_ID;
  const retryHref =
    requested === undefined
      ? '/invest/subscribe'
      : `/invest/subscribe?series=${encodeURIComponent(id)}`;

  try {
    const [series, coupons] = await Promise.all([fetchSeries(id), fetchCoupons(id)]);
    return <SubscribeScreen coupons={coupons} investor={demoInvestorAccount()} series={series} />;
  } catch {
    return <InvestorUnavailable retryHref={retryHref} />;
  }
}
