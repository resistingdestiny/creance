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

import { hashscanTopicUrl, rankByDistance, type ExplorerOccupation } from './explorer-model';
import { formatAmount, formatDayWithYear, formatMoney, formatPeriod, formatWholeMoney } from './format';
import { isoDay } from './investor-model';
import { OCCUPATIONS } from './occupations';
import { exhaustionFor, headlineReading, pointsInProse } from './worker-model';
import type { CouponsView, SeriesView } from './investor-api';
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
 * "From 28.00 a month", the hero's figure.
 *
 * The figure is a quote for the smallest cover on offer, taken live. There is
 * no price to fall back on, so the line disappears rather than naming an
 * amount nobody quoted.
 */
export function fromPriceLine(premium: string | null): string | null {
  return premium === null ? null : `From ${premium} a month`;
}

/**
 * "for 1,000 of cover", under the figure: what the from price buys (T52).
 *
 * A price with nothing beside it reads as too small to be real, so the line
 * says the cover it was quoted for. The amount is the one the quote was asked
 * for and is handed in by the reader that asked, never typed here, so the
 * sentence cannot name a cover the price is not for. The wording is the
 * explorer's own, "Monthly premium for 5,000 of cover", with the figure the
 * hero's; docs/DESIGN-TOKENS-ADDENDUM.md carries it under T52.
 */
