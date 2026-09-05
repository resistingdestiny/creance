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
  'function getCouponFor(uint256 couponId, address account) view returns (tuple(uint256 tokenBalance, uint8 decimals, uint256 nominalValue, uint256 nominalValueDecimals, bool recordDateReached, tuple(uint256 recordDate, uint256 executionDate, uint256 startDate, uint256 endDate, uint256 fixingDate, uint256 rate, uint8 rateDecimals, uint8 rateStatus) coupon, tuple(uint256 numerator, uint256 denominator, bool recordDateReached) couponAmount, bool isDisabled))',
] as const;
