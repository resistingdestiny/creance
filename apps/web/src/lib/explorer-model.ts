/**
 * The arithmetic and the wording behind the public index explorer.
 *
 * Every figure the explorer prints is computed here from a reading the API
 * served, so the screen holds no maths and no number of its own. Two rules from
 * docs/DECISIONS.md shape all of it:
 *
 * - the headline form is chosen server side and arrives as `headline.form`. The
 *   web app never picks a form, here or anywhere else;
 * - a consumer is never shown a signed index value. Position is points better
 *   or worse than average, the headline is the distance to a payout, and a
 *   distance under 0.05 reads as sitting on the line.
 *
 * Distance is the one quantity the whole page turns on: the points still to
 * travel before claims open, positive short of the line and negative past it.
 * It is `line - value` for whichever form the API named, which is the same
 * subtraction `headline.distance` carries for the newest month.
 */

import { formatIndexValue, formatMoney, formatPeriod } from './format';
import { findOccupation, occupationLabel } from './occupations';
import { bandLabel, marginSentences } from './worker-model';
import type { IndexView } from './worker-api';

import { guideRate, marketRate, monthlyPremium } from '@creance/index-model/src/pricing';

export type IndexForm = 'level' | 'shock';

/** Covered, within half a point of the line, or open. */
export type ExplorerState = 'covered' | 'watch' | 'open';

/** Half a point, which is what "close to opening" means on this page. */
export const WATCH_BAND = 0.5;

/** Under this many points reads as sitting on the line. docs/DECISIONS.md. */
export const ON_THE_LINE = 0.05;

/** The cover the price block is quoted for, and the copy deck's own amount. */
export const PRICE_COVER = 5_000;

export interface ExplorerMonth {
  /** An index period, "2026-07". */
  readonly period: string;
  /** The headline form's reading, or null for a month with no observation. */
  readonly value: number | null;
  /** Points still to travel to a payout. Negative past the line, null with no reading. */
  readonly distance: number | null;
  /** Whether claims were open that month, on either form. The API's own flag. */
  readonly open: boolean;
  /** The unemployment rate for the occupation, for the four steps. */
  readonly rate: number | null;
  /** The unemployment rate across all occupations, for the four steps. */
  readonly allRate: number | null;
  /** The excess, before smoothing, for the four steps. */
  readonly excess: number | null;
  /** The excess smoothed over three months, for the four steps. */
  readonly smoothed: number | null;
}

export interface ExplorerOccupation {
  readonly key: string;
  readonly label: string;
  readonly form: IndexForm;
  /** The frozen threshold for the headline form. May be negative. */
  readonly line: number;
  /** Oldest first, which is the order a chart draws in. */
  readonly months: readonly ExplorerMonth[];
  readonly seriesId: string | null;
  /** Whether capacity has been committed, so cover can be bought today. */
  readonly buyable: boolean;
  /** Whether the backtest has ever opened claims for the occupation since 2010. */
  readonly everOpened: boolean;
  /**
   * How close the call was for the newest published month (T56): the feed's
   * own `level_margin` and `shock_margin`, the reading less its line to two
   * decimals, and the period they belong to. Strings as published, so the
   * round in src/lib/held-read.ts stays serialisable; the sign is stripped
   * only when they are worded.
   */
  readonly margins: {
    readonly period: string;
    readonly level: string | null;
    readonly shock: string | null;
  };
}

/**
 * One reading turned into what the explorer draws.
 *
 * `buyable` comes from src/lib/occupations.ts rather than from the reading:
 * capacity is committed per occupation and the API has no endpoint that lists
 * series, so the picker's own table is where the web app knows it from
 * (docs/DECISIONS.md).
 */
