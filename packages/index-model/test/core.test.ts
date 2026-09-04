import { describe, expect, it } from 'vitest';

import {
  computeSeries,
  ratesOf,
  smooth,
  type Observation,
  type SeriesInput,
} from '../src/core.js';
import type { Period } from '../src/period.js';

/**
 * Synthetic series with the arithmetic worked in the test body. The rates are
 * chosen so every intermediate value is a round number a reader can check.
 */
const AGGREGATE: Record<Period, number> = {
  '2024-11': 5.0,
  '2024-12': 5.0,
  '2025-01': 5.0,
  '2025-02': 5.0,
  '2025-03': 5.0,
  '2025-11': 5.0,
  '2025-12': 5.0,
  '2026-01': 5.0,
  '2026-02': 5.0,
  '2026-03': 5.0,
};

const GROUP: Record<Period, number> = {
  '2024-11': 5.0,
  '2024-12': 5.0,
  '2025-01': 5.0, // e 0.00
  '2025-02': 5.3, // e 0.30
  '2025-03': 5.6, // e 0.60   ebar = (0.60 + 0.30 + 0.00) / 3 = 0.30
  '2025-11': 6.0,
  '2025-12': 6.0,
  '2026-01': 6.0, // e 1.00
  '2026-02': 6.4, // e 1.40
  '2026-03': 6.8, // e 1.80   ebar = (1.80 + 1.40 + 1.00) / 3 = 4.20 / 3 = 1.40
  //                          odi  = 1.40 - 0.30 = 1.10
};

function input(overrides: Partial<SeriesInput> = {}, group = GROUP): SeriesInput {
  return {
    groupKey: 'synthetic',
    seriesId: 'SYN0000',
    groupRates: new Map(Object.entries(group)),
    aggregateRates: new Map(Object.entries(AGGREGATE)),
    parameters: { attachmentShock: 1.1, levelLine: 1.4 },
    ...overrides,
  };
}

function at(rows: Observation[], period: Period): Observation {
  const row = rows.find((r) => r.period === period);
  if (!row) throw new Error(`no observation for ${period}`);
  return row;
}

describe('the arithmetic', () => {
  it('computes e, ebar and odi as three lines of algebra', () => {
    const rows = computeSeries(input(), '2025-03', '2026-03');
    const march = at(rows, '2026-03');
    expect(march.e).toBe(1.8); //  6.8 - 5.0
    expect(march.ebar).toBe(1.4); // (1.80 + 1.40 + 1.00) / 3
    expect(march.ebarBase).toBe(0.3); // ebar for 2025-03
    expect(march.odi).toBe(1.1); // 1.40 - 0.30
    expect(march.status).toBe('final');
  });

  it('opens on equality, on both forms, and calls the reason both', () => {
    // L is exactly the ebar and A is exactly the odi, so a comparison written
    // with > instead of >= loses this month twice over.
    const rows = computeSeries(input(), '2026-03', '2026-03');
    const march = at(rows, '2026-03');
    expect(march.levelOpen).toBe(true);
    expect(march.shockOpen).toBe(true);
    expect(march.open).toBe(true);
    expect(march.openReason).toBe('both');
    expect(march.forms).toEqual(['shock', 'level']);
  });

  it('names the level form when only the level form holds', () => {
    // A one notch above the odi of 1.10; L unchanged.
    const rows = computeSeries(
      input({ parameters: { attachmentShock: 1.11, levelLine: 1.4 } }),
      '2026-03',
      '2026-03',
    );
    const march = at(rows, '2026-03');
    expect(march.openReason).toBe('level');
    expect(march.shockOpen).toBe(false);
  });

  it('names the shock form when only the shock form holds', () => {
    const rows = computeSeries(
      input({ parameters: { attachmentShock: 1.1, levelLine: 1.41 } }),
      '2026-03',
      '2026-03',
    );
    const march = at(rows, '2026-03');
    expect(march.openReason).toBe('shock');
    expect(march.levelOpen).toBe(false);
  });

  it('stays closed when neither form holds', () => {
    const rows = computeSeries(
      input({ parameters: { attachmentShock: 2, levelLine: 2 } }),
      '2026-03',
      '2026-03',
    );
    const march = at(rows, '2026-03');
    expect(march.open).toBe(false);
    expect(march.openReason).toBe('none');
    // The forms were both evaluable; they simply did not trigger.
    expect(march.forms).toEqual(['shock', 'level']);
  });
});

