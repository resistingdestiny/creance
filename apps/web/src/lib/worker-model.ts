/**
 * The arithmetic and the wording behind the worker screens.
 *
 * Every screen is a rendering of these functions, so that a figure or a
 * sentence has one definition and two screens cannot disagree about it. The
 * screens themselves hold no maths.
 *
 * Two rules from docs/DECISIONS.md shape most of this file:
 *
 * - The headline index figure is whichever form is nearer its line, chosen
 *   server side and returned as a field. The web app never picks a form.
 * - A consumer is never shown a signed index value. Position is points better
 *   or worse than average, the headline is the distance to a payout, and a
 *   distance under 0.05 reads as sitting on the line.
 */

import { formatIndexValue, formatMoney, formatWholeMoney } from './format';
import { occupationLabel } from './occupations';
import type { IndexPoint } from '../components/index-chart';
import type { IndexView, PolicyView, QuoteView } from './worker-api';
import type { Money } from './api';

/** The cover amount, as the copy deck writes it: "5,000", no decimals. */
export function coverAmount(money: Money): string {
  return formatWholeMoney(BigInt(money.amount), money.decimals);
}

/** Money at the money scale, as the copy deck writes it: "28.00". */
export function premiumAmount(money: Money): string {
  return formatMoney(BigInt(money.amount), money.decimals);
}

/**
 * A series parameter in running prose. The copy deck writes the attachment as
 * "2 points" and the exhaustion as "4 points", not "2.00" and "4.00": these are
 * frozen configuration read out in a sentence, not published index readings,
 * and the two decimal rule is about readings.
 */
export function pointsInProse(value: string | number): string {
  const text = formatIndexValue(value);
  return text.replace(/\.?0+$/, '') || '0';
}

/**
 * The exhaustion level E, which the quote view does not carry.
 *
 * DESIGN.md 3.2 makes exhaustion a series field and the Amount screen's copy
 * reads it out. `GET /v1/quote` returns the attachment and the level line and
 * not the exhaustion, so it is read here from the series of record in
 * docs/HEDERA.md, "The demo series": E is 4.0 points for ODI-COMP-2026-01. The
 * gap belongs in the quote view and is recorded in docs/DECISIONS.md.
 */
const SERIES_EXHAUSTION: Record<string, number> = { 'ODI-COMP-2026-01': 4.0 };

export function exhaustionFor(seriesId: string): number | null {
  return SERIES_EXHAUSTION[seriesId] ?? null;
}

/**
 * The Amount screen's sentence, docs/DESIGN-TOKENS.md section 8, with the group
 * label, the attachment and the exhaustion interpolated as its engineering note
 * requires. The second sentence is dropped when the series has no published
 * exhaustion rather than printed with a guess.
 */
export function paysOutSentence(quote: QuoteView): string {
  const label = occupationLabel(quote.group);
  const attachment = pointsInProse(quote.attachment_shock);
  const exhaustion = exhaustionFor(quote.series_id);
  const first = `Pays out if the index for ${label} rises ${attachment} points above its trend.`;
  if (exhaustion === null) return first;
  return `${first} Full payout at ${pointsInProse(exhaustion)} points.`;
}

export type IndexTrend = 'rising' | 'steady' | 'falling';

export interface HeadlineReading {
  readonly form: 'level' | 'shock';
  /** The threshold the headline form is measured against. */
  readonly line: number;
  /** Points to a payout, unsigned. Zero when claims are open. */
  readonly distance: string;
  readonly onTheLine: boolean;
  readonly open: boolean;
  readonly trend: IndexTrend;
  /** The Home row's value, as the copy deck writes it: "1.10, steady". */
  readonly value: string;
  /** The caption under it, in ink-2. */
  readonly caption: string;
}

/**
 * The trend word, from the last three published months of the form the headline
 * names.
 *
 * The index moves towards a payout as its distance to the line falls, so a
 * falling distance is a rising index. The 0.10 threshold is a decision, not a
 * fact: CPS sampling noise at the detailed occupation level is large enough
 * that a smaller one would flip the word most months. docs/DECISIONS.md.
 */
