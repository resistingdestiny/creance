import type { Metadata } from 'next';

import { readActivity } from '../../lib/activity-data';
import { activityCursor, activityFilter } from '../../lib/activity-model';
import { ActivityScreen } from './activity-screen';

/**
 * `/activity`, the page that shows the product running on Hedera testnet.
 *
 * The route is named for what it shows rather than for what it reads. Every
 * other page here is named in the product's own words, and a person who lands on
 * this one is looking for what has been happening, not for a second block
 * explorer: HashScan is the explorer, and every line on this page goes there.
 *
 * Nothing behind it is a session. No wallet, no eligibility credential, no
 * purchase: the mirror node is public and so is this page, which is the point of
 * it, because the reader it is for has none of those things.
 *
 * `?source=` picks one of the seven places and `?before=` is a place in the
 * history. Both come off a query string, so both fall back to the newest page of
 * everything rather than erroring, and neither is passed to the mirror node
 * without being checked first.
 *
 * The reads are made on the server, they are live, and the newest page is held
 * for the few seconds src/lib/activity-data.ts sets so that a demo reloading it
 * does not make seven fresh calls each time. Nothing is prerendered and nothing
 * is a fixture: if the mirror node cannot be read, the page says so and shows no
 * lines.
 */

export const metadata: Metadata = {
  title: 'Activity',
  description:
    'Everything this product does on Hedera testnet as it happens: cover started, premiums collected, months of the index published, claims filed and decided, coupons paid and notes traded. Every line links to the record on HashScan.',
  alternates: { canonical: '/activity' },
};

// The whole page is the live edge of a public ledger. There is nothing here to
// prerender, and a cached copy would be the one thing this page must not be.
export const dynamic = 'force-dynamic';

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; before?: string }>;
}) {
  const { source, before: beforeParam } = await searchParams;
  const filter = activityFilter(source);
  const before = activityCursor(beforeParam);

  // The reads are handed on as a promise rather than awaited, so the heading and
  // the filters are on the first byte and the lines land under them when the
  // seven reads come back. A cold load must never be a white screen.
  return (
    <ActivityScreen
      before={before}
      feed={readActivity(filter, before)}
      filter={filter}
      now={Date.now()}
    />
  );
}
