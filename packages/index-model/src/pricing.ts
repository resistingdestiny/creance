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
 * the yield that capital is assumed to make by waiting, on an occupation far
 * enough from its line that nothing is imminent.
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
 * The numerator is the return capital requires less the implied base yield, and
 * that subtraction is the whole of the difference between a sane price and an
 * absurd one. The premium only has to fund the SPREAD the investor is paid for
 * taking displacement risk on top of the base, not the entire return. Charging
 * the entire return to premium assumes the collateral makes nothing, which no
 * insurer assumes, and it roughly doubles what a worker pays.
 *
 * The divisor is the target utilisation, and it is there because capital is
 * owed its return on all of the principal while premium only ever arrives on
 * the part of it that has been written against. `CoverPool.bind` refuses any
 * policy that would take `activeExposure` past `principalRemaining`, so this
 * pool is collateralised one for one and a unit of limit locks a whole unit of
 * capital. A book writing several times its capital would divide this by that
 * multiple, and it is the single change that would most reduce what a worker
 * pays.
 *
 * This is the BASE of the term and not the whole of it. The return capital
 * requires is not flat across occupations; see `requiredReturn` below, which is
 * the change of 12 September 2026. What IS flat is the collateralisation: every
 * unit of limit locks the same unit of capital whatever the job is, which is
 * why the multiple is one everywhere and why no occupation can lever its way to
 * a cheaper price.
 */
const BASE_CAPITAL_CHARGE = ((0.08 - IMPLIED_BASE_YIELD) * (1 + 0.2)) / 0.85;

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
 *
 * Two of them are new on 12 September 2026 and both are capital side.
 * `selectionCeiling` says the people who buy cover with a payout in sight lose
 * their jobs far more often than the population the hazard measures, and
 * `imminenceSpread` says capital wants more for funding an occupation that may
 * pay this year. Neither touches the fitted hazard, which was checked against
 * the archive and already runs above the data in every insurable bucket. They
 * are written out at length where they are declared, because a constant that
 * quadruples a price and hides behind a one line comment is the thing
 * board/PRICING.md exists to prevent.
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
  /**
   * The chance that a worker who buys cover with the line in sight is
   * involuntarily separated inside a loss window, once claims open.
   *
   * An assumption, set on 12 September 2026, and the largest lever added that
   * day. `separationGivenOpen` above is a POPULATION rate: JOLTS layoffs and
   * discharges for everybody in the occupation. The people who buy cover on an
   * occupation whose index is about to open are not everybody. They are the
   * ones who can already see the redundancy consultation, and nothing in this
   * product screens them out: there is no underwriting, no health question and
   * no waiting list, and the index that says when a payout is coming is
   * published for anyone to read. That is textbook adverse selection, and a
   * product with a public trigger and voluntary purchase gets it in the
   * strongest form there is.
   *
   * So the loss rate on business WRITTEN at the line is far above the
   * population rate the hazard measures, and 0.75 is the judgment of how far:
   * three in four of the people who buy at the line lose the job inside the
   * window. Nothing measures it. No claims experience exists to measure it
   * with, this product has never written a policy into an open month, and the
   * archive holds unemployment rates rather than the purchase decisions of
   * people who could see them coming.
   *
   * It fades with the distance to the line on `imminence` below, because
   * selection needs something to select on. Four points from the line there is
   * nothing to see, nobody is buying on a hunch about next month, and the
   * charge it produces is worth less than a penny a month.
   */
  selectionCeiling: 0.75,
  /**
   * The extra return, a year, that capital requires to stand behind an
   * occupation sitting on its line rather than far from it.
   *
   * An assumption, set on 12 September 2026, and the answer to the question
   * this model could not answer before it: what does capital want for taking a
   * risk that may pay within the year.
   *
   * Until this date the only capital-side term in the price was utilisation,
   * which is a measure of demand that has already arrived. It is at its weakest
   * exactly where the risk is at its worst. An occupation nobody has bought
   * cover from yet, whose claims could open inside twelve months, priced as
   * though capital were indifferent to it, because an empty pool has a
   * utilisation of nought and nought added nothing. Capital would want most
   * there and the model asked for least.
   *
   * Twelve points takes the required return from 8 percent a year far from the
   * line to 20 percent a year at it, which is two and a half times the coupon.
   * Nothing calibrates it. It is a judgment about what a capital provider would
   * ask to fund fully collateralised cover on an occupation that is one
   * published month from paying out, and it was chosen so that the worst
   * occupation in the book prices near where a capital provider said it would
   * have to. That anchor is recorded in board/PRICING.md rather than dressed up
   * as a measurement here.
   */
  imminenceSpread: 0.12,
  /**
   * The capital charge far from the line, which is also the floor.
   *
   * The least a policy can be sold for, derived rather than chosen: the spread
   * the capital it locks has to be paid over the yield that capital is assumed
   * to make waiting, and nothing for the risk. The old floor was 0.5 percent a
   * year, which is below the implied base yield on its own, so a policy sold at
   * it did not even pay for the collateral standing behind it, let alone the
   * risk.
   */
  baseCapitalCharge: BASE_CAPITAL_CHARGE,
  floorRate: BASE_CAPITAL_CHARGE,
  /** The slope of the market term, and the multiple it is capped at. */
  utilisationLambda: 1.0,
  marketCapMultiple: 3,
} as const;

