/// Timings and gas limits for the coupon settlement and the maturity
/// demonstration.

/// Explicit gas limits everywhere, for the reason contracts/scripts/deploy
/// gives: the relay's eth_estimateGas cannot price a call whose cost depends on
/// state it cannot see, and unused gas is refunded in full. The vault figures
/// are the measured ones from docs/HEDERA.md with headroom.
export const GAS = {
  /// An HTS transfer or approve through the ERC-20 facade.
  transfer: 2_000_000,
  approve: 2_000_000,
  subscribe: 1_500_000,
  attributePremium: 1_000_000,
  fundCoupon: 1_500_000,
  openSeries: 300_000,
  redeemAtMaturity: 1_500_000,
  redeemAtMaturityAts: 3_000_000,
} as const;

/// How far ahead a coupon schedule is created. A schedule with `waitForExpiry`
/// true is held until its expiry, so this is the wait between creating the
/// schedules and seeing the transfers execute. Long enough that both creates
/// land first, short enough to watch.
export const SCHEDULE_LEAD_SECONDS = 120;

/// How long the short dated maturity series has to run. It has to outlast the
/// subscription calls and the ATS mint, because both revert once the series has
/// matured, and it is the wait before the redemption.
/// How far ahead the probe schedule is created. Short, because nothing waits on
/// it but the measurement.
export const PROBE_LEAD_SECONDS = 45;

export const MATURITY_LEAD_SECONDS = 15 * 60;

/// The mirror node poll budget for one schedule execution. The default in the
/// helper is two minutes; a coupon is created two minutes ahead of its
/// execution, so it needs more.
export const EXECUTION_POLL = { attempts: 80, delayMs: 3_000 } as const;
