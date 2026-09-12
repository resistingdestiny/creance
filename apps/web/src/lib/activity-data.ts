/**
 * What the activity page reads before it renders: seven places on Hedera
 * testnet, at once.
 *
 * This is the one page in the product whose whole subject is the chain, so it is
 * the one page that talks to the mirror node rather than to the API. It uses
 * @creance/client's MirrorClient, which is the same reader GET /v1/audit/:policyId
 * uses, so there is one mirror client in this repository and not two.
 *
 * Everything is read in parallel. Seven sequential reads is seven round trips to
 * a public node on the other side of the Atlantic, and a demo cannot wait for
 * that; seven at once is one round trip's worth of waiting. Each read carries
 * its own timeout, because a source that hangs must cost this page that source
 * and not the page.
 *
 * A source that fails is named rather than hidden. The page prints what came
 * back and says which places could not be read, and a read that returns nothing
 * at all is a page that says so and shows no rows. There is no fixture behind
 * this page and nothing is remembered across a restart: if the mirror node is
 * down, there is nothing to show, and that is what the reader is told.
 *
 * The newest page is held for a few seconds, the way src/lib/explorer-data.ts
 * holds its round of readings, through the same src/lib/held-read.ts. The reason
 * is different, though. Nothing here costs money; what the hold buys is that a
 * demo reloading the page, and a room of judges opening it at once, make one set
 * of reads between them rather than one each. The window is short because the
 * subject is live: twenty seconds is long enough to cover a reload and short
 * enough that "four minutes ago" on the screen is still true.
 *
 * A page reached with a cursor is not held. Those are the older pages, they are
 * read by one person walking back through the history, and a hold per cursor
 * would be a hold per string anybody cared to send.
 */

import {
  MirrorClient,
  TESTNET_MIRROR_URL,
  type MirrorTopicMessage,
} from '@creance/client/src/hedera/mirror';

import { reportUnreachable } from './api';
import {
  ACTIVITY_SOURCES,
  capRuns,
  contractEntry,
  mergeActivity,
  rollUp,
  topicEntry,
  type ActivityEntry,
  type ActivityRun,
  type ActivitySource,
  type ActivitySourceKey,
  type MirrorContractResult,
} from './activity-model';
import { heldRead, heldReadPerKey } from './held-read';
import { serverVar } from './server-env';

/**
 * How many lines a page shows.
 *
 * It is the binding number on a page showing one place, which is every record
 * that place has, one by one. On a page of everything the cap below usually
 * binds first, and the page is the seven places at six lines each.
 */
export const PAGE_SIZE = 50;

/**
 * How many records are asked of each source.
 *
 * This is a hundred rather than a handful because of what rolling up does to
 * the arithmetic. A line that stands for a run of fifteen paid readings is only
 * true about fifteen of them if fifteen were read, and the mirror node's own
 * ceiling on a page is a hundred, so a hundred is what is asked for. Seven
 * requests of a hundred small records still cost one round trip, because they
 * go out together.
 */
const PER_SOURCE = 100;

/**
 * How many of a page's lines any one place may take.
 *
 * Rolling up shrank this problem without removing it. The payments topic writes
 * a settlement for every metered call this product makes and they come in
 * bursts, so even as runs it was still taking the first dozen lines and pushing
 * everything else below the fold. Six lines is enough of the busiest place to
 * see that it is running now, and leaves the page for the six things that
 * happen less often and say more. A place shown on its own is not capped,
 * because then there is nothing to crowd out.
 */
export const PER_SOURCE_ON_A_PAGE = 6;

/** How long a source has to answer before the page goes on without it. */
const TIMEOUT_MS = 6000;

/** How long the newest page stands before it is read again. */
export const TTL_MS = 20_000;

/** How long past that it is served while the next read runs behind the reader. */
export const STALE_MS = 40_000;

export interface ActivityFeed {
  readonly runs: readonly ActivityRun[];
  /**
   * This page is a summary of what was read rather than all of it: a place was
   * held back, or a run of identical records was rolled into one line. The page
   * says so, and says where the unrolled records are.
   */
  readonly summarised: boolean;
  /** The places that did not answer, so the page can say which. */
  readonly unread: readonly ActivitySourceKey[];
  /** When these lines were read, as an ISO instant. */
  readonly readAt: string;
  /**
   * Where the next page starts: the oldest line on this one, or null at the end
   * of what was read.
   *
   * It continues from the bottom of what is on screen, which is what the link
   * says it does. On a page of everything that is not the same as continuing
   * from the newest record nobody has seen, because a capped place has records
   * between the two; the page names the cap and points at the place filter,
   * which is the complete view of any one place and pages exactly.
   */
  readonly older: string | null;
}