/**
 * How imminent a payout is, from one at the line to nought far from it.
 *
 * The fitted hazard's own decay, normalised: `h(d)` runs from 0.660 at the line
 * to a floor of 0.047, and this is the part of it that moves, divided by the
 * part of it that can. So it is 1 where the hazard is at its highest and 0
 * where the hazard has settled on the floor the shock form sets everywhere.
 *
 * It is a SHAPE borrowed from the hazard rather than a second fit. Nothing new
 * was measured to produce it and nothing in `HAZARD_FIT` was touched: the same
 * three constants, rearranged, so that the two things that respond to imminence
 * respond to it on the same curve as the loss does and no third scale had to be
 * invented to hold them.
 *
 * Floored at the line. The fit begins at the line and says nothing below it,
 * and there is no cover to price past it anyway; see `coverIsOffered`.
 */
export function imminence(distance: number): number {
  return Math.exp(-Math.max(0, distance) / HAZARD_FIT.scale);
}

/**
 * Whether new cover is written on an occupation at this distance from its line.
 *
 * It is not, at or past it. The level form opens on equality and distance is
 * the points still to travel, so a distance of nought or less is an occupation
 * whose claims are already open, and writing a policy into that is selling
 * cover against a loss that is already running. No insurer does it, and the
 * published hazard table has said so since it was written: its first row is the
 * months at or past the line, and the note under it reads "cover cannot be
 * bought in that state, so the row is here for completeness and no price is
 * quoted from it". Until 12 September 2026 nothing enforced that. The public
 * explorer would quote a month in which claims were open, off a curve floored
 * at the line, and it quoted the same price it quoted for the month before.
 *
 * A refusal rather than a very large number, for two reasons. A price implies
 * somebody would take the other side, and at a distance past the line nobody
 * would: the hazard's own first row says two thirds of those months see another
 * open month inside a year. And the product already has the vocabulary for
 * refusing, because a band with no capital behind it is refused rather than
 * priced at a floor. This is the same answer to the same kind of question.
 */
export function coverIsOffered(distance: number): boolean {
  return distance > 0;
}

/**
 * The share of the limit expected to be paid out in a year, from the index,
 * for the population of the occupation.
 *
 * This is the measured half of the price and it is not touched by anything
 * below. It is what the index says about everybody doing that job, which is the
 * only thing the index has a reading for.
 */
export function expectedLossRate(distance: number): number {
  return fittedHazard(distance) * PRICING.separationGivenOpen * PRICING.expectedShareOfLimit;
}

/** Expected loss with the expense load on top. */
export function riskCharge(distance: number): number {
  return expectedLossRate(distance) * PRICING.load;
}

/**
 * The chance a worker who buys cover at this distance is separated inside a
 * loss window, once claims open.
 *
 * The population rate where nothing is imminent, rising towards
 * `selectionCeiling` as the line comes into view. The people who buy cover on
 * an occupation about to pay are not a random sample of the people doing the
 * job, and this is the one place the price says so.
 */
export function separationOnWrittenCover(distance: number): number {
  return (
    PRICING.separationGivenOpen +
    (PRICING.selectionCeiling - PRICING.separationGivenOpen) * imminence(distance)
  );
}

/**
 * The share of the limit expected to be paid out in a year on cover WRITTEN at
 * this distance, which is the loss an investor actually bears.
 *
 * `expectedLossRate` above is the population figure and this is the book's. The
 * two are the same number far from the line and differ by four times at it,
 * and the difference is selection rather than anything the index measured: the
 * hazard is untouched and so is every constant in it.
 */
export function expectedLossOnWrittenCover(distance: number): number {
  return (
    fittedHazard(distance) * separationOnWrittenCover(distance) * PRICING.expectedShareOfLimit
  );
}

