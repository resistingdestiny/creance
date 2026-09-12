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
import { bandLabel, bandSentence, levelLinePhrase, marginSentences } from './worker-model';
import type { IndexView } from './worker-api';

import {
  coverIsOffered,
  guideRate,
  marketRate,
  monthlyPremium,
  riskCharge,
  selectionCharge,
} from '@creance/index-model/src/pricing';

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
 *
 * Two decimals, through the app's one index formatter. It was one, and one was
 * a rounding step wider than the gap this page most often has to show: arts,
 * design, entertainment and media reads 1.30 against a line of 1.32, and the
 * sentence below printed both as "1.3 points worse than average" in the same
 * breath, on the occupation the panel opens on. Both figures were right and the
 * screen read as broken copy. The feed publishes both at two decimals, the
 * chart's own band caption has always printed the line at two, so this prints
 * what was published rather than inventing a difference or hiding one.
 */
export function againstAverage(excess: number): string {
  const direction = excess > 0 ? 'worse' : 'better';
  return `${formatIndexValue(Math.abs(excess))} points ${direction} than average`;
}

/**
 * The sentence under the headline: where the occupation sits.
 *
 * The two forms are different measurements and cannot share a sentence. The
 * level form is a position against every other occupation; the shock form is
 * ground lost against the same occupation a year earlier. Saying either one in
 * the other's words would be false.
 *
 * It used to carry a second sentence naming the trigger and its level, so that
 * a reader meeting the other trigger on the front door could tell the two
 * apart. The chart beside it says that now: the band is named where it is drawn
 * and its caption is the trigger and the level, printed once. The sentence was
 * the same figure a third time, one line under the second.
 */
