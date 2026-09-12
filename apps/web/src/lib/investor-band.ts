/**
 * What the landing page's investor band reads, and what it may say.
 *
 * The band exists because a visitor can read the whole front door without ever
 * learning that there is a side of this product that funds the cover rather
 * than buying it. "Earn yield" in the header and "I want to invest" in the
 * closing band are the only two ways in, and both are a control rather than a
 * proposition.
 *
 * Every figure here is read from the records the investor screens read, through
 * the same functions, so the front door and /invest cannot disagree about what
 * an occupation costs or where a return comes from:
 *
 *   the price      `marketRate(guideRate(distance), utilisation)`, which is
 *                  `premiumRatePercent` in src/lib/investor-model.ts, applied to
 *                  the same two live inputs the market board applies it to
 *   the split      `returnSplit` in packages/index-model/src/pricing.ts, the
 *                  arithmetic behind the board's own yield line
 *   the capacity   `capacityPercent`, the series' committed exposure over the
 *                  principal still standing behind it
 *
 * Three of the four reads cost this page nothing at all. The round of fifteen
 * readings is src/lib/explorer-data.ts's, held and already bought for the
 * explorer under the hero; what capital has funded is
 * src/lib/cover-availability.ts's, held and already bought for the from price.
 * The fourth is a series read, which is free, unmetered and new: see NOTE_TTL_MS
 * below.
 *
 * Two things this module will not produce.
 *
 * It will not produce a return. The coupon is a rate written into one series at
 * issuance, the closing band already carries it, and a landing page that put a
 * yield in a large figure would be promising one. What the band shows instead
 * is where the money comes from, in three parts, unnetted.
 *
 * And it will not state the base as earned. `PRICING.impliedBaseYield` is what
 * collateral would make in tokenised treasuries; this deployment holds its
 * collateral in a vault on Hedera testnet and deploys none of it. Every surface
 * that shows the split says so and so does this one, which is why the split is
 * handed over in its three parts rather than as a total.
 */

import { reportUnreachable } from './api';
import { readUtilisation } from './cover-availability';
import { readExplorer, type ExplorerData } from './explorer-data';
import { rankByDistance, type RankedOccupation } from './explorer-model';
import { heldRead } from './held-read';
import { fetchSeries, fetchSeriesList, type SeriesView } from './investor-api';
import { capacityPercent, premiumRatePercent } from './investor-model';

import { expectedLossRate, guideRate, marketRate, returnSplit } from '@creance/index-model/src/pricing';

/**
 * How long the series read stands. The head of GET /v1/series is the same
 * series the landing's closing line and the /invest default open on, and what
 * this band takes from it, the principal, the exposure and the capacity, moves
 * when somebody buys cover and not otherwise. The same window the landing page
 * holds its own note read for.
 */
export const NOTE_TTL_MS = 10 * 60 * 1000;
export const NOTE_STALE_MS = 10 * 60 * 1000;

/**
 * A figure the band can be handed either way: the value, or a promise of it.
 *
 * The same shape the landing page and the investor route hand their own
 * sections. The server hands a promise, so the band's heading is on the first
 * byte and the figures land behind their own boundary; a test hands the value
 * and the same components render it with no resting state in between.
 */
export type Streamed<T> = T | Promise<T>;

/** The lowest and highest annual rate cover is priced at, across the round. */
export interface PricedRange {
  readonly low: number;
  readonly high: number;
  /** How many occupations were priced to get it. */
  readonly count: number;
}

/** The three parts of the return, as annual percentages of the principal. */
export interface BandSplit {
  /** What the collateral would make waiting. Not earned in this deployment. */
  readonly base: number;
  readonly premium: number;
  readonly loss: number;
}

export interface InvestorBandView {
  /** What cover across the occupations is priced at, or null with no round. */
  readonly priced: PricedRange | null;
  /** Where the return on the featured series comes from, in three parts. */
  readonly split: BandSplit | null;
  /** How much of the capital behind that series is standing behind cover. */
  readonly capacity: number | null;
  /** The series the split and the capacity are about, and its note on Hedera. */
  readonly note: { readonly label: string; readonly hashscan: string | null } | null;
}

/** Nothing could be read. The band renders nothing at all on this. */
export const NO_INVESTOR_BAND: InvestorBandView = {
  priced: null,
  split: null,
  capacity: null,
  note: null,
};

/** Whether this view has anything worth standing a band up for. */
export function hasInvestorBand(view: InvestorBandView): boolean {
  return view.priced !== null || view.split !== null || view.capacity !== null;
}

/**
 * The series the band speaks for: the head of GET /v1/series, which is the
 * same one /invest opens on and the same one the landing's closing line takes
 * its coupon from, so no two surfaces of this product feature different notes.
 */
