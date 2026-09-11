import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AttributionPanel } from '../../components/attribution-panel';
import { Skeleton } from '../../components/skeleton';
import { reportUnreachable } from '../../lib/api';
import { fetchAttribution } from '../../lib/attribution-api';
import {
  attributionPanel,
  attributionSnapshot,
  type AttributionPanelData,
} from '../../lib/attribution-model';
import { readExplorer } from '../../lib/explorer-data';
import { ExplorerScreen } from './explorer-screen';

/**
 * `/index`, the public page of record for the Occupation Displacement Index.
 *
 * It has a route of its own rather than sharing the worker's Index tab, because
 * the two are different pages for different readers: `/cover/index` is one
 * occupation for the person whose cover depends on it, inside the app frame and
 * behind the tab bar, and this is all fifteen for anyone at all. The tab is
 * unchanged and still answers `?group=`. Recorded in docs/DECISIONS.md.
 *
 * The reads are metered, so they are made on the server and cached for the
 * interval src/lib/explorer-data.ts sets. Nothing on this page is a fixture and
 * nothing is remembered from an earlier month: if the feed cannot be read, the
 * page says so rather than showing figures it cannot stand behind.
 *
 * The attribution panel under it is fetched on its own path, in its own
 * Suspense boundary, so that the caveats about the index can fail without
 * taking the index down. T31 put it on the worker's Index tab; this ticket puts
 * it here too, so that a reader who follows the product's own index links from
 * the landing page still meets them.
 */

export const metadata: Metadata = {
  title: 'The index',
  description:
    'The Occupation Displacement Index for fifteen occupation groups, month by month, with the line that opens claims. Unemployment in your occupation, compared with everyone else, smoothed over three months, compared with a year ago.',
  alternates: { canonical: '/index' },
};

export const dynamic = 'force-dynamic';

export default async function IndexExplorerPage() {
  const data = await readExplorer();
  return (
    <ExplorerScreen
      attribution={
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <Attribution asOf={data.provenance.asOf} />
        </Suspense>
      }
      data={data}
    />
  );
}

/**
 * The panel's figures, live if the feed answers and from the committed copy if
 * it does not.
 *
 * The fallback is the series this repository committed, bundled at build time.
 * It is genuinely the last published figures rather than a remembered read or a
 * placeholder, and the panel says on screen which of the two it is showing.
 */
async function Attribution({ asOf }: { asOf: string | null }) {
  let panel: AttributionPanelData;
  try {
    panel = attributionPanel(await fetchAttribution(), { indexLatestPeriod: asOf });
  } catch (cause) {
    reportUnreachable('the attribution panel', cause);
    panel = attributionPanel(attributionSnapshot(), {
      indexLatestPeriod: asOf,
      fromSnapshot: true,
    });
  }
  return <AttributionPanel data={panel} />;
}
