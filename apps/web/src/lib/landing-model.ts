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

import { rankByDistance, type ExplorerOccupation } from './explorer-model';
import { formatAmount, formatMoney, formatPeriod, formatWholeMoney } from './format';
import { OCCUPATIONS, occupationLabel } from './occupations';
import { exhaustionFor, headlineReading, levelLinePhrase, pointsInProse } from './worker-model';
import type { CouponsView, SeriesView } from './investor-api';
import type { IndexCatalogueView, IndexView } from './worker-api';

/**
 * The one occupation the landing page speaks for: the hero card, the from
 * price and the index section are all this group.
 *
 * The design of record shows Office and administrative support. Computer and
 * mathematical was the only group with a series behind it when this was
 * chosen, so it was the only one whose card could honestly read "Covered".
 * T39 issued capacity for the other fourteen and all fifteen can be bought
 * now, but the hero keeps this one: it is the group every recorded figure on
 * the page was read against. Recorded in docs/DECISIONS.md.
 *
 * The index explorer under the hero opens somewhere else on purpose, on
 * whichever occupation is nearest its line, because that is the one a reader
 * has come to look at. See OPENS_ON in src/app/index/explorer-panel.tsx.
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
 * "When does it pay." Both triggers, both levels, and the occupation they are
 * for.
 *
 * Two things were wrong with the sentence this replaces, and they were the same
 * thing twice. It said "When the index for your occupation rises 2 points above
 * its trend", which is the attachment and is one of the two ways claims open;
 * the explorer directly beneath it was captioned with the other one, the level
 * line, on a different scale and with no word anywhere saying they were
 * different triggers. So the answer now names both, in the vocabulary the Index
 * tab already uses for them, and each figure is labelled with the trigger it
 * belongs to.
 *
 * The occupation is named rather than left as "your occupation". It said "your
 * occupation" while being computed for LANDING_GROUP, which is computer and
 * mathematical: not the reader's occupation, and not the one the explorer four
 * inches below it opens on either. The two are deliberately separate (see
 * LANDING_GROUP above and OPENS_ON in src/app/index/explorer-panel.tsx), the
 * levels are per occupation, and this is a server rendered sentence in a ledger
 * while the panel's selection is client state the reader moves. Making the
 * answer chase the panel would mean either lifting that selection into the page
 * or letting a ledger row rewrite itself under the reader's hand. So the answer
 * says which occupation it is about instead, which is the honest version and
 * the cheaper one. Recorded in docs/DECISIONS.md.
 *
 * The full payout sentence is dropped when the series publishes no exhaustion,
 * the same rule the Amount screen's sentence follows. When there is no reading
 * and no catalogue either, the figures are gone and the answer says what is
 * still true and says why the levels are missing, rather than printing them
 * from memory.
 */
export function payAnswer(
  attachment: string | number | null,
  levelLine: string | number | null,
  group: string,
  seriesId: string | null,
): string {
  const label = occupationLabel(group).toLowerCase();
  if (attachment === null || levelLine === null) {
    return `Claims open in two ways for ${label}: a sudden jump past its trigger line, or staying worse than anything in the decade before AI. The live feed is not answering, so the levels are not shown.`;
  }
  const exhaustion = seriesId === null ? null : exhaustionFor(seriesId);
  const first = `Claims open in two ways for ${label}: a sudden jump of ${pointsInProse(attachment)} points above trend, or staying ${levelLinePhrase(levelLine)}.`;
  if (exhaustion === null) return first;
  return `${first} A jump of ${pointsInProse(exhaustion)} pays in full.`;
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

/**
 * The other trigger's level, read the same way and from the same two places.
 *
 * The answer above names both, so both have to come from a record. The
 * catalogue is free and carries this line frozen at issuance alongside the
 * attachment, so a deployment whose wallet has run dry prints both levels or
 * neither and never one with the other invented.
 */
export function levelLineFor(
  group: string,
  index: IndexView | null,
  catalogue: IndexCatalogueView | null,
): string | null {
  if (index !== null) return index.trigger.level_line;
  const row = catalogue?.groups.find((candidate) => candidate.group === group) ?? null;
  return row?.level_line ?? null;
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
 * them.
 *
 * The principal is every occupation's, not this note's. It was this note's
 * funded principal, 100,000, standing on a landing page beside "3 coupons
 * settled on Hedera" where it reads as the product's capital: it understated
 * the product 4.5 times while overstating this one series by the 3,000 already
 * paid out of it. The caller hands in the sum across all fifteen, read from the
 * same held call the occupation picker already makes, and it is the principal
 * still standing rather than the principal ever funded, which is the base the
 * pool binds against. Without it the figure is dropped rather than falling back
 * to one series, because one series under that label is the bug.
 */
export function noteFigures(
  series: SeriesView,
  coupons: CouponsView,
  principalBehindCover: bigint | null,
): readonly LandingFigure[] {
  const decimals = series.settlement_asset.decimals;
  const paid = coupons.coupons
    .flatMap((coupon) => coupon.holders.filter((holder) => holder.settlement.settled))
    .reduce((sum, holder) => sum + BigInt(holder.amount.amount), 0n);
  const principal = principalBehindCover ?? 0n;
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
