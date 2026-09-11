import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReceiptScreen, caption, title } from '../src/app/receipt/[policyId]/receipt-screen.js';
import type { AuditEntry, AuditTrail } from '../src/lib/audit-api.js';

/// The receipt screen, against the trail the API really returned for the demo
/// policy on 5 September 2026 (payments topic 0.0.10366471, sequences 17 to
/// 20), with a fifth entry added for a payment whose message never reached the
/// topic, because that case is the one the screen must not gloss over.

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const POLICY = 'pol_01M1RG5GHA82D523FDHJPXFXA8';

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    kind: 'settlement',
    source: 'topic',
    at: '2026-09-05T10:00:21Z',
    amount: { amount: '841667', asset: '0.0.10366463', decimals: 6, display: '0.841667' },
    hcs: {
      topic_id: '0.0.10366471',
      sequence_number: 20,
      consensus_at: '2026-09-05T10:00:21Z',
      hashscan: 'https://hashscan.io/testnet/topic/0.0.10366471',
    },
    tx: {
      id: '0.0.7162784@1788602397.120605122',
      hashscan: 'https://hashscan.io/testnet/transaction/0.0.7162784-1788602397-120605122',
    },
    detail: { endpoint: 'POST /v1/bind', payer: '0.0.10366451', ref: POLICY },
    ...overrides,
  };
}

const TRAIL: AuditTrail = {
  policy_id: POLICY,
  series_id: 'ODI-COMP-2026-01',
  group: 'computer_math',
  status: 'bound',
  summary: {
    payments_topic: {
      id: '0.0.10366471',
      hashscan: 'https://hashscan.io/testnet/topic/0.0.10366471',
    },
    claims_topic: {
      id: '0.0.10366473',
      hashscan: 'https://hashscan.io/testnet/topic/0.0.10366473',
    },
    policy_nft: {
      token_id: '0.0.10366468',
      serial: 6,
      hashscan: 'https://hashscan.io/testnet/token/0.0.10366468/6',
    },
    bind_transaction: {
      id: '0x34449e5df8100a6c4d9d9d0dd0245e36ceb54cb4fc21c502bb2d5b4555bca7ec',
      hashscan:
        'https://hashscan.io/testnet/transaction/0x34449e5df8100a6c4d9d9d0dd0245e36ceb54cb4fc21c502bb2d5b4555bca7ec',
    },
    cover_pool: {
      id: '0x6358ddd5AA2e1797ddA949D7d82eA86C9F89ff09',
      hashscan: 'https://hashscan.io/testnet/contract/0x6358ddd5AA2e1797ddA949D7d82eA86C9F89ff09',
    },
    entries: 5,
    entries_on_topic: 4,
  },
  entries: [
    entry({
      kind: 'settlement',
      amount: { amount: '50000', asset: '0.0.10366463', decimals: 6, display: '0.05' },
      detail: { endpoint: 'POST /v1/quote' },
      hcs: {
        topic_id: '0.0.10366471',
        sequence_number: 17,
        consensus_at: '2026-09-05T10:00:00Z',
        hashscan: 'https://hashscan.io/testnet/topic/0.0.10366471',
      },
    }),
    entry({
      kind: 'policy',
      amount: null,
      tx: null,
      detail: { status: 'binding', series: 'ODI-COMP-2026-01' },
    }),
    entry({ kind: 'policy', amount: null, detail: { status: 'bound', series: 'ODI-COMP-2026-01' } }),
    entry(),
    entry({
      kind: 'premium',
      source: 'not_yet_on_topic',
      at: '2026-10-05T10:00:00Z',
      tx: null,
      hcs: {
        topic_id: '0.0.10366471',
        sequence_number: null,
        consensus_at: null,
        hashscan: 'https://hashscan.io/testnet/topic/0.0.10366471',
      },
      detail: { period: '2026-10' },
    }),
  ],
};

describe('the receipt screen', () => {
  const markup = renderToStaticMarkup(<ReceiptScreen trail={TRAIL} />);
  const text = visibleText(markup);

  it('names every entry in the product voice', () => {
    expect(text).toContain('Receipt');
    expect(text).toContain('Price quote');
    expect(text).toContain('Cover requested');
    expect(text).toContain('Cover started');
    expect(text).toContain('First payment');
    expect(text).toContain('Monthly payment');
  });

  it('keeps the words the copy deck forbids off the screen', () => {
    for (const word of ['bind', 'settle', 'nullifier', 'on-chain', 'parametric']) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });

  it('links each entry to HashScan, and the topic under all of them', () => {
    expect(markup).toContain(
      'https://hashscan.io/testnet/transaction/0.0.7162784-1788602397-120605122',
    );
    expect(markup).toContain('https://hashscan.io/testnet/token/0.0.10366468/6');
    expect(markup).toContain('https://hashscan.io/testnet/topic/0.0.10366471');
    expect(text).toContain('View every payment on HashScan');
  });

  it('formats amounts from the minor units, never from display', () => {
    // 841667 at six decimals is 0.84, and 50000 is 0.05.
    expect(text).toContain('0.84');
    expect(text).toContain('0.05');
  });

  it('says when a payment has not reached Hedera yet, and stays quiet when it has', () => {
    // Only the states worth a reader's attention are said. Settled is the
    // ordinary one and every row on a healthy receipt is in it, so saying it
    // on each was repetition rather than information.
    expect(text).toContain('Not recorded yet');
    expect(text).not.toContain('Recorded on Hedera');
  });

  it('shows the reference and the cover state', () => {
    expect(text).toContain('Covered');
    expect(text).toContain('pol_…FXA8');
  });
});

describe('the entry labels', () => {
  it('reads a payout, a coupon and the two claim messages', () => {
    expect(title(entry({ kind: 'payout' }))).toBe('Payout');
    expect(title(entry({ kind: 'coupon' }))).toBe('Coupon');
    expect(title(entry({ kind: 'claim_packet' }))).toBe('Claim sent');
    expect(title(entry({ kind: 'claim_decision' }))).toBe('Claim decision');
    expect(title(entry({ kind: 'rebate' }))).toBe('Entry');
  });

  it('dates an entry in en-GB and in UTC, per the T10 decision', () => {
    expect(caption(entry())).toBe('5 September 2026');
    expect(caption(entry({ source: 'awaiting_mirror' }))).toContain('Recording on Hedera');
    expect(caption(entry({ at: null, hcs: null, source: 'mirror_unavailable' }))).toBe(
      'Cannot reach Hedera',
    );
  });
});
