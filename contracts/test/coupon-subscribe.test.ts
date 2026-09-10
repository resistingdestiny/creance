import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CouponContext, Party } from '../coupons/context.js';
import type { SubscriptionRecord } from '../coupons/record.js';
import type { DeploymentRecord, SeriesRecord } from '../scripts/deploy/record.js';

/// `subscribe` is the only step that talks to the vault, so the vault module is
/// the seam. Everything else in the step is bookkeeping over the record, which
/// is what these tests are about: the subscription has to land on the series
/// the API reads, and it has to be saved before the next investor is touched.
const subscribeInvestor = vi.fn();
vi.mock('../coupons/vault.js', () => ({
  subscribeInvestor: (...args: unknown[]) => subscribeInvestor(...args) as unknown,
}));

const { subscribe } = await import('../coupons/subscribe.js');

function party(role: string): Party {
  return { role, accountId: `0.0.${role}`, address: `0x${role}` } as unknown as Party;
}

function subscription(role: string): SubscriptionRecord {
  return {
    role,
    accountId: `0.0.${role}`,
    address: `0x${role}`,
    amount: '50000000000',
    subscribeTx: `0x${role}tx`,
  };
}

function makeContext(): { context: CouponContext; series: SeriesRecord; saves: number[] } {
  const series = {
    id: '0xseries',
    label: 'ODI-COMP-2026-01',
    group: 'computer-and-mathematical',
  } as SeriesRecord;
  const record = { network: 'testnet', chainId: 296, series: [series] } as DeploymentRecord;
  // Each save records how many subscriptions were on the series at the moment
  // it was called, which is how the ordering assertions below read.
  const saves: number[] = [];
  const context = {
    record,
    investors: [party('investor-1'), party('investor-2')],
    vault: {
      getFunction: () => async () => ({ principalFunded: 100_000_000_000n }),
    },
    save: () => saves.push(series.subscriptions?.length ?? 0),
  } as unknown as CouponContext;
  return { context, series, saves };
}

beforeEach(() => {
  subscribeInvestor.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('subscribe', () => {
  it('writes each subscription onto the series rather than the record', async () => {
    const { context, series, saves } = makeContext();
    subscribeInvestor
      .mockResolvedValueOnce(subscription('investor-1'))
      .mockResolvedValueOnce(subscription('investor-2'));

    await subscribe(context);

    expect(series.subscriptions?.map((entry) => entry.role)).toEqual([
      'investor-1',
      'investor-2',
    ]);
    // The record itself carries no subscriptions field: an entry written there
    // is invisible to the API, which reads them off the series.
    expect((context.record as Record<string, unknown>).subscriptions).toBeUndefined();
    expect(saves).toEqual([1, 2]);
  });

  it('saves the first subscription before the second investor is subscribed', async () => {
    const { context, series, saves } = makeContext();
    // The money has already moved by the time the record is written, so a
    // failure on the second investor must not lose the first.
    subscribeInvestor
      .mockResolvedValueOnce(subscription('investor-1'))
      .mockRejectedValueOnce(new Error('relay timeout'));

    await expect(subscribe(context)).rejects.toThrow('relay timeout');

    expect(series.subscriptions?.map((entry) => entry.role)).toEqual(['investor-1']);
    expect(saves).toEqual([1]);
  });

  it('replaces the entry for a role rather than appending a second one', async () => {
    const { context, series } = makeContext();
    series.subscriptions = [{ ...subscription('investor-1'), amount: '1' }];
    subscribeInvestor
      .mockResolvedValueOnce({ ...subscription('investor-1'), amount: '2' })
      .mockResolvedValueOnce(subscription('investor-2'));

    await subscribe(context);

    expect(series.subscriptions?.map((entry) => entry.role)).toEqual([
      'investor-1',
      'investor-2',
    ]);
    expect(series.subscriptions?.[0]?.amount).toBe('2');
  });

  it('leaves the record alone for an investor who is already subscribed', async () => {
    const { context, series, saves } = makeContext();
    // subscribeInvestor returns null when the chain already carries the wanted
    // subscription, and the step must not write or save for that investor.
    subscribeInvestor.mockResolvedValueOnce(null).mockResolvedValueOnce(subscription('investor-2'));

    await subscribe(context);

    expect(series.subscriptions?.map((entry) => entry.role)).toEqual(['investor-2']);
    expect(saves).toEqual([1]);
  });
});
