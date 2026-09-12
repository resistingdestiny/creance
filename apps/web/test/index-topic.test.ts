import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetIndexTopic, readIndexTopic } from '../src/lib/index-topic.js';

/**
 * What the pages are allowed to say about the index topic, which is whatever
 * counting the topic supports and not a word more.
 *
 * The messages here are the shape the oracle publishes: one per occupation
 * group per month, the group and the period in the payload. The topic on
 * testnet holds exactly that, so a summary that reads it wrongly would put a
 * false sentence under an invitation to go and check.
 */

const TOPIC = '0.0.10366470';

/** One message, as the mirror node returns it. */
function message(sequence: number, group: string, period: string) {
  return {
    consensus_timestamp: `${String(1_700_000_000 + sequence)}.000000000`,
    topic_id: TOPIC,
    sequence_number: sequence,
    message: Buffer.from(JSON.stringify({ group, period, status: 'final' })).toString('base64'),
    running_hash: '',
    payer_account_id: '0.0.10366447',
  };
}

/** The mirror node, answering with one page of the messages it is given. */
function mirror(messages: ReturnType<typeof message>[]) {
  return vi.fn(async (url: string) => {
    const query = new URL(url, 'https://mirror.invalid');
    const order = query.searchParams.get('order') ?? 'asc';
    const limit = Number(query.searchParams.get('limit') ?? '25');
    const from = query.searchParams.get('sequencenumber');
    const gte = from === null ? 1 : Number(from.replace('gte:', ''));
    const rows = messages
      .filter((entry) => entry.sequence_number >= gte)
      .sort((left, right) =>
        order === 'desc'
          ? right.sequence_number - left.sequence_number
          : left.sequence_number - right.sequence_number,
      )
      .slice(0, limit);
    return new Response(JSON.stringify({ messages: rows }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

beforeEach(() => {
  forgetIndexTopic();
});

afterEach(() => {
  vi.restoreAllMocks();
  forgetIndexTopic();
});

describe('what the index topic holds', () => {
  it('counts the months each occupation has settled, and the newest of them', async () => {
    const fetchImpl = mirror([
      message(1, 'computer_math', '2026-05'),
      message(2, 'computer_math', '2026-06'),
      message(3, 'computer_math', '2026-07'),
      message(4, 'legal', '2026-07'),
    ]);
    vi.stubGlobal('fetch', fetchImpl);

    const summary = await readIndexTopic(TOPIC);

    expect(summary?.months).toEqual({ computer_math: 3, legal: 1 });
    expect(summary?.newest).toEqual({ computer_math: '2026-07', legal: '2026-07' });
    expect(summary?.truncated).toBe(false);
  });

  it('counts a month republished as a revision once, not twice', async () => {
    vi.stubGlobal(
      'fetch',
      mirror([
        message(1, 'computer_math', '2026-07'),
        message(2, 'computer_math', '2026-07'),
      ]),
    );

    expect((await readIndexTopic(TOPIC))?.months).toEqual({ computer_math: 1 });
  });

  it('skips a message it cannot read rather than losing the count', async () => {
    const rows = [message(1, 'legal', '2026-07'), message(2, 'legal', '2026-06')];
    rows[1]!.message = Buffer.from('not json').toString('base64');
    vi.stubGlobal('fetch', mirror(rows));

    expect((await readIndexTopic(TOPIC))?.months).toEqual({ legal: 1 });
  });

  it('is one read for a room of readers, and none at all with no topic', async () => {
    const fetchImpl = mirror([message(1, 'legal', '2026-07')]);
    vi.stubGlobal('fetch', fetchImpl);

    await Promise.all(Array.from({ length: 20 }, () => readIndexTopic(TOPIC)));
    // The newest message, then the page from it. Twenty readers, two requests.
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    expect(await readIndexTopic(null)).toBeNull();
  });

  it('says nothing rather than guessing when the mirror node will not answer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('no', { status: 500 })),
    );

    expect(await readIndexTopic(TOPIC)).toBeNull();
  });

  it('has nothing to report for a topic with no messages on it', async () => {
    vi.stubGlobal('fetch', mirror([]));

    expect(await readIndexTopic(TOPIC)).toEqual({ months: {}, newest: {}, truncated: false });
  });
});