export function positionSentence(
  occupation: ExplorerOccupation,
  month: ExplorerMonth | null,
): string | null {
  if (month === null || month.value === null) return null;
  if (occupation.form === 'level') {
    return `Unemployment in this job sits ${againstAverage(month.value)}.`;
  }
  const moved = month.value >= 0 ? 'lost' : 'gained';
  return `Against a year ago this job has ${moved} ${formatIndexValue(Math.abs(month.value))} points of ground on everyone else.`;
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

/**
 * The chart's accessible reading, in the same unsigned framing as the screen.
 *
 * The band goes in as `bandSentence` and not as the caption: a reader with only
 * the words has neither the red band nor the line of prose under the figure, so
 * the trigger has to say that it opens claims rather than only naming itself.
 */
export function chartName(
  occupation: ExplorerOccupation,
  month: ExplorerMonth | null,
): string {
  if (month === null) return `${occupation.label}. No reading yet.`;
  return `${occupation.label}, ${formatPeriod(month.period)}. ${headlineFor(month)}. ${bandSentence(occupation.form, occupation.line)}.`;
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

/**
 * What is settled on the index topic, in the one wording every page that cites
 * the topic uses.
 *
 * The topic carries one message per occupation per published month, so what a
 * reader who follows the link finds is a count, and the sentence has to be that
 * count and nothing wider. It is composed from what the round was actually
 * served: how many of the occupations on screen carry a topic and a sequence
 * number for their newest month, against how many occupations there are. A page
 * that said more than that would be inviting a reader to check a claim the page
 * itself has no reading behind.
 *
 * It stops at the topic id, which each page links itself, and each page says in
 * its own words what the reader can then check.
 */
export function settledLead(
  published: number,
  groups: number,
  deepest: { readonly label: string; readonly months: number } | null = null,
): string {
  if (published === 0 || groups === 0) return 'The index settles on Hedera topic';
  const newest =
    published >= groups
      ? 'The newest month for every occupation'
      : `The newest month for ${String(published)} of ${String(groups)} occupations`;
  if (deepest === null) return `${newest} is settled on Hedera topic`;
  return `${newest}, and the whole ${String(deepest.months)} month history for ${deepest.label.toLowerCase()}, are settled on Hedera topic`;
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
  /**
   * The part of the guide price that is this occupation's own risk.
   *
   * Published beside the guide price rather than folded into it, because this
   * is the only part of the price the index measured and the other two are
   * judgments about what capital wants. A reader who disbelieves those can
   * still read this one.
   */
  readonly risk: string;
  /**
   * The part of the guide price that is the book's own selection: the extra
   * loss expected on cover bought when a payout is already in sight, over the
   * population risk in the row above.
   *
   * Its own row and not folded into the risk, because they are different kinds
   * of claim. The risk is read off a curve fitted to counted months. This is a
   * judgment about who buys, and a reader should be able to weigh it on its
   * own. It is nothing at all on an occupation far from its line, and a row
   * that rounds to nothing is not drawn.
   */
  readonly selection: string;
  /**
   * The rest of the guide price: what the capital standing behind the cover
   * costs. The pool is collateralised one for one, so a unit of limit locks the
   * same unit of capital whatever the job is, but capital does not require the
   * same return for locking it: an occupation that may pay this year is asked
   * more for than one four points from its line.
   */
  readonly capital: string;
  /** What capital adds over the guide price, as whole percent. */
  readonly addOn: number;
  /** The cover the two figures are for. */
  readonly cover: number;
}

/** One labelled row of the build up under the premium. */
export interface PriceRow {
  readonly label: string;
  readonly value: string;
}

/**
 * How the premium is built, as labelled rows rather than as a sentence.
 *
 * It was two lines of prose narrating the same figures, which is the form a
 * price build up should never take: the series page has carried this as rows
 * since it was written, and rows are read where a sentence about arithmetic is
 * not. The rows above the guide price add to it, and the last is what capital
 * that chose this occupation asks over it.
 *
 * The selection row is dropped where it rounds to nothing, which is every
 * occupation more than about a point from its line, so the eleven quiet ones
 * read exactly as they did. Dropping it keeps the addition exact rather than
 * breaking it: a row worth less than a penny contributes nothing to the sum it
 * would have been part of.
 */
export function priceRows(price: ExplorerPrice): readonly PriceRow[] {
  return [
    { label: "This job's own risk", value: price.risk },
    ...(price.selection === money(0)
      ? []
      : [{ label: 'Buying with a payout in sight', value: price.selection }]),
    { label: 'The capital behind it', value: price.capital },
    { label: 'Guide price', value: price.guide },
    { label: 'Capital asks on top', value: `${String(price.addOn)} percent` },
  ];
}

/**
 * What the price block says in a month when claims were open.
 *
 * Cover is not sold in that state, so there is no price to print and the block
 * says why rather than quietly disappearing. A reader scrubbing an occupation's
 * history lands on those months, and they are the ones that most need an
 * answer: this is exactly where a premium looked like a bargain and was not on
 * offer at all.
 */
export const COVER_CLOSED_HEADLINE = 'Not on sale';

export const COVER_CLOSED =
  'Claims were open this month, so no new cover was sold. Cover has to be in place before the index reaches the line.';

/**
 * Why the premium is small beside the cover: two things have to happen, not
 * one. One line, with the number it explains, and nowhere else in the product.
 */
export const PAYOUT_CONDITION =
  'Pays when the index opens and you lose the job involuntarily.';

/**
 * The price of a month, from the index model's own pricing functions, or null
 * where there is no price because none is on offer.
 *
 * Null in a month at or past the line. This block used to quote those months
 * off a curve floored at zero, and it quoted them at roughly the price of the
 * month before, on the one screen whose whole job is to show how close an
 * occupation is to paying. A person could scrub to a month in which claims were
 * open and read a premium for it. Nobody would have sold it: cover written into
 * an open month is cover against a loss that is already running, and the
 * published hazard table has said as much since it was written. The explorer
 * says so now instead of pricing it, which is why the floor at zero is gone
 * from this function rather than kept as a guard.
 */
export function priceFor(
  distance: number | null,
  utilisation: number,
  cover: number = PRICE_COVER,
): ExplorerPrice | null {
  if (distance === null || !coverIsOffered(distance)) return null;
  const guide = guideRate(distance);
  const rate = marketRate(guide, utilisation);

  // Rounded to the penny first, and the capital row is then the guide less the
  // other two rather than its own rounding.
  //
  // The rows are an addition a reader can do on the screen, so they have to
  // add on the screen. Three figures each rounded on their own are a penny out
  // of the fourth about half the time, and a build up that is a penny out is a
  // build up that looks wrong on the one block whose whole job is to show that
  // the price is not arbitrary. The capital charge carries the remainder
  // because it is the largest of the three and a penny is invisible in it,
  // where the same penny in the selection row would be a tenth of it.
  const pence = (annual: number) => Math.round(monthlyPremium(annual, cover) * 100);
  const guidePence = pence(guide);
  const riskPence = pence(riskCharge(distance));
  const selectionPence = pence(selectionCharge(distance));

  return {
    monthly: money(monthlyPremium(rate, cover)),
    guide: money(guidePence / 100),
    risk: money(riskPence / 100),
    selection: money(selectionPence / 100),
    capital: money((guidePence - riskPence - selectionPence) / 100),
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
      // The threshold is worded exactly as the chart's band caption and the
      // verdict sentence word it, because all three name one frozen number and
      // a step that rounded it differently would read as a fourth figure.
      body:
        occupation.form === 'level'
          ? `The line comes from this occupation's own history in the 2010s, so each job is judged against itself. Staying ${levelLinePhrase(occupation.line)} opens claims.`
          : `The line comes from how far this occupation's own index moved in the 2010s, so each job is judged against itself. A sudden jump of ${formatIndexValue(Math.abs(occupation.line))} points in a year opens claims.`,
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
