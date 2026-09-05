import { addMonths } from '@creance/client';

import { compareDecimals } from './decimal.js';

/// The written decision rule.
///
/// DESIGN.md 3.7 gives it in one sentence: "buy if no active policy and the ODI
/// three-month trend is rising, or at annual renewal". That sentence leaves
/// three things open, so they are settled here, in one pure function whose
/// inputs and result are printed in the run and published in the journal.
///
/// 1. Which field. The ODI, `odi` on each month of the history the paid index
///    read returns. Not `ebar`, which is what the level form of the trigger
///    reads, and not the trigger status: the rule is about the direction of the
///    displacement signal, not about whether claims are open today.
///
/// 2. Which three months. The vantage period and the two months before it, all
///    three consecutive calendar months with a published ODI. The vantage is
///    the newest month in the history unless a replay vantage is given. The
///    source has real holes in it (October 2025 was never collected), so three
///    readings that are not three consecutive months are not a trend and the
///    rule refuses to call them one.
///
/// 3. What counts as rising. Strictly increasing across the three, compared as
///    decimals: odi[p-2] < odi[p-1] < odi[p]. Two equal months are not a rise.
///
/// The whole rule, then:
///
///     hold   when cover is already in force and is not near its renewal
///     buy    when the three month ODI trend is rising
///     buy    when the last policy is inside its renewal window
///     hold   otherwise
///
/// A hold is a legitimate outcome. The run still writes its journal entry and
/// exits 0, because an agent that only ever reports buying is not a rule.

/** How near the end of a term counts as the annual renewal. */
export const RENEWAL_WINDOW_DAYS = 30;

const MONTHS_IN_TREND = 3;

/** One month of the history the index endpoint returns, as it arrives. */
export interface HistoryPoint {
  /** `YYYY-MM`. */
  period: string;
  /** A decimal string, or null for a month the source never published. */
  odi: string | null;
}

/** What the agent knows about cover it has already bought for this principal. */
export interface HeldPolicy {
  policyId: string;
  /** Anything other than a live status means the policy buys nothing today. */
  status: string;
  /** The last day of the term, as `YYYY-MM-DD`. */
  coverEnds: string;
}

export interface DecisionInput {
  history: HistoryPoint[];
  /** `YYYY-MM`, the month the rule stands in. Defaults to the newest reading. */
  asOf?: string | undefined;
  policy?: HeldPolicy | null | undefined;
  now: Date;
}

export interface Trend {
  asOf: string;
  /** The three periods read, oldest first, or fewer when the run is short. */
  periods: string[];
  /** Their ODI values, in the same order and as they were published. */
  odi: string[];
  rising: boolean;
  /** Why the trend could not be computed, when it could not be. */
  unavailable: string | null;
}

export type DecisionReason =
  | 'cover_in_force'
  | 'trend_rising'
  | 'annual_renewal'
  | 'trend_not_rising';

export interface Decision {
  buy: boolean;
  reason: DecisionReason;
  trend: Trend;
  /** True when cover is in force and is not inside the renewal window. */
  coverInForce: boolean;
  atRenewal: boolean;
}

/** The statuses in which a policy is cover the principal actually holds. */
const LIVE_STATUSES = new Set(['bound', 'active', 'claims_open', 'claimed', 'under_review']);

/**
 * The three month ODI trend at a vantage period.
 *
 * The vantage defaults to the newest month in the history. Passing one is the
 * replay vantage DESIGN.md 2 already gives the demo clock: the same published
 * data, read as of an earlier month, and labelled as a replay everywhere it is
 * reported.
 */
