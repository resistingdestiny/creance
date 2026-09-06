import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { reportUnreachable } from '../../../lib/api';

import { fetchAttribution } from '../../../lib/attribution-api';
import {
  attributionPanel,
  attributionSnapshot,
  type AttributionPanelData,
} from '../../../lib/attribution-model';

import { fetchReplay } from '../../../lib/claim-api';
import { replayBadgeLabel } from '../../../lib/claim-model';

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
 *
 * Under the index sits the attribution panel (T31). It is fetched separately
 * and its failure is not the page's failure: the index is what this screen is
 * for, and the caveats beside it are never the reason a worker cannot see their
 * own reading.
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
    const [index, replay] = await Promise.all([fetchIndex(group), fetchReplay()]);
    const attribution = await attributionFor(index.reading.period);
    const reading = headlineReading(index);
    const occupation = findOccupation(group);
    return (
      <IndexScreen
        attribution={attribution}
        bandLabel={bandLabelFor(index)}
        description={chartDescription(index)}
        distance={reading?.distance ?? null}
        months={whatWouldHaveHappened(index)}
        negativeLine={lineIsNegative(index)}
        neverOpened={occupation?.lastOpenPeriod === null}
        occupation={occupationLabel(group)}
        open={reading?.open ?? false}
        points={chartPoints(index)}
        replayBadge={replayBadgeLabel(replay)}
        sentence={reading?.detail ?? null}
        threshold={chartThreshold(index)}
      />
    );
  } catch (cause) {
    reportUnreachable('the index tab', cause);
    return <WorkerUnavailable retryHref="/cover/index" />;
  }
}

/**
 * The panel's figures, live if the feed answers and from the committed copy if
 * it does not.
 *
 * The fallback is the series this repository committed, bundled at build time.
 * It is genuinely the last published figures rather than a remembered read or a
 * placeholder, and the panel says on screen which of the two it is showing.
 * Never a zero and never an invented number: those are the only two answers
 * this function is not allowed to give.
 */
async function attributionFor(indexLatestPeriod: string | null): Promise<AttributionPanelData> {
  try {
    return attributionPanel(await fetchAttribution(), { indexLatestPeriod });
  } catch (cause) {
    reportUnreachable('the attribution panel', cause);
    return attributionPanel(attributionSnapshot(), { indexLatestPeriod, fromSnapshot: true });
  }
}