export function explorerOccupation(index: IndexView): ExplorerOccupation {
  const form: IndexForm = index.headline?.form ?? 'level';
  const line = Number(
    form === 'level' ? index.trigger.level_line : index.trigger.attachment_shock,
  );
  const occupation = findOccupation(index.group);
  return {
    key: index.group,
    label: occupationLabel(index.group),
    form,
    line,
    months: index.history.map((point) => {
      const raw = form === 'level' ? point.ebar : point.odi;
      const value = raw === null ? null : Number(raw);
      return {
        period: point.period,
        value,
        distance: value === null ? null : line - value,
        open: point.open,
        rate: point.u_g === null ? null : Number(point.u_g),
        allRate: point.u_all === null ? null : Number(point.u_all),
        excess: point.e === null ? null : Number(point.e),
        smoothed: point.ebar === null ? null : Number(point.ebar),
      };
    }),
    seriesId: index.series_id,
    buyable: occupation !== null && occupation.series !== null,
    everOpened: occupation?.lastOpenPeriod !== null,
    margins: {
      period: index.reading.period,
      level: index.trigger.level_margin,
      shock: index.trigger.shock_margin,
    },
  };
}

/**
 * The margin caption for the newest published month, in the words the Index
 * tab uses, and the sentence that the first published value settles. Empty
 * where no margin was published. It names its month, because the scrubber can
 * be on another one.
 */
export function marginCaption(occupation: ExplorerOccupation): readonly string[] {
  const { period, level, shock } = occupation.margins;
  return marginSentences(period, level, shock);
}

/** The newest month with a reading behind it, which is the default month. */
export function latestMonth(occupation: ExplorerOccupation): ExplorerMonth | null {
  for (let at = occupation.months.length - 1; at >= 0; at -= 1) {
    const month = occupation.months[at];
    if (month !== undefined && month.value !== null) return month;
  }
  return null;
}

/** The index of the default month: the newest published one. */
export function latestMonthIndex(occupation: ExplorerOccupation): number {
  for (let at = occupation.months.length - 1; at >= 0; at -= 1) {
    if (occupation.months[at]?.value !== null) return at;
  }
  return Math.max(0, occupation.months.length - 1);
}

/**
 * The scrubber's bounds. A range input can be dragged past either end and a
 * pointer can leave the chart, so every month index the page uses comes through
 * here and no caller has to remember that months can be empty.
 */
export function clampMonth(occupation: ExplorerOccupation, at: number): number {
  const last = occupation.months.length - 1;
  if (last < 0) return 0;
  if (!Number.isFinite(at)) return last;
  return Math.min(last, Math.max(0, Math.round(at)));
}

export function monthAt(occupation: ExplorerOccupation, at: number): ExplorerMonth | null {
  return occupation.months[clampMonth(occupation, at)] ?? null;
}

/** Covered, close to opening, or open, for one month. */
export function stateOf(month: ExplorerMonth | null): ExplorerState {
  if (month === null || month.distance === null) return 'covered';
  if (month.open || month.distance <= 0) return 'open';
  if (month.distance <= WATCH_BAND) return 'watch';
  return 'covered';
}

const STATE_WORDS: Record<ExplorerState, string> = {
  covered: 'Covered',
  watch: 'Close to opening',
  open: 'Claims open',
};

export function stateWord(state: ExplorerState): string {
  return STATE_WORDS[state];
}

/**
 * The headline over the verdict block.
 *
 * Open is answered first, because a person whose occupation has opened claims
 * needs that sentence before any measure of how near the line it is. Under a
 * twentieth of a point is on the line rather than "0.0 points from a payout",
 * which reads as a payout that is not coming.
 */
export function headlineFor(month: ExplorerMonth | null): string {
  if (month === null || month.distance === null) return 'No reading yet';
  if (month.open || month.distance <= 0) return 'Claims are open';
  if (month.distance < ON_THE_LINE) return 'Right on the line';
  return `${month.distance.toFixed(1)} points from a payout`;
}

/**
 * A position against the all-occupation rate, unsigned and said in words.
 *
 * The excess is `u_g - u_all`, so a positive excess is an occupation doing
 * worse than the labour market as a whole. The sign never reaches the screen;
 * the word does.
 */
