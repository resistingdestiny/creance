import { describe, expect, it } from 'vitest';

import { MirrorClient } from '../src/hedera/mirror.js';

/// The query the mirror reads build, with a stub fetch. The live behaviour is
/// exercised by the testnet stages; what matters here is that a window read
/// asks for `sequencenumber=gte:` and not for one message.

function recordingClient() {
  const asked: string[] = [];
  const client = new MirrorClient({
    baseUrl: 'https://testnet.mirrornode.hedera.com/api/v1',
    fetchImpl: (async (url: string) => {
      asked.push(String(url));
      return new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  });
  return { asked, client };
}

describe('topic message reads', () => {
  it('asks for one message by equality', async () => {
    const { asked, client } = recordingClient();
    await client.topicMessage('0.0.10366471', 18);
    expect(asked[0]).toContain('sequencenumber=eq%3A18');
  });

  it('asks for the window from a sequence number on', async () => {
    const { asked, client } = recordingClient();
    await client.topicMessagesFrom('0.0.10366471', 18, 5);
    expect(asked[0]).toContain('sequencenumber=gte%3A18');
    expect(asked[0]).toContain('limit=5');
    expect(asked[0]).toContain('order=asc');
  });
});
