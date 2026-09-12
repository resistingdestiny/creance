import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_CALLS,
  ACTIVITY_SOURCES,
  SETTLEMENT_TOKEN,
  activityCursor,
  activityFilter,
  activitySource,
  contractEntry,
  hashscanSourceUrl,
  instantOf,
  mergeActivity,
  submitTransactionOf,
  topicEntry,
  type ActivityEntry,
  type ActivitySource,
  type ActivitySourceKey,
} from '../src/lib/activity-model.js';
import { formatAge, formatInstant } from '../src/lib/format.js';

/**
 * The activity page's two promises, held here.
 *
 * The first is that it shows the deployment it says it is showing. Every id in
 * ACTIVITY_SOURCES is read back out of contracts/deployments/testnet.json and
 * docs/hedera.testnet.json, so a redeployment fails here rather than quietly
 * pointing the page at a topic nobody writes to any more. The same goes for the
 * settlement token's scale, which is the one scale this page applies to a figure
 * the record did not scale itself.
 *
 * The second is that nothing is invented. A record with no transaction on it
 * gets no link, a record whose amount has no scale gets no amount, and a message
 * this build has never written renders as the little that is known about it.
 */

const repo = new URL('../../../', import.meta.url);

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(fileURLToPath(new URL(path, repo)), 'utf8')) as Record<
    string,
    unknown
  >;
}

function source(key: ActivitySourceKey): ActivitySource {
  return activitySource(key);
}

type Message = Parameters<typeof topicEntry>[1];

/** A mirror node topic message carrying this payload, in the shape the node returns. */
function message(payload: unknown, sequence = 1, consensus = '1789202164.922804104'): Message {
  return {
    chunk_info: {
      initial_transaction_id: {
        account_id: '0.0.10366450',
        nonce: 0,
        scheduled: false,
        transaction_valid_start: '1789202159.814712667',
      },
      number: 1,
      total: 1,
    },
    consensus_timestamp: consensus,
    message: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
    payer_account_id: '0.0.10366450',
    running_hash: '',
    sequence_number: sequence,
    topic_id: '0.0.10366471',
  } as unknown as Message;
}

describe('the seven places', () => {
  it('are the topics and contracts the deployment record names', () => {
    const resources = json('docs/hedera.testnet.json');
    const record = json('contracts/deployments/testnet.json');
    const topics = resources['topics'] as Record<string, { topicId: string }>;
    const market = (record['secondaryMarket'] as { market: { contractId: string } }).market;

    const expected: Record<string, string> = {
      payments: topics['payments']?.topicId ?? '',
      claims: topics['claims']?.topicId ?? '',
      index: topics['index']?.topicId ?? '',
      journal: topics['agent-journal']?.topicId ?? '',
      cover: (record['coverPool'] as { contractId: string }).contractId,
      capital: (record['collateralVault'] as { contractId: string }).contractId,
      market: market.contractId,
    };

    expect([...ACTIVITY_SOURCES].map((entry) => entry.key).sort()).toEqual(
      Object.keys(expected).sort(),
    );
    for (const entry of ACTIVITY_SOURCES) {
      expect(entry.id, entry.key).toBe(expected[entry.key]);
      expect(entry.id, entry.key).toMatch(/^0\.0\.\d+$/);
    }
  });

  it('names the settlement token at the scale the resources file records', () => {
    const token = json('docs/hedera.testnet.json')['settlementToken'] as {
      tokenId: string;
      decimals: number;
    };
    expect(SETTLEMENT_TOKEN.id).toBe(token.tokenId);
    expect(SETTLEMENT_TOKEN.decimals).toBe(token.decimals);
  });

  it('sends a reader to the right kind of HashScan page for each', () => {
    expect(hashscanSourceUrl(source('payments'))).toBe(
      'https://hashscan.io/testnet/topic/0.0.10366471',
    );
    expect(hashscanSourceUrl(source('market'))).toBe(
      'https://hashscan.io/testnet/contract/0.0.10495570',
    );
    for (const entry of ACTIVITY_SOURCES) {
      expect(hashscanSourceUrl(entry), entry.key).toContain(`/testnet/${entry.kind}/`);
    }
  });
});

describe('the query string', () => {
  it('takes a filter only from the seven', () => {
    expect(activityFilter('claims')).toBe('claims');
    expect(activityFilter(undefined)).toBeNull();
    expect(activityFilter('../../etc/passwd')).toBeNull();
  });

  it('takes a cursor only in the shape a consensus timestamp has', () => {
    expect(activityCursor('1789202164.922804104')).toBe('1789202164.922804104');
    expect(activityCursor('1789202164')).toBeNull();
    expect(activityCursor('lt:1789202164.9')).toBeNull();
    expect(activityCursor(undefined)).toBeNull();
  });
});