export function trendOf(index: IndexView, months = 3): IndexTrend {
  const form = index.headline?.form ?? 'level';
  const line = Number(form === 'level' ? index.trigger.level_line : index.trigger.attachment_shock);
  const values = index.history
    .map((point) => (form === 'level' ? point.ebar : point.odi))
    .filter((value): value is string => value !== null)
    .map((value) => line - Number(value));
  const latest = values.at(-1);
  const earlier = values.at(-1 - months);
  if (latest === undefined || earlier === undefined) return 'steady';
  const change = latest - earlier;
  if (change <= -0.1) return 'rising';
  if (change >= 0.1) return 'falling';
  return 'steady';
}

/**
 * The one reading a worker screen shows, in the unsigned framing. `distance` on
 * the wire is signed: positive is short of the line, negative is past it. A
 * consumer sees the magnitude and a sentence that says which side of the line
 * it is on.
 */
export function headlineReading(index: IndexView): HeadlineReading | null {
  const headline = index.headline;
  if (headline === null) return null;
  const form = headline.form;
  const line = Number(form === 'level' ? index.trigger.level_line : index.trigger.attachment_shock);
  const signed = Number(headline.distance);
  const distance = formatIndexValue(headline.open || signed < 0 ? 0 : signed);
  const trend = trendOf(index);
  const label = occupationLabel(index.group);

  const caption = headline.open
    ? `Claims are open for ${label}.`
    : headline.on_the_line
      ? 'On the line that opens claims.'
      : `${distance} points from opening claims.`;

  return {
    form,
    line,
    distance,
    onTheLine: headline.on_the_line,
    open: headline.open,
    trend,
    value: `${distance}, ${trend}`,
    caption,
  };
}

/**
 * The chart's points: the series of the form the headline names, in the order
 * the chart draws, with a month that has no reading left as null so the line
 * breaks rather than bridging it.
 */
export function chartPoints(index: IndexView): IndexPoint[] {
  const form = index.headline?.form ?? 'level';
  return index.history.map((point) => {
    const value = form === 'level' ? point.ebar : point.odi;
    return { period: point.period, value: value === null ? null : Number(value) };
  });
}

export function chartThreshold(index: IndexView): number {
  const form = index.headline?.form ?? 'level';
  return Number(form === 'level' ? index.trigger.level_line : index.trigger.attachment_shock);
}

/**
 * The band label, which is the one place the chart would otherwise print a
 * signed threshold.
 *
 * The shock form is a change against a year ago and its attachment is positive,
 * so it keeps the copy deck's own string. The level form is an excess against
 * every occupation, and its line is negative for a profession that is usually
 * unemployed less than average, so the sign becomes a word.
 */
export function bandLabelFor(index: IndexView): string {
  const form = index.headline?.form ?? 'level';
  const line = chartThreshold(index);
  if (form === 'shock') return `Pays out above ${formatIndexValue(line)}`;
  if (line < 0) return `Pays out above ${formatIndexValue(Math.abs(line))} better than average`;
  return `Pays out above ${formatIndexValue(line)} worse than average`;
}

/** The chart's accessible reading, in the same unsigned framing as the screen. */
export function chartDescription(index: IndexView): string {
  const reading = headlineReading(index);
  const label = occupationLabel(index.group);
  if (reading === null) return `${label}. No reading yet.`;
  if (reading.open) return `${label}. Claims are open.`;
  return `${label}. ${reading.distance} points from opening claims, ${reading.trend}.`;
}

/** True when the level line is below zero, which changes what the chart means. */
export function lineIsNegative(index: IndexView): boolean {
  return (index.headline?.form ?? 'level') === 'level' && chartThreshold(index) < 0;
}

export interface BacktestMonth {
  readonly period: string;
  readonly open: boolean;
}

/**
 * The "What would have happened" strip: one mark per published month, open or
 * closed, oldest first. It is the feed's own twenty-four months, which is what
 * the API carries, and every mark is a month the index actually published.
 */
export function whatWouldHaveHappened(index: IndexView): BacktestMonth[] {
  return index.history.map((point) => ({ period: point.period, open: point.open }));
}

/** The Home row: "28.00 on 4 October", from the policy and nothing else. */
export function nextPaymentLine(policy: PolicyView, formatDay: (iso: string) => string): string {
  const premium = premiumAmount(policy.premium);
  if (policy.next_payment_due === null) return premium;
  return `${premium} on ${formatDay(policy.next_payment_due)}`;
}