export function againstAverage(excess: number): string {
  const direction = excess > 0 ? 'worse' : 'better';
  return `${Math.abs(excess).toFixed(1)} points ${direction} than average`;
}

/**
 * The sentence under the headline: where the occupation sits, and where claims
 * open, both in the same framing.
 *
 * The two forms are different measurements and cannot share a sentence. The
 * level form is a position against every other occupation; the shock form is
 * ground lost against the same occupation a year earlier. Saying either one in
 * the other's words would be false.
 */
export function positionSentence(
  occupation: ExplorerOccupation,
  month: ExplorerMonth | null,
): string | null {
  if (month === null || month.value === null) return null;
  if (occupation.form === 'level') {
    return `Unemployment in this job sits ${againstAverage(month.value)}. Claims open when it reaches ${againstAverage(occupation.line)}.`;
  }
  const moved = month.value >= 0 ? 'lost' : 'gained';
  return `Against a year ago this job has ${moved} ${Math.abs(month.value).toFixed(1)} points of ground on everyone else. Claims open when it has lost ${Math.abs(occupation.line).toFixed(1)}.`;
}

/**
 * How full the meter is, from a payout at nothing to far from a payout at one.
 *
 * The span is the widest distance the occupation reached over the months on
 * screen, floored at 1.2 points so that a series that never moved far from its
 * line does not read as though every month were a crisis.
 */
export function meterFraction(
  occupation: ExplorerOccupation,
  month: ExplorerMonth | null,
): number {
  if (month === null || month.distance === null) return 0;
  const distances = occupation.months
    .map((entry) => entry.distance)
    .filter((distance): distance is number => distance !== null);
  const span = Math.max(1.2, ...distances);
  return Math.min(1, Math.max(0, month.distance / span));
}

/** The chart's band caption, which is the one place a threshold is worded. */
export function bandCaption(occupation: ExplorerOccupation): string {
  return bandLabel(occupation.form, occupation.line);
}

/** The chart's accessible reading, in the same unsigned framing as the screen. */
export function chartName(
  occupation: ExplorerOccupation,
  month: ExplorerMonth | null,
): string {
  if (month === null) return `${occupation.label}. No reading yet.`;
  return `${occupation.label}, ${formatPeriod(month.period)}. ${headlineFor(month)}. ${bandCaption(occupation)}.`;
}

export interface RankedOccupation {
  readonly occupation: ExplorerOccupation;
  readonly month: ExplorerMonth | null;
  readonly state: ExplorerState;
  /** "claims open", "on the line" or "0.7 points away". */
  readonly gap: string;
}

/**
 * Every occupation, closest to opening first.
 *
 * Ties are broken by label so the order is the same on two page views of the
 * same data. An occupation with no reading at all sorts last: nothing is known
 * about how near its line it is, and putting it above one that is measured
 * would be a claim.
 */
export function rankByDistance(
  occupations: readonly ExplorerOccupation[],
): readonly RankedOccupation[] {
  return [...occupations]
    .map((occupation) => {
      const month = latestMonth(occupation);
      return { occupation, month, state: stateOf(month), gap: gapWord(month) };
    })
    .sort((left, right) => {
      const a = left.month?.distance ?? Number.POSITIVE_INFINITY;
      const b = right.month?.distance ?? Number.POSITIVE_INFINITY;
      if (a !== b) return a - b;
      return left.occupation.label.localeCompare(right.occupation.label, 'en-GB');
    });
}

function gapWord(month: ExplorerMonth | null): string {
  if (month === null || month.distance === null) return 'no reading';
  if (month.open || month.distance <= 0) return 'claims open';
  if (month.distance < ON_THE_LINE) return 'on the line';
  return `${month.distance.toFixed(1)} points away`;
}