export function fromPriceBuys(limit: number): string {
  return `for ${formatAmount(limit)} of cover`;
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

/**
 * The badge above the headline, with its number (T54).
 *
 * "Index live for 15 occupations, updated monthly from public data" when the
 * feed answered on this request. The count is the table the explorer buys its
 * round from, src/lib/occupations.ts, which is the fifteen groups DESIGN.md
 * 3.3 names; the reading behind the badge is one of them and the round under
 * the hero is all of them. When the feed did not answer the badge says what it
 * is showing instead and carries no number, because the one thing it may
 * never do is decorate a stale reading.
 */
export function indexBadge(live: boolean, count: number = OCCUPATIONS.length): string {
  if (!live) return 'Showing the last reading we published';
  return `Index live for ${String(count)} occupations, updated monthly from public data`;
}

export interface LandingIndexSection {
  /** Whether the feed answered on this request. The page's "index live" state. */
  readonly live: boolean;
  /** The badge above the headline, worded for this render. */
  readonly badge: string;
  /** Null while the feed answers, the honest note when it does not. */
  readonly note: string | null;
}

/**
 * What the page says about the state of the feed it was served by.
 *
 * The readings themselves are the explorer's, which the page now carries whole
 * (T34), so this is no longer a second drawing of one occupation's chart. What
 * it still decides is the one thing the explorer cannot: whether the metered
 * reading behind the hero's live badge and the trigger level in the copy came
 * from a feed that answered, and what to say when it did not.
 */
export function landingIndexSection(index: IndexView | null, live: boolean): LandingIndexSection {
  const headline = index === null ? null : headlineReading(index);
  if (index === null || headline === null) {
    // Two different things and two different notes. A feed that did not answer
    // is an outage; a feed that answered with no headline is an occupation the
    // index has not published for yet, and saying the feed is down in that case
    // would be a false statement about a working endpoint.
    return {
      live,
      badge: indexBadge(live),
      note:
        live && index !== null
          ? 'No reading has been published for this occupation yet.'
          : 'The live feed is not answering, so there is no reading to show.',
    };
  }

  return { live, badge: indexBadge(live), note: live ? null : staleNote(index.as_of) };
}

export interface TickerReading {
  readonly occupation: string;
  /** "0.7 points away", "on the line" or "claims open". */
  readonly gap: string;
}

/**
 * The readings the ticker under the hero runs.
 *
 * All fifteen groups, one reading each, in the explorer's own order of closest
 * to a payout first, with the occupation this page speaks for moved to the
 * front so that the first thing the eye catches is the one the hero card and
 * the price are about.
 *
 * The wording is the explorer's, through `rankByDistance`, rather than a second
 * vocabulary invented here for the same measurement. A group the feed had no
 * reading for still appears and says so, because leaving it out would make the
 * ticker a list of the occupations that happen to be measurable today.
 */
export function tickerReadings(
  occupations: readonly ExplorerOccupation[],
  group: string = LANDING_GROUP,
): readonly TickerReading[] {
  const ranked = rankByDistance(occupations);
  const ordered = [
    ...ranked.filter((entry) => entry.occupation.key === group),
    ...ranked.filter((entry) => entry.occupation.key !== group),
  ];
  return ordered.map((entry) => ({ occupation: entry.occupation.label, gap: entry.gap }));
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

/**
 * One event around the hero card (T54): something that actually happened,
 * with where it can be read without trusting this page.
 *
 * Every chip on the hero is one of these, and each is built here from a record
 * the page already reads. Nothing in this file invents one: a reading with no
 * month, a coupon nobody was paid and a month the oracle has not published are
 * each a chip that does not exist, which is what the two builders below return
 * for them.
 */
export interface LandingEvent {
  readonly key: string;
  /** What happened, in white. */
  readonly title: string;
  /** When, or how far, in the secondary opacity. */
  readonly detail: string;
  /** Where the same event can be read: HashScan, or the explorer on this page. */
  readonly href: string;
  /** The occupation to open the explorer on, for a chip that points at it. */
  readonly group: string | null;
}

/**
 * The readings worth a chip: the occupation nearest its line, and the one this
 * page speaks for.
 *
 * Both are the explorer's own round and the explorer's own words through
 * `rankByDistance`, the same rule the ticker follows, so the chip, the strip
 * and the panel cannot say one distance three ways. When the page's own
 * occupation is the nearest, the second chip is the next nearest, so there
 * are two readings and not one said twice. An occupation with no reading is
 * skipped rather than shown saying "no reading", because a chip is an event
 * and that is the absence of one.
 */
export function readingEvents(
  occupations: readonly ExplorerOccupation[],
  group: string = LANDING_GROUP,
): readonly LandingEvent[] {
  const read = rankByDistance(occupations).flatMap((entry) =>
    entry.month === null ? [] : [{ ...entry, month: entry.month }],
  );
  const nearest = read[0] ?? null;
  const own = read.find((entry) => entry.occupation.key === group) ?? null;
  const second = own !== null && own !== nearest ? own : (read[1] ?? null);
  return [nearest, second]
    .flatMap((entry) => (entry === null ? [] : [entry]))
    .map((entry) => ({
      key: `reading-${entry.occupation.key}`,
      title: entry.occupation.label,
      detail: `${entry.gap}, ${formatPeriod(entry.month.period)}`,
      href: '#the-index',
      group: entry.occupation.key,
    }));
}

/**
 * The month the oracle settled on the index topic, as a chip, or null.
 *
 * The receipt is the reading's own `publication`: the topic and the sequence
 * number the API read back from the chain. Null there is a month that was
 * computed and not yet published, which is not an event and gets no chip.
 */
export function publishedEvent(index: IndexView | null): LandingEvent | null {
  if (index === null || index.publication.topic_id === null) return null;
  const { topic_id: topic, sequence_number: sequence } = index.publication;
  return {
    key: `published-${index.group}-${index.as_of}`,
    title: `Index published, ${formatPeriod(index.as_of)}`,
    detail: sequence === null ? `Topic ${topic}` : `Topic ${topic}, message ${String(sequence)}`,
    href: hashscanTopicUrl(topic),
    group: null,
  };
}

/** How many coupon chips the hero carries: the newest, and the one before it. */
export const COUPON_EVENTS = 2;

/**
 * The coupons that were actually paid, newest first, each linking the
 * settlement that paid it.
 *
 * "Paid" is the settlement's own `settled` flag and not the presence of a
 * transaction, the rule src/lib/investor-model.ts already follows: a
 * Scheduled Transaction executes whether or not the transfer inside it
 * succeeded. The amount is what moved to the holders that were paid, and the
 * link is the first of those transfers on HashScan. A coupon declared and not
 * yet payable has no settled holder and no chip.
 */
export function couponEvents(coupons: CouponsView): readonly LandingEvent[] {
  return coupons.coupons
    .flatMap((coupon): LandingEvent[] => {
      const paid = coupon.holders.filter((holder) => holder.settlement.settled);
      const first = paid[0];
      if (first === undefined || first.settlement.hashscan.transaction === null) return [];
      const moved = paid.reduce((sum, holder) => sum + BigInt(holder.amount.amount), 0n);
      const day = isoDay(first.settlement.paid_at ?? coupon.execution_date);
      return [
        {
          key: `coupon-${coupon.coupon_id}`,
          title: `Coupon ${coupon.coupon_id} paid`,
          detail: `${formatMoney(moved, first.amount.decimals)} on ${formatDayWithYear(day)}`,
          href: first.settlement.hashscan.transaction,
          group: null,
        },
      ];
    })
    .reverse()
    .slice(0, COUPON_EVENTS);
}

/** One large figure in the band under the hero, with its label. */
export interface LandingFigure {
  readonly value: string;
  readonly label: string;
}

/**
 * The first month of the index history, docs/INDEX.md: "The backtest window
 * on this page runs from 2010-01." The page prints how many whole years run
 * from here to the newest month it was served, so the figure moves with the
 * index and the start is the one thing typed. apps/web/test/landing.test.tsx
 * pins it to that document.
 */
export const INDEX_HISTORY_FROM = '2010-01';

/**
 * "16", the whole years of index history between the backtest's first month
 * and the newest month the page has, or null with no month to count to.
 */
export function historyYears(asOf: string | null, from: string = INDEX_HISTORY_FROM): number | null {
  if (asOf === null) return null;
  const months = monthsBetween(from, asOf);
  return months === null ? null : Math.floor(months / 12);
}

function monthsBetween(from: string, to: string): number | null {
  const start = /^(\d{4})-(\d{2})$/.exec(from);
  const end = /^(\d{4})-(\d{2})$/.exec(to);
  if (start === null || end === null) return null;
  const months =
    (Number(end[1]) - Number(start[1])) * 12 + (Number(end[2]) - Number(start[2]));
  return months < 0 ? null : months;
}

/** The years figure, built the same way as the ones from the note. */
export function historyFigure(asOf: string | null): LandingFigure | null {
  const years = historyYears(asOf);
  return years === null ? null : { value: String(years), label: 'years of index history' };
}

/**
 * The three figures the note gives the band: coupons settled, what has been
 * paid to the noteholders, and the principal funding the cover.
 *
 * The count is the API's own `coupons.settled`. The paid total is the sum of
 * every settled holder row, which is the arithmetic the investor screen's
 * "Earned to date" already does across one holder; here it is across all of
 * them. The principal is what was funded, in the deck's whole-money form.
 */
export function noteFigures(series: SeriesView, coupons: CouponsView): readonly LandingFigure[] {
  const decimals = series.settlement_asset.decimals;
  const paid = coupons.coupons
    .flatMap((coupon) => coupon.holders.filter((holder) => holder.settlement.settled))
    .reduce((sum, holder) => sum + BigInt(holder.amount.amount), 0n);
  const principal = BigInt(series.vault.principal_funded.amount);
  // A note that has settled nothing yet has no coupon figure rather than a
  // nought, for the reason "Earned to date" is null before a payment: 0.00
  // in a band of achievements reads as a failure, and it is not one.
  return [
    ...(series.coupons.settled > 0 && paid > 0n
      ? [
          { value: String(series.coupons.settled), label: 'coupons settled on Hedera' },
          { value: formatMoney(paid, decimals), label: 'paid to noteholders' },
        ]
      : []),
    ...(principal > 0n
      ? [{ value: formatWholeMoney(principal, decimals), label: 'funding the cover' }]
      : []),
  ];
}
