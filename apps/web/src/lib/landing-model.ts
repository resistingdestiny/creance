/**
 * The figures and the sentences the landing page prints.
 *
 * The page holds no arithmetic and composes no copy, the same rule the worker
 * screens follow through src/lib/worker-model.ts. Three of the landing's
 * sentences carry a number that is per-series configuration and must be read
 * rather than typed (docs/DESIGN-TOKENS.md section 9): the from price, the
 * attachment and the full payout level. Every one of them degrades to a
 * sentence without the figure when the feed cannot be reached, because a
 * marketing page that invents a price is the one failure this ticket is about.
 *
 * The strings are the design of record's, verbatim, with the figures
 * interpolated into the places the design shows them.
 */

import { formatPeriod } from './format';
import { occupationLabel } from './occupations';
import type { IndexPoint } from '../components/index-chart';
import type { IndexTrend } from './worker-model';
import {
  bandLabelFor,
  chartDescription,
  chartPoints,
  chartThreshold,
  exhaustionFor,
  headlineReading,
  lineIsNegative,
  pointsInProse,
} from './worker-model';
import type { IndexCatalogueView, IndexView } from './worker-api';

/**
 * The one occupation the landing page speaks for: the hero card, the from
 * price and the index section are all this group.
 *
 * The design of record shows Office and administrative support. Only computer
 * and mathematical has a series behind it (ODI-COMP-2026-01), and capacity is
 * committed per occupation, so it is the only group with a price to quote and
 * the only one whose card can honestly read "Covered". Recorded in
 * docs/DECISIONS.md.
 */
export const LANDING_GROUP = 'computer_math';

/**
 * The three steps, verbatim from the design of record.
 *
 * Step one says "Eleven groups" and the picker offers fifteen, which is the
 * "Occupation picker correction" in docs/DESIGN-TOKENS-ADDENDUM.md. The ticket
 * asks for these sentences verbatim, so the count ships as the design writes it
 * and the mismatch is Root's to settle rather than this file's.
 */
export const LANDING_STEPS = [
  {
    title: 'Pick your occupation',
    line: 'Eleven groups, one tap. Each shows its index reading.',
  },
  {
    title: 'Choose your cover',
    line: '1,000 to 10,000. The monthly payment updates as you slide.',
  },
  {
    title: 'Verify and pay',
    line: "One person, one cover, verified with World ID. Pay and you're done.",
  },
] as const;

/**
 * "From 28.00 a month", beside the hero button.
 *
 * The figure is a quote for the smallest cover on offer, taken live. There is
 * no price to fall back on, so the line disappears rather than naming an
 * amount nobody quoted.
 */
export function fromPriceLine(premium: string | null): string | null {
  return premium === null ? null : `From ${premium} a month`;
}

/** "What does it cost." The from price, then the sentence that explains it. */
export function costAnswer(premium: string | null): string {
  const explanation = "The price comes from your occupation's index, nothing else.";
  const line = fromPriceLine(premium);
  return line === null ? explanation : `${line}. ${explanation}`;
}

/**
 * "When does it pay." The attachment and the full payout level, interpolated.
 *
 * The second sentence is dropped when the series publishes no exhaustion, the
 * same rule the Amount screen's sentence follows. When there is no reading and
 * no catalogue either, both figures are gone and the answer says what is still
 * true and says why the level is missing, rather than printing a level from
 * memory.
 */
export function payAnswer(attachment: string | number | null, seriesId: string | null): string {
  if (attachment === null) {
    return 'When the index for your occupation rises above its trigger line. The live feed is not answering, so the level is not shown.';
  }
  const exhaustion = seriesId === null ? null : exhaustionFor(seriesId);
  const first = `When the index for your occupation rises ${pointsInProse(attachment)} points above its trend.`;
  if (exhaustion === null) return first;
  return `${first} Full payout at ${pointsInProse(exhaustion)}.`;
}

/** "Am I covered." No figure in it, so it is the design's sentence and nothing else. */
export const COVERED_ANSWER = 'Your card says so at all times. Green means yes.';

/**
 * The investor line under the closing buttons.
 *
 * The coupon is per-series and the investor screens already read it, so the
 * landing reads the same field rather than typing the rate twice. Without it
 * the line falls back to the first landing's own wording, which says the same
 * thing without naming a rate.
 */
export function investorLine(coupon: string | null): string {
  if (coupon === null) return 'Investors fund the cover and earn the premiums monthly.';
  return `Investors fund the cover and earn ${coupon}.`;
}

export interface LandingReading {
  readonly distance: string;
  readonly trend: IndexTrend;
  readonly points: readonly IndexPoint[];
  readonly threshold: number;
  readonly bandLabel: string;
  readonly description: string;
  readonly negativeLine: boolean;
  readonly open: boolean;
  /** The period the reading is for, "2026-07". */
  readonly period: string;
}

export interface LandingIndexSection {
  readonly occupation: string;
  readonly reading: LandingReading | null;
  /** Null while the feed answers, the honest note when it does not. */
  readonly note: string | null;
}

/**
 * The index section, from whatever reading could be had.
 *
 * The figure is the distance to a payout that the Index tab shows, chosen
 * server side and taken through the same helpers, so the number on the front
 * door and the number inside the app cannot disagree. A consumer is never
 * shown a signed index value (docs/DECISIONS.md), which is why the headline is
 * a distance and the band is labelled rather than numbered.
 */
export function landingIndexSection(
  group: string,
  index: IndexView | null,
  live: boolean,
): LandingIndexSection {
  const occupation = occupationLabel(group);
  const headline = index === null ? null : headlineReading(index);
  if (index === null || headline === null) {
    // Two different things and two different notes. A feed that did not answer
    // is an outage; a feed that answered with no headline is an occupation the
    // index has not published for yet, and saying the feed is down in that case
    // would be a false statement about a working endpoint.
    return {
      occupation,
      reading: null,
      note:
        live && index !== null
          ? 'No reading has been published for this occupation yet.'
          : 'The live feed is not answering, so there is no reading to show.',
    };
  }

  return {
    occupation,
    reading: {
      distance: headline.distance,
      trend: headline.trend,
      points: chartPoints(index),
      threshold: chartThreshold(index),
      bandLabel: bandLabelFor(index),
      description: chartDescription(index),
      negativeLine: lineIsNegative(index),
      open: headline.open,
      period: index.as_of,
    },
    note: live ? null : staleNote(index.as_of),
  };
}

/** What the page says over a reading it could not confirm is the newest. */
export function staleNote(period: string): string {
  return `This is the last reading we published, for ${formatPeriod(period)}. The live feed is not answering.`;
}

/**
 * The attachment for the landing group, from the reading if there is one and
 * from the free catalogue if there is not.
 *
 * The trigger lines are frozen at issuance and published with every
 * observation, so the catalogue can say what opens claims without giving away
 * the reading the metered route sells. A deployment whose wallet has run dry
 * therefore still prints the right level in the copy.
 */
export function attachmentFor(
  group: string,
  index: IndexView | null,
  catalogue: IndexCatalogueView | null,
): string | null {
  if (index !== null) return index.trigger.attachment_shock;
  const row = catalogue?.groups.find((candidate) => candidate.group === group) ?? null;
  return row?.attachment_shock ?? null;
}

/** The series behind the landing group, for the full payout level. */
export function seriesFor(
  group: string,
  index: IndexView | null,
  catalogue: IndexCatalogueView | null,
): string | null {
  if (index?.series_id != null) return index.series_id;
  const row = catalogue?.groups.find((candidate) => candidate.group === group) ?? null;
  return row?.series_id ?? null;
}
