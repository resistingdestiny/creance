/// The vault fragments the coupon and maturity scripts call. Written out rather
/// than taken from the Hardhat artifacts so the scripts run from a clean clone
/// without a compile step, and narrow on purpose: nothing here can reserve,
/// release or pay a claim.
export const VAULT_ABI = [
  'function openSeries(bytes32 seriesId, address atsToken, uint64 maturityAt)',
  'function subscribe(bytes32 seriesId, address holder, uint256 amount)',
  'function attributePremium(bytes32 seriesId, uint256 amount)',
  'function fundCoupon(bytes32 seriesId, bytes32 couponId, address to, uint256 amount)',
  'function redeemAtMaturity(bytes32 seriesId, address holder) returns (uint256)',
  'function premiumBalanceOf(bytes32 seriesId) view returns (uint256)',
  'function subscriptionOf(bytes32 seriesId, address holder) view returns (uint256)',
  'function principalRemaining(bytes32 seriesId) view returns (uint256)',
  'function principalFree(bytes32 seriesId) view returns (uint256)',
  'function reservedOf(bytes32 seriesId) view returns (uint256)',
  'function accountedTotal() view returns (uint256)',
  'function seriesOf(bytes32 seriesId) view returns (tuple(uint256 principalFunded, uint256 principalPaid, uint256 principalRedeemed, uint256 reserved, uint256 premiumBalance, uint256 subscriptionsOutstanding, uint64 maturityAt, address atsToken))',
  // The errors as well as the functions, so a revert reads back as a name. A
  // scheduled call has no receipt to decode, so the four bytes come off the
  // mirror node and there is nothing else to identify them with.
  'error ZeroAmount()',
  'error ZeroAddress()',
  'error SeriesUnknown(bytes32 seriesId)',
  'error SeriesExists(bytes32 seriesId)',
  'error SeriesMatured(bytes32 seriesId, uint64 maturityAt)',
  'error MaturityInPast(uint64 maturityAt, uint64 nowAt)',
  'error InsufficientPremium(bytes32 seriesId, uint256 requested, uint256 available)',
  'error InsufficientFreePrincipal(bytes32 seriesId, uint256 requested, uint256 available)',
  'error UnbackedAttribution(uint256 balance, uint256 accountedNow, uint256 requested)',
  'error NotMatured(bytes32 seriesId, uint64 maturityAt)',
  'error ReserveOutstanding(bytes32 seriesId, uint256 reserved)',
  'error NothingSubscribed(bytes32 seriesId, address holder)',
  'error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)',
  'error EnforcedPause()',
] as const;

/// The settlement token through its ERC-20 facade at the long-zero address.
export const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
] as const;
