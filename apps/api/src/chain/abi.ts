/// The CoverPool and CollateralVault fragments the policy endpoints use.
///
/// Written out by hand rather than imported from the contracts workspace, for
/// the reason apps/api/src/investor/abi.ts gives: an import from there drags
/// Hardhat and its plugins into the API's dependency graph. These are wider
/// than the investor set because `bind`, `recordPremium`, `payClaim` and
/// `closeWindow` are writes, so the custom errors are here too: a revert
/// reaches the relay as a hex selector and the only way to turn it back into a
/// caller-facing code is to have the ABI.
///
/// `payClaim` takes its parameters as one struct, so the fragment writes the
/// tuple out in the order CoverPool declares `ClaimParams` and ethers encodes a
/// plain array against it. The order is load bearing twice over: once here, and
/// again in the EIP-712 type, which is a different order and a different set of
/// fields. See apps/api/src/chain/authorisation.ts.

export const COVER_POOL_ABI = [
  'function bind((bytes32 policyId, bytes32 seriesId, address holder, bytes32 nullifierHash, uint256 limit, uint256 premium, uint64 startAt, uint64 hcsReceiptSeq) p)',
  'function recordPremium(bytes32 policyId, uint32 period)',
  'function quoteCapacity(bytes32 seriesId) view returns (uint256 free)',
  'function seriesOf(bytes32 seriesId) view returns (tuple(bytes32 group, int64 attachmentShock, int64 levelLine, int64 exhaustionShock, uint8 payoutMode, uint32 waitingPeriod, uint32 term, uint32 gracePeriod, uint32 claimWindowFromObservation, uint32 claimWindowFromSeparation, uint8 lookbackMonths, uint8 status, uint8 statusBeforeWindow, uint256 activeExposure, uint256 exposureCovered, uint32 firstOpenMonth, uint32 lastOpenMonth, uint32 lastObservedMonth, uint64 windowEndsAt))',
  'function policyOf(bytes32 policyId) view returns (tuple(bytes32 seriesId, address holder, bytes32 nullifierHash, uint256 limit, uint256 premium, uint64 startAt, uint32 paidThroughMonth, uint64 paidAt, uint8 status))',
  'function activePolicyOf(bytes32 seriesId, bytes32 nullifierHash) view returns (bytes32)',
  'function openMonths(bytes32 seriesId) view returns (uint32[])',
  'function isInLossWindow(bytes32 seriesId, uint32 separationPeriod) view returns (bool inWindow, uint32 qualifyingPeriod)',
  'function claimDeadline(bytes32 seriesId, uint64 separationAt) view returns (uint64)',
  'function expectedPayout(bytes32 policyId, uint64 separationAt) view returns (uint256)',
  'function payClaim((bytes32 policyId, bytes32 claimId, uint64 separationAt, bytes32 packetHash, bytes32 decisionHash, uint256 amount, address payee, uint64 authDeadline) c, bytes authorisation)',
  'function closeWindow(bytes32 seriesId)',
  'event PolicyBound(bytes32 indexed policyId, bytes32 indexed seriesId, address indexed holder, bytes32 nullifierHash, uint256 limit, uint256 premium, uint64 startAt, uint64 hcsReceiptSeq, uint256 activeExposure)',
  'error ZeroAddress()',
  'error SeriesUnknown(bytes32 seriesId)',
  'error SeriesNotActive(bytes32 seriesId, uint8 status)',
  'error BadTerms(bytes32 seriesId)',
  'error PolicyExists(bytes32 policyId)',
  'error PolicyUnknown(bytes32 policyId)',
  'error NullifierHasActivePolicy(bytes32 seriesId, bytes32 nullifierHash)',
  'error CapacityExceeded(bytes32 seriesId, uint256 exposure, uint256 limit, uint256 principal)',
  'error SeparationOutsideLossWindow(bytes32 seriesId, uint32 separationMonth)',
  'event ClaimPaid(bytes32 indexed policyId, bytes32 indexed claimId, bytes32 indexed seriesId, address payee, uint256 amount, uint32 separationMonth, uint32 qualifyingMonth, bytes32 packetHash, bytes32 decisionHash)',
  'event WindowClosed(bytes32 indexed seriesId, uint256 released, uint32 lastOpenPeriod)',
  'error PolicyNotActive(bytes32 policyId, uint8 status)',
  'error PolicyAlreadyPaid(bytes32 policyId, uint64 paidAt)',
  'error ClaimIdUsed(bytes32 claimId)',
  'error NullifierAlreadyClaimed(bytes32 seriesId, bytes32 nullifierHash)',
  'error SeparationInWaitingPeriod(uint64 separationAt, uint64 waitingEndsAt)',
  'error SeparationAfterTerm(uint64 separationAt, uint64 termEndsAt)',
  'error ClaimWindowClosed(uint64 deadline, uint64 nowAt)',
  'error AmountMismatch(uint256 submitted, uint256 expected)',
  'error ZeroPayout(bytes32 policyId)',
  'error PayeeIsNotHolder(address payee, address holder)',
  'error AuthorisationExpired(uint64 deadline)',
  'error BadSignature()',
  'error SignerLacksClaimsRole(address signer)',
  'error WindowNotOver(bytes32 seriesId, uint64 windowEndsAt)',
  'error NoOpenWindow(bytes32 seriesId)',
  'error IndexedModeNeedsShockOpening(bytes32 seriesId, uint32 qualifyingMonth)',
] as const;

export const VAULT_PRINCIPAL_ABI = [
  'function principalRemaining(bytes32 seriesId) view returns (uint256)',
] as const;

/// A month index is `year * 12 + (month - 1)`, which is how every window rule
/// inside CoverPool is computed; the raw `SeriesTerms` struct is the one place
/// an index is visible from outside, so `firstOpenMonth`, `lastOpenMonth` and
/// `lastObservedMonth` are converted here rather than at each call site.
/// docs/HEDERA.md, ABI conventions.
export function periodFromMonthIndex(index: number): number {
  if (index === 0) return 0;
  return Math.floor(index / 12) * 100 + ((index % 12) + 1);
}

/// `SeriesTerms.status`, in the order CoverPool declares the enum. Binding is
/// allowed in Active and ClaimsOpen and nowhere else, which is what `bind`
/// checks first.
export const SERIES_STATUS = ['none', 'active', 'claims_open', 'settling', 'matured'] as const;

/// `Policy.status`, likewise.
export const POLICY_STATUS = ['none', 'active', 'lapsed', 'paid', 'expired'] as const;
