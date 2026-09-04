/**
 * Periods are calendar months written "YYYY-MM". Every window in the index is a
 * calendar window: the smoothing window is t, t-1 and t-2 by the calendar and
 * never "the last three months that happen to have data". Arithmetic therefore
 * goes through a month index rather than through row offsets in a source file,
 * because the October 2025 collection gap shifts row offsets and does not shift
 * the calendar.
 */
export type Period = string;

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Months since January of year zero, so that t-12 is always twelve months back. */
export function periodIndex(period: Period): number {
  const match = PERIOD_RE.exec(period);
  if (!match) throw new Error(`not a period: ${period}`);
  return Number(match[1]) * 12 + (Number(match[2]) - 1);
}

export function periodFromIndex(index: number): Period {
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function addMonths(period: Period, months: number): Period {
  return periodFromIndex(periodIndex(period) + months);
}

export function isPeriod(value: string): boolean {
  return PERIOD_RE.test(value);
}

/** The calendar month as 1 to 12, used by the month-matched level lines. */
export function monthOf(period: Period): number {
  return periodIndex(period) % 12 + 1;
}

export function yearOf(period: Period): number {
  return Math.floor(periodIndex(period) / 12);
}

/** Inclusive at both ends, ascending. */
export function periodRange(from: Period, to: Period): Period[] {
  const first = periodIndex(from);
  const last = periodIndex(to);
  const out: Period[] = [];
  for (let i = first; i <= last; i += 1) out.push(periodFromIndex(i));
  return out;
}

export function comparePeriods(a: Period, b: Period): number {
  return periodIndex(a) - periodIndex(b);
}

/**
 * BLS writes monthly periods as M01 to M12 and annual averages as M13. M13 is
 * not a month and is dropped rather than folded into December.
 */
export function periodFromBls(year: string, blsPeriod: string): Period | null {
  if (!/^M(0[1-9]|1[0-2])$/.test(blsPeriod)) return null;
  if (!/^\d{4}$/.test(year)) throw new Error(`not a year: ${year}`);
  return `${year}-${blsPeriod.slice(1)}`;
}
