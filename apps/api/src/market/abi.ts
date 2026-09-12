/// The fragments the market endpoints use.
///
/// Copied out rather than imported from the contracts workspace, for the reason
/// apps/api/src/investor/abi.ts gives: an import from there drags Hardhat and
/// its plugins into the API's dependency graph.

/// NoteMarket, the venue. `offerAt` returns the whole offer in one call, and
/// `fillable` reports the two preconditions a screen cannot read any other way:
/// whether the seller still holds the lot and whether the allowance that backs
/// it is still in place. Neither is a compliance verdict; that is the note's.
export const MARKET_ABI = [
  'function settlementToken() view returns (address)',
  'function offerCount() view returns (uint256)',
  'function offerAt(uint256 offerId) view returns (tuple(address note, address seller, address buyer, uint256 units, uint256 price, uint64 openedAt, uint64 closedAt, uint8 status))',
  'function fillable(uint256 offerId) view returns (bool open, bool sellerHolds, bool sellerApproved)',
  'function offer(address note, uint256 units, uint256 price) returns (uint256)',
  'function cancel(uint256 offerId)',
  'function fill(uint256 offerId)',
  'error UnknownOffer(uint256 offerId)',
  'error OfferNotOpen(uint256 offerId)',
  'error NotTheSeller(uint256 offerId, address caller)',
  'error SellerCannotFill(uint256 offerId)',
  'error NoteTransferRefused(uint256 offerId)',
  'error ZeroAddress()',
  'error ZeroAmount()',
] as const;

/// The part of an ATS note a market touches: the balance, the internal KYC
/// register that decides whether a buyer may hold it at all, and the ERC-20
/// shaped allowance the venue settles through.
export const NOTE_MARKET_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function getFrozenTokens(address account) view returns (uint256)',
  'function getKycStatusFor(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
] as const;

/// The settlement asset, through the ERC-20 facade every HTS fungible token
/// answers at its own address.
export const SETTLEMENT_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
] as const;

/**
 * The ATS error fragments a refused fill comes back as.
 *
 * Ethers decodes a revert against the ABI of the contract it called, and a fill
 * that the note refuses reverts inside the note, so without these the reason
 * arrives as four bytes of data and the API would have to answer "it failed".
 * Only the errors the compliance path can raise are here; the note's full
 * interface is a union over every ATS facet and the API has no use for it.
 */
export const NOTE_ERROR_ABI = [
  'error InvalidKycStatus()',
  'error AccountIsBlocked(address account)',
  'error WalletRecovered()',
  'error ComplianceNotAllowed()',
  'error IsPaused()',
  'error InsufficientBalance(address account, uint256 balance, uint256 value, bytes32 partition)',
  'error InsufficientAllowance(address spender, address from)',
  'error ZeroAddressNotAllowed()',
] as const;
