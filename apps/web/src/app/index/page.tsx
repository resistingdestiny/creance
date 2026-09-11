import type { Metadata } from 'next';

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
 */

export const metadata: Metadata = {
  title: 'The index',
  description:
    'The Occupation Displacement Index for fifteen occupation groups, month by month, with the line that opens claims. Unemployment in your occupation, compared with everyone else, smoothed over three months, compared with a year ago.',
  alternates: { canonical: '/index' },
};

export const dynamic = 'force-dynamic';

export default async function IndexExplorerPage() {
  return <ExplorerScreen data={await readExplorer()} />;
}
