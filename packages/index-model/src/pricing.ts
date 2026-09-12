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
 * The published pricing assumptions, all of them arguable and all of them
 * stated. P(separation given claims open) is the JOLTS layoffs and discharges
 * base with the three times open-month uplift over a six month loss window; the
 * expected share of limit is partial at attachment and full at twice it; the
 * load is 30 percent; the floor is a judgment, not a measurement.
 */
export const PRICING = {
  separationGivenOpen: 0.167,
  expectedShareOfLimit: 0.6,
  load: 1.3,
  floorRate: 0.005,
  /** The slope of the market term, and the multiple it is capped at. */
  utilisationLambda: 1.0,
  marketCapMultiple: 3,
} as const;

/** The annual guide rate for a group sitting `distance` points from its line. */
export function guideRate(distance: number): number {
  const expectedLoss =
    fittedHazard(distance) * PRICING.separationGivenOpen * PRICING.expectedShareOfLimit;
  return Math.max(PRICING.floorRate, expectedLoss * PRICING.load);
}

/**
 * The price charged. The guide price is what the risk is worth; capital that has
 * chosen this occupation says what it will take it for.
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
