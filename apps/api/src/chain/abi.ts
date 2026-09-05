/// The CoverPool and CollateralVault fragments the policy endpoints use.
///
/// Written out by hand rather than imported from the contracts workspace, for
/// the reason apps/api/src/investor/abi.ts gives: an import from there drags
/// Hardhat and its plugins into the API's dependency graph. These are wider
/// than the investor set because `bind` and `recordPremium` are writes, so the
/// custom errors are here too: a revert reaches the relay as a hex selector and
/// the only way to turn it back into a caller-facing code is to have the ABI.

export const COVER_POOL_ABI = [
  'function bind((bytes32 policyId, bytes32 seriesId, address holder, bytes32 nullifierHash, uint256 limit, uint256 premium, uint64 startAt, uint64 hcsReceiptSeq) p)',
  'function recordPremium(bytes32 policyId, uint32 period)',
  'function quoteCapacity(bytes32 seriesId) view returns (uint256 free)',
  'function seriesOf(bytes32 seriesId) view returns (tuple(bytes32 group, int64 attachmentShock, int64 levelLine, int64 exhaustionShock, uint8 payoutMode, uint32 waitingPeriod, uint32 term, uint32 gracePeriod, uint32 claimWindowFromObservation, uint32 claimWindowFromSeparation, uint8 lookbackMonths, uint8 status, uint8 statusBeforeWindow, uint256 activeExposure, uint256 exposureCovered, uint32 firstOpenMonth, uint32 lastOpenMonth, uint32 lastObservedMonth, uint64 windowEndsAt))',
  'function policyOf(bytes32 policyId) view returns (tuple(bytes32 seriesId, address holder, bytes32 nullifierHash, uint256 limit, uint256 premium, uint64 startAt, uint32 paidThroughMonth, uint64 paidAt, uint8 status))',
  'function activePolicyOf(bytes32 seriesId, bytes32 nullifierHash) view returns (bytes32)',
  'event PolicyBound(bytes32 indexed policyId, bytes32 indexed seriesId, address indexed holder, bytes32 nullifierHash, uint256 limit, uint256 premium, uint64 startAt, uint64 hcsReceiptSeq, uint256 activeExposure)',
  'error ZeroAddress()',
  'error SeriesUnknown(bytes32 seriesId)',
  'error SeriesNotActive(bytes32 seriesId, uint8 status)',
  'error BadTerms(bytes32 seriesId)',
  'error PolicyExists(bytes32 policyId)',
  'error PolicyUnknown(bytes32 policyId)',
  'error NullifierHasActivePolicy(bytes32 seriesId, bytes32 nullifierHash)',
  'error CapacityExceeded(bytes32 seriesId, uint256 exposure, uint256 limit, uint256 principal)',
] as const;

export const VAULT_PRINCIPAL_ABI = [
  'function principalRemaining(bytes32 seriesId) view returns (uint256)',
] as const;

/// `SeriesTerms.status`, in the order CoverPool declares the enum. Binding is
/// allowed in Active and ClaimsOpen and nowhere else, which is what `bind`
/// checks first.
export const SERIES_STATUS = ['none', 'active', 'claims_open', 'settling', 'matured'] as const;

/// `Policy.status`, likewise.
export const POLICY_STATUS = ['none', 'active', 'lapsed', 'paid', 'expired'] as const;