export interface ExplorerPrice {
  /** The monthly premium at the market rate, "4.25". */
  readonly monthly: string;
  /** The monthly premium at the guide rate, before capital's own appetite. */
  readonly guide: string;
  /** What capital adds over the guide price, as whole percent. */
  readonly addOn: number;
  /** The cover the two figures are for. */
  readonly cover: number;
}

/**
 * The price of a month, from the index model's own pricing functions.
 *
 * The distance is floored at zero before it reaches the hazard. `fittedHazard`
 * is an exponential fitted to buckets that start at the line, and the bucket at
 * or past the line is one bucket: the fit says nothing about a distance below
 * zero and extrapolating it there runs the rate away to numbers no capital
 * would ever quote. The API prices only the current month of a group that has
 * capacity behind it and does not floor; the explorer prices sixty months of
 * fifteen groups and does. docs/DECISIONS.md.
 */
export function priceFor(
  distance: number | null,
  utilisation: number,
  cover: number = PRICE_COVER,
): ExplorerPrice | null {
  if (distance === null) return null;
  const guide = guideRate(Math.max(0, distance));
  const rate = marketRate(guide, utilisation);
  return {
    monthly: money(monthlyPremium(rate, cover)),
    guide: money(monthlyPremium(guide, cover)),
    addOn: Math.round((rate / guide - 1) * 100),
    cover,
  };
}

/** A premium in whole units, through the app's one money formatter. */
function money(amount: number): string {
  return formatMoney(Math.round(amount * 1_000_000), 6);
}

/**
 * The four steps of "How this number is built", on the chosen occupation.
 *
 * Titles and bodies are written in the deck's voice. The design of record marks
 * its own step titles provisional, so these say what the step does rather than
 * borrowing a phrase from it. Every figure in them is interpolated from the
 * reading; none is a constant in copy.
 */
export interface MethodStep {
  readonly title: string;
  readonly body: string;
  /** The series drawn in black. */
  readonly line: 'rate' | 'allRate' | 'excess' | 'smoothed' | 'headline';
  /** A second series in ink-3, where the step is a comparison. */
  readonly against: 'allRate' | 'excess' | null;
  /** Whether the step draws the threshold and its band. */
  readonly threshold: boolean;
}

export function methodSteps(
  occupation: ExplorerOccupation,
  month: ExplorerMonth | null,
): readonly MethodStep[] {
  const at = month === null ? '' : ` in ${formatPeriod(month.period)}`;
  const rate = month?.rate ?? null;
  const allRate = month?.allRate ?? null;
  const comparison =
    rate === null || allRate === null
      ? 'The difference between the two is the only thing we watch.'
      : `Everyone else is at ${allRate.toFixed(1)} percent and this job is at ${rate.toFixed(1)}. The difference between the two is the only thing we watch.`;

  return [
    {
      title: 'Your job',
      body: `How many people in ${occupation.label.toLowerCase()} are out of work${at}. Straight from the monthly government jobs survey, not seasonally adjusted.`,
      line: 'rate',
      against: null,
      threshold: false,
    },
    {
      title: 'Compared with everyone else',
      body: comparison,
      line: 'rate',
      against: 'allRate',
      threshold: false,
    },
    {
      title: 'Smoothed over three months',
      body: 'The difference is averaged three months at a time, so a single strange month cannot move cover in either direction.',
      line: 'smoothed',
      against: 'excess',
      threshold: false,
    },
    {
      title: 'The line',
      body:
        occupation.form === 'level'
          ? `The line comes from this occupation's own history in the 2010s, so each job is judged against itself. Here it sits at ${againstAverage(occupation.line)}.`
          : `The line comes from how far this occupation's own index moved in the 2010s, so each job is judged against itself. Here it sits at ${formatIndexValue(Math.abs(occupation.line))} points of ground lost in a year.`,
      line: 'headline',
      against: null,
      threshold: true,
    },
  ];
}

/** Testnet only, which is a hard rule of this repository, so the network is fixed. */
export function hashscanTopicUrl(topicId: string): string {
  return `https://hashscan.io/testnet/topic/${topicId}`;
}