describe('missing months', () => {
  const withHole = { ...GROUP };
  delete (withHole as Record<string, number>)['2026-02'];

  it('reports no_source for a month the source does not carry', () => {
    const rows = computeSeries(input({}, withHole), '2026-01', '2026-03');
    const february = at(rows, '2026-02');
    expect(february.status).toBe('no_source');
    expect(february.uG).toBeNull();
    expect(february.e).toBeNull();
    expect(february.ebar).toBeNull();
    expect(february.odi).toBeNull();
    expect(february.open).toBe(false);
    expect(february.forms).toEqual([]);
  });

  it('never slides the window over a hole', () => {
    // The three most recent available months for 2026-03 are 2026-03, 2026-01
    // and 2025-12. The window is t, t-1, t-2 by the calendar, so there is no
    // ebar at all, and the hop-over reading would have produced one.
    const rows = computeSeries(input({}, withHole), '2026-01', '2026-03');
    const march = at(rows, '2026-03');
    expect(march.ebar).toBeNull();
    expect(march.status).toBe('insufficient_history');
    expect(march.e).toBe(1.8);
    const hopOver = (1.8 + 1.0 + 1.0) / 3;
    expect(march.ebar).not.toBe(hopOver);
  });

  it('publishes the level form alone when the base year is missing', () => {
    const noBase = { ...GROUP };
    delete (noBase as Record<string, number>)['2025-01'];
    const rows = computeSeries(input({}, noBase), '2026-03', '2026-03');
    const march = at(rows, '2026-03');
    // ebar at t is intact; ebar at t-12 is not, because 2025-03 needs 2025-01.
    expect(march.ebar).toBe(1.4);
    expect(march.ebarBase).toBeNull();
    expect(march.odi).toBeNull();
    expect(march.forms).toEqual(['level']);
    expect(march.status).toBe('final');
    // The level comparison still runs.
    expect(march.levelOpen).toBe(true);
    expect(march.openReason).toBe('level');
  });

  it('has no ebar for either of the two months after a hole', () => {
    const rows = computeSeries(input({}, withHole), '2026-02', '2026-03');
    expect(at(rows, '2026-02').ebar).toBeNull();
    expect(at(rows, '2026-03').ebar).toBeNull();
  });
});

describe('smooth', () => {
  it('needs all three calendar months', () => {
    const e = new Map<Period, number>([
      ['2026-01', 1],
      ['2026-02', 2],
      ['2026-03', 3],
    ]);
    expect(smooth(e, '2026-03')).toBe(2);
    expect(smooth(e, '2026-02')).toBeNull();
  });
});

describe('the month-matched level line', () => {
  it('compares a March reading with the March line', () => {
    // Twelve lines, all unreachable except March, which sits exactly on the ebar.
    const byMonth = Array.from({ length: 12 }, (_, i) => (i === 2 ? 1.4 : 9));
    const rows = computeSeries(
      input({ parameters: { attachmentShock: 9, levelLine: 9, levelLineByMonth: byMonth } }),
      '2026-03',
      '2026-03',
      { levelLineMode: 'month_matched', baseEffectGuard: false },
    );
    const march = at(rows, '2026-03');
    expect(march.levelLine).toBe(1.4);
    expect(march.levelOpen).toBe(true);
  });

  it('refuses a month-matched run without twelve lines', () => {
    expect(() =>
      computeSeries(input(), '2026-03', '2026-03', {
        levelLineMode: 'month_matched',
        baseEffectGuard: false,
      }),
    ).toThrow(/twelve level lines/);
  });
});

describe('the base-effect guard', () => {
  // Base year raised so that 2025-03 itself opens: e 3.00, 3.30, 3.60 gives an
  // ebar of 3.30, above a level line of 1.40.
  const shockedBase: Record<Period, number> = {
    ...GROUP,
    '2025-01': 8.0,
    '2025-02': 8.3,
    '2025-03': 8.6,
  };

  it('suppresses a shock-only opening whose base period was itself open', () => {
    // ebar 2026-03 stays 1.40 and ebar 2025-03 becomes 3.30, so the odi is
    // 1.40 - 3.30 = -1.90. A level line of 3.00 opens the base period and leaves
    // 2026-03 closed on the level form, and an A of -2.00 opens 2026-03 on the
    // shock form alone, which is exactly the case the guard is for.
    const parameters = { attachmentShock: -2, levelLine: 3 };
    const unguarded = computeSeries(input({ parameters }, shockedBase), '2026-03', '2026-03', {
      levelLineMode: 'single',
      baseEffectGuard: false,
    });
    expect(at(unguarded, '2026-03').shockOpen).toBe(true);
    expect(at(unguarded, '2026-03').openReason).toBe('shock');

    const guarded = computeSeries(input({ parameters }, shockedBase), '2026-03', '2026-03', {
      levelLineMode: 'single',
      baseEffectGuard: true,
    });
    const march = at(guarded, '2026-03');
    expect(march.shockOpen).toBe(false);
    expect(march.open).toBe(false);
    expect(march.guardSuppressed).toBe(true);
  });

  it('leaves an opening alone when the level form also holds', () => {
    const parameters = { attachmentShock: -2, levelLine: 1.4 };
    const guarded = computeSeries(input({ parameters }, shockedBase), '2026-03', '2026-03', {
      levelLineMode: 'single',
      baseEffectGuard: true,
    });
    const march = at(guarded, '2026-03');
    expect(march.open).toBe(true);
    expect(march.openReason).toBe('both');
    expect(march.guardSuppressed).toBeUndefined();
  });
});

describe('ratesOf', () => {
  it('drops the months with no value rather than storing a zero', () => {
    const rates = ratesOf([
      { period: '2025-09', value: 4.3 },
      { period: '2025-10', value: null },
      { period: '2025-11', value: 4.3 },
    ]);
    expect(rates.size).toBe(2);
    expect(rates.has('2025-10')).toBe(false);
    expect(rates.get('2025-10')).toBeUndefined();
  });
});
