import { describe, expect, it } from 'vitest';

import {
  encodeJournalMessage,
  journalMessage,
  MAX_JOURNAL_MESSAGE_BYTES,
  type BoundCycle,
} from '../src/journal.js';
import { decide, type HistoryPoint } from '../src/rule.js';

const history: HistoryPoint[] = [
  { period: '2024-05', odi: '0.27' },
  { period: '2024-06', odi: '0.40' },
  { period: '2024-07', odi: '0.60' },
];

const now = new Date('2026-09-05T13:22:41.000Z');
const buy = decide({ history, asOf: '2024-07', policy: null, now });
const hold = decide({
  history,
  policy: { policyId: 'pol_01M1', status: 'active', coverEnds: '2027-09-05' },
  asOf: '2024-07',
  now,
});

const bound: BoundCycle = {
  quoteId: 'qte_01M1EXAMPLE0000000000000',
  policyId: 'pol_01M1EXAMPLE0000000000000',
  nft: { tokenId: '0.0.10366465', serial: 12 },
  premium: { amount: '841667', asset: '0.0.10366463', decimals: 6 },
  cadence: 'demo',
  schedules: [
    { id: '0.0.10370001', period: 202610 },
    { id: '0.0.10370002', period: 202611 },
    { id: '0.0.10370003', period: 202612 },
  ],
  deferred: [],
};

const settlements = {
  index: '0.0.7162784@1788602390.475160190',
  quote: '0.0.7162784@1788602392.809335465',
  premium: '0.0.7162784@1788602397.120605122',
};

const input = {
  agent: '0.0.10366451',
  principal: { wallet: '0.0.10366457', group: 'computer_math' },
  eligibility: 'api_demo_issuer',
  replay: true,
  at: now,
};

describe('journalMessage', () => {
  it('carries the rule inputs and the decision', () => {
    const message = journalMessage({ ...input, decision: buy, settlements, bound });
    expect(message.rule).toEqual({
      as_of: '2024-07',
      periods: ['2024-05', '2024-06', '2024-07'],
      odi: ['0.27', '0.40', '0.60'],
      rising: true,
      cover_in_force: false,
      at_renewal: false,
      decision: 'buy',
      reason: 'trend_rising',
      replay: true,
    });
  });

  it('carries the three settlements, the policy, the NFT and the schedules', () => {
    const message = journalMessage({ ...input, decision: buy, settlements, bound });
    expect(message.settlements).toEqual(settlements);
    expect(message.policy_id).toBe('pol_01M1EXAMPLE0000000000000');
    expect(message.nft).toEqual({ token_id: '0.0.10366465', serial: 12 });
    expect(message.schedules?.map((schedule) => schedule.period)).toEqual([202610, 202611, 202612]);
  });

  it('carries the premium as an amount with its asset and scale', () => {
    const message = journalMessage({ ...input, decision: buy, settlements, bound });
    expect(message.premium).toEqual({
      amount: '841667',
      asset: '0.0.10366463',
      decimals: 6,
      display: '0.841667',
    });
  });

  it('names where the credential came from and never the credential', () => {
    const text = encodeJournalMessage(
      journalMessage({ ...input, decision: buy, settlements, bound }),
    );
    expect(text).toContain('"eligibility":"api_demo_issuer"');
    expect(text).not.toContain('nullifier');
  });

  it('records the periods the 62 day cap deferred', () => {
    const message = journalMessage({
      ...input,
      decision: buy,
      settlements,
      bound: { ...bound, cadence: 'monthly', schedules: bound.schedules.slice(0, 2), deferred: [202612] },
    });
    expect(message.deferred).toEqual([202612]);
  });

  it('is a full entry for a run that held, with the index read it paid for', () => {
    const message = journalMessage({
      ...input,
      decision: hold,
      settlements: { index: settlements.index },
    });
    expect(message.rule.decision).toBe('hold');
    expect(message.rule.reason).toBe('cover_in_force');
    expect(message.policy_id).toBeUndefined();
    expect(message.settlements.quote).toBeUndefined();
  });

  it('fits inside one HCS message', () => {
    const text = encodeJournalMessage(
      journalMessage({ ...input, decision: buy, settlements, bound }),
    );
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(MAX_JOURNAL_MESSAGE_BYTES);
  });

  it('refuses an entry that would have to be chunked', () => {
    const message = journalMessage({ ...input, decision: buy, settlements, bound });
    message.schedules = Array.from({ length: 40 }, (_unused, index) => ({
      id: `0.0.1037${index}`,
      period: 202610 + index,
    }));
    expect(() => encodeJournalMessage(message)).toThrow(/over the 1024 cap/);
  });
});