/**
 * What the book's own selection costs, loaded, over and above the population
 * risk the index measured.
 *
 * Its own charge and its own row on every screen that breaks a price down,
 * rather than folded into the risk charge. They are different claims and a
 * reader is entitled to disbelieve one without disbelieving the other: the risk
 * charge is read off a fitted curve through counted months, and this is a
 * judgment about who walks through the door. Adding them silently would present
 * the judgment with the measurement's authority.
 */
export function selectionCharge(distance: number): number {
  return (
    (expectedLossOnWrittenCover(distance) - expectedLossRate(distance)) * PRICING.load
  );
}

/**
 * The return capital requires, a year, for standing behind cover on an
 * occupation this far from its line.
 *
 * The coupon everywhere, plus the imminence spread where a payout is in sight.
 *
 * This is the change of 12 September 2026 and it is the answer to why the price
 * was not believable. Capital does not require the same return to fund an
 * occupation four points from its line and one sitting on it. The first is a
 * long wait for a tail; the second may pay this year, and the pool is
 * collateralised one for one, so the capital cannot be anywhere else when it
 * does. The old model asked capital for 8 percent either way and made up the
 * difference nowhere, which is why an occupation on its line with an empty pool
 * came out at fourteen percent a year of limit and read as a giveaway.
 *
 * The coupon of record is untouched and stays at 8 percent. It is a per series
 * term frozen at issuance, three coupons are settled on chain at it, and this
 * is not it: this is the return the price is SOLVED for, of which the coupon is
 * the contractual floor and the rest is the residual that reaches the note
 * holder as return over the coupon. That mechanism is not new. It is what the
 * capacity term has always done above the target utilisation.
 */
export function requiredReturn(distance: number): number {
  return PRICING.couponRate + PRICING.imminenceSpread * imminence(distance);
}

/**
 * What the capital behind one unit of limit costs for a year at this distance.
 *
 * `BASE_CAPITAL_CHARGE`'s arithmetic with `requiredReturn` in place of the
 * coupon: the return capital requires less what it makes by waiting, with the
 * reserve margin, over the utilisation the series is priced to clear at.
 *
 * It is the largest part of every price in the product and, from this date, the
 * part that carries most of the difference between an occupation on its line
 * and one nowhere near it. What stays flat is the collateralisation, which is a
 * fact about `CoverPool.bind` rather than a choice.
 */
export function capitalCharge(distance: number): number {
  return (
    ((requiredReturn(distance) - PRICING.impliedBaseYield) * (1 + PRICING.reserveMargin)) /
    PRICING.targetUtilisation
  );
}

/**
 * The annual guide rate for a group sitting `distance` points from its line.
 *
 * Set so that at the target utilisation the premium on a series funds the part
 * of the return capital requires that the capital's own yield does not, with
 * its reserve margin, plus the losses it expects on the cover it writes and the
 * load on those losses, with nothing left over. Multiply through by the target
 * utilisation and the limit and the identity is exact:
 *
 *     guide * U * P  =  (requiredReturn - impliedBaseYield) * (1 + margin) * P
 *                       +  load * expectedLossOnWrittenCover * U * P
 *
 * The loss term is the loss on the cover actually written and not the
 * population rate, which is the second half of the 12 September 2026 change.
 * A series has to fund the claims it will pay, and the people who buy at the
 * line are not the population.
 *
 * Three things that identity does not say. It does not say the coupon is
 * funded below the target utilisation, and no price can make it so: a series
 * nobody has bought cover from earns nothing and still owes its coupon on the
 * whole of its principal. It does not say the base yield has been earned; this
 * deployment holds its collateral in a vault on Hedera testnet and does not
 * deploy it anywhere, so the base component is the structure being described
 * and priced for, not income taken in. And it does not say the selection
 * assumption is right, only what follows if it is. All three are stated rather
 * than priced away.
 */
export function guideRate(distance: number): number {
  return Math.max(
    PRICING.floorRate,
    capitalCharge(distance) + riskCharge(distance) + selectionCharge(distance),
  );
}

/**
 * The price charged. The guide price is what the series must charge to fund
 * itself; capital that has chosen this occupation says what it will take it
 * for, and above the target utilisation the difference is its surplus.
 *
 * Utilisation measures demand that has already arrived, which is why this term
 * alone could never carry imminence: a pool nobody has bought from is empty
 * because nobody wants it yet, and an occupation about to pay is dear because
 * everybody will. Those are two forces and until 12 September 2026 only this
 * one was modelled, so the price was at its softest exactly where the risk was
 * at its worst. The other one is in the guide now, in `requiredReturn` and
 * `selectionCharge`, and this term is left to do the job it could always do.
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
