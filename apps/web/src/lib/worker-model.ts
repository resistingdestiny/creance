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

import { ApiError } from './api';
import { formatIndexValue, formatMoney, formatPeriod, formatWholeMoney } from './format';
import { occupationLabel } from './occupations';
import type { Surface } from './surface';
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
 * The level line, in the words a person reads it in.
 *
 * The product has exactly two triggers and one vocabulary for them: a sudden
 * jump, which is the shock form against the same occupation a year earlier, and
 * staying worse, which is the level form against every other occupation. This
 * is the second one's threshold, and it is the one figure in the product that
 * cannot be said the same way for every occupation. A positive line is points
 * worse than average. A negative line belongs to a profession that is usually
 * unemployed less than average, and there claims open when the gap to the
 * average narrows to that many points, so it is said that way round: "within
 * 0.68 points of average", never "above -0.68".
 *
 * Two decimals, always, through the app's one index formatter. Level lines are
 * two decimal figures by nature (12.78, -0.98) and the chart's own band caption
 * has always printed them that way, so a sentence beside the chart that dropped
 * a decimal would name a different line from the one drawn. The shock
 * attachment is the opposite case and keeps `pointsInProse`: it is 1.5 or 2 or
 * 3, and the copy deck writes "2 points", not "2.00".
 */
export function levelLinePhrase(line: string | number): string {
  const value = Number(line);
  const points = formatIndexValue(Math.abs(value));
  return value < 0
    ? `within ${points} points of average`
    : `${points} points worse than average`;
}

/**
 * The Amount screen's sentence: when this cover pays, in the product's one
 * vocabulary for it.
 *
 * It used to name the attachment alone, "Pays out if the index for Computer and
 * mathematical rises 2 points above its trend", which is true and is half the
 * mechanism. Claims open on either trigger, and a screen that names one of them
 * as though it were the whole answer leaves a buyer unable to reconcile it with
 * the level line the index tab and the chart both print. So both are here, in
 * the words the Index tab already uses for them, and each figure is labelled
 * with the trigger it belongs to.
 *
 * The occupation is not named. It stands at the top of both surfaces that print
 * this sentence, the Amount screen and the landing card's amount step, one line
 * under the heading, and saying it twice is the kind of over explaining this
 * product is being cut back.
 *
 * The full payout sentence is dropped when the series has no published
 * exhaustion rather than printed with a guess.
 */
