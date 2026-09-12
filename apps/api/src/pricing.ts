import {
  PRICING,
  bandUtilisation,
  capitalCharge,
  coverIsOffered,
  expectedLossOnWrittenCover,
  expectedLossRate,
  guideRate,
  imminence,
  marketRate,
  requiredReturn,
  riskCharge,
  selectionCharge,
  separationOnWrittenCover,
} from '@creance/index-model';

/// The price of a policy, in minor units.
///
/// The formula of record:
///
///     imminence        = exp(-d / 0.22)
///     required return  = 0.08 + 0.12 * imminence
///     capital charge   = (required return - 0.04) * 1.20 / 0.85
///     risk charge      = h(d) * 0.167 * 0.60 * 1.30
///     selection charge = h(d) * (sep(d) - 0.167) * 0.60 * 1.30
///     sep(d)           = 0.167 + (0.75 - 0.167) * imminence
///     guide rate       = capital charge + risk charge + selection charge
///     market rate      = guide * (1 + utilisation), capped at three times guide
///
/// where `d` is the distance in percentage points from the group's smoothed
/// excess to its level line and `h` is the fitted hazard.
///
/// The 0.04 subtracted is the implied base yield: what the collateral would
/// make in tokenised treasuries while it waits, so the premium only has to fund
/// the spread over it rather than the whole return. It is an assumption and
/// this deployment does not deploy its collateral.
///
/// The guide rate is a sum, not a floor over a sum. No charge in it can be
/// negative, so `max(floor, sum)` was always the second branch.
///
/// DESIGN.md 3.4 prices from the backtest frequency of open months instead,
/// which puts thirteen of the fifteen offered occupations exactly on the floor;
/// that version is superseded and the deviation is recorded.
///
/// Two of the three charges move with the distance to the line, and that is the
/// change of 12 September 2026. The capital charge moves because capital does
/// not require the same return to stand behind an occupation four points from
/// its line and one sitting on it, and the selection charge exists because the
/// people who buy cover with a payout in sight are not the population the
/// hazard measured. The fitted hazard itself is untouched. What stays flat is
/// the collateralisation: `CoverPool.bind` will not let exposure pass
/// principal, so every unit of limit locks the same unit of capital whatever
/// the job is, and no occupation can lever its way to a cheaper price.
///
/// Utilisation is per experience band. The guide rate is not: the index has no
/// occupation-by-age series to measure a seniority difference with, so the
/// measured hazard is identical for all three bands and so is the trigger.
/// What differs is the capital behind each band, and that is what the market
/// term has always been about. See @creance/index-model's pricing module.
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
  /**
   * The exposure written against this band and the capital committed to it,
   * both in minor units. Not the series totals: a quote is priced against the
   * capacity it is actually drawing on. apps/api/src/capacity.ts computes both
   * from real subscription rows, real policy rows and the chain.
   */
  exposure: bigint;
  capital: bigint;
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
    /** The two amounts the utilisation is the ratio of, so it can be rechecked. */
    capital: string;
    exposure: string;
    guide_rate_bps: number;
    /** The three parts of the guide rate, so a reader can see which is which. */
    capital_charge_bps: number;
    risk_charge_bps: number;
    selection_charge_bps: number;
    expected_loss_bps: number;
    /** The loss expected on cover written at this distance, after selection. */
    expected_loss_written_bps: number;
    separation_given_open: string;
    /** The separation rate the selection charge is struck on. */
    separation_on_written_cover: string;
    expected_share_of_limit: string;
    load: string;
    coupon_rate: string;
    /** The return capital requires here, which is the coupon plus imminence. */
    required_return: string;
    imminence: string;
    selection_ceiling: string;
    imminence_spread: string;
    reserve_margin: string;
    target_utilisation: string;
    floor_rate: string;
    market_cap_multiple: number;
  };
}

/**
 * Utilisation is committed exposure over the capital still behind it.
 *
 * Null, not zero, when there is no capital. It used to answer zero for an empty
 * series, which was harmless while capital committed to a series as a whole and
 * an empty series could not be reached: the capacity check refused first. It is
 * not harmless per band. A band nobody has funded is not a band at the floor
 * price, it is a band that is not for sale, and zero is a price.
 */
export function utilisationOf(exposure: bigint, capital: bigint): number | null {
  return bandUtilisation(Number(exposure), Number(capital));
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

/**
 * The price, or null when no capital stands behind what is being priced, or
 * when claims on the occupation are already open.
 *
 * Null rather than a floor price, for the reason `utilisationOf` gives: an
 * unfunded band has no price at all and the caller has to say so rather than
 * quote one. The second null is the same answer to a different question. At or
 * past the line the level form has opened, so a policy written now would be
 * cover against a loss already running, and no rate makes that a trade. The
 * published hazard table has said cover cannot be bought in that state since it
 * was written; this is the first version in which anything enforces it.
 */
export function priceCover(input: PriceInput): Price | null {
  const distance = input.levelLine - input.ebar;
  if (!coverIsOffered(distance)) return null;
  const utilisation = utilisationOf(input.exposure, input.capital);
  if (utilisation === null) return null;
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
      capital: input.capital.toString(),
      exposure: input.exposure.toString(),
      guide_rate_bps: Math.round(guide * 10_000),
      capital_charge_bps: Math.round(capitalCharge(distance) * 10_000),
      risk_charge_bps: Math.round(riskCharge(distance) * 10_000),
      selection_charge_bps: Math.round(selectionCharge(distance) * 10_000),
      expected_loss_bps: Math.round(expectedLossRate(distance) * 10_000),
      expected_loss_written_bps: Math.round(expectedLossOnWrittenCover(distance) * 10_000),
      separation_given_open: PRICING.separationGivenOpen.toFixed(3),
      separation_on_written_cover: separationOnWrittenCover(distance).toFixed(4),
      expected_share_of_limit: PRICING.expectedShareOfLimit.toFixed(2),
      load: PRICING.load.toFixed(2),
      coupon_rate: PRICING.couponRate.toFixed(2),
      required_return: requiredReturn(distance).toFixed(4),
      imminence: imminence(distance).toFixed(4),
      selection_ceiling: PRICING.selectionCeiling.toFixed(2),
      imminence_spread: PRICING.imminenceSpread.toFixed(2),
      reserve_margin: PRICING.reserveMargin.toFixed(2),
      target_utilisation: PRICING.targetUtilisation.toFixed(2),
      floor_rate: PRICING.floorRate.toFixed(4),
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
