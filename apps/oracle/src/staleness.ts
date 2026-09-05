import { addMonths, type Period } from '@creance/index-model';

/**
 * The staleness check of docs/INDEX-SPEC.md section 9: the source is stale when
 * the newest period is older than 45 days.
 *
 * Measured from the end of the newest reference month present at the source,
 * not from the last successful run. A run that succeeds every day while the
 * source has published nothing new is not health, it is a heartbeat with
 * nothing behind it, and the whole point of the alert is to catch the case
 * where the pipeline is fine and the data is not. The 2025 lapse in
 * appropriations is that case: the October 2025 release was cancelled outright
 * and the September release moved by seven weeks.
 *
 * Forty five days is the right line for normal operation. A July reference
 * month is published on 7 August, so the newest period is at most about five
 * weeks old at any moment, and a month that has been the newest for six weeks
 * means the next release did not happen.
 *
 * The clock is always passed in. Nothing here reads `Date.now`, so the test
 * that proves the alert fires does not have to wait forty six days for it.
 */

export const STALE_AFTER_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The first instant after a reference month, in UTC. */
export function endOfPeriod(period: Period): Date {
  const next = addMonths(period, 1);
  return new Date(`${next}-01T00:00:00Z`);
}

/** Whole days from the end of the reference month to now, never negative. */
export function ageInDays(period: Period, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - endOfPeriod(period).getTime()) / DAY_MS));
}

export interface Staleness {
  newest_period: Period | null;
  /** Null when nothing has been published: there is no age to report. */
  stale_days: number | null;
  stale: boolean;
  stale_after_days: number;
}

/**
 * A source with no period at all is not called stale. It is a clone that has
 * never run, and paging about it would mean every fresh checkout alerts before
 * it has done anything; the null period says so on its own.
 */
export function staleness(newest: Period | null, now: Date): Staleness {
  if (newest === null) {
    return {
      newest_period: null,
      stale_days: null,
      stale: false,
      stale_after_days: STALE_AFTER_DAYS,
    };
  }
  const days = ageInDays(newest, now);
  return {
    newest_period: newest,
    stale_days: days,
    stale: days > STALE_AFTER_DAYS,
    stale_after_days: STALE_AFTER_DAYS,
  };
}
