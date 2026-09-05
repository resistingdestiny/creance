/// The CoverPool and CollateralVault fragments the oracle needs.
///
/// Hand written rather than imported from the contracts workspace, the same
/// reason apps/api/src/investor/abi.ts gives: an import from there drags
/// Hardhat and its plugins into the dependency graph of a worker that only ever
/// makes one call.
///
/// `submitObservation` is the only write. Everything else is a view the worker
/// reads before it writes, because the contract reverts rather than ignoring a
/// duplicate and idempotence is therefore the oracle's job.

export const COVER_POOL_ABI = [
  'function submitObservation((bytes32 seriesId, uint32 period, int64 odi, int64 ebar, uint64 hcsSequence, bytes32 sourceHash) o)',
  'function observationOf(bytes32 seriesId, uint32 period) view returns (tuple(int64 odi, int64 ebar, uint64 submittedAt, uint64 hcsSequence, bytes32 sourceHash, uint8 openReason, bool present))',
  'function seriesOf(bytes32 seriesId) view returns (tuple(bytes32 group, int64 attachmentShock, int64 levelLine, int64 exhaustionShock, uint8 payoutMode, uint32 waitingPeriod, uint32 term, uint32 gracePeriod, uint32 claimWindowFromObservation, uint32 claimWindowFromSeparation, uint8 lookbackMonths, uint8 status, uint8 statusBeforeWindow, uint256 activeExposure, uint256 exposureCovered, uint32 firstOpenMonth, uint32 lastOpenMonth, uint32 lastObservedMonth, uint64 windowEndsAt))',
  'function paused() view returns (bool)',
  'event ObservationSubmitted(bytes32 indexed seriesId, uint32 indexed period, int64 odi, int64 ebar, bool open, uint8 openReason, uint64 hcsSequence, bytes32 sourceHash)',
  'event ClaimsOpened(bytes32 indexed seriesId, uint32 indexed period, uint8 openReason, uint256 reserved, uint64 windowEndsAt)',
  'event ReserveToppedUp(bytes32 indexed seriesId, uint32 indexed period, uint256 added, uint256 reserved)',
  'event WindowExtended(bytes32 indexed seriesId, uint32 indexed period, uint64 windowEndsAt)',
] as const;

export const VAULT_ABI = ['function reservedOf(bytes32 seriesId) view returns (uint256)'] as const;

/// SeriesStatus, as CoverPool declares it. An observation is only accepted
/// while the series is one of the three middle states.
export const SERIES_STATUS = ['None', 'Active', 'ClaimsOpen', 'Settling', 'Matured'] as const;

export function seriesStatusName(status: number): string {
  return SERIES_STATUS[status] ?? `unknown(${status})`;
}

export function canAcceptObservation(status: number): boolean {
  return status === 1 || status === 2 || status === 3;
}

/// `openReason` on chain: 0 none, 1 shock, 2 level. The contract has no "both",
/// it reports shock when both hold, so a message saying "both" and an event
/// saying "shock" agree rather than disagree.
export const OPEN_REASON = ['none', 'shock', 'level'] as const;

export function openReasonName(reason: number): string {
  return OPEN_REASON[reason] ?? `unknown(${reason})`;
}
