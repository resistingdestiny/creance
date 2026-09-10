/**
 * What the landing page reads before it renders.
 *
 * Four calls, all on the server, all live: the metered index reading, a quote
 * for the smallest cover on offer, the coupon the note pays, and the round of
 * fifteen readings the explorer buys. The first three are not cached, because a
 * front door that shows yesterday's premium is worse than one that shows no
 * premium (src/lib/api.ts says the same for every other screen).
 *
 * The round is the one exception, and it is not this module's exception to
 * make: it is the round the public explorer already bought, which
 * src/lib/explorer-data.ts holds for ten minutes behind one in-flight promise.
 * The index publishes once a month, so a reading a few minutes old is the same
 * reading, and the landing pays nothing extra whenever that round is warm. It
 * is both the explorer this page now carries (T34) and the ticker under the
 * hero, read once and shown twice.
 *
 * Every call is allowed to fail on its own. The page is the front door and it
 * has to render whatever happens, so a failure removes the figure it carried
 * and adds the note that says so, and never removes the page.
 */

import { reportUnreachable } from './api';
import { fetchReplay } from './claim-api';
import { replayBadgeLabel } from './claim-model';
import { AMOUNT_MIN } from './cover-amount';
import { readExplorer, type ExplorerData } from './explorer-data';
import { fetchSeries, fetchSeriesList } from './investor-api';
import { couponLine } from './investor-model';
import {
  LANDING_GROUP,
  attachmentFor,
  costAnswer,
  fromPriceLine,
  investorLine,
  landingIndexSection,
  payAnswer,
  seriesFor,
  tickerReadings,
  type LandingIndexSection,
  type TickerReading,
} from './landing-model';
import { recallReading, rememberReading } from './last-reading';
import { occupationLabel } from './occupations';
import { DEMO_ACCOUNT } from './wallet';
import {
  fetchIndex,
  fetchIndexCatalogue,
  requestQuote,
  toMinorUnits,
  type IndexCatalogueView,
  type IndexView,
} from './worker-api';
import { premiumAmount } from './worker-model';

export interface LandingData {
  readonly group: string;
  /** "Computer and mathematical", which is what the hero card is titled. */
  readonly occupation: string;
  /** "From 28.00 a month", or null when no price could be quoted. */
  readonly priceLine: string | null;
  /** "What does it cost." */
  readonly costLine: string;
  /** "When does it pay." */
  readonly payLine: string;
  /** "Investors fund the cover and earn 8 percent a year, paid monthly." */
  readonly investorLine: string;
  readonly index: LandingIndexSection;
  /** The fifteen occupations the ticker runs, or empty when none could be read. */
  readonly ticker: readonly TickerReading[];
  /** The public explorer's own round, or null when it could not be read. */
  readonly explorer: ExplorerData | null;
  /** "Replay: Jul 2026" while the demo clock is walking. */
  readonly replayBadge: string | null;
}

export async function readLanding(group: string = LANDING_GROUP): Promise<LandingData> {
  const [reading, premium, coupon, explorer] = await Promise.all([
    readIndex(group),
    readPrice(group),
    readCoupon(),
    readExplorerData(),
  ]);

  // The catalogue is free and carries the frozen trigger lines but no values.
  // It is asked only when the reading could not be had, which is the one case
  // where the copy would otherwise lose the level that opens claims.
  const catalogue = reading.index === null ? await readCatalogue() : null;

  return {
    group,
    occupation: occupationLabel(group),
    priceLine: fromPriceLine(premium),
    costLine: costAnswer(premium),
    payLine: payAnswer(
      attachmentFor(group, reading.index, catalogue),
      seriesFor(group, reading.index, catalogue),
    ),
    investorLine: investorLine(coupon),
    index: landingIndexSection(reading.index, reading.live),
    ticker: explorer === null ? [] : tickerReadings(explorer.occupations, group),
    explorer,
    // The explorer reads the demo clock on every request of its own, so the
    // badge comes back with the round. Only a page that has no round at all
    // has to ask for it separately, and it still asks, because the badge is
    // about what is on screen rather than about the index.
    replayBadge: explorer?.replayBadge ?? replayBadgeLabel(await fetchReplay()),
  };
}

/**
 * The reading, live if the feed answers and the last published one if it does
 * not. A successful read is remembered so that the next failure has something
 * true to show.
 */
async function readIndex(group: string): Promise<{ index: IndexView | null; live: boolean }> {
  try {
    const index = await fetchIndex(group);
    rememberReading(index);
    return { index, live: true };
  } catch (cause) {
    reportUnreachable('the landing index section', cause);
    return { index: recallReading(group), live: false };
  }
}

/**
 * The from price: a quote for the smallest cover on offer.
 *
 * A quote takes no capacity, lasts fifteen minutes and needs no eligibility,
 * so pricing the landing costs the same call the Amount screen makes and the
 * figure is a binding price rather than a number in a copy deck.
 */
async function readPrice(group: string): Promise<string | null> {
  try {
    const quote = await requestQuote({
      group,
      limit: toMinorUnits(AMOUNT_MIN),
      wallet: DEMO_ACCOUNT.accountId,
    });
    return premiumAmount(quote.premium);
  } catch (cause) {
    reportUnreachable('the landing from price', cause);
    return null;
  }
}

/**
 * The coupon the note pays, from the series the investor screens already read.
 *
 * Which series is the API's to say, not this page's: it is the head of
 * GET /v1/series, the same default /invest opens on, so the landing page and
 * the investor screen never quote different notes.
 */
async function readCoupon(): Promise<string | null> {
  try {
    const listing = await fetchSeriesList();
    const first = listing.series[0]?.series_id;
    if (first === undefined) return null;
    return couponLine(await fetchSeries(first));
  } catch (cause) {
    reportUnreachable('the landing investor line', cause);
    return null;
  }
}

/**
 * The public explorer's round, which is the readings on the page and the ticker
 * under the hero both.
 *
 * The free catalogue carries the trigger lines but no values, so the only
 * public route with readings on it is the metered one, and fifteen of those is
 * exactly the round the explorer buys. This asks for that round rather than
 * buying a sixteenth of its own: src/lib/explorer-data.ts holds it for ten
 * minutes behind one in-flight promise, so the landing pays nothing extra
 * whenever it is warm. It is read here on the server, never from the browser,
 * and it is never a fixture.
 *
 * A round that cannot be had costs the page its explorer and its ticker and
 * nothing else.
 */
async function readExplorerData(): Promise<ExplorerData | null> {
  try {
    return await readExplorer();
  } catch (cause) {
    reportUnreachable('the landing index explorer', cause);
    return null;
  }
}

async function readCatalogue(): Promise<IndexCatalogueView | null> {
  try {
    return await fetchIndexCatalogue();
  } catch (cause) {
    reportUnreachable('the landing trigger line', cause);
    return null;
  }
}