describe('a topic message', () => {
  it('links to the transaction that submitted it, because HashScan has no message page', () => {
    expect(submitTransactionOf(message({ v: 1, kind: 'journal' }))).toBe(
      '0.0.10366450-1789202159-814712667',
    );
  });

  it('carries no link at all when the record names no transaction', () => {
    const bare = { ...message({ v: 1, kind: 'journal' }), chunk_info: undefined };
    expect(topicEntry(source('journal'), bare as unknown as Message).href).toBeNull();
  });

  it('says which of the three gated calls an agent paid for', () => {
    const entry = topicEntry(
      source('payments'),
      message({
        v: 1,
        kind: 'settlement',
        endpoint: 'POST /v1/quote',
        x402: 2,
        scheme: 'exact',
        network: 'hedera:testnet',
        payer: '0.0.10366453',
        payTo: '0.0.10366450',
        amount: '50000',
        asset: SETTLEMENT_TOKEN.id,
        decimals: 6,
        tx: '0.0.7162784@1789202153.162295661',
        facilitator: 'api.testnet.blocky402.com',
        at: '2026-09-12T08:36:04.623Z',
      }),
    );
    expect(entry.title).toBe('An agent paid for a price');
    expect(entry.detail).toBe('POST /v1/quote');
    expect(entry.amount).toBe('0.05');
    expect(entry.href).toBe(
      'https://hashscan.io/testnet/transaction/0.0.10366450-1789202159-814712667',
    );
    // The consensus timestamp, not the moment the writer put in the payload.
    expect(entry.at).toBe('2026-09-12T08:36:04.922Z');
  });

  it('reads a month of the index, which carries no kind at all', () => {
    const entry = topicEntry(
      source('index'),
      message({
        group: 'computer_math',
        period: '2026-05',
        odi: 0.07,
        open: true,
        series: 'ODI-COMP-2026-01',
        v: 2,
      }),
    );
    expect(entry.title).toBe('The index published May 2026 for computer and mathematical');
    expect(entry.detail).toBe('Reading 0.07, claims open');
    expect(entry.amount).toBeNull();
  });

  it("reads the agent's own journal, which the audit parser does not know", () => {
    const entry = topicEntry(
      source('journal'),
      message({
        v: 1,
        kind: 'journal',
        at: '2026-09-05T19:19:36.878Z',
        agent: '0.0.10366451',
        principal: { wallet: '0.0.10366457', group: 'computer_math' },
        rule: { decision: 'hold', reason: 'trend_not_rising' },
      }),
    );
    expect(entry.title).toBe('The agent reviewed cover for computer and mathematical');
    expect(entry.detail).toBe('It decided to hold');
  });

  it('names a claim decision by what was decided', () => {
    for (const [decision, title] of [
      ['approve', 'A claim was approved'],
      ['decline', 'A claim was declined'],
      ['refer', 'A claim was sent for review'],
    ] as const) {
      const entry = topicEntry(
        source('claims'),
        message({
          v: 1,
          kind: 'claim_decision',
          policy: 'pol_1',
          claimId: 'clm_1',
          decisionHash: 'sha256:0',
          decision,
          at: '2026-09-12T07:11:02.480Z',
        }),
      );
      expect(entry.title, decision).toBe(title);
      expect(entry.detail, decision).toBe('clm_1');
    }
  });

  it('prints a coupon at the settlement token scale, which the message itself omits', () => {
    const paid = {
      v: 1,
      kind: 'coupon',
      series: 'ODI-COMP-2026-01',
      seriesId: '0x00',
      couponId: '0x00',
      holder: '0.0.10366460',
      holderAddress: '0x00',
      numerator: '1',
      denominator: '1',
      amount: '328767123',
      token: SETTLEMENT_TOKEN.id,
      scheduleId: '0.0.1',
      transactionId: '0.0.1@1.1',
      result: 'SUCCESS',
      paidAt: '2026-09-10T00:00:00.000Z',
    };
    expect(topicEntry(source('payments'), message(paid)).amount).toBe('328.77');

    // Another token at an unknown scale is not printed at this one.
    expect(
      topicEntry(source('payments'), message({ ...paid, token: '0.0.999999' })).amount,
    ).toBeNull();
  });

  it('renders a kind it has never seen as the little that is known about it', () => {
    const entry = topicEntry(source('payments'), message({ v: 9, kind: 'something_later' }));
    expect(entry.title).toBe('A record was written');
    expect(entry.detail).toBe('something_later');
    expect(entry.amount).toBeNull();
  });
});

