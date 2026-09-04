import { describe, expect, it } from 'vitest';

import {
  addMonths,
  assertPeriod,
  hashscanUrl,
  mirrorScheduleUrl,
  monthIndexOf,
  nextExecuteAt,
  nextPeriod,
  nextPremiumSlot,
  parsePremiumMemo,
  periodFromMonthIndex,
  periodOf,
  premiumMemo,
  premiumSlot,
  toMirrorTransactionId,
} from '../src/hedera/schedule.js';

// The chain free half of the premium chain. Everything here decides which month
// comes next and what its memo says; the network half is proved by the spike
// script in the contracts workspace against testnet.

describe('periods', () => {
  it('rejects anything that is not YYYYMM', () => {
    expect(() => assertPeriod(202613)).toThrow(/month of 1 to 12/);
    expect(() => assertPeriod(202600)).toThrow(/month of 1 to 12/);
    expect(() => assertPeriod(2026.5)).toThrow(/integer YYYYMM/);
    expect(assertPeriod(202601)).toBe(202601);
  });

  it('reads a period from a date in UTC', () => {
    expect(periodOf(new Date('2026-04-30T23:59:59Z'))).toBe(202604);
    expect(periodOf(new Date('2026-01-01T00:00:00Z'))).toBe(202601);
  });

  it('matches the CoverPool month index', () => {
    // docs/HEDERA.md: 2026-04 is year * 12 + (month - 1) = 24315.
    expect(monthIndexOf(202604)).toBe(24315);
    expect(periodFromMonthIndex(24315)).toBe(202604);
  });

  it('steps across a year boundary in both directions', () => {
    expect(nextPeriod(202612)).toBe(202701);
    expect(nextPeriod(202601)).toBe(202602);
    expect(addMonths(202611, 3)).toBe(202702);
    expect(addMonths(202601, -1)).toBe(202512);
    expect(addMonths(202606, 12)).toBe(202706);
  });
});

describe('nextExecuteAt', () => {
  it('keeps the wall clock and crosses the year', () => {
    expect(nextExecuteAt(new Date('2026-12-05T09:30:00Z')).toISOString()).toBe(
      '2027-01-05T09:30:00.000Z',
    );
  });

  it('clamps a day that the target month does not have', () => {
    expect(nextExecuteAt(new Date('2026-01-31T12:00:00Z')).toISOString()).toBe(
      '2026-02-28T12:00:00.000Z',
    );
    // 2028 is a leap year, so the clamp lands on the 29th.
    expect(nextExecuteAt(new Date('2028-01-31T12:00:00Z')).toISOString()).toBe(
      '2028-02-29T12:00:00.000Z',
    );
  });

  it('does not carry a clamp forward when stepping from the original date', () => {
    expect(nextExecuteAt(new Date('2026-01-31T12:00:00Z'), 2).toISOString()).toBe(
      '2026-03-31T12:00:00.000Z',
    );
  });

  it('steps backwards too', () => {
    expect(nextExecuteAt(new Date('2027-01-05T09:30:00Z'), -1).toISOString()).toBe(
      '2026-12-05T09:30:00.000Z',
    );
  });
});

describe('the premium memo', () => {
  it('names the policy and the period', () => {
    expect(premiumMemo('POL-0007', 202605)).toBe('creance premium POL-0007 202605');
  });

  it('round trips through the parser', () => {
    expect(parsePremiumMemo(premiumMemo('POL-0007', 202612))).toEqual({
      policyId: 'POL-0007',
      period: 202612,
    });
  });

  it('rejects a memo that is not ours or not a period', () => {
    expect(parsePremiumMemo('some other schedule')).toBeNull();
    expect(parsePremiumMemo('creance premium POL-0007 202613')).toBeNull();
    expect(parsePremiumMemo('')).toBeNull();
  });

  it('refuses a policy id that would not survive the round trip', () => {
    expect(() => premiumMemo('POL 0007', 202605)).toThrow(/policy id/);
    expect(() => premiumMemo('P'.repeat(49), 202605)).toThrow(/policy id/);
  });
});

describe('the next slot', () => {
  it('advances the month, the due date and the memo together', () => {
    const december = premiumSlot('POL-0007', 202612, new Date('2026-12-05T09:30:00Z'));
    const january = nextPremiumSlot(december);
    expect(january.period).toBe(202701);
    expect(january.executeAt.toISOString()).toBe('2027-01-05T09:30:00.000Z');
    expect(january.memo).toBe('creance premium POL-0007 202701');
  });

  it('keeps the period and the due date in step over a full year', () => {
    let slot = premiumSlot('POL-0007', 202608, new Date('2026-08-15T00:00:00Z'));
    for (let month = 0; month < 12; month += 1) {
      slot = nextPremiumSlot(slot);
    }
    expect(slot.period).toBe(202708);
    expect(slot.executeAt.toISOString()).toBe('2027-08-15T00:00:00.000Z');
  });
});

describe('links', () => {
  it('strips the scheduled suffix from a transaction id', () => {
    expect(toMirrorTransactionId('0.0.1234@1615422161.673238162?scheduled')).toBe(
      '0.0.1234-1615422161-673238162',
    );
    expect(toMirrorTransactionId('0.0.1234@1615422161.673238162')).toBe(
      '0.0.1234-1615422161-673238162',
    );
    expect(() => toMirrorTransactionId('0.0.1234-1615422161-673238162')).toThrow(/expected a/);
  });

  it('builds the explorer and mirror node routes', () => {
    expect(hashscanUrl('schedule', '0.0.10367416')).toBe(
      'https://hashscan.io/testnet/schedule/0.0.10367416',
    );
    expect(mirrorScheduleUrl('https://testnet.mirrornode.hedera.com/api/v1/', '0.0.1')).toBe(
      'https://testnet.mirrornode.hedera.com/api/v1/schedules/0.0.1',
    );
  });
});
