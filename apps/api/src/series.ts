import type { SeriesChainState } from './chain/cover-pool.js';
import type { ApiConfig, SeriesConfig } from './config.js';
import type { SeriesRow } from './db/types.js';

/// The series row, which is a cache of what the chain says.
///
/// Everything from the attachment to the lookback is frozen at registration in
/// `CoverPool.registerSeries` and nothing off chain may disagree with it, so
/// the row is written from `seriesOf` rather than from a configuration file.
/// The API refreshes it at boot and again on every quote and bind.

/** The term is `uint32` seconds on chain; twelve months is 31,536,000 of them. */
export function monthsOf(seconds: number): number {
  return Math.round(seconds / ((365 * 86_400) / 12));
}

function days(seconds: number): number {
  return Math.round(seconds / 86_400);
}

export function seriesRowFrom(
  series: SeriesConfig,
  state: SeriesChainState,
  config: ApiConfig,
): SeriesRow {
  return {
    seriesId: series.label,
    seriesKey: series.seriesId,
    groupKey: series.groupKey,
    status: state.status === 'none' ? 'drafted' : state.status,
    principal: state.principalRemaining.toString(),
    // The demo series pays 8 percent, set at issuance (DESIGN.md 3.4). It is
    // not on chain: the coupon lives on the ATS note, not in CoverPool.
    couponRateBps: 800,
    attachmentShock: state.attachmentShock,
    levelLine: state.levelLine,
    exhaustionShock: state.exhaustionShock,
    payoutMode: state.payoutMode,
    termMonths: monthsOf(state.termSeconds),
    waitingPeriodDays: days(state.waitingPeriodSeconds),
    gracePeriodDays: days(state.gracePeriodSeconds),
    claimWindowObsDays: days(state.claimWindowObsSeconds),
    claimWindowSepDays: days(state.claimWindowSepSeconds),
    lookbackMonths: state.lookbackMonths,
    // The auto-approval gate is not on chain and is not derived from the
    // terms: how much of the adjudication we automate is ours to set, per
    // series. The row keeps whatever an operator set, so these are the values a
    // first insert takes and never what a later sync writes back.
    autoApprovalLimit: config.autoApproval.limit,
    autoApprovalConfidence: config.autoApproval.confidence,
    coverPool: config.coverPoolAddress,
    collateralVault: config.vaultAddress,
    maturesAt: new Date(series.maturityAt * 1000).toISOString(),
  };
}
