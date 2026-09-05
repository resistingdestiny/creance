import { describe, expect, it } from 'vitest';

import { STALE_AFTER_DAYS, ageInDays, endOfPeriod, staleness } from '../src/staleness.js';

/// The archive's newest period is 2026-07 and the event is on 2026-09-05, so
/// the numbers here are the ones the deployed index actually reports.

describe('the age of the newest period', () => {
  it('is measured from the end of the reference month', () => {
    expect(endOfPeriod('2026-07').toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(endOfPeriod('2026-12').toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('is 35 days for 2026-07 on the day of the event', () => {
    expect(ageInDays('2026-07', new Date('2026-09-05T12:00:00Z'))).toBe(35);
  });

  it('is zero, not negative, inside the reference month itself', () => {
    expect(ageInDays('2026-09', new Date('2026-09-05T12:00:00Z'))).toBe(0);
  });
});

describe('the staleness line', () => {
  it('holds at 45 days and trips at 46', () => {
    const at45 = staleness('2026-07', new Date('2026-09-15T00:00:00Z'));
    expect(at45.stale_days).toBe(STALE_AFTER_DAYS);
    expect(at45.stale).toBe(false);

    const at46 = staleness('2026-07', new Date('2026-09-16T00:00:00Z'));
    expect(at46.stale_days).toBe(46);
    expect(at46.stale).toBe(true);
  });

  it('reports the demo deployment as fresh on the day of the event', () => {
    expect(staleness('2026-07', new Date('2026-09-05T12:00:00Z'))).toEqual({
      newest_period: '2026-07',
      stale_days: 35,
      stale: false,
      stale_after_days: 45,
    });
  });

  it('does not call a clone that has published nothing stale', () => {
    expect(staleness(null, new Date('2026-09-05T12:00:00Z'))).toEqual({
      newest_period: null,
      stale_days: null,
      stale: false,
      stale_after_days: 45,
    });
  });
});