/**
 * A mirror client with a deadline on every call.
 *
 * The base url is the same variable the API reads, with the same default, so a
 * deployment pointed at another mirror node does not have to point this page
 * separately.
 */
function mirror(): MirrorClient {
  return new MirrorClient({
    baseUrl: serverVar('HEDERA_MIRROR_URL') ?? TESTNET_MIRROR_URL,
    fetchImpl: (input, init) =>
      fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) }),
  });
}

const newest = heldReadPerKey<ActivityFeed>((key) =>
  heldRead({
    what: `the activity feed, ${key}`,
    ttlMs: TTL_MS,
    staleMs: STALE_MS,
    read: () => buyFeed(key === 'all' ? null : (key as ActivitySourceKey), null),
  }),
);

/** Tests only. A module level hold outlives a test file otherwise. */
export function forgetActivity(): void {
  newest.forget();
}

/**
 * The page of activity a request asks for.
 *
 * With no cursor this is the newest page and it comes from the hold. With one it
 * is read fresh, because it is a place in the history and not the live edge.
 */
export function readActivity(
  filter: ActivitySourceKey | null,
  before: string | null,
  now: number = Date.now(),
): Promise<ActivityFeed> {
  if (before !== null) return buyFeed(filter, before);
  return newest.read(filter ?? 'all', now);
}

async function buyFeed(
  filter: ActivitySourceKey | null,
  before: string | null,
): Promise<ActivityFeed> {
  const client = mirror();
  const sources = ACTIVITY_SOURCES.filter(
    (source) => filter === null || source.key === filter,
  );

  const reads = await Promise.all(
    sources.map(async (source) => {
      try {
        return { source, entries: await readSource(client, source, before) };
      } catch (cause) {
        reportUnreachable(`the activity feed's ${source.label.toLowerCase()} records`, cause);
        return { source, entries: null };
      }
    }),
  );

  // A place shown on its own is every record it has, one by one: rolling up and
  // the cap are both ways of fitting seven places into one page, and on a page
  // that is one place there is nothing to fit. That is also where a reader goes
  // when they want the records a rolled up line stands for.
  const merged = mergeActivity(reads.map((read) => read.entries ?? []));
  const all = filter === null ? rollUp(merged) : merged.map(asOwnLine);
  const runs = capRuns(all, PAGE_SIZE, filter === null ? PER_SOURCE_ON_A_PAGE : PAGE_SIZE);
  const summarised =
    filter === null && (all.length > runs.length || runs.some((run) => run.count > 1));

  // There is another page only where a source was read to its limit: a page
  // that ends because every source ran out has nothing older to offer, and a
  // link to an empty page is worse than no link.
  const more = reads.some((read) => read.entries !== null && read.entries.length >= PER_SOURCE);

  return {
    runs,
    summarised,
    unread: reads.filter((read) => read.entries === null).map((read) => read.source.key),
    readAt: new Date().toISOString(),
    older: more && runs.length > 0 ? (runs.at(-1)?.consensus ?? null) : null,
  };
}

/** One record as a line of its own, which is what a page of one place shows. */
function asOwnLine(entry: ActivityEntry): ActivityRun {
  return {
    key: entry.key,
    source: entry.source,
    title: entry.title,
    detail: entry.detail,
    refused: entry.refused,
    count: 1,
    at: entry.at,
    since: entry.at,
    total: entry.amount,
    href: entry.href,
    consensus: entry.consensus,
  };
}

/**
 * One source's newest records, older than the cursor when there is one.
 *
 * The two shapes take the same two query parameters, `limit` and `timestamp`,
 * and answer newest first with `order=desc`, so the paging is one expression for
 * both and a cursor means the same thing on a topic as it does on a contract.
 */
async function readSource(
  client: MirrorClient,
  source: ActivitySource,
  before: string | null,
): Promise<readonly ActivityEntry[]> {
  const query = new URLSearchParams({ limit: String(PER_SOURCE), order: 'desc' });
  if (before !== null) query.set('timestamp', `lt:${before}`);

  if (source.kind === 'topic') {
    const body = await client.get<{ messages?: MirrorTopicMessage[] }>(
      `/topics/${source.id}/messages?${query.toString()}`,
    );
    return (body?.messages ?? []).map((message) => topicEntry(source, message));
  }

  const body = await client.get<{ results?: MirrorContractResult[] }>(
    `/contracts/${source.id}/results?${query.toString()}`,
  );
  return (body?.results ?? []).map((result) => contractEntry(source, result));
}
