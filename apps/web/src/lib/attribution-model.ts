/**
 * The attribution panel's figures and its sentences.
 *
 * The screen holds no arithmetic and composes no copy, the same rule
 * src/lib/worker-model.ts and src/lib/landing-model.ts follow. Everything the
 * panel prints is built here and tested here.
 *
 * Two rules run through this file and are the reason it exists.
 *
 * Nothing is fabricated. The category of employer attributed AI job cuts did
 * not exist before May 2023, so earlier months are untracked: they are absent
 * from the series and they are not drawn. A zero inside the window is a real
 * recorded zero and is drawn as one. There is no interpolation anywhere and no
 * bar is ever invented to make the strip rectangular.
 *
 * Nothing here decides a payout. The settlement sentence is body copy, not a
 * footnote and not screen reader text, because a reader who takes one thing
 * from this panel must take that. The caveats are held in this module rather
 * than read from the feed, so a failed read can cost the reader a number but
 * can never cost them a caveat.
 */

import committed from '../../../../data/attribution/challenger-ai-cuts-monthly.json';
import type { AttributionView } from './attribution-api';
import { formatAmount, formatPeriod, formatPeriodShort } from './format';

/** The strip is this tall, and a bar is scaled against the peak month. */
export const STRIP_HEIGHT = 40;

/** One column of the strip. `height` is 0 for a recorded zero. */
export interface AttributionBar {
  readonly period: string;
  readonly cuts: number;
  readonly height: number;
}

export interface AttributionPanelData {
  readonly cumulative: string;
  readonly latestMonth: string;
  readonly latestCuts: string;
  readonly firstMonth: string;
  readonly axis: readonly [string, string];
  readonly bars: readonly AttributionBar[];
  readonly untrackedNote: string;
  readonly alignmentNote: string | null;
  readonly description: string;
  /** Set when the feed could not be read and the committed copy was used. */
  readonly fallbackNote: string | null;
}

/**
 * The heading and the sentence under it.
 *
 * Nothing in the design of record covers this panel, so every string here is a
 * decision rather than a copy deck quotation. See docs/DECISIONS.md.
 */
export const ATTRIBUTION_HEADING = 'What employers say about AI';

export const ATTRIBUTION_SETTLEMENT = [
  'This does not affect settlement. Claims open on the occupation index alone, and nothing in this panel can open or close a claim.',
  'The index cannot tell why anyone lost their job. It fires on any cause. This panel is here so you can see the evidence about AI for yourself, not so it can decide anything.',
] as const;

export const ATTRIBUTION_LIMITS = [
  'Employers report the reason themselves, and economists contest it.',
  'These are announced cuts, not separations. Announced is not the same as happened.',
  'It is national and by industry. It is not coded by occupation, so it cannot be tied to an occupation group without an assumption we have not made.',
  'New York added an artificial intelligence box to its redundancy filings in March 2025. Zero of the 162 or more filings since have ticked it.',
  'Verizon, Block and TCS each denied publicly that their headline cuts were driven by AI.',
  'Several monthly figures are worked back from published year to date totals rather than published month by month, and the series says nothing about which.',
] as const;

export const ATTRIBUTION_CORRELATION = [
  'Measured against our own index over these months, the correlation with the computer and mathematical margin is about minus 0.44 in levels and about minus 0.21 differenced. For construction and for farming, fishing and forestry it is about zero.',
  'Most of that level relationship is a shared trend, and nothing shows at three or six month leads. It is context, not a predictor.',
] as const;

export const ATTRIBUTION_SOURCE =
  'Announced United States job cuts where the employer itself named artificial intelligence, compiled by Challenger, Gray and Christmas.';

function untrackedNote(first: string, months: number, zeros: number): string {
  return `The category did not exist before ${formatPeriod(first)}, so earlier months are untracked and nothing is drawn for them. A flat month inside the window is a recorded zero, and ${zeros} of the ${months} months here are.`;
}

/**
 * Why the last column of the strip can be a month the index has not reached.
 *
 * The two series are published on different calendars and the attribution one
 * runs ahead. Saying so is cheaper than a reader assuming the strip and the
 * index line are the same window.
 */
function alignmentNote(latest: string, indexLatest: string | null): string | null {
  if (indexLatest === null || indexLatest === latest) return null;
  return `The index's newest month is ${formatPeriod(indexLatest)} and this series runs to ${formatPeriod(latest)}. The two are not aligned month for month.`;
}

export const ATTRIBUTION_FALLBACK_NOTE =
  'These are the last published figures, from the copy of the series committed to this repository. The feed could not be reached, so this is not a live read.';

function bars(view: AttributionView): AttributionBar[] {
  const peak = view.peak.cuts;
  return view.months.map((month) => ({
    period: month.period,
    cuts: month.cuts,
    // A recorded zero gets no bar, and every month that is not zero gets at
    // least one pixel: rounding a real 7 down to nothing would draw it as the
    // zero it is not.
    height:
      month.cuts === 0 || peak === 0
        ? 0
        : Math.max(1, Math.round((month.cuts / peak) * STRIP_HEIGHT)),
  }));
}

/** What the panel prints, from a reading of the feed or from the committed copy. */
export function attributionPanel(
  view: AttributionView,
  options: { indexLatestPeriod?: string | null; fromSnapshot?: boolean } = {},
): AttributionPanelData {
  const zeros = view.months.filter((month) => month.cuts === 0).length;
  return {
    cumulative: formatAmount(view.cumulative),
    latestMonth: formatPeriod(view.latest.period),
    latestCuts: formatAmount(view.latest.cuts),
    firstMonth: formatPeriod(view.first_period),
    axis: [formatPeriodShort(view.first_period), formatPeriodShort(view.latest_period)],
    bars: bars(view),
    untrackedNote: untrackedNote(view.first_period, view.months.length, zeros),
    alignmentNote: alignmentNote(view.latest_period, options.indexLatestPeriod ?? null),
    description: `${formatAmount(view.cumulative)} announced cuts across ${view.months.length} months, from ${formatPeriod(view.first_period)} to ${formatPeriod(view.latest_period)}. The largest month is ${formatPeriod(view.peak.period)} at ${formatAmount(view.peak.cuts)}.`,
    fallbackNote: options.fromSnapshot === true ? ATTRIBUTION_FALLBACK_NOTE : null,
  };
}

/**
 * The committed series, bundled at build time.
 *
 * This is the honest cold fallback the panel needs. The series is static
 * committed data and the file the API serves is this same file, so a build time
 * import really is "the last published figures" rather than a guess or a
 * remembered read. Module memory of the last successful read, the way
 * src/lib/last-reading.ts does it for the landing, would add nothing here and
 * would still leave an empty panel after a restart.
 *
 * It is an import and not a file read because the web image copies only
 * apps/web and the two packages at runtime, so the bundle has to carry it.
 */
export function attributionSnapshot(): AttributionView {
  const months = Object.keys(committed)
    .sort()
    .map((period) => ({ period, cuts: (committed as Record<string, number>)[period] ?? 0 }));
  const first = months[0];
  const latest = months.at(-1);
  if (first === undefined || latest === undefined) {
    throw new Error('the committed attribution series is empty');
  }
  const peak = months.reduce((best, month) => (month.cuts > best.cuts ? month : best), first);
  return {
    first_period: first.period,
    latest_period: latest.period,
    untracked_before: first.period,
    cumulative: months.reduce((total, month) => total + month.cuts, 0),
    latest,
    peak,
    months,
  };
}
