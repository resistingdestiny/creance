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
  contractEntry,
  mergeActivity,
  topicEntry,
  type ActivityEntry,
  type ActivitySource,
  type ActivitySourceKey,
  type MirrorContractResult,
} from './activity-model';
import { heldRead, heldReadPerKey } from './held-read';
import { serverVar } from './server-env';

/** How many lines a page shows. Two screens of dense rows, and one more read is one link away. */
export const PAGE_SIZE = 50;

/**
 * How many records are asked of each source.
 *
 * The payments topic writes far more than the other six put together, so a
 * page of fifty is usually fifty payments and a handful of others. Reading
 * twenty five from each is what keeps a quiet source visible: the index
 * publishes once a month and would otherwise never appear on the first page.
 */
const PER_SOURCE = 25;

/**
 * How many of a page's lines any one place may take.
 *
 * The payments topic writes more than every other place put together, so
 * without this the first page is fifty settlements and a reader never learns
 * that anything else happens here at all. Eight of fifty is enough of the
 * busiest place to see that it is running now, and leaves the rest of the page
 * for the six things that happen less often and say more. A place shown on its
 * own is not capped, because then there is nothing to crowd out.
 */
export const PER_SOURCE_ON_A_PAGE = 8;

/** How long a source has to answer before the page goes on without it. */
const TIMEOUT_MS = 6000;

/** How long the newest page stands before it is read again. */
export const TTL_MS = 20_000;

/** How long past that it is served while the next read runs behind the reader. */
export const STALE_MS = 40_000;

export interface ActivityFeed {
  readonly entries: readonly ActivityEntry[];
  /** A place had more to show than a page gives it, so the page can say so. */
  readonly capped: boolean;
  /** The places that did not answer, so the page can say which. */
  readonly unread: readonly ActivitySourceKey[];
  /** When these lines were read, as an ISO instant. */
  readonly readAt: string;
  /** The cursor for the page before this one in time, or null at the end of what was read. */
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

  const entries = mergeActivity(
    reads.map((read) => read.entries ?? []),
    PAGE_SIZE,
    filter === null ? PER_SOURCE_ON_A_PAGE : PAGE_SIZE,
  );
  const capped =
    filter === null &&
    reads.some(
      (read) => read.entries !== null && read.entries.length > PER_SOURCE_ON_A_PAGE,
    );

  // There is another page only where a source was read to its limit: a page
  // that ends because every source ran out has nothing older to offer, and a
  // link to an empty page is worse than no link.
  const more = reads.some((read) => read.entries !== null && read.entries.length >= PER_SOURCE);

  return {
    entries,
    capped,
    unread: reads.filter((read) => read.entries === null).map((read) => read.source.key),
    readAt: new Date().toISOString(),
    older: more && entries.length > 0 ? (entries.at(-1)?.consensus ?? null) : null,
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
