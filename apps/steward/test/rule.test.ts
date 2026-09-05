import { describe, expect, it } from 'vitest';

import { compareDecimals } from '../src/decimal.js';
import { atRenewal, decide, explain, trendAt, type HistoryPoint } from '../src/rule.js';

/** The published computer and mathematical history, as the endpoint returns it. */
const history: HistoryPoint[] = [
  { period: '2024-05', odi: '0.27' },
  { period: '2024-06', odi: '0.40' },
  { period: '2024-07', odi: '0.60' },
  { period: '2024-08', odi: '0.80' },
  { period: '2024-09', odi: '0.50' },
  { period: '2025-09', odi: '0.03' },
  { period: '2026-01', odi: '0.87' },
  { period: '2026-05', odi: '0.07' },
  { period: '2026-06', odi: '-0.13' },
  { period: '2026-07', odi: '-0.07' },
];

const now = new Date('2026-09-05T12:00:00Z');

describe('compareDecimals', () => {
  it('orders values that a float would blur', () => {
    expect(compareDecimals('0.10', '0.1')).toBe(0);
    expect(compareDecimals('-0.13', '-0.07')).toBe(-1);
    expect(compareDecimals('0.80', '0.60')).toBe(1);
    expect(compareDecimals('0.3', '0.30000000000000004')).toBe(-1);
  });

  it('refuses anything that is not a decimal', () => {
    expect(() => compareDecimals('0.4', 'n/a')).toThrow(/decimal/);
  });
});

describe('trendAt', () => {
  it('reads the vantage month and the two before it, oldest first', () => {
    const trend = trendAt(history, '2024-07');
    expect(trend.periods).toEqual(['2024-05', '2024-06', '2024-07']);
    expect(trend.odi).toEqual(['0.27', '0.40', '0.60']);
    expect(trend.rising).toBe(true);
    expect(trend.unavailable).toBeNull();
  });

  it('defaults to the newest published month', () => {
    const trend = trendAt(history);
    expect(trend.asOf).toBe('2026-07');
    expect(trend.periods).toEqual(['2026-05', '2026-06', '2026-07']);
    expect(trend.rising).toBe(false);
  });

  it('is not rising when the middle month is the highest', () => {
    expect(trendAt(history, '2024-09').rising).toBe(false);
  });

  it('is not rising when two months are equal', () => {
    const flat: HistoryPoint[] = [
      { period: '2026-01', odi: '0.10' },
      { period: '2026-02', odi: '0.20' },
      { period: '2026-03', odi: '0.20' },
    ];
    expect(trendAt(flat, '2026-03').rising).toBe(false);
  });

  it('refuses to call a window with a hole in it a trend', () => {
    const trend = trendAt(history, '2026-01');
    expect(trend.rising).toBe(false);
    expect(trend.unavailable).toBe('incomplete_window');
    expect(trend.periods).toEqual(['2026-01']);
  });

  it('says when the vantage month itself has no reading', () => {
    const trend = trendAt(history, '2025-12');
    expect(trend.unavailable).toBe('no_reading_at_vantage');
  });

  it('skips a month the source published as null', () => {
    const withHole: HistoryPoint[] = [
      { period: '2025-09', odi: '0.03' },
      { period: '2025-10', odi: null },
      { period: '2025-11', odi: '0.30' },
    ];
    expect(trendAt(withHole, '2025-11').unavailable).toBe('incomplete_window');
  });
});

describe('atRenewal', () => {
  const policy = { policyId: 'pol_1', status: 'active', coverEnds: '2026-09-20' };

  it('is true inside the last thirty days of the term', () => {
    expect(atRenewal(policy, now)).toBe(true);
  });

  it('is false with a year still to run', () => {
    expect(atRenewal({ ...policy, coverEnds: '2027-09-05' }, now)).toBe(false);
  });

  it('is true once the term has ended', () => {
    expect(atRenewal({ ...policy, coverEnds: '2026-01-01' }, now)).toBe(true);
  });

  it('refuses a date that is not a calendar date', () => {
    expect(() => atRenewal({ ...policy, coverEnds: 'soon' }, now)).toThrow(/YYYY-MM-DD/);
  });
});

describe('decide', () => {
  it('buys when there is no policy and the trend is rising', () => {
    const decision = decide({ history, asOf: '2024-07', policy: null, now });
    expect(decision).toMatchObject({ buy: true, reason: 'trend_rising', atRenewal: false });
    expect(explain(decision)).toContain('the three month ODI trend is rising');
  });

  it('holds when there is no policy and the trend is not rising', () => {
    const decision = decide({ history, policy: null, now });
    expect(decision).toMatchObject({ buy: false, reason: 'trend_not_rising' });
    expect(explain(decision)).toContain('no renewal is due');
  });

  it('holds while cover is in force, whatever the trend says', () => {
    const decision = decide({
      history,
      asOf: '2024-07',
      policy: { policyId: 'pol_1', status: 'active', coverEnds: '2027-09-05' },
      now,
    });
    expect(decision).toMatchObject({ buy: false, reason: 'cover_in_force', coverInForce: true });
  });

  it('buys at the annual renewal even when the trend is flat', () => {
    const decision = decide({
      history,
      policy: { policyId: 'pol_1', status: 'active', coverEnds: '2026-09-20' },
      now,
    });
    expect(decision).toMatchObject({ buy: true, reason: 'annual_renewal', atRenewal: true });
    expect(explain(decision)).toContain('renewal window');
  });

  it('ignores a policy that lapsed rather than treating it as cover', () => {
    const decision = decide({
      history,
      asOf: '2024-07',
      policy: { policyId: 'pol_1', status: 'lapsed', coverEnds: '2027-09-05' },
      now,
    });
    expect(decision).toMatchObject({ buy: true, reason: 'trend_rising', coverInForce: false });
  });
});
