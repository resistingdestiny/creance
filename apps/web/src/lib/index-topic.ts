/**
 * What the index topic actually holds, read from the mirror node.
 *
 * The public explorer and the market board both invite a reader to check the
 * index without trusting the page, and an invitation like that is only worth
 * making if the sentence beside it is exactly true. The pages used to say every
 * month was settled on the topic. It was not: the topic carries one message per
 * occupation per published month, and what is on it is a matter of counting.
 * So the pages count, here, from the same place a reader following the link
 * would count from.
 *
 * This reads Hedera and not the API on purpose, and it is the only module
 * outside src/lib/activity-data.ts that does. The claim is about what is on the
 * topic, so the topic is what has to answer it: asking the API whether its own
 * figures were settled would be the page trusting the thing the sentence offers
 * to let a reader stop trusting.
 *
 * It is free, it is held, and it fails soft. A summary that could not be read
 * costs the pages the count and nothing else: they say the index settles on the
 * topic, which is true with or without a count, and they say no more than that.
 */

import {
  MirrorClient,
  TESTNET_MIRROR_URL,
  decodeMessage,
  type MirrorTopicMessage,
} from '@creance/client/src/hedera/mirror';

import { reportUnreachable } from './api';
import { heldRead, heldReadPerKey } from './held-read';

/**
 * How long a summary stands. The index publishes once a month, so this is
 * about a room of readers arriving together rather than about staleness.
 */
export const TOPIC_TTL_MS = 10 * 60 * 1000;
export const TOPIC_STALE_MS = 10 * 60 * 1000;

/** Messages per mirror node request, which is its own maximum. */
const PAGE = 100;

/**
 * The most messages one summary reads.
 *
 * Fifteen occupations at one message a month is a hundred and eighty a year,
 * so this is years of headroom and still a bounded read. Past it the summary
 * is the newest five hundred messages and says so, and every page that words
 * itself from it drops the claim that the history is whole. A count that might
 * have missed something is not a count worth printing as one.
 */
const CAP = 500;

export interface IndexTopicSummary {
  /** How many distinct months are settled, per occupation group. */
  readonly months: Readonly<Record<string, number>>;
  /** The newest month settled, per occupation group. */
  readonly newest: Readonly<Record<string, string>>;
  /** Whether older messages were left unread, so nothing may be called whole. */
  readonly truncated: boolean;
}

const summaries = heldReadPerKey<IndexTopicSummary>((topicId) =>
  heldRead({
    what: `the index topic ${topicId}`,
    ttlMs: TOPIC_TTL_MS,
    staleMs: TOPIC_STALE_MS,
    read: () => summarise(topicId),
  }),
);

/** Tests only. A module level hold outlives a test file otherwise. */
export function forgetIndexTopic(): void {
  summaries.forget();
}

/**
 * The summary, or null when the mirror node could not be read. Null is the
 * whole of what a failure costs: no page depends on it for anything but a
 * count it drops when there is none.
 */
export async function readIndexTopic(topicId: string | null): Promise<IndexTopicSummary | null> {
  if (topicId === null) return null;
  try {
    return await summaries.read(topicId);
  } catch (cause) {
    reportUnreachable(`the index topic ${topicId}`, cause);
    return null;
  }
}

async function summarise(topicId: string): Promise<IndexTopicSummary> {
  const mirror = new MirrorClient({ baseUrl: TESTNET_MIRROR_URL });

  // The newest message first, for two things: the highest sequence number, and
  // therefore whether the whole topic fits inside the cap. Reading forward from
  // the end rather than from the beginning is what keeps the newest month, which
  // is the part every sentence turns on, inside a truncated read.
  const newest = await mirror.topicMessages(topicId, { order: 'desc', limit: 1 });
  const highest = newest[0]?.sequence_number ?? 0;
  if (highest === 0) return { months: {}, newest: {}, truncated: false };

  const from = Math.max(1, highest - CAP + 1);
  const periods = new Map<string, Set<string>>();
  const latest = new Map<string, string>();

  for (let at = from; at <= highest; at += PAGE) {
    const page = await mirror.topicMessages(topicId, { fromSequenceNumber: at, limit: PAGE });
    if (page.length === 0) break;
    for (const message of page) {
      const observation = observationOf(message);
      if (observation === null) continue;
      const { group, period } = observation;
      const seen = periods.get(group) ?? new Set<string>();
      seen.add(period);
      periods.set(group, seen);
      const standing = latest.get(group);
      // String order is date order for a period, which is why they are written
      // this way round. A revision republishes a month that is already counted,
      // which the set above handles on its own.
      if (standing === undefined || period > standing) latest.set(group, period);
    }
  }

  const months: Record<string, number> = {};
  for (const [group, seen] of periods) months[group] = seen.size;
  return {
    months,
    newest: Object.fromEntries(latest),
    truncated: from > 1,
  };
}

/**
 * The group and the period one message settles, or null for anything this
 * summary cannot read.
 *
 * Anything unparseable is skipped rather than thrown on. A message this module
 * does not understand is a message it must not count, and it is not a reason
 * for a page to lose a sentence about the ones it does understand.
 */
function observationOf(message: MirrorTopicMessage): { group: string; period: string } | null {
  let payload: unknown;
  try {
    payload = JSON.parse(decodeMessage(message));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const group = record['group'];
  const period = record['period'];
  if (typeof group !== 'string' || typeof period !== 'string') return null;
  return { group, period };
}
