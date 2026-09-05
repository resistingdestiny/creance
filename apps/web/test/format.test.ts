import { describe, expect, it } from 'vitest';

import {
  formatAmount,
  formatDay,
  formatDayWithYear,
  formatIndexValue,
  formatMoney,
  formatPercent,
  formatPeriod,
  formatPeriodShort,
  formatWholeMoney,
  shortenAddress,
} from '../src/lib/format.js';

describe('dates', () => {
  it('formats a day as day and month', () => {
    expect(formatDay('2026-10-04')).toBe('4 October');
  });

  it('formats a day the same way west of Greenwich', () => {
    // The timezone trap: new Date("2026-10-04") is UTC midnight, which a
    // browser in Los Angeles would otherwise render as 3 October.
    const before = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(formatDay('2026-10-04')).toBe('4 October');
      expect(formatDayWithYear('2027-09-04')).toBe('4 September 2027');
      expect(formatPeriod('2026-04')).toBe('April 2026');
    } finally {
      process.env.TZ = before;
    }
  });

  it('formats a term end with the year', () => {
    expect(formatDayWithYear('2027-09-04')).toBe('4 September 2027');
  });

  it('formats an index period', () => {
    expect(formatPeriod('2026-04')).toBe('April 2026');
  });

  it('formats a chart axis label short', () => {
    expect(formatPeriodShort('2025-01')).toBe('Jan 2025');
    // en-GB abbreviates September to four letters. See docs/harness-notes.md.
    expect(formatPeriodShort('2024-09')).toBe('Sept 2024');
  });

  it('rejects anything that is not a date-only string', () => {
    expect(() => formatDay('2026-10-04T00:00:00Z')).toThrow(RangeError);
    expect(() => formatPeriod('2026-4')).toThrow(RangeError);
  });
});

describe('money', () => {
  it('renders minor units at two decimals with separators and no symbol', () => {
    expect(formatMoney(28_000_000n)).toBe('28.00');
    expect(formatMoney(5_000_000_000n)).toBe('5,000.00');
    expect(formatMoney(100_000_000_000n)).toBe('100,000.00');
  });

  it('keeps a trailing zero and the fractional part', () => {
    expect(formatMoney(28_500_000n)).toBe('28.50');
    expect(formatMoney(1_234_567n)).toBe('1.23');
  });

  it('uses the ASCII hyphen-minus for a negative', () => {
    expect(formatMoney(-28_000_000n)).toBe('-28.00');
    expect(formatMoney(-28_000_000n).charCodeAt(0)).toBe(0x002d);
  });

  it('formats a whole cover amount without decimals', () => {
    expect(formatAmount(5000)).toBe('5,000');
    expect(formatAmount(10_000)).toBe('10,000');
  });
});

describe('index values', () => {
  it('always renders two decimals including trailing zeros', () => {
    expect(formatIndexValue(0.3)).toBe('0.30');
    expect(formatIndexValue('2')).toBe('2.00');
    expect(formatIndexValue(1.1)).toBe('1.10');
  });

  it('uses U+002D for a negative and never a bare decimal point', () => {
    expect(formatIndexValue(-0.68)).toBe('-0.68');
    expect(formatIndexValue(-0.68).charCodeAt(0)).toBe(0x002d);
    expect(formatIndexValue(-0.004)).toBe('0.00');
  });
});

describe('percent and addresses', () => {
  it('spells percent as a word', () => {
    expect(formatPercent(8)).toBe('8 percent');
    expect(formatPercent(100)).toBe('100 percent');
    expect(formatPercent(8)).not.toContain('%');
  });

  it('shortens an address to the first four and the last four', () => {
    expect(shortenAddress('0x7A3F2b19c40aa9e01f4c7d2e5a6b8c9d0e1f2D21B')).toBe('0x7A3F…D21B');
    expect(shortenAddress('0xcad39730d48683b13e6077a70c6972add449b6f5')).toBe('0xcad3…b6f5');
  });

  it('joins the halves with U+2026', () => {
    expect(shortenAddress('0xcad39730d48683b13e6077a70c6972add449b6f5')).toContain('…');
  });

  it('leaves an address that is already short alone', () => {
    expect(shortenAddress('0x1234')).toBe('0x1234');
  });
});

describe('formatWholeMoney', () => {
  it('writes a principal the way the investor copy deck writes it', () => {
    expect(formatWholeMoney(100_000_000_000n)).toBe('100,000');
    expect(formatWholeMoney(92_500_000_000n)).toBe('92,500');
    expect(formatWholeMoney(0n)).toBe('0');
  });

  it('keeps the decimals when there is a fraction to show', () => {
    expect(formatWholeMoney(92_500_250_000n)).toBe('92,500.25');
    expect(formatWholeMoney(328_767_123n)).toBe('328.77');
  });

  it('uses the ASCII hyphen-minus for a negative', () => {
    expect(formatWholeMoney(-5_000_000_000n)).toBe('-5,000');
  });
});
