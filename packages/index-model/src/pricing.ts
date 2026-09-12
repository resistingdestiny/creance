import type { Observation } from './core.js';

/**
 * Pricing. The formula in DESIGN section 3.4 prices from the backtest frequency
 * of open months, which puts thirteen of the fifteen offered occupations exactly
 * on the floor: the shock attachment is calibrated per series at three sigma of
 * that series' own index, so by construction a shock is about as rare for every
 * occupation, and the index cannot differentiate through the shock form at all.
 * It can only differentiate through how close an occupation sits to its level
 * line today, so the guide price is conditioned on that distance.
 *
 * Nothing here imports anything but a type, on purpose. The distance in, the
 * price out, and the empirical hazard the fit came from in ./hazard.js. A
 * module with no runtime imports of its own is one the web app's bundler can
 * follow, which is the only way a screen and the API can price from the same
 * functions rather than from two copies of them.
 */

/** The fitted hazard, so the price has no cliff at a bucket edge. */
export const HAZARD_FIT = { floor: 0.047, amplitude: 0.613, scale: 0.22 } as const;

export function fittedHazard(distance: number): number {
  return HAZARD_FIT.floor + HAZARD_FIT.amplitude * Math.exp(-distance / HAZARD_FIT.scale);
}

/**
 * The yield the collateral is assumed to make while it waits: 4 percent a year,
 * implied from tokenised treasuries. An assumption, 12 September 2026.
 *
 * Read the verb. The collateral WOULD make this if it were deployed to
 * tokenised treasuries, which is a real and nameable place for a stablecoin
 * collateral pool to sit while it waits to pay claims. It does not make it
 * here. Nothing in this build has received a unit of it: the TUSD sits in a
 * `CollateralVault` on Hedera testnet earning exactly nothing, no yield source
 * is implemented and none is going to be.
 *
 * What the number does is size the premium. An insurer's capital is not idle
 * while it waits to pay claims, it is invested, and the income on that float is
 * a real and usually dominant part of the return. Pricing as though the
 * collateral earned nothing makes the premium carry the entire coupon on its
 * own, which is what made this product's premiums absurd.
 *
 * It is a judgment and not a measurement, in the same voice as
 * `separationGivenOpen` and `expectedShareOfLimit`: a figure chosen as a
 * reasonable base return on safe dollar collateral, on a stated date. Nothing
 * fetches it, nothing calibrates it, and no live rate was looked up to arrive
 * at it. A named source makes a number easier to mistake for a measured one, so
 * any screen that shows it says "implied" and "would", never "earns" and never
 * "yields", because those two would be false.
 */
const IMPLIED_BASE_YIELD = 0.04;

/**
 * What the capital behind one unit of limit costs for a year, over and above
 * the yield that capital is assumed to make by waiting.
 *
 * This is the term that decides the level of every price in the product, and
 * for a long time it was missing. The formula used to be expected loss times a
 * load and nothing else, which is how you price a book you already hold capital
 * against. It is not how you price one that has to attract capital. Priced that
 * way the demo series charged 1.81 percent a year on 86,000 of limit, which is
 * 1,557 of premium against an 8,000 coupon: the coupon was five times the
 * product's entire income and the net return to capital came out under one
 * percent a year. Nothing funds displacement risk for that.
 *
 * So the price is inverted. Capital names the return it requires and the
 * premium is whatever must be charged to deliver it, which is the ordinary
 * rate-making identity: required return on capital, plus expected loss, plus
 * expenses.
 *
 * The numerator is the coupon less the implied base yield, and that
 * subtraction is the whole of the difference between a sane price and an absurd
 * one. The premium only has to fund the SPREAD the investor is paid for taking
 * displacement risk on top of the base, not the entire coupon. Charging the
 * entire coupon to premium assumes the collateral makes nothing, which no
 * insurer assumes, and it roughly doubles what a worker pays.
 *
 * The divisor is the target utilisation, and it is there because capital is
 * owed its coupon on all of the principal while premium only ever arrives on
 * the part of it that has been written against. `CoverPool.bind` refuses any
 * policy that would take `activeExposure` past `principalRemaining`, so this
 * pool is collateralised one for one and a unit of limit locks a whole unit of
 * capital. A book writing several times its capital would divide this by that
 * multiple, and it is the single change that would most reduce what a worker
 * pays.
 *
 * Flat across occupations, on purpose: under one for one collateralisation
 * every unit of limit locks the same capital whatever the job is, so only the
 * loss term may vary by occupation. The measured index sets that term and
 * therefore still sets the whole of the difference between one occupation and
 * another. It no longer sets the level.
 */
