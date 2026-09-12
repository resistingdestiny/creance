import {
  SENIORITY_BANDS,
  SENIORITY_BAND_LABELS,
  isSeniorityBand,
  type SeniorityBand,
} from '@creance/index-model/src/pricing';

/**
 * The experience question, and the words the whole product uses for it.
 *
 * The three bands come from the index model rather than from a list written out
 * here, for the same reason the price does: the API refuses a band it does not
 * know, and two copies of an enumeration are two enumerations.
 *
 * What a band does and does not do is the only thing on this screen that has to
 * be exactly right. It changes the price, because it changes which capital the
 * cover is written against and capital's appetite differs by band. It changes
 * nothing else. The trigger is the occupation's index, the payout is the cover
 * amount, and both are identical in all three bands, because the published
 * unemployment data has no occupation-by-age series at all and so cannot
 * measure a difference between a person with two years of work and one with
 * thirty. Nothing here may imply otherwise.
 *
 * A band with no capital behind it is not an error and is not drawn as one. It
 * is capital declining that risk, which is the ordinary business of an
 * insurance market and is almost never visible on a screen. It gets a plain
 * sentence and no apology.
 */

export { SENIORITY_BANDS, SENIORITY_BAND_LABELS, isSeniorityBand };
export type { SeniorityBand };

/** The question, on its own screen, after the occupation. */
export const BAND_QUESTION = 'How long have you been working?';

/** The one sentence that says what a band does. It appears wherever one is chosen. */
export const BAND_EFFECT = 'This changes the price, not the payout.';

/**
 * What the screen adds when every band it can sell costs the same.
 *
 * It is true of twelve of the fifteen occupations today, and it made the screen
 * ask a question and give three identical answers under a caption saying the
 * answer mattered. The prices are right: capital that named no band backs all
 * three equally, so with nothing allocated between them there is nothing to
 * tell them apart, and the screen was simply not saying so. Legal is where
 * capital has chosen, and there they differ, so it is named: a reader who wants
 * the contrast has somewhere to look for it.
 */
export const BAND_SAME_PRICE =
  'They cost the same here because no capital has chosen between them yet. Where it has, as in legal, they do not.';

/**
 * Whether every band with a price has the same price, which is the state the
 * sentence above is for.
 *
 * Two or more, because one priced band is not three identical answers and
 * saying that nobody has chosen between them would be about bands this
 * occupation cannot sell at all. The premiums are compared as the strings the
 * screen prints, so what is called equal is what a reader sees as equal.
 */
export function bandsPriceAlike(premiums: readonly (string | null)[]): boolean {
  const priced = premiums.filter((premium): premium is string => premium !== null);
  return priced.length > 1 && priced.every((premium) => premium === priced[0]);
}

/** What a row says when capital has not chosen that band yet. */
export const BAND_NOT_FUNDED = 'Nobody has funded this one yet.';

/** What a row says when the band is funded but has no room for this amount. */
export const BAND_FULL = 'Full at this amount.';

/** The caption under a band row, or undefined when it just has a price. */
export function bandCaption(reason: 'none' | 'no_capital' | 'no_free_capacity'): string | undefined {
  if (reason === 'no_capital') return BAND_NOT_FUNDED;
  if (reason === 'no_free_capacity') return BAND_FULL;
  return undefined;
}

export function bandLabel(band: SeniorityBand): string {
  return SENIORITY_BAND_LABELS[band];
}
