import { NOTE } from '../ats/config.js';

/// What the secondary market run through does, and against which series.
///
/// It is not the demo series. `ODI-COMP-2026-01` carries the coupon evidence,
/// and an ATS coupon reads a holder's entitlement off the balance the holder
/// has now rather than off a stored snapshot, so moving a unit of that note
/// would change what `getCouponFor` reports for coupons 1 to 3 and the settled
/// amounts in docs/HEDERA.md would stop reconciling. The office and
/// administrative support series is the right place instead: its whole supply
/// sits with the operator, it has declared no coupon, and neither investor
/// holds KYC on it, so the refusal below is a real refusal and not one arranged
/// by revoking something.
export const MARKET_SERIES = 'ODI-OFFC-2026-01';

/// Note units, in the note's own six decimals.
export function noteUnits(whole: bigint): bigint {
  return whole * 10n ** BigInt(NOTE.decimals);
}

/// Settlement asset minor units. The note and the settlement token carry the
/// same scale, which is deliberate, so a price is never rescaled between them.
export function tusd(whole: bigint): bigint {
  return whole * 10n ** 6n;
}

export interface TradePlan {
  /// The key this trade is recorded under, and the step name that runs it.
  key: string;
  seller: string;
  buyer: string;
  /// Whole note units.
  units: bigint;
  /// The whole lot price in whole units of the settlement asset.
  price: bigint;
  /// What this trade is for, in the words the record needs.
  purpose: string;
}

/// Two trades, because one would not be a secondary market.
///
/// The first moves a lot out of the operator, which is the account whose
/// settlement tokens are in the vault for this series, and into an investor.
/// It is the trade that carries the compliance demonstration: the buyer holds
/// no KYC on this note when it first tries to take the offer.
///
/// The second is the one the market exists for: an investor selling to another
/// investor, at a price of its own choosing rather than at par, with the same
/// gate in front of it.
export const TRADES: TradePlan[] = [
  {
    key: 'placement',
    seller: 'operator',
    buyer: 'investor-1',
    units: 5n,
    price: 5_000n,
    purpose: 'the first lot out of the issuing account, at par',
  },
  {
    key: 'secondary',
    seller: 'investor-1',
    buyer: 'investor-2',
    units: 2n,
    price: 2_100n,
    purpose: 'one investor selling to another, at 1,050 a unit',
  },
];

/// Explicit gas limits, for the reason the rest of this build gives: the
/// relay cannot estimate a call whose cost depends on state it cannot see, and
/// unused gas is refunded in full. A fill is two token transfers and an ATS
/// compliance pass in one transaction, so it is the dearest call here.
export const MARKET_GAS = {
  deploy: 4_000_000,
  offer: 1_000_000,
  cancel: 500_000,
  approveNote: 1_500_000,
  approveToken: 2_000_000,
  fill: 4_000_000,
  grantKyc: 1_500_000,
} as const;