const CAPITAL_CHARGE = ((0.08 - IMPLIED_BASE_YIELD) * (1 + 0.2)) / 0.85;

/**
 * The published pricing assumptions, all of them arguable and all of them
 * stated. P(separation given claims open) is the JOLTS layoffs and discharges
 * base with the three times open-month uplift over a six month loss window; the
 * expected share of limit is partial at attachment and full at twice it; the
 * load is 30 percent on the loss term. The coupon, the reserve margin and the
 * target utilisation are the three the capital charge is built from, and they
 * are DESIGN.md 3.4's own numbers: 3.4 always said a series' coupon had to be
 * covered by premium inflow at a target utilisation with a 20 percent reserve
 * margin, and until now nothing computed it.
 */
export const PRICING = {
  separationGivenOpen: 0.167,
  expectedShareOfLimit: 0.6,
  load: 1.3,
  /** The coupon a series promises the capital standing behind it, a year. */
  couponRate: 0.08,
  /** DESIGN.md 3.4's reserve margin on top of the coupon. */
  reserveMargin: 0.2,
  /**
   * The utilisation a series is priced to clear at. An assumption. The pool
   * cannot write more limit than principal, so utilisation cannot pass 1, and
   * the live demo series runs at 0.89.
   */
  targetUtilisation: 0.85,
  /** What the collateral is assumed to make waiting. Not earned here. */
  impliedBaseYield: IMPLIED_BASE_YIELD,
  capitalCharge: CAPITAL_CHARGE,
  /**
   * The least a policy can be sold for, which is now derived rather than
   * chosen: the spread the capital it locks has to be paid over the yield
   * that capital is assumed to make waiting, and nothing for the risk. The old
   * floor was 0.5 percent a year, which is below the implied base yield on its
   * own, so a policy sold at it did not even pay for the collateral standing
   * behind it, let alone the risk.
   */
  floorRate: CAPITAL_CHARGE,
  /** The slope of the market term, and the multiple it is capped at. */
  utilisationLambda: 1.0,
  marketCapMultiple: 3,
} as const;

/**
 * The share of the limit expected to be paid out in a year, from the index.
 *
 * This is the measured half of the price and the only half that differs by
 * occupation. It is not touched by the inversion above.
 */
export function expectedLossRate(distance: number): number {
  return fittedHazard(distance) * PRICING.separationGivenOpen * PRICING.expectedShareOfLimit;
}

/** Expected loss with the expense load on top. */
export function riskCharge(distance: number): number {
  return expectedLossRate(distance) * PRICING.load;
}

/**
 * The annual guide rate for a group sitting `distance` points from its line.
 *
 * Set so that at the target utilisation the premium on a series funds the part
 * of the coupon that the capital's own yield does not, with its reserve margin,
 * plus the losses it expects and the load on those losses, with nothing left
 * over. Multiply through by the target utilisation and the limit and the
 * identity is exact:
 *
 *     guide * U * P  =  (coupon - impliedBaseYield) * (1 + margin) * P
 *                       +  load * expectedLoss * U * P
 *
 * Two things that identity does not say. It does not say the coupon is funded
 * below the target utilisation, and no price can make it so: a series nobody
 * has bought cover from earns nothing and still owes its coupon on the whole
 * of its principal. And it does not say the base yield has been earned. This
 * deployment holds its collateral in a vault on Hedera testnet and does not
 * deploy it anywhere, so the base component is the structure being described
 * and priced for, not income taken in. Both are stated rather than priced away.
 */
export function guideRate(distance: number): number {
  return Math.max(PRICING.floorRate, PRICING.capitalCharge + riskCharge(distance));
}

/**
 * The price charged. The guide price is what the series must charge to fund
 * itself; capital that has chosen this occupation says what it will take it
 * for, and above the target utilisation the difference is its surplus.
 */
export function marketRate(guide: number, utilisation: number): number {
  if (utilisation < 0) throw new Error('utilisation cannot be negative');
  return Math.min(
    guide * (1 + PRICING.utilisationLambda * utilisation),
    guide * PRICING.marketCapMultiple,
  );
}