const note = heldRead<SeriesView>({
  what: 'the landing investor band series',
  ttlMs: NOTE_TTL_MS,
  staleMs: NOTE_STALE_MS,
  read: async () => {
    const listing = await fetchSeriesList();
    const first = listing.series[0]?.series_id;
    if (first === undefined) throw new Error('the API serves no series');
    return await fetchSeries(first);
  },
});

/** Tests only. A module level hold outlives a test file otherwise. */
export function forgetInvestorBand(): void {
  note.forget();
}

/**
 * The band's figures, with every read allowed to fail on its own.
 *
 * A read that fails costs the band the figures it carried and never the band,
 * and a band with nothing left in it is not rendered. This is the front door:
 * it has to draw whatever happens.
 */
export async function readInvestorBand(): Promise<InvestorBandView> {
  const [round, utilisation, series] = await Promise.all([
    readRound(),
    readCapacity(),
    readNote(),
  ]);
  const ranked = round === null ? [] : rankByDistance(round.occupations);
  const distance =
    series === null
      ? null
      : (ranked.find((entry) => entry.occupation.key === series.group)?.month?.distance ?? null);
  return {
    priced: pricedRange(ranked, utilisation),
    split: splitFor(series, distance),
    capacity: series === null ? null : capacityPercent(series),
    note:
      series === null
        ? null
        : { label: series.series_id, hashscan: series.note?.hashscan ?? null },
  };
}

/**
 * What cover is priced at across the occupations the index prices today.
 *
 * The same formula the market board's premium column uses, on the same two
 * inputs: the distance from an occupation's newest published reading to its
 * line, and the share of its series' remaining principal already committed as
 * exposure. Both are already on this page: the round is the explorer's under
 * the hero and the utilisation is the free capacity read the from price ranks
 * with, and both are behind holds shared with those callers, so this costs
 * nothing.
 *
 * Distance is floored at zero, as every other pricing surface floors it: the
 * hazard is fitted to buckets that begin at the line and says nothing below it.
 *
 * An occupation with no series behind it cannot be quoted and so is not counted
 * or priced, which is the same rule the landing's own "from" price ranks by.
 *
 * This is the series level rate, which is what the board's premium column shows
 * for every occupation capital has not split into experience bands. On one that
 * it has, /invest quotes a rate per band, because utilisation is measured per
 * band there, and the band rates straddle this one. The board carries both.
 */
export function pricedRange(
  ranked: readonly RankedOccupation[],
  utilisation: Readonly<Record<string, number>>,
): PricedRange | null {
  const rates: number[] = [];
  for (const entry of ranked) {
    const distance = entry.month?.distance ?? null;
    if (distance === null || entry.occupation.seriesId === null) continue;
    const rate =
      marketRate(guideRate(Math.max(0, distance)), utilisation[entry.occupation.key] ?? 0) * 100;
    if (Number.isFinite(rate)) rates.push(rate);
  }
  if (rates.length === 0) return null;
  return { low: Math.min(...rates), high: Math.max(...rates), count: rates.length };
}

async function readRound(): Promise<ExplorerData | null> {
  try {
    return await readExplorer();
  } catch (cause) {
    reportUnreachable('the landing investor band readings', cause);
    return null;
  }
}

async function readCapacity(): Promise<Readonly<Record<string, number>>> {
  try {
    return await readUtilisation();
  } catch (cause) {
    reportUnreachable('the landing investor band capacity', cause);
    return {};
  }
}

async function readNote(): Promise<SeriesView | null> {
  try {
    return await note.read();
  } catch (cause) {
    reportUnreachable('the landing investor band series', cause);
    return null;
  }
}

/**
 * Where this series' return comes from, in three parts, as annual percentages
 * of the principal still standing behind it.
 *
 * `returnSplit`'s own arithmetic, on the figures the board feeds it: the rate
 * cover on this occupation is priced at, the exposure written against the
 * series, the principal remaining, and the loss the index expects at this
 * distance. Divided by principal remaining rather than principal funded,
 * because that is the base the rate was priced off, and dividing by what was
 * funded would print a share of premium that does not reconcile to the rate it
 * came from on any series that has paid a claim.
 *
 * Null wherever the rate is null, for the reason `premiumRatePercent` gives:
 * an unpriced risk is not a free one, and a split nobody can check is worse
 * than no split.
 */
function splitFor(series: SeriesView | null, distance: number | null): BandSplit | null {
  if (series === null || distance === null) return null;
  const rate = premiumRatePercent(series, distance);
  const pool = series.cover_pool;
  if (rate === null || pool === null) return null;
  const split = returnSplit(
    rate / 100,
    Number(BigInt(pool.active_exposure.amount)),
    Number(BigInt(series.vault.principal_remaining.amount)),
    expectedLossRate(Math.max(0, distance)),
  );
  // `total` is deliberately dropped here. It is the one figure on this page
  // that would read as a yield, and the base it contains has not been earned.
  return split === null ? null : { base: split.base, premium: split.premium, loss: split.loss };
}
