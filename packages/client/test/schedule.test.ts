import { Client } from '@hiero-ledger/sdk';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

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
  premiumExecution,
  premiumSlot,
  scheduleNext,
  scheduleTransfer,
  toMirrorTransactionId,
  waitForExecution,
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

  it('comes back out of February on its own day of month', () => {
    // Chaining is where a clamp turns into permanent drift: 28 February must not
    // become 28 March for the rest of the term.
    let slot = premiumSlot('POL-0007', 202601, new Date('2026-01-31T12:00:00Z'));
    const dates: string[] = [];
    for (let month = 0; month < 4; month += 1) {
      slot = nextPremiumSlot(slot);
      dates.push(slot.executeAt.toISOString());
    }
    expect(dates).toEqual([
      '2026-02-28T12:00:00.000Z',
      '2026-03-31T12:00:00.000Z',
      '2026-04-30T12:00:00.000Z',
      '2026-05-31T12:00:00.000Z',
    ]);
    expect(slot.dueDay).toBe(31);
    expect(slot.period).toBe(202605);
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

describe('scheduleTransfer argument guards', () => {
  // Every one of these throws before the client is used, so the suite stays
  // chain free. The network half is proved by pnpm hedera:schedule.
  const client = Client.forTestnet();
  const base = {
    client,
    tokenId: '0.0.10366463',
    to: '0.0.10366451',
    amount: 1_000_000n,
    executeAt: new Date('2026-10-04T18:58:25Z'),
    memo: 'creance premium POL-0007 202610',
  };
  const payer = { accountId: '0.0.10366453' };

  afterAll(() => {
    client.close();
  });

  it('refuses an amount that is not positive', async () => {
    await expect(scheduleTransfer({ ...base, payer, amount: 0n })).rejects.toThrow(
      /positive amount/,
    );
  });

  it('refuses a memo over the 100 byte cap', async () => {
    await expect(
      scheduleTransfer({ ...base, payer, memo: 'x'.repeat(101) }),
    ).rejects.toThrow(/over 100 bytes/);
  });

  it('refuses to pre-sign without the payer key', async () => {
    await expect(scheduleTransfer({ ...base, payer })).rejects.toThrow(/needs the payer key/);
  });
});

// -- The settlement gate -----------------------------------------------------

interface StubSchedule {
  executed_timestamp: string | null;
  deleted?: boolean;
}

/**
 * A mirror node that answers the two endpoints waitForExecution reads. No
 * network: `transactions` is what /transactions returns for the execution
 * timestamp, and an empty list is an execution the mirror node has not indexed.
 */
function stubMirror(schedule: StubSchedule, transactions: unknown[]): void {
  vi.stubGlobal('fetch', async (url: string) => {
    const body = url.includes('/schedules/')
      ? { schedule_id: '0.0.1', deleted: false, ...schedule }
      : { transactions };
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
}

const MIRROR = 'https://testnet.mirrornode.hedera.com/api/v1';
const POLL = { attempts: 3, delayMs: 1 };

describe('waitForExecution', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('settles an execution whose transfer succeeded', async () => {
    stubMirror({ executed_timestamp: '1788548305.112642208' }, [
      { transaction_id: '0.0.7-1788548118-155677633', result: 'SUCCESS', scheduled: true },
    ]);
    const execution = await waitForExecution(MIRROR, '0.0.1', POLL);
    expect(execution).toMatchObject({
      result: 'SUCCESS',
      settled: true,
      executedTransactionId: '0.0.7-1788548118-155677633',
    });
    expect(execution?.link).toBe(
      'https://hashscan.io/testnet/transaction/0.0.7-1788548118-155677633',
    );
  });

  it('does not settle an execution whose transfer failed', async () => {
    // The schedule ran, the money did not move. This is the case the docs
    // describe: an underfunded payer still gets a successful schedule.
    stubMirror({ executed_timestamp: '1788548305.112642208' }, [
      {
        transaction_id: '0.0.7-1788548118-155677633',
        result: 'INSUFFICIENT_TOKEN_BALANCE',
        scheduled: true,
      },
    ]);
    const execution = await waitForExecution(MIRROR, '0.0.1', POLL);
    expect(execution?.result).toBe('INSUFFICIENT_TOKEN_BALANCE');
    expect(execution?.settled).toBe(false);
  });

  it('ignores the create when it looks for the transfer', async () => {
    stubMirror({ executed_timestamp: '1788548305.112642208' }, [
      { transaction_id: '0.0.7-1788548118-155677633', result: 'SUCCESS', scheduled: false },
      {
        transaction_id: '0.0.7-1788548118-155677633',
        result: 'INSUFFICIENT_PAYER_BALANCE',
        scheduled: true,
      },
    ]);
    const execution = await waitForExecution(MIRROR, '0.0.1', POLL);
    expect(execution?.result).toBe('INSUFFICIENT_PAYER_BALANCE');
    expect(execution?.settled).toBe(false);
  });

  it('reports an execution the mirror node never showed as unknown, never as paid', async () => {
    stubMirror({ executed_timestamp: '1788548305.112642208' }, []);
    const execution = await waitForExecution(MIRROR, '0.0.1', POLL);
    expect(execution).toMatchObject({
      result: 'UNKNOWN',
      settled: false,
      executedTransactionId: '',
      link: '',
    });
  });

  it('returns null while nothing has executed', async () => {
    stubMirror({ executed_timestamp: null }, []);
    expect(await waitForExecution(MIRROR, '0.0.1', POLL)).toBeNull();
  });

  it('returns null for a schedule that was deleted before it ran', async () => {
    stubMirror({ executed_timestamp: null, deleted: true }, []);
    expect(await waitForExecution(MIRROR, '0.0.1', POLL)).toBeNull();
  });
});

describe('premiumExecution', () => {
  it('carries the policy and period from the slot and the settlement from the chain', () => {
    const slot = premiumSlot('POL-0007', 202610, new Date('2026-10-04T18:58:25Z'));
    const premium = premiumExecution(
      {
        scheduleId: '0.0.1',
        executedAt: '1788548305.112642208',
        executedTransactionId: '0.0.7-1788548118-155677633',
        result: 'INSUFFICIENT_TOKEN_BALANCE',
        settled: false,
        link: '',
      },
      slot,
    );
    expect(premium.policyId).toBe('POL-0007');
    expect(premium.period).toBe(202610);
    expect(premium.settled).toBe(false);
  });
});

describe('scheduleNext routes an execution by its settlement', () => {
  const client = Client.forTestnet();
  const slot = premiumSlot('POL-0007', 202610, new Date('2026-10-04T18:58:25Z'));

  // The callbacks run before the next month is created, and the create here is
  // given an amount it refuses, so the routing is observable without the chain.
  const params = {
    client,
    mirrorUrl: MIRROR,
    scheduleId: '0.0.1',
    slot,
    tokenId: '0.0.10366463',
    payer: { accountId: '0.0.10366453' },
    to: '0.0.10366451',
    amount: 0n,
    poll: POLL,
  };

  afterAll(() => {
    client.close();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hands a settled premium to onExecuted', async () => {
    stubMirror({ executed_timestamp: '1788548305.112642208' }, [
      { transaction_id: '0.0.7-1788548118-155677633', result: 'SUCCESS', scheduled: true },
    ]);
    const onExecuted = vi.fn();
    const onFailed = vi.fn();
    await expect(scheduleNext({ ...params, onExecuted, onFailed })).rejects.toThrow(
      /positive amount/,
    );
    expect(onExecuted).toHaveBeenCalledTimes(1);
    expect(onExecuted.mock.calls[0]?.[0]).toMatchObject({ policyId: 'POL-0007', period: 202610 });
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('never hands a failed premium to onExecuted', async () => {
    stubMirror({ executed_timestamp: '1788548305.112642208' }, [
      {
        transaction_id: '0.0.7-1788548118-155677633',
        result: 'INSUFFICIENT_TOKEN_BALANCE',
        scheduled: true,
      },
    ]);
    const onExecuted = vi.fn();
    const onFailed = vi.fn();
    await expect(scheduleNext({ ...params, onExecuted, onFailed })).rejects.toThrow(
      /positive amount/,
    );
    expect(onExecuted).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('never hands an unknown result to onExecuted', async () => {
    stubMirror({ executed_timestamp: '1788548305.112642208' }, []);
    const onExecuted = vi.fn();
    const onFailed = vi.fn();
    await expect(scheduleNext({ ...params, onExecuted, onFailed })).rejects.toThrow(
      /positive amount/,
    );
    expect(onExecuted).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed.mock.calls[0]?.[0]).toMatchObject({ result: 'UNKNOWN', settled: false });
  });
});