describe('a contract call', () => {
  it('is captioned by its selector, and every caption is a sentence', () => {
    for (const [selector, said] of Object.entries(ACTIVITY_CALLS)) {
      expect(selector).toMatch(/^0x[0-9a-f]{8}$/);
      expect(said, selector).toMatch(/^[A-Z]/);
      expect(said, selector).not.toMatch(/[\u2013\u2014]/);
    }
    // The sentences are what a reader tells the rows apart by, so no two say the
    // same thing.
    const said = Object.values(ACTIVITY_CALLS);
    expect(new Set(said).size).toBe(said.length);
  });

  it('reads the three the market makes, which is what a judge watches', () => {
    const filled = contractEntry(source('market'), {
      timestamp: '1789201434.642522104',
      hash: '0xe4be09f1d907f5bc76a93000327670166aceb489e02913ed54f9371d3e7ef159',
      function_parameters: '0x74a460500000000000000000000000008a5a1ac8aa7941ff61f63f81dd3f2a32',
      error_message: null,
    });
    expect(filled.title).toBe('Notes were offered for sale');
    expect(filled.source).toBe('market');
    expect(filled.href).toBe(
      'https://hashscan.io/testnet/transaction/0xe4be09f1d907f5bc76a93000327670166aceb489e02913ed54f9371d3e7ef159',
    );
    expect(filled.refused).toBe(false);
    expect(filled.at).toBe(instantOf('1789201434.642522104'));
  });

  it('keeps a refused call, because a refusal is the control working', () => {
    const entry = contractEntry(source('market'), {
      timestamp: '1789201434.642522104',
      hash: '0xc03a61253bb6e7daefcc19826cb5c534ed0239cff6181b051216da8d00751fba',
      function_parameters: '0x3fda5389000000',
      error_message: '0x0102',
    });
    expect(entry.title).toBe('Notes changed hands');
    expect(entry.refused).toBe(true);
    expect(entry.detail).toBe('The chain refused it');
  });

  it('says only that something was called when the selector is not one it names', () => {
    const entry = contractEntry(source('cover'), {
      timestamp: '1.0',
      hash: '0xdeadbeef',
      function_parameters: '0x00000000',
      error_message: null,
    });
    expect(entry.title).toBe('Something was called on cover');
    expect(entry.href).toBe('https://hashscan.io/testnet/transaction/0xdeadbeef');
  });
});

describe('the stream', () => {
  function at(consensus: string): ActivityEntry {
    return {
      key: consensus,
      source: 'payments',
      at: instantOf(consensus),
      consensus,
      title: 'x',
      detail: null,
      amount: null,
      refused: false,
      href: null,
    };
  }

  it('is newest first across every place, compared as seconds then nanoseconds', () => {
    const merged = mergeActivity(
      [
        [at('1789202164.000000002'), at('1789202100.999999999')],
        [at('1789202164.000000010'), at('1789202099.000000000')],
      ],
      10,
    );
    expect(merged.map((entry) => entry.consensus)).toEqual([
      '1789202164.000000010',
      '1789202164.000000002',
      '1789202100.999999999',
      '1789202099.000000000',
    ]);
  });

  it('is cut to the page size', () => {
    expect(mergeActivity([[at('2.0'), at('1.0'), at('3.0')]], 2)).toHaveLength(2);
  });

  it('lets no one place fill a page, so a busy topic cannot hide the rest', () => {
    const payments = ['9.0', '8.0', '7.0', '6.0'].map((stamp) => at(stamp));
    const market = ['5.0', '4.0'].map((stamp) => ({ ...at(stamp), source: 'market' as const }));
    const page = mergeActivity([payments, market], 10, 2);
    expect(page.map((row) => row.consensus)).toEqual(['9.0', '8.0', '5.0', '4.0']);
  });

  it('caps nothing when the caller asks for no cap', () => {
    const payments = ['9.0', '8.0', '7.0'].map((stamp) => at(stamp));
    expect(mergeActivity([payments], 10)).toHaveLength(3);
  });
});

describe('a time on the page', () => {
  it('is the consensus instant, truncated rather than rounded up', () => {
    expect(instantOf('1789202164.922804104')).toBe('2026-09-12T08:36:04.922Z');
  });

  it('is written as a day and a clock time in UTC', () => {
    expect(formatInstant('2026-09-12T08:36:04.922Z')).toBe('12 September, 08:36');
  });

  it('is also written as an age, against a moment the caller passes in', () => {
    const now = Date.parse('2026-09-12T09:00:00.000Z');
    expect(formatAge('2026-09-12T08:59:30.000Z', now)).toBe('just now');
    expect(formatAge('2026-09-12T08:59:00.000Z', now)).toBe('1 minute ago');
    expect(formatAge('2026-09-12T08:36:00.000Z', now)).toBe('24 minutes ago');
    expect(formatAge('2026-09-12T06:00:00.000Z', now)).toBe('3 hours ago');
    expect(formatAge('2026-09-06T09:00:00.000Z', now)).toBe('6 days ago');
  });
});
