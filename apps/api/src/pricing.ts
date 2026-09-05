import { PRICING, guideRate, marketRate } from '@creance/index-model';

/// The price of a policy, in minor units.
///
/// The formula of record is docs/DECISIONS.md, "Premium is a guide price from
/// the index multiplied by a capacity term":
///
///     guide rate  = max(0.005, h(d) * 0.167 * 0.60 * 1.30)
///     market rate = guide * (1 + utilisation), capped at three times guide
///
/// where `d` is the distance in percentage points from the group's smoothed
/// excess to its level line and `h` is the fitted hazard. DESIGN.md 3.4 prices
/// from the backtest frequency of open months instead, which puts thirteen of
/// the fifteen offered occupations exactly on the floor; that version is
/// superseded and the deviation is recorded.
///
/// The rate is a float, because it is a rate. The premium is not: the rate is
/// rounded to whole basis points first and the premium is then integer
/// arithmetic on the limit, so no float ever reaches an amount.

export interface PriceInput {
  /** The group's published smoothed excess for the latest observation. */
  ebar: number;
  /** The series' frozen level line, in percentage points. May be negative. */
  levelLine: number;
  /** Cover limit in the settlement asset's minor units. */
  limit: bigint;
  /** Committed exposure and the principal behind it, both in minor units. */
  activeExposure: bigint;
  principalRemaining: bigint;
}

export interface Price {
  /** Points still to travel before the level form opens. Negative when past. */
  distance: number;
  utilisation: number;
  guideRateBps: number;
  annualRateBps: number;
  /** The monthly premium, in minor units. */
  premium: bigint;
  basis: {
    distance: string;
    utilisation: string;
    guide_rate_bps: number;
    separation_given_open: string;
    expected_share_of_limit: string;
    load: string;
    floor_rate: string;
    market_cap_multiple: number;
  };
}

/** Utilisation is committed exposure over the principal still behind it. */
export function utilisationOf(activeExposure: bigint, principalRemaining: bigint): number {
  if (principalRemaining <= 0n) return 0;
  return Number(activeExposure) / Number(principalRemaining);
}

/**
 * The monthly premium: `rate * limit / 12`, in minor units.
 *
 * Basis points first, then integers, then a round half up. Doing it the other
 * way round produces a premium that differs in the last minor unit depending on
 * which process computed it, and the pay sheet and the chain would disagree.
 */
export function monthlyPremiumMinor(annualRateBps: number, limit: bigint): bigint {
  const numerator = limit * BigInt(annualRateBps);
  const denominator = 120_000n; // 10,000 basis points times twelve months
  return (numerator + denominator / 2n) / denominator;
}

export function priceCover(input: PriceInput): Price {
  const distance = input.levelLine - input.ebar;
  const utilisation = utilisationOf(input.activeExposure, input.principalRemaining);
  const guide = guideRate(distance);
  const rate = marketRate(guide, utilisation);
  const annualRateBps = Math.round(rate * 10_000);
  return {
    distance,
    utilisation,
    guideRateBps: Math.round(guide * 10_000),
    annualRateBps,
    premium: monthlyPremiumMinor(annualRateBps, input.limit),
    basis: {
      distance: distance.toFixed(4),
      utilisation: utilisation.toFixed(4),
      guide_rate_bps: Math.round(guide * 10_000),
      separation_given_open: PRICING.separationGivenOpen.toFixed(3),
      expected_share_of_limit: PRICING.expectedShareOfLimit.toFixed(2),
      load: PRICING.load.toFixed(2),
      floor_rate: PRICING.floorRate.toFixed(3),
      market_cap_multiple: PRICING.marketCapMultiple,
    },
  };
}

/// The slider the Amount screen offers: 1,000 to 10,000 in steps of 500. A
/// limit outside it is a 400 rather than a silent clamp, because a clamped
/// amount is a policy for a sum the person did not choose.
export const LIMIT_MIN_MAJOR = 1_000;
export const LIMIT_MAX_MAJOR = 10_000;
export const LIMIT_STEP_MAJOR = 500;

export function limitIsOffered(limit: bigint, decimals: number): boolean {
  const scale = 10n ** BigInt(decimals);
  if (limit % scale !== 0n) return false;
  const major = limit / scale;
  return (
    major >= BigInt(LIMIT_MIN_MAJOR) &&
    major <= BigInt(LIMIT_MAX_MAJOR) &&
    major % BigInt(LIMIT_STEP_MAJOR) === 0n
  );
}
