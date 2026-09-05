/// The fragments the investor endpoints read.
///
/// Copied out rather than imported from the contracts workspace on purpose: an
/// import from there drags Hardhat and its plugins into the API's dependency
/// graph. They are narrow on purpose too, all views: nothing the API holds can
/// move money.

/// CollateralVault, the contract that holds principal and the premium account.
export const VAULT_ABI = [
  'function seriesOf(bytes32 seriesId) view returns (tuple(uint256 principalFunded, uint256 principalPaid, uint256 principalRedeemed, uint256 reserved, uint256 premiumBalance, uint256 subscriptionsOutstanding, uint64 maturityAt, address atsToken))',
  'function subscriptionOf(bytes32 seriesId, address holder) view returns (uint256)',
] as const;

/// The Asset Tokenization Studio bond, which is a contract and not an HTS
/// token: it has a contract id and an EVM address, no token id, and nobody
/// associates with it.
///
/// `getFrozenTokens` is not decoration. A partial freeze leaves the partition
/// balance, so `balanceOf` reports only what is spendable and a holder's real
/// position is the two added together.
export const NOTE_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function paused() view returns (bool)',
  'function getMaturityDate() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function getFrozenTokens(address account) view returns (uint256)',
  'function getKycStatusFor(address account) view returns (uint256)',
  'function getCouponFor(uint256 couponId, address account) view returns (tuple(uint256 tokenBalance, uint8 decimals, uint256 nominalValue, uint256 nominalValueDecimals, bool recordDateReached, tuple(uint256 recordDate, uint256 executionDate, uint256 startDate, uint256 endDate, uint256 fixingDate, uint256 rate, uint8 rateDecimals, uint8 rateStatus) coupon, tuple(uint256 numerator, uint256 denominator, bool recordDateReached) couponAmount, bool isDisabled))',
] as const;

/// CoverPool, the policy registry. The investor screen needs two things from
/// it that live nowhere else: the sum of the limits of the policies currently
/// bound against the series, which is what "capacity used" measures against the
/// principal, and the series term, which the vault does not store.
///
/// `seriesOf` returns the whole terms struct in one call, so the exposure and
/// the term cost one round trip rather than two. A series that was never
/// registered in the pool reads back as a zeroed struct, and a zero term is how
/// that is told apart from a registered series with no policies bound.
export const COVER_POOL_ABI = [
  'function seriesOf(bytes32 seriesId) view returns (tuple(bytes32 group, int64 attachmentShock, int64 levelLine, int64 exhaustionShock, uint8 payoutMode, uint32 waitingPeriod, uint32 term, uint32 gracePeriod, uint32 claimWindowFromObservation, uint32 claimWindowFromSeparation, uint8 lookbackMonths, uint8 status, uint8 statusBeforeWindow, uint256 activeExposure, uint256 exposureCovered, uint32 firstOpenMonth, uint32 lastOpenMonth, uint32 lastObservedMonth, uint64 windowEndsAt))',
] as const;
