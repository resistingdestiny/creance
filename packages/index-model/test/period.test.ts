import { describe, expect, it } from 'vitest';

import {
  addMonths,
  comparePeriods,
  monthOf,
  periodFromBls,
  periodIndex,
  periodRange,
  yearOf,
} from '../src/period.js';

describe('periods', () => {
  it('steps by the calendar, so t-12 is the same month a year earlier', () => {
    expect(addMonths('2026-04', -12)).toBe('2025-04');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2025-12', 1)).toBe('2026-01');
    expect(addMonths('2026-01', -12)).toBe('2025-01');
    expect(periodIndex('2026-04') - periodIndex('2025-04')).toBe(12);
  });

  it('reads the calendar month and year out of a period', () => {
    expect(monthOf('2026-04')).toBe(4);
    expect(monthOf('2026-12')).toBe(12);
    expect(monthOf('2026-01')).toBe(1);
    expect(yearOf('2026-04')).toBe(2026);
  });

  it('builds an inclusive ascending range', () => {
    expect(periodRange('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(periodRange('2010-01', '2019-12')).toHaveLength(120);
    expect(periodRange('2010-01', '2026-07')).toHaveLength(199);
    expect(periodRange('2000-01', '2026-07')).toHaveLength(319);
    expect(comparePeriods('2025-09', '2026-01')).toBeLessThan(0);
  });

  it('drops the M13 annual average and keeps the twelve months', () => {
    expect(periodFromBls('2026', 'M07')).toBe('2026-07');
    expect(periodFromBls('2026', 'M13')).toBeNull();
    expect(periodFromBls('2026', 'Q01')).toBeNull();
  });

  it('rejects anything that is not a month', () => {
    expect(() => periodIndex('2026-13')).toThrow();
    expect(() => periodIndex('2026-1')).toThrow();
    expect(() => periodIndex('2026')).toThrow();
  });
});
