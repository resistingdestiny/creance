import { addMonths, nextExecuteAt, premiumSlot, type PremiumSlot } from '@creance/client';

/// Planning the premium chain, and the 62 day cap it runs into.
///
/// Months two onwards are Scheduled Transactions, not x402: the Hedera exact
/// scheme requires a bare `TransferTransaction` and forbids one wrapped in a
/// `ScheduleCreateTransaction`, so the first premium is the paid request and
/// the rest are pre-signed schedules.
/// https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
///
/// A `ScheduleCreate` is accepted when its expiry is at most 5,356,800 seconds,
/// exactly 62.0 days, after the consensus timestamp of the create itself, and
/// rejected one second later with `SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE`.
/// https://docs.hedera.com/hedera/sdks-and-apis/sdks/schedule-transaction/create-a-schedule-transaction
///
/// So at a real monthly cadence "the next three premiums" do not all fit: they
/// fall about 30, 61 and 91 days out and the third is past the cap. The plan
/// says so rather than failing at the third create. Every premium inside the
/// window is created now and the rest belong to the watcher, which creates each
/// following month when one executes (docs/DECISIONS.md, T05, "scheduleNext is
/// a watcher, not an on-chain loop").
///
/// The compressed demo cadence runs the same code. The helper takes an
/// `executeAt` and never a duration, so the only difference between a month and
/// ninety seconds is the date arithmetic here; the accounting period on each
/// slot still steps one calendar month, because the memo is what CoverPool
/// reads and it must name the month the premium is for.

/** 62.0 days. Measured on testnet in T05, not read off a page. */
export const MAX_SCHEDULE_WINDOW_SECONDS = 5_356_800;

/**
 * How much of the window to leave alone. The cap is measured from the
 * consensus timestamp of the create, which lands a few seconds after the valid
 * start the SDK generates, and a run creates its schedules one after another.
 * Five minutes is far more than either and far less than a month.
 */
export const WINDOW_MARGIN_SECONDS = 300;

export type Cadence =
  /** One premium per calendar month, which is the real product. */
  | { kind: 'monthly' }
  /**
   * The demo clock cadence from DESIGN.md 2: the accounting months still step
   * one at a time and the due dates are seconds apart, so a whole chain is
   * visible inside a run.
   */
  | { kind: 'demo'; intervalSeconds: number };

export interface PlannedPremium {
  slot: PremiumSlot;
  /** How far past the create the due date falls. */
  secondsOut: number;
  /**
   * False when the due date is past the 62 day cap, which is not an error: the
   * premium is created later, by the watcher, when the one before it executes.
   */
  withinWindow: boolean;
}

export interface PremiumPlanInput {
  policyId: string;
  /** The period the first premium covered, which the bind settled over x402. */
  paidThrough: number;
  /** When the second premium is due. The API returns it as `next_payment_due`. */
  firstDueAt: Date;
  /** How many premiums to plan. The acceptance asks for the next three. */
  count: number;
  cadence: Cadence;
  /** The moment the schedules are created, which is what the cap is measured from. */
  createdAt: Date;
  marginSeconds?: number;
}

/**
 * The next `count` premiums after the one the bind paid, each with the month it
 * is for, the moment it is due and whether it fits inside the cap.
 */
export function premiumPlan(input: PremiumPlanInput): PlannedPremium[] {
  const { policyId, paidThrough, firstDueAt, count, cadence, createdAt } = input;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`a plan covers at least one premium, got ${count}`);
  }
  const margin = input.marginSeconds ?? WINDOW_MARGIN_SECONDS;
  const dueDay = firstDueAt.getUTCDate();

  const planned: PlannedPremium[] = [];
  for (let month = 0; month < count; month += 1) {
    const period = addMonths(paidThrough, month + 1);
    const executeAt =
      cadence.kind === 'monthly'
        ? nextExecuteAt(firstDueAt, month, dueDay)
        : new Date(createdAt.getTime() + (month + 1) * cadence.intervalSeconds * 1000);
    const secondsOut = Math.round((executeAt.getTime() - createdAt.getTime()) / 1000);
    if (secondsOut <= 0) {
      throw new Error(
        `premium ${period} is due at ${executeAt.toISOString()}, which is not after the create`,
      );
    }
    planned.push({
      slot: premiumSlot(policyId, period, executeAt, dueDay),
      secondsOut,
      withinWindow: secondsOut <= MAX_SCHEDULE_WINDOW_SECONDS - margin,
    });
  }
  return planned;
}

/** The premiums a run can create now. The rest are the watcher's. */
export function creatable(plan: PlannedPremium[]): PlannedPremium[] {
  return plan.filter((premium) => premium.withinWindow);
}

/** The premiums the 62 day cap defers, in order. */
export function deferred(plan: PlannedPremium[]): PlannedPremium[] {
  return plan.filter((premium) => !premium.withinWindow);
}