/**
 * The three experience bands cover is sold in.
 *
 * They exist on the market term and nowhere else, and the reason is a fact
 * about the data rather than a preference. The CPS catalogue this index
 * settles on, data/bls/raw/ln.series.gz, carries 739 unemployment rate series
 * with an occupation code and 819 unemployed level series with one. Not a
 * single series in either set also carries an age code. There is no
 * occupation-by-age unemployment rate published and none can be derived,
 * because the numerator does not exist. The catalogue's own "experience" field
 * is binary, experienced against inexperienced labour force, and is not years.
 *
 * So the measured hazard cannot tell a person with two years of work from one
 * with thirty, `guideRate` is band blind by construction, and the trigger, the
 * settlement and the payout are identical for all three. What a band can
 * honestly change is the half of the price that was never a measurement:
 * `marketRate` moves with utilisation, which is an expression of what capital
 * will take a risk for. Segmenting that claims nothing about the world. It says
 * capital's appetite differs by band, which is a fact about capital.
 *
 * The one rule everything downstream holds to: a band changes what you pay, it
 * never changes whether you are paid.
 *
 * The keys are Root's own three options and the labels are his own words.
 */
export const SENIORITY_BANDS = ['0_5', '5_25', '25_plus'] as const;

export type SeniorityBand = (typeof SENIORITY_BANDS)[number];

export const SENIORITY_BAND_LABELS: Record<SeniorityBand, string> = {
  '0_5': '0 to 5 years',
  '5_25': '5 to 25 years',
  '25_plus': '25 or more',
};

export function isSeniorityBand(value: unknown): value is SeniorityBand {
  return typeof value === 'string' && (SENIORITY_BANDS as readonly string[]).includes(value);
}

/**
 * Utilisation for one band: the exposure written in it over the capital
 * committed to it.
 *
 * Null, never zero, when no capital stands behind the band. A band nothing has
 * funded is not a band priced at the floor: it is a band that cannot be sold,
 * and returning 0 would put a price on capacity that does not exist. Every
 * caller has to answer for the null, which is the point.
 */
export function bandUtilisation(exposure: number, capital: number): number | null {
  if (exposure < 0) throw new Error('exposure cannot be negative');
  if (capital <= 0) return null;
  return exposure / capital;
}

/**
 * Where a series' return to capital comes from, as annual percentages of the
 * principal standing behind it.
 *
 * The three parts an investor actually wants and no screen could answer
 * before: what the capital earns waiting, what the premiums add, and what the
 * losses take away. Reported separately rather than netted, because the first
 * of the three is the one this deployment does not earn and a single net
 * number would hide that.
 *
 * `base` is `PRICING.impliedBaseYield` and nothing else. It is what the
 * collateral would make if it were deployed to tokenised treasuries. It is NOT
 * earned here and this build deploys nothing.
 */
export interface ReturnSplit {
  /** What the collateral would make waiting. Not earned in this deployment. */
  readonly base: number;
  /** Premium income over the year, as a percentage of principal. */
  readonly premium: number;
  /** Expected losses over the year, as a percentage of principal. */
  readonly loss: number;
  /** base + premium - loss. */
  readonly total: number;
}

export function returnSplit(
  marketRateOnLimit: number,
  exposure: number,
  principal: number,
  expectedLoss: number,
): ReturnSplit | null {
  if (principal <= 0) return null;
  const base = PRICING.impliedBaseYield;
  const premium = (marketRateOnLimit * exposure) / principal;
  const loss = (expectedLoss * exposure) / principal;
  return { base, premium, loss, total: base + premium - loss };
}

/** Monthly premium for a limit, at an annual rate. */
export function monthlyPremium(rate: number, limit: number): number {
  return (rate * limit) / 12;
}

export type HeadlineForm = 'level' | 'shock';

export interface Headline {
  form: HeadlineForm;
  /** Points still to travel before the form opens. Negative when already past. */
  distance: number;
  /** Under 0.05 points reads as sitting on the line rather than 0.0 away. */
  onTheLine: boolean;
  open: boolean;
}

/**
 * Which form is nearer its line, chosen here so that two screens cannot choose
 * differently. The index has two forms and two thresholds and one number cannot
 * say which is nearer to opening.
 */
export function headline(observation: Observation): Headline | null {
  const candidates: { form: HeadlineForm; distance: number }[] = [];
  if (observation.ebar !== null) {
    candidates.push({ form: 'level', distance: observation.levelLine - observation.ebar });
  }
  if (observation.odi !== null) {
    candidates.push({ form: 'shock', distance: observation.attachmentShock - observation.odi });
  }
  if (candidates.length === 0) return null;
  // Ties go to the level form, which is the one the demo series trades on and
  // the one a reader can check against a published smoothed value.
  const nearest = candidates.reduce((best, candidate) =>
    candidate.distance < best.distance ? candidate : best,
  );
  return {
    form: nearest.form,
    distance: nearest.distance,
    onTheLine: Math.abs(nearest.distance) < 0.05,
    open: observation.open,
  };
}