export function paysOutSentence(quote: QuoteView): string {
  const attachment = pointsInProse(quote.attachment_shock);
  const exhaustion = exhaustionFor(quote.series_id);
  const first = `Claims open in two ways: a sudden jump of ${attachment} points above trend, or staying ${levelLinePhrase(quote.level_line)}.`;
  if (exhaustion === null) return first;
  return `${first} A jump of ${pointsInProse(exhaustion)} pays in full.`;
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
  /** The caption under it, in ink-2. It never repeats the figure beside it. */
  readonly caption: string;
  /** The same line under the Index tab's large figure, which carries the trend. */
  readonly detail: string;
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
      : 'Points from opening claims.';
  const detail =
    headline.open || headline.on_the_line
      ? caption
      : `Points from opening claims, ${trend}.`;

  return {
    form,
    line,
    distance,
    onTheLine: headline.on_the_line,
    open: headline.open,
    trend,
    value: `${distance}, ${trend}`,
    caption,
    detail,
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
 * The band label: which of the two triggers the red band is, and its level. It
 * is also the one place the chart would otherwise print a signed threshold, and
 * `levelLinePhrase` above carries the sign rule.
 *
 * A chart draws one line, whichever one this occupation is nearer, and this
 * used to say only "Pays out above 1.32 worse than average". A reader who had
 * just met "a sudden jump of 2 points above trend" on the front door could not
 * reconcile the two: two numbers, two scales, and nothing anywhere saying they
 * were two different triggers. Naming the trigger is the whole of what was
 * missing.
 *
 * It names the trigger in place of saying "pays out", rather than as well. The
 * caption is an axis label squeezed between two dates in a 350 pixel row, it is
 * drawn in the triggered red of the band it labels, and on both screens that
 * render it the line underneath says in words that the red band is where claims
 * open. Saying it a third time inside the label cost the caption its second line
 * at 390 on most of the fifteen. What a reader who has only the words gets is
 * `bandSentence` below, which the charts hand to their accessible name.
 */
export function bandLabel(form: 'level' | 'shock', line: number): string {
  if (form === 'shock') return `A sudden jump above ${formatIndexValue(line)}`;
  if (line < 0) return `Staying within ${formatIndexValue(Math.abs(line))} of average`;
  return `Staying ${formatIndexValue(line)} worse than average`;
}

/**
 * The same band said as a sentence, for the chart's accessible name, where
 * there is no red band and no caption under the picture to carry the rest.
 */
export function bandSentence(form: 'level' | 'shock', line: number): string {
  const label = bandLabel(form, line);
  return `Claims open on ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

export function bandLabelFor(index: IndexView): string {
  return bandLabel(index.headline?.form ?? 'level', chartThreshold(index));
}

/** The chart's accessible reading, in the same unsigned framing as the screen. */
export function chartDescription(index: IndexView): string {
  const reading = headlineReading(index);
  const label = occupationLabel(index.group);
  if (reading === null) return `${label}. No reading yet.`;
  if (reading.open) return `${label}. Claims are open.`;
  return `${label}. ${reading.distance} points from opening claims, ${reading.trend}.`;
}

/**
 * The one sentence that has to sit under any margin, because the margin is the
 * whole reason a reader would wonder what a later correction does. The source
 * has been corrected before; what it cannot do is move a month that has
 * settled. docs/INDEX-SPEC.md section 6.
 */
export const FIRST_VALUE_SETTLES =
  'The first value published for a month settles, regardless of any later correction.';

/**
 * How close the call was, for one published month (T56).
 *
 * `level` and `shock` are the API's own `level_margin` and `shock_margin`: the
 * reading less its line, to two decimals, negative while the form is closed
 * and zero or positive once it has opened. They are rendered and never
 * re-derived, so this stays read-only against the published observation. The
 * shock margin is null where the shock form cannot be evaluated (no reading a
 * year earlier), and then nothing is said about it: an absent margin is not a
 * margin of zero.
 *
 * The sign never reaches the screen. docs/DECISIONS.md: a consumer is never
 * shown a signed index value, so a margin is points past the line or points
 * short of it, at the two decimals the feed publishes, because 0.08 is the
 * demonstration month and 0.1 would be a different fact. The two forms are
 * named the way the Index tab's own explanation names them, staying worse and
 * a sudden jump, so the sentence and the explanation above it use one
 * vocabulary.
 */
export function marginSentences(
  period: string,
  level: string | null,
  shock: string | null,
): readonly string[] {
  const parts: string[] = [];
  if (level !== null) parts.push(`${marginPhrase(level)} the line for staying worse`);
  if (shock !== null) parts.push(`${marginPhrase(shock)} the line for a sudden jump`);
  if (parts.length === 0) return [];
  return [`In ${formatPeriod(period)} the index was ${parts.join(', and ')}.`, FIRST_VALUE_SETTLES];
}

/** "0.08 points past", "0.69 points short of", or "on" for a margin of exactly zero. */
function marginPhrase(margin: string): string {
  const value = Number(margin);
  if (value === 0) return 'on';
  const points = formatIndexValue(Math.abs(value));
  return value > 0 ? `${points} points past` : `${points} points short of`;
}

/** The margin sentences for the newest published month of a reading. */
export function indexMargins(index: IndexView): readonly string[] {
  return marginSentences(
    index.reading.period,
    index.trigger.level_margin,
    index.trigger.shock_margin,
  );
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

/**
 * What the Amount, Verify and Pay screens get back from a server action.
 *
 * The wording lives here rather than in the actions module, because a 'use
 * server' file may export nothing but async functions and because a message a
 * person reads is worth a test.
 */

export interface PriceResult {
  readonly limit: string;
  readonly premium: string;
  readonly sentence: string;
  readonly usedPercent: number;
  readonly full: boolean;
  readonly error: string | null;
  /**
   * The occupation can be bought, but not by capital that named no length of
   * experience, so the question has to be answered before there is a price.
   *
   * Absent everywhere but the one refusal that means it. It exists because the
   * sentence below is written for a screen that asked the question, and the
   * landing page's inline quote never asks it: a surface that cannot ask has to
   * be able to tell this refusal from a price that simply failed, so that it
   * can send somebody to the screen that can.
   */
  readonly needsBand?: boolean;
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly error: string | null;
  /**
   * The check was of a kind this deployment does not accept, so the screen says
   * which check to run instead. Told apart from a check that simply failed
   * because the same device answers with the same kind every time, and the
   * generic line offers a retry that cannot work. T42.
   */
  readonly wrongCheck: boolean;
  /**
   * One person, one cover: this person already holds cover in this series. Not
   * a failure of the check, so the screen says the rule rather than offering a
   * retry that would be refused the same way. DESIGN.md 3.6.
   */
  readonly alreadyCovered: boolean;
}

/** The states the Verify screen can be in. docs/DESIGN-TOKENS.md section 8. */
export type VerifyState = 'idle' | 'waiting' | 'verified' | 'failed' | 'wrong-check' | 'covered';

export interface VerifyCopy {
  readonly heading: string;
  readonly line: string;
  readonly button: string;
}

/**
 * The Verify screen's copy, per state, from the deck and only from the deck.
 *
 * `covered` is the one person, one cover rule. The deck has no dedicated string
 * for it, and the nearest is the screen's own second line, which says the rule
 * outright; the heading is the Home deck's word for the state the person is
 * actually in, and the button carries them to it. Recorded in
 * docs/DECISIONS.md.
 *
 * The deck was written for a browser and a second device to scan from. Inside
 * World App there is no second device, so the failure line drops the half of
 * itself that offers one. Recorded in docs/DECISIONS.md under T27.
 *
 * `wrong-check` is the second failure the deck gained in T42, for a check of a
 * kind this deployment does not accept. Its button opens the widget rather than
 * saying "Try again", because what it asks for is a different check and not the
 * same one twice, and inside World App its line drops the app it is already in.
 */
export function verifyCopy(state: VerifyState, surface: Surface = 'browser'): VerifyCopy {
  const rule = 'One person, one cover. This stops bots and duplicate accounts.';
  if (state === 'failed') {
    return {
      heading: "We couldn't verify you.",
      line: surface === 'world-app' ? 'Try again.' : 'Try again, or use a different device.',
      button: 'Try again',
    };
  }
  if (state === 'wrong-check') {
    return {
      heading: "That check isn't the one we asked for.",
      line:
        surface === 'world-app'
          ? 'Run the face check to continue.'
          : 'Open the World app and run the face check.',
      button: 'Verify with World ID',
    };
  }
  if (state === 'covered') {
    return { heading: 'Covered', line: rule, button: 'Cover' };
  }
  return {
    heading: "Confirm you're a real person.",
    line: rule,
    button: state === 'verified' ? 'Continue' : 'Verify with World ID',
  };
}

/**
 * What the demo check says about itself, wherever the purchase asks for a
 * check: on /verify and on the same step inside the landing card.
 *
 * It is one string because it is one act. A deployment with no World app of its
 * own has always minted the credential this way and said so here; a deployment
 * that has one offers the same path a second time, after a real check has been
 * opened and has not come back with anything. Both are the labelled demo
 * issuer, both are testnet, and two surfaces wording that differently is how a
 * person comes to believe a demo check was a World proof.
 *
 * The claim flow's C4 screen is the precedent and this is its sentence with the
 * purchase's own object in it: what a check earns there is a live person on a
 * claim, and what it earns here is the eligibility credential that binds cover.
 * Nothing downstream changes: the credential carries which issuer minted it, so
 * the receipt and the audit trail go on saying which check was used.
 */
export const DEMO_CHECK_LINE =
  'Demo check. Testnet only. This issues the eligibility credential without running a World Selfie Check, because a camera cannot be automated.';

/**
 * The secondary control that runs it, which appears only once a real check has
 * been opened and refused. It is never the primary: the World check is what
 * this screen is for, and the demo path is the way out of a dead end.
 */
export const DEMO_CHECK_ACTION = 'Use the demo check';

/**
 * The line while a check is out. Both check screens use it, at purchase and at
 * claim.
 *
 * The deck's string is "Waiting for the World app", written for the browser flow
 * where the check leaves for a phone. Inside World App it is wrong on its face:
 * the person is in the World app, the sheet is open in front of them, and
 * nothing is being waited for anywhere else. Recorded in docs/DECISIONS.md under
 * T27.
 */
export function waitingLine(surface: Surface): string {
  return surface === 'world-app' ? 'Confirming with World ID' : 'Waiting for the World app';
}

export interface PayResult {
  readonly ok: boolean;
  readonly error: string | null;
}

/**
 * A price that could not be taken. Every message says what happened and what to
 * do next, without apology, which is the sheet's rule for every error here.
 *
 * "This series is full" is the one string on these screens that is in neither
 * sheet: the copy deck has nothing for a series at capacity, and a screen that
 * says nothing about it would leave a disabled button unexplained.
 */
export function priceFailure(limit: number, cause: unknown): PriceResult {
  const empty = { limit: String(limit), premium: '', sentence: '', usedPercent: 0 };
  if (cause instanceof ApiError && cause.code === 'insufficient_capacity') {
    return {
      ...empty,
      full: true,
      error: 'This series is full. Choose a smaller amount or try again later.',
    };
  }
  if (cause instanceof ApiError && cause.code === 'no_capacity_for_group') {
    return noCoverForGroup(limit);
  }
  // Capital can move between the band being chosen and the price being taken,
  // and the band the person picked can lose the capital behind it. It is not an
  // error on their part and the sentence does not treat it as one; it sends
  // them back to the one screen that can show which bands are funded now.
  if (cause instanceof ApiError && cause.code === 'band_not_funded') {
    return {
      ...empty,
      full: true,
      error: 'Nobody is funding that length of experience any more. Choose another.',
      needsBand: true,
    };
  }
  return {
    ...empty,
    full: false,
    error: "We couldn't get a price. Check that the API is running, then try again.",
  };
}

/**
 * The same refusal, said where the question was never asked.
 *
 * `priceFailure` above words it for the screens that did ask: you chose a
 * length of experience, and the capital behind it has gone. The landing page's
 * inline quote has no experience step and quotes with no band at all, so there
 * the refusal means something else entirely: this occupation is sold by length
 * of experience and nobody has said theirs yet. Two sentences because they are
 * two different facts, not one fact worded twice.
 */
export const BAND_NEEDED_LINE =
  'Cover for this occupation is sold by how long you have worked. Answer one more question and we can price it.';

/**
 * The price for an occupation with no series behind it: none, and the reason.
 *
 * It is the sentence the API answers a quote for such a group with, and it is
 * also what the landing page's inline quote answers without making the call,
 * because a group nothing has been committed to is knowable from the occupation
 * list. One function, so the two paths cannot come to say it differently.
 */
export function noCoverForGroup(limit: number): PriceResult {
  return {
    limit: String(limit),
    premium: '',
    sentence: '',
    usedPercent: 0,
    full: true,
    error: 'There is no cover behind this occupation yet.',
  };
}

/** What a bind failure says, switched on the problem document's own code. */
export function bindMessage(cause: unknown): string {
  const fallback = "Your payment didn't go through. Nothing was taken. Try again.";
  if (!(cause instanceof ApiError)) return fallback;
  switch (cause.code) {
    case 'already_covered':
      return 'You already have cover for this occupation. One person, one cover.';
    case 'insufficient_capacity':
      return 'This series is full. Choose a smaller amount or try again later.';
    case 'band_not_funded':
      return 'Nobody is funding that length of experience any more. Choose another.';
    case 'series_not_open_for_binding':
      return 'This series is not taking new cover.';
    case 'credential_expired':
    case 'credential_consumed':
      return 'That check has expired. Verify again and the price is unchanged.';
    default:
      return fallback;
  }
}

/**
 * A check of a kind this deployment does not accept, told apart from a check
 * that simply failed. It lives here rather than in a server action module
 * because both the claim path and the sign in path need it, and every export of
 * a 'use server' file has to be an async function. T42.
 */
export function wrongKind(cause: unknown): boolean {
  return cause instanceof ApiError && cause.code === 'world_credential_unaccepted';
}
