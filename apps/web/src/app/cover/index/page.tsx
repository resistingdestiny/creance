import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { findOccupation, occupationLabel } from '../../../lib/occupations';
import { readPurchase } from '../../../lib/purchase-session';
import { fetchIndex, fetchPolicy } from '../../../lib/worker-api';
import {
  bandLabelFor,
  chartDescription,
  chartPoints,
  chartThreshold,
  headlineReading,
  lineIsNegative,
  whatWouldHaveHappened,
} from '../../../lib/worker-model';
import { IndexScreen } from './index-screen';
import { WorkerUnavailable } from '../../unavailable';

/**
 * The app's Index tab, docs/DESIGN-TOKENS.md section 8 and the addendum's
 * "Index screen, second explanation block".
 *
 * It is the worker's screen and shows one chart: the form the headline names,
 * with its own band. A second chart on a phone is where a person stops reading.
 *
 * The occupation is the one the purchase is for, or the one the policy covers.
 * `?group=` opens another, which is how the fourteen occupations with no series
 * behind them can still be read.
 */

export const metadata: Metadata = { title: 'Index' };

export const dynamic = 'force-dynamic';

export default async function CoverIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const { group: requested } = await searchParams;
  const session = await readPurchase();
  let group = requested ?? session?.group ?? null;
  if (group === null && session?.policyId) {
    try {
      group = (await fetchPolicy(session.policyId)).group;
    } catch {
      group = null;
    }
  }
  if (group === null || findOccupation(group) === null) redirect('/');

  try {
    const index = await fetchIndex(group);
    const reading = headlineReading(index);
    const occupation = findOccupation(group);
    return (
      <IndexScreen
        bandLabel={bandLabelFor(index)}
        description={chartDescription(index)}
        distance={reading?.distance ?? null}
        months={whatWouldHaveHappened(index)}
        negativeLine={lineIsNegative(index)}
        neverOpened={occupation?.lastOpenPeriod === null}
        occupation={occupationLabel(group)}
        open={reading?.open ?? false}
        points={chartPoints(index)}
        sentence={reading === null ? null : `${reading.trend}. ${reading.caption}`}
        threshold={chartThreshold(index)}
      />
    );
  } catch {
    return <WorkerUnavailable retryHref="/cover/index" />;
  }
}