export function trendAt(history: HistoryPoint[], asOf?: string | undefined): Trend {
  const newest = history[history.length - 1]?.period;
  const vantage = asOf ?? newest;
  if (vantage === undefined) {
    return { asOf: '', periods: [], odi: [], rising: false, unavailable: 'no_history' };
  }
  const wanted = [MONTHS_IN_TREND - 1, MONTHS_IN_TREND - 2, 0].map((back) =>
    periodLabel(addMonths(periodNumber(vantage), -back)),
  );
  const readings = wanted.map((period) => history.find((point) => point.period === period) ?? null);
  const periods: string[] = [];
  const odi: string[] = [];
  for (const reading of readings) {
    if (reading === null || reading.odi === null) continue;
    periods.push(reading.period);
    odi.push(reading.odi);
  }
  if (odi.length < MONTHS_IN_TREND) {
    const vantageReading = readings[MONTHS_IN_TREND - 1];
    return {
      asOf: vantage,
      periods,
      odi,
      rising: false,
      // Either the vantage month itself has no published ODI or the source has
      // a hole behind it. Both mean there is no three month trend to read.
      unavailable:
        vantageReading?.odi === undefined || vantageReading.odi === null
          ? 'no_reading_at_vantage'
          : 'incomplete_window',
    };
  }
  const rising =
    compareDecimals(odi[0] as string, odi[1] as string) < 0 &&
    compareDecimals(odi[1] as string, odi[2] as string) < 0;
  return { asOf: vantage, periods, odi, rising, unavailable: null };
}

/** Whether a policy is inside the last `RENEWAL_WINDOW_DAYS` of its term. */
export function atRenewal(policy: HeldPolicy, now: Date): boolean {
  const ends = Date.parse(`${policy.coverEnds}T00:00:00Z`);
  if (Number.isNaN(ends)) {
    throw new Error(`a policy's cover_ends is YYYY-MM-DD, got ${policy.coverEnds}`);
  }
  return ends - now.getTime() <= RENEWAL_WINDOW_DAYS * 86_400_000;
}

/** The rule itself. Pure: the same inputs always give the same decision. */
export function decide(input: DecisionInput): Decision {
  const trend = trendAt(input.history, input.asOf);
  const policy = input.policy ?? null;
  const live = policy !== null && LIVE_STATUSES.has(policy.status);
  const renewal = live && atRenewal(policy, input.now);
  const coverInForce = live && !renewal;

  if (coverInForce) {
    return { buy: false, reason: 'cover_in_force', trend, coverInForce, atRenewal: renewal };
  }
  if (trend.rising) {
    return { buy: true, reason: 'trend_rising', trend, coverInForce, atRenewal: renewal };
  }
  if (renewal) {
    return { buy: true, reason: 'annual_renewal', trend, coverInForce, atRenewal: renewal };
  }
  return { buy: false, reason: 'trend_not_rising', trend, coverInForce, atRenewal: renewal };
}

/** One line of English for the transcript, from the same fields as the journal. */
export function explain(decision: Decision): string {
  const { trend } = decision;
  const window =
    trend.unavailable === null
      ? `${trend.periods.join(', ')} ODI ${trend.odi.join(' -> ')}`
      : `no three month window at ${trend.asOf} (${trend.unavailable})`;
  switch (decision.reason) {
    case 'cover_in_force':
      return `hold: cover is already in force and is not near renewal; ${window}`;
    case 'trend_rising':
      return `buy: the three month ODI trend is rising; ${window}`;
    case 'annual_renewal':
      return `buy: the term is inside its ${RENEWAL_WINDOW_DAYS} day renewal window; ${window}`;
    case 'trend_not_rising':
      return `hold: the three month ODI trend is not rising and no renewal is due; ${window}`;
  }
}

/** `2026-04` as the number 202604, which is the form the period helpers take. */
export function periodNumber(label: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(label.trim());
  if (!match) {
    throw new Error(`a period is YYYY-MM, got ${label}`);
  }
  return Number(match[1]) * 100 + Number(match[2]);
}

/** The inverse, so the rule speaks the same language as the endpoint. */
export function periodLabel(period: number): string {
  const month = period % 100;
  return `${(period - month) / 100}-${String(month).padStart(2, '0')}`;
}
